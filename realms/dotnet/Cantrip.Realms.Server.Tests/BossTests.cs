using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// The color bosses (design.md A6): a win unlocks the boss's color - which the deck checks take at once - gives a rare or
/// mythic of its loot outright, and drops its own unique item the first time; a beaten boss rests a week,
/// its hall empty meanwhile. A live run is resumed as it was left, and the first floor's spell table (the antechamber's)
/// saves the deck there.
/// </summary>
public sealed class BossTests
{
    private const string World = RealmContent.WorldSpace;
    private const string Hollow = "elfhame-hollow";
    private const string Rofellos = "rofellos";

    /// <summary>A run of the elfhames' hollow on its last floor, where Rofellos waits.</summary>
    private static async Task<RunView> AtRofellos(RealmApp app, Browser browser)
    {
        RunView run = await app.EnterRun(browser, Hollow);
        await app.ToFloor(run, RealmApp.BossOf(run).Floor);
        return run;
    }

    /// <summary>Fights the boss of a run on its last floor and wins (the fake verifier's default).</summary>
    private static async Task<OutcomeView> BeatTheBoss(Browser browser, RunView run, string boss)
    {
        (int floor, int index) = RealmApp.BossOf(run);
        EncounterView encounter = await RealmApp.Fight(browser, run, floor, index, boss);
        return await RealmApp.Finish(browser, encounter.Token);
    }

    [Fact]
    public void Every_color_boss_has_a_unique_item_of_its_own_and_rares_to_give()
    {
        RealmContent content = RealmApp.Content;
        List<Mob> bosses = [.. content.Mobs.Values.Where(mob => mob.File.Boss)];
        Assert.Equal(6, bosses.Count);
        Assert.All(bosses, boss =>
        {
            Assert.NotNull(boss.File.Unique);
            Assert.True(content.Gear[boss.File.Unique!].Unique, boss.Id);
            Assert.NotEmpty(content.GiftsOf(boss));
            Assert.All(content.GiftsOf(boss), card => Assert.Contains(content.Cards.Prices[card].Rarity, RealmContent.GiftRarities));
        });
        Assert.Equal(bosses.Count, bosses.Select(boss => boss.File.Unique).Distinct().Count());
        Assert.Equal("GWUBR".Order().Select(c => c.ToString()), bosses.Select(boss => boss.File.Unlocks).OfType<string>().Order());
        Assert.All(content.Mobs.Values.Where(mob => !mob.File.Boss), mob => Assert.Empty(content.GiftsOf(mob)));
    }

    [Fact]
    public async Task Beating_a_color_boss_unlocks_its_color_gives_a_rare_and_drops_its_unique()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        await app.Give(browser, "Llanowar Elves", 4);
        DeckChange green = new([new CardCount("Forest", 36), new CardCount("Llanowar Elves", 4)], []);
        CheckOf(await browser.Ok<DeckCheckView>(HttpMethod.Post, "/api/deck/check", green), "Llanowar Elves is outside the color identity W.");

        RunView run = await AtRofellos(app, browser);
        OutcomeView won = await BeatTheBoss(browser, run, Rofellos);
        Assert.Equal(("won", "G"), (won.Outcome, won.Unlocked));

        // The gift is a rare or mythic of its loot, in the collection already.
        Assert.NotNull(won.Gift);
        Assert.Contains(won.Gift, RealmApp.Content.GiftsOf(RealmApp.Content.Mobs[Rofellos]));
        Assert.True((await browser.Collection()).GetValueOrDefault(won.Gift!) >= 1);

        // Its own unique item, owned now.
        Assert.Equal("rofellos-emissary-torc", won.Gear?.Gear.Id);
        CharacterView me = await browser.Me();
        Assert.Contains(me.Gear, owned => owned.Gear.Id == "rofellos-emissary-torc");
        Assert.Equal("WG", me.Identity);
        Assert.Equal(["G"], me.Unlocked);

