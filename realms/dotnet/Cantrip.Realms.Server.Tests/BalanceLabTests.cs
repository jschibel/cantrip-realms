using System.Text.Json;
using Cantrip.Decks;
using Cantrip.Realms.Balance;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Economy;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>
/// The balance lab (tools/realms/balance.cmd, realms/docs/tech.md C5) measures the realm's own duels: a lab game is dealt
/// exactly as the server deals the same player's encounter with the same mob, and its reference players are decks a
/// character could hold, wearing the catalogue's gear. Dealing only; the games themselves are the lab's to play.
/// </summary>
public sealed class BalanceLabTests
{
    private static readonly JsonSerializerOptions Json = new();

    [Fact]
    public async Task A_lab_game_deals_the_seats_the_servers_encounter_deals_for_the_same_player_and_mob()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "W");
        MapSpawn spawn = RealmApp.SpawnOf(1);
        await browser.Put(RealmContent.WorldSpace, spawn.At);
        long epoch = Spawns.Epoch(app.Time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds);
        string mobId = Spawns.MobOf(browser.Player, RealmContent.WorldSpace, spawn.Id, epoch, spawn.Mobs);
        EncounterView encounter = await browser.Ok<EncounterView>(HttpMethod.Post, "/api/encounter/start", new { Spawn = spawn.Id, Mob = mobId });
        Duel server = encounter.Duel;

        RealmContent content = RealmApp.Content;
        Reference starter = Lab.References(content, RealmApp.Root).Single(reference => reference.Id == "starter-white");
        Duel lab = Lab.Deal(content, starter, content.Mobs[mobId], server.Seed);

        // The new character is the white starter with the starting kit: the same seat but for its name (and the order its
        // deck is listed in, which the engine shuffles away).
        DuelSeat player = server.Seats[0], seat = lab.Seats[0];
        Assert.Equal(player.Deck.Order(StringComparer.Ordinal), seat.Deck.Order(StringComparer.Ordinal));
        Assert.Equal(Same(player with { Name = string.Empty, Deck = [] }), Same(seat with { Name = string.Empty, Deck = [] }));
        Assert.Equal(Same(server.Seats[1]), Same(lab.Seats[1]));
        Assert.Equal((server.Seed, server.MinimumDeckSize, server.Mob), (lab.Seed, lab.MinimumDeckSize, lab.Mob));
    }

    [Fact]
    public async Task A_lab_game_deals_a_color_boss_as_a_run_of_its_dungeon_deals_it_by_the_players_standing()
    {
        // A black starter against Lyra: Benalia's white is an enemy color, so her keep's run deals her stronger.
        await using var app = new RealmApp();
        Browser browser = await app.Character(1, "B");
        RunView run = await app.EnterRun(browser, "benalish-keep");
        (int floor, int index) = RealmApp.BossOf(run);
        await app.ToFloor(run, floor);
        Duel server = (await RealmApp.Fight(browser, run, floor, index, "lyra-dawnbringer")).Duel;

        RealmContent content = RealmApp.Content;
        Mob lyra = content.Mobs["lyra-dawnbringer"];
        Reference black = Lab.References(content, RealmApp.Root).Single(reference => reference.Id == "starter-black");
        Duel lab = Lab.Deal(content, black, lyra, server.Seed);
        Assert.Equal(Same(server.Seats[1]), Same(lab.Seats[1]));
        Assert.True(lab.Seats[1].StartingLife > Encounters.MobSeat(content, lyra).StartingLife);

        // Against the white starter she is as written: white is her own color.
        Reference white = Lab.References(content, RealmApp.Root).Single(reference => reference.Id == "starter-white");
        Assert.Equal(Same(Encounters.MobSeat(content, lyra)), Same(Lab.Deal(content, white, lyra, server.Seed).Seats[1]));
    }

    [Fact]
    public void Every_reference_deck_is_one_a_character_of_its_colors_could_play_wearing_catalogue_gear()
    {
        RealmContent content = RealmApp.Generated;
        List<Reference> references = Lab.References(content, RealmApp.Root);
        Assert.Equal(["duo", "starter", "upgraded"], references.Select(reference => reference.Kind).Distinct().Order(StringComparer.Ordinal));
        foreach (Reference reference in references)
        {
            List<DeckEntry> main = [.. reference.Deck.GroupBy(card => card, StringComparer.Ordinal).Select(group => new DeckEntry(group.Key, group.Count()))];
            Assert.Empty(DeckChecks.Problems(content.Cards, main, CardPool.Identity(reference.Colors)));
            Assert.All(reference.Gear, item => Assert.False(item.Unique));
            Assert.Equal(reference.Gear.Count, reference.Gear.Select(item => item.Slot).Distinct().Count());
        }

        Assert.All(references.Where(reference => reference.Kind == "upgraded").SelectMany(reference => reference.Gear), item => Assert.Equal("uncommon", item.Rarity));
    }

    [Fact]
    public void A_two_color_deck_never_faces_the_boss_whose_color_it_holds()
    {
        RealmContent content = RealmApp.Generated;
        List<Reference> duos = [.. Lab.References(content, RealmApp.Root).Where(reference => reference.Kind == "duo")];
        foreach (Mob boss in content.Mobs.Values.Where(mob => mob.File.Boss))
        {
            List<Reference> facing = [.. duos.Where(reference => Lab.Faces(reference, boss))];
            Assert.NotEmpty(facing);
            Assert.All(facing, reference => Assert.True(boss.File.Unlocks is null || !reference.Colors.Contains(boss.File.Unlocks, StringComparison.Ordinal)));
        }
    }

    [Fact]
    public void A_games_seed_is_a_duels_and_the_same_for_the_same_game()
    {
        long seed = Lab.SeedOf(1, "upgraded-white", "rofellos", 3);
        Assert.InRange(seed, 0, Duel.MaximumSeed);
        Assert.Equal(seed, Lab.SeedOf(1, "upgraded-white", "rofellos", 3));
        Assert.NotEqual(seed, Lab.SeedOf(1, "upgraded-white", "rofellos", 4));
        Assert.NotEqual(seed, Lab.SeedOf(2, "upgraded-white", "rofellos", 3));
    }

    [Fact]
    public void The_interval_is_wilsons()
    {
        (double low, double high) = Lab.Wilson(50, 100);
        Assert.Equal(0.404, low, 3);
        Assert.Equal(0.596, high, 3);
        Assert.Equal((0.0, 1.0), Lab.Wilson(0, 0));
        Assert.Equal(0.0, Lab.Wilson(0, 10).Low);
        Assert.Equal(1.0, Lab.Wilson(10, 10).High, 9);
    }

    private static string Same(object value) => JsonSerializer.Serialize(value, Json);
}
