using System.Text.Json;
using Xunit;

namespace Cantrip.Client.Web.Tests;

/// <summary>
/// Cantrip Realms' card screens (realms/docs/interfaces.md, "The card layer"), each asked for through the bridge as the
/// overworld asks, against the real realm server, and clicked as a player clicks them: the duel played on the rules engine
/// in the page and its log checked by the server's replay, a rematch's sideboarding, the spell table, a vendor, and the gear
/// screen with an armorer's.
/// </summary>
[Collection(WebClientCollection.Name)]
public sealed class RealmScreenTests(WebClient web, RealmSite site) : IClassFixture<RealmSite>, IAsyncLifetime
{
    private static string Pictures => WebClient.Pictures(nameof(RealmScreenTests));

    private readonly RealmSite _site = site;

    public Task InitializeAsync() => _site.StartAsync(web);

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// Starts an encounter with the mob a spawn of the wilds by New Benalia holds for the player now, standing on the
    /// spawn's tile (POST /dev/place): the duel screen's args.
    /// </summary>
    private static async Task<(object Args, string Token)> Encounter(RealmPage realm)
    {
        (string spawn, int x, int z, string mob, string name, int tier) = RealmSite.SpawnNear("new-benalia", realm.Player);
        await realm.OkAsync(HttpMethod.Post, "dev/place", new { Space = "world", X = x, Z = z }, api: false);
        JsonElement start = await realm.OkAsync(HttpMethod.Post, "encounter/start", new { Spawn = spawn, Mob = mob });
        string token = start.GetProperty("Token").GetString()!;
        return (new
        {
            token,
            seed = start.GetProperty("Seed").GetInt64(),
            duel = start.GetProperty("Duel"),
            mob = new { id = mob, name, tier, map = "world", spawn },
        }, token);
    }

    /// <summary>Stands the character beside an NPC of a kind in a room (POST /dev/place): at a spell table, a vendor, an armorer.</summary>
    private static Task<JsonElement> Beside(RealmPage realm, string interior, string kind)
    {
        (int x, int z) = RealmSite.BesideNpc(interior, kind);
        return realm.OkAsync(HttpMethod.Post, "dev/place", new { Space = interior, X = x, Z = z }, api: false);
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
            await Beside(page, "new-benalia-inn", "spell-table");
            await page.OkAsync(HttpMethod.Put, "deck", new { Main = new[] { new { Name = "Plains", Count = 40 } }, Sideboard = Array.Empty<object>() });
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
    public async Task The_sideboard_screen_swaps_the_deck_with_its_sideboard_and_hands_back_the_deck_and_play_or_draw()
    {
        // A rematch's sideboarding (design.md A3): the last game's deck and sideboard, judged in the page, saved nowhere.
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 103, "W", Pictures);
        JsonElement deck = await realm.OkAsync(HttpMethod.Get, "deck");
        int id = await realm.OpenScreenAsync("sideboard", new
        {
            mob = "Phyrexian Scout",
            game = 2,
            main = deck.GetProperty("Main"),
            sideboard = new[] { new { Name = "Serra Angel", Count = 1 } },
            identity = "W",
            mobLife = 7,
        });

        RealmState table = await realm.SettledAsync(state => state.DeckEditor is { } editor && editor.Main.Count > 0 && editor.Side.Count == 1);
        await realm.PictureAsync("sideboard");
        Assert.Equal(["1 Serra Angel"], table.DeckEditor!.Side);

        // A card of the deck out, the Angel in: forty still, and legal.
        string out_ = deck.GetProperty("Main").EnumerateArray().Select(card => card.GetProperty("Name").GetString()!).First(name => name != "Plains");
        CardState card = await realm.CardAsync(out_, "pool");
        await realm.Page.Mouse.DblClickAsync(card.X, card.Y);
        await realm.SettledAsync(state => state.DeckEditor is { } editor && editor.Side.Count == 2);
        CardState angel = await realm.CardAsync("Serra Angel", "sideboard");
        await realm.Page.Mouse.DblClickAsync(angel.X, angel.Y);
        await realm.SettledAsync(state => state.DeckEditor is { } editor && editor.Side.Count == 1 && editor.Problems.Count == 0);

        // Fight: play or draw, the loser's choice; drawing.
        await realm.ClickAsync("Fight");
        await realm.ClickAsync("Draw first");
        JsonElement closed = await realm.ClosedAsync(id);
        Assert.Equal("closed", closed.GetProperty("outcome").GetString());
        JsonElement result = closed.GetProperty("result");
        Assert.False(result.GetProperty("playFirst").GetBoolean());
        Assert.Equal(40, result.GetProperty("main").EnumerateArray().Sum(entry => entry.GetProperty("Count").GetInt32()));
        Assert.Contains(result.GetProperty("main").EnumerateArray(), entry => entry.GetProperty("Name").GetString() == "Serra Angel");
        Assert.Contains(result.GetProperty("sideboard").EnumerateArray(), entry => entry.GetProperty("Name").GetString() == out_);

        // The saved deck is as it was: the swap was for the encounter alone.
        Assert.Equal(deck.GetProperty("Main").GetRawText(), (await realm.OkAsync(HttpMethod.Get, "deck")).GetProperty("Main").GetRawText());
        Assert.Empty(realm.Errors);
    }

