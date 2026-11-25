using Cantrip.Decks;
using Cantrip.Protocol;

namespace Cantrip.Realms.Server.Content;

/// <summary>
/// The realm's deck rules (design.md A2), over the deck editor's own card rules (<see cref="DeckRules"/>): at least forty
/// cards and no maximum; a sideboard of at most fifteen (CR 100.4a); no more copies of a card, the deck's and the
/// sideboard's together, than <see cref="DeckRules.MostCopies"/> allows in Vintage (four, any number of a basic land), one
/// of a card restricted there, and one of a relic (design.md A3a); every card legal or restricted in Vintage; and, for a
/// character, every card's color identity within theirs (<see cref="DeckRules.Within"/>), the sideboard's too.
/// </summary>
public static class DeckChecks
{
    /// <summary>The most cards a sideboard holds (design.md A2; CR 100.4a).</summary>
    public const int MostSideboard = 15;

    private static readonly DeckFormat Vintage = DeckFormat.Find(DeckFormat.VintageKey)!;

    /// <summary>Everything wrong with a main deck and its sideboard, in name order; empty for a deck the realm deals.</summary>
    /// <param name="identity">The colors the cards are held to; null for none (a mob's deck).</param>
    /// <param name="sideboard">The sideboard beside the deck; none for a mob's deck.</param>
    public static List<string> Problems(CardPool cards, IReadOnlyList<DeckEntry> main, IReadOnlySet<ColorView>? identity, IReadOnlyList<DeckEntry>? sideboard = null)
    {
        ArgumentNullException.ThrowIfNull(cards);
        ArgumentNullException.ThrowIfNull(main);
        sideboard ??= [];
        List<string> problems = [];
        if (main.Concat(sideboard).Any(entry => entry.Count <= 0))
        {
            problems.Add("Every entry is one copy or more.");
        }

        int total = main.Sum(entry => Math.Max(0, entry.Count));
        if (total < Duel.RealmMinimumDeckSize)
        {
            problems.Add($"A deck is at least {Duel.RealmMinimumDeckSize} cards: this one is {total}.");
        }

        int aside = sideboard.Sum(entry => Math.Max(0, entry.Count));
        if (aside > MostSideboard)
        {
            problems.Add($"A sideboard is at most {MostSideboard} cards: this one is {aside}.");
        }

        foreach (IGrouping<string, DeckEntry> named in main.Concat(sideboard).GroupBy(entry => entry.Card, StringComparer.Ordinal).OrderBy(group => group.Key, StringComparer.Ordinal))
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

            int most = legality == Legality.Restricted || cards.IsRelic(named.Key) ? 1 : DeckRules.MostCopies(card, Vintage);
            if (copies > most)
            {
                problems.Add(legality == Legality.Restricted
                    ? $"{named.Key} is restricted in Vintage: one copy at most, not {copies}."
                    : most == 1
                        ? $"{named.Key} is a relic: one copy at most, not {copies}."
                        : $"{named.Key}: {copies} copies, more than the {most} a deck and its sideboard may have.");
            }

            if (identity is not null && !CardPool.Within(card, identity))
            {
                problems.Add($"{named.Key} is outside the color identity {CardPool.Letters(identity)}.");
            }
        }

        return problems;
    }
}
