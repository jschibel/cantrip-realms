using System.Globalization;
using System.Text.Json;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// Dungeon runs and waystones (design.md A6; interfaces.md, "Dungeons" and the <c>/api/dungeon</c> and <c>/api/waystone</c>
/// calls). Entering a dungeon from beside its entrance begins a single-player run: a seed for the browser's layout, and
/// every encounter of every floor drawn at once - each floor's count from the dungeon's range and each mob from its floor's
/// table, the warden at every stair, the boss on the last floor - so the server checks each duel of the run against what
/// it named. The stair down opens once its warden is beaten; leaving, or losing any duel of the run, ends it. A mage
/// tower's waystone, attuned by beating its boss (<see cref="Encounters"/>), takes the character from one attuned tower to
/// another at once.
/// </summary>
public sealed class Dungeons(RealmDb db, RealmContent content, Characters characters, RealmDice dice, TimeProvider time)
{
    private static readonly JsonSerializerOptions Json = new();

    private long Now => time.GetUtcNow().ToUnixTimeMilliseconds();

    /// <summary>Begins a run of a dungeon, ending any run of the character's still live.</summary>
    public async Task<RunView> Enter(string player, DungeonEnter request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        RealmDungeon dungeon = content.Dungeons.GetValueOrDefault(request.Dungeon ?? string.Empty)
            ?? throw Refusal.NotFound(Codes.NotThere, $"There is no dungeon '{request.Dungeon}'.");
        if (!Characters.Beside(row, dungeon.File.At)) throw Refusal.Conflict(Codes.NotNear, $"{dungeon.File.Name} is entered at its entrance.");
        await characters.RequireOpen(player, dungeon).ConfigureAwait(false);

        List<RunFloor> floors = Roll(dungeon);
        var run = new RunRow
        {
            Id = RealmDice.Token(),
            PlayerId = player,
            Dungeon = dungeon.Id,
            Seed = dice.Seed(),
            Floors = JsonSerializer.Serialize(floors, Json),
            Floor = 0,
            State = RunRow.Live,
            StartedAt = Now,
        };

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            await End(player, "Another run began.").ConfigureAwait(false);
            db.Runs.Add(run);
            await db.SaveChangesAsync().ConfigureAwait(false);
            await characters.Place(player, RealmContent.RunSpace(run.Id), new Tile(0, 0)).ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return new RunView(run.Id, run.Seed, floors);
    }

    /// <summary>
    /// A run's encounters, drawn as it begins: so many floors, each with so many encounters of its table's mobs, the warden
    /// at each floor's stair but the last's, and the boss on the last.
    /// </summary>
    public List<RunFloor> Roll(RealmDungeon dungeon)
    {
        ArgumentNullException.ThrowIfNull(dungeon);
        DungeonFile file = dungeon.File;
        int count = (int)dice.Between(file.Floors[0], file.Floors[1]);
        List<RunFloor> floors = [];
        for (int floor = 0; floor < count; floor++)
        {
            IReadOnlyList<string> table = dungeon.TableOf(floor);
            int encounters = table.Count == 0 ? 0 : (int)dice.Between(file.Encounters[0], file.Encounters[1]);
            bool last = floor == count - 1;
            floors.Add(new RunFloor(
                [.. Enumerable.Range(0, encounters).Select(index => new RunEncounter(index, table[dice.Below(table.Count)]))],
                last ? null : file.Warden,
                last ? file.Boss : null));
        }

        return floors;
    }

    /// <summary>Takes the stair to the next floor, once the warden of the floor the character stands on is beaten.</summary>
    public async Task Floor(string player, FloorTake request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        RunRow run = await Live(player, request.Run).ConfigureAwait(false);
        string space = RealmContent.RunSpace(run.Id);
        if (row.Space != space) throw Refusal.Conflict(Codes.NotNear, "You are not in that run.");
        List<RunFloor> floors = FloorsOf(run);
        if (request.Floor != run.Floor + 1 || request.Floor >= floors.Count)
        {
            throw Refusal.Conflict(Codes.NoWay, $"From floor {run.Floor} the stair leads to floor {run.Floor + 1}{(run.Floor + 1 >= floors.Count ? ", and this is the last" : string.Empty)}.");
        }

        string warden = EncounterId(run.Floor, WardenIndex(floors[run.Floor]));
        if (!await db.Duels.AnyAsync(duel => duel.PlayerId == player && duel.Space == space && duel.Spawn == warden && (duel.State == DuelRow.Won || duel.State == DuelRow.Looted)).ConfigureAwait(false))
        {
            throw Refusal.Conflict(Codes.WardenStands, $"{content.Mobs.GetValueOrDefault(floors[run.Floor].Warden ?? string.Empty)?.File.Name ?? "The warden"} keeps the stair.");
        }

        if (await db.Runs.Where(stored => stored.Id == run.Id && stored.State == RunRow.Live && stored.Floor == run.Floor)
            .ExecuteUpdateAsync(set => set.SetProperty(stored => stored.Floor, request.Floor)).ConfigureAwait(false) != 1)
        {
            throw Refusal.Conflict(Codes.NoWay, "The run moved on meanwhile.");
        }
    }

    /// <summary>Leaves a run: it ends, and the character stands beside its entrance in the world.</summary>
    public async Task Leave(string player, RunLeave request)
    {
        ArgumentNullException.ThrowIfNull(request);
        await characters.Require(player).ConfigureAwait(false);
        RunRow run = await Live(player, request.Run).ConfigureAwait(false);
        await using var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false);
        await End(player, "Left.").ConfigureAwait(false);
        if (content.Dungeons.TryGetValue(run.Dungeon, out RealmDungeon? dungeon))
        {
            await characters.Place(player, RealmContent.WorldSpace, Outside(dungeon)).ConfigureAwait(false);
        }
        else
        {
            await characters.ToInn(player).ConfigureAwait(false);
        }

