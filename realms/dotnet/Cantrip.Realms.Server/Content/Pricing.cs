namespace Cantrip.Realms.Server.Content;

/// <summary>
/// A card's list price (realms/docs/design.md A5): a hundred gold to the dollar, of the median paper price of its printings
/// plus a surcharge by the rarity of that printing. <c>tools/realms/card-economy.py</c> works the prices out and writes
/// them to <c>realms/content/prices.json</c>; the server reads them, and checks each against this as it loads.
/// </summary>
public static class Pricing
{
    /// <summary>The rarities a card's price is surcharged for, and by how much in dollars.</summary>
    public static IReadOnlyDictionary<string, decimal> Surcharge { get; } = new Dictionary<string, decimal>(StringComparer.Ordinal)
    {
        ["common"] = 0.50m,
        ["uncommon"] = 1.00m,
        ["rare"] = 5.00m,
        ["mythic"] = 10.00m,
    };

    /// <summary>The list price in gold of a card whose median printing costs <paramref name="usd"/> at <paramref name="rarity"/>.</summary>
    /// <exception cref="ArgumentException">A rarity there is no surcharge for.</exception>
    public static long ListPrice(decimal usd, string rarity)
    {
        if (!Surcharge.TryGetValue(rarity, out decimal surcharge))
        {
            throw new ArgumentException($"'{rarity}' is not a rarity.", nameof(rarity));
        }

        // Python's round(), which card-economy.py uses: half to even.
        return (long)Math.Round(100m * (usd + surcharge), MidpointRounding.ToEven);
    }

    /// <summary>What a vendor pays for a card it would sell at <paramref name="listPrice"/>: half, rounded down.</summary>
    public static long BuyPrice(long listPrice) => listPrice / 2;
}
