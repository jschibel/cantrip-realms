using System.Net;
using Cantrip.Decks;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using MessagePack;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// What the card layer reads beside the screens' own calls (interfaces.md, "The realm server's API"): the card faces, a deck
/// checked as it is edited, what a vendor would buy of the character's, and the card layer's origin.
/// </summary>
public sealed class CardLayerApiTests
{
    [Fact]
    public async Task The_catalog_is_every_card_the_engine_plays_as_printed()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        using HttpResponseMessage response = await browser.Send(HttpMethod.Get, "/api/catalog");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/x-msgpack", response.Content.Headers.ContentType?.MediaType);
        CardCatalogView catalog = MessagePackSerializer.Deserialize<CardCatalogView>(await response.Content.ReadAsByteArrayAsync());

        Assert.Equal(RealmApp.Content.Cards.Catalog.Count, catalog.Cards.Count);
        CatalogCard angel = catalog.Cards.Single(card => card.Name == "Serra Angel");
        Assert.Contains("Flying", angel.Card.OracleText, StringComparison.Ordinal);
        Assert.Contains(catalog.Cards, card => card.Name == "Plains");

        // Signed out, nothing.
        HttpClient stranger = app.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync(new Uri("/api/catalog", UriKind.Relative))).StatusCode);
    }

    [Fact]
    public async Task A_deck_is_checked_as_saving_it_would_be_anywhere_the_character_stands()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        await app.Give(browser, "Serra Angel", 2);
        DeckView deck = await browser.Deck();

        // The starter deck as it is, with an Angel anted: legal, and the ante worth the Angel's price - away from any table.
        DeckCheckView fine = await browser.Ok<DeckCheckView>(HttpMethod.Post, "/api/deck/check", new { deck.Main, Ante = new[] { new CardCount("Serra Angel", 1) } });
        Assert.Empty(fine.Problems);
        Assert.Equal(RealmApp.Content.Cards.Price("Serra Angel"), fine.AnteValue);

        // What PUT would refuse it for, in the same words.
        DeckCheckView wrong = await browser.Ok<DeckCheckView>(HttpMethod.Post, "/api/deck/check", new
        {
            Main = new[] { new CardCount("Plains", 39), new CardCount("Lightning Bolt", 1) },
            Ante = new[] { new CardCount("Serra Angel", 3), new CardCount("Plains", 1) },
        });
        Assert.Contains("Lightning Bolt is outside the color identity W.", wrong.Problems);
        Assert.Contains("You don't own Lightning Bolt.", wrong.Problems);
        Assert.Contains("You own 2 Serra Angel; the deck and the ante use 3.", wrong.Problems);
        Assert.Contains("Plains is a basic land, free to every deck: it can't be anted.", wrong.Problems);

        await browser.ToSpellTable();
        ApiError refused = await browser.Refused(HttpMethod.Put, "/api/deck", new
        {
            Main = new[] { new CardCount("Plains", 39), new CardCount("Lightning Bolt", 1) },
            Ante = new[] { new CardCount("Serra Angel", 3), new CardCount("Plains", 1) },
        }, HttpStatusCode.UnprocessableEntity, Codes.IllegalDeck);
        Assert.Equal(wrong.Problems, refused.Problems);
    }

    [Fact]
    public async Task A_vendor_says_what_of_the_characters_it_would_buy_and_for_what()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        await browser.Travel("new-benalia", RealmApp.InnOf("new-benalia").At);
        await app.Give(browser, "Serra Angel", 3);
        await app.Give(browser, "Lightning Bolt", 1);
        DeckView deck = await browser.Deck();
        await browser.ToSpellTable();
        await browser.Ok<DeckView>(HttpMethod.Put, "/api/deck", new { deck.Main, Ante = new[] { new CardCount("Serra Angel", 1) } });
        await browser.Travel("new-benalia", RealmApp.InnOf("new-benalia").At);

        VendorView whites = await browser.Ok<VendorView>(HttpMethod.Get, "/api/vendor/benalia-white-goods");
        CharacterView me = await browser.Me();
        Assert.Equal(me.Gold, whites.Gold);
        BuyingView angel = Assert.Single(whites.Buying, card => card.Name == "Serra Angel");
        Assert.Equal(Pricing.BuyPrice(RealmApp.Content.Cards.Price("Serra Angel")!.Value), angel.Gold);
        Assert.Equal((3, 2), (angel.Owned, angel.Spare));

        // A red card is not a white vendor's trade, and every card it lists is one it would take.
        Assert.DoesNotContain(whites.Buying, card => card.Name == "Lightning Bolt");
        Assert.All(whites.Buying, card => Assert.True(RealmApp.Content.Cards.Fits(card.Name, RealmApp.Content.Vendors["benalia-white-goods"].File.Specialty), card.Name));

        // A starter card all in the deck is listed with none spare, and selling it is refused as the listing says.
        BuyingView used = whites.Buying.First(card => card.Spare == 0 && card.Name != "Serra Angel");
        await browser.Refused(HttpMethod.Post, "/api/vendor/benalia-white-goods/sell", new { used.Name }, HttpStatusCode.Conflict, Codes.InDeck);
        await browser.Ok<TradeView>(HttpMethod.Post, "/api/vendor/benalia-white-goods/sell", new { Name = "Serra Angel" });
        VendorView after = await browser.Ok<VendorView>(HttpMethod.Get, "/api/vendor/benalia-white-goods");
        Assert.Equal((2, 1), after.Buying.Where(card => card.Name == "Serra Angel").Select(card => (card.Owned, card.Spare)).Single());
        Assert.Equal(me.Gold + angel.Gold, after.Gold);
    }

    [Fact]
    public async Task The_card_layers_origin_is_answered_with_the_cookie()
    {
        await using var app = new RealmApp();
        app.Settings["REALMS_CLIENT"] = "http://world.test/";
        app.Settings["REALMS_CARDS"] = "http://cards.test/";
        Browser browser = await app.Character(1, "W");

        foreach (string origin in (string[])["http://cards.test", "http://world.test"])
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/me");
            request.Headers.Add("Origin", origin);
            using HttpResponseMessage response = await browser.Client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(origin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.Equal("true", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Credentials")));
        }

        using var elsewhere = new HttpRequestMessage(HttpMethod.Get, "/api/me");
        elsewhere.Headers.Add("Origin", "http://elsewhere.test");
        using HttpResponseMessage refused = await browser.Client.SendAsync(elsewhere);
        Assert.False(refused.Headers.Contains("Access-Control-Allow-Origin"));
    }
}
