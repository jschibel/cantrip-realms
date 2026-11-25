using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// The card vendors (design.md A5): global, shared state. Each trades only in its specialty, sells at list price and buys at
/// half from a finite purse. Every hour on the clock its purse gains 2,000 gold and 300 more for each player who visited it
/// in the hour before, to a ceiling of 500,000, and three new cards of its specialty come in, each leaving if unsold within
/// 24 hours; twelve are seeded when it is created. A card a player sells stays at full price until bought, and once 60 such
/// cards are on its shelves it buys nothing more.
/// <para>
/// The exotic dealers (design.md A5, "Wares from other planes") deal in off-plane cards alone, and no other vendor in
/// any: an exotic wares shop shows at most six, gains one every six hours while it shows fewer, and lets one go unsold
/// after three days; a traveling trader trades only while its caravan is in the character's town (<see cref="Travelers"/>),
/// brings three cards of its plane to each visit, and takes what it bought away with it when the visit ends.
/// </para>
/// <para>
/// A vendor is brought up to the hour whenever anyone looks at or trades with it, and by <see cref="RealmClock"/> every hour
/// besides, so its state never depends on when anyone looked. Time is the injected <see cref="TimeProvider"/>'s. A purchase
/// or a sale changes the player's gold and collection and the vendor's purse and stock in one transaction, each change a
/// conditional update, so two players racing for the last copy cannot both have it.
/// </para>
/// </summary>
public sealed class Vendors(RealmDb db, RealmContent content, Characters characters, RealmDice dice, TimeProvider time)
{
    public const long HourlyTrickle = 2000;
    public const long PerVisitor = 300;
    public const long PurseCeiling = 500_000;
    public const int RotatedEachHour = 3;
    public const int SeededAtCreation = 12;
    public const int MostSold = 60;
    public static TimeSpan Shelf { get; } = TimeSpan.FromHours(24);

    /// <summary>The most off-plane cards an exotic wares shop shows.</summary>
    public const int ExoticShown = 6;

    /// <summary>How often an exotic wares shop gains a card, in hours.</summary>
    public const int ExoticEvery = 6;

    /// <summary>How long an off-plane card stays on an exotic wares shop's shelf unsold.</summary>
    public static TimeSpan ExoticShelf { get; } = TimeSpan.FromDays(3);

    private const long HourMs = 3_600_000;

    private long Now => time.GetUtcNow().ToUnixTimeMilliseconds();

    public Vendor Require(string id) =>
        content.Vendors.GetValueOrDefault(id) ?? throw Refusal.NotFound(Codes.NoVendor, $"There is no vendor '{id}'.");

    /// <summary>Creates every vendor of the content not yet in the store, with its purse and its twelve seeded cards.</summary>
    public async Task CreateMissing()
    {
        HashSet<string> known = [.. await db.Vendors.Select(vendor => vendor.Id).ToListAsync().ConfigureAwait(false)];
        long now = Now;
        foreach (Vendor vendor in content.Vendors.Values.Where(vendor => !known.Contains(vendor.Id)))
        {
            db.Vendors.Add(new VendorRow { Id = vendor.Id, Purse = vendor.File.Purse, Hour = now / HourMs, CreatedAt = now, Visit = -1 });
            if (vendor.Kind == Vendor.Shop)
            {
                foreach (string card in Specialty(vendor).Count > 0 ? Enumerable.Range(0, SeededAtCreation).Select(_ => Pick(vendor)) : [])
                {
                    db.VendorStock.Add(new VendorStockRow { VendorId = vendor.Id, Name = card, Count = 1, Source = VendorStockRow.Seeded, AddedAt = now, Until = now + (long)Shelf.TotalMilliseconds });
                }
            }
            else if (vendor.Kind == Vendor.ExoticShop && Specialty(vendor).Count > 0)
            {
                // A full shelf, as if it had filled a card every six hours: the oldest leaves first.
                for (int i = 0; i < ExoticShown; i++)
                {
                    long until = now + (long)ExoticShelf.TotalMilliseconds - (i * ExoticEvery * HourMs);
                    db.VendorStock.Add(new VendorStockRow { VendorId = vendor.Id, Name = Pick(vendor), Count = 1, Source = VendorStockRow.Seeded, AddedAt = now, Until = until });
                }
            }
        }

        await db.SaveChangesAsync().ConfigureAwait(false);
    }