    [Fact]
    public async Task The_spell_table_edits_the_deck_and_the_sideboard_from_the_collection_and_saves_them()
    {
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 104, "W", Pictures, async page =>
        {
            await Beside(page, "new-benalia-inn", "spell-table");
        });
        JsonElement deck = await realm.OkAsync(HttpMethod.Get, "deck");
        int id = await realm.OpenScreenAsync("spell-table", new { map = "new-benalia-inn", name = "the spell table at the inn" });

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

        // A card of the deck double-clicked into the sideboard: thirty-nine cards, which the server says is too few.
        string aside = deck.GetProperty("Main").EnumerateArray().Select(card => card.GetProperty("Name").GetString()!).First(name => name != "Plains");
        CardState card = await realm.CardAsync(aside, "pool");
        await realm.Page.Mouse.DblClickAsync(card.X, card.Y);
        RealmState short_ = await realm.SettledAsync(state => state.DeckEditor is { } editor && editor.Side.Count > 0 && editor.Problems.Any(problem => problem.Contains("at least 40", StringComparison.Ordinal)));
        Assert.Contains(short_.DeckEditor!.Side, line => line.Contains(aside, StringComparison.Ordinal));

        // A Plains from the search makes forty again.
        CardState plains = await realm.CardAsync("Plains", "search");
        await realm.Page.Mouse.DblClickAsync(plains.X, plains.Y);
        await realm.SettledAsync(state => state.DeckEditor is { } editor && editor.Problems.Count == 0 && editor.Status.StartsWith("Legal", StringComparison.Ordinal));
        await realm.ClickAsync("Save");
        await realm.SettledAsync(state => state.DeckEditor?.Status.StartsWith("Saved", StringComparison.Ordinal) == true);
        await realm.PictureAsync("spell-table-saved");

        JsonElement saved = await realm.OkAsync(HttpMethod.Get, "deck");
        Assert.Equal([aside], saved.GetProperty("Sideboard").EnumerateArray().Select(entry => entry.GetProperty("Name").GetString()));
        Assert.Equal(40, saved.GetProperty("Main").EnumerateArray().Sum(entry => entry.GetProperty("Count").GetInt32()));

        await realm.ClickAsync("Done");
        Assert.Equal("closed", (await realm.ClosedAsync(id)).GetProperty("outcome").GetString());
        Assert.Empty(realm.Errors);
    }

    [Fact]
    public async Task The_vendor_screen_buys_and_sells_through_the_api_and_says_a_refusal_in_words()
    {
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 105, "W", Pictures, async page =>
        {
            await Beside(page, "benalia-white-goods-shop", "vendor");
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
        RealmState refused = await realm.SettledAsync(state => state.Realm?.Status.Contains("in your deck or your sideboard", StringComparison.Ordinal) == true);
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
        await using RealmPage realm = await RealmPage.OpenAsync(web, _site, 106, "W", Pictures, page => Beside(page, "new-benalia-smithy", "armorer"));
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

        // At New Benalia's armorer, in its smithy: an item of the day's stock bought, and sold back at half its price.
        JsonElement stock = await realm.OkAsync(HttpMethod.Get, "armorer/new-benalia");
        JsonElement cheapest = stock.GetProperty("Stock").EnumerateArray().OrderBy(gear => gear.GetProperty("Gold").GetInt64()).First();
        string bought = cheapest.GetProperty("Name").GetString()!;
        long price = cheapest.GetProperty("Gold").GetInt64();
        Assert.True(price <= 2000, $"{bought} costs {price}, more than a new character has.");
        id = await realm.OpenScreenAsync("gear", new { armorer = "new-benalia", name = "the armorer of New Benalia" });
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
