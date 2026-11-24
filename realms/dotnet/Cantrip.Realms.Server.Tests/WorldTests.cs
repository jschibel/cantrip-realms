using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Duels;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// Where a character stands (interfaces.md, "Places"; <c>POST /api/position</c>): the world walked no faster than walking
/// allows, interiors through their doors, dungeon runs by their own calls; and the inn a character sets as home.
/// </summary>
public sealed class PlacesTests
{
    private const string World = RealmContent.WorldSpace;

    private static async Task<CharacterView> At(Browser browser, string space, Tile at)
    {
        CharacterView me = await browser.Me();
        Assert.Equal((space, at), (me.Space, new Tile(me.X, me.Z)));
        return me;
    }

    [Fact]
    public async Task The_world_is_walked_on_open_ground_no_faster_than_walking()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await browser.Put(World, new Tile(40, 40));

        // A step, at once (within the slack of 2 tiles), is taken, diagonally as well; ten tiles at once are not, but are after
        // the walk's time (5 tiles a second). Tiles apart are counted by the most of the two axes: (42, 42) is 2 from (40, 40).
        await browser.Position(World, new Tile(42, 40));
        await At(browser, World, new Tile(42, 40));
        await browser.Position(World, new Tile(40, 42));
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = World, X = 50, Z = 49 }, HttpStatusCode.Conflict, Codes.NoWay);
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = World, X = 52, Z = 40 }, HttpStatusCode.Conflict, Codes.NoWay);
        app.Time.Advance(TimeSpan.FromSeconds(2));
        await browser.Position(World, new Tile(52, 40));
        await At(browser, World, new Tile(52, 40));

        // The rock, off the world's edge, and a place that is none; and the west chunks, at negative x, walked into.
        await browser.Put(World, new Tile(25, 5));
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = World, X = 26, Z = 5 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);
        await browser.Put(World, new Tile(0, 0));
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = World, X = 0, Z = -1 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = "benalish-meadow", X = 0, Z = 0 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);
        await At(browser, World, new Tile(0, 0));
        await browser.Position(World, new Tile(-2, 1));
        await At(browser, World, new Tile(-2, 1));
        await browser.Put(World, new Tile(-32, 0));
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = World, X = -33, Z = 0 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);
    }

    [Fact]
    public async Task On_the_generated_world_a_character_starts_outside_new_benalias_inn_walks_and_goes_in()
    {
        // The server as it starts with no REALMS_PLACES: the Domains, realms/content/dominaria/world.
        await using var app = new RealmApp { OnGenerated = true };
        Browser browser = await app.Character(1);
        RealmContent content = RealmApp.Generated;
        InnEntry start = content.World.File.Inns.First(inn => inn.Town == "new-benalia");
        CharacterView me = await At(browser, World, start.At);
        Assert.Equal(start.Id, me.Inn);

        // A step along the street, and in through the inn's door, which is beside where they stand.
        Tile step = Tile.Steps.Select(start.At.Plus).First(tile => content.World.CanStep(start.At, tile) && !content.World.Doors.ContainsKey(tile));
        await browser.Position(World, step);
        await browser.Position(World, start.At);
        RealmInterior inn = content.Interiors[start.Id];
        Assert.Equal("new-benalia", inn.Town?.Id);
        Tile entry = inn.File.EntryAt!.Value;
        Tile inside = inn.Walkable(new Tile(entry.X, entry.Z - 1)) ? new Tile(entry.X, entry.Z - 1) : entry;
        await browser.Position(inn.Id, inside);
        await At(browser, inn.Id, inside);
        await browser.Ok<InnView>(HttpMethod.Post, "/api/inn", new { });

        // The traders' schedule names the world's towns.
        TravelersView travelers = await browser.Ok<TravelersView>(HttpMethod.Get, "/api/travelers");
        Assert.Equal(15, travelers.Travelers.Count);
        Assert.All(travelers.Travelers, traveler => Assert.Contains(traveler.Next.Town, content.Towns.Keys));
    }

    [Fact]
    public async Task A_development_server_places_a_character_and_judges_its_duels_as_a_test_says()
    {
        // Only with REALMS_DEV_SIGNIN=1 (as RealmApp runs), for the end-to-end suites: POST /dev/place and /dev/verdict.
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await browser.Ok<object>(HttpMethod.Post, "/dev/place", new { Space = "benalia-white-goods-shop", X = 0, Z = 0 });
        await At(browser, "benalia-white-goods-shop", new Tile(0, 0));
        await browser.Refused(HttpMethod.Post, "/dev/place", new { Space = World, X = 26, Z = 5 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);
        await browser.Refused(HttpMethod.Post, "/dev/place", new { Space = "run:1", X = 0, Z = 0 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);

        // The fake verifier says every log is a win; a verdict set says otherwise for this player alone, until cleared.
        MapSpawn spawn = RealmApp.SpawnOf(1);
        async Task<string> Fight(Browser who)
        {
            await who.Put(World, spawn.At);
            app.Time.Advance(TimeSpan.FromSeconds(spawn.RespawnSeconds));
            string mob = Spawns.MobOf(who.Player, World, spawn.Id, Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds), spawn.Mobs);
            EncounterView encounter = await who.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = spawn.Id, Mob = mob });
            return (await RealmApp.Finish(who, encounter.Token)).Outcome;
        }

        Browser other = await app.Character(2);
        await browser.Ok<object>(HttpMethod.Post, "/dev/verdict", new { Outcome = "lost" });
        Assert.Equal("lost", await Fight(browser));
        Assert.Equal("won", await Fight(other));
        await browser.Ok<object>(HttpMethod.Post, "/dev/verdict", new { Outcome = (string?)null });
        Assert.Equal("won", await Fight(browser));
        await browser.Refused(HttpMethod.Post, "/dev/verdict", new { Outcome = "drawn" }, HttpStatusCode.BadRequest, "BadRequest");
    }

    [Fact]
    public async Task A_development_server_deals_a_players_duels_with_the_seats_a_test_forces()
    {
        // POST /dev/duel, for the end-to-end suites' forced positions: the duel is committed with the seats changed, for
        // this player alone, until cleared.
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        Browser other = await app.Character(2);
        MapSpawn spawn = RealmApp.SpawnOf(1);
        async Task<Duel> Deal(Browser who)
        {
            await who.Put(World, spawn.At);
            app.Time.Advance(TimeSpan.FromSeconds(spawn.RespawnSeconds));
            string mob = Spawns.MobOf(who.Player, World, spawn.Id, Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds), spawn.Mobs);
            EncounterView encounter = await who.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = spawn.Id, Mob = mob });
            await RealmApp.Finish(who, encounter.Token);
            return encounter.Duel;
        }

        Duel plain = await Deal(browser);
        await browser.Ok<object>(HttpMethod.Post, "/dev/duel", new { Player = new { StartingHandSize = 5, Emblems = new[] { "Circlet of Foresight (gear)" } }, Mob = new { StartingLife = 0, Deck = Enumerable.Repeat("Plains", 40) } });
        Duel forced = await Deal(browser);
        Assert.Equal(plain.Seats[0] with { StartingHandSize = 5, Emblems = ["Circlet of Foresight (gear)"] }, forced.Seats[0], SeatComparer.Instance);
        Assert.Equal(0, forced.Seats[1].StartingLife);
        Assert.Equal(Enumerable.Repeat("Plains", 40), forced.Seats[1].Deck);
        Assert.Equal(20, (await Deal(other)).Seats[1].StartingLife);

        await browser.Ok<object>(HttpMethod.Post, "/dev/duel", new { Player = (object?)null, Mob = (object?)null });
        Assert.Equal(plain.Seats[0], (await Deal(browser)).Seats[0], SeatComparer.Instance);
    }

    /// <summary>Seats compared by what they say, their lists by their items.</summary>
    private sealed class SeatComparer : IEqualityComparer<DuelSeat>
    {
        public static readonly SeatComparer Instance = new();

        public bool Equals(DuelSeat? x, DuelSeat? y) =>
            x is not null && y is not null && x.Name == y.Name && x.Deck.SequenceEqual(y.Deck) && x.StartingLife == y.StartingLife
            && x.StartingHandSize == y.StartingHandSize && x.MaximumHandSize == y.MaximumHandSize && x.Emblems.SequenceEqual(y.Emblems);

        public int GetHashCode(DuelSeat obj) => obj.Name.GetHashCode(StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_development_server_signs_in_from_a_browser_and_goes_on_to_the_world()
    {
        await using var app = new RealmApp();
        HttpClient client = app.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        using HttpResponseMessage form = await client.GetAsync(new Uri("/dev/signin", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, form.StatusCode);
        Assert.Contains("<form", await form.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        using HttpResponseMessage signedIn = await client.GetAsync(new Uri("/dev/signin?id=7&name=Ann", UriKind.Relative));
        Assert.Equal(HttpStatusCode.Redirect, signedIn.StatusCode);
        Assert.Equal("/home", signedIn.Headers.Location?.OriginalString);
        Assert.Contains(signedIn.Headers.GetValues("Set-Cookie"), cookie => cookie.StartsWith("cantrip.signin=", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_building_is_entered_through_its_door_and_left_through_it()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        RealmInterior inn = RealmApp.Content.Interiors["new-benalia-inn"];
        Tile door = inn.Doors[0];
        Tile exit = inn.File.ExitAt!.Value;

        // From the street far off, no; from beside its door, in; within the building, a walk; not off its floor.
        await browser.Put(World, RealmApp.Away(door, 3));
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = inn.Id, X = 0, Z = 0 }, HttpStatusCode.Conflict, Codes.NoWay);
        await browser.Put(World, RealmApp.Beside(World, door));
        await browser.Position(inn.Id, new Tile(0, 0));
        await browser.Position(inn.Id, new Tile(1, 0));
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = inn.Id, X = 9, Z = 0 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);

        // Not straight into another building, nor out anywhere but its exit.
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = "new-benalia-smithy", X = 0, Z = 0 }, HttpStatusCode.Conflict, Codes.NoWay);
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = World, X = 60, Z = 60 }, HttpStatusCode.Conflict, Codes.NoWay);
        await browser.Position(World, exit);
        await At(browser, World, exit);
    }

    [Fact]
    public async Task A_run_is_entered_and_left_by_its_own_calls_and_walked_freely_inside()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        Browser other = await app.Character(2);
        RunView run = await app.EnterRun(browser, "hurloon-caves");
        string space = RealmContent.RunSpace(run.Run);
        await At(browser, space, new Tile(0, 0));

        // Inside, any tile of the browser's layout; out, only by leaving.
        await browser.Position(space, new Tile(17, -4));
        await At(browser, space, new Tile(17, -4));
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = World, X = 24, Z = 57 }, HttpStatusCode.Conflict, Codes.NoWay);

        // Another player can't report themselves into it, nor anyone into a run that is none.
        await other.Refused(HttpMethod.Post, "/api/position", new { Space = space, X = 0, Z = 0 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);
        await other.Refused(HttpMethod.Post, "/api/position", new { Space = "run:nothing", X = 0, Z = 0 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);
    }

    [Fact]
    public async Task A_character_whose_place_is_gone_stands_anywhere_open()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await browser.Put("benalish-meadow", new Tile(3, 3));
        await browser.Position(World, new Tile(90, 90));
        await At(browser, World, new Tile(90, 90));
    }

    [Fact]
    public async Task An_inn_set_as_home_is_where_a_loss_wakes_the_character()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (_, _) => FakeVerifier.MobWon;
        Browser browser = await app.Character(1);

        // Only inside an inn; not in a shop or in the street.
        await browser.Refused(HttpMethod.Post, "/api/inn", new { }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Inside("benalia-white-goods-shop");
        await browser.Refused(HttpMethod.Post, "/api/inn", new { }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Inside("capashen-hold-inn");
        InnView home = await browser.Ok<InnView>(HttpMethod.Post, "/api/inn", new { });
        Assert.Equal(RealmApp.Inn("capashen-hold").Id, home.Inn);
        Assert.Equal(home.Inn, (await browser.Me()).Inn);

        MapSpawn spawn = RealmApp.SpawnOf(1);
        await browser.Put(World, spawn.At);
        string mob = Spawns.MobOf(browser.Player, World, spawn.Id, Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds), spawn.Mobs);
        EncounterView encounter = await browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = spawn.Id, Mob = mob });
        Assert.Equal("lost", (await RealmApp.Finish(browser, encounter.Token)).Outcome);
        await At(browser, World, RealmApp.Inn("capashen-hold").At);
    }
}

