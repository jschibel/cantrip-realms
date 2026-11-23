using System.Text.Json;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Economy;
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
    public void Everything_a_map_names_is_there_and_everything_there_is_named_by_a_map()
    {
        RealmContent content = RealmApp.Content;
        HashSet<string> mobsNamed = new(StringComparer.Ordinal);
        HashSet<string> vendorsNamed = new(StringComparer.Ordinal);
        foreach (RealmMap map in content.Maps.Values)
        {
            foreach (MapSpawn spawn in map.File.Spawns)
            {
                foreach (string mob in spawn.Mobs)
                {
                    Assert.True(content.Mobs.ContainsKey(mob), $"{map.Id} spawn {spawn.Id}: no mob '{mob}'");
                    mobsNamed.Add(mob);
                }
            }

            foreach (MapNpc npc in map.File.Npcs.Where(npc => npc.Kind == "vendor"))
            {
                Assert.True(content.Vendors.TryGetValue(npc.Vendor!, out Vendor? vendor), $"{map.Id}: no vendor '{npc.Vendor}'");
                Assert.Equal(map.Id, vendor.File.Town);
                vendorsNamed.Add(vendor.Id);
            }

            foreach (MapExit exit in map.File.Exits)
            {
                Assert.True(exit.To == RealmContent.World || content.Maps.ContainsKey(exit.To), $"{map.Id}: an exit to no map '{exit.To}'");
            }

            foreach (MapEncounterZone zone in map.File.Encounters)
            {
                Assert.Contains(zone.Map, content.Maps.Keys);
            }

            // The inn: none on the world map, a town's or village's own, else the inn of a town or village by its map.
            if (map.File.Kind == RealmContent.World)
            {
                Assert.Null(map.File.Inn);
                continue;
            }

            MapInn inn = map.File.Inn!;
            RealmMap town = content.Maps[inn.Map ?? map.Id];
            Assert.Contains(town.File.Kind, new[] { "town", "village" });
            Assert.Equal(inn.At, town.File.Inn!.At);
            Assert.Null(town.File.Inn.Map);
            Assert.True(town.Walkable(inn.At), $"{map.Id}'s inn");
        }

        // No mob or vendor nobody meets.
        Assert.Equal(content.Mobs.Keys.Order(StringComparer.Ordinal), mobsNamed.Order(StringComparer.Ordinal));
        Assert.Equal(content.Vendors.Keys.Order(StringComparer.Ordinal), vendorsNamed.Order(StringComparer.Ordinal));

        // Every mob's deck, gear and model resolve.
        foreach (Mob mob in content.Mobs.Values)
        {
            Assert.True(mob.Deck.Entries.Sum(entry => entry.Copies) >= Duel.RealmMinimumDeckSize, mob.Id);
            Assert.All(mob.Deck.Entries, entry => Assert.True(content.Cards.Catalog.ContainsKey(entry.Card), $"{mob.Id}: {entry.Card}"));
            Assert.All(mob.File.Gear, gear => Assert.True(content.Gear.ContainsKey(gear) && content.Gear[gear].Emblem is null, $"{mob.Id} wears {gear}"));
            Assert.Equal("mob", content.Models.GetValueOrDefault(mob.File.Model.Mesh));
            Assert.NotEmpty(content.Cards.Filter(mob.File.Loot.Pool ?? mob.Plane, mob.File.Loot));
        }

        Assert.All(content.Gear.Values, item => Assert.Equal("gear", content.Models.GetValueOrDefault(item.Look.Mesh)));
    }

    [Fact]
    public void Mobs_grow_from_the_wilderness_to_the_dungeons_and_their_bosses()
    {
        RealmContent content = RealmApp.Content;
        foreach (RealmMap map in content.Maps.Values)
        {
            List<Mob> mobs = [.. map.File.Spawns.SelectMany(spawn => spawn.Mobs).Distinct().Select(id => content.Mobs[id])];
            if (map.File.Kind == "wilderness") Assert.All(mobs, mob => Assert.InRange(mob.File.Tier, 1, 2));
            if (map.File.Kind == "dungeon")
            {
                Assert.All(mobs, mob => Assert.True(mob.File.Boss || mob.File.Tier >= (map.File.Floor == 1 ? 2 : 3), $"{map.Id}: {mob.Id} is tier {mob.File.Tier}"));
                Assert.Contains(mobs, mob => mob.Id.EndsWith("-warden", StringComparison.Ordinal));

                // Beyond the Phyrexian Portal, tier 4 and up on every floor.
                if (map.File.Requires is not null) Assert.All(mobs, mob => Assert.Equal(4, mob.File.Tier));
            }
        }

        // Six floor wardens of tier 4 (the five dungeons' and the portal's); five bosses who unlock the five colors, and
        // the capstone's praetor, who unlocks none.
        Assert.Equal(6, content.Mobs.Values.Count(mob => mob.Id.EndsWith("-warden", StringComparison.Ordinal) && mob.File.Tier == 4 && !mob.File.Boss));
        List<Mob> bosses = [.. content.Mobs.Values.Where(mob => mob.File.Boss)];
        Assert.Equal("BGRUW", string.Concat(bosses.Select(boss => boss.File.Unlocks).OfType<string>().Order(StringComparer.Ordinal)));
        Assert.Equal(["phyrexian-praetor"], bosses.Where(boss => boss.File.Unlocks is null).Select(boss => boss.Id));
        Assert.All(bosses, boss => Assert.Equal(6000, boss.File.Prize));
        Assert.Contains("Lyra Dawnbringer", content.Mobs["lyra-dawnbringer"].Deck.Entries.Select(entry => entry.Card));
        Assert.Contains("Teferi, Hero of Dominaria", content.Mobs["teferi"].Deck.Entries.Select(entry => entry.Card));
        Assert.Contains("Sheoldred, the Apocalypse", content.Mobs["sheoldred"].Deck.Entries.Select(entry => entry.Card));

        // The prize and gold of each tier (design.md A3).
        Dictionary<int, (long Prize, long Low, long High)> tiers = new() { [1] = (100, 20, 60), [2] = (300, 50, 150), [3] = (800, 120, 300), [4] = (2000, 250, 600) };
        foreach (Mob mob in content.Mobs.Values.Where(mob => !mob.File.Boss))
        {
            Assert.Equal(tiers[mob.File.Tier], (mob.File.Prize, mob.File.GoldRange[0], mob.File.GoldRange[1]));
        }

        // An armorer in New Argive and each home town.
        Assert.Equal(6, content.Maps.Values.Count(map => map.File.Npcs.Any(npc => npc.Kind == Armorers.Kind)));
    }

    [Fact]
    public void No_pool_vendor_stock_loot_offer_or_starter_deck_can_hold_a_relic()
    {
        RealmContent content = RealmApp.Content;
        HashSet<string> relics = [.. content.Relics.Select(relic => relic.Card)];
        Assert.Contains("Black Lotus", relics);
        Assert.Equal(relics, content.Cards.Relics);

        // The pools (as card-economy.py writes them, and as the server reads them), and so every vendor's stock and every
        // mob's loot, which are filters of them.
        foreach (string plane in content.Cards.Planes)
        {
            Assert.DoesNotContain(content.Cards.Pool(plane), relics.Contains);
            using JsonDocument file = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RealmApp.Root, "realms", "content", "pools", $"{plane}.json")));
            Assert.DoesNotContain(file.RootElement.GetProperty("cards").EnumerateArray().Select(card => card.GetString()!), relics.Contains);
        }

        Assert.All(content.Vendors.Values, vendor => Assert.DoesNotContain(content.Cards.Filter(vendor.Plane, vendor.File.Specialty), relics.Contains));
        Assert.All(content.Mobs.Values, mob => Assert.DoesNotContain(content.Cards.Filter(mob.File.Loot.Pool ?? mob.Plane, mob.File.Loot), relics.Contains));
        Assert.All(content.Starters.Values.SelectMany(decks => decks.Values), deck => Assert.DoesNotContain(deck.Entries, entry => relics.Contains(entry.Card)));
        Assert.All(content.Mobs.Values, mob => Assert.DoesNotContain(mob.Deck.Entries, entry => relics.Contains(entry.Card)));

        // Even a pool that lists one, a vendor that names one or a loot filter that asks for one gets none.
        var listed = new CardPool(content.Cards.Catalog, content.Cards.Prices, new Dictionary<string, IReadOnlyList<string>> { ["dominaria"] = ["Black Lotus", "Mox Pearl", "Llanowar Elves"] }, content.Cards.Relics);
        Assert.Equal(["Llanowar Elves"], listed.Pool("dominaria"));
        Assert.Empty(listed.Filter("dominaria", new CardFilter { Names = ["Black Lotus", "Mox Pearl"] }));
    }

    [Fact]
    public void The_phyrexian_portal_is_the_capstone_sealed_to_all_but_five_colors()
    {
        RealmContent content = RealmApp.Content;
        List<RealmMap> floors = [.. content.Maps.Values.Where(map => map.Id.StartsWith("phyrexian-portal-", StringComparison.Ordinal)).OrderBy(map => map.File.Floor)];
        Assert.InRange(floors.Count, 3, 5);
        Assert.All(floors, floor =>
        {
            Assert.Equal("dungeon", floor.File.Kind);
            Assert.Equal("WUBRG", floor.File.Requires);
            Assert.Null(floor.File.Region);
        });
        Assert.Equal(Enumerable.Range(1, floors.Count), floors.Select(floor => floor.File.Floor!.Value));
        Assert.Contains(content.Maps[RealmContent.World].File.Exits, exit => exit.To == floors[0].Id);
        Assert.All(content.Maps.Values.Where(map => map.File.Requires is not null), map => Assert.Contains(map, floors));

        // The boss hall on the last floor: the praetor, five colors, its deck round the pool's one praetor.
        MapSpawn boss = floors[^1].Spawn("boss")!;
        Assert.Equal(["phyrexian-praetor"], boss.Mobs);
        Mob praetor = content.Mobs["phyrexian-praetor"];
        Assert.True(praetor.File.Boss);
        Assert.Null(praetor.File.Unlocks);
        Assert.Equal(6000, praetor.File.Prize);
        Assert.Contains("Sheoldred, the Apocalypse", praetor.Deck.Entries.Select(entry => entry.Card));
        Assert.Equal("WUBRG", CardPool.Letters(praetor.Deck.Entries.SelectMany(entry => content.Cards.Catalog[entry.Card].Identity)));
        Assert.All(floors.SkipLast(1), floor => Assert.DoesNotContain(floor.File.Spawns, spawn => spawn.Mobs.Contains("phyrexian-praetor")));
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
            Edit(Path.Combine(content, "dominaria", "maps", "benalish-meadow.json"), json => json.Replace("{\"id\":\"s2\",\"q\":-6,\"r\":9,\"mobs\":[\"phyrexian-scout\",\"benalish-deserter\"]", "{\"id\":\"s2\",\"q\":-3,\"r\":3,\"mobs\":[\"nobody\"]", StringComparison.Ordinal));
            Edit(Path.Combine(content, "gear", "leather-cap.json"), json => json.Replace("\"slot\": \"head\"", "\"slot\": \"hat\"", StringComparison.Ordinal));

            // A relic in a pool, a relic from a mob that is no boss, and a map locked to colors that are none.
            Edit(Path.Combine(content, "pools", "dominaria.json"), json => json.Replace("\"cards\": [", "\"cards\": [\n\"Black Lotus\",", StringComparison.Ordinal));
            Edit(Path.Combine(content, "relics.json"), json => json.Replace("{ \"card\": \"Mox Pearl\", \"bosses\": [\"phyrexian-praetor\"]", "{ \"card\": \"Mox Pearl\", \"bosses\": [\"phyrexian-scout\"]", StringComparison.Ordinal));
            Edit(Path.Combine(content, "dominaria", "maps", "phyrexian-portal-2.json"), json => json.Replace("\"requires\": \"WUBRG\"", "\"requires\": \"WX\"", StringComparison.Ordinal));

            RealmContentException refused = Assert.Throws<RealmContentException>(() => RealmContent.Load(root, Path.Combine(RealmApp.Root, "content")));
            Assert.Contains(refused.Problems, problem => problem.Contains("missing.txt", StringComparison.Ordinal));
            Assert.Contains(refused.Problems, problem => problem.Contains("spawn s2 stands on (-3, 3)", StringComparison.Ordinal));
            Assert.Contains(refused.Problems, problem => problem.Contains("'nobody', which is no mob", StringComparison.Ordinal));
            Assert.Contains(refused.Problems, problem => problem.Contains("slot 'hat'", StringComparison.Ordinal));
            Assert.Contains("pools/dominaria.json: Black Lotus is a relic, which is in no pool (design.md A3a).", refused.Problems);
            Assert.Contains("relics.json: Mox Pearl drops from 'phyrexian-scout', which is no boss.", refused.Problems);
            Assert.Contains("map phyrexian-portal-2: it requires 'WX', which is not colors' letters (W U B R G).", refused.Problems);
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
