using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Cantrip.Realms.Server.Reports;

/// <summary>
/// A playtest report as the overworld sends it (<c>POST /api/reports</c>; F8 anywhere in the game, realms/web/src/reports):
/// what the player chose and wrote, the picture of the screen, and what the page knew - its state and its logs.
/// </summary>
/// <param name="Kind"><c>bug</c>, <c>feedback</c> or <c>idea</c>.</param>
/// <param name="Severity"><c>blocker</c>, <c>major</c>, <c>minor</c> or <c>trivial</c>.</param>
/// <param name="Area">The part of the game it is about, a short slug (<c>walking</c>, <c>duels</c>, ...).</param>
/// <param name="Title">One line.</param>
/// <param name="Description">What happened and what was expected, in the player's words.</param>
/// <param name="Screenshot">The screen when F8 was pressed, a <c>data:image/png;base64,</c> URL; null when left out.</param>
/// <param name="Place">Where the player stood, in a line (<c>world 412,388</c>).</param>
/// <param name="Screen">What the page was showing: <c>world</c>, a card screen's name, a dialog.</param>
/// <param name="Build">The overworld's build: its commit.</param>
/// <param name="Summary">The state in a few lines, for the report's page.</param>
/// <param name="Context">Everything the page knew, as it is: written out as <c>context.json</c>.</param>
/// <param name="Console">The overworld page's console lately, a line each.</param>
/// <param name="Network">The page's calls to this server lately.</param>
/// <param name="Cards">The card layer's console lately.</param>
/// <param name="Trace">What passed between the page and the presence relay, the figure's jumps and the walks refused.</param>
public sealed record ReportFiling(
    string? Kind,
    string? Severity,
    string? Area,
    string? Title,
    string? Description,
    string? Screenshot,
    string? Place,
    string? Screen,
    string? Build,
    IReadOnlyList<string>? Summary,
    JsonElement? Context,
    string? Console,
    string? Network,
    string? Cards,
    string? Trace);

/// <summary>A report filed: its id (the name of its folder) and the folder.</summary>
public sealed record ReportFiled(string Id, string Folder);

/// <summary>What the server adds to a report from what it knows: whose it is, their character as stored, its own log.</summary>
public sealed record ReportServerSide(string? Player, string? Character, object? State, IReadOnlyList<string> Log);

/// <summary>
/// Playtest reports (realms/reports/README.md): each one a folder of the reports directory (<c>REALMS_REPORTS</c>, by
/// default <c>realms/reports</c> of the repository the server runs from) named for when it was filed, its kind and its
/// title - a <c>report.md</c> to read first (front matter an agent triages by: kind, severity, area, status), the
/// screenshot, <c>context.json</c> and the logs. A player files at most one every <see cref="Between"/>.
/// </summary>
public sealed class PlayReports(RealmOptions options, TimeProvider time, RecentLog log)
{
    public static readonly IReadOnlyList<string> Kinds = ["bug", "feedback", "idea"];

    public static readonly IReadOnlyList<string> Severities = ["blocker", "major", "minor", "trivial"];

    /// <summary>The least time between two reports of one player.</summary>
    public static readonly TimeSpan Between = TimeSpan.FromSeconds(3);

    /// <summary>How far back the server's own log is attached.</summary>
    public static readonly TimeSpan LogWindow = TimeSpan.FromMinutes(15);

    private const int MaxTitle = 200;
    private const int MaxDescription = 20_000;
    private const int MaxLog = 1_000_000;
    private const int MaxScreenshot = 16_000_000;

    private readonly ConcurrentDictionary<string, DateTimeOffset> _last = new(StringComparer.Ordinal);

