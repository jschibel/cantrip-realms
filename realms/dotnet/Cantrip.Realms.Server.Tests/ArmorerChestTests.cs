using System.Net;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Economy;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Cantrip.Realms.Server.Tests;

/// <summary>Armorers (design.md A4) and treasure chests (A5).</summary>
public sealed class ArmorerChestTests
{
    [Fact]
    public async Task An_armorer_sells_six_to_ten_items_the_same_all_day()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        ArmorerView morning = await browser.Ok<ArmorerView>(HttpMethod.Get, "/api/armorer/new-benalia");
        Assert.InRange(morning.Stock.Count, Math.Min(Armorers.Fewest, RealmApp.Content.Gear.Count), Armorers.Most);
        Assert.Equal(morning.Stock.Count, morning.Stock.Select(item => item.Id).Distinct().Count());

        app.Time.Advance(TimeSpan.FromHours(10));
        ArmorerView evening = await browser.Ok<ArmorerView>(HttpMethod.Get, "/api/armorer/new-benalia");
        Assert.Equal(morning.Stock.Select(item => item.Id), evening.Stock.Select(item => item.Id));

        await browser.Refused(HttpMethod.Get, "/api/armorer/keld", null, HttpStatusCode.NotFound, Codes.NoArmorer);
        await browser.Refused(HttpMethod.Get, "/api/armorer/nowhere", null, HttpStatusCode.NotFound, Codes.NoArmorer);
    }

    [Fact]
    public async Task Gear_is_bought_at_its_gold_and_sold_back_at_half_but_not_while_worn()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        await browser.Inside("new-benalia-smithy");
        ArmorerView shop = await browser.Ok<ArmorerView>(HttpMethod.Get, "/api/armorer/new-benalia");
        GearItem item = shop.Stock.Where(item => item.Gold <= Characters.StartingGold).OrderBy(item => item.Gold).First();

        GearTradeView bought = await browser.Ok<GearTradeView>(HttpMethod.Post, "/api/armorer/new-benalia/buy", new { GearId = item.Id });
        Assert.Equal(Characters.StartingGold - item.Gold, bought.Gold);
        GearInstance mine = bought.Gear.Last();
        Assert.Equal(item.Id, mine.Gear.Id);

        GearTradeView sold = await browser.Ok<GearTradeView>(HttpMethod.Post, "/api/armorer/new-benalia/sell", new { InstanceId = mine.InstanceId });
        Assert.Equal(Characters.StartingGold - item.Gold + (item.Gold / 2), sold.Gold);
        Assert.DoesNotContain(sold.Gear, owned => owned.InstanceId == mine.InstanceId);

        CharacterView me = await browser.Me();
        GearInstance worn = me.Loadout.Values.OfType<GearInstance>().First();
        await browser.Refused(HttpMethod.Post, "/api/armorer/new-benalia/sell", new { worn.InstanceId }, HttpStatusCode.Conflict, Codes.Worn);
        await browser.Refused(HttpMethod.Post, "/api/armorer/new-benalia/buy", new { GearId = "no-such-thing" }, HttpStatusCode.Conflict, Codes.NotInStock);

        await app.Store(db => db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, 0)));
        await browser.Refused(HttpMethod.Post, "/api/armorer/new-benalia/buy", new { GearId = item.Id }, HttpStatusCode.Conflict, Codes.CannotAfford);

        // Out of the smithy, in the street or the inn, the armorer does not trade.
        await app.Store(db => db.Players.Where(row => row.Id == browser.Player).ExecuteUpdateAsync(set => set.SetProperty(row => row.Gold, 5000)));
        await browser.Put(RealmContent.WorldSpace, RealmApp.Inn("new-benalia").At);
        await browser.Refused(HttpMethod.Post, "/api/armorer/new-benalia/buy", new { GearId = item.Id }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Inside("new-benalia-inn");
        await browser.Refused(HttpMethod.Post, "/api/armorer/new-benalia/buy", new { GearId = item.Id }, HttpStatusCode.Conflict, Codes.NotNear);
        await browser.Inside("capashen-hold-smithy");
        await browser.Refused(HttpMethod.Post, "/api/armorer/new-benalia/buy", new { GearId = item.Id }, HttpStatusCode.Conflict, Codes.NotNear);
    }

    [Fact]
    public async Task A_chest_holds_gold_in_its_range_and_refills_on_its_timer()
    {
        await using var app = new RealmApp();
        Browser browser = await app.Character(1);
        const string World = RealmContent.WorldSpace;
        MapChest chest = RealmApp.Content.World.Chest("0_0:1")!;

        await browser.Put(World, RealmApp.Away(chest.At, 2));
        await browser.Refused(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id }, HttpStatusCode.Conflict, Codes.NotNear);

        await browser.Put(World, RealmApp.Beside(World, chest.At));
        ChestView found = await browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id });
        Assert.InRange(found.Found, chest.Gold[0], chest.Gold[1]);
        Assert.Equal(Characters.StartingGold + found.Found, found.Gold);

        await browser.Refused(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id }, HttpStatusCode.Conflict, Codes.Empty);
        app.Time.Advance(TimeSpan.FromSeconds(chest.RespawnSeconds - 1));
        await browser.Refused(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id }, HttpStatusCode.Conflict, Codes.Empty);
        app.Time.Advance(TimeSpan.FromSeconds(1));
        ChestView again = await browser.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id });
        Assert.Equal(found.Gold + again.Found, again.Gold);

        // Another player's chest is full.
        Browser other = await app.Character(2);
        await other.Put(World, RealmApp.Beside(World, chest.At));
        await other.Ok<ChestView>(HttpMethod.Post, "/api/chest/open", new { Space = World, Chest = chest.Id });

        // A chest is named by its space: none of that name inside a building.
        await other.Refused(HttpMethod.Post, "/api/chest/open", new { Space = "new-benalia-inn", Chest = chest.Id }, HttpStatusCode.NotFound, Codes.NoSuchPlace);
    }
}

