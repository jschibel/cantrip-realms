using System.Text.Json;

namespace Cantrip.Realms.Server.Content;

/// <summary>
/// A space a character stands in (interfaces.md, "Places"): the world, or an interior. A dungeon run's space is the
/// browser's own layout, which the server does not walk.
/// </summary>
public abstract class RealmSpace
{
    /// <summary>The space's id: <see cref="RealmContent.World"/>, or the interior's.</summary>
    public abstract string Id { get; }

    /// <summary>Whether someone may stand on a hex: it is a tile of the space and not blocked.</summary>
    public abstract bool Walkable(Hex at);

    /// <summary>Whether a hex is a tile of the space, blocked or not.</summary>
    public abstract bool Has(Hex at);

    /// <summary>The space's people and places a player uses: vendors, armorers, innkeepers, spell tables.</summary>
    public abstract IReadOnlyList<MapNpc> Npcs { get; }

    /// <summary>The hexes a spell table stands on (design.md A2): a <c>spell-table</c> prop or NPC.</summary>
    public abstract IReadOnlyList<Hex> SpellTables { get; }

    public abstract MapChest? Chest(string id);

    public const string SpellTable = "spell-table";

    /// <summary>A spell table among scenery: a prop <c>{kind: "spell-table", q, r}</c>.</summary>
    internal static IEnumerable<Hex> SpellTablesAmong(IEnumerable<JsonElement> props)
    {
        foreach (JsonElement prop in props)
        {
            if (prop.ValueKind == JsonValueKind.Object
                && prop.TryGetProperty("kind", out JsonElement kind) && kind.ValueKind == JsonValueKind.String && kind.GetString() == SpellTable
                && prop.TryGetProperty("q", out JsonElement q) && q.TryGetInt32(out int pq)
                && prop.TryGetProperty("r", out JsonElement r) && r.TryGetInt32(out int pr))
            {
                yield return new Hex(pq, pr);
            }
        }
    }
}

/// <summary>
/// The world (design.md A6): one map streamed in chunks of <see cref="Chunk"/> hexes a side. Chunk (cq, cr) holds the
/// hexes with floor(q / chunk) = cq and floor(r / chunk) = cr. Each tile is kept as a byte - none, open or blocked - so the
/// whole world (about 640 by 640) is a few hundred kilobytes.
/// </summary>
public sealed class RealmWorld : RealmSpace
{
    private const byte None = 0;
    private const byte Open = 1;
    private const byte Blocked = 2;

    private readonly Dictionary<(int, int), byte[]> _cells = [];
    private readonly Dictionary<string, MapSpawn> _spawns = new(StringComparer.Ordinal);
    private readonly Dictionary<string, MapChest> _chests = new(StringComparer.Ordinal);
    private readonly Dictionary<Hex, string> _doors = [];
    private readonly Dictionary<Hex, string> _entrances = [];
    private readonly List<MapNpc> _npcs = [];
    private readonly List<Hex> _spellTables = [];

    public RealmWorld(WorldFile file, string plane)
    {
        File = file;
        Plane = plane;
        Chunk = file.Chunk;
    }

    public WorldFile File { get; }

    /// <summary>The plane the world is.</summary>
    public string Plane { get; }

    /// <summary>A chunk's side in hexes.</summary>
    public int Chunk { get; }

    public override string Id => RealmContent.WorldSpace;

    /// <summary>The chunks read, by (cq, cr).</summary>
    public IReadOnlyCollection<(int Cq, int Cr)> Chunks => _cells.Keys;

    public IReadOnlyCollection<MapSpawn> Spawns => _spawns.Values;

    public IReadOnlyCollection<MapChest> Chests => _chests.Values;

    /// <summary>Every door, by its hex: the interior it enters.</summary>
    public IReadOnlyDictionary<Hex, string> Doors => _doors;

    /// <summary>Every dungeon entrance, by its hex: the dungeon it enters.</summary>
    public IReadOnlyDictionary<Hex, string> Entrances => _entrances;

    public override IReadOnlyList<MapNpc> Npcs => _npcs;

    public override IReadOnlyList<Hex> SpellTables => _spellTables;

    /// <summary>The chunk a hex is in.</summary>
    public (int Cq, int Cr) ChunkOf(Hex at) => (FloorDiv(at.Q, Chunk), FloorDiv(at.R, Chunk));

    private static int FloorDiv(int value, int divisor) => value >= 0 ? value / divisor : -((-value + divisor - 1) / divisor);

    private byte Cell(Hex at)
    {
        (int cq, int cr) = ChunkOf(at);
        return _cells.TryGetValue((cq, cr), out byte[]? cells) ? cells[((at.R - cr * Chunk) * Chunk) + (at.Q - cq * Chunk)] : None;
    }

    public override bool Walkable(Hex at) => Cell(at) == Open;

    public override bool Has(Hex at) => Cell(at) != None;

    public MapSpawn? Spawn(string id) => _spawns.GetValueOrDefault(id);

    public override MapChest? Chest(string id) => _chests.GetValueOrDefault(id);

