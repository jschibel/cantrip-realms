using Cantrip.Realms.Server.Content;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// The traveling traders' schedule (design.md A5, "Wares from other planes"): each caravan's round is fixed by the date
/// alone - on Unix day <c>d</c> (UTC) it is in <c>Towns[d mod Towns.Count]</c> from <c>Hour</c> o'clock for <c>Hours</c>
/// hours - so the server keeps it without a store, everyone sees the same, and a test pins it with its clock.
/// </summary>
public static class Travelers
{
    /// <summary>How many cards of its plane a caravan brings to each visit.</summary>
    public const int Brought = 3;

    private const long DayMs = 86_400_000;
    private const long HourMs = 3_600_000;

    /// <summary>A caravan's visit: the town, and from when until when (Unix milliseconds) it is there.</summary>
    public sealed record Visit(string Town, long From, long Until, long Day);

    /// <summary>The visit of a day.</summary>
    public static Visit On(TraderRound round, long day)
    {
        ArgumentNullException.ThrowIfNull(round);
        long from = (day * DayMs) + (round.Hour * HourMs);
        return new Visit(round.Towns[(int)(((day % round.Towns.Count) + round.Towns.Count) % round.Towns.Count)], from, from + (round.Hours * HourMs), day);
    }

    private static long DayOf(long ms) => ms >= 0 ? ms / DayMs : -((-ms + DayMs - 1) / DayMs);

    /// <summary>The visit a caravan is on at a moment; null between visits.</summary>
    public static Visit? Current(TraderRound round, long now)
    {
        Visit today = On(round, DayOf(now));
        return now >= today.From && now < today.Until ? today : null;
    }

    /// <summary>The caravan's next visit to begin after a moment.</summary>
    public static Visit Next(TraderRound round, long now)
    {
        Visit today = On(round, DayOf(now));
        return today.From > now ? today : On(round, DayOf(now) + 1);
    }

    /// <summary>Every trader's schedule as the API gives it (<c>GET /api/travelers</c>).</summary>
    public static TravelersView View(RealmContent content, long now)
    {
        ArgumentNullException.ThrowIfNull(content);
        return new TravelersView([.. content.Vendors.Values
            .Where(vendor => vendor.File.Trader is not null)
            .OrderBy(vendor => vendor.Id, StringComparer.Ordinal)
            .Select(vendor =>
            {
                TraderRound round = vendor.File.Trader!;
                return new TravelerView(vendor.Id, vendor.File.Name, round.Plane, content.TraderPlanes.GetValueOrDefault(round.Plane) ?? round.Plane,
                    Current(round, now) is { } visit ? Of(visit) : null, Of(Next(round, now)));
            })]);
    }

    private static VisitView Of(Visit visit) =>
        new(visit.Town, DateTimeOffset.FromUnixTimeMilliseconds(visit.From), DateTimeOffset.FromUnixTimeMilliseconds(visit.Until));
}
