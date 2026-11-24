using System.Net;
using Cantrip.Client.Tactics;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Duels;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// Relics (design.md A3a): a drop only from the bosses their entries name, at most once per account ever, kept in the
/// collection and the ledger together, and never anted, sold or held twice in a deck; and the Phyrexian Portal (A6) they
/// drop in, sealed until all five colors are unlocked. The relic rolls are forced (<see cref="ForcedRolls"/>), never swept.
/// </summary>
public sealed class RelicTests
{
    private const string Portal = "phyrexian-portal";
    private const string Praetor = "phyrexian-praetor";

    private static IReadOnlyList<string> PraetorsRelics =>
        [.. RealmApp.Content.RelicsOf(RealmApp.Content.Mobs[Praetor]).Select(relic => relic.Card)];

    /// <summary>A white character who has unlocked the other four colors, in a run of the Portal on the praetor's floor.</summary>
    private static async Task<(Browser, RunView)> AtThePraetor(RealmApp app, ulong id)
    {
        Browser browser = await app.Character(id, "W");
        await Unlock(app, browser, "UBRG");
        return (browser, await PraetorRun(app, browser));
    }

    /// <summary>A new run of the Portal, on the praetor's floor.</summary>
    private static async Task<RunView> PraetorRun(RealmApp app, Browser browser)
    {
        RunView run = await app.EnterRun(browser, Portal);
        await app.ToFloor(run, RealmApp.BossOf(run).Floor);
        return run;
    }

    private static Task Unlock(RealmApp app, Browser browser, string colors) => app.Store(async db =>
    {
        foreach (char color in colors) db.Unlocks.Add(new UnlockRow { PlayerId = browser.Player, Color = color.ToString(), At = 0 });
        await db.SaveChangesAsync();
    });

    /// <summary>Fights the praetor and wins (the fake verifier's default).</summary>
    private static async Task<OutcomeView> BeatThePraetor((Browser Browser, RunView Run) at)
    {
        (int floor, int index) = RealmApp.BossOf(at.Run);
        EncounterView encounter = await RealmApp.Fight(at.Browser, at.Run, floor, index, Praetor);
        return await RealmApp.Finish(at.Browser, encounter.Token);
    }

    private static Task<List<string>> Ledger(RealmApp app, Browser browser) =>
        app.Store(db => db.Relics.Where(row => row.PlayerId == browser.Player).Select(row => row.Card).ToListAsync());

    [Fact]
    public void The_praetor_is_the_one_boss_the_power_nine_drop_from()
    {
        RealmContent content = RealmApp.Content;
        Assert.Equal(9, content.Relics.Count);
        Assert.All(content.Relics, relic => Assert.Equal([Praetor], relic.Bosses));
        Assert.Equal(content.Relics.Select(relic => relic.Card), PraetorsRelics);
        Assert.All(content.Mobs.Values.Where(mob => mob.Id != Praetor), mob => Assert.Empty(content.RelicsOf(mob)));
    }

