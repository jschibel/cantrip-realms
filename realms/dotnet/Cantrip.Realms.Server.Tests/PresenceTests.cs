using System.Net.WebSockets;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Presence;
using MessagePack;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>The presence relay (realms/docs/interfaces.md, "Presence") over real WebSockets in this process.</summary>
public sealed class PresenceTests
{
    private const string Meadow = "benalish-meadow";

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

    /// <summary>A character standing at a hex of the meadow, connected.</summary>
    private static async Task<Walker> Connect(RealmApp app, ulong id, int q, int r)
    {
        Browser browser = await app.Character(id, name: $"Walker {id}");
        await browser.Travel(Meadow, q, r);
        WebSocketClient client = app.Server.CreateWebSocketClient();
        client.ConfigureRequest = request => request.Headers.Cookie = browser.Cookie;
        return new Walker(await client.ConnectAsync(new Uri(app.Server.BaseAddress, PresenceEndpoint.Route), CancellationToken.None));
    }

    private static int[][] Path(params (int Q, int R)[] steps) => [.. steps.Select(step => new[] { step.Q, step.R })];

    [Fact]
    public async Task Players_on_a_map_see_each_other_enter_walk_look_emote_and_leave()
    {
        await using var app = new RealmApp();
        await using Walker ann = await Connect(app, 1, 0, 0);
        await ann.Send(new EnterMessage { Map = Meadow });
        WelcomeMessage annIn = await ann.Next<WelcomeMessage>();
        Assert.Equal(1, annIn.Instance);
        Assert.Empty(annIn.Others);

        await using Walker bob = await Connect(app, 2, 1, 0);
        await bob.Send(new EnterMessage { Map = Meadow });
        WelcomeMessage bobIn = await bob.Next<WelcomeMessage>();
        OtherMessage annSeen = Assert.Single(bobIn.Others);
        Assert.Equal(("Walker 1", "W"), (annSeen.Name, annSeen.Identity));
        Assert.Equal(new[] { 0, 0 }, annSeen.At);
        Assert.Equal(3, annSeen.Look.Slots.Count);

        OtherMessage bobSeen = await ann.Next<OtherMessage>();
        Assert.Equal(bobIn.Player, bobSeen.Player);
        Assert.Equal(new[] { 1, 0 }, bobSeen.At);

        // A walk along the road, relayed with the server's time.
        await ann.Send(new MoveMessage { From = [0, 0], Path = Path((1, -1), (2, -1), (3, -2)), Speed = 3 });
        MovedMessage moved = await bob.Next<MovedMessage>();
        Assert.Equal(annIn.Player, moved.Player);
        Assert.Equal(Path((1, -1), (2, -1), (3, -2)), moved.Path);
        Assert.Equal(app.Time.GetUtcNow().ToUnixTimeMilliseconds(), moved.Since);

        await bob.Send(new LookMessage { Body = 3, Palette = 1, Slots = new() { ["head"] = "circlet" } });
        LookedMessage looked = await ann.Next<LookedMessage>();
        Assert.Equal(("circlet", 3), (looked.Look.Slots["head"], looked.Look.Body));

        await bob.Send(new EmoteMessage { Emote = "wave" });
        Assert.Equal("wave", (await ann.Next<EmotedMessage>()).Emote);

        await bob.DisposeAsync();
        Assert.Equal(bobIn.Player, (await ann.Next<LeftMessage>()).Player);
    }

    [Fact]
    public async Task A_walk_that_leaves_the_ground_or_is_too_fast_or_starts_elsewhere_is_refused()
    {
        await using var app = new RealmApp();
        await using Walker ann = await Connect(app, 1, -3, 4);
        await ann.Send(new EnterMessage { Map = Meadow });
        await ann.Next<WelcomeMessage>();

        // Into the spell table at (-3, 3).
        await ann.Send(new MoveMessage { From = [-3, 4], Path = Path((-3, 3)), Speed = 3 });
        RefusedMessage blocked = await ann.Next<RefusedMessage>();
        Assert.Equal(new[] { -3, 4 }, blocked.At);

        // Two hexes in one step; off the edge of the map; faster than walking; from three hexes away.
        await ann.Send(new MoveMessage { From = [-3, 4], Path = Path((-1, 4)), Speed = 3 });
        Assert.Equal(new[] { -3, 4 }, (await ann.Next<RefusedMessage>()).At);
        await ann.Send(new MoveMessage { From = [-3, 4], Path = Path((-3, 5), (-3, 6), (-3, 7), (-3, 8), (-3, 9), (-3, 10), (-3, 11), (-3, 12), (-3, 13), (-3, 14), (-3, 15), (-3, 16), (-3, 17), (-3, 18), (-3, 19), (-3, 20)), Speed = 3 });
        Assert.Contains("leaves the map", (await ann.Next<RefusedMessage>()).Reason, StringComparison.Ordinal);
        await ann.Send(new MoveMessage { From = [-3, 4], Path = Path((-3, 5)), Speed = 40 });
        Assert.Contains("faster", (await ann.Next<RefusedMessage>()).Reason, StringComparison.Ordinal);
        await ann.Send(new MoveMessage { From = [0, 4], Path = Path((0, 5)), Speed = 3 });
        Assert.Equal(new[] { -3, 4 }, (await ann.Next<RefusedMessage>()).At);
    }

