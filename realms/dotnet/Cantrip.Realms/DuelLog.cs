using Cantrip.Protocol;
using MessagePack;

namespace Cantrip.Realms;

/// <summary>
/// A duel's log (realms/docs/interfaces.md, <c>Log</c>): every <see cref="ClientMessage"/> seat 1's client sent the table, in
/// order, each MessagePack-serialised as the wire serialises it and base64-encoded. Seat 2's answers are not in it: the
/// server works them out again.
/// </summary>
public static class DuelLog
{
    /// <summary>One message as a log line.</summary>
    public static string Encode(ClientMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        return Convert.ToBase64String(MessagePackSerializer.Serialize(message));
    }

    /// <summary>The messages of a log, in order.</summary>
    /// <exception cref="FormatException">A line that is not base64, or not a client message.</exception>
    public static IReadOnlyList<ClientMessage> Decode(IReadOnlyList<string> log)
    {
        ArgumentNullException.ThrowIfNull(log);
        List<ClientMessage> messages = new(log.Count);
        for (int i = 0; i < log.Count; i++)
        {
            try
            {
                messages.Add(MessagePackSerializer.Deserialize<ClientMessage>(Convert.FromBase64String(log[i] ?? string.Empty))
                    ?? throw new FormatException($"Line {i + 1} of the log is empty."));
            }
            catch (FormatException problem)
            {
                throw new FormatException($"Line {i + 1} of the log is not base64.", problem);
            }
            catch (MessagePackSerializationException problem)
            {
                throw new FormatException($"Line {i + 1} of the log is not a client message.", problem);
            }
        }

        return messages;
    }
}

/// <summary>
/// A seat's transport that keeps the log of what its client sends (<see cref="DuelLog"/>): what the browser wraps seat 1's
/// transport in, and what a test plays a duel through to have a log to check.
/// <para>
/// Before each message goes to the table, <see cref="BeforeSend"/> runs: the host answers everything the mob's seat has been
/// asked there (<c>RealmBot.Settle(mob)</c>), so that seat 2's answers and seat 1's messages reach the table in the order
/// the server's replay sends them (realms/docs/interfaces.md, <c>Log</c>). After the last message, the host settles the
/// mob's seat once more, as it does throughout the game.
/// </para>
/// </summary>
public sealed class RecordingTransport(IGameTransport inner) : IGameTransport
{
    private readonly List<string> _log = [];

    /// <summary>The log so far.</summary>
    public IReadOnlyList<string> Log => _log;

    /// <summary>What runs before each message is sent: the mob's seat settled.</summary>
    public Action? BeforeSend { get; init; }

    public bool IsConnected => inner.IsConnected;

    public void Send(ClientMessage message)
    {
        BeforeSend?.Invoke();
        _log.Add(DuelLog.Encode(message));
        inner.Send(message);
    }

    public IReadOnlyList<ServerMessage> Receive() => inner.Receive();

    public void Dispose() => inner.Dispose();
}
