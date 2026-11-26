using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Presence;

namespace Cantrip.Realms.Server.Economy;

/// <summary>What a find of the wilds is: a treasure chest (design.md A5) or a heartbloom (A3b).</summary>
public enum FindKind
{
    Chest,
    Heartbloom,
}

/// <summary>
/// A find standing in the world's wilds now: its id, kind and tile, the tier of the zone it stands in (a chest's gold is
/// that tier's, <see cref="Finds.GoldOf"/>), and when it appeared and when it goes if nobody takes it (Unix ms).
/// </summary>
public sealed record Find(string Id, FindKind Kind, Tile At, int Tier, long Since, long Until)
{
    /// <summary>A chest's gold, the least and the most; none for a heartbloom.</summary>
    public IReadOnlyList<long> Gold => Kind == FindKind.Chest ? Finds.GoldOf(Tier) : [];
}

/// <summary>
/// The finds of the wilds (design.md A5, A3b): nothing kept in the world's files, they come and go. Treasure chests spawn
/// in each tier zone of the wilds - at most <see cref="FindOptions.ChestsPerZone"/> at once, a new one about every
/// <see cref="FindOptions.ChestEvery"/> while a zone has fewer - and crumble after <see cref="FindOptions.ChestLasts"/>
/// unopened. Heartblooms grow anywhere in the wilds, at most <see cref="FindOptions.Heartblooms"/> at once and
/// <see cref="HeartbloomApart"/> tiles from each other, one about every <see cref="FindOptions.HeartbloomEvery"/>,
/// wilting after <see cref="FindOptions.HeartbloomLasts"/>. A find stands on a random open tile of the wilds with open,
/// level ground all round - never on worked ground (a road, a field), in a town, near a door, a way in, a person or a
/// spawn point, near another find, or where a player stands - and is everyone's: the first to take it has it, and it is
/// gone for all (<see cref="Take"/>). The world moves on when it is asked (<see cref="Live"/>), on the injected clock; the
/// finds are kept in memory, so a server started anew grows its own.
/// </summary>
public sealed class Finds(RealmContent content, RealmOptions options, TimeProvider time, PresenceHub presence, Random? random = null)
{
    /// <summary>How near another find, in tiles (Chebyshev), a find never spawns.</summary>
    public const int Apart = 8;

    /// <summary>How near another heartbloom one never grows (design.md A3b: far apart, so the far ones are worth the walk).</summary>
    public const int HeartbloomApart = 150;

    /// <summary>How near a player a find never spawns, tiles: none appears underfoot.</summary>
    public const int AwayFromPlayers = 4;

    /// <summary>How near a door, a way in, a person or a spawn point a find never spawns, tiles.</summary>
    public const int AwayFromPlaces = 3;

    /// <summary>How many tiles a spawn tries before it waits for its next turn.</summary>
    private const int Tries = 64;

    /// <summary>A treasure chest's gold by its zone's tier (design.md A5: 50 to 500 gold, richer the harder the wilds).</summary>
    public static IReadOnlyList<long> GoldOf(int tier) => tier switch
    {
        <= 1 => [50, 150],
        2 => [100, 250],
        3 => [180, 380],
        _ => [300, 500],
    };

    private readonly Random _random = random ?? new Random();
    private readonly object _gate = new();
    private readonly Dictionary<string, Find> _live = new(StringComparer.Ordinal);
    private readonly Dictionary<int, long> _nextChest = [];
    private long? _nextBloom;
    private Dictionary<int, List<(int Col, int Row)>>? _cells;
    private HashSet<Tile>? _kept;

    private FindOptions Rules => options.Finds;

    private RealmWorld World => content.World;

    private long Now => time.GetUtcNow().ToUnixTimeMilliseconds();

    /// <summary>The finds standing now, the world moved on to now first.</summary>
    public IReadOnlyList<Find> Live()
    {
        lock (_gate)
        {
            Advance(Now);
            return [.. _live.Values.OrderBy(find => find.Id, StringComparer.Ordinal)];
        }
    }

    /// <summary>A find standing now, or null: taken, gone, or never one.</summary>
    public Find? Get(string id)
    {
        lock (_gate)
        {
            Advance(Now);
            return _live.GetValueOrDefault(id);
        }
    }

    /// <summary>Takes a find: true for the first to ask, and it is gone for everyone; false when it is gone already.</summary>
    public bool Take(Find find)
    {
        ArgumentNullException.ThrowIfNull(find);
        lock (_gate)
        {
            Advance(Now);
            return _live.TryGetValue(find.Id, out Find? standing) && standing == find && _live.Remove(find.Id);
        }
    }

    /// <summary>Puts back a find taken that could not be had (a heartbloom whose picker's hearts were full after all).</summary>
    public void PutBack(Find find)
    {
        ArgumentNullException.ThrowIfNull(find);
        lock (_gate)
        {
            if (find.Until > Now) _live.TryAdd(find.Id, find);
        }
    }

    /// <summary>Stands a find on a tile of the world now, whatever the rules (a development server's <c>POST /dev/find</c>).</summary>
    public Find Place(FindKind kind, Tile at)
    {
        lock (_gate)
        {
            Advance(Now);
            return Add(kind, at, Now);
        }
    }

    /// <summary>Whether a find may be stood on a tile at all: an open tile of the world.</summary>
    public bool CanStand(Tile at) => World.Walkable(at);

    /// <summary>Takes away every find standing (a development server's, before a test places its own).</summary>
    public void Clear()
    {
        lock (_gate) _live.Clear();
    }

