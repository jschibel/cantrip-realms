using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Cantrip.Art;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Cantrip.Client.Web.Tests;

/// <summary>
/// What Cantrip Realms' card layer (<c>?realm</c>) runs against in a test, each on an origin of its own as a deployment has
/// them: the real realm server (<c>realms/dotnet/Cantrip.Realms.Server</c>, built, started as its own process on a fresh
/// SQLite file with the development sign-in, and told the card layer's origin, <c>REALMS_CARDS</c>), a stand-in for the
/// overworld - a page that frames the card layer full size and speaks the bridge (<c>{realm: 1, op: "open"}</c>, and the
/// <c>closed</c> answers it keeps in <c>window.realmClosed</c>) - and card art. Started by the first test that asks
/// (<see cref="StartAsync"/>), for every test of the class.
/// </summary>
public sealed class RealmSite : IAsyncLifetime
{
    private readonly SemaphoreSlim _starting = new(1, 1);
    private readonly StringBuilder _serverLog = new();
    private readonly string _database = Path.Combine(Path.GetTempPath(), $"cantrip-realm-web-{Guid.NewGuid():N}.db");
    private Process? _server;
    private WebApplication? _overworld;
    private WebApplication? _art;

    /// <summary>The realm server's address, with a trailing slash.</summary>
    public Uri Server { get; private set; } = null!;

    /// <summary>The overworld's stand-in page.</summary>
    public Uri Overworld { get; private set; } = null!;

    /// <summary>The card art service's address.</summary>
    public string Art { get; private set; } = string.Empty;

    /// <summary>What the realm server has written, for a test that fails to say why.</summary>
    public string ServerLog
    {
        get
        {
            lock (_serverLog)
            {
                return _serverLog.ToString();
            }
        }
    }

    public static string ServerAssembly => Path.Combine(WebClient.Root, "realms", "dotnet", "Cantrip.Realms.Server", "bin", "Debug", "net10.0", "cantrip-realms-server.dll");

    /// <summary>Starts everything once; later calls wait on the first. The card layer is <paramref name="web"/>'s page.</summary>
    public async Task StartAsync(WebClient web)
    {
        await _starting.WaitAsync();
        try
        {
            if (_server is not null)
            {
                return;
            }

            if (!File.Exists(ServerAssembly))
            {
                throw new InvalidOperationException($"The realm server is not built at {ServerAssembly}: dotnet build realms\\dotnet\\Cantrip.Realms.sln first.");
            }

            _overworld = await ServeOverworld();
            Overworld = new Uri(_overworld.Urls.First() + "/");
            _art = await ArtServer.StartAsync(new ArtStore(new ArtStoreOptions { ContentRoot = WebClient.Content, CacheDirectory = WebClient.ArtCache }), "127.0.0.1", 0);
            Art = _art.Urls.First();

            int port = FreePort();
            Server = new Uri($"http://127.0.0.1:{port}/");
            var start = new ProcessStartInfo("dotnet", $"\"{ServerAssembly}\"")
            {
                WorkingDirectory = Path.GetDirectoryName(ServerAssembly)!,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            start.Environment["ASPNETCORE_URLS"] = Server.GetLeftPart(UriPartial.Authority);
            start.Environment["ASPNETCORE_ENVIRONMENT"] = "Development";
            start.Environment["REALMS_DEV_SIGNIN"] = "1";
            start.Environment["REALMS_DATABASE"] = $"sqlite:{_database}";
            start.Environment["REALMS_ROOT"] = WebClient.Root;
            start.Environment["REALMS_CLIENT"] = Overworld.AbsoluteUri;
            start.Environment["REALMS_CARDS"] = web.Site.AbsoluteUri;
            _server = Process.Start(start) ?? throw new InvalidOperationException("The realm server did not start.");
            _server.OutputDataReceived += (_, line) => Keep(line.Data);
            _server.ErrorDataReceived += (_, line) => Keep(line.Data);
            _server.BeginOutputReadLine();
            _server.BeginErrorReadLine();

            using var http = new HttpClient();
            DateTime giveUp = DateTime.UtcNow.AddMinutes(3);
            while (true)
            {
                if (_server.HasExited)
                {
                    throw new InvalidOperationException($"The realm server stopped as it started:\n{ServerLog}");
                }

                try
                {
                    if ((await http.GetAsync(new Uri(Server, "healthz"))).IsSuccessStatusCode)
                    {
                        break;
                    }
                }
                catch (HttpRequestException)
                {
                }

                if (DateTime.UtcNow > giveUp)
                {
                    throw new InvalidOperationException($"The realm server never answered /healthz:\n{ServerLog}");
                }

                await Task.Delay(250);
            }
        }
        finally
        {
            _starting.Release();
        }
    }

    private void Keep(string? line)
    {
        if (line is null)
        {
            return;
        }

        lock (_serverLog)
        {
            _serverLog.AppendLine(line);
        }
    }

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    /// <summary>
    /// The overworld's stand-in: the card layer framed over the whole page from its <c>cards</c> query, as realms/web's
    /// CardLayer frames it, and the bridge's side of it - <c>realmOpen(screen, args)</c> asks for a screen, and every
    /// <c>closed</c> answer is kept in <c>realmClosed</c>.
    /// </summary>
    private static async Task<WebApplication> ServeOverworld()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        WebApplication app = builder.Build();
        app.MapGet("/", () => Results.Content(OverworldPage, "text/html"));
        await app.StartAsync();
        return app;
    }

