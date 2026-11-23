using System.Net.WebSockets;
using System.Threading.Channels;
using Cantrip.Realms.Server.Auth;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using MessagePack;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Presence;

/// <summary>
/// <c>/realm/ws</c>: a signed-in player's presence connection (realms/docs/interfaces.md, "Presence"). Each frame read is a
/// <see cref="PresenceClientMessage"/> for <see cref="PresenceHub"/>; each it sends back is written by one writer, in order.
/// A frame that is not a message, or a client that cannot keep up, ends the connection.
/// </summary>
public static class PresenceEndpoint
{
    public const string Route = "/realm/ws";

    /// <summary>The largest frame a client sends.</summary>
    public const int LargestFrame = 16 * 1024;

    /// <summary>How many messages wait for a client before it is taken to have gone.</summary>
    public const int Backlog = 1024;

    public static void MapPresence(this IEndpointRouteBuilder app)
    {
        app.Map(Route, async (HttpContext context, PresenceHub hub, RealmContent content, IServiceScopeFactory scopes) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                return Results.BadRequest(new ApiError("BadRequest", "This is a WebSocket."));
            }

            // A page of another site cannot open a player's connection with their cookie.
            if (context.Request.Headers.Origin is [{ } origin] && !Allowed(origin, context.RequestServices.GetRequiredService<RealmOptions>(), context.Request))
            {
                return Results.Json(new ApiError("Forbidden", "Not from this realm's pages."), statusCode: StatusCodes.Status403Forbidden);
            }

            if (RealmSignIn.PlayerId(context) is not { } player)
            {
                return Results.Json(new ApiError(Codes.NotSignedIn, "Sign in first."), statusCode: StatusCodes.Status401Unauthorized);
            }

            CharacterView character;
            PlayerRow row;
            using (IServiceScope scope = scopes.CreateScope())
            {
                Characters characters = scope.ServiceProvider.GetRequiredService<Characters>();
                try
                {
                    character = await characters.View(player).ConfigureAwait(false);
                }
                catch (Refusal refusal)
                {
                    return Results.Json(new ApiError(refusal.Code, refusal.Message), statusCode: refusal.Status);
                }

                row = await scope.ServiceProvider.GetRequiredService<RealmDb>().Players.AsNoTracking().SingleAsync(stored => stored.Id == player).ConfigureAwait(false);
            }

            using WebSocket socket = await context.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
            var outbox = Channel.CreateBounded<PresenceServerMessage>(new BoundedChannelOptions(Backlog) { SingleReader = true });
            using var ending = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            var look = new LookView
            {
                Body = character.Body,
                Palette = character.Palette,
                Slots = character.Loadout.Where(slot => slot.Value is not null).ToDictionary(slot => slot.Key, slot => slot.Value!.Gear.Look.Mesh, StringComparer.Ordinal),
            };
            PresenceHub.Member member = hub.Connect(player, character.Name, character.Identity, look, message =>
            {
                if (!outbox.Writer.TryWrite(message)) ending.Cancel();
            });

            Task writing = Write(socket, outbox.Reader, ending.Token);
            try
            {
                await Read(socket, hub, member, row, scopes, ending.Token).ConfigureAwait(false);
            }
            catch (Exception problem) when (problem is OperationCanceledException or WebSocketException or MessagePackSerializationException)
            {
                // The client went, or sent what is not a message: either way the connection ends.
            }
            finally
            {
                hub.Leave(member);
                outbox.Writer.TryComplete();
                await ending.CancelAsync().ConfigureAwait(false);
                try
                {
                    await writing.ConfigureAwait(false);
                }
                catch (Exception problem) when (problem is OperationCanceledException or WebSocketException)
                {
                }
            }

            return Results.Empty;
        });
    }

    /// <summary>Whether a connection's origin is the world client's (<see cref="RealmOptions.Client"/>) or the server's own.</summary>
    private static bool Allowed(string origin, RealmOptions options, HttpRequest request) =>
        Uri.TryCreate(origin, UriKind.Absolute, out Uri? from)
        && (string.Equals(from.GetLeftPart(UriPartial.Authority), options.Client?.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase)
            || string.Equals(from.Authority, request.Host.Value, StringComparison.OrdinalIgnoreCase));

    private static async Task Read(WebSocket socket, PresenceHub hub, PresenceHub.Member member, PlayerRow row, IServiceScopeFactory scopes, CancellationToken cancel)
    {
        byte[] buffer = new byte[LargestFrame];
        while (socket.State == WebSocketState.Open && !cancel.IsCancellationRequested)
        {
            int length = 0;
            ValueWebSocketReceiveResult received;
            do
            {
                if (length == buffer.Length)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.MessageTooBig, "A frame is at most 16 KB.", cancel).ConfigureAwait(false);
                    return;
                }

                received = await socket.ReceiveAsync(buffer.AsMemory(length), cancel).ConfigureAwait(false);
                if (received.MessageType == WebSocketMessageType.Close)
                {
                    await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, cancel).ConfigureAwait(false);
                    return;
                }

                length += received.Count;
            }
            while (!received.EndOfMessage);

            PresenceClientMessage message = MessagePackSerializer.Deserialize<PresenceClientMessage>(buffer.AsMemory(0, length), cancellationToken: cancel);
            switch (message)
            {
                case EnterMessage enter:
                    // The map the character last reported standing on (/api/travel), at the hex they reported.
                    using (IServiceScope scope = scopes.CreateScope())
                    {
                        PlayerRow now = await scope.ServiceProvider.GetRequiredService<RealmDb>().Players.AsNoTracking()
                            .SingleAsync(stored => stored.Id == row.Id, cancel).ConfigureAwait(false);
                        if (now.Map != enter.Map)
                        {
                            member.Send(new RefusedMessage { Reason = "You are not on that map.", At = [now.Q, now.R] });
                            break;
                        }

                        hub.Enter(member, now.Map, new Hex(now.Q, now.R));
                    }

                    break;
                case MoveMessage move:
                    hub.Move(member, move);
                    break;
                case LookMessage look:
                    hub.Look(member, look);
                    break;
                case EmoteMessage emote:
                    hub.Emote(member, emote);
                    break;
            }
        }
    }

    private static async Task Write(WebSocket socket, ChannelReader<PresenceServerMessage> outbox, CancellationToken cancel)
    {
        await foreach (PresenceServerMessage message in outbox.ReadAllAsync(cancel).ConfigureAwait(false))
        {
            byte[] frame = MessagePackSerializer.Serialize(message, cancellationToken: cancel);
            await socket.SendAsync(frame, WebSocketMessageType.Binary, endOfMessage: true, cancel).ConfigureAwait(false);
        }
    }
}
