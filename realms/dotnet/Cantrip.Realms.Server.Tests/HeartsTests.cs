using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Duels;
using Cantrip.Realms.Server.Economy;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// Hearts (design.md A3b) and what a lost game comes to (A3): a heart lost and nothing won; with hearts left a world mob's
/// buyout or a rematch, a dungeon's rematch alone; the last heart lost, death - home, hearts full, a run's winnings taken
/// back. Towns fill the hearts, healers sell more, and the old ante is gone from the store.
/// </summary>
public sealed class HeartsTests
{
    private const string World = RealmContent.WorldSpace;

    /// <summary>A tier 1 spawn near New Benalia.</summary>
    private static readonly MapSpawn Spawn = RealmApp.SpawnOf(1);

    /// <summary>A verdict of the mob's win, the mob ending the game at <paramref name="mobLife"/>.</summary>
    private static DuelVerdict MobWonAt(int mobLife) => new(true, [Duel.MobSeat], null, new Dictionary<int, int> { [Duel.PlayerSeat] = 0, [Duel.MobSeat] = mobLife });

    /// <summary>A white character standing at the tier 1 spawn.</summary>
    private static async Task<Browser> AtSpawn(RealmApp app, ulong id = 1)
    {
        Browser browser = await app.Character(id, "W");
        await browser.Put(World, Spawn.At);
        return browser;
    }

