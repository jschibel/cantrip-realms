using System.Text.Json;
using System.Text.RegularExpressions;
using Cantrip.Decks;
using Cantrip.Server;
using Cantrip.Server.Decks;

namespace Cantrip.Realms.Server.Content;

/// <summary>A mob, with its deck read.</summary>
public sealed record Mob(MobFile File, string Plane, DeckList Deck)
{
    public string Id => File.Id;
}

/// <summary>A vendor, with the plane it trades in.</summary>
public sealed record Vendor(VendorFile File, string Plane)
{
    public string Id => File.Id;

    /// <summary>What kind of dealer it is: <see cref="Shop"/> (Dominaria's own), <see cref="ExoticShop"/> or <see cref="Traveler"/>.</summary>
    public string Kind => File.Trader is not null ? Traveler : File.Exotic ? ExoticShop : Shop;

    /// <summary>Whether it deals in off-plane cards alone: an exotic wares shop or a traveling trader.</summary>
    public bool Exotic => Kind != Shop;

    public const string Shop = "shop";
    public const string ExoticShop = "exotic";
    public const string Traveler = "trader";
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

    /// <summary>The world's space id (interfaces.md, "Places"); an interior's is its own id, a dungeon run's <c>run:&lt;id&gt;</c>.</summary>
    public const string WorldSpace = "world";

    /// <summary>The kinds of town of the world.</summary>
    public static IReadOnlySet<string> TownKinds { get; } = new HashSet<string>(StringComparer.Ordinal) { "town", "village", "capital" };

    /// <summary>The kinds of interior.</summary>
    public static IReadOnlySet<string> InteriorKinds { get; } = new HashSet<string>(StringComparer.Ordinal) { "shop", "inn", "guildhall", "temple", "smithy", "library", "house", "tower", "exotic-wares", "crypt" };

    /// <summary>The themes of dungeon (design.md A6), each a generator of realms/web/src/dungeon.</summary>
    public static IReadOnlySet<string> DungeonThemes { get; } = new HashSet<string>(StringComparer.Ordinal) { "caves", "castle", "tower", "crypt", "hollow", "foundry", "portal" };

    /// <summary>
    /// The mob meshes (interfaces.md, "Models"): a mob's <c>model.mesh</c> is one of them, whether or not its model is drawn
    /// yet (an unknown mesh is drawn as <c>humanoid</c>), and every mob model of realms/content/models is one of them.
    /// </summary>
    public static IReadOnlySet<string> MobMeshes { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "humanoid", "ghoul", "angel", "drake", "elf", "goblin", "wurm", "construct", "spirit", "phyrexian",
        "dragon", "bird", "beast", "cat", "merfolk", "insect", "treefolk", "serpent", "giant", "wizard", "knight",
    };

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

    /// <summary>The world (design.md A6): one plane's, the one a character stands in.</summary>
    public RealmWorld World { get; private set; } = new(new WorldFile(), string.Empty);

    public IReadOnlyDictionary<string, RealmInterior> Interiors { get; private set; } = new Dictionary<string, RealmInterior>();

    public IReadOnlyDictionary<string, RealmDungeon> Dungeons { get; private set; } = new Dictionary<string, RealmDungeon>();

    /// <summary>The world's towns, by id.</summary>
    public IReadOnlyDictionary<string, TownEntry> Towns { get; private set; } = new Dictionary<string, TownEntry>();

    /// <summary>The world's inns, by id.</summary>
    public IReadOnlyDictionary<string, InnEntry> Inns { get; private set; } = new Dictionary<string, InnEntry>();

    /// <summary>A space by its id: the world, or an interior; null for a run's, which the server does not walk, or none.</summary>
    public RealmSpace? Space(string? id) =>
        id == WorldSpace ? World : id is not null && Interiors.TryGetValue(id, out RealmInterior? interior) ? interior : null;

    /// <summary>The space id of a dungeon run.</summary>
    public static string RunSpace(string run) => RunPrefix + run;

    /// <summary>A run's id from its space id; null for a space that is no run's.</summary>
    public static string? RunOf(string? space) => space is not null && space.StartsWith(RunPrefix, StringComparison.Ordinal) ? space[RunPrefix.Length..] : null;

    public const string RunPrefix = "run:";

    public IReadOnlyDictionary<string, Vendor> Vendors { get; private set; } = new Dictionary<string, Vendor>();

    /// <summary>Every card the engine has, as the realm's card database records it (<c>cards.json</c>), by name.</summary>
    public IReadOnlyDictionary<string, CardRecord> Records { get; private set; } = new Dictionary<string, CardRecord>();

    /// <summary>The planes of planes.json not walked yet, whose traders bring their cards (design.md A5): id to name.</summary>
    public IReadOnlyDictionary<string, string> TraderPlanes { get; private set; } = new Dictionary<string, string>();

    /// <summary>The relics (design.md A3a), in <c>relics.json</c>'s order.</summary>
    public IReadOnlyList<RelicEntry> Relics { get; private set; } = [];

