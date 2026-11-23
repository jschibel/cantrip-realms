# Cantrip Realms - technical design

How the game in `design.md` is built, tested and deployed, and the order it is built in.



### B1. The repository
- **Setup:**
  1. `gh repo fork cantrip-rs/cantrip-rs --fork-name cantrip-realms` under jschibel.
  2. In the local clone, add the remote `upstream` = cantrip-rs.
  3. Merge upstream `main` into the fork's `main` regularly, through `tools/realms/sync-upstream.cmd`.
- **Layout:** the fork adds `realms/` (game code and content) and a few project heads. It touches upstream files only at documented seams, to keep merges clean. CLAUDE.md gets a Realms section.

### B2. Upstream engine work (lands on cantrip-rs first)
1. **Per-player game parameters** in `Setup`, the host `Deal`, `NewGame` and `RulesGameOptions`:
   - `starting_life` sets both `Player.life` and `starting_life` (CR 103.4).
   - `starting_hand_size` replaces the literal 7 in `turn::opening` for the opening draw and each mulligan redraw (CR 103.5). The London mulligan still bottoms the number of mulligans taken.
   - `maximum_hand_size` is the base that `actions::maximum_hand_size` starts from (CR 402.2). Effects still override it by timestamp, as now.
   - The defaults are unchanged, and Commander's 40 becomes a default derived from these parameters.
2. **Start-of-game command-zone objects (Vanguard, CR 902):** `Setup.seats[i].command_objects: Vec<CardId>`, created in `Zone::COMMAND` in `Game::new` before the opening, with the same immunity as emblems (CR 114.4 / 902).
   - This uses the existing emblem path (`ops::create_emblem`), not a parallel store.
   - A scenario `[Seats]` section in `cantrip-script` sets life, hand sizes and command objects, so all of this can be tested.
3. **`crates/cantrip-wasm`:** wasm-bindgen over `cantrip-host::session::Session`, speaking the same JSON-lines messages as `host.rs`. It takes a card table, so a fork can add its own definitions through the `deal_on` table hook.
   - Built for `wasm32-unknown-unknown` with `opt-level=s` and `wasm-opt`; the brotli size is measured in this milestone.
   - **The determinism check** is a test that plays N bench games natively and in Node/WASM and compares the state hash after every decision. It also runs the scenario corpus under WASM.
4. **`WasmRulesHost : IRulesHost`** in a new browser-safe `Cantrip.Server.Local`, which reuses `GameSession` and `LoopbackTransport`. It calls the engine through `JSImport`, synchronously, on the main thread; decisions take microseconds.
   - The web client gets an upstream `?local` mode: play the tactical bot with no server at all.
   - The `PresentationBoundaryTests` and `DependencyClosureTests` allow exactly that one project, with the reason written down: a local bot game owns its engine by design.
5. **New cards:**
   - Importing the Dominaria sets uses the existing `import-cards` skill and the GitHub claim flow, and runs alongside everything else: DOM, DMU and DMR first, then whatever the mob and boss decks need from the classic Dominaria sets.
   - Card coverage only limits the loot pool, so it never blocks the RPG work.

### B3. Gear in the engine (fork: `realms/crates/realms-gear`)
- **Effect families** are written once in Rust, each a parameterised constructor of command-zone abilities built from `cantrip-mechanics` (draw, scry, tokens, mana, counters, damage, prevention, once-per-game activated abilities), never a new core brick.
- **Item definitions** live in `realms/content/gear/*.json`. A build script generates one static `CardDef` per item from them, the way `cantrip-oracle` does, plus an extended card table for `deal_on`.
- **The fork's WASM build** and its native **replay verifier** both link cards plus gear.
- **Testing:** every family gets `.cantrip` scenarios over its parameter range, and every item gets a generated smoke scenario. Coverage uses `tools/card-coverage.cmd` on the gear crate. The no-rules-deviation bar applies in full.

### B4. Server (fork: `realms/dotnet/Cantrip.Realms.Server`, ASP.NET Core)
- **Auth:** reuses the `SiteSignIn` code (Discord OAuth with PKCE and a sealed cookie) with the game's own Discord application and keys. The player id is `discord-{id}`.
- **Storage:** **PostgreSQL** through EF Core migrations. SQLite is used for local development and tests through the same EF model.
  - Why not the existing JSON store: buying and selling has to change a player's gold and collection, a vendor's purse and its stock in one atomic transaction, and `EventStore`'s file-at-a-time writes can't do that. This is a server store, not an engine system.
  - Why Postgres: a managed database gives backups and point-in-time restore, and it lets more than one server instance run later.
  - Tables: players, collection, gear_owned, loadout, deck, ante, unlocks, relics (each relic an account ever received, design.md A3a), vendors, vendor_stock, vendor_visits, duels, chests, quests.
