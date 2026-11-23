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

    /// <summary>The color a boss unlocks when beaten.</summary>
    public string? Unlocks { get; init; }
}

public sealed class MapProp
{
    public int Q { get; init; }

    public int R { get; init; }

    public string Kind { get; init; } = string.Empty;
}

public sealed class MapExit
{
    public int Q { get; init; }

    public int R { get; init; }

    public string To { get; init; } = string.Empty;
}

public sealed class MapSpawn
{
    public string Id { get; init; } = string.Empty;

    public int Q { get; init; }

    public int R { get; init; }

    public IReadOnlyList<string> Mobs { get; init; } = [];

    /// <summary>How far from the spawn point its mobs wander.</summary>
    public int Radius { get; init; }

    public int RespawnSeconds { get; init; }

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

    /// <summary><c>inn</c>, <c>spell-table</c>, <c>armorer</c>, <c>vendor</c>, or another the overworld draws.</summary>
    public string Kind { get; init; } = string.Empty;

    /// <summary>The vendor a <c>vendor</c> NPC is.</summary>
    public string? Vendor { get; init; }

    public Hex At => new(Q, R);
}

/// <summary>Where a character who loses a duel on a map wakes: a hex of that map, or of the map it names.</summary>
public sealed class MapInn
{
    public int Q { get; init; }

    public int R { get; init; }

    /// <summary>The map the inn is on, when it is not this one: the nearest town's.</summary>
    public string? Map { get; init; }

    public Hex At => new(Q, R);
}

/// <summary>A map (<c>realms/content/&lt;plane&gt;/maps/*.json</c>).</summary>
public sealed class MapFile
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary><c>town</c>, <c>village</c>, <c>wilderness</c>, <c>dungeon</c> or <c>world</c>.</summary>
    public string Kind { get; init; } = string.Empty;

    public string? Region { get; init; }

    public int? Floor { get; init; }

    public int Radius { get; init; }

    /// <summary>Each <c>[q, r, height, terrain, blocked]</c>.</summary>
    public IReadOnlyList<JsonElement> Tiles { get; init; } = [];

    public IReadOnlyList<MapProp> Props { get; init; } = [];

    public IReadOnlyList<MapExit> Exits { get; init; } = [];

    public IReadOnlyList<MapSpawn> Spawns { get; init; } = [];

    public IReadOnlyList<MapChest> Chests { get; init; } = [];

    public IReadOnlyList<MapNpc> Npcs { get; init; } = [];

    public MapInn? Inn { get; init; }
}

/// <summary>A card vendor (<c>realms/content/&lt;plane&gt;/vendors/*.json</c>).</summary>
public sealed class VendorFile
{
    public string Id { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    /// <summary>The town map it trades in.</summary>
    public string Town { get; init; } = string.Empty;

    public CardFilter Specialty { get; init; } = new();

    /// <summary>The purse it is created with.</summary>
    public long Purse { get; init; }
}

/// <summary>One tile of a map: its height and terrain, and whether anyone may stand on it.</summary>
public readonly record struct Tile(Hex At, double Height, string Terrain, bool Blocked);
