using Cantrip.Client;
using Cantrip.Client.Embedded;
using Cantrip.Client.Tactics;
using Cantrip.Core;
using Cantrip.Protocol;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
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
    public void A_seat_is_dealt_with_its_setup_values_and_emblems_as_its_variant()
    {
        var seat = new DuelSeat("Ann", ["Plains"], [], null, [], 25, 8, 9, ["Circlet of Foresight (gear)"]);
        RulesSeat dealt = NativeDuelVerifier.Seat(seat);
        Assert.Equal(new SeatVariant(25, 8, 9, dealt.Variant!.Emblems), dealt.Variant);
        Assert.Equal(["Circlet of Foresight (gear)"], dealt.Variant.Emblems!);
    }

    /// <summary>A duel of two sample mobs' decks, at the default setup values: what today's engine deals.</summary>
    internal static Duel Sample(long seed = 42)
    {
        DuelSeat Seat(string mob)
        {
            Mob content = RealmApp.Content.Mobs[mob];
            return new DuelSeat(content.File.Name, [.. content.Deck.Entries.SelectMany(entry => Enumerable.Repeat(entry.Card, entry.Copies))], [], null, [], 20, 7, 7, []);
        }

        return new Duel([Seat("benalish-hero"), Seat("bog-raiders")], Duel.RealmMinimumDeckSize, seed, new DuelMob("Bog Raiders", 1));
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
    internal static (List<string> Log, IReadOnlyList<int> Winners) Play(Duel duel, IAutoPlayer player, IAutoPlayer mob, Action<PlayerView>? watch = null)
    {
        IRulesHost rules = NativeDuelVerifier.Deal(duel, NativeHostProcess.Shared);
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
            if (client.View is { } seen) watch?.Invoke(seen);
            idle = playerSeat.Step() || client.IsWaitingOnMe || client.IsSettling || client.IsChecking ? 0 : idle + 1;
            Assert.True(idle < 4, $"Neither seat has anything to do and the game is not over: waiting on {string.Join(",", session.WaitingOn)}, turn {session.Turn}.");
        }

        Assert.True(RealmBot.Settle(mobSeat));
        return ([.. recording.Log], session.WinningSeats);
    }

    /// <summary>
    /// Plays a duel on the table the browser plays it on (<see cref="DuelTable"/>): seat 1 by <paramref name="player"/>,
    /// the table settling the mob's seat before each of its messages, and the player's loop settling it between them as the
    /// browser's ticks do.
    /// </summary>
    private static (IReadOnlyList<string> Log, IReadOnlyList<int> Winners) PlayOnTable(Duel duel, IAutoPlayer player)
    {
        using DuelTable table = DuelTable.Open(duel, NativeHostProcess.Shared);
        var playerSeat = new AutoSeat(table.Player, player);
        for (int idle = 0, steps = 0; !table.IsOver; steps++)
        {
            Assert.True(steps < 100_000, "The duel never ended.");
            Assert.True(table.Settle());
            GameClient client = playerSeat.Client;
            idle = playerSeat.Step() || client.IsWaitingOnMe || client.IsSettling || client.IsChecking ? 0 : idle + 1;
            Assert.True(idle < 4, "Neither seat has anything to do and the game is not over.");
        }

        Assert.True(table.Settle());
        Assert.True(table.Settled);
        return ([.. table.Log], table.Winners);
    }

    [Fact]
    public void A_duel_played_on_the_browsers_table_verifies_with_its_result()
    {
        Duel duel = VerifierPartsTests.Sample(seed: 7);
        (IReadOnlyList<string> log, IReadOnlyList<int> winners) = PlayOnTable(duel, new AutoPlayer());
        DuelVerdict verdict = new NativeDuelVerifier().Verify(duel, log);
        Assert.True(verdict.Accepted, verdict.Problem);
        Assert.Equal(winners, verdict.Winners);
    }

    [Fact]
    public async Task A_duels_starting_life_and_hand_from_gear_stats_reach_the_engine()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");

        // Beside the kit, a crown (one more card in the opening hand) and plate (eight more life).
        List<long> worn = await app.Store(async db =>
        {
            GearOwnedRow crown = new() { PlayerId = browser.Player, GearId = "argivian-crown" };
            GearOwnedRow plate = new() { PlayerId = browser.Player, GearId = "benalish-plate" };
            db.GearOwned.AddRange(crown, plate);
            await db.SaveChangesAsync();
            return new List<long> { crown.Id, plate.Id };
        });
        CharacterView me = await browser.Ok<CharacterView>(HttpMethod.Put, "/api/loadout", new { Slots = new Dictionary<string, long?> { ["head"] = worn[0], ["body"] = worn[1] } });

        // The warden of Serra's sanctum, who wears plate and a pendant of its own.
        RunView run = await app.EnterRun(browser, "benalish-keep");
        RunFloor first = run.Floors[0];
        Assert.Equal("sanctum-warden", first.Warden);
        EncounterView encounter = await RealmApp.Fight(browser, run, 0, first.Encounters.Count, first.Warden!);
        Duel duel = encounter.Duel;
        Assert.Equal((me.Stats.Life, me.Stats.Hand), (duel.Seats[0].StartingLife, duel.Seats[0].StartingHandSize));
        Assert.NotEqual((20, 7), (duel.Seats[0].StartingLife, duel.Seats[0].StartingHandSize));
        Assert.NotEqual(20, duel.Seats[1].StartingLife);

        // Dealt on the native engine as the verifier deals it: each seat starts with its life and draws its hand (CR 103.4,
        // 103.5). Both seats answer one question at a time - who plays first first - until both hands are drawn.
        using var session = new GameSession(NativeDuelVerifier.Deal(duel, NativeHostProcess.Shared));
        var player = new AutoSeat(new LoopbackTransport(session, new PlayerId(Duel.PlayerSeat)), new AutoPlayer());
        var mobSeat = new AutoSeat(new LoopbackTransport(session, new PlayerId(Duel.MobSeat)), RealmBot.Create(duel.Seed));
        session.Start();
        for (int i = 0; i < 20 && (player.Client.View is null || player.Client.View.Players.Any(seat => seat.HandCount == 0)); i++)
        {
            if (!player.Step()) mobSeat.Step();
            player.Client.Pump();
        }

        PlayerView view = player.Client.View!;
        Assert.NotNull(view);
        for (int seat = 1; seat <= 2; seat++)
        {
            PlayerSummaryView summary = view.Players.Single(summary => summary.Seat == seat);
            DuelSeat dealt = duel.Seats[seat - 1];
            Assert.Equal((dealt.StartingLife, dealt.StartingHandSize), (summary.Life, summary.HandCount));
        }
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
    public void A_duel_with_gear_emblems_plays_them_and_verifies()
    {
        // The player wears Tinker's Talisman (a Thopter at its second upkeep), the mob Ring of Thorns (the player discards at
        // its second upkeep): emblems of the fork's own card files, which the fork's cantrip-native-host knows as any card
        // (realms/docs/gear.md). Both begin in their seats' command zones, the Talisman's Thopter comes, and the log of the
        // whole game verifies with the result it had.
        Duel sample = VerifierPartsTests.Sample(7);
        Duel duel = sample with
        {
            Seats = [sample.Seats[0] with { Emblems = ["Tinker's Talisman (gear)"] }, sample.Seats[1] with { Emblems = ["Ring of Thorns (gear)"] }],
        };
        bool inCommand = false, thopter = false;
        (List<string> log, IReadOnlyList<int> winners) = Play(duel, new TacticalPlay(), RealmBot.Create(duel.Seed), view =>
        {
            inCommand |= view.Objects.Any(o => o.Zone == ZoneKindView.Command && o.Name == "Tinker's Talisman (gear)" && o.Owner == Duel.PlayerSeat)
                && view.Objects.Any(o => o.Zone == ZoneKindView.Command && o.Name == "Ring of Thorns (gear)" && o.Owner == Duel.MobSeat);
            thopter |= view.Objects.Any(o => o.Zone == ZoneKindView.Battlefield && o.Name == "Thopter Token" && o.Controller == Duel.PlayerSeat);
        });
        Assert.True(inCommand, "Both seats' emblems were in the command zone.");
        Assert.True(thopter, "The Talisman made its Thopter.");

        DuelVerdict verdict = new NativeDuelVerifier().Verify(duel, log);
        Assert.True(verdict.Accepted, verdict.Problem);
        Assert.Equal(winners, verdict.Winners);

        // The same log without the gear is another game, which it does not fit.
        Assert.False(new NativeDuelVerifier().Verify(sample, log).Accepted);
    }

    [Fact]
    public void A_concession_is_a_whole_game_the_mob_won()
    {
        Duel duel = VerifierPartsTests.Sample();
        DuelVerdict verdict = new NativeDuelVerifier().Verify(duel, [DuelLog.Encode(new ConcedeMessage())]);
        Assert.True(verdict.Accepted, verdict.Problem);
        Assert.Equal([Duel.MobSeat], verdict.Winners);
        Assert.False(verdict.PlayerWon);

        // Each seat's life at the end, as the game had it: untouched, the mob's is all it began with.
        Assert.Equal(duel.Seats[1].StartingLife, verdict.LifeOf(Duel.MobSeat));
        Assert.Equal(duel.Seats[0].StartingLife, verdict.LifeOf(Duel.PlayerSeat));
    }

    [Fact]
    public void A_rematch_is_dealt_with_the_mob_at_its_carried_life_and_the_seat_the_loser_chose_first()
    {
        // An encounter's next game (design.md A3): the mob begins at the life it ended the last with, the player having
        // chosen to draw (the mob plays first, CR 103.1); the log verifies, and says the mob's life at the end as the game had it.
        Duel sample = VerifierPartsTests.Sample(11);
        Duel duel = sample with { Seats = [sample.Seats[0], sample.Seats[1] with { StartingLife = 7 }], Game = 2, FirstPlayer = Duel.MobSeat };
        int? firstActive = null, mobLifeFirst = null;
        (List<string> log, IReadOnlyList<int> winners) = Play(duel, new TacticalPlay(), RealmBot.Create(duel.Seed), view =>
        {
            if (view.Turn >= 1 && firstActive is null)
            {
                firstActive = view.ActivePlayer;
                mobLifeFirst = view.Players.Single(player => player.Seat == Duel.MobSeat).Life;
            }
        });
        Assert.Equal(Duel.MobSeat, firstActive);
        Assert.Equal(7, mobLifeFirst);

        DuelVerdict verdict = new NativeDuelVerifier().Verify(duel, log);
        Assert.True(verdict.Accepted, verdict.Problem);
        Assert.Equal(winners, verdict.Winners);
        Assert.NotNull(verdict.LifeOf(Duel.MobSeat));
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
        MapSpawn spawn = RealmApp.SpawnOf(1);
        await browser.Put(RealmContent.WorldSpace, spawn.At);
        string mob = Spawns.MobOf(browser.Player, RealmContent.WorldSpace, spawn.Id, Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds), spawn.Mobs);
        EncounterView encounter = await browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = spawn.Id, Mob = mob });

        // The browser's part: the duel as the API gave it, seat 1 played by a bot here.
        (List<string> log, IReadOnlyList<int> winners) = Play(encounter.Duel, new TacticalPlay(), RealmBot.Create(encounter.Seed));
        OutcomeView outcome = await browser.Ok<OutcomeView>(HttpMethod.Post, "/api/encounter/finish", new { encounter.Token, Log = log });
        Assert.Equal(winners is [Duel.PlayerSeat] ? "won" : "lost", outcome.Outcome);
        Assert.Null(outcome.Detail is { } detail && detail.StartsWith("The log", StringComparison.Ordinal) ? detail : null);
    }
}

