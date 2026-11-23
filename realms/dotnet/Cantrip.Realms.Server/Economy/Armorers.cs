using System.Globalization;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// A town's armorer (design.md A4), who works in its smithy (an interior of the town with an <c>armorer</c> NPC): 6 to 10 items of the gear catalogue, a different choice each day, sold at their gold and
/// bought back at half. The day's choice is the same for everyone and needs no store: it is drawn from the town and the
/// UTC day with the spawn table's hash (<see cref="Spawns.Fnv1a32"/>).
/// </summary>
public sealed class Armorers(RealmDb db, RealmContent content, Characters characters, TimeProvider time)
{
    public const int Fewest = 6;
    public const int Most = 10;

    public const string Kind = "armorer";

    /// <summary>The interiors of a town an armorer works in.</summary>
    private IEnumerable<RealmInterior> Smithies(string town) =>
        content.Interiors.Values.Where(interior => interior.Town?.Id == town && interior.Npcs.Any(npc => npc.Kind == Kind));

    private TownEntry Town(string town) =>
        content.Towns.TryGetValue(town, out TownEntry? found) && Smithies(town).Any()
            ? found
            : throw Refusal.NotFound(Codes.NoArmorer, $"There is no armorer in '{town}'.");

    /// <summary>What a town's armorer sells today.</summary>
    public IReadOnlyList<GearItem> Stock(string town)
    {
        TownEntry map = Town(town);
        long day = time.GetUtcNow().ToUnixTimeSeconds() / 86_400;
        List<GearItem> catalogue = [.. content.Gear.Values.Where(item => !item.Unique).OrderBy(item => item.Id, StringComparer.Ordinal)];
        uint seed = Spawns.Fnv1a32(string.Create(CultureInfo.InvariantCulture, $"{map.Id}|armorer|{day}"));
        int count = Math.Min(catalogue.Count, Fewest + (int)(seed % (Most - Fewest + 1)));

        // A Fisher-Yates shuffle driven by the hash, step by step, so it is the same on every server.
        uint state = seed;
        for (int i = catalogue.Count - 1; i > 0; i--)
        {
            state = Spawns.Fnv1a32(state.ToString(CultureInfo.InvariantCulture));
            int j = (int)(state % (uint)(i + 1));
            (catalogue[i], catalogue[j]) = (catalogue[j], catalogue[i]);
        }

        return [.. catalogue.Take(count).OrderBy(item => item.Slot, StringComparer.Ordinal).ThenBy(item => item.Gold)];
    }

    public async Task<GearTradeView> Buy(string player, string town, GearBuy request)
    {
        ArgumentNullException.ThrowIfNull(request);
        await Near(player, town).ConfigureAwait(false);
        GearItem item = Stock(town).FirstOrDefault(item => item.Id == request.GearId)
            ?? throw Refusal.Conflict(Codes.NotInStock, $"The armorer has no '{request.GearId}' today.");

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            if (await db.Players.Where(row => row.Id == player && row.Gold >= item.Gold)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, row => row.Gold - item.Gold)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.CannotAfford, $"{item.Name} is {item.Gold} gold.");
            }

            db.GearOwned.Add(new GearOwnedRow { PlayerId = player, GearId = item.Id, AcquiredAt = time.GetUtcNow().ToUnixTimeMilliseconds() });
            await db.SaveChangesAsync().ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return await Traded(player).ConfigureAwait(false);
    }

    public async Task<GearTradeView> Sell(string player, string town, GearSell request)
    {
        ArgumentNullException.ThrowIfNull(request);
        await Near(player, town).ConfigureAwait(false);
        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            GearOwnedRow owned = await db.GearOwned.SingleOrDefaultAsync(row => row.Id == request.InstanceId && row.PlayerId == player).ConfigureAwait(false)
                ?? throw Refusal.Conflict(Codes.NotOwned, $"You own no gear item {request.InstanceId}.");
            if (await db.Loadout.AnyAsync(slot => slot.PlayerId == player && slot.GearInstanceId == owned.Id).ConfigureAwait(false))
            {
                throw Refusal.Conflict(Codes.Worn, "Take it off first.");
            }

            long pays = content.Gear.TryGetValue(owned.GearId, out GearItem? item) ? item.Gold / 2 : 0;
            db.GearOwned.Remove(owned);
            await db.Players.Where(row => row.Id == player)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, row => row.Gold + pays)).ConfigureAwait(false);
            await db.SaveChangesAsync().ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return await Traded(player).ConfigureAwait(false);
    }

    private async Task<GearTradeView> Traded(string player)
    {
        db.ChangeTracker.Clear();
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        return new GearTradeView(row.Gold, await characters.Gear(player).ConfigureAwait(false));
    }

    private async Task Near(string player, string town)
    {
        Town(town);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        if (!Smithies(town).Any(smithy => smithy.Id == row.Space)) throw Refusal.Conflict(Codes.NotNear, $"The armorer trades in {town}'s smithy.");
    }
}
