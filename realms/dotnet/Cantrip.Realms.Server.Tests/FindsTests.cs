using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Economy;
using Cantrip.Realms.Server.Presence;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// The finds of the wilds (Economy/Finds; design.md A5, A3b): treasure chests and heartblooms come and go, never kept in
/// the world's files - a few to a zone, each on an open tile of the wilds, crumbling unopened - and each is everyone's.
/// The spawner's own dice are a seeded <see cref="Random"/>; what is checked is what holds whatever they roll.
/// </summary>
public sealed class FindsTests
{
    private const string World = RealmContent.WorldSpace;

    private static readonly FindOptions Rules = new()
    {
        ChestsPerZone = 2,
        ChestEvery = TimeSpan.FromMinutes(10),
        ChestLasts = TimeSpan.FromMinutes(30),
        Heartblooms = 8,
        HeartbloomEvery = TimeSpan.FromMinutes(30),
        HeartbloomLasts = TimeSpan.FromHours(3),
    };

    private static (Finds Finds, FakeTimeProvider Time, PresenceHub Presence) Spawner(RealmContent content, FindOptions rules)
    {
        var time = new FakeTimeProvider(RealmApp.Start);
        var options = new RealmOptions { Database = Data.RealmDatabase.Parse("sqlite:unused.db"), Root = RealmApp.Root, Finds = rules };
        var presence = new PresenceHub(content, options, time);
        return (new Finds(content, options, time, presence, new Random(20261125)), time, presence);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Finds_come_and_go_in_the_wilds_a_few_to_a_zone_never_kept(bool dominaria)
    {
        RealmContent content = dominaria ? RealmApp.Generated : RealmApp.Content;
        RealmWorld world = content.World;
        (Finds finds, FakeTimeProvider time, PresenceHub presence) = Spawner(content, Rules);

        // A player standing in the wilds: nothing spawns at their feet.
        Find? first = null;
        Dictionary<string, Find> seen = new(StringComparer.Ordinal);
        Tile? standing = null;
        for (int minute = 0; minute < 12 * 60; minute++)
        {
            time.Advance(TimeSpan.FromMinutes(1));
            IReadOnlyList<Find> live = finds.Live();
            if (standing is null && live.FirstOrDefault() is { } earliest)
            {
                first = earliest;
                standing = Enumerable.Range(20, 64).Select(more => new Tile(earliest.At.X, earliest.At.Z + more)).First(world.Walkable);
                presence.Enter(presence.Connect("dev-1", "Stander", "W", new LookView(), _ => { }), World, standing.Value);
            }

            long now = time.GetUtcNow().ToUnixTimeMilliseconds();
            foreach (IGrouping<int, Find> zone in live.Where(find => find.Kind == FindKind.Chest).GroupBy(find => world.ZoneOf(find.At)))
            {
                Assert.True(zone.Count() <= Rules.ChestsPerZone, $"zone {zone.Key} holds {zone.Count()} chests");
            }

            List<Find> blooms = [.. live.Where(find => find.Kind == FindKind.Heartbloom)];
            Assert.True(blooms.Count <= Rules.Heartblooms);
            foreach (Find bloom in blooms)
            {
                Assert.All(blooms.Where(other => other != bloom), other => Assert.True(bloom.At.DistanceTo(other.At) >= Finds.HeartbloomApart));
            }

            foreach (Find find in live)
            {
                Assert.True(find.Until > now, $"{find.Id} stands past its time");
                if (seen.TryAdd(find.Id, find) && standing is { } at && find != first)
                {
                    Assert.True(find.At.DistanceTo(at) >= Finds.AwayFromPlayers, $"{find.Id} spawned at {find.At}, at a player's feet");
                }
            }
        }

        // Some of each, and each where the rules say: open ground of the wilds, level all round, in a zone of its tier.
        Assert.Contains(seen.Values, find => find.Kind == FindKind.Chest);
        Assert.Contains(seen.Values, find => find.Kind == FindKind.Heartbloom);
        foreach (Find find in seen.Values)
        {
            Assert.True(world.Walkable(find.At) && !world.IsWorked(find.At), $"{find.Id} at {find.At}: not open ground of the wilds");
            Assert.All(Tile.Steps, step => Assert.True(world.CanStep(find.At, find.At.Plus(step), hops: false), $"{find.Id} at {find.At}: not level all round"));
            Assert.Null(content.TownAt(find.At));
            int zone = world.ZoneOf(find.At);
            Assert.True(zone >= 0, $"{find.Id} at {find.At}: in no zone");
            Assert.Equal(world.File.Zones!.Areas[zone].Tier, find.Tier);
            Assert.True(find.Tier > 0);
            TimeSpan lasts = find.Kind == FindKind.Chest ? Rules.ChestLasts : Rules.HeartbloomLasts;
            Assert.Equal((long)lasts.TotalMilliseconds, find.Until - find.Since);
            Assert.Equal(find.Kind == FindKind.Chest ? Finds.GoldOf(find.Tier) : (IReadOnlyList<long>)[], find.Gold);
        }

        // Unopened, each goes in its time: an hour after the last spawn could stand, a quiet spawner has none.
        (Finds quiet, FakeTimeProvider later, _) = Spawner(content, Rules with { ChestsPerZone = 0, Heartblooms = 0 });
        Find placed = quiet.Place(FindKind.Chest, seen.Values.First().At);
        later.Advance(Rules.ChestLasts - TimeSpan.FromSeconds(1));
        Assert.Contains(quiet.Live(), find => find.Id == placed.Id);
        later.Advance(TimeSpan.FromSeconds(1));
        Assert.Empty(quiet.Live());
    }

    [Fact]
    public void A_find_taken_is_gone_for_everyone_and_one_put_back_stands_again()
    {
        (Finds finds, _, _) = Spawner(RealmApp.Content, Rules with { ChestsPerZone = 0, Heartblooms = 0 });
        Find bloom = finds.Place(FindKind.Heartbloom, RealmApp.Wilds);
        Assert.True(finds.Take(bloom));
        Assert.False(finds.Take(bloom));
        Assert.Null(finds.Get(bloom.Id));
        finds.PutBack(bloom);
        Assert.Equal(bloom, finds.Get(bloom.Id));
    }

    [Fact]
    public async Task The_overworld_is_told_the_finds_standing_and_a_test_stands_its_own()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        Assert.Empty(await browser.Ok<List<FindView>>(HttpMethod.Get, "/api/finds"));
        FindView chest = await RealmApp.Stand(browser, "chest", RealmApp.Wilds);
        FindView listed = Assert.Single(await browser.Ok<List<FindView>>(HttpMethod.Get, "/api/finds"));
        Assert.Equal(chest, listed);
        Assert.Equal(RealmApp.Start + Rules.ChestLasts, chest.Until);

        // Nowhere a find can't stand, and nothing that is no find.
        await browser.Refused(HttpMethod.Post, "/dev/find", new { Kind = "chest", X = 9999, Z = 9999 }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);
        await browser.Refused(HttpMethod.Post, "/dev/find", new { Kind = "barrel", RealmApp.Wilds.X, RealmApp.Wilds.Z }, HttpStatusCode.UnprocessableEntity, Codes.NoSuchPlace);
    }

    [Fact]
    public void Dominarias_zones_hold_wilds_of_every_tier()
    {
        RealmWorld world = RealmApp.Generated.World;
        ZonesEntry zones = Assert.IsType<ZonesEntry>(world.File.Zones);
        Assert.Equal(Enumerable.Range(1, 4), zones.Grid.SelectMany(row => row).Where(zone => zone >= 0).Select(zone => zones.Areas[zone].Tier).Where(tier => tier > 0).Distinct().Order());
    }
}