    /// <summary>
    /// Reads a chunk's file into the world: its tiles, and the doors, entrances, NPCs, spawns, chests and spell tables in
    /// it. What does not hold together is a problem, and what can't be read is left out.
    /// </summary>
    internal void Add(int cq, int cr, ChunkFile chunk, string where, List<string> problems)
    {
        if (!_cells.TryAdd((cq, cr), new byte[Chunk * Chunk]))
        {
            problems.Add($"{where}: a second file for chunk {cq}_{cr}.");
            return;
        }

        byte[] cells = _cells[(cq, cr)];
        foreach (JsonElement tile in chunk.Tiles)
        {
            if (!RealmContent.TryTile(tile, out Hex at, out bool blocked))
            {
                problems.Add($"{where}: a tile is [q, r, height, terrain, blocked]: {tile.GetRawText()}.");
                continue;
            }

            if (ChunkOf(at) != (cq, cr))
            {
                problems.Add($"{where}: the tile at {at} is in chunk {ChunkOf(at).Cq}_{ChunkOf(at).Cr}, not this one.");
                continue;
            }

            int index = ((at.R - cr * Chunk) * Chunk) + (at.Q - cq * Chunk);
            if (cells[index] != None) problems.Add($"{where}: two tiles at {at}.");
            cells[index] = blocked ? Blocked : Open;
        }

        foreach (MapDoor door in chunk.Doors)
        {
            if (!_doors.TryAdd(door.At, door.Interior)) problems.Add($"{where}: two doors at {door.At}.");
        }

        foreach (MapEntrance entrance in chunk.Entrances)
        {
            if (!_entrances.TryAdd(entrance.At, entrance.Dungeon)) problems.Add($"{where}: two entrances at {entrance.At}.");
        }

        foreach (MapSpawn spawn in chunk.Spawns)
        {
            string prefix = $"{cq}_{cr}:";
            if (!spawn.Id.StartsWith(prefix, StringComparison.Ordinal) || spawn.Id.Length == prefix.Length || !spawn.Id[prefix.Length..].All(char.IsAsciiDigit))
            {
                problems.Add($"{where}: spawn '{spawn.Id}' is not \"{cq}_{cr}:<n>\", its chunk and a number.");
            }
            else if (!_spawns.TryAdd(spawn.Id, spawn))
            {
                problems.Add($"{where}: a second spawn '{spawn.Id}'.");
            }

            if (ChunkOf(spawn.At) != (cq, cr)) problems.Add($"{where}: spawn {spawn.Id} stands at {spawn.At}, outside its chunk.");
        }

        foreach (MapChest chest in chunk.Chests)
        {
            if (!_chests.TryAdd(chest.Id, chest)) problems.Add($"{where}: a second chest '{chest.Id}' in the world.");
        }

        _npcs.AddRange(chunk.Npcs);
        _spellTables.AddRange(SpellTablesAmong(chunk.Props).Concat(chunk.Npcs.Where(npc => npc.Kind == SpellTable).Select(npc => npc.At)));
    }
}

/// <summary>An interior (interfaces.md, "Interiors"): a small scene of its own tiles, entered through a door of the world.</summary>
public sealed class RealmInterior : RealmSpace
{
    private readonly Dictionary<Hex, bool> _tiles = [];
    private readonly List<Hex> _spellTables;

    public RealmInterior(InteriorFile file, string plane, string where, List<string> problems)
    {
        ArgumentNullException.ThrowIfNull(file);
        ArgumentNullException.ThrowIfNull(problems);
        File = file;
        Plane = plane;
        foreach (JsonElement tile in file.Tiles)
        {
            if (!RealmContent.TryTile(tile, out Hex at, out bool blocked)) problems.Add($"{where}: a tile is [q, r, height, terrain, blocked]: {tile.GetRawText()}.");
            else if (!_tiles.TryAdd(at, blocked)) problems.Add($"{where}: two tiles at {at}.");
        }

        _spellTables = [.. SpellTablesAmong(file.Props).Concat(file.Npcs.Where(npc => npc.Kind == SpellTable).Select(npc => npc.At))];
    }

    public InteriorFile File { get; }

    public string Plane { get; }

    public override string Id => File.Id;

    /// <summary>The town whose door leads into it; null for a building in the wilds.</summary>
    public TownEntry? Town { get; internal set; }

    /// <summary>The world's doors into it.</summary>
    public IReadOnlyList<Hex> Doors { get; internal set; } = [];

    public override bool Walkable(Hex at) => _tiles.TryGetValue(at, out bool blocked) && !blocked;

    public override bool Has(Hex at) => _tiles.ContainsKey(at);

    public override IReadOnlyList<MapNpc> Npcs => File.Npcs;

    public override IReadOnlyList<Hex> SpellTables => _spellTables;

    public override MapChest? Chest(string id) => File.Chests.FirstOrDefault(chest => chest.Id == id);
}

/// <summary>A dungeon (interfaces.md, "Dungeons"), with its mob tables read: one list of mobs a floor.</summary>
public sealed class RealmDungeon(DungeonFile file, string plane, IReadOnlyList<IReadOnlyList<string>> tables)
{
    public DungeonFile File { get; } = file;

    public string Plane { get; } = plane;

    public string Id => File.Id;

    /// <summary>The mobs each floor's encounters are drawn from: the last list for the floors past the lists given.</summary>
    public IReadOnlyList<IReadOnlyList<string>> Tables { get; } = tables;

    /// <summary>The mobs a floor's encounters are drawn from, the first floor 0.</summary>
    public IReadOnlyList<string> TableOf(int floor) => Tables.Count == 0 ? [] : Tables[Math.Min(floor, Tables.Count - 1)];

    public bool IsTower => File.Theme == "tower";
}
