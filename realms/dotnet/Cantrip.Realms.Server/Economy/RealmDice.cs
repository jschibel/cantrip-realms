using System.Security.Cryptography;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// The realm's randomness: gold and loot rolls, the cards vendors rotate in, the ante card a loss takes, a duel's seed - and
/// its tokens, which come from the operating system's generator. One source for the server, safe from any thread; a test
/// gives a seeded one so a failure repeats, and checks what every roll must satisfy, never a roll's value.
/// </summary>
public sealed class RealmDice(Random? random = null)
{
    private readonly Random _random = random ?? new Random();
    private readonly object _gate = new();

    /// <summary>A whole number from <paramref name="low"/> to <paramref name="high"/>, both included.</summary>
    public long Between(long low, long high)
    {
        if (high < low) throw new ArgumentOutOfRangeException(nameof(high), "The range is empty.");
        lock (_gate) return _random.NextInt64(low, high + 1);
    }

    /// <summary>An index below <paramref name="count"/>.</summary>
    public int Below(int count)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(count);
        lock (_gate) return _random.Next(count);
    }

    /// <summary>Whether a chance of <paramref name="percent"/> in a hundred comes up.</summary>
    public bool Chance(int percent)
    {
        lock (_gate) return _random.Next(100) < percent;
    }

    /// <summary>Up to <paramref name="count"/> different items of a list, in the order drawn.</summary>
    public List<T> Draw<T>(IReadOnlyList<T> items, int count)
    {
        ArgumentNullException.ThrowIfNull(items);
        List<T> left = [.. items];
        List<T> drawn = [];
        lock (_gate)
        {
            while (drawn.Count < count && left.Count > 0)
            {
                int index = _random.Next(left.Count);
                drawn.Add(left[index]);
                left.RemoveAt(index);
            }
        }

        return drawn;
    }

    /// <summary>A duel's seed: below 2^53 (<see cref="Duel.MaximumSeed"/>).</summary>
    public long Seed() => Between(0, Duel.MaximumSeed);

    /// <summary>A duel's token: 128 bits from the operating system, as hex.</summary>
    public static string Token() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
}
