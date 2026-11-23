using System.Text.Json;
using Cantrip.Realms.Server.Content;
using Cantrip.Server;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>The realm's content (realms/docs/interfaces.md, "Content") reads and holds together, and the checks catch what doesn't.</summary>
public sealed class ContentTests
{
    [Fact]
    public void The_sample_content_loads_whole()
    {
        RealmContent content = RealmApp.Content;
        Assert.Contains("benalish-meadow", content.Maps.Keys);
        Assert.Contains("new-argive", content.Maps.Keys);
        Assert.True(content.Mobs.Count >= 6);
        Assert.True(content.Vendors.Values.Count(vendor => vendor.File.Town == "new-argive") >= 2);
        foreach (string slot in RealmContent.GearSlots)
        {
            Assert.Contains(content.Gear.Values, item => item.Slot == slot);
        }
    }

    [Fact]
    public void Every_starter_deck_is_forty_cards_of_its_color_from_the_pool()
    {
        RealmContent content = RealmApp.Content;
        HashSet<string> pool = [.. content.Cards.Pool("dominaria")];
        foreach ((string color, DeckList deck) in content.Starters["dominaria"])
        {
            Assert.Equal(40, deck.Entries.Sum(entry => entry.Copies));
            foreach (DeckListEntry entry in deck.Entries)
            {
                var card = content.Cards.Catalog[entry.Card];
                Assert.True(CardPool.IsBasic(card) || pool.Contains(entry.Card), $"{entry.Card} is not in the pool");
                Assert.Equal(color, CardPool.Letters(card.Identity));
                if (!CardPool.IsBasic(card)) Assert.Contains(content.Cards.Prices[entry.Card].Rarity, new[] { "common", "uncommon" });
            }
        }
    }

    [Fact]
    public void Every_mob_deck_is_legal_and_forty_cards()
    {
        foreach (Mob mob in RealmApp.Content.Mobs.Values)
        {
            Assert.True(mob.Deck.Entries.Sum(entry => entry.Copies) >= 40, mob.Id);
        }
    }

    [Fact]
    public void The_meadow_is_the_overworlds_meadow()
    {
        RealmMap meadow = RealmApp.Content.Maps["benalish-meadow"];

        // realms/web/src/map.ts: radius 16, the spell table at (-3, 3), the pond at (5, -7) all water, the start clear.
        Assert.Equal(1 + (3 * 16 * 17), meadow.Tiles.Count);
        Assert.False(meadow.Walkable(new Hex(-3, 3)));
        Assert.Contains(new Hex(-3, 3), meadow.SpellTables);
        Assert.Equal("water", meadow.TileAt(new Hex(5, -7))!.Value.Terrain);
        Assert.False(meadow.Walkable(new Hex(5, -7)));
        Assert.True(meadow.Walkable(new Hex(0, 0)));
    }

    [Fact]
    public void Gear_with_effects_names_its_emblem()
    {
        GearItem circlet = RealmApp.Content.Gear["circlet-of-foresight"];
        Assert.Equal("Circlet of Foresight (gear)", circlet.Emblem);
        Assert.Null(RealmApp.Content.Gear["leather-cap"].Emblem);
    }

