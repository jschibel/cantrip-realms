# Cantrip Realms - technical design

How the game in `design.md` is built, tested and deployed, and the order it is built in.



### B1. The repository
- **Setup:**
  1. `gh repo fork cantrip-rs/cantrip-rs --fork-name cantrip-realms` under jschibel.
  2. In the local clone, add the remote `upstream` = cantrip-rs.
  3. Merge upstream `main` into the fork's `main` regularly, through `tools/realms/sync-upstream.cmd`.
- **Layout:** the fork adds `realms/` (game code and content) and a few project heads. It touches upstream files only at documented seams, to keep merges clean. CLAUDE.md gets a Realms section. The one seam inside the engine's folders is new files only: the gear's card files and test in `crates/cantrip-cards` and its scenarios `scenarios/realm-gear-*` (B3), which an upstream merge never meets.

### B2. What is upstream, and what never goes there
cantrip-rs is only for playing Magic in a browser and for training AI. Nothing of this game's design or code goes there.
The only changes allowed upstream are generic hooks that make our cards (and cards like them) function and don't affect
the engine's performance, each decided by the owner. Everything else lives in this fork only. Two such hooks are upstream,
and this fork has them by the sync:

1. **A variant's start for each seat** (cantrip-rs `ac0ed3f5e`): `Setup::variant` / `SeatVariant`, and the host's
   `NewGame` seat fields `StartingLife`, `StartingHandSize`, `MaximumHandSize` and `Emblems` (docs/host-protocol.md). A
   seat's starting life (CR 103.4), its starting hand size, drawn for the opening hand and each mulligan (CR 103.5a), its
   maximum hand size before any effect (CR 402.2, 902.5b), and the emblems it begins the game with in its command zone
   (CR 902.3, 114.4). It is CR 902-style Vanguard support, and the hook gear rides on. C#: `RulesSeat.Variant`.
   Scenarios: the `[Variant]` section.
2. **The engine in the browser** (cantrip-rs `9e1edf71d`): `crates/cantrip-wasm`, a WebAssembly module with no imports
   serving the host's requests (`cantrip_host::serve`), which answers byte for byte as the native host does (all
   28,725 scenarios checked). The web client's `?local` plays the tactical bot on it with no server
   (docs/engine-in-the-browser.md). The realm's duels run on it, and the server replays them on the native host.

