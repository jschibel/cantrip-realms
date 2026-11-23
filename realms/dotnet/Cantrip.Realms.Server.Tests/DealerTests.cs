using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// Wares from other planes (design.md A5): the off-plane pool kept apart from all of Dominaria's, the exotic wares shops,
/// and the traveling traders' caravans on their schedule - all on the fake clock.
/// </summary>
public sealed class DealerTests
{
    private const string Exotic = "new-benalia-exotic-wares";
    private const string World = RealmContent.WorldSpace;

    private static string VendorPath(string vendor, string action = "") => $"/api/vendor/{vendor}{action}";

    private static long Now(RealmApp app) => app.Time.GetUtcNow().ToUnixTimeMilliseconds();

    [Fact]
    public void Off_plane_cards_are_in_no_vendor_loot_starter_or_mob_deck_of_dominaria()
    {
        RealmContent content = RealmApp.Content;
        IReadOnlyDictionary<string, IReadOnlyList<string>> offPlane = content.Cards.OffPlane;
        Assert.True(offPlane.Count > 1000);
        HashSet<string> pool = [.. content.Cards.Pool("dominaria")];
        Assert.DoesNotContain(offPlane.Keys, pool.Contains);

        // Every off-plane card is legal in Vintage, priced, no relic, and tagged only with traders' planes.
        foreach ((string name, IReadOnlyList<string> planes) in offPlane)
        {
            Assert.Contains(content.Cards.Prices[name].Vintage, new[] { "legal", "restricted" });
            Assert.False(content.Cards.IsRelic(name), name);
            Assert.All(planes, plane => Assert.Contains(plane, content.TraderPlanes.Keys));
        }

        Assert.Contains("ravnica", offPlane.Values.SelectMany(planes => planes));

        // Dominaria's shops, its mobs' loot and decks and its starter decks hold none.
        Assert.All(content.Vendors.Values.Where(vendor => !vendor.Exotic), vendor => Assert.DoesNotContain(content.Cards.Filter(vendor.Plane, vendor.File.Specialty), content.Cards.IsOffPlane));
        Assert.All(content.Mobs.Values, mob =>
        {
            Assert.DoesNotContain(content.Cards.Filter(mob.File.Loot.Pool ?? mob.Plane, mob.File.Loot), content.Cards.IsOffPlane);
            Assert.DoesNotContain(mob.Deck.Entries, entry => content.Cards.IsOffPlane(entry.Card));
        });
        Assert.All(content.Starters.Values.SelectMany(decks => decks.Values), deck => Assert.DoesNotContain(deck.Entries, entry => content.Cards.IsOffPlane(entry.Card)));

        // The exotic shops are New Benalia's and one more big town's; the traders round the five towns.
        Assert.Equal(["keld", "new-benalia"], content.Vendors.Values.Where(vendor => vendor.Kind == Vendor.ExoticShop).Select(vendor => vendor.File.Town).Order(StringComparer.Ordinal));
        List<Vendor> traders = [.. content.Vendors.Values.Where(vendor => vendor.Kind == Vendor.Traveler)];
        Assert.True(traders.Count >= 10);
        Assert.All(traders, trader => Assert.Equal(["capashen-hold", "keld", "llanowar", "new-benalia", "tolarian-academy"], trader.File.Trader!.Towns.Order(StringComparer.Ordinal)));
        Assert.Equal(traders.Count, traders.Select(trader => trader.File.Trader!.Plane).Distinct().Count());
    }

    [Fact]
    public async Task A_shop_of_dominaria_buys_no_off_plane_card_and_an_exotic_shop_no_card_of_dominaria()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        string offPlane = RealmApp.Content.Cards.OffPlane.Keys.First(name => RealmApp.Content.Cards.Catalog[name].Identity.Count == 0);
        await app.Give(browser, offPlane, 1);
        await app.Give(browser, "Serra Angel", 1);

        await browser.Inside("argive-curio-dealer-shop");
        await browser.Refused(HttpMethod.Post, VendorPath("argive-curio-dealer", "/sell"), new { Name = offPlane }, HttpStatusCode.Conflict, Codes.NotTheirTrade);

