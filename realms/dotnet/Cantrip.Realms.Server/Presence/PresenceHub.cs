using System.Text.RegularExpressions;
using Cantrip.Realms.Server.Content;

namespace Cantrip.Realms.Server.Presence;

/// <summary>
/// Who is where (realms/docs/interfaces.md, "Presence"; design.md A6). In the world, a player sees the players of their
/// layer within <see cref="AreaChunks"/> chunks of them, each judged by the chunk their walk ends in; a player entering
/// takes the first layer whose players within that distance number fewer than forty, so a crowd spreads over layers. In an
/// interior, a player sees everyone in the same instance of it, forty to an instance. A dungeon run is single-player and
/// shares nothing. Players see each other walk, change their look and emote; nothing else is shared. A walk is points of
/// the space joined by straight lines, walked at any angle: the server checks every walk against the space (each line
/// crossing only tiles walked from tile to tile - on it, nothing blocked, never over a ledge nor cutting the corner of a
/// blocked tile or a ledge, as <see cref="RealmSpace.CanWalk"/> says), against where the player is (a walk starts within
/// <see cref="Slack"/> of where the last has taken them) and against a walking speed, then relays it to those who see the
/// player; clients animate the walks themselves. Time is the injected <see cref="TimeProvider"/>'s.
/// </summary>
public sealed partial class PresenceHub(RealmContent content, RealmOptions options, TimeProvider time, ILogger<PresenceHub>? log = null)
{
    /// <summary>The most points one walk's path may have (after its first).</summary>
    public const int LongestPath = 256;

    /// <summary>The longest one walk may be, tiles.</summary>
    public const double LongestWalk = 256;

    /// <summary>
    /// How far from where the server has the player a walk may start, tiles: what a walk told runs behind or ahead of the
    /// figure walking it by the time it arrives (the overworld tells one every sixth of a second or so).
    /// </summary>
    public const double Slack = 1.5;

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

    /// <summary>Where the hub has each connection of an account now (a development server's <c>GET /dev/where</c>): the space and point.</summary>
    public IReadOnlyList<(int Member, string Space, Point At)> WhereIs(string account)
    {
        lock (_gate)
        {
            long now = Now;
            return
            [
                .. _layers.Values.SelectMany(layer => layer).Concat(_interiors.Values.SelectMany(instances => instances).SelectMany(instance => instance.Members.Values))
                    .Where(member => member.Account == account && member.Space is not null)
                    .Select(member => (member.Id, member.Space!, member.Where(now))),
            ];
        }
    }

    /// <summary>Whether two chunks are near enough for players in them to see each other.</summary>
    public static bool Near((int Cx, int Cz) a, (int Cx, int Cz) b) => Math.Abs(a.Cx - b.Cx) <= AreaChunks && Math.Abs(a.Cz - b.Cz) <= AreaChunks;

