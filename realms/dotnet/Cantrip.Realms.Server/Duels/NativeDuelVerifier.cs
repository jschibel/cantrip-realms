using Cantrip.Client;
using Cantrip.Client.Embedded;
using Cantrip.Core;
using Cantrip.Protocol;
using Cantrip.Server;
using Cantrip.Server.Rules;

namespace Cantrip.Realms.Server.Duels;

/// <summary>
/// Checks a duel on the native engine (realms/docs/interfaces.md, <c>Log</c>): deals the <see cref="Duel"/> behind a
/// <see cref="GameSession"/> as the browser did (<c>HostAndPlay</c>'s wiring: a <see cref="LoopbackTransport"/> per seat),
/// plays seat 1's logged messages back in order, and answers seat 2 with <see cref="RealmBot"/> on the duel's seed, as the
/// browser's bot seat did. The log is taken only if no message is refused and the game is over at its end; a log the bot's
/// answers would have played out otherwise, or that a tampered bot made, comes to another game and fails that.
/// <para>
/// The two seats take turns as they did in the browser: before each of seat 1's messages is sent, seat 2 answers
/// everything it has been asked (<see cref="RealmBot.Settle"/>), and again after the last. The browser's realm duel steps
/// its bot seat the same way (interfaces.md says so), so a moment where both seats are asked at once plays out in the same
/// order on both sides.
/// </para>
/// </summary>
public sealed class NativeDuelVerifier(Func<IHostTransport>? host = null) : IDuelVerifier
{
    /// <summary>The most answers the bot gives between two of seat 1's messages before the log is taken to loop.</summary>
    public int MostBotAnswers { get; init; } = 100_000;

    public DuelVerdict Verify(Duel duel, IReadOnlyList<string> log)
    {
        ArgumentNullException.ThrowIfNull(duel);
        ArgumentNullException.ThrowIfNull(log);
        if (duel.Seats.Count != 2) return DuelVerdict.Rejected("A duel has two seats.");

        IReadOnlyList<ClientMessage> messages;
        try
        {
            messages = DuelLog.Decode(log);
        }
        catch (FormatException problem)
        {
            return DuelVerdict.Rejected(problem.Message);
        }

        IRulesHost rules;
        try
        {
            rules = Deal(duel, host?.Invoke() ?? NativeHostProcess.Shared);
        }
        catch (RulesRejectedException refused)
        {
            return DuelVerdict.Rejected($"The engine would not deal the duel: {refused.Detail}");
        }

        using var session = new GameSession(rules);
        var player = new PlayerId(Duel.PlayerSeat);
        var mob = new AutoSeat(new LoopbackTransport(session, new PlayerId(Duel.MobSeat)), RealmBot.Create(duel.Seed));
        session.Start();

        if (Refused(session, player) is { } early) return DuelVerdict.Rejected(early);
        for (int i = 0; i < messages.Count; i++)
        {
            if (!Settle(mob)) return DuelVerdict.Rejected($"The mob's seat was still being asked after its most answers, before message {i + 1}.");
            if (session.IsOver) return DuelVerdict.Rejected($"The game was over before message {i + 1} of {messages.Count}.");
            session.Submit(player, messages[i]);
            if (Refused(session, player) is { } refused) return DuelVerdict.Rejected($"Message {i + 1} ({messages[i].GetType().Name}) was refused: {refused}");
        }

        if (!Settle(mob)) return DuelVerdict.Rejected("The mob's seat was still being asked after its most answers, after the last message.");
        return session.IsOver
            ? new DuelVerdict(true, session.WinningSeats, null)
            : DuelVerdict.Rejected("The game is not over at the end of the log.");
    }

    /// <summary>Deals a duel on a native engine host as the browser deals it (<see cref="DuelTable.Deal"/>, shared with it).</summary>
    public static IRulesHost Deal(Duel duel, IHostTransport host) => DuelTable.Deal(duel, host);

    /// <summary>A duel seat as the rules host deals it (<see cref="DuelTable.Seat"/>).</summary>
    public static RulesSeat Seat(DuelSeat seat) => DuelTable.Seat(seat);

    /// <summary>Has the mob's seat answer everything it has been asked (<see cref="RealmBot.Settle"/>); false if it never stops.</summary>
    private bool Settle(AutoSeat mob) => RealmBot.Settle(mob, MostBotAnswers);

    /// <summary>What the table said was wrong with seat 1's last message, if it refused it; null if it took it.</summary>
    private static string? Refused(GameSession session, PlayerId player) =>
        session.Drain(player).OfType<ErrorMessage>().FirstOrDefault() is { } error ? $"{error.Code}: {error.Detail}" : null;
}
