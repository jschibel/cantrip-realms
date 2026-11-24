using System.Text.Json;

namespace Cantrip.Realms.Server.Content;

// The content files of realms/docs/interfaces.md ("Content"), as they are read: camelCase JSON, one file per item.

/// <summary>What a gear item, or a mob, adds to the setup values (design.md A1): life, starting hand and maximum hand.</summary>
public sealed record GearStats(int Life, int Hand, int MaxHand)
{
    public static GearStats None { get; } = new(0, 0, 0);

    public static GearStats operator +(GearStats a, GearStats b) =>
        new(a.Life + b.Life, a.Hand + b.Hand, a.MaxHand + b.MaxHand);
}

/// <summary>How an item or a mob shows: a gear or mob mesh (<see cref="RealmContent.GearMeshes"/>, <see cref="RealmContent.MobMeshes"/>) and its palette.</summary>
public sealed class Look
{
    public string Mesh { get; init; } = string.Empty;

    public IReadOnlyList<string> Palette { get; init; } = [];

    /// <summary>A mob's scale; absent for gear.</summary>
    public double? Size { get; init; }
}

/// <summary>A gear item (<c>realms/content/gear/*.json</c>).</summary>
public sealed class GearItem
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public string Slot { get; init; } = string.Empty;

    public string Rarity { get; init; } = string.Empty;

    public long Gold { get; init; }

    /// <summary>What it costs of its rarity's budget (gear.md, "Budgets"): its stats' and effects' points, refunds subtracted, as the generator writes them.</summary>
    public int Points { get; init; }

    /// <summary>Its rarity's budget (gear.md, "Budgets"): common 3, uncommon 5, rare 8, mythic 12; a boss's unique 14.</summary>
    public int Budget => Unique ? UniqueBudget : Budgets.GetValueOrDefault(Rarity);

    /// <summary>Each rarity's budget of points (gear.md, "Budgets"; tools/realms/gear-cards.py's BUDGETS).</summary>
    public static IReadOnlyDictionary<string, int> Budgets { get; } = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["common"] = 3,
        ["uncommon"] = 5,
        ["rare"] = 8,
        ["mythic"] = 12,
    };

    /// <summary>A boss's unique item's budget.</summary>
    public const int UniqueBudget = 14;

    public GearStats Stats { get; init; } = GearStats.None;

    /// <summary>The item's abilities, each an effect family and its parameters: the gear crate's to read (M4).</summary>
    public IReadOnlyList<JsonElement> Effects { get; init; } = [];

    public string Text { get; init; } = string.Empty;

    public Look Look { get; init; } = new();

    public bool Unique { get; init; }

    /// <summary>The engine's emblem for this item, <c>"&lt;name&gt; (gear)"</c>, or null for an item with no effects.</summary>
    public string? Emblem => Effects.Count > 0 ? $"{Name} (gear)" : null;
}

/// <summary>What a mob's loot (or a vendor's specialty) takes from a plane's pool: every filter given must hold.</summary>
public sealed class CardFilter
{
    /// <summary>The plane whose pool is filtered (a mob's loot names it; a vendor's is its town's plane).</summary>
    public string? Pool { get; init; }

    /// <summary>A color identity, as letters ("WU"), that a card's identity is within.</summary>
    public string? Colors { get; init; }

    /// <summary>Card types, any of which a card has.</summary>
    public IReadOnlyList<string> Types { get; init; } = [];

    /// <summary>Subtypes, any of which a card has.</summary>
    public IReadOnlyList<string> Subtypes { get; init; } = [];

    /// <summary>Rarities, one of which is a card's.</summary>
    public IReadOnlyList<string> Rarities { get; init; } = [];

    /// <summary>Cards named outright, one of which a card is: a theme.</summary>
    public IReadOnlyList<string> Names { get; init; } = [];
}

