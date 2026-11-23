using Cantrip.Realms.Server;

// The realm server (realms/docs/tech.md B4): configured by environment variables (RealmOptions), it readies its store and
// content, then serves /api, /realm/ws, sign-in and /healthz. realms/dotnet/README.md says how to run it.

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
RealmOptions options = RealmOptions.From(builder.Configuration);
builder.Services.AddRealm(options);

WebApplication app = builder.Build();
await app.PrepareRealm().ConfigureAwait(false);
app.UseRealm();
await app.RunAsync().ConfigureAwait(false);

/// <summary>The server's entry point, named so the tests can host it (WebApplicationFactory).</summary>
public partial class Program;
