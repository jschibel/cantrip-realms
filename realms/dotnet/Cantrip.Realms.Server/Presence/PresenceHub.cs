using System.Text.RegularExpressions;
using Cantrip.Realms.Server.Content;

namespace Cantrip.Realms.Server.Presence;

/// <summary>
/// Who is where (realms/docs/interfaces.md, "Presence"; design.md A6). In the world, a player sees the players of their
/// layer within <see cref="AreaChunks"/> chunks of them, each judged by the chunk their walk ends in; a player entering
/// takes the first layer whose players within that distance number fewer than forty, so a crowd spreads over layers. In an
/// interior, a player sees everyone in the same instance of it, forty to an instance. A dungeon run is single-player and
/// shares nothing. Players see each other walk, change their look and emote; nothing else is shared. The server checks
/// every walk against the space (on it, nothing blocked, each step to a neighbour), against where the player last was (a
/// walk starts at most one hex from there) and against a walking speed, then relays it to those who see the player;
/// clients animate the walks themselves. Time is the injected <see cref="TimeProvider"/>'s.
/// </summary>
public sealed partial class PresenceHub(RealmContent content, RealmOptions options, TimeProvider time)
{
    /// <summary>The longest path one walk may be.</summary>
    public const int LongestPath = 256;

    /// <summary>The most walks a player starts in a second.</summary>
    public const int MovesPerSecond = 10;

    /// <summary>The most emotes a player makes in a second.</summary>
    public const int EmotesPerSecond = 2;

    /// <summary>How many chunks apart, along either axis, two players of a layer of the world may be and still see each other.</summary>
    public const int AreaChunks = 2;

    private readonly object _gate = new();

    /// <summary>The world's layers, by number from 1: the players on each.</summary>
    private readonly Dictionary<int, HashSet<Member>> _layers = [];

    /// <summary>Each interior's instances.</summary>
    private readonly Dictionary<string, List<Instance>> _interiors = new(StringComparer.Ordinal);
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

    /// <summary>The players on each layer of the world, or in each instance of an interior, for a test or a status page.</summary>
    public IReadOnlyList<int> Instances(string space)
    {
        lock (_gate)
        {
            return space == RealmContent.WorldSpace
                ? [.. _layers.OrderBy(layer => layer.Key).Select(layer => layer.Value.Count)]
                : _interiors.TryGetValue(space, out List<Instance>? instances) ? [.. instances.Select(instance => instance.Members.Count)] : [];
        }
    }

    /// <summary>Whether two chunks are near enough for players in them to see each other.</summary>
    public static bool Near((int Cq, int Cr) a, (int Cq, int Cr) b) => Math.Abs(a.Cq - b.Cq) <= AreaChunks && Math.Abs(a.Cr - b.Cr) <= AreaChunks;

    /// <summary>
    /// Puts a player in a space at a hex: in the world, on the first layer with room around them; in an interior, in its
    /// first instance with room. They are welcomed with everyone they see, and each of those is told of them.
    /// </summary>
    public void Enter(Member member, string space, Hex at)
    {
        ArgumentNullException.ThrowIfNull(member);
        lock (_gate)
        {
            LeaveLocked(member);
            member.Space = space;
            member.From = at;
            member.Path = [];
            member.Speed = 0;
            member.Since = Now;
            List<Member> seen;
            if (space == RealmContent.WorldSpace)
            {
                member.Area = content.World.ChunkOf(at);
                int layer = Enumerable.Range(1, _layers.Count + 1).First(number =>
                    !_layers.TryGetValue(number, out HashSet<Member>? members) || members.Count(other => Near(other.Area, member.Area)) < options.InstanceSize);
                if (!_layers.TryGetValue(layer, out HashSet<Member>? on)) _layers[layer] = on = [];
                member.Layer = layer;
                seen = [.. on.Where(other => Near(other.Area, member.Area))];
                on.Add(member);
            }
            else
            {
                if (!_interiors.TryGetValue(space, out List<Instance>? instances)) _interiors[space] = instances = [];
                Instance instance = instances.Where(open => open.Members.Count < options.InstanceSize).MinBy(open => open.Number)
                    ?? new Instance(space, Enumerable.Range(1, instances.Count + 1).First(number => instances.All(open => open.Number != number)));
                if (!instances.Contains(instance)) instances.Add(instance);
                member.Instance = instance;
                member.Layer = instance.Number;
                seen = [.. instance.Members.Values];
                instance.Members[member.Id] = member;
            }

            member.Send(new WelcomeMessage { Instance = member.Layer, Player = member.Id, Others = [.. seen.Select(Other)] });
            OtherMessage arrived = Other(member);
            foreach (Member other in seen)
            {
                other.Send(arrived);
                Meet(member, other);
            }
        }
    }

    private static void Meet(Member a, Member b)
    {
        a.Seen.Add(b);
        b.Seen.Add(a);
    }

    private static void Part(Member a, Member b)
    {
        a.Seen.Remove(b);
        b.Seen.Remove(a);
        a.Send(new LeftMessage { Player = b.Id });
        b.Send(new LeftMessage { Player = a.Id });
    }