/// <summary>A mob (<c>realms/content/&lt;plane&gt;/mobs/*.json</c>).</summary>
public sealed class MobFile
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public int Tier { get; init; }

    /// <summary>Its decklist, a path from the repository root.</summary>
    public string Deck { get; init; } = string.Empty;

    public GearStats Stats { get; init; } = new(20, 7, 7);

    public IReadOnlyList<string> Gear { get; init; } = [];

    /// <summary>The mob's prize value in gold: the most a duel against it can win in cards (design.md A3).</summary>
    public long Prize { get; init; }

    public IReadOnlyList<long> GoldRange { get; init; } = [];

    public CardFilter Loot { get; init; } = new();

    public Look Model { get; init; } = new();

    public bool Boss { get; init; }

    /// <summary>The color a boss unlocks when beaten; none for a plane's capstone boss, which ends its arc instead.</summary>
    public string? Unlocks { get; init; }

    /// <summary>The creature card the mob is (design.md A6): a card of its deck, which the mob is drawn as.</summary>
    public string Creature { get; init; } = string.Empty;

    /// <summary>The region, by its color, the mob roams or belongs to; none for a mob of no region.</summary>
    public string? Region { get; init; }
}

/// <summary>
/// A relic (<c>realms/content/relics.json</c>, design.md A3a): a card that drops only from the bosses named, at
/// <see cref="Chance"/> on each win, and at most once per account ever.
/// </summary>
public sealed class RelicEntry
{
    public string Card { get; init; } = string.Empty;

    /// <summary>The mobs (bosses) it drops from.</summary>
    public IReadOnlyList<string> Bosses { get; init; } = [];

    /// <summary>The chance of it dropping on each win against one of them, more than 0 and at most 1.</summary>
    public double Chance { get; init; }
}

/// <summary>
/// A card of the realm's card database (<c>realms/content/cards.json</c>, written by <c>tools/realms/card-economy.py</c>):
/// where it comes from and has been printed, its price, legality and identity, its types for vendor specialties, and
/// whether it is Universes Beyond or a relic.
/// </summary>
public sealed class CardRecord
{
    public string Name { get; init; } = string.Empty;

    /// <summary>The plane of its first printing; <see cref="Multiverse"/> when that printing places it on none; null unprinted.</summary>
    public string? Origin { get; init; }

    /// <summary>Every plane it has been printed on.</summary>
    public IReadOnlyList<string> Planes { get; init; } = [];

    /// <summary>Its paper set codes, oldest first.</summary>
    public IReadOnlyList<string> Sets { get; init; } = [];

    public decimal? Usd { get; init; }

    public string? Rarity { get; init; }

    /// <summary>Its list price; null for a card with no paper price, which nobody deals in.</summary>
    public long? Gold { get; init; }

    /// <summary><c>legal</c>, <c>restricted</c>, <c>banned</c> or <c>not_legal</c> in Vintage.</summary>
    public string Vintage { get; init; } = "not_legal";

    /// <summary>Its color identity, WUBRG letters.</summary>
    public string Identity { get; init; } = string.Empty;

    public IReadOnlyList<string> Types { get; init; } = [];

    public IReadOnlyList<string> Subtypes { get; init; } = [];

    public bool UniversesBeyond { get; init; }

    public bool Relic { get; init; }

    /// <summary>
    /// Whether a vendor or loot may deal in it (design.md A5, A3a): legal or restricted in Vintage, priced, not Universes
    /// Beyond, and no relic. A walked plane's pool is these printed on it; the off-plane pool these printed on none.
    /// </summary>
    public bool Dealt => Vintage is "legal" or "restricted" && Gold is not null && !UniversesBeyond && !Relic;

    public const string Multiverse = "multiverse";
}

/// <summary><c>realms/content/cards.json</c>.</summary>
public sealed class CardsFile
{
    public IReadOnlyList<CardRecord> Cards { get; init; } = [];
}

/// <summary>A plane of <c>realms/content/planes.json</c>: its name, its sets, and whether a character walks it.</summary>
public sealed class PlaneEntry
{
    public string Name { get; init; } = string.Empty;

    public bool Walked { get; init; }

    public IReadOnlyList<string> Sets { get; init; } = [];
}

/// <summary><c>realms/content/planes.json</c>.</summary>
public sealed class PlanesFile
{
    public IReadOnlyDictionary<string, PlaneEntry> Planes { get; init; } = new Dictionary<string, PlaneEntry>();
}

/// <summary><c>realms/content/relics.json</c>.</summary>
public sealed class RelicsFile
{
    public IReadOnlyList<RelicEntry> Relics { get; init; } = [];
}

// The world, its interiors and its dungeons, in version 2 of the world data (realms/docs/interfaces.md, "Version 2 of the
// version 2"; the types are realms/web/src/world/format.ts): square tiles, every position [x, z] in tiles or an entity's
// fields x and z, x east and z south. The server reads what it checks places against and leaves the rest - surfaces'
// looks, props, buildings but their doors, lights - to the overworld.

