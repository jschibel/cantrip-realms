using Cantrip.Decks;
using Cantrip.Protocol;

namespace Cantrip.Realms.Server.Content;

/// <summary>
/// The realm's deck rules (design.md A2), over the deck editor's own card rules (<see cref="DeckRules"/>): at least forty
/// cards and no maximum; no more copies of a card than <see cref="DeckRules.MostCopies"/> allows in Vintage (four, any
/// number of a basic land), one of a card restricted there; every card legal or restricted in Vintage; and, for a
/// character, every card's color identity within theirs (<see cref="DeckRules.Within"/>).
/// </summary>
public static class DeckChecks
{
    /// <summary>The most cards an ante holds (design.md A2).</summary>
    public const int MostAnte = 10;

    private static readonly DeckFormat Vintage = DeckFormat.Find(DeckFormat.VintageKey)!;

    /// <summary>Everything wrong with a main deck, in name order; empty for a deck the realm deals.</summary>
    /// <param name="identity">The colors the deck's cards are held to; null for none (a mob's deck).</param>
    public static List<string> Problems(CardPool cards, IReadOnlyList<DeckEntry> main, IReadOnlySet<ColorView>? identity)
    {
        ArgumentNullException.ThrowIfNull(cards);
        ArgumentNullException.ThrowIfNull(main);
        List<string> problems = [];
        if (main.Any(entry => entry.Count <= 0))
        {
            problems.Add("Every entry is one copy or more.");
        }

        int total = main.Sum(entry => Math.Max(0, entry.Count));
        if (total < Duel.RealmMinimumDeckSize)
        {
            problems.Add($"A deck is at least {Duel.RealmMinimumDeckSize} cards: this one is {total}.");
        }

        foreach (IGrouping<string, DeckEntry> named in main.GroupBy(entry => entry.Card, StringComparer.Ordinal).OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            int copies = named.Sum(entry => Math.Max(0, entry.Count));
            if (!cards.Catalog.TryGetValue(named.Key, out CatalogCard? card))
            {
                problems.Add($"{named.Key} is not a card the engine plays.");
                continue;
            }

            // A basic land is legal in every format, whether or not the legality data lists it (Wastes is missing from it).
            string legality = CardPool.IsBasic(card) ? Legality.Legal : card.LegalityIn(DeckFormat.VintageKey);
            if (!Legality.Allows(legality))
            {
                problems.Add($"{named.Key} is not legal in Vintage.");
            }

            int most = legality == Legality.Restricted ? 1 : DeckRules.MostCopies(card, Vintage);
            if (copies > most)
            {
                problems.Add(legality == Legality.Restricted
                    ? $"{named.Key} is restricted in Vintage: one copy at most, not {copies}."
                    : $"{named.Key}: {copies} copies, more than the {most} a deck may have.");
            }

            if (identity is not null && !DeckRules.Within(card, identity))
            {
                problems.Add($"{named.Key} is outside the color identity {CardPool.Letters(identity)}.");
            }
        }

        return problems;
    }
}
