using Cantrip.Client;
using Cantrip.Client.Tactics;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Economy;
using Cantrip.Server;
using Cantrip.Server.Rules;

namespace Cantrip.Realms.Balance;

/// <summary>
/// A player the lab seats against the mobs: a reference deck and what it wears. <paramref name="Kind"/> is
/// <c>starter</c> (a color's starter deck with the starting kit, design.md A1), <c>upgraded</c> (that color's deck of
/// <c>decks/realms/dominaria/reference</c> with <see cref="Lab.UpgradedGear"/>) or <c>duo</c> (a strong two-color deck
/// of that folder, with the same gear); <paramref name="Colors"/> is its identity, in WUBRG order.
/// </summary>
public sealed record Reference(string Id, string Kind, string Colors, IReadOnlyList<string> Deck, IReadOnlyList<GearItem> Gear);

/// <summary>One game's result: whether seat 1 alone won (the realm's only win), the winners, the turn it ended on, and whether it ended at all.</summary>
public sealed record GameResult(bool PlayerWon, IReadOnlyList<int> Winners, int Turn, bool Finished);

/// <summary>
/// The lab's dealing and playing (realms/docs/tech.md C5). A game is a <see cref="Duel"/> the realm server would deal
/// for that player and mob as an encounter's first game (<see cref="Encounters.Deal"/>,
/// <see cref="Encounters.PlayerSeat(string, IReadOnlyList{GearItem}, IEnumerable{string}, IEnumerable{string}?)"/>,
/// <see cref="Encounters.MobSeat(RealmContent, Mob, GearStats?)"/>), with no sideboard, played to its end
/// on the table the browser plays one on (<see cref="DuelTable"/>): the player's seat by the tactical bot, the mob's by
/// <see cref="RealmBot"/> on the duel's seed, as in the realm.
/// </summary>
public static class Lab
{
    /// <summary>Where the reference decks are, from the repository root.</summary>
    public const string ReferenceFolder = "decks/realms/dominaria/reference";