- **Authority:** the server owns everything of value, and the client only asks. The endpoints are a JSON API: character, collection, deck and ante save (only accepted while you stand at a spell table), loadout, vendor buy and sell, armorer, quests.
- **The encounter protocol** (single-player, but it can't be cheated):
  1. **Start:** `POST /encounter/start {map, spawnId}`. The server checks that the spawn exists in that map's **deterministic spawn table** (seeded by player, map and spawn epoch; the client and server share golden test vectors) and that your last reported position is close. It then **commits** the seed, the mob, a snapshot of your deck, loadout and ante, and the prize cap, and returns a duel token.
  2. **Play:** the browser plays the duel in WASM.
  3. **Report:** `POST /encounter/finish {token, decisionLog}`.
  4. **Verify:** the server **replays the log** with the native engine of the same version and recomputes the mob's answers with the same seeded `TacticalPlay`. Any mismatch rejects the report and counts the duel as a loss.
  5. **Win:** the server rolls the 3-card offer, and `POST /encounter/loot {picks}` grants the picks that fit the cap.
  6. **Loss:** the server removes a random ante card and moves you to the nearest inn.
- **Engine versions:** each build carries its engine version, and the server keeps the previous version's verifier for 24 hours across a deploy.
- **Vendors:** a background service applies each vendor's hourly trickle and rotation. It runs on `TimeProvider`, so tests use a fake clock.
- **Presence:** a WebSocket at `/realm/ws` (MessagePack, following `Cantrip.Protocol`).
  - The client sends `MoveIntent {map, fromHex, path}`. The server checks the path against the map's walkability data and your walking speed, then relays it to the instance.
  - Other messages: `Appearance` (body plus one look id per slot), `Join`, `Leave`, `Emote`.
  - Sending paths rather than frames keeps the traffic tiny, and clients animate the walk themselves.
- **Static files:** the world bundle, the Uno client, the engine `.wasm`, the models and the card art are all static, with hashed names, `immutable` caching and brotli, served from a CDN (B8). The server serves only the API and the WebSocket.

### B5. The overworld client (fork: `realms/web/`, TypeScript + Vite + three.js, pinned)
- **The retro 3D look:**
  - Orthographic dimetric isometric camera (2:1).
  - The scene is drawn to a **low-resolution target**, about 1/3 of device pixels and integer-scaled, then upscaled with nearest-neighbor filtering.
  - Lighting is stepped toon shading through a **per-plane 48-color palette** (a lookup table), with a Bayer dither in the shadow steps and 1-pixel outlines from depth and normal edges.
  - **The camera snaps to the texel grid**, so nothing shimmers. Effects are billboards drawn at the same pixel scale.
- **Assets:** **voxel models stored as data** (`realms/content/models/*.vox.json`), written by generator scripts and tuned by hand.
  - The browser greedy-meshes them when they load (`src/voxel/mesher.ts`) into vertex-colored meshes in the palette's colors, shared between every character drawn alike; they are small enough that no build step is needed.
  - Characters are segmented rigs (head, torso, arms, legs) with idle, walk, cast and interact animations. Each slot's gear is a voxel piece hung on an attachment point of the body. Mobs are base models with palette swaps (ten so far).
  - Audio: CC0 chiptune tracks and SFX generated with jsfxr.
- **Maps:** hex JSON (`realms/content/dominaria/maps/*.json`, interfaces.md) holding height, terrain, props, exits, spawn points, chests and NPCs. They are produced by a seeded generator plus hand-placed set pieces (`scripts/maps.ts`, `npm run maps`), edited in a dev-only in-browser map editor (`?editor`), linted by `validateMap`, and drawn as a prism per hex with the scenery merged into one mesh.
- **Play:** click-to-move with A* over hexes; local mob AI (wander, chase); the world-map travel screen with encounter rolls; NPC interaction; the HUD and minimap; and other players animated from relayed paths.
- **The HUD and menus that show no cards** are DOM and CSS built on **the client's Theme tokens and fonts**. A script generates `theme.css` from `Theme.cs`, so the two can't drift.
- **Without a server:** `?offline` (or no `?server=` / `VITE_REALM_SERVER`) plays the whole overworld against `MockApi`, the API in memory, with presence passed between the browser's own tabs; the card layer's stand-in panels (`?cards=stub`, the offline default) answer its screens. `?at=`, `?now=`, `?wander=0`, `?mobs=0` and `?encounters=` force a state for tests and development (src/main.ts).
- **Test hooks:** `?test` publishes `globalThis.realmTest`, the screen position of every entity and control by name, the way `cantripTest` does. `npm test` runs vitest; `npm run e2e` runs the Playwright suite (`e2e/`) against the offline overworld with real clicks. `npm run e2e:server` runs `e2e/server/` against the real realm server instead: it starts `Cantrip.Realms.Server` with the development sign-in on a fresh SQLite file and the overworld across origins (`?server=`), signs in, makes a character, walks, asks for a vendor's screen and starts an encounter through the API (the card layer's stand-in records the duel), and has two players see each other walk through the relay.

