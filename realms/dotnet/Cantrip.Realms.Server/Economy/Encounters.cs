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
/// and that the spawn has not been fought this epoch; then commits the seed, the mob and both seats. The browser plays it;
/// finishing it checks the log (<see cref="IDuelVerifier"/>). A win pays out - gold, perhaps a gear item, from a boss perhaps
/// a relic (design.md A3a), and from a mage tower's boss its waystone's attunement (A6); a boss's win also unlocks its
/// color, gives a rare or mythic of its loot outright and drops its own unique item the first time (A6). A loss pays
/// nothing and costs a heart (design.md A3b). With hearts left the mob stands over the player, who answers it
/// (<see cref="Pay"/> or <see cref="Rematch"/>): a world mob may be paid off, for gold measured by its tier and the life it
/// has left; a dungeon's is fought again. The next game is the encounter's own: the player at full life with a deck swapped
/// from their sideboard, the mob at the life it ended the last with. With the last heart lost the character dies: home to
/// their inn, their hearts full again, and a dungeon run they died in over and its winnings taken back. A game never
/// finished is lost when the next encounter starts, or after 24 hours. A dungeon run's encounter is started the same way,
/// checked against the run (<see cref="Dungeons"/>) rather than a spawn.
/// </summary>
public sealed class Encounters(
    RealmDb db,
    RealmContent content,
    Characters characters,
    DecksAndGear decks,
    IDuelVerifier verifier,
    RealmDice dice,
    TimeProvider time,
    DevVerdicts devVerdicts,
    DevDuels devDuels)
{
    /// <summary>How far past its wander radius a mob gives chase (design.md A6).</summary>
    public const int ChaseRadius = 6;

    /// <summary>Slack for a character who has walked on since last reporting where they were.</summary>
    public const int Slack = 2;

    /// <summary>How long a duel may be left unfinished before it counts as lost.</summary>
    public static TimeSpan Abandoned { get; } = TimeSpan.FromHours(24);

    /// <summary>
    /// The chance, in percent, of a gear drop on a win, by tier (design.md A3), rolled with <see cref="RealmDice.Roll"/>; a
    /// boss always drops one.
    /// </summary>
    public static IReadOnlyDictionary<int, int> GearChance { get; } = new Dictionary<int, int> { [1] = 10, [2] = 15, [3] = 20, [4] = 30 };

    /// <summary>What a mob of each tier asks to be paid off with when it beat the player without losing a point (design.md A3).</summary>
    public static IReadOnlyDictionary<int, long> BuyoutBase { get; } = new Dictionary<int, long> { [1] = 30, [2] = 120, [3] = 400, [4] = 1_200 };

    private static readonly JsonSerializerOptions Json = new();

    private long Now => time.GetUtcNow().ToUnixTimeMilliseconds();

    /// <summary>
    /// A mob's buyout (design.md A3): its tier's base, in the share of its full starting life it ended the game with - never
    /// more than the whole, however much it gained - rounded, and never less than 1 gold.
    /// </summary>
    public static long Buyout(int tier, int lifeAtEnd, int fullLife)
    {
        long whole = BuyoutBase.TryGetValue(tier, out long gold) ? gold : BuyoutBase[BuyoutBase.Keys.Max()];
        double share = fullLife <= 0 ? 1 : Math.Min(1.0, (double)lifeAtEnd / fullLife);
        return Math.Max(1, (long)Math.Round(whole * share, MidpointRounding.AwayFromZero));
    }

    /// <summary>Starts a duel with a spawn's mob.</summary>
    public async Task<EncounterView> Start(string player, EncounterStart request)
    {
        ArgumentNullException.ThrowIfNull(request);
        await characters.Require(player).ConfigureAwait(false);
        await SettleAbandoned(player).ConfigureAwait(false);

        DuelRow? open = await db.Duels.FirstOrDefaultAsync(duel => duel.PlayerId == player && duel.State == DuelRow.Open).ConfigureAwait(false);
        if (open is not null)
        {
            await Lose(open, "Left unfinished when another duel began.", null).ConfigureAwait(false);
            throw Refusal.Conflict(Codes.Unfinished, "The duel before this one was never finished, so it counts as lost.");
        }

        if (await Pending(player).ConfigureAwait(false) is { } defeated)
        {
            string who = content.Mobs.TryGetValue(defeated.Mob, out Mob? standing) ? standing.File.Name : defeated.Mob;
            throw Refusal.Conflict(Codes.Defeated, $"{who} still stands over you: pay it off or fight it again first.");
        }

        PlayerRow row = await characters.Require(player).ConfigureAwait(false);
        (string space, string spawnId, long free, Mob mob, GearStats? gains) = request.Run is null
            ? await World(player, row, request).ConfigureAwait(false)
            : await InRun(player, row, request).ConfigureAwait(false);

        DeckView deck = await decks.View(player).ConfigureAwait(false);
        List<string> problems = await decks.Problems(player, deck.Main, deck.Sideboard).ConfigureAwait(false);
        if (problems.Count > 0) throw Refusal.Unprocessable(Codes.IllegalDeck, "Your deck can't be played as it is: fix it at a spell table.", problems);

        CharacterView character = await characters.View(player).ConfigureAwait(false);
        long seed = dice.Seed();
        DuelSeat mobSeat = MobSeat(mob, gains);
        (DuelSeat seat1, DuelSeat seat2) = devDuels.Apply(player, PlayerSeat(character, deck.Main, deck.Sideboard), mobSeat);
        Duel duel = Deal(seat1, seat2, mob, seed);

        string token = RealmDice.Token();
        db.Duels.Add(new DuelRow
        {
            Token = token,
            PlayerId = player,
            Space = space,
            Spawn = spawnId,
            Epoch = free,
            Mob = mob.Id,
            Seed = seed,
            StartedAt = Now,
            State = DuelRow.Open,
            Spec = JsonSerializer.Serialize(duel, Json),
            Sideboard = JsonSerializer.Serialize(deck.Sideboard, Json),
            MobLife = mobSeat.StartingLife,
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

    /// <summary>
    /// A world spawn's mob (interfaces.md, "Spawns"): one of the spawn's, the character in the world within its reach, and
    /// the one it holds for this player this epoch or the last, not fought in that epoch. Its space, spawn, epoch and mob
    /// (which gains nothing).
    /// </summary>
    private async Task<(string, string, long, Mob, GearStats?)> World(string player, PlayerRow row, EncounterStart request)
    {
        MapSpawn spawn = content.World.Spawn(request.Spawn ?? string.Empty) ?? throw Refusal.NotFound(Codes.NotThere, $"The world has no spawn '{request.Spawn}'.");
        if (request.Mob is null || !content.Mobs.TryGetValue(request.Mob, out Mob? mob) || !spawn.Mobs.Contains(mob.Id, StringComparer.Ordinal))
        {
            throw Refusal.Conflict(Codes.NotThere, $"'{request.Mob}' does not spawn there.");
        }

        if (row.Space != RealmContent.WorldSpace || new Tile(row.X, row.Z).DistanceTo(spawn.At) > spawn.Radius + ChaseRadius + Slack)
        {
            throw Refusal.Conflict(Codes.NotNear, $"You are too far from where {mob.File.Name} roams.");
        }

        // This epoch's mob, or the last one's for a fight begun just as the epoch turned; once per spawn per epoch.
        long epoch = Spawns.Epoch(time.GetUtcNow().ToUnixTimeSeconds(), spawn.RespawnSeconds);
        List<long> epochs = [.. new[] { epoch, epoch - 1 }.Where(candidate => Spawns.MobOf(player, RealmContent.WorldSpace, spawn.Id, candidate, spawn.Mobs) == mob.Id)];
        if (epochs.Count == 0) throw Refusal.Conflict(Codes.NotThere, $"{mob.File.Name} is not at that spawn now.");
        HashSet<long> fought = [.. await db.Duels.Where(duel => duel.PlayerId == player && duel.Space == RealmContent.WorldSpace && duel.Spawn == spawn.Id && epochs.Contains(duel.Epoch))
            .Select(duel => duel.Epoch).ToListAsync().ConfigureAwait(false)];
        long free = epochs.FirstOrDefault(candidate => !fought.Contains(candidate), long.MinValue);
        if (free == long.MinValue)
        {
            throw Refusal.Conflict(Codes.TooSoon, $"You have fought {mob.File.Name} here already; it is back later.");
        }

        return (RealmContent.WorldSpace, spawn.Id, free, mob, null);
    }

    /// <summary>
    /// A dungeon run's encounter (interfaces.md): the run is the character's and live, they stand in it on the floor named,
    /// and the index is an encounter of that floor not yet fought, whose mob is the one named. Its space, encounter, epoch
    /// (0: each is fought once), mob, and what the mob gains this run: a boss what its run's standing gives it (design.md A6).
    /// </summary>
    private async Task<(string, string, long, Mob, GearStats?)> InRun(string player, PlayerRow row, EncounterStart request)
    {
        RunRow run = await db.Runs.AsNoTracking().SingleOrDefaultAsync(stored => stored.Id == request.Run && stored.PlayerId == player).ConfigureAwait(false)
            ?? throw Refusal.NotFound(Codes.NotThere, "You have no such dungeon run.");
        if (run.State != RunRow.Live) throw Refusal.Conflict(Codes.NotThere, "That run is over.");
        string space = RealmContent.RunSpace(run.Id);
        if (row.Space != space) throw Refusal.Conflict(Codes.NotNear, "You are not in that run.");
        if (request.Floor != run.Floor) throw Refusal.Conflict(Codes.NotThere, $"You stand on floor {run.Floor}, not {request.Floor}.");
        List<RunFloor> floors = Dungeons.FloorsOf(run);
        if (request.Index is not int index || Dungeons.MobAt(floors[run.Floor], index) is not { } at)
        {
            throw Refusal.NotFound(Codes.NotThere, $"Floor {run.Floor} has no encounter {request.Index}.");
        }

        if (request.Mob != at || !content.Mobs.TryGetValue(at, out Mob? mob)) throw Refusal.Conflict(Codes.NotThere, $"'{request.Mob}' is not that encounter's mob.");
        string encounter = Dungeons.EncounterId(run.Floor, index);
        if (await db.Duels.AnyAsync(duel => duel.PlayerId == player && duel.Space == space && duel.Spawn == encounter).ConfigureAwait(false))
        {
            throw Refusal.Conflict(Codes.TooSoon, $"You have fought {mob.File.Name} in this run already.");
        }

        return (space, encounter, 0, mob, index == Dungeons.BossIndex(floors[run.Floor]) ? floors[run.Floor].BossStats : null);
    }

    /// <summary>
    /// A duel against a mob as an encounter deals it: the player's seat and the mob's, the seed, the realm's minimum deck
    /// size, who seat 2 is (a boss's tier 0), which game of its encounter it is and, after the first, who the player chose
    /// to play first. The balance lab deals its games with this too (tools/realms/balance.cmd), so they are the server's
    /// duels.
    /// </summary>
    public static Duel Deal(DuelSeat player, DuelSeat mobSeat, Mob mob, long seed, int game = 1, int? firstPlayer = null)
    {
        ArgumentNullException.ThrowIfNull(player);
        ArgumentNullException.ThrowIfNull(mobSeat);
        ArgumentNullException.ThrowIfNull(mob);
        return new Duel(
            [player, mobSeat],
            Duel.RealmMinimumDeckSize,
            seed,
            new DuelMob(mob.File.Name, mob.File.Boss ? 0 : mob.File.Tier),
            game,
            firstPlayer);
    }

    /// <summary>
    /// The player's seat: their deck and their sideboard (the cards they own outside the game, CR 100.4a), their stats with
    /// their gear's, an emblem per worn item with effects.
    /// </summary>
    public static DuelSeat PlayerSeat(CharacterView character, IReadOnlyList<CardCount> main, IReadOnlyList<CardCount> sideboard)
    {
        ArgumentNullException.ThrowIfNull(character);
        ArgumentNullException.ThrowIfNull(main);
        ArgumentNullException.ThrowIfNull(sideboard);
        List<GearItem> worn = [.. RealmContent.LoadoutSlots.Keys.Select(slot => character.Loadout.GetValueOrDefault(slot)?.Gear).OfType<GearItem>()];
        return PlayerSeat(character.Name, worn, Copies(main), Copies(sideboard));
    }

    /// <summary>Each copy of a list's cards, by name.</summary>
    private static IEnumerable<string> Copies(IEnumerable<CardCount> cards) => cards.SelectMany(card => Enumerable.Repeat(card.Name, card.Count));

    /// <summary>
    /// A player's seat from its parts: the deck, the sideboard, the base stats with the worn items' (in loadout order), an
    /// emblem per worn item with effects.
    /// </summary>
    public static DuelSeat PlayerSeat(string name, IReadOnlyList<GearItem> worn, IEnumerable<string> deck, IEnumerable<string>? sideboard = null)
    {
        ArgumentNullException.ThrowIfNull(worn);
        ArgumentNullException.ThrowIfNull(deck);
        GearStats stats = Characters.Stats(worn);
        return new DuelSeat(
            name,
            [.. deck],
            [.. sideboard ?? []],
            null,
            [],
            stats.Life,
            stats.Hand,
            stats.MaxHand,
            [.. worn.Select(item => item.Emblem).OfType<string>()]);
    }

    /// <summary>
    /// The mob's seat: its deck, its stats with its gear's and with what it gains (a boss of a run dealt by standing,
    /// design.md A6), and its gear's emblems.
    /// </summary>
    public DuelSeat MobSeat(Mob mob, GearStats? gains = null) => MobSeat(content, mob, gains);

    /// <summary>A mob's seat in a duel dealt from <paramref name="content"/>, with what it gains this run (none by default).</summary>
    public static DuelSeat MobSeat(RealmContent content, Mob mob, GearStats? gains = null)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(mob);
        List<GearItem> worn = [.. mob.File.Gear.Select(id => content.Gear[id])];
        GearStats stats = worn.Aggregate(mob.File.Stats, (sum, item) => sum + item.Stats) + (gains ?? GearStats.None);
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

    /// <summary>Finishes a game with the browser's log: checked, then won or lost.</summary>
    public async Task<OutcomeView> Finish(string player, EncounterFinish request)
    {
        ArgumentNullException.ThrowIfNull(request);
        await characters.Require(player).ConfigureAwait(false);
        DuelRow duel = await Owned(player, request.Token).ConfigureAwait(false);
        if (duel.State != DuelRow.Open) throw Refusal.Conflict(Codes.Finished, "That duel is over.");

        if (Now - duel.StartedAt > (long)Abandoned.TotalMilliseconds)
        {
            return await Lose(duel, "Left unfinished for 24 hours.", null).ConfigureAwait(false)
                ?? throw Refusal.Conflict(Codes.Finished, "That duel is over.");
        }

        Duel spec = JsonSerializer.Deserialize<Duel>(duel.Spec, Json)!;
        IReadOnlyList<string> log = request.Log ?? [];
        // A development server's test may have set the verdict (POST /dev/verdict); else the log is replayed.
        DuelVerdict verdict = devVerdicts.For(player, spec) ?? await Task.Run(() => verifier.Verify(spec, log)).ConfigureAwait(false);
        if (!verdict.PlayerWon)
        {
            string detail = verdict.Accepted ? (verdict.Winners.Count == 0 ? "A draw." : "The mob won.") : $"The log was not a game of this duel: {verdict.Problem}";
            return await Lose(duel, detail, verdict.LifeOf(Duel.MobSeat)).ConfigureAwait(false)
                ?? throw Refusal.Conflict(Codes.Finished, "That duel is over.");
        }

        Mob mob = content.Mobs[duel.Mob];
        long gold = dice.Between(mob.File.GoldRange[0], mob.File.GoldRange[1]);
        HashSet<string> gearOwned = mob.File.Boss
            ? [.. await db.GearOwned.Where(row => row.PlayerId == player).Select(row => row.GearId).ToListAsync().ConfigureAwait(false)]
            : [];
        GearItem? drop = mob.File.Boss || (devVerdicts.GearRoll(player) ?? dice.Roll(GearChance.GetValueOrDefault(mob.File.Tier) / 100.0)) ? Drop(mob, gearOwned) : null;
        string? gift = Gift(mob);
        int? mobLifeEnd = verdict.LifeOf(Duel.MobSeat);

        await using var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false);
        if (await db.Duels.Where(row => row.Token == duel.Token && row.State == DuelRow.Open)
            .ExecuteUpdateAsync(set => set
                .SetProperty(row => row.State, DuelRow.Won)
                .SetProperty(row => row.FinishedAt, Now)
                .SetProperty(row => row.Gold, gold)
                .SetProperty(row => row.MobLifeEnd, mobLifeEnd)
                .SetProperty(row => row.Gift, gift)).ConfigureAwait(false) != 1)
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
            await db.Duels.Where(row => row.Token == duel.Token).ExecuteUpdateAsync(set => set.SetProperty(row => row.GearInstance, owned.Id)).ConfigureAwait(false);
        }

        List<string> relics = await DropRelics(player, mob, duel.Token).ConfigureAwait(false);
        await Attune(duel).ConfigureAwait(false);

        string? unlocked = null;
        if (mob.File.Boss && mob.File.Unlocks is { } color && !await db.Unlocks.AnyAsync(unlock => unlock.PlayerId == player && unlock.Color == color).ConfigureAwait(false))
        {
            db.Unlocks.Add(new UnlockRow { PlayerId = player, Color = color, At = Now });
            await db.SaveChangesAsync().ConfigureAwait(false);
            unlocked = color;
        }

        if (gift is not null)
        {
            await characters.AddToCollection(player, gift, 1).ConfigureAwait(false);
            await db.SaveChangesAsync().ConfigureAwait(false);
        }

        await transaction.CommitAsync().ConfigureAwait(false);
        int hearts = await db.Players.Where(row => row.Id == player).Select(row => row.Hearts).SingleAsync().ConfigureAwait(false);
        return new OutcomeView("won", gold, dropped, relics, null, Gift: gift, Unlocked: unlocked, Hearts: hearts);
    }

    /// <summary>
    /// A boss's gift (design.md A6, "a rare or mythic guaranteed"): one rare or mythic of its loot, given outright. None for
    /// any other mob.
    /// </summary>
    public string? Gift(Mob mob)
    {
        ArgumentNullException.ThrowIfNull(mob);
        IReadOnlyList<string> gifts = content.GiftsOf(mob);
        return gifts.Count == 0 ? null : gifts[dice.Below(gifts.Count)];
    }

    /// <summary>
    /// The relics a win against a boss drops (design.md A3a), inside the win's transaction: each relic whose entry names the
    /// boss, unless the account's ledger has it already, is rolled at its chance, apart from the gift, and one that comes up
    /// goes to the collection and the ledger together. The ledger keeps it whatever becomes of the card, so it never drops
    /// for this account again - unless the win is taken back by dying in the run it was won in.
    /// </summary>
    private async Task<List<string>> DropRelics(string player, Mob mob, string token)
    {
        List<RelicEntry> entries = [.. content.RelicsOf(mob)];
        if (entries.Count == 0) return [];
        HashSet<string> had = [.. await db.Relics.Where(row => row.PlayerId == player).Select(row => row.Card).ToListAsync().ConfigureAwait(false)];
        List<string> dropped = [.. entries.Where(relic => !had.Contains(relic.Card) && dice.Roll(relic.Chance)).Select(relic => relic.Card)];
        foreach (string card in dropped)
        {
            db.Relics.Add(new RelicRow { PlayerId = player, Card = card, At = Now, Duel = token });
            await characters.AddToCollection(player, card, 1).ConfigureAwait(false);
        }

        if (dropped.Count > 0) await db.SaveChangesAsync().ConfigureAwait(false);
        return dropped;
    }

    /// <summary>
    /// A win against a mage tower's boss attunes its waystone (design.md A6), inside the win's transaction: the boss of the
    /// run's last floor, in a dungeon with a waystone.
    /// </summary>
    private async Task Attune(DuelRow duel)
    {
        if (RealmContent.RunOf(duel.Space) is not { } id
            || await db.Runs.AsNoTracking().SingleOrDefaultAsync(run => run.Id == id).ConfigureAwait(false) is not { } run
            || !content.Dungeons.TryGetValue(run.Dungeon, out RealmDungeon? tower) || !tower.File.Waystone)
        {
            return;
        }

        List<RunFloor> floors = Dungeons.FloorsOf(run);
        if (Dungeons.EncounterId(floors.Count - 1, Dungeons.BossIndex(floors[^1])) != duel.Spawn) return;
        if (!await db.Attuned.AnyAsync(row => row.PlayerId == duel.PlayerId && row.Tower == tower.Id).ConfigureAwait(false))
        {
            db.Attuned.Add(new AttunedRow { PlayerId = duel.PlayerId, Tower = tower.Id, At = Now });
            await db.SaveChangesAsync().ConfigureAwait(false);
        }
    }

    /// <summary>
    /// A gear item a win drops: a boss's own unique (its file's <c>unique</c>) while the character owns none of it, and once
    /// they have it a rare or mythic item of the catalogue, never a unique; any other mob's an item of its tier's rarity.
    /// </summary>
    public GearItem? Drop(Mob mob, IReadOnlySet<string> owned)
    {
        ArgumentNullException.ThrowIfNull(mob);
        ArgumentNullException.ThrowIfNull(owned);
        if (mob.File.Boss && mob.File.Unique is { } unique && !owned.Contains(unique) && content.Gear.TryGetValue(unique, out GearItem? own)) return own;
        string rarity = mob.File.Tier switch { <= 2 => "common", 3 => "uncommon", _ => "rare" };
        List<GearItem> items = [.. content.Gear.Values.Where(item => !item.Unique && (mob.File.Boss ? item.Rarity is "rare" or "mythic" : item.Rarity == rarity)).OrderBy(item => item.Id, StringComparer.Ordinal)];
        return items.Count == 0 ? null : items[dice.Below(items.Count)];
    }

    /// <summary>The game a player lost with hearts left and has still to answer (pay or fight again), if any.</summary>
    public async Task<DuelRow?> Pending(string player) =>
        await db.Duels.AsNoTracking().Where(duel => duel.PlayerId == player && duel.State == DuelRow.Defeated)
            .OrderByDescending(duel => duel.FinishedAt).FirstOrDefaultAsync().ConfigureAwait(false);

    /// <summary>A game lost with hearts left, as the player answers it: the mob's offer and the deck the game was played with.</summary>
    public static DefeatView Defeat(DuelRow duel, int hearts, int maxHearts)
    {
        ArgumentNullException.ThrowIfNull(duel);
        Duel spec = JsonSerializer.Deserialize<Duel>(duel.Spec, Json)!;
        List<CardCount> main = [.. spec.Seats[0].Deck.GroupBy(card => card, StringComparer.Ordinal)
            .Select(group => new CardCount(group.Key, group.Count())).OrderBy(card => card.Name, StringComparer.Ordinal)];
        return new DefeatView(
            duel.Token,
            duel.Mob,
            duel.Game,
            hearts,
            maxHearts,
            duel.MobLifeEnd ?? spec.Seats[1].StartingLife,
            duel.MobLife,
            duel.Price,
            main,
            SideboardOf(duel));
    }

    /// <summary>The sideboard a game was played with.</summary>
    private static List<CardCount> SideboardOf(DuelRow duel) => JsonSerializer.Deserialize<List<CardCount>>(duel.Sideboard, Json) ?? [];

    /// <summary>
    /// Pays a mob off after a lost game (<c>POST /api/encounter/pay</c>, design.md A3): the encounter is over, the mob dealt
    /// with until its spawn's next epoch, and nothing won. A dungeon's mob can't be bought off (409 <c>NoBuyout</c>); 409
    /// <c>CannotAfford</c> without the gold, <c>Finished</c> for a game not awaiting an answer.
    /// </summary>
    public async Task<PaidView> Pay(string player, EncounterPay request)
    {
        ArgumentNullException.ThrowIfNull(request);
        await characters.Require(player).ConfigureAwait(false);
        DuelRow duel = await Owned(player, request.Token).ConfigureAwait(false);
        if (duel.State != DuelRow.Defeated) throw Refusal.Conflict(Codes.Finished, "That duel is over.");
        string who = content.Mobs.TryGetValue(duel.Mob, out Mob? mob) ? mob.File.Name : duel.Mob;
        if (duel.Price is not { } price) throw Refusal.Conflict(Codes.NoBuyout, $"{who} can't be bought off: fight it again.");

        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            if (await db.Duels.Where(row => row.Token == duel.Token && row.State == DuelRow.Defeated)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.State, DuelRow.Paid)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.Finished, "That duel is over.");
            }

            if (await db.Players.Where(row => row.Id == player && row.Gold >= price)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, row => row.Gold - price)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.CannotAfford, $"{who} asks {price} gold.");
            }

            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return new PaidView(await db.Players.Where(row => row.Id == player).Select(row => row.Gold).SingleAsync().ConfigureAwait(false));
    }

    /// <summary>
    /// Fights on after a lost game (<c>POST /api/encounter/rematch</c>, design.md A3): the encounter's next game, dealt with
    /// the deck and sideboard the player swapped from the last game's - a legal deck, the same cards between them but for
    /// free basic lands - the player at their full starting life and playing first or not as they chose (the loser of the
    /// last game chooses, CR 103.1), and the mob at exactly the life it ended the last game with, the rest of its seat as it
    /// was. 422 <c>IllegalDeck</c> for a deck or sideboard that is no such swap; 409 <c>Finished</c> for a game not awaiting
    /// an answer.
    /// </summary>
    public async Task<EncounterView> Rematch(string player, EncounterRematch request)
    {
        ArgumentNullException.ThrowIfNull(request);
        await characters.Require(player).ConfigureAwait(false);
        DuelRow last = await Owned(player, request.Token).ConfigureAwait(false);
        if (last.State != DuelRow.Defeated) throw Refusal.Conflict(Codes.Finished, "That duel is over.");

        List<CardCount> main = DecksAndGear.Merge(request.Main);
        List<CardCount> sideboard = DecksAndGear.Merge(request.Sideboard);
        Duel before = JsonSerializer.Deserialize<Duel>(last.Spec, Json)!;
        List<string> problems = await decks.Problems(player, main, sideboard).ConfigureAwait(false);
        problems.AddRange(SwapProblems(Copies(main).Concat(Copies(sideboard)), before.Seats[0].Deck.Concat(Copies(SideboardOf(last)))));
        if (problems.Count > 0) throw Refusal.Unprocessable(Codes.IllegalDeck, "That deck can't be played in the next game.", problems);

        CharacterView character = await characters.View(player).ConfigureAwait(false);
        int carried = last.MobLifeEnd ?? before.Seats[1].StartingLife;
        Mob mob = content.Mobs[last.Mob];
        long seed = dice.Seed();
        (DuelSeat seat1, DuelSeat seat2) = devDuels.Apply(player, PlayerSeat(character, main, sideboard), before.Seats[1]);
        int game = last.Game + 1;
        Duel duel = Deal(seat1, seat2 with { StartingLife = carried }, mob, seed, game, request.PlayFirst ? Duel.PlayerSeat : Duel.MobSeat);

        string token = RealmDice.Token();
        await using (var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false))
        {
            if (await db.Duels.Where(row => row.Token == last.Token && row.State == DuelRow.Defeated)
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.State, DuelRow.Rematched)).ConfigureAwait(false) != 1)
            {
                throw Refusal.Conflict(Codes.Finished, "That duel is over.");
            }

            db.Duels.Add(new DuelRow
            {
                Token = token,
                PlayerId = player,
                Space = last.Space,
                Spawn = last.Spawn,
                Epoch = last.Epoch,
                Mob = last.Mob,
                Game = game,
                Seed = seed,
                StartedAt = Now,
                State = DuelRow.Open,
                Spec = JsonSerializer.Serialize(duel, Json),
                Sideboard = JsonSerializer.Serialize(sideboard, Json),
                MobLife = last.MobLife,
            });
            await db.SaveChangesAsync().ConfigureAwait(false);
            await transaction.CommitAsync().ConfigureAwait(false);
        }

        return new EncounterView(token, seed, duel);
    }

    /// <summary>
    /// What makes a deck and sideboard no swap of the last game's (design.md A2): every card but the free basic lands the
    /// same, copy for copy, between them.
    /// </summary>
    private List<string> SwapProblems(IEnumerable<string> now, IEnumerable<string> before)
    {
        Dictionary<string, int> had = Count(before);
        Dictionary<string, int> has = Count(now);
        List<string> problems = [];
        foreach (string card in had.Keys.Union(has.Keys).Order(StringComparer.Ordinal))
        {
            int then = had.GetValueOrDefault(card);
            int still = has.GetValueOrDefault(card);
            if (then != still)
            {
                problems.Add(then == 0
                    ? $"{card} was in neither the deck nor the sideboard: a game after the first swaps only the cards between them."
                    : $"{card}: {then} between the deck and the sideboard last game, {still} now.");
            }
        }

        return problems;

        Dictionary<string, int> Count(IEnumerable<string> cards) =>
            cards.Where(card => !characters.IsBasic(card)).GroupBy(card => card, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
    }

    /// <summary>Counts every duel of a player's left unfinished for 24 hours as lost.</summary>
    public async Task SettleAbandoned(string player)
    {
        long before = Now - (long)Abandoned.TotalMilliseconds;
        foreach (DuelRow duel in await db.Duels.Where(duel => duel.PlayerId == player && duel.State == DuelRow.Open && duel.StartedAt < before).ToListAsync().ConfigureAwait(false))
        {
            await Lose(duel, "Left unfinished for 24 hours.", null).ConfigureAwait(false);
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
    /// A lost game (design.md A3, A3b): it pays nothing and costs a heart. With hearts left the game awaits the player's
    /// answer, and a world mob asks its buyout, measured by the life it ended with (the life it began with, for a game never
    /// played out); the character stays where they stand. With the last heart the character dies (<see cref="Die"/>).
    /// </summary>
    /// <returns>How it ended; null if the game had ended already.</returns>
    private async Task<OutcomeView?> Lose(DuelRow duel, string detail, int? mobLifeEnd)
    {
        string player = duel.PlayerId;
        Duel spec = JsonSerializer.Deserialize<Duel>(duel.Spec, Json)!;
        int end = mobLifeEnd ?? spec.Seats[1].StartingLife;
        await using var transaction = await db.Database.BeginTransactionAsync().ConfigureAwait(false);
        if (await db.Duels.Where(row => row.Token == duel.Token && row.State == DuelRow.Open)
            .ExecuteUpdateAsync(set => set
                .SetProperty(row => row.State, DuelRow.Lost)
                .SetProperty(row => row.FinishedAt, Now)
                .SetProperty(row => row.Detail, detail)
                .SetProperty(row => row.MobLifeEnd, end)).ConfigureAwait(false) != 1)
        {
            return null;
        }

        duel.State = DuelRow.Lost;
        duel.Detail = detail;
        duel.MobLifeEnd = end;

        await db.Players.Where(row => row.Id == player && row.Hearts > 0).ExecuteUpdateAsync(set => set.SetProperty(row => row.Hearts, row => row.Hearts - 1)).ConfigureAwait(false);
        PlayerRow row = await db.Players.AsNoTracking().SingleAsync(stored => stored.Id == player).ConfigureAwait(false);
        OutcomeView outcome;
        if (row.Hearts > 0)
        {
            long? price = RealmContent.RunOf(duel.Space) is null && content.Mobs.TryGetValue(duel.Mob, out Mob? mob)
                ? Buyout(mob.File.Tier, end, duel.MobLife)
                : null;
            await db.Duels.Where(stored => stored.Token == duel.Token).ExecuteUpdateAsync(set => set
                .SetProperty(stored => stored.State, DuelRow.Defeated)
                .SetProperty(stored => stored.Price, price)).ConfigureAwait(false);
            duel.State = DuelRow.Defeated;
            duel.Price = price;
            outcome = new OutcomeView("lost", 0, null, [], detail, Hearts: row.Hearts, Defeat: Defeat(duel, row.Hearts, row.MaxHearts));
        }
        else
        {
            RunLoss? forfeit = await Die(player, duel).ConfigureAwait(false);
            int hearts = await db.Players.Where(stored => stored.Id == player).Select(stored => stored.Hearts).SingleAsync().ConfigureAwait(false);
            outcome = new OutcomeView("lost", 0, null, [], detail, Hearts: hearts, Died: true, Forfeit: forfeit);
        }

        await db.SaveChangesAsync().ConfigureAwait(false);
        await transaction.CommitAsync().ConfigureAwait(false);
        return outcome;
    }

    /// <summary>
    /// The last heart lost (design.md A3b): the character wakes at home - their inn - with their hearts full. A dungeon run
    /// they died in ends, and what it won is taken back: the gold of its wins (as much of it as they still have), the gear
    /// items that dropped (taken off if worn) and the cards it gave - a boss's gift, and a relic, whose ledger entry goes
    /// with it so that it may drop again - from the collection, and from the sideboard and then the deck where those held
    /// the copies that are gone. Outside a dungeon nothing else is lost.
    /// </summary>
    /// <returns>What the run had won and lost, or null outside a run.</returns>
    private async Task<RunLoss?> Die(string player, DuelRow duel)
    {
        RunLoss? forfeit = null;
        if (RealmContent.RunOf(duel.Space) is { } run)
        {
            await db.Runs.Where(row => row.Id == run && row.State == RunRow.Live).ExecuteUpdateAsync(set => set
                .SetProperty(row => row.State, RunRow.Ended)
                .SetProperty(row => row.EndedAt, Now)
                .SetProperty(row => row.Detail, "Its challenger fell in it.")).ConfigureAwait(false);
            forfeit = await TakeBack(player, duel.Space).ConfigureAwait(false);
        }

        await characters.ToInn(player).ConfigureAwait(false);
        await db.Players.Where(row => row.Id == player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Hearts, row => row.MaxHearts)).ConfigureAwait(false);
        return forfeit;
    }

    /// <summary>Takes back what a run's wins gave (<see cref="Die"/>).</summary>
    private async Task<RunLoss> TakeBack(string player, string space)
    {
        List<DuelRow> won = await db.Duels.AsNoTracking()
            .Where(row => row.PlayerId == player && row.Space == space && (row.State == DuelRow.Won || row.State == DuelRow.Looted))
            .ToListAsync().ConfigureAwait(false);
        long gold = won.Sum(row => row.Gold);
        if (gold > 0)
        {
            await db.Players.Where(row => row.Id == player).ExecuteUpdateAsync(set => set
                .SetProperty(row => row.Gold, row => row.Gold > gold ? row.Gold - gold : 0)).ConfigureAwait(false);
        }

        List<string> gear = [];
        foreach (long instance in won.Select(row => row.GearInstance).OfType<long>())
        {
            if (await db.GearOwned.SingleOrDefaultAsync(row => row.Id == instance && row.PlayerId == player).ConfigureAwait(false) is not { } owned) continue;
            await db.Loadout.Where(row => row.PlayerId == player && row.GearInstanceId == instance).ExecuteDeleteAsync().ConfigureAwait(false);
            db.GearOwned.Remove(owned);
            gear.Add(content.Gear.TryGetValue(owned.GearId, out GearItem? item) ? item.Name : owned.GearId);
        }

        List<string> tokens = [.. won.Select(row => row.Token)];
        List<RelicRow> relics = await db.Relics.Where(row => row.PlayerId == player && tokens.Contains(row.Duel)).ToListAsync().ConfigureAwait(false);
        db.Relics.RemoveRange(relics);
        List<string> cards = [.. won.Select(row => row.Gift).OfType<string>().Concat(relics.Select(row => row.Card))];
        foreach (string card in cards)
        {
            await characters.AddToCollection(player, card, -1).ConfigureAwait(false);
            await db.SaveChangesAsync().ConfigureAwait(false);
            await decks.FitToCollection(player, card).ConfigureAwait(false);
        }

        await db.SaveChangesAsync().ConfigureAwait(false);
        return new RunLoss(gold, cards, gear);
    }

    private async Task<DuelRow> Owned(string player, string? token) =>
        await db.Duels.SingleOrDefaultAsync(duel => duel.Token == token && duel.PlayerId == player).ConfigureAwait(false)
            ?? throw Refusal.NotFound(Codes.NoDuel, "You have no such duel.");
}