    [Fact]
    public async Task A_relic_that_comes_up_goes_to_the_collection_and_the_ledger()
    {
        var rolls = new ForcedRolls(0);
        await using var app = new RealmApp { Random = rolls };
        (Browser browser, RunView browserRun) = await AtThePraetor(app, 1);

        OutcomeView won = await BeatThePraetor((browser, browserRun));
        Assert.Equal("won", won.Outcome);
        Assert.Equal(PraetorsRelics, won.Relics);

        // Apart from the offer and outside the cap: with an empty ante nothing is offered, and the relics drop all the same.
        Assert.Equal(0, won.Cap);
        Assert.Empty(won.Offer);
        IReadOnlyDictionary<string, int> collection = await browser.Collection();
        Assert.All(PraetorsRelics, relic => Assert.Equal(1, collection.GetValueOrDefault(relic)));
        Assert.Equal(PraetorsRelics.Order(StringComparer.Ordinal), (await Ledger(app, browser)).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task The_collection_names_the_relics_it_holds_for_the_spell_table_to_mark()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        Assert.Empty((await browser.Ok<CollectionView>(HttpMethod.Get, "/api/collection")).Relics!);
        await app.Give(browser, "Black Lotus", 1);
        await app.Give(browser, "Llanowar Elves", 2);
        CollectionView collection = await browser.Ok<CollectionView>(HttpMethod.Get, "/api/collection");
        Assert.Equal(["Black Lotus"], collection.Relics!);
        Assert.Equal(1, collection.Cards["Black Lotus"]);
    }

    [Fact]
    public async Task A_relic_that_does_not_come_up_drops_nothing()
    {
        await using var app = new RealmApp { Random = new ForcedRolls(1) };
        (Browser browser, RunView browserRun) = await AtThePraetor(app, 1);

        OutcomeView won = await BeatThePraetor((browser, browserRun));
        Assert.Equal("won", won.Outcome);
        Assert.Empty(won.Relics);
        IReadOnlyDictionary<string, int> collection = await browser.Collection();
        Assert.All(PraetorsRelics, relic => Assert.False(collection.ContainsKey(relic), relic));
        Assert.Empty(await Ledger(app, browser));
    }

    [Fact]
    public async Task A_relic_never_drops_twice_for_an_account_even_once_the_card_is_gone_and_others_still_get_theirs()
    {
        await using var app = new RealmApp { Random = new ForcedRolls(0) };
        (Browser first, RunView firstRun) = await AtThePraetor(app, 1);
        Assert.Equal(PraetorsRelics, (await BeatThePraetor((first, firstRun))).Relics);

        // The cards leave the collection; the ledger keeps them.
        await app.Store(async db =>
        {
            await db.Collection.Where(row => row.PlayerId == first.Player && PraetorsRelics.Contains(row.Name)).ExecuteDeleteAsync();
        });

        // The praetor is back a week later, and every roll would come up: none of the relics drops again.
        app.Time.Advance(TimeSpan.FromDays(7));
        OutcomeView again = await BeatThePraetor((first, await PraetorRun(app, first)));
        Assert.Equal("won", again.Outcome);
        Assert.Empty(again.Relics);
        IReadOnlyDictionary<string, int> collection = await first.Collection();
        Assert.All(PraetorsRelics, relic => Assert.False(collection.ContainsKey(relic), relic));
        Assert.Equal(PraetorsRelics.Count, (await Ledger(app, first)).Count);

        // Another account's ledger is its own.
        (Browser second, RunView secondRun) = await AtThePraetor(app, 2);
        Assert.Equal(PraetorsRelics, (await BeatThePraetor((second, secondRun))).Relics);
        Assert.Equal(PraetorsRelics.Count, (await Ledger(app, second)).Count);
    }

    [Fact]
    public async Task Only_a_relics_own_ledger_entries_are_skipped()
    {
        await using var app = new RealmApp { Random = new ForcedRolls(0) };
        (Browser browser, RunView browserRun) = await AtThePraetor(app, 1);
        await app.Store(async db =>
        {
            db.Relics.Add(new RelicRow { PlayerId = browser.Player, Card = "Black Lotus", At = 0, Duel = "earlier" });
            await db.SaveChangesAsync();
        });

        OutcomeView won = await BeatThePraetor((browser, browserRun));
        Assert.Equal(PraetorsRelics.Where(relic => relic != "Black Lotus"), won.Relics);
        Assert.False((await browser.Collection()).ContainsKey("Black Lotus"));
    }

    [Fact]
    public async Task No_mob_but_a_relics_boss_drops_one()
    {
        await using var app = new RealmApp { Random = new ForcedRolls(0) };
        Browser browser = await app.Character(1, "W");
        MapSpawn spawn = RealmApp.SpawnOf(4);
        await browser.Put(RealmContent.WorldSpace, spawn.At);
        long epoch = Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds);
        string mob = Spawns.MobOf(browser.Player, RealmContent.WorldSpace, spawn.Id, epoch, spawn.Mobs);

        EncounterView encounter = await browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = spawn.Id, Mob = mob });
        OutcomeView won = await browser.Ok<OutcomeView>(HttpMethod.Post, "/api/encounter/finish", new { Token = encounter.Token, Log = new[] { "AA==" } });
        Assert.Equal("won", won.Outcome);
        Assert.Empty(won.Relics);
        Assert.Empty(await Ledger(app, browser));
    }

    [Fact]
    public async Task A_relic_is_never_anted_and_never_sold()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        await app.Give(browser, "Black Lotus", 1);

        await browser.ToSpellTable();
        DeckView deck = await browser.Deck();
        ApiError anted = await browser.Refused(
            HttpMethod.Put, "/api/deck", new { Main = deck.Main, Ante = new[] { new CardCount("Black Lotus", 1) } }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains("Black Lotus is a relic, which is never lost: it can't be anted.", anted.Problems!);

        // In the deck, one copy is fine.
        List<CardCount> main = [.. deck.Main.Where(card => card.Name != "Plains"), new("Plains", deck.Main.Single(card => card.Name == "Plains").Count - 1), new("Black Lotus", 1)];
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = main, Ante = Array.Empty<CardCount>() });

        // No vendor buys one: not even the curio dealer, nor one whose trade it would otherwise be.
        await app.Give(browser, "Black Lotus", 1);
        foreach (string vendor in new[] { "argive-curio-dealer", "argive-artificer" })
        {
            await browser.Inside(vendor + "-shop");
            await browser.Refused(HttpMethod.Post, $"/api/vendor/{vendor}/sell", new { Name = "Black Lotus" }, HttpStatusCode.Conflict, Codes.Relic);
        }

        Assert.Equal(2, (await browser.Collection())["Black Lotus"]);
    }

    [Fact]
    public void A_deck_holds_one_copy_of_a_relic_restricted_or_not()
    {
        // The Power 9 are all restricted in Vintage; a relic the owner adds need not be, and is held to one all the same.
        CardPool cards = RealmApp.Content.Cards;
        var withBolt = new CardPool(cards.Catalog, cards.Prices, new Dictionary<string, IReadOnlyList<string>>(), new HashSet<string>(["Lightning Bolt"], StringComparer.Ordinal));
        List<string> problems = DeckChecks.Problems(withBolt, [new("Lightning Bolt", 2), new("Mountain", 38)], identity: null);
        Assert.Equal(["Lightning Bolt is a relic: one copy at most, not 2."], problems);
        Assert.Empty(DeckChecks.Problems(withBolt, [new("Lightning Bolt", 1), new("Mountain", 39)], identity: null));
        Assert.Contains("Black Lotus is restricted in Vintage: one copy at most, not 2.", DeckChecks.Problems(cards, [new("Black Lotus", 2), new("Mountain", 38)], identity: null));
    }

    [Fact]
    public async Task The_portal_is_sealed_until_all_five_colors_are_unlocked()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        Tile gate = RealmApp.Content.Dungeons[Portal].File.At;
        Tile outside = RealmApp.Beside(RealmContent.WorldSpace, gate);
        await browser.Put(RealmContent.WorldSpace, outside);

        // Its gate stays shut: no run, and no stepping onto it.
        await browser.Refused(HttpMethod.Post, "/api/dungeon/enter", new { Dungeon = Portal }, HttpStatusCode.Conflict, Codes.Locked);
        await browser.Refused(HttpMethod.Post, "/api/position", new { Space = RealmContent.WorldSpace, gate.X, gate.Z }, HttpStatusCode.Conflict, Codes.Locked);
        await Unlock(app, browser, "UBR");
        await browser.Refused(HttpMethod.Post, "/api/dungeon/enter", new { Dungeon = Portal }, HttpStatusCode.Conflict, Codes.Locked);
        CharacterView me = await browser.Me();
        Assert.Equal((RealmContent.WorldSpace, outside), (me.Space, new Tile(me.X, me.Z)));
        Assert.Empty(await app.Store(db => db.Runs.ToListAsync()));

        await Unlock(app, browser, "G");
        Assert.Equal("WUBRG", (await browser.Me()).Identity);
        await browser.Position(RealmContent.WorldSpace, gate);
        RunView run = await browser.Ok<RunView>(HttpMethod.Post, "/api/dungeon/enter", new { Dungeon = Portal });

        // Four floors of the Portal's Phyrexians, its warden at every stair, the praetor on the last.
        Assert.Equal(4, run.Floors.Count);
        Assert.All(run.Floors.SkipLast(1), floor => Assert.Equal(("portal-warden", (string?)null), (floor.Warden, floor.Boss)));
        Assert.Equal(((string?)null, (string?)Praetor), (run.Floors[^1].Warden, run.Floors[^1].Boss));
        Assert.All(run.Floors.SelectMany(floor => floor.Encounters), encounter => Assert.Equal(4, RealmApp.Content.Mobs[encounter.Mob].File.Tier));
        Assert.DoesNotContain(run.Floors[0].Encounters, encounter => encounter.Mob == "gitaxian-mindcutter");
    }
}