/// <summary>Dungeon runs (design.md A6; <c>/api/dungeon/enter</c>, <c>floor</c>, <c>leave</c>) and their encounters.</summary>
public sealed class DungeonTests
{
    private const string World = RealmContent.WorldSpace;
    private const string Caves = "hurloon-caves";
    private const string Sanctum = "benalish-keep";

    [Fact]
    public async Task A_run_holds_every_encounter_its_dungeon_allows()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await browser.Put(World, RealmApp.Away(RealmApp.Content.Dungeons[Sanctum].File.At, 3));
        await browser.Refused(HttpMethod.Post, "/api/dungeon/enter", new { Dungeon = Sanctum }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Refused(HttpMethod.Post, "/api/dungeon/enter", new { Dungeon = "nowhere" }, HttpStatusCode.NotFound, Codes.NotThere);

        for (int i = 0; i < 8; i++)
        {
            RunView run = await app.EnterRun(browser, Sanctum);
            RealmDungeon dungeon = RealmApp.Content.Dungeons[Sanctum];
            Assert.InRange(run.Seed, 0, Duel.MaximumSeed);
            Assert.InRange(run.Floors.Count, dungeon.File.Floors[0], dungeon.File.Floors[1]);
            for (int floor = 0; floor < run.Floors.Count; floor++)
            {
                RunFloor at = run.Floors[floor];
                Assert.InRange(at.Encounters.Count, dungeon.File.Encounters[0], dungeon.File.Encounters[1]);
                Assert.Equal(Enumerable.Range(0, at.Encounters.Count), at.Encounters.Select(encounter => encounter.Index));
                Assert.All(at.Encounters, encounter => Assert.Contains(encounter.Mob, dungeon.TableOf(floor)));
                bool last = floor == run.Floors.Count - 1;
                Assert.Equal((last ? null : "sanctum-warden", last ? "lyra-dawnbringer" : null), (at.Warden, at.Boss));
            }

            // Entering again ends the run before: one live run a character.
            Assert.Equal(1, await app.Store(db => db.Runs.CountAsync(row => row.PlayerId == browser.Player && row.State == RunRow.Live)));
            await browser.Put(World, RealmApp.Inn("new-benalia").At);
        }
    }

