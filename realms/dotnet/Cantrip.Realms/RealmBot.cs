using Cantrip.Client;
using Cantrip.Client.Tactics;

namespace Cantrip.Realms;

/// <summary>
/// The player the mob's seat of a duel is played by: the tactical bot (<see cref="TacticalPlay"/>), seeded from the duel's
/// seed. The browser plays the mob with this, and the realm server answers seat 2 with this when it replays a duel's log
/// (realms/docs/interfaces.md, <c>Log</c>), so the two play the same seat the same way.
/// <para>
/// <see cref="TacticalPlay"/>'s seed is only drawn from when it explores (<see cref="TacticalPlay.Explore"/>), which play
/// never does: at zero it decides from the view and the prompt alone, the same way every time. The seed is given anyway,
/// from the duel's, so that a seat that one day does draw draws the same on both sides. The web client's own
/// <c>?bot-seed=N</c> (<c>ClientConfig.BotSeed</c>) seeds the same constructor; a realm duel takes its seed from here, not
/// from the page's address.
/// </para>
/// </summary>
public static class RealmBot
{
    /// <summary>The bot's seed for a duel: the duel's seed's low 31 bits.</summary>
    public static int SeedOf(long duelSeed) => (int)(duelSeed & int.MaxValue);

    /// <summary>The mob's player for a duel dealt from <paramref name="duelSeed"/>.</summary>
    public static TacticalPlay Create(long duelSeed) => new(seed: SeedOf(duelSeed));

    /// <summary>
    /// Has the mob's seat answer everything it has been asked, as both sides do before each of seat 1's messages reaches the
    /// table (realms/docs/interfaces.md, <c>Log</c>; <see cref="RecordingTransport.BeforeSend"/>). Returns false if it is
    /// still being asked after <paramref name="most"/> steps.
    /// <para>
    /// A step that answers nothing may still have sent something - a selection the table has just judged is answered as its
    /// verdict is taken in (<see cref="GameClient.IsSettling"/>) - and what that sent is only taken in at the next step. So
    /// the seat is settled after two steps in a row in which it answered nothing and was neither asked, nor settling, nor
    /// waiting on a check: everything the first could have sent, the second has taken in.
    /// </para>
    /// </summary>
    public static bool Settle(AutoSeat mob, int most = 100_000)
    {
        ArgumentNullException.ThrowIfNull(mob);
        int idle = 0;
        for (int steps = 0; steps < most; steps++)
        {
            bool answered = mob.Step();
            GameClient client = mob.Client;
            bool busy = answered || client.IsWaitingOnMe || client.IsSettling || client.IsChecking;
            idle = busy ? 0 : idle + 1;
            if (idle == 2 || client.IsOver) return true;
        }

        return false;
    }
}