    /// <summary>What a vendor stocks: its plane's pool in its specialty; an exotic shop's off-plane cards in it; a trader's, its plane's.</summary>
    private IReadOnlyList<string> Specialty(Vendor vendor) => vendor.Kind switch
    {
        Vendor.Traveler => content.Cards.OffPlaneFilter(new CardFilter(), vendor.File.Trader!.Plane),
        Vendor.ExoticShop => content.Cards.OffPlaneFilter(vendor.File.Specialty),
        _ => content.Cards.Filter(vendor.Plane, vendor.File.Specialty),
    };

    /// <summary>
    /// Whether a vendor buys a card: a shop of Dominaria its plane's cards of its specialty, never an off-plane card; an
    /// exotic shop off-plane cards of its specialty; a trader any off-plane card.
    /// </summary>
    private bool Buys(Vendor vendor, string name) => vendor.Kind switch
    {
        Vendor.Traveler => content.Cards.IsOffPlane(name),
        Vendor.ExoticShop => content.Cards.IsOffPlane(name) && content.Cards.Fits(name, vendor.File.Specialty),
        _ => content.Cards.Fits(name, vendor.File.Specialty) && content.Cards.Pool(vendor.Plane).Contains(name, StringComparer.Ordinal),
    };

    private string Pick(Vendor vendor)
    {
        IReadOnlyList<string> pool = Specialty(vendor);
        return pool[dice.Below(pool.Count)];
    }

    /// <summary>
    /// Brings a vendor up to the hour: each hour since it last was, its trickle (counting the visitors of the hour before)
    /// and three new cards; then whatever has been on the shelf 24 hours leaves.
    /// </summary>
    public async Task<VendorRow> Advance(Vendor vendor)
    {
        ArgumentNullException.ThrowIfNull(vendor);
        long now = Now;
        long hour = now / HourMs;
        VendorRow row = await db.Vendors.SingleOrDefaultAsync(row => row.Id == vendor.Id).ConfigureAwait(false)
            ?? throw new InvalidOperationException($"Vendor {vendor.Id} has not been created.");
        if (row.Hour < hour)
        {
            long from = row.Hour;
            Dictionary<long, int> visitors = await db.VendorVisits
                .Where(visit => visit.VendorId == vendor.Id && visit.Hour >= from && visit.Hour < hour)
                .GroupBy(visit => visit.Hour)
                .Select(group => new { Hour = group.Key, Count = group.Count() })
                .ToDictionaryAsync(group => group.Hour, group => group.Count).ConfigureAwait(false);

            long purse = row.Purse;
            bool stocks = Specialty(vendor).Count > 0;
            List<(long AddedAt, long? Until)> shown = vendor.Kind == Vendor.ExoticShop
                ? [.. (await db.VendorStock.AsNoTracking().Where(item => item.VendorId == vendor.Id && item.Count > 0).Select(item => new { item.AddedAt, item.Until, item.Count }).ToListAsync().ConfigureAwait(false))
                    .SelectMany(item => Enumerable.Repeat((item.AddedAt, item.Until), item.Count))]
                : [];
            for (long h = from + 1; h <= hour; h++)
            {
                // The hour that just ended is h - 1: its visitors are what this hour's trickle counts.
                long gained = HourlyTrickle + (PerVisitor * visitors.GetValueOrDefault(h - 1));
                purse = Math.Max(purse, Math.Min(PurseCeiling, purse + gained));

                long added = h * HourMs;
                if (vendor.Kind == Vendor.ExoticShop)
                {
                    // A card every six hours while it shows fewer than six then; each leaves unsold after three days.
                    long leaves = added + (long)ExoticShelf.TotalMilliseconds;
                    if (stocks && h % ExoticEvery == 0 && shown.Count(item => item.AddedAt <= added && (item.Until is null || item.Until > added)) < ExoticShown)
                    {
                        shown.Add((added, leaves));
                        if (leaves > now) db.VendorStock.Add(new VendorStockRow { VendorId = vendor.Id, Name = Pick(vendor), Count = 1, Source = VendorStockRow.Rotated, AddedAt = added, Until = leaves });
                    }

                    continue;
                }

                long until = added + (long)Shelf.TotalMilliseconds;
                if (stocks && until > now && vendor.Kind == Vendor.Shop)
                {
                    for (int i = 0; i < RotatedEachHour; i++)
                    {
                        db.VendorStock.Add(new VendorStockRow { VendorId = vendor.Id, Name = Pick(vendor), Count = 1, Source = VendorStockRow.Rotated, AddedAt = added, Until = until });
                    }
                }
            }

            await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
            {
                // The purse moves by what the hours added, so a trade made meanwhile stands.
                long gained = purse - row.Purse;
                int moved = await db.Vendors.Where(stored => stored.Id == vendor.Id && stored.Hour == from)
                    .ExecuteUpdateAsync(set => set.SetProperty(stored => stored.Hour, hour).SetProperty(stored => stored.Purse, stored => stored.Purse + gained))
                    .ConfigureAwait(false);
                if (moved == 1)
                {
                    await db.SaveChangesAsync().ConfigureAwait(false);
                    await transaction.CommitAsync().ConfigureAwait(false);
                }
                else
                {
                    // Someone else brought it up to the hour first: theirs stands, and what was added here is let go.
                    db.ChangeTracker.Clear();
                }
            }

            await db.VendorVisits.Where(visit => visit.VendorId == vendor.Id && visit.Hour < hour - 1).ExecuteDeleteAsync().ConfigureAwait(false);
        }

        await db.VendorStock.Where(stock => stock.VendorId == vendor.Id && stock.Until != null && stock.Until <= now).ExecuteDeleteAsync().ConfigureAwait(false);
        db.ChangeTracker.Clear();
        if (vendor.File.Trader is { } round && Travelers.Current(round, now) is { } visit)
        {
            await Arrive(vendor, visit).ConfigureAwait(false);
        }

        return await db.Vendors.AsNoTracking().SingleAsync(stored => stored.Id == vendor.Id).ConfigureAwait(false);
    }

