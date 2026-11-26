using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Cantrip.Realms.Server.Reports;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// Playtest reports (F8 in the game; realms/reports/README.md): <c>POST /api/reports</c> writes a folder of the reports
/// directory - report.md with the front matter an agent triages by, the screenshot, context.json with the server's side
/// beside the page's, the logs - and refuses what is not a report.
/// </summary>
public sealed class ReportTests : IDisposable
{
    private readonly string _reports = Path.Combine(Path.GetTempPath(), $"cantrip-reports-{Guid.NewGuid():N}");

    /// <summary>A one-pixel PNG.</summary>
    private const string Pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    public void Dispose()
    {
        if (Directory.Exists(_reports)) Directory.Delete(_reports, recursive: true);
    }

    private RealmApp App()
    {
        var app = new RealmApp();
        app.Settings["REALMS_REPORTS"] = _reports;
        return app;
    }

    private static object Report(string title = "The goblin walked through the wall", string kind = "bug", string severity = "major", string? screenshot = Pixel) => new
    {
        Kind = kind,
        Severity = severity,
        Area = "Walking",
        Title = title,
        Description = "It went straight through the smithy's back wall.\nThen it stood inside.",
        Screenshot = screenshot,
        Place = "world 412,388",
        Screen = "world",
        Build = "abc1234",
        Summary = new[] { "Place: world, tile 412,388", "Character: Tester (W)" },
        Context = new Dictionary<string, object> { ["Tile"] = new Dictionary<string, int> { ["X"] = 412, ["Z"] = 388 } },
        Console = "12:00:01 warn [realm] a warning\n",
        Network = "GET /api/me 200 12ms",
        Cards = "",
        Trace = "connected to the relay",
    };