    [Fact]
    public async Task A_runs_encounter_is_its_own_floors_named_mob_fought_once()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        Browser other = await app.Character(2);
        RunView run = await app.EnterRun(browser, Sanctum);
        RunFloor first = run.Floors[0];
        RunEncounter one = first.Encounters[0];
        string notIt = RealmApp.Content.Dungeons[Sanctum].TableOf(0).First(mob => mob != one.Mob);

        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = 1, one.Index, one.Mob }, HttpStatusCode.Conflict, Codes.NotThere);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = 0, Index = 99, one.Mob }, HttpStatusCode.NotFound, Codes.NotThere);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = 0, one.Index, Mob = notIt }, HttpStatusCode.Conflict, Codes.NotThere);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = 0, Index = first.Encounters.Count + 1, Mob = "lyra-dawnbringer" }, HttpStatusCode.NotFound, Codes.NotThere);
        await other.Refused(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = 0, one.Index, one.Mob }, HttpStatusCode.NotFound, Codes.NotThere);

        EncounterView duel = await RealmApp.Fight(browser, run, 0, one.Index, one.Mob);
        Assert.Equal(RealmApp.Content.Mobs[one.Mob].File.Name, duel.Duel.Mob.Name);
        Assert.Equal("won", (await RealmApp.Finish(browser, duel.Token)).Outcome);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = 0, one.Index, one.Mob }, HttpStatusCode.Conflict, Codes.TooSoon);

        // Out of the run (as an arranged move would put them), its encounters are not near.
        await browser.Put(World, RealmApp.Inn("new-benalia").At);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = 0, first.Encounters[^1].Index, first.Encounters[^1].Mob }, HttpStatusCode.Conflict, Codes.NotNear);
    }

    [Fact]
    public async Task The_stair_opens_once_its_warden_is_beaten()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        RunView run = await app.EnterRun(browser, Sanctum);
        await browser.Refused(HttpMethod.Post, "/api/dungeon/floor", new { run.Run, Floor = 1 }, HttpStatusCode.Conflict, Codes.WardenStands);
        await browser.Refused(HttpMethod.Post, "/api/dungeon/floor", new { run.Run, Floor = 2 }, HttpStatusCode.Conflict, Codes.NoWay);

        // A lost duel would end the run; a won one against the warden opens the stair.
        EncounterView warden = await RealmApp.Fight(browser, run, 0, run.Floors[0].Encounters.Count, "sanctum-warden");
        await RealmApp.Finish(browser, warden.Token);
        await browser.Ok<object>(HttpMethod.Post, "/api/dungeon/floor", new { run.Run, Floor = 1 });
        await browser.Refused(HttpMethod.Post, "/api/dungeon/floor", new { run.Run, Floor = 1 }, HttpStatusCode.Conflict, Codes.NoWay);

        // The first floor's encounters are behind; the second's are the ones to fight.
        RunEncounter below = run.Floors[1].Encounters.FirstOrDefault() ?? new RunEncounter(run.Floors[1].Encounters.Count, run.Floors[1].Warden ?? run.Floors[1].Boss!);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = 0, run.Floors[0].Encounters[0].Index, run.Floors[0].Encounters[0].Mob }, HttpStatusCode.Conflict, Codes.NotThere);
        await RealmApp.Fight(browser, run, 1, below.Index, below.Mob);

        // From the last floor no stair leads on.
        await app.ToFloor(run, run.Floors.Count - 1);
        await browser.Refused(HttpMethod.Post, "/api/dungeon/floor", new { run.Run, Floor = run.Floors.Count }, HttpStatusCode.Conflict, Codes.NoWay);
    }

    [Fact]
    public async Task Losing_a_duel_of_a_run_ends_it_and_wakes_the_character_at_their_inn()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (_, _) => FakeVerifier.MobWon;
        Browser browser = await app.Character(1);
        RunView run = await app.EnterRun(browser, Caves);
        RunFloor first = run.Floors[0];
        RunEncounter one = first.Encounters[0];
        EncounterView duel = await RealmApp.Fight(browser, run, 0, one.Index, one.Mob);
        Assert.Equal("lost", (await RealmApp.Finish(browser, duel.Token)).Outcome);

        CharacterView me = await browser.Me();
        Assert.Equal((World, RealmApp.Inn("new-benalia").At), (me.Space, new Tile(me.X, me.Z)));
        RunRow row = await app.Store(db => db.Runs.AsNoTracking().SingleAsync(stored => stored.Id == run.Run));
        Assert.Equal(RunRow.Ended, row.State);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { run.Run, Floor = 0, Index = first.Encounters.Count, Mob = "warden-2" }, HttpStatusCode.Conflict, Codes.NotThere);
        await browser.Refused(HttpMethod.Post, "/api/dungeon/leave", new { run.Run }, HttpStatusCode.Conflict, Codes.NotThere);
    }

    [Fact]
    public async Task Leaving_a_run_ends_it_with_the_character_beside_its_entrance()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        RunView run = await app.EnterRun(browser, Caves);
        await browser.Refused(HttpMethod.Post, "/api/dungeon/leave", new { Run = "nothing" }, HttpStatusCode.NotFound, Codes.NotThere);
        await browser.Ok<object>(HttpMethod.Post, "/api/dungeon/leave", new { run.Run });

        Tile entrance = RealmApp.Content.Dungeons[Caves].File.At;
        CharacterView me = await browser.Me();
        Assert.Equal(World, me.Space);
        Assert.Equal(1, new Tile(me.X, me.Z).DistanceTo(entrance));
        await browser.Refused(HttpMethod.Post, "/api/dungeon/leave", new { run.Run }, HttpStatusCode.Conflict, Codes.NotThere);

        // The next run is a new one, from the first floor.
        RunView again = await browser.Ok<RunView>(HttpMethod.Post, "/api/dungeon/enter", new { Dungeon = Caves });
        Assert.NotEqual(run.Run, again.Run);
        Assert.Equal(0, await app.Store(db => db.Runs.Where(row => row.Id == again.Run).Select(row => row.Floor).SingleAsync()));
    }
}

