using System.Text.RegularExpressions;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Server;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// Characters (design.md A1): creating one with its starting kit, reading it, its collection, where it stands
/// (interfaces.md, "Places") - a town filling its hearts (<see cref="Hearts"/>) - and the inn it wakes at, and the stats its
/// loadout gives it.
/// </summary>
public sealed partial class Characters(RealmDb db, RealmContent content, RealmOptions options, RealmDice dice, TimeProvider time, Hearts hearts)
{
    /// <summary>The setup values every character starts from (design.md A1).</summary>
    public static GearStats BaseStats { get; } = new(20, 7, 7);

    /// <summary>The gold a new character has.</summary>
    public const long StartingGold = 2000;

    /// <summary>The commons a new character has beside their starter deck.</summary>
    public const int ExtraCommons = 10;

    /// <summary>How many gear items a new character wears.</summary>
    public const int StartingGear = 3;

    /// <summary>The bodies a character is drawn with (realms/web/src/character.ts), as the API names them; stored by index.</summary>
    public static IReadOnlyList<string> BodyNames { get; } = ["lithe", "broad", "tall", "stocky"];

    /// <summary>How many skin and hair palettes a character is drawn with.</summary>
    public const int Palettes = 6;

    /// <summary>A body's name, from its stored index.</summary>
    public static string BodyName(int body) => body >= 0 && body < BodyNames.Count ? BodyNames[body] : BodyNames[0];

    [GeneratedRegex(@"^[\p{L}\p{N}][\p{L}\p{N} '\-]{0,22}[\p{L}\p{N}]$")]
    private static partial Regex NamePattern();

    public long Now => time.GetUtcNow().ToUnixTimeMilliseconds();

    /// <summary>A player's character, or a refusal that they have none.</summary>
    public async Task<PlayerRow> Require(string player) =>
        await db.Players.SingleOrDefaultAsync(row => row.Id == player).ConfigureAwait(false)
            ?? throw Refusal.NotFound(Codes.NoCharacter, "You have no character yet.");

    /// <summary>Creates a player's character with the starting kit (design.md A1).</summary>
    public async Task<CharacterView> Create(string player, NewCharacter request)
    {
        ArgumentNullException.ThrowIfNull(request);
        string name = request.Name?.Trim() ?? string.Empty;
        if (!NamePattern().IsMatch(name)) throw Refusal.BadRequest("A name is 2 to 24 letters, digits, spaces, hyphens and apostrophes.");
        int body = request.Body is { } named ? BodyNames.ToList().IndexOf(named) : -1;
        if (body < 0) throw Refusal.BadRequest($"A body is one of {string.Join(", ", BodyNames)}.");
        if (request.Palette is < 0 or >= Palettes) throw Refusal.BadRequest($"A palette is 0 to {Palettes - 1}.");
        string color = request.Color?.Trim().ToUpperInvariant() ?? string.Empty;
        if (!RealmContent.StarterFiles.ContainsKey(color)) throw Refusal.BadRequest("A starting color is one of W, U, B, R and G.");
        if (await db.Players.AnyAsync(row => row.Id == player).ConfigureAwait(false)) throw Refusal.Conflict(Codes.HasCharacter, "You already have a character.");

        InnEntry inn = TownInn(options.StartTown) ?? throw new InvalidOperationException($"The start town '{options.StartTown}' has no inn in the world.");
        DeckList starter = content.Starters[content.World.Plane][color];
        long now = Now;

        db.Players.Add(new PlayerRow
        {
            Id = player,
            Name = name,
            Body = body,
            Palette = request.Palette,
            Color = color,
            Gold = StartingGold,
            Space = RealmContent.WorldSpace,
            X = inn.X,
            Z = inn.Z,
            PlacedAt = now,
            Inn = inn.Id,
            Hearts = Economy.Hearts.Starting,
            MaxHearts = Economy.Hearts.Starting,
            CreatedAt = now,
        });

        Dictionary<string, int> owned = new(StringComparer.Ordinal);
        foreach (DeckListEntry entry in starter.Entries)
        {
            db.Deck.Add(new DeckRow { PlayerId = player, Name = entry.Card, Count = entry.Copies });
            if (!IsBasic(entry.Card)) owned[entry.Card] = owned.GetValueOrDefault(entry.Card) + entry.Copies;
        }

        var commons = new CardFilter { Colors = color, Rarities = ["common"] };
        List<string> exact = [.. content.Cards.Filter(content.World.Plane, commons).Where(card => content.Cards.Catalog[card].Identity.Count == 1)];
        foreach (string card in dice.Draw(exact, ExtraCommons))
        {
            owned[card] = owned.GetValueOrDefault(card) + 1;
        }

        foreach ((string card, int count) in owned)
        {
            db.Collection.Add(new CollectionRow { PlayerId = player, Name = card, Count = count });
        }

        // Common gear in three slots, with no effects, so the first duels need nothing but the engine.
        List<(string Slot, GearOwnedRow Owned)> kit = [.. StartingKit().Select(pair => (pair.Slot, new GearOwnedRow { PlayerId = player, GearId = pair.Item.Id, AcquiredAt = now }))];
        db.GearOwned.AddRange(kit.Select(pair => pair.Owned));

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            await db.SaveChangesAsync().ConfigureAwait(false);
            db.Loadout.AddRange(kit.Select(pair => new LoadoutRow { PlayerId = player, Slot = pair.Slot, GearInstanceId = pair.Owned.Id }));
            await db.SaveChangesAsync().ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return await View(player).ConfigureAwait(false);
    }