        await browser.Inside(Exotic + "-shop");
        VendorView shop = await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(Exotic));
        Assert.Equal(("exotic", (string?)null), (shop.Vendor.Kind, shop.Vendor.Plane));
        Assert.Equal([offPlane], shop.Buying.Select(card => card.Name));
        await browser.Refused(HttpMethod.Post, VendorPath(Exotic, "/sell"), new { Name = "Serra Angel" }, HttpStatusCode.Conflict, Codes.NotTheirTrade);
    }

    [Fact]
    public async Task An_exotic_shop_shows_six_cards_gains_one_every_six_hours_and_lets_one_go_after_three_days()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        await browser.Inside(Exotic + "-shop");
        await app.Store(db => db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, 10_000_000)));

        VendorView first = await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(Exotic));
        Assert.Equal(Vendors.ExoticShown, first.Stock.Sum(item => item.Count));
        Assert.All(first.Stock, item =>
        {
            Assert.True(RealmApp.Content.Cards.IsOffPlane(item.Name), item.Name);
            Assert.True(item.Until <= app.Time.GetUtcNow() + Vendors.ExoticShelf, item.Name);
        });

        // A card bought leaves a gap, filled at the next six-hour mark (noon, from half past ten) and not before.
        await browser.Ok<TradeView>(HttpMethod.Post, VendorPath(Exotic, "/buy"), new { first.Stock[0].Name });
        app.Time.Advance(TimeSpan.FromMinutes(89));
        Assert.Equal(Vendors.ExoticShown - 1, (await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(Exotic))).Stock.Sum(item => item.Count));
        app.Time.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal(Vendors.ExoticShown, (await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(Exotic))).Stock.Sum(item => item.Count));

        // Full, it buys nothing: a card sold would be a seventh.
        string offPlane = RealmApp.Content.Cards.OffPlane.Keys.First(name => RealmApp.Content.Cards.Catalog[name].Identity.Count == 0);
        await app.Give(browser, offPlane, 1);
        await browser.Refused(HttpMethod.Post, VendorPath(Exotic, "/sell"), new { Name = offPlane }, HttpStatusCode.Conflict, Codes.VendorFull);

        // Days on, every card shown came within three days and fewer than seven are shown at once.
        for (int hours = 0; hours < 24 * 5; hours += 5)
        {
            app.Time.Advance(TimeSpan.FromHours(5));
            VendorView later = await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(Exotic));
            Assert.InRange(later.Stock.Sum(item => item.Count), 1, Vendors.ExoticShown);
            Assert.All(later.Stock, item => Assert.True(item.Until > app.Time.GetUtcNow() && item.Until <= app.Time.GetUtcNow() + Vendors.ExoticShelf, item.Name));
        }

        Assert.DoesNotContain((await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(Exotic))).Stock, item => first.Stock.Skip(1).Any(seeded => seeded.Name == item.Name && seeded.Until == item.Until));
    }

    [Fact]
    public async Task The_travelers_schedule_is_the_dates_and_everyone_sees_it()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        TravelersView view = await browser.Ok<TravelersView>(HttpMethod.Get, "/api/travelers");
        List<Vendor> traders = [.. RealmApp.Content.Vendors.Values.Where(vendor => vendor.Kind == Vendor.Traveler).OrderBy(vendor => vendor.Id, StringComparer.Ordinal)];
        Assert.Equal(traders.Select(trader => trader.Id), view.Travelers.Select(traveler => traveler.Id));

        long now = Now(app);
        long day = now / 86_400_000;
        foreach ((Vendor trader, TravelerView seen) in traders.Zip(view.Travelers))
        {
            TraderRound round = trader.File.Trader!;
            Assert.Equal(round.Plane, seen.Plane);
            Travelers.Visit today = Travelers.On(round, day);
            Assert.Equal(round.Towns[(int)(day % round.Towns.Count)], today.Town);
            bool there = now >= today.From && now < today.Until;
            Assert.Equal(there ? today.Town : null, seen.Visit?.Town);
            Assert.True(seen.Next.From > app.Time.GetUtcNow());
            Assert.Equal(TimeSpan.FromHours(round.Hours), seen.Next.Until - seen.Next.From);

            // Tomorrow the caravan is in the next town of its round.
            Assert.Equal(round.Towns[(int)((day + 1) % round.Towns.Count)], Travelers.On(round, day + 1).Town);
        }

        // At half past ten some caravans are in town, the morning's gone and the afternoon's to come.
        Assert.Contains(view.Travelers, traveler => traveler.Visit is not null);
        Assert.Contains(view.Travelers, traveler => traveler.Visit is null);
    }

    [Fact]
    public async Task A_trader_trades_only_while_its_caravan_is_in_the_characters_town_and_takes_its_wares_away()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        await app.Store(db => db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, 10_000_000)));

        // A caravan in town at half past ten.
        Vendor trader = RealmApp.Content.Vendors.Values.Where(vendor => vendor.Kind == Vendor.Traveler)
            .OrderBy(vendor => vendor.Id, StringComparer.Ordinal).First(vendor => Travelers.Current(vendor.File.Trader!, Now(app)) is not null);
        TraderRound round = trader.File.Trader!;
        Travelers.Visit visit = Travelers.Current(round, Now(app))!;
        TownEntry town = RealmApp.Content.Towns[visit.Town];
        TownEntry elsewhere = RealmApp.Content.Towns[round.Towns.First(other => other != visit.Town)];

        // Not from another town, nor from the wilds.
        await browser.Put(World, elsewhere.At);
        await browser.Refused(HttpMethod.Get, VendorPath(trader.Id), null, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Put(World, new Hex(120, 120));
        await browser.Refused(HttpMethod.Get, VendorPath(trader.Id), null, HttpStatusCode.Conflict, Codes.NotNear);

        // In its town, in the street or in a building of it: three cards of its plane, leaving when the caravan does.
        await browser.Put(World, town.At);
        VendorView wares = await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(trader.Id));
        Assert.Equal(("trader", round.Plane, visit.Town), (wares.Vendor.Kind, wares.Vendor.Plane, wares.Vendor.Town));
        Assert.Equal(Travelers.Brought, wares.Stock.Sum(item => item.Count));
        Assert.All(wares.Stock, item =>
        {
            Assert.Contains(round.Plane, RealmApp.Content.Cards.OffPlane[item.Name]);
            Assert.Equal(DateTimeOffset.FromUnixTimeMilliseconds(visit.Until), item.Until);
        });
        await browser.Inside(RealmApp.Content.Interiors.Values.First(interior => interior.Town?.Id == town.Id).Id);
        Assert.Equal(wares.Stock.Select(item => item.Name), (await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(trader.Id))).Stock.Select(item => item.Name));

        // It buys any off-plane card, and goes off with it; no card of Dominaria.
        string offPlane = RealmApp.Content.Cards.OffPlane.Keys.First(name => !RealmApp.Content.Cards.OffPlane[name].Contains(round.Plane));
        await app.Give(browser, offPlane, 1);
        await app.Give(browser, "Serra Angel", 1);
        await browser.Refused(HttpMethod.Post, VendorPath(trader.Id, "/sell"), new { Name = "Serra Angel" }, HttpStatusCode.Conflict, Codes.NotTheirTrade);
        await browser.Ok<TradeView>(HttpMethod.Post, VendorPath(trader.Id, "/sell"), new { Name = offPlane });
        await browser.Ok<TradeView>(HttpMethod.Post, VendorPath(trader.Id, "/buy"), new { wares.Stock[0].Name });
        VendorView after = await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(trader.Id));
        Assert.Equal(Travelers.Brought, after.Stock.Sum(item => item.Count));
        Assert.Contains(after.Stock, item => item.Name == offPlane && item.Until == DateTimeOffset.FromUnixTimeMilliseconds(visit.Until));

        // The caravan leaves: no trade until its next visit, in the next town, which brings three new cards.
        app.Time.Advance(DateTimeOffset.FromUnixTimeMilliseconds(visit.Until) - app.Time.GetUtcNow());
        await browser.Refused(HttpMethod.Get, VendorPath(trader.Id), null, HttpStatusCode.Conflict, Codes.NotNear);
        Travelers.Visit next = Travelers.Next(round, Now(app));
        Assert.NotEqual(visit.Town, next.Town);
        app.Time.Advance(DateTimeOffset.FromUnixTimeMilliseconds(next.From) - app.Time.GetUtcNow());
        await browser.Put(World, RealmApp.Content.Towns[next.Town].At);
        VendorView tomorrow = await browser.Ok<VendorView>(HttpMethod.Get, VendorPath(trader.Id));
        Assert.Equal(Travelers.Brought, tomorrow.Stock.Sum(item => item.Count));
        Assert.All(tomorrow.Stock, item => Assert.Equal(DateTimeOffset.FromUnixTimeMilliseconds(next.Until), item.Until));
    }
}
