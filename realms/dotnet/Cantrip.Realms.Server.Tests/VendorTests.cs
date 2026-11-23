using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>Card vendors (design.md A5): specialty, prices, the purse, the stock, the hourly trickle and rotation.</summary>
public sealed class VendorTests
{
    /// <summary>New Benalia's white goods: a vendor of every white card.</summary>
    private const string Whites = "benalia-white-goods";

    /// <summary>A player with a character, inside the white goods' shop in New Benalia.</summary>
    private static async Task<Browser> Shopper(RealmApp app, ulong id, string color = "W", string name = "Tester")
    {
        Browser browser = await app.Character(id, color, name);
        await browser.Inside(Whites + "-shop");
        return browser;
    }

    private static string Path(string vendor, string action = "") => $"/api/vendor/{vendor}{action}";

    /// <summary>A card of the vendor's stock that the player can afford, and its price.</summary>
    private static (string Name, long Gold) Cheapest(VendorView view) =>
        view.Stock.OrderBy(item => item.Gold).Select(item => (item.Name, item.Gold)).First();

    private static Task<int> Stocked(RealmApp app, string vendor, string? source = null) =>
        app.Store(db => db.VendorStock.Where(item => item.VendorId == vendor && (source == null || item.Source == source)).SumAsync(item => item.Count));

    private static Task<VendorRow> Row(RealmApp app, string vendor) => app.Store(db => db.Vendors.AsNoTracking().SingleAsync(row => row.Id == vendor));