/// <summary>A spawn point of the world: the mobs that may stand there, all of its tier, and how they wander and come back.</summary>
public sealed class MapSpawn
{
    /// <summary><c>"&lt;cx&gt;_&lt;cz&gt;:&lt;n&gt;"</c>: its chunk and its number there, unique across the world.</summary>
    public string Id { get; init; } = string.Empty;

    public int X { get; init; }

    public int Z { get; init; }

    public IReadOnlyList<string> Mobs { get; init; } = [];

    /// <summary>How far from the spawn point its mobs wander, in tiles.</summary>
    public int Radius { get; init; }

    public int RespawnSeconds { get; init; }

    /// <summary>The tier of its distance from the nearest starting area (design.md A6): every mob of it is of this tier.</summary>
    public int Tier { get; init; }

    public Tile At => new(X, Z);
}

public sealed class MapChest
{
    public string Id { get; init; } = string.Empty;

    public int X { get; init; }

    public int Z { get; init; }

    public IReadOnlyList<long> Gold { get; init; } = [];

    public int RespawnSeconds { get; init; }

    public Tile At => new(X, Z);
}

public sealed class MapNpc
{
    public string Id { get; init; } = string.Empty;

    public int X { get; init; }

    public int Z { get; init; }

    /// <summary><c>vendor</c>, <c>armorer</c>, <c>innkeeper</c>, <c>spell-table</c>, or another the overworld draws.</summary>
    public string Kind { get; init; } = string.Empty;

    /// <summary>The vendor a <c>vendor</c> NPC is.</summary>
    public string? Vendor { get; init; }

    /// <summary>The mage tower a <c>waystone</c> NPC is the waystone of (a dungeon with a waystone).</summary>
    public string? Tower { get; init; }

    public Tile At => new(X, Z);
}

/// <summary>
/// A building of the world (a chunk's <c>buildings</c>): the server reads only its door - the walkable tile in front of
/// it - and the interior walking through it enters (none: a door only painted).
/// </summary>
public sealed class MapBuilding
{
    public string Id { get; init; } = string.Empty;

    /// <summary><c>[x, z]</c>, or none for a building without a door.</summary>
    public IReadOnlyList<int>? Door { get; init; }

    public string? Interior { get; init; }

    public Tile? DoorAt => Door is [int x, int z] ? new Tile(x, z) : null;
}

/// <summary>A dungeon's entrance in the world: a cave mouth, a castle gate, a tower door.</summary>
public sealed class MapEntrance
{
    public int X { get; init; }

    public int Z { get; init; }

    public string Dungeon { get; init; } = string.Empty;

    public Tile At => new(X, Z);
}

/// <summary>A chunk of the world (<c>world/chunks/&lt;cx&gt;_&lt;cz&gt;.json</c>).</summary>
public sealed class ChunkFile
{
    /// <summary>The chunk's coordinates, as its file's name has them.</summary>
    public int? Cx { get; init; }

    public int? Cz { get; init; }

    /// <summary><c>chunk * chunk</c> tiles, each <c>[height (texels), surface, flags]</c>, row by row: z, then x.</summary>
    public IReadOnlyList<JsonElement> Tiles { get; init; } = [];

    public IReadOnlyList<MapBuilding> Buildings { get; init; } = [];

    public IReadOnlyList<MapNpc> Npcs { get; init; } = [];

    public IReadOnlyList<MapSpawn> Spawns { get; init; } = [];

    public IReadOnlyList<MapChest> Chests { get; init; } = [];

    public IReadOnlyList<MapEntrance> Entrances { get; init; } = [];
}

/// <summary>A town of the world: a walled town, a village or the capital.</summary>
public sealed class TownEntry
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary><c>town</c>, <c>village</c> or <c>capital</c>.</summary>
    public string Kind { get; init; } = string.Empty;

    /// <summary><c>[x, z]</c>.</summary>
    public IReadOnlyList<int> Center { get; init; } = [];

    /// <summary>Its walls stand this many tiles from its center: a tile within it (<see cref="Tile.Distance"/>) is the town's.</summary>
    public int Radius { get; init; }

    public string? Style { get; init; }

    public Tile At => Center is [int x, int z] ? new Tile(x, z) : default;
}

