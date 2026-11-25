using System.Text.Json;

namespace Cantrip.Realms.Server.Content;

/// <summary>
/// A space a character stands in (interfaces.md, "Places"): the world, or an interior. A dungeon run's space is the
/// browser's own layout, which the server does not walk. Its tiles are squares, walked eight ways (<see cref="CanStep"/>).
/// </summary>
public abstract class RealmSpace
{
    /// <summary>The space's id: <see cref="RealmContent.World"/>, or the interior's.</summary>
    public abstract string Id { get; }

    /// <summary>Whether someone may stand on a tile: it is a tile of the space, has a surface and is not blocked.</summary>
    public abstract bool Walkable(Tile at);

    /// <summary>Whether a tile is a tile of the space, blocked or not.</summary>
    public abstract bool Has(Tile at);

    /// <summary>A tile's floor height in texels (a sixteenth of a tile); 0 off the space.</summary>
    public abstract int HeightAt(Tile at);

    /// <summary>Whether nothing grows up off a tile (flag 2, bare: no standing grass under a tree or a house).</summary>
    public abstract bool IsBare(Tile at);

    /// <summary>The space's people and places a player uses: vendors, armorers, innkeepers, spell tables.</summary>
    public abstract IReadOnlyList<MapNpc> Npcs { get; }

    /// <summary>The tiles a spell table stands on (design.md A2): its <c>spell-table</c> NPCs'.</summary>
    public abstract IReadOnlyList<Tile> SpellTables { get; }

    public abstract MapChest? Chest(string id);

    public const string SpellTable = "spell-table";

    /// <summary>A mage tower's waystone (an NPC of the world beside its entrance, naming its <c>tower</c>).</summary>
    public const string Waystone = "waystone";

    /// <summary>
    /// The most a step between side-by-side tiles climbs or drops, texels (a quarter of a tile), unless both are ramps
    /// (<c>LEDGE</c> of <c>realms/web/src/world/format.ts</c>): a higher bank is a ledge, walked up to but never over.
    /// </summary>
    public const int Ledge = 4;

    /// <summary>Whether a tile's floor is a ramp (flag 4): a slope between two levels, stepped up whatever the heights.</summary>
    public abstract bool IsRamp(Tile at);

    /// <summary>Whether the edge between two side-by-side tiles is no ledge: their floors within <see cref="Ledge"/>, or both ramps.</summary>
    public bool Passes(Tile a, Tile b) => (IsRamp(a) && IsRamp(b)) || Math.Abs(HeightAt(a) - HeightAt(b)) <= Ledge;

    /// <summary>
    /// Whether one step of a walk is taken (the rule of <c>realms/web/src/world/grid.ts</c>, <c>canStep</c>, exactly): to
    /// one of the eight tiles round, which is walkable, over no ledge (<see cref="Passes"/>); and diagonally only where
    /// both tiles it passes between are walkable too and all four edges round the corner are no ledge - a walk never cuts
    /// the corner of a blocked tile, nor of a ledge.
    /// </summary>
    public bool CanStep(Tile from, Tile to)
    {
        if (from.DistanceTo(to) != 1 || !Walkable(to)) return false;
        if (!from.IsDiagonalTo(to)) return Passes(from, to);
        var across = new Tile(to.X, from.Z);
        var along = new Tile(from.X, to.Z);
        return Walkable(across) && Walkable(along) && Passes(from, across) && Passes(across, to) && Passes(from, along) && Passes(along, to);
    }

