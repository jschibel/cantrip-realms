using System.Text.RegularExpressions;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Server;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// Characters (design.md A1): creating one with its starting kit, reading it, its collection, where it stands, and the
/// stats its loadout gives it.
/// </summary>
public sealed partial class Characters(RealmDb db, RealmContent content, RealmOptions options, RealmDice dice, TimeProvider time)
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

        RealmMap start = content.Maps.GetValueOrDefault(options.StartMap) ?? throw new InvalidOperationException($"The start map '{options.StartMap}' is not in the content.");
        (string innMap, Hex inn) = InnOf(start);
        DeckList starter = content.Starters[start.Plane][color];
        long now = Now;

        db.Players.Add(new PlayerRow
        {
            Id = player,
            Name = name,
            Body = body,
            Palette = request.Palette,
            Color = color,
            Gold = StartingGold,
            Map = innMap,
            Q = inn.Q,
            R = inn.R,
            CreatedAt = now,
        });

        Dictionary<string, int> owned = new(StringComparer.Ordinal);
        foreach (DeckListEntry entry in starter.Entries)
        {
            db.Deck.Add(new DeckRow { PlayerId = player, Name = entry.Card, Count = entry.Copies });
            if (!IsBasic(entry.Card)) owned[entry.Card] = owned.GetValueOrDefault(entry.Card) + entry.Copies;
        }

        var commons = new CardFilter { Colors = color, Rarities = ["common"] };
        List<string> exact = [.. content.Cards.Filter(start.Plane, commons).Where(card => content.Cards.Catalog[card].Identity.Count == 1)];
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
    public IEnumerable<(string Slot, GearItem Item)> StartingKit() =>
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
        List<AnteRow> ante = await db.Ante.AsNoTracking().Where(row => row.PlayerId == player).ToListAsync().ConfigureAwait(false);
        return new CharacterView(
            row.Id,
            row.Name,
            BodyName(row.Body),
            row.Palette,
            Identity(row, unlocked),
            row.Gold,
            ante.Sum(card => (content.Cards.Price(card.Name) ?? 0) * card.Count),
            row.Map,
            row.Q,
            row.R,
            StatsView.Of(Stats(loadout.Values.OfType<GearInstance>().Select(instance => instance.Gear))),
            loadout,
            gear,
            [.. unlocked.Order(StringComparer.Ordinal)]);
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

    /// <summary>A character's collection, by card name.</summary>
    public async Task<CollectionView> Collection(string player)
    {
        await Require(player).ConfigureAwait(false);
        List<CollectionRow> rows = await db.Collection.AsNoTracking().Where(row => row.PlayerId == player && row.Count > 0).ToListAsync().ConfigureAwait(false);
        return new CollectionView(new SortedDictionary<string, int>(rows.ToDictionary(row => row.Name, row => row.Count), StringComparer.Ordinal));
    }

    /// <summary>Records where a character is (<c>/api/travel</c>): a walkable hex of a map.</summary>
    public async Task Travel(string player, TravelTo request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await Require(player).ConfigureAwait(false);
        if (request.Map is null || !content.Maps.TryGetValue(request.Map, out RealmMap? map) || !map.Walkable(new Hex(request.Q, request.R)))
        {
            throw Refusal.Unprocessable(Codes.NoSuchPlace, "Nobody can stand there.");
        }

        row.Map = map.Id;
        row.Q = request.Q;
        row.R = request.R;
        await db.SaveChangesAsync().ConfigureAwait(false);
    }

    /// <summary>The inn a character who loses on a map wakes at: its map and hex.</summary>
    public (string Map, Hex At) InnOf(RealmMap map)
    {
        ArgumentNullException.ThrowIfNull(map);
        MapInn inn = map.File.Inn ?? throw new InvalidOperationException($"Map {map.Id} has no inn.");
        return (inn.Map ?? map.Id, inn.At);
    }

    public bool IsBasic(string card) => content.Cards.Catalog.TryGetValue(card, out var known) && CardPool.IsBasic(known);

    /// <summary>Whether a character stands at a spell table: on its map, on or next to one.</summary>
    public bool AtSpellTable(PlayerRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return content.Maps.TryGetValue(row.Map, out RealmMap? map) && map.SpellTables.Any(table => table.DistanceTo(new Hex(row.Q, row.R)) <= 1);
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