    /// <summary>A caravan come to town: three cards of its plane for the visit, once a visit, leaving when it does.</summary>
    private async Task Arrive(Vendor vendor, Travelers.Visit visit)
    {
        await using var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false);
        if (await db.Vendors.Where(stored => stored.Id == vendor.Id && stored.Visit != visit.Day)
            .ExecuteUpdateAsync(set => set.SetProperty(stored => stored.Visit, visit.Day)).ConfigureAwait(false) != 1)
        {
            return;
        }

        foreach (string card in dice.Draw(Specialty(vendor), Travelers.Brought))
        {
            db.VendorStock.Add(new VendorStockRow { VendorId = vendor.Id, Name = card, Count = 1, Source = VendorStockRow.Rotated, AddedAt = visit.From, Until = visit.Until });
        }

        await db.SaveChangesAsync().ConfigureAwait(false);
        await transaction.CommitAsync().ConfigureAwait(false);
        db.ChangeTracker.Clear();
    }

    /// <summary>Brings every vendor up to the hour.</summary>
    public async Task AdvanceAll()
    {
        await CreateMissing().ConfigureAwait(false);
        foreach (Vendor vendor in content.Vendors.Values)
        {
            await Advance(vendor).ConfigureAwait(false);
        }
    }

    /// <summary>A vendor as a visiting player sees it; the visit counts toward the next hour's trickle.</summary>
    public async Task<VendorView> Visit(string player, string id)
    {
        Vendor vendor = Require(id);
        await Near(player, vendor).ConfigureAwait(false);
        VendorRow row = await Advance(vendor).ConfigureAwait(false);

        long hour = Now / HourMs;
        if (!await db.VendorVisits.AnyAsync(visit => visit.VendorId == vendor.Id && visit.PlayerId == player && visit.Hour == hour).ConfigureAwait(false))
        {
            db.VendorVisits.Add(new VendorVisitRow { VendorId = vendor.Id, PlayerId = player, Hour = hour });
            try
            {
                await db.SaveChangesAsync().ConfigureAwait(false);
            }
            catch (DbUpdateException)
            {
                // The same player's other request counted this hour's visit first.
                db.ChangeTracker.Clear();
            }
        }

        return await View(player, vendor, row).ConfigureAwait(false);
    }

    private async Task<VendorView> View(string player, Vendor vendor, VendorRow row)
    {
        List<VendorStockRow> stock = await db.VendorStock.AsNoTracking().Where(item => item.VendorId == vendor.Id && item.Count > 0).ToListAsync().ConfigureAwait(false);
        List<StockView> shelf = [.. stock
            .GroupBy(item => (item.Name, item.Until))
            .Select(group => new StockView(
                group.Key.Name,
                content.Cards.Price(group.Key.Name) ?? 0,
                group.Sum(item => item.Count),
                group.Key.Until is { } until ? DateTimeOffset.FromUnixTimeMilliseconds(until) : null))
            .OrderBy(item => item.Name, StringComparer.Ordinal)
            .ThenBy(item => item.Until ?? DateTimeOffset.MaxValue)];
        PlayerRow character = await characters.Require(player).ConfigureAwait(false);
        string town = vendor.File.Trader is { } round ? Travelers.Current(round, Now)?.Town ?? string.Empty : vendor.File.Town;
        return new VendorView(
            new VendorInfo(vendor.Id, vendor.File.Name, town, vendor.File.Specialty, vendor.Kind, vendor.File.Trader?.Plane),
            row.Purse,
            shelf,
            character.Gold,
            await Buying(player, vendor).ConfigureAwait(false));
    }

    /// <summary>The character's cards a vendor deals in - those <see cref="Sell"/> would not refuse as <c>NotTheirTrade</c> - in name order.</summary>
    private async Task<List<BuyingView>> Buying(string player, Vendor vendor)
    {
        Dictionary<string, int> owned = await db.Collection.AsNoTracking().Where(row => row.PlayerId == player && row.Count > 0)
            .ToDictionaryAsync(row => row.Name, row => row.Count, StringComparer.Ordinal).ConfigureAwait(false);
        List<string> traded = [.. owned.Keys.Where(name => Buys(vendor, name)).Order(StringComparer.Ordinal)];
        if (traded.Count == 0) return [];

        Dictionary<string, int> used = new(StringComparer.Ordinal);
        foreach ((string name, int count) in (await db.Deck.AsNoTracking().Where(row => row.PlayerId == player && traded.Contains(row.Name)).Select(row => new { row.Name, row.Count }).ToListAsync().ConfigureAwait(false))
            .Concat(await db.Sideboard.AsNoTracking().Where(row => row.PlayerId == player && traded.Contains(row.Name)).Select(row => new { row.Name, row.Count }).ToListAsync().ConfigureAwait(false))
            .Select(row => (row.Name, row.Count)))
        {
            used[name] = used.GetValueOrDefault(name) + count;
        }

        return [.. traded.Select(name => new BuyingView(name, Pricing.BuyPrice(content.Cards.Price(name)!.Value), owned[name], Math.Max(0, owned[name] - used.GetValueOrDefault(name))))];
    }

    /// <summary>Buys a copy of a card from a vendor at its list price.</summary>
    public async Task<TradeView> Buy(string player, string id, CardTrade request)
    {
        ArgumentNullException.ThrowIfNull(request);
        Vendor vendor = Require(id);
        await Near(player, vendor).ConfigureAwait(false);
        await Advance(vendor).ConfigureAwait(false);
        string name = request.Name ?? throw Refusal.BadRequest("A purchase names a card.");
        long price = content.Cards.Price(name) ?? throw Refusal.Conflict(Codes.SoldOut, $"{vendor.File.Name} has no {name}.");
        long now = Now;

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            // The copy that would leave the shelf soonest; a card a player sold, which never leaves, last.
            long? shelf = await db.VendorStock
                .Where(item => item.VendorId == vendor.Id && item.Name == name && item.Count > 0 && (item.Until == null || item.Until > now))
                .OrderBy(item => item.Until == null).ThenBy(item => item.Until).ThenBy(item => item.Id)
                .Select(item => (long?)item.Id).FirstOrDefaultAsync().ConfigureAwait(false);
            if (shelf is not { } stockId
                || await db.VendorStock.Where(item => item.Id == stockId && item.Count > 0)
                    .ExecuteUpdateAsync(set => set.SetProperty(item => item.Count, item => item.Count - 1)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.SoldOut, $"{vendor.File.Name} has no {name} left.");
            }

            if (await db.Players.Where(row => row.Id == player && row.Gold >= price)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, row => row.Gold - price)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.CannotAfford, $"{name} is {price} gold.");
            }

            await db.Vendors.Where(row => row.Id == vendor.Id)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Purse, row => row.Purse + price)).ConfigureAwait(false);
            await db.VendorStock.Where(item => item.Id == stockId && item.Count <= 0).ExecuteDeleteAsync().ConfigureAwait(false);
            await characters.AddToCollection(player, name, 1).ConfigureAwait(false);
            await db.SaveChangesAsync().ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return await Traded(player).ConfigureAwait(false);
    }

    /// <summary>Sells a copy of a card to a vendor at half its list price.</summary>
    public async Task<TradeView> Sell(string player, string id, CardTrade request)
    {
        ArgumentNullException.ThrowIfNull(request);
        Vendor vendor = Require(id);
        await Near(player, vendor).ConfigureAwait(false);
        await Advance(vendor).ConfigureAwait(false);
        string name = request.Name ?? throw Refusal.BadRequest("A sale names a card.");
        if (content.Cards.IsRelic(name)) throw Refusal.Conflict(Codes.Relic, $"{name} is a relic: nobody buys one, and it is never sold.");
        if (!Buys(vendor, name))
        {
            throw Refusal.Conflict(Codes.NotTheirTrade, $"{vendor.File.Name} doesn't deal in {name}.");
        }

        long pays = Pricing.BuyPrice(content.Cards.Price(name)!.Value);
        long now = Now;

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            int owned = await db.Collection.Where(row => row.PlayerId == player && row.Name == name).Select(row => row.Count).FirstOrDefaultAsync().ConfigureAwait(false);
            if (owned <= 0) throw Refusal.Conflict(Codes.NotOwned, $"You have no {name}.");
            int used = await db.Deck.Where(row => row.PlayerId == player && row.Name == name).SumAsync(row => row.Count).ConfigureAwait(false)
                + await db.Sideboard.Where(row => row.PlayerId == player && row.Name == name).SumAsync(row => row.Count).ConfigureAwait(false);
            if (owned - 1 < used) throw Refusal.Conflict(Codes.InDeck, $"Every {name} you own is in your deck or your sideboard.");

            // A shop of Dominaria keeps sixty sold cards; an exotic shop shows six cards in all; a caravan has room for all.
            int sold = await db.VendorStock.Where(item => item.VendorId == vendor.Id && item.Source == VendorStockRow.Sold).SumAsync(item => item.Count).ConfigureAwait(false);
            int shown = await db.VendorStock.Where(item => item.VendorId == vendor.Id && (item.Until == null || item.Until > now)).SumAsync(item => item.Count).ConfigureAwait(false);
            if (vendor.Kind == Vendor.Shop ? sold >= MostSold : vendor.Kind == Vendor.ExoticShop && shown >= ExoticShown)
            {
                throw Refusal.Conflict(Codes.VendorFull, $"{vendor.File.Name}'s shelves are full.");
            }

            if (await db.Vendors.Where(row => row.Id == vendor.Id && row.Purse >= pays)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Purse, row => row.Purse - pays)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.VendorCannotAfford, $"{vendor.File.Name} can't pay {pays} gold for {name} now.");
            }

            if (await db.Collection.Where(row => row.PlayerId == player && row.Name == name && row.Count >= 1)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Count, row => row.Count - 1)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.NotOwned, $"You have no {name}.");
            }

            await db.Collection.Where(row => row.PlayerId == player && row.Name == name && row.Count <= 0).ExecuteDeleteAsync().ConfigureAwait(false);
            await db.Players.Where(row => row.Id == player)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, row => row.Gold + pays)).ConfigureAwait(false);

            // A card sold to a caravan goes with it when its visit ends; any other stays until bought.
            long? leaves = vendor.File.Trader is { } round ? Travelers.Current(round, now)?.Until : null;
            VendorStockRow? shelf = await db.VendorStock.SingleOrDefaultAsync(item => item.VendorId == vendor.Id && item.Name == name && item.Source == VendorStockRow.Sold && item.Until == leaves).ConfigureAwait(false);
            if (shelf is null) db.VendorStock.Add(new VendorStockRow { VendorId = vendor.Id, Name = name, Count = 1, Source = VendorStockRow.Sold, AddedAt = now, Until = leaves });
            else shelf.Count++;
            await db.SaveChangesAsync().ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return await Traded(player).ConfigureAwait(false);
    }

    private async Task<TradeView> Traded(string player)
    {
        db.ChangeTracker.Clear();
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        return new TradeView(row.Gold, await characters.Collection(player).ConfigureAwait(false));
    }

    /// <summary>
    /// A vendor trades with a character inside its shop: an interior of its town where it keeps a vendor NPC. A trader trades
    /// while its caravan is in the character's town: in the world within the town, or in a building of it.
    /// </summary>
    private async Task Near(string player, Vendor vendor)
    {
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        if (vendor.File.Trader is { } round)
        {
            string? here = row.Space == RealmContent.WorldSpace ? content.TownAt(new Tile(row.X, row.Z))?.Id : content.Interiors.GetValueOrDefault(row.Space)?.Town?.Id;
            if (Travelers.Current(round, Now) is not { } visit || visit.Town != here)
            {
                throw Refusal.Conflict(Codes.NotNear, $"{vendor.File.Name}'s caravan is not in your town now.");
            }

            return;
        }

        if (content.Interiors.GetValueOrDefault(row.Space) is not { } shop || !shop.Npcs.Any(npc => npc.Kind == "vendor" && npc.Vendor == vendor.Id))
        {
            throw Refusal.Conflict(Codes.NotNear, $"{vendor.File.Name} trades in its shop in {vendor.File.Town}.");
        }
    }
}
