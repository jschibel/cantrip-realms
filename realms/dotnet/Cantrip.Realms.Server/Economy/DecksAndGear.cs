using Cantrip.Decks;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// A character's deck and sideboard (design.md A2), and their loadout (A1, A4). The deck and the sideboard change only while
/// the character stands at a spell table; basic lands of the character's colors are free, unlimited and never owned.
/// </summary>
public sealed class DecksAndGear(RealmDb db, RealmContent content, Characters characters)
{
    /// <summary>The allowed range of each setup value with gear (design.md A1).</summary>
    public static (int Least, int Most) LifeRange { get; } = (10, 40);

    public static (int Least, int Most) HandRange { get; } = (4, 9);

    public static (int Least, int Most) MaxHandRange { get; } = (4, 10);

    public async Task<DeckView> View(string player)
    {
        await characters.Require(player).ConfigureAwait(false);
        List<DeckRow> main = await db.Deck.Where(row => row.PlayerId == player).ToListAsync().ConfigureAwait(false);
        List<SideboardRow> sideboard = await db.Sideboard.Where(row => row.PlayerId == player).ToListAsync().ConfigureAwait(false);
        return View(
            [.. main.Select(row => new CardCount(row.Name, row.Count))],
            [.. sideboard.Select(row => new CardCount(row.Name, row.Count))]);
    }

    private static DeckView View(IEnumerable<CardCount> main, IEnumerable<CardCount> sideboard) =>
        new([.. main.Where(card => card.Count > 0).OrderBy(card => card.Name, StringComparer.Ordinal)],
            [.. sideboard.Where(card => card.Count > 0).OrderBy(card => card.Name, StringComparer.Ordinal)]);

    /// <summary>
    /// Everything a character owns of cards (<c>GET /api/inventory</c>): each card of the collection, by name, with how many,
    /// its list price (0 for a card with none), how many copies the deck and the sideboard use, and whether it is a relic;
    /// and what the collection is worth at list price. Their gear is the <c>Character</c>'s.
    /// </summary>
    public async Task<InventoryView> Inventory(string player)
    {
        await characters.Require(player).ConfigureAwait(false);
        Dictionary<string, int> deck = await db.Deck.AsNoTracking().Where(row => row.PlayerId == player)
            .ToDictionaryAsync(row => row.Name, row => row.Count, StringComparer.Ordinal).ConfigureAwait(false);
        Dictionary<string, int> sideboard = await db.Sideboard.AsNoTracking().Where(row => row.PlayerId == player)
            .ToDictionaryAsync(row => row.Name, row => row.Count, StringComparer.Ordinal).ConfigureAwait(false);
        List<CollectionRow> owned = await db.Collection.AsNoTracking().Where(row => row.PlayerId == player && row.Count > 0).ToListAsync().ConfigureAwait(false);
        List<InventoryCard> cards = [.. owned.OrderBy(row => row.Name, StringComparer.Ordinal).Select(row => new InventoryCard(
            row.Name,
            row.Count,
            content.Cards.Price(row.Name) ?? 0,
            deck.GetValueOrDefault(row.Name),
            sideboard.GetValueOrDefault(row.Name),
            content.Cards.IsRelic(row.Name)))];
        return new InventoryView(cards, cards.Sum(card => card.Gold * card.Count));
    }

    /// <summary>Saves a character's deck and sideboard, at a spell table, if they are legal.</summary>
    public async Task<DeckView> Save(string player, DeckChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        if (!characters.AtSpellTable(row) && !await characters.InAntechamber(row).ConfigureAwait(false)) throw Refusal.Conflict(Codes.NotAtTable, "A deck is changed only at a spell table.");

        List<CardCount> main = Merge(change.Main);
        List<CardCount> sideboard = Merge(change.Sideboard);
        List<string> problems = await Problems(player, main, sideboard).ConfigureAwait(false);
        if (problems.Count > 0) throw Refusal.Unprocessable(Codes.IllegalDeck, "The deck can't be played as it is.", problems);

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            await db.Deck.Where(card => card.PlayerId == player).ExecuteDeleteAsync().ConfigureAwait(false);
            await db.Sideboard.Where(card => card.PlayerId == player).ExecuteDeleteAsync().ConfigureAwait(false);
            db.Deck.AddRange(main.Select(card => new DeckRow { PlayerId = player, Name = card.Name, Count = card.Count }));
            db.Sideboard.AddRange(sideboard.Select(card => new SideboardRow { PlayerId = player, Name = card.Name, Count = card.Count }));
            await db.SaveChangesAsync().ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return View(main, sideboard);
    }

    /// <summary>What saving a deck and a sideboard would find wrong with them, wherever the character stands.</summary>
    public async Task<DeckCheckView> Check(string player, DeckChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        await characters.Require(player).ConfigureAwait(false);
        return new DeckCheckView(await Problems(player, Merge(change.Main), Merge(change.Sideboard)).ConfigureAwait(false));
    }

    /// <summary>
    /// Everything wrong with a deck and a sideboard for a character (design.md A2), in the order they would fix it: the
    /// deck's and the sideboard's cards together within the copy limits and the character's identity, the sideboard at most
    /// 15 cards, and every copy but a free basic land owned.
    /// </summary>
    public async Task<List<string>> Problems(string player, IReadOnlyList<CardCount> main, IReadOnlyList<CardCount> sideboard)
    {
        string identity = await characters.Identity(player).ConfigureAwait(false);
        List<string> problems = DeckChecks.Problems(
            content.Cards,
            [.. main.Select(card => new DeckEntry(card.Name, card.Count))],
            CardPool.Identity(identity),
            [.. sideboard.Select(card => new DeckEntry(card.Name, card.Count))]);

        Dictionary<string, int> owned = await db.Collection.Where(row => row.PlayerId == player)
            .ToDictionaryAsync(row => row.Name, row => row.Count, StringComparer.Ordinal).ConfigureAwait(false);
        foreach (IGrouping<string, CardCount> named in main.Concat(sideboard).Where(card => !characters.IsBasic(card.Name))
            .GroupBy(card => card.Name, StringComparer.Ordinal).OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            int used = named.Sum(card => card.Count);
            int has = owned.GetValueOrDefault(named.Key);
            if (used > has)
            {
                problems.Add(has == 0
                    ? $"You don't own {named.Key}."
                    : $"You own {has} {named.Key}; the deck and the sideboard use {used}.");
            }
        }

        return problems;
    }