    /// <summary>The kit a new character wears: the first common item without effects of each slot, three slots of them.</summary>
    public IEnumerable<(string Slot, GearItem Item)> StartingKit() => StartingKit(content);

    /// <summary>The starting kit of <paramref name="content"/>'s gear catalogue (<see cref="StartingKit()"/>).</summary>
    public static IEnumerable<(string Slot, GearItem Item)> StartingKit(RealmContent content) =>
        RealmContent.LoadoutSlots
            .Select(slot => (slot.Key, Item: content.Gear.Values
                .Where(item => item.Slot == slot.Value && item.Rarity == "common" && item.Effects.Count == 0 && !item.Unique)
                .OrderBy(item => item.Id, StringComparer.Ordinal)
                .FirstOrDefault()))
            .Where(pair => pair.Item is not null)
            .DistinctBy(pair => pair.Item!.Slot)
            .Take(StartingGear)
            .Select(pair => (pair.Key, pair.Item!));

    /// <summary>A character as its player sees it.</summary>
    public async Task<CharacterView> View(string player)
    {
        // As stored now, whatever this request has read before: a conditional update may have moved it since.
        PlayerRow row = await db.Players.AsNoTracking().SingleOrDefaultAsync(row => row.Id == player).ConfigureAwait(false)
            ?? throw Refusal.NotFound(Codes.NoCharacter, "You have no character yet.");
        List<GearInstance> gear = await Gear(player).ConfigureAwait(false);
        Dictionary<string, GearInstance?> loadout = await Loadout(player, gear).ConfigureAwait(false);
        List<string> unlocked = await db.Unlocks.Where(unlock => unlock.PlayerId == player).Select(unlock => unlock.Color).ToListAsync().ConfigureAwait(false);
        List<string> attuned = await db.Attuned.Where(row => row.PlayerId == player).Select(row => row.Tower).ToListAsync().ConfigureAwait(false);
        DuelRow? defeated = await db.Duels.AsNoTracking().Where(duel => duel.PlayerId == player && duel.State == DuelRow.Defeated)
            .OrderByDescending(duel => duel.FinishedAt).FirstOrDefaultAsync().ConfigureAwait(false);
        return new CharacterView(
            row.Id,
            row.Name,
            BodyName(row.Body),
            row.Palette,
            Identity(row, unlocked),
            row.Gold,
            row.Hearts,
            row.MaxHearts,
            Economy.Hearts.PriceAfter(row.MaxHearts),
            defeated is null ? null : Encounters.Defeat(defeated, row.Hearts, row.MaxHearts),
            row.Space,
            row.X,
            row.Z,
            InnOf(row).Id,
            StatsView.Of(Stats(loadout.Values.OfType<GearInstance>().Select(instance => instance.Gear))),
            loadout,
            gear,
            [.. unlocked.Order(StringComparer.Ordinal)],
            [.. attuned.Order(StringComparer.Ordinal)]);
    }

