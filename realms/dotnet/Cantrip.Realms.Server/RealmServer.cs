using Cantrip.Art;
using Cantrip.Realms.Server.Auth;
using Cantrip.Realms.Server.Content;
using Cantrip.Realms.Server.Data;
using Cantrip.Realms.Server.Duels;
using Cantrip.Realms.Server.Economy;
using Cantrip.Realms.Server.Presence;
using Microsoft.EntityFrameworkCore;

namespace Cantrip.Realms.Server;

/// <summary>The realm server, put together: its services, its pipeline and its routes.</summary>
public static class RealmServer
{
    /// <summary>Registers everything the server runs on, from its options; a test replaces what it fakes after this.</summary>
    public static void AddRealm(this IServiceCollection services, RealmOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        services.AddSingleton(options);
        services.TryAddSingletonTime();
        services.AddSingleton(_ => RealmContent.Load(options.Root, places: options.Places));
        services.AddSingleton(_ => new RealmDice());
        services.AddSingleton<IDuelVerifier>(_ => new NativeDuelVerifier());
        services.AddSingleton<PresenceHub>();
        services.AddSingleton(provider => new Finds(provider.GetRequiredService<RealmContent>(), options, provider.GetRequiredService<TimeProvider>(), provider.GetRequiredService<PresenceHub>()));
        services.AddSingleton<DevVerdicts>();
        services.AddSingleton<DevDuels>();
        options.Database.Register(services);
        services.AddScoped<Hearts>();
        services.AddScoped<Characters>();
        services.AddScoped<DecksAndGear>();
        services.AddScoped<Vendors>();
        services.AddScoped<Armorers>();
        services.AddScoped<Encounters>();
        services.AddScoped<Chests>();
        services.AddScoped<Dungeons>();
        services.AddHostedService<RealmClock>();
        services.AddRealmSignIn(options);
        services.AddHealthChecks();
        services.ConfigureHttpJsonOptions(json => json.SerializerOptions.PropertyNamingPolicy = null);
        if (options.Origins.Count > 0)
        {
            services.AddCors(cors => cors.AddDefaultPolicy(policy => policy
                .WithOrigins([.. options.Origins])
                .AllowCredentials()
                .AllowAnyHeader()
                .AllowAnyMethod()));
        }
    }

    private static void TryAddSingletonTime(this IServiceCollection services)
    {
        if (!services.Any(service => service.ServiceType == typeof(TimeProvider)))
        {
            services.AddSingleton(TimeProvider.System);
        }
    }

    /// <summary>
    /// Readies the store and the content before the first request: the migrations applied (unless told not to), the content
    /// read and checked - a server whose content does not hold together stops here - and every vendor created.
    /// </summary>
    public static async Task PrepareRealm(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        RealmOptions options = app.Services.GetRequiredService<RealmOptions>();
        app.Services.GetRequiredService<RealmContent>();
        using IServiceScope scope = app.Services.CreateScope();
        RealmDb db = scope.ServiceProvider.GetRequiredService<RealmDb>();
        if (options.Migrate)
        {
            await db.Database.MigrateAsync().ConfigureAwait(false);
        }

        await scope.ServiceProvider.GetRequiredService<Vendors>().CreateMissing().ConfigureAwait(false);
    }

    /// <summary>The pipeline and the routes.</summary>
    public static void UseRealm(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        RealmOptions options = app.Services.GetRequiredService<RealmOptions>();
        app.UseWebSockets();
        if (options.Origins.Count > 0) app.UseCors();
        app.UseRealmSignIn(options);
        app.MapHealthChecks("/healthz");
        app.MapRealmSignIn(options);
        app.MapRealmApi();
        app.MapRealmDevApi(options);
        app.MapPresence();
        if (options.Art is { } art)
        {
            app.MapCardArt(new ArtStore(new ArtStoreOptions { ContentRoot = art, CacheDirectory = options.ArtCache }));
        }
    }
}
