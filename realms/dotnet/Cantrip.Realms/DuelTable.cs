using Cantrip.Client;
using Cantrip.Client.Embedded;
using Cantrip.Core;
using Cantrip.Protocol;
using Cantrip.Server;
using Cantrip.Server.Rules;

namespace Cantrip.Realms;

/// <summary>
/// A duel dealt to a table in this process (realms/docs/interfaces.md, <c>Duel</c> and <c>Log</c>): the
/// <see cref="Duel"/> dealt on an engine host - the one in the page in the browser, the native one on the server - behind a
/// <see cref="GameSession"/>, seat 2 played by <see cref="RealmBot"/> on the duel's seed, and seat 1's transport a
/// <see cref="RecordingTransport"/> that settles the mob's seat before each message it sends. The browser's realm duel
/// plays on one, and the realm server's replay deals the same way (<see cref="Deal"/>), so the two meet the same game.
/// <para>
/// Nothing here runs on a clock: the replay has none, so a duel's table has none either, and nothing but seat 1's messages
/// and the mob's answers moves the game.
/// </para>
/// </summary>
public sealed class DuelTable : IDisposable
{
    private readonly GameSession _session;
    private readonly RecordingTransport _player;
    private readonly int _mostBotAnswers;

    private DuelTable(GameSession session, AutoSeat mob, int mostBotAnswers)
    {
        _session = session;
        _mostBotAnswers = mostBotAnswers;
        Mob = mob;
        _player = new RecordingTransport(new LoopbackTransport(session, new PlayerId(Duel.PlayerSeat)))
        {
            BeforeSend = () => Settle(),
        };
    }

    /// <summary>
    /// Deals a duel and starts it. Seat 1 is played through <see cref="Player"/>; seat 2 by <see cref="RealmBot"/>, which
    /// the table settles before each of seat 1's messages - and which whoever plays the table settles whenever else it
    /// likes (<see cref="Settle"/>): the mob's answers only ever follow from what the table has asked it, so when it answers
    /// between two of seat 1's messages changes nothing.
    /// </summary>
    /// <exception cref="RulesRejectedException">The engine would not deal the duel.</exception>
    public static DuelTable Open(Duel duel, IHostTransport host, int mostBotAnswers = 100_000)
    {
        ArgumentNullException.ThrowIfNull(duel);
        ArgumentNullException.ThrowIfNull(host);
        var session = new GameSession(Deal(duel, host));
        var mob = new AutoSeat(new LoopbackTransport(session, new PlayerId(Duel.MobSeat)), RealmBot.Create(duel.Seed));
        var table = new DuelTable(session, mob, mostBotAnswers);
        session.Start();
        return table;
    }

    /// <summary>
    /// Deals a duel on an engine host: its seats, its seed, the realm's minimum deck size, who plays first when the player
    /// chose (CR 103.1), and each seat's setup values and emblems as its variant (docs/host-protocol.md, <c>NewGame</c>).
    /// </summary>
    public static IRulesHost Deal(Duel duel, IHostTransport host)
    {
        ArgumentNullException.ThrowIfNull(duel);
        return new NativeRulesHostFactory(host).Create(
            [.. duel.Seats.Select(Seat)],
            unchecked((ulong)duel.Seed),
            new RulesGameOptions { MinimumDeckSize = duel.MinimumDeckSize, FirstPlayer = duel.FirstPlayer });
    }

    /// <summary>
    /// A duel seat as the rules host deals it, its setup values and emblems always said (interfaces.md, <c>Duel</c>), so the
    /// engine never falls back on the format's.
    /// </summary>
    public static RulesSeat Seat(DuelSeat seat)
    {
        ArgumentNullException.ThrowIfNull(seat);
        return new RulesSeat(seat.Name, seat.Deck, seat.Sideboard, seat.Companion)
        {
            Commanders = seat.Commanders,
            Variant = new SeatVariant(seat.StartingLife, seat.StartingHandSize, seat.MaximumHandSize, seat.Emblems),
        };
    }

    /// <summary>Seat 1's transport: what its client sends is logged (<see cref="Log"/>), the mob's seat settled first.</summary>
    public IGameTransport Player => _player;

    /// <summary>What seat 1 has sent the table, as the duel's log.</summary>
    public IReadOnlyList<string> Log => _player.Log;

    /// <summary>The mob's seat.</summary>
    public AutoSeat Mob { get; }

    /// <summary>
    /// False once the mob's seat has gone on being asked past its most answers (<see cref="RealmBot.Settle"/>): a game the
    /// replay would reject.
    /// </summary>
    public bool Settled { get; private set; } = true;

    public bool IsOver => _session.IsOver;

    /// <summary>The seats that won, once the game is over; empty for a draw.</summary>
    public IReadOnlyList<int> Winners => _session.WinningSeats;

    /// <summary>Whether seat 1 alone won: the one result the realm counts as a win (interfaces.md, <c>/api/encounter/finish</c>).</summary>
    public bool PlayerWon => IsOver && Winners is [Duel.PlayerSeat];

    /// <summary>A seat's life total now, as the game shows it to everyone: the mob's at the end is what it carries into the next game.</summary>
    public int Life(int seat) => DuelLife.Of(_session.Rules, seat);

    /// <summary>Has the mob's seat answer everything it has been asked; false if it is still being asked after its most answers.</summary>
    public bool Settle()
    {
        bool settled = RealmBot.Settle(Mob, _mostBotAnswers);
        Settled &= settled;
        return settled;
    }

    public void Dispose()
    {
        _player.Dispose();
        _session.Dispose();
    }
}

/// <summary>A seat's life total in a game, as everyone sees it (each seat's view says every player's).</summary>
public static class DuelLife
{
    public static int Of(IRulesHost rules, int seat)
    {
        ArgumentNullException.ThrowIfNull(rules);
        return rules.View(seat).Players.FirstOrDefault(player => player.Seat == seat)?.Life ?? 0;
    }
}
