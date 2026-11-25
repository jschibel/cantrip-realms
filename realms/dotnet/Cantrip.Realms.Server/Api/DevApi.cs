using System.Collections.Concurrent;
using Cantrip.Realms.Server.Auth;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Duels;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server;

/// <summary>
/// Calls for development and tests alone, mapped only when <c>REALMS_DEV_SIGNIN=1</c> (as <c>POST /dev/signin</c> is), never
/// in production: what an end-to-end suite driving a real server needs to arrange that playing would take too long to
/// reach (realms/docs/interfaces.md, the sign-in bullet).
/// <list type="bullet">
/// <item><c>POST /dev/place {Space, X, Z}</c> puts the signed-in character at once on an open tile of the world or an interior,
/// as a test arranges where it starts; 422 <c>NoSuchPlace</c> for any other.</item>
/// <item><c>POST /dev/duel {Player, Mob}</c> deals the signed-in player's next duels with those seats' setup changed - each
/// <c>{StartingLife, StartingHandSize, MaximumHandSize, Deck, Emblems}</c>, any of them, or null to leave the seat as it is - as a
/// scenario forces a position: the duel is committed so and replayed so, and its result is the engine's. A body of two
/// nulls deals them as they are again.</item>
/// <item><c>POST /dev/verdict {Outcome, MobLife}</c> judges the signed-in player's duels as it says, <c>won</c> or <c>lost</c>,
/// instead of replaying their logs on the engine, so a stand-in card layer's win counts - the mob ending each at
/// <c>MobLife</c>, or at the life it began the game with when that is null; <c>null</c> replays them again.</item>
/// <item><c>POST /dev/drop {Gear, Shrine}</c> decides the signed-in player's rolls: <c>Gear</c> their gear rolls - a win's
/// and a chest's (design.md A3, A5) - and <c>Shrine</c> whether a run they begin holds a shrine (A6): <c>true</c> every one
/// comes up, <c>false</c> none does, <c>null</c> (or left out) the dice decide again. Which item drops, and the shrine's
/// floor, are still the dice's.</item>
/// <item><c>POST /dev/gear {GearId}</c> gives the signed-in character a copy of a gear item, as a drop would: the
/// <c>GearInstance</c>; 404 <c>NotThere</c> for no such item.</item>
/// <item><c>POST /dev/hearts {Hearts, MaxHearts}</c> sets the signed-in character's hearts (design.md A3b) - those they
/// have, and (if given) those they hold, 1 to 5 and none above the capacity - as a test arranges a heart missing without
/// losing a duel for it: the <c>Character</c>; 422 <c>NoSuchHearts</c> for any other.</item>
/// <item><c>POST /dev/cards {Name, Count}</c> adds copies of a card the engine plays to the signed-in character's collection
/// (or takes them, with a negative count), as a test arranges what is owned; 422 <c>NoSuchCard</c> for any other.</item>
/// <item><c>GET /dev/where</c>: where the presence relay has each of the signed-in player's connections now, <c>[{Member,
/// Space, X, Z}]</c> - what a test reads a page's walks against.</item>
/// <item><c>POST /dev/find {Kind, X, Z, Clear}</c> stands a find of the wilds on an open tile of the world now -
/// <c>chest</c> or <c>heartbloom</c>, its tier its zone's - after taking away every other when <c>Clear</c>, as a test
/// arranges what is there instead of waiting on the spawner's dice: the <c>Find</c>; 422 <c>NoSuchPlace</c> for a tile nobody
/// stands on, or another kind.</item>
/// <item><c>POST /dev/log {Text}</c> writes what the page saw to the server's log, as a warning under the player's id (the
/// overworld's report of a jump of the player's figure, with the presence events before it), at most 16 KB of it.</item>
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

        dev.MapGet("/where", (HttpContext context, Presence.PresenceHub hub) =>
            Results.Ok(hub.WhereIs(RealmSignIn.PlayerId(context)!).Select(where => new { where.Member, where.Space, where.At.X, where.At.Z })));

        dev.MapPost("/find", (Economy.Finds finds, DevFind body) =>
        {
            var at = new Tile(body.X, body.Z);
            Economy.FindKind? kind = body.Kind switch { "chest" => Economy.FindKind.Chest, "heartbloom" => Economy.FindKind.Heartbloom, _ => null };
            if (kind is null || !finds.CanStand(at))
            {
                throw Refusal.Unprocessable(Codes.NoSuchPlace, "A find is a chest or a heartbloom, on an open tile of the world.");
            }

            if (body.Clear) finds.Clear();
            return Results.Ok(Economy.Chests.View(finds.Place(kind.Value, at)));
        });

        dev.MapPost("/log", (HttpContext context, ILoggerFactory logs, DevLog body) =>
        {
            string text = body.Text ?? string.Empty;
            if (text.Length > 16 * 1024) text = text[..(16 * 1024)];
            logs.CreateLogger("Cantrip.Realms.Server.Client").LogWarning("Client {Player}: {Text}", RealmSignIn.PlayerId(context), text);
            return Results.Ok(new { });
        });

        dev.MapPost("/duel", (HttpContext context, DevDuels duels, DevDuel body) =>
        {
            duels.Set(RealmSignIn.PlayerId(context)!, body);
            return Results.Ok(new { });
        });

        dev.MapPost("/cards", async (HttpContext context, Characters characters, RealmContent content, RealmDb db, DevCards body) =>
        {
            string player = RealmSignIn.PlayerId(context)!;
            await characters.Require(player).ConfigureAwait(false);
            if (body.Name is not { Length: > 0 } name || !content.Cards.Catalog.ContainsKey(name) || body.Count == 0)
            {
                throw Refusal.Unprocessable("NoSuchCard", "Copies of a card the engine plays are added: a name and a count.");
            }

            await characters.AddToCollection(player, name, body.Count).ConfigureAwait(false);
            await db.SaveChangesAsync().ConfigureAwait(false);
            return Results.Ok(await characters.Collection(player).ConfigureAwait(false));
        });

        dev.MapPost("/hearts", async (HttpContext context, Characters characters, RealmDb db, DevHearts body) =>
        {
            string player = RealmSignIn.PlayerId(context)!;
            PlayerRow row = await characters.Require(player).ConfigureAwait(false);
            int most = body.MaxHearts ?? row.MaxHearts;
            if (most < 1 || most > Hearts.Most || body.Hearts < 1 || body.Hearts > most)
            {
                throw Refusal.Unprocessable("NoSuchHearts", $"A character has 1 to {most} hearts, and holds 1 to {Hearts.Most}.");
            }

            await db.Players.Where(stored => stored.Id == player).ExecuteUpdateAsync(set => set
                .SetProperty(stored => stored.Hearts, body.Hearts)
                .SetProperty(stored => stored.MaxHearts, most)).ConfigureAwait(false);
            return Results.Ok(await characters.View(player).ConfigureAwait(false));
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
                    verdicts.Set(player, body.Outcome == "won", body.MobLife);
                    break;
                default:
                    throw Refusal.BadRequest("A verdict is \"won\", \"lost\" or null.");
            }

            return Results.Ok(new { });
        });

        dev.MapPost("/gear", async (HttpContext context, Characters characters, RealmContent content, Data.RealmDb db, TimeProvider time, DevGear body) =>
        {
            string player = RealmSignIn.PlayerId(context)!;
            await characters.Require(player).ConfigureAwait(false);
            if (body.GearId is null || !content.Gear.TryGetValue(body.GearId, out GearItem? item))
            {
                throw Refusal.NotFound(Codes.NotThere, "There is no such gear item.");
            }

            var owned = new Data.GearOwnedRow { PlayerId = player, GearId = item.Id, AcquiredAt = time.GetUtcNow().ToUnixTimeMilliseconds() };
            db.GearOwned.Add(owned);
            await db.SaveChangesAsync().ConfigureAwait(false);
            return Results.Ok(new GearInstance(owned.Id, item));
        });

        dev.MapPost("/drop", (HttpContext context, DevVerdicts verdicts, DevDrop body) =>
        {
            verdicts.SetGearRoll(RealmSignIn.PlayerId(context)!, body.Gear);
            verdicts.SetShrineRoll(RealmSignIn.PlayerId(context)!, body.Shrine);
            return Results.Ok(new { });
        });
    }

    /// <summary><c>POST /dev/duel</c>'s body: what to change of each seat, or null to leave it.</summary>
    public sealed record DevDuel(DevSeat? Player, DevSeat? Mob);

    /// <summary>A seat's setup values to deal a duel with instead of its own, each null to leave it.</summary>
    public sealed record DevSeat(int? StartingLife, int? StartingHandSize, int? MaximumHandSize, IReadOnlyList<string>? Deck, IReadOnlyList<string>? Emblems = null)
    {
        /// <summary>The seat with these changes.</summary>
        public DuelSeat Apply(DuelSeat seat)
        {
            ArgumentNullException.ThrowIfNull(seat);
            return seat with
            {
                StartingLife = StartingLife ?? seat.StartingLife,
                StartingHandSize = StartingHandSize ?? seat.StartingHandSize,
                MaximumHandSize = MaximumHandSize ?? seat.MaximumHandSize,
                Deck = Deck ?? seat.Deck,
                Emblems = Emblems ?? seat.Emblems,
            };
        }
    }

    /// <summary><c>POST /dev/cards</c>'s body.</summary>
    public sealed record DevCards(string? Name, int Count);

    /// <summary><c>POST /dev/hearts</c>'s body: the hearts the character has, and (null: as they are) holds.</summary>
    public sealed record DevHearts(int Hearts, int? MaxHearts = null);

    /// <summary><c>POST /dev/verdict</c>'s body: the outcome, and the mob's life at the end (null: what it began with).</summary>
    public sealed record DevVerdict(string? Outcome, int? MobLife = null);

    /// <summary><c>POST /dev/gear</c>'s body.</summary>
    public sealed record DevGear(string? GearId);

    /// <summary><c>POST /dev/drop</c>'s body.</summary>
    public sealed record DevDrop(bool? Gear, bool? Shrine = null);

    /// <summary><c>POST /dev/log</c>'s body.</summary>
    public sealed record DevLog(string? Text);