    /// <summary>A character's color identity: their starting color and every color unlocked, in WUBRG order.</summary>
    public static string Identity(PlayerRow row, IEnumerable<string> unlocked)
    {
        ArgumentNullException.ThrowIfNull(row);
        return CardPool.Letters(CardPool.Identity(row.Color + string.Concat(unlocked)));
    }

    public async Task<string> Identity(string player)
    {
        PlayerRow row = await Require(player).ConfigureAwait(false);
        List<string> unlocked = await db.Unlocks.Where(unlock => unlock.PlayerId == player).Select(unlock => unlock.Color).ToListAsync().ConfigureAwait(false);
        return Identity(row, unlocked);
    }

    /// <summary>The setup values worn items give: the base, and every item's stat lines.</summary>
    public static GearStats Stats(IEnumerable<GearItem> worn) => worn.Aggregate(BaseStats, (stats, item) => stats + item.Stats);

    /// <summary>Every gear item a character owns, oldest first.</summary>
    public async Task<List<GearInstance>> Gear(string player)
    {
        List<GearOwnedRow> rows = await db.GearOwned.AsNoTracking().Where(row => row.PlayerId == player).OrderBy(row => row.Id).ToListAsync().ConfigureAwait(false);
        return [.. rows.Where(row => content.Gear.ContainsKey(row.GearId)).Select(row => new GearInstance(row.Id, content.Gear[row.GearId]))];
    }

    /// <summary>What a character wears in each of the eight slots.</summary>
    public async Task<Dictionary<string, GearInstance?>> Loadout(string player, IReadOnlyList<GearInstance> gear)
    {
        Dictionary<long, GearInstance> byId = gear.ToDictionary(instance => instance.InstanceId);
        List<LoadoutRow> rows = await db.Loadout.AsNoTracking().Where(row => row.PlayerId == player).ToListAsync().ConfigureAwait(false);
        Dictionary<string, GearInstance?> loadout = RealmContent.LoadoutSlots.Keys.ToDictionary(slot => slot, _ => (GearInstance?)null, StringComparer.Ordinal);
        foreach (LoadoutRow row in rows)
        {
            if (loadout.ContainsKey(row.Slot) && byId.TryGetValue(row.GearInstanceId, out GearInstance? instance)) loadout[row.Slot] = instance;
        }

        return loadout;
    }

    /// <summary>
    /// A character's collection, by card name, with each priced card's list price and the relics of it (design.md A3a: never
    /// anted), for the spell table to mark.
    /// </summary>
    public async Task<CollectionView> Collection(string player)
    {
        await Require(player).ConfigureAwait(false);
        List<CollectionRow> rows = await db.Collection.AsNoTracking().Where(row => row.PlayerId == player && row.Count > 0).ToListAsync().ConfigureAwait(false);
        var prices = new SortedDictionary<string, long>(StringComparer.Ordinal);
        foreach (CollectionRow row in rows)
        {
            if (content.Cards.Price(row.Name) is { } gold) prices[row.Name] = gold;
        }

        List<string> relics = [.. rows.Select(row => row.Name).Where(content.Cards.IsRelic).Order(StringComparer.Ordinal)];
        return new CollectionView(new SortedDictionary<string, int>(rows.ToDictionary(row => row.Name, row => row.Count), StringComparer.Ordinal), prices, relics);
    }

    /// <summary>How many tiles past what walking allows a report may be: the character walked on as it was sent.</summary>
    public const int Slack = 2;

