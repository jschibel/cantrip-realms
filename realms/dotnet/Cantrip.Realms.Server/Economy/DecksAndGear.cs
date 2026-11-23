using Cantrip.Decks;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// A character's deck and ante (design.md A2), and their loadout (A1, A4). The deck and the ante change only while the
/// character stands at a spell table; basic lands of the character's colors are free, unlimited and never owned.
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
        List<AnteRow> ante = await db.Ante.Where(row => row.PlayerId == player).ToListAsync().ConfigureAwait(false);
        return View(
            [.. main.Select(row => new CardCount(row.Name, row.Count))],
            [.. ante.Select(row => new CardCount(row.Name, row.Count))]);
    }

    private DeckView View(IEnumerable<CardCount> main, IEnumerable<CardCount> ante)
    {
        List<CardCount> anteList = [.. ante.Where(card => card.Count > 0).OrderBy(card => card.Name, StringComparer.Ordinal)];
        return new DeckView([.. main.Where(card => card.Count > 0).OrderBy(card => card.Name, StringComparer.Ordinal)], anteList, AnteValue(anteList));
    }

    /// <summary>What an ante is worth: the sum of its cards' list prices (design.md A2).</summary>
    public long AnteValue(IEnumerable<CardCount> ante) => ante.Sum(card => (content.Cards.Price(card.Name) ?? 0) * card.Count);

    /// <summary>Saves a character's deck and ante, at a spell table, if they are legal.</summary>
    public async Task<DeckView> Save(string player, DeckChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        if (!characters.AtSpellTable(row)) throw Refusal.Conflict(Codes.NotAtTable, "A deck is changed only at a spell table.");

        List<CardCount> main = Merge(change.Main);
        List<CardCount> ante = Merge(change.Ante);
        List<string> problems = await Problems(player, main, ante).ConfigureAwait(false);
        if (problems.Count > 0) throw Refusal.Unprocessable(Codes.IllegalDeck, "The deck can't be played as it is.", problems);

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            await db.Deck.Where(card => card.PlayerId == player).ExecuteDeleteAsync().ConfigureAwait(false);
            await db.Ante.Where(card => card.PlayerId == player).ExecuteDeleteAsync().ConfigureAwait(false);
            db.Deck.AddRange(main.Select(card => new DeckRow { PlayerId = player, Name = card.Name, Count = card.Count }));
            db.Ante.AddRange(ante.Select(card => new AnteRow { PlayerId = player, Name = card.Name, Count = card.Count }));
            await db.SaveChangesAsync().ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return View(main, ante);
    }

    /// <summary>What saving a deck and an ante would find wrong with them, wherever the character stands, and what the ante is worth.</summary>
    public async Task<DeckCheckView> Check(string player, DeckChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        await characters.Require(player).ConfigureAwait(false);
        List<CardCount> main = Merge(change.Main);
        List<CardCount> ante = Merge(change.Ante);
        return new DeckCheckView(await Problems(player, main, ante).ConfigureAwait(false), AnteValue(ante.Where(card => card.Count > 0)));
    }

    /// <summary>Everything wrong with a deck and an ante for a character, in the order they would fix it.</summary>
    public async Task<List<string>> Problems(string player, IReadOnlyList<CardCount> main, IReadOnlyList<CardCount> ante)
    {
        string identity = await characters.Identity(player).ConfigureAwait(false);
        List<string> problems = DeckChecks.Problems(content.Cards, [.. main.Select(card => new DeckEntry(card.Name, card.Count))], CardPool.Identity(identity));

        int anted = ante.Sum(card => card.Count);
        if (ante.Any(card => card.Count <= 0)) problems.Add("Every ante entry is one copy or more.");
        if (anted > DeckChecks.MostAnte) problems.Add($"An ante is at most {DeckChecks.MostAnte} cards: this one is {anted}.");
        foreach (CardCount card in ante.Where(card => characters.IsBasic(card.Name)))
        {
            problems.Add($"{card.Name} is a basic land, free to every deck: it can't be anted.");
        }

        foreach (CardCount card in ante.Where(card => content.Cards.IsRelic(card.Name)))
        {
            problems.Add($"{card.Name} is a relic, which is never lost: it can't be anted.");
        }

        Dictionary<string, int> owned = await db.Collection.Where(row => row.PlayerId == player)
            .ToDictionaryAsync(row => row.Name, row => row.Count, StringComparer.Ordinal).ConfigureAwait(false);
        foreach (IGrouping<string, CardCount> named in main.Concat(ante).Where(card => !characters.IsBasic(card.Name))
            .GroupBy(card => card.Name, StringComparer.Ordinal).OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            int used = named.Sum(card => card.Count);
            int has = owned.GetValueOrDefault(named.Key);
            if (used > has)
            {
                problems.Add(has == 0
                    ? $"You don't own {named.Key}."
                    : $"You own {has} {named.Key}; the deck and the ante use {used}.");
            }
        }

        return problems;
    }

    /// <summary>A list's entries with one entry per card.</summary>
    private static List<CardCount> Merge(IReadOnlyList<CardCount>? cards) =>
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
