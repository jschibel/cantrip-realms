namespace Cantrip.Realms.Server.Duels;

/// <summary>
/// What checking a duel's log found: whether the log is a whole game of the duel as dealt, and if so who won it, by seat.
/// </summary>
/// <param name="Accepted">Whether every message of the log was taken and the game is over at its end.</param>
/// <param name="Winners">The seats that won, empty for a draw; empty too for a log not accepted.</param>
/// <param name="Problem">Why the log was not accepted, in words; null when it was.</param>
public sealed record DuelVerdict(bool Accepted, IReadOnlyList<int> Winners, string? Problem)
{
    public static DuelVerdict Rejected(string problem) => new(false, [], problem);

    /// <summary>Whether the player, seat 1, won alone.</summary>
    public bool PlayerWon => Accepted && Winners is [Duel.PlayerSeat];
}

/// <summary>
/// Checks a duel the browser played (realms/docs/interfaces.md, <c>Log</c>; tech.md B4, "the encounter protocol"): deals the
/// same <see cref="Duel"/>, plays seat 1's logged messages back, answers seat 2 as the browser's bot did, and says whether
/// the game it comes to is over and who won. The real one is <see cref="NativeDuelVerifier"/>; tests of everything around
/// it give a fake.
/// </summary>
public interface IDuelVerifier
{
    /// <summary>Checks a log against a duel. Never throws for a bad log: a log that can't be played is a rejected one.</summary>
    DuelVerdict Verify(Duel duel, IReadOnlyList<string> log);
}
