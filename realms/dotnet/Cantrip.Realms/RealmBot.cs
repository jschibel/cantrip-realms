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
}