/// <summary>An inn of the world, at the tile outside its door where a character whose home it is wakes after a lost duel.</summary>
public sealed class InnEntry
{
    public string Id { get; init; } = string.Empty;

    public string Town { get; init; } = string.Empty;

    public int X { get; init; }

    public int Z { get; init; }

    public Tile At => new(X, Z);
}

/// <summary>Where a dungeon stands in the world (<c>world.json</c>'s <c>dungeons</c>).</summary>
public sealed class DungeonPlace
{
    public string Id { get; init; } = string.Empty;

    public int X { get; init; }

    public int Z { get; init; }

    public Tile At => new(X, Z);
}

/// <summary>A traveling vendor's pitch in a town's market square: the tile their caravan's trader stands on.</summary>
public sealed class PitchEntry
{
    public string Town { get; init; } = string.Empty;

    public int X { get; init; }

    public int Z { get; init; }

    public Tile At => new(X, Z);
}

/// <summary>A ferry to a far isle: its docks, and the lane a passenger walks between them.</summary>
public sealed class FerryEntry
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary><c>[x, z]</c>.</summary>
    public IReadOnlyList<int> From { get; init; } = [];

    public IReadOnlyList<int> To { get; init; } = [];

    /// <summary>Tile by tile from <see cref="From"/> to <see cref="To"/>, each <c>[x, z]</c>.</summary>
    public IReadOnlyList<IReadOnlyList<int>> Lane { get; init; } = [];
}

/// <summary>A region of the world: its color and name (its tiles are the overworld's to shade).</summary>
public sealed class RegionEntry
{
    public string Color { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;
}

/// <summary><c>world/world.json</c>: the world's tiles and chunking, its regions, towns, inns, dungeons, pitches and ferries.</summary>
public sealed class WorldFile
{
    /// <summary><c>[width, height]</c> in tiles, from <see cref="Origin"/>.</summary>
    public IReadOnlyList<int> Size { get; init; } = [];

    /// <summary>The world's first tile, <c>[x, z]</c>; none for <c>[0, 0]</c>.</summary>
    public IReadOnlyList<int>? Origin { get; init; }

    /// <summary>A chunk's side in tiles: chunk (cx, cz) holds the tiles with floor(x / chunk) = cx and floor(z / chunk) = cz.</summary>
    public int Chunk { get; init; } = 32;

    /// <summary>World units along a tile's side: 1.</summary>
    public double Tile { get; init; } = 1;

    /// <summary>Where the camera keeps its view, <c>[x0, z0, x1, z1]</c>: the overworld's; the server walks every open tile of the world.</summary>
    public IReadOnlyList<int>? Bounds { get; init; }

    public IReadOnlyList<RegionEntry> Regions { get; init; } = [];

    public IReadOnlyList<TownEntry> Towns { get; init; } = [];

    public IReadOnlyList<InnEntry> Inns { get; init; } = [];

    public IReadOnlyList<DungeonPlace> Dungeons { get; init; } = [];

    public IReadOnlyList<PitchEntry> Pitches { get; init; } = [];

    public IReadOnlyList<FerryEntry> Ferries { get; init; } = [];
}

/// <summary>
/// An interior (<c>interiors/&lt;id&gt;.json</c>): a room behind a door of the world. Its floor is <see cref="W"/> by
/// <see cref="D"/> tiles from (0, 0); <see cref="Tiles"/> cover <see cref="Area"/> (default the floor) row by row.
/// </summary>
public sealed class InteriorFile
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary><c>shop</c>, <c>inn</c>, <c>guildhall</c>, <c>temple</c>, <c>smithy</c>, <c>library</c>, <c>house</c>, <c>tower</c>, <c>exotic-wares</c> or <c>crypt</c>.</summary>
    public string Kind { get; init; } = string.Empty;

    /// <summary>The town it says it is in: when given, the town its doors stand in.</summary>
    public string? Town { get; init; }

    public int W { get; init; }

    public int D { get; init; }

    /// <summary><c>[x0, z0, x1, z1]</c> (x1 and z1 excluded), the tiles' rectangle; none for the floor's.</summary>
    public IReadOnlyList<int>? Area { get; init; }

    /// <summary>Each <c>[height (texels), surface, flags]</c>, row by row over <see cref="Area"/>.</summary>
    public IReadOnlyList<JsonElement> Tiles { get; init; } = [];

