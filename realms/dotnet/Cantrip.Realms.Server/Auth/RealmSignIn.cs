using System.Globalization;
using System.Security.Claims;
using Cantrip.Discord;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Cantrip.Realms.Server.Auth;

/// <summary>
/// Signing in to the realm (realms/docs/tech.md B4): the Discord bot site's own sign-in (<see cref="SiteSignIn"/>: Discord
/// OAuth with PKCE, then a cookie sealed by the server), with the game's own Discord application and keys. A player is
/// <c>discord-{id}</c>.
/// <para>
/// <see cref="SiteSignIn"/> lands a player on its site's <c>/home</c> once they are signed in, and on
/// <c>/home?signin=failed</c> when they are not; here <c>/home</c> passes them on to the world client
/// (<see cref="RealmOptions.Client"/>), query and all.
/// </para>
/// <para>
/// For tests and local play there is also a sign-in with no Discord at all, only when <c>REALMS_DEV_SIGNIN=1</c> says so:
/// <c>POST /dev/signin {"Id": 7, "Name": "Ann"}</c> signs in as <c>dev-7</c>, on the same cookie.
/// </para>
/// </summary>
public static class RealmSignIn
{
    private const string DevClaim = "urn:cantrip-realms:dev";

    /// <summary>The Discord site's sign-in options for the realm's settings.</summary>
    public static SiteSignInOptions SiteOptions(RealmOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return new SiteSignInOptions
        {
            Site = options.Site ?? new Uri("http://localhost:5080/"),
            ClientId = options.DiscordClientId,
            ClientSecret = options.DiscordClientSecret,
            Keys = options.Keys,
        };
    }

    public static IServiceCollection AddRealmSignIn(this IServiceCollection services, RealmOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        SiteSignInOptions site = SiteOptions(options);
        services.AddSingleton(site);
        services.AddSiteSignIn(site);
        if (!site.Enabled && options.DevSignIn)
        {
            // The cookie SiteSignIn would have set up, for the development sign-in alone.
            services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
                .AddCookie(cookie =>
                {
                    cookie.Cookie.Name = "cantrip.signin";
                    cookie.Cookie.HttpOnly = true;
                    cookie.Cookie.SameSite = SameSiteMode.Lax;
                    cookie.Events.OnRedirectToLogin = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        return Task.CompletedTask;
                    };
                });
        }

        return services;
    }

    public static void UseRealmSignIn(this IApplicationBuilder app, RealmOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        SiteSignInOptions site = app.ApplicationServices.GetRequiredService<SiteSignInOptions>();
        app.UseSiteSignIn(site);
        if (!site.Enabled && options.DevSignIn)
        {
            app.UseAuthentication();
        }
    }

    public static void MapRealmSignIn(this IEndpointRouteBuilder app, RealmOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        app.MapSiteSignIn(app.ServiceProvider.GetRequiredService<SiteSignInOptions>());

        // Where SiteSignIn lands a player: on to the world.
        app.MapGet("/" + HomeSite.Route, (HttpContext context) =>
            options.Client is { } client
                ? Results.Redirect(new Uri(client, context.Request.QueryString.Value ?? string.Empty).AbsoluteUri)
                : Results.Text("Signed in. The realm's world client is not configured here (REALMS_CLIENT)."));

        if (options.DevSignIn)
        {
            app.MapPost("/dev/signin", async (HttpContext context, DevSignIn body) =>
            {
                if (body.Id == 0 || string.IsNullOrWhiteSpace(body.Name))
                {
                    return Results.BadRequest(new ApiError("BadRequest", "A development sign-in names an id and a name."));
                }

                ClaimsIdentity identity = new(
                    [
                        new Claim(ClaimTypes.NameIdentifier, body.Id.ToString(CultureInfo.InvariantCulture)),
                        new Claim(ClaimTypes.Name, body.Name),
                        new Claim(DevClaim, "1"),
                    ],
                    CookieAuthenticationDefaults.AuthenticationScheme);
                await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity)).ConfigureAwait(false);
                return Results.Ok(new { Player = $"dev-{body.Id}" });
            });
        }
    }

    /// <summary>The player signed in - <c>discord-{id}</c>, or <c>dev-{id}</c> - or null.</summary>
    public static string? PlayerId(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (SiteSignIn.Account(context) is not { } account)
        {
            return null;
        }

        return context.User.HasClaim(claim => claim.Type == DevClaim)
            ? string.Create(CultureInfo.InvariantCulture, $"dev-{account.Id}")
            : string.Create(CultureInfo.InvariantCulture, $"discord-{account.Id}");
    }

    /// <summary>A development sign-in's body.</summary>
    public sealed record DevSignIn(ulong Id, string Name);
}