    /// <summary>
    /// Whether a straight line walked from one point to another keeps the grid's rule (the rule of
    /// <c>realms/web/src/render/motion.ts</c>, <c>legClear</c>, exactly): the tiles it crosses, in turn, are each a step
    /// (<see cref="CanStep"/>) from the one before - through a tile's corner, the diagonal step, which never cuts the corner
    /// of a blocked tile or a ledge. The overworld's body, which never overlaps a blocked tile nor stands across a ledge,
    /// walks only such lines. The caller bounds the line's length (it is walked tile by tile).
    /// </summary>
    public bool CanWalk(Point from, Point to)
    {
        int tx = (int)Math.Floor(from.X);
        int tz = (int)Math.Floor(from.Z);
        var end = to.Tile;
        double dx = to.X - from.X;
        double dz = to.Z - from.Z;
        int stepX = Math.Sign(dx);
        int stepZ = Math.Sign(dz);
        double deltaX = stepX != 0 ? Math.Abs(1 / dx) : double.PositiveInfinity;
        double deltaZ = stepZ != 0 ? Math.Abs(1 / dz) : double.PositiveInfinity;
        double maxX = stepX > 0 ? (tx + 1 - from.X) * deltaX : stepX < 0 ? (from.X - tx) * deltaX : double.PositiveInfinity;
        double maxZ = stepZ > 0 ? (tz + 1 - from.Z) * deltaZ : stepZ < 0 ? (from.Z - tz) * deltaZ : double.PositiveInfinity;
        // Amanatides and Woo's walk over the squares a segment crosses before its end, crossings within Corner of each
        // other a corner; an end on the edge of the tile reached (a point on a tile's edge is the tile east or south of
        // it) is a step on to that tile.
        for (int guard = 0; Math.Min(maxX, maxZ) < 1 - Corner && guard < 4096; guard++)
        {
            var was = new Tile(tx, tz);
            if (Math.Abs(maxX - maxZ) < Corner)
            {
                tx += stepX;
                tz += stepZ;
                maxX += deltaX;
                maxZ += deltaZ;
            }
            else if (maxX < maxZ)
            {
                tx += stepX;
                maxX += deltaX;
            }
            else
            {
                tz += stepZ;
                maxZ += deltaZ;
            }

            if (!CanStep(was, new Tile(tx, tz))) return false;
        }

        var reached = new Tile(tx, tz);
        return reached == end || (reached.DistanceTo(end) == 1 && CanStep(reached, end));
    }

    /// <summary>How near, in the line's own measure, two crossings are one through a corner (a line from tile middle to middle on the diagonal goes exactly through it).</summary>
    private const double Corner = 1e-9;

    /// <summary>Whether a walk is one: from a tile, each tile of the path a step (<see cref="CanStep"/>) from the one before.</summary>
    public bool IsWalk(Tile from, IEnumerable<Tile> path)
    {
        ArgumentNullException.ThrowIfNull(path);
        Tile previous = from;
        foreach (Tile next in path)
        {
            if (!CanStep(previous, next)) return false;
            previous = next;
        }

        return true;
    }

    // A tile as kept: none (no tile of the space), open or blocked, and whether it is bare, and a ramp.
    private protected const byte None = 0;
    private protected const byte Open = 1;
    private protected const byte Blocked = 2;
    private protected const byte Bare = 4;
    private protected const byte Ramp = 8;

    /// <summary>
    /// Reads a list of tiles, <c>[height (texels), surface, flags]</c> (interfaces.md, "Version 2 of the world data"): the floor's height in whole texels,
    /// a surface id or <c>""</c> (nothing: never walked), and flags 1 blocked, 2 bare and 4 ramp (a slope between two
    /// levels, stepped onto from the level each side and from the ramp's other tiles, <see cref="Passes"/>). Each into a state byte and a height, at the index it has in the list.
    /// </summary>
    private protected static void ReadTiles(IReadOnlyList<JsonElement> tiles, byte[] states, short[] heights, string where, List<string> problems)
    {
        for (int i = 0; i < tiles.Count && i < states.Length; i++)
        {
            if (!TryTile(tiles[i], out short height, out string surface, out int flags))
            {
                problems.Add($"{where}: tile {i} is [height (whole texels), surface, flags 0-7], not {tiles[i].GetRawText()}.");
                continue;
            }

            bool blocked = (flags & 1) != 0 || surface.Length == 0;
            states[i] = (byte)((blocked ? Blocked : Open) | ((flags & 2) != 0 ? Bare : 0) | ((flags & 4) != 0 ? Ramp : 0));
            heights[i] = height;
        }
    }

    /// <summary>A tile on the wire, <c>[height, surface, flags]</c>.</summary>
    internal static bool TryTile(JsonElement tile, out short height, out string surface, out int flags)
    {
        height = 0;
        surface = string.Empty;
        flags = 0;
        if (tile.ValueKind != JsonValueKind.Array || tile.GetArrayLength() != 3
            || !tile[0].TryGetInt16(out height) || tile[1].ValueKind != JsonValueKind.String
            || !tile[2].TryGetInt32(out flags) || flags is < 0 or > 7)
        {
            return false;
        }

        surface = tile[1].GetString()!;
        return true;
    }
}

