using Cantrip.Client.Tactics;
using Cantrip.Server;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Duels;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// The decks a player first meets are real and playable (design.md A1, A6): each color's starter deck plays a whole duel
/// against a tier 1 wanderer of its own region, as the browser plays one - the player's seat by the tactical bot, the mob's
/// by <see cref="RealmBot"/> - to a winner, and the native verifier takes its log with that result. On the native engine
/// (<c>cargo build --profile cards -p cantrip-host</c> first), so with the wall-clock tests.
/// </summary>
[Trait("Category", "WallClock")]
public sealed class StarterDuelTests
{
    public static TheoryData<string> Colors => new() { "W", "U", "B", "R", "G" };

    [Theory]
    [MemberData(nameof(Colors))]
    public void A_starter_deck_plays_a_whole_duel_against_a_wanderer_of_its_region_that_verifies(string color)
    {
        RealmContent content = RealmApp.Generated;
        DeckList starter = content.Starters[content.World.Plane][color];
        Mob mob = content.Mobs.Values
            .Where(candidate => candidate.File.Region == color && candidate.File.Tier == 1 && !candidate.File.Boss && !candidate.Id.StartsWith("mage-", StringComparison.Ordinal))
            .OrderBy(candidate => candidate.Id, StringComparer.Ordinal)
            .First();
        static List<string> Cards(DeckList deck) => [.. deck.Entries.SelectMany(entry => Enumerable.Repeat(entry.Card, entry.Copies))];

        long seed = 20261123 + color[0];
        var duel = new Duel(
            [new DuelSeat("Tester", Cards(starter), [], null, [], 20, 7, 7, []), new DuelSeat(mob.File.Name, Cards(mob.Deck), [], null, [], mob.File.Stats.Life, mob.File.Stats.Hand, mob.File.Stats.MaxHand, [])],
            Duel.RealmMinimumDeckSize,
            seed,
            new DuelMob(mob.File.Name, mob.File.Tier));

        (List<string> log, IReadOnlyList<int> winners) = NativeVerifierTests.Play(duel, new TacticalPlay(), RealmBot.Create(seed));
        Assert.Single(winners);
        DuelVerdict verdict = new NativeDuelVerifier().Verify(duel, log);
        Assert.True(verdict.Accepted, verdict.Problem);
        Assert.Equal(winners, verdict.Winners);
    }
}
