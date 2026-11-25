using Cantrip.Decks;
using Cantrip.Realms.Server.Auth;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Economy;
using MessagePack;

namespace Cantrip.Realms.Server;

/// <summary>
/// The realm server's API (realms/docs/interfaces.md, "The realm server's API"): every call needs the signed-in cookie, and a
/// refused call is an HTTP 4xx with <c>{"Error", "Detail"}</c> (and <c>Problems</c> for a deck or a loadout).
/// </summary>
public static class RealmApi
{
    public static void MapRealmApi(this IEndpointRouteBuilder app)
    {
        RouteGroupBuilder api = app.MapGroup("/api").AddEndpointFilter(async (context, next) =>
        {
            if (RealmSignIn.PlayerId(context.HttpContext) is null)
            {
                return Results.Json(new ApiError(Codes.NotSignedIn, "Sign in first."), statusCode: StatusCodes.Status401Unauthorized);
            }

            context.HttpContext.Response.Headers.CacheControl = "no-store";
            try
            {
                return await next(context).ConfigureAwait(false);
            }
            catch (Refusal refusal)
            {
                return Results.Json(new ApiError(refusal.Code, refusal.Message, refusal.Problems), statusCode: refusal.Status);
            }
        });

        static string Player(HttpContext context) => RealmSignIn.PlayerId(context)!;

        api.MapGet("/me", async (HttpContext context, Characters characters, Encounters encounters) =>
        {
            await characters.Require(Player(context)).ConfigureAwait(false);
            await encounters.SettleAbandoned(Player(context)).ConfigureAwait(false);
            return Results.Ok(await characters.View(Player(context)).ConfigureAwait(false));
        });

        api.MapPost("/character", async (HttpContext context, Characters characters, NewCharacter body) =>
            Results.Ok(await characters.Create(Player(context), body).ConfigureAwait(false)));

        // Every card the engine plays as printed, with its legalities and color identity: the card layer's faces, as the deck
        // site's catalog is the deck editor's (MessagePack, the protocol's own CardCatalogView). The same for everyone, so made once.
        var catalog = new Lazy<byte[]>(() => Catalog(app.ServiceProvider.GetRequiredService<RealmContent>()));
        api.MapGet("/catalog", () => Results.Bytes(catalog.Value, "application/x-msgpack"));

        api.MapGet("/collection", async (HttpContext context, Characters characters) =>
            Results.Ok(await characters.Collection(Player(context)).ConfigureAwait(false)));

        api.MapGet("/inventory", async (HttpContext context, DecksAndGear decks) =>
            Results.Ok(await decks.Inventory(Player(context)).ConfigureAwait(false)));

        api.MapGet("/deck", async (HttpContext context, DecksAndGear decks) =>
            Results.Ok(await decks.View(Player(context)).ConfigureAwait(false)));

        api.MapPost("/deck/check", async (HttpContext context, DecksAndGear decks, DeckChange body) =>
            Results.Ok(await decks.Check(Player(context), body).ConfigureAwait(false)));

        api.MapPut("/deck", async (HttpContext context, DecksAndGear decks, DeckChange body) =>
            Results.Ok(await decks.Save(Player(context), body).ConfigureAwait(false)));

        api.MapPut("/loadout", async (HttpContext context, DecksAndGear decks, LoadoutChange body) =>
            Results.Ok(await decks.Wear(Player(context), body).ConfigureAwait(false)));

        api.MapGet("/vendor/{id}", async (HttpContext context, Vendors vendors, string id) =>
            Results.Ok(await vendors.Visit(Player(context), id).ConfigureAwait(false)));

        api.MapPost("/vendor/{id}/buy", async (HttpContext context, Vendors vendors, string id, CardTrade body) =>
            Results.Ok(await vendors.Buy(Player(context), id, body).ConfigureAwait(false)));

        api.MapPost("/vendor/{id}/sell", async (HttpContext context, Vendors vendors, string id, CardTrade body) =>
            Results.Ok(await vendors.Sell(Player(context), id, body).ConfigureAwait(false)));

        api.MapGet("/travelers", (RealmContent content, TimeProvider time) =>
            Results.Ok(Travelers.View(content, time.GetUtcNow().ToUnixTimeMilliseconds())));

        api.MapGet("/armorer/{town}", (Armorers armorers, string town) =>
            Results.Ok(new ArmorerView(armorers.Stock(town))));

        api.MapPost("/armorer/{town}/buy", async (HttpContext context, Armorers armorers, string town, GearBuy body) =>
            Results.Ok(await armorers.Buy(Player(context), town, body).ConfigureAwait(false)));

        api.MapPost("/armorer/{town}/sell", async (HttpContext context, Armorers armorers, string town, GearSell body) =>
            Results.Ok(await armorers.Sell(Player(context), town, body).ConfigureAwait(false)));

        api.MapPost("/encounter/start", async (HttpContext context, Encounters encounters, EncounterStart body) =>
            Results.Ok(await encounters.Start(Player(context), body).ConfigureAwait(false)));

        api.MapPost("/encounter/finish", async (HttpContext context, Encounters encounters, EncounterFinish body) =>
            Results.Ok(await encounters.Finish(Player(context), body).ConfigureAwait(false)));

        api.MapPost("/encounter/pay", async (HttpContext context, Encounters encounters, EncounterPay body) =>
            Results.Ok(await encounters.Pay(Player(context), body).ConfigureAwait(false)));

        api.MapPost("/encounter/rematch", async (HttpContext context, Encounters encounters, EncounterRematch body) =>
            Results.Ok(await encounters.Rematch(Player(context), body).ConfigureAwait(false)));

        api.MapPost("/hearts/buy", async (HttpContext context, Hearts hearts) =>
            Results.Ok(await hearts.Buy(Player(context)).ConfigureAwait(false)));

        api.MapGet("/finds", (Chests chests) => Results.Ok(chests.Standing()));

        api.MapPost("/chest/open", async (HttpContext context, Chests chests, ChestOpen body) =>
            Results.Ok(await chests.Open(Player(context), body).ConfigureAwait(false)));

        api.MapPost("/position", async (HttpContext context, Characters characters, PlaceView body) =>
            Results.Ok(await characters.Position(Player(context), body).ConfigureAwait(false)));

        api.MapPost("/inn", async (HttpContext context, Characters characters) =>
            Results.Ok(await characters.SetInn(Player(context)).ConfigureAwait(false)));

        api.MapPost("/dungeon/enter", async (HttpContext context, Dungeons dungeons, DungeonEnter body) =>
            Results.Ok(await dungeons.Enter(Player(context), body).ConfigureAwait(false)));

        api.MapGet("/dungeon/run", async (HttpContext context, Dungeons dungeons) =>
            Results.Ok(await dungeons.Current(Player(context)).ConfigureAwait(false)));

        api.MapPost("/dungeon/floor", async (HttpContext context, Dungeons dungeons, FloorTake body) =>
        {
            await dungeons.Floor(Player(context), body).ConfigureAwait(false);
            return Results.Ok(new { });
        });

        api.MapPost("/dungeon/shrine", async (HttpContext context, Dungeons dungeons, ShrineUse body) =>
            Results.Ok(await dungeons.Pray(Player(context), body).ConfigureAwait(false)));

        api.MapPost("/dungeon/leave", async (HttpContext context, Dungeons dungeons, RunLeave body) =>
        {
            await dungeons.Leave(Player(context), body).ConfigureAwait(false);
            return Results.Ok(new { });
        });

        api.MapPost("/waystone", async (HttpContext context, Dungeons dungeons, WaystoneTravel body) =>
            Results.Ok(await dungeons.Travel(Player(context), body).ConfigureAwait(false)));
    }

    /// <summary>Every card the engine plays as printed, with the realm's legality and identity: <c>/api/catalog</c>'s body.</summary>
    public static byte[] Catalog(RealmContent content)
    {
        ArgumentNullException.ThrowIfNull(content);
        return MessagePackSerializer.Serialize(new CardCatalogView
        {
            Cards = [.. content.Cards.Catalog.Values.OrderBy(card => card.Name, StringComparer.Ordinal)],
        });
    }
}
