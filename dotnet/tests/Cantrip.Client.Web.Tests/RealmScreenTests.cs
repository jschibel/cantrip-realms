using System.Text.Json;
using Xunit;

namespace Cantrip.Client.Web.Tests;

/// <summary>
/// Cantrip Realms' card screens (realms/docs/interfaces.md, "The card layer"), each asked for through the bridge as the
/// overworld asks, against the real realm server, and clicked as a player clicks them: the duel played on the rules engine
/// in the page and its log checked by the server's replay, the loot pick, the spell table, a vendor, and the gear screen
/// with an armorer's.
/// </summary>
[Collection(WebClientCollection.Name)]
public sealed class RealmScreenTests(WebClient web, RealmSite site) : IClassFixture<RealmSite>, IAsyncLifetime
{
    private static string Pictures => WebClient.Pictures(nameof(RealmScreenTests));

    private readonly RealmSite _site = site;

    public Task InitializeAsync() => _site.StartAsync(web);

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>Starts an encounter with the Phyrexian Scout of Benalish Meadow, the one mob its first spawn holds: the duel screen's args.</summary>
    private static async Task<(object Args, string Token)> Encounter(RealmPage realm)
    {
        await realm.OkAsync(HttpMethod.Post, "travel", new { Map = "benalish-meadow", Q = 6, R = 3 });
        JsonElement start = await realm.OkAsync(HttpMethod.Post, "encounter/start", new { Map = "benalish-meadow", Spawn = "s1", Mob = "phyrexian-scout" });
        string token = start.GetProperty("Token").GetString()!;
        return (new
        {
            token,
            seed = start.GetProperty("Seed").GetInt64(),
            duel = start.GetProperty("Duel"),
            mob = new { id = "phyrexian-scout", name = "Phyrexian Scout", tier = 1, map = "benalish-meadow", spawn = "s1" },
        }, token);
    }

    private static string[] Log(JsonElement closed) =>
        [.. closed.GetProperty("result").GetProperty("log").EnumerateArray().Select(line => line.GetString()!)];

    [Fact]
    public async Task A_conceded_duel_closes_as_lost_with_a_log_the_server_replays_to_the_same_end()
    {
        (object Args, string Token) encounter = (new object(), string.Empty);
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 101, "W", Pictures, async page => encounter = await Encounter(page));
        int id = await realm.OpenScreenAsync("duel", encounter.Args);

        // The table is dealt in the page, the mob's seat answering in it; the player concedes from the duel's bar.
        await realm.SettledAsync(state => state.Realm?.Duel is { Over: false } && !string.IsNullOrEmpty(state.Prompt), within: TimeSpan.FromMinutes(2));
        await realm.PictureAsync("duel-dealt");
        await realm.ClickAsync("Concede");
        RealmState asked = await realm.SettledAsync(state => state.Controls.Any(c => c.Label == "Play on"));
        Assert.Contains(asked.Controls, control => control.Label == "Concede");
        await realm.ClickAsync("Play on");
        await realm.SettledAsync(state => !state.Controls.Any(c => c.Label == "Play on"));
        await realm.ClickAsync("Concede");
        await realm.SettledAsync(state => state.Controls.Any(c => c.Label == "Play on"));
        RealmState confirming = await realm.StateAsync() ?? throw new Xunit.Sdk.XunitException("No state.");
        ControlState really = confirming.Controls.Where(c => c.Label == "Concede").OrderByDescending(c => c.Y).First();
        await realm.Page.Mouse.ClickAsync(really.X, really.Y);

        JsonElement closed = await realm.ClosedAsync(id);
        Assert.Equal("lost", closed.GetProperty("outcome").GetString());
        string[] log = Log(closed);
        Assert.NotEmpty(log);