/// <summary>A find a test stands on a tile (<c>POST /dev/find</c>): its kind, its tile, and whether every other goes first.</summary>
public sealed record DevFind(string? Kind, int X, int Z, bool Clear = false);
}

/// <summary>
/// The verdicts <c>POST /dev/verdict</c> has set, by player: empty unless a development server's test set one, and then
/// <see cref="Encounters.Finish"/> takes it in place of the verifier's. And the gear and shrine rolls <c>POST /dev/drop</c>
/// decided.
/// </summary>
public sealed class DevVerdicts
{
    private readonly ConcurrentDictionary<string, (bool Won, int? MobLife)> _won = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, bool> _gear = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, bool> _shrine = new(StringComparer.Ordinal);

    /// <summary>Decides whether a player's runs hold a shrine: every one, none, or (null) as the dice say.</summary>
    public void SetShrineRoll(string player, bool? comesUp)
    {
        if (comesUp is { } decided) _shrine[player] = decided;
        else _shrine.TryRemove(player, out _);
    }

    /// <summary>Whether a player's run holds a shrine when a test decided it; null when the dice decide.</summary>
    public bool? ShrineRoll(string player) => _shrine.TryGetValue(player, out bool comesUp) ? comesUp : null;

    /// <summary>Decides a player's gear rolls: every one comes up, none does, or (null) the dice's again.</summary>
    public void SetGearRoll(string player, bool? comesUp)
    {
        if (comesUp is { } decided) _gear[player] = decided;
        else _gear.TryRemove(player, out _);
    }