        await transaction.CommitAsync().ConfigureAwait(false);
    }

    /// <summary>
    /// Travels by waystone: from the attuned mage tower the character stands beside, at once, to another attuned tower's,
    /// beside its entrance.
    /// </summary>
    public async Task<WaystoneView> Travel(string player, WaystoneTravel request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        RealmDungeon to = content.Dungeons.GetValueOrDefault(request.Tower ?? string.Empty) is { File.Waystone: true } tower
            ? tower
            : throw Refusal.NotFound(Codes.NotThere, $"There is no mage tower '{request.Tower}' with a waystone.");
        RealmDungeon from = content.Dungeons.Values.Where(dungeon => dungeon.File.Waystone && AtWaystone(row, dungeon)).OrderBy(dungeon => dungeon.Id, StringComparer.Ordinal).FirstOrDefault()
            ?? throw Refusal.Conflict(Codes.NotNear, "A waystone is used standing at it, beside a mage tower's door.");
        HashSet<string> attuned = [.. await db.Attuned.Where(stored => stored.PlayerId == player).Select(stored => stored.Tower).ToListAsync().ConfigureAwait(false)];
        foreach (RealmDungeon end in new[] { from, to }.Where(end => !attuned.Contains(end.Id)))
        {
            throw Refusal.Conflict(Codes.NotAttuned, $"{end.File.Name}'s waystone is not attuned to you: beat its mage first.");
        }

        Tile at = Outside(to);
        await characters.Place(player, RealmContent.WorldSpace, at).ConfigureAwait(false);
        return new WaystoneView(new PlaceView(RealmContent.WorldSpace, at.X, at.Z));
    }

    /// <summary>
    /// Whether a character stands at a tower's waystone: in the world on or beside one of its <c>waystone</c> NPCs' tiles
    /// (the client talks to an NPC from any tile round it), or on or beside the tower's entrance.
    /// </summary>
    private bool AtWaystone(PlayerRow row, RealmDungeon tower) =>
        Characters.Beside(row, tower.File.At) || content.World.WaystonesOf(tower.Id).Any(at => Characters.Beside(row, at));

    /// <summary>
    /// Where a character stands coming out of a dungeon or a waystone: the first tile a step from its entrance (in
    /// <see cref="Tile.Steps"/>'s order: south, east, west, north, then the diagonals) that is no door or entrance itself,
    /// else the entrance.
    /// </summary>
    public Tile Outside(RealmDungeon dungeon)
    {
        ArgumentNullException.ThrowIfNull(dungeon);
        Tile entrance = dungeon.File.At;
        RealmWorld world = content.World;
        return Tile.Steps.Select(entrance.Plus)
            .Where(tile => world.CanStep(entrance, tile) && !world.Entrances.ContainsKey(tile) && !world.Doors.ContainsKey(tile))
            .Cast<Tile?>().FirstOrDefault() ?? entrance;
    }

    /// <summary>Ends a player's live run, if they have one.</summary>
    private Task End(string player, string detail) =>
        db.Runs.Where(run => run.PlayerId == player && run.State == RunRow.Live).ExecuteUpdateAsync(set => set
            .SetProperty(run => run.State, RunRow.Ended)
            .SetProperty(run => run.EndedAt, Now)
            .SetProperty(run => run.Detail, detail));

    private async Task<RunRow> Live(string player, string? id)
    {
        RunRow run = await db.Runs.AsNoTracking().SingleOrDefaultAsync(stored => stored.Id == id && stored.PlayerId == player).ConfigureAwait(false)
            ?? throw Refusal.NotFound(Codes.NotThere, "You have no such dungeon run.");
        return run.State == RunRow.Live ? run : throw Refusal.Conflict(Codes.NotThere, "That run is over.");
    }

    /// <summary>A run's floors, as it began.</summary>
    public static List<RunFloor> FloorsOf(RunRow run)
    {
        ArgumentNullException.ThrowIfNull(run);
        return JsonSerializer.Deserialize<List<RunFloor>>(run.Floors, Json) ?? [];
    }

    /// <summary>The index of a floor's warden: the count of its encounters.</summary>
    public static int WardenIndex(RunFloor floor) => floor?.Encounters.Count ?? throw new ArgumentNullException(nameof(floor));

    /// <summary>The index of a floor's boss: one past its encounters'.</summary>
    public static int BossIndex(RunFloor floor) => (floor?.Encounters.Count ?? throw new ArgumentNullException(nameof(floor))) + 1;

    /// <summary>The mob of a floor's encounter, its warden or its boss, by index; null for none.</summary>
    public static string? MobAt(RunFloor floor, int index)
    {
        ArgumentNullException.ThrowIfNull(floor);
        return index >= 0 && index < floor.Encounters.Count ? floor.Encounters[index].Mob
            : index == WardenIndex(floor) ? floor.Warden
            : index == BossIndex(floor) ? floor.Boss
            : null;
    }

    /// <summary>The key a run's encounter is fought under: <c>&lt;floor&gt;:&lt;index&gt;</c>.</summary>
    public static string EncounterId(int floor, int index) => string.Create(CultureInfo.InvariantCulture, $"{floor}:{index}");
}
