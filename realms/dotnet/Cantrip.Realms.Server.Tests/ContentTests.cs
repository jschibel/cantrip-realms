using System.Text.Json;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Economy;
using Cantrip.Decks;
using Cantrip.Server;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// The realm's content (realms/docs/interfaces.md, "Content") reads and holds together - the roster, gear, vendors and
/// starters of realms/content over the test world (World/make-world.py) - and the checks catch what doesn't.
/// </summary>
public sealed class ContentTests
{
    private const string World = RealmContent.WorldSpace;

    private static readonly string[] Regions = ["benalia", "orvada", "caligo", "keld", "llanowar"];

    [Fact]
    public void The_content_loads_whole_over_the_test_world()
    {
        RealmContent content = RealmApp.Content;
        Assert.Equal("dominaria", content.World.Plane);
        Assert.Equal(20, content.World.Chunks.Count);
        Assert.Contains("new-benalia", content.Towns.Keys);
        Assert.True(content.Mobs.Count >= 90);
        Assert.True(content.Vendors.Values.Count(vendor => vendor.File.Town == "new-benalia") >= 2);
        foreach (string slot in RealmContent.GearSlots)
        {
            Assert.Contains(content.Gear.Values, item => item.Slot == slot);
        }
    }

    [Fact]
    public void The_server_starts_on_the_generated_world_of_the_domains()
    {
        // realms/content/dominaria/world, interiors and dungeons, as realms/web/scripts/world.ts writes them from layout.json and
        // the roster: what the server reads with no REALMS_PLACES.
        RealmContent content = RealmApp.Generated;
        RealmWorld world = content.World;
        Assert.Equal("dominaria", world.Plane);
        // Two scales: the travel map at the origin, each town's grounds in a pocket east of it, a chunk for each chunk of
        // ground (the travel map's 16 by 24, and the grounds', whose sizes are the town generator's).
        Assert.True(world.TwoScales);
        Assert.Equal([0, 0, 512, 768], world.File.Travel!);
        Assert.Equal((0, 0), (world.X0, world.Z0));
        Assert.Equal(768, world.Height);
        Assert.All(content.Towns.Keys, id => Assert.NotNull(world.File.Towns.Single(town => town.Id == id).Grounds));
        int groundChunks = 16 * 24 + world.File.Towns.Sum(town => town.Grounds is [int x0, int z0, int x1, int z1] ? (x1 - x0) / 32 * ((z1 - z0) / 32) : 0);
        Assert.Equal(groundChunks, world.Chunks.Count);
        Assert.Equal(world.File.Towns.Max(town => town.Grounds![2]), world.Width);
        Assert.NotEmpty(world.Spawns);

        using JsonDocument layout = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RealmApp.Root, "realms", "content", "dominaria", "layout.json")));
        JsonElement root = layout.RootElement;

        // Its towns are the layout's, each with an inn; New Benalia, where characters start, among them.
        string[] towns = [.. root.GetProperty("towns").EnumerateArray().Select(town => town.GetProperty("id").GetString()!).Order(StringComparer.Ordinal)];
        Assert.Equal(towns, content.Towns.Keys.Order(StringComparer.Ordinal));
        Assert.All(towns, town => Assert.Contains(world.File.Inns, inn => inn.Town == town));
        Assert.Contains("new-benalia", towns);

        // Every card vendor keeps a stall in its town's market and every exotic dealer a shop there; every trader's town is the
        // world's; the exotic wares shops are New Benalia's and Capashen Hold's.
        foreach (Vendor vendor in content.Vendors.Values)
        {
            if (vendor.File.Trader is { } round) Assert.All(round.Towns, town => Assert.Contains(town, content.Towns.Keys));
            else if (vendor.Kind == Vendor.ExoticShop) Assert.Equal(vendor.File.Town, Assert.Single(content.Interiors.Values, interior => interior.Npcs.Any(npc => npc.Kind == "vendor" && npc.Vendor == vendor.Id)).Town?.Id);
            else
            {
                Assert.DoesNotContain(content.Interiors.Values, interior => interior.Npcs.Any(npc => npc.Kind == "vendor" && npc.Vendor == vendor.Id));
                Tile stall = content.StallOf(vendor) ?? throw new Xunit.Sdk.XunitException($"{vendor.Id} keeps no stall");
                Assert.True(world.Walkable(stall), vendor.Id);
            }
        }

        Assert.Equal(["capashen-hold-exotic-wares", "new-benalia-exotic-wares"], content.Vendors.Values.Where(vendor => vendor.Kind == Vendor.ExoticShop).Select(vendor => vendor.Id).Order(StringComparer.Ordinal));

        // Its dungeons are the layout's, and those that name their mobs name the roster's: the region dungeons' bosses who
        // unlock its colors, the towers' mages, the wardens.
        string[] dungeons = [.. root.GetProperty("dungeons").EnumerateArray().Select(dungeon => dungeon.GetProperty("id").GetString()!).Order(StringComparer.Ordinal)];
        Assert.Equal(dungeons, content.Dungeons.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(["garna", "liliana", "lyra-dawnbringer", "rofellos", "teferi"], content.Dungeons.Values.Select(dungeon => content.Mobs[dungeon.File.Boss]).Where(boss => boss.File.Unlocks is not null).Select(boss => boss.Id).Order(StringComparer.Ordinal));
        foreach (string region in Regions)
        {
            for (int tier = 1; tier <= 4; tier++)
            {
                RealmDungeon tower = content.Dungeons[$"{region}-{tier}"];
                Assert.Equal(("tower", true, $"mage-{region}-{tier}"), (tower.File.Theme, tower.File.Waystone, tower.File.Boss));
            }
        }
    }

    [Fact]
    public void Everything_the_generated_world_names_is_there_and_everything_there_is_met() => Everything_the_world_names_is_there_and_everything_there_is_met("generated");

    [Theory]
    [InlineData("test")]
    public void Everything_the_world_names_is_there_and_everything_there_is_met(string over)
    {
        RealmContent content = RealmApp.Of(over);
        RealmWorld world = content.World;

        // Spawns: their mobs, each of the spawn's tier, none a boss; on open ground.
        foreach (MapSpawn spawn in world.Spawns)
        {
            Assert.True(world.Walkable(spawn.At), spawn.Id);
            System.Text.RegularExpressions.Match id = System.Text.RegularExpressions.Regex.Match(spawn.Id, @"^(-?\d+)_(-?\d+):\d+$");
            Assert.True(id.Success, spawn.Id);
            Assert.Equal(world.ChunkOf(spawn.At), (int.Parse(id.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture), int.Parse(id.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture)));
            Assert.All(spawn.Mobs, mob => Assert.Equal((spawn.Tier, false), (content.Mobs[mob].File.Tier, content.Mobs[mob].File.Boss)));
        }

        // Doors lead into interiors, which come out on or beside them, and are walked onto; a vendor's shop is in its town.
        foreach ((Tile door, string interior) in world.Doors)
        {
            RealmInterior inside = content.Interiors[interior];
            Assert.Contains(door, inside.Doors);
            Assert.True(world.Walkable(door), interior);
            Assert.True(world.Walkable(inside.File.ExitAt!.Value), interior);
            Assert.Contains(inside.Doors, at => at.DistanceTo(inside.File.ExitAt!.Value) <= 1);
            Assert.True(inside.Walkable(inside.File.EntryAt!.Value), interior);
        }

        // A vendor keeps a shop in its town, or a stall in its town's street or market: one or the other.
        foreach (Vendor vendor in content.Vendors.Values.Where(vendor => vendor.Kind != Vendor.Traveler))
        {
            RealmInterior[] shops = [.. content.Interiors.Values.Where(interior => interior.Npcs.Any(npc => npc.Kind == "vendor" && npc.Vendor == vendor.Id))];
            if (content.StallOf(vendor) is { } stall)
            {
                Assert.Empty(shops);
                Assert.Equal(vendor.File.Town, content.TownAt(stall)?.Id);
            }
            else Assert.Equal(vendor.File.Town, Assert.Single(shops).Town?.Id);
        }

        foreach (InnEntry inn in world.File.Inns)
        {
            Assert.True(world.Walkable(inn.At), inn.Id);
            Assert.Contains(inn.Town, content.Towns.Keys);
        }

        // Dungeons stand where world.json says, an entrance of a chunk leading in; their mobs and bosses are mobs; each is a
        // tournament of a round or more and the boss's hall.
        foreach (RealmDungeon dungeon in content.Dungeons.Values)
        {
            Assert.Equal(dungeon.Id, world.Entrances[dungeon.File.At]);
            Assert.Contains(world.File.Dungeons, place => place.Id == dungeon.Id && place.At == dungeon.File.At);
            Assert.All(dungeon.Tables.SelectMany(table => table), mob => Assert.False(content.Mobs[mob].File.Boss, mob));
            Assert.Contains(dungeon.File.Boss, content.Mobs.Keys);
            Assert.True(dungeon.File.Floors[0] >= 2, dungeon.Id);
            Assert.Equal([3, 3], dungeon.File.Encounters);
        }

        // No mob nobody meets.
        HashSet<string> met = [.. world.Spawns.SelectMany(spawn => spawn.Mobs)];
        foreach (RealmDungeon dungeon in content.Dungeons.Values)
        {
            met.UnionWith(dungeon.Tables.SelectMany(table => table));
            met.Add(dungeon.File.Boss);
        }

        Assert.Equal(content.Mobs.Keys.Order(StringComparer.Ordinal), met.Order(StringComparer.Ordinal));

        // Every mob's deck, gear and model resolve.
        foreach (Mob mob in content.Mobs.Values)
        {
            Assert.True(mob.Deck.Entries.Sum(entry => entry.Copies) >= Duel.RealmMinimumDeckSize, mob.Id);
            Assert.All(mob.Deck.Entries, entry => Assert.True(content.Cards.Catalog.ContainsKey(entry.Card), $"{mob.Id}: {entry.Card}"));
            Assert.All(mob.File.Gear, gear => Assert.True(content.Gear.ContainsKey(gear) && content.Gear[gear].Emblem is null, $"{mob.Id} wears {gear}"));
            Assert.Contains(mob.File.Model.Mesh, RealmContent.MobMeshes);
            Assert.Equal(mob.File.Boss, mob.File.Loot is not null);
            if (mob.File.Loot is { } loot) Assert.NotEmpty(content.Cards.Filter(loot.Pool ?? mob.Plane, loot));
        }

        Assert.All(content.Gear.Values, item => Assert.Equal(item.Slot, RealmContent.GearMeshes.GetValueOrDefault(item.Look.Mesh)));
    }

    [Fact]
    public void Every_wanderer_is_a_creature_of_dominaria_with_a_deck_built_round_it()
    {
        RealmContent content = RealmApp.Content;
        HashSet<string> pool = [.. content.Cards.Pool("dominaria")];
        List<Mob> wanderers = [.. content.Mobs.Values.Where(mob => !mob.File.Boss && !mob.Id.StartsWith("mage-", StringComparison.Ordinal)
            && !mob.Id.Contains("warden", StringComparison.Ordinal) && mob.File.Region is not null)];

        // About fifteen a tier for tiers 1 to 4, every region in every tier.
        for (int tier = 1; tier <= 4; tier++)
        {
            List<Mob> ofTier = [.. wanderers.Where(mob => mob.File.Tier == tier)];
            Assert.InRange(ofTier.Count, 12, 20);
            Assert.Equal("BGRUW", string.Concat(ofTier.Select(mob => mob.File.Region).Distinct().Order(StringComparer.Ordinal)));
        }

        foreach (Mob mob in wanderers)
        {
            // The mob is its creature card, named for it, in the pool; and its deck holds two to four of it.
            Assert.Equal(mob.File.Creature, mob.File.Name);
            Assert.Contains(mob.File.Creature, pool);
            Assert.Contains(content.Cards.Catalog[mob.File.Creature].Card.CardTypes, type => type.ToString() == "Creature");
            Assert.InRange(mob.Deck.Entries.Where(entry => entry.Card == mob.File.Creature).Sum(entry => entry.Copies), 2, 4);
        }

        Assert.Equal(wanderers.Count, wanderers.Select(mob => mob.File.Creature).Distinct().Count());
        Assert.Contains(wanderers, mob => mob.File.Creature == "Llanowar Elves" && mob.File.Tier == 1);
        Assert.Contains(wanderers, mob => mob.File.Creature == "Serra Angel");
    }

    [Fact]
    public void Each_region_of_the_generated_world_has_a_mage_for_every_tier_of_tower() => Each_region_has_a_mage_for_every_tier_of_tower("generated");

    [Theory]
    [InlineData("test")]
    public void Each_region_has_a_mage_for_every_tier_of_tower(string over)
    {
        RealmContent content = RealmApp.Of(over);
        foreach (string region in Regions)
        {
            for (int tier = 1; tier <= 4; tier++)
            {
                string tower = $"{region}-{tier}";
                Mob mage = content.Mobs[$"mage-{tower}"];
                Assert.Equal((tier, false), (mage.File.Tier, mage.File.Boss));
                Assert.Contains(mage.Deck.Entries, entry => entry.Card == mage.File.Creature);

                // Its tower: the mage at the top, a waystone.
                RealmDungeon dungeon = content.Dungeons[tower];
                Assert.Equal(("tower", true, mage.Id, tier), (dungeon.File.Theme, dungeon.File.Waystone, dungeon.File.Boss, dungeon.File.Tier));
            }
        }
    }

    [Fact]
    public void Wardens_bosses_and_tiers_pay_as_design_A3_says()
    {
        RealmContent content = RealmApp.Content;

        // Six dungeon wardens of tier 4 and a warden for each tier, each among its dungeons' challengers; five bosses who
        // unlock the five colors, and the capstone's praetor, who unlocks none.
        Assert.Equal(6, content.Mobs.Values.Count(mob => mob.Id.EndsWith("-warden", StringComparison.Ordinal) && mob.File.Tier == 4 && !mob.File.Boss));
        Assert.All(Enumerable.Range(1, 4), tier => Assert.Equal(tier, content.Mobs[$"warden-{tier}"].File.Tier));
        Assert.All(content.Mobs.Keys.Where(id => id.Contains("warden", StringComparison.Ordinal)), id => Assert.Contains(content.Dungeons.Values, dungeon => dungeon.Tables.Any(table => table.Contains(id))));
        List<Mob> bosses = [.. content.Mobs.Values.Where(mob => mob.File.Boss)];
        Assert.Equal("BGRUW", string.Concat(bosses.Select(boss => boss.File.Unlocks).OfType<string>().Order(StringComparer.Ordinal)));
        Assert.Equal(["phyrexian-praetor"], bosses.Where(boss => boss.File.Unlocks is null).Select(boss => boss.Id));
        Assert.Contains("Lyra Dawnbringer", content.Mobs["lyra-dawnbringer"].Deck.Entries.Select(entry => entry.Card));
        Assert.Contains("Teferi, Hero of Dominaria", content.Mobs["teferi"].Deck.Entries.Select(entry => entry.Card));
        Assert.Contains("Liliana of the Veil", content.Mobs["liliana"].Deck.Entries.Select(entry => entry.Card));

        Dictionary<int, (long Low, long High)> tiers = new() { [1] = (20, 60), [2] = (50, 150), [3] = (120, 300), [4] = (250, 600) };
        foreach (Mob mob in content.Mobs.Values.Where(mob => !mob.File.Boss))
        {
            Assert.Equal(tiers[mob.File.Tier], (mob.File.GoldRange[0], mob.File.GoldRange[1]));
        }
    }

    [Fact]
    public void No_pool_vendor_stock_boss_loot_or_starter_deck_can_hold_a_relic()
    {
        RealmContent content = RealmApp.Content;
        HashSet<string> relics = [.. content.Relics.Select(relic => relic.Card)];
        Assert.Contains("Black Lotus", relics);
        Assert.Equal(relics, content.Cards.Relics);

        // The pools (views of cards.json, which marks the relics), and so every vendor's stock and every mob's loot, which are
        // filters of them; and the off-plane pool.
        Assert.Equal(relics.Order(StringComparer.Ordinal), content.Records.Values.Where(record => record.Relic).Select(record => record.Name).Order(StringComparer.Ordinal));
        foreach (string plane in content.Cards.Planes)
        {
            Assert.DoesNotContain(content.Cards.Pool(plane), relics.Contains);
        }

        Assert.DoesNotContain(content.Cards.OffPlane.Keys, relics.Contains);

        Assert.All(content.Vendors.Values, vendor => Assert.DoesNotContain(content.Cards.Filter(vendor.Plane, vendor.File.Specialty), relics.Contains));
        Assert.All(content.Mobs.Values.Where(mob => mob.File.Loot is not null), mob => Assert.DoesNotContain(content.Cards.Filter(mob.File.Loot!.Pool ?? mob.Plane, mob.File.Loot), relics.Contains));
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
        RealmDungeon portal = content.Dungeons["phyrexian-portal"];
        Assert.Equal(("portal", "WUBRG", "phyrexian-praetor"), (portal.File.Theme, portal.File.Requires, portal.File.Boss));
        Assert.Contains("portal-warden", portal.Tables[^1]);
        Assert.All(portal.Tables.SelectMany(table => table), mob => Assert.Equal(4, content.Mobs[mob].File.Tier));
        Assert.All(content.Dungeons.Values.Where(dungeon => dungeon.File.Requires is not null), dungeon => Assert.Same(portal, dungeon));

        Mob praetor = content.Mobs["phyrexian-praetor"];
        Assert.True(praetor.File.Boss);
        Assert.Null(praetor.File.Unlocks);
        Assert.Contains("Sheoldred, the Apocalypse", praetor.Deck.Entries.Select(entry => entry.Card));
        Assert.Equal("WUBRG", CardPool.Letters(praetor.Deck.Entries.SelectMany(entry => content.Cards.Catalog[entry.Card].Identity)));
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
        RealmContent content = RealmApp.Content;
        foreach (Mob mob in content.Mobs.Values)
        {
            Assert.Equal(40, mob.Deck.Entries.Sum(entry => entry.Copies));
            List<string> problems = DeckChecks.Problems(content.Cards, [.. mob.Deck.Entries.Select(entry => new Cantrip.Decks.DeckEntry(entry.Card, entry.Copies))], identity: null);
            Assert.Empty(problems);
        }
    }

    [Fact]
    public void Llanowars_boss_is_rofellos_a_mono_green_deck_round_him_from_the_pool()
    {
        RealmContent content = RealmApp.Content;
        Mob rofellos = content.Mobs["rofellos"];
        Assert.Equal(("Rofellos, Llanowar Emissary", "G", true), (rofellos.File.Creature, rofellos.File.Unlocks, rofellos.File.Boss));
        Assert.Contains("Rofellos, Llanowar Emissary", content.Cards.Pool("dominaria"));
        Assert.InRange(rofellos.Deck.Entries.Where(entry => entry.Card == rofellos.File.Creature).Sum(entry => entry.Copies), 2, 4);
        Assert.Equal("G", CardPool.Letters(rofellos.Deck.Entries.SelectMany(entry => content.Cards.Catalog[entry.Card].Identity)));
        Assert.False(File.Exists(Path.Combine(RealmApp.Root, "realms", "content", "awaiting-engine.json")));
    }

    [Fact]
    public void The_test_world_is_walked_by_chunk_tile_and_town()
    {
        RealmWorld world = RealmApp.Content.World;

        // Five by four chunks of 32 tiles from (-32, 0), open grass but for the rock and the buildings; nothing off its edge.
        Assert.Equal((32, -32, 0, 160, 128), (world.Chunk, world.X0, world.Z0, world.Width, world.Height));
        Assert.Contains((-1, 0), world.Chunks);
        Assert.True(world.Walkable(new Tile(0, 0)));
        Assert.True(world.Walkable(new Tile(-1, 0)));
        Assert.True(world.Walkable(new Tile(-32, 127)));
        Assert.True(world.Walkable(new Tile(127, 127)));
        Assert.False(world.Walkable(new Tile(26, 5)));
        Assert.True(world.Has(new Tile(26, 5)));
        Assert.False(world.Has(new Tile(-33, 0)));
        Assert.False(world.Has(new Tile(128, 0)));
        Assert.False(world.Has(new Tile(0, -1)));
        Assert.Equal((0, 0), world.ChunkOf(new Tile(31, 31)));
        Assert.Equal((1, 3), world.ChunkOf(new Tile(32, 127)));
        Assert.Equal((-1, -1), world.ChunkOf(new Tile(-1, -32)));
        Assert.Equal((-2, 0), world.ChunkOf(new Tile(-33, 0)));

        // The rock is blocked but grows grass; a building's footprint is blocked and bare; its door is open ground.
        Assert.False(world.IsBare(new Tile(26, 5)));
        RealmInterior inn = RealmApp.Content.Interiors["new-benalia-inn"];
        Tile door = Assert.Single(inn.Doors);
        Assert.Equal(inn.File.ExitAt, door);
        Assert.True(world.Walkable(door));
        Assert.True(world.IsBare(new Tile(door.X, door.Z - 1)) && !world.Walkable(new Tile(door.X, door.Z - 1)));

        // A building belongs to the town its door stands in: within the town's radius in tiles, by the most of the two axes.
        Assert.Equal("new-benalia", inn.Town?.Id);
        Assert.Equal("new-benalia", RealmApp.Content.TownAt(new Tile(16, 16))?.Id);
        Assert.Equal("new-benalia", RealmApp.Content.TownAt(new Tile(26, 26))?.Id);
        Assert.Null(RealmApp.Content.TownAt(new Tile(27, 16)));
        Assert.Null(RealmApp.Content.TownAt(new Tile(120, 120)));
        Assert.Contains(world.SpellTables, table => RealmApp.Content.TownAt(table)?.Id == "new-benalia");

        // Inside the inn: its floor of 7 by 5 tiles and the sill past it, nothing to walk; the dais by the hearth 3 texels up.
        Assert.Contains(new Tile(5, 1), inn.SpellTables);
        Assert.Equal((0, 0, 7, 6), (inn.X0, inn.Z0, inn.X1, inn.Z1));
        Assert.True(inn.Walkable(new Tile(6, 4)));
        Assert.False(inn.Walkable(new Tile(4, 5)));
        Assert.True(inn.Has(new Tile(4, 5)));
        Assert.False(inn.Has(new Tile(7, 0)));
        Assert.Equal((3, 0), (inn.HeightAt(new Tile(0, 1)), inn.HeightAt(new Tile(1, 1))));
        Assert.True(inn.Walkable(new Tile(0, 1)));
    }

    [Fact]
    public void The_server_reads_the_slice_worlds_files_as_the_overworld_does()
    {
        // realms/web/fixtures/slice-world: the foundation's sample of version 2 (interfaces.md, "Version 2 of the world data"), with an origin west and north of
        // 0, negative chunks, heights in texels, bare tiles and tiles of no surface; read with the server's own reader.
        string folder = Path.Combine(RealmApp.Root, "realms", "web", "fixtures", "slice-world");
        List<string> problems = [];
        RealmWorld world = RealmContent.ReadWorld(folder, "dominaria", problems)!;
        Dictionary<string, RealmInterior> interiors = RealmContent.ReadInteriors(Path.Combine(folder, "interiors"), "dominaria", problems);
        Assert.Empty(problems);
        Assert.Equal(Directory.GetFiles(Path.Combine(folder, "chunks"), "*.json").Length, world.Chunks.Count);
        Assert.Contains(world.Chunks, chunk => chunk.Cx < 0 && chunk.Cz < 0);
        Assert.False(world.Has(new Tile(world.X0 - 1, world.Z0)));
        Assert.True(world.Has(new Tile(world.X0, world.Z0)));

        // Every door with an interior leads into one of its interiors, and comes out where the interior says.
        Assert.NotEmpty(world.Doors);
        foreach ((Tile door, string id) in world.Doors)
        {
            RealmInterior room = interiors[id];
            Assert.True(world.Walkable(door), id);
            Assert.Equal(door, room.File.ExitAt);
            Assert.True(room.Walkable(room.File.EntryAt!.Value), id);
        }

        // The tiles walked are the tiles the overworld's grid walks (world/load.ts: open unless blocked or of no surface),
        // tile by tile, counted from the chunk files themselves.
        int open = 0;
        int bare = 0;
        foreach (string path in Directory.GetFiles(Path.Combine(folder, "chunks"), "*.json"))
        {
            using JsonDocument chunk = JsonDocument.Parse(File.ReadAllBytes(path));
            int cx = chunk.RootElement.GetProperty("cx").GetInt32();
            int cz = chunk.RootElement.GetProperty("cz").GetInt32();
            int i = 0;
            foreach (JsonElement tile in chunk.RootElement.GetProperty("tiles").EnumerateArray())
            {
                var at = new Tile((cx * 32) + (i % 32), (cz * 32) + (i / 32));
                bool inside = world.Inside(at);
                bool walked = inside && (tile[2].GetInt32() & 1) == 0 && tile[1].GetString() != "";
                Assert.Equal(walked, world.Walkable(at));
                if (walked) open++;
                if (inside && (tile[2].GetInt32() & 2) != 0) bare++;
                Assert.Equal(inside ? tile[0].GetInt32() : 0, world.HeightAt(at));
                i++;
            }
        }

        Assert.True(open > 1000);
        Assert.True(bare > 0);
        Assert.Contains(interiors.Values, room => room.File.Area is not null);
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
            CopyDirectory(RealmApp.Places, Path.Combine(root, "places"));
            string content = Path.Combine(root, "realms", "content");
            string places = Path.Combine(root, "places", "dominaria");

            // A mob whose deck is gone, a mob that is not its creature's deck, gear in no slot, gear that looks like no gear
            // mesh, and gear that looks like a mesh made for another slot.
            Edit(Path.Combine(content, "dominaria", "mobs", "hurloon-minotaur.json"), json => json.Replace("decks/realms/dominaria/hurloon-minotaur.txt", "decks/realms/dominaria/missing.txt", StringComparison.Ordinal));
            Edit(Path.Combine(content, "dominaria", "mobs", "llanowar-elves.json"), json => json.Replace("\"creature\": \"Llanowar Elves\"", "\"creature\": \"Serra Angel\"", StringComparison.Ordinal));
            Edit(Path.Combine(content, "gear", "leather-cap.json"), json => json.Replace("\"slot\": \"head\"", "\"slot\": \"hat\"", StringComparison.Ordinal));
            Edit(Path.Combine(content, "gear", "benalish-plate.json"), json => json.Replace("\"mesh\": \"armor\"", "\"mesh\": \"tabard\"", StringComparison.Ordinal));
            Edit(Path.Combine(content, "gear", "boots-of-the-march.json"), json => json.Replace("\"mesh\": \"boots\"", "\"mesh\": \"crown\"", StringComparison.Ordinal));

            // A relic in a pool, and a relic from a mob that is no boss.
            Edit(Path.Combine(content, "cards.json"), json => System.Text.RegularExpressions.Regex.Replace(json, "(\\{\"name\":\"Black Lotus\",[^\\n]*)\"relic\":true", "$1\"relic\":false"));
            Edit(Path.Combine(content, "relics.json"), json => json.Replace("{ \"card\": \"Mox Pearl\", \"bosses\": [\"phyrexian-praetor\"]", "{ \"card\": \"Mox Pearl\", \"bosses\": [\"hurloon-minotaur\"]", StringComparison.Ordinal));

            // In the world: a spawn on the rock holding nobody, a spawn of the wrong tier, a door into no building, a dungeon
            // sealed to colors that are none, and one whose boss is nobody; a waystone of a dungeon with none; a chunk that
            // says it is another, a tile flagged with no flag there is, and a chunk a tile short.
            string chunk = Path.Combine(places, "world", "chunks", "0_0.json");
            string tier1 = RealmApp.SpawnOf(1).Id;
            Edit(chunk, json => json.Replace($"{{\"id\":\"{tier1}\",\"x\":10,\"z\":4,\"mobs\":[", $"{{\"id\":\"{tier1}\",\"x\":26,\"z\":4,\"mobs\":[\"nobody\",", StringComparison.Ordinal));
            Edit(Path.Combine(places, "world", "chunks", "-1_1.json"), json => json.Replace("\"cx\":-1,", "\"cx\":7,", StringComparison.Ordinal));
            Edit(Path.Combine(places, "world", "chunks", "0_3.json"), json => json.Replace("\"tower\":\"benalia-1\"", "\"tower\":\"hurloon-caves\"", StringComparison.Ordinal));
            Edit(Path.Combine(places, "world", "chunks", "3_3.json"), json => json.Replace("\"tiles\":[[0,\"grass\",0]", "\"tiles\":[[0,\"grass\",8]", StringComparison.Ordinal));
            Edit(Path.Combine(places, "world", "chunks", "2_3.json"), json => json.Replace("\"tiles\":[[0,\"grass\",0],", "\"tiles\":[", StringComparison.Ordinal));
            Edit(chunk, json => json.Replace("\"tier\":2}", "\"tier\":3}", StringComparison.Ordinal));
            Edit(chunk, json => json.Replace("\"interior\":\"new-benalia-smithy\"", "\"interior\":\"nowhere\"", StringComparison.Ordinal));
            Edit(Path.Combine(places, "dungeons", "phyrexian-portal.json"), json => json.Replace("\"requires\":\"WUBRG\"", "\"requires\":\"WX\"", StringComparison.Ordinal));
            Edit(Path.Combine(places, "dungeons", "hurloon-caves.json"), json => json.Replace("\"boss\":\"", "\"boss\":\"x", StringComparison.Ordinal));

            RealmContentException refused = Assert.Throws<RealmContentException>(() => RealmContent.Load(root, Path.Combine(RealmApp.Root, "content"), Path.Combine(root, "places")));
            Assert.Contains(refused.Problems, problem => problem.Contains("missing.txt", StringComparison.Ordinal));
            Assert.Contains("mob llanowar-elves: its deck does not hold Serra Angel, the creature it is.", refused.Problems);
            Assert.Contains(refused.Problems, problem => problem.Contains("slot 'hat'", StringComparison.Ordinal));
            Assert.Contains(refused.Problems, problem => problem.StartsWith("gear benalish-plate: its look 'tabard' is none of the gear meshes (", StringComparison.Ordinal));
            Assert.Contains("gear boots-of-the-march: its look 'crown' is made for the head slot, not feet.", refused.Problems);
            Assert.Contains("cards.json: Black Lotus: relic is false, but relics.json lists it.", refused.Problems);
            Assert.Contains("relics.json: Mox Pearl drops from 'hurloon-minotaur', which is no boss.", refused.Problems);
            Assert.Contains($"the world: spawn {tier1} stands on (26, 4), which nobody can stand on.", refused.Problems);
            Assert.Contains($"the world: spawn {tier1} holds 'nobody', which is no mob.", refused.Problems);
            Assert.Contains(refused.Problems, problem => problem.Contains("is tier 3 but holds", StringComparison.Ordinal));
            Assert.Contains(refused.Problems, problem => problem.Contains("leads into 'nowhere', which is no interior.", StringComparison.Ordinal));
            Assert.Contains("interior new-benalia-smithy: no door of the world leads into it.", refused.Problems);
            Assert.Contains("dungeon phyrexian-portal: it requires 'WX', which is not colors' letters (W U B R G).", refused.Problems);
            Assert.Contains(refused.Problems, problem => problem.StartsWith("dungeon hurloon-caves: its boss 'x", StringComparison.Ordinal));
            Assert.Contains("chunks/-1_1.json: it says it is chunk 7_1, but its name is -1_1.", refused.Problems);
            Assert.Contains("the world: benalia-1-waystone is a waystone, but 'hurloon-caves' is no mage tower of the world with a waystone.", refused.Problems);
            Assert.Contains("chunks/3_3.json: tile 0 is [height (whole texels), surface, flags 0-7], not [0,\"grass\",8].", refused.Problems);
            Assert.Contains("chunks/2_3.json: a chunk is 1024 tiles (32 by 32, row by row), not 1023.", refused.Problems);
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
        Assert.Contains("Lightning Bolt: 5 copies, more than the 4 a deck and its sideboard may have.", problems);
        Assert.Contains("Lightning Bolt is outside the color identity W.", problems);
        Assert.Contains("Black Lotus is restricted in Vintage: one copy at most, not 2.", problems);
        Assert.Contains(problems, problem => problem.StartsWith("A deck is at least 40 cards", StringComparison.Ordinal));
    }

    [Fact]
    public void A_card_the_deck_sites_legality_data_lacks_is_dealt_by_the_realms_own()
    {
        // content/mtg/legality.json has no Shivan Dragon; cards.json (Scryfall's legalities, card-economy.py) does.
        RealmContent content = RealmApp.Content;
        Assert.Contains("Shivan Dragon", content.Cards.Pool("dominaria"));
        Assert.Equal(("legal", "R"), (content.Records["Shivan Dragon"].Vintage, content.Records["Shivan Dragon"].Identity));
        Assert.Equal("R", CardPool.Letters(content.Cards.Catalog["Shivan Dragon"].Identity));
        Assert.Empty(DeckChecks.Problems(content.Cards, [new("Shivan Dragon", 4), new("Mountain", 36)], CardPool.Identity("R")));
        Assert.Equal(["Shivan Dragon is outside the color identity W."], DeckChecks.Problems(content.Cards, [new("Shivan Dragon", 4), new("Plains", 36)], CardPool.Identity("W")));
        Assert.Contains("Black Lotus is restricted in Vintage: one copy at most, not 2.", DeckChecks.Problems(content.Cards, [new("Black Lotus", 2), new("Mountain", 38)], identity: null));
    }

    [Fact]
    public void The_server_reads_the_realms_card_database_and_every_pool_card_agrees_with_its_record()
    {
        RealmContent content = RealmApp.Content;
        using JsonDocument file = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RealmApp.Root, "realms", "content", "cards.json")));
        Assert.Equal(file.RootElement.GetProperty("cards").GetArrayLength(), content.Records.Count);
        Assert.All(content.Records.Keys, name => Assert.Contains(name, content.Cards.Catalog.Keys));

        // Where cards come from: Alpha's are Dominaria's; a card first printed in a Commander deck is the multiverse's,
        // until an expansion prints it on a plane; a Ravnican card is Ravnica's.
        Assert.Equal(("dominaria", true), (content.Records["Serra Angel"].Origin, content.Records["Serra Angel"].Planes.Contains("dominaria")));
        Assert.Equal("multiverse", content.Records["True-Name Nemesis"].Origin);
        Assert.Equal("ravnica", content.Records["Dark Confidant"].Origin);
        Assert.Contains("lea", content.Records["Llanowar Elves"].Sets);

        HashSet<string> walked = [.. content.Cards.Planes];
        foreach (string plane in content.Cards.Planes)
        {
            foreach (string name in content.Cards.Pool(plane))
            {
                CardRecord record = content.Records[name];
                Assert.True(record.Dealt, name);
                Assert.Contains(plane, record.Planes);
                Assert.Equal(record.Gold, content.Cards.Price(name));
                Assert.Equal(record.Identity, CardPool.Letters(content.Cards.Catalog[name].Identity));
                Assert.Equal(record.Vintage, content.Cards.Catalog[name].LegalityIn(DeckFormat.VintageKey));

                // Its types and subtypes are the engine's (Kindred was Tribal), so a vendor's specialty reads alike either way.
                CatalogCard card = content.Cards.Catalog[name];
                Assert.Equal(
                    card.Card.CardTypes.Select(type => type.ToString().Replace("Tribal", "Kindred", StringComparison.Ordinal)).Order(StringComparer.Ordinal),
                    record.Types.Select(type => type.Replace("Tribal", "Kindred", StringComparison.Ordinal)).Order(StringComparer.Ordinal));
                Assert.Equal(card.Card.Subtypes.Order(StringComparer.Ordinal), record.Subtypes.Order(StringComparer.Ordinal));
            }
        }

        // The off-plane pool is every dealt card printed on no walked plane; nothing else is dealt anywhere. Basic lands are
        // free, and in no pool.
        bool Basic(CardRecord record) => CardPool.IsBasic(content.Cards.Catalog[record.Name]);
        Assert.All(content.Records.Values.Where(record => record.Dealt && !Basic(record)), record =>
            Assert.True(record.Planes.Any(walked.Contains) ? content.Cards.Pool("dominaria").Contains(record.Name) : content.Cards.OffPlane.ContainsKey(record.Name), record.Name));
        Assert.All(content.Records.Values.Where(record => !record.Dealt), record =>
            Assert.False(content.Cards.OffPlane.ContainsKey(record.Name) || content.Cards.Pool("dominaria").Contains(record.Name), record.Name));
        Assert.All(content.Records.Values.Where(record => record.UniversesBeyond), record => Assert.False(record.Dealt, record.Name));
    }

    [Fact]
    public void Every_new_card_set_is_placed_on_a_plane_or_deliberately_not()
    {
        // planes.json's own consistency, as card-economy.py checks it against Scryfall's whole list of sets: no set two
        // planes', no set both placed and ignored, and every plane's name.
        using JsonDocument file = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RealmApp.Root, "realms", "content", "planes.json")));
        JsonElement root = file.RootElement;
        List<string> placed = [.. root.GetProperty("planes").EnumerateObject().SelectMany(plane => plane.Value.GetProperty("sets").EnumerateArray().Select(set => set.GetString()!))];
        Assert.Equal(placed.Count, placed.Distinct().Count());
        HashSet<string> ignored = [.. root.GetProperty("ignoredSets").EnumerateObject().Select(set => set.Name)];
        HashSet<string> beyond = [.. root.GetProperty("universesBeyondSets").EnumerateArray().Select(set => set.GetString()!)];
        Assert.DoesNotContain(placed, ignored.Contains);
        Assert.DoesNotContain(placed, beyond.Contains);
        Assert.Equal(["dominaria"], root.GetProperty("planes").EnumerateObject().Where(plane => plane.Value.TryGetProperty("walked", out JsonElement walked) && walked.GetBoolean()).Select(plane => plane.Name));
        Assert.Contains("core", root.GetProperty("reprintSetTypes").EnumerateArray().Select(type => type.GetString()));

        // Every record's sets: a card printed in a set Dominaria places, as a new card, is on Dominaria.
        Assert.All(RealmApp.Content.Records.Values.Where(record => record.Sets.Contains("dom") || record.Sets.Contains("dmu")), record => Assert.Contains("dominaria", record.Planes));
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