    /// <summary>Takes a player out of whatever space they were in, everyone who saw them told.</summary>
    public void Leave(Member member)
    {
        ArgumentNullException.ThrowIfNull(member);
        lock (_gate) LeaveLocked(member);
    }

    private void LeaveLocked(Member member)
    {
        if (member.Space is null) return;
        foreach (Member other in member.Seen)
        {
            other.Seen.Remove(member);
            other.Send(new LeftMessage { Player = member.Id });
        }

        member.Seen.Clear();
        if (member.Instance is { } instance)
        {
            instance.Members.Remove(member.Id);
            if (instance.Members.Count == 0 && _interiors.TryGetValue(instance.Space, out List<Instance>? instances))
            {
                instances.Remove(instance);
                if (instances.Count == 0) _interiors.Remove(instance.Space);
            }
        }
        else if (_layers.TryGetValue(member.Layer, out HashSet<Member>? layer))
        {
            layer.Remove(member);
            if (layer.Count == 0) _layers.Remove(member.Layer);
        }

        member.Space = null;
        member.Instance = null;
        member.Layer = 0;
    }

    /// <summary>
    /// A walk: relayed if it holds, else refused with where the player truly is. In the world it may carry the player into
    /// sight of others of their layer, or out of it: the two who come to see each other are each told of the other
    /// (<see cref="OtherMessage"/>), the two who part each that the other has left.
    /// </summary>
    public void Move(Member member, MoveMessage move)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(move);
        lock (_gate)
        {
            if (member.Space is not { } spaceId || content.Space(spaceId) is not { } space)
            {
                member.Send(new RefusedMessage { Reason = "Enter the world or a building first." });
                return;
            }

            long now = Now;
            Hex here = member.Where(now);
            if (Problem(member, space, move, here, now) is { } problem)
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
            if (space is not RealmWorld world)
            {
                foreach (Member other in member.Seen) other.Send(moved);
                return;
            }

            member.Area = world.ChunkOf(member.Path.Count > 0 ? member.Path[^1] : member.From);
            foreach (Member other in _layers[member.Layer].Where(other => other != member).OrderBy(other => other.Id))
            {
                bool sees = member.Seen.Contains(other);
                bool near = Near(member.Area, other.Area);
                if (sees && near)
                {
                    other.Send(moved);
                }
                else if (sees)
                {
                    Part(member, other);
                }
                else if (near)
                {
                    other.Send(Other(member));
                    member.Send(Other(other));
                    Meet(member, other);
                }
            }
        }
    }

    private string? Problem(Member member, RealmSpace space, MoveMessage move, Hex here, long now)
    {
        if (move.From is not [int q, int r] || move.Path.Any(step => step is not [_, _]))
        {
            return "A hex is [q, r].";
        }

        if (move.Path.Length > LongestPath) return $"A walk is at most {LongestPath} hexes.";
        while (member.Moves.Count > 0 && member.Moves.Peek() <= now - 1000) member.Moves.Dequeue();
        if (member.Moves.Count >= MovesPerSecond) return "Too many walks at once.";

        var from = new Hex(q, r);
        if (!space.Walkable(from)) return "Nobody can stand there.";
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
            if (!space.Walkable(next)) return "The walk leaves the place or crosses something nobody can.";
            previous = next;
        }

        return null;
    }

    /// <summary>A new look, relayed to those who see the player.</summary>
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
            var looked = new LookedMessage { Player = member.Id, Look = member.Look };
            foreach (Member other in member.Seen) other.Send(looked);
        }
    }

    /// <summary>An emote, relayed to those who see the player.</summary>
    public void Emote(Member member, EmoteMessage emote)
    {
        ArgumentNullException.ThrowIfNull(member);
        ArgumentNullException.ThrowIfNull(emote);
        lock (_gate)
        {
            long now = Now;
            while (member.Emotes.Count > 0 && member.Emotes.Peek() <= now - 1000) member.Emotes.Dequeue();
            if (member.Space is null || !EmoteName().IsMatch(emote.Emote) || member.Emotes.Count >= EmotesPerSecond)
            {
                member.Send(new RefusedMessage { Reason = "That emote can't be made now." });
                return;
            }

            member.Emotes.Enqueue(now);
            var emoted = new EmotedMessage { Player = member.Id, Emote = emote.Emote };
            foreach (Member other in member.Seen) other.Send(emoted);
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

    /// <summary>One instance of an interior.</summary>
    public sealed class Instance(string space, int number)
    {
        public string Space { get; } = space;

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

        /// <summary>The space the player is in, the world or an interior; null before they enter one.</summary>
        public string? Space { get; set; }

        /// <summary>Their layer of the world, or their interior's instance's number.</summary>
        public int Layer { get; set; }

        /// <summary>Their interior's instance; null in the world.</summary>
        public Instance? Instance { get; set; }

        /// <summary>In the world, the chunk their walk ends in, which who they see is judged from.</summary>
        public (int Cq, int Cr) Area { get; set; }

        /// <summary>The players who see this one, and whom this one sees.</summary>
        public HashSet<Member> Seen { get; } = [];

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
