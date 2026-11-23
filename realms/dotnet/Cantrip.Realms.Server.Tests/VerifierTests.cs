using System.Text.Json.Nodes;
using Cantrip.Client;
using Cantrip.Client.Embedded;
using Cantrip.Client.Tactics;
using Cantrip.Core;
using Cantrip.Protocol;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Duels;
using Cantrip.Server;
using Cantrip.Server.Rules;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>What the duel verifier is made of, without the engine: the log codec, the bot's seed, the deal's variants.</summary>
public sealed class VerifierPartsTests
{
    [Fact]
    public void A_log_is_each_message_as_the_wire_has_it()
    {
        List<ClientMessage> sent = [new ConcedeMessage(), new AnswerMessage { RequestId = 7 }];
        List<string> log = [.. sent.Select(DuelLog.Encode)];
        IReadOnlyList<ClientMessage> back = DuelLog.Decode(log);
        Assert.IsType<ConcedeMessage>(back[0]);
        Assert.Equal(7, Assert.IsType<AnswerMessage>(back[1]).RequestId);
        Assert.Throws<FormatException>(() => DuelLog.Decode(["not base64!"]));
        Assert.Throws<FormatException>(() => DuelLog.Decode([Convert.ToBase64String([0xc1])]));
    }

    [Fact]
    public void A_log_that_is_no_log_is_rejected_before_any_engine_is_asked()
    {
        var verifier = new NativeDuelVerifier(() => throw new InvalidOperationException("No engine should be started."));
        DuelVerdict verdict = verifier.Verify(Sample(), ["%%%"]);
        Assert.False(verdict.Accepted);
        Assert.Contains("Line 1", verdict.Problem, StringComparison.Ordinal);
    }

    [Fact]
    public void The_bots_seed_is_the_duels_low_bits()
    {
        Assert.Equal(5, RealmBot.SeedOf(5));
        Assert.Equal(int.MaxValue, RealmBot.SeedOf(Duel.MaximumSeed));
        Assert.Equal(1, RealmBot.SeedOf((1L << 31) + 1));
    }

    [Fact]
    public void A_deal_carries_each_seats_variant_as_the_host_names_it()
    {
        string request = """{"Cmd":"NewGame","Seats":[{"Name":"Ann","Deck":[]},{"Name":"Mob","Deck":[]}],"Seed":1}""";
        string dealt = SeatVariantTransport.WithVariants(request, [new SeatVariant(25, 8, 9, ["Circlet of Foresight (gear)"]), null]);
        JsonNode seats = JsonNode.Parse(dealt)!["Seats"]!;
        Assert.Equal(25, seats[0]!["StartingLife"]!.GetValue<int>());
        Assert.Equal(8, seats[0]!["StartingHandSize"]!.GetValue<int>());
        Assert.Equal(9, seats[0]!["MaximumHandSize"]!.GetValue<int>());
        Assert.Equal("Circlet of Foresight (gear)", seats[0]!["Emblems"]![0]!.GetValue<string>());
        Assert.Null(seats[1]!["StartingLife"]);

        string start = """{"Cmd":"Start","GameId":1}""";
        Assert.Same(start, SeatVariantTransport.WithVariants(start, [new SeatVariant(25)]));
    }

    /// <summary>A duel of two sample mobs' decks, at the default setup values: what today's engine deals.</summary>
    internal static Duel Sample(long seed = 42)
    {
        DuelSeat Seat(string mob)
        {
            Mob content = RealmApp.Content.Mobs[mob];
            return new DuelSeat(content.File.Name, [.. content.Deck.Entries.SelectMany(entry => Enumerable.Repeat(entry.Card, entry.Copies))], [], null, [], 20, 7, 7, []);
        }

        return new Duel([Seat("benalish-deserter"), Seat("phyrexian-scout")], Duel.RealmMinimumDeckSize, seed, new DuelMob("Phyrexian Scout", 1, 100), 0, 0);
    }
}

