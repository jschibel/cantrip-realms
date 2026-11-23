using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server.Data;

// The realm's store (realms/docs/tech.md B4): one EF Core model, on PostgreSQL in production and SQLite in development and
// tests. Times are Unix milliseconds, which both keep and compare alike; gold is a 64-bit count.

/// <summary>A character (<c>players</c>): the player's one character, by their id (<c>discord-{id}</c>).</summary>
public sealed class PlayerRow
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /// <summary>Which of the voxel bodies, 0 to 3.</summary>
    public int Body { get; set; }

    /// <summary>Which skin and hair palette, 0 to 5.</summary>
    public int Palette { get; set; }

    /// <summary>The color the character started in, a letter.</summary>
    public string Color { get; set; } = string.Empty;

    public long Gold { get; set; }

    /// <summary>
    /// The space the character last reported standing in (interfaces.md, "Places"): <c>world</c>, an interior's id, or
    /// <c>run:&lt;id&gt;</c> - and the tile of it, <see cref="X"/> east and <see cref="Z"/> south.
    /// </summary>
    public string Space { get; set; } = string.Empty;

    public int X { get; set; }

    public int Z { get; set; }

    /// <summary>When the character was last put somewhere: the walk to the next report starts then.</summary>
    public long PlacedAt { get; set; }

    /// <summary>The inn the character has set as home (world.json's id), where a lost duel wakes them.</summary>
    public string Inn { get; set; } = string.Empty;

    public long CreatedAt { get; set; }
}

/// <summary>Copies of a card a character owns (<c>collection</c>); never a basic land.</summary>
public sealed class CollectionRow
{
    public string PlayerId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int Count { get; set; }
}

/// <summary>A gear item a character owns (<c>gear_owned</c>): an instance of an item of the catalogue.</summary>
public sealed class GearOwnedRow
{
    public long Id { get; set; }

    public string PlayerId { get; set; } = string.Empty;

    public string GearId { get; set; } = string.Empty;

    public long AcquiredAt { get; set; }
}

/// <summary>What a character wears in one slot (<c>loadout</c>).</summary>
public sealed class LoadoutRow
{
    public string PlayerId { get; set; } = string.Empty;

    /// <summary>One of the eight loadout slots (head, neck, body, hands, feet, ring1, ring2, relic).</summary>
    public string Slot { get; set; } = string.Empty;

    public long GearInstanceId { get; set; }
}

/// <summary>Copies of a card in a character's deck (<c>deck</c>), basic lands among them.</summary>
public sealed class DeckRow
{
    public string PlayerId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int Count { get; set; }
}

/// <summary>Copies of a card in a character's ante (<c>ante</c>).</summary>
public sealed class AnteRow
{
    public string PlayerId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int Count { get; set; }
}

/// <summary>A color a character has unlocked by beating its boss (<c>unlocks</c>).</summary>
public sealed class UnlockRow
{
    public string PlayerId { get; set; } = string.Empty;

    public string Color { get; set; } = string.Empty;

    public long At { get; set; }
}

/// <summary>
/// A relic an account has received (<c>relics</c>, design.md A3a): the ledger a relic never drops twice from, kept whatever
/// becomes of the card. One row per account and relic, ever.
/// </summary>
public sealed class RelicRow
{
    public string PlayerId { get; set; } = string.Empty;

    public string Card { get; set; } = string.Empty;

    public long At { get; set; }

    /// <summary>The duel whose win dropped it.</summary>
    public string Duel { get; set; } = string.Empty;
}

/// <summary>A card vendor's own state (<c>vendors</c>): its purse, and the last hour it was brought up to.</summary>
public sealed class VendorRow
{
    public string Id { get; set; } = string.Empty;

    public long Purse { get; set; }

    /// <summary>The Unix hour of the last trickle and rotation applied.</summary>
    public long Hour { get; set; }

    /// <summary>A traveling trader's: the Unix day of the last visit its caravan brought cards to (a day long past, -1 or 0, before any).</summary>
    public long Visit { get; set; } = -1;

    public long CreatedAt { get; set; }
}

