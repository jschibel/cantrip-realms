using System.Globalization;
using System.Text;

namespace Cantrip.Realms;

/// <summary>
/// Which mob stands at a spawn point (realms/docs/interfaces.md, "Spawns"): the overworld shows and walks it, the server
/// checks that a duel's mob could be there. Both make it the same way, and both test against
/// <c>realms/content/spawn-vectors.json</c>.
/// <code>
/// epoch = floor(unix seconds / respawnSeconds)
/// seed  = fnv1a32("&lt;player&gt;|&lt;map&gt;|&lt;spawn&gt;|&lt;epoch&gt;")
/// mob   = mobs[seed % mobs.length]
/// </code>
/// </summary>
public static class Spawns
{
    private const uint OffsetBasis = 2166136261;
    private const uint Prime = 16777619;

    /// <summary>FNV-1a, 32-bit, over the UTF-8 bytes of <paramref name="text"/>.</summary>
    public static uint Fnv1a32(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        uint hash = OffsetBasis;
        foreach (byte b in Encoding.UTF8.GetBytes(text))
        {
            hash ^= b;
            hash = unchecked(hash * Prime);
        }

        return hash;
    }

    /// <summary>The spawn epoch a moment falls in.</summary>
    public static long Epoch(long unixSeconds, int respawnSeconds)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(respawnSeconds);
        return Floor(unixSeconds, respawnSeconds);
    }

    private static long Floor(long value, long divisor)
    {
        long quotient = value / divisor;
        return value % divisor != 0 && (value < 0) != (divisor < 0) ? quotient - 1 : quotient;
    }

    /// <summary>The key a spawn's seed is hashed from.</summary>
    public static string Key(string player, string map, string spawn, long epoch) =>
        string.Create(CultureInfo.InvariantCulture, $"{player}|{map}|{spawn}|{epoch}");

    /// <summary>The seed of a spawn in an epoch.</summary>
    public static uint Seed(string player, string map, string spawn, long epoch) => Fnv1a32(Key(player, map, spawn, epoch));

    /// <summary>The mob a spawn holds for a player in an epoch.</summary>
    public static string MobOf(string player, string map, string spawn, long epoch, IReadOnlyList<string> mobs)
    {
        ArgumentNullException.ThrowIfNull(mobs);
        if (mobs.Count == 0) throw new ArgumentException("A spawn has at least one mob.", nameof(mobs));
        return mobs[(int)(Seed(player, map, spawn, epoch) % (uint)mobs.Count)];
    }
}
