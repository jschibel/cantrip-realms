using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Economy;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// Where gear comes from (design.md A3, A4, A5): a won duel drops an item at its tier's chance (10, 15, 20, 30 in a hundred),
/// of its tier's rarity; a chest holds one at <see cref="Chests.GearChance"/>. The rolls are forced (<see cref="ForcedRolls"/>:
/// a roll just under a chance comes up, the chance itself does not), never swept; and a development server's
/// <c>/dev/drop</c> decides them for an end-to-end test. What the inventory and the gear say of what a character owns.
/// </summary>
public sealed class GearDropTests
{
    private const string World = RealmContent.WorldSpace;

    /// <summary>A white character standing at the first spawn of a tier, and the mob it holds for them now.</summary>
    private static async Task<(Browser Browser, MapSpawn Spawn, string Mob)> AtSpawn(RealmApp app, ulong id, int tier)
    {
        Browser browser = await app.Character(id, "W");
        MapSpawn spawn = RealmApp.SpawnOf(tier);
        await browser.Put(World, spawn.At);
        long epoch = Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds);
        return (browser, spawn, Spawns.MobOf(browser.Player, World, spawn.Id, epoch, spawn.Mobs));
    }

    private static async Task<(OutcomeView, Browser)> Win(RealmApp app, ulong id, int tier)
    {
        (Browser browser, MapSpawn spawn, string mob) = await AtSpawn(app, id, tier);
        EncounterView encounter = await browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = spawn.Id, Mob = mob });
        OutcomeView won = await browser.Ok<OutcomeView>(HttpMethod.Post, "/api/encounter/finish", new { Token = encounter.Token, Log = new[] { "AA==" } });
        Assert.Equal("won", won.Outcome);
        return (won, browser);
    }

    [Theory]
    [InlineData(1, 10, "common")]
    [InlineData(2, 15, "common")]
    [InlineData(3, 20, "uncommon")]
    [InlineData(4, 30, "rare")]
    public async Task A_win_drops_gear_at_its_tiers_chance_of_its_tiers_rarity_and_the_item_is_owned(int tier, int percent, string rarity)
    {
        Assert.Equal(percent, Encounters.GearChance[tier]);
        var rolls = new ForcedRolls(percent / 100.0 - 1e-9);
        await using var app = new RealmApp { Random = rolls };

        // A roll just under the chance comes up: an item of the tier's rarity, owned at once, not worn.
        (OutcomeView dropped, Browser browser) = await Win(app, 1, tier);
        GearInstance gear = Assert.IsType<GearInstance>(dropped.Gear);
        Assert.Equal(rarity, gear.Gear.Rarity);
        Assert.False(gear.Gear.Unique);
        Assert.Empty(dropped.Relics);
        CharacterView me = await browser.Me();
        Assert.Contains(me.Gear, owned => owned.InstanceId == gear.InstanceId && owned.Gear.Id == gear.Gear.Id);
        Assert.DoesNotContain(me.Loadout.Values, worn => worn?.InstanceId == gear.InstanceId);

        // A roll of the chance itself does not.
        rolls.Value = percent / 100.0;
        (OutcomeView none, _) = await Win(app, 2, tier);
        Assert.Null(none.Gear);
    }

    [Fact]
    public async Task A_lost_duel_drops_nothing()
    {
        await using var app = new RealmApp { Random = new ForcedRolls(0) };
        app.Verifier.Answer = (_, _) => FakeVerifier.MobWon;
        (Browser browser, MapSpawn spawn, string mob) = await AtSpawn(app, 1, 4);
        EncounterView encounter = await browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = spawn.Id, Mob = mob });
        OutcomeView lost = await browser.Ok<OutcomeView>(HttpMethod.Post, "/api/encounter/finish", new { Token = encounter.Token, Log = new[] { "AA==" } });
        Assert.Equal("lost", lost.Outcome);
        Assert.Null(lost.Gear);
    }

    [Fact]
    public async Task A_chest_holds_a_common_item_at_its_chance_beside_its_gold()
    {
        var rolls = new ForcedRolls(Chests.GearChance / 100.0 - 1e-9);
        await using var app = new RealmApp { Random = rolls };
        MapChest chest = RealmApp.Content.World.Chest("0_0:1")!;
        Assert.Equal("common", Chests.GearRarity(chest));

        Browser browser = await app.Character(1);
        await browser.Put(World, RealmApp.Beside(World, chest.At));
        ChestView found = await browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id });
        GearInstance gear = Assert.IsType<GearInstance>(found.Gear);
        Assert.Equal("common", gear.Gear.Rarity);
        Assert.InRange(found.Found, chest.Gold[0], chest.Gold[1]);
        Assert.Contains((await browser.Me()).Gear, owned => owned.InstanceId == gear.InstanceId);

        // Refilled, and the roll of the chance itself: gold alone.
        rolls.Value = Chests.GearChance / 100.0;
        app.Time.Advance(TimeSpan.FromSeconds(chest.RespawnSeconds));
        ChestView again = await browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id });
        Assert.Null(again.Gear);
        Assert.Equal(found.Gold + again.Found, again.Gold);
    }

    [Fact]
    public void The_richest_chests_hold_uncommon_items_and_the_rest_common_ones()
    {
        Assert.Equal("uncommon", Chests.GearRarity(new MapChest { Gold = [Chests.RichChest, 500] }));
        Assert.Equal("common", Chests.GearRarity(new MapChest { Gold = [Chests.RichChest - 1, 500] }));
        Assert.Equal("common", Chests.GearRarity(new MapChest { Gold = [50, 150] }));
    }

    [Fact]
    public async Task A_development_server_decides_the_gear_rolls_when_a_test_asks()
    {
        // No roll comes up by the dice; the test says every one does, then none does.
        await using var app = new RealmApp { Random = new ForcedRolls(1) };
        (Browser browser, MapSpawn spawn, string mob) = await AtSpawn(app, 1, 1);
        await browser.Ok<object>(HttpMethod.Post, "/dev/drop", new { Gear = true });
        EncounterView encounter = await browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = spawn.Id, Mob = mob });
        OutcomeView won = await browser.Ok<OutcomeView>(HttpMethod.Post, "/api/encounter/finish", new { Token = encounter.Token, Log = new[] { "AA==" } });
        Assert.NotNull(won.Gear);

        MapChest chest = RealmApp.Content.World.Chest("0_0:1")!;
        await browser.Put(World, RealmApp.Beside(World, chest.At));
        Assert.NotNull((await browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id })).Gear);

        await browser.Ok<object>(HttpMethod.Post, "/dev/drop", new { Gear = (bool?)null });
        app.Time.Advance(TimeSpan.FromSeconds(chest.RespawnSeconds));
        Assert.Null((await browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id })).Gear);
    }

    [Fact]
    public async Task Every_item_shows_its_points_within_its_rarity_budget()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        ArmorerView shop = await browser.Ok<ArmorerView>(HttpMethod.Get, "/api/armorer/new-benalia");
        Assert.NotEmpty(shop.Stock);
        Assert.All(shop.Stock, item =>
        {
            Assert.InRange(item.Points, -20, item.Budget);
            Assert.Equal(GearItem.Budgets[item.Rarity], item.Budget);
        });
        Assert.All(RealmApp.Content.Gear.Values, item => Assert.True(item.Points <= item.Budget, $"{item.Id}: {item.Points} of {item.Budget}"));

        // gear.md's table: a maximum hand card is 2 points, a life 1, a starting hand card 6.
        Assert.Equal(2, RealmApp.Content.Gear["leather-cap"].Points);
        Assert.Equal(5, RealmApp.Content.Gear["chain-hauberk"].Points);
        Assert.Equal(4, RealmApp.Content.Gear["seers-blindfold"].Points);
    }

    [Fact]
    public async Task The_inventory_counts_every_card_with_its_price_and_what_the_deck_and_ante_use()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        await app.Give(browser, "Serra Angel", 2);
        await browser.ToSpellTable();
        DeckView deck = await browser.Deck();
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { Main = deck.Main, Sideboard = new[] { new CardCount("Serra Angel", 1) } });

        InventoryView inventory = await browser.Ok<InventoryView>(HttpMethod.Get, "/api/inventory");
        IReadOnlyDictionary<string, int> collection = await browser.Collection();
        Assert.Equal(collection.Keys.Order(StringComparer.Ordinal), inventory.Cards.Select(card => card.Name));
        Assert.All(inventory.Cards, card =>
        {
            Assert.Equal(collection[card.Name], card.Count);
            Assert.Equal(RealmApp.Content.Cards.Price(card.Name) ?? 0, card.Gold);
            Assert.Equal(deck.Main.Where(main => main.Name == card.Name).Sum(main => main.Count), card.Deck);
        });
        InventoryCard angel = inventory.Cards.Single(card => card.Name == "Serra Angel");
        Assert.Equal((2, 1, false), (angel.Count, angel.Sideboard, angel.Relic));
        Assert.Equal(inventory.Cards.Sum(card => card.Gold * card.Count), inventory.Value);

        // Anyone else's call has no character.
        Browser stranger = await app.SignIn(9);
        await stranger.Refused(HttpMethod.Get, "/api/inventory", null, HttpStatusCode.NotFound, Codes.NoCharacter);
    }
}
