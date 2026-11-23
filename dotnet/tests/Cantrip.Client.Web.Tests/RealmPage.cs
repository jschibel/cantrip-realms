using System.Text.Json;
using Microsoft.Playwright;
using Xunit;

namespace Cantrip.Client.Web.Tests;

/// <summary>
/// The realm's card layer as a player meets it: the overworld's stand-in page (<see cref="RealmSite"/>) framing the web
/// client's <c>?realm</c> page full size, for a player signed in on the realm server with a character. The frame publishes
/// where everything is on <c>globalThis.cantripTest</c> as every page does (MainPage.Test.cs), and since it fills the page
/// from its corner, where a thing is in the frame is where it is on the page: everything is clicked with real mouse events
/// there, as <see cref="TablePage"/> does. The bridge is the overworld's: a screen is asked for as the overworld asks, and
/// its answer read as the overworld hears it.
/// </summary>
public sealed class RealmPage : IAsyncDisposable
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(90);

    private readonly IBrowserContext _context;
    private readonly RealmSite _site;
    private readonly string _pictures;
    private readonly List<string> _errors = [];
    private int _pictured;

    private RealmPage(IBrowserContext context, IPage page, RealmSite site, string pictures, string player)
    {
        _context = context;
        Page = page;
        _site = site;
        _pictures = pictures;
        Player = player;
        page.PageError += (_, error) => _errors.Add(error);
    }

    public IPage Page { get; }

    /// <summary>The player's id on the realm server: <c>dev-&lt;id&gt;</c>.</summary>
    public string Player { get; }

    public IReadOnlyList<string> Errors => _errors;

    /// <summary>
    /// Signs player <paramref name="id"/> in on the realm server (the development sign-in, into this page's cookies), makes
    /// them a character of <paramref name="color"/>, and does what <paramref name="arrange"/> asks of the API before the
    /// card layer is loaded with <paramref name="query"/> beside <c>realm</c>, <c>test</c> and the server's address.
    /// </summary>
    public static async Task<RealmPage> OpenAsync(WebClient web, RealmSite site, ulong id, string color, string pictures, Func<RealmPage, Task>? arrange = null, string query = "")
    {
        await site.StartAsync(web);
        IBrowserContext context = await web.Browser.NewContextAsync(new BrowserNewContextOptions
        {
            ViewportSize = WebClient.Headed ? ViewportSize.NoViewport : new ViewportSize { Width = WebClient.Width, Height = WebClient.Height },
        });
        IPage page = await context.NewPageAsync();
        var realm = new RealmPage(context, page, site, pictures, $"dev-{id}");
        await realm.OkAsync(HttpMethod.Post, "dev/signin", new { Id = id, Name = $"Tester {id}" }, api: false);
        await realm.OkAsync(HttpMethod.Post, "character", new { Name = $"Tester {id}", Body = "broad", Palette = 1, Color = color });
        if (arrange is not null)
        {
            await arrange(realm);
        }

        string cards = $"{web.Site}?realm&test&api={Uri.EscapeDataString(site.Server.AbsoluteUri)}&art={Uri.EscapeDataString(site.Art)}{query}";
        await page.GotoAsync($"{site.Overworld}?cards={Uri.EscapeDataString(cards)}");
        DateTime giveUp = DateTime.UtcNow + Patience;
        while (!await page.EvaluateAsync<bool>("() => window.realmReady === true"))
        {
            Assert.True(DateTime.UtcNow < giveUp, $"The card layer never said it was ready. Page errors: {string.Join(" | ", realm._errors)}");
            await Task.Delay(200);
        }

        return realm;
    }

    /// <summary>A call to the realm server's API on this player's cookie, which must succeed: its answer.</summary>
    public async Task<JsonElement> OkAsync(HttpMethod method, string path, object? body = null, bool api = true)
    {
        IAPIResponse response = await CallAsync(method, path, body, api);
        string text = await response.TextAsync();
        Assert.True(response.Ok, $"{method} {path}: {response.Status} {text}");
        using JsonDocument document = JsonDocument.Parse(text.Length == 0 ? "{}" : text);
        return document.RootElement.Clone();
    }

    /// <summary>A call to the realm server's API on this player's cookie.</summary>
    public Task<IAPIResponse> CallAsync(HttpMethod method, string path, object? body = null, bool api = true)
    {
        string url = new Uri(_site.Server, (api ? "api/" : string.Empty) + path).AbsoluteUri;
        var options = new APIRequestContextOptions { Method = method.Method, DataObject = body };
        return _context.APIRequest.FetchAsync(url, options);
    }

    /// <summary>Asks the card layer for a screen as the overworld does; the request's id.</summary>
    public Task<int> OpenScreenAsync(string screen, object args) =>
        Page.EvaluateAsync<int>("([screen, args]) => window.realmOpen(screen, JSON.parse(args))", new object[] { screen, JsonSerializer.Serialize(args) });

    /// <summary>Clicks into a box by its placeholder and types into it, key by key.</summary>
    public async Task TypeAsync(string placeholder, string text)
    {
        await ClickAsync(placeholder);
        await Page.Keyboard.TypeAsync(text, new KeyboardTypeOptions { Delay = 30 });
    }

    /// <summary>Waits for the screen asked for with <paramref name="id"/> to close, and what it said: its outcome and result.</summary>
    public async Task<JsonElement> ClosedAsync(int id, TimeSpan? within = null)
    {
        DateTime giveUp = DateTime.UtcNow + (within ?? Patience);
        while (DateTime.UtcNow < giveUp)
        {
            string closed = await Page.EvaluateAsync<string>("() => JSON.stringify(window.realmClosed)");
            using JsonDocument document = JsonDocument.Parse(closed);
            foreach (JsonElement message in document.RootElement.EnumerateArray())
            {
                if (message.GetProperty("id").GetInt32() == id)
                {
                    return message.Clone();
                }
            }

            await Task.Delay(200);
        }

        await PictureAsync("not-closed");
        Assert.Fail($"Screen {id} never closed. Last state: {Describe(await StateAsync())}. Page errors: {string.Join(" | ", _errors)}");
        return default;
    }

    private IFrame Frame => Page.Frames.First(frame => frame.Url.Contains("realm", StringComparison.Ordinal) && frame != Page.MainFrame);

    /// <summary>What the card layer last published; null before it has.</summary>
    public async Task<RealmState?> StateAsync()
    {
        string? json = await Frame.EvaluateAsync<string?>("() => globalThis.cantripTest ?? null");
        return json is null ? null : JsonSerializer.Deserialize<RealmState>(json, Json);
    }

    /// <summary>Waits for the layer to be up and still, as <paramref name="until"/> says, for a few readings in a row.</summary>
    public async Task<RealmState> SettledAsync(Func<RealmState, bool>? until = null, TimeSpan? within = null)
    {
        DateTime giveUp = DateTime.UtcNow + (within ?? Patience);
        int still = 0;
        RealmState? state = null;
        while (DateTime.UtcNow < giveUp)
        {
            state = await StateAsync();
            still = state is { Ready: true, Busy: false } && (until?.Invoke(state) ?? true) ? still + 1 : 0;
            if (still >= 3)
            {
                return state!;
            }

            await Task.Delay(100);
        }

        await PictureAsync("not-settled");
        Assert.Fail($"The card layer never settled. Last state: {Describe(state)}. Page errors: {string.Join(" | ", _errors)}");
        return null!;
    }

    /// <summary>Clicks a control by what it says (exactly, else the first that says it among more).</summary>
    public async Task ClickAsync(string label)
    {
        RealmState state = await SettledAsync(state => state.Controls.Any(c => c.Label == label || c.Label.Contains(label, StringComparison.Ordinal)));
        ControlState control = state.Controls.FirstOrDefault(c => c.Label == label) ?? state.Controls.First(c => c.Label.Contains(label, StringComparison.Ordinal));
        await Page.Mouse.ClickAsync(control.X, control.Y);
    }

    /// <summary>A card in view by name, in a row if one is named.</summary>
    public async Task<CardState> CardAsync(string name, string? row = null)
    {
        RealmState state = await SettledAsync(state => state.Cards.Any(card => card.Visible && card.Name == name && (row is null || card.Row == row)));
        return state.Cards.First(card => card.Visible && card.Name == name && (row is null || card.Row == row));
    }

    public async Task ClickCardAsync(string name, string? row = null)
    {
        CardState card = await CardAsync(name, row);
        await Page.Mouse.ClickAsync(card.X, card.Y);
    }

    /// <summary>A gear card by where it is (<c>worn:head</c>, <c>owned</c>, <c>stock</c>), and its name if given.</summary>
    public async Task<RealmGearState> GearAsync(string place, string? name = null)
    {
        RealmState state = await SettledAsync(state => state.Realm?.Gear.Any(card => card.Place == place && (name is null || card.Name == name)) == true);
        return state.Realm!.Gear.First(card => card.Place == place && (name is null || card.Name == name));
    }

    public async Task ClickGearAsync(string place, string? name = null)
    {
        RealmGearState card = await GearAsync(place, name);
        await Page.Mouse.ClickAsync(card.X, card.Y);
    }

    public async Task<string> PictureAsync(string name)
    {
        string path = Path.Combine(_pictures, $"{++_pictured:00}-{name}.png");
        await Page.ScreenshotAsync(new PageScreenshotOptions { Path = path });
        return path;
    }

    private static string Describe(RealmState? state) => state is null
        ? "nothing published"
        : $"ready {state.Ready}, busy {state.Busy} ({state.Doing}), screen '{state.Realm?.Screen}' title '{state.Realm?.Title}' status '{state.Realm?.Status}' body '{state.Realm?.Body}', over {state.Over}, {state.Cards.Count} cards, controls {string.Join(", ", state.Controls.Select(c => c.Label))}";

    public async ValueTask DisposeAsync() => await _context.DisposeAsync();
}

/// <summary>What the card layer publishes, as the realm's tests read it: the table's own state and the realm screen's (<c>realm</c>).</summary>
public sealed record RealmState(
    bool Ready,
    bool Busy,
    string Doing,
    bool Over,
    string Phase,
    string Prompt,
    IReadOnlyList<CardState> Cards,
    IReadOnlyList<ControlState> Controls,
    DeckEditorState? DeckEditor,
    RealmScreenState? Realm);

/// <summary>
/// A realm screen as the card layer publishes it: which, what it is waiting on, its header's title, facts and status (a
/// refusal in words), the duel's state, the loot's picks, and every gear card with where it is.
/// </summary>
public sealed record RealmScreenState(
    string Screen,
    string Loading,
    string Title,
    string Body,
    string Facts,
    string Status,
    RealmDuelState? Duel,
    RealmLootState? Loot,
    IReadOnlyList<RealmGearState> Gear);

public sealed record RealmDuelState(string Mob, bool Over, bool Won, bool Settled, int Log, bool Ended, string End);

public sealed record RealmLootState(long Cap, long Taken, IReadOnlyList<string> Picked);

public sealed record RealmGearState(string Name, string Place, long Instance, bool Selected, float X, float Y, float W, float H);