    /// <summary>How a player's gear roll comes out when a test decided it; null when the dice decide.</summary>
    public bool? GearRoll(string player) => _gear.TryGetValue(player, out bool comesUp) ? comesUp : null;

    public void Set(string player, bool won, int? mobLife = null) => _won[player] = (won, mobLife);

    public void Clear(string player) => _won.TryRemove(player, out _);

    /// <summary>
    /// The verdict set for a player's duels: seat 1's win or the mob's, the mob ending <paramref name="duel"/> at the life a
    /// test said or else the life it began with, the player at theirs; null when none is set.
    /// </summary>
    public DuelVerdict? For(string player, Duel duel)
    {
        ArgumentNullException.ThrowIfNull(duel);
        if (!_won.TryGetValue(player, out (bool Won, int? MobLife) set)) return null;
        return new DuelVerdict(true, [set.Won ? Duel.PlayerSeat : Duel.MobSeat], null, new Dictionary<int, int>
        {
            [Duel.PlayerSeat] = set.Won ? duel.Seats[0].StartingLife : 0,
            [Duel.MobSeat] = set.MobLife ?? (set.Won ? 0 : duel.Seats[1].StartingLife),
        });
    }
}

/// <summary>
/// The seats <c>POST /dev/duel</c> has changed, by player: empty unless a development server's test set them, and then
/// <see cref="Encounters.Start"/> deals the player's duels with them.
/// </summary>
public sealed class DevDuels
{
    private readonly ConcurrentDictionary<string, DevApi.DevDuel> _duels = new(StringComparer.Ordinal);

    public void Set(string player, DevApi.DevDuel duel)
    {
        ArgumentNullException.ThrowIfNull(duel);
        if (duel.Player is null && duel.Mob is null) _duels.TryRemove(player, out _);
        else _duels[player] = duel;
    }

    /// <summary>The player's and the mob's seats as a test set them for this player, else as they are.</summary>
    public (DuelSeat Player, DuelSeat Mob) Apply(string player, DuelSeat seat1, DuelSeat seat2) =>
        _duels.TryGetValue(player, out DevApi.DevDuel? duel)
            ? (duel.Player?.Apply(seat1) ?? seat1, duel.Mob?.Apply(seat2) ?? seat2)
            : (seat1, seat2);
}