    [Fact]
    public async Task A_new_walk_starts_where_the_last_one_has_taken_the_player()
    {
        await using var app = new RealmApp();
        await using Walker ann = await Connect(app, 1, 0, 0);
        await ann.Send(new EnterMessage { Map = Meadow });
        await ann.Next<WelcomeMessage>();

        // West along the road at two hexes a second.
        await ann.Send(new MoveMessage { From = [0, 0], Path = Path((0, 1), (-1, 2), (-2, 3), (-3, 4), (-4, 5), (-5, 6)), Speed = 2 });

        // At once, a walk from the far end is from six hexes away; two seconds on the player is at (-3, 4).
        await ann.Send(new MoveMessage { From = [-5, 6], Path = [], Speed = 0 });
        Assert.Equal(new[] { 0, 0 }, (await ann.Next<RefusedMessage>()).At);
        app.Time.Advance(TimeSpan.FromSeconds(2));
        await ann.Send(new MoveMessage { From = [-5, 6], Path = [], Speed = 0 });
        Assert.Equal(new[] { -3, 4 }, (await ann.Next<RefusedMessage>()).At);

        // From the next hex along, it is taken: nothing comes back but the refused emote after it.
        await ann.Send(new MoveMessage { From = [-4, 5], Path = Path((-5, 5)), Speed = 2 });
        await ann.Send(new EmoteMessage { Emote = "bad emote!" });
        Assert.Equal("That emote can't be made now.", (await ann.Next<RefusedMessage>()).Reason);
    }

    [Fact]
    public async Task A_player_enters_only_the_map_they_stand_on()
    {
        await using var app = new RealmApp();
        await using Walker ann = await Connect(app, 1, 0, 0);
        await ann.Send(new EnterMessage { Map = "new-argive" });
        Assert.Equal("You are not on that map.", (await ann.Next<RefusedMessage>()).Reason);
    }

    [Fact]
    public void An_instance_holds_its_number_of_players_and_another_opens_when_it_is_full()
    {
        RealmContent content = RealmApp.Content;
        var options = new RealmOptions { Database = Data.RealmDatabase.Parse("sqlite:unused.db"), Root = RealmApp.Root, InstanceSize = 2 };
        var hub = new PresenceHub(content, options, new FakeTimeProvider(RealmApp.Start));
        List<List<PresenceServerMessage>> inboxes = [];
        List<PresenceHub.Member> members = [];
        for (int i = 0; i < 5; i++)
        {
            List<PresenceServerMessage> inbox = [];
            inboxes.Add(inbox);
            PresenceHub.Member member = hub.Connect($"dev-{i}", $"P{i}", "W", new LookView(), inbox.Add);
            members.Add(member);
            hub.Enter(member, Meadow, new Hex(0, 0));
        }

        Assert.Equal([2, 2, 1], hub.Instances(Meadow));
        Assert.Equal([1, 1, 2, 2, 3], inboxes.Select(inbox => inbox.OfType<WelcomeMessage>().Single().Instance));

        // A place freed in the first instance is the next arrival's.
        hub.Leave(members[0]);
        Assert.IsType<LeftMessage>(inboxes[1][^1]);
        PresenceHub.Member late = hub.Connect("dev-9", "Late", "W", new LookView(), _ => { });
        hub.Enter(late, Meadow, new Hex(0, 0));
        Assert.Equal([2, 2, 1], hub.Instances(Meadow));

        // Nobody outside an instance hears of it.
        Assert.DoesNotContain(inboxes[4], message => message is OtherMessage);
    }
}