        // Green cards and Forests are within the identity now, wherever the deck is judged.
        Assert.Empty((await browser.Ok<DeckCheckView>(HttpMethod.Post, "/api/deck/check", green)).Problems);
        await browser.ToSpellTable();
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", green);
    }

    private static void CheckOf(DeckCheckView check, string problem) => Assert.Contains(problem, check.Problems);

    [Fact]
    public async Task A_beaten_boss_rests_a_week_its_hall_empty_then_is_back_for_loot_without_a_second_unique()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        RunView first = await AtRofellos(app, browser);
        DateTimeOffset won = app.Time.GetUtcNow();
        Assert.Equal("G", (await BeatTheBoss(browser, first, Rofellos)).Unlocked);
        await browser.Ok<object>(HttpMethod.Post, "/api/dungeon/leave", new { first.Run });

        // Within the week: the last floor holds no boss, the run says when it is back, and its fight is no encounter.
        app.Time.Advance(TimeSpan.FromDays(6));
        RunView resting = await AtRofellos(app, browser);
        Assert.Null(resting.Floors[^1].Boss);
        Assert.Equal(new RestingView(Rofellos, won + Dungeons.BossRest), resting.Resting);
        (int floor, int index) = RealmApp.BossOf(resting);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { resting.Run, Floor = floor, Index = index, Mob = Rofellos }, HttpStatusCode.NotFound, Codes.NotThere);
        await browser.Ok<object>(HttpMethod.Post, "/api/dungeon/leave", new { resting.Run });

        // A week on he is back; beaten again he unlocks nothing new and drops a rare or mythic item, never his unique twice.
        app.Time.Advance(TimeSpan.FromDays(1));
        RunView back = await AtRofellos(app, browser);
        Assert.Equal((Rofellos, (RestingView?)null), (back.Floors[^1].Boss, back.Resting));
        OutcomeView again = await BeatTheBoss(browser, back, Rofellos);
        Assert.Equal(("won", (string?)null), (again.Outcome, again.Unlocked));
        Assert.NotNull(again.Gift);
        Assert.NotNull(again.Gear);
        Assert.False(again.Gear!.Gear.Unique);
        Assert.Contains(again.Gear.Gear.Rarity, new[] { "rare", "mythic" });
        Assert.Single((await browser.Me()).Gear, owned => owned.Gear.Id == "rofellos-emissary-torc");
    }

    [Fact]
    public async Task A_mage_never_rests_and_a_tower_is_refought_at_once()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        RunView run = await app.EnterRun(browser, "benalia-1");
        await app.ToFloor(run, RealmApp.BossOf(run).Floor);
        OutcomeView won = await BeatTheBoss(browser, run, "mage-benalia-1");
        Assert.Equal(("won", (string?)null, (string?)null), (won.Outcome, won.Unlocked, won.Gift));
        await browser.Ok<object>(HttpMethod.Post, "/api/dungeon/leave", new { run.Run });

        RunView again = await app.EnterRun(browser, "benalia-1");
        Assert.Equal(("mage-benalia-1", (RestingView?)null), (again.Floors[^1].Boss, again.Resting));
    }

    [Fact]
    public async Task A_live_run_is_resumed_on_the_floor_reached_with_its_wins()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        await browser.Refused(HttpMethod.Get, "/api/dungeon/run", null, HttpStatusCode.NotFound, Codes.NotThere);

        RunView run = await app.EnterRun(browser, "benalish-keep");
        RunView fresh = await browser.Ok<RunView>(HttpMethod.Get, "/api/dungeon/run");
        Assert.Equal((run.Run, run.Seed, "benalish-keep", 0), (fresh.Run, fresh.Seed, fresh.Dungeon, fresh.Floor));
        Assert.Empty(fresh.Beaten!);
        Assert.Equal(run.Floors.Count, fresh.Floors.Count);

        RunEncounter one = run.Floors[0].Encounters[0];
        RunEncounter two = run.Floors[0].Encounters[1];
        await RealmApp.Finish(browser, (await RealmApp.Fight(browser, run, 0, one.Index, one.Mob)).Token);
        await RealmApp.Finish(browser, (await RealmApp.Fight(browser, run, 0, two.Index, two.Mob)).Token);
        await browser.Ok<object>(HttpMethod.Post, "/api/dungeon/floor", new { run.Run, Floor = 1 });

        RunView resumed = await browser.Ok<RunView>(HttpMethod.Get, "/api/dungeon/run");
        Assert.Equal(1, resumed.Floor);
        Assert.Equal([$"0:{one.Index}", $"0:{two.Index}"], resumed.Beaten!.Order(StringComparer.Ordinal));
        Assert.Null(resumed.Resting);

        await browser.Ok<object>(HttpMethod.Post, "/api/dungeon/leave", new { run.Run });
        await browser.Refused(HttpMethod.Get, "/api/dungeon/run", null, HttpStatusCode.NotFound, Codes.NotThere);
    }

    [Fact]
    public async Task The_antechambers_spell_table_saves_the_deck_on_the_first_floor_alone()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        DeckView deck = await browser.Deck();
        var change = new DeckChange(deck.Main, []);

        // Out in the world, away from any table: no.
        await browser.Put(World, RealmApp.Inn("new-benalia").At);
        await browser.Refused(HttpMethod.Put, "/api/deck", change, HttpStatusCode.Conflict, Codes.NotAtTable);

        // In a run's first floor, the antechamber: yes; a floor down: no.
        RunView run = await app.EnterRun(browser, "benalish-keep");
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", change);
        await app.ToFloor(run, 1);
        await browser.Refused(HttpMethod.Put, "/api/deck", change, HttpStatusCode.Conflict, Codes.NotAtTable);

        // Another's run is nobody's antechamber but theirs.
        Browser other = await app.Character(2, "W");
        await other.Put(RealmContent.RunSpace(run.Run), new Tile(0, 0));
        await app.ToFloor(run, 0);
        await other.Refused(HttpMethod.Put, "/api/deck", new DeckChange((await other.Deck()).Main, []), HttpStatusCode.Conflict, Codes.NotAtTable);
        Assert.Equal(RunRow.Live, await app.Store(db => db.Runs.Where(row => row.Id == run.Run).Select(row => row.State).SingleAsync()));
    }
}