    /// <summary>The relics a boss may drop, in <c>relics.json</c>'s order; none for any other mob.</summary>
    public IEnumerable<RelicEntry> RelicsOf(Mob mob)
    {
        ArgumentNullException.ThrowIfNull(mob);
        return mob.File.Boss ? Relics.Where(relic => relic.Bosses.Contains(mob.Id, StringComparer.Ordinal)) : [];
    }

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
    /// <param name="places">
    /// Where each plane's world, interiors and dungeons are read from (<c>&lt;places&gt;/&lt;plane&gt;/world</c>, ...): a test world;
    /// <c>realms/content</c> unless given.
    /// </param>
    /// <exception cref="RealmContentException">Anything that does not hold together.</exception>
    public static RealmContent Load(string repositoryRoot, string? cardContent = null, string? places = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(repositoryRoot);
        string root = Path.GetFullPath(repositoryRoot);
        string realms = Path.Combine(root, "realms", "content");
        List<string> problems = [];

        // The realm's card database (cards.json, tools/realms/card-economy.py) and the planes (planes.json); the pools are
        // views of the database, computed here (CardRecord.Dealt): a walked plane's every card dealt in printed on it, and
        // the off-plane pool every such card printed on no walked plane.
        (Dictionary<string, PlaneEntry> planes, HashSet<string> walked) = ReadPlanes(Path.Combine(realms, "planes.json"), problems);
        List<CardRecord> records = ReadCards(Path.Combine(realms, "cards.json"), problems);
        List<RelicEntry> relics = ReadRelics(Path.Combine(realms, "relics.json"), problems);
        HashSet<string> relicNames = new(relics.Select(relic => relic.Card), StringComparer.Ordinal);
        Dictionary<string, CardPrice> prices = new(StringComparer.Ordinal);
        Dictionary<string, IReadOnlyList<string>> pools = walked.ToDictionary(plane => plane, _ => (IReadOnlyList<string>)new List<string>(), StringComparer.Ordinal);
        Dictionary<string, IReadOnlyList<string>> offPlane = new(StringComparer.Ordinal);
        foreach (CardRecord record in records)
        {
            if (record.Gold is { } gold && record.Usd is { } usd && record.Rarity is { } rarity)
            {
                prices[record.Name] = new CardPrice(gold, usd, rarity, record.Vintage, record.Identity);
            }

            if (!record.Dealt) continue;
            foreach (string plane in record.Planes.Where(walked.Contains)) ((List<string>)pools[plane]).Add(record.Name);
            if (!record.Planes.Any(walked.Contains)) offPlane[record.Name] = record.Planes;
        }

        Dictionary<string, CardRecord> byName = records.GroupBy(record => record.Name, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var cards = new CardPool(CardPool.WithRealmLegality(DeckCatalog.ByName(cardContent ?? Path.Combine(root, "content")), byName), prices, pools, relicNames, offPlane);
        var content = new RealmContent(root, cards)
        {
            Relics = relics,
            Records = byName,
            TraderPlanes = planes.Where(plane => !walked.Contains(plane.Key)).ToDictionary(plane => plane.Key, plane => plane.Value.Name, StringComparer.Ordinal),
        };

        HashSet<string> seen = new(StringComparer.Ordinal);
        foreach (CardRecord record in records)
        {
            string where = $"cards.json: {record.Name}";
            if (!seen.Add(record.Name)) problems.Add($"{where} has two records.");
            if (!cards.Catalog.ContainsKey(record.Name)) problems.Add($"{where} is not a card the engine plays.");
            if (record.Vintage is not ("legal" or "restricted" or "banned" or "not_legal")) problems.Add($"{where}: vintage '{record.Vintage}' is none of legal, restricted, banned, not_legal.");
            if (record.Identity.Any(letter => CardPool.Color(letter) is null)) problems.Add($"{where}: identity '{record.Identity}' is not colors' letters.");
            foreach (string plane in record.Planes.Where(plane => !planes.ContainsKey(plane))) problems.Add($"{where}: '{plane}' is no plane of planes.json.");
            if (record.Origin is { } origin && origin != CardRecord.Multiverse && !planes.ContainsKey(origin)) problems.Add($"{where}: its origin '{origin}' is no plane of planes.json.");
            if (record.Relic != relicNames.Contains(record.Name)) problems.Add($"{where}: relic is {(record.Relic ? "true" : "false")}, but relics.json {(record.Relic ? "lists no such relic" : "lists it")}.");
            if ((record.Gold is null) != (record.Usd is null) || (record.Gold is null) != (record.Rarity is null)) problems.Add($"{where}: a price is its usd, rarity and gold, all or none.");
            else if (record.Rarity is { } rarity && !Pricing.Surcharge.ContainsKey(rarity)) problems.Add($"{where} has rarity '{rarity}'.");
            else if (record.Gold is { } gold && gold != Pricing.ListPrice(record.Usd!.Value, record.Rarity!)) problems.Add($"{where} is {gold} gold, but ${record.Usd} at {record.Rarity} lists at {Pricing.ListPrice(record.Usd!.Value, record.Rarity!)}.");
        }

        content.Models = ReadModels(Path.Combine(realms, "models"), problems);
        content.Gear = ReadGear(Path.Combine(realms, "gear"), problems);

        Dictionary<string, Mob> mobs = new(StringComparer.Ordinal);
        Dictionary<string, RealmInterior> interiors = new(StringComparer.Ordinal);
        Dictionary<string, RealmDungeon> dungeons = new(StringComparer.Ordinal);
        List<RealmWorld> worlds = [];
        Dictionary<string, Vendor> vendors = new(StringComparer.Ordinal);
        Dictionary<string, IReadOnlyDictionary<string, DeckList>> starters = new(StringComparer.Ordinal);
        foreach (string plane in walked.Order(StringComparer.Ordinal))
        {
            string folder = Path.Combine(realms, plane);
            foreach ((string file, MobFile mob) in Read<MobFile>(Path.Combine(folder, "mobs"), problems))
            {
                if (Named(file, mob.Id, mobs.ContainsKey(mob.Id), problems) && ReadDeck(root, mob.Deck, $"{file}: its deck", problems) is { } deck)
                {
                    mobs[mob.Id] = new Mob(mob, plane, deck);
                }
            }

            string placed = places is null ? folder : Path.Combine(Path.GetFullPath(places), plane);
            if (ReadWorld(Path.Combine(placed, "world"), plane, problems) is { } world) worlds.Add(world);
            foreach ((string id, RealmInterior interior) in ReadInteriors(Path.Combine(placed, "interiors"), plane, problems))
            {
                if (!interiors.TryAdd(id, interior)) problems.Add($"interiors/{id}.json: the id '{id}' is taken.");
            }

            foreach ((string file, DungeonFile dungeon) in Read<DungeonFile>(Path.Combine(placed, "dungeons"), problems))
            {
                if (Named(file, dungeon.Id, dungeons.ContainsKey(dungeon.Id), problems))
                {
                    dungeons[dungeon.Id] = new RealmDungeon(dungeon, plane, Tables(dungeon, $"dungeons/{file}", problems));
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
        if (worlds.Count == 1) content.World = worlds[0];
        else problems.Add(worlds.Count == 0 ? "No plane has a world (<plane>/world/world.json)." : "More than one plane has a world: the server walks one.");
        content.Towns = content.World.File.Towns.GroupBy(town => town.Id, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        content.Inns = content.World.File.Inns.GroupBy(inn => inn.Id, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        content.Interiors = interiors;
        content.Dungeons = dungeons;
        content.Vendors = vendors;
        content.Starters = starters;
        content.Check(problems);

        return problems.Count == 0 ? content : throw new RealmContentException(problems);
    }

    /// <summary>planes.json's planes, and the walked ones among them (<c>"walked": true</c>), which have pools.</summary>
    private static (Dictionary<string, PlaneEntry> Planes, HashSet<string> Walked) ReadPlanes(string path, List<string> problems)
    {
        Dictionary<string, PlaneEntry> planes = new(StringComparer.Ordinal);
        try
        {
            planes = JsonSerializer.Deserialize<PlanesFile>(System.IO.File.ReadAllBytes(path), Json)?.Planes
                .ToDictionary(plane => plane.Key, plane => plane.Value, StringComparer.Ordinal) ?? planes;
        }
        catch (Exception problem) when (problem is JsonException or IOException)
        {
            problems.Add($"planes.json: {problem.Message}");
        }

        HashSet<string> walked = [.. planes.Where(plane => plane.Value.Walked).Select(plane => plane.Key)];
        if (walked.Count == 0) problems.Add("planes.json: no plane is walked.");
        return (planes, walked);
    }

    /// <summary>cards.json's records: every card the engine has, as card-economy.py found it.</summary>
    private static List<CardRecord> ReadCards(string path, List<string> problems)
    {
        try
        {
            return [.. JsonSerializer.Deserialize<CardsFile>(System.IO.File.ReadAllBytes(path), Json)?.Cards ?? []];
        }
        catch (Exception problem) when (problem is JsonException or IOException)
        {
            problems.Add($"cards.json: {problem.Message}");
            return [];
        }
    }

    private static List<RelicEntry> ReadRelics(string path, List<string> problems)
    {
        if (!System.IO.File.Exists(path)) return [];
        try
        {
            return [.. JsonSerializer.Deserialize<RelicsFile>(System.IO.File.ReadAllBytes(path), Json)?.Relics ?? []];
        }
        catch (JsonException problem)
        {
            problems.Add($"relics.json: {problem.Message}");
            return [];
        }
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

        foreach ((string model, _) in Models.Where(model => model.Value == "mob" && !MobMeshes.Contains(model.Key)))
        {
            problems.Add($"models/{model}.vox.json: a mob model of no mob mesh the content may name (RealmContent.MobMeshes, interfaces.md \"Models\").");
        }

        foreach (Mob mob in Mobs.Values)
        {
            CheckMob(mob, problems);
        }

        HashSet<string> relics = new(StringComparer.Ordinal);
        foreach (RelicEntry relic in Relics)
        {
            string where = $"relics.json: {relic.Card}";
            if (!relics.Add(relic.Card)) problems.Add($"{where} is listed twice.");
            if (!Cards.Catalog.ContainsKey(relic.Card)) problems.Add($"{where} is not a card the engine plays.");
            if (relic.Chance is <= 0 or > 1 || double.IsNaN(relic.Chance)) problems.Add($"{where}: its chance is more than 0 and at most 1.");
            if (relic.Bosses.Count == 0) problems.Add($"{where} drops from no boss.");
            foreach (string boss in relic.Bosses.Where(boss => !Mobs.TryGetValue(boss, out Mob? mob) || !mob.File.Boss))
            {
                problems.Add($"{where} drops from '{boss}', which is no boss.");
            }
        }

        foreach (Vendor vendor in Vendors.Values)
        {
            string where = $"vendor {vendor.Id}";
            if (string.IsNullOrWhiteSpace(vendor.File.Name)) problems.Add($"{where}: no name.");
            if (vendor.File.Purse < 0) problems.Add($"{where}: a purse is never less than nothing.");
            if (vendor.File.Trader is { } round)
            {
                if (vendor.File.Exotic) problems.Add($"{where}: a trader is not a shop as well.");
                if (!TraderPlanes.ContainsKey(round.Plane)) problems.Add($"{where}: its plane '{round.Plane}' is no trader's plane of planes.json.");
                else if (Cards.OffPlaneFilter(new CardFilter(), round.Plane).Count < Economy.Travelers.Brought) problems.Add($"{where}: the {round.Plane} off-plane cards are fewer than a caravan brings.");
                if (round.Towns.Count == 0) problems.Add($"{where}: its caravan visits no town.");
                if (round.Hour is < 0 or > 23 || round.Hours < 1 || round.Hour + round.Hours > 24) problems.Add($"{where}: its caravan comes at an hour of the day (0 to 23) and stays some hours within it.");
            }
            else if (vendor.File.Exotic)
            {
                if (Cards.OffPlaneFilter(vendor.File.Specialty).Count == 0) problems.Add($"{where}: its specialty has no off-plane card.");
            }
            else if (Cards.Filter(vendor.Plane, vendor.File.Specialty).Count == 0)
            {
                problems.Add($"{where}: its specialty has no card in the {vendor.Plane} pool.");
            }
        }

        CheckPlaces(problems);

        foreach ((string plane, IReadOnlyDictionary<string, DeckList> decks) in Starters)
        {
            foreach ((string color, DeckList deck) in decks)
            {
                string where = $"{plane}'s {StarterFiles[color]} starter deck";
                problems.AddRange(DeckProblems(deck, plane, CardPool.Identity(color)).Select(problem => $"{where}: {problem}"));
                foreach (DeckListEntry entry in deck.Entries)
                {
                    if (Cards.IsRelic(entry.Card)) problems.Add($"{where}: {entry.Card} is a relic, which no starter deck holds.");
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
        if (file.Boss ? file.Unlocks is not null && (file.Unlocks.Length != 1 || CardPool.Color(file.Unlocks[0]) is null) : file.Tier is < 1 or > 4)
        {
            problems.Add(file.Boss ? $"{where}: a boss unlocks one color, W U B R or G, or none (a capstone)." : $"{where}: tier {file.Tier} is not 1 to 4.");
        }

        if (file.Stats.Life < 1 || file.Stats.Hand is < 0 or > 254 || file.Stats.MaxHand < 0)
        {
            problems.Add($"{where}: stats {file.Stats} are not a game's (life at least 1, a hand of 0 to 254, a maximum hand of 0 or more).");
        }

        foreach (string gear in file.Gear.Where(gear => !Gear.ContainsKey(gear)))
        {
            problems.Add($"{where}: wears '{gear}', which is no gear item.");
        }

        if (!MobMeshes.Contains(file.Model.Mesh)) problems.Add($"{where}: its model '{file.Model.Mesh}' is none of the mob meshes ({string.Join(", ", MobMeshes)}).");
        if (file.Region is { } region && (region.Length != 1 || CardPool.Color(region[0]) is null)) problems.Add($"{where}: its region '{region}' is no color's letter.");
        if (!Cards.Catalog.TryGetValue(file.Creature, out CatalogCard? creature)) problems.Add($"{where}: its creature '{file.Creature}' is no card the engine plays.");
        else if (!creature.Card.CardTypes.Any(type => type.ToString() is "Creature" or "Planeswalker")) problems.Add($"{where}: its creature {file.Creature} is no creature (or planeswalker) card.");
        else if (!mob.Deck.Entries.Any(entry => entry.Card == file.Creature)) problems.Add($"{where}: its deck does not hold {file.Creature}, the creature it is.");
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

    /// <summary>
    /// The world, its interiors and its dungeons (interfaces.md, "The world, interiors and dungeons"): towns and inns, doors
    /// into interiors that exist and belong to one town at most, entrances of dungeons that exist and stand where world.json
    /// says, spawns of mobs of their tier, chests, the vendors' and armorers' interiors, the traders' pitches, the ferries' lanes,
    /// every tile a character is put on walkable, and every mob met somewhere.
    /// </summary>
    private void CheckPlaces(List<string> problems)
    {
        RealmWorld world = World;
        foreach (IGrouping<string, TownEntry> twice in world.File.Towns.GroupBy(town => town.Id, StringComparer.Ordinal).Where(group => group.Count() > 1)) problems.Add($"world.json: two towns '{twice.Key}'.");
        foreach (TownEntry town in world.File.Towns)
        {
            string where = $"world.json: town {town.Id}";
            if (!KebabCase().IsMatch(town.Id)) problems.Add($"{where}: its id is kebab-case.");
            if (string.IsNullOrWhiteSpace(town.Name)) problems.Add($"{where}: no name.");
            if (!TownKinds.Contains(town.Kind)) problems.Add($"{where}: kind '{town.Kind}' is none of {string.Join(", ", TownKinds)}.");
            if (town.Center is not [_, _] || town.Radius <= 0) problems.Add($"{where}: a town has a center [x, z] and a radius.");
        }

        foreach (IGrouping<string, InnEntry> twice in world.File.Inns.GroupBy(inn => inn.Id, StringComparer.Ordinal).Where(group => group.Count() > 1)) problems.Add($"world.json: two inns '{twice.Key}'.");
        foreach (InnEntry inn in world.File.Inns)
        {
            string where = $"world.json: inn {inn.Id}";
            if (!KebabCase().IsMatch(inn.Id)) problems.Add($"{where}: its id is kebab-case.");
            if (!Towns.ContainsKey(inn.Town)) problems.Add($"{where}: its town '{inn.Town}' is no town.");
            if (!world.Walkable(inn.At)) problems.Add($"{where}: a character wakes at {inn.At}, which nobody can stand on.");
        }

        // Doors: each into an interior that exists, from the world; an interior belongs to the town its doors stand in.
        Dictionary<string, List<Tile>> doors = new(StringComparer.Ordinal);
        foreach ((Tile at, string interior) in world.Doors)
        {
            if (!world.Walkable(at)) problems.Add($"the world: the door into {interior} at {at} is a tile nobody can stand on.");
            if (!Interiors.ContainsKey(interior)) problems.Add($"the world: the door at {at} leads into '{interior}', which is no interior.");
            else (doors.TryGetValue(interior, out List<Tile>? list) ? list : doors[interior] = []).Add(at);
        }

        foreach (RealmInterior interior in Interiors.Values)
        {
            InteriorFile file = interior.File;
            string where = $"interior {interior.Id}";
            if (string.IsNullOrWhiteSpace(file.Name)) problems.Add($"{where}: no name.");
            if (!InteriorKinds.Contains(file.Kind)) problems.Add($"{where}: kind '{file.Kind}' is none of {string.Join(", ", InteriorKinds)}.");
            interior.Doors = doors.GetValueOrDefault(interior.Id) ?? [];
            if (file.ExitAt is not { } exit) problems.Add($"{where}: no exit [x, z], the world tile its door comes out on.");
            else if (!world.Walkable(exit)) problems.Add($"{where}: its exit at {exit} is a tile of the world nobody can stand on.");
            else if (interior.Doors.Count > 0 && !interior.Doors.Any(door => door.DistanceTo(exit) <= 1)) problems.Add($"{where}: its exit at {exit} is not at a door of the world into it.");
            if (file.EntryAt is not { } entry) problems.Add($"{where}: no entry [x, z], its own tile at the door.");
            else if (!interior.Walkable(entry)) problems.Add($"{where}: its entry at {entry} is a tile nobody can stand on.");
            if (file.Tiles.Count == 0) problems.Add($"{where}: no tiles.");
            if (interior.Doors.Count == 0) problems.Add($"{where}: no door of the world leads into it.");
            List<TownEntry> towns = [.. interior.Doors.Select(TownAt).OfType<TownEntry>().DistinctBy(town => town.Id)];
            if (towns.Count > 1) problems.Add($"{where}: its doors stand in more than one town ({string.Join(", ", towns.Select(town => town.Id))}).");
            interior.Town = towns.FirstOrDefault();
            if (file.Town is { } named && named != interior.Town?.Id) problems.Add($"{where}: it says it is in {named}, but its doors stand in {interior.Town?.Id ?? "no town"}.");
            CheckNpcs(interior, where, problems);
            CheckChests(interior, interior.File.Chests, where, problems);
        }

        CheckNpcs(world, "the world", problems);
        CheckChests(world, world.Chests, "the world", problems);

        foreach (Vendor vendor in Vendors.Values.Where(vendor => vendor.File.Trader is { } round))
        {
            foreach (string town in vendor.File.Trader!.Towns.Where(town => !Towns.ContainsKey(town))) problems.Add($"vendor {vendor.Id}: its caravan visits '{town}', which is no town of the world.");
        }

        // The traders' pitches, each an open tile of a town's; and the ferries, each a walk from dock to dock.
        foreach (PitchEntry pitch in world.File.Pitches)
        {
            string where = $"world.json: the pitch of {pitch.Town} at {pitch.At}";
            if (!Towns.ContainsKey(pitch.Town)) problems.Add($"{where}: '{pitch.Town}' is no town.");
            else if (TownAt(pitch.At)?.Id != pitch.Town) problems.Add($"{where} is outside the town.");
            if (!world.Walkable(pitch.At)) problems.Add($"{where} is a tile nobody can stand on.");
        }

        foreach (FerryEntry ferry in world.File.Ferries)
        {
            string where = $"world.json: ferry {ferry.Id}";
            List<Tile> lane = [.. ferry.Lane.Select(step => step is [int x, int z] ? new Tile(x, z) : new Tile(int.MinValue, int.MinValue))];
            if (ferry.From is not [int fx, int fz] || ferry.To is not [int tx, int tz]) problems.Add($"{where}: its docks are [x, z] from and to.");
            else if (lane.Count < 2 || lane[0] != new Tile(fx, fz) || lane[^1] != new Tile(tx, tz)) problems.Add($"{where}: its lane runs from its dock {new Tile(fx, fz)} to its dock {new Tile(tx, tz)}.");
            else if (!world.Walkable(lane[0]) || !world.IsWalk(lane[0], lane.Skip(1))) problems.Add($"{where}: its lane is not a walk, tile by tile over open tiles.");
        }

        foreach (Vendor vendor in Vendors.Values.Where(vendor => vendor.File.Trader is null))
        {
            string where = $"vendor {vendor.Id}";
            if (!Towns.ContainsKey(vendor.File.Town)) problems.Add($"{where}: its town '{vendor.File.Town}' is no town of the world.");
            else if (!Interiors.Values.Any(interior => interior.Town?.Id == vendor.File.Town && interior.Npcs.Any(npc => npc.Kind == "vendor" && npc.Vendor == vendor.Id)))
            {
                problems.Add($"{where}: nobody keeps its shop in {vendor.File.Town}: no vendor NPC of an interior of that town names it.");
            }
        }

        // Dungeons: where world.json and the chunks put them, and what their runs hold.
        Dictionary<string, DungeonPlace> placed = new(StringComparer.Ordinal);
        foreach (DungeonPlace place in world.File.Dungeons)
        {
            if (!placed.TryAdd(place.Id, place)) problems.Add($"world.json: dungeon {place.Id} is placed twice.");
            if (!Dungeons.ContainsKey(place.Id)) problems.Add($"world.json: dungeon '{place.Id}' has no dungeons/{place.Id}.json.");
        }

        foreach ((Tile at, string dungeon) in world.Entrances)
        {
            if (!Dungeons.ContainsKey(dungeon)) problems.Add($"the world: the entrance at {at} leads into '{dungeon}', which is no dungeon.");
            if (!world.Walkable(at)) problems.Add($"the world: the entrance of {dungeon} at {at} is a tile nobody can stand on.");
        }

        foreach (RealmDungeon dungeon in Dungeons.Values)
        {
            CheckDungeon(dungeon, placed.GetValueOrDefault(dungeon.Id), problems);
        }

        foreach (MapSpawn spawn in world.Spawns)
        {
            string where = $"the world: spawn {spawn.Id}";
            if (!world.Walkable(spawn.At)) problems.Add($"{where} stands on {spawn.At}, which nobody can stand on.");
            if (spawn.Tier is < 1 or > 4) problems.Add($"{where}: tier {spawn.Tier} is not 1 to 4.");
            if (spawn.Mobs.Count == 0) problems.Add($"{where} has no mobs.");
            foreach (string id in spawn.Mobs)
            {
                if (!Mobs.TryGetValue(id, out Mob? mob)) problems.Add($"{where} holds '{id}', which is no mob.");
                else if (mob.File.Boss) problems.Add($"{where} holds {id}, a boss, which waits in its dungeon.");
                else if (mob.File.Tier != spawn.Tier) problems.Add($"{where} is tier {spawn.Tier} but holds {id}, of tier {mob.File.Tier}.");
            }

            if (spawn.Radius < 0 || spawn.RespawnSeconds <= 0) problems.Add($"{where} has a radius of 0 or more and respawns after some seconds.");
        }

        HashSet<string> met = [.. world.Spawns.SelectMany(spawn => spawn.Mobs)];
        foreach (RealmDungeon dungeon in Dungeons.Values)
        {
            met.UnionWith(dungeon.Tables.SelectMany(table => table));
            if (dungeon.File.Warden is { } warden) met.Add(warden);
            met.Add(dungeon.File.Boss);
        }

        foreach (Mob mob in Mobs.Values.Where(mob => !met.Contains(mob.Id)))
        {
            problems.Add($"mob {mob.Id} is met nowhere: no spawn of the world and no dungeon holds it.");
        }
    }

    /// <summary>
    /// The town a tile of the world stands in: the one whose center is within its radius, in tiles (<see cref="Tile.Distance"/>,
    /// the nearest if two are).
    /// </summary>
    public TownEntry? TownAt(Tile at) =>
        World.File.Towns.Where(town => town.Center is [_, _] && town.At.DistanceTo(at) <= town.Radius).MinBy(town => town.At.DistanceTo(at));

    private void CheckNpcs(RealmSpace space, string where, List<string> problems)
    {
        foreach (MapNpc npc in space.Npcs)
        {
            if (!space.Has(npc.At)) problems.Add($"{where}: {npc.Id} stands off it at {npc.At}.");
            if (!KebabCase().IsMatch(npc.Kind)) problems.Add($"{where}: {npc.Id} is a '{npc.Kind}', which is no kebab-case kind.");
            if (npc.Kind is "vendor" or "armorer" && space is not RealmInterior)
            {
                problems.Add($"{where}: {npc.Id} is a {npc.Kind}, who works inside a building (an interior), not in the world.");
            }

            if (npc.Kind == "vendor" && (npc.Vendor is null || !Vendors.TryGetValue(npc.Vendor, out Vendor? vendor) || (space as RealmInterior)?.Town?.Id != vendor.File.Town))
            {
                problems.Add($"{where}: {npc.Id} is a vendor, but '{npc.Vendor}' is no vendor of this town.");
            }
        }

        foreach (Tile table in space.SpellTables.Where(table => !space.Has(table)))
        {
            problems.Add($"{where}: a spell table stands off it at {table}.");
        }
    }

    private static void CheckChests(RealmSpace space, IEnumerable<MapChest> chests, string where, List<string> problems)
    {
        HashSet<string> ids = new(StringComparer.Ordinal);
        foreach (MapChest chest in chests)
        {
            if (!ChestId().IsMatch(chest.Id) || !ids.Add(chest.Id)) problems.Add($"{where}: chest '{chest.Id}' is not a fresh id (lower-case letters, digits, '-', '_' and ':', a letter or digit first but for a leading '-').");
            if (!space.Has(chest.At)) problems.Add($"{where}: chest {chest.Id} is off it at {chest.At}.");
            if (chest.Gold is not [long low, long high] || low < 0 || high < low) problems.Add($"{where}: chest {chest.Id}'s gold is two amounts, the lower first.");
            if (chest.RespawnSeconds <= 0) problems.Add($"{where}: chest {chest.Id} refills after some seconds.");
        }
    }

    // A chunk's own id serves, "<cx>_<cz>:<n>", a negative chunk's ("-1_0:1") too.
    [GeneratedRegex("^-?[a-z0-9][a-z0-9_:-]{0,63}$")]
    private static partial Regex ChestId();

    private void CheckDungeon(RealmDungeon dungeon, DungeonPlace? place, List<string> problems)
    {
        DungeonFile file = dungeon.File;
        string where = $"dungeon {dungeon.Id}";
        if (string.IsNullOrWhiteSpace(file.Name)) problems.Add($"{where}: no name.");
        if (!DungeonThemes.Contains(file.Theme)) problems.Add($"{where}: theme '{file.Theme}' is none of {string.Join(", ", DungeonThemes)}.");
        if (file.Entrance is not [_, _]) problems.Add($"{where}: its entrance is a tile [x, z].");
        else if (place is null) problems.Add($"{where}: world.json does not place it.");
        else if (place.At != file.At) problems.Add($"{where}: its entrance is {file.At}, but world.json places it at {place.At}.");
        else if (!World.Entrances.TryGetValue(file.At, out string? entered) || entered != dungeon.Id) problems.Add($"{where}: no entrance of a chunk at {file.At} leads into it.");

        if (file.Requires is { } requires && (requires.Length == 0 || requires.Any(letter => CardPool.Color(letter) is null)))
        {
            problems.Add($"{where}: it requires '{requires}', which is not colors' letters (W U B R G).");
        }

        if (file.Region is { } region && (region.Length != 1 || CardPool.Color(region[0]) is null)) problems.Add($"{where}: its region '{region}' is no color's letter.");
        if (file.Floors is not [int fewest, int most] || fewest < 1 || most < fewest) problems.Add($"{where}: its floors are two counts, the fewer first, at least 1.");
        if (file.Encounters is not [int least, int greatest] || least < 0 || greatest < least) problems.Add($"{where}: its encounters are two counts a floor, the fewer first.");
        if (file.Tier is < 1 or > 4) problems.Add($"{where}: tier {file.Tier} is not 1 to 4.");
        if (file.Waystone && file.Theme != "tower") problems.Add($"{where}: only a mage tower has a waystone.");

        foreach (string id in dungeon.Tables.SelectMany(table => table))
        {
            if (!Mobs.TryGetValue(id, out Mob? mob)) problems.Add($"{where} holds '{id}', which is no mob.");
            else if (mob.File.Boss) problems.Add($"{where}'s floors hold {id}, a boss, who waits on the last floor.");
        }

        if (file.Encounters is [_, > 0] && (dungeon.Tables.Count == 0 || dungeon.Tables.Any(table => table.Count == 0))) problems.Add($"{where}: a floor with encounters has mobs to draw them from.");
        if (file.Warden is { } warden && !Mobs.ContainsKey(warden)) problems.Add($"{where}: its warden '{warden}' is no mob.");
        if (file.Warden is null && file.Floors is [_, > 1]) problems.Add($"{where}: a dungeon of more than one floor has a warden at each stair.");
        if (!Mobs.ContainsKey(file.Boss)) problems.Add($"{where}: its boss '{file.Boss}' is no mob.");
    }

    /// <summary>A dungeon's mob tables: one list of ids for every floor, or a list a floor.</summary>
    private static List<IReadOnlyList<string>> Tables(DungeonFile dungeon, string where, List<string> problems)
    {
        JsonElement mobs = dungeon.Mobs;
        if (mobs.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null) return [];
        if (mobs.ValueKind == JsonValueKind.Array && mobs.EnumerateArray().All(mob => mob.ValueKind == JsonValueKind.String))
        {
            return [[.. mobs.EnumerateArray().Select(mob => mob.GetString()!)]];
        }

        if (mobs.ValueKind == JsonValueKind.Array && mobs.EnumerateArray().All(floor => floor.ValueKind == JsonValueKind.Array && floor.EnumerateArray().All(mob => mob.ValueKind == JsonValueKind.String)))
        {
            return [.. mobs.EnumerateArray().Select(floor => (IReadOnlyList<string>)[.. floor.EnumerateArray().Select(mob => mob.GetString()!)])];
        }

        problems.Add($"{where}: its mobs are a list of mob ids, or a list of them a floor.");
        return [];
    }

    /// <summary>
    /// Reads a plane's world in version 2 of the world data (conversion.md): <c>world.json</c> and every chunk of
    /// <c>chunks/</c>, chunk files named <c>&lt;cx&gt;_&lt;cz&gt;.json</c> (negative ones too); null for a plane with none.
    /// </summary>
    internal static RealmWorld? ReadWorld(string folder, string plane, List<string> problems)
    {
        string path = Path.Combine(folder, "world.json");
        if (!System.IO.File.Exists(path)) return null;
        WorldFile? file;
        try
        {
            file = JsonSerializer.Deserialize<WorldFile>(System.IO.File.ReadAllBytes(path), Json);
        }
        catch (JsonException problem)
        {
            problems.Add($"world.json: {problem.Message}");
            return null;
        }

        if (file is null || file.Chunk <= 0 || file.Size is not [> 0, > 0])
        {
            problems.Add("world.json: empty, or no size [width, height] in tiles, or a chunk of no tiles.");
            return null;
        }

        if (file.Tile != 1) problems.Add($"world.json: a tile is 1 world unit, not {file.Tile}.");
        if (file.Origin is not null and not [_, _]) problems.Add("world.json: its origin is a tile [x, z].");
        if (file.Bounds is not null and not [_, _, _, _]) problems.Add("world.json: its bounds are [x0, z0, x1, z1].");

        var world = new RealmWorld(file, plane);
        foreach ((string name, ChunkFile chunk) in Read<ChunkFile>(Path.Combine(folder, "chunks"), problems))
        {
            Match match = ChunkName().Match(name);
            if (!match.Success)
            {
                problems.Add($"chunks/{name}: a chunk's file is named <cx>_<cz>.json.");
                continue;
            }

            int cx = int.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
            int cz = int.Parse(match.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture);
            world.Add(cx, cz, chunk, $"chunks/{name}", problems);
        }

        if (world.Chunks.Count == 0) problems.Add("the world has no chunks (world/chunks/<cx>_<cz>.json).");
        return world;
    }

    /// <summary>Reads the interiors of a folder (<c>interiors/&lt;id&gt;.json</c>), each named by its id.</summary>
    internal static Dictionary<string, RealmInterior> ReadInteriors(string folder, string plane, List<string> problems)
    {
        Dictionary<string, RealmInterior> interiors = new(StringComparer.Ordinal);
        foreach ((string file, InteriorFile interior) in Read<InteriorFile>(folder, problems))
        {
            if (Named(file, interior.Id, interiors.ContainsKey(interior.Id), problems))
            {
                interiors[interior.Id] = new RealmInterior(interior, plane, $"interiors/{file}", problems);
            }
        }

        return interiors;
    }

    [GeneratedRegex(@"^(-?\d+)_(-?\d+)\.json$")]
    private static partial Regex ChunkName();

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
}