    [Fact]
    public void Broken_content_is_refused_with_every_problem_said()
    {
        string root = Path.Combine(Path.GetTempPath(), $"cantrip-realm-content-{Guid.NewGuid():N}");
        try
        {
            CopyDirectory(Path.Combine(RealmApp.Root, "realms", "content"), Path.Combine(root, "realms", "content"));
            CopyDirectory(Path.Combine(RealmApp.Root, "decks", "realms"), Path.Combine(root, "decks", "realms"));
            string content = Path.Combine(root, "realms", "content");

            // A mob whose deck is gone, a spawn on a blocked hex holding no mob, and gear in no slot.
            Edit(Path.Combine(content, "dominaria", "mobs", "phyrexian-scout.json"), json => json.Replace("decks/realms/dominaria/phyrexian-scout.txt", "decks/realms/dominaria/missing.txt", StringComparison.Ordinal));
            Edit(Path.Combine(content, "dominaria", "maps", "benalish-meadow.json"), json => json.Replace("{\"id\":\"s2\",\"q\":-6,\"r\":10,\"mobs\":[\"llanowar-elves-pack\"]", "{\"id\":\"s2\",\"q\":-3,\"r\":3,\"mobs\":[\"nobody\"]", StringComparison.Ordinal));
            Edit(Path.Combine(content, "gear", "leather-cap.json"), json => json.Replace("\"slot\": \"head\"", "\"slot\": \"hat\"", StringComparison.Ordinal));

            RealmContentException refused = Assert.Throws<RealmContentException>(() => RealmContent.Load(root, Path.Combine(RealmApp.Root, "content")));
            Assert.Contains(refused.Problems, problem => problem.Contains("missing.txt", StringComparison.Ordinal));
            Assert.Contains(refused.Problems, problem => problem.Contains("spawn s2 stands on (-3, 3)", StringComparison.Ordinal));
            Assert.Contains(refused.Problems, problem => problem.Contains("'nobody', which is no mob", StringComparison.Ordinal));
            Assert.Contains(refused.Problems, problem => problem.Contains("slot 'hat'", StringComparison.Ordinal));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void A_deck_of_cards_outside_the_pool_or_too_many_copies_is_refused()
    {
        RealmContent content = RealmApp.Content;
        List<string> problems = DeckChecks.Problems(content.Cards, [new("Lightning Bolt", 5), new("Black Lotus", 2), new("Plains", 20)], CardPool.Identity("W"));
        Assert.Contains("Lightning Bolt: 5 copies, more than the 4 a deck may have.", problems);
        Assert.Contains("Lightning Bolt is outside the color identity W.", problems);
        Assert.Contains("Black Lotus is restricted in Vintage: one copy at most, not 2.", problems);
        Assert.Contains(problems, problem => problem.StartsWith("A deck is at least 40 cards", StringComparison.Ordinal));
    }

    private static void Edit(string path, Func<string, string> change)
    {
        string before = File.ReadAllText(path);
        string after = change(before);
        Assert.NotEqual(before, after);
        File.WriteAllText(path, after);
    }

    private static void CopyDirectory(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (string file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
        {
            string target = Path.Combine(to, Path.GetRelativePath(from, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target);
        }
    }
}

/// <summary>The spawn table's golden vectors (realms/content/spawn-vectors.json), which the overworld's tests check too.</summary>
public sealed class SpawnTests
{
    [Fact]
    public void Every_golden_vector_holds()
    {
        using JsonDocument vectors = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RealmApp.Root, "realms", "content", "spawn-vectors.json")));
        int cases = 0;
        foreach (JsonElement vector in vectors.RootElement.GetProperty("cases").EnumerateArray())
        {
            string player = vector.GetProperty("player").GetString()!;
            string map = vector.GetProperty("map").GetString()!;
            string spawn = vector.GetProperty("spawn").GetString()!;
            long epoch = Spawns.Epoch(vector.GetProperty("unixSeconds").GetInt64(), vector.GetProperty("respawnSeconds").GetInt32());
            List<string> mobs = [.. vector.GetProperty("mobs").EnumerateArray().Select(mob => mob.GetString()!)];

            Assert.Equal(vector.GetProperty("key").GetString(), Spawns.Key(player, map, spawn, epoch));
            Assert.Equal(vector.GetProperty("seed").GetUInt32(), Spawns.Seed(player, map, spawn, epoch));
            Assert.Equal(vector.GetProperty("mob").GetString(), Spawns.MobOf(player, map, spawn, epoch, mobs));
            cases++;
        }

        Assert.True(cases >= 6);
    }

    [Fact]
    public void Fnv1a_is_the_reference_function()
    {
        // FNV-1a 32's published test values.
        Assert.Equal(0x811c9dc5u, Spawns.Fnv1a32(string.Empty));
        Assert.Equal(0xe40c292cu, Spawns.Fnv1a32("a"));
        Assert.Equal(0xbf9cf968u, Spawns.Fnv1a32("foobar"));
    }

    [Fact]
    public void An_epoch_is_floored()
    {
        Assert.Equal(2939760, Spawns.Epoch(1763856599, 600));
        Assert.Equal(2939761, Spawns.Epoch(1763856600, 600));
        Assert.Equal(-1, Spawns.Epoch(-1, 600));
    }
}

/// <summary>The price formula (design.md A5).</summary>
public sealed class PricingTests
{
    [Theory]
    [InlineData("0.16", "uncommon", 116)]
    [InlineData("0.19", "common", 69)]
    [InlineData("7.21", "rare", 1221)]
    [InlineData("0", "mythic", 1000)]
    [InlineData("0.005", "common", 50)]
    [InlineData("0.015", "common", 52)]
    public void A_list_price_is_a_hundred_gold_a_dollar_with_the_surcharge(string usd, string rarity, long gold) =>
        Assert.Equal(gold, Pricing.ListPrice(decimal.Parse(usd, System.Globalization.CultureInfo.InvariantCulture), rarity));

    [Fact]
    public void Every_price_in_the_content_is_the_formulas() =>
        Assert.All(RealmApp.Content.Cards.Prices, price => Assert.Equal(price.Value.Gold, Pricing.ListPrice(price.Value.Usd, price.Value.Rarity)));

    [Fact]
    public void A_vendor_buys_at_half_rounded_down()
    {
        Assert.Equal(58, Pricing.BuyPrice(116));
        Assert.Equal(34, Pricing.BuyPrice(69));
    }
}