/// <summary>
/// The real verifier on the native engine (<c>cargo build --profile cards -p cantrip-host</c> first): whole games, so they
/// run with the wall-clock tests.
/// </summary>
[Trait("Category", "WallClock")]
public sealed class NativeVerifierTests
{
    /// <summary>
    /// Plays a duel as the browser does: seat 1 by <paramref name="player"/> through a recording transport that settles the
    /// mob's seat before each message, seat 2 by <paramref name="mob"/>. Returns the log and who won.
    /// </summary>
    private static (List<string> Log, IReadOnlyList<int> Winners) Play(Duel duel, IAutoPlayer player, IAutoPlayer mob)
    {
        IHostTransport host = new SeatVariantTransport(NativeHostProcess.Shared, [.. duel.Seats.Select(SeatVariant.Of)]);
        IRulesHost rules = new NativeRulesHostFactory(host).Create([.. duel.Seats.Select(NativeDuelVerifier.Seat)], (ulong)duel.Seed, new RulesGameOptions { MinimumDeckSize = duel.MinimumDeckSize });
        using var session = new GameSession(rules);
        var mobSeat = new AutoSeat(new LoopbackTransport(session, new PlayerId(Duel.MobSeat)), mob);
        var recording = new RecordingTransport(new LoopbackTransport(session, new PlayerId(Duel.PlayerSeat)))
        {
            BeforeSend = () => Assert.True(RealmBot.Settle(mobSeat)),
        };
        var playerSeat = new AutoSeat(recording, player);
        session.Start();

        for (int idle = 0, steps = 0; !session.IsOver; steps++)
        {
            Assert.True(steps < 100_000, "The duel never ended.");
            Assert.True(RealmBot.Settle(mobSeat));
            GameClient client = playerSeat.Client;
            idle = playerSeat.Step() || client.IsWaitingOnMe || client.IsSettling || client.IsChecking ? 0 : idle + 1;
            Assert.True(idle < 4, $"Neither seat has anything to do and the game is not over: waiting on {string.Join(",", session.WaitingOn)}, turn {session.Turn}.");
        }

        Assert.True(RealmBot.Settle(mobSeat));
        return ([.. recording.Log], session.WinningSeats);
    }

    [Fact]
    public void A_whole_duel_played_as_the_browser_plays_it_verifies_with_its_result()
    {
        Duel duel = VerifierPartsTests.Sample();
        (List<string> log, IReadOnlyList<int> winners) = Play(duel, new TacticalPlay(), RealmBot.Create(duel.Seed));
        Assert.NotEmpty(log);

        DuelVerdict verdict = new NativeDuelVerifier().Verify(duel, log);
        Assert.True(verdict.Accepted, verdict.Problem);
        Assert.Equal(winners, verdict.Winners);

        // The same log, the same verdict.
        Assert.Equal(verdict.Winners, new NativeDuelVerifier().Verify(duel, log).Winners);
    }

    [Fact]
    public void A_concession_is_a_whole_game_the_mob_won()
    {
        Duel duel = VerifierPartsTests.Sample();
        DuelVerdict verdict = new NativeDuelVerifier().Verify(duel, [DuelLog.Encode(new ConcedeMessage())]);
        Assert.True(verdict.Accepted, verdict.Problem);
        Assert.Equal([Duel.MobSeat], verdict.Winners);
        Assert.False(verdict.PlayerWon);
    }

    [Fact]
    public void A_tampered_log_is_rejected()
    {
        Duel duel = VerifierPartsTests.Sample();
        (List<string> log, _) = Play(duel, new TacticalPlay(), RealmBot.Create(duel.Seed));
        Assert.True(log.Count > 4);

        // A message taken out of the middle: what follows answers questions never asked.
        List<string> cut = [.. log];
        cut.RemoveAt(log.Count / 2);
        Assert.False(new NativeDuelVerifier().Verify(duel, cut).Accepted);

        // The log stopped half way: the game is not over.
        DuelVerdict half = new NativeDuelVerifier().Verify(duel, log[..(log.Count / 2)]);
        Assert.False(half.Accepted);

        // The same log against another deal of the duel.
        Assert.False(new NativeDuelVerifier().Verify(duel with { Seed = duel.Seed + 1 }, log).Accepted);
    }

    [Fact]
    public void A_log_played_against_another_mob_player_is_rejected()
    {
        // A tampered bot in the browser: seat 2 answered the simple way, not the tactical bot's.
        Duel duel = VerifierPartsTests.Sample();
        (List<string> log, _) = Play(duel, new TacticalPlay(), new AutoPlayer());
        DuelVerdict verdict = new NativeDuelVerifier().Verify(duel, log);
        Assert.False(verdict.Accepted, "A log the mob's seat would have answered otherwise was taken.");
    }

    [Fact]
    public async Task A_duel_started_played_and_finished_through_the_api_is_judged_by_its_game()
    {
        await using var app = new RealmApp { NativeVerifier = true };
        Browser browser = await app.Character(1, "W");
        await browser.Travel("benalish-meadow", 6, 3);
        MapSpawn spawn = RealmApp.Content.Maps["benalish-meadow"].Spawn("s1")!;
        string mob = Spawns.MobOf(browser.Player, "benalish-meadow", "s1", Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds), spawn.Mobs);
        EncounterView encounter = await browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Map = "benalish-meadow", Spawn = "s1", Mob = mob });

        // The browser's part: the duel as the API gave it, seat 1 played by a bot here.
        (List<string> log, IReadOnlyList<int> winners) = Play(encounter.Duel, new TacticalPlay(), RealmBot.Create(encounter.Seed));
        OutcomeView outcome = await browser.Ok<OutcomeView>(HttpMethod.Post, "/api/encounter/finish", new { encounter.Token, Log = log });
        Assert.Equal(winners is [Duel.PlayerSeat] ? "won" : "lost", outcome.Outcome);
        Assert.Null(outcome.Detail is { } detail && detail.StartsWith("The log", StringComparison.Ordinal) ? detail : null);
    }
}
