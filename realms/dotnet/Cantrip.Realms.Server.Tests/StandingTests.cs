using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;
using Cantrip.Realms;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// A color's dungeon dealt by where its color stands to the character's (design.md A6): an ally color's is tier 3 with T2-T3
/// mobs, an enemy color's tier 4 with T3-T4 mobs and a stronger boss, and the character's own color's as written. The
/// standing is the dungeon file's (<c>standing</c>), kept with the run as it began.
/// </summary>
public sealed class StandingTests
{
    private const string Keep = "benalish-keep";
    private const string Lyra = "lyra-dawnbringer";

    [Theory]
    [InlineData("W", "W", "W", Standings.Own)]
    [InlineData("U", "W", "W", Standings.Ally)]
    [InlineData("G", "W", "W", Standings.Ally)]
    [InlineData("B", "W", "W", Standings.Enemy)]
    [InlineData("R", "W", "W", Standings.Enemy)]
    [InlineData("W", "G", "G", Standings.Ally)]
    [InlineData("U", "G", "G", Standings.Enemy)]
    [InlineData("B", "W", "WB", Standings.Own)]
    [InlineData("R", "W", "WG", Standings.Enemy)]
    [InlineData(null, "W", "W", null)]
    [InlineData("X", "W", "W", null)]
    public void A_regions_color_stands_to_the_characters_own_by_their_identity_and_their_starting_color(string? region, string start, string identity, string? standing) =>
        Assert.Equal(standing, Standings.Of(region, start, identity));

    [Fact]
    public void The_five_color_dungeons_are_dealt_by_standing_and_their_tables_hold_each_standings_tiers()
    {
        foreach (string id in new[] { "benalish-keep", "academy-tower", "vess-crypts", "keldon-fortress", "elfhame-hollow" })
        {
            RealmDungeon dungeon = RealmApp.Content.Dungeons[id];
            DungeonStanding ally = dungeon.StandingOf(Standings.Ally)!;
            DungeonStanding enemy = dungeon.StandingOf(Standings.Enemy)!;
            Assert.Equal((3, 4), (ally.Tier, enemy.Tier));
            Assert.Equal(new[] { 2, 3 }, ally.MobTiers);
            Assert.Equal(new[] { 3, 4 }, enemy.MobTiers);
            Assert.True(enemy.BossStats.Life > 0, id);
            Assert.Null(dungeon.StandingOf(Standings.Own));
            for (int floor = 0; floor < dungeon.Tables.Count; floor++)
            {
                Assert.NotEmpty(dungeon.TableOf(floor, ally, RealmApp.Content.Mobs));
                Assert.NotEmpty(dungeon.TableOf(floor, enemy, RealmApp.Content.Mobs));
            }
        }
    }

    [Fact]
    public void A_standing_keeps_a_floors_mobs_of_its_tiers_and_else_draws_from_every_floors()
    {
        // The real keep: its first floor T2-T3, its second T3-T4.
        RealmContent content = RealmApp.Generated;
        RealmDungeon keep = content.Dungeons[Keep];
        int TierOf(string mob) => content.Mobs[mob].File.Tier;
        var low = new DungeonStanding { Tier = 3, MobTiers = [2, 2] };
        Assert.All(keep.TableOf(0, low, content.Mobs), mob => Assert.Equal(2, TierOf(mob)));
        Assert.Equal(keep.TableOf(0, low, content.Mobs), keep.TableOf(1, low, content.Mobs));
        Assert.Equal(keep.TableOf(1), keep.TableOf(1, null, content.Mobs));

        Assert.All(keep.TableOf(1, keep.StandingOf(Standings.Ally), content.Mobs), mob => Assert.InRange(TierOf(mob), 2, 3));
        Assert.All(keep.TableOf(0, keep.StandingOf(Standings.Enemy), content.Mobs), mob => Assert.InRange(TierOf(mob), 3, 4));
    }

