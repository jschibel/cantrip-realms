using System.Text.Json;
using System.Text.RegularExpressions;
using Cantrip.Decks;
using Cantrip.Server;
using Cantrip.Server.Decks;

namespace Cantrip.Realms.Server.Content;

/// <summary>A map as the server walks it: its file, and its tiles by hex.</summary>
public sealed class RealmMap
{
    private readonly Dictionary<Hex, Tile> _tiles;

    public RealmMap(MapFile file, string plane, IEnumerable<Tile> tiles)
    {
        File = file;
        Plane = plane;
        _tiles = [];
        foreach (Tile tile in tiles) _tiles.TryAdd(tile.At, tile);
    }

    public MapFile File { get; }

    public string Id => File.Id;

    /// <summary>The plane the map is on.</summary>
    public string Plane { get; }

    public IReadOnlyCollection<Tile> Tiles => _tiles.Values;

    public Tile? TileAt(Hex at) => _tiles.TryGetValue(at, out Tile tile) ? tile : null;

    /// <summary>Whether someone may stand on a hex: it is on the map and not blocked.</summary>
    public bool Walkable(Hex at) => _tiles.TryGetValue(at, out Tile tile) && !tile.Blocked;

    public MapSpawn? Spawn(string id) => File.Spawns.FirstOrDefault(spawn => spawn.Id == id);

    public MapChest? Chest(string id) => File.Chests.FirstOrDefault(chest => chest.Id == id);

    /// <summary>
    /// The hexes a spell table stands on (design.md A2): a <c>spell-table</c> prop or NPC. A character stands at one on it or
    /// next to it.
    /// </summary>
    public IEnumerable<Hex> SpellTables =>
        File.Props.Where(prop => prop.Kind == SpellTable).Select(prop => new Hex(prop.Q, prop.R))
            .Concat(File.Npcs.Where(npc => npc.Kind == SpellTable).Select(npc => npc.At));

    public const string SpellTable = "spell-table";
}

/// <summary>A mob, with its deck read.</summary>
public sealed record Mob(MobFile File, string Plane, DeckList Deck)
{
    public string Id => File.Id;
}

/// <summary>A vendor, with the plane it trades in.</summary>
public sealed record Vendor(VendorFile File, string Plane)
{
    public string Id => File.Id;
}

/// <summary>Content that does not hold together: everything found wrong with it, one line each.</summary>
public sealed class RealmContentException(IReadOnlyList<string> problems)
    : Exception($"The realm's content has {problems.Count} problem(s):\n" + string.Join('\n', problems))
{
    public IReadOnlyList<string> Problems { get; } = problems;
}

