using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// Treasure chests of the world and its interiors (design.md A5): gold within the chest's range, refilling for each player on the chest's own
/// timer, and now and then a gear item (A4, "gear sources"): <see cref="GearChance"/> in a hundred, an item of
/// <see cref="GearRarity"/>. A character opens one standing on it or next to it.
/// </summary>
public sealed class Chests(RealmDb db, RealmContent content, Characters characters, RealmDice dice, TimeProvider time, DevVerdicts devVerdicts)
{
    /// <summary>The chance, in percent, that a chest holds a gear item as well as its gold, rolled with <see cref="RealmDice.Roll"/>.</summary>
    public const int GearChance = 10;

    /// <summary>The richest chests' least gold: a chest whose range starts there holds an uncommon item, any other a common one.</summary>
    public const long RichChest = 300;

    /// <summary>The rarity of the item a chest holds: uncommon in the richest chests, common in the rest. Never a boss's unique.</summary>
    public static string GearRarity(MapChest chest)
    {
        ArgumentNullException.ThrowIfNull(chest);
        return chest.Gold.Count > 0 && chest.Gold[0] >= RichChest ? "uncommon" : "common";
    }

    public async Task<ChestView> Open(string player, ChestOpen request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        if (content.Space(request.Space) is not { } space || space.Chest(request.Chest ?? string.Empty) is not { } chest)
        {
            throw Refusal.NotFound(Codes.NoSuchPlace, "There is no such chest.");
        }

        if (row.Space != space.Id || new Tile(row.X, row.Z).DistanceTo(chest.At) > 1)
        {
            throw Refusal.Conflict(Codes.NotNear, "You are not at that chest.");
        }

        long now = time.GetUtcNow().ToUnixTimeMilliseconds();
        long found = dice.Between(chest.Gold[0], chest.Gold[1]);
        GearItem? item = devVerdicts.GearRoll(player) ?? dice.Roll(GearChance / 100.0) ? Item(chest) : null;
        GearInstance? gear = null;
        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            ChestRow? opened = await db.Chests.SingleOrDefaultAsync(opened => opened.PlayerId == player && opened.Space == space.Id && opened.Chest == chest.Id).ConfigureAwait(false);
            if (opened is not null && now - opened.OpenedAt < chest.RespawnSeconds * 1000L)
            {
                throw Refusal.Conflict(Codes.Empty, "The chest is empty.");
            }

            if (opened is null) db.Chests.Add(new ChestRow { PlayerId = player, Space = space.Id, Chest = chest.Id, OpenedAt = now });
            else opened.OpenedAt = now;
            GearOwnedRow? owned = item is null ? null : new GearOwnedRow { PlayerId = player, GearId = item.Id, AcquiredAt = now };
            if (owned is not null) db.GearOwned.Add(owned);
            await db.SaveChangesAsync().ConfigureAwait(false);
            await db.Players.Where(stored => stored.Id == player)
                .ExecuteUpdateAsync(set => set.SetProperty(stored => stored.Gold, stored => stored.Gold + found)).ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
            if (owned is not null) gear = new GearInstance(owned.Id, item!);
        }

        db.ChangeTracker.Clear();
        return new ChestView((await characters.Require(player).ConfigureAwait(false)).Gold, found, gear);
    }

    /// <summary>The item a chest holds when its gear roll comes up: any non-unique item of its rarity, or none if there is none.</summary>
    private GearItem? Item(MapChest chest)
    {
        string rarity = GearRarity(chest);
        List<GearItem> items = [.. content.Gear.Values.Where(item => !item.Unique && item.Rarity == rarity).OrderBy(item => item.Id, StringComparer.Ordinal)];
        return items.Count == 0 ? null : items[dice.Below(items.Count)];
    }
}
