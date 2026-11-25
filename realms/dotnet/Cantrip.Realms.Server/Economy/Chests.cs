using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// Taking the finds of the wilds (<see cref="Finds"/>, which spawns them), each everyone's until someone takes it. A
/// treasure chest (design.md A5): gold within its tier's range, and now and then a gear item (A4, "gear sources"):
/// <see cref="GearChance"/> in a hundred, an item of <see cref="GearRarity"/>. A heartbloom (A3b): a heart given back (<see
/// cref="Hearts.Grant"/>); a character whose hearts are full can't pick one (409 <c>FullHearts</c>), and it stays. A
/// character takes either standing on it or next to it; the first to take one has it, and it is gone for all.
/// </summary>
public sealed class Chests(RealmDb db, RealmContent content, Characters characters, Hearts hearts, RealmDice dice, Finds finds, TimeProvider time, DevVerdicts devVerdicts)
{
    /// <summary>The chance, in percent, that a chest holds a gear item as well as its gold, rolled with <see cref="RealmDice.Roll"/>.</summary>
    public const int GearChance = 10;

    /// <summary>The richest chests' least gold: a chest whose range starts there holds an uncommon item, any other a common one.</summary>
    public const long RichChest = 300;

    /// <summary>The rarity of the item a chest of this gold holds: uncommon in the richest chests, common in the rest. Never a boss's unique.</summary>
    public static string GearRarity(IReadOnlyList<long> gold)
    {
        ArgumentNullException.ThrowIfNull(gold);
        return gold.Count > 0 && gold[0] >= RichChest ? "uncommon" : "common";
    }

    /// <summary>The finds standing in the world now (<c>GET /api/finds</c>).</summary>
    public IReadOnlyList<FindView> Standing() => [.. finds.Live().Select(View)];

    /// <summary>A find as the overworld is told of it.</summary>
    public static FindView View(Find find)
    {
        ArgumentNullException.ThrowIfNull(find);
        return new FindView(find.Id, find.Kind == FindKind.Chest ? "chest" : "heartbloom", find.At.X, find.At.Z, DateTimeOffset.FromUnixTimeMilliseconds(find.Until));
    }

    public async Task<ChestView> Open(string player, ChestOpen request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        if (request.Space != RealmContent.WorldSpace) throw Refusal.NotFound(Codes.NoSuchPlace, "There is no such find.");
        if (finds.Get(request.Chest ?? string.Empty) is not { } find) throw Refusal.Conflict(Codes.Empty, "It is gone: someone got there first, or it crumbled.");
        if (row.Space != RealmContent.WorldSpace || new Tile(row.X, row.Z).DistanceTo(find.At) > 1)
        {
            throw Refusal.Conflict(Codes.NotNear, find.Kind == FindKind.Chest ? "You are not at that chest." : "You are not at that heartbloom.");
        }

        return find.Kind == FindKind.Heartbloom ? await Pick(player, find).ConfigureAwait(false) : await OpenChest(player, find).ConfigureAwait(false);
    }

    private async Task<ChestView> OpenChest(string player, Find chest)
    {
        if (!finds.Take(chest)) throw Refusal.Conflict(Codes.Empty, "Someone got there first.");
        long now = time.GetUtcNow().ToUnixTimeMilliseconds();
        long found = dice.Between(chest.Gold[0], chest.Gold[1]);
        GearItem? item = devVerdicts.GearRoll(player) ?? dice.Roll(GearChance / 100.0) ? Item(chest.Gold) : null;
        GearInstance? gear = null;
        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            GearOwnedRow? owned = item is null ? null : new GearOwnedRow { PlayerId = player, GearId = item.Id, AcquiredAt = now };
            if (owned is not null) db.GearOwned.Add(owned);
            await db.SaveChangesAsync().ConfigureAwait(false);
            await db.Players.Where(stored => stored.Id == player)
                .ExecuteUpdateAsync(set => set.SetProperty(stored => stored.Gold, stored => stored.Gold + found)).ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
            if (owned is not null) gear = new GearInstance(owned.Id, item!);
        }

        db.ChangeTracker.Clear();
        PlayerRow after = await characters.Require(player).ConfigureAwait(false);
        return new ChestView(after.Gold, found, gear, after.Hearts);
    }

    /// <summary>
    /// Picks a heartbloom: a heart given back and the bloom gone for everyone; <c>FullHearts</c> (and the bloom left
    /// standing) when the picker's hearts are full.
    /// </summary>
    private async Task<ChestView> Pick(string player, Find bloom)
    {
        // Taken first, so two picks at once give one heart; then the heart, or the bloom put back.
        if (!finds.Take(bloom)) throw Refusal.Conflict(Codes.Empty, "Someone picked the heartbloom first.");
        if (!await hearts.Grant(player).ConfigureAwait(false))
        {
            finds.PutBack(bloom);
            throw Refusal.Conflict(Codes.FullHearts, "Your hearts are full. The heartbloom will keep.");
        }

        db.ChangeTracker.Clear();
        PlayerRow after = await characters.Require(player).ConfigureAwait(false);
        return new ChestView(after.Gold, 0, null, after.Hearts, Heart: true);
    }

    /// <summary>The item a chest holds when its gear roll comes up: any non-unique item of its rarity, or none if there is none.</summary>
    private GearItem? Item(IReadOnlyList<long> gold)
    {
        string rarity = GearRarity(gold);
        List<GearItem> items = [.. content.Gear.Values.Where(item => !item.Unique && item.Rarity == rarity).OrderBy(item => item.Id, StringComparer.Ordinal)];
        return items.Count == 0 ? null : items[dice.Below(items.Count)];
    }
}