    /// <summary>Starts a duel with the spawn's mob now, and its mob's id.</summary>
    private static async Task<(EncounterView Duel, string Mob)> Engage(RealmApp app, Browser browser)
    {
        string mob = Spawns.MobOf(browser.Player, World, Spawn.Id, Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), Spawn.RespawnSeconds), Spawn.Mobs);
        return (await browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = Spawn.Id, Mob = mob }), mob);
    }

    private static Task<EncounterView> Rematch(Browser browser, DefeatView defeat, bool playFirst = true, IEnumerable<CardCount>? main = null, IEnumerable<CardCount>? sideboard = null) =>
        browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/rematch", new { defeat.Token, Main = main ?? defeat.Main, Sideboard = sideboard ?? defeat.Sideboard, PlayFirst = playFirst });

    [Fact]
    public void A_buyout_is_the_tiers_base_in_the_share_of_life_the_mob_kept()
    {
        // Flawless: the whole base. At 1 life of 20, a twentieth of it. Above where it began, still the whole.
        Assert.Equal(Encounters.BuyoutBase[4], Encounters.Buyout(4, 20, 20));
        Assert.Equal(60, Encounters.Buyout(4, 1, 20));
        Assert.Equal(Encounters.BuyoutBase[4], Encounters.Buyout(4, 31, 20));
        Assert.Equal(Encounters.BuyoutBase[2] / 2, Encounters.Buyout(2, 10, 20));

        // Rounded, and never less than 1 gold, however low the mob went (a draw may leave it at 0 or below).
        Assert.Equal(2, Encounters.Buyout(1, 1, 20));
        Assert.Equal(1, Encounters.Buyout(1, 0, 20));
        Assert.Equal(1, Encounters.Buyout(1, -3, 20));

        // Cheap at tier 1 beside what a tier 1 win pays (20 to 60 gold); dear at tier 4.
        Assert.True(Encounters.BuyoutBase[1] < 60);
        Assert.True(Encounters.BuyoutBase[4] > 600);
        Assert.True(Encounters.BuyoutBase.Values.Order().SequenceEqual(Encounters.BuyoutBase.OrderBy(pair => pair.Key).Select(pair => pair.Value)));
    }

    [Fact]
    public async Task A_lost_game_costs_a_heart_and_the_mob_asks_its_buyout_from_the_checked_log()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (duel, _) => MobWonAt(1);
        Browser browser = await AtSpawn(app);
        (EncounterView encounter, string mob) = await Engage(app, browser);
        int full = encounter.Duel.Seats[1].StartingLife;

        OutcomeView lost = await RealmApp.Finish(browser, encounter.Token);
        Assert.Equal(("lost", 0L, 1, false), (lost.Outcome, lost.Gold, lost.Hearts, lost.Died));
        DefeatView defeat = lost.Defeat!;
        Assert.Equal((encounter.Token, mob, 1, 1, 2), (defeat.Token, defeat.Mob, defeat.Game, defeat.Hearts, defeat.MaxHearts));
        Assert.Equal((1, full), (defeat.MobLife, defeat.MobFullLife));
        Assert.Equal(Encounters.Buyout(RealmApp.Content.Mobs[mob].File.Tier, 1, full), defeat.Price);
        Assert.Equal(40, defeat.Main.Sum(card => card.Count));

        // Pending, it comes back with the character (a page reloaded), and no other encounter starts meanwhile.
        Assert.Equivalent(defeat, (await browser.Me()).Defeat);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn = RealmApp.SpawnOf(2).Id, Mob = RealmApp.SpawnOf(2).Mobs[0] }, HttpStatusCode.Conflict, Codes.Defeated);
    }

    [Fact]
    public async Task Paying_the_buyout_ends_the_encounter_with_nothing_won_and_the_mob_dealt_with()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (_, _) => FakeVerifier.MobWon;
        Browser browser = await AtSpawn(app);
        (EncounterView encounter, string mob) = await Engage(app, browser);
        DefeatView defeat = (await RealmApp.Finish(browser, encounter.Token)).Defeat!;
        Assert.Equal(Encounters.BuyoutBase[1], defeat.Price);

        // Without the gold, the offer can't be taken, and stands.
        await app.Store(db => db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, 1)));
        await browser.Refused(HttpMethod.Post, "/api/encounter/pay", new { defeat.Token }, HttpStatusCode.Conflict, Codes.CannotAfford);
        Assert.NotNull((await browser.Me()).Defeat);

        await app.Store(db => db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, 500)));
        PaidView paid = await browser.Ok<PaidView>(HttpMethod.Post, "/api/encounter/pay", new { defeat.Token });
        Assert.Equal(500 - defeat.Price!.Value, paid.Gold);
        CharacterView me = await browser.Me();
        Assert.Null(me.Defeat);
        Assert.Equal((paid.Gold, 1), (me.Gold, me.Hearts));
        Assert.Equal(DuelRow.Paid, await app.Store(db => db.Duels.Where(row => row.Token == defeat.Token).Select(row => row.State).SingleAsync()));

        // Once: paid, it is over; and the mob is dealt with this epoch.
        await browser.Refused(HttpMethod.Post, "/api/encounter/pay", new { defeat.Token }, HttpStatusCode.Conflict, Codes.Finished);
        await browser.Refused(HttpMethod.Post, "/api/encounter/rematch", new { defeat.Token, defeat.Main, defeat.Sideboard }, HttpStatusCode.Conflict, Codes.Finished);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn = Spawn.Id, Mob = mob }, HttpStatusCode.Conflict, Codes.TooSoon);
    }

    [Fact]
    public async Task A_rematch_deals_the_player_at_full_life_and_the_mob_at_the_life_it_ended_with()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (_, _) => MobWonAt(7);
        Browser browser = await AtSpawn(app);
        CharacterView me = await browser.Me();
        (EncounterView first, string mob) = await Engage(app, browser);
        DefeatView defeat = (await RealmApp.Finish(browser, first.Token)).Defeat!;

        EncounterView second = await Rematch(browser, defeat, playFirst: false);
        Duel duel = second.Duel;
        Assert.NotEqual(first.Token, second.Token);
        Assert.Equal((2, (int?)Duel.MobSeat), (duel.Game, duel.FirstPlayer));
        Assert.Equal(me.Stats.Life, duel.Seats[0].StartingLife);
        Assert.Equal(7, duel.Seats[1].StartingLife);
        Assert.Equivalent(first.Duel.Seats[1] with { StartingLife = 7 }, duel.Seats[1]);
        Assert.Equal(first.Duel.Mob, duel.Mob);
        Assert.Null(first.Duel.FirstPlayer);

        // The second game lost too: another heart - the last - and the character dies.
        app.Verifier.Answer = (_, _) => MobWonAt(3);
        OutcomeView died = await RealmApp.Finish(browser, second.Token);
        Assert.True(died.Died);
        Assert.Null(died.Defeat);

        // And committed so: the verifier was asked about the duel the rematch dealt.
        Assert.Equivalent(duel, app.Verifier.Checked[^1].Duel);
        Assert.Equal(RealmApp.Content.Mobs[mob].File.Name, duel.Mob.Name);
    }

    [Fact]
    public async Task A_rematch_carries_the_mobs_life_as_it_is_and_measures_its_buyout_by_its_full_life()
    {
        await using var app = new RealmApp();
        Browser browser = await AtSpawn(app);
        await app.SetHearts(browser, 3, 3);
        (EncounterView first, string mob) = await Engage(app, browser);
        int full = first.Duel.Seats[1].StartingLife;
        int tier = RealmApp.Content.Mobs[mob].File.Tier;

        // It gained life: carried as it is, not capped - only the buyout is.
        app.Verifier.Answer = (_, _) => MobWonAt(full + 5);
        DefeatView defeat = (await RealmApp.Finish(browser, first.Token)).Defeat!;
        Assert.Equal(Encounters.BuyoutBase[tier], defeat.Price);
        EncounterView second = await Rematch(browser, defeat);
        Assert.Equal((full + 5, (int?)Duel.PlayerSeat), (second.Duel.Seats[1].StartingLife, second.Duel.FirstPlayer));

        // Worn down in the next, it is measured against its full life still, not the life it began that game with.
        app.Verifier.Answer = (_, _) => MobWonAt(2);
        DefeatView again = (await RealmApp.Finish(browser, second.Token)).Defeat!;
        Assert.Equal((2, 2, full, 1), (again.Game, again.MobLife, again.MobFullLife, again.Hearts));
        Assert.Equal(Encounters.Buyout(tier, 2, full), again.Price);

        // A rematch won is a win like any: its gold.
        app.Verifier.Answer = (_, _) => new DuelVerdict(true, [Duel.PlayerSeat], null);
        EncounterView third = await Rematch(browser, again);
        Assert.Equal((3, 2), (third.Duel.Game, third.Duel.Seats[1].StartingLife));
        OutcomeView won = await RealmApp.Finish(browser, third.Token);
        Assert.Equal("won", won.Outcome);
        Assert.True(won.Gold > 0);
        Assert.Null((await browser.Me()).Defeat);
    }

    [Fact]
    public async Task A_rematch_swaps_cards_between_the_deck_and_the_sideboard_for_the_encounter_alone()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (_, _) => FakeVerifier.MobWon;
        Browser browser = await app.Character(1, "W");
        await app.Give(browser, "Serra Angel", 2);
        await app.Give(browser, "Goblin King", 1);
        await browser.ToSpellTable();
        DeckView saved = await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { (await browser.Deck()).Main, Sideboard = new[] { new CardCount("Serra Angel", 2) } });
        await browser.Put(World, Spawn.At);
        (EncounterView first, _) = await Engage(app, browser);
        Assert.Equal(["Serra Angel", "Serra Angel"], first.Duel.Seats[0].Sideboard);
        DefeatView defeat = (await RealmApp.Finish(browser, first.Token)).Defeat!;
        Assert.Equal([new CardCount("Serra Angel", 2)], defeat.Sideboard);

        // Two Angels in for two cards of the deck: a swap, and dealt so.
        List<CardCount> main = [.. defeat.Main];
        CardCount out1 = main.First(card => card.Name != "Plains");
        main = [.. main.Select(card => card.Name == out1.Name ? card with { Count = card.Count - 1 } : card).Where(card => card.Count > 0), new CardCount("Serra Angel", 2)];
        main = [.. main.Select(card => card.Name == "Plains" ? card with { Count = card.Count - 1 } : card)];
        List<CardCount> side = [new CardCount(out1.Name, 1)];

        // A card from neither, a card outside the identity, a deck under forty or a sideboard over fifteen is no swap.
        ApiError added = await browser.Refused(HttpMethod.Post, "/api/encounter/rematch", new { defeat.Token, Main = main, Sideboard = side.Append(new CardCount("Goblin King", 1)), PlayFirst = true }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains("Goblin King is outside the color identity W.", added.Problems!);
        Assert.Contains(added.Problems!, problem => problem.StartsWith("Goblin King was in neither the deck nor the sideboard", StringComparison.Ordinal));
        ApiError small = await browser.Refused(HttpMethod.Post, "/api/encounter/rematch", new { defeat.Token, Main = main.Where(card => card.Name != "Plains"), Sideboard = side, PlayFirst = true }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains(small.Problems!, problem => problem.StartsWith("A deck is at least 40 cards", StringComparison.Ordinal));
        ApiError big = await browser.Refused(HttpMethod.Post, "/api/encounter/rematch", new { defeat.Token, Main = main, Sideboard = side.Append(new CardCount("Plains", 15)), PlayFirst = true }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains("A sideboard is at most 15 cards: this one is 16.", big.Problems!);

        EncounterView second = await Rematch(browser, defeat, main: main, sideboard: side);
        Assert.Equal(2, second.Duel.Seats[0].Deck.Count(card => card == "Serra Angel"));
        Assert.Equal([out1.Name], second.Duel.Seats[0].Sideboard);
        Assert.Equal(40, second.Duel.Seats[0].Deck.Count);

        // The saved deck is as it was: a match's swaps revert after it.
        DeckView after = await browser.Deck();
        Assert.Equal(saved.Main, after.Main);
        Assert.Equal(saved.Sideboard, after.Sideboard);
    }

    [Fact]
    public async Task A_dungeons_mob_is_never_bought_off_only_fought_again()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (_, _) => MobWonAt(4);
        Browser browser = await app.Character(1);
        RunView run = await app.EnterRun(browser, "hurloon-caves");
        RunEncounter one = run.Floors[0].Encounters[0];
        EncounterView duel = await RealmApp.Fight(browser, run, 0, one.Index, one.Mob);
        OutcomeView lost = await RealmApp.Finish(browser, duel.Token);
        Assert.Null(lost.Defeat!.Price);
        await browser.Refused(HttpMethod.Post, "/api/encounter/pay", new { lost.Defeat.Token }, HttpStatusCode.Conflict, Codes.NoBuyout);

        // The run goes on, the character in it; the next game is the same encounter's.
        CharacterView me = await browser.Me();
        Assert.Equal(RealmContent.RunSpace(run.Run), me.Space);
        Assert.Equal(RunRow.Live, await app.Store(db => db.Runs.Where(row => row.Id == run.Run).Select(row => row.State).SingleAsync()));
        EncounterView again = await Rematch(browser, lost.Defeat);
        Assert.Equal(4, again.Duel.Seats[1].StartingLife);
        app.Verifier.Answer = (_, _) => new DuelVerdict(true, [Duel.PlayerSeat], null);
        Assert.Equal("won", (await RealmApp.Finish(browser, again.Token)).Outcome);
        RunView current = await browser.Ok<RunView>(HttpMethod.Get, "/api/dungeon/run");
        Assert.Contains(Dungeons.EncounterId(0, one.Index), current.Beaten!);
    }

    [Fact]
    public async Task The_last_heart_lost_sends_the_character_home_with_their_hearts_full()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (_, _) => FakeVerifier.MobWon;
        Browser browser = await AtSpawn(app);
        IReadOnlyDictionary<string, int> cards = await browser.Collection();
        long gold = (await browser.Me()).Gold;
        await app.SetHearts(browser, 1, 3);

        (EncounterView encounter, _) = await Engage(app, browser);
        OutcomeView died = await RealmApp.Finish(browser, encounter.Token);
        Assert.True(died.Died);
        Assert.Equal(3, died.Hearts);
        Assert.Null(died.Forfeit);

        // Home - the inn - with nothing else lost outside a dungeon.
        CharacterView me = await browser.Me();
        Assert.Equal((World, RealmApp.Inn("new-benalia").At), (me.Space, new Tile(me.X, me.Z)));
        Assert.Equal((3, 3, gold), (me.Hearts, me.MaxHearts, me.Gold));
        Assert.Null(me.Defeat);
        Assert.Equal(cards, await browser.Collection());
    }

    [Fact]
    public async Task Dying_in_a_dungeon_ends_the_run_and_takes_back_what_it_won()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await browser.Ok<object>(HttpMethod.Post, "/dev/drop", new { Gear = true });
        long gold = (await browser.Me()).Gold;
        IReadOnlyDictionary<string, int> cards = await browser.Collection();
        int gear = (await browser.Me()).Gear.Count;

        // A challenger of the first round beaten - gold, a gear drop - and the boss in its hall - gold, its gift, its unique
        // item; then (the run set back on its first round, as a test arranges it) another challenger lost with the last heart.
        RunView run = await app.EnterRun(browser, "elfhame-hollow");
        RunEncounter first = run.Floors[0].Encounters[0];
        OutcomeView other = await RealmApp.Finish(browser, (await RealmApp.Fight(browser, run, 0, first.Index, first.Mob)).Token);
        Assert.Equal("won", other.Outcome);
        Assert.NotNull(other.Gear);
        (int floor, int index) = RealmApp.BossOf(run);
        await app.ToFloor(run, floor);
        OutcomeView boss = await RealmApp.Finish(browser, (await RealmApp.Fight(browser, run, floor, index, "rofellos")).Token);
        Assert.Equal("won", boss.Outcome);
        await app.ToFloor(run, 0);
        RunEncounter next = run.Floors[0].Encounters[1];
        await app.SetHearts(browser, 1);
        app.Verifier.Answer = (_, _) => FakeVerifier.MobWon;
        OutcomeView died = await RealmApp.Finish(browser, (await RealmApp.Fight(browser, run, 0, next.Index, next.Mob)).Token);

        Assert.True(died.Died);
        RunLoss forfeit = died.Forfeit!;
        Assert.Equal(boss.Gold + other.Gold, forfeit.Gold);
        Assert.Equal([boss.Gift!], forfeit.Cards);
        Assert.Equal(new[] { boss.Gear!.Gear.Name, other.Gear!.Gear.Name }.Order(StringComparer.Ordinal), forfeit.Gear.Order(StringComparer.Ordinal));

        CharacterView me = await browser.Me();
        Assert.Equal(gold, me.Gold);
        Assert.Equal(gear, me.Gear.Count);
        Assert.Equal(cards, await browser.Collection());
        Assert.Equal((World, RealmApp.Inn("new-benalia").At), (me.Space, new Tile(me.X, me.Z)));
        Assert.Equal(RunRow.Ended, await app.Store(db => db.Runs.Where(row => row.Id == run.Run).Select(row => row.State).SingleAsync()));

        // The color the boss unlocked stays: a win's story, not its winnings.
        Assert.Contains("G", me.Unlocked);
    }

    [Fact]
    public async Task A_town_fills_the_hearts_and_the_wilds_do_not()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await app.SetHearts(browser, 1);
        TownEntry town = RealmApp.Content.Towns["new-benalia"];
        Tile wild = Enumerable.Range(town.Radius + 2, 40).Select(far => new Tile(town.At.X, town.At.Z + far)).First(RealmApp.Content.World.Walkable);
        Assert.Null(RealmApp.Content.TownAt(wild));

        await browser.Put(World, wild);
        app.Time.Advance(TimeSpan.FromSeconds(1));
        Tile step = Tile.Steps.Select(wild.Plus).First(tile => RealmApp.Content.World.Walkable(tile) && RealmApp.Content.TownAt(tile) is null);
        Assert.Equal(new PositionView(1), await browser.Ok<PositionView>(HttpMethod.Post, "/api/position", new { Space = World, step.X, step.Z }));

        // Walked into the town, the server sees it from where they stand: the hearts fill.
        app.Time.Advance(TimeSpan.FromMinutes(1));
        Tile inn = RealmApp.Inn("new-benalia").At;
        Assert.NotNull(RealmApp.Content.TownAt(inn));
        Assert.Equal(new PositionView(2), await browser.Ok<PositionView>(HttpMethod.Post, "/api/position", new { Space = World, inn.X, inn.Z }));
        Assert.Equal(2, (await browser.Me()).Hearts);

        // A building of a town is the town; a run is not.
        using IServiceScope scope = app.Services.CreateScope();
        Hearts hearts = scope.ServiceProvider.GetRequiredService<Hearts>();
        Assert.True(hearts.InTown("new-benalia-inn", new Tile(0, 0)));
        Assert.False(hearts.InTown(RealmContent.RunSpace("x"), new Tile(0, 0)));
        Assert.False(hearts.InTown(World, wild));
    }

    [Fact]
    public async Task A_heart_found_is_given_back_up_to_the_capacity()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await app.SetHearts(browser, 1, 2);
        using IServiceScope scope = app.Services.CreateScope();
        Hearts hearts = scope.ServiceProvider.GetRequiredService<Hearts>();
        Assert.True(await hearts.Grant(browser.Player));
        Assert.False(await hearts.Grant(browser.Player));
        Assert.Equal((2, 2), ((await browser.Me()).Hearts, (await browser.Me()).MaxHearts));
    }

    [Fact]
    public async Task Hearts_are_bought_at_a_healer_one_at_a_time_to_five_each_dearer()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await app.SetHearts(browser, 1);

        // Not at the inn: at a temple's healer.
        await browser.Inside("new-benalia-inn");
        await browser.Refused(HttpMethod.Post, "/api/hearts/buy", new { }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Inside("new-benalia-temple");
        await app.Store(db => db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, Hearts.Prices[3] - 1)));
        await browser.Refused(HttpMethod.Post, "/api/hearts/buy", new { }, HttpStatusCode.Conflict, Codes.CannotAfford);

        await app.Store(db => db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, 20_000)));
        long gold = 20_000;
        int had = 1;
        foreach (int capacity in new[] { 3, 4, 5 })
        {
            HeartsView bought = await browser.Ok<HeartsView>(HttpMethod.Post, "/api/hearts/buy", new { });
            gold -= Hearts.Prices[capacity];
            had++;
            Assert.Equal((gold, had, capacity), (bought.Gold, bought.Hearts, bought.MaxHearts));
            Assert.Equal(Hearts.PriceAfter(capacity), bought.Price);
        }

        Assert.True(Hearts.Prices[3] < Hearts.Prices[4] && Hearts.Prices[4] < Hearts.Prices[5]);
        await browser.Refused(HttpMethod.Post, "/api/hearts/buy", new { }, HttpStatusCode.Conflict, Codes.MostHearts);
        CharacterView me = await browser.Me();
        Assert.Equal((4, Hearts.Most, (long?)null), (me.Hearts, me.MaxHearts, me.HeartPrice));
    }

    [Fact]
    public async Task The_store_moves_to_hearts_and_sideboards_dropping_the_ante()
    {
        // A store as it was before hearts: a character, their ante and a duel of theirs.
        string file = Path.Combine(Path.GetTempPath(), $"cantrip-realm-migrate-{Guid.NewGuid():N}.db");
        try
        {
            DbContextOptions<SqliteRealmDb> options = new DbContextOptionsBuilder<SqliteRealmDb>().UseSqlite($"Data Source={file}").Options;
            await using (var db = new SqliteRealmDb(options))
            {
                IMigrator migrator = db.GetInfrastructure().GetRequiredService<IMigrator>();
                string before = db.Database.GetMigrations().Last(migration => !migration.EndsWith("_Hearts", StringComparison.Ordinal));
                await migrator.MigrateAsync(before);
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO players (Id, Name, Body, Palette, Color, Gold, Space, X, Z, PlacedAt, Inn, CreatedAt) VALUES ('dev-1', 'Old', 0, 0, 'W', 100, 'world', 0, 0, 0, 'new-benalia-inn', 0);
                    INSERT INTO ante (PlayerId, Name, Count) VALUES ('dev-1', 'Serra Angel', 1);
                    INSERT INTO duels (Token, PlayerId, Space, Spawn, Epoch, Mob, Seed, StartedAt, State, Spec, Ante, AnteValue, Cap, Gold) VALUES ('t', 'dev-1', 'world', 's', 1, 'm', 1, 0, 'won', 'spec', '[]', 90, 90, 40);
                    """);
                await migrator.MigrateAsync();
            }

            await using (var db = new SqliteRealmDb(options))
            {
                PlayerRow player = await db.Players.SingleAsync();
                Assert.Equal((2, 2), (player.Hearts, player.MaxHearts));
                Assert.Empty(await db.Sideboard.ToListAsync());
                DuelRow duel = await db.Duels.SingleAsync();
                Assert.Equal((1, "[]", 40L), (duel.Game, duel.Sideboard, duel.Gold));
                List<string> tables = await db.Database.SqlQueryRaw<string>("SELECT name AS \"Value\" FROM sqlite_master WHERE type = 'table'").ToListAsync();
                Assert.DoesNotContain("ante", tables);
            }
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            File.Delete(file);
        }
    }
}
