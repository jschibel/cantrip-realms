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

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
RealmOptions options = RealmOptions.From(builder.Configuration);
builder.Services.AddRealm(options);

WebApplication app = builder.Build();
await app.PrepareRealm().ConfigureAwait(false);
app.UseRealm();
await app.RunAsync().ConfigureAwait(false);

/// <summary>The server's entry point, named so the tests can host it (WebApplicationFactory).</summary>
public partial class Program;