/// <summary>
/// The world (design.md A6): <c>size</c> tiles from <c>origin</c>, streamed in chunks of <see cref="Chunk"/> tiles a
/// side. Chunk (cx, cz) holds the tiles with floor(x / chunk) = cx and floor(z / chunk) = cz, and may be negative. Each
/// tile is kept as a state byte and a height, so the whole world (640 by 640) is about a megabyte. A tile past the world's
/// edge, or of a chunk with no file, is none of the world's.
/// </summary>
public sealed class RealmWorld : RealmSpace
{
    private readonly Dictionary<(int, int), (byte[] States, short[] Heights)> _cells = [];
    private readonly Dictionary<string, MapSpawn> _spawns = new(StringComparer.Ordinal);
    private readonly Dictionary<string, MapChest> _chests = new(StringComparer.Ordinal);
    private readonly Dictionary<Tile, string> _doors = [];
    private readonly Dictionary<Tile, string> _entrances = [];
    private readonly List<MapNpc> _npcs = [];
    private readonly List<Tile> _spellTables = [];
    private readonly Dictionary<string, List<Tile>> _waystones = new(StringComparer.Ordinal);

    public RealmWorld(WorldFile file, string plane)
    {
        ArgumentNullException.ThrowIfNull(file);
        File = file;
        Plane = plane;
        Chunk = file.Chunk;
        (X0, Z0) = file.Origin is [int x, int z] ? (x, z) : (0, 0);
        (Width, Height) = file.Size is [int w, int h] ? (w, h) : (0, 0);
    }

    public WorldFile File { get; }

    /// <summary>The plane the world is.</summary>
    public string Plane { get; }

    /// <summary>A chunk's side in tiles.</summary>
    public int Chunk { get; }

    /// <summary>The world's first tile (its <c>origin</c>) and its size in tiles.</summary>
    public int X0 { get; }

    public int Z0 { get; }

    public int Width { get; }

    public int Height { get; }

    public override string Id => RealmContent.WorldSpace;

    /// <summary>The chunks read, by (cx, cz).</summary>
    public IReadOnlyCollection<(int Cx, int Cz)> Chunks => _cells.Keys;

    public IReadOnlyCollection<MapSpawn> Spawns => _spawns.Values;

    public IReadOnlyCollection<MapChest> Chests => _chests.Values;

    /// <summary>Every door with an interior, by its tile: the interior it enters.</summary>
    public IReadOnlyDictionary<Tile, string> Doors => _doors;

    /// <summary>Every dungeon entrance, by its tile: the dungeon it enters.</summary>
    public IReadOnlyDictionary<Tile, string> Entrances => _entrances;

    public override IReadOnlyList<MapNpc> Npcs => _npcs;

    public override IReadOnlyList<Tile> SpellTables => _spellTables;

    /// <summary>The tiles a mage tower's <c>waystone</c> NPCs stand on (none for a dungeon without one).</summary>
    public IReadOnlyList<Tile> WaystonesOf(string tower) => _waystones.TryGetValue(tower, out List<Tile>? tiles) ? tiles : [];

    /// <summary>The chunk a tile is in.</summary>
    public (int Cx, int Cz) ChunkOf(Tile at) => (FloorDiv(at.X, Chunk), FloorDiv(at.Z, Chunk));

    private static int FloorDiv(int value, int divisor) => value >= 0 ? value / divisor : -((-value + divisor - 1) / divisor);

    /// <summary>Whether a tile is within the world's <c>size</c> from its <c>origin</c>.</summary>
    public bool Inside(Tile at) => at.X >= X0 && at.Z >= Z0 && at.X < X0 + Width && at.Z < Z0 + Height;

    private (byte State, short Height) Cell(Tile at)
    {
        if (!Inside(at)) return (None, 0);
        (int cx, int cz) = ChunkOf(at);
        if (!_cells.TryGetValue((cx, cz), out var cells)) return (None, 0);
        int index = ((at.Z - cz * Chunk) * Chunk) + (at.X - cx * Chunk);
        return (cells.States[index], cells.Heights[index]);
    }

