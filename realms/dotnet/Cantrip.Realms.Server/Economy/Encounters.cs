using System.Text.Json;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Duels;
using Cantrip.Server;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Economy;

/// <summary>
/// Duels against mobs (design.md A3; tech.md B4, "the encounter protocol"). Starting one checks that the mob could be at
/// that spawn for this player now (<see cref="Spawns"/>, this epoch or the one before), that the character stands near it,
/// and that the spawn has not been fought this epoch; then commits the seed, the mob, both seats and the prize cap. The
/// browser plays it; finishing it checks the log (<see cref="IDuelVerifier"/>) and pays out - gold, three cards offered
/// under the cap, perhaps a gear item - or takes a random ante card and sends the character to the nearest inn. A duel never
/// finished is lost when the next one starts, or after 24 hours.
/// </summary>
public sealed class Encounters(
    RealmDb db,
    RealmContent content,
    Characters characters,
    DecksAndGear decks,
    IDuelVerifier verifier,
    RealmDice dice,
    TimeProvider time)
{
    /// <summary>How far past its wander radius a mob gives chase (design.md A6).</summary>
    public const int ChaseRadius = 6;

    /// <summary>Slack for a character who has walked on since last reporting where they were.</summary>
    public const int Slack = 2;

    /// <summary>How long a duel may be left unfinished before it counts as lost.</summary>
    public static TimeSpan Abandoned { get; } = TimeSpan.FromHours(24);

    /// <summary>How many cards a win offers.</summary>
    public const int Offered = 3;

    /// <summary>The chance, in percent, of a gear drop on a win, by tier (design.md A3); a boss always drops one.</summary>
    public static IReadOnlyDictionary<int, int> GearChance { get; } = new Dictionary<int, int> { [1] = 10, [2] = 15, [3] = 20, [4] = 30 };

    private static readonly JsonSerializerOptions Json = new();

    private long Now => time.GetUtcNow().ToUnixTimeMilliseconds();

    /// <summary>Starts a duel with a spawn's mob.</summary>
    public async Task<EncounterView> Start(string player, EncounterStart request)
    {
        ArgumentNullException.ThrowIfNull(request);
        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        await SettleAbandoned(player).ConfigureAwait(false);

        DuelRow? open = await db.Duels.FirstOrDefaultAsync(duel => duel.PlayerId == player && duel.State == DuelRow.Open).ConfigureAwait(false);
        if (open is not null)
        {
            await Lose(open, "Left unfinished when another duel began.").ConfigureAwait(false);
            throw Refusal.Conflict(Codes.Unfinished, "The duel before this one was never finished, so it counts as lost: you are back at the inn.");
        }

        if (request.Map is null || !content.Maps.TryGetValue(request.Map, out RealmMap? map)) throw Refusal.NotFound(Codes.NotThere, $"There is no map '{request.Map}'.");
        MapSpawn spawn = map.Spawn(request.Spawn ?? string.Empty) ?? throw Refusal.NotFound(Codes.NotThere, $"{map.File.Name} has no spawn '{request.Spawn}'.");
        if (request.Mob is null || !content.Mobs.TryGetValue(request.Mob, out Mob? mob) || !spawn.Mobs.Contains(mob.Id, StringComparer.Ordinal))
        {
            throw Refusal.Conflict(Codes.NotThere, $"'{request.Mob}' does not spawn there.");
        }

        if (row.Map != map.Id || new Hex(row.Q, row.R).DistanceTo(spawn.At) > spawn.Radius + ChaseRadius + Slack)
        {
            throw Refusal.Conflict(Codes.NotNear, $"You are too far from where {mob.File.Name} roams.");
        }

        // This epoch's mob, or the last one's for a fight begun just as the epoch turned; once per spawn per epoch.
        long epoch = Spawns.Epoch(time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds);
        List<long> epochs = [.. new[] { epoch, epoch - 1 }.Where(candidate => Spawns.MobOf(player, map.Id, spawn.Id, candidate, spawn.Mobs) == mob.Id)];
        if (epochs.Count == 0) throw Refusal.Conflict(Codes.NotThere, $"{mob.File.Name} is not at that spawn now.");
        HashSet<long> fought = [.. await db.Duels.Where(duel => duel.PlayerId == player && duel.Map == map.Id && duel.Spawn == spawn.Id && epochs.Contains(duel.Epoch))
            .Select(duel => duel.Epoch).ToListAsync().ConfigureAwait(false)];
        long free = epochs.FirstOrDefault(candidate => !fought.Contains(candidate), long.MinValue);
        if (free == long.MinValue)
        {
            throw Refusal.Conflict(Codes.TooSoon, $"You have fought {mob.File.Name} here already; it is back later.");
        }

        DeckView deck = await decks.View(player).ConfigureAwait(false);
        List<string> problems = await decks.Problems(player, deck.Main, deck.Ante).ConfigureAwait(false);
        if (problems.Count > 0) throw Refusal.Unprocessable(Codes.IllegalDeck, "Your deck can't be played as it is: fix it at a spell table.", problems);

        CharacterView character = await characters.View(player).ConfigureAwait(false);
        long seed = dice.Seed();
        long cap = Math.Min(deck.AnteValue, mob.File.Prize);
        var duel = new Duel(
            [PlayerSeat(character, deck), MobSeat(mob)],
            Duel.RealmMinimumDeckSize,
            seed,
            new DuelMob(mob.File.Name, mob.File.Boss ? 0 : mob.File.Tier, mob.File.Prize),
            deck.AnteValue,
            cap);

        string token = RealmDice.Token();
        db.Duels.Add(new DuelRow
        {
            Token = token,
            PlayerId = player,
            Map = map.Id,
            Spawn = spawn.Id,
            Epoch = free,
            Mob = mob.Id,
            Seed = seed,
            StartedAt = Now,
            State = DuelRow.Open,
            Spec = JsonSerializer.Serialize(duel, Json),
            Ante = JsonSerializer.Serialize(deck.Ante, Json),
            AnteValue = deck.AnteValue,
            Cap = cap,
        });

        try
        {
            await db.SaveChangesAsync().ConfigureAwait(false);
        }
        catch (DbUpdateException)
        {
            throw Refusal.Conflict(Codes.TooSoon, $"You have fought {mob.File.Name} here already; it is back later.");
        }

        return new EncounterView(token, seed, duel);
    }

    /// <summary>The player's seat: their deck, their stats with their gear's, an emblem per worn item with effects.</summary>
    public static DuelSeat PlayerSeat(CharacterView character, DeckView deck)
    {
        ArgumentNullException.ThrowIfNull(character);
        ArgumentNullException.ThrowIfNull(deck);
        List<GearItem> worn = [.. RealmContent.LoadoutSlots.Keys.Select(slot => character.Loadout.GetValueOrDefault(slot)?.Gear).OfType<GearItem>()];
        GearStats stats = Characters.Stats(worn);
        return new DuelSeat(
            character.Name,
            [.. deck.Main.SelectMany(card => Enumerable.Repeat(card.Name, card.Count))],
            [],
            null,
            [],
            stats.Life,
            stats.Hand,
            stats.MaxHand,
            [.. worn.Select(item => item.Emblem).OfType<string>()]);
    }

    /// <summary>The mob's seat: its deck, its stats with its gear's, and its gear's emblems.</summary>
    public DuelSeat MobSeat(Mob mob)
    {
        ArgumentNullException.ThrowIfNull(mob);
        List<GearItem> worn = [.. mob.File.Gear.Select(id => content.Gear[id])];
        GearStats stats = worn.Aggregate(mob.File.Stats, (sum, item) => sum + item.Stats);
        return new DuelSeat(
            mob.File.Name,
            [.. mob.Deck.Entries.SelectMany(entry => Enumerable.Repeat(entry.Card, entry.Copies))],
            [],
            null,
            [],
            stats.Life,
            stats.Hand,
            stats.MaxHand,
            [.. worn.Select(item => item.Emblem).OfType<string>()]);
    }

    /// <summary>Finishes a duel with the browser's log: checked, then won or lost.</summary>
    public async Task<OutcomeView> Finish(string player, EncounterFinish request)
    {
        ArgumentNullException.ThrowIfNull(request);
        await characters.Require(player).ConfigureAwait(false);
        DuelRow duel = await Owned(player, request.Token).ConfigureAwait(false);
        if (duel.State != DuelRow.Open) throw Refusal.Conflict(Codes.Finished, "That duel is over.");

        if (Now - duel.StartedAt > (long)Abandoned.TotalMilliseconds)
        {
            await Lose(duel, "Left unfinished for 24 hours.").ConfigureAwait(false);
            return new OutcomeView("lost", 0, [], duel.Cap, null, duel.Detail);
        }

        Duel spec = JsonSerializer.Deserialize<Duel>(duel.Spec, Json)!;
        IReadOnlyList<string> log = request.Log ?? [];
        DuelVerdict verdict = await Task.Run(() => verifier.Verify(spec, log)).ConfigureAwait(false);
        if (!verdict.PlayerWon)
        {
            string detail = verdict.Accepted ? (verdict.Winners.Count == 0 ? "A draw." : "The mob won.") : $"The log was not a game of this duel: {verdict.Problem}";
            await Lose(duel, detail).ConfigureAwait(false);
            return new OutcomeView("lost", 0, [], duel.Cap, null, detail);
        }

        Mob mob = content.Mobs[duel.Mob];
        long gold = dice.Between(mob.File.GoldRange[0], mob.File.GoldRange[1]);
        List<string> offer = Offer(mob, duel.Cap);
        GearItem? drop = mob.File.Boss || dice.Chance(GearChance.GetValueOrDefault(mob.File.Tier)) ? Drop(mob) : null;

        await using var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false);
        if (await db.Duels.Where(row => row.Token == duel.Token && row.State == DuelRow.Open)
            .ExecuteUpdateAsync(set => set
                .SetProperty(row => row.State, DuelRow.Won)
                .SetProperty(row => row.FinishedAt, Now)
                .SetProperty(row => row.Gold, gold)
                .SetProperty(row => row.Offer, JsonSerializer.Serialize(offer, Json))).ConfigureAwait(false) != 1)
        {
            throw Refusal.Conflict(Codes.Finished, "That duel is over.");
        }

        await db.Players.Where(row => row.Id == player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, row => row.Gold + gold)).ConfigureAwait(false);
        GearInstance? dropped = null;
        if (drop is not null)
        {
            var owned = new GearOwnedRow { PlayerId = player, GearId = drop.Id, AcquiredAt = Now };
            db.GearOwned.Add(owned);
            await db.SaveChangesAsync().ConfigureAwait(false);
            dropped = new GearInstance(owned.Id, drop);
        }

        if (mob.File.Boss && mob.File.Unlocks is { } color && !await db.Unlocks.AnyAsync(unlock => unlock.PlayerId == player && unlock.Color == color).ConfigureAwait(false))
        {
            db.Unlocks.Add(new UnlockRow { PlayerId = player, Color = color, At = Now });
            await db.SaveChangesAsync().ConfigureAwait(false);
        }

        await transaction.CommitAsync().ConfigureAwait(false);
        return new OutcomeView("won", gold, offer, duel.Cap, dropped, null);
    }

    /// <summary>
    /// The three cards a win offers (design.md A3): drawn from the mob's loot, each within the cap, so any one of them fits.
    /// With an empty ante the cap is nothing, and nothing is offered.
    /// </summary>
    public List<string> Offer(Mob mob, long cap)
    {
        ArgumentNullException.ThrowIfNull(mob);
        if (cap <= 0) return [];
        List<string> fitting = [.. content.Cards.Filter(mob.File.Loot.Pool ?? mob.Plane, mob.File.Loot).Where(card => content.Cards.Price(card) <= cap)];
        return dice.Draw(fitting, Offered);
    }

    /// <summary>A gear item a win drops: the boss's own unique for a boss, else any item of the tier's rarity.</summary>
    private GearItem? Drop(Mob mob)
    {
        string rarity = mob.File.Tier switch { <= 2 => "common", 3 => "uncommon", _ => "rare" };
        List<GearItem> items = [.. content.Gear.Values.Where(item => mob.File.Boss ? item.Unique : !item.Unique && item.Rarity == rarity).OrderBy(item => item.Id, StringComparer.Ordinal)];
        return items.Count == 0 ? null : items[dice.Below(items.Count)];
    }

    /// <summary>Takes the cards picked from a win's offer: any of them, together within the cap.</summary>
    public async Task<CollectionView> Loot(string player, LootPicks request)
    {
        ArgumentNullException.ThrowIfNull(request);
        await characters.Require(player).ConfigureAwait(false);
        DuelRow duel = await Owned(player, request.Token).ConfigureAwait(false);
        if (duel.State != DuelRow.Won) throw Refusal.Conflict(Codes.Finished, duel.State == DuelRow.Looted ? "That duel's loot is taken." : "That duel was not won.");

        List<string> offer = JsonSerializer.Deserialize<List<string>>(duel.Offer ?? "[]", Json) ?? [];
        List<string> picks = [.. request.Picks ?? []];
        foreach (IGrouping<string, string> picked in picks.GroupBy(pick => pick, StringComparer.Ordinal))
        {
            if (picked.Count() > offer.Count(card => card == picked.Key)) throw Refusal.Unprocessable(Codes.NotOffered, $"{picked.Key} was not offered.");
        }

        long total = picks.Sum(pick => content.Cards.Price(pick) ?? 0);
        if (total > duel.Cap) throw Refusal.Unprocessable(Codes.OverCap, $"Those are worth {total} gold together; the cap is {duel.Cap}.");

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            if (await db.Duels.Where(row => row.Token == duel.Token && row.State == DuelRow.Won)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.State, DuelRow.Looted)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.Finished, "That duel's loot is taken.");
            }

            foreach (string pick in picks)
            {
                await characters.AddToCollection(player, pick, 1).ConfigureAwait(false);
                await db.SaveChangesAsync().ConfigureAwait(false);
            }

            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return await characters.Collection(player).ConfigureAwait(false);
    }

    /// <summary>Counts every duel of a player's left unfinished for 24 hours as lost.</summary>
    public async Task SettleAbandoned(string player)
    {
        long before = Now - (long)Abandoned.TotalMilliseconds;
        foreach (DuelRow duel in await db.Duels.Where(duel => duel.PlayerId == player && duel.State == DuelRow.Open && duel.StartedAt < before).ToListAsync().ConfigureAwait(false))
        {
            await Lose(duel, "Left unfinished for 24 hours.").ConfigureAwait(false);
        }
    }

    /// <summary>Counts every player's duels left unfinished for 24 hours as lost.</summary>
    public async Task SettleAllAbandoned()
    {
        long before = Now - (long)Abandoned.TotalMilliseconds;
        foreach (string player in await db.Duels.Where(duel => duel.State == DuelRow.Open && duel.StartedAt < before).Select(duel => duel.PlayerId).Distinct().ToListAsync().ConfigureAwait(false))
        {
            await SettleAbandoned(player).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// A lost duel (design.md A3): a card of the ante it was fought for, chosen uniformly among its copies, is gone from the
    /// collection and the ante; and the character wakes at the nearest inn. Gold is kept.
    /// </summary>
    private async Task Lose(DuelRow duel, string detail)
    {
        string player = duel.PlayerId;
        await using var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false);
        if (await db.Duels.Where(row => row.Token == duel.Token && row.State == DuelRow.Open)
            .ExecuteUpdateAsync(set => set
                .SetProperty(row => row.State, DuelRow.Lost)
                .SetProperty(row => row.FinishedAt, Now)
                .SetProperty(row => row.Detail, detail)).ConfigureAwait(false) != 1)
        {
            return;
        }

        duel.State = DuelRow.Lost;
        duel.Detail = detail;

        // The ante as the duel began, each copy a ticket, of the cards the character still has.
        List<CardCount> ante = JsonSerializer.Deserialize<List<CardCount>>(duel.Ante, Json) ?? [];
        Dictionary<string, int> owned = await db.Collection.Where(row => row.PlayerId == player)
            .ToDictionaryAsync(row => row.Name, row => row.Count, StringComparer.Ordinal).ConfigureAwait(false);
        List<string> tickets = [.. ante.SelectMany(card => Enumerable.Repeat(card.Name, Math.Min(card.Count, owned.GetValueOrDefault(card.Name))))];
        if (tickets.Count > 0)
        {
            string lost = tickets[dice.Below(tickets.Count)];
            await characters.AddToCollection(player, lost, -1).ConfigureAwait(false);
            AnteRow? anted = await db.Ante.SingleOrDefaultAsync(row => row.PlayerId == player && row.Name == lost).ConfigureAwait(false);
            if (anted is not null)
            {
                anted.Count--;
                if (anted.Count <= 0) db.Ante.Remove(anted);
            }
            else if (await db.Deck.SingleOrDefaultAsync(row => row.PlayerId == player && row.Name == lost).ConfigureAwait(false) is { } decked
                && decked.Count > owned[lost] - 1)
            {
                // The ante changed since the duel began and the deck holds the last copies: the deck gives one up.
                decked.Count--;
                if (decked.Count <= 0) db.Deck.Remove(decked);
            }
        }

        if (content.Maps.TryGetValue(duel.Map, out RealmMap? map))
        {
            (string inn, Hex at) = characters.InnOf(map);
            await db.Players.Where(row => row.Id == player)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Map, inn).SetProperty(row => row.Q, at.Q).SetProperty(row => row.R, at.R)).ConfigureAwait(false);
        }

        await db.SaveChangesAsync().ConfigureAwait(false);
        await transaction.CommitAsync().ConfigureAwait(false);
    }

    private async Task<DuelRow> Owned(string player, string? token) =>
        await db.Duels.SingleOrDefaultAsync(duel => duel.Token == token && duel.PlayerId == player).ConfigureAwait(false)
            ?? throw Refusal.NotFound(Codes.NoDuel, "You have no such duel.");
}
