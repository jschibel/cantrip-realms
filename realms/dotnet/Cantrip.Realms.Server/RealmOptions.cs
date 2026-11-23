using Cantrip.Realms.Server.Data;

namespace Cantrip.Realms.Server;

/// <summary>
/// The realm server's configuration (realms/docs/tech.md B8): every setting an environment variable, so any container
/// host runs it the same way.
/// <code>
/// REALMS_DATABASE                sqlite:&lt;file&gt; or postgres://... (else DATABASE_URL; RealmDatabase); sqlite:realms.db by default
/// REALMS_ROOT                    the repository the content is read from (realms/content, decks/, content/); found above
///                                the server by default
/// REALMS_SITE                    the server's public address, which Discord sends a player back to after signing in
/// REALMS_DISCORD_CLIENT_ID       the game's own Discord application, for signing in
/// REALMS_DISCORD_CLIENT_SECRET
/// REALMS_KEYS                    where the keys sealing the sign-in cookie are kept; in memory when unset
/// REALMS_CLIENT                  the world client's address (the CDN): where signing in lands, and the one origin the API
///                                answers from a browser
/// REALMS_DEV_SIGNIN              1 lets anyone sign in as any id, with no Discord: development and tests only
/// REALMS_MIGRATE                 0 leaves the database's schema alone at start; by default the migrations are applied
/// REALMS_START_MAP               the map new characters start on, at its inn; new-argive by default
/// REALMS_WALKING_SPEED           the fastest walk presence relays, in hexes a second; 4 by default
/// REALMS_INSTANCE_SIZE           the most players in one instance of a map; 40 by default (design.md A6)
/// CANTRIP_NATIVE_HOST            the native engine host that checks duels (cantrip-rs's own setting)
/// </code>
/// ASP.NET Core's own (<c>ASPNETCORE_URLS</c>, <c>ASPNETCORE_ENVIRONMENT</c>) work as they always do.
/// </summary>
public sealed class RealmOptions
{
    public required RealmDatabase Database { get; init; }

    public required string Root { get; init; }

    public Uri? Site { get; init; }

    public string? DiscordClientId { get; init; }

    public string? DiscordClientSecret { get; init; }

    public string? Keys { get; init; }

    public Uri? Client { get; init; }

    public bool DevSignIn { get; init; }

    public bool Migrate { get; init; } = true;

    /// <summary>The map a new character starts on, at its inn.</summary>
    public string StartMap { get; init; } = "new-argive";

    /// <summary>The fastest a character walks, in hexes a second: presence refuses a faster walk.</summary>
    public double WalkingSpeed { get; init; } = 4.0;

    /// <summary>The most players one instance of a map holds (design.md A6).</summary>
    public int InstanceSize { get; init; } = 40;

    /// <summary>Reads the options from configuration, whose environment variables are <c>REALMS_*</c>.</summary>
    public static RealmOptions From(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        string? Setting(string name) => configuration[$"REALMS_{name}"] is { Length: > 0 } value ? value : null;

        return new RealmOptions
        {
            Database = RealmDatabase.Parse(Setting("DATABASE") ?? (configuration["DATABASE_URL"] is { Length: > 0 } url ? url : "sqlite:realms.db")),
            Root = Setting("ROOT") ?? FindRoot() ?? throw new InvalidOperationException("No REALMS_ROOT, and no repository above the server to read the content from."),
            Site = Setting("SITE") is { } site ? new Uri(site) : null,
            DiscordClientId = Setting("DISCORD_CLIENT_ID"),
            DiscordClientSecret = Setting("DISCORD_CLIENT_SECRET"),
            Keys = Setting("KEYS"),
            Client = Setting("CLIENT") is { } client ? new Uri(client) : null,
            DevSignIn = Setting("DEV_SIGNIN") is "1" or "true",
            Migrate = Setting("MIGRATE") is not ("0" or "false"),
            WalkingSpeed = Setting("WALKING_SPEED") is { } speed ? double.Parse(speed, System.Globalization.CultureInfo.InvariantCulture) : 4.0,
            InstanceSize = Setting("INSTANCE_SIZE") is { } size ? int.Parse(size, System.Globalization.CultureInfo.InvariantCulture) : 40,
            StartMap = Setting("START_MAP") ?? "new-argive",
        };
    }

    /// <summary>The repository above this process: the folder holding <c>realms/content</c>.</summary>
    public static string? FindRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "realms", "content")) && Directory.Exists(Path.Combine(directory.FullName, "content")))
            {
                return directory.FullName;
            }
        }

        return null;
    }
}