/// <summary>Copies of a card a vendor has for sale (<c>vendor_stock</c>).</summary>
public sealed class VendorStockRow
{
    public long Id { get; set; }

    public string VendorId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int Count { get; set; }

    /// <summary>Where it came from: <see cref="Seeded"/>, <see cref="Rotated"/> or <see cref="Sold"/>.</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>When it leaves unsold; null for a card a player sold, which stays until bought.</summary>
    public long? Until { get; set; }

    public long AddedAt { get; set; }

    public const string Seeded = "seeded";
    public const string Rotated = "rotated";
    public const string Sold = "sold";
}

/// <summary>A player's visit to a vendor in one hour (<c>vendor_visits</c>), which the next hour's trickle counts.</summary>
public sealed class VendorVisitRow
{
    public string VendorId { get; set; } = string.Empty;

    public string PlayerId { get; set; } = string.Empty;

    /// <summary>The Unix hour of the visit.</summary>
    public long Hour { get; set; }
}

/// <summary>A duel (<c>duels</c>): what was committed as it started, and how it ended.</summary>
public sealed class DuelRow
{
    /// <summary>The duel's token, which the client finishes it with.</summary>
    public string Token { get; set; } = string.Empty;

    public string PlayerId { get; set; } = string.Empty;

    /// <summary>Where it was fought: <c>world</c>, or a dungeon run's <c>run:&lt;id&gt;</c>.</summary>
    public string Space { get; set; } = string.Empty;

    /// <summary>The world spawn's id, or in a run <c>&lt;floor&gt;:&lt;index&gt;</c>, the encounter's.</summary>
    public string Spawn { get; set; } = string.Empty;

    /// <summary>The spawn epoch whose mob this is: one duel per spawn per epoch (0 in a run: one duel per encounter).</summary>
    public long Epoch { get; set; }

    public string Mob { get; set; } = string.Empty;

    public long Seed { get; set; }

    public long StartedAt { get; set; }

    /// <summary><see cref="Open"/>, <see cref="Won"/> (loot not yet taken), <see cref="Looted"/> or <see cref="Lost"/>.</summary>
    public string State { get; set; } = Open;

    /// <summary>The <see cref="Duel"/> as dealt, as JSON.</summary>
    public string Spec { get; set; } = string.Empty;

    /// <summary>The ante as the duel began, as JSON: what a loss takes a card from.</summary>
    public string Ante { get; set; } = string.Empty;

    public long AnteValue { get; set; }

    public long Cap { get; set; }

    public long? FinishedAt { get; set; }

    /// <summary>The gold a win paid.</summary>
    public long Gold { get; set; }

    /// <summary>The cards a win offered, as JSON.</summary>
    public string? Offer { get; set; }

    /// <summary>Why it ended as it did, in words: what the verifier found, or that it was left too long.</summary>
    public string? Detail { get; set; }

    public const string Open = "open";
    public const string Won = "won";
    public const string Looted = "looted";
    public const string Lost = "lost";
}

/// <summary>When a character last opened a chest (<c>chests</c>); chests refill for each player on their own timer.</summary>
public sealed class ChestRow
{
    public string PlayerId { get; set; } = string.Empty;

    /// <summary>The space the chest is in: <c>world</c> or an interior's id.</summary>
    public string Space { get; set; } = string.Empty;

    public string Chest { get; set; } = string.Empty;

    public long OpenedAt { get; set; }
}

/// <summary>
/// A dungeon run (<c>runs</c>, design.md A6): a single-player instance of a dungeon, its seed for the browser's layout, and
/// every encounter of every floor, fixed as it begins. A character has one live run at most; leaving it or losing a duel
/// in it ends it.
/// </summary>
public sealed class RunRow
{
    /// <summary>The run's id: its space is <c>run:&lt;id&gt;</c>.</summary>
    public string Id { get; set; } = string.Empty;

    public string PlayerId { get; set; } = string.Empty;

    public string Dungeon { get; set; } = string.Empty;

    /// <summary>The seed the browser lays the run out from: below 2^53.</summary>
    public long Seed { get; set; }

    /// <summary>Every floor's encounters, warden and boss, as JSON (the run's <c>Floors</c>).</summary>
    public string Floors { get; set; } = string.Empty;