    /// <summary>
    /// Puts a player in a space at a tile (its middle): in the world, on the first layer with room around them; in an
    /// interior, in its first instance with room. They are welcomed with everyone they see, and each of those is told of them.
    /// </summary>
    public void Enter(Member member, string space, Tile at)
    {
        ArgumentNullException.ThrowIfNull(member);
        lock (_gate)
        {
            LeaveLocked(member);
            member.Space = space;
            member.From = Point.Middle(at);
            member.Path = [];
            member.Speed = 0;
            member.Since = Now;
            log?.LogInformation("Presence: {Account} (#{Member}) enters {Space} at {X},{Z}", member.Account, member.Id, space, at.X, at.Z);
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
            Point here = member.Where(now);
            if (Problem(member, space, move, here, now) is { } problem)
            {
                log?.LogWarning(
                    "Presence: {Account} (#{Member}) walk refused: {Problem} The walk was from {From} ({Points} points at {Speed}); the server has them at {Here}, along a walk from {WasFrom} of {WasPoints} points at {WasSpeed} told {Ago} ms ago",
                    member.Account, member.Id, problem, move.From is [double fx, double fz] ? new Point(fx, fz).ToString() : "?", move.Path.Length, move.Speed, here,
                    member.From, member.Path.Count, member.Speed, now - member.Since);
                member.Send(new RefusedMessage { Reason = problem, At = [here.X, here.Z] });
                return;
            }

            member.From = new Point(move.From[0], move.From[1]);
            member.Path = [.. move.Path.Select(point => new Point(point[0], point[1]))];
            member.Speed = move.Path.Length == 0 ? 0 : move.Speed;
            member.Since = now;
            member.Moves.Enqueue(now);

            var moved = new MovedMessage { Player = member.Id, From = [member.From.X, member.From.Z], Path = Path(member.Path), Speed = member.Speed, Since = now };
            if (space is not RealmWorld world)
            {
                foreach (Member other in member.Seen) other.Send(moved);
                return;
            }

            member.Area = world.ChunkOf((member.Path.Count > 0 ? member.Path[^1] : member.From).Tile);
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

    private string? Problem(Member member, RealmSpace space, MoveMessage move, Point here, long now)
    {
        static bool IsPoint(double[]? xz) => xz is [double x, double z] && double.IsFinite(x) && double.IsFinite(z);
        if (!IsPoint(move.From) || move.Path.Any(point => !IsPoint(point))) return "A point is [x, z].";
        if (move.Path.Length > LongestPath) return $"A walk is at most {LongestPath} points.";
        while (member.Moves.Count > 0 && member.Moves.Peek() <= now - 1000) member.Moves.Dequeue();
        if (member.Moves.Count >= MovesPerSecond) return "Too many walks at once.";

        var from = new Point(move.From[0], move.From[1]);
        if (!space.Walkable(from.Tile)) return "Nobody can stand there.";
        if (from.DistanceTo(here) > Slack) return "A walk starts where you are.";
        if (move.Path.Length > 0 && (double.IsNaN(move.Speed) || move.Speed <= 0 || move.Speed > options.WalkingSpeed))
        {
            return $"Nobody walks faster than {options.WalkingSpeed} tiles a second.";
        }

        List<Point> path = [.. move.Path.Select(point => new Point(point[0], point[1]))];
        double length = 0;
        Point previous = from;
        foreach (Point next in path)
        {
            length += previous.DistanceTo(next);
            previous = next;
        }

        if (length > LongestWalk) return $"A walk is at most {LongestWalk} tiles.";
        previous = from;
        foreach (Point next in path)
        {
            if (!space.CanWalk(previous, next)) return "The walk leaves the place, crosses something nobody can, or cuts a corner.";
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

    /// <summary>Whether a slot's look is one: a gear mesh (<see cref="RealmContent.GearMeshes"/>) and a few colors.</summary>
    private bool Wearable(SlotLook? look) =>
        look is { Mesh: { Length: > 0 and <= 64 } mesh, Palette: { Count: <= MostLookColors } palette }
        && RealmContent.GearMeshes.ContainsKey(mesh)
        && palette.All(color => color is not null && PaletteColor().IsMatch(color));

    private static OtherMessage Other(Member member) => new()
    {
        Player = member.Id,
        Name = member.Name,
        Identity = member.Identity,
        Look = member.Look,
        At = [member.From.X, member.From.Z],
        Path = Path(member.Path),
        Speed = member.Speed,
        Since = member.Since,
    };

    private static double[][] Path(IReadOnlyList<Point> path) => [.. path.Select(point => new[] { point.X, point.Z })];

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

        /// <summary>In the world, the chunk their walk ends in (the tile its last point is on), which who they see is judged from.</summary>
        public (int Cx, int Cz) Area { get; set; }

        /// <summary>The players who see this one, and whom this one sees.</summary>
        public HashSet<Member> Seen { get; } = [];

        public Point From { get; set; }

        public IReadOnlyList<Point> Path { get; set; } = [];

        public double Speed { get; set; }

        public long Since { get; set; }

        public Queue<long> Moves { get; } = new();

        public Queue<long> Emotes { get; } = new();

        public void Send(PresenceServerMessage message) => send(message);

        /// <summary>Where the player is at a moment: as far along their walk's lines as its speed has brought them since it began.</summary>
        public Point Where(long now)
        {
            if (Path.Count == 0 || Speed <= 0) return Path.Count == 0 ? From : Path[^1];
            double walked = Math.Max(0, now - Since) / 1000.0 * Speed;
            Point at = From;
            foreach (Point next in Path)
            {
                double leg = at.DistanceTo(next);
                if (walked < leg) return at.Toward(next, walked / leg);
                walked -= leg;
                at = next;
            }

            return at;
        }
    }
}