    /// <summary>
    /// Records where a character is (<c>POST /api/position</c>, interfaces.md "Places"). A place of the world or an interior
    /// is a tile nobody is kept off, and is reached from the last by walking - no farther, in tiles (<see cref="Tile.Distance"/>,
    /// which no walk of eight-way steps beats), than the walking speed allows in the time since - or through a door: into an
    /// interior from on or beside a door of it, out of one on or beside its exit. A dungeon run is entered and left by its own
    /// calls, and its places are the browser's, so within a live run of theirs any tile is taken; a waystone is travelled by
    /// its own call. A place in a town - within its walls, or in one of its buildings - fills the character's hearts
    /// (design.md A3b), the server's knowledge of where they stand being what it has checked here. Their hearts after it.
    /// </summary>
    public async Task<PositionView> Position(string player, PlaceView request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await Require(player).ConfigureAwait(false);
        var at = new Tile(request.X, request.Z);
        var here = new Tile(row.X, row.Z);
        long now = Now;

        if (RealmContent.RunOf(request.Space) is { } run)
        {
            if (!await db.Runs.AnyAsync(stored => stored.Id == run && stored.PlayerId == player && stored.State == RunRow.Live).ConfigureAwait(false))
            {
                throw Refusal.Unprocessable(Codes.NoSuchPlace, "You are in no such dungeon run.");
            }

            if (row.Space != request.Space) throw Refusal.Conflict(Codes.NoWay, "A dungeon run is entered at its entrance.");
        }
        else
        {
            RealmSpace space = content.Space(request.Space) ?? throw Refusal.Unprocessable(Codes.NoSuchPlace, $"There is no place '{request.Space}'.");
            if (!space.Walkable(at)) throw Refusal.Unprocessable(Codes.NoSuchPlace, "Nobody can stand there.");
            bool inRun = RealmContent.RunOf(row.Space) is { } from
                && await db.Runs.AnyAsync(stored => stored.Id == from && stored.PlayerId == player && stored.State == RunRow.Live).ConfigureAwait(false);
            if (inRun) throw Refusal.Conflict(Codes.NoWay, "Leave the dungeon first.");
            if (content.Space(row.Space) is null)
            {
                // Where they were is gone - a run since ended, a place the content no longer has: any open tile will do.
            }
            else if (row.Space == space.Id)
            {
                long walkable = (long)Math.Floor(Math.Max(0, now - row.PlacedAt) / 1000.0 * options.WalkingSpeed) + Slack;
                if (here.DistanceTo(at) > walkable) throw Refusal.Conflict(Codes.NoWay, "Nobody walks that far that fast.");
            }
            else if (space is RealmInterior into)
            {
                if (row.Space != RealmContent.WorldSpace || !into.Doors.Any(door => door.DistanceTo(here) <= 1))
                {
                    throw Refusal.Conflict(Codes.NoWay, $"{into.File.Name} is entered through its door.");
                }
            }
            else if (content.Interiors.GetValueOrDefault(row.Space) is not { File.ExitAt: { } exit } || exit.DistanceTo(at) > 1)
            {
                throw Refusal.Conflict(Codes.NoWay, "A building is left through its door.");
            }

            if (space is RealmWorld && content.World.Entrances.TryGetValue(at, out string? entrance) && content.Dungeons.TryGetValue(entrance, out RealmDungeon? dungeon))
            {
                await RequireOpen(player, dungeon).ConfigureAwait(false);
            }
        }

        row.Space = request.Space!;
        row.X = request.X;
        row.Z = request.Z;
        row.PlacedAt = now;
        await db.SaveChangesAsync().ConfigureAwait(false);
        if (hearts.InTown(row.Space, at)) await hearts.Refill(player).ConfigureAwait(false);
        return new PositionView(await db.Players.AsNoTracking().Where(stored => stored.Id == player).Select(stored => stored.Hearts).SingleAsync().ConfigureAwait(false));
    }

    /// <summary>Puts a character somewhere at once: through a waystone, out of a dungeon, back at the inn.</summary>
    public async Task Place(string player, string space, Tile at)
    {
        await db.Players.Where(row => row.Id == player).ExecuteUpdateAsync(set => set
            .SetProperty(row => row.Space, space)
            .SetProperty(row => row.X, at.X)
            .SetProperty(row => row.Z, at.Z)
            .SetProperty(row => row.PlacedAt, Now)).ConfigureAwait(false);
    }

    /// <summary>Sends a character to their inn (their last heart lost, design.md A3b), outside it in the world.</summary>
    public async Task ToInn(string player)
    {
        PlayerRow row = await db.Players.AsNoTracking().SingleAsync(stored => stored.Id == player).ConfigureAwait(false);
        await Place(player, RealmContent.WorldSpace, InnOf(row).At).ConfigureAwait(false);
    }