    /// <summary>The floor the character stands on, the first 0.</summary>
    public int Floor { get; set; }

    /// <summary><see cref="Live"/> or <see cref="Ended"/>.</summary>
    public string State { get; set; } = Live;

    public long StartedAt { get; set; }

    public long? EndedAt { get; set; }

    /// <summary>How it ended, in words.</summary>
    public string? Detail { get; set; }

    public const string Live = "live";
    public const string Ended = "ended";
}

/// <summary>A mage tower whose waystone a character has attuned by beating its mage (<c>attuned</c>, design.md A6).</summary>
public sealed class AttunedRow
{
    public string PlayerId { get; set; } = string.Empty;

    /// <summary>The tower: a dungeon with a waystone.</summary>
    public string Tower { get; set; } = string.Empty;

    public long At { get; set; }
}

/// <summary>A character's progress on a quest of the quest board (<c>quests</c>); the board itself comes later.</summary>
public sealed class QuestRow
{
    public string PlayerId { get; set; } = string.Empty;

    public string Quest { get; set; } = string.Empty;

    public int Progress { get; set; }

    public long? CompletedAt { get; set; }
}

/// <summary>
/// The realm's store. One model; <see cref="SqliteRealmDb"/> and <see cref="PostgresRealmDb"/> are it on each database,
/// each with its own migrations (<c>Data/Migrations/&lt;provider&gt;</c>), as EF Core keeps migrations per provider.
/// </summary>
public abstract class RealmDb(DbContextOptions options) : DbContext(options)
{
    public DbSet<PlayerRow> Players => Set<PlayerRow>();

    public DbSet<CollectionRow> Collection => Set<CollectionRow>();

    public DbSet<GearOwnedRow> GearOwned => Set<GearOwnedRow>();

    public DbSet<LoadoutRow> Loadout => Set<LoadoutRow>();

    public DbSet<DeckRow> Deck => Set<DeckRow>();

    public DbSet<AnteRow> Ante => Set<AnteRow>();

    public DbSet<UnlockRow> Unlocks => Set<UnlockRow>();

    public DbSet<RelicRow> Relics => Set<RelicRow>();

    public DbSet<VendorRow> Vendors => Set<VendorRow>();

    public DbSet<VendorStockRow> VendorStock => Set<VendorStockRow>();

    public DbSet<VendorVisitRow> VendorVisits => Set<VendorVisitRow>();

    public DbSet<DuelRow> Duels => Set<DuelRow>();

    public DbSet<ChestRow> Chests => Set<ChestRow>();

    public DbSet<QuestRow> Quests => Set<QuestRow>();

    public DbSet<RunRow> Runs => Set<RunRow>();

