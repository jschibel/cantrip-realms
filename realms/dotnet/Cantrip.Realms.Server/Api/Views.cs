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

/// <summary>
/// A character as its player sees it: <see cref="Id"/> the player id the spawn table hashes, <see cref="Body"/> one of
/// <see cref="Economy.Characters.BodyNames"/>, <see cref="Identity"/> the colors' letters in WUBRG order; their hearts
/// (design.md A3b) - how many they have, how many they hold, what a healer asks for one more (null at the most) - and the
/// defeat they have still to answer, if any; where they stand (<see cref="Space"/>, <see cref="X"/>, <see cref="Z"/>, a
/// tile), the inn they wake at, the mage towers they have attuned, and the heartblooms of the world they have picked that
/// have not grown back.
/// </summary>
public sealed record CharacterView(
    string Id,
    string Name,
    string Body,
    int Palette,
    string Identity,
    long Gold,
    int Hearts,
    int MaxHearts,
    long? HeartPrice,
    DefeatView? Defeat,
    string Space,
    int X,
    int Z,
    string Inn,
    StatsView Stats,
    IReadOnlyDictionary<string, GearInstance?> Loadout,
    IReadOnlyList<GearInstance> Gear,
    IReadOnlyList<string> Unlocked,
    IReadOnlyList<string> Attuned,
    IReadOnlyList<PickedView> Picked);

/// <summary>A new character: a name, a body (<c>lithe</c>, <c>broad</c>, <c>tall</c> or <c>stocky</c>), a palette and a starting color.</summary>
public sealed record NewCharacter(string? Name, string? Body, int Palette, string? Color);

/// <summary>
/// A character's collection by card name, and (from <c>GET /api/collection</c>) each owned card's list price in gold, for
/// the spell table: a card with no price is missing from <c>Prices</c>.
/// </summary>
public sealed record CollectionView(IReadOnlyDictionary<string, int> Cards, IReadOnlyDictionary<string, long>? Prices = null, IReadOnlyList<string>? Relics = null);

/// <summary>A card of the collection as the inventory shows it: how many, its list price, the copies the deck and the sideboard use, whether it is a relic.</summary>
public sealed record InventoryCard(string Name, int Count, long Gold, int Deck, int Sideboard, bool Relic);

/// <summary>The collection card by card (<c>GET /api/inventory</c>), and what it is worth at list price.</summary>
public sealed record InventoryView(IReadOnlyList<InventoryCard> Cards, long Value);

public sealed record CardCount(string Name, int Count);

/// <summary>A deck and its sideboard (design.md A2).</summary>
public sealed record DeckView(IReadOnlyList<CardCount> Main, IReadOnlyList<CardCount> Sideboard);

public sealed record DeckChange(IReadOnlyList<CardCount>? Main, IReadOnlyList<CardCount>? Sideboard);

/// <summary>What the realm finds wrong with a deck and a sideboard, as saving them would: empty for a legal pair.</summary>
public sealed record DeckCheckView(IReadOnlyList<string> Problems);

public sealed record LoadoutChange(IReadOnlyDictionary<string, long?>? Slots);

/// <summary>
/// A vendor: its id and name, the town it trades in (a trader's caravan's now, empty between visits), its specialty, its
/// kind (<c>shop</c>, <c>exotic</c> or <c>trader</c>) and a trader's home plane.
/// </summary>
public sealed record VendorInfo(string Id, string Name, string Town, CardFilter Specialty, string Kind, string? Plane);

/// <summary>A caravan's visit: its town, and when it comes and goes.</summary>
public sealed record VisitView(string Town, DateTimeOffset From, DateTimeOffset Until);

/// <summary>A traveling trader: its plane, the visit it is on now (null between visits) and its next.</summary>
public sealed record TravelerView(string Id, string Name, string Plane, string PlaneName, VisitView? Visit, VisitView Next);

/// <summary>Every traveling trader's schedule (<c>GET /api/travelers</c>).</summary>
public sealed record TravelersView(IReadOnlyList<TravelerView> Travelers);

