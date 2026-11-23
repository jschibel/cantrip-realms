using System.Net;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>A character's deck and ante (design.md A2), changed only at a spell table.</summary>
public sealed class DeckTests
{
    /// <summary>A white character at the spell table, owning <paramref name="cards"/> beside their starter deck.</summary>
    private static async Task<Browser> AtTable(RealmApp app, params (string Name, int Count)[] cards)
    {
        Browser browser = await app.Character(1, "W");
        await app.Store(async db =>
        {
            foreach ((string name, int count) in cards)
            {
                CollectionRow? row = await db.Collection.SingleOrDefaultAsync(row => row.PlayerId == browser.Player && row.Name == name);
                if (row is null) db.Collection.Add(new CollectionRow { PlayerId = browser.Player, Name = name, Count = count });
                else row.Count += count;
            }

            await db.SaveChangesAsync();
        });
        await browser.ToSpellTable();
        return browser;
    }

    private static List<CardCount> Starter(DeckView deck) => [.. deck.Main];

    [Fact]
    public async Task A_deck_changes_only_at_a_spell_table()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        DeckView deck = await browser.Deck();
        await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Ante = Array.Empty<CardCount>() }, HttpStatusCode.Conflict, Codes.NotAtTable);

        // Next to the table, it does; and in the meadow, next to its table, too.
        await browser.ToSpellTable();
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Ante = Array.Empty<CardCount>() });
        await browser.Travel("benalish-meadow", -3, 4);
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Ante = Array.Empty<CardCount>() });
        await browser.Travel("benalish-meadow", -3, 6);
        await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Ante = Array.Empty<CardCount>() }, HttpStatusCode.Conflict, Codes.NotAtTable);
    }

    [Fact]
    public async Task An_ante_is_cards_owned_beside_the_deck_and_worth_their_prices()
    {
        await using var app = new RealmApp();
        Browser browser = await AtTable(app, ("Benalish Hero", 2), ("Serra Angel", 1));
        List<CardCount> main = Starter(await browser.Deck());

        DeckView saved = await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = main, Ante = new[] { new CardCount("Benalish Hero", 2), new CardCount("Serra Angel", 1) } });
        long expected = (2 * RealmApp.Content.Cards.Price("Benalish Hero")!.Value) + RealmApp.Content.Cards.Price("Serra Angel")!.Value;
        Assert.Equal(expected, saved.AnteValue);
        Assert.Equal(expected, (await browser.Deck()).AnteValue);
    }

    [Fact]
    public async Task A_copy_is_in_the_deck_or_the_ante_never_both()
    {
        await using var app = new RealmApp();
        Browser browser = await AtTable(app);
        List<CardCount> main = Starter(await browser.Deck());

        // A card the deck holds every owned copy of.
        IReadOnlyDictionary<string, int> owned = await browser.Collection();
        CardCount all = main.First(card => card.Name != "Plains" && owned[card.Name] == card.Count);
        ApiError refused = await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = main, Ante = new[] { new CardCount(all.Name, 1) } }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains($"You own {all.Count} {all.Name}; the deck and the ante use {all.Count + 1}.", refused.Problems!);
    }

    [Fact]
    public async Task Basic_lands_of_the_identity_are_free_and_unlimited_and_never_anted()
    {
        await using var app = new RealmApp();
        Browser browser = await AtTable(app);

        // Forty Plains, owned by nobody; Wastes too, whatever the identity.
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = new[] { new CardCount("Plains", 36), new CardCount("Wastes", 4) }, Ante = Array.Empty<CardCount>() });

        ApiError island = await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = new[] { new CardCount("Plains", 36), new CardCount("Island", 4) }, Ante = Array.Empty<CardCount>() }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains("Island is outside the color identity W.", island.Problems!);

        ApiError anted = await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = new[] { new CardCount("Plains", 40) }, Ante = new[] { new CardCount("Plains", 1) } }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains("Plains is a basic land, free to every deck: it can't be anted.", anted.Problems!);
    }

    [Fact]
    public async Task A_deck_breaking_the_rules_is_refused_with_every_problem()
    {
        await using var app = new RealmApp();
        Browser browser = await AtTable(app, ("Benalish Hero", 4), ("Serra Angel", 11), ("Black Lotus", 2), ("Lightning Bolt", 1));
        ApiError refused = await browser.Refused(
            HttpMethod.Put,
            "/api/deck",
            new
            {
                Main = new[] { new CardCount("Plains", 30), new CardCount("Benalish Hero", 5), new CardCount("Black Lotus", 2), new CardCount("Lightning Bolt", 1), new CardCount("Llanowar Elves", 1) },
                Ante = new[] { new CardCount("Serra Angel", 11) },
            },
            HttpStatusCode.UnprocessableEntity,
            Codes.IllegalDeck);

        Assert.Contains("Benalish Hero: 5 copies, more than the 4 a deck may have.", refused.Problems!);
        Assert.Contains("Black Lotus is restricted in Vintage: one copy at most, not 2.", refused.Problems!);
        Assert.Contains("Lightning Bolt is outside the color identity W.", refused.Problems!);
        Assert.Contains("You don't own Llanowar Elves.", refused.Problems!);
        Assert.Contains("An ante is at most 10 cards: this one is 11.", refused.Problems!);

        // Under forty.
        ApiError small = await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = new[] { new CardCount("Plains", 39) }, Ante = Array.Empty<CardCount>() }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains("A deck is at least 40 cards: this one is 39.", small.Problems!);
    }

    [Fact]
    public async Task A_loadout_takes_owned_items_in_their_slots_within_the_stat_ranges()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        CharacterView me = await browser.Me();
        GearInstance cap = me.Loadout["head"]!;

        long ring1 = 0, ring2 = 0, amulet = 0;
        await app.Store(async db =>
        {
            var a = new GearOwnedRow { PlayerId = browser.Player, GearId = "copper-ring" };
            var b = new GearOwnedRow { PlayerId = browser.Player, GearId = "copper-ring" };
            var c = new GearOwnedRow { PlayerId = browser.Player, GearId = "silver-pendant" };
            db.GearOwned.AddRange(a, b, c);
            await db.SaveChangesAsync();
            (ring1, ring2, amulet) = (a.Id, b.Id, c.Id);
        });

        // Two rings, one in each ring slot; the head emptied.
        CharacterView worn = await browser.Ok<CharacterView>(HttpMethod.Put, "/api/loadout", new { Slots = new Dictionary<string, long?> { ["ring1"] = ring1, ["ring2"] = ring2, ["head"] = null } });
        Assert.Equal(ring1, worn.Loadout["ring1"]!.InstanceId);
        Assert.Equal(ring2, worn.Loadout["ring2"]!.InstanceId);
        Assert.Null(worn.Loadout["head"]);
        Assert.Equal(me.Stats.Life + 2, worn.Stats.Life);
        Assert.Equal(me.Stats.MaxHand - 1, worn.Stats.MaxHand);

        ApiError refused = await browser.Refused(
            HttpMethod.Put,
            "/api/loadout",
            new { Slots = new Dictionary<string, long?> { ["head"] = amulet, ["neck"] = ring1, ["ring2"] = 999_999, ["cape"] = cap.InstanceId } },
            HttpStatusCode.UnprocessableEntity,
            Codes.IllegalLoadout);
        Assert.Contains("Silver Pendant is worn on the neck, not the head.", refused.Problems!);
        Assert.Contains("Copper Ring is worn on the ring, not the neck.", refused.Problems!);
        Assert.Contains("You own no gear item 999999.", refused.Problems!);
        Assert.Contains(refused.Problems!, problem => problem.StartsWith("'cape' is not a slot", StringComparison.Ordinal));

        ApiError twice = await browser.Refused(HttpMethod.Put, "/api/loadout", new { Slots = new Dictionary<string, long?> { ["ring1"] = ring2 } }, HttpStatusCode.UnprocessableEntity, Codes.IllegalLoadout);
        Assert.Contains("Copper Ring can't be worn in two slots.", twice.Problems!);
    }

    [Fact]
    public void The_stat_ranges_are_design_A1s()
    {
        Assert.Empty(DecksAndGear.StatProblems(new(10, 4, 4)));
        Assert.Empty(DecksAndGear.StatProblems(new(40, 9, 10)));
        Assert.Equal(3, DecksAndGear.StatProblems(new(9, 3, 3)).Count);
        Assert.Equal(3, DecksAndGear.StatProblems(new(41, 10, 11)).Count);
    }
}
