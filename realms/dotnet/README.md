# The realm server

`Cantrip.Realms.Server` is Cantrip Realms' server (`realms/docs/tech.md` B4): characters, collections, decks and antes,
gear, vendors and armorers, encounters checked by replaying them on the native engine, loot, chests, and the presence
relay. Its API, its presence protocol and its content are `realms/docs/interfaces.md`.

| Project | What it is |
| --- | --- |
| `Cantrip.Realms` | What the browser and the server must do alike: the `Duel` and the table it is dealt to (`DuelTable`), the log codec and `RecordingTransport`, the mob's bot (`RealmBot`), the spawn table (`Spawns`). |
| `Cantrip.Realms.Server` | The ASP.NET Core server (`cantrip-realms-server`). |
| `Cantrip.Realms.Server.Tests` | Its tests (xUnit). |

`Cantrip.Realms.sln` holds them and the cantrip-rs projects they reference. `Directory.Build.props` and
`Directory.Packages.props` import cantrip-rs's own (`dotnet/`) and add only the framework (net10.0) and the server's
packages, each pinned exactly.

## Run it locally

To play, `tools\realms\play.cmd` builds and starts everything - this server, the card layer and the overworld - and
opens the browser signed in (`realms/docs/tech.md`, "Playing it locally"). The server alone:

From the repository root, with the .NET 10 SDK:

```
cargo build --profile cards -p cantrip-host          # the engine that checks duels; once, and after engine changes

set REALMS_DEV_SIGNIN=1
dotnet run --project realms\dotnet\Cantrip.Realms.Server --urls http://localhost:5080
```

It starts on the world the generator writes (`realms/content/dominaria/world`, its interiors and dungeons: `npm run
world` in `realms/web`), the Domains, with new characters outside New Benalia's inn. `REALMS_PLACES` points it at
another world instead, such as the tests' small one:

```
set REALMS_PLACES=%CD%\realms\dotnet\Cantrip.Realms.Server.Tests\World
```

That keeps its data in `realms.db` (SQLite) beside the server's project (`dotnet run` runs it from there; git ignores
it), finds the content in the repository it runs from, and lets anyone sign in as anyone. Then:

```
curl -c jar -H "Content-Type: application/json" -d "{\"Id\":1,\"Name\":\"Ann\"}" http://localhost:5080/dev/signin
curl -b jar -H "Content-Type: application/json" -d "{\"Name\":\"Ann\",\"Body\":\"lithe\",\"Palette\":0,\"Color\":\"W\"}" http://localhost:5080/api/character
curl -b jar http://localhost:5080/api/me
curl http://localhost:5080/healthz
```

With Discord sign-in instead (the game's own Discord application, whose OAuth2 redirect is `<site>/signin/discord`):

```
set REALMS_SITE=http://localhost:5080/
set REALMS_DISCORD_CLIENT_ID=...
set REALMS_DISCORD_CLIENT_SECRET=...
set REALMS_CLIENT=http://localhost:5173/
```

`/signin` goes to Discord and back, and on to `REALMS_CLIENT`, the world client.

## Configuration

Every setting is an environment variable (`RealmOptions`):

| Variable | What it says | Default |
| --- | --- | --- |
| `REALMS_DATABASE` | `sqlite:<file>`, `postgres://user:password@host:5432/db` or `postgres:<Npgsql connection string>` (else `DATABASE_URL`) | `sqlite:realms.db` |
| `REALMS_MIGRATE` | `0` leaves the schema alone at start | migrations applied |
| `REALMS_ROOT` | the repository the content is read from (`realms/content`, `decks/`, `content/`) | the one above the server |
| `REALMS_SITE` | the server's public address, for Discord's redirect | `http://localhost:5080/` |
| `REALMS_DISCORD_CLIENT_ID`, `REALMS_DISCORD_CLIENT_SECRET` | the game's Discord application | none: no Discord sign-in |
| `REALMS_KEYS` | where the keys sealing the sign-in cookie are kept | in memory |
| `REALMS_CLIENT` | the world client's address: where sign-in lands, and a browser origin the API answers | none |
| `REALMS_CARDS` | the card layer's address (the web client's `?realm` page), when it has an origin of its own: the other browser origin the API answers | none |
| `REALMS_DEV_SIGNIN` | `1` allows `POST /dev/signin`, and the tests' `POST /dev/place` and `/dev/verdict` (interfaces.md) - never in production | off |
| `REALMS_START_TOWN` | the town new characters start in (and wake in until they set an inn), at its first inn | `new-benalia` |
| `REALMS_PLACES` | where each plane's world, interiors and dungeons are read from instead of `realms/content` (a folder of `<plane>/world`, `<plane>/interiors`, `<plane>/dungeons`) | `realms/content` |
| `REALMS_WALKING_SPEED` | the fastest walk, tiles a second (a diagonal step the square root of 2): presence's walks and reported places | `5` |
| `REALMS_INSTANCE_SIZE` | players in one layer of an area of the world (within two chunks), or one instance of an interior | `40` |
| `CANTRIP_NATIVE_HOST` | the native engine host (cantrip-rs's setting) | `target/cards`, `release` or `debug` |

ASP.NET Core's own settings (`ASPNETCORE_URLS`, `ASPNETCORE_ENVIRONMENT`) work as always.

## Tests

```
dotnet test realms\dotnet\Cantrip.Realms.sln --filter "Category!=WallClock"
```

runs everything but the native engine's whole games, against a fake clock and a fake duel verifier, over the roster,
gear and vendors of `realms/content` and the tests' own small world (`Cantrip.Realms.Server.Tests/World`, in version 2
of the world data, square tiles: five by four chunks from x -32, the Domains' towns the vendors keep shops in and the
traders visit, with their inns and shops, spawns of every tier, the region dungeons, the Portal, the Hurloon caves and
the twenty mage towers, by `layout.json`'s ids, a ferry and the traders' pitches). `World/make-world.py` writes it from
the layout, the roster and the vendors; run it after any of them changes. The content checks run over the generated
world too (`RealmApp.Generated`), since the server starts on it, and a server test plays on it (`new RealmApp {
OnGenerated = true }`). Walking is checked against the golden vectors of `realms/content/walk-vectors.json` (`WalkTests`), which
`tools/realms/walk-vectors.ts` writes from the overworld's A* (`node --experimental-transform-types
tools/realms/walk-vectors.ts`) and the overworld's tests check too. The duel verifier's
own tests play whole duels on the native engine (build it first, as above):

```
dotnet test realms\dotnet\Cantrip.Realms.sln --filter "Category=WallClock"
```

## Migrations

One model (`Data/RealmDb.cs`), a migration set per database. After changing the model, add both:

```
cd realms\dotnet\Cantrip.Realms.Server
dotnet ef migrations add <Name> --context SqliteRealmDb --output-dir Data/Migrations/Sqlite
dotnet ef migrations add <Name> --context PostgresRealmDb --output-dir Data/Migrations/Postgres
```

`DatabaseTests.Each_providers_migrations_are_the_model` fails until both are there.
