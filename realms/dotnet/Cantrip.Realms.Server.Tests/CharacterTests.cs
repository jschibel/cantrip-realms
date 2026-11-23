using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>Signing in, and a character with its starting kit (design.md A1).</summary>
public sealed class CharacterTests
{
    [Fact]
    public async Task The_api_needs_a_signed_in_player()
    {
        await using var app = new RealmApp();
        using HttpClient anonymous = app.CreateClient();
        using HttpResponseMessage response = await anonymous.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Health_is_answered_without_signing_in()
    {
        await using var app = new RealmApp();
        using HttpClient anonymous = app.CreateClient();
        using HttpResponseMessage response = await anonymous.GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task A_player_without_a_character_is_told_so()
    {
        await using var app = new RealmApp();
        Browser browser = await app.SignIn(1);
        await browser.Refused(HttpMethod.Get, "/api/me", null, HttpStatusCode.NotFound, Codes.NoCharacter);
    }

    [Fact]
    public async Task A_new_character_has_the_starting_kit()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "G", "Ann");
        CharacterView me = await browser.Me();

        Assert.Equal(browser.Player, me.Id);
        Assert.Equal("Ann", me.Name);
        Assert.Equal("broad", me.Body);
        Assert.Equal("G", me.Identity);
        Assert.Equal(0, me.AnteValue);
        Assert.Equal(2000, me.Gold);
        Assert.Empty(me.Unlocked);

        // In the world outside New Benalia's inn, which is their home; no tower attuned.
        Assert.Equal((RealmContent.WorldSpace, RealmApp.Inn("new-benalia").At), (me.Space, new Hex(me.Q, me.R)));
        Assert.Equal(RealmApp.Inn("new-benalia").Id, me.Inn);
        Assert.Empty(me.Attuned);

        // Common gear in three slots, worn, with the stats it gives.
        List<GearInstance> worn = [.. me.Loadout.Values.OfType<GearInstance>()];
        Assert.Equal(3, worn.Count);
        Assert.Equal(3, worn.Select(item => item.Gear.Slot).Distinct().Count());
        Assert.All(worn, item => Assert.Equal("common", item.Gear.Rarity));
        Assert.Equal(worn.Select(item => item.InstanceId).Order(), me.Gear.Select(item => item.InstanceId).Order());
        GearStats expected = Characters.Stats(worn.Select(item => item.Gear));
        Assert.Equal(new StatsView(expected.Life, expected.Hand, expected.MaxHand), me.Stats);

        // The green starter deck, and every card of it but the basics owned, with ten more commons.
        DeckView deck = await browser.Deck();
        Assert.Equal(40, deck.Main.Sum(card => card.Count));
        Assert.Empty(deck.Ante);
        IReadOnlyDictionary<string, int> collection = await browser.Collection();
        Assert.DoesNotContain("Forest", collection.Keys);
        foreach (CardCount card in deck.Main.Where(card => card.Name != "Forest"))
        {
            Assert.True(collection.GetValueOrDefault(card.Name) >= card.Count, card.Name);
        }

        int extra = collection.Values.Sum() - deck.Main.Where(card => card.Name != "Forest").Sum(card => card.Count);
        Assert.Equal(Characters.ExtraCommons, extra);
        Assert.All(collection.Keys, name => Assert.Equal("G", CardPool.Letters(RealmApp.Content.Cards.Catalog[name].Identity)));
    }

    [Fact]
    public async Task A_player_has_one_character()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await browser.Refused(HttpMethod.Post, "/api/character", new { Name = "Again", Body = "lithe", Palette = 0, Color = "U" }, HttpStatusCode.Conflict, Codes.HasCharacter);
    }

    [Theory]
    [InlineData("A", "lithe", 0, "W")]
    [InlineData("Ann", "giant", 0, "W")]
    [InlineData("Ann", "1", 0, "W")]
    [InlineData("Ann", "lithe", 6, "W")]
    [InlineData("Ann", "lithe", 0, "C")]
    public async Task A_character_is_made_of_a_name_a_body_a_palette_and_a_color(string name, string body, int palette, string color)
    {
        await using var app = new RealmApp();
        Browser browser = await app.SignIn(1);
        await browser.Refused(HttpMethod.Post, "/api/character", new { Name = name, Body = body, Palette = palette, Color = color }, HttpStatusCode.BadRequest, "BadRequest");
    }

    [Fact]
    public async Task What_is_stored_reads_back_from_a_new_server()
    {
        var first = new RealmApp();
        Browser browser = await first.Character(1, "B", "Ann");
        CharacterView before = await browser.Me();
        IReadOnlyDictionary<string, int> collection = await browser.Collection();

        // Another server over the same database file.
        string database = await first.Store(db => Task.FromResult(db.Database.GetConnectionString()!));
        await using (first)
        {
            await using var second = new RealmApp();
            second.Settings["REALMS_DATABASE"] = $"sqlite:{database.Replace("Data Source=", string.Empty, StringComparison.Ordinal)}";
            Browser again = await second.SignIn(1, "Ann");
            CharacterView after = await again.Me();
            Assert.Equivalent(before, after, strict: true);
            Assert.Equivalent(collection, await again.Collection(), strict: true);
            Assert.Equal(RealmApp.Content.Vendors.Count, await second.Store(db => db.Vendors.CountAsync()));
        }
    }
}