/// <summary>The capstone's praetor on the native engine: its five-color deck and its gear's stats deal and play out.</summary>
[Trait("Category", "WallClock")]
public sealed class PraetorDuelTests
{
    [Fact]
    public void A_whole_duel_against_the_praetor_plays_out_and_verifies()
    {
        RealmContent content = RealmApp.Content;
        Mob praetor = content.Mobs["phyrexian-praetor"];
        GearStats stats = praetor.File.Gear.Select(id => content.Gear[id].Stats).Aggregate(praetor.File.Stats, (sum, item) => sum + item);
        DuelSeat Seat(string name, IEnumerable<string> deck, GearStats with) =>
            new(name, [.. deck], [], null, [], with.Life, with.Hand, with.MaxHand, []);
        var duel = new Duel(
            [
                Seat("Tester", content.Starters["dominaria"]["W"].Entries.SelectMany(entry => Enumerable.Repeat(entry.Card, entry.Copies)), Characters.BaseStats),
                Seat(praetor.File.Name, praetor.Deck.Entries.SelectMany(entry => Enumerable.Repeat(entry.Card, entry.Copies)), stats),
            ],
            Duel.RealmMinimumDeckSize,
            20261123,
            new DuelMob(praetor.File.Name, 0, praetor.File.Prize),
            0,
            0);

        (List<string> log, IReadOnlyList<int> winners) = NativeVerifierTests.Play(duel, new TacticalPlay(), RealmBot.Create(duel.Seed));
        DuelVerdict verdict = new NativeDuelVerifier().Verify(duel, log);
        Assert.True(verdict.Accepted, verdict.Problem);
        Assert.Equal(winners, verdict.Winners);
    }
}