public sealed record StockView(string Name, long Gold, int Count, DateTimeOffset? Until);

/// <summary>
/// A card of the character's that a vendor deals in: what it pays for one (half the list price, rounded down), how many the
/// character owns, and how many of those are spare - in neither the deck nor the sideboard, so that one can be sold.
/// </summary>
public sealed record BuyingView(string Name, long Gold, int Owned, int Spare);

/// <summary>A vendor as a visiting character sees it: its purse and its shelves, the character's gold, and what of theirs it would buy.</summary>
public sealed record VendorView(VendorInfo Vendor, long Purse, IReadOnlyList<StockView> Stock, long Gold, IReadOnlyList<BuyingView> Buying);

public sealed record CardTrade(string? Name);

public sealed record TradeView(long Gold, CollectionView Collection);

public sealed record ArmorerView(IReadOnlyList<GearItem> Stock);

public sealed record GearBuy(string? GearId);

public sealed record GearSell(long InstanceId);

public sealed record GearTradeView(long Gold, IReadOnlyList<GearInstance> Gear);

/// <summary>An encounter to start: a world spawn's mob (<see cref="Spawn"/>), or a dungeon run's (<see cref="Run"/>, <see cref="Floor"/>, <see cref="Index"/>).</summary>
public sealed record EncounterStart(string? Spawn, string? Mob, string? Run = null, int? Floor = null, int? Index = null);

public sealed record EncounterView(string Token, long Seed, Duel Duel);

public sealed record EncounterFinish(string? Token, IReadOnlyList<string>? Log);

/// <summary>
/// How a game ended: <c>won</c> or <c>lost</c>. A win's gold, the gear item it dropped, the relics that dropped (already in
/// the collection, design.md A3a), and from a boss its <see cref="Gift"/>, a rare or mythic card of its loot already in the
/// collection, and the color it <see cref="Unlocked"/> now (design.md A6). A loss pays nothing and costs a heart
/// (design.md A3b): <see cref="Hearts"/> are what the character has after the game; with hearts left, <see cref="Defeat"/>
/// is the mob's offer - pay it off or fight again - and with none, <see cref="Died"/>: the character is home, and
/// <see cref="Forfeit"/> is what a dungeon run they died in had won, taken back. <see cref="Detail"/> says why a game
/// counted as lost without being played out.
/// </summary>
public sealed record OutcomeView(
    string Outcome,
    long Gold,
    GearInstance? Gear,
    IReadOnlyList<string> Relics,
    string? Detail,
    string? Gift = null,
    string? Unlocked = null,
    int Hearts = 0,
    DefeatView? Defeat = null,
    bool Died = false,
    RunLoss? Forfeit = null);

/// <summary>
/// A game lost with hearts left, its answer pending (design.md A3): the game's token, the mob (its id), where it was met
/// (the world spawn's id, or a run's encounter, <c>&lt;floor&gt;:&lt;index&gt;</c>) and in which epoch of the spawn, and which
/// game of the encounter it was; the character's hearts now; the mob's life at the game's end and its full starting life (gear and
/// a run's gains included); what it asks to be paid off (null in a dungeon, where it can't be); and the deck and sideboard
/// the game was played with, which the next game's are swapped from.
/// </summary>
public sealed record DefeatView(
    string Token,
    string Mob,
    string Spawn,
    long Epoch,
    int Game,
    int Hearts,
    int MaxHearts,
    int MobLife,
    int MobFullLife,
    long? Price,
    IReadOnlyList<CardCount> Main,
    IReadOnlyList<CardCount> Sideboard);

/// <summary>What a dungeon run had won and dying in it took back: its gold, its cards and its gear items, by name.</summary>
public sealed record RunLoss(long Gold, IReadOnlyList<string> Cards, IReadOnlyList<string> Gear);

/// <summary>Paying a mob off after a lost game (<c>POST /api/encounter/pay</c>).</summary>
public sealed record EncounterPay(string? Token);