    private Find Add(FindKind kind, Tile at, long now)
    {
        int zone = World.ZoneOf(at);
        int tier = zone >= 0 ? World.File.Zones!.Areas[zone].Tier : 0;
        TimeSpan lasts = kind == FindKind.Chest ? Rules.ChestLasts : Rules.HeartbloomLasts;
        string id = $"{(kind == FindKind.Chest ? "chest" : "bloom")}-{Guid.NewGuid():N}"[..18];
        var find = new Find(id, kind, at, tier, now, now + (long)lasts.TotalMilliseconds);
        _live[id] = find;
        return find;
    }

    /// <summary>
    /// The world moved on to a moment: what has stood its time is gone, and each zone whose turn has come, and the
    /// heartblooms' when theirs has, spawns one if it has fewer than its most (a turn is the time apart, give or take half).
    /// </summary>
    private void Advance(long now)
    {
        foreach (Find gone in _live.Values.Where(find => find.Until <= now).ToList()) _live.Remove(gone.Id);
        _cells ??= Cells();
        List<Point>? players = null;
        IReadOnlyList<Point> Players() => players ??= [.. presence.Everyone(RealmContent.WorldSpace)];

        if (Rules.ChestsPerZone > 0)
        {
            foreach ((int zone, List<(int Col, int Row)> cells) in _cells)
            {
                if (!_nextChest.TryGetValue(zone, out long next))
                {
                    _nextChest[zone] = now + Spread(Rules.ChestEvery, 0, 1);
                    continue;
                }

                if (next > now) continue;
                _nextChest[zone] = now + Spread(Rules.ChestEvery, 0.5, 1.5);
                if (_live.Values.Count(find => find.Kind == FindKind.Chest && World.ZoneOf(find.At) == zone) >= Rules.ChestsPerZone) continue;
                if (Spot(FindKind.Chest, cells, Players()) is { } at) Add(FindKind.Chest, at, now);
            }
        }

        if (Rules.Heartblooms > 0)
        {
            if (_nextBloom is null)
            {
                _nextBloom = now + Spread(Rules.HeartbloomEvery, 0, 1);
            }
            else if (_nextBloom <= now)
            {
                _nextBloom = now + Spread(Rules.HeartbloomEvery, 0.5, 1.5);
                if (_live.Values.Count(find => find.Kind == FindKind.Heartbloom) < Rules.Heartblooms
                    && Spot(FindKind.Heartbloom, [.. _cells.Values.SelectMany(cells => cells)], Players()) is { } at)
                {
                    Add(FindKind.Heartbloom, at, now);
                }
            }
        }
    }

    private long Spread(TimeSpan every, double least, double most) => (long)(every.TotalMilliseconds * (least + (_random.NextDouble() * (most - least))));

    /// <summary>A tile for a find among cells of the zones, by the rules the summary gives, or null if none was met in a few tries.</summary>
    private Tile? Spot(FindKind kind, List<(int Col, int Row)> cells, IReadOnlyList<Point> players)
    {
        if (cells.Count == 0 || World.File.Zones is not { } zones) return null;
        _kept ??= Kept();
        for (int attempt = 0; attempt < Tries; attempt++)
        {
            (int col, int row) = cells[_random.Next(cells.Count)];
            var at = new Tile(World.X0 + (col * zones.Cell) + _random.Next(zones.Cell), World.Z0 + (row * zones.Cell) + _random.Next(zones.Cell));
            if (!World.Walkable(at) || World.IsWorked(at) || _kept.Contains(at) || content.TownAt(at) is not null) continue;
            // Level all round: every tile round a step with no hop (realms/web/src/world/finds.ts, noLedge).
            if (!Tile.Steps.All(step => World.CanStep(at, at.Plus(step), hops: false))) continue;
            if (_live.Values.Any(find => find.At.DistanceTo(at) < (kind == FindKind.Heartbloom && find.Kind == FindKind.Heartbloom ? HeartbloomApart : Apart))) continue;
            if (players.Any(player => player.Tile.DistanceTo(at) < AwayFromPlayers)) continue;
            return at;
        }

        return null;
    }

    /// <summary>The cells of each zone of the wilds (a tier above 0), by the zone's index.</summary>
    private Dictionary<int, List<(int Col, int Row)>> Cells()
    {
        Dictionary<int, List<(int Col, int Row)>> cells = [];
        if (World.File.Zones is not { } zones) return cells;
        for (int row = 0; row < zones.Grid.Count; row++)
        {
            for (int col = 0; col < zones.Grid[row].Count; col++)
            {
                int zone = zones.Grid[row][col];
                if (zone < 0 || zone >= zones.Areas.Count || zones.Areas[zone].Tier <= 0) continue;
                if (!cells.TryGetValue(zone, out List<(int Col, int Row)>? list)) cells[zone] = list = [];
                list.Add((col, row));
            }
        }

        return cells;
    }

    /// <summary>The tiles near a door, a way in, a person or a spawn point, where no find spawns.</summary>
    private HashSet<Tile> Kept()
    {
        HashSet<Tile> kept = [];
        IEnumerable<Tile> places = World.Doors.Keys.Concat(World.Entrances.Keys).Concat(World.Npcs.Select(npc => npc.At)).Concat(World.Spawns.Select(spawn => spawn.At));
        foreach (Tile place in places)
        {
            for (int dz = -AwayFromPlaces; dz <= AwayFromPlaces; dz++)
            {
                for (int dx = -AwayFromPlaces; dx <= AwayFromPlaces; dx++) kept.Add(new Tile(place.X + dx, place.Z + dz));
            }
        }

        return kept;
    }
}