    /// <summary>Files a player's report, and says where it is.</summary>
    public ReportFiled File(string player, string? character, object? state, ReportFiling body)
    {
        DateTimeOffset now = time.GetUtcNow();
        if (_last.TryGetValue(player, out DateTimeOffset last) && now - last < Between)
        {
            throw Refusal.Conflict(Codes.TooSoon, "A report was just sent; wait a moment.");
        }

        ReportFiled filed = Write(options.Reports, body, new ReportServerSide(player, character, state, log.Since(now - LogWindow)), now);
        _last[player] = now;
        return filed;
    }

    /// <summary>
    /// Writes a report's folder into <paramref name="directory"/>: the realm server's for a signed-in player's, and the
    /// <c>report</c> command's for offline play's, which has no server (Program.cs).
    /// </summary>
    public static ReportFiled Write(string directory, ReportFiling body, ReportServerSide server, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(body);
        ArgumentNullException.ThrowIfNull(server);
        string kind = OneOf(body.Kind, Kinds, "kind");
        string severity = OneOf(body.Severity, Severities, "severity");
        string area = Slug(body.Area ?? "other", 32) is { Length: > 0 } a ? a : "other";
        string title = OneLine(body.Title);
        if (title.Length == 0) throw Refusal.BadRequest("A report needs a title.");
        if (title.Length > MaxTitle) title = title[..MaxTitle];
        string description = (body.Description ?? string.Empty).Trim();
        if (description.Length > MaxDescription) description = description[..MaxDescription];
        byte[]? png = Png(body.Screenshot);

        Directory.CreateDirectory(directory);
        string stem = $"{now.UtcDateTime:yyyyMMdd-HHmmss}-{kind}-{(Slug(title, 48) is { Length: > 0 } s ? s : "report")}";
        string id = stem;
        for (int n = 2; Directory.Exists(Path.Combine(directory, id)); n++) id = $"{stem}-{n}";
        string folder = Path.Combine(directory, id);
        Directory.CreateDirectory(folder);

        var files = new List<(string Name, string About)>();
        void Text(string name, string? text, string about)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            if (text.Length > MaxLog) text = text[^MaxLog..];
            System.IO.File.WriteAllText(Path.Combine(folder, name), text.EndsWith('\n') ? text : text + "\n");
            files.Add((name, about));
        }

        if (png is not null)
        {
            System.IO.File.WriteAllBytes(Path.Combine(folder, "screenshot.png"), png);
            files.Add(("screenshot.png", "the screen when the report was begun (the world's picture with the card layer's over it; the HUD's words are in context.json)"));
        }

        var context = new Dictionary<string, object?>
        {
            ["Page"] = body.Context,
            ["Server"] = new { server.Player, server.Character, Version = Version(), Received = now, server.State },
        };
        System.IO.File.WriteAllText(Path.Combine(folder, "context.json"), JsonSerializer.Serialize(context, Indented) + "\n");
        files.Add(("context.json", "the game's state: the page's (place, camera, character, screen, mobs and players near, the HUD, the debug overlay) and the server's (the character as stored)"));
        Text("console.log", body.Console, "the overworld page's console lately, errors included");
        Text("cards.log", body.Cards, "the card layer's console lately (the duel and the other card screens)");
        Text("network.log", body.Network, "the page's calls to the realm server lately");
        Text("trace.log", body.Trace, "the presence relay's trace, the figure's jumps and the walks the server refused");
        Text("server.log", server.Log.Count == 0 ? null : string.Join('\n', server.Log), $"the server's own log over the {LogWindow.TotalMinutes:0} minutes before");

