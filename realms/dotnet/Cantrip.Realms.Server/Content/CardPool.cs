using System.Text.Json;
using Cantrip.Decks;
using Cantrip.Protocol;

namespace Cantrip.Realms.Server.Content;

/// <summary>
/// A card's price and rarity, and its Vintage legality and color identity, as the realm's card database
/// (<c>realms/content/cards.json</c>, <see cref="CardRecord"/>) gives them.
/// </summary>
public sealed record CardPrice(long Gold, decimal Usd, string Rarity, string? Vintage = null, string? Identity = null);

/// <summary>
/// The cards of the realm: the engine's catalog with each card's legality and color identity (the deck editor's,
/// <see cref="Cantrip.Server.Decks.DeckCatalog"/>), each card's list price, and each plane's pool - what loot and vendors
/// draw from (design.md A5). Basic lands are in no pool here: they are free and never part of a collection (design.md A1);
/// nor are the relics (design.md A3a), which drop only from the bosses their entries name.
/// </summary>
public sealed class CardPool
{
    private readonly IReadOnlyDictionary<string, IReadOnlyList<string>> _pools;

    public CardPool(
        IReadOnlyDictionary<string, CatalogCard> catalog,
        IReadOnlyDictionary<string, CardPrice> prices,
        IReadOnlyDictionary<string, IReadOnlyList<string>> pools,
        IReadOnlySet<string>? relics = null,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? offPlane = null)
    {
        ArgumentNullException.ThrowIfNull(pools);
        Catalog = catalog;
        Prices = prices;
        Relics = relics ?? new HashSet<string>(StringComparer.Ordinal);
        OffPlane = (offPlane ?? new Dictionary<string, IReadOnlyList<string>>())
            .Where(card => catalog.TryGetValue(card.Key, out CatalogCard? known) && !IsBasic(known) && prices.ContainsKey(card.Key) && !Relics.Contains(card.Key))
            .ToDictionary(card => card.Key, card => card.Value, StringComparer.Ordinal);
        _pools = pools.ToDictionary(
            plane => plane.Key,
            plane => (IReadOnlyList<string>)[.. plane.Value.Where(name => catalog.TryGetValue(name, out CatalogCard? card) && !IsBasic(card) && prices.ContainsKey(name) && !Relics.Contains(name))
                .Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)],
            StringComparer.Ordinal);
    }

    /// <summary>Every card the engine plays, by name.</summary>
    public IReadOnlyDictionary<string, CatalogCard> Catalog { get; }

    public IReadOnlyDictionary<string, CardPrice> Prices { get; }

    /// <summary>The relics' names (design.md A3a): in no pool, never anted or sold, one copy at most in a deck.</summary>
    public IReadOnlySet<string> Relics { get; }

    public bool IsRelic(string name) => Relics.Contains(name);

    public IEnumerable<string> Planes => _pools.Keys;

    /// <summary>
    /// The off-plane pool (design.md A5, "Wares from other planes"): cards printed on no walked plane, each with the trader
    /// planes it was printed on. Only exotic dealers deal in it.
    /// </summary>
    public IReadOnlyDictionary<string, IReadOnlyList<string>> OffPlane { get; }

    public bool IsOffPlane(string name) => OffPlane.ContainsKey(name);

    /// <summary>The off-plane cards that fit a filter (its <c>Pool</c> aside), and with a plane given, printed on that plane.</summary>
    public IReadOnlyList<string> OffPlaneFilter(CardFilter filter, string? plane = null)
    {
        ArgumentNullException.ThrowIfNull(filter);
        CardFilter any = new() { Colors = filter.Colors, Types = filter.Types, Subtypes = filter.Subtypes, Rarities = filter.Rarities, Names = filter.Names };
        return [.. OffPlane.Where(card => plane is null || card.Value.Contains(plane, StringComparer.Ordinal)).Select(card => card.Key).Where(name => Fits(name, any)).Order(StringComparer.Ordinal)];
    }

    /// <summary>A plane's pool, without its basic lands; empty for a plane there is none of.</summary>
    public IReadOnlyList<string> Pool(string plane) => _pools.GetValueOrDefault(plane) ?? [];

    /// <summary>A card's list price in gold, or null for a card with no price (which no vendor or loot has).</summary>
    public long? Price(string name) => Prices.TryGetValue(name, out CardPrice? price) ? price.Gold : null;

    /// <summary>Whether a card is a basic land (CR 205.4c), which a character has any number of and never owns.</summary>
    public static bool IsBasic(CatalogCard card)
    {
        ArgumentNullException.ThrowIfNull(card);
        return card.Card.Supertypes.Contains(SupertypeView.Basic) && card.Card.CardTypes.Contains(CardTypeView.Land);
    }

    /// <summary>
    /// The colors a basic land's land types give it mana of (CR 305.6): Plains white, Island blue and so on; none for Wastes.
    /// What a basic land's color identity is (CR 903.4), whether or not the legality data lists the card (it misses the
    /// snow-covered basics).
    /// </summary>
    public static HashSet<ColorView> BasicColors(CatalogCard card)
    {
        ArgumentNullException.ThrowIfNull(card);
        HashSet<ColorView> colors = [];
        foreach (string type in card.Card.Subtypes)
        {
            if (type switch { "Plains" => ColorView.White, "Island" => ColorView.Blue, "Swamp" => ColorView.Black, "Mountain" => ColorView.Red, "Forest" => ColorView.Green, _ => (ColorView?)null } is { } color)
            {
                colors.Add(color);
            }
        }

        return colors;
    }

    /// <summary>Whether a card's color identity is within a character's: as the deck editor judges it, a basic land by its land types too.</summary>
    public static bool Within(CatalogCard card, IReadOnlySet<ColorView> identity)
    {
        ArgumentNullException.ThrowIfNull(card);
        ArgumentNullException.ThrowIfNull(identity);
        return DeckRules.Within(card, identity) && (!IsBasic(card) || BasicColors(card).IsSubsetOf(identity));
    }

    /// <summary>Whether a card fits a filter: every part of it that is given holds.</summary>
    public bool Fits(string name, CardFilter filter)
    {
        ArgumentNullException.ThrowIfNull(filter);
        if (!Catalog.TryGetValue(name, out CatalogCard? card) || !Prices.TryGetValue(name, out CardPrice? price))
        {
            return false;
        }

        if (filter.Colors is { } colors && !DeckRules.Within(card, Identity(colors)))
        {
            return false;
        }

        if (filter.Types.Count > 0 && !card.Card.CardTypes.Any(type => filter.Types.Contains(type.ToString(), StringComparer.OrdinalIgnoreCase)))
        {
            return false;
        }

        if (filter.Subtypes.Count > 0 && !card.Card.Subtypes.Any(subtype => filter.Subtypes.Contains(subtype, StringComparer.OrdinalIgnoreCase)))
        {
            return false;
        }

        if (filter.Rarities.Count > 0 && !filter.Rarities.Contains(price.Rarity, StringComparer.Ordinal))
        {
            return false;
        }

        return filter.Names.Count == 0 || filter.Names.Contains(name, StringComparer.Ordinal);
    }

    /// <summary>A plane's pool filtered.</summary>
    public IReadOnlyList<string> Filter(string plane, CardFilter filter) => [.. Pool(plane).Where(name => Fits(name, filter))];

    /// <summary>A color identity written as letters ("WU"), as colors.</summary>
    public static HashSet<ColorView> Identity(string letters)
    {
        ArgumentNullException.ThrowIfNull(letters);
        return [.. letters.Select(Color).OfType<ColorView>()];
    }

    /// <summary>The letter of a color, W U B R G.</summary>
    public static ColorView? Color(char letter) => letter switch
    {
        'W' => ColorView.White,
        'U' => ColorView.Blue,
        'B' => ColorView.Black,
        'R' => ColorView.Red,
        'G' => ColorView.Green,
        _ => null,
    };

    /// <summary>The colors' letters in WUBRG order.</summary>
    public static string Letters(IEnumerable<ColorView> colors)
    {
        HashSet<ColorView> set = [.. colors];
        return string.Concat("WUBRG".Where(letter => set.Contains(Color(letter)!.Value)));
    }

    /// <summary>
    /// The engine's catalog with the realm's own word on each priced card (design.md A2): the Vintage legality and color
    /// identity cards.json gives, in place of the deck site's legality data, which lags the cards the engine has. A card
    /// cards.json has no record of is left as the catalog has it.
    /// </summary>
    public static Dictionary<string, CatalogCard> WithRealmLegality(IReadOnlyDictionary<string, CatalogCard> catalog, IReadOnlyDictionary<string, CardRecord> records)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(records);
        Dictionary<string, CatalogCard> cards = new(StringComparer.Ordinal);
        foreach ((string name, CatalogCard card) in catalog)
        {
            if (!records.TryGetValue(name, out CardRecord? record))
            {
                cards[name] = card;
                continue;
            }

            cards[name] = new CatalogCard
            {
                Card = card.Card,
                Identity = [.. Identity(record.Identity)],
                Legalities = new Dictionary<string, string>(card.Legalities, StringComparer.Ordinal) { [DeckFormat.VintageKey] = record.Vintage },
            };
        }

        return cards;
    }
}