    /// <summary>
    /// Takes copies of a card out of the sideboard, then the deck, until they hold no more than the collection has: after a
    /// card has left the collection (a dungeon run's winnings taken back, design.md A3b).
    /// </summary>
    public async Task FitToCollection(string player, string card)
    {
        int owned = await db.Collection.Where(row => row.PlayerId == player && row.Name == card).Select(row => row.Count).FirstOrDefaultAsync().ConfigureAwait(false);
        SideboardRow? side = await db.Sideboard.SingleOrDefaultAsync(row => row.PlayerId == player && row.Name == card).ConfigureAwait(false);
        DeckRow? deck = await db.Deck.SingleOrDefaultAsync(row => row.PlayerId == player && row.Name == card).ConfigureAwait(false);
        int over = (side?.Count ?? 0) + (deck?.Count ?? 0) - owned;
        if (over <= 0) return;
        if (side is not null)
        {
            int taken = Math.Min(over, side.Count);
            side.Count -= taken;
            over -= taken;
            if (side.Count <= 0) db.Sideboard.Remove(side);
        }

        if (over > 0 && deck is not null)
        {
            deck.Count -= Math.Min(over, deck.Count);
            if (deck.Count <= 0) db.Deck.Remove(deck);
        }

        await db.SaveChangesAsync().ConfigureAwait(false);
    }

    /// <summary>A list's entries with one entry per card.</summary>
    public static List<CardCount> Merge(IReadOnlyList<CardCount>? cards) =>
        [.. (cards ?? []).Where(card => !string.IsNullOrWhiteSpace(card.Name))
            .GroupBy(card => card.Name.Trim(), StringComparer.Ordinal)
            .Select(group => new CardCount(group.Key, group.Sum(card => card.Count)))];

    /// <summary>Changes what a character wears: each slot named takes the item named, or is emptied by null.</summary>
    public async Task<CharacterView> Wear(string player, LoadoutChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        await characters.Require(player).ConfigureAwait(false);
        List<GearInstance> gear = await characters.Gear(player).ConfigureAwait(false);
        Dictionary<long, GearInstance> owned = gear.ToDictionary(instance => instance.InstanceId);
        Dictionary<string, GearInstance?> loadout = await characters.Loadout(player, gear).ConfigureAwait(false);

        List<string> problems = [];
        foreach ((string slot, long? instance) in change.Slots ?? new Dictionary<string, long?>())
        {
            if (!RealmContent.LoadoutSlots.TryGetValue(slot, out string? kind))
            {
                problems.Add($"'{slot}' is not a slot: they are {string.Join(", ", RealmContent.LoadoutSlots.Keys)}.");
            }
            else if (instance is not { } id)
            {
                loadout[slot] = null;
            }
            else if (!owned.TryGetValue(id, out GearInstance? item))
            {
                problems.Add($"You own no gear item {id}.");
            }
            else if (item.Gear.Slot != kind)
            {
                problems.Add($"{item.Gear.Name} is worn on the {item.Gear.Slot}, not the {slot}.");
            }
            else
            {
                loadout[slot] = item;
            }
        }

        foreach (IGrouping<long, KeyValuePair<string, GearInstance?>> twice in loadout.Where(slot => slot.Value is not null)
            .GroupBy(slot => slot.Value!.InstanceId).Where(group => group.Count() > 1))
        {
            problems.Add($"{twice.First().Value!.Gear.Name} can't be worn in two slots.");
        }

        problems.AddRange(StatProblems(Characters.Stats(loadout.Values.OfType<GearInstance>().Select(instance => instance.Gear))));
        if (problems.Count > 0) throw Refusal.Unprocessable(Codes.IllegalLoadout, "That can't be worn together.", problems);

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            await db.Loadout.Where(slot => slot.PlayerId == player).ExecuteDeleteAsync().ConfigureAwait(false);
            db.Loadout.AddRange(loadout.Where(slot => slot.Value is not null)
                .Select(slot => new LoadoutRow { PlayerId = player, Slot = slot.Key, GearInstanceId = slot.Value!.InstanceId }));
            await db.SaveChangesAsync().ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return await characters.View(player).ConfigureAwait(false);
    }

    /// <summary>What is out of range in the setup values a loadout gives (design.md A1).</summary>
    public static List<string> StatProblems(GearStats stats)
    {
        ArgumentNullException.ThrowIfNull(stats);
        List<string> problems = [];
        if (stats.Life < LifeRange.Least || stats.Life > LifeRange.Most) problems.Add($"Starting life is {LifeRange.Least} to {LifeRange.Most}: this is {stats.Life}.");
        if (stats.Hand < HandRange.Least || stats.Hand > HandRange.Most) problems.Add($"A starting hand is {HandRange.Least} to {HandRange.Most} cards: this is {stats.Hand}.");
        if (stats.MaxHand < MaxHandRange.Least || stats.MaxHand > MaxHandRange.Most) problems.Add($"A maximum hand is {MaxHandRange.Least} to {MaxHandRange.Most} cards: this is {stats.MaxHand}.");
        return problems;
    }
}