/// <summary>The character's gold after paying a mob off.</summary>
public sealed record PaidView(long Gold);

/// <summary>
/// Fighting on after a lost game (<c>POST /api/encounter/rematch</c>): the game's token, the deck and sideboard swapped
/// from the last game's, and whether the player, who lost, plays first (CR 103.1).
/// </summary>
public sealed record EncounterRematch(string? Token, IReadOnlyList<CardCount>? Main, IReadOnlyList<CardCount>? Sideboard, bool PlayFirst = true);

/// <summary>A character's hearts after buying one at a healer, their gold, and what the next costs (null at the most).</summary>
public sealed record HeartsView(long Gold, int Hearts, int MaxHearts, long? Price);

/// <summary>What <c>POST /api/position</c> answers: the character's hearts, which a town fills.</summary>
public sealed record PositionView(int Hearts);

public sealed record ChestOpen(string? Space, string? Chest);

/// <summary>What a chest held - its gold, and a gear item now theirs or null - and the character's gold with it.</summary>
public sealed record ChestView(long Gold, long Found, GearInstance? Gear, int Hearts, bool Heart = false);

/// <summary>A heartbloom of the world a character picked, and when it grows back for them.</summary>
public sealed record PickedView(string Chest, DateTimeOffset Until);

/// <summary>Where a character stands (interfaces.md, "Places"): a space - <c>world</c>, an interior's id, <c>run:&lt;id&gt;</c> - and a tile of it, x east and z south.</summary>
public sealed record PlaceView(string Space, int X, int Z);

public sealed record DungeonEnter(string? Dungeon);

/// <summary>One encounter of a run's floor: its index on the floor, and its mob.</summary>
public sealed record RunEncounter(int Index, string Mob);

/// <summary>
/// A floor of a run: its encounters, then the warden at its stair (every floor but the last; its index the count of the
/// encounters) and on the last floor the boss (its index one past the encounters'). A run of a color's dungeon dealt by the
/// character's standing to its color (design.md A6, <see cref="Content.DungeonStanding"/>) says the tier it deals each floor
/// at and what its boss gains over its own stats; null for a run dealt as the dungeon is written. <see cref="Shrine"/>: the
/// floor holds the run's shrine (design.md A6), which gives back a heart once in the run; a run has one at most.
/// </summary>
public sealed record RunFloor(IReadOnlyList<RunEncounter> Encounters, string? Warden, string? Boss, int? Tier = null, GearStats? BossStats = null, bool Shrine = false);

/// <summary>A boss resting after a win (design.md A6: refought weekly): who, and when it is back.</summary>
public sealed record RestingView(string Boss, DateTimeOffset Until);

/// <summary>
/// A run: its id, its seed for the browser's layout, every encounter it holds, its dungeon, the floor the character stands
/// on, the encounters of it beaten (<c>&lt;floor&gt;:&lt;index&gt;</c>), the boss that rests and so is not on its last floor, and the
/// run's tier: its dungeon's, or the one the character's standing to its color deals it at (design.md A6); and whether the
/// run's shrine, if it has one, has given its heart.
/// </summary>
public sealed record RunView(string Run, long Seed, IReadOnlyList<RunFloor> Floors, string? Dungeon = null, int Floor = 0, IReadOnlyList<string>? Beaten = null, RestingView? Resting = null, int? Tier = null, bool ShrineUsed = false);

/// <summary><c>POST /api/dungeon/shrine</c>'s body: the run whose shrine the character prays at.</summary>
public sealed record ShrineUse(string? Run);

/// <summary>What a shrine's blessing came to: the character's hearts after.</summary>
public sealed record ShrineView(int Hearts);

public sealed record FloorTake(string? Run, int Floor);

public sealed record RunLeave(string? Run);

public sealed record WaystoneTravel(string? Tower);

/// <summary>Where a waystone took the character.</summary>
public sealed record WaystoneView(PlaceView Place);

/// <summary>The inn a character has set as home.</summary>
public sealed record InnView(string Inn);
