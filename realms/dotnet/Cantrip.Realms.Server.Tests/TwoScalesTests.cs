using System.Net;
using System.Text.Json.Nodes;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Economy;
using Cantrip.Realms.Server.Presence;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// A world of two scales (interfaces.md, "Two scales"): a travel map, each town's grounds in a pocket of its own past it,
/// joined by the towns' ways. Read and checked (the overworld's two-scale fixture, realms/web/fixtures/two-world, and the
/// test world written as one of two scales, World/two), a way taken through <c>POST /api/position</c> and nothing else
/// jumped, the whole grounds safe for hearts, and the finds of the wilds on the travel map alone.
/// </summary>
public sealed class TwoScalesTests
{
    private const string World = RealmContent.WorldSpace;

    /// <summary>The overworld's two-scale fixture as files (<c>npm run two-world</c>).</summary>
    private static string Fixture => Path.Combine(RealmApp.Root, "realms", "web", "fixtures", "two-world", "files");

    private static TownEntry Avenant => RealmApp.TwoScales.Towns["avenant"];

    private static TownWay Way => Avenant.Ways[0];

    /// <summary>A world read from a folder of world files, and what its two scales' check finds.</summary>
    private static (RealmWorld? World, List<string> Problems) Read(string folder)
    {
        List<string> problems = [];
        RealmWorld? world = RealmContent.ReadWorld(folder, "two", problems);
        if (world is not null) RealmContent.CheckScales(world, problems);
        return (world, problems);
    }

