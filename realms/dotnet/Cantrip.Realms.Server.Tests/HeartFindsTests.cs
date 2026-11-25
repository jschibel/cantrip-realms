using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// The two hearts found rather than bought (design.md A3b): a heartbloom of the wilds, picked from on or beside it, gone for
/// everyone once picked (Finds spawns them); and a dungeon run's shrine (A6), on one floor of a run in eight, which blesses
/// once in the run (kept in the <c>chests</c> table). Each gives back one heart up to the capacity, and neither is used up
/// by a character whose hearts are full.
/// </summary>
public sealed class HeartFindsTests
{
    private const string World = RealmContent.WorldSpace;

    private static Task<ChestView> Pick(Browser browser, FindView bloom) =>
        browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = bloom.Id });

    private static Task<ApiError> PickRefused(Browser browser, FindView bloom, string code) =>
        browser.Refused(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = bloom.Id }, HttpStatusCode.Conflict, code);

    [Fact]
    public async Task A_heartbloom_gives_back_a_heart_once_and_is_gone_for_everyone()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await app.SetHearts(browser, 1, 3);
        FindView bloom = await RealmApp.Stand(browser, "heartbloom", RealmApp.Wilds);
        Assert.Equal(("heartbloom", RealmApp.Wilds.X, RealmApp.Wilds.Z), (bloom.Kind, bloom.X, bloom.Z));

        // Picked from on or beside it, never from afar.
        await browser.Put(World, RealmApp.Away(RealmApp.Wilds, 2));
        await PickRefused(browser, bloom, Codes.NotNear);
        await browser.Put(World, RealmApp.Wilds);
        ChestView picked = await Pick(browser, bloom);
        Assert.Equal((true, 0L, (GearInstance?)null, 2, Characters.StartingGold), (picked.Heart, picked.Found, picked.Gear, picked.Hearts, picked.Gold));
        CharacterView me = await browser.Me();
        Assert.Equal((2, 3), (me.Hearts, me.MaxHearts));

        // Gone: for its picker, and for anyone else who comes to it.
        Assert.DoesNotContain(await browser.Ok<List<FindView>>(HttpMethod.Get, "/api/finds"), find => find.Id == bloom.Id);
        await PickRefused(browser, bloom, Codes.Empty);
        Browser other = await app.Character(2);
        await app.SetHearts(other, 1);
        await other.Put(World, RealmApp.Wilds);
        await PickRefused(other, bloom, Codes.Empty);
    }

    [Fact]
    public async Task A_heartbloom_is_left_standing_by_a_character_whose_hearts_are_full()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        FindView bloom = await RealmApp.Stand(browser, "heartbloom", RealmApp.Wilds);
        await browser.Put(World, RealmApp.Wilds);

        ApiError full = await PickRefused(browser, bloom, Codes.FullHearts);
        Assert.Contains("full", full.Detail, StringComparison.Ordinal);
        CharacterView me = await browser.Me();
        Assert.Equal((2, 2, Characters.StartingGold), (me.Hearts, me.MaxHearts, me.Gold));
        Assert.Contains(await browser.Ok<List<FindView>>(HttpMethod.Get, "/api/finds"), find => find.Id == bloom.Id);

        // A heart lost since, it is there to pick.
        await app.SetHearts(browser, 1);
        Assert.Equal(2, (await Pick(browser, bloom)).Hearts);
    }

    [Fact]
    public async Task A_treasure_chest_says_the_hearts_unchanged_and_no_heart()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await app.SetHearts(browser, 1);
        FindView chest = await RealmApp.Stand(browser, "chest", RealmApp.Wilds);
        await browser.Put(World, RealmApp.Beside(World, RealmApp.Wilds));
        ChestView found = await browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id });
        Assert.Equal((false, 1), (found.Heart, found.Hearts));
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
}