    [Fact]
    public async Task An_ally_colors_dungeon_is_tier_3_with_tier_2_and_3_mobs_and_its_boss_as_written()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "U");
        for (int i = 0; i < 4; i++)
        {
            RunView run = await app.EnterRun(browser, Keep);
            Assert.Equal(3, run.Tier);
            Assert.All(run.Floors, floor => Assert.Equal(3, floor.Tier));
            Assert.All(run.Floors.SelectMany(floor => floor.Encounters), encounter => Assert.InRange(RealmApp.Content.Mobs[encounter.Mob].File.Tier, 2, 3));
            Assert.Null(run.Floors[^1].BossStats);
        }

        RunView last = await app.EnterRun(browser, Keep);
        Assert.Equal(Written().Life, await BossLife(app, browser, last));
    }

    [Fact]
    public async Task An_enemy_colors_dungeon_is_tier_4_with_tier_3_and_4_mobs_and_a_stronger_boss()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "B");
        DungeonStanding enemy = RealmApp.Content.Dungeons[Keep].StandingOf(Standings.Enemy)!;
        for (int i = 0; i < 4; i++)
        {
            RunView run = await app.EnterRun(browser, Keep);
            Assert.Equal(4, run.Tier);
            Assert.All(run.Floors.SelectMany(floor => floor.Encounters), encounter => Assert.InRange(RealmApp.Content.Mobs[encounter.Mob].File.Tier, 3, 4));
            Assert.Equal(enemy.BossStats, run.Floors[^1].BossStats);
            Assert.All(run.Floors.SkipLast(1), floor => Assert.Null(floor.BossStats));
        }

        RunView fought = await app.EnterRun(browser, Keep);
        EncounterView duel = await FightBoss(app, browser, fought);
        DuelSeat boss = duel.Duel.Seats[Duel.MobSeat - 1];
        GearStats written = Written();
        Assert.Equal(written + enemy.BossStats, new GearStats(boss.StartingLife, boss.StartingHandSize, boss.MaximumHandSize));

        // The run keeps its standing as it began: resumed, it says the same tier.
        Assert.Equal(4, (await browser.Ok<RunView>(HttpMethod.Get, "/api/dungeon/run")).Tier);
    }

    [Fact]
    public async Task The_characters_own_colors_dungeon_is_dealt_as_written()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        RealmDungeon keep = RealmApp.Content.Dungeons[Keep];
        RunView run = await app.EnterRun(browser, Keep);
        Assert.Equal(keep.File.Tier, run.Tier);
        Assert.All(run.Floors, floor => Assert.Null(floor.Tier));
        for (int floor = 0; floor < run.Floors.Count; floor++)
        {
            Assert.All(run.Floors[floor].Encounters, encounter => Assert.Contains(encounter.Mob, keep.TableOf(floor)));
        }

        Assert.Equal(Written().Life, await BossLife(app, browser, run));
    }

    [Fact]
    public async Task A_run_begun_before_standings_were_written_is_its_dungeons_tier()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "B");
        RunView run = await app.EnterRun(browser, Keep);
        await app.Store(db => db.Runs.Where(row => row.Id == run.Run).ExecuteUpdateAsync(set => set.SetProperty(row => row.Floors,
            System.Text.Json.JsonSerializer.Serialize(run.Floors.Select(floor => new { floor.Encounters, floor.Warden, floor.Boss }), (System.Text.Json.JsonSerializerOptions?)null))));
        RunView resumed = await browser.Ok<RunView>(HttpMethod.Get, "/api/dungeon/run");
        Assert.Equal(RealmApp.Content.Dungeons[Keep].File.Tier, resumed.Tier);
        Assert.Null(resumed.Floors[^1].BossStats);
    }

    private static async Task<EncounterView> FightBoss(RealmApp app, Browser browser, RunView run)
    {
        (int floor, int index) = RealmApp.BossOf(run);
        await app.ToFloor(run, floor);
        return await RealmApp.Fight(browser, run, floor, index, Lyra);
    }

    private static async Task<int> BossLife(RealmApp app, Browser browser, RunView run) =>
        (await FightBoss(app, browser, run)).Duel.Seats[Duel.MobSeat - 1].StartingLife;

    /// <summary>Lyra's stats as her file and her gear have them.</summary>
    private static GearStats Written()
    {
        Mob lyra = RealmApp.Content.Mobs[Lyra];
        return lyra.File.Gear.Aggregate(lyra.File.Stats, (stats, id) => stats + RealmApp.Content.Gear[id].Stats);
    }
}
