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
/// REALMS_CLIENT                  the world client's address (the CDN): where signing in lands, and an origin the API
///                                answers from a browser
/// REALMS_CARDS                   the card layer's address (the web client's ?realm page, framed over the world): the other
///                                origin the API answers from a browser, with the signed-in cookie
/// REALMS_DEV_SIGNIN              1 lets anyone sign in as any id, with no Discord: development and tests only
/// REALMS_MIGRATE                 0 leaves the database's schema alone at start; by default the migrations are applied
/// REALMS_START_TOWN              the town new characters start in, at its inn; new-benalia by default
/// REALMS_PLACES                  where each plane's world, interiors and dungeons are read from instead of
///                                realms/content (a folder of &lt;plane&gt;/world, ...): a test world
/// REALMS_WALKING_SPEED           the fastest walk presence relays, in tiles a second; 5 by default
/// REALMS_INSTANCE_SIZE           the most players in one layer of an area of the world, or one instance of an interior;
///                                40 by default (design.md A6)
/// REALMS_ART                     a content folder whose datasets hold card illustrations (&lt;dataset&gt;/images, as
///                                fetch-card-art leaves them): served at /art/{size}/{slug}.webp, for local play; a
///                                deployed realm's art is on the CDN instead (tech.md B8)
/// REALMS_ART_CACHE               where the art's sizes are kept once made; a folder in the temporary directory by default
/// REALMS_CHESTS_PER_ZONE         the most treasure chests a tier zone of the wilds holds at once (Economy/Finds); 2
/// REALMS_CHEST_EVERY             about how often, seconds, a zone below that gets a new one; 600
/// REALMS_CHEST_LASTS             how long, seconds, a chest nobody opens stands before it crumbles; 1800
/// REALMS_HEARTBLOOMS             the most heartblooms the world's wilds grow at once; 8
/// REALMS_HEARTBLOOM_EVERY        about how often, seconds, a new one grows while there are fewer; 1800
/// REALMS_HEARTBLOOM_LASTS        how long, seconds, a heartbloom nobody picks stands before it wilts; 10800
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

    /// <summary>The card layer's address, when it is served from another origin than the world client's (interfaces.md).</summary>
    public Uri? Cards { get; init; }

    /// <summary>The browser origins the API answers, with credentials: the world client's and the card layer's.</summary>
    public IReadOnlyList<string> Origins => [.. new[] { Client, Cards }.OfType<Uri>().Select(uri => uri.GetLeftPart(UriPartial.Authority)).Distinct(StringComparer.OrdinalIgnoreCase)];

    public bool DevSignIn { get; init; }

    public bool Migrate { get; init; } = true;

    /// <summary>The town a new character starts in, at its inn.</summary>
    public string StartTown { get; init; } = "new-benalia";

    /// <summary>Where the planes' world, interiors and dungeons are read from instead of realms/content; null for there.</summary>
    public string? Places { get; init; }

    /// <summary>
    /// The fastest a character walks, in tiles a second along the walk (a diagonal step the square root of 2): presence refuses a
    /// faster walk, and a reported place farther than this allows.
    /// </summary>
    public double WalkingSpeed { get; init; } = DefaultWalkingSpeed;

    /// <summary>The walking speed unless set: above the overworld's (the slice walks the player at 4.2 tiles a second).</summary>
    public const double DefaultWalkingSpeed = 5.0;

    /// <summary>The most players one layer of an area of the world, or one instance of an interior, holds (design.md A6).</summary>
    public int InstanceSize { get; init; } = 40;

    /// <summary>How the finds of the wilds spawn (Economy/Finds): REALMS_CHESTS_PER_ZONE and the rest.</summary>
    public FindOptions Finds { get; init; } = new();

    /// <summary>A content folder with card illustrations to serve at <c>/art</c> (REALMS_ART), or null to serve none.</summary>
    public string? Art { get; init; }

    /// <summary>Where the art's sizes are kept once made (REALMS_ART_CACHE).</summary>
    public string ArtCache { get; init; } = Path.Combine(Path.GetTempPath(), "cantrip-realms-art");

    /// <summary>Reads the options from configuration, whose environment variables are <c>REALMS_*</c>.</summary>
    public static RealmOptions From(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        string? Setting(string name) => configuration[$"REALMS_{name}"] is { Length: > 0 } value ? value : null;
        int Count(string name, int otherwise) => Setting(name) is { } value ? int.Parse(value, System.Globalization.CultureInfo.InvariantCulture) : otherwise;
        TimeSpan Seconds(string name, TimeSpan otherwise) => Setting(name) is { } value ? TimeSpan.FromSeconds(double.Parse(value, System.Globalization.CultureInfo.InvariantCulture)) : otherwise;
        var finds = new FindOptions();

        return new RealmOptions
        {
            Database = RealmDatabase.Parse(Setting("DATABASE") ?? (configuration["DATABASE_URL"] is { Length: > 0 } url ? url : "sqlite:realms.db")),
            Root = Setting("ROOT") ?? FindRoot() ?? throw new InvalidOperationException("No REALMS_ROOT, and no repository above the server to read the content from."),
            Site = Setting("SITE") is { } site ? new Uri(site) : null,
            DiscordClientId = Setting("DISCORD_CLIENT_ID"),
            DiscordClientSecret = Setting("DISCORD_CLIENT_SECRET"),
            Keys = Setting("KEYS"),
            Client = Setting("CLIENT") is { } client ? new Uri(client) : null,
            Cards = Setting("CARDS") is { } cards ? new Uri(cards) : null,
            DevSignIn = Setting("DEV_SIGNIN") is "1" or "true",
            Migrate = Setting("MIGRATE") is not ("0" or "false"),
            WalkingSpeed = Setting("WALKING_SPEED") is { } speed ? double.Parse(speed, System.Globalization.CultureInfo.InvariantCulture) : DefaultWalkingSpeed,
            InstanceSize = Setting("INSTANCE_SIZE") is { } size ? int.Parse(size, System.Globalization.CultureInfo.InvariantCulture) : 40,
            StartTown = Setting("START_TOWN") ?? "new-benalia",
            Places = Setting("PLACES"),
            Art = Setting("ART"),
            ArtCache = Setting("ART_CACHE") ?? Path.Combine(Path.GetTempPath(), "cantrip-realms-art"),
            Finds = new FindOptions
            {
                ChestsPerZone = Count("CHESTS_PER_ZONE", finds.ChestsPerZone),
                ChestEvery = Seconds("CHEST_EVERY", finds.ChestEvery),
                ChestLasts = Seconds("CHEST_LASTS", finds.ChestLasts),
                Heartblooms = Count("HEARTBLOOMS", finds.Heartblooms),
                HeartbloomEvery = Seconds("HEARTBLOOM_EVERY", finds.HeartbloomEvery),
                HeartbloomLasts = Seconds("HEARTBLOOM_LASTS", finds.HeartbloomLasts),
            },
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

/// <summary>
/// How the finds of the wilds spawn (design.md A5, A3b; Economy/Finds): at most <see cref="ChestsPerZone"/> treasure
/// chests in each tier zone of the wilds, a new one about every <see cref="ChestEvery"/> in a zone with fewer, each
/// standing <see cref="ChestLasts"/> unless opened; at most <see cref="Heartblooms"/> heartblooms in the world, one about
/// every <see cref="HeartbloomEvery"/> while there are fewer, each standing <see cref="HeartbloomLasts"/> unless picked.
/// </summary>
public sealed record FindOptions
{
    public int ChestsPerZone { get; init; } = 1;

    public TimeSpan ChestEvery { get; init; } = TimeSpan.FromMinutes(10);

    public TimeSpan ChestLasts { get; init; } = TimeSpan.FromMinutes(30);

    public int Heartblooms { get; init; } = 3;

    public TimeSpan HeartbloomEvery { get; init; } = TimeSpan.FromMinutes(30);

    public TimeSpan HeartbloomLasts { get; init; } = TimeSpan.FromHours(3);
}
