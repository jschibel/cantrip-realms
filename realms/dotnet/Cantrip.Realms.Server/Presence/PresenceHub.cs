using System.Text.RegularExpressions;
using Cantrip.Realms.Server.Content;

namespace Cantrip.Realms.Server.Presence;

/// <summary>
/// Who is where (realms/docs/interfaces.md, "Presence"; design.md A6): players on the same instance of a map - forty to an
/// instance, another opening when one is full - see each other walk, change their look and emote, and nothing else is
/// shared. The server checks every walk against the map (on it, nothing blocked, each step to a neighbour), against where
/// the player last was (a walk starts at most one hex from there) and against a walking speed, then relays it; clients
/// animate the walks themselves. Time is the injected <see cref="TimeProvider"/>'s.
/// </summary>
public sealed partial class PresenceHub(RealmContent content, RealmOptions options, TimeProvider time)
{
    /// <summary>The longest path one walk may be.</summary>
    public const int LongestPath = 256;

    /// <summary>The most walks a player starts in a second.</summary>
    public const int MovesPerSecond = 10;

    /// <summary>The most emotes a player makes in a second.</summary>
    public const int EmotesPerSecond = 2;

    private readonly object _gate = new();
    private readonly Dictionary<string, List<Instance>> _maps = new(StringComparer.Ordinal);
    private int _next;

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{0,31}$")]
    private static partial Regex EmoteName();

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex PaletteColor();

    /// <summary>The most colors one slot's look names.</summary>
    public const int MostLookColors = 8;

    private long Now => time.GetUtcNow().ToUnixTimeMilliseconds();

    /// <summary>A player connected: who they are, how they look, and where messages to them go.</summary>
    public Member Connect(string account, string name, string identity, LookView look, Action<PresenceServerMessage> send)
    {
        lock (_gate)
        {
            return new Member(++_next, account, name, identity, look, send);
        }
    }

    /// <summary>The players in each instance of a map, for a test or a status page.</summary>
    public IReadOnlyList<int> Instances(string map)
    {
        lock (_gate)
        {
            return _maps.TryGetValue(map, out List<Instance>? instances) ? [.. instances.Select(instance => instance.Members.Count)] : [];
        }
    }

    /// <summary>Puts a player on a map at a hex: the first instance with room, and everyone there told.</summary>
    public void Enter(Member member, string map, Hex at)
    {
        ArgumentNullException.ThrowIfNull(member);
        lock (_gate)
        {
            LeaveLocked(member);
            if (!_maps.TryGetValue(map, out List<Instance>? instances))
            {
                _maps[map] = instances = [];
            }

            Instance instance = instances.Where(open => open.Members.Count < options.InstanceSize).MinBy(open => open.Number)
                ?? new Instance(map, Enumerable.Range(1, instances.Count + 1).First(number => instances.All(open => open.Number != number)));
            if (!instances.Contains(instance)) instances.Add(instance);

            member.Instance = instance;
            member.From = at;
            member.Path = [];
            member.Speed = 0;
            member.Since = Now;

            member.Send(new WelcomeMessage { Instance = instance.Number, Player = member.Id, Others = [.. instance.Members.Values.Select(Other)] });
            OtherMessage arrived = Other(member);
            foreach (Member other in instance.Members.Values) other.Send(arrived);
            instance.Members[member.Id] = member;
        }
    }

    /// <summary>Takes a player off whatever map they were on, everyone there told.</summary>
    public void Leave(Member member)
    {
        ArgumentNullException.ThrowIfNull(member);
        lock (_gate) LeaveLocked(member);
    }

    private void LeaveLocked(Member member)
    {
        if (member.Instance is not { } instance) return;
        instance.Members.Remove(member.Id);
        member.Instance = null;
        foreach (Member other in instance.Members.Values) other.Send(new LeftMessage { Player = member.Id });
        if (instance.Members.Count == 0 && _maps.TryGetValue(instance.Map, out List<Instance>? instances))
        {
            instances.Remove(instance);
            if (instances.Count == 0) _maps.Remove(instance.Map);
        }
    }

