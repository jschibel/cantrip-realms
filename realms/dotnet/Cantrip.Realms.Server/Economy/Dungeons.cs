using System.Globalization;
using System.Text.Json;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// Dungeon runs and waystones (design.md A6; interfaces.md, "Dungeons" and the <c>/api/dungeon</c> and <c>/api/waystone</c>
/// calls). A dungeon is a tournament: entering it from beside its entrance begins a single-player run - a seed for the
/// browser's layout, and every encounter of every floor drawn at once: each floor but the last a round, its challengers'
/// count from the dungeon's range and each mob from its floor's table, and the last floor the boss's hall, the boss alone -
/// so the server checks each duel of the run against what it named. A round's gate down opens once all its challengers but
/// one are beaten (<see cref="WinsToOpen"/>); the rest still fight and pay. Leaving, or losing the last heart in any duel of
/// the run, ends it. A mage tower's waystone, attuned by beating its boss (<see cref="Encounters"/>), takes the character
/// from one attuned tower to another at once. A boss beaten rests for a week (design.md A6: refought weekly): a run begun meanwhile finds its last
/// floor without it, and the run says when it is back. A live run is what a character resumes (<see cref="Current"/>):
/// the floor reached and the fights won stay with it until it ends. Now and then a run holds a shrine on one of its floors
/// (<see cref="ShrineChance"/>, rolled as it begins): praying at it gives back a heart, once in the run, which the
/// <c>chests</c> table records as the run's find (<see cref="Shrine"/>).
/// </summary>
public sealed class Dungeons(RealmDb db, RealmContent content, Characters characters, Hearts hearts, RealmDice dice, TimeProvider time, DevVerdicts devVerdicts)
{
    private static readonly JsonSerializerOptions Json = new();

    /// <summary>The chance a run holds a shrine (design.md A6): one run in eight, on one of its floors drawn at random.</summary>
    public const double ShrineChance = 1.0 / 8;

    /// <summary>A run's shrine as the <c>chests</c> table names the find, in the run's space.</summary>
    public const string Shrine = "shrine";

    /// <summary>How long a beaten boss rests before it can be fought again (design.md A6: bosses are refought weekly).</summary>
    public static TimeSpan BossRest { get; } = TimeSpan.FromDays(7);

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

        // A color's dungeon is dealt by where its color stands to the character's (design.md A6).
        DungeonStanding? standing = dungeon.StandingOf(Standings.Of(dungeon.File.Region, row.Color, await characters.Identity(player).ConfigureAwait(false)));
        List<RunFloor> floors = Roll(dungeon, standing);
        RestingView? resting = await Resting(player, dungeon).ConfigureAwait(false);
        if (resting is not null)
        {
            // The boss rests: the last floor holds no boss this run.
            floors[^1] = floors[^1] with { Boss = null, BossStats = null };
        }

        // A shrine, now and then, on one of the floors.
        if (devVerdicts.ShrineRoll(player) ?? dice.Roll(ShrineChance))
        {
            int at = dice.Below(floors.Count);
            floors[at] = floors[at] with { Shrine = true };
        }

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

