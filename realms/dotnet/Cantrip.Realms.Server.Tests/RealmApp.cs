using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Duels;
using Cantrip.Realms.Server.Economy;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// The realm server in this process, as a browser reaches it: its own SQLite file, the development sign-in, a fake clock
/// (<see cref="Time"/>), a fake duel verifier (<see cref="Verifier"/>) and seeded dice (<see cref="Random"/>). The content
/// is the repository's, read once for every test.
/// </summary>
public sealed class RealmApp : WebApplicationFactory<Program>
{
    private static readonly Lazy<RealmContent> SharedContent = new(() => RealmContent.Load(Root, places: Places));

    private readonly string _database = Path.Combine(Path.GetTempPath(), $"cantrip-realm-{Guid.NewGuid():N}.db");

    /// <summary>The repository the tests run in.</summary>
    public static string Root => RealmOptions.FindRoot() ?? throw new InvalidOperationException("No repository above the tests.");

    public static RealmContent Content => SharedContent.Value;

    /// <summary>The test world (World/make-world.py): its planes' world, interiors and dungeons, read instead of realms/content's.</summary>
    public static string Places => Path.Combine(Root, "realms", "dotnet", "Cantrip.Realms.Server.Tests", "World");

    /// <summary>A Monday, half past ten in the morning, UTC.</summary>
    public static DateTimeOffset Start { get; } = new(2026, 11, 23, 10, 30, 0, TimeSpan.Zero);

    public FakeTimeProvider Time { get; } = new(Start);

    public FakeVerifier Verifier { get; } = new();

    /// <summary>What the dice roll from: seeded, so a failure repeats; a <see cref="ForcedRolls"/> decides the relic rolls.</summary>
    public Random Random { get; init; } = new Random(20261123);

    /// <summary>Whether the hourly clock (<see cref="RealmClock"/>) runs; off, a test brings the realm up to the hour by its calls.</summary>
    public bool Clock { get; init; }

    /// <summary>Whether duels are checked on the native engine (<see cref="NativeDuelVerifier"/>) rather than by <see cref="Verifier"/>.</summary>
    public bool NativeVerifier { get; init; }

    /// <summary>Settings beyond the test's own (REALMS_*), for a test about one.</summary>
    public Dictionary<string, string> Settings { get; } = [];

