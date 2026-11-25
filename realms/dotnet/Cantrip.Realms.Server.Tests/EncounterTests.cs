using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Duels;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>Duels against mobs (design.md A3; tech.md B4's encounter protocol), checked by a fake verifier. Hearts, buyouts and rematches are <see cref="HeartsTests"/>.</summary>
public sealed class EncounterTests
{
    private const string World = RealmContent.WorldSpace;

    /// <summary>A tier 1 spawn near New Benalia, of every tier 1 wanderer, so that the mob there changes from epoch to epoch.</summary>
    private static readonly string Spawn = RealmApp.SpawnOf(1).Id;

    /// <summary>The mob the spawn holds for a player now.</summary>
    private static string MobNow(RealmApp app, Browser browser, int epochsBack = 0)
    {
        MapSpawn spawn = RealmApp.Content.World.Spawn(Spawn)!;
        long epoch = Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds) - epochsBack;
        return Spawns.MobOf(browser.Player, World, Spawn, epoch, spawn.Mobs);
    }

    /// <summary>A white character with <paramref name="sideboard"/> in their sideboard, standing at the spawn.</summary>
    private static async Task<Browser> Ready(RealmApp app, ulong id = 1, params (string Name, int Count)[] sideboard)
    {
        Browser browser = await app.Character(id, "W");
        if (sideboard.Length > 0)
        {
            foreach ((string name, int count) in sideboard) await app.Give(browser, name, count);
            await browser.ToSpellTable();
            DeckView deck = await browser.Deck();
            await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Sideboard = sideboard.Select(card => new CardCount(card.Name, card.Count)) });
        }

        await browser.Put(World, RealmApp.Content.World.Spawn(Spawn)!.At);
        return browser;
    }

    private static Task<EncounterView> Begin(Browser browser, string mob) =>
        browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn, Mob = mob });

    private static Task<OutcomeView> Finish(Browser browser, string token) =>
        browser.Ok<OutcomeView>(HttpMethod.Post, "/api/encounter/finish", new { Token = token, Log = new[] { "AA==" } });

    [Fact]
    public async Task A_duel_is_dealt_from_the_character_and_the_mob()
    {
        await using var app = new RealmApp();
        Browser browser = await Ready(app, 1, ("Serra Angel", 1));
        CharacterView me = await browser.Me();
        string mob = MobNow(app, browser);
        EncounterView encounter = await Begin(browser, mob);
        Duel duel = encounter.Duel;

        Assert.Equal(encounter.Seed, duel.Seed);
        Assert.InRange(duel.Seed, 0, Duel.MaximumSeed);
        Assert.Equal(40, duel.MinimumDeckSize);
        Assert.Equal(2, duel.Seats.Count);

        DuelSeat player = duel.Seats[0];
        Assert.Equal(me.Name, player.Name);
        Assert.Equal(40, player.Deck.Count);
        Assert.Equal(["Serra Angel"], player.Sideboard);
        Assert.Equal((me.Stats.Life, me.Stats.Hand, me.Stats.MaxHand), (player.StartingLife, player.StartingHandSize, player.MaximumHandSize));
        Assert.Empty(player.Emblems);

        Mob content = RealmApp.Content.Mobs[mob];
        DuelSeat seat = duel.Seats[1];
        Assert.Equal(content.File.Name, seat.Name);
        Assert.Equal(content.Deck.Entries.Sum(entry => entry.Copies), seat.Deck.Count);
        GearStats stats = content.File.Gear.Select(id => RealmApp.Content.Gear[id].Stats).Aggregate(content.File.Stats, (sum, item) => sum + item);
        Assert.Equal((stats.Life, stats.Hand, stats.MaxHand), (seat.StartingLife, seat.StartingHandSize, seat.MaximumHandSize));

        Assert.Equal(new DuelMob(content.File.Name, content.File.Tier), duel.Mob);
        Assert.Equal(1, duel.Game);
        Assert.Null(duel.FirstPlayer);
    }

    [Fact]
    public async Task Worn_gear_with_effects_is_an_emblem_of_the_players_seat()
    {
        await using var app = new RealmApp();
        Browser browser = await Ready(app);
        long circlet = await app.Store(async db =>
        {
            var owned = new GearOwnedRow { PlayerId = browser.Player, GearId = "circlet-of-foresight" };
            db.GearOwned.Add(owned);
            await db.SaveChangesAsync();
            return owned.Id;
        });
        await browser.Ok<CharacterView>(HttpMethod.Put, "/api/loadout", new { Slots = new Dictionary<string, long?> { ["head"] = circlet } });

        EncounterView encounter = await Begin(browser, MobNow(app, browser));
        Assert.Equal(["Circlet of Foresight (gear)"], encounter.Duel.Seats[0].Emblems);
    }

    [Fact]
    public async Task Only_the_mob_of_this_epoch_or_the_last_is_at_a_spawn_and_only_once_an_epoch()
    {
        await using var app = new RealmApp();
        Browser browser = await Ready(app);
        MapSpawn spawn = RealmApp.Content.World.Spawn(Spawn)!;
        string now = MobNow(app, browser);
        string last = MobNow(app, browser, epochsBack: 1);

        foreach (string other in spawn.Mobs.Where(mob => mob != now && mob != last))
        {
            await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn, Mob = other }, HttpStatusCode.Conflict, Codes.NotThere);
        }

        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn, Mob = "teferi" }, HttpStatusCode.Conflict, Codes.NotThere);
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn = "0_0:99", Mob = now }, HttpStatusCode.NotFound, Codes.NotThere);

        EncounterView first = await Begin(browser, now);
        await Finish(browser, first.Token);

        // The same mob again this epoch: if last epoch's was the same mob, that one may be fought too, once.
        if (last == now)
        {
            EncounterView second = await Begin(browser, now);
            await Finish(browser, second.Token);
        }

        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn, Mob = now }, HttpStatusCode.Conflict, Codes.TooSoon);

        // Two epochs on, the spawn holds a mob again.
        app.Time.Advance(TimeSpan.FromSeconds(2 * spawn.RespawnSeconds));
        await browser.Put(World, RealmApp.Content.World.Spawn(Spawn)!.At);
        await Begin(browser, MobNow(app, browser));
    }

    [Fact]
    public async Task Last_epochs_mob_is_still_there_just_after_the_epoch_turns()
    {
        await using var app = new RealmApp();
        Browser browser = await Ready(app);
        MapSpawn spawn = RealmApp.Content.World.Spawn(Spawn)!;

        // Find the turn of an epoch where the mob changes, by stepping the fake clock one epoch at a time.
        string before = MobNow(app, browser);
        for (int i = 0; i < 50 && MobNow(app, browser) == before; i++) app.Time.Advance(TimeSpan.FromSeconds(spawn.RespawnSeconds));
        Assert.NotEqual(before, MobNow(app, browser));
        await browser.Put(World, RealmApp.Content.World.Spawn(Spawn)!.At);

        await Begin(browser, MobNow(app, browser, epochsBack: 1));
    }

    [Fact]
    public async Task A_duel_starts_only_near_its_spawn()
    {
        await using var app = new RealmApp();
        Browser browser = await Ready(app);
        MapSpawn spawn = RealmApp.Content.World.Spawn(Spawn)!;
        await browser.Put(World, RealmApp.Away(spawn.At, spawn.Radius + 9));
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn, Mob = MobNow(app, browser) }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Inside("new-benalia-inn");
        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn, Mob = MobNow(app, browser) }, HttpStatusCode.Conflict, Codes.NotNear);
    }

    [Fact]
    public async Task A_win_pays_gold_and_no_cards()
    {
        await using var app = new RealmApp();
        Browser browser = await Ready(app, 1, ("Serra Angel", 2));
        IReadOnlyDictionary<string, int> before = await browser.Collection();
        string mob = MobNow(app, browser);
        EncounterView encounter = await Begin(browser, mob);
        OutcomeView won = await Finish(browser, encounter.Token);

        Mob content = RealmApp.Content.Mobs[mob];
        Assert.Equal("won", won.Outcome);
        Assert.InRange(won.Gold, content.File.GoldRange[0], content.File.GoldRange[1]);
        Assert.Null(won.Defeat);
        Assert.Null(won.Gift);
        Assert.Equal(Hearts.Starting, won.Hearts);
        Assert.Equal(Characters.StartingGold + won.Gold, (await browser.Me()).Gold);
        Assert.Equal(before, await browser.Collection());

        // The verifier was asked about the duel as dealt, with the log sent.
        (Duel checkedDuel, IReadOnlyList<string> log) = Assert.Single(app.Verifier.Checked);
        Assert.Equivalent(encounter.Duel, checkedDuel);
        Assert.Equal(["AA=="], log);
    }

    [Fact]
    public async Task A_loss_costs_a_heart_and_pays_nothing_and_the_character_stays_where_they_stand()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (_, _) => FakeVerifier.MobWon;
        Browser browser = await Ready(app, 1, ("Serra Angel", 2));
        IReadOnlyDictionary<string, int> before = await browser.Collection();
        CharacterView was = await browser.Me();

        EncounterView encounter = await Begin(browser, MobNow(app, browser));
        OutcomeView lost = await Finish(browser, encounter.Token);
        Assert.Equal("lost", lost.Outcome);
        Assert.Equal(0, lost.Gold);
        Assert.Null(lost.Gear);
        Assert.Empty(lost.Relics);
        Assert.False(lost.Died);
        Assert.Equal(Hearts.Starting - 1, lost.Hearts);
        Assert.NotNull(lost.Defeat);

        CharacterView me = await browser.Me();
        Assert.Equal(was.Gold, me.Gold);
        Assert.Equal(before, await browser.Collection());
        Assert.Equal(Hearts.Starting - 1, me.Hearts);
        Assert.Equal((was.Space, was.X, was.Z), (me.Space, me.X, me.Z));
        Assert.Equivalent(lost.Defeat, me.Defeat);
    }

    [Fact]
    public async Task A_tampered_log_counts_as_a_loss()
    {
        await using var app = new RealmApp();
        app.Verifier.Answer = (_, _) => FakeVerifier.Tampered;
        Browser browser = await Ready(app, 1, ("Serra Angel", 2), ("Benalish Hero", 1));
        IReadOnlyDictionary<string, int> before = await browser.Collection();
        EncounterView encounter = await Begin(browser, MobNow(app, browser));

        OutcomeView lost = await Finish(browser, encounter.Token);
        Assert.Equal("lost", lost.Outcome);
        Assert.Contains("was refused", lost.Detail, StringComparison.Ordinal);
        Assert.Equal(Hearts.Starting - 1, lost.Hearts);
        Assert.Equal(before, await browser.Collection());
        await browser.Refused(HttpMethod.Post, "/api/encounter/finish", new { encounter.Token, Log = Array.Empty<string>() }, HttpStatusCode.Conflict, Codes.Finished);
    }

    [Fact]
    public async Task A_duel_left_unfinished_is_lost_when_the_next_one_starts()
    {
        await using var app = new RealmApp();
        Browser browser = await Ready(app, 1, ("Serra Angel", 2), ("Benalish Hero", 1));
        IReadOnlyDictionary<string, int> before = await browser.Collection();
        EncounterView first = await Begin(browser, MobNow(app, browser));

        await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn = RealmApp.SpawnOf(2).Id, Mob = RealmApp.SpawnOf(2).Mobs[0] }, HttpStatusCode.Conflict, Codes.Unfinished);
        CharacterView me = await browser.Me();
        Assert.Equal(Hearts.Starting - 1, me.Hearts);
        Assert.Equal(first.Token, me.Defeat?.Token);
        Assert.Equal(before, await browser.Collection());
        await browser.Refused(HttpMethod.Post, "/api/encounter/finish", new { first.Token, Log = Array.Empty<string>() }, HttpStatusCode.Conflict, Codes.Finished);
        Assert.Empty(app.Verifier.Checked);
    }

    [Fact]
    public async Task A_duel_left_unfinished_for_a_day_is_lost()
    {
        await using var app = new RealmApp();
        Browser browser = await Ready(app, 1, ("Serra Angel", 2), ("Benalish Hero", 1));
        IReadOnlyDictionary<string, int> before = await browser.Collection();
        EncounterView encounter = await Begin(browser, MobNow(app, browser));

        app.Time.Advance(TimeSpan.FromHours(23));
        Assert.Equal(before.Values.Sum(), (await browser.Collection()).Values.Sum());
        app.Time.Advance(TimeSpan.FromHours(2));

        // Looking at the character settles it: a heart lost, and the mob, untouched, asks its whole buyout.
        CharacterView me = await browser.Me();
        Assert.Equal(Hearts.Starting - 1, me.Hearts);
        Assert.Equal(before, await browser.Collection());
        string state = await app.Store(db => db.Duels.Where(duel => duel.Token == encounter.Token).Select(duel => duel.State).SingleAsync());
        Assert.Equal(DuelRow.Defeated, state);
        Assert.Equal(me.Defeat!.MobFullLife, me.Defeat.MobLife);
        Assert.Equal(Encounters.BuyoutBase[1], me.Defeat.Price);
    }

    [Fact]
    public async Task A_duel_is_finished_only_by_its_own_player()
    {
        await using var app = new RealmApp();
        Browser ann = await Ready(app, 1);
        Browser bob = await app.Character(2);
        EncounterView encounter = await Begin(ann, MobNow(app, ann));
        await bob.Refused(HttpMethod.Post, "/api/encounter/finish", new { encounter.Token, Log = Array.Empty<string>() }, HttpStatusCode.NotFound, Codes.NoDuel);
    }

    [Fact]
    public async Task A_deck_that_is_no_longer_legal_cannot_start_a_duel()
    {
        await using var app = new RealmApp();
        Browser browser = await Ready(app);
        await app.Store(db => db.Deck.Where(row => row.PlayerId == browser.Player && row.Name == "Plains").ExecuteUpdateAsync(set => set.SetProperty(row => row.Count, 1)));
        ApiError refused = await browser.Refused(HttpMethod.Post, "/api/encounter/start", new { Spawn, Mob = MobNow(app, browser) }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains(refused.Problems!, problem => problem.StartsWith("A deck is at least 40 cards", StringComparison.Ordinal));
    }
}