        return new RunView(run.Id, run.Seed, floors, dungeon.Id, 0, [], resting, TierOf(dungeon, floors));
    }

    /// <summary>A run's tier: the one its floors were dealt at, else its dungeon's.</summary>
    private static int TierOf(RealmDungeon? dungeon, IReadOnlyList<RunFloor> floors) =>
        floors.Count > 0 && floors[0].Tier is int dealt ? dealt : dungeon?.File.Tier ?? 0;

    /// <summary>
    /// The character's live run, to resume it (a reload, a return): its floors as they began, the floor reached, the
    /// encounters won, and the boss that rests. 404 <c>NotThere</c> with none.
    /// </summary>
    public async Task<RunView> Current(string player)
    {
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        RunRow run = await db.Runs.AsNoTracking().Where(stored => stored.PlayerId == player && stored.State == RunRow.Live).OrderByDescending(stored => stored.StartedAt).FirstOrDefaultAsync().ConfigureAwait(false)
            ?? throw Refusal.NotFound(Codes.NotThere, "You are in no dungeon run.");
        string space = RealmContent.RunSpace(run.Id);
        if (row.Space != space) throw Refusal.NotFound(Codes.NotThere, "You are in no dungeon run.");
        List<RunFloor> floors = FloorsOf(run);
        List<string> beaten = [.. (await db.Duels.AsNoTracking().Where(duel => duel.PlayerId == player && duel.Space == space && (duel.State == DuelRow.Won || duel.State == DuelRow.Looted))
            .Select(duel => duel.Spawn).ToListAsync().ConfigureAwait(false)).Order(StringComparer.Ordinal)];
        RealmDungeon? dungeon = content.Dungeons.GetValueOrDefault(run.Dungeon);
        RestingView? resting = dungeon is not null && floors.Count > 0 && floors[^1].Boss is null
            ? await Resting(player, dungeon).ConfigureAwait(false)
            : null;
        bool prayed = await db.Chests.AnyAsync(stored => stored.PlayerId == player && stored.Space == space && stored.Chest == Shrine).ConfigureAwait(false);
        return new RunView(run.Id, run.Seed, floors, run.Dungeon, run.Floor, beaten, resting, TierOf(dungeon, floors), prayed);
    }

    /// <summary>
    /// Prays at the shrine of the floor the character stands on (<c>POST /api/dungeon/shrine</c>): a heart given back, once
    /// in the run. 409 <c>NotThere</c> for a floor with no shrine (or a run over), <c>Empty</c> once it has given its heart,
    /// <c>FullHearts</c> (and the shrine left for later) when their hearts are full, <c>NotNear</c> out of the run; 404
    /// <c>NotThere</c> for no such run. The browser lays the floor out and the server does not walk it, so it holds the
    /// character to the floor, as it does an encounter.
    /// </summary>
    public async Task<ShrineView> Pray(string player, ShrineUse request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        RunRow run = await Live(player, request.Run).ConfigureAwait(false);
        string space = RealmContent.RunSpace(run.Id);
        if (row.Space != space) throw Refusal.Conflict(Codes.NotNear, "You are not in that run.");
        List<RunFloor> floors = FloorsOf(run);
        if (run.Floor >= floors.Count || !floors[run.Floor].Shrine) throw Refusal.Conflict(Codes.NotThere, "There is no shrine on this floor.");

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            if (await db.Chests.AnyAsync(stored => stored.PlayerId == player && stored.Space == space && stored.Chest == Shrine).ConfigureAwait(false))
            {
                throw Refusal.Conflict(Codes.Empty, "The shrine has given its blessing this run.");
            }

            // Taken first (two prayers at once meet the table's key), then the heart, or nothing.
            db.Chests.Add(new ChestRow { PlayerId = player, Space = space, Chest = Shrine, OpenedAt = Now });
            await db.SaveChangesAsync().ConfigureAwait(false);
            if (!await hearts.Grant(player).ConfigureAwait(false))
            {
                throw Refusal.Conflict(Codes.FullHearts, "Your hearts are full. The shrine's blessing will keep.");
            }

            await transaction.CommitAsync().ConfigureAwait(false);
        }

        db.ChangeTracker.Clear();
        return new ShrineView(await db.Players.AsNoTracking().Where(stored => stored.Id == player).Select(stored => stored.Hearts).SingleAsync().ConfigureAwait(false));
    }

    /// <summary>
    /// Whether a dungeon's boss rests for this character: a boss (<c>"boss": true</c>) they have beaten within
    /// <see cref="BossRest"/>, and when it is back. Other mobs that end a dungeon (a mage, a wanderer) never rest.
    /// </summary>
    public async Task<RestingView?> Resting(string player, RealmDungeon dungeon)
    {
        ArgumentNullException.ThrowIfNull(dungeon);
        string boss = dungeon.File.Boss;
        if (!content.Mobs.TryGetValue(boss, out Mob? mob) || !mob.File.Boss) return null;
        long? last = await db.Duels.AsNoTracking()
            .Where(duel => duel.PlayerId == player && duel.Mob == boss && (duel.State == DuelRow.Won || duel.State == DuelRow.Looted))
            .MaxAsync(duel => duel.FinishedAt).ConfigureAwait(false);
        if (last is not long won) return null;
        DateTimeOffset until = DateTimeOffset.FromUnixTimeMilliseconds(won) + BossRest;
        return until > time.GetUtcNow() ? new RestingView(boss, until) : null;
    }

    /// <summary>
    /// A run's encounters, drawn as it begins: so many floors, each but the last a round of so many challengers of its
    /// table's mobs, and the last the boss's hall, the boss alone. A standing (design.md A6) deals every floor at its tier,
    /// draws the rounds' mobs from its tiers alone and gives the boss what it gains; none deals the dungeon as written.
    /// </summary>
    public List<RunFloor> Roll(RealmDungeon dungeon, DungeonStanding? standing = null)
    {
        ArgumentNullException.ThrowIfNull(dungeon);
        DungeonFile file = dungeon.File;
        int count = (int)dice.Between(file.Floors[0], file.Floors[1]);
        List<RunFloor> floors = [];
        for (int floor = 0; floor < count; floor++)
        {
            bool hall = floor == count - 1;
            IReadOnlyList<string> table = hall ? [] : dungeon.TableOf(floor, standing, content.Mobs);
            int challengers = table.Count == 0 ? 0 : (int)dice.Between(file.Encounters[0], file.Encounters[1]);
            floors.Add(new RunFloor(
                [.. Enumerable.Range(0, challengers).Select(index => new RunEncounter(index, table[dice.Below(table.Count)]))],
                hall ? file.Boss : null,
                standing?.Tier,
                hall && standing is not null && standing.BossStats != GearStats.None ? standing.BossStats : null));
        }

        return floors;
    }

    /// <summary>
    /// What a boss gains over its own stats when a character of this starting color and identity fights it in its
    /// dungeon (design.md A6: an enemy color's boss is stronger): its color dungeon's standing's, as <see cref="Roll"/> deals
    /// it; null for a boss of no color dungeon, a standing that gives it nothing, or any other mob. What the balance lab
    /// deals a boss with (Cantrip.Realms.Balance), so its duels are the server's.
    /// </summary>
    public static GearStats? BossGains(RealmContent content, Mob mob, string startingColor, string identity)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(mob);
        if (!mob.File.Boss) return null;
        RealmDungeon? home = content.Dungeons.Values.Where(dungeon => dungeon.File.Boss == mob.Id && dungeon.File.Standing.Count > 0)
            .OrderBy(dungeon => dungeon.Id, StringComparer.Ordinal).FirstOrDefault();
        GearStats? gains = home?.StandingOf(Standings.Of(home.File.Region, startingColor, identity))?.BossStats;
        return gains is null || gains == GearStats.None ? null : gains;
    }

    /// <summary>
    /// Takes the gate down to the next floor, once the round the character stands in is won: <see cref="WinsToOpen"/> of its
    /// challengers beaten. 409 <c>RoundOpen</c> before.
    /// </summary>
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

        RunFloor round = floors[run.Floor];
        int need = WinsToOpen(round.Encounters.Count);
        List<string> challengers = [.. round.Encounters.Select(encounter => EncounterId(run.Floor, encounter.Index))];
        int beaten = await db.Duels.CountAsync(duel => duel.PlayerId == player && duel.Space == space && challengers.Contains(duel.Spawn) && (duel.State == DuelRow.Won || duel.State == DuelRow.Looted)).ConfigureAwait(false);
        if (beaten < need)
        {
            throw Refusal.Conflict(Codes.RoundOpen, $"Beat {need} of the {round.Encounters.Count} challengers to open the gate.");
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
            .Where(tile => world.CanStep(entrance, tile, hops: false) && !world.Entrances.ContainsKey(tile) && !world.Doors.ContainsKey(tile))
            .Cast<Tile?>().FirstOrDefault() ?? entrance;
    }

    /// <summary>
    /// Ends a player's live run, if they have one. A game of it lost and not yet answered (design.md A3: fought again, a
    /// dungeon's mob being never paid off) is over with it: lost.
    /// </summary>
    private async Task End(string player, string detail)
    {
        List<string> spaces = [.. (await db.Runs.Where(run => run.PlayerId == player && run.State == RunRow.Live).Select(run => run.Id).ToListAsync().ConfigureAwait(false))
            .Select(RealmContent.RunSpace)];
        await db.Duels.Where(duel => duel.PlayerId == player && spaces.Contains(duel.Space) && duel.State == DuelRow.Defeated)
            .ExecuteUpdateAsync(set => set.SetProperty(duel => duel.State, DuelRow.Lost)).ConfigureAwait(false);
        await db.Runs.Where(run => run.PlayerId == player && run.State == RunRow.Live).ExecuteUpdateAsync(set => set
            .SetProperty(run => run.State, RunRow.Ended)
            .SetProperty(run => run.EndedAt, Now)
            .SetProperty(run => run.Detail, detail)).ConfigureAwait(false);
    }

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

    /// <summary>
    /// How many of a round's challengers open its gate (design.md A6): all but one, at least one - two of three. A floor with
    /// none has its gate open.
    /// </summary>
    public static int WinsToOpen(int challengers) => challengers <= 0 ? 0 : Math.Max(1, challengers - 1);

    /// <summary>The index of a floor's boss: past its encounters' (the hall has none, so 0).</summary>
    public static int BossIndex(RunFloor floor) => floor?.Encounters.Count ?? throw new ArgumentNullException(nameof(floor));

    /// <summary>The mob of a floor's encounter or its boss, by index; null for none.</summary>
    public static string? MobAt(RunFloor floor, int index)
    {
        ArgumentNullException.ThrowIfNull(floor);
        return index >= 0 && index < floor.Encounters.Count ? floor.Encounters[index].Mob
            : index == BossIndex(floor) ? floor.Boss
            : null;
    }

    /// <summary>The key a run's encounter is fought under: <c>&lt;floor&gt;:&lt;index&gt;</c>.</summary>
    public static string EncounterId(int floor, int index) => string.Create(CultureInfo.InvariantCulture, $"{floor}:{index}");
}