        // The contract: the server deals the same duel, plays the log back with the mob answered the same way, and comes to
        // the same end - a whole game the mob won, so the log is taken and the duel is lost, not rejected.
        JsonElement outcome = await realm.OkAsync(HttpMethod.Post, "encounter/finish", new { encounter.Token, Log = log });
        Assert.Equal("lost", outcome.GetProperty("Outcome").GetString());
        Assert.Equal("The mob won.", outcome.GetProperty("Detail").GetString());
        Assert.Empty(realm.Errors);
    }

    [Fact]
    public async Task A_duel_played_out_in_the_page_ends_as_the_servers_replay_of_its_log_does()
    {
        // Forty Plains and nothing else, played by the page itself (?auto): the mob's creatures win it in a few turns.
        (object Args, string Token) encounter = (new object(), string.Empty);
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 102, "W", Pictures, async page =>
        {
            (int q, int r) = RealmSite.BesideNpc("new-argive", "spell-table");
            await page.OkAsync(HttpMethod.Post, "travel", new { Map = "new-argive", Q = q, R = r });
            await page.OkAsync(HttpMethod.Put, "deck", new { Main = new[] { new { Name = "Plains", Count = 40 } }, Ante = Array.Empty<object>() });
            encounter = await Encounter(page);
        }, query: "&auto");
        int id = await realm.OpenScreenAsync("duel", encounter.Args);

        RealmState over = await realm.SettledAsync(state => state.Realm?.Duel is { Ended: true }, within: TimeSpan.FromMinutes(6));
        await realm.PictureAsync("duel-over");
        Assert.True(over.Realm!.Duel!.Settled);
        bool won = over.Realm.Duel.Won;
        Assert.Equal(won ? "Victory" : "Defeat", over.Realm.Duel.End);
        await realm.ClickAsync("Return to the world");

        JsonElement closed = await realm.ClosedAsync(id);
        Assert.Equal(won ? "won" : "lost", closed.GetProperty("outcome").GetString());
        string[] log = Log(closed);
        Assert.True(log.Length > 5, $"A whole game's log, not {log.Length} messages.");
        JsonElement outcome = await realm.OkAsync(HttpMethod.Post, "encounter/finish", new { encounter.Token, Log = log });
        Assert.Equal(closed.GetProperty("outcome").GetString(), outcome.GetProperty("Outcome").GetString());
        // Taken, not rejected: a win says nothing more, a loss who won.
        Assert.Equal(won ? null : "The mob won.", outcome.GetProperty("Detail").ValueKind == JsonValueKind.Null ? null : outcome.GetProperty("Detail").GetString());
        Assert.Empty(realm.Errors);
    }

    [Fact]
    public async Task The_loot_screen_hands_back_the_cards_taken_within_the_cap()
    {
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 103, "W", Pictures);
        int id = await realm.OpenScreenAsync("loot", new
        {
            token = "t",
            offer = new[] { new { Name = "Serra Angel", Gold = 200 }, new { Name = "Benalish Hero", Gold = 50 }, new { Name = "Llanowar Elves", Gold = 100 } },
            cap = 260,
            mob = "Phyrexian Scout",
        });

        await realm.SettledAsync(state => state.Realm?.Loot is not null && state.Cards.Count(card => card.Row == "loot") == 3);
        await realm.PictureAsync("loot");
        await realm.ClickCardAsync("Serra Angel", "loot");
        await realm.SettledAsync(state => state.Realm?.Loot?.Taken == 200);

        // The Elves would take it over the cap: refused, in words.
        await realm.ClickCardAsync("Llanowar Elves", "loot");
        RealmState over = await realm.SettledAsync(state => state.Realm?.Status.Contains("over the cap", StringComparison.Ordinal) == true);
        Assert.Equal(["Serra Angel"], over.Realm!.Loot!.Picked);

        await realm.ClickCardAsync("Benalish Hero", "loot");
        await realm.SettledAsync(state => state.Realm?.Loot?.Taken == 250);
        await realm.ClickAsync("Take");
        JsonElement closed = await realm.ClosedAsync(id);
        Assert.Equal("closed", closed.GetProperty("outcome").GetString());
        Assert.Equal(["Serra Angel", "Benalish Hero"], closed.GetProperty("result").GetProperty("picks").EnumerateArray().Select(pick => pick.GetString()));
        Assert.Empty(realm.Errors);
    }

    [Fact]
    public async Task The_spell_table_edits_the_deck_and_the_ante_from_the_collection_and_saves_them()
    {
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 104, "W", Pictures, async page =>
        {
            (int q, int r) = RealmSite.BesideNpc("new-argive", "spell-table");
            await page.OkAsync(HttpMethod.Post, "travel", new { Map = "new-argive", Q = q, R = r });
        });
        JsonElement deck = await realm.OkAsync(HttpMethod.Get, "deck");
        int id = await realm.OpenScreenAsync("spell-table", new { map = "new-argive", name = "the spell table at New Argive" });

        RealmState table = await realm.SettledAsync(state => state.DeckEditor is { } editor && editor.Main.Count > 0 && editor.Status.StartsWith("Legal", StringComparison.Ordinal));
        await realm.PictureAsync("spell-table");
        Assert.Equal(40, deck.GetProperty("Main").EnumerateArray().Sum(card => card.GetProperty("Count").GetInt32()));
        Assert.Empty(table.DeckEditor!.Side);

        // The search is the collection: every card owned, and free basic lands of the character's color only.
        await realm.TypeAsync("Search cards: name, type or rules text", "Island");
        await realm.SettledAsync(state => state.DeckEditor?.Results == 0);
        foreach (char _ in "Island")
        {
            await realm.Page.Keyboard.PressAsync("Backspace");
        }

        await realm.Page.Keyboard.TypeAsync("Plains", new Microsoft.Playwright.KeyboardTypeOptions { Delay = 30 });
        table = await realm.SettledAsync(state => state.Cards.Any(card => card.Row == "search" && card.Name == "Plains"));
        Assert.Contains(table.Cards, card => card.Row == "search" && card.Name == "Plains");

        // A card of the deck double-clicked into the ante: thirty-nine cards, which the server says is too few.
        string anted = deck.GetProperty("Main").EnumerateArray().Select(card => card.GetProperty("Name").GetString()!).First(name => name != "Plains");
        CardState card = await realm.CardAsync(anted, "pool");
        await realm.Page.Mouse.DblClickAsync(card.X, card.Y);
        RealmState short_ = await realm.SettledAsync(state => state.DeckEditor is { } editor && editor.Side.Count > 0 && editor.Problems.Any(problem => problem.Contains("at least 40", StringComparison.Ordinal)));
        Assert.Contains(short_.DeckEditor!.Side, line => line.Contains(anted, StringComparison.Ordinal));

        // A Plains from the search makes forty again.
        CardState plains = await realm.CardAsync("Plains", "search");
        await realm.Page.Mouse.DblClickAsync(plains.X, plains.Y);
        await realm.SettledAsync(state => state.DeckEditor is { } editor && editor.Problems.Count == 0 && editor.Status.StartsWith("Legal", StringComparison.Ordinal));
        await realm.ClickAsync("Save");
        await realm.SettledAsync(state => state.DeckEditor?.Status.StartsWith("Saved", StringComparison.Ordinal) == true);
        await realm.PictureAsync("spell-table-saved");

        JsonElement saved = await realm.OkAsync(HttpMethod.Get, "deck");
        Assert.Equal([anted], saved.GetProperty("Ante").EnumerateArray().Select(entry => entry.GetProperty("Name").GetString()));
        Assert.Equal(40, saved.GetProperty("Main").EnumerateArray().Sum(entry => entry.GetProperty("Count").GetInt32()));
        Assert.True(saved.GetProperty("AnteValue").GetInt64() > 0);

        await realm.ClickAsync("Done");
        Assert.Equal("closed", (await realm.ClosedAsync(id)).GetProperty("outcome").GetString());
        Assert.Empty(realm.Errors);
    }

    [Fact]
    public async Task The_vendor_screen_buys_and_sells_through_the_api_and_says_a_refusal_in_words()
    {
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 105, "W", Pictures, async page =>
        {
            (int q, int r) = RealmSite.Inn("new-benalia");
            await page.OkAsync(HttpMethod.Post, "travel", new { Map = "new-benalia", Q = q, R = r });
        });
        JsonElement shop = await realm.OkAsync(HttpMethod.Get, "vendor/benalia-white-goods");
        JsonElement cheapest = shop.GetProperty("Stock").EnumerateArray().OrderBy(item => item.GetProperty("Gold").GetInt64()).First();
        string name = cheapest.GetProperty("Name").GetString()!;
        int id = await realm.OpenScreenAsync("vendor", new { id = "benalia-white-goods", name = "White goods" });

        await realm.SettledAsync(state => state.Cards.Any(card => card.Row == "stock") && state.Cards.Any(card => card.Row == "buying"));
        await realm.PictureAsync("vendor");
        await realm.ClickCardAsync(name, "stock");
        await realm.ClickAsync("Buy");
        RealmState bought = await realm.SettledAsync(state => state.Realm?.Status.StartsWith("You bought", StringComparison.Ordinal) == true);
        Assert.Contains(name, bought.Realm!.Status, StringComparison.Ordinal);
        JsonElement owned = await realm.OkAsync(HttpMethod.Get, "collection");
        Assert.True(owned.GetProperty("Cards").GetProperty(name).GetInt32() >= 1);

        // A card of the starter deck, every copy in the deck: the vendor's refusal, as the server words it.
        JsonElement after = await realm.OkAsync(HttpMethod.Get, "vendor/benalia-white-goods");
        string used = after.GetProperty("Buying").EnumerateArray().First(card => card.GetProperty("Spare").GetInt32() == 0).GetProperty("Name").GetString()!;
        await realm.ClickCardAsync(used, "buying");
        await realm.ClickAsync("Sell");
        RealmState refused = await realm.SettledAsync(state => state.Realm?.Status.Contains("in your deck or your ante", StringComparison.Ordinal) == true);
        Assert.Contains(used, refused.Realm!.Status, StringComparison.Ordinal);

        // The card bought, sold back at half its price.
        await realm.ClickCardAsync(name, "buying");
        await realm.ClickAsync("Sell");
        await realm.SettledAsync(state => state.Realm?.Status.StartsWith("You sold", StringComparison.Ordinal) == true);
        await realm.PictureAsync("vendor-sold");
        JsonElement me = await realm.OkAsync(HttpMethod.Get, "me");
        long price = cheapest.GetProperty("Gold").GetInt64();
        Assert.Equal(2000 - price + (price / 2), me.GetProperty("Gold").GetInt64());

        await realm.ClickAsync("Done");
        Assert.Equal("closed", (await realm.ClosedAsync(id)).GetProperty("outcome").GetString());
        Assert.Empty(realm.Errors);
    }

    [Fact]
    public async Task The_gear_screen_takes_off_and_wears_gear_and_trades_with_an_armorer()
    {
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 106, "W", Pictures);
        JsonElement me = await realm.OkAsync(HttpMethod.Get, "me");
        (string slot, JsonElement worn) = me.GetProperty("Loadout").EnumerateObject()
            .Where(pair => pair.Value.ValueKind == JsonValueKind.Object).Select(pair => (pair.Name, pair.Value)).First();
        string item = worn.GetProperty("Gear").GetProperty("Name").GetString()!;
        long instance = worn.GetProperty("InstanceId").GetInt64();

        int id = await realm.OpenScreenAsync("gear", new { name = "Tester 106" });
        await realm.SettledAsync(state => state.Realm?.Gear.Count(card => card.Place.StartsWith("worn:", StringComparison.Ordinal)) == 8);
        await realm.PictureAsync("gear");
        Assert.Equal(item, (await realm.GearAsync($"worn:{slot}")).Name);

        // Taken off: the slot is empty, the item among those owned.
        await realm.ClickGearAsync($"worn:{slot}");
        await realm.ClickAsync("Take off");
        await realm.SettledAsync(state => state.Realm?.Gear.Any(card => card.Place == "owned" && card.Instance == instance) == true);
        Assert.Equal(JsonValueKind.Null, (await realm.OkAsync(HttpMethod.Get, "me")).GetProperty("Loadout").GetProperty(slot).ValueKind);

        // Worn again.
        await realm.ClickGearAsync("owned", item);
        await realm.ClickAsync("Wear");
        await realm.SettledAsync(state => state.Realm?.Gear.Any(card => card.Place == $"worn:{slot}" && card.Instance == instance) == true);
        Assert.Equal(instance, (await realm.OkAsync(HttpMethod.Get, "me")).GetProperty("Loadout").GetProperty(slot).GetProperty("InstanceId").GetInt64());
        await realm.ClickAsync("Done");
        Assert.Equal("closed", (await realm.ClosedAsync(id)).GetProperty("outcome").GetString());

        // At New Argive's armorer: an item of the day's stock bought, and sold back at half its price.
        JsonElement stock = await realm.OkAsync(HttpMethod.Get, "armorer/new-argive");
        JsonElement cheapest = stock.GetProperty("Stock").EnumerateArray().OrderBy(gear => gear.GetProperty("Gold").GetInt64()).First();
        string bought = cheapest.GetProperty("Name").GetString()!;
        long price = cheapest.GetProperty("Gold").GetInt64();
        Assert.True(price <= 2000, $"{bought} costs {price}, more than a new character has.");
        id = await realm.OpenScreenAsync("gear", new { armorer = "new-argive", name = "the armorer of New Argive" });
        await realm.ClickGearAsync("stock", bought);
        await realm.ClickAsync("Buy");
        await realm.SettledAsync(state => state.Realm?.Status.StartsWith("You bought", StringComparison.Ordinal) == true && state.Realm.Gear.Any(card => card.Place == "owned" && card.Name == bought));
        await realm.PictureAsync("armorer");
        await realm.ClickGearAsync("owned", bought);
        await realm.ClickAsync("Sell");
        await realm.SettledAsync(state => state.Realm?.Status.StartsWith("You sold", StringComparison.Ordinal) == true);
        Assert.Equal(2000 - price + (price / 2), (await realm.OkAsync(HttpMethod.Get, "me")).GetProperty("Gold").GetInt64());
        await realm.ClickAsync("Done");
        await realm.ClosedAsync(id);
        Assert.Empty(realm.Errors);
    }
}