    [Fact]
    public async Task A_new_vendor_has_its_purse_and_twelve_seeded_cards_of_its_specialty()
    {
        await using var app = new RealmApp();
        Browser browser = await Shopper(app, 1);
        VendorView view = await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));

        Assert.Equal(50_000, view.Purse);
        Assert.Equal(Vendors.SeededAtCreation, view.Stock.Sum(item => item.Count));
        Vendor vendor = RealmApp.Content.Vendors[Whites];
        Assert.All(view.Stock, item =>
        {
            Assert.True(RealmApp.Content.Cards.Fits(item.Name, vendor.File.Specialty), item.Name);
            Assert.Equal(RealmApp.Content.Cards.Price(item.Name), item.Gold);
            Assert.Equal(RealmApp.Start + Vendors.Shelf, item.Until);
        });
    }

    [Fact]
    public async Task A_vendor_trades_in_its_own_shop()
    {
        await using var app = new RealmApp();
        Browser browser = await Shopper(app, 1);

        // Not in the street outside, nor in the town's other shop.
        await browser.Put(RealmContent.WorldSpace, RealmApp.Inn("new-benalia").At);
        await browser.Refused(HttpMethod.Get, Path(Whites), null, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Inside("benalia-soldiers-shop");
        await browser.Refused(HttpMethod.Get, Path(Whites), null, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Refused(HttpMethod.Get, Path("nobody"), null, HttpStatusCode.NotFound, Codes.NoVendor);
    }

    [Fact]
    public async Task Buying_moves_gold_to_the_purse_and_the_card_to_the_collection()
    {
        await using var app = new RealmApp();
        Browser browser = await Shopper(app, 1);
        VendorView before = await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        (string name, long gold) = Cheapest(before);
        int owned = (await browser.Collection()).GetValueOrDefault(name);

        TradeView traded = await browser.Ok<TradeView>(HttpMethod.Post, Path(Whites, "/buy"), new { Name = name });
        Assert.Equal(Characters.StartingGold - gold, traded.Gold);
        Assert.Equal(owned + 1, traded.Collection.Cards[name]);

        VendorView after = await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(before.Purse + gold, after.Purse);
        Assert.Equal(before.Stock.Sum(item => item.Count) - 1, after.Stock.Sum(item => item.Count));
    }

    [Fact]
    public async Task A_purchase_the_player_cannot_afford_changes_nothing()
    {
        await using var app = new RealmApp();
        Browser browser = await Shopper(app, 1);
        VendorView before = await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        (string name, long gold) = Cheapest(before);
        await app.Store(db => db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, gold - 1)));
        IReadOnlyDictionary<string, int> collection = await browser.Collection();

        await browser.Refused(HttpMethod.Post, Path(Whites, "/buy"), new { Name = name }, HttpStatusCode.Conflict, Codes.CannotAfford);

        // The copy taken off the shelf inside the transaction is back on it.
        VendorView after = await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(before.Purse, after.Purse);
        Assert.Equal(before.Stock.Sum(item => item.Count), after.Stock.Sum(item => item.Count));
        Assert.Equal(gold - 1, (await browser.Me()).Gold);
        Assert.Equivalent(collection, await browser.Collection(), strict: true);
    }

    [Fact]
    public async Task Two_players_racing_for_the_last_copy_do_not_both_get_it()
    {
        await using var app = new RealmApp();
        Browser ann = await Shopper(app, 1, name: "Ann");
        Browser bob = await Shopper(app, 2, name: "Bob");
        VendorView view = await ann.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        (string name, _) = Cheapest(view);

        // One copy of it on the shelf.
        await app.Store(async db =>
        {
            await db.VendorStock.Where(item => item.VendorId == Whites && item.Name == name).ExecuteDeleteAsync();
            db.VendorStock.Add(new VendorStockRow { VendorId = Whites, Name = name, Count = 1, Source = VendorStockRow.Sold });
            await db.SaveChangesAsync();
        });

        HttpResponseMessage[] answers = await Task.WhenAll(
            ann.Send(HttpMethod.Post, Path(Whites, "/buy"), new { Name = name }),
            bob.Send(HttpMethod.Post, Path(Whites, "/buy"), new { Name = name }));
        Assert.Equal(1, answers.Count(answer => answer.StatusCode == HttpStatusCode.OK));
        Assert.Equal(1, answers.Count(answer => answer.StatusCode == HttpStatusCode.Conflict));
        foreach (HttpResponseMessage answer in answers) answer.Dispose();
        long spent = (2 * Characters.StartingGold) - (await ann.Me()).Gold - (await bob.Me()).Gold;
        Assert.Equal(RealmApp.Content.Cards.Price(name), spent);
    }

    [Fact]
    public async Task Selling_pays_half_and_shelves_the_card_at_full_price_until_bought()
    {
        await using var app = new RealmApp();
        Browser browser = await Shopper(app, 1);
        await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        (string name, int owned) = await Spare(app, browser);
        long price = RealmApp.Content.Cards.Price(name)!.Value;

        TradeView traded = await browser.Ok<TradeView>(HttpMethod.Post, Path(Whites, "/sell"), new { Name = name });
        Assert.Equal(Characters.StartingGold + Pricing.BuyPrice(price), traded.Gold);
        Assert.Equal(owned - 1, traded.Collection.Cards.GetValueOrDefault(name));

        VendorView after = await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(50_000 - Pricing.BuyPrice(price), after.Purse);
        StockView shelved = Assert.Single(after.Stock, item => item.Name == name && item.Until is null);
        Assert.Equal(price, shelved.Gold);

        // A day later the seeded cards are gone, and the sold one is still there.
        app.Time.Advance(TimeSpan.FromHours(25));
        VendorView later = await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Contains(later.Stock, item => item.Name == name && item.Until is null);
    }

    /// <summary>A white card the player owns a copy of beyond their deck, given if need be.</summary>
    private static async Task<(string Name, int Owned)> Spare(RealmApp app, Browser browser)
    {
        const string name = "Serra Angel";
        int owned = (await browser.Collection()).GetValueOrDefault(name);
        await app.Give(browser, name, 2);
        Assert.True(RealmApp.Content.Cards.Fits(name, RealmApp.Content.Vendors[Whites].File.Specialty));
        return (name, owned + 2);
    }

    [Fact]
    public async Task A_vendor_buys_only_its_trade_and_only_cards_outside_the_deck()
    {
        await using var app = new RealmApp();
        Browser browser = await Shopper(app, 1, "W");
        await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));

        // The soldiers' trade is soldiers; an angel is not.
        await browser.Inside("benalia-soldiers-shop");
        await browser.Refused(HttpMethod.Post, Path("benalia-soldiers", "/sell"), new { Name = "Serra Angel" }, HttpStatusCode.Conflict, Codes.NotTheirTrade);
        await browser.Inside(Whites + "-shop");

        // Every copy of a starter card is in the deck.
        DeckView deck = await browser.Deck();
        IReadOnlyDictionary<string, int> owned = await browser.Collection();
        CardCount all = deck.Main.First(card => card.Name != "Plains" && owned[card.Name] == card.Count && RealmApp.Content.Cards.Fits(card.Name, RealmApp.Content.Vendors[Whites].File.Specialty));
        await browser.Refused(HttpMethod.Post, Path(Whites, "/sell"), new { Name = all.Name }, HttpStatusCode.Conflict, Codes.InDeck);
        await browser.Refused(HttpMethod.Post, Path(Whites, "/sell"), new { Name = "Serra Angel" }, HttpStatusCode.Conflict, Codes.NotOwned);
    }

    [Fact]
    public async Task A_vendor_with_too_small_a_purse_or_full_shelves_buys_nothing()
    {
        await using var app = new RealmApp();
        Browser browser = await Shopper(app, 1);
        await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        (string name, int owned) = await Spare(app, browser);

        await app.Store(db => db.Vendors.Where(row => row.Id == Whites).ExecuteUpdateAsync(set => set.SetProperty(row => row.Purse, 1)));
        await browser.Refused(HttpMethod.Post, Path(Whites, "/sell"), new { Name = name }, HttpStatusCode.Conflict, Codes.VendorCannotAfford);

        await app.Store(async db =>
        {
            await db.Vendors.Where(row => row.Id == Whites).ExecuteUpdateAsync(set => set.SetProperty(row => row.Purse, 50_000));
            db.VendorStock.Add(new VendorStockRow { VendorId = Whites, Name = "Benalish Hero", Count = Vendors.MostSold, Source = VendorStockRow.Sold });
            await db.SaveChangesAsync();
        });
        await browser.Refused(HttpMethod.Post, Path(Whites, "/sell"), new { Name = name }, HttpStatusCode.Conflict, Codes.VendorFull);
        Assert.Equal(owned, (await browser.Collection())[name]);
    }

    [Fact]
    public async Task Each_hour_the_purse_trickles_in_with_the_visitors_of_the_hour_before()
    {
        await using var app = new RealmApp();
        Browser ann = await Shopper(app, 1, name: "Ann");
        Browser bob = await Shopper(app, 2, name: "Bob");

        // 10:30 - two visitors this hour (Ann twice).
        await ann.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        await ann.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        await bob.Ok<VendorView>(HttpMethod.Get, Path(Whites));

        // 11:00 counts them; 12:00 counts nobody.
        app.Time.Advance(TimeSpan.FromMinutes(31));
        VendorView eleven = await ann.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(50_000 + Vendors.HourlyTrickle + (2 * Vendors.PerVisitor), eleven.Purse);

        app.Time.Advance(TimeSpan.FromHours(1));
        VendorView noon = await bob.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(eleven.Purse + Vendors.HourlyTrickle + Vendors.PerVisitor, noon.Purse);
    }

    [Fact]
    public async Task The_purse_stops_at_its_ceiling()
    {
        await using var app = new RealmApp();
        Browser browser = await Shopper(app, 1);
        await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        await app.Store(db => db.Vendors.Where(row => row.Id == Whites).ExecuteUpdateAsync(set => set.SetProperty(row => row.Purse, Vendors.PurseCeiling - 500)));

        app.Time.Advance(TimeSpan.FromHours(3));
        VendorView view = await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(Vendors.PurseCeiling, view.Purse);
    }

    [Fact]
    public async Task Three_cards_come_in_each_hour_and_leave_after_a_day()
    {
        await using var app = new RealmApp();
        Browser browser = await Shopper(app, 1);
        await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(12, await Stocked(app, Whites, VendorStockRow.Seeded));

        // 10:30 to 15:30: five hours turned, fifteen cards in.
        app.Time.Advance(TimeSpan.FromHours(5));
        await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(15, await Stocked(app, Whites, VendorStockRow.Rotated));
        Assert.Equal(12, await Stocked(app, Whites, VendorStockRow.Seeded));

        // To 10:30 the next day: the seeded cards have left, and 24 hours of rotation stand.
        app.Time.Advance(TimeSpan.FromHours(19));
        VendorView day = await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(0, await Stocked(app, Whites, VendorStockRow.Seeded));
        Assert.Equal(24 * Vendors.RotatedEachHour, await Stocked(app, Whites, VendorStockRow.Rotated));
        Assert.All(day.Stock, item => Assert.True(item.Until > app.Time.GetUtcNow()));

        // A week away: still only the last day's cards.
        app.Time.Advance(TimeSpan.FromDays(7));
        await browser.Ok<VendorView>(HttpMethod.Get, Path(Whites));
        Assert.Equal(24 * Vendors.RotatedEachHour, await Stocked(app, Whites, VendorStockRow.Rotated));
    }

    [Fact]
    public async Task The_clock_brings_every_vendor_up_to_the_hour_with_nobody_looking()
    {
        await using var app = new RealmApp { Clock = true };
        Browser browser = await Shopper(app, 1);
        long hour = (await Row(app, Whites)).Hour;

        app.Time.Advance(TimeSpan.FromMinutes(30));
        await WaitFor(async () => (await Row(app, Whites)).Hour == hour + 1);
        foreach (Vendor vendor in RealmApp.Content.Vendors.Values)
        {
            VendorRow row = await Row(app, vendor.Id);
            Assert.Equal(hour + 1, row.Hour);
            Assert.Equal(vendor.File.Purse + Vendors.HourlyTrickle, row.Purse);
        }
    }

    /// <summary>Waits for the clock's work, which runs on its own: the fake clock has moved, and the work follows at once.</summary>
    private static async Task WaitFor(Func<Task<bool>> done)
    {
        for (int i = 0; i < 200; i++)
        {
            if (await done()) return;
            await Task.Yield();
            await Task.Delay(TimeSpan.FromMilliseconds(25), TimeProvider.System);
        }

        Assert.Fail("The clock's work never happened.");
    }
}