    public override bool Walkable(Tile at) => (Cell(at).State & 3) == Open;

    public override bool Has(Tile at) => Cell(at).State != None;

    public override int HeightAt(Tile at) => Cell(at).Height;

    public override bool IsBare(Tile at) => (Cell(at).State & Bare) != 0;

    public override bool IsRamp(Tile at) => (Cell(at).State & Ramp) != 0;

    public MapSpawn? Spawn(string id) => _spawns.GetValueOrDefault(id);

    public override MapChest? Chest(string id) => _chests.GetValueOrDefault(id);

    /// <summary>
    /// Reads a chunk's file into the world: its tiles, and the doors (its buildings' with an interior), entrances, NPCs,
    /// spawns, chests and spell tables in it. What does not hold together is a problem, and what can't be read is left out.
    /// </summary>
    internal void Add(int cx, int cz, ChunkFile chunk, string where, List<string> problems)
    {
        if ((chunk.Cx is { } fileCx && fileCx != cx) || (chunk.Cz is { } fileCz && fileCz != cz))
        {
            problems.Add($"{where}: it says it is chunk {chunk.Cx}_{chunk.Cz}, but its name is {cx}_{cz}.");
        }

        if (chunk.Tiles.Count != Chunk * Chunk)
        {
            problems.Add($"{where}: a chunk is {Chunk * Chunk} tiles ({Chunk} by {Chunk}, row by row), not {chunk.Tiles.Count}.");
            return;
        }

        if (!_cells.TryAdd((cx, cz), (new byte[Chunk * Chunk], new short[Chunk * Chunk])))
        {
            problems.Add($"{where}: a second file for chunk {cx}_{cz}.");
            return;
        }

        (byte[] states, short[] heights) = _cells[(cx, cz)];
        ReadTiles(chunk.Tiles, states, heights, where, problems);

        foreach (MapBuilding building in chunk.Buildings)
        {
            if (building.Interior is not { } interior) continue;
            if (building.DoorAt is not { } door) problems.Add($"{where}: building {building.Id} leads into {interior} through no door [x, z].");
            else if (!_doors.TryAdd(door, interior)) problems.Add($"{where}: two doors at {door}.");
        }

        foreach (MapEntrance entrance in chunk.Entrances)
        {
            if (!_entrances.TryAdd(entrance.At, entrance.Dungeon)) problems.Add($"{where}: two entrances at {entrance.At}.");
        }

        foreach (MapSpawn spawn in chunk.Spawns)
        {
            string prefix = $"{cx}_{cz}:";
            if (!spawn.Id.StartsWith(prefix, StringComparison.Ordinal) || spawn.Id.Length == prefix.Length || !spawn.Id[prefix.Length..].All(char.IsAsciiDigit))
            {
                problems.Add($"{where}: spawn '{spawn.Id}' is not \"{cx}_{cz}:<n>\", its chunk and a number.");
            }
            else if (!_spawns.TryAdd(spawn.Id, spawn))
            {
                problems.Add($"{where}: a second spawn '{spawn.Id}'.");
            }

            if (ChunkOf(spawn.At) != (cx, cz)) problems.Add($"{where}: spawn {spawn.Id} stands at {spawn.At}, outside its chunk.");
        }

        foreach (MapChest chest in chunk.Chests)
        {
            if (!_chests.TryAdd(chest.Id, chest)) problems.Add($"{where}: a second chest '{chest.Id}' in the world.");
        }

        _npcs.AddRange(chunk.Npcs);
        _spellTables.AddRange(chunk.Npcs.Where(npc => npc.Kind == SpellTable).Select(npc => npc.At));
        foreach (MapNpc waystone in chunk.Npcs.Where(npc => npc.Kind == Waystone && npc.Tower is not null))
        {
            if (!_waystones.TryGetValue(waystone.Tower!, out List<Tile>? tiles)) _waystones[waystone.Tower!] = tiles = [];
            tiles.Add(waystone.At);
        }
    }
}