    public DbSet<AttunedRow> Attuned => Set<AttunedRow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);

        modelBuilder.Entity<PlayerRow>(player =>
        {
            player.ToTable("players");
            player.HasKey(row => row.Id);
            player.Property(row => row.Id).HasMaxLength(64);
            player.Property(row => row.Name).HasMaxLength(32);
            player.Property(row => row.Color).HasMaxLength(1);
            player.Property(row => row.Space).HasMaxLength(80);
            player.Property(row => row.Inn).HasMaxLength(64);
        });

        modelBuilder.Entity<CollectionRow>(row =>
        {
            row.ToTable("collection");
            row.HasKey(card => new { card.PlayerId, card.Name });
            row.Property(card => card.Name).HasMaxLength(160);
        });

        modelBuilder.Entity<GearOwnedRow>(row =>
        {
            row.ToTable("gear_owned");
            row.HasKey(gear => gear.Id);
            row.Property(gear => gear.Id).ValueGeneratedOnAdd();
            row.Property(gear => gear.GearId).HasMaxLength(64);
            row.HasIndex(gear => gear.PlayerId);
        });

        modelBuilder.Entity<LoadoutRow>(row =>
        {
            row.ToTable("loadout");
            row.HasKey(slot => new { slot.PlayerId, slot.Slot });
            row.Property(slot => slot.Slot).HasMaxLength(16);
            row.HasIndex(slot => slot.GearInstanceId).IsUnique();
        });

        modelBuilder.Entity<DeckRow>(row =>
        {
            row.ToTable("deck");
            row.HasKey(card => new { card.PlayerId, card.Name });
            row.Property(card => card.Name).HasMaxLength(160);
        });

        modelBuilder.Entity<AnteRow>(row =>
        {
            row.ToTable("ante");
            row.HasKey(card => new { card.PlayerId, card.Name });
            row.Property(card => card.Name).HasMaxLength(160);
        });

        modelBuilder.Entity<UnlockRow>(row =>
        {
            row.ToTable("unlocks");
            row.HasKey(unlock => new { unlock.PlayerId, unlock.Color });
            row.Property(unlock => unlock.Color).HasMaxLength(1);
        });

        modelBuilder.Entity<RelicRow>(row =>
        {
            row.ToTable("relics");
            row.HasKey(relic => new { relic.PlayerId, relic.Card });
            row.Property(relic => relic.PlayerId).HasMaxLength(64);
            row.Property(relic => relic.Card).HasMaxLength(160);
            row.Property(relic => relic.Duel).HasMaxLength(64);
        });

        modelBuilder.Entity<VendorRow>(row =>
        {
            row.ToTable("vendors");
            row.HasKey(vendor => vendor.Id);
            row.Property(vendor => vendor.Id).HasMaxLength(64);
        });

        modelBuilder.Entity<VendorStockRow>(row =>
        {
            row.ToTable("vendor_stock");
            row.HasKey(stock => stock.Id);
            row.Property(stock => stock.Id).ValueGeneratedOnAdd();
            row.Property(stock => stock.Name).HasMaxLength(160);
            row.Property(stock => stock.Source).HasMaxLength(16);
            row.HasIndex(stock => new { stock.VendorId, stock.Name });
        });

        modelBuilder.Entity<VendorVisitRow>(row =>
        {
            row.ToTable("vendor_visits");
            row.HasKey(visit => new { visit.VendorId, visit.PlayerId, visit.Hour });
        });

        modelBuilder.Entity<DuelRow>(row =>
        {
            row.ToTable("duels");
            row.HasKey(duel => duel.Token);
            row.Property(duel => duel.Token).HasMaxLength(64);
            row.Property(duel => duel.State).HasMaxLength(16);
            row.Property(duel => duel.Space).HasMaxLength(80);
            row.HasIndex(duel => new { duel.PlayerId, duel.Space, duel.Spawn, duel.Epoch }).IsUnique();
            row.HasIndex(duel => new { duel.PlayerId, duel.State });
        });

        modelBuilder.Entity<ChestRow>(row =>
        {
            row.ToTable("chests");
            row.HasKey(chest => new { chest.PlayerId, chest.Space, chest.Chest });
        });

        modelBuilder.Entity<RunRow>(row =>
        {
            row.ToTable("runs");
            row.HasKey(run => run.Id);
            row.Property(run => run.Id).HasMaxLength(64);
            row.Property(run => run.PlayerId).HasMaxLength(64);
            row.Property(run => run.Dungeon).HasMaxLength(64);
            row.Property(run => run.State).HasMaxLength(16);
            row.HasIndex(run => new { run.PlayerId, run.State });
        });

        modelBuilder.Entity<AttunedRow>(row =>
        {
            row.ToTable("attuned");
            row.HasKey(attuned => new { attuned.PlayerId, attuned.Tower });
            row.Property(attuned => attuned.PlayerId).HasMaxLength(64);
            row.Property(attuned => attuned.Tower).HasMaxLength(64);
        });

        modelBuilder.Entity<QuestRow>(row =>
        {
            row.ToTable("quests");
            row.HasKey(quest => new { quest.PlayerId, quest.Quest });
        });
    }
}

/// <summary>The realm's store on SQLite: development and tests.</summary>
public sealed class SqliteRealmDb(DbContextOptions<SqliteRealmDb> options) : RealmDb(options);

/// <summary>The realm's store on PostgreSQL: production.</summary>
public sealed class PostgresRealmDb(DbContextOptions<PostgresRealmDb> options) : RealmDb(options);