    private const string OverworldPage = """
        <!doctype html>
        <html><head><meta charset="utf-8"><title>Overworld stand-in</title></head>
        <body style="margin:0;background:#101018;overflow:hidden">
        <iframe id="cards" title="Cards" style="position:fixed;left:0;top:0;width:100vw;height:100vh;border:0"></iframe>
        <script>
          const target = new URL(new URLSearchParams(location.search).get("cards"));
          const frame = document.getElementById("cards");
          frame.src = target.toString();
          window.realmReady = false;
          window.realmClosed = [];
          let next = 1;
          window.addEventListener("message", (e) => {
            if (e.source !== frame.contentWindow || e.origin !== target.origin) return;
            const message = e.data;
            if (!message || message.realm !== 1) return;
            if (message.op === "ready") window.realmReady = true;
            if (message.op === "closed") window.realmClosed.push(message);
          });
          window.realmOpen = (screen, args) => {
            const id = next++;
            frame.contentWindow.postMessage({ realm: 1, op: "open", id, screen, args }, target.origin);
            return id;
          };
          window.realmClose = () => frame.contentWindow.postMessage({ realm: 1, op: "close" }, target.origin);
        </script>
        </body></html>
        """;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (_server is { HasExited: false } server)
        {
            server.Kill(entireProcessTree: true);
            await server.WaitForExitAsync();
        }

        _server?.Dispose();
        if (_overworld is not null)
        {
            await _overworld.DisposeAsync();
        }

        if (_art is not null)
        {
            await _art.DisposeAsync();
        }

        foreach (string file in new[] { _database, _database + "-wal", _database + "-shm" })
        {
            try
            {
                File.Delete(file);
            }
            catch (IOException)
            {
            }
        }

        _starting.Dispose();
    }

    /// <summary>The map files the realm is played on, by id: what a test reads to stand a character somewhere.</summary>
    public static JsonElement Map(string id)
    {
        string file = Directory.EnumerateFiles(Path.Combine(WebClient.Root, "realms", "content"), id + ".json", SearchOption.AllDirectories)
            .First(path => path.Contains($"{Path.DirectorySeparatorChar}maps{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
        using JsonDocument document = JsonDocument.Parse(File.ReadAllBytes(file));
        return document.RootElement.Clone();
    }

    /// <summary>The first open hex beside a map's first NPC of a kind (in hex.ts's order of directions): where one stands to use it.</summary>
    public static (int Q, int R) BesideNpc(string map, string kind)
    {
        JsonElement data = Map(map);
        JsonElement npc = data.GetProperty("npcs").EnumerateArray().First(person => person.GetProperty("kind").GetString() == kind);
        int q = npc.GetProperty("q").GetInt32();
        int r = npc.GetProperty("r").GetInt32();
        HashSet<(int, int)> open = [.. data.GetProperty("tiles").EnumerateArray()
            .Where(tile => tile[4].GetInt32() == 0)
            .Select(tile => (tile[0].GetInt32(), tile[1].GetInt32()))];
        foreach ((int dq, int dr) in ((int, int)[])[(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)])
        {
            if (open.Contains((q + dq, r + dr)))
            {
                return (q + dq, r + dr);
            }
        }

        throw new InvalidOperationException($"No open hex beside {map}'s {kind}.");
    }

    /// <summary>Where a town's inn stands.</summary>
    public static (int Q, int R) Inn(string map)
    {
        JsonElement inn = Map(map).GetProperty("inn");
        return (inn.GetProperty("q").GetInt32(), inn.GetProperty("r").GetInt32());
    }
}
