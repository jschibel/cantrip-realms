namespace Cantrip.Realms;

/// <summary>
/// Everything a realm duel is dealt from (realms/docs/interfaces.md, <c>Duel</c>): the browser deals it on its engine and
/// the realm server deals the same on the native one to check the result. The player is seat 1, the mob seat 2. Who plays
/// first is the engine's to decide from <see cref="Seed"/> (CR 103.1), so nobody chooses it.
/// </summary>
/// <param name="Seats">Each seat as the host's <c>NewGame</c> names it, with its setup values (design.md A1).</param>
/// <param name="MinimumDeckSize">The realm's minimum deck size, 40 (design.md A2), which the engine is told (CR 100.2a).</param>
/// <param name="Seed">
/// The game's seed: an integer below 2^53, so it survives a JavaScript number on its way through the overworld. The
/// engine deals from it, and the mob's seat is played from it (<see cref="RealmBot"/>).
/// </param>
/// <param name="Mob">Who seat 2 is, as the duel's splash shows it.</param>
/// <param name="AnteValue">The player's ante as the duel began, in gold: the sum of its cards' list prices.</param>
/// <param name="Cap">The prize cap: the least of the ante value and the mob's prize (design.md A3).</param>
public sealed record Duel(IReadOnlyList<DuelSeat> Seats, int MinimumDeckSize, long Seed, DuelMob Mob, long AnteValue, long Cap)
{
    /// <summary>The player's seat.</summary>
    public const int PlayerSeat = 1;

    /// <summary>The mob's seat, which <see cref="RealmBot"/> plays.</summary>
    public const int MobSeat = 2;

    /// <summary>The realm's minimum deck size (design.md A2).</summary>
    public const int RealmMinimumDeckSize = 40;

    /// <summary>The largest seed a duel is dealt from: 2^53 - 1, the largest integer a JavaScript number holds exactly.</summary>
    public const long MaximumSeed = (1L << 53) - 1;
}

/// <summary>
/// One seat of a duel: the host's <c>NewGame</c> seat (docs/host-protocol.md) with the setup values a variant sets, here
/// always said - the character's or the mob's stats with its gear's, and an emblem per worn item with effects, named
/// <c>"&lt;name&gt; (gear)"</c>.
/// </summary>
public sealed record DuelSeat(
    string Name,
    IReadOnlyList<string> Deck,
    IReadOnlyList<string> Sideboard,
    string? Companion,
    IReadOnlyList<string> Commanders,
    int StartingLife,
    int StartingHandSize,
    int MaximumHandSize,
    IReadOnlyList<string> Emblems);

/// <summary>The mob a duel is against: its name, its tier (0 for a boss) and its prize value in gold.</summary>
public sealed record DuelMob(string Name, int Tier, long Prize);
