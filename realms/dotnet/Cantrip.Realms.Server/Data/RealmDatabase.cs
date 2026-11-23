using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Npgsql;

namespace Cantrip.Realms.Server.Data;

/// <summary>
/// Which database the realm keeps its store in, from one setting (<c>REALMS_DATABASE</c>, else <c>DATABASE_URL</c>, as
/// hosts name it):
/// <code>
/// sqlite:realms.db                                  a SQLite file (a path, or a whole connection string)
/// postgres://user:password@host:5432/realms         PostgreSQL, as a URL (postgresql:// too)
/// postgres:Host=host;Database=realms;...            PostgreSQL, as an Npgsql connection string
/// </code>
/// </summary>
public sealed record RealmDatabase(RealmDatabase.Provider Kind, string ConnectionString)
{
    public enum Provider
    {
        Sqlite,
        Postgres,
    }

    /// <summary>Reads the setting.</summary>
    /// <exception cref="FormatException">A setting that names neither database.</exception>
    public static RealmDatabase Parse(string setting)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(setting);
        if (setting.StartsWith("sqlite:", StringComparison.OrdinalIgnoreCase))
        {
            string rest = setting["sqlite:".Length..];
            string connection = rest.Contains('=', StringComparison.Ordinal) ? rest : new SqliteConnectionStringBuilder { DataSource = rest }.ConnectionString;
            return new RealmDatabase(Provider.Sqlite, connection);
        }

        if (setting.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) || setting.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            var url = new Uri(setting);
            string[] user = Uri.UnescapeDataString(url.UserInfo).Split(':', 2);
            var builder = new NpgsqlConnectionStringBuilder
            {
                Host = url.Host,
                Port = url.IsDefaultPort || url.Port <= 0 ? 5432 : url.Port,
                Database = url.AbsolutePath.Trim('/'),
                Username = user[0],
                Password = user.Length > 1 ? user[1] : null,
            };
            foreach (string pair in url.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                string[] parts = pair.Split('=', 2);
                builder[Uri.UnescapeDataString(parts[0])] = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : string.Empty;
            }

            return new RealmDatabase(Provider.Postgres, builder.ConnectionString);
        }

        if (setting.StartsWith("postgres:", StringComparison.OrdinalIgnoreCase))
        {
            return new RealmDatabase(Provider.Postgres, setting["postgres:".Length..]);
        }

        throw new FormatException("The database is sqlite:<file>, postgres://user:password@host/database or postgres:<connection string>.");
    }

    /// <summary>Registers the store: the provider's context, and <see cref="RealmDb"/> as it.</summary>
    public void Register(IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        switch (Kind)
        {
            case Provider.Sqlite:
                services.AddDbContext<SqliteRealmDb>(options => options.UseSqlite(ConnectionString));
                services.AddScoped<RealmDb>(provider => provider.GetRequiredService<SqliteRealmDb>());
                break;
            case Provider.Postgres:
                services.AddDbContext<PostgresRealmDb>(options => options.UseNpgsql(ConnectionString));
                services.AddScoped<RealmDb>(provider => provider.GetRequiredService<PostgresRealmDb>());
                break;
        }
    }
}

/// <summary>What <c>dotnet ef migrations add ... --context SqliteRealmDb</c> builds the SQLite model from.</summary>
public sealed class SqliteRealmDbDesign : IDesignTimeDbContextFactory<SqliteRealmDb>
{
    public SqliteRealmDb CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<SqliteRealmDb>().UseSqlite("Data Source=design.db").Options);
}

/// <summary>What <c>dotnet ef migrations add ... --context PostgresRealmDb</c> builds the PostgreSQL model from; it connects to nothing.</summary>
public sealed class PostgresRealmDbDesign : IDesignTimeDbContextFactory<PostgresRealmDb>
{
    public PostgresRealmDb CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<PostgresRealmDb>().UseNpgsql("Host=localhost;Database=realms").Options);
}