    /// <summary>The fixture's world copied, its world.json changed (and any files added), and read.</summary>
    private static List<string> Changed(Action<JsonObject> change, params (string Path, string Text)[] more)
    {
        string folder = Path.Combine(Path.GetTempPath(), $"two-world-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateDirectory(Path.Combine(folder, "chunks"));
            foreach (string chunk in Directory.EnumerateFiles(Path.Combine(Fixture, "world", "chunks"))) File.Copy(chunk, Path.Combine(folder, "chunks", Path.GetFileName(chunk)));
            JsonObject world = JsonNode.Parse(File.ReadAllText(Path.Combine(Fixture, "world", "world.json")))!.AsObject();
            change(world);
            File.WriteAllText(Path.Combine(folder, "world.json"), world.ToJsonString());
            foreach ((string path, string text) in more) File.WriteAllText(Path.Combine(folder, path), text);
            return Read(folder).Problems;
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    private static JsonObject Town(JsonObject world) => world["towns"]![0]!.AsObject();

    [Fact]
    public void The_overworlds_fixture_is_read_and_holds_together()
    {
        (RealmWorld? world, List<string> problems) = Read(Path.Combine(Fixture, "world"));
        Assert.Empty(problems);
        Assert.NotNull(world);
        Assert.True(world.TwoScales);
        // Chunks over the travel map (3 by 3) and Twoford's grounds (3 by 3), none between.
        Assert.Equal(18, world.Chunks.Count);
        Assert.False(world.HasGround(4, 1));
        Assert.True(world.HasGround(7, 1));
        Assert.Equal("twoford", world.GroundsAt(new Tile(240, 44))?.Id);
        Assert.Null(world.GroundsAt(new Tile(48, 40)));
        Assert.True(world.InTravel(new Tile(10, 10)));
        Assert.False(world.InTravel(new Tile(240, 44)));
        // Nothing stands between the scales: no tile of the void is anybody's.
        Assert.False(world.Has(new Tile(140, 40)));
    }

    [Fact]
    public void Two_scales_that_do_not_hold_together_are_problems_never_a_crash()
    {
        Assert.Empty(Changed(_ => { }));
        Assert.Contains(Changed(w => Town(w)["grounds"] = new JsonArray(96, 0, 160, 64)), p => p.Contains("within 2 chunks of the travel map", StringComparison.Ordinal));
        Assert.Contains(Changed(w => Town(w)["ways"]![0]!["outside"] = new JsonArray(44, 40)), p => p.Contains("is not beside the icon on its west", StringComparison.Ordinal));
        Assert.Contains(Changed(w => Town(w)["ways"]![1]!["inside"] = new JsonArray(40, 40)), p => p.Contains("south way: its inside", StringComparison.Ordinal) && p.Contains("is not an open tile of its grounds", StringComparison.Ordinal));
        Assert.Contains(Changed(w => Town(w)["ways"]![1]!["to"] = "nowhere"), p => p.Contains("leads to 'nowhere'", StringComparison.Ordinal));
        Assert.Contains(Changed(w => Town(w)["center"] = new JsonArray(20, 20)), p => p.Contains("is not in its grounds", StringComparison.Ordinal));
        Assert.Contains(Changed(w => Town(w)["site"] = new JsonArray(30, 30)), p => p.Contains("is open (an icon stands on a blocked square)", StringComparison.Ordinal));
        Assert.Contains(Changed(w => w["dungeons"]![0]!["x"] = 230), p => p.Contains("dungeon two-caves", StringComparison.Ordinal) && p.Contains("not on the travel map", StringComparison.Ordinal));
        Assert.Contains(Changed(w => w.Remove("travel")), p => p.Contains("no travel map", StringComparison.Ordinal));
        string stray = File.ReadAllText(Path.Combine(Fixture, "world", "chunks", "0_0.json")).Replace("\"cx\":0", "\"cx\":4", StringComparison.Ordinal);
        Assert.Contains(Changed(_ => { }, ("chunks/4_0.json", stray)), p => p.Contains("4_0", StringComparison.Ordinal) && p.Contains("over no ground", StringComparison.Ordinal));
        // A spawn in the grounds: a chunk of the pocket with one.
        JsonObject pocket = JsonNode.Parse(File.ReadAllText(Path.Combine(Fixture, "world", "chunks", "7_1.json")))!.AsObject();
        pocket["spawns"] = new JsonArray(JsonNode.Parse("""{"id":"7_1:0","x":230,"z":50,"mobs":["benalish-hero"],"radius":2,"respawnSeconds":600,"tier":1}"""));
        Assert.Contains(Changed(_ => { }, ("chunks/7_1.json", pocket.ToJsonString())), p => p.Contains("spawn 7_1:0", StringComparison.Ordinal) && p.Contains("not on the travel map", StringComparison.Ordinal));
    }

    [Fact]
    public void The_test_world_of_two_scales_holds_together_and_a_town_without_grounds_stands_on_the_travel_map()
    {
        RealmContent content = RealmApp.TwoScales;
        Assert.True(content.World.TwoScales);
        Assert.Equal("avenant", content.World.GroundsAt(Avenant.At)?.Id);
        Assert.Null(content.Towns["new-benalia"].Grounds);
        Assert.True(content.World.InTravel(content.Towns["new-benalia"].At));
        Assert.Equal("avenant", content.Interiors["avenant-inn"].Town?.Id);
    }

    [Fact]
    public async Task A_way_is_taken_into_the_grounds_from_beside_its_outside_and_out_from_its_exit_and_nothing_else_jumps()
    {
        using var app = new RealmApp { OnTwoScales = true };
        Browser browser = await app.Character(4100);
        Tile outside = Way.OutsideAt;
        Tile inside = Way.InsideAt;
        Tile exit = Way.ExitAt.First();
        object At(Tile t) => new { Space = World, t.X, t.Z };

        // In: from the way's outside (or beside it) to its inside, at once.
        await browser.Put(World, outside);
        await browser.Ok<PositionView>(HttpMethod.Post, "/api/position", At(inside));
        // Out: from its exit to its outside.
        await browser.Put(World, exit);
        await browser.Ok<PositionView>(HttpMethod.Post, "/api/position", At(outside));

        // Nothing else jumps: into the grounds from far off on the travel map, or to a tile of them far from the way in;
        // out of them from anywhere but an exit, or to anywhere but the outside.
        await browser.Put(World, new Tile(outside.X - 30, outside.Z));
        await browser.Refused(HttpMethod.Post, "/api/position", At(inside), HttpStatusCode.Conflict, Codes.NoWay);
        await browser.Put(World, outside);
        await browser.Refused(HttpMethod.Post, "/api/position", At(new Tile(Avenant.At.X + 20, Avenant.At.Z + 20)), HttpStatusCode.Conflict, Codes.NoWay);
        await browser.Put(World, inside);
        await browser.Refused(HttpMethod.Post, "/api/position", At(outside), HttpStatusCode.Conflict, Codes.NoWay);
        await browser.Put(World, exit);
        await browser.Refused(HttpMethod.Post, "/api/position", At(new Tile(outside.X - 30, outside.Z)), HttpStatusCode.Conflict, Codes.NoWay);
    }

    [Fact]
    public async Task A_towns_grounds_are_safe_its_hearts_filled_anywhere_in_them()
    {
        using var app = new RealmApp { OnTwoScales = true };
        Browser browser = await app.Character(4101);
        await app.SetHearts(browser, 1);
        // Out past its walls, on its road from the way: still the town's.
        Tile road = Way.InsideAt;
        Assert.True(road.DistanceTo(Avenant.At) > Avenant.Radius);
        await browser.Put(World, Way.OutsideAt);
        PositionView after = await browser.Ok<PositionView>(HttpMethod.Post, "/api/position", new { Space = World, road.X, road.Z });
        Assert.Equal(2, after.Hearts);
    }

    [Fact]
    public void Someone_going_into_a_town_is_gone_from_the_travel_map_behind_no_walk_and_seen_in_its_grounds()
    {
        RealmContent content = RealmApp.TwoScales;
        var time = new FakeTimeProvider(RealmApp.Start);
        var options = new RealmOptions { Database = Data.RealmDatabase.Parse("sqlite:unused.db"), Root = RealmApp.Root };
        var hub = new PresenceHub(content, options, time);
        List<PresenceServerMessage> toWaiter = [];
        List<PresenceServerMessage> toHost = [];
        PresenceHub.Member walker = hub.Connect("dev-1", "Walker", "W", new LookView(), _ => { });
        PresenceHub.Member waiter = hub.Connect("dev-2", "Waiter", "W", new LookView(), toWaiter.Add);
        PresenceHub.Member host = hub.Connect("dev-3", "Host", "W", new LookView(), toHost.Add);
        Tile outside = Way.OutsideAt;
        hub.Enter(waiter, World, new Tile(outside.X - 2, outside.Z));
        hub.Enter(host, World, Way.InsideAt);
        hub.Enter(walker, World, outside);
        Assert.Contains(toWaiter, m => m is OtherMessage other && other.Player == walker.Id);
        Assert.DoesNotContain(toHost, m => m is OtherMessage other && other.Player == walker.Id);

        // Through the way (the report taken, the relay entered anew where the server has them): gone from beside the icon,
        // come to the road into town, where whoever is there sees them.
        toWaiter.Clear();
        hub.Enter(walker, World, Way.InsideAt);
        Assert.Contains(toWaiter, m => m is LeftMessage left && left.Player == walker.Id);
        Assert.Contains(toHost, m => m is OtherMessage other && other.Player == walker.Id);
    }

    [Fact]
    public void The_finds_of_the_wilds_stand_on_the_travel_map_alone()
    {
        RealmContent content = RealmApp.TwoScales;
        var time = new FakeTimeProvider(RealmApp.Start);
        var rules = new FindOptions { ChestsPerZone = 3, ChestEvery = TimeSpan.FromMinutes(1), ChestLasts = TimeSpan.FromMinutes(30), Heartblooms = 4, HeartbloomEvery = TimeSpan.FromMinutes(2), HeartbloomLasts = TimeSpan.FromHours(1) };
        var options = new RealmOptions { Database = Data.RealmDatabase.Parse("sqlite:unused.db"), Root = RealmApp.Root, Finds = rules };
        var finds = new Finds(content, options, time, new PresenceHub(content, options, time), new Random(20261126));
        HashSet<string> seen = new(StringComparer.Ordinal);
        for (int minute = 0; minute < 6 * 60; minute++)
        {
            time.Advance(TimeSpan.FromMinutes(1));
            foreach (Find find in finds.Live())
            {
                seen.Add(find.Id);
                Assert.True(content.World.InTravel(find.At), $"{find.Id} at {find.At}");
                Assert.Null(content.World.GroundsAt(find.At));
            }
        }

        Assert.True(seen.Count > 5);
    }
}
