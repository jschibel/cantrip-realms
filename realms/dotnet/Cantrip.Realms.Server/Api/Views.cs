using Cantrip.Realms.Server.Content;

namespace Cantrip.Realms.Server;

// What the API sends and takes (realms/docs/interfaces.md, "The realm server's API"), PascalCase on the wire.

/// <summary>A character's setup values (design.md A1).</summary>
public sealed record StatsView(int Life, int Hand, int MaxHand)
{
    public static StatsView Of(GearStats stats)
    {
        ArgumentNullException.ThrowIfNull(stats);
        return new(stats.Life, stats.Hand, stats.MaxHand);
    }
}

/// <summary>A gear item a character owns: its instance's id and the item.</summary>
public sealed record GearInstance(long InstanceId, GearItem Gear);

/// <summary>A character as its player sees it.</summary>
public sealed record CharacterView(
    string Name,
    int Body,
    int Palette,
    string Identity,
    long Gold,
    string Map,
    int Q,
    int R,
    StatsView Stats,
    IReadOnlyDictionary<string, GearInstance?> Loadout,
    IReadOnlyList<GearInstance> Gear,
    IReadOnlyList<string> Unlocked);

public sealed record NewCharacter(string? Name, int Body, int Palette, string? Color);

public sealed record CollectionView(IReadOnlyDictionary<string, int> Cards);

public sealed record CardCount(string Name, int Count);

/// <summary>A deck and its ante, and what the ante is worth.</summary>
public sealed record DeckView(IReadOnlyList<CardCount> Main, IReadOnlyList<CardCount> Ante, long AnteValue);

public sealed record DeckChange(IReadOnlyList<CardCount>? Main, IReadOnlyList<CardCount>? Ante);

public sealed record LoadoutChange(IReadOnlyDictionary<string, long?>? Slots);

public sealed record VendorInfo(string Id, string Name, string Town, CardFilter Specialty);

public sealed record StockView(string Name, long Gold, int Count, DateTimeOffset? Until);

public sealed record VendorView(VendorInfo Vendor, long Purse, IReadOnlyList<StockView> Stock);

public sealed record CardTrade(string? Name);

public sealed record TradeView(long Gold, CollectionView Collection);

public sealed record ArmorerView(IReadOnlyList<GearItem> Stock);

public sealed record GearBuy(string? GearId);

public sealed record GearSell(long InstanceId);

public sealed record GearTradeView(long Gold, IReadOnlyList<GearInstance> Gear);

public sealed record EncounterStart(string? Map, string? Spawn, string? Mob);

public sealed record EncounterView(string Token, long Seed, Duel Duel);

public sealed record EncounterFinish(string? Token, IReadOnlyList<string>? Log);

/// <summary>
/// How a duel ended: <c>won</c> or <c>lost</c>; the gold a win paid; the cards offered and the cap their picks fit under;
/// a gear item that dropped; and, for a duel counted as lost without being played out, why.
/// </summary>
public sealed record OutcomeView(string Outcome, long Gold, IReadOnlyList<string> Offer, long Cap, GearInstance? Gear, string? Detail);

public sealed record LootPicks(string? Token, IReadOnlyList<string>? Picks);

public sealed record ChestOpen(string? Map, string? Chest);

/// <summary>What a chest held, and the character's gold with it.</summary>
public sealed record ChestView(long Gold, long Found);

public sealed record TravelTo(string? Map, int Q, int R);