    /// <summary>A walk: relayed if it holds, else refused with where the player truly is.</summary>
    public void Move(Member member, MoveMessage move)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(move);
        lock (_gate)
        {
            if (member.Instance is not { } instance)
            {
                member.Send(new RefusedMessage { Reason = "Enter a map first." });
                return;
            }

            long now = Now;
            Hex here = member.Where(now);
            if (Problem(member, instance, move, here, now) is { } problem)
            {
                member.Send(new RefusedMessage { Reason = problem, At = [here.Q, here.R] });
                return;
            }

            member.From = new Hex(move.From[0], move.From[1]);
            member.Path = [.. move.Path.Select(step => new Hex(step[0], step[1]))];
            member.Speed = move.Path.Length == 0 ? 0 : move.Speed;
            member.Since = now;
            member.Moves.Enqueue(now);

            var moved = new MovedMessage { Player = member.Id, From = [member.From.Q, member.From.R], Path = Path(member.Path), Speed = member.Speed, Since = now };
            foreach (Member other in instance.Members.Values.Where(other => other != member)) other.Send(moved);
        }
    }

    private string? Problem(Member member, Instance instance, MoveMessage move, Hex here, long now)
    {
        if (move.From is not [int q, int r] || move.Path.Any(step => step is not [_, _]))
        {
            return "A hex is [q, r].";
        }

        if (move.Path.Length > LongestPath) return $"A walk is at most {LongestPath} hexes.";
        while (member.Moves.Count > 0 && member.Moves.Peek() <= now - 1000) member.Moves.Dequeue();
        if (member.Moves.Count >= MovesPerSecond) return "Too many walks at once.";

        RealmMap? map = content.Maps.GetValueOrDefault(instance.Map);
        var from = new Hex(q, r);
        if (map is null || !map.Walkable(from)) return "Nobody can stand there.";
        if (from.DistanceTo(here) > 1) return "A walk starts where you are.";
        if (move.Path.Length > 0 && (double.IsNaN(move.Speed) || move.Speed <= 0 || move.Speed > options.WalkingSpeed))
        {
            return $"Nobody walks faster than {options.WalkingSpeed} hexes a second.";
        }

        Hex previous = from;
        foreach (int[] step in move.Path)
        {
            var next = new Hex(step[0], step[1]);
            if (next.DistanceTo(previous) != 1) return "Each step of a walk is to a neighbouring hex.";
            if (!map.Walkable(next)) return "The walk leaves the map or crosses something nobody can.";
            previous = next;
        }

        return null;
    }

    /// <summary>A new look, relayed.</summary>
    public void Look(Member member, LookMessage look)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(look);
        lock (_gate)
        {
            if (!Economy.Characters.BodyNames.Contains(look.Body) || look.Palette is < 0 or >= Economy.Characters.Palettes
                || look.Slots is null || look.Slots.Count > RealmContent.LoadoutSlots.Count
                || look.Slots.Any(slot => !RealmContent.LoadoutSlots.ContainsKey(slot.Key) || !Wearable(slot.Value)))
            {
                member.Send(new RefusedMessage { Reason = "A look is a body, a palette and, for any of the loadout's slots, a gear mesh and its colors." });
                return;
            }

            member.Look = new LookView
            {
                Body = look.Body,
                Palette = look.Palette,
                Slots = look.Slots.ToDictionary(slot => slot.Key, slot => new SlotLook { Mesh = slot.Value.Mesh, Palette = [.. slot.Value.Palette] }, StringComparer.Ordinal),
            };
            if (member.Instance is not { } instance) return;
            var looked = new LookedMessage { Player = member.Id, Look = member.Look };
            foreach (Member other in instance.Members.Values.Where(other => other != member)) other.Send(looked);
        }
    }

    /// <summary>An emote, relayed.</summary>
    public void Emote(Member member, EmoteMessage emote)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(emote);
        lock (_gate)
        {
            long now = Now;
            while (member.Emotes.Count > 0 && member.Emotes.Peek() <= now - 1000) member.Emotes.Dequeue();
            if (member.Instance is not { } instance || !EmoteName().IsMatch(emote.Emote) || member.Emotes.Count >= EmotesPerSecond)
            {
                member.Send(new RefusedMessage { Reason = "That emote can't be made now." });
                return;
            }

            member.Emotes.Enqueue(now);
            var emoted = new EmotedMessage { Player = member.Id, Emote = emote.Emote };
            foreach (Member other in instance.Members.Values.Where(other => other != member)) other.Send(emoted);
        }
    }

    /// <summary>Whether a slot's look is one: a gear model's mesh and a few colors.</summary>
    private bool Wearable(SlotLook? look) =>
        look is { Mesh: { Length: > 0 and <= 64 } mesh, Palette: { Count: <= MostLookColors } palette }
        && content.Models.TryGetValue(mesh, out string? kind) && kind == "gear"
        && palette.All(color => color is not null && PaletteColor().IsMatch(color));

    private static OtherMessage Other(Member member) => new()
    {
        Player = member.Id,
        Name = member.Name,
        Identity = member.Identity,
        Look = member.Look,
        At = [member.From.Q, member.From.R],
        Path = Path(member.Path),
        Speed = member.Speed,
        Since = member.Since,
    };

    private static int[][] Path(IReadOnlyList<Hex> path) => [.. path.Select(step => new[] { step.Q, step.R })];

    /// <summary>One instance of a map.</summary>
    public sealed class Instance(string map, int number)
    {
        public string Map { get; } = map;

        public int Number { get; } = number;

        public Dictionary<int, Member> Members { get; } = [];
    }

    /// <summary>A connected player.</summary>
    public sealed class Member(int id, string account, string name, string identity, LookView look, Action<PresenceServerMessage> send)
    {
        public int Id { get; } = id;

        /// <summary>The player's account, which nobody else is told.</summary>
        public string Account { get; } = account;

        public string Name { get; } = name;

        public string Identity { get; } = identity;

        public LookView Look { get; set; } = look;

        public Instance? Instance { get; set; }

        public Hex From { get; set; }

        public IReadOnlyList<Hex> Path { get; set; } = [];

        public double Speed { get; set; }

        public long Since { get; set; }

        public Queue<long> Moves { get; } = new();

        public Queue<long> Emotes { get; } = new();

        public void Send(PresenceServerMessage message) => send(message);

        /// <summary>Where the player is at a moment: as far along their walk as its speed has taken them.</summary>
        public Hex Where(long now)
        {
            if (Path.Count == 0 || Speed <= 0) return Path.Count == 0 ? From : Path[^1];
            long walked = (long)Math.Floor(Math.Max(0, now - Since) / 1000.0 * Speed);
            return walked <= 0 ? From : walked >= Path.Count ? Path[^1] : Path[(int)walked - 1];
        }
    }
}