    public static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("REALMS_DATABASE", $"sqlite:{_database}");
        builder.UseSetting("REALMS_ROOT", Root);
        builder.UseSetting("REALMS_DEV_SIGNIN", "1");
        foreach ((string key, string value) in Settings) builder.UseSetting(key, value);

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Time);
            services.RemoveAll<RealmContent>();
            services.AddSingleton(_ => SharedContent.Value);
            services.RemoveAll<IDuelVerifier>();
            services.AddSingleton<IDuelVerifier>(NativeVerifier ? new NativeDuelVerifier() : Verifier);
            services.RemoveAll<RealmDice>();
            services.AddSingleton(new RealmDice(Random));
            if (!Clock)
            {
                ServiceDescriptor? clock = services.FirstOrDefault(service => service.ServiceType == typeof(IHostedService) && service.ImplementationType == typeof(RealmClock));
                if (clock is not null) services.Remove(clock);
            }
        });
    }

    /// <summary>A signed-in player's browser.</summary>
    public async Task<Browser> SignIn(ulong id, string name = "Tester")
    {
        HttpClient client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        using HttpResponseMessage response = await client.PostAsJsonAsync("/dev/signin", new { Id = id, Name = name });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // The sealed sign-in cookie, sent on every call after, as a browser would.
        string cookie = string.Join("; ", response.Headers.GetValues("Set-Cookie").Select(header => header.Split(';')[0]));
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        return new Browser(this, client, $"dev-{id}", cookie);
    }

    /// <summary>A player with a character, standing at New Benalia's inn.</summary>
    public async Task<Browser> Character(ulong id, string color = "W", string name = "Tester")
    {
        Browser browser = await SignIn(id, name);
        await browser.Ok<CharacterView>(HttpMethod.Post, "/api/character", new { Name = name, Body = "broad", Palette = 2, Color = color });
        return browser;
    }

    /// <summary>The first inn of a town of the test world.</summary>
    public static InnEntry Inn(string town) => Content.World.File.Inns.First(inn => inn.Town == town);

    /// <summary>A space of the test world: the world, or an interior.</summary>
    public static RealmSpace Space(string id) => Content.Space(id) ?? throw new ArgumentException($"No space '{id}'.", nameof(id));

    /// <summary>The first open hex beside a hex of a space (in hex.ts's order of directions), to stand at.</summary>
    public static Hex Beside(string space, Hex at) =>
        Hex.Directions.Select(step => new Hex(at.Q + step.Q, at.R + step.R)).First(Space(space).Walkable);

    /// <summary>An open hex of the world at least <paramref name="steps"/> hexes from another, along the r axis.</summary>
    public static Hex Away(Hex from, int steps) =>
        Enumerable.Range(steps, 64).Select(more => new Hex(from.Q, from.R + more)).Concat(Enumerable.Range(steps, 64).Select(more => new Hex(from.Q, from.R - more)))
            .First(Content.World.Walkable);

    /// <summary>Where an NPC of a kind stands in a space (the first of them).</summary>
    public static Hex Npc(string space, string kind) => Space(space).Npcs.First(npc => npc.Kind == kind).At;

    /// <summary>A world spawn of the test world, by tier: the first of that tier.</summary>
    public static MapSpawn SpawnOf(int tier) => Content.World.Spawns.Where(spawn => spawn.Tier == tier).OrderBy(spawn => spawn.Id, StringComparer.Ordinal).First();

    /// <summary>Puts a character somewhere at once, as a test arranges where they stand: no walking, no doors.</summary>
    public Task Put(Browser browser, string space, Hex at) => Store(async db =>
    {
        await db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set
            .SetProperty(row => row.Space, space)
            .SetProperty(row => row.Q, at.Q)
            .SetProperty(row => row.R, at.R)
            .SetProperty(row => row.PlacedAt, Time.GetUtcNow().ToUnixTimeMilliseconds()));
    });

    /// <summary>Walks a character to beside a dungeon's entrance and begins a run of it.</summary>
    public async Task<RunView> EnterRun(Browser browser, string dungeon)
    {
        await Put(browser, RealmContent.WorldSpace, Beside(RealmContent.WorldSpace, Content.Dungeons[dungeon].File.At));
        return await browser.Ok<RunView>(HttpMethod.Post, "/api/dungeon/enter", new { Dungeon = dungeon });
    }

    /// <summary>Sets the floor a run stands on, as a test arranges a run it would take long to climb.</summary>
    public Task ToFloor(RunView run, int floor) =>
        Store(db => db.Runs.Where(row => row.Id == run.Run).ExecuteUpdateAsync(set => set.SetProperty(row => row.Floor, floor)));

    /// <summary>Where a run's boss waits: its last floor, and its index there.</summary>
    public static (int Floor, int Index) BossOf(RunView run) => (run.Floors.Count - 1, run.Floors[^1].Encounters.Count + 1);

    /// <summary>Starts the duel of a run's encounter.</summary>
    public static Task<EncounterView> Fight(Browser browser, RunView run, int floor, int index, string mob) =>
        browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = floor, Index = index, Mob = mob });

    /// <summary>Finishes a duel, won unless the fake verifier says otherwise.</summary>
    public static Task<OutcomeView> Finish(Browser browser, string token) =>
        browser.Ok<OutcomeView>(HttpMethod.Post, "/api/encounter/finish", new { Token = token, Log = new[] { "AA==" } });

    /// <summary>Works with the store directly, as a test arranges what a call would take long to.</summary>
    public async Task Store(Func<RealmDb, Task> work)
    {
        using IServiceScope scope = Services.CreateScope();
        await work(scope.ServiceProvider.GetRequiredService<RealmDb>());
    }

    /// <summary>Gives a player copies of a card.</summary>
    public Task Give(Browser browser, string card, int count) => Store(async db =>
    {
        CollectionRow? row = await db.Collection.SingleOrDefaultAsync(row => row.PlayerId == browser.Player && row.Name == card);
        if (row is null) db.Collection.Add(new CollectionRow { PlayerId = browser.Player, Name = card, Count = count });
        else row.Count += count;
        await db.SaveChangesAsync();
    });

    public async Task<T> Store<T>(Func<RealmDb, Task<T>> work)
    {
        using IServiceScope scope = Services.CreateScope();
        return await work(scope.ServiceProvider.GetRequiredService<RealmDb>());
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (string file in new[] { _database, _database + "-wal", _database + "-shm" })
        {
            try
            {
                File.Delete(file);
            }
            catch (IOException)
            {
            }
        }
    }
}

