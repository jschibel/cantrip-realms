using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>A character's deck and sideboard (design.md A2), changed only at a spell table.</summary>
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
        await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Sideboard = Array.Empty<CardCount>() }, HttpStatusCode.Conflict, Codes.NotAtTable);

        // Next to the inn's table, it does; and in the world, next to the table in New Benalia's square, too.
        await browser.ToSpellTable();
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Sideboard = Array.Empty<CardCount>() });
        Tile table = RealmApp.Content.World.SpellTables.First(tile => RealmApp.Content.TownAt(tile)?.Id == "new-benalia");
        await browser.Put(RealmContent.WorldSpace, RealmApp.Beside(RealmContent.WorldSpace, table));
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Sideboard = Array.Empty<CardCount>() });
        await browser.Put(RealmContent.WorldSpace, RealmApp.Away(table, 2));
        await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Sideboard = Array.Empty<CardCount>() }, HttpStatusCode.Conflict, Codes.NotAtTable);
    }

    [Fact]
    public async Task A_sideboard_is_cards_owned_beside_the_deck()
    {
        await using var app = new RealmApp();
        Browser browser = await AtTable(app, ("Benalish Hero", 2), ("Serra Angel", 1));
        List<CardCount> main = Starter(await browser.Deck());

        DeckView saved = await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = main, Sideboard = new[] { new CardCount("Benalish Hero", 2), new CardCount("Serra Angel", 1) } });
        Assert.Equal([new CardCount("Benalish Hero", 2), new CardCount("Serra Angel", 1)], saved.Sideboard);
        Assert.Equal(saved.Sideboard, (await browser.Deck()).Sideboard);
    }

    [Fact]
    public async Task A_copy_is_in_the_deck_or_the_sideboard_never_both()
    {
        await using var app = new RealmApp();
        Browser browser = await AtTable(app);
        List<CardCount> main = Starter(await browser.Deck());

        // A card the deck holds every owned copy of.
        IReadOnlyDictionary<string, int> owned = await browser.Collection();
        CardCount all = main.First(card => card.Name != "Plains" && owned[card.Name] == card.Count);
        ApiError refused = await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = main, Sideboard = new[] { new CardCount(all.Name, 1) } }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains($"You own {all.Count} {all.Name}; the deck and the sideboard use {all.Count + 1}.", refused.Problems!);
    }

    [Fact]
    public async Task Basic_lands_of_the_identity_are_free_and_unlimited_in_the_deck_and_the_sideboard()
    {
        await using var app = new RealmApp();
        Browser browser = await AtTable(app);

        // Forty Plains, owned by nobody; Wastes too, whatever the identity; and Plains in the sideboard.
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = new[] { new CardCount("Plains", 36), new CardCount("Wastes", 4) }, Sideboard = new[] { new CardCount("Plains", 3) } });

        ApiError island = await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = new[] { new CardCount("Plains", 36), new CardCount("Island", 4) }, Sideboard = Array.Empty<CardCount>() }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Contains("Island is outside the color identity W.", island.Problems!);
    }

    [Fact]
    public async Task The_sideboard_is_held_to_the_identity_and_shares_the_decks_copy_limits()
    {
        // The identity holds the sideboard as it holds the deck; and four copies of a card are the most the deck and its
        // sideboard hold between them (CR 100.4a).
        await using var app = new RealmApp();
        Browser browser = await AtTable(app, ("Goblin King", 1), ("Benalish Hero", 5));
        List<CardCount> main = Starter(await browser.Deck());
        ApiError outside = await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = main, Sideboard = new[] { new CardCount("Goblin King", 1) } }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Equal(["Goblin King is outside the color identity W."], outside.Problems);

        int inStarter = main.SingleOrDefault(card => card.Name == "Benalish Hero")?.Count ?? 0;
        List<CardCount> others = [.. main.Where(card => card.Name != "Benalish Hero")];
        ApiError five = await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = others.Append(new CardCount("Benalish Hero", 4)), Sideboard = new[] { new CardCount("Benalish Hero", 1) } }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Equal(["Benalish Hero: 5 copies, more than the 4 a deck and its sideboard may have."], five.Problems);
        DeckView saved = await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = others.Append(new CardCount("Benalish Hero", 3)), Sideboard = new[] { new CardCount("Benalish Hero", 1) } });

        // The realm keeps what was saved, sideboard and all, until it is changed at a table again.
        DeckView kept = await browser.Deck();
        Assert.Equal(saved.Main, kept.Main);
        Assert.Equal(saved.Sideboard, kept.Sideboard);
        Assert.Equal(40 + 3 - inStarter, saved.Main.Sum(card => card.Count));
        Assert.Equal([new CardCount("Benalish Hero", 1)], saved.Sideboard);
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
                Sideboard = new[] { new CardCount("Serra Angel", 4), new CardCount("Plains", 12) },
            },
            HttpStatusCode.UnprocessableEntity,
            Codes.IllegalDeck);

        Assert.Contains("Benalish Hero: 5 copies, more than the 4 a deck and its sideboard may have.", refused.Problems!);
        Assert.Contains("Black Lotus is restricted in Vintage: one copy at most, not 2.", refused.Problems!);
        Assert.Contains("Lightning Bolt is outside the color identity W.", refused.Problems!);
        Assert.Contains("You don't own Llanowar Elves.", refused.Problems!);
        Assert.Contains("A sideboard is at most 15 cards: this one is 16.", refused.Problems!);

        // Under forty.
        ApiError small = await browser.Refused(HttpMethod.Put, "/api/deck", new { Main = new[] { new CardCount("Plains", 39) }, Sideboard = Array.Empty<CardCount>() }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
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