    /// <summary>The starter decks' files by color, as the content names them.</summary>
    private static readonly IReadOnlyDictionary<string, string> ColorNames = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["W"] = "white",
        ["U"] = "blue",
        ["B"] = "black",
        ["R"] = "red",
        ["G"] = "green",
    };

    /// <summary>The two-color reference decks and their identities.</summary>
    private static readonly IReadOnlyDictionary<string, string> Duos = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["white-blue"] = "WU",
        ["black-red"] = "BR",
    };

    /// <summary>
    /// What an upgraded player wears: uncommon items in four slots, of the kind T3 drops and armorers sell (design.md
    /// A3, A4) - a head (a maximum hand and a card on turn 4), a neck (two more maximum hand), a body (five life) and feet
    /// (an extra land on turn 2).
    /// </summary>
    public static IReadOnlyList<string> UpgradedGear { get; } = ["circlet-of-foresight", "silver-pendant", "chain-hauberk", "boots-of-the-march"];

    /// <summary>Every reference player: the five starters, the five upgraded decks and the two-color decks.</summary>
    public static List<Reference> References(RealmContent content, string root)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(root);
        List<Reference> all = [];
        List<GearItem> kit = [.. Characters.StartingKit(content).Select(pair => pair.Item)];
        List<GearItem> upgraded = Worn(content, UpgradedGear);
        foreach ((string color, string name) in ColorNames)
        {
            DeckList starter = content.Starters[content.World.Plane][color];
            all.Add(new Reference($"starter-{name}", "starter", color, Cards(starter), kit));
        }

        foreach ((string color, string name) in ColorNames)
        {
            all.Add(new Reference($"upgraded-{name}", "upgraded", color, Cards(Read(root, name)), upgraded));
        }

        foreach ((string name, string colors) in Duos)
        {
            all.Add(new Reference($"duo-{name}", "duo", colors, Cards(Read(root, name)), upgraded));
        }

        return all;
    }

    /// <summary>Items by id, in loadout order (head, neck, body, hands, feet, rings, relic), as a character wears them.</summary>
    public static List<GearItem> Worn(RealmContent content, IEnumerable<string> ids)
    {
        ArgumentNullException.ThrowIfNull(content);
        List<string> slots = [.. RealmContent.LoadoutSlots.Values.Distinct()];
        return [.. ids.Select(id => content.Gear.TryGetValue(id, out GearItem? item) ? item : throw new ArgumentException($"No gear item '{id}'."))
            .OrderBy(item => slots.IndexOf(item.Slot))];
    }

    /// <summary>
    /// Whether the design lets a reference deck face a mob: a boss that unlocks a color is fought before that color is
    /// yours (design.md A6), so a two-color deck holding it does not face it. Every other pairing is allowed.
    /// </summary>
    public static bool Faces(Reference reference, Mob mob)
    {
        ArgumentNullException.ThrowIfNull(reference);
        ArgumentNullException.ThrowIfNull(mob);
        return !(mob.File.Boss && mob.File.Unlocks is { } color && reference.Kind == "duo" && reference.Colors.Contains(color, StringComparison.Ordinal));
    }

    /// <summary>
    /// The duel the realm server would deal this reference player against this mob, on this seed. With
    /// <paramref name="standing"/>, a color boss has what it gains in its dungeon by where its color stands to the player's
    /// (design.md A6, <see cref="Dungeons.BossGains"/>), the reference's first color taken as the one it started with;
    /// without it, the boss is as its file has it, as an own or ally color's run deals it - the stats the lab fits.
    /// </summary>
    public static Duel Deal(RealmContent content, Reference reference, Mob mob, long seed, bool standing = true)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(reference);
        ArgumentNullException.ThrowIfNull(mob);
        DuelSeat player = Encounters.PlayerSeat(reference.Id, reference.Gear, reference.Deck);
        GearStats? gains = standing ? Dungeons.BossGains(content, mob, reference.Colors[..1], reference.Colors) : null;
        return Encounters.Deal(player, Encounters.MobSeat(content, mob, gains), mob, seed);
    }

    /// <summary>
    /// Plays a duel to its end on the browser's table, on <paramref name="host"/>: seat 1 by the tactical bot, seat 2 by
    /// <see cref="RealmBot"/>. A game that is still going after <paramref name="mostSteps"/> of seat 1's steps, or in which
    /// neither seat has anything to do, is unfinished.
    /// </summary>
    public static GameResult Play(Duel duel, IHostTransport host, int mostSteps = 100_000)
    {
        ArgumentNullException.ThrowIfNull(duel);
        using DuelTable table = DuelTable.Open(duel, host);
        var player = new AutoSeat(table.Player, new TacticalPlay(seed: RealmBot.SeedOf(duel.Seed) ^ 0x5EED));
        for (int idle = 0, steps = 0; !table.IsOver; steps++)
        {
            if (steps >= mostSteps || idle >= 4 || !table.Settle()) return new GameResult(false, [], player.Client.View?.Turn ?? 0, false);
            GameClient client = player.Client;
            idle = player.Step() || client.IsWaitingOnMe || client.IsSettling || client.IsChecking ? 0 : idle + 1;
        }

        table.Settle();
        return new GameResult(table.PlayerWon, [.. table.Winners], player.Client.View?.Turn ?? 0, true);
    }

    /// <summary>
    /// A game's seed: from the run's seed, the player, the mob and the game's number, below 2^53 as every duel's is
    /// (<see cref="Duel.MaximumSeed"/>), the same for the same four on every run.
    /// </summary>
    public static long SeedOf(long runSeed, string reference, string mob, int game)
    {
        ulong hash = 14695981039346656037UL;
        foreach (char c in $"{runSeed}|{reference}|{mob}|{game}")
        {
            hash = (hash ^ c) * 1099511628211UL;
        }

        return (long)(hash & (ulong)Duel.MaximumSeed);
    }

    /// <summary>The Wilson score interval for <paramref name="wins"/> of <paramref name="n"/> at 95%.</summary>
    public static (double Low, double High) Wilson(int wins, int n)
    {
        if (n == 0) return (0, 1);
        const double z = 1.959964;
        double p = (double)wins / n, z2 = z * z;
        double centre = (p + z2 / (2 * n)) / (1 + z2 / n);
        double half = z * Math.Sqrt(p * (1 - p) / n + z2 / (4.0 * n * n)) / (1 + z2 / n);
        return (Math.Max(0, centre - half), Math.Min(1, centre + half));
    }

    private static DeckList Read(string root, string name) => DeckList.Load(Path.Combine(root, ReferenceFolder, name + ".txt"));

    private static List<string> Cards(DeckList deck) => [.. deck.Entries.SelectMany(entry => Enumerable.Repeat(entry.Card, entry.Copies))];
}