/// <summary>A signed-in player's HTTP client, with the calls the tests make.</summary>
public sealed class Browser(RealmApp app, HttpClient client, string player, string cookie)
{
    public RealmApp App { get; } = app;

    public HttpClient Client { get; } = client;

    /// <summary>The player's id: <c>dev-{id}</c>.</summary>
    public string Player { get; } = player;

    /// <summary>The sign-in cookie, as a request's Cookie header.</summary>
    public string Cookie { get; } = cookie;

    public async Task<HttpResponseMessage> Send(HttpMethod method, string path, object? body = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = JsonContent.Create(body, body.GetType());
        return await Client.SendAsync(request);
    }

    /// <summary>A call that must succeed, and its answer.</summary>
    public async Task<T> Ok<T>(HttpMethod method, string path, object? body = null)
    {
        using HttpResponseMessage response = await Send(method, path, body);
        string text = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{method} {path}: {(int)response.StatusCode} {text}");
        return JsonSerializer.Deserialize<T>(text, RealmApp.Json)!;
    }

    /// <summary>A call that must be refused with a status and a code, and the refusal.</summary>
    public async Task<ApiError> Refused(HttpMethod method, string path, object? body, HttpStatusCode status, string code)
    {
        using HttpResponseMessage response = await Send(method, path, body);
        string text = await response.Content.ReadAsStringAsync();
        Assert.True(status == response.StatusCode, $"{method} {path}: expected {(int)status}, got {(int)response.StatusCode} {text}");
        ApiError error = JsonSerializer.Deserialize<ApiError>(text, RealmApp.Json)!;
        Assert.Equal(code, error.Error);
        return error;
    }

    public Task<CharacterView> Me() => Ok<CharacterView>(HttpMethod.Get, "/api/me");

    public Task<DeckView> Deck() => Ok<DeckView>(HttpMethod.Get, "/api/deck");

    public async Task<IReadOnlyDictionary<string, int>> Collection() => (await Ok<CollectionView>(HttpMethod.Get, "/api/collection")).Cards;

    /// <summary>Reports where the character stands (<c>/api/position</c>).</summary>
    public Task Position(string space, Hex at) => Ok<object>(HttpMethod.Post, "/api/position", new { Space = space, at.Q, at.R });

    /// <summary>Puts the character somewhere at once (<see cref="RealmApp.Put"/>).</summary>
    public Task Put(string space, Hex at) => App.Put(this, space, at);

    /// <summary>Puts the character inside an interior, on its middle hex.</summary>
    public Task Inside(string interior) => Put(interior, new Hex(0, 0));

    /// <summary>Puts the character beside the spell table of New Benalia's inn.</summary>
    public Task ToSpellTable() => Put("new-benalia-inn", RealmApp.Beside("new-benalia-inn", RealmApp.Npc("new-benalia-inn", RealmSpace.SpellTable)));
}

/// <summary>
/// Dice whose relic rolls (<see cref="RealmDice.Roll"/>, the one roll that reads <see cref="Random.NextDouble"/>) come up as a
/// test says - <see cref="Value"/>, 0 for every chance to come up and 1 for none - and whose every other roll is seeded.
/// </summary>
public sealed class ForcedRolls(double value) : Random(20261123)
{
    public double Value { get; set; } = value;

    public override double NextDouble() => Value;
}

/// <summary>A duel verifier a test decides the answers of: by default, every log is a win for the player.</summary>
public sealed class FakeVerifier : IDuelVerifier
{
    public Func<Duel, IReadOnlyList<string>, DuelVerdict> Answer { get; set; } = (_, _) => new DuelVerdict(true, [Duel.PlayerSeat], null);

    public List<(Duel Duel, IReadOnlyList<string> Log)> Checked { get; } = [];

    public DuelVerdict Verify(Duel duel, IReadOnlyList<string> log)
    {
        lock (Checked) Checked.Add((duel, log));
        return Answer(duel, log);
    }

    public static DuelVerdict MobWon { get; } = new(true, [Duel.MobSeat], null);

    public static DuelVerdict Tampered { get; } = DuelVerdict.Rejected("Message 3 (AnswerMessage) was refused.");
}