    public IReadOnlyList<MapNpc> Npcs { get; init; } = [];

    /// <summary>Chests inside (the server's own field: <c>{id, x, z, gold, respawnSeconds}</c>, as a chunk's).</summary>
    public IReadOnlyList<MapChest> Chests { get; init; } = [];

    /// <summary>Its own tile at the door, <c>[x, z]</c>: stepping onto it leaves.</summary>
    public IReadOnlyList<int> Entry { get; init; } = [];

    /// <summary>The world tile one comes out on, <c>[x, z]</c>: the door tile of the building that leads in.</summary>
    public IReadOnlyList<int> Exit { get; init; } = [];

    public Tile? EntryAt => Entry is [int x, int z] ? new Tile(x, z) : null;

    public Tile? ExitAt => Exit is [int x, int z] ? new Tile(x, z) : null;
}

/// <summary>A dungeon (<c>dungeons/&lt;id&gt;.json</c>): its theme, floors, mobs, warden and boss; the layout is the browser's.</summary>
public sealed class DungeonFile
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary><c>caves</c>, <c>castle</c>, <c>tower</c>, <c>crypt</c>, <c>hollow</c>, <c>foundry</c> or <c>portal</c>.</summary>
    public string Theme { get; init; } = string.Empty;

    /// <summary><c>[x, z]</c>, the world tile walked onto to enter.</summary>
    public IReadOnlyList<int> Entrance { get; init; } = [];

    /// <summary>The colors, as letters, a character's identity must hold to enter; null for a dungeon open to everyone.</summary>
    public string? Requires { get; init; }

    /// <summary>How many floors a run has: the fewest and the most.</summary>
    public IReadOnlyList<int> Floors { get; init; } = [];

    public int Tier { get; init; }

    /// <summary>How many encounters each floor holds besides its warden and boss: the fewest and the most.</summary>
    public IReadOnlyList<int> Encounters { get; init; } = [];

    /// <summary>The mobs a floor's encounters are drawn from: one list for every floor, or a list per floor (the last for the floors past it).</summary>
    public JsonElement Mobs { get; init; }

    /// <summary>The mob that keeps each floor's stair (every floor but the last); none for a dungeon of one floor.</summary>
    public string? Warden { get; init; }

    /// <summary>The mob waiting on the last floor.</summary>
    public string Boss { get; init; } = string.Empty;

    /// <summary>The color of the region it belongs to, if any.</summary>
    public string? Region { get; init; }

    /// <summary>A mage tower's: beating its boss attunes its waystone, at its entrance, to the character.</summary>
    public bool Waystone { get; init; }

    public Tile At => Entrance is [int x, int z] ? new Tile(x, z) : default;
}

/// <summary>A card vendor (<c>realms/content/&lt;plane&gt;/vendors/*.json</c>).</summary>
public sealed class VendorFile
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary>The town it keeps its shop in; none for a traveling trader, whose caravan moves (<see cref="Trader"/>).</summary>
    public string Town { get; init; } = string.Empty;

    public CardFilter Specialty { get; init; } = new();

    /// <summary>The purse it is created with.</summary>
    public long Purse { get; init; }

    /// <summary>An exotic wares shop (design.md A5): it deals only in off-plane cards, a few at a time.</summary>
    public bool Exotic { get; init; }

    /// <summary>A traveling trader from another plane (design.md A5): its plane and its caravan's round; null for a shop.</summary>
    public TraderRound? Trader { get; init; }
}

/// <summary>
/// A traveling trader's plane and round (design.md A5, "Wares from other planes"): on day <c>d</c> (the Unix day, UTC) its
/// caravan is in <c>Towns[d mod Towns.Count]</c> from <see cref="Hour"/> o'clock UTC for <see cref="Hours"/> hours.
/// </summary>
public sealed class TraderRound
{
    /// <summary>Its home plane: a trader plane of planes.json, whose off-plane cards it brings.</summary>
    public string Plane { get; init; } = string.Empty;

    /// <summary>The towns its caravan visits, a day each, in turn.</summary>
    public IReadOnlyList<string> Towns { get; init; } = [];

    /// <summary>The hour of the day (UTC, 0 to 23) its caravan comes in.</summary>
    public int Hour { get; init; }

    /// <summary>How many hours its caravan stays: within the day.</summary>
    public int Hours { get; init; }
}