    [Fact]
    public async Task A_report_is_a_folder_an_agent_reads()
    {
        using RealmApp app = App();
        Browser browser = await app.Character(1, name: "Ann");
        ReportFiled filed = await browser.Ok<ReportFiled>(HttpMethod.Post, "/api/reports", Report());

        Assert.Equal("20261123-103000-bug-the-goblin-walked-through-the-wall", filed.Id);
        string folder = Path.Combine(_reports, filed.Id);
        Assert.Equal(Path.GetFullPath(folder), Path.GetFullPath(filed.Folder));
        string md = await File.ReadAllTextAsync(Path.Combine(folder, "report.md"));
        Assert.StartsWith("---\nid: 20261123-103000-bug-the-goblin-walked-through-the-wall\nkind: bug\nseverity: major\narea: walking\nstatus: new\n", md, StringComparison.Ordinal);
        Assert.Contains("title: \"The goblin walked through the wall\"\n", md, StringComparison.Ordinal);
        Assert.Contains("player: \"dev-1\"\ncharacter: \"Ann\"\nplace: \"world 412,388\"\n", md, StringComparison.Ordinal);
        Assert.Contains("# The goblin walked through the wall\n\nIt went straight through the smithy's back wall.\nThen it stood inside.\n", md, StringComparison.Ordinal);
        Assert.Contains("- Place: world, tile 412,388\n", md, StringComparison.Ordinal);
        Assert.Contains("## Triage", md, StringComparison.Ordinal);

        byte[] png = await File.ReadAllBytesAsync(Path.Combine(folder, "screenshot.png"));
        Assert.Equal(0x89, png[0]);
        Assert.Equal("12:00:01 warn [realm] a warning\n", await File.ReadAllTextAsync(Path.Combine(folder, "console.log")));
        Assert.True(File.Exists(Path.Combine(folder, "network.log")));
        Assert.True(File.Exists(Path.Combine(folder, "trace.log")));
        // Nothing the page had is no file.
        Assert.False(File.Exists(Path.Combine(folder, "cards.log")));
        Assert.Contains("`console.log`", md, StringComparison.Ordinal);
        Assert.DoesNotContain("`cards.log`", md, StringComparison.Ordinal);

        using JsonDocument context = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(folder, "context.json")));
        Assert.Equal(412, context.RootElement.GetProperty("Page").GetProperty("Tile").GetProperty("X").GetInt32());
        JsonElement server = context.RootElement.GetProperty("Server");
        Assert.Equal("dev-1", server.GetProperty("Player").GetString());
        Assert.Equal("Ann", server.GetProperty("State").GetProperty("Character").GetProperty("Name").GetString());
    }

    [Fact]
    public async Task A_second_report_of_the_same_moment_and_title_has_a_folder_of_its_own()
    {
        using RealmApp app = App();
        Browser ann = await app.Character(1);
        Browser bo = await app.Character(2);
        ReportFiled first = await ann.Ok<ReportFiled>(HttpMethod.Post, "/api/reports", Report("Same", kind: "feedback", screenshot: null));
        ReportFiled second = await bo.Ok<ReportFiled>(HttpMethod.Post, "/api/reports", Report("Same", kind: "feedback", screenshot: null));
        Assert.Equal("20261123-103000-feedback-same", first.Id);
        Assert.Equal("20261123-103000-feedback-same-2", second.Id);
        Assert.False(File.Exists(Path.Combine(first.Folder, "screenshot.png")));
    }

    [Fact]
    public async Task A_player_with_no_character_yet_reports_too()
    {
        using RealmApp app = App();
        Browser browser = await app.SignIn(3);
        ReportFiled filed = await browser.Ok<ReportFiled>(HttpMethod.Post, "/api/reports", Report(kind: "idea", severity: "trivial"));
        string md = await File.ReadAllTextAsync(Path.Combine(filed.Folder, "report.md"));
        Assert.Contains("player: \"dev-3\"\nplace:", md, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_server_log_lately_goes_with_a_report()
    {
        using RealmApp app = App();
        Browser browser = await app.Character(1);
        // What the page logs on the server (a jump of the figure) is a warning of the realm's own.
        await browser.Ok<object>(HttpMethod.Post, "/dev/log", new { Text = "jump in world: 1,1 -> 9,9" });
        ReportFiled filed = await browser.Ok<ReportFiled>(HttpMethod.Post, "/api/reports", Report());
        string log = await File.ReadAllTextAsync(Path.Combine(filed.Folder, "server.log"));
        Assert.Contains("warn Cantrip.Realms.Server.Client: Client dev-1: jump in world: 1,1 -> 9,9", log, StringComparison.Ordinal);
    }

    [Fact]
    public async Task What_is_no_report_is_refused()
    {
        using RealmApp app = App();
        Browser browser = await app.Character(1);
        await browser.Refused(HttpMethod.Post, "/api/reports", Report(kind: "rant"), HttpStatusCode.BadRequest, "BadRequest");
        await browser.Refused(HttpMethod.Post, "/api/reports", Report(severity: "apocalyptic"), HttpStatusCode.BadRequest, "BadRequest");
        await browser.Refused(HttpMethod.Post, "/api/reports", Report(title: "   "), HttpStatusCode.BadRequest, "BadRequest");
        await browser.Refused(HttpMethod.Post, "/api/reports", Report(screenshot: "data:image/jpeg;base64,AAAA"), HttpStatusCode.BadRequest, "BadRequest");
        await browser.Refused(HttpMethod.Post, "/api/reports", Report(screenshot: "data:image/png;base64,AAAA"), HttpStatusCode.BadRequest, "BadRequest");
        Assert.False(Directory.Exists(_reports) && Directory.EnumerateDirectories(_reports).Any());
    }

    [Fact]
    public async Task Reports_come_no_faster_than_one_every_few_seconds()
    {
        using RealmApp app = App();
        Browser browser = await app.Character(1);
        await browser.Ok<ReportFiled>(HttpMethod.Post, "/api/reports", Report());
        await browser.Refused(HttpMethod.Post, "/api/reports", Report(), HttpStatusCode.Conflict, Codes.TooSoon);
        app.Time.Advance(PlayReports.Between);
        await browser.Ok<ReportFiled>(HttpMethod.Post, "/api/reports", Report());
    }

    [Fact]
    public async Task Only_a_player_signed_in_reports()
    {
        using RealmApp app = App();
        using HttpClient client = app.CreateClient();
        using HttpResponseMessage response = await client.PostAsJsonAsync("/api/reports", Report());
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("The goblin walked through the wall!", 48, "the-goblin-walked-through-the-wall")]
    [InlineData("  ¿Qué?  ", 48, "qu")]
    [InlineData("a--b  c", 48, "a-b-c")]
    [InlineData("abcdefghij", 4, "abcd")]
    public void Titles_are_slugs_in_the_folder_name(string title, int most, string slug) => Assert.Equal(slug, PlayReports.Slug(title, most));
}
