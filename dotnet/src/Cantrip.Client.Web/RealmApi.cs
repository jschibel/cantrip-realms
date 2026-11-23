using System.Net;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Cantrip.Realms;

namespace Cantrip.Client.Web;

/// <summary>
/// The realm server's API as the card layer calls it (realms/docs/interfaces.md, "The realm server's API"): what happens
/// inside a screen - buying, selling, saving the deck and the loadout - on the signed-in cookie. The server is the one the
/// overworld named in the frame's address (<c>?api=</c>), or this page's own origin; a call to another origin carries the
/// cookie (the server answers the card layer's origin, <c>REALMS_CARDS</c>).
/// </summary>
public static class RealmApi
{
    private static readonly HttpClient Http = new();

    /// <summary>
    /// What the browser's fetch is told beside the request (the browser's HTTP handler reads them under this key): here that
    /// the cookie goes with it to another origin, as <c>credentials: "include"</c>.
    /// </summary>
    private static readonly HttpRequestOptionsKey<IDictionary<string, object>> FetchOptions = new("WebAssemblyFetchOptions");

    /// <summary>Where the realm server is: <c>?api=</c>, else this page's origin.</summary>
    public static Uri Base { get; } = FindBase();

    private static Uri FindBase()
    {
        string search = JSHost.GlobalThis.GetPropertyAsJSObject("location")?.GetPropertyAsString("search") ?? string.Empty;
        foreach (string pair in search.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            int equals = pair.IndexOf('=', StringComparison.Ordinal);
            if (equals > 0 && pair[..equals] == "api" && Uri.TryCreate(Uri.UnescapeDataString(pair[(equals + 1)..].Replace('+', ' ')), UriKind.Absolute, out Uri? api))
            {
                return new Uri(api.AbsoluteUri.EndsWith('/') ? api.AbsoluteUri : api.AbsoluteUri + "/");
            }
        }

        return new Uri(ClientConfig.Page.GetLeftPart(UriPartial.Authority) + "/");
    }

    /// <summary>The address of a call, <c>api/&lt;path&gt;</c> on the server.</summary>
    public static Uri Url(string path) => new(Base, "api/" + path);

    /// <summary>A call as the browser sends it to the realm server: with the sign-in cookie, whatever origin it is on.</summary>
    public static async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string? json = null)
    {
        using var request = new HttpRequestMessage(method, Url(path));
        request.Options.Set(FetchOptions, new Dictionary<string, object> { ["credentials"] = "include" });
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        return await Http.SendAsync(request);
    }

    /// <summary>A call and its answer, or the refusal it met; a server that did not answer is a refusal too.</summary>
    public static async Task<RealmReply<T>> CallAsync<T>(HttpMethod method, string path, JsonTypeInfo<T> answer, string? json = null)
    {
        try
        {
            using HttpResponseMessage response = await SendAsync(method, path, json);
            string text = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                RealmRefusal? refusal = null;
                try
                {
                    refusal = JsonSerializer.Deserialize(text, RealmJson.Default.RealmRefusal);
                }
                catch (JsonException)
                {
                }

                return new RealmReply<T>(default, refusal ?? new RealmRefusal(
                    response.StatusCode == HttpStatusCode.Unauthorized ? "NotSignedIn" : response.StatusCode.ToString(),
                    response.StatusCode == HttpStatusCode.Unauthorized ? "Sign in to the realm first." : $"The realm server said {(int)response.StatusCode}.",
                    null));
            }

            return new RealmReply<T>(JsonSerializer.Deserialize(text, answer), null);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException)
        {
            return new RealmReply<T>(default, new RealmRefusal("Unreachable", "The realm server did not answer. Try again.", null));
        }
    }

    public static Task<RealmReply<T>> GetAsync<T>(string path, JsonTypeInfo<T> answer) => CallAsync(HttpMethod.Get, path, answer);

    /// <summary>A call with a body, written as <paramref name="type"/> says.</summary>
    public static Task<RealmReply<T>> CallAsync<TBody, T>(HttpMethod method, string path, TBody body, JsonTypeInfo<TBody> type, JsonTypeInfo<T> answer) =>
        CallAsync(method, path, answer, JsonSerializer.Serialize(body, type));
}