### B6. The two layers on one page
- **Two runtimes:** the page shows the three.js world at once and boots the Uno client (about 12 MB compressed) and the engine `.wasm` in the background, in a hidden full-screen layer.
- **Card screens open over the world**, as Fallout's barter screen does. The world pauses while they are open.
  - The screens: duel, spell table (deck and ante), vendor, loot pick, collection, and gear and paper-doll.
  - Gear is drawn as Vanguard-style oversize cards, using the same face renderer.
- **The bridge:** `window.realmBridge`, using `JSImport`/`JSExport` on the Uno side.
  - Calls in: `openDuel(spec)`, `openSpellTable()`, `openVendor(id)`, `openLoot(offer)`, `openGear()`, `close()`.
  - Events out: results.
- **On the Uno side:** a `?realm` mode in the fork's `Cantrip.Client.Web`, in new partial files (`MainPage.Realm*.cs`) next to the existing ones.
  - The duel uses `WasmRulesHost` with the bot seat in the tab.
  - Deck building reuses the `MainPage.Decks.cs` editor in a collection-limited mode that respects identity and the ante.
- **Milestone 0 proves this layering** before anything else depends on it.

### B7. Data pipelines (fork, `tools/realms/`)
- `fetch-prices.py`: Scryfall default-cards bulk → median paper price and rarity per Oracle card, plus each printing's set. Writes `realms/content/prices.json`; it is run monthly and committed.
- `planes.json`: set code → plane (Dominaria = Alpha through Mirage-era core, Ice Age, Weatherlight, Urza's, Invasion, Odyssey, Onslaught, Time Spiral, DOM, DMU, DMR, BRO…), with Universes Beyond excluded by Scryfall's set and printing data.
- `realm-pool.py`: implemented ∩ Vintage-legal ∩ not UB ∩ priced, split by plane, makes the loot and vendor pools.
- Mob decks: `decks/realms/dominaria/*.txt`, as plain decklists. A drafting tool built on `DeckBuilder` drafts each from a themed pool, then they are tuned by hand.

### B8. Deployment (provider-neutral, separate from cantrip-rs.dev)
- **One container image:** `realms/deploy/Dockerfile` is a multi-stage build.
  - A Rust stage builds the native replay verifier, `cantrip-native-host` linked with `realms-gear`, for linux-x64 and linux-arm64.
  - A .NET stage publishes `Cantrip.Realms.Server`.
  - The final image is the ASP.NET runtime with both, and it exposes the API, the WebSocket and `/healthz`.
  - All configuration comes from environment variables: the database URL, the Discord client id and secret, the cookie-key directory or KMS, and the CDN base URL.
- **The static bundle** — the world client, the Uno client, the engine `.wasm`, the models and the art renditions from `Cantrip.Art`'s sizes — is uploaded to any S3-compatible bucket behind a CDN.
  - Card art goes through the same pipeline: `fetch-card-art`, then the rendition sizes are pre-rendered at build time. The game doesn't depend on the cantrip-rs.dev art server.
- **Infrastructure:**
  - `realms/deploy/compose.yml` runs the server, Postgres and Caddy for TLS, for a single VM or for local staging.
  - Any container host works the same way: Fly.io, Render, a Kubernetes cluster, or a VM with Docker.
  - The database is managed Postgres in production.
- **CI/CD:** GitHub Actions in the fork.
  - On every PR: `tools/realms/test.cmd`, meaning the fork's Rust workspace, the server tests, vitest, and the Playwright suite against a compose stack.
  - On `main`: build and push the image to GHCR, upload the static bundle with hashed names first, then roll the server.
  - Engine version: the server image carries the current verifier and the previous one, so duels already in flight still verify for 24 hours.
  - Upstream cantrip-rs keeps no CI; this is the fork's own.
- **Owner steps:**
  - Choose the provider and domain.
  - Create the Discord OAuth app and its redirect URI.
  - Set the secrets in the provider and in GitHub Actions.

### B9. PvP (last milestone, after PvE ships)
- **The duel zone** in towns uses server-hosted tables: the existing `GameSession` and the native host through `Matchmaker`. Decks come from the collection, and both players' gear objects are in play.
- **Ladders** are weekly Swiss and then elimination events, reusing `Swiss.cs` and `League*`, with special prizes: unique gear and cosmetic auras.
- There is no ante in PvP unless a later decision adds it.

---

## Milestones (each ends tested, pushed and merged)

| # | Milestone | Where | Done when |
|---|---|---|---|
| 0 | The fork, the design docs (`realms/docs/design.md` = Part A, `tech.md` = Part B), and a spike of the two-layer page | fork | three.js and Uno layers swap on one page; `realmBridge` round-trips |
| 1 | Per-player setup and Vanguard objects (B2.1–2) | upstream | scenarios for life, hand sizes and command objects; `test.cmd` passes |
| 2 | The WASM engine and `?local` bot play (B2.3–4) | upstream | determinism check passes; a whole bot game in a browser with no server |
| 3 | Data pipelines (B7) and the Dominaria card import (B2.5), continuing in parallel | fork + upstream | prices and pools generated; card imports keep landing |
| 4 | `realms-gear`: about 25 effect families, the generator, scenarios | fork | every family and item covered and passing |
| 5 | The realm server (B4): accounts, collection, decks, ante, gear, vendors, encounters, replay check, loot, presence | fork | server tests pass (B10) |
| 6 | The overworld (B5): renderer, maps, movement, mobs, world map, HUD, map editor | fork | you can walk Dominaria and see other players |
| 7 | Card screens in `?realm` (B6): duel, spell table, vendor, loot, gear | fork | the whole loop plays end to end in a browser |
| 8 | Content: 50 maps, 60 mobs and decks, 5 dungeons with bosses plus the capstone, 255 gear items, vendors, quests, story text, models, audio | fork | content lint passes; every mob deck is legal and plays in the bot lab |
| 9 | Balance and economy: balance lab, economy simulation, difficulty tuning | fork | gear costs fitted; vendor purse and stock stay steady in the simulation |
| 10 | Deployment (B8): image, compose, CI/CD, CDN, then a closed beta | fork | it runs at the chosen host and domain, deployed by CI |
| 11 | PvP duel zone and ladders (B9) | fork | arena tables and ladder events run |

The work runs through the existing worktree pool and agents: card agents for B2.5, and separate agents for the server, the overworld, the card screens and content. Each piece lands on its repository's `main` and is pushed right away.

### C5. The balance lab (milestone 9)
- **Gear costs:** `tools/realms/balance.cmd` uses `Cantrip.BotLab` to run tactical-vs-tactical games on reference mob decks, with and without each item, spread over the worker pool (`tools\cantrip-workers.cmd`). Each effect's cost is fitted to the change in log-odds of winning.
- **Economy:** an agent-based simulation of N players farming, selling and buying checks the trickle, rotation and purse limits.

---

## B10. Verification
- **Engine (upstream):**
  - Run `tools\test.cmd` for core and host changes; the Rust workspace includes the new scenarios.
  - Run the WASM-versus-native determinism check over bench games and the scenario corpus.
- **Gear:** `realms` scenarios for every family and item, through the corpus runner on the fork's card table, and coverage of the gear crate.
- **Server:** xUnit tests for these areas.

  | Area | What the tests cover |
  |---|---|
  | Pricing | the price formula |
  | Loot | the cap and the subset choice; the empty ante |
  | Losing | losing an ante card; the nearest inn |
  | Vendors | buy and sell atomicity; a purse too small; a full stock; trickle and rotation on a fake `TimeProvider` |
  | Encounters | spawn-table validation against the golden vectors; a tampered log rejected; a mob answer that doesn't match rejected |
  | Duels | a duel left unfinished becomes a loss |
  | Persistence | storage round-trips |

- **Overworld:** vitest for hex math, A*, spawn generation (the same golden vectors as the server), path validation and the bridge.
- **Browser end to end:** Playwright in a new `Cantrip.Realms.Web.Tests`, driving `realmTest` and `cantripTest` with real clicks.
  - The flow: create a character → walk → engage a mob → the duel → the loot pick → a vendor sale → spell table edits → a loss returns you to the inn.
  - The duel is forced with a `.cantrip` scenario, never a seed hunt.
  - Two browser contexts see each other move and change gear.
  - Screenshot checks of the world rendering.
- **Load:** headless presence bots (200 clients) against the WebSocket relay.
- **Deployment:**
  - The compose stack runs locally from the published image.
  - A staging environment is deployed by CI, with `/healthz` checked and one rollback to the previous image exercised.
  - Migrations are applied to a copy of the database.
  - A by-hand play-through on the live domain.
