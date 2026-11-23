using System.Net.WebSockets;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Presence;
using MessagePack;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>The presence relay (realms/docs/interfaces.md, "Presence") over real WebSockets in this process.</summary>
public sealed class PresenceTests
{
    private const string World = RealmContent.WorldSpace;

    /// <summary>A player's presence connection.</summary>
    private sealed class Walker(WebSocket socket) : IAsyncDisposable
    {
        public async Task Send(PresenceClientMessage message) =>
            await socket.SendAsync(MessagePackSerializer.Serialize(message), WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);

        /// <summary>The next message, which must come.</summary>
        public async Task<T> Next<T>() where T : PresenceServerMessage
        {
            byte[] buffer = new byte[64 * 1024];
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            int length = 0;
            ValueWebSocketReceiveResult received;
            do
            {
                received = await socket.ReceiveAsync(buffer.AsMemory(length), timeout.Token);
                length += received.Count;
            }
            while (!received.EndOfMessage);

            PresenceServerMessage message = MessagePackSerializer.Deserialize<PresenceServerMessage>(buffer.AsMemory(0, length));
            return Assert.IsType<T>(message);
        }

        public async ValueTask DisposeAsync()
        {
            if (socket.State == WebSocketState.Open)
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
            }

            socket.Dispose();
        }
    }

    /// <summary>A character standing at a tile of a space (the world unless named), connected.</summary>
    private static async Task<Walker> Connect(RealmApp app, ulong id, int x, int z, string space = World)
    {
        Browser browser = await app.Character(id, name: $"Walker {id}");
        await browser.Put(space, new Tile(x, z));
        WebSocketClient client = app.Server.CreateWebSocketClient();
        client.ConfigureRequest = request => request.Headers.Cookie = browser.Cookie;
        return new Walker(await client.ConnectAsync(new Uri(app.Server.BaseAddress, PresenceEndpoint.Route), CancellationToken.None));
    }

    private static int[][] Path(params (int X, int Z)[] steps) => [.. steps.Select(step => new[] { step.X, step.Z })];

    /// <summary>A walk along the x axis, one tile at a time, from a tile (not in the path) to another.</summary>
    private static int[][] Along(int fromX, int toX, int z) =>
        [.. Enumerable.Range(1, Math.Abs(toX - fromX)).Select(step => new[] { fromX + (Math.Sign(toX - fromX) * step), z })];

    [Fact]
    public void A_frame_is_the_union_the_overworld_writes_byte_for_byte()
    {
        // realms/web/src/net/presence.test.ts checks the same bytes from its side.
        Assert.Equal("920081a55370616365a5776f726c64", Convert.ToHexStringLower(MessagePackSerializer.Serialize<PresenceClientMessage>(new EnterMessage { Space = "world" })));
        Assert.Equal(
            "920183a446726f6d920000a45061746891920100a55370656564cb400c000000000000",
            Convert.ToHexStringLower(MessagePackSerializer.Serialize<PresenceClientMessage>(new MoveMessage { From = [0, 0], Path = [[1, 0]], Speed = 3.5 })));
    }

    [Fact]
    public async Task Players_near_each_other_in_the_world_see_each_other_enter_walk_look_emote_and_leave()
    {
        await using var app = new RealmApp();
        await using Walker ann = await Connect(app, 1, 5, 5);
        await ann.Send(new EnterMessage { Space = World });
        WelcomeMessage annIn = await ann.Next<WelcomeMessage>();
        Assert.Equal(1, annIn.Instance);
        Assert.Empty(annIn.Others);

        await using Walker bob = await Connect(app, 2, 6, 5);
        await bob.Send(new EnterMessage { Space = World });
        WelcomeMessage bobIn = await bob.Next<WelcomeMessage>();
        OtherMessage annSeen = Assert.Single(bobIn.Others);
        Assert.Equal(("Walker 1", "W"), (annSeen.Name, annSeen.Identity));
        Assert.Equal(new[] { 5, 5 }, annSeen.At);
        Assert.Equal(3, annSeen.Look.Slots.Count);

        OtherMessage bobSeen = await ann.Next<OtherMessage>();
        Assert.Equal(bobIn.Player, bobSeen.Player);
        Assert.Equal(new[] { 6, 5 }, bobSeen.At);

        // A walk, relayed with the server's time.
        await ann.Send(new MoveMessage { From = [5, 5], Path = Path((6, 4), (7, 4), (8, 3)), Speed = 3 });
        MovedMessage moved = await bob.Next<MovedMessage>();
        Assert.Equal(annIn.Player, moved.Player);
        Assert.Equal(Path((6, 4), (7, 4), (8, 3)), moved.Path);
        Assert.Equal(app.Time.GetUtcNow().ToUnixTimeMilliseconds(), moved.Since);

        await bob.Send(new LookMessage { Body = "stocky", Palette = 1, Slots = new() { ["head"] = new SlotLook { Mesh = "circlet", Palette = ["#f1b44c", "#5b8fd6"] } } });
        LookedMessage looked = await ann.Next<LookedMessage>();
        Assert.Equal(("circlet", "stocky"), (looked.Look.Slots["head"].Mesh, looked.Look.Body));
        Assert.Equal(["#f1b44c", "#5b8fd6"], looked.Look.Slots["head"].Palette);

        await bob.Send(new EmoteMessage { Emote = "wave" });
        Assert.Equal("wave", (await ann.Next<EmotedMessage>()).Emote);

        await bob.DisposeAsync();
        Assert.Equal(bobIn.Player, (await ann.Next<LeftMessage>()).Player);
    }

    [Fact]
    public async Task A_walk_that_leaves_the_ground_cuts_a_corner_or_is_too_fast_or_starts_elsewhere_is_refused()
    {
        await using var app = new RealmApp();
        await using Walker ann = await Connect(app, 1, 25, 5);
        await ann.Send(new EnterMessage { Space = World });
        await ann.Next<WelcomeMessage>();

        // Into the rock at (26, 5).
        await ann.Send(new MoveMessage { From = [25, 5], Path = Path((26, 5)), Speed = 3 });
        RefusedMessage blocked = await ann.Next<RefusedMessage>();
        Assert.Equal(new[] { 25, 5 }, blocked.At);

        // Two tiles in one step; off the edge of the world; faster than walking; from three tiles away.
        await ann.Send(new MoveMessage { From = [25, 5], Path = Path((25, 7)), Speed = 3 });
        Assert.Equal(new[] { 25, 5 }, (await ann.Next<RefusedMessage>()).At);
        await ann.Send(new MoveMessage { From = [25, 5], Path = [.. Enumerable.Range(1, 7).Select(step => new[] { 25, 5 - step })], Speed = 3 });
        Assert.Contains("leaves the place", (await ann.Next<RefusedMessage>()).Reason, StringComparison.Ordinal);
        await ann.Send(new MoveMessage { From = [25, 5], Path = Path((25, 6)), Speed = 40 });
        Assert.Contains("faster", (await ann.Next<RefusedMessage>()).Reason, StringComparison.Ordinal);
        await ann.Send(new MoveMessage { From = [22, 5], Path = Path((22, 6)), Speed = 3 });
        Assert.Equal(new[] { 25, 5 }, (await ann.Next<RefusedMessage>()).At);

        // Down the rock's west side and round its foot: cutting the corner of its last tile, (26, 12), is refused; walking
        // round it is taken, a diagonal step clear of it too (nothing comes back but the refused emote after it).
        int[][] down = [.. Enumerable.Range(6, 7).Select(z => new[] { 25, z })];
        await ann.Send(new MoveMessage { From = [25, 5], Path = [.. down, [26, 13]], Speed = 3 });
        Assert.Contains("cuts a corner", (await ann.Next<RefusedMessage>()).Reason, StringComparison.Ordinal);
        await ann.Send(new MoveMessage { From = [25, 5], Path = [.. down, [25, 13], [26, 13], [27, 14]], Speed = 3 });
        await ann.Send(new EmoteMessage { Emote = "bad emote!" });
        Assert.Equal("That emote can't be made now.", (await ann.Next<RefusedMessage>()).Reason);
    }

    [Fact]
    public async Task A_new_walk_starts_where_the_last_one_has_taken_the_player()
    {
        await using var app = new RealmApp();
        await using Walker ann = await Connect(app, 1, 10, 10);
        await ann.Send(new EnterMessage { Space = World });
        await ann.Next<WelcomeMessage>();

        // A step south, then south-west at two tiles a second: a diagonal step is the square root of 2 tiles long.
        await ann.Send(new MoveMessage { From = [10, 10], Path = Path((10, 11), (9, 12), (8, 13), (7, 14), (6, 15), (5, 16)), Speed = 2 });

        // At once, a walk from the far end is from six tiles away; two seconds on the player has walked 4 tiles, past
        // (8, 13) (1 + 2 x 1.41 along) and short of (7, 14) (1 + 3 x 1.41).
        await ann.Send(new MoveMessage { From = [5, 16], Path = [], Speed = 0 });
        Assert.Equal(new[] { 10, 10 }, (await ann.Next<RefusedMessage>()).At);
        app.Time.Advance(TimeSpan.FromSeconds(2));
        await ann.Send(new MoveMessage { From = [5, 16], Path = [], Speed = 0 });
        Assert.Equal(new[] { 8, 13 }, (await ann.Next<RefusedMessage>()).At);

        // From the next tile along, it is taken: nothing comes back but the refused emote after it.
        await ann.Send(new MoveMessage { From = [7, 14], Path = Path((6, 14)), Speed = 2 });
        await ann.Send(new EmoteMessage { Emote = "bad emote!" });
        Assert.Equal("That emote can't be made now.", (await ann.Next<RefusedMessage>()).Reason);
    }

    [Fact]
    public async Task A_player_enters_only_the_space_they_stand_in_and_never_a_run()
    {
        await using var app = new RealmApp();
        await using Walker ann = await Connect(app, 1, 5, 5);
        await ann.Send(new EnterMessage { Space = "new-benalia-inn" });
        Assert.Equal("You are not there, or nobody else is.", (await ann.Next<RefusedMessage>()).Reason);

        // In a dungeon run, nobody else is.
        await app.Store(db => db.Players.Where(row => row.Id == "dev-1").ExecuteUpdateAsync(set => set.SetProperty(row => row.Space, "run:abc")));
        await ann.Send(new EnterMessage { Space = "run:abc" });
        Assert.Equal("You are not there, or nobody else is.", (await ann.Next<RefusedMessage>()).Reason);
    }

    [Fact]
    public async Task Players_in_an_interior_see_each_other_and_nobody_outside()
    {
        await using var app = new RealmApp();
        await using Walker ann = await Connect(app, 1, 0, 0, "new-benalia-inn");
        await ann.Send(new EnterMessage { Space = "new-benalia-inn" });
        Assert.Empty((await ann.Next<WelcomeMessage>()).Others);

        // Someone in the street outside is not seen inside, nor someone in another building.
        Tile inn = RealmApp.Inn("new-benalia").At;
        await using Walker street = await Connect(app, 2, inn.X, inn.Z);
        await street.Send(new EnterMessage { Space = World });
        Assert.Empty((await street.Next<WelcomeMessage>()).Others);
        await using Walker smith = await Connect(app, 3, 0, 0, "new-benalia-smithy");
        await smith.Send(new EnterMessage { Space = "new-benalia-smithy" });
        Assert.Empty((await smith.Next<WelcomeMessage>()).Others);

        await using Walker bob = await Connect(app, 4, 1, 0, "new-benalia-inn");
        await bob.Send(new EnterMessage { Space = "new-benalia-inn" });
        Assert.Equal("Walker 1", Assert.Single((await bob.Next<WelcomeMessage>()).Others).Name);
        Assert.Equal("Walker 4", (await ann.Next<OtherMessage>()).Name);

        // A walk inside is checked against the interior's own tiles: off its floor, or onto the innkeeper's, is refused.
        await bob.Send(new MoveMessage { From = [1, 0], Path = Path((1, -1)), Speed = 3 });
        Assert.Contains("leaves the place", (await bob.Next<RefusedMessage>()).Reason, StringComparison.Ordinal);
        await bob.Send(new MoveMessage { From = [1, 0], Path = Path((2, 0), (3, 1)), Speed = 3 });
        Assert.Contains("leaves the place", (await bob.Next<RefusedMessage>()).Reason, StringComparison.Ordinal);
        await bob.Send(new MoveMessage { From = [1, 0], Path = Path((2, 0)), Speed = 3 });
        Assert.Equal(Path((2, 0)), (await ann.Next<MovedMessage>()).Path);
    }

    [Fact]
    public async Task A_page_of_another_site_cannot_connect_with_the_players_cookie()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        WebSocketClient client = app.Server.CreateWebSocketClient();
        client.ConfigureRequest = request =>
        {
            request.Headers.Cookie = browser.Cookie;
            request.Headers.Origin = "https://elsewhere.example";
        };
        await Assert.ThrowsAnyAsync<InvalidOperationException>(() => client.ConnectAsync(new Uri(app.Server.BaseAddress, PresenceEndpoint.Route), CancellationToken.None));
    }

    /// <summary>A hub on a fake clock, and a member of it with their inbox.</summary>
    private sealed class Hub(int size)
    {
        public FakeTimeProvider Time { get; } = new(RealmApp.Start);

        public PresenceHub Presence { get; } = new(RealmApp.Content, new RealmOptions { Database = Data.RealmDatabase.Parse("sqlite:unused.db"), Root = RealmApp.Root, InstanceSize = size }, new FakeTimeProvider(RealmApp.Start));

        public (PresenceHub.Member Member, List<PresenceServerMessage> Inbox) Join(string space, Tile at, int number)
        {
            List<PresenceServerMessage> inbox = [];
            PresenceHub.Member member = Presence.Connect($"dev-{number}", $"P{number}", "W", new LookView(), inbox.Add);
            Presence.Enter(member, space, at);
            return (member, inbox);
        }
    }

    [Fact]
    public void Players_come_into_sight_within_two_chunks_and_go_out_of_it_beyond()
    {
        var time = new FakeTimeProvider(RealmApp.Start);
        var presence = new PresenceHub(RealmApp.Content, new RealmOptions { Database = Data.RealmDatabase.Parse("sqlite:unused.db"), Root = RealmApp.Root }, time);
        List<PresenceServerMessage> annBox = [];
        List<PresenceServerMessage> bobBox = [];
        PresenceHub.Member ann = presence.Connect("dev-1", "Ann", "W", new LookView(), annBox.Add);
        PresenceHub.Member bob = presence.Connect("dev-2", "Bob", "W", new LookView(), bobBox.Add);

        // Ann in chunk 0_0, Bob in chunk 3_0: three chunks apart, on the same layer, and neither sees the other.
        presence.Enter(ann, World, new Tile(5, 5));
        presence.Enter(bob, World, new Tile(100, 5));
        Assert.Equal([2], presence.Instances(World));
        Assert.Empty(annBox.OfType<WelcomeMessage>().Single().Others);
        Assert.Empty(bobBox.OfType<WelcomeMessage>().Single().Others);
        Assert.DoesNotContain(annBox, message => message is OtherMessage);

        // Bob walks west into chunk 2_0, two chunks from Ann's: each is told of the other, Bob's walk and all.
        presence.Move(bob, new MoveMessage { From = [100, 5], Path = Along(100, 97, 5), Speed = 4 });
        Assert.DoesNotContain(annBox, message => message is OtherMessage);
        time.Advance(TimeSpan.FromSeconds(2));
        presence.Move(bob, new MoveMessage { From = [97, 5], Path = Along(97, 90, 5), Speed = 4 });
        OtherMessage bobSeen = Assert.Single(annBox.OfType<OtherMessage>());
        Assert.Equal("Bob", bobSeen.Name);
        Assert.Equal(Along(97, 90, 5), bobSeen.Path);
        Assert.Equal("Ann", Assert.Single(bobBox.OfType<OtherMessage>()).Name);

        // In sight, a walk is relayed; Ann's own walk reaches Bob.
        time.Advance(TimeSpan.FromSeconds(2));
        presence.Move(ann, new MoveMessage { From = [5, 5], Path = Path((6, 5)), Speed = 4 });
        Assert.Equal(Path((6, 5)), Assert.Single(bobBox.OfType<MovedMessage>()).Path);
        time.Advance(TimeSpan.FromSeconds(2));

        // Bob walks back east, out of sight: each hears the other has left, and Bob's walks reach Ann no more.
        presence.Move(bob, new MoveMessage { From = [90, 5], Path = Along(90, 96, 5), Speed = 4 });
        Assert.Equal(bob.Id, Assert.Single(annBox.OfType<LeftMessage>()).Player);
        Assert.Equal(ann.Id, Assert.Single(bobBox.OfType<LeftMessage>()).Player);
        int heard = annBox.Count;
        time.Advance(TimeSpan.FromSeconds(2));
        presence.Move(bob, new MoveMessage { From = [96, 5], Path = Along(96, 97, 5), Speed = 4 });
        presence.Emote(bob, new EmoteMessage { Emote = "wave" });
        Assert.Equal(heard, annBox.Count);
    }

    [Fact]
    public void A_crowd_spreads_over_layers_of_forty_and_a_layer_counts_only_those_near()
    {
        var hub = new Hub(2);
        List<(PresenceHub.Member Member, List<PresenceServerMessage> Inbox)> crowd = [.. Enumerable.Range(0, 5).Select(i => hub.Join(World, new Tile(5, 5), i))];
        Assert.Equal([2, 2, 1], hub.Presence.Instances(World));
        Assert.Equal([1, 1, 2, 2, 3], crowd.Select(one => one.Inbox.OfType<WelcomeMessage>().Single().Instance));

        // Far off in chunk 3_3 the first layer has nobody near: a newcomer there takes it, and sees nobody.
        (PresenceHub.Member _, List<PresenceServerMessage> far) = hub.Join(World, new Tile(120, 120), 9);
        Assert.Equal(1, far.OfType<WelcomeMessage>().Single().Instance);
        Assert.Empty(far.OfType<WelcomeMessage>().Single().Others);
        Assert.Equal([3, 2, 1], hub.Presence.Instances(World));

        // A place freed in the first layer near the crowd is the next arrival's there.
        hub.Presence.Leave(crowd[0].Member);
        Assert.IsType<LeftMessage>(crowd[1].Inbox[^1]);
        (PresenceHub.Member _, List<PresenceServerMessage> late) = hub.Join(World, new Tile(6, 5), 10);
        Assert.Equal(1, late.OfType<WelcomeMessage>().Single().Instance);

        // Nobody of another layer hears of anyone.
        Assert.DoesNotContain(crowd[4].Inbox, message => message is OtherMessage);
    }

    [Fact]
    public void An_interiors_instance_holds_its_number_of_players_and_another_opens_when_it_is_full()
    {
        var hub = new Hub(2);
        List<(PresenceHub.Member Member, List<PresenceServerMessage> Inbox)> inside = [.. Enumerable.Range(0, 5).Select(i => hub.Join("new-benalia-inn", new Tile(0, 0), i))];
        Assert.Equal([2, 2, 1], hub.Presence.Instances("new-benalia-inn"));
        Assert.Empty(hub.Presence.Instances(World));
        hub.Presence.Leave(inside[0].Member);
        Assert.IsType<LeftMessage>(inside[1].Inbox[^1]);
        hub.Join("new-benalia-inn", new Tile(0, 0), 9);
        Assert.Equal([2, 2, 1], hub.Presence.Instances("new-benalia-inn"));
        Assert.DoesNotContain(inside[4].Inbox, message => message is OtherMessage);
    }
}