    /// <summary>
    /// Sets the inn a character stands in as their home (<c>POST /api/inn</c>): the world's inn of that town, the one nearest
    /// the building's door.
    /// </summary>
    public async Task<InnView> SetInn(string player)
    {
        PlayerRow row = await Require(player).ConfigureAwait(false);
        if (content.Interiors.GetValueOrDefault(row.Space) is not { File.Kind: "inn", Town: { } town } interior
            || content.Inns.Values.Where(inn => inn.Town == town.Id).MinBy(inn => interior.File.ExitAt is { } exit ? inn.At.DistanceTo(exit) : 0) is not { } home)
        {
            throw Refusal.Conflict(Codes.NotNear, "A home is set inside a town's inn.");
        }

        row.Inn = home.Id;
        await db.SaveChangesAsync().ConfigureAwait(false);
        return new InnView(home.Id);
    }

    /// <summary>The first inn of a town, by world.json's order.</summary>
    public InnEntry? TownInn(string town) => content.World.File.Inns.FirstOrDefault(inn => inn.Town == town);

    /// <summary>The inn a character wakes at, their home: the one they set, or (if it is gone from the world) the start town's.</summary>
    public InnEntry InnOf(PlayerRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return content.Inns.GetValueOrDefault(row.Inn) ?? TownInn(options.StartTown)
            ?? throw new InvalidOperationException($"The start town '{options.StartTown}' has no inn in the world.");
    }

    /// <summary>
    /// Refuses a character a dungeon that is sealed to them (<c>requires</c>, interfaces.md "Dungeons"): one whose colors are
    /// not all in their identity, as the Phyrexian Portal's are not until all five are unlocked (design.md A6).
    /// </summary>
    public async Task RequireOpen(string player, RealmDungeon dungeon)
    {
        ArgumentNullException.ThrowIfNull(dungeon);
        if (dungeon.File.Requires is not { } requires) return;
        string identity = await Identity(player).ConfigureAwait(false);
        if (!requires.All(identity.Contains))
        {
            throw Refusal.Conflict(Codes.Locked, $"{dungeon.File.Name} is sealed: it opens to a mage who has unlocked {CardPool.Letters(CardPool.Identity(requires))}.");
        }
    }

    /// <summary>Whether a character stands in the world on or beside a tile: on it or one of the eight round it.</summary>
    public static bool Beside(PlayerRow row, Tile at)
    {
        ArgumentNullException.ThrowIfNull(row);
        return row.Space == RealmContent.WorldSpace && new Tile(row.X, row.Z).DistanceTo(at) <= 1;
    }

    public bool IsBasic(string card) => content.Cards.Catalog.TryGetValue(card, out var known) && CardPool.IsBasic(known);

    /// <summary>Whether a character stands at a spell table: in its space, on or next to one.</summary>
    public bool AtSpellTable(PlayerRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return content.Space(row.Space) is { } space && space.SpellTables.Any(table => table.DistanceTo(new Tile(row.X, row.Z)) <= 1);
    }

    /// <summary>
    /// Whether a character stands in a dungeon's antechamber, where its spell table is (design.md A6, "the entrance has a
    /// spell table"): on the first floor of a live run of theirs. A run's layout is the browser's, so the server takes any
    /// tile of it, as it takes any tile of the run for where the character stands.
    /// </summary>
    public async Task<bool> InAntechamber(PlayerRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return RealmContent.RunOf(row.Space) is { } run
            && await db.Runs.AnyAsync(stored => stored.Id == run && stored.PlayerId == row.Id && stored.State == RunRow.Live && stored.Floor == 0).ConfigureAwait(false);
    }

    /// <summary>Adds copies of a card to a character's collection (or takes them, with a negative count).</summary>
    public async Task AddToCollection(string player, string card, int count)
    {
        CollectionRow? row = await db.Collection.SingleOrDefaultAsync(row => row.PlayerId == player && row.Name == card).ConfigureAwait(false);
        if (row is null)
        {
            if (count > 0) db.Collection.Add(new CollectionRow { PlayerId = player, Name = card, Count = count });
            return;
        }

        row.Count += count;
        if (row.Count <= 0) db.Collection.Remove(row);
    }
}
