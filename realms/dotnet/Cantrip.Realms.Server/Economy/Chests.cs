using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// The finds of the world and its interiors, each a character's own on its own timer, which the <c>chests</c> table keeps
/// (when each was last taken, by whom). Treasure chests (design.md A5): gold within the chest's range, refilling for each
/// player on the chest's own timer, and now and then a gear item (A4, "gear sources"): <see cref="GearChance"/> in a
/// hundred, an item of <see cref="GearRarity"/>. Heartblooms of the wilds (A3b): a heart given back (<see
/// cref="Hearts.Grant"/>), growing back for that character a week after it is picked (<see cref="HeartbloomRegrowth"/>, the
/// world's files say so); a character whose hearts are full can't pick one (409 <c>FullHearts</c>), and it stays. A
/// character takes either standing on it or next to it.
/// </summary>
public sealed class Chests(RealmDb db, RealmContent content, Characters characters, Hearts hearts, RealmDice dice, TimeProvider time, DevVerdicts devVerdicts)
{
    /// <summary>How long a heartbloom takes to grow back for the character who picked it: a week, as a boss rests.</summary>
    public static TimeSpan HeartbloomRegrowth { get; } = TimeSpan.FromDays(7);

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
        if (chest.Heart) return await Pick(player, space, chest, now).ConfigureAwait(false);
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
        PlayerRow after = await characters.Require(player).ConfigureAwait(false);
        return new ChestView(after.Gold, found, gear, after.Hearts);
    }

    /// <summary>
    /// Picks a heartbloom: a heart given back and the bloom gone for the character until it grows back; 409 <c>Empty</c>
    /// while it has not, <c>FullHearts</c> (and the bloom left standing) when their hearts are full.
    /// </summary>
    private async Task<ChestView> Pick(string player, RealmSpace space, MapChest bloom, long now)
    {
        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            ChestRow? picked = await db.Chests.SingleOrDefaultAsync(row => row.PlayerId == player && row.Space == space.Id && row.Chest == bloom.Id).ConfigureAwait(false);
            if (picked is not null && now - picked.OpenedAt < bloom.RespawnSeconds * 1000L)
            {
                throw Refusal.Conflict(Codes.Empty, "The heartbloom has been picked. It will grow back.");
            }

            // Taken first, and only from as it was read, so two picks at once give one heart; then the heart, or nothing.
            if (picked is null)
            {
                db.Chests.Add(new ChestRow { PlayerId = player, Space = space.Id, Chest = bloom.Id, OpenedAt = now });
                await db.SaveChangesAsync().ConfigureAwait(false);
            }
            else if (await db.Chests.Where(row => row.PlayerId == player && row.Space == space.Id && row.Chest == bloom.Id && row.OpenedAt == picked.OpenedAt)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.OpenedAt, now)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.Empty, "The heartbloom has been picked. It will grow back.");
            }

            if (!await hearts.Grant(player).ConfigureAwait(false))
            {
                throw Refusal.Conflict(Codes.FullHearts, "Your hearts are full. The heartbloom will keep.");
            }

            await transaction.CommitAsync().ConfigureAwait(false);
        }

        db.ChangeTracker.Clear();
        PlayerRow after = await characters.Require(player).ConfigureAwait(false);
        return new ChestView(after.Gold, 0, null, after.Hearts, Heart: true);
    }

    /// <summary>
    /// The heartblooms of the world a character has picked that have not grown back, with when each does (the
    /// <c>Character</c>'s <c>Picked</c>): what the overworld draws without its bloom.
    /// </summary>
    public static async Task<List<PickedView>> Picked(RealmDb db, RealmContent content, string player, long now)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(content);
        List<ChestRow> rows = await db.Chests.AsNoTracking().Where(row => row.PlayerId == player && row.Space == RealmContent.WorldSpace).ToListAsync().ConfigureAwait(false);
        return [.. rows
            .Select(row => (Row: row, Bloom: content.World.Chest(row.Chest)))
            .Where(pair => pair.Bloom is { Heart: true } && now - pair.Row.OpenedAt < pair.Bloom.RespawnSeconds * 1000L)
            .Select(pair => new PickedView(pair.Bloom!.Id, DateTimeOffset.FromUnixTimeMilliseconds(pair.Row.OpenedAt + (pair.Bloom.RespawnSeconds * 1000L))))
            .OrderBy(view => view.Chest, StringComparer.Ordinal)];
    }

    /// <summary>The item a chest holds when its gear roll comes up: any non-unique item of its rarity, or none if there is none.</summary>
    private GearItem? Item(MapChest chest)
    {
        string rarity = GearRarity(chest);
        List<GearItem> items = [.. content.Gear.Values.Where(item => !item.Unique && item.Rarity == rarity).OrderBy(item => item.Id, StringComparer.Ordinal)];
        return items.Count == 0 ? null : items[dice.Below(items.Count)];
    }
}