/// <summary>
/// An interior (interfaces.md, "Interiors"): a room of its own tiles, its floor <c>w</c> by <c>d</c> from (0, 0), its
/// tiles over its <c>area</c> (by default the floor), entered through a door of the world.
/// </summary>
public sealed class RealmInterior : RealmSpace
{
    private readonly byte[] _states;
    private readonly short[] _heights;
    private readonly List<Tile> _spellTables;

    public RealmInterior(InteriorFile file, string plane, string where, List<string> problems)
    {
        ArgumentNullException.ThrowIfNull(file);
        ArgumentNullException.ThrowIfNull(problems);
        File = file;
        Plane = plane;
        (X0, Z0, X1, Z1) = file.Area is [int x0, int z0, int x1, int z1] ? (x0, z0, x1, z1) : (0, 0, file.W, file.D);
        if (file.Area is not null and not [_, _, _, _]) problems.Add($"{where}: its area is [x0, z0, x1, z1].");
        if (file.W <= 0 || file.D <= 0) problems.Add($"{where}: its floor is some tiles wide (w) and deep (d).");
        int count = X1 > X0 && Z1 > Z0 ? (X1 - X0) * (Z1 - Z0) : 0;
        _states = new byte[count];
        _heights = new short[count];
        if (file.Tiles.Count != count) problems.Add($"{where}: its tiles cover its area, {count} of them row by row, not {file.Tiles.Count}.");
        else ReadTiles(file.Tiles, _states, _heights, where, problems);

        _spellTables = [.. file.Npcs.Where(npc => npc.Kind == SpellTable).Select(npc => npc.At)];
    }

    public InteriorFile File { get; }

    public string Plane { get; }

    public override string Id => File.Id;

    /// <summary>The rectangle of its tiles: x from <see cref="X0"/> to <see cref="X1"/> (excluded), likewise z.</summary>
    public int X0 { get; }

    public int Z0 { get; }

    public int X1 { get; }

    public int Z1 { get; }

    /// <summary>The town whose door leads into it; null for a building in the wilds.</summary>
    public TownEntry? Town { get; internal set; }

    /// <summary>The world's doors into it.</summary>
    public IReadOnlyList<Tile> Doors { get; internal set; } = [];

    private int Index(Tile at) => at.X >= X0 && at.Z >= Z0 && at.X < X1 && at.Z < Z1 ? ((at.Z - Z0) * (X1 - X0)) + (at.X - X0) : -1;

    private byte State(Tile at) => Index(at) is var i and >= 0 && i < _states.Length ? _states[i] : None;

    public override bool Walkable(Tile at) => (State(at) & 3) == Open;

    public override bool Has(Tile at) => State(at) != None;

    public override int HeightAt(Tile at) => Index(at) is var i and >= 0 && i < _heights.Length ? _heights[i] : 0;

    public override bool IsBare(Tile at) => (State(at) & Bare) != 0;

    public override bool IsRamp(Tile at) => (State(at) & Ramp) != 0;

    public override IReadOnlyList<MapNpc> Npcs => File.Npcs;

    public override IReadOnlyList<Tile> SpellTables => _spellTables;

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

    /// <summary>
    /// The mobs a floor's encounters are drawn from as <paramref name="standing"/> deals the run (design.md A6): the floor's
    /// own of the standing's tiers, else every floor's of them, in the order the tables give them; the floor's table as
    /// written with no standing.
    /// </summary>
    public IReadOnlyList<string> TableOf(int floor, DungeonStanding? standing, IReadOnlyDictionary<string, Mob> mobs)
    {
        ArgumentNullException.ThrowIfNull(mobs);
        if (standing?.MobTiers is not [int lowest, int highest]) return TableOf(floor);
        bool Fits(string id) => mobs.TryGetValue(id, out Mob? mob) && mob.File.Tier >= lowest && mob.File.Tier <= highest;
        List<string> own = [.. TableOf(floor).Where(Fits)];
        return own.Count > 0 ? own : [.. Tables.SelectMany(table => table).Where(Fits).Distinct(StringComparer.Ordinal)];
    }

    /// <summary>How the dungeon is dealt to a character of this standing (<see cref="Standings.Of"/>): null as written.</summary>
    public DungeonStanding? StandingOf(string? standing) => standing is null ? null : File.Standing.GetValueOrDefault(standing);

    public bool IsTower => File.Theme == "tower";
}
