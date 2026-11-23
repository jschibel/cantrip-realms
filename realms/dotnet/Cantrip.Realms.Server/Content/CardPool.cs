using System.Text.Json;
using Cantrip.Decks;
using Cantrip.Protocol;

namespace Cantrip.Realms.Server.Content;

/// <summary>A card's price and rarity (<c>realms/content/prices.json</c>).</summary>
public sealed record CardPrice(long Gold, decimal Usd, string Rarity);

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
        IReadOnlySet<string>? relics = null)
    {
        ArgumentNullException.ThrowIfNull(pools);
        Catalog = catalog;
        Prices = prices;
        Relics = relics ?? new HashSet<string>(StringComparer.Ordinal);
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

    /// <summary>Reads <c>prices.json</c>.</summary>
    public static Dictionary<string, CardPrice> ReadPrices(string path)
    {
        using JsonDocument document = JsonDocument.Parse(File.ReadAllBytes(path));
        Dictionary<string, CardPrice> prices = new(StringComparer.Ordinal);
        foreach (JsonProperty card in document.RootElement.GetProperty("cards").EnumerateObject())
        {
            JsonElement value = card.Value;
            decimal usd = value.TryGetProperty("usd", out JsonElement dollars) && dollars.ValueKind == JsonValueKind.Number ? dollars.GetDecimal() : 0m;
            prices[card.Name] = new CardPrice(value.GetProperty("gold").GetInt64(), usd, value.GetProperty("rarity").GetString() ?? string.Empty);
        }

        return prices;
    }
}
