using System.Text.Json.Nodes;
using Cantrip.Server.Rules;

namespace Cantrip.Realms.Server.Duels;

// TODO-upstream: cantrip-rs is adding per-seat variants to the deal - RulesSeat.Variant, of type
// Cantrip.Server.Rules.SeatVariant(int? StartingLife, int? StartingHandSize, int? MaximumHandSize, IReadOnlyList<string>? Emblems),
// which NativeRulesHost sends as the NewGame seat's StartingLife, StartingHandSize, MaximumHandSize and Emblems
// (docs/host-protocol.md). Until that lands in this fork, this stand-in has the same shape and SeatVariantTransport adds the
// same four fields to the request NativeRulesHost sends. Once it lands: delete both, set RulesSeat.Variant in
// NativeDuelVerifier.Seat, and deal through the factory's own transport.

/// <summary>
/// What a variant sets of one seat's start (stand-in for cantrip-rs's <c>Cantrip.Server.Rules.SeatVariant</c>, see the TODO
/// above): each null or empty where the format's stands.
/// </summary>
public sealed record SeatVariant(int? StartingLife = null, int? StartingHandSize = null, int? MaximumHandSize = null, IReadOnlyList<string>? Emblems = null)
{
    /// <summary>A duel seat's variant: its setup values and emblems, always said.</summary>
    public static SeatVariant Of(DuelSeat seat)
    {
        ArgumentNullException.ThrowIfNull(seat);
        return new SeatVariant(seat.StartingLife, seat.StartingHandSize, seat.MaximumHandSize, seat.Emblems);
    }
}

/// <summary>
/// TODO-upstream stand-in: a host transport that adds each seat's variant to the <c>NewGame</c> request passing through it,
/// exactly as cantrip-rs's <c>NativeRulesHost</c> will once <c>RulesSeat.Variant</c> lands, and passes everything else on as
/// it is.
/// </summary>
public sealed class SeatVariantTransport(IHostTransport inner, IReadOnlyList<SeatVariant?> variants) : IHostTransport
{
    public string Exchange(string request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return inner.Exchange(WithVariants(request, variants));
    }

    /// <summary>A request with the seats' variants added, if it is a deal; any other request as it is.</summary>
    public static string WithVariants(string request, IReadOnlyList<SeatVariant?> variants)
    {
        ArgumentNullException.ThrowIfNull(variants);
        if (!request.Contains("\"NewGame\"", StringComparison.Ordinal) || JsonNode.Parse(request) is not JsonObject deal
            || deal["Cmd"]?.GetValue<string>() != "NewGame" || deal["Seats"] is not JsonArray seats)
        {
            return request;
        }

        for (int i = 0; i < seats.Count && i < variants.Count; i++)
        {
            if (seats[i] is JsonObject seat && variants[i] is { } variant)
            {
                seat["StartingLife"] = variant.StartingLife;
                seat["StartingHandSize"] = variant.StartingHandSize;
                seat["MaximumHandSize"] = variant.MaximumHandSize;
                seat["Emblems"] = new JsonArray([.. (variant.Emblems ?? []).Select(emblem => (JsonNode?)JsonValue.Create(emblem))]);
            }
        }

        return deal.ToJsonString();
    }
}
