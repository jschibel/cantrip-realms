using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// The two hearts found rather than bought (design.md A3b): a heartbloom of the wilds, picked from beside it, which grows
/// back for that character a week later; and a dungeon run's shrine (A6), on one floor of a run in eight, which blesses
/// once in the run. Each gives back one heart up to the capacity, and neither is used up by a character whose hearts are
/// full. Both are kept in the <c>chests</c> table, as a chest's opening is.
/// </summary>
public sealed class HeartFindsTests
{
    private const string World = RealmContent.WorldSpace;

    /// <summary>The test world's heartbloom (World/make-world.py).</summary>
    private static MapChest Bloom => RealmApp.Content.World.Chest("1_1:h1")!;

    private static Task<ChestView> Pick(Browser browser) =>
        browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = Bloom.Id });

    private static Task<ApiError> PickRefused(Browser browser, string code) =>
        browser.Refused(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = Bloom.Id }, HttpStatusCode.Conflict, code);

    [Fact]
    public void The_test_worlds_heartbloom_is_a_heart_and_no_gold_on_an_open_tile_of_the_wilds()
    {
        Assert.True(Bloom.Heart);
        Assert.Empty(Bloom.Gold);
        Assert.Equal((int)Chests.HeartbloomRegrowth.TotalSeconds, Bloom.RespawnSeconds);
        Assert.True(RealmApp.Content.World.Walkable(Bloom.At));
        Assert.Null(RealmApp.Content.TownAt(Bloom.At));
        Assert.DoesNotContain(RealmApp.Content.World.Chests, chest => chest.Heart && chest.Id != Bloom.Id);
    }

    [Fact]
    public async Task A_heartbloom_gives_back_a_heart_and_grows_back_for_its_picker_a_week_later()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await app.SetHearts(browser, 1, 3);

        // Picked from beside it, never from afar.
        await browser.Put(World, RealmApp.Away(Bloom.At, 2));
        await browser.Refused(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = Bloom.Id }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Put(World, Bloom.At);
        Assert.Empty((await browser.Me()).Picked);

        ChestView picked = await Pick(browser);
        Assert.Equal((true, 0L, (GearInstance?)null, 2, Characters.StartingGold), (picked.Heart, picked.Found, picked.Gear, picked.Hearts, picked.Gold));
        CharacterView me = await browser.Me();
        Assert.Equal((2, 3), (me.Hearts, me.MaxHearts));
        PickedView gone = Assert.Single(me.Picked);
        Assert.Equal((Bloom.Id, RealmApp.Start + Chests.HeartbloomRegrowth), (gone.Chest, gone.Until));

        // Gone for this character until it grows back, a week on, a heart missing or not.
        await browser.Put(World, RealmApp.Beside(World, Bloom.At));
        await PickRefused(browser, Codes.Empty);
        app.Time.Advance(Chests.HeartbloomRegrowth - TimeSpan.FromSeconds(1));
        await PickRefused(browser, Codes.Empty);
        Assert.Single((await browser.Me()).Picked);
        app.Time.Advance(TimeSpan.FromSeconds(1));
        Assert.Empty((await browser.Me()).Picked);
        Assert.Equal(3, (await Pick(browser)).Hearts);

        // Another character's is theirs: still there for them.
        Browser other = await app.Character(2);
        await app.SetHearts(other, 1);
        await other.Put(World, Bloom.At);
        Assert.Equal(2, (await Pick(other)).Hearts);

        // One row a find, as a chest's: the bloom's time taken, by whom.
        List<ChestRow> rows = await app.Store(db => db.Chests.AsNoTracking().Where(row => row.Chest == Bloom.Id).OrderBy(row => row.PlayerId).ToListAsync());
        Assert.Equal([browser.Player, other.Player], rows.Select(row => row.PlayerId));
    }

    [Fact]
    public async Task A_heartbloom_is_left_standing_by_a_character_whose_hearts_are_full()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await browser.Put(World, Bloom.At);

        ApiError full = await PickRefused(browser, Codes.FullHearts);
        Assert.Contains("full", full.Detail, StringComparison.Ordinal);
        CharacterView me = await browser.Me();
        Assert.Equal((2, 2, Characters.StartingGold), (me.Hearts, me.MaxHearts, me.Gold));
        Assert.Empty(me.Picked);
        Assert.False(await app.Store(db => db.Chests.AnyAsync(row => row.PlayerId == browser.Player)));

        // A heart lost since, it is there to pick.
        await app.SetHearts(browser, 1);
        Assert.Equal(2, (await Pick(browser)).Hearts);
    }

    [Fact]
    public async Task A_treasure_chest_says_the_hearts_unchanged_and_no_heart()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await app.SetHearts(browser, 1);
        MapChest chest = RealmApp.Content.World.Chest("0_0:1")!;
        await browser.Put(World, RealmApp.Beside(World, chest.At));
        ChestView found = await browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id });
        Assert.Equal((false, 1), (found.Heart, found.Hearts));
        Assert.Empty((await browser.Me()).Picked);
    }

    [Fact]
    public void A_run_holds_a_shrine_one_time_in_eight()
    {
        Assert.Equal(1.0 / 8, Dungeons.ShrineChance);
    }

    [Theory]
    [InlineData(0.0, true)]
    [InlineData(1.0, false)]
    public async Task The_dice_put_a_shrine_on_one_floor_of_a_run_or_none(double roll, bool shrine)
    {
        await using var app = new RealmApp { Random = new ForcedRolls(roll) };
        Browser browser = await app.Character(1);
        RunView run = await app.EnterRun(browser, "benalish-keep");
        Assert.Equal(shrine ? 1 : 0, run.Floors.Count(floor => floor.Shrine));
        Assert.False(run.ShrineUsed);
    }

    [Fact]
    public async Task A_shrine_blesses_once_in_its_run_on_its_own_floor()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await browser.Ok<object>(HttpMethod.Post, "/dev/drop", new { Shrine = true });
        RunView run = await app.EnterRun(browser, "benalish-keep");
        int floor = run.Floors.Select((f, at) => (f, at)).Single(pair => pair.f.Shrine).at;

        // Only on its floor.
        if (run.Floors.Count > 1)
        {
            await app.ToFloor(run, floor == 0 ? 1 : 0);
            await browser.Refused(HttpMethod.Post, "/api/dungeon/shrine", new { run.Run }, HttpStatusCode.Conflict, Codes.NotThere);
        }

        await app.ToFloor(run, floor);

        // Hearts full: the blessing keeps.
        await browser.Refused(HttpMethod.Post, "/api/dungeon/shrine", new { run.Run }, HttpStatusCode.Conflict, Codes.FullHearts);
        Assert.False((await browser.Ok<RunView>(HttpMethod.Get, "/api/dungeon/run")).ShrineUsed);

        await app.SetHearts(browser, 1);
        ShrineView blessed = await browser.Ok<ShrineView>(HttpMethod.Post, "/api/dungeon/shrine", new { run.Run });
        Assert.Equal(2, blessed.Hearts);
        Assert.Equal(2, (await browser.Me()).Hearts);
        RunView resumed = await browser.Ok<RunView>(HttpMethod.Get, "/api/dungeon/run");
        Assert.True(resumed.ShrineUsed);
        Assert.Equal(floor, resumed.Floors.Select((f, at) => (f, at)).Single(pair => pair.f.Shrine).at);

        // Once in the run, a heart missing or not.
        await app.SetHearts(browser, 1);
        await browser.Refused(HttpMethod.Post, "/api/dungeon/shrine", new { run.Run }, HttpStatusCode.Conflict, Codes.Empty);
        Assert.Equal(1, (await browser.Me()).Hearts);

        // The next run is a run of its own: its shrine, where the dice put it, blesses again.
        await browser.Ok<object>(HttpMethod.Post, "/api/dungeon/leave", new { run.Run });
        await browser.Refused(HttpMethod.Post, "/api/dungeon/shrine", new { run.Run }, HttpStatusCode.Conflict, Codes.NotThere);
        RunView next = await app.EnterRun(browser, "benalish-keep");
        Assert.False(next.ShrineUsed);
        await app.ToFloor(next, next.Floors.Select((f, at) => (f, at)).Single(pair => pair.f.Shrine).at);
        Assert.Equal(2, (await browser.Ok<ShrineView>(HttpMethod.Post, "/api/dungeon/shrine", new { next.Run })).Hearts);
    }

    [Fact]
    public async Task A_shrine_is_prayed_at_only_in_its_run_and_a_run_without_one_has_none()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await app.SetHearts(browser, 1);
        await browser.Ok<object>(HttpMethod.Post, "/dev/drop", new { Shrine = false });
        RunView bare = await app.EnterRun(browser, "benalish-keep");
        Assert.DoesNotContain(bare.Floors, floor => floor.Shrine);
        foreach (int floor in Enumerable.Range(0, bare.Floors.Count))
        {
            await app.ToFloor(bare, floor);
            await browser.Refused(HttpMethod.Post, "/api/dungeon/shrine", new { bare.Run }, HttpStatusCode.Conflict, Codes.NotThere);
        }

        await browser.Ok<object>(HttpMethod.Post, "/dev/drop", new { Shrine = true });
        RunView run = await app.EnterRun(browser, "benalish-keep");
        await app.ToFloor(run, run.Floors.Select((f, at) => (f, at)).Single(pair => pair.f.Shrine).at);

        // Not standing in it (somewhere else, as a stale page might ask): refused.
        await browser.Put(World, RealmApp.Inn("new-benalia").At);
        await browser.Refused(HttpMethod.Post, "/api/dungeon/shrine", new { run.Run }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Refused(HttpMethod.Post, "/api/dungeon/shrine", new { Run = "no-such-run" }, HttpStatusCode.NotFound, Codes.NotThere);

        // Another player's run is none of theirs.
        Browser other = await app.Character(2);
        await other.Refused(HttpMethod.Post, "/api/dungeon/shrine", new { run.Run }, HttpStatusCode.NotFound, Codes.NotThere);
        Assert.Equal(1, (await browser.Me()).Hearts);
    }

    [Fact]
    public async Task A_test_arranges_a_heart_missing_on_a_development_server()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        CharacterView set = await browser.Ok<CharacterView>(HttpMethod.Post, "/dev/hearts", new { Hearts = 1 });
        Assert.Equal((1, 2), (set.Hearts, set.MaxHearts));
        set = await browser.Ok<CharacterView>(HttpMethod.Post, "/dev/hearts", new { Hearts = 3, MaxHearts = 4 });
        Assert.Equal((3, 4), (set.Hearts, set.MaxHearts));
        foreach (object none in new object[] { new { Hearts = 0 }, new { Hearts = 5 }, new { Hearts = 2, MaxHearts = 6 } })
        {
            await browser.Refused(HttpMethod.Post, "/dev/hearts", none, HttpStatusCode.UnprocessableEntity, "NoSuchHearts");
        }

        Assert.Equal((3, 4), ((await browser.Me()).Hearts, (await browser.Me()).MaxHearts));
    }

    [Fact]
    public void Dominaria_grows_a_handful_of_heartblooms_in_its_wilds()
    {
        RealmContent content = RealmApp.Generated;
        List<MapChest> blooms = [.. content.World.Chests.Where(chest => chest.Heart)];
        Assert.InRange(blooms.Count, 6, 12);
        foreach (MapChest bloom in blooms)
        {
            Assert.Empty(bloom.Gold);
            Assert.Equal((int)Chests.HeartbloomRegrowth.TotalSeconds, bloom.RespawnSeconds);
            Assert.True(content.World.Walkable(bloom.At), $"{bloom.Id} stands on a closed tile");
            Assert.Null(content.TownAt(bloom.At));
        }

        // Rare: far apart, never two in one stretch of the wilds.
        foreach (MapChest bloom in blooms)
        {
            Assert.All(blooms.Where(other => other != bloom), other => Assert.True(bloom.At.DistanceTo(other.At) >= 100, $"{bloom.Id} and {other.Id} grow close"));
        }
    }
}