/// <summary>What a call came to: its answer, or why it was refused.</summary>
public sealed record RealmReply<T>(T? Value, RealmRefusal? Refused)
{
    public bool Ok => Refused is null && Value is not null;

    /// <summary>The refusal in words, as a screen shows it: its detail, and what is wrong one by one.</summary>
    public string Words => Refused is null ? string.Empty
        : Refused.Problems is { Count: > 0 } problems ? $"{Refused.Detail} {string.Join(" ", problems)}" : Refused.Detail;
}

// What the API sends and takes, as the card layer reads it (interfaces.md); PascalCase on the wire, as the server writes it.

public sealed record RealmRefusal(string Error, string Detail, IReadOnlyList<string>? Problems);

public sealed record RealmStats(int Life, int Hand, int MaxHand);

public sealed record RealmGear(string Id, string Name, string Slot, string Rarity, long Gold, RealmStats Stats, string Text, bool Unique, string? Emblem);

public sealed record RealmGearInstance(long InstanceId, RealmGear Gear);

public sealed record RealmCharacter(
    string Id,
    string Name,
    string Identity,
    long Gold,
    long AnteValue,
    string Map,
    RealmStats Stats,
    IReadOnlyDictionary<string, RealmGearInstance?> Loadout,
    IReadOnlyList<RealmGearInstance> Gear);

public sealed record RealmCardCount(string Name, int Count);

public sealed record RealmDeck(IReadOnlyList<RealmCardCount> Main, IReadOnlyList<RealmCardCount> Ante, long AnteValue);

public sealed record RealmDeckChange(IReadOnlyList<RealmCardCount> Main, IReadOnlyList<RealmCardCount> Ante);

public sealed record RealmDeckCheck(IReadOnlyList<string> Problems, long AnteValue);

public sealed record RealmCollection(IReadOnlyDictionary<string, int> Cards);

public sealed record RealmVendorInfo(string Id, string Name, string Town);

public sealed record RealmStock(string Name, long Gold, int Count, DateTimeOffset? Until);

public sealed record RealmBuying(string Name, long Gold, int Owned, int Spare);

public sealed record RealmVendor(RealmVendorInfo Vendor, long Purse, IReadOnlyList<RealmStock> Stock, long Gold, IReadOnlyList<RealmBuying> Buying);

public sealed record RealmCardTrade(string Name);

public sealed record RealmTrade(long Gold, RealmCollection Collection);

public sealed record RealmArmorer(IReadOnlyList<RealmGear> Stock);

public sealed record RealmGearBuy(string GearId);

public sealed record RealmGearSell(long InstanceId);

public sealed record RealmGearTrade(long Gold, IReadOnlyList<RealmGearInstance> Gear);

public sealed record RealmLoadoutChange(IReadOnlyDictionary<string, long?> Slots);

/// <summary>A card offered after a win, and its list price (the <c>loot</c> screen's <c>offer</c>).</summary>
public sealed record RealmOffered(string Name, long Gold);

[JsonSourceGenerationOptions(PropertyNameCaseInsensitive = true)]
[JsonSerializable(typeof(RealmRefusal))]
[JsonSerializable(typeof(RealmCharacter))]
[JsonSerializable(typeof(RealmDeck))]
[JsonSerializable(typeof(RealmDeckChange))]
[JsonSerializable(typeof(RealmDeckCheck))]
[JsonSerializable(typeof(RealmCollection))]
[JsonSerializable(typeof(RealmVendor))]
[JsonSerializable(typeof(RealmCardTrade))]
[JsonSerializable(typeof(RealmTrade))]
[JsonSerializable(typeof(RealmArmorer))]
[JsonSerializable(typeof(RealmGearBuy))]
[JsonSerializable(typeof(RealmGearSell))]
[JsonSerializable(typeof(RealmGearTrade))]
[JsonSerializable(typeof(RealmLoadoutChange))]
[JsonSerializable(typeof(List<RealmOffered>))]
[JsonSerializable(typeof(Duel))]
internal sealed partial class RealmJson : JsonSerializerContext;
