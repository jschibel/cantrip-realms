using System.Collections.Concurrent;
using Cantrip.Realms.Server.Auth;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Duels;
using Cantrip.Realms.Server.Economy;

namespace Cantrip.Realms.Server;

/// <summary>
/// Calls for development and tests alone, mapped only when <c>REALMS_DEV_SIGNIN=1</c> (as <c>POST /dev/signin</c> is), never
/// in production: what an end-to-end suite driving a real server needs to arrange that playing would take too long to
/// reach (realms/docs/interfaces.md, the sign-in bullet).
/// <list type="bullet">
/// <item><c>POST /dev/place {Space, X, Z}</c> puts the signed-in character at once on an open tile of the world or an interior,
/// as a test arranges where it starts; 422 <c>NoSuchPlace</c> for any other.</item>
/// <item><c>POST /dev/verdict {Outcome}</c> judges the signed-in player's duels as it says, <c>won</c> or <c>lost</c>, instead
/// of replaying their logs on the engine, so a stand-in card layer's win counts; <c>null</c> replays them again.</item>
/// <item><c>POST /dev/drop {Gear}</c> decides the signed-in player's gear rolls - a win's and a chest's (design.md A3, A5):
/// <c>true</c> every one comes up, <c>false</c> none does, <c>null</c> the dice decide again. Which item drops is still the
/// dice's.</item>
/// </list>
/// </summary>
public static class DevApi
{
    public static void MapRealmDevApi(this IEndpointRouteBuilder app, RealmOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (!options.DevSignIn)
        {
            return;
        }

        RouteGroupBuilder dev = app.MapGroup("/dev").AddEndpointFilter(async (context, next) =>
        {
            if (RealmSignIn.PlayerId(context.HttpContext) is null)
            {
                return Results.Json(new ApiError(Codes.NotSignedIn, "Sign in first."), statusCode: StatusCodes.Status401Unauthorized);
            }

            try
            {
                return await next(context).ConfigureAwait(false);
            }
            catch (Refusal refusal)
            {
                return Results.Json(new ApiError(refusal.Code, refusal.Message, refusal.Problems), statusCode: refusal.Status);
            }
        });

        dev.MapPost("/place", async (HttpContext context, Characters characters, RealmContent content, PlaceView body) =>
        {
            string player = RealmSignIn.PlayerId(context)!;
            await characters.Require(player).ConfigureAwait(false);
            var at = new Tile(body.X, body.Z);
            if (content.Space(body.Space) is not { } space || !space.Walkable(at))
            {
                throw Refusal.Unprocessable(Codes.NoSuchPlace, "A character is placed on an open tile of the world or an interior.");
            }

            await characters.Place(player, space.Id, at).ConfigureAwait(false);
            return Results.Ok(new { });
        });

        dev.MapPost("/verdict", (HttpContext context, DevVerdicts verdicts, DevVerdict body) =>
        {
            string player = RealmSignIn.PlayerId(context)!;
            switch (body.Outcome)
            {
                case null:
                    verdicts.Clear(player);
                    break;
                case "won" or "lost":
                    verdicts.Set(player, body.Outcome == "won");
                    break;
                default:
                    throw Refusal.BadRequest("A verdict is \"won\", \"lost\" or null.");
            }

            return Results.Ok(new { });
        });

        dev.MapPost("/drop", (HttpContext context, DevVerdicts verdicts, DevDrop body) =>
        {
            verdicts.SetGearRoll(RealmSignIn.PlayerId(context)!, body.Gear);
            return Results.Ok(new { });
        });
    }

    /// <summary><c>POST /dev/verdict</c>'s body.</summary>
    public sealed record DevVerdict(string? Outcome);

    /// <summary><c>POST /dev/drop</c>'s body.</summary>
    public sealed record DevDrop(bool? Gear);
}

/// <summary>
/// The verdicts <c>POST /dev/verdict</c> has set, by player: empty unless a development server's test set one, and then
/// <see cref="Encounters.Finish"/> takes it in place of the verifier's. And the gear rolls <c>POST /dev/drop</c> decided.
/// </summary>
public sealed class DevVerdicts
{
    private readonly ConcurrentDictionary<string, bool> _won = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, bool> _gear = new(StringComparer.Ordinal);

    /// <summary>Decides a player's gear rolls: every one comes up, none does, or (null) the dice's again.</summary>
    public void SetGearRoll(string player, bool? comesUp)
    {
        if (comesUp is { } decided) _gear[player] = decided;
        else _gear.TryRemove(player, out _);
    }

    /// <summary>How a player's gear roll comes out when a test decided it; null when the dice decide.</summary>
    public bool? GearRoll(string player) => _gear.TryGetValue(player, out bool comesUp) ? comesUp : null;

    public void Set(string player, bool won) => _won[player] = won;

    public void Clear(string player) => _won.TryRemove(player, out _);

    /// <summary>The verdict set for a player's duels: seat 1's win or the mob's; null when none is set.</summary>
    public DuelVerdict? For(string player) =>
        _won.TryGetValue(player, out bool won) ? new DuelVerdict(true, [won ? Duel.PlayerSeat : Duel.MobSeat], null) : null;
}
