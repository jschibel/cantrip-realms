using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// Treasure chests on maps (design.md A5): gold within the chest's range, refilling for each player on the chest's own
/// timer. A character opens one standing on it or next to it.
/// </summary>
public sealed class Chests(RealmDb db, RealmContent content, Characters characters, RealmDice dice, TimeProvider time)
{
    public async Task<ChestView> Open(string player, ChestOpen request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        if (request.Map is null || !content.Maps.TryGetValue(request.Map, out RealmMap? map) || map.Chest(request.Chest ?? string.Empty) is not { } chest)
        {
            throw Refusal.NotFound(Codes.NoSuchPlace, "There is no such chest.");
        }

        if (row.Map != map.Id || new Hex(row.Q, row.R).DistanceTo(chest.At) > 1)
        {
            throw Refusal.Conflict(Codes.NotNear, "You are not at that chest.");
        }

        long now = time.GetUtcNow().ToUnixTimeMilliseconds();
        long found = dice.Between(chest.Gold[0], chest.Gold[1]);
        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            ChestRow? opened = await db.Chests.SingleOrDefaultAsync(opened => opened.PlayerId == player && opened.Map == map.Id && opened.Chest == chest.Id).ConfigureAwait(false);
            if (opened is not null && now - opened.OpenedAt < chest.RespawnSeconds * 1000L)
            {
                throw Refusal.Conflict(Codes.Empty, "The chest is empty.");
            }

            if (opened is null) db.Chests.Add(new ChestRow { PlayerId = player, Map = map.Id, Chest = chest.Id, OpenedAt = now });
            else opened.OpenedAt = now;
            await db.SaveChangesAsync().ConfigureAwait(false);
            await db.Players.Where(stored => stored.Id == player)
                .ExecuteUpdateAsync(set => set.SetProperty(stored => stored.Gold, stored => stored.Gold + found)).ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        db.ChangeTracker.Clear();
        return new ChestView((await characters.Require(player).ConfigureAwait(false)).Gold, found);
    }
}