/// <summary>The store's configuration and its migrations.</summary>
public sealed class DatabaseTests
{
    [Theory]
    [InlineData("sqlite:realms.db", RealmDatabase.Provider.Sqlite, "Data Source=realms.db")]
    [InlineData("sqlite:Data Source=x.db;Cache=Shared", RealmDatabase.Provider.Sqlite, "Data Source=x.db;Cache=Shared")]
    [InlineData("postgres:Host=db;Database=realms", RealmDatabase.Provider.Postgres, "Host=db;Database=realms")]
    public void The_database_setting_names_the_provider(string setting, RealmDatabase.Provider kind, string connection)
    {
        RealmDatabase database = RealmDatabase.Parse(setting);
        Assert.Equal(kind, database.Kind);
        Assert.Equal(connection, database.ConnectionString);
    }

    [Fact]
    public void A_postgres_url_becomes_a_connection_string()
    {
        RealmDatabase database = RealmDatabase.Parse("postgres://realm:p%40ss@db.example:6543/realms?sslmode=require");
        Assert.Equal(RealmDatabase.Provider.Postgres, database.Kind);
        var built = new Npgsql.NpgsqlConnectionStringBuilder(database.ConnectionString);
        Assert.Equal(("db.example", 6543, "realms", "realm", "p@ss"), (built.Host, built.Port, built.Database, built.Username, built.Password));
        Assert.Equal(Npgsql.SslMode.Require, built.SslMode);
        Assert.Throws<FormatException>(() => RealmDatabase.Parse("mysql://x"));
    }

    [Fact]
    public void Each_providers_migrations_are_the_model()
    {
        using SqliteRealmDb sqlite = new SqliteRealmDbDesign().CreateDbContext([]);
        Assert.False(sqlite.Database.HasPendingModelChanges());
        using PostgresRealmDb postgres = new PostgresRealmDbDesign().CreateDbContext([]);
        Assert.False(postgres.Database.HasPendingModelChanges());
        Assert.NotEmpty(postgres.Database.GetMigrations());
    }

    [Fact]
    public async Task The_tables_are_tech_B4s()
    {
        await using var app = new RealmApp();
        await app.SignIn(1);
        List<string> tables = await app.Store(db => db.Database.SqlQueryRaw<string>("SELECT name AS \"Value\" FROM sqlite_master WHERE type = 'table'").ToListAsync());
        foreach (string table in new[] { "players", "collection", "gear_owned", "loadout", "deck", "ante", "unlocks", "vendors", "vendor_stock", "vendor_visits", "duels", "chests", "quests", "runs", "attuned" })
        {
            Assert.Contains(table, tables);
        }
    }
}