        var md = new StringBuilder();
        md.Append("---\n");
        md.Append(CultureInfo.InvariantCulture, $"id: {id}\n");
        md.Append(CultureInfo.InvariantCulture, $"kind: {kind}\n");
        md.Append(CultureInfo.InvariantCulture, $"severity: {severity}\n");
        md.Append(CultureInfo.InvariantCulture, $"area: {area}\n");
        md.Append("status: new\n");
        md.Append(CultureInfo.InvariantCulture, $"title: {Quoted(title)}\n");
        md.Append(CultureInfo.InvariantCulture, $"filed: {now.UtcDateTime:yyyy-MM-ddTHH:mm:ssZ}\n");
        md.Append(CultureInfo.InvariantCulture, $"player: {Quoted(server.Player ?? "unknown")}\n");
        if (server.Character is not null) md.Append(CultureInfo.InvariantCulture, $"character: {Quoted(server.Character)}\n");
        md.Append(CultureInfo.InvariantCulture, $"place: {Quoted(OneLine(body.Place))}\n");
        md.Append(CultureInfo.InvariantCulture, $"screen: {Quoted(OneLine(body.Screen))}\n");
        md.Append(CultureInfo.InvariantCulture, $"build: {Quoted(OneLine(body.Build))}\n");
        md.Append(CultureInfo.InvariantCulture, $"server: {Quoted(Version())}\n");
        md.Append("---\n\n");
        md.Append(CultureInfo.InvariantCulture, $"# {title}\n\n");
        md.Append(description.Length > 0 ? description : "(No description.)").Append("\n\n");
        if (body.Summary is { Count: > 0 } summary)
        {
            md.Append("## When it was filed\n\n");
            foreach (string line in summary.Take(40)) md.Append("- ").Append(OneLine(line)).Append('\n');
            md.Append('\n');
        }

        md.Append("## Files\n\n");
        foreach ((string name, string about) in files) md.Append(CultureInfo.InvariantCulture, $"- `{name}` - {about}\n");
        md.Append("\n## Triage\n\n<!-- Findings, the cause, the fix's commit: realms/reports/README.md says how. -->\n");
        System.IO.File.WriteAllText(Path.Combine(folder, "report.md"), md.ToString());
        return new ReportFiled(id, folder);
    }

    /// <summary>JSON as people read it: only what JSON must escape is escaped (no <c>+</c> for a plus).</summary>
    private static readonly JsonSerializerOptions Readable = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private static readonly JsonSerializerOptions Indented = new(Readable) { WriteIndented = true };

    /// <summary>The server's version: its informational version, with the commit it was built from.</summary>
    public static string Version() =>
        typeof(PlayReports).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";

    private static string OneOf(string? value, IReadOnlyList<string> allowed, string what)
    {
        string v = (value ?? string.Empty).Trim().ToLowerInvariant();
        return allowed.Contains(v) ? v : throw Refusal.BadRequest($"A report's {what} is one of {string.Join(", ", allowed)}.");
    }

    private static string OneLine(string? text) => string.Join(' ', (text ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    /// <summary>A double-quoted YAML scalar: JSON's string escaping is YAML's.</summary>
    private static string Quoted(string text) => JsonSerializer.Serialize(text, Readable);

    /// <summary>Lowercase letters and digits joined by single dashes, at most <paramref name="most"/> long.</summary>
    public static string Slug(string text, int most)
    {
        var slug = new StringBuilder();
        foreach (char c in text.ToLowerInvariant())
        {
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9') slug.Append(c);
            else if (slug.Length > 0 && slug[^1] != '-') slug.Append('-');
            if (slug.Length >= most) break;
        }

        return slug.ToString().Trim('-');
    }

    private static readonly byte[] PngMagic = [0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A];

    private static byte[]? Png(string? dataUrl)
    {
        if (string.IsNullOrEmpty(dataUrl)) return null;
        const string prefix = "data:image/png;base64,";
        if (!dataUrl.StartsWith(prefix, StringComparison.Ordinal)) throw Refusal.BadRequest("A report's screenshot is a PNG data URL.");
        if (dataUrl.Length - prefix.Length > MaxScreenshot) throw Refusal.BadRequest("The screenshot is too large.");
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(dataUrl[prefix.Length..]);
        }
        catch (FormatException)
        {
            throw Refusal.BadRequest("The screenshot is not base64.");
        }

        return bytes.AsSpan().StartsWith(PngMagic) ? bytes : throw Refusal.BadRequest("The screenshot is not a PNG.");
    }
}