/// <summary>Llanowar's boss on the native engine: Rofellos, Llanowar Emissary, dealt by the server in his hollow and verified.</summary>
[Trait("Category", "WallClock")]
public sealed class RofellosDuelTests
{
    [Fact]
    public async Task A_duel_against_rofellos_in_the_elfhames_hollow_deals_and_verifies()
    {
        await using var app = new RealmApp { NativeVerifier = true };
        Browser browser = await app.Character(1, "G");
        RunView run = await app.EnterRun(browser, "elfhame-hollow");
        Assert.Equal("rofellos", run.Floors[^1].Boss);
        await app.ToFloor(run, run.Floors.Count - 1);
        (int floor, int index) = RealmApp.BossOf(run);
        EncounterView encounter = await RealmApp.Fight(browser, run, floor, index, "rofellos");
        Assert.Equal("Rofellos, Llanowar Emissary", encounter.Duel.Seats[1].Name);
        Assert.Contains("Rofellos, Llanowar Emissary", encounter.Duel.Seats[1].Deck);

        // The browser's part, seat 1 played by a bot here; the server replays the log on the native host and takes it.
        (List<string> log, IReadOnlyList<int> winners) = NativeVerifierTests.Play(encounter.Duel, new TacticalPlay(), RealmBot.Create(encounter.Seed));
        Assert.NotEmpty(winners);
        OutcomeView outcome = await browser.Ok<OutcomeView>(HttpMethod.Post, "/api/encounter/finish", new { encounter.Token, Log = log });
        Assert.Equal(winners is [Duel.PlayerSeat] ? "won" : "lost", outcome.Outcome);
        Assert.Null(outcome.Detail is { } detail && detail.StartsWith("The log", StringComparison.Ordinal) ? detail : null);
    }
}
