using Cantrip.Art;
using Cantrip.Realms.Server;
using Cantrip.Realms.Server.Content;

// The realm server (realms/docs/tech.md B4): configured by environment variables (RealmOptions), it readies its store and
// content, then serves /api, /realm/ws, sign-in and /healthz. realms/dotnet/README.md says how to run it.

// `catalog <file>` writes the card faces GET /api/catalog serves to a file and stops: what a card layer framed with no
// realm server (offline play) reads from its own origin instead (realms/web/scripts/cardLayer.mjs, tools/realms/play.cmd).
if (args is ["catalog", string catalogFile])
{
    RealmOptions settings = RealmOptions.From(new ConfigurationBuilder().AddEnvironmentVariables().Build());
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(catalogFile))!);
    await File.WriteAllBytesAsync(catalogFile, RealmApi.Catalog(RealmContent.Load(settings.Root, places: settings.Places))).ConfigureAwait(false);
    return;
}

// `art [--urls ...]` serves card art alone (REALMS_ART, REALMS_ART_CACHE): /art/{size}/{slug}.webp at the sizes the card
// layer asks for, and /healthz - for a card layer with no realm server (offline play, tools/realms/play.cmd /offline),
// which would otherwise draw no pictures, and never the full-size illustrations.
if (args is ["art", ..])
{
    WebApplicationBuilder artBuilder = WebApplication.CreateBuilder(args[1..]);
    RealmOptions artOptions = RealmOptions.From(artBuilder.Configuration);
    WebApplication artApp = artBuilder.Build();
    artApp.MapGet("/healthz", () => "ok");
    artApp.MapCardArt(new ArtStore(new ArtStoreOptions
    {
        ContentRoot = artOptions.Art ?? throw new InvalidOperationException("Serving art needs REALMS_ART: a content folder with <dataset>/images."),
        CacheDirectory = artOptions.ArtCache,
    }));
    await artApp.RunAsync().ConfigureAwait(false);
    return;
}

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
RealmOptions options = RealmOptions.From(builder.Configuration);
builder.Services.AddRealm(options);

WebApplication app = builder.Build();
await app.PrepareRealm().ConfigureAwait(false);
app.UseRealm();
await app.RunAsync().ConfigureAwait(false);

/// <summary>The server's entry point, named so the tests can host it (WebApplicationFactory).</summary>
public partial class Program;
