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

/// <summary>How an item or a mob shows: a mesh of realms/content/models and its palette.</summary>
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

/// <summary><c>realms/content/relics.json</c>.</summary>
public sealed class RelicsFile
{
    public IReadOnlyList<RelicEntry> Relics { get; init; } = [];
}

// The world, its interiors and its dungeons (interfaces.md, "The world, interiors and dungeons"), as the world generator
// (realms/web/scripts/world.ts) writes them.

/// <summary>A spawn point of the world: the mobs that may stand there, all of its tier, and how they wander and come back.</summary>
public sealed class MapSpawn
{
    /// <summary><c>"&lt;cq&gt;_&lt;cr&gt;:&lt;n&gt;"</c>: its chunk and its number there, unique across the world.</summary>
    public string Id { get; init; } = string.Empty;

    public int Q { get; init; }

    public int R { get; init; }

    public IReadOnlyList<string> Mobs { get; init; } = [];

    /// <summary>How far from the spawn point its mobs wander.</summary>
    public int Radius { get; init; }

    public int RespawnSeconds { get; init; }

    /// <summary>The tier of its distance from the nearest starting area (design.md A6): every mob of it is of this tier.</summary>
    public int Tier { get; init; }

    public Hex At => new(Q, R);
}

public sealed class MapChest
{
    public string Id { get; init; } = string.Empty;

    public int Q { get; init; }

    public int R { get; init; }

    public IReadOnlyList<long> Gold { get; init; } = [];

    public int RespawnSeconds { get; init; }

    public Hex At => new(Q, R);
}

public sealed class MapNpc
{
    public string Id { get; init; } = string.Empty;

    public int Q { get; init; }

    public int R { get; init; }

    /// <summary><c>vendor</c>, <c>armorer</c>, <c>innkeeper</c>, <c>spell-table</c>, or another the overworld draws.</summary>
    public string Kind { get; init; } = string.Empty;

    /// <summary>The vendor a <c>vendor</c> NPC is.</summary>
    public string? Vendor { get; init; }

    public Hex At => new(Q, R);
}

/// <summary>A door of the world: walking onto it enters the interior it names.</summary>
public sealed class MapDoor
{
    public int Q { get; init; }

    public int R { get; init; }

    public string Interior { get; init; } = string.Empty;

    public Hex At => new(Q, R);
}

/// <summary>A dungeon's entrance in the world: a cave mouth, a castle gate, a tower door.</summary>
public sealed class MapEntrance
{
    public int Q { get; init; }

    public int R { get; init; }

    public string Dungeon { get; init; } = string.Empty;

    public Hex At => new(Q, R);
}

/// <summary>A hex of a place, <c>{q, r}</c>.</summary>
public sealed class MapHex
{
    public int Q { get; init; }

    public int R { get; init; }

    public Hex At => new(Q, R);
}

/// <summary>A chunk of the world (<c>world/chunks/&lt;cq&gt;_&lt;cr&gt;.json</c>).</summary>
public sealed class ChunkFile
{
    /// <summary>Each <c>[q, r, height, terrain, blocked]</c>, in the world's hexes.</summary>
    public IReadOnlyList<JsonElement> Tiles { get; init; } = [];

    /// <summary>Scenery, the overworld's to draw; the server reads only its spell tables (<c>{kind: "spell-table", q, r}</c>).</summary>
    public IReadOnlyList<JsonElement> Props { get; init; } = [];

    public IReadOnlyList<MapDoor> Doors { get; init; } = [];

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

    public IReadOnlyList<int> Center { get; init; } = [];

    public int Radius { get; init; }

    public string? Style { get; init; }

    public Hex At => Center is [int q, int r] ? new Hex(q, r) : default;
}

/// <summary>An inn of the world, at the hex outside its door where a character whose home it is wakes after a lost duel.</summary>
public sealed class InnEntry
{
    public string Id { get; init; } = string.Empty;

    public string Town { get; init; } = string.Empty;

    public int Q { get; init; }

    public int R { get; init; }

    public Hex At => new(Q, R);
}

/// <summary>Where a dungeon stands in the world (<c>world.json</c>'s <c>dungeons</c>).</summary>
public sealed class DungeonPlace
{
    public string Id { get; init; } = string.Empty;

    public int Q { get; init; }

    public int R { get; init; }

    public Hex At => new(Q, R);
}

/// <summary>A region of the world: its color and name (its hexes are the overworld's to shade).</summary>
public sealed class RegionEntry
{
    public string Color { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;
}

/// <summary><c>world/world.json</c>: the world's size and chunking, its regions, towns, inns and dungeons.</summary>
public sealed class WorldFile
{
    public IReadOnlyList<int> Size { get; init; } = [];

    /// <summary>A chunk's side in hexes: chunk (cq, cr) holds the hexes with floor(q / chunk) = cq and floor(r / chunk) = cr.</summary>
    public int Chunk { get; init; } = 32;

    public IReadOnlyList<RegionEntry> Regions { get; init; } = [];

    public IReadOnlyList<TownEntry> Towns { get; init; } = [];

    public IReadOnlyList<InnEntry> Inns { get; init; } = [];

    public IReadOnlyList<DungeonPlace> Dungeons { get; init; } = [];
}

/// <summary>An interior (<c>interiors/&lt;id&gt;.json</c>): a small scene of its own, entered through a door of the world.</summary>
public sealed class InteriorFile
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary><c>shop</c>, <c>inn</c>, <c>guildhall</c>, <c>temple</c>, <c>smithy</c>, <c>library</c>, <c>house</c> or <c>tower</c>.</summary>
    public string Kind { get; init; } = string.Empty;

    /// <summary>Each <c>[q, r, height, terrain, blocked]</c>, in the interior's own hexes.</summary>
    public IReadOnlyList<JsonElement> Tiles { get; init; } = [];

    public IReadOnlyList<JsonElement> Props { get; init; } = [];

    public IReadOnlyList<MapNpc> Npcs { get; init; } = [];

    public IReadOnlyList<MapChest> Chests { get; init; } = [];

    /// <summary>Where its door comes out in the world.</summary>
    public MapHex? Exit { get; init; }
}

/// <summary>A dungeon (<c>dungeons/&lt;id&gt;.json</c>): its theme, floors, mobs, warden and boss; the layout is the browser's.</summary>
public sealed class DungeonFile
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary><c>caves</c>, <c>castle</c>, <c>tower</c>, <c>crypt</c>, <c>hollow</c>, <c>foundry</c> or <c>portal</c>.</summary>
    public string Theme { get; init; } = string.Empty;

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

    public Hex At => Entrance is [int q, int r] ? new Hex(q, r) : default;
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


