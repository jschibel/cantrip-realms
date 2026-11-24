using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Cantrip.Realms.Server;
using Cantrip.Realms.Server.Content;
using Cantrip.Server.Rules;

namespace Cantrip.Realms.Balance;

/// <summary>
/// The balance lab's command line (tools/realms/balance.cmd; realms/docs/tech.md C5): plays reference players against the
/// realm's mobs and says how often each wins, with a 95% interval, by tier, by boss, by deck and by mob.
/// </summary>
public static class Program
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public static int Main(string[] args)
    {
        ArgumentNullException.ThrowIfNull(args);
        if (args.Contains("--help") || args.Contains("-h"))
        {
            Console.WriteLine(Help);
            return 0;
        }

        try
        {
            return Run(args);
        }
        catch (ArgumentException error)
        {
            Console.Error.WriteLine(error.Message);
            return 2;
        }
    }

    private const string Help = """
        cantrip-realm-balance: the realm's mobs against reference players, the tactical bot in both seats.

          --games N        games per deck-and-mob pairing of the tiers (4)
          --boss-games N   games per deck-and-boss pairing (20)
          --standing       deal each color boss as its dungeon's run deals it for the deck's colors: an enemy color's
                           boss with its gains. Without it every boss is as its file has it (an own or ally run's),
                           which is what the boss targets are fitted on.
          --mobs LIST      which mobs: t1, t2, t3, t4, boss, wanderers, minibosses, or mob ids, comma-separated (all)
          --decks LIST     which reference decks: starter, upgraded, duo, or their ids; each faces every mob chosen.
                           Without it, the plan: T1 and T2 face the starters, T3 and T4 the upgraded decks, the bosses
                           the upgraded and two-color decks.
          --parallel N     games at once, each on a native host of its own (half the cores, at most 16)
          --seed N         the run's seed; the same seed plays the same games (1)
          --log FILE       each game's result as a JSON line, appended
          --out FILE       the report as Markdown (it is printed too)
          --from FILE      report the games of a log instead of playing (repeatable; later lines of a game win)
          --list           the plan's pairings and game count, and stop
        """;

    private static int Run(string[] args)
    {
        string root = RealmOptions.FindRoot() ?? throw new ArgumentException("Run this inside the repository.");
        List<string> from = Values(args, "--from");
        string? outFile = Value(args, "--out");
        List<GameLine> lines;
        if (from.Count > 0)
        {
            lines = [.. from.SelectMany(File.ReadAllLines).Where(line => line.Length > 0).Select(line => JsonSerializer.Deserialize<GameLine>(line, Json)!)];
        }
        else
        {
            RealmContent content = RealmContent.Load(root);
            List<Reference> references = Lab.References(content, root);
            List<Job> jobs = Plan(content, references, args);
            Console.Error.WriteLine($"{jobs.Count} games: {jobs.Select(job => (job.Reference.Id, job.Mob.Id)).Distinct().Count()} pairings, {jobs.Select(job => job.Mob.Id).Distinct().Count()} mobs, {jobs.Select(job => job.Reference.Id).Distinct().Count()} decks.");
            if (args.Contains("--list")) return 0;
            int parallel = Number(args, "--parallel", Math.Clamp(Environment.ProcessorCount / 2, 1, 16));
            lines = Play(content, jobs, parallel, Value(args, "--log"), args.Contains("--standing"));
        }

        string report = Report(lines);
        Console.WriteLine(report);
        if (outFile is not null) File.WriteAllText(outFile, report);
        return 0;
    }

    /// <summary>One game to play.</summary>
    private sealed record Job(Reference Reference, Mob Mob, int Game, long Seed);

    /// <summary>One game as played, a line of the log.</summary>
    public sealed record GameLine(
        string Reference,
        string Kind,
        string Mob,
        string Group,
        int Tier,
        bool Boss,
        int Life,
        int Hand,
        int MaxHand,
        long Seed,
        bool Won,
        bool Finished,
        int Turn,
        long Milliseconds);

    /// <summary>The group a mob is reported in: a boss by itself, else its tier's wanderers or its tier's mages and wardens.</summary>
    public static string Group(Mob mob)
    {
        ArgumentNullException.ThrowIfNull(mob);
        if (mob.File.Boss) return $"Boss: {mob.Id}";
        return string.Create(Invariant, $"T{mob.File.Tier} {(MiniBoss(mob) ? "mages & wardens" : "wanderers")}");
    }

    private static bool MiniBoss(Mob mob) => mob.Id.StartsWith("mage-", StringComparison.Ordinal) || mob.Id.Contains("warden", StringComparison.Ordinal);

    private static List<Job> Plan(RealmContent content, List<Reference> references, string[] args)
    {
        int games = Number(args, "--games", 4);
        int bossGames = Number(args, "--boss-games", 20);
        long seed = Number(args, "--seed", 1);
        List<string> mobTokens = Values(args, "--mobs").SelectMany(value => value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToList();
        List<string> deckTokens = Values(args, "--decks").SelectMany(value => value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToList();

        foreach (string token in mobTokens.Where(token => !IsMobGroup(token) && !content.Mobs.ContainsKey(token)))
        {
            throw new ArgumentException($"--mobs: no mob or group '{token}'.");
        }

        foreach (string token in deckTokens.Where(token => token is not ("starter" or "upgraded" or "duo") && references.All(reference => reference.Id != token)))
        {
            throw new ArgumentException($"--decks: no reference deck '{token}' (they are {string.Join(", ", references.Select(reference => reference.Id))}).");
        }

        List<Mob> mobs = [.. content.Mobs.Values
            .Where(mob => mobTokens.Count == 0 || mobTokens.Any(token => Matches(token, mob)))
            .OrderBy(mob => mob.File.Boss).ThenBy(mob => mob.File.Tier).ThenBy(mob => mob.Id, StringComparer.Ordinal)];

        IEnumerable<Reference> Facing(Mob mob)
        {
            IEnumerable<Reference> decks = deckTokens.Count > 0
                ? references.Where(reference => deckTokens.Contains(reference.Kind) || deckTokens.Contains(reference.Id))
                : references.Where(reference => mob.File.Boss
                    ? reference.Kind is "upgraded" or "duo"
                    : reference.Kind == (mob.File.Tier <= 2 ? "starter" : "upgraded"));
            return decks.Where(reference => Lab.Faces(reference, mob));
        }

        List<Job> jobs = [];
        foreach (Mob mob in mobs)
        {
            foreach (Reference reference in Facing(mob))
            {
                int count = mob.File.Boss ? bossGames : games;
                for (int game = 0; game < count; game++)
                {
                    jobs.Add(new Job(reference, mob, game, Lab.SeedOf(seed, reference.Id, mob.Id, game)));
                }
            }
        }

        // Game 0 of every pairing first, then game 1, ...: a run cut short has sampled everything evenly.
        return [.. jobs.OrderBy(job => job.Game).ThenBy(job => job.Mob.File.Boss).ThenBy(job => job.Mob.Id, StringComparer.Ordinal).ThenBy(job => job.Reference.Id, StringComparer.Ordinal)];
    }

    private static bool IsMobGroup(string token) => token is "t1" or "t2" or "t3" or "t4" or "boss" or "wanderers" or "minibosses";

    private static bool Matches(string token, Mob mob) => token switch
    {
        "boss" => mob.File.Boss,
        "wanderers" => !mob.File.Boss && !MiniBoss(mob),
        "minibosses" => !mob.File.Boss && MiniBoss(mob),
        ['t', char digit] when char.IsAsciiDigit(digit) => !mob.File.Boss && mob.File.Tier == digit - '0',
        _ => mob.Id == token,
    };

    private static List<GameLine> Play(RealmContent content, List<Job> jobs, int parallel, string? logFile, bool standing)
    {
        var queue = new ConcurrentQueue<Job>(jobs);
        var lines = new ConcurrentBag<GameLine>();
        object writing = new();
        using StreamWriter? log = logFile is null ? null : new StreamWriter(logFile, append: true) { AutoFlush = true };
        var clock = Stopwatch.StartNew();
        int done = 0;
        Console.Error.WriteLine($"Playing on {parallel} native hosts.");

        void Work()
        {
            using NativeHostProcess host = NativeHostProcess.Start();
            while (queue.TryDequeue(out Job? job))
            {
                Duel duel = Lab.Deal(content, job.Reference, job.Mob, job.Seed, standing);
                var game = Stopwatch.StartNew();
                GameResult result;
                try
                {
                    result = Lab.Play(duel, host);
                }
                catch (Exception error) when (error is InvalidOperationException or IOException or RulesRejectedException)
                {
                    Console.Error.WriteLine($"{job.Reference.Id} vs {job.Mob.Id} (seed {job.Seed}): {error.Message}");
                    result = new GameResult(false, [], 0, false);
                }

                DuelSeat mob = duel.Seats[1];
                var line = new GameLine(job.Reference.Id, job.Reference.Kind, job.Mob.Id, Group(job.Mob), job.Mob.File.Tier, job.Mob.File.Boss,
                    mob.StartingLife, mob.StartingHandSize, mob.MaximumHandSize, job.Seed, result.PlayerWon, result.Finished, result.Turn, game.ElapsedMilliseconds);
                lines.Add(line);
                int now = Interlocked.Increment(ref done);
                lock (writing)
                {
                    log?.WriteLine(JsonSerializer.Serialize(line, Json));
                    if (now % 25 == 0 || now == jobs.Count)
                    {
                        double rate = now / clock.Elapsed.TotalSeconds;
                        TimeSpan left = TimeSpan.FromSeconds((jobs.Count - now) / Math.Max(rate, 1e-9));
                        Console.Error.WriteLine(string.Create(Invariant, $"{now}/{jobs.Count} games, {clock.Elapsed:hh\\:mm\\:ss} in, {rate * 60:F1} a minute, about {left:hh\\:mm\\:ss} to go"));
                    }
                }
            }
        }

        Thread[] workers = [.. Enumerable.Range(0, parallel).Select(_ => new Thread(Work) { IsBackground = true })];
        foreach (Thread worker in workers) worker.Start();
        foreach (Thread worker in workers) worker.Join();
        return [.. lines];
    }

    /// <summary>The report: a summary by group, then by deck within each group, then by mob; each a tally with its 95% interval.</summary>
    public static string Report(IReadOnlyList<GameLine> all)
    {
        ArgumentNullException.ThrowIfNull(all);
        // A game logged twice (a log reported with the run it was merged into) counts once: its last line.
        List<GameLine> lines = [.. all.GroupBy(line => (line.Reference, line.Mob, line.Seed)).Select(group => group.Last())];
        var text = new StringBuilder();
        text.AppendLine(Invariant, $"# Balance lab: {lines.Count} games");
        text.AppendLine();
        text.AppendLine(Invariant, $"Unfinished games (counted as not won): {lines.Count(line => !line.Finished)}. Mean game length: {(lines.Count == 0 ? 0 : lines.Average(line => line.Milliseconds) / 1000):F1} s; mean last turn {(lines.Count == 0 ? 0 : lines.Average(line => line.Turn)):F1}.");
        text.AppendLine();

        static string Order(GameLine line) => line.Boss ? $"9{line.Group}" : string.Create(CultureInfo.InvariantCulture, $"{line.Tier}{line.Group}");

        text.AppendLine("## By opponent");
        text.AppendLine();
        text.AppendLine("| Opponent | Decks | Wins/games | Win rate | 95% interval |");
        text.AppendLine("|---|---|---|---|---|");
        foreach (var group in lines.GroupBy(line => (line.Group, line.Kind)).OrderBy(group => Order(group.First())).ThenBy(group => group.Key.Kind, StringComparer.Ordinal))
        {
            text.AppendLine(Invariant, $"| {group.Key.Group} | {group.Key.Kind} | {Tally(group)} |");
        }

        text.AppendLine();
        text.AppendLine("## By opponent and deck");
        text.AppendLine();
        text.AppendLine("| Opponent | Deck | Wins/games | Win rate | 95% interval |");
        text.AppendLine("|---|---|---|---|---|");
        foreach (var group in lines.GroupBy(line => (line.Group, line.Reference)).OrderBy(group => Order(group.First())).ThenBy(group => group.Key.Reference, StringComparer.Ordinal))
        {
            text.AppendLine(Invariant, $"| {group.Key.Group} | {group.Key.Reference} | {Tally(group)} |");
        }

        text.AppendLine();
        text.AppendLine("## By mob");
        text.AppendLine();
        text.AppendLine("| Mob | Group | Life/hand/max (with gear) | Decks | Wins/games | Win rate | 95% interval |");
        text.AppendLine("|---|---|---|---|---|---|---|");
        foreach (var group in lines.GroupBy(line => (line.Mob, line.Kind)).OrderBy(group => Order(group.First())).ThenBy(group => group.Key.Mob, StringComparer.Ordinal).ThenBy(group => group.Key.Kind, StringComparer.Ordinal))
        {
            GameLine last = group.Last();
            text.AppendLine(Invariant, $"| {group.Key.Mob} | {last.Group} | {last.Life}/{last.Hand}/{last.MaxHand} | {group.Key.Kind} | {Tally(group)} |");
        }

        return text.ToString();
    }

    /// <summary>"wins/games | rate | [low, high]": the Wilson score interval at 95%.</summary>
    private static string Tally(IEnumerable<GameLine> games)
    {
        List<GameLine> list = [.. games];
        int n = list.Count, wins = list.Count(line => line.Won);
        (double low, double high) = Lab.Wilson(wins, n);
        return string.Create(Invariant, $"{wins}/{n} | {(n == 0 ? 0 : 100.0 * wins / n):F0}% | {100 * low:F0}-{100 * high:F0}%");
    }

    private static string? Value(string[] args, string name)
    {
        int at = Array.IndexOf(args, name);
        return at >= 0 && at + 1 < args.Length ? args[at + 1] : null;
    }

    private static List<string> Values(string[] args, string name) =>
        [.. args.Select((arg, at) => (arg, at)).Where(pair => pair.arg == name && pair.at + 1 < args.Length).Select(pair => args[pair.at + 1])];

    private static int Number(string[] args, string name, int fallback) =>
        Value(args, name) is { } text
            ? int.TryParse(text, NumberStyles.Integer, Invariant, out int value) && value > 0 ? value : throw new ArgumentException($"{name}: a whole number above zero, not '{text}'.")
            : fallback;
}