/// <summary>Mage towers' waystones (design.md A6): beating a tower's mage attunes it, and attuned towers are travelled between at once.</summary>
public sealed class WaystoneTests
{
    private const string World = RealmContent.WorldSpace;

    /// <summary>Beats the mage at the top of a tower.</summary>
    private static async Task<OutcomeView> BeatTheMage(RealmApp app, Browser browser, string tower)
    {
        RunView run = await app.EnterRun(browser, tower);
        (int floor, int index) = RealmApp.BossOf(run);
        await app.ToFloor(run, floor);
        EncounterView duel = await RealmApp.Fight(browser, run, floor, index, $"mage-{tower}");
        return await RealmApp.Finish(browser, duel.Token);
    }

    [Fact]
    public async Task Beating_a_towers_mage_attunes_its_waystone_and_nothing_else_does()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);

        // A tower's lesser fight attunes nothing, nor does a dungeon's boss where there is no waystone.
        RunView run = await app.EnterRun(browser, "benalia-1");
        RunEncounter guard = run.Floors[0].Encounters[0];
        await RealmApp.Finish(browser, (await RealmApp.Fight(browser, run, 0, guard.Index, guard.Mob)).Token);
        Assert.Empty((await browser.Me()).Attuned);
        RunView sanctum = await app.EnterRun(browser, "benalish-keep");
        (int floor, int index) = RealmApp.BossOf(sanctum);
        await app.ToFloor(sanctum, floor);
        await RealmApp.Finish(browser, (await RealmApp.Fight(browser, sanctum, floor, index, "lyra-dawnbringer")).Token);
        Assert.Empty((await browser.Me()).Attuned);

        // A lost duel against the mage attunes nothing either.
        app.Verifier.Answer = (_, _) => FakeVerifier.MobWon;
        Assert.Equal("lost", (await BeatTheMage(app, browser, "benalia-1")).Outcome);
        Assert.Empty((await browser.Me()).Attuned);

        app.Verifier.Answer = (_, _) => new DuelVerdict(true, [Duel.PlayerSeat], null);
        Assert.Equal("won", (await BeatTheMage(app, browser, "benalia-1")).Outcome);
        Assert.Equal(["benalia-1"], (await browser.Me()).Attuned);
        Assert.Equal("won", (await BeatTheMage(app, browser, "benalia-1")).Outcome);
        Assert.Equal(["benalia-1"], (await browser.Me()).Attuned);
    }

    [Fact]
    public async Task A_waystone_takes_the_character_between_attuned_towers_at_once()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        Tile benalia = RealmApp.Content.Dungeons["benalia-1"].File.At;
        Tile tolaria = RealmApp.Content.Dungeons["orvada-2"].File.At;

        await browser.Put(World, RealmApp.Inn("new-benalia").At);
        await browser.Refused(HttpMethod.Post, "/api/waystone", new { Tower = "orvada-2" }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Put(World, RealmApp.Beside(World, benalia));
        await browser.Refused(HttpMethod.Post, "/api/waystone", new { Tower = "orvada-2" }, HttpStatusCode.Conflict, Codes.NotAttuned);
        await browser.Refused(HttpMethod.Post, "/api/waystone", new { Tower = "hurloon-caves" }, HttpStatusCode.NotFound, Codes.NotThere);

        await BeatTheMage(app, browser, "benalia-1");
        await browser.Ok<object>(HttpMethod.Post, "/api/dungeon/leave", new { Run = (await app.Store(db => db.Runs.Where(row => row.State == RunRow.Live).Select(row => row.Id).SingleAsync())) });
        await browser.Refused(HttpMethod.Post, "/api/waystone", new { Tower = "orvada-2" }, HttpStatusCode.Conflict, Codes.NotAttuned);
        await BeatTheMage(app, browser, "orvada-2");
        await browser.Put(World, RealmApp.Beside(World, benalia));

        // Across the world in one call, beside the other tower's door, and walked on from there.
        WaystoneView travelled = await browser.Ok<WaystoneView>(HttpMethod.Post, "/api/waystone", new { Tower = "orvada-2" });
        Assert.Equal(World, travelled.Place.Space);
        Tile there = new(travelled.Place.X, travelled.Place.Z);
        Assert.Equal(1, there.DistanceTo(tolaria));
        CharacterView me = await browser.Me();
        Assert.Equal((World, there), (me.Space, new Tile(me.X, me.Z)));
        Assert.Equal(["benalia-1", "orvada-2"], me.Attuned);
        await browser.Position(World, new Tile(there.X + 1, there.Z));

        // And back.
        await browser.Put(World, there);
        await browser.Ok<WaystoneView>(HttpMethod.Post, "/api/waystone", new { Tower = "benalia-1" });
        Assert.Equal(1, new Tile((await browser.Me()).X, (await browser.Me()).Z).DistanceTo(benalia));
    }

    [Fact]
    public async Task On_the_generated_world_a_waystone_is_used_from_beside_it_away_from_the_door()
    {
        // The Domains' waystone stands on a blocked tile two to one side of its tower's entrance, and is used from any
        // open tile round it, as the overworld talks to any NPC: three tiles from the door, say.
        await using var app = new RealmApp { OnGenerated = true };
        Browser browser = await app.Character(1);
        RealmContent content = RealmApp.Generated;
        RealmWorld world = content.World;
        Tile entrance = content.Dungeons["benalia-1"].File.At;
        Tile waystone = Assert.Single(world.WaystonesOf("benalia-1"));
        Assert.Contains(world.Npcs, npc => npc.Kind == RealmSpace.Waystone && npc.Tower == "benalia-1" && npc.At == waystone);
        Tile stand = Tile.Steps.Select(waystone.Plus).Where(world.Walkable).OrderByDescending(tile => tile.DistanceTo(entrance)).First();
        Assert.True(stand.DistanceTo(entrance) > 1, $"{stand} is beside the entrance {entrance}");
        Assert.All(content.Dungeons.Values.Where(dungeon => dungeon.File.Waystone), tower => Assert.NotEmpty(world.WaystonesOf(tower.Id)));

        await app.Store(async db =>
        {
            db.Attuned.AddRange(new AttunedRow { PlayerId = browser.Player, Tower = "benalia-1" }, new AttunedRow { PlayerId = browser.Player, Tower = "orvada-2" });
            await db.SaveChangesAsync();
        });
        await browser.Put(World, new Tile(stand.X + 3 * (stand.X - waystone.X), stand.Z + 3 * (stand.Z - waystone.Z)));
        await browser.Refused(HttpMethod.Post, "/api/waystone", new { Tower = "orvada-2" }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Put(World, stand);
        WaystoneView travelled = await browser.Ok<WaystoneView>(HttpMethod.Post, "/api/waystone", new { Tower = "orvada-2" });
        Assert.Equal(1, new Tile(travelled.Place.X, travelled.Place.Z).DistanceTo(content.Dungeons["orvada-2"].File.At));
    }
}