**Cards.** The game draws on the cards the trunk has (its own card work goes on there regardless). A card the game
would like that the trunk lacks (a boss's namesake, say) is asked of the owner, never added here or there unasked.

### B3. Gear in the engine (fork: card files of `crates/cantrip-cards`, realms/docs/gear.md)
- **Effect families** are written once in Rust, each a parameterised `const fn` making a command-zone ability from `cantrip-mechanics` and the core's verbs (draw, scry, surveil, tokens, mana, counters, haste, life, prevention, discard, mill), never a new core brick and never in an upstream module: they are `crates/cantrip-cards/src/cards/realm_gear.rs`, a new file of the card crate that defines no card.
- **Item definitions** live in `realms/content/gear/*.json`. `tools/realms/gear-cards.py` generates one card file per item with effects, `realm_gear_<item>.rs`, holding its typeless emblem, and validates each item against its slot's families and its rarity's budget. The card crate's own build script registers them as it registers every card, so the engine's one card table has them: no hook, no second table.
- **The fork's WASM build** (`cantrip-wasm`) and its native **replay verifier** (`cantrip-native-host`) are the stock ones built from the fork, which has the gear's card files.
- **Testing:** every family gets `.cantrip` scenarios over its parameter range, and every item gets a generated smoke scenario, all in the stock corpus (`scenarios/realm-gear-*.cantrip`). Coverage is `tools/realms/gear-coverage.py`, card-coverage.py for the gear. The no-rules-deviation bar applies in full.

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
- **The pixel-art look**, one idea carried through: the world is drawn small and shown in big, clean pixels.
  - Orthographic dimetric isometric camera (2:1), which **snaps to the texel grid**, so nothing shimmers.
  - The scene is drawn to a **low-resolution target**, about 1/3 of device pixels and integer-scaled, then upscaled with
    nearest-neighbor filtering.
  - **Flat cel shading:** two or three light bands per surface, each a palette color (the per-plane palette as a lookup).
    **No dithering**, no noise, no gradients: areas of one color read as areas of one color.
  - **Outlines on what you look at, not on the ground:** characters, mobs, props and buildings have a 1-pixel dark outline,
    and terrain has none (its hexes join without seams, and height steps show by their side faces' darker band).
  - **Characters stand out:** they are drawn larger than life against the scenery, in saturated identity colors that the
    terrain palette doesn't use, with a clear silhouette and a soft ring on the ground under the player. They are never
    lost in the scene.
  - Effects are billboards at the same pixel scale.
  - Where it lives: the cel materials, light and band thresholds in `src/look.ts`, the ramps in `src/palette.ts`, the
    post pass (bands to colors, outlines) in `src/render.ts`. Two choices are left open for comparing on any page:
    `?bands=2` (lit and shade only) and `?outline=ramp` (outlines in the darkest of the outlined thing's own ramp).
- **Assets:** **voxel models stored as data** (`realms/content/models/*.vox.json`), written by generator scripts and tuned by hand.
  - The browser greedy-meshes them when they load (`src/voxel/mesher.ts`) into vertex-colored meshes in the palette's colors, shared between every character drawn alike; they are small enough that no build step is needed.
  - Characters are segmented rigs (head, torso, arms, legs) with idle, walk, cast and interact animations. Each slot's gear is a voxel piece hung on an attachment point of the body. Mobs are base models with palette swaps (ten so far).
  - Audio: CC0 chiptune tracks and SFX generated with jsfxr.
- **The world:** one connected map streamed in 32-by-32 chunks (interfaces.md, "The world, interiors and dungeons"),
  made offline by a seeded generator with hand-placed set pieces (`scripts/world.ts`) from the geography in
  `realms/content/dominaria/layout.json`, checked in, and linted. Nobody edits the map in the game: there is no map
  editor, for players or for admins. Chunks near the player are built (a prism per hex, the scenery merged per chunk,
  each building apart so one between the camera and the player is cut away) and those far away are dropped; paths are
  found over the loaded chunks, a bounded search. Ferries cross to the far isles along open lanes over the water.
- **The tier zones are shown:** the regional map (the minimap, opening to the whole world's) tints and borders each
  zone in its tier's color with a legend, and marks the towns, dungeons and mage towers with their tiers, attuned
  waystones lit; waymarkers in the tier's color and number stand where it rises; the HUD names the area and its tier,
  and says so on crossing into a harder one; a wanderer under the pointer shows its name and tier.
- **Traders from other planes:** the overworld asks `GET /api/travelers` now and then, and stands each trader's caravan
  at their town's pitch while they are in town; the HUD says so on coming into the town.
- **Interiors:** a door's interior is its own scene. Entering is seamless: the door opens, the camera eases in, the
  world fades behind a short iris and the room fades in around the player at its door (about 400 ms in all, never a
  loading screen; the next interiors near the player are built ahead). Leaving reverses it.
- **Dungeons:** generated in the browser from the run's seed (`src/dungeon/`), one generator per theme, exactly the
  encounters the server's run names (interfaces.md). Single-player, never replicated.
- **Play:** click-to-move with A* over hexes; local mob AI (wander, chase); doors, entrances and stairs; the waystones of attuned mage towers; NPC interaction; the HUD and minimap; and other players near you animated from relayed paths.
- **The HUD and menus that show no cards** are DOM and CSS built on **the client's Theme tokens and fonts**. A script generates `theme.css` from `Theme.cs`, so the two can't drift.
- **Without a server:** `?offline` (or no `?server=` / `VITE_REALM_SERVER`) plays the whole overworld against `MockApi`, the API in memory, with presence passed between the browser's own tabs; the card layer's stand-in panels (`?cards=stub`, the offline default) answer its screens. `?at=` (`world:q,r`, a town, an interior or a dungeon), `?now=`, `?wander=0`, `?mobs=0` and `?attuned=` force a state for tests and development (src/main.ts).
- **Test hooks:** `?test` publishes `globalThis.realmTest`, the screen position of every entity and control by name, the way `cantripTest` does. `npm test` runs vitest; `npm run e2e` runs the Playwright suite (`e2e/`) against the offline overworld with real clicks. `npm run e2e:server` runs `e2e/server/` against the real realm server on the generated world instead: it starts `Cantrip.Realms.Server` with the development sign-in on a fresh SQLite file and the overworld across origins (`?server=`), signs in, makes a character, walks New Benalia's streets, goes into a shop and asks for its vendor's screen, starts a world encounter through the API (the card layer's stand-in records the duel), enters a dungeon run and takes its stair once the warden is beaten, attunes two mage towers by beating their mages and travels between their waystones, has two players see each other walk in the world and in an inn, and plays a duel in the real card layer whose log the server replays on the native host. A test starts its character where it needs to be and has the server count the stand-in's wins through the development server's test-only calls (`POST /dev/place`, `/dev/verdict`, interfaces.md); everything else is walked and clicked.

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
- `card-economy.py`: Scryfall default-cards bulk → the realm's card database, `realms/content/cards.json`: per card the engine has, its origin plane, the planes and sets it was printed in, its median paper price, rarity and list price, its Vintage legality, identity and types, and its Universes Beyond and relic flags (interfaces.md, "Cards, planes and pools"); the pools are views of it. It is run monthly and committed.
- `planes.json`: set code → plane (Dominaria = Alpha through Mirage-era core, Ice Age, Weatherlight, Urza's, Invasion, Odyssey, Onslaught, Time Spiral, DOM, DMU, DMR, BRO…), with Universes Beyond excluded by Scryfall's set and printing data.
- The pools (implemented ∩ Vintage-legal ∩ not UB ∩ priced ∩ no relic, by plane, and the off-plane pool) are views of `cards.json`, computed by the server as it loads and by the tools the same way (`tools/realms/realm_cards.py`); `card-economy.py --check` holds the file to the engine's cards.
- Mob decks: `decks/realms/dominaria/*.txt`, as plain decklists. A drafting tool built on `DeckBuilder` drafts each from a themed pool, then they are tuned by hand.

### B8. Deployment (provider-neutral, separate from cantrip-rs.dev)
- **One container image:** `realms/deploy/Dockerfile` is a multi-stage build.
  - A Rust stage builds the native replay verifier, `cantrip-native-host` built from the fork (its card table has the gear), for linux-x64 and linux-arm64.
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
| 1 | Per-player setup and Vanguard objects (B2.1) | upstream (a generic hook) | scenarios for life, hand sizes and command objects; `test.cmd` passes |
| 2 | The WASM engine and `?local` bot play (B2.2) | upstream (the owner's call) | determinism check passes; a whole bot game in a browser with no server |
| 3 | Data pipelines (B7); the game draws on the cards the trunk has | fork | prices and pools generated |
| 4 | Gear in the engine (B3): the effect families, the generator, scenarios | fork | every family and item covered and passing |
| 5 | The realm server (B4): accounts, collection, decks, ante, gear, vendors, encounters, replay check, loot, presence | fork | server tests pass (B10) |
| 6 | The overworld (B5): renderer, the world, movement, mobs, HUD | fork | you can walk Dominaria and see other players |
| 7 | Card screens in `?realm` (B6): duel, spell table, vendor, loot, gear | fork | the whole loop plays end to end in a browser |
| 8 | Content: 50 maps, 60 mobs and decks, 5 dungeons with bosses plus the capstone, 255 gear items, vendors, quests, story text, models, audio | fork | content lint passes; every mob deck is legal and plays in the bot lab |
| 9 | Balance and economy: balance lab, economy simulation, difficulty tuning | fork | gear costs fitted; vendor purse and stock stay steady in the simulation |
| 10 | Deployment (B8): image, compose, CI/CD, CDN, then a closed beta | fork | it runs at the chosen host and domain, deployed by CI |
| 11 | PvP duel zone and ladders (B9) | fork | arena tables and ladder events run |

The work runs through agents in worktrees of this fork, one per piece (the server, the overworld, gear, the card screens, content), each merged into this fork's `main` and pushed. Nothing of it goes to cantrip-rs (B2).

### C5. The balance lab (milestone 9)
- **Gear costs:** `tools/realms/balance.cmd` uses `Cantrip.BotLab` to run tactical-vs-tactical games on reference mob decks, with and without each item, spread over the worker pool (`tools\cantrip-workers.cmd`). Each effect's cost is fitted to the change in log-odds of winning.
- **Economy:** an agent-based simulation of N players farming, selling and buying checks the trickle, rotation and purse limits.

---

## B10. Verification
- **Engine (the upstream hooks, done):**
  - Run `tools\test.cmd` for core and host changes; the Rust workspace includes the new scenarios.
  - Run the WASM-versus-native determinism check over bench games and the scenario corpus.
- **Gear:** `realm-gear-*` scenarios for every family and item, in the stock corpus (the fork's card table has the gear's card files), coverage of the gear's files (`tools/realms/gear-coverage.py`), and the determinism check over them.
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