/// <summary>
/// Everything the realm is made of, read and checked at start (realms/docs/interfaces.md, "Content"): the gear, and each
/// plane's mobs and their decks, maps, vendors and starter decks, over the cards of <see cref="CardPool"/>. A server whose
/// content does not hold together does not start: <see cref="Load"/> says everything wrong at once.
/// </summary>
public sealed partial class RealmContent
{
    /// <summary>The eight slots of a character's loadout (design.md A4), and the kind of item each holds.</summary>
    public static IReadOnlyDictionary<string, string> LoadoutSlots { get; } = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["head"] = "head",
        ["neck"] = "neck",
        ["body"] = "body",
        ["hands"] = "hands",
        ["feet"] = "feet",
        ["ring1"] = "ring",
        ["ring2"] = "ring",
        ["relic"] = "relic",
    };

    /// <summary>The kinds of gear item.</summary>
    public static IReadOnlySet<string> GearSlots { get; } = new HashSet<string>(StringComparer.Ordinal) { "head", "neck", "body", "hands", "feet", "ring", "relic" };

    public static IReadOnlySet<string> Rarities { get; } = new HashSet<string>(StringComparer.Ordinal) { "common", "uncommon", "rare", "mythic" };

    public static IReadOnlySet<string> MapKinds { get; } = new HashSet<string>(StringComparer.Ordinal) { "town", "village", "wilderness", "dungeon", "world" };

    /// <summary>The people and places of a map a player uses (interfaces.md, "Maps").</summary>
    public static IReadOnlySet<string> NpcKinds { get; } = new HashSet<string>(StringComparer.Ordinal) { "inn", "spell-table", "vendor", "armorer", "quest-board", "arena", "townsfolk" };

    /// <summary>The world map's id: the travel map, whose exits are its places.</summary>
    public const string World = "world";

    /// <summary>The five colors a character may start in, and the file each starter deck is in.</summary>
    public static IReadOnlyDictionary<string, string> StarterFiles { get; } = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["W"] = "white",
        ["U"] = "blue",
        ["B"] = "black",
        ["R"] = "red",
        ["G"] = "green",
    };

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
    };

    [GeneratedRegex("^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex KebabCase();

    private RealmContent(string root, CardPool cards)
    {
        Root = root;
        Cards = cards;
    }

    /// <summary>The repository the content was read from.</summary>
    public string Root { get; }

    public CardPool Cards { get; }

    public IReadOnlyDictionary<string, GearItem> Gear { get; private set; } = new Dictionary<string, GearItem>();

    public IReadOnlyDictionary<string, Mob> Mobs { get; private set; } = new Dictionary<string, Mob>();

    public IReadOnlyDictionary<string, RealmMap> Maps { get; private set; } = new Dictionary<string, RealmMap>();

    public IReadOnlyDictionary<string, Vendor> Vendors { get; private set; } = new Dictionary<string, Vendor>();

    /// <summary>The kind of each voxel model of <c>realms/content/models</c> (<c>body</c>, <c>mob</c> or <c>gear</c>), by id.</summary>
    public IReadOnlyDictionary<string, string> Models { get; private set; } = new Dictionary<string, string>();

    /// <summary>Each plane's starter decks, by color letter.</summary>
    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, DeckList>> Starters { get; private set; } =
        new Dictionary<string, IReadOnlyDictionary<string, DeckList>>();

    /// <summary>
    /// Reads and checks the realm's content under a repository: <c>realms/content</c>, the decks under <c>decks/</c> that
    /// mobs name, and the engine's card catalog under <c>content/</c>.
    /// </summary>
    /// <param name="cardContent">Where the engine's card content is; the repository's <c>content/</c> unless given.</param>
    /// <exception cref="RealmContentException">Anything that does not hold together.</exception>
    public static RealmContent Load(string repositoryRoot, string? cardContent = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(repositoryRoot);
        string root = Path.GetFullPath(repositoryRoot);
        string realms = Path.Combine(root, "realms", "content");
        List<string> problems = [];

        Dictionary<string, CardPrice> prices = CardPool.ReadPrices(Path.Combine(realms, "prices.json"));
        Dictionary<string, IReadOnlyList<string>> pools = new(StringComparer.Ordinal);
        foreach (string file in Directory.EnumerateFiles(Path.Combine(realms, "pools"), "*.json").Order(StringComparer.Ordinal))
        {
            using JsonDocument pool = JsonDocument.Parse(System.IO.File.ReadAllBytes(file));
            pools[pool.RootElement.GetProperty("plane").GetString() ?? Path.GetFileNameWithoutExtension(file)] =
                [.. pool.RootElement.GetProperty("cards").EnumerateArray().Select(card => card.GetString() ?? string.Empty)];
        }

        var cards = new CardPool(DeckCatalog.ByName(cardContent ?? Path.Combine(root, "content")), prices, pools);
        var content = new RealmContent(root, cards);

        foreach ((string name, CardPrice price) in prices)
        {
            if (!Pricing.Surcharge.ContainsKey(price.Rarity))
            {
                problems.Add($"prices.json: {name} has rarity '{price.Rarity}'.");
            }
            else if (price.Gold != Pricing.ListPrice(price.Usd, price.Rarity))
            {
                problems.Add($"prices.json: {name} is {price.Gold} gold, but ${price.Usd} at {price.Rarity} lists at {Pricing.ListPrice(price.Usd, price.Rarity)}.");
            }
        }

        foreach ((string plane, IReadOnlyList<string> pool) in pools)
        {
            foreach (string name in pool.Where(name => !cards.Catalog.ContainsKey(name)))
            {
                problems.Add($"pools/{plane}.json: {name} is not a card the engine plays.");
            }
        }

        content.Models = ReadModels(Path.Combine(realms, "models"), problems);
        content.Gear = ReadGear(Path.Combine(realms, "gear"), problems);

        Dictionary<string, Mob> mobs = new(StringComparer.Ordinal);
        Dictionary<string, RealmMap> maps = new(StringComparer.Ordinal);
        Dictionary<string, Vendor> vendors = new(StringComparer.Ordinal);
        Dictionary<string, IReadOnlyDictionary<string, DeckList>> starters = new(StringComparer.Ordinal);
        foreach (string plane in pools.Keys)
        {
            string folder = Path.Combine(realms, plane);
            foreach ((string file, MobFile mob) in Read<MobFile>(Path.Combine(folder, "mobs"), problems))
            {
                if (Named(file, mob.Id, mobs.ContainsKey(mob.Id), problems) && ReadDeck(root, mob.Deck, $"{file}: its deck", problems) is { } deck)
                {
                    mobs[mob.Id] = new Mob(mob, plane, deck);
                }
            }

            foreach ((string file, MapFile map) in Read<MapFile>(Path.Combine(folder, "maps"), problems))
            {
                if (Named(file, map.Id, maps.ContainsKey(map.Id), problems))
                {
                    maps[map.Id] = new RealmMap(map, plane, ReadTiles(file, map, problems));
                }
            }

            foreach ((string file, VendorFile vendor) in Read<VendorFile>(Path.Combine(folder, "vendors"), problems))
            {
                if (Named(file, vendor.Id, vendors.ContainsKey(vendor.Id), problems))
                {
                    vendors[vendor.Id] = new Vendor(vendor, plane);
                }
            }

            Dictionary<string, DeckList> planeStarters = new(StringComparer.Ordinal);
            foreach ((string color, string name) in StarterFiles)
            {
                string path = Path.Combine("realms", "content", plane, "starters", name + ".txt");
                if (ReadDeck(root, path, $"{plane}'s {name} starter deck", problems) is { } deck)
                {
                    planeStarters[color] = deck;
                }
            }

            starters[plane] = planeStarters;
        }

        content.Mobs = mobs;
        content.Maps = maps;
        content.Vendors = vendors;
        content.Starters = starters;
        content.Check(problems);

        return problems.Count == 0 ? content : throw new RealmContentException(problems);
    }

    private static Dictionary<string, GearItem> ReadGear(string folder, List<string> problems)
    {
        Dictionary<string, GearItem> gear = new(StringComparer.Ordinal);
        HashSet<string> emblems = new(StringComparer.Ordinal);
        foreach ((string file, GearItem item) in Read<GearItem>(folder, problems))
        {
            if (!Named(file, item.Id, gear.ContainsKey(item.Id), problems))
            {
                continue;
            }

            if (string.IsNullOrWhiteSpace(item.Name)) problems.Add($"{file}: no name.");
            if (!GearSlots.Contains(item.Slot)) problems.Add($"{file}: slot '{item.Slot}' is none of {string.Join(", ", GearSlots)}.");
            if (!Rarities.Contains(item.Rarity)) problems.Add($"{file}: rarity '{item.Rarity}' is none of {string.Join(", ", Rarities)}.");
            if (item.Gold <= 0) problems.Add($"{file}: an item's gold is more than nothing.");
            if (string.IsNullOrWhiteSpace(item.Look.Mesh)) problems.Add($"{file}: no look.");
            if (item.Emblem is { } emblem && !emblems.Add(emblem)) problems.Add($"{file}: a second item makes the emblem '{emblem}'.");
            foreach (JsonElement effect in item.Effects)
            {
                if (effect.ValueKind != JsonValueKind.Object || !effect.TryGetProperty("family", out JsonElement family) || family.ValueKind != JsonValueKind.String)
                {
                    problems.Add($"{file}: an effect without a family.");
                }
            }

            gear[item.Id] = item;
        }

        return gear;
    }

    private static Dictionary<string, string> ReadModels(string folder, List<string> problems)
    {
        Dictionary<string, string> models = new(StringComparer.Ordinal);
        if (!Directory.Exists(folder)) return models;
        foreach (string path in Directory.EnumerateFiles(folder, "*.vox.json").Order(StringComparer.Ordinal))
        {
            string file = Path.GetFileName(path);
            try
            {
                using JsonDocument model = JsonDocument.Parse(System.IO.File.ReadAllBytes(path));
                string id = model.RootElement.GetProperty("id").GetString() ?? string.Empty;
                if (file != id + ".vox.json") problems.Add($"models/{file}: its id '{id}' is its file's name.");
                else models[id] = model.RootElement.GetProperty("kind").GetString() ?? string.Empty;
            }
            catch (Exception problem) when (problem is JsonException or KeyNotFoundException or InvalidOperationException)
            {
                problems.Add($"models/{file}: {problem.Message}");
            }
        }

        return models;
    }

    /// <summary>Whether a mesh is a model of a kind (a gear item's look, a mob's model).</summary>
    private bool IsModel(string mesh, string kind) => Models.TryGetValue(mesh, out string? found) && found == kind;

    /// <summary>Checks what refers to what, once everything is read.</summary>
    private void Check(List<string> problems)
    {
        foreach (GearItem item in Gear.Values.Where(item => !string.IsNullOrWhiteSpace(item.Look.Mesh) && !IsModel(item.Look.Mesh, "gear")))
        {
            problems.Add($"gear {item.Id}: its look '{item.Look.Mesh}' is no gear model of realms/content/models.");
        }

        foreach (Mob mob in Mobs.Values)
        {
            CheckMob(mob, problems);
        }

        foreach (RealmMap map in Maps.Values)
        {
            CheckMap(map, problems);
        }

        foreach (Vendor vendor in Vendors.Values)
        {
            string where = $"vendor {vendor.Id}";
            if (string.IsNullOrWhiteSpace(vendor.File.Name)) problems.Add($"{where}: no name.");
            if (!Maps.TryGetValue(vendor.File.Town, out RealmMap? town) || town.File.Kind is not ("town" or "village"))
            {
                problems.Add($"{where}: its town '{vendor.File.Town}' is not a town's map.");
            }

            else if (!town.File.Npcs.Any(npc => npc.Kind == "vendor" && npc.Vendor == vendor.Id))
            {
                problems.Add($"{where}: nobody keeps its stall in {vendor.File.Town}: no vendor of the map names it.");
            }

            if (vendor.File.Purse < 0) problems.Add($"{where}: a purse is never less than nothing.");
            if (Cards.Filter(vendor.Plane, vendor.File.Specialty).Count == 0) problems.Add($"{where}: its specialty has no card in the {vendor.Plane} pool.");
        }

        foreach ((string plane, IReadOnlyDictionary<string, DeckList> decks) in Starters)
        {
            foreach ((string color, DeckList deck) in decks)
            {
                string where = $"{plane}'s {StarterFiles[color]} starter deck";
                problems.AddRange(DeckProblems(deck, plane, CardPool.Identity(color)).Select(problem => $"{where}: {problem}"));
                foreach (DeckListEntry entry in deck.Entries)
                {
                    if (Cards.Catalog.TryGetValue(entry.Card, out var card) && !CardPool.IsBasic(card)
                        && Cards.Prices.TryGetValue(entry.Card, out CardPrice? price) && price.Rarity is not ("common" or "uncommon"))
                    {
                        problems.Add($"{where}: {entry.Card} is {price.Rarity}; a starter deck is commons and uncommons.");
                    }
                }
            }
        }
    }

    private void CheckMob(Mob mob, List<string> problems)
    {
        MobFile file = mob.File;
        string where = $"mob {mob.Id}";
        if (string.IsNullOrWhiteSpace(file.Name)) problems.Add($"{where}: no name.");
        if (file.Boss ? file.Unlocks is not { Length: 1 } || CardPool.Color(file.Unlocks[0]) is null : file.Tier is < 1 or > 4)
        {
            problems.Add(file.Boss ? $"{where}: a boss unlocks one color, W U B R or G." : $"{where}: tier {file.Tier} is not 1 to 4.");
        }

        if (file.Stats.Life < 1 || file.Stats.Hand is < 0 or > 254 || file.Stats.MaxHand < 0)
        {
            problems.Add($"{where}: stats {file.Stats} are not a game's (life at least 1, a hand of 0 to 254, a maximum hand of 0 or more).");
        }

        foreach (string gear in file.Gear.Where(gear => !Gear.ContainsKey(gear)))
        {
            problems.Add($"{where}: wears '{gear}', which is no gear item.");
        }

        if (!IsModel(file.Model.Mesh, "mob")) problems.Add($"{where}: its model '{file.Model.Mesh}' is no mob model of realms/content/models.");
        if (file.Prize < 0) problems.Add($"{where}: a prize is never less than nothing.");
        if (file.GoldRange is not [long low, long high] || low < 0 || high < low)
        {
            problems.Add($"{where}: its gold range is two amounts, the lower first.");
        }

        string pool = file.Loot.Pool ?? mob.Plane;
        if (!Cards.Planes.Contains(pool, StringComparer.Ordinal)) problems.Add($"{where}: its loot pool '{pool}' is no plane's.");
        else if (Cards.Filter(pool, file.Loot).Count == 0) problems.Add($"{where}: its loot has no card in the {pool} pool.");
        foreach (string rarity in file.Loot.Rarities.Where(rarity => !Rarities.Contains(rarity))) problems.Add($"{where}: loot rarity '{rarity}'.");

        problems.AddRange(DeckProblems(mob.Deck, mob.Plane, identity: null).Select(problem => $"{where}'s deck: {problem}"));
    }

    private void CheckMap(RealmMap map, List<string> problems)
    {
        MapFile file = map.File;
        string where = $"map {map.Id}";
        if (string.IsNullOrWhiteSpace(file.Name)) problems.Add($"{where}: no name.");
        if (!MapKinds.Contains(file.Kind)) problems.Add($"{where}: kind '{file.Kind}' is none of {string.Join(", ", MapKinds)}.");
        if (file.Kind == "dungeon" && file.Floor is null) problems.Add($"{where}: a dungeon floor says which floor it is.");

        HashSet<string> spawns = new(StringComparer.Ordinal);
        foreach (MapSpawn spawn in file.Spawns)
        {
            if (!KebabCase().IsMatch(spawn.Id) || !spawns.Add(spawn.Id)) problems.Add($"{where}: spawn '{spawn.Id}' is not a fresh kebab-case id.");
            if (!map.Walkable(spawn.At)) problems.Add($"{where}: spawn {spawn.Id} stands on {spawn.At}, which nobody can stand on.");
            if (spawn.Mobs.Count == 0) problems.Add($"{where}: spawn {spawn.Id} has no mobs.");
            foreach (string mob in spawn.Mobs.Where(mob => !Mobs.ContainsKey(mob))) problems.Add($"{where}: spawn {spawn.Id} holds '{mob}', which is no mob.");
            if (spawn.Radius < 0 || spawn.RespawnSeconds <= 0) problems.Add($"{where}: spawn {spawn.Id} has a radius of 0 or more and respawns after some seconds.");
        }

        HashSet<string> chests = new(StringComparer.Ordinal);
        foreach (MapChest chest in file.Chests)
        {
            if (!KebabCase().IsMatch(chest.Id) || !chests.Add(chest.Id)) problems.Add($"{where}: chest '{chest.Id}' is not a fresh kebab-case id.");
            if (map.TileAt(chest.At) is null) problems.Add($"{where}: chest {chest.Id} is off the map at {chest.At}.");
            if (chest.Gold is not [long low, long high] || low < 0 || high < low) problems.Add($"{where}: chest {chest.Id}'s gold is two amounts, the lower first.");
            if (chest.RespawnSeconds <= 0) problems.Add($"{where}: chest {chest.Id} refills after some seconds.");
        }

        foreach (MapNpc npc in file.Npcs)
        {
            if (map.TileAt(npc.At) is null) problems.Add($"{where}: {npc.Id} stands off the map at {npc.At}.");
            if (!NpcKinds.Contains(npc.Kind)) problems.Add($"{where}: {npc.Id} is a '{npc.Kind}', none of {string.Join(", ", NpcKinds)}.");
            if (npc.Kind == "vendor" && (npc.Vendor is null || !Vendors.TryGetValue(npc.Vendor, out Vendor? vendor) || vendor.File.Town != map.Id))
            {
                problems.Add($"{where}: {npc.Id} is a vendor, but '{npc.Vendor}' is no vendor of this town.");
            }
        }

        foreach (MapExit exit in file.Exits)
        {
            if (map.TileAt(new Hex(exit.Q, exit.R)) is null) problems.Add($"{where}: an exit is off the map at ({exit.Q}, {exit.R}).");
            if (exit.To != World && !Maps.ContainsKey(exit.To)) problems.Add($"{where}: an exit leads to '{exit.To}', which is no map.");
        }

        foreach (MapEncounterZone zone in file.Encounters)
        {
            if (file.Kind != World) problems.Add($"{where}: only the world map has encounter zones.");
            if (!Maps.TryGetValue(zone.Map, out RealmMap? fought)) problems.Add($"{where}: an encounter zone is fought on '{zone.Map}', which is no map.");
            else if (fought.File.Spawns.Count == 0) problems.Add($"{where}: an encounter zone is fought on {zone.Map}, which has no spawn to be the mob.");
            if (map.TileAt(new Hex(zone.Q, zone.R)) is null) problems.Add($"{where}: an encounter zone is off the map at ({zone.Q}, {zone.R}).");
            if (zone.Chance is < 0 or > 1 || double.IsNaN(zone.Chance)) problems.Add($"{where}: an encounter zone's chance is from 0 to 1.");
        }

        CheckInn(map, problems);
    }

    /// <summary>
    /// A map's inn (interfaces.md, "Maps"): none on the world map; a town's or village's an open hex of its own; any other
    /// map's the inn of a town or village, named by its map and hex.
    /// </summary>
    private void CheckInn(RealmMap map, List<string> problems)
    {
        MapFile file = map.File;
        string where = $"map {map.Id}";
        bool settlement = file.Kind is "town" or "village";
        if (file.Kind == World)
        {
            if (file.Inn is not null) problems.Add($"{where}: the world map names no inn.");
        }
        else if (file.Inn is not { } inn)
        {
            problems.Add($"{where}: no inn, so a character who loses here has nowhere to wake.");
        }
        else if (inn.Map is null)
        {
            if (!settlement) problems.Add($"{where}: only a town's or village's inn is its own; any other map names its nearest town's.");
            if (!map.Walkable(inn.At)) problems.Add($"{where}: its inn is at {inn.At}, which nobody can stand on.");
        }
        else if (settlement)
        {
            problems.Add($"{where}: a {file.Kind}'s inn is its own.");
        }
        else if (!Maps.TryGetValue(inn.Map, out RealmMap? town))
        {
            problems.Add($"{where}: its inn is on '{inn.Map}', which is no map.");
        }
        else if (town.File.Kind is not ("town" or "village") || town.File.Inn is not { Map: null } own || own.At != inn.At)
        {
            problems.Add($"{where}: its inn is {inn.Map}'s at {inn.At}, which is not that town's or village's own inn.");
        }
    }

    /// <summary>
    /// What is wrong with a decklist as a deck of the realm (design.md A2) - forty cards or more, no more copies of a card
    /// than Vintage allows (four, one of a restricted card), every card legal in Vintage, in the plane's pool and, with an
    /// identity given, within it - leaving out whether a player owns the cards.
    /// </summary>
    private List<string> DeckProblems(DeckList deck, string plane, IReadOnlySet<Cantrip.Protocol.ColorView>? identity)
    {
        List<string> problems = [];
        HashSet<string> pool = new(Cards.Pool(plane), StringComparer.Ordinal);
        List<DeckEntry> entries = [.. deck.Entries.Select(entry => new DeckEntry(entry.Card, entry.Copies))];
        problems.AddRange(DeckChecks.Problems(Cards, entries, identity));
        foreach (DeckEntry entry in entries)
        {
            if (Cards.Catalog.TryGetValue(entry.Card, out var card) && !CardPool.IsBasic(card) && !pool.Contains(entry.Card))
            {
                problems.Add($"{entry.Card} is not in the {plane} pool.");
            }
        }

        if (deck.Sideboard.Count > 0 || deck.Commanders.Count > 0 || deck.Companion is not null)
        {
            problems.Add("a realm deck is a main deck alone.");
        }

        return problems;
    }

    private static DeckList? ReadDeck(string root, string relative, string where, List<string> problems)
    {
        string path = Path.GetFullPath(Path.Combine(root, relative));
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(path))
        {
            problems.Add($"{where}: no decklist at {relative}.");
            return null;
        }

        return DeckList.Load(path);
    }

    private static bool Named(string file, string id, bool taken, List<string> problems)
    {
        if (!KebabCase().IsMatch(id) || Path.GetFileNameWithoutExtension(file) != id)
        {
            problems.Add($"{file}: its id '{id}' is kebab-case and its file's name.");
            return false;
        }

        if (taken)
        {
            problems.Add($"{file}: the id '{id}' is taken.");
            return false;
        }

        return true;
    }

    private static List<(string File, T Value)> Read<T>(string folder, List<string> problems)
    {
        List<(string, T)> read = [];
        if (!Directory.Exists(folder))
        {
            return read;
        }

        foreach (string path in Directory.EnumerateFiles(folder, "*.json").Order(StringComparer.Ordinal))
        {
            string file = Path.GetFileName(path);
            try
            {
                T? value = JsonSerializer.Deserialize<T>(System.IO.File.ReadAllBytes(path), Json);
                if (value is null) problems.Add($"{file}: empty.");
                else read.Add((file, value));
            }
            catch (JsonException problem)
            {
                problems.Add($"{file}: {problem.Message}");
            }
        }

        return read;
    }

    private static List<Tile> ReadTiles(string file, MapFile map, List<string> problems)
    {
        List<Tile> tiles = [];
        HashSet<Hex> seen = [];
        foreach (JsonElement tile in map.Tiles)
        {
            if (tile.ValueKind != JsonValueKind.Array || tile.GetArrayLength() != 5
                || !tile[0].TryGetInt32(out int q) || !tile[1].TryGetInt32(out int r) || !tile[2].TryGetDouble(out double height)
                || tile[3].ValueKind != JsonValueKind.String || !tile[4].TryGetInt32(out int blocked) || blocked is not (0 or 1))
            {
                problems.Add($"{file}: a tile is [q, r, height, terrain, blocked]: {tile.GetRawText()}.");
                continue;
            }

            var at = new Hex(q, r);
            if (!seen.Add(at)) problems.Add($"{file}: two tiles at {at}.");
            else if (at.DistanceTo(new Hex(0, 0)) > map.Radius) problems.Add($"{file}: the tile at {at} is beyond the map's radius {map.Radius}.");
            else tiles.Add(new Tile(at, height, tile[3].GetString()!, blocked == 1));
        }

        return tiles;
    }
}
