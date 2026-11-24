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
- **The look:** low-poly 3D with textures painted by code (no downloaded assets), drawn small and scaled up in whole
  pixels; light quantized into colored bands (warm sun, cool shade, orange firelight); soft outlines in each object's own
  darkened color; swaying grass; figures leaning back toward the camera as SNES sprites face it.
- **One camera:** three-quarter (pitched 45 degrees, stretched by 1/sin 45 degrees so a floor texel is one scene pixel),
  snapped to whole pixels at rest. Three headings, front and 45 degrees to either side and never further round, so
  nothing is drawn from behind: Q/E or the HUD's turn buttons. Stepped zoom outdoors (whole-number screen-pixel scales
  only; the wheel, +/- or the HUD's buttons); rooms and dungeons stay at the closest step. Where something tall stands
  between the camera and the player, what of it stands in front of them fades (the occluder fade), never over its own
  footprint.
- **Movement:** square tiles, eight-way walking, never cutting a corner past a blocked tile (`world/grid.ts`). Click to
  walk, and hold to keep walking toward the cursor (it re-paths when the cursor is more than 1.25 tiles from the path's
  target, with a 0.1 s cap for slow drift). Doors and gates are entered only by a click, or by holding still on them.
- **The world:** one connected map of the Domains streamed in 32-by-32 chunks (interfaces.md, "The world, interiors and
  dungeons"), made offline by a seeded generator with set pieces in its code (`scripts/worldgen`, `npm run world`) from
  `realms/content/dominaria/layout.json`, checked in, and linted. Nobody edits the map in the game: there is no map
  editor. Chunks near the view are read and built a step at a time (the ground, terrain from heights, the scenery merged
  per chunk) and those far away are dropped; paths are found over the chunks read, a bounded search.
- **The tier zones are shown:** the regional map (the minimap, opening to the whole world's) tints and borders each zone
  in its tier's color with a legend, and marks the towns, dungeons and mage towers with their tiers, attuned waystones
  lit; waymarkers in the tier's color and number stand where it rises; the HUD names the area and its tier, and says so
  on crossing into a harder one; a wanderer under the pointer shows its name and tier.
- **Ferries** cross to the far isles along their lanes: the ferryman offers the crossing, the player rides the lane at a
  walk on the ferry's raft and steps off at the far dock. The lanes are closed to walking otherwise.
- **Traders from other planes:** the overworld asks `GET /api/travelers` now and then, and stands each trader with their
  caravan at their town's pitch while they are in town; the HUD says so on coming into the town.
- **Interiors:** a door's interior is its own place, laid out by the room recipes (`art/rooms`). Entering is seamless:
  the camera eases in, an iris closes on the doorway and opens on the room around the player at its door, never a
  loading screen (the rooms near the player are built ahead). Leaving reverses it.
- **Dungeons:** generated in the browser from the run's seed (`src/dungeon/`), one carver per theme on squares, exactly
  the encounters the server's run names (interfaces.md). A run starts at the floor's `arrive`; stepping onto `up`
  leaves, onto `down` descends once the warden is beaten, onto `wayOut` leaves after the boss (or at once, when the boss
  rests this week and its hall is empty). Single-player, never replicated. A page opened on a character in a live run
  resumes it (`GET /api/dungeon/run`) on the floor reached, its beaten mobs gone. A boss beaten opens its moment over the
  world (`screens/bossBeaten.ts`: the color unlocked, the five pips, the gift, the unique item), and the HUD's pip for
  the color lights.
- **Figures:** the player is `playerFigure(appearance)` (body, palette, identity, the looks of what they wear), other
  players `lookFigure(Look, Identity)` from presence, mobs `mobFigure(model, id, creature)`, NPCs `figureSpec(id,
  palette, seed)`. Figures cast as a duel begins and reach out at vendors and doors.
- **Play:** click-to-move over the grid; local mob AI (wander, chase); doors, entrances and stairs; the waystones of
  attuned mage towers; NPC interaction (spell tables, quest boards, the arena's gate and waystones are things used from
  beside their tile); the HUD and minimap; and other players near you walking the paths the relay sends.
- **The HUD and menus that show no cards** are DOM and CSS built on **the client's Theme tokens and fonts**. A script
  generates `theme.css` from `Theme.cs`, so the two can't drift.
- **Without a server:** `?offline` (or no `?server=` / `VITE_REALM_SERVER`) plays the whole overworld against
  `MockApi`, the API in memory, with presence passed between the browser's own tabs. Its duels are still real games:
  `MockApi` deals them as the server does (`net/mockDuel.ts`: the starter deck of the character's color, the mob's
  themed deck, both seats' stats and gear emblems), the real card layer plays them and offers the loot, and only the
  verdict is taken on trust, there being no server to replay the log; the screens that trade and save through the API
  (spell table, vendors, gear) are the stand-in panels' (`OfflineCardLayer`). The card layer is the real one whenever
  one is built: the dev server serves the web client's built page on a port of its own (its port + 100, or
  `REALM_CARD_LAYER_PORT`; `vite.config.ts`) and says where in a `<meta name="card-layer">`; `?cards=stub` (or
  `REALM_CARD_LAYER=stub`, as the offline suites set) asks for the stand-in panels (`cardStub.ts`). `?at=` (`world:x,z`, a town, an interior or a dungeon),
  `?now=`, `?wander=0`, `?mobs=0`, `?attuned=`, `?heading=`, `?zoom=`, `?still` and `?nohud` force a state for tests and
  development (src/main.ts). `?world=slice|large` plays the art slice's street or the renderer's large synthetic world
  instead of the Domains.
- **Test hooks:** `?test` publishes `globalThis.realmTest`, the screen position of every entity and control by name,
  the way `cantripTest` does (and `sliceTest`, the stage's view for the renderer's suites). `?manual` holds the clock
  until a test advances it: the offline suites never wait on the wall clock. `npm test` runs vitest; `npm run e2e` runs
  the Playwright suite (`e2e/`) against the offline overworld with real clicks; `tour.spec.ts` takes the pictures of the
  Domains (`REALM_TOUR=1` writes `e2e/screenshots/tour`); `occlude.spec.ts` holds the occluder fade and the steady
  view in New Benalia at every heading. `npm run e2e:server` runs `e2e/server/` against the real realm
  server on the generated world instead (the page on its own clock there, as the server times walks by its clock): it
  starts `Cantrip.Realms.Server` with the development sign-in on a fresh SQLite file and the overworld across origins
  (`?server=`), signs in, makes a character, walks New Benalia's streets, goes into a shop and asks for its vendor's
  screen, starts a world encounter through the API (the card layer's stand-in records the duel), enters a dungeon run and
  takes its stair once the warden is beaten, resumes a run after a reload, beats Rofellos (green unlocked, his hall empty
  for the week after; `bosses.spec.ts`) and plays his duel in the real card layer (won from a forced position, lost by
  conceding: the run over, the character at the inn), attunes two mage towers by beating their mages and travels between their
  waystones, has two players see each other walk in the world and in an inn, and plays duels in the real card layer
  whose logs the server replays on the native host: one conceded, and the whole loop won and lost
  (`duel-loop.spec.ts`: the encounter's splash, the game, its end, the server's verdict, then the loot picked within the
  cap and the world resumed, or a card of the ante gone and the character awake at the inn), each a position forced
  through `POST /dev/duel` (a seat beginning at 0 life), never a seed; and an offline duel and its loot in the real card
  layer (`offline-duel.spec.ts`, forced through `realmTest.forceDuel`); and builds a deck and an ante at a spell table in the
  real card layer (the server's refusals shown, the saved deck the one the next duel deals) and buys and sells at a card
  vendor there (`spell-table.spec.ts`). A test starts its character where it needs to be and has the server
  count the stand-in's wins through the development server's test-only calls (`POST /dev/place`, `/dev/verdict`, `/dev/duel`, `/dev/cards`,
  interfaces.md); everything else is walked and clicked. `npm run bench` times the renderer on walks through the
  Domains and the large world (`e2e/bench`). The dev galleries are `gallery.html` (the art library), `rooms.html`
  (rooms and dungeon floors) and `cast.html` (figures).

#### The module layout (`realms/web/src`)

| Module | What it is |
| --- | --- |
| `render/` | the renderer: pixel target and upscale, camera (headings, zoom, texel snapping), band lighting, the edge pass, the ground shader, terrain, grass, shadows, the chunk streamer, the occluder fade, rooms' cut-aways, door transitions, the stage every page runs |
| `art/paint/` | the painting toolkit: pixmaps, ramps and palettes, procedural surface painting, text sprites, the material helpers, the mesh builder |
| `art/recipe.ts` | what every registry is: `Registry`, `Recipe`, `Built` |
| `art/surfaces/` | tiling surfaces by id, per biome |
| `art/props/` | props by id (trees per biome, rocks, fences, lamps, ruins, wares, furniture...) |
| `art/buildings/` | building recipes by style (one per region) and size, with doors and signs |
| `art/rooms/` | room recipes by interior kind, and `layoutRoom` |
| `dungeon/` | the dungeon floors per theme, on squares |
| `art/figures/` | the figure rig, bodies, palettes, gear parts per slot, every creature model, the NPCs |
| `world/` | the world data format (types, loader, lint), the walk grid, and Dominaria's files (`realm.ts`) |
| `game.ts`, `entities.ts`, `input.ts`, `hud.ts`, `screens/`, `net/`, `testHooks.ts` | the game around it |

Each recipe module is a registry: an id maps to a pure function from a recipe and a palette to meshes and materials.
The world data names ids; nothing in the world data is three.js.

#### Module interfaces

##### `render/` (index.ts lists it all)

The world calls the renderer with a scene of chunks, figures, doors and lights:

- `CameraRig(canvas, heading, zoom, framing)` (camera.ts): the view. It owns the `PixelRenderer` (`rig.renderer`) and
  decides what it sees: `heading` (-1, 0, 1) and `zoom` (0-2 steps out), `viewFor(framing)`, `turn(step, framing)` and
  `zoomBy(step, framing)` (false where refused), `stepTurn(dt, framing)` and `stepZoom(dt)` each frame, `halt()` (a
  door's easing takes over), `settled`, `clampFocus(point, framing)`. A `Framing` is what a place says about how it is
  seen: `{inside, turns, bounds}`. The page keeps the heading and zoom between visits; the rig keeps no storage.
- `PixelRenderer` (renderer.ts): draws a `THREE.Scene` small and shows it in whole pixels; `view`, `setView`, `focus`,
  `snap`, `iris` (a doorway's), `fade`, `setEdges`, `toScreen`, `rayAt`, `readFrame`. `View`, `THREE_QUARTER`,
  `blendViews` are in view.ts.
- `Place` (place.ts): one place as drawn - a `scene` with its ground, its scenery merged into a handful of meshes (the
  tall as occluders), its rooms' cut-aways, flipbooks (flames), scrolling materials (water), standing grass and lights. `addGround`, `addPieces(built[],
  name)`, `addLight(spec)`, `addSun(x, z, reach)`, `addGrass(field)`, `addFigure(root)` / `removeFigure(root)`. Each
  frame: `update(time, yaw, toward)` (grass, water, flames and their light, the walls on the camera's side).
- `assembleWorld(world, chunks)` and `assembleInterior(room)` (assemble.ts): the one place world ids meet the art
  registries. A world's loaded chunks become a `Place` and its `doors` (`DoorSpot`: `{tile, step, to, at}`); an interior
  becomes a `Place`, its `doorway` and `bounds`. `assembleWorld` draws given chunks as one place (the cast page, tests); the chunk
  streamer calls the same recipes per chunk.
- `Actor` (actor.ts): a figure walking a grid - `goTo`, `retarget`, `walkTo`, `stopAfterStep`, `update(dt, player)`;
  `behaviourOf(npc.behaviour)` turns the data's behaviour into its own.
- Underneath: `buildGround` (ground.ts: the ground shader over a block of tiles, texels counted from an `anchor` - the
  world's origin - so blocks join without a seam), `grassField` (grass.ts: tufts per tile, visited row by row),
  `lit`/`glow`/`bandShader`/`textureOf` (lighting.ts: the bands), `normalMaterialFor` (edges.ts: the normal pass),
  `sunlight`, `addLight`, `stepFlicker` (lights.ts), `blobShadow` (shadow.ts).

##### `art/paint/` (index.ts lists it all)

`Pixmap`, `seeded`, `hash2` (pixmap.ts); the ramps (`colors.ts`); `Palette`, `Ramp`, `PALETTES`, `namedPalette`,
`withDefaults`, `rampKey`, `paletteKey` (palette.ts); `valueNoise`, `fbm`, `paintCells`, `voronoi`, `jitteredPoints`,
`tuft`, `pebble`, `crack` (procedural.ts); `sprite`, `mirror` (sprite.ts: pixel art as text); the tiling textures
(textures.ts, 64 by 64 = four tiles, seamless, seeded) and pictures of single things (pictures.ts); `material(name,
paint, options)` made once by name, `painted(name, ramp, usual, paint)` named for its ramp when it is not the usual one,
`flat(color)`, and `stock` - the walls, roofs, timber and foliage, those painted from a ramp taking one (materials.ts); `MeshBuilder`
(`box`, `roundedBox`, `gableRoof`, `cylinder`, `ring`, `blob`, `decal`, `card`, `quad`, `polygon`, `at(x, y, z, turn,
draw)`), faces `tiled` (from the world's grid) or `fitted` (one picture), and `Model` - geometry by material in world
coordinates - with `model()`, `add(model)`, `mergeModels`, `meshesOf` (builder.ts).

A palette is ramps by slot name: a recipe declares the slots it reads and their defaults, and a palette given with it
overrides some. A material painted from a ramp must be named for it (`painted` does it), or two palettes would share one
material.

##### The registries (art/recipe.ts)

```ts
type Recipe<R> = (recipe: R, palette: Palette) => Built;
interface Built {
  model: Model;                    // still geometry, world coordinates: merged into the place's scenery
  frames?: Frames[];               // flipbooks: {models, rate}, one shown at a time (flames)
  cutaways?: Cutaway[];            // {full, low, when: {camera: "east" | "west"}}: a room's side walls
  footprints?: Rect[];             // the ground it stands solid on, which the occluder fade never fades over
  lights?: LightSpec[];            // a room's own: hemisphere, directional, or the data's point and spot
  doorway?: XYZ;                   // buildings and rooms: where the iris closes
  bounds?: Rect;                   // rooms: the ground the camera keeps to
}
class Registry<R> { define(id, about, recipe, palette?, check?); has(id); get(id); ids(); build(id, recipe, palette?); problems(id, recipe) }
```

- `PROPS: Registry<PropData>` (art/props): `drawn(id, about, (builder, prop, palette) => extras, palette?, check?)` is the
  usual way to define one; `num`, `bool`, `str`, `point`, `turnOf`, `needs` read and check `args`. The drawing kit is
  `art/props/draw.ts`. Ids so far - outdoors: `barrel`, `crate`, `sack`, `pot`, `lamp-post`, `bench`, `market-stall`,
  `fountain`, `gravestone`, `railings`, `hedge-wall`, `tree`, `bush`, `hedgerow`, `boulder`, `stepping-stone`,
  `town-wall` (a gate between towers), `bridge`, `terrace`, `ruined-tower`; indoors: `hearth` (flames), `candle`, `skull`,
  `bookshelf`, `back-window`, `poster`, `blade-rack`, `shield`, `shop-counter`, `scales`, `coins`, `ledger`,
  `card-table`, `stool`, `rug`, `ossuary`, `buttress`, `tattered-banner`, `torch` (flames), `cobweb`, `crypt-pillar`,
  `fallen-drum`, `crypt-dais`, `brazier` (flames), `candles`, `coffin`, `bones`, `rubble`. Each entry's `about` says
  where its anchor is and what its `args` are.
- `BUILDINGS: Registry<BuildingData>` by style (art/buildings): `benalish` (kinds `house`, `shop` - `params`: `ground`,
  `upper`, `roof` tile|slate, `rise`, `chimney`, `wall` limestone|plaster, `openings` [{at, kind: door, shopDoor, window,
  windowUp, display, banner, bannerUp, sign, lamp}] - and `mausoleum`). `placeBuilding(building, draw)` lays a style's
  drawing (facing south on its footprint) out at the building's `rot`, its doorway turned with it.
- `ROOMS: Registry<InteriorData>` by interior kind (art/rooms): `shop`, `inn`, `guildhall`, `temple`, `smithy`,
  `library`, `house`, `tower`, `exotic-wares`, `crypt` ("Rooms and dungeons" below). `roomShell(builder, spec)` draws the
  back and front walls and returns the side walls as camera cut-aways; `exitGap(entry.x)` is the exit's two-tile gap.
- `SURFACES` (art/surfaces): `defineSurface(id, about, palette, (palette) => {picture, priority, hole?, under?,
  tufts?})`; `SURFACES.look(id, palette?)`. Ids: `grass` (tufts 3), `cobbles`, `flagstones`, `dirt`, `straw`,
  `furrows`, `wheat`, `stream` (a hole, water under), `floorboards`, `hearthstone`, `crypt-floor`.
- `FIGURES` (art/figures): `defineFigure(id, about, palette, (palette, seed) => FigureSpec, seeded?)`;
  `figureSpec(id, palette?, seed?)`. Ids: the slice's `hero`, `knight`, `grizzlegom`, `goblin`, `skeleton`, `ghoul`,
  `townswoman`, and (seeded) `townsfolk-<region>` and `guard-<region>` for `benalia`, `orvada`, `caligo`, `keld`,
  `llanowar`, `shopkeeper`, `innkeeper`, `ferryman`, `planar-trader`. Mobs, players and gear are their own registries
  beside it (see "Characters" below).

##### Figure specs (art/figures/rig.ts)

A `FigureSpec` is `{name, parts: PartSpec[], stride?, armSwing?, hunch?}`. A `PartSpec` is a box of `size` texels
`[w, h, d]` on a pivot `at` (texels, on its `parent` part or the body), the box at `box` from the pivot, its six faces
painted (`faces`: `front`, `back`, `left`, `right`, `top`, `bottom`, each a `Paint` - `(pixmap) => void` - unpainted
faces filled with `fill`), with an optional fixed `tilt`, `round`ing and head `shape`. Every rig has `leg.l`, `leg.r`,
`torso`, `arm.l`, `arm.r` and `head` (the walk swings them; `cape`, `ear.l`, `ear.r` move too). `new Figure(spec)`
packs the faces into one picture per spec `name` (its material: a palette's look needs its own name, which `figureSpec`
gives it), and animates with `update(dt, speed)`, `face(dx, dz)` and `setLean(angle, pitch, yaw)`. Painting helpers are
faces.ts (`cloth`, `layer`, `rows`, `stamp`, `hairRows`, `hairAll`, `hairCrown`, `spikes`); the cast is cast.ts. Colors
`GHOUL_EYE` and `BONE_EYE` glow wherever painted.

##### `world/` (three-free)

- format.ts: the version-2 types below, and `chunkOf`, `chunkKey`, `parseChunkKey`, `worldRect`, `viewBounds`,
  `chunksOver`, `chunkTile`, `interiorArea`, `interiorTile`, `heightOf`, `isBlocked`, `isBare`, `frontStep`; and (phase
  2, World) `areaAt`, `tierAt` (a tile's tier zone and tier), `inTown`, `townAt` (a town is the square of tiles within
  its `radius` of its `center` along x and z).
- load.ts: a `WorldSource` (`globSource` over Vite's `import.meta.glob`, or `fetchSource(baseUrl)`), `loadWorld`,
  `loadChunk`, `loadChunks(source, world, rect?)`, `loadAllChunks`, `loadInterior` - each file checked as it comes, a bad
  one a `WorldFormatError` - and the walkable `Grid`s: `gridOfWorld(world, chunks)`, `gridOfInterior(room)`, and (phase
  2) `gridOfChunks(world, chunks)`, a grid over only the rectangle the loaded chunks cover, so a walk crosses chunk edges
  as one ground without a grid the size of the world (the chunk manager remakes it as chunks come and go).
- lint.ts: per file, `checkWorld`, `checkChunk`, `checkInterior`; the whole, `lintWorld(world, chunks, interiors,
  known?)`, with `known` the art's ids (and its props' and buildings' own checks) so the lint stays three-free.
  art/registries.test.ts builds `known` from the registries and lints the sample with it. `known.onUnknown(kind, id,
  where)`, given, takes an id the art does not have instead of its being a problem (while the art is built beside the
  world). The realm, `lintRealm(world, chunks, interiors, dungeons, {known, tiers})`: `lintWorld` and the
  whole world as the game plays it - walked whole from the first inn (eight ways, no corner cut), everything stood on
  open and reached, the rest reached beside, interiors in the towns their doors stand in, entrances and dungeons where
  world.json says with spell tables and waystones beside them and an open step out, spawns of their zone's tier and their
  mobs', tiers growing with distance, waymarkers at rises, ferry lanes walks from dock to dock with ferrymen, pitches open
  in their towns, spell tables spell-table NPCs. src/world/dominaria.test.ts runs it on Dominaria.
- grid.ts: `Grid`, the square A* (eight ways, never cutting a blocked corner), with `setWalkable`, `setHeight`,
  `raise`, `block`, `heightAt`, `walkable`, `path`.

#### The renderer at world scale

What the renderer does with the interfaces above at the scale of the whole world.

- **The stage** (`render/stage.ts`) is the frame every page runs, the slice's and the game's alike: the `CameraRig`, the
  `Spot` the player is in (a `Framing` with its `place`, `grid`, `doors`, `actors`, `start`, optional `floorAt` and
  `streamer`), walking and doors (`clickTile`, `startDoor`, `arrive`; the slice's iris and camera easing; `Spots.through`
  says where a door leads, and may answer a promise - the iris stays shut until it settles, and opens back on the place
  if it fails), `pick` / `floorTileAt` / `pickFigure`, `tick(dt)` and `render()`. The page hooks `intercept` (a click on
  a person, a chest), `onArrive`, `onTile`, `beforeTick`. `WalkInput` (`render/pointer.ts`) is click and hold-to-walk.
- **The world** is a `StreamedWorld` (`render/spots.ts`): its chunks read and built round the view by the
  `ChunkStreamer` (`render/chunks.ts`) - read within the view's reach plus 30 tiles, built within it plus 6 once their
  eight neighbours are read, dropped past it plus 26 - each chunk a `Section` of the place, built a step at a time
  (`buildChunk`, a generator: the ground, the banks and water, recipes time-sliced at 2.5 ms, a merge per group, the
  grass), at most 4 ms a frame (or 3 steps a frame on a manual clock). The walk grid is a window over the chunks read,
  remade as they come and go, so a path is a bounded search; `onGrid` / the stage hand it to every actor. A chunk's
  ground map carries a border of its neighbours' tiles, so it joins them without a seam. `WorldPlaces` gives the rooms:
  each read as soon as its chunk is built, built ahead while the player is within 14 tiles of its door (one a half
  second), the last ten kept; `extra` resolves the page's own ways (a dungeon's entrance, a run's stairs).
- **Terrain** (`render/terrain.ts`): each tile's floor at its height; where a tile's edge stands above its neighbour's,
  a face of rock down to it (a surface's look may name its own bank material as an optional `cliff`; else
  `bank-rock`); a **ramp** tile (flag `RAMP` = 4, the one format addition: `world/format.ts` and the lint accept it)
  slopes along the axis its neighbours differ most on, from the level on one side to the level on the other, half-way to
  a ramp neighbour, so a run of ramps is one even slope. `floorAt(x, z)` is the surface anywhere; figures and grass stand
  on it. Terrain ground is outlined where a terrace's edge stands in front of lower ground (normal-pass kind 0.875). For
  the generator: hills as terraces of whole texels (12 is a good step), banks a tile apart, ramps in straight runs; a
  terrace's rim is best blocked except where a ramp meets it (the grid does not know edges). Rooms are still drawn level.
- **The occluder fade** (`render/occlude.ts`), the one way of seeing past scenery out of doors: tall scenery (anything
  over 1.6 high: buildings, trees, walls) is merged with each thing's id, foot and footprints (`Built.footprints`; by
  default the rectangle its lowest parts stand on) on its vertices. Each frame five rays from the player's figure
  toward the camera are tried against the occluders' boxes, then their triangles; the ones met fade - where they stand
  in front of the player (nearer the camera than their figure along its heading), never behind them: so a shop's
  awning over the player fades while its wall behind them and its far side stay solid. Of what stands in front, what
  covers the player's figure on the screen fades, whatever it is; and what hides the ground within 2 tiles of their feet
  (then fading out over three quarters of a tile) outside the occluder's own footprints as the camera sees it - a window
  in the roof of the house they stand behind, the ground under a building never shown. From a pixel past an edge it
  fades over 7 scene pixels to 25%. The color and normal passes drop what fades; a third pass draws only the fading
  parts of those occluders into a target of its own (the nearest at each pixel, with its alpha), and the post pass lays
  it over the scene, judging outlines as if it were there so the fade's start is not outlined. A faded occluder still
  casts its whole shadow. A gatehouse stands on its two towers, so its arch fades over its passage. Off indoors.
- **Shadows** follow the camera: the sun's shadow camera is fitted to the view's ground at its heading and zoom (plus 5
  past its edges, 6 high), 2048 square (the all-at-once `assembleWorld` keeps 4096); it stays put until the focus is 2
  tiles from it, then moves to it in whole texels along the sun's axes. Every lit material casts from both its faces
  (`shadowSide`): a roof, an awning or a gable is a single face, and three draws only back faces into a shadow map by
  default, so a house's shadow was its walls' alone, with light through every seam between its parts; the bias and a
  normal bias of 0.04 keep a lit face off its own depth. **Lights** of the chunks (fires, lamps) go to a pool of eight
  point lights given to the nearest each frame, so streaming never changes the shaders' light count.
- **A steady view:** the color, normal and fading passes draw a frame 32 scene pixels wider than the view on every side
  (`render/renderer.ts`, `place`), and the post pass shows the view's part of it. While the camera follows the player
  it stays where it is and only that window moves, by whole pixels, so the scene is drawn exactly as it was; it is
  placed again when the view would leave the margin, turns, zooms or glides. Moving the camera by whole pixels instead
  rounded the world's large coordinates differently at each step, and the edges and texel borders that run within a
  hundredth of a pixel of the pixels' centres - a roof's eave or a row of its tiles at a turned heading, which run along
  a diagonal of them - came and went: roof lines flickered as the player walked. The shadow map holding still (above)
  does the same for the shadows' edges. `scenePixel` says where a point is in the view.
- **The far zoom** (step 2) leaves out small props (no more than 1.05 by 1.05 by 1.35) and standing grass.
- **Merging:** each chunk's scenery is sorted into tall (occluders), small (detail) and the rest, each merged by material
  straight into typed arrays; a kind over 24,000 triangles (a forest) is merged in 16-tile cells so the view culls it
  finely.
- **The benchmark** (`npm run bench`, `e2e/bench`): a scripted walk through the large synthetic world's town and
  forest at 1080p on the manual clock, every frame timed to `gl.finish`, streaming on its real budget. On the RTX 4080
  of the machine it was written on (ANGLE/D3D11): mean frame 0.7-1.6 ms, p99 1.4-8 ms, one frame in about 14,000 over
  16.7 ms (a first-time building's paint); 170-730 draw calls a frame over all passes (shadow, color, normals, post);
  155k-330k triangles in town, 1.9M (closest) to 3.5M (furthest) in the dense forest, whose trees are ~650 triangles
  each. No integrated GPU was at hand: the forest's triangle count is the number to watch on one (cheaper trees, or a
  far-zoom tree, would be the Art library's lever).
- **Fixtures:** `fixtures/large-world/source.ts` is an 8 by 8 chunk synthetic world as a `WorldSource` (a dense town
  with shops and rooms, a forest, terraced hills with ramps, a lake, fields, roads, townsfolk, lamps, spawns), for the
  renderer's tests and benchmark: the game page's `?world=large`.
- **The game page** (`index.html`, `src/main.ts`, `game.ts`, `entities.ts`, `input.ts`, `testHooks.ts`) runs on the
  stage over the generated Domains (`world/realm.ts`), or `?world=slice` / `?world=large` for tests. Positions are
  `{Space, X, Z}`, presence paths `[x, z]` from the open tile the player stands on along the grid's path, speeds at most
  5 tiles a second, nearness Chebyshev. The minimap is the regional map in the world and the place's tiles in a room
  or a run (`Hud.drawMap`, `Hud.drawSquares`). Dungeon runs are the floors of `dungeon/` (`Overworld.floors`), the
  dungeons the world's `dungeons/<id>.json` (`Overworld.dungeons`). `realmTest` publishes tiles as `{x, z}`.

#### Adding to the art

- **A surface:** paint its picture in `art/paint/textures.ts` (64 by 64, seamless, seeded), then `defineSurface` it in
  `art/surfaces/index.ts` with the ramps it paints from as its palette and a `priority` among its likely neighbours
  (the higher grows over the lower: grass over paths over cobbles over flagstones; a room's floors alike). Give it
  `tufts` if grass stands on it, `hole` and `under` if it is water.
- **A prop:** draw it in `art/props/draw.ts` (or beside its definition) on a `MeshBuilder` in world units, then
  `drawn(id, about, draw, palette?, needs({...}))` it in `art/props/outdoors.ts` or `indoors.ts` (or a new file imported
  by `art/props/index.ts`). Read its `args` with `num`, `bool`, `str`, `point`; return `{frames}` for flames,
  `{footprints}` where what it stands solid on is not the rectangle under its lowest parts (a gate's towers). Draw in world coordinates (tiled faces follow the world's
  grid); turn with `b.at(x, y, z, turnOf(prop), ...)`.
- **A building style:** a file in `art/buildings/` defining `BUILDINGS.define(style, about, recipe, palette)`, drawing
  each `kind` it knows facing south on its footprint through `placeBuilding` and returning the door's point. Its
  `params` are documented in its `about`. Import it from `art/buildings/index.ts`.
- **A room:** a file in `art/rooms/` defining `ROOMS.define(kind, ...)`: the shell with `roomShell` (or its own walls,
  its side walls as camera cut-aways), its own light (a fill, a sky), `doorway` and `bounds`. The furniture is props
  (`indoors.ts`), the fires' light the interior's `lights`. Import it from `art/rooms/index.ts`.
- **A figure:** a function of a palette in `art/figures/cast.ts` (or a file of its own) returning a `FigureSpec`, then
  `defineFigure(id, about, palette, spec)` in `art/figures/index.ts`. Most are a `Person` (person.ts) - a description
  of build, skin, hair, headgear, clothes and what is held - rather than parts by hand.
- **A mob mesh:** `defineMob({id, about, slots, palette, build})` in `art/figures/mobs-people.ts`, `mobs-beasts.ts` or
  `bosses.ts`; add its id to `RealmContent.MobMeshes` (the server) and to interfaces.md "Models". `npm test` builds every
  mesh at several sizes and every mob of the content in its own colors.
- **A gear part:** `define({id, about, slot, palette, wear})` in `art/figures/gear.ts`, `wear` changing the wearer's
  description; interfaces.md "Models" lists them.
- **A palette:** add it to `PALETTES` (`art/paint/palette.ts`) by name; the world data names it.
- Every id the sample world names must lint: `npm test` runs `art/registries.test.ts` (the lint with the art's ids) and
  `world/world2.test.ts` (the format, the loader, the sample).

#### The art library

What the world generator places and the renderer draws. Every id below is in a registry; `realms/web/gallery.html` (dev
only: `npm run dev`, then `/gallery.html`) shows them all on boards at the three headings and every zoom step, and its
pictures are in `realms/web/e2e/screenshots/art/`. `npx vite-node scripts/art-ids.ts` reprints the tables of "Art ids"
from the registries; `src/art/library.test.ts` builds every id from its own example at every heading.

##### What the world generator relies on

- **Its ids** (scripts/worldgen/ids.ts) are all the art's now, under the same names: surfaces `meadow`, `forest-floor`,
  `moss`, `mud`, `bog`, `snow`, `ice`, `tundra`, `rock`, `scree`, `sand`, `sea`, `shallows`, `lava`, `ash`,
  `cracked-earth`, `road`, `planks`, `phyrexian-ground`; styles `llanowar`, `urborg` (the Morass's, also `morass`),
  `keldon`, `tolarian`, each with every kind it asks for (`barn` draws as `warehouse`; `tenement` where a style has none
  draws as `house`); props `pine`, `dead-tree`, `great-tree`, `swamp-tree`, `mushroom`, `reeds`, `ice-rock`, `crystal`,
  `stump`, `ruined-wall`, `wall-run`, `wall-tower`, `gatehouse`, `statue` (`args.size`), `well`, `giant-tree`
  (`args.size`), `quest-board`, `spell-table`, `waystone`, `arena-gate`, `ferry-post`, `pier`, `cave-mouth`,
  `castle-gate`, `mage-tower`, `crypt-door`, `root-hollow`, `foundry-gate`, `phyrexian-portal` (each over `args.w` by
  `args.d` from its corner, facing `rot`, its door the front's middle), `flower-bed`, `fence-run`, `hay-bale`,
  `wood-pile`, `tent`. `wall-run`, `wall-tower` and `gatehouse` draw in `args.style`'s walls (`args.kind` palisade or
  hedge draws those for a run). The indoor ones (`bed`, `altar`, `pew`, `forge`, `stump-anvil`...) are the rooms'
  (below); `anvil` here is an outdoor one.
- **Surfaces** meet by `priority` (biomes.ts's ladder): waters -1 (holes), paving 0, cobbles 1, fields 2 (all equal, so
  fields meet in straight seams), tracks 3, bare stone and sand 3.3-4.4, forest floor 4.8, grass 5-5.5, snow 6, ash
  6.5, Phyrexian ground 7. Lay a biome's surfaces as `SURFACE_GROUPS` lists them.
- **Props** stand where `tilesOf(prop)` says: mark those tiles blocked when `blocks`, and bare (flag 2) under trees,
  rocks and anything solid. Footprints are about the anchor (trees, rocks: the trunk's or the lump's middle); line props
  run from (x, z) to `args.to`, area props cover (x, z) to `args.to`. `town-wall`'s gate and a `fence-gate` are to be
  left walkable. Each catalogue entry's `biomes` says where it belongs and `sample` is a working example of its args.
- **Lights:** a prop's recipe makes no light. Lit props (`torch-post`, `fire-bowl`, `campfire`, `lantern-post`,
  `lamp-post`, `waystone`) carry `light` in the catalogue - add it to the chunk's `lights` at the prop's anchor plus
  `light.at` (turned with the prop).
- **Buildings:** `style` one of the eight below, `kind` one of its kinds (default `house`), footprint `w` x `d` as the
  showcase sizes recommend (any size draws). The front faces `rot` 0 (south); rot 1 and 3 are fine; rot 2 shows its back
  (plainer) to the camera, so prefer fronts toward the camera or the sides. The door tile is in front of the door's middle
  (`params.doorAt`, tiles from the west end, else the front's middle; the Vess `manor`'s door is at its court's back
  wall, its tile inside the court, the court walkable). Gatehouses (and the Phyrexian `portal`) have a walkable passage,
  the middle 2 tiles of their width, front to back. `wall` runs along its footprint's longer side.
- Shops' signs show `params.trade` (weapons, armor, potions, magic, books, food, bread, drink, inn, smith, cards,
  general, jewels, herbs, fish, tailor, temple, guild, arena, goblin), defaulting by kind (shop general, inn inn,
  smithy smith, library books, temple temple, guildhall guild, tower magic).
- Palettes: a building's `palette` or a prop's `tint` names one of "Named palettes" (a region's dresses any style; a
  biome's recolors trees and stone; `tier-1`..`tier-4` the tier banners).

##### How the renderer draws the art

- **Far stand-ins:** a prop's `Built.far` (when it has one) is drawn at the far zoom step instead of its
  `model` - every tree (`tree`, `oak`, `birch`, `pine`, `snowy-fir`, `giant-tree`, `great-tree`, `elf-tree`,
  `dead-tree`, `mossy-dead-tree`, `cypress`, `swamp-tree`, `palm`, `lush-tree`) and `hedgerow`: the silhouette and the
  painted leaves in 50 to 120 triangles (the "Far" column below says near / far for each). Near, a crown's clumps are
  spheres of 80 triangles (were 180): the slice's `tree` went from 748 to 348, an oak is about 390, a pine 80; the
  giants of Llanowar and Verdura's lush trees stay 650-790 (few of them stand anywhere). Merge `far` per chunk as
  `model` is merged, and switch the group.
- **Banks:** every surface's look carries `cliff` (earth under grass with a fringe of turf, loam under the forest, peat
  in the Morass, granite in the mountains with a fringe of tundra, ice under snow, sand, basalt, masonry under paving,
  Phyrexian metal), a 32-square picture whose top row is the ground's edge.
- **Footprints:** every building (all styles) returns `footprints`, its rectangle - a gatehouse's two, either side of
  its passage (`styled(building, draw, through)`) - for the occluder fade. Nothing is cut away for the player.
- **Flames** (`frames`) come from props (torches, fire bowls, campfires, the foundry's chimney) and from buildings (the
  Keldon inn, temple and smithy, the Llanowar smithy), kept through assembly and merged per chunk, one group a frame.
- **Holes:** `render/ground.ts` gives each tile of a block's map its own surface, priority rank and hole flag, so
  every hole surface (rivers into the sea, lava beside oil) is a gap over its own liquid; a block takes up to 255
  surfaces (the generated world needs at most 12 in a chunk and its border).
- **Tufts:** surfaces with `tufts` grow standing grass, each tile's painted in its surface's `tuftRamp` (plains
  gold-green, marsh reeds, tundra frost; the slice's green elsewhere).
- Scrolling materials (water, lava, oil, the Phyrexian portal's membrane) are marked as the slice's stream is.

##### Art ids

###### Surfaces

| Group | Id (priority; hole; tufts) |
| --- | --- |
| grassland | `grass` (5; tufts 3), `plains` (5.2; tufts 2), `meadow` (5.3; tufts 4), `pasture` (5.1; tufts 1) |
| farmland | `wheat` (2), `furrows` (2), `straw` (2), `crop-rows` (2), `stubble` (2) |
| forest | `forest-floor` (4.8), `leaf-litter` (4.8), `moss` (4.85), `needles` (4.8), `elf-moss` (4.85) |
| swamp | `swamp-mud` (4.2), `mire` (4.25), `mud` (4.25), `marsh` (5.4; tufts 2), `bog` (-1; hole) |
| cold | `tundra` (5.5; tufts 1), `snow` (6), `ice` (3.5), `snow-track` (3.1) |
| mountain | `bedrock` (3.3), `rock` (3.3), `scree` (4.4), `gravel` (1.5) |
| coast | `sand` (4), `wet-sand` (3.8), `shingle` (3.8), `sea` (-1; hole), `shallows` (-1; hole), `ford` (4.6) |
| fire | `ash` (6.5), `basalt` (3.6), `lava` (-1; hole) |
| waste | `waste` (4.1), `cracked-earth` (4.1), `salt-flat` (3.4) |
| phyrexian | `phyrexian-ground` (7), `plating` (0), `oil` (-1; hole) |
| roads | `dirt` (3), `road` (3.08), `cart-track` (3.05), `cobbles` (1), `setts` (1.05), `flagstones` (0), `marble-paving` (0), `mud-track` (3), `boardwalk` (1), `boardwalk-ns` (1), `planks` (1) |
| waters | `stream` (-1; hole), `river` (-1; hole), `lake` (-1; hole), `sea` (-1; hole), `shallows` (-1; hole), `bog` (-1; hole), `lava` (-1; hole), `oil` (-1; hole), `ford` (4.6) |
| indoors | `floorboards` (1), `hearthstone` (2), `crypt-floor` (1) |

###### Props (outdoors)

Far: triangles near / far (Built.far, the far zoom step's stand-in) for the dense vegetation.

Footprint: `WxD` tiles about the anchor (unturned; `rect` offsets where not centred), `line` (x, z to args.to, its width) or `area` (x, z to args.to); **B** blocks walking. `tilesOf(prop)` gives the tiles.

| Category | Id | Footprint | Biomes | Light | Far |
| --- | --- | --- | --- | --- | --- |
| entrance | `cave-mouth` | args.w x args.d from x, z (6x4) **B** | mountain, keld, tundra |  |  |
| entrance | `castle-gate` | args.w x args.d from x, z (9x7) **B** | plains, farmland |  |  |
| entrance | `mage-tower` | args.w x args.d from x, z (6x6) **B** | coast, plains, mountain, any |  |  |
| entrance | `crypt-door` | args.w x args.d from x, z (6x5) **B** | swamp, morass, town, waste |  |  |
| entrance | `root-hollow` | args.w x args.d from x, z (7x5) **B** | llanowar, forest, verdura |  |  |
| entrance | `foundry-gate` | args.w x args.d from x, z (9x6) **B** | mountain, keld, volcanic |  |  |
| entrance | `phyrexian-portal` | args.w x args.d from x, z (8x4) **B** | phyrexian, waste |  |  |
| fence | `fence` | line 0.3 **B** | plains, farmland, town, keld |  |  |
| fence | `picket-fence` | line 0.3 **B** | town, farmland, plains |  |  |
| fence | `wattle-fence` | line 0.3 **B** | farmland, plains, llanowar, swamp |  |  |
| fence | `stone-wall` | line 0.6 **B** | plains, farmland, mountain, tundra, keld |  |  |
| fence | `palisade` | line 0.4 **B** | keld, tundra, forest, swamp |  |  |
| fence | `hedge` | line 0.8 **B** | town, plains, farmland |  |  |
| fence | `fence-gate` | 1.6x0.3 | farmland, plains, town |  |  |
| fence | `railings` | line 0.2 **B** | town |  |  |
| fence | `hedge-wall` | line 0.7 **B** | town, plains |  |  |
| fence | `hedgerow` | line 0.9 **B** | farmland, plains |  | 640 / 160 |
| fence | `town-wall` | line 1.5 **B** | town |  |  |
| fence | `wall-run` | line 1 **B** | town |  |  |
| fence | `wall-tower` | 2x2 **B** | town |  |  |
| fence | `gatehouse` | 7x2 **B** | town |  |  |
| fence | `fence-run` | line 0.3 **B** | farmland, town, plains |  |  |
| goods | `well` | 1.6x1.6 **B** | town, farmland, plains |  |  |
| goods | `cart` | 2.4x1.2 **B** | town, farmland, road |  |  |
| goods | `wagon` | rect [-1.7, -0.75, 1.9, 0.75] **B** | town, farmland, road |  |  |
| goods | `hay-bale` | 1x0.7 **B** | farmland, plains, town |  |  |
| goods | `haystack` | 1.8x1.8 **B** | farmland, plains |  |  |
| goods | `woodpile` | 1.8x0.9 **B** | forest, keld, town, farmland |  |  |
| goods | `trough` | 1.6x0.7 **B** | farmland, town, road |  |  |
| goods | `crate-stack` | 1.6x1.2 **B** | town, coast, road |  |  |
| goods | `barrel` | 0.6x0.6 **B** | town, road, coast |  |  |
| goods | `crate` | 0.75x0.75 **B** | town, road, coast |  |  |
| goods | `sack` | 0.6x0.5 | town, farmland |  |  |
| goods | `pot` | 0.4x0.4 | town |  |  |
| goods | `wood-pile` | 1.8x0.9 **B** | forest, keld, town, farmland |  |  |
| light | `torch-post` | 0.3x0.3 **B** | any | at [0, 2, 0] |  |
| light | `fire-bowl` | 0.8x0.8 **B** | keld, town, waste, volcanic | at [0, 1.4, 0] |  |
| light | `campfire` | 1.2x1.2 **B** | any | at [0, 0.6, 0] |  |
| light | `lantern-post` | 0.3x0.3 **B** | swamp, morass, town, road | at [0.6, 1.8, 0] |  |
| light | `lamp-post` | 0.4x0.4 **B** | town, road | at [0, 2.4, 0] |  |
| mountain | `crag` | 2.4x2.4 **B** | mountain, keld, volcanic, waste |  |  |
| mountain | `cliff` | line 1.2 **B** | mountain, keld, coast |  |  |
| mountain | `mountain` | 10x10 **B** | mountain, keld, tundra |  |  |
| mountain | `terrace` | area | plains, town |  |  |
| phyrexian | `phyrexian-wreck` | 3x2.4 **B** | phyrexian, waste |  |  |
| phyrexian | `phyrexian-spike` | 1x1 **B** | phyrexian, waste |  |  |
| phyrexian | `phyrexian-ribs` | 4x2.4 **B** | phyrexian, waste |  |  |
| phyrexian | `oil-vent` | 1.4x1.4 **B** | phyrexian, waste |  |  |
| plant | `fern` | 0.5x0.5 | forest, llanowar, verdura, swamp |  |  |
| plant | `undergrowth` | 1.5x1.5 **B** | forest, llanowar, verdura |  |  |
| plant | `giant-fern` | 1x1 **B** | verdura, llanowar |  |  |
| plant | `flowering-bush` | 0.8x0.8 **B** | verdura, plains, town |  |  |
| plant | `scrub` | 1x1 | coast, waste, mountain, tundra |  |  |
| plant | `stump` | 0.6x0.6 **B** | forest, plains, llanowar, keld |  |  |
| plant | `log` | 2.2x0.6 **B** | forest, llanowar, swamp, keld |  |  |
| plant | `mushrooms` | 0.6x0.6 | forest, llanowar, swamp, morass |  |  |
| plant | `giant-mushroom` | 1x1 **B** | llanowar, morass |  |  |
| plant | `reeds` | 0.8x0.8 | swamp, morass, coast, plains |  |  |
| plant | `lily-pads` | 1x1 | swamp, plains, verdura |  |  |
| plant | `wildflowers` | 1x1 | plains, farmland, verdura, town |  |  |
| plant | `bush` | 0.8x0.8 **B** | plains, town, forest |  |  |
| plant | `mushroom` | 1x1 **B** | morass, forest, llanowar |  |  |
| plant | `flower-bed` | 1x1 | town, plains |  |  |
| rock | `rock` | 1x1 **B** | any |  |  |
| rock | `rock-pile` | 1x1 | any |  |  |
| rock | `mossy-rock` | 1.2x1.2 **B** | forest, llanowar, swamp, verdura |  |  |
| rock | `snowy-rock` | 1.2x1.2 **B** | tundra, keld, mountain |  |  |
| rock | `standing-stone` | 0.8x0.8 **B** | plains, tundra, keld, mountain, waste |  |  |
| rock | `boulder-field` | area | mountain, tundra, waste, keld |  |  |
| rock | `boulder` | 1x1 **B** | plains, forest, mountain |  |  |
| rock | `ice-rock` | 1.4x1.4 **B** | tundra, keld, coast |  |  |
| rock | `crystal` | 1.2x1.2 **B** | coast, town, mountain | at [0, 1, 0] |  |
| ruin | `ruined-wall` | line 0.8 **B** | plains, waste, forest, mountain, swamp |  |  |
| ruin | `column` | 1x1 **B** | plains, waste, coast, town |  |  |
| ruin | `ruined-arch` | 3.2x0.8 | plains, waste, forest, mountain |  |  |
| ruin | `rubble-heap` | 1.5x1.5 **B** | plains, waste, town, mountain |  |  |
| ruin | `statue` | 1.2x1.2 **B** | town, plains, waste |  |  |
| ruin | `gravestone` | 0.8x0.4 **B** | town, swamp, morass |  |  |
| ruin | `ruined-tower` | 5x5 **B** | plains, waste |  |  |
| sign | `signpost` | 0.3x0.3 **B** | road, any |  |  |
| sign | `waymarker` | 0.8x0.8 **B** | any |  |  |
| sign | `tier-banner` | 0.3x0.3 **B** | road, any |  |  |
| sign | `banner-pole` | 0.3x0.3 **B** | town, road, any |  |  |
| sign | `milestone` | 0.5x0.5 **B** | road |  |  |
| sign | `quest-board` | 1.8x0.5 **B** | town |  |  |
| sign | `waystone` | 1x1 **B** | any | at [0, 2.6, 0] |  |
| street | `canopy-stall` | rect [0, -1.1, 3, 0.4] **B** | town |  |  |
| street | `anvil` | 0.8x0.6 **B** | town, keld |  |  |
| street | `bench` | 1.6x0.5 **B** | town |  |  |
| street | `market-stall` | rect [0, -1, 3.4, 0.35] **B** | town |  |  |
| street | `fountain` | 4x4 **B** | town |  |  |
| street | `spell-table` | 1x1 **B** | town, any | at [0, 1.1, 0] |  |
| street | `arena-gate` | 3x1 **B** | town |  |  |
| travel | `caravan-wagon` | rect [-1.7, -0.8, 1.9, 0.8] **B** | road, town, plains, waste |  |  |
| travel | `caravan` | rect [-1.7, -0.8, 1.9, 2.6] **B** | road, town, plains, waste |  |  |
| travel | `tent` | 2x2.4 **B** | any |  |  |
| travel | `pavilion` | 3.2x3.2 **B** | town, plains, road |  |  |
| tree | `oak` | 0.6x0.6 **B** | plains, farmland, forest, town |  | 392 / 90 |
| tree | `birch` | 0.6x0.6 **B** | plains, forest, tundra |  | 330 / 86 |
| tree | `giant-tree` | 3x3 **B** | llanowar, forest |  | 790 / 96 |
| tree | `great-tree` | 1x1 **B** | llanowar, forest |  | 790 / 96 |
| tree | `elf-tree` | 0.6x0.6 **B** | llanowar |  | 392 / 90 |
| tree | `dead-tree` | 0.6x0.6 **B** | swamp, morass, waste, volcanic |  | 122 / 52 |
| tree | `mossy-dead-tree` | 0.6x0.6 **B** | morass, swamp |  | 132 / 52 |
| tree | `cypress` | 0.6x0.6 **B** | swamp, morass |  | 443 / 121 |
| tree | `swamp-tree` | 0.6x0.6 **B** | swamp, morass |  | 443 / 121 |
| tree | `pine` | 0.6x0.6 **B** | tundra, keld, mountain, forest |  | 80 / 50 |
| tree | `snowy-fir` | 0.6x0.6 **B** | keld, tundra, mountain |  | 144 / 90 |
| tree | `palm` | 0.6x0.6 **B** | coast, verdura |  | 340 / 56 |
| tree | `lush-tree` | 0.78x0.78 **B** | verdura |  | 650 / 108 |
| tree | `tree` | 0.6x0.6 **B** | plains, town, forest |  | 348 / 68 |
| water | `wooden-bridge` | line 2 | any |  |  |
| water | `ford-stones` | line 0.8 | any |  |  |
| water | `dock` | area | coast, swamp, town |  |  |
| water | `rowboat` | 1x2.6 **B** | coast, swamp, town |  |  |
| water | `ferry` | 2.5x4 **B** | coast, swamp, town |  |  |
| water | `sailboat` | 1.6x4.6 **B** | coast, town |  |  |
| water | `stepping-stone` | 0.6x0.6 | any |  |  |
| water | `bridge` | area | any |  |  |
| water | `ferry-post` | 0.6x0.6 **B** | coast, swamp |  |  |
| water | `pier` | area | coast, swamp, town |  |  |

###### Building styles

| Style | Kinds at their showcase footprints (w x d tiles, facing south) |
| --- | --- |
| `benalish` | house (slice) 6x4, house (cottage) 4x4, shop 7x4, tenement 5x4, inn 8x5, smithy 6x5, guildhall 9x6, temple 7x9, library 8x6, tower 4x4, warehouse 8x5, mausoleum 5x4, gatehouse 6x3, wall-tower 3x3, wall 6x1 |
| `morass` | house 5x5, house (hut) 4x4, shop 6x5, tenement 4x5, inn 7x6, temple 6x8, guildhall 8x6, smithy 6x5, library 6x6, tower 4x4, warehouse 8x6, gatehouse 6x3, wall-tower 3x3, wall 6x1 |
| `urborg` |  |
| `llanowar` | house 5x5, house (small) 4x4, shop 6x5, inn 6x6, tenement 5x5, temple 7x7, guildhall 8x6, smithy 6x5, library 6x6, tower 4x4, warehouse 6x5, gatehouse 6x3, wall-tower 3x3, wall 6x1 |
| `keldon` | house (longhouse) 7x4, house (small, thatch) 5x4, shop 7x5, inn 9x6, temple 7x8, guildhall 10x6, smithy 6x5, library 7x5, tower 3x3, warehouse 5x5, gatehouse 6x3, wall-tower 2x2, wall 6x1 |
| `tolarian` | house (small) 4x4, house (two floors) 6x5, shop 6x4, inn 8x6, smithy 6x5, guildhall 10x6, temple 8x9, library 9x10, tower 4x4, tower (slender) 3x3, warehouse 8x5, gatehouse 6x3, wall-tower 3x3, wall 6x1 |
| `vess` | manor 14x9, house (cottage) 4x4, house 6x4, shop 6x4, inn 8x5, smithy 6x5, temple 6x9, guildhall 8x5, library 8x6, tower 3x3, warehouse 7x5, mausoleum 4x5, gatehouse 6x3, wall-tower 3x3, wall 6x1 |
| `village` | house (cottage) 4x3, house (two floors) 5x4, house (whitewashed) 6x4, shop 5x4, inn 7x5, smithy 5x5, temple 4x6, guildhall 6x4, library 5x4, tower 3x3, warehouse 7x5, gatehouse 6x1, wall-tower 3x3, wall 6x1 |
| `phyrexian` | portal 9x4, hall 7x6, spire 3x3, spire (small) 2x2, vat 4x4, obelisk 2x2, gatehouse 6x3, wall-tower 3x3, wall 6x1 |

###### Named palettes

`default`, `autumn`, `dark-hair`, `benalish`, `benalish-slate`, `llanowar`, `morass`, `keldon`, `tolarian`, `vess`, `village`, `phyrexian`, `whitewash`, `thatch`, `red-cloth`, `green-cloth`, `purple-cloth`, `teal-cloth`, `summer`, `spring`, `elfhame`, `verdura`, `swamp`, `winter`, `blighted`, `granite`, `basalt`, `sandstone`, `marble`, `cobble`, `ice`, `phyrexian-stone`, `tier-1`, `tier-2`, `tier-3`, `tier-4`

#### Rooms and dungeons

##### Rooms: `art/rooms/layout.ts` -> `interiors/<id>.json`

The world generator (`scripts/worldgen/rooms.ts`) instances every interior by calling `layoutRoom(spec)`, the
vendor as `keeper`. It returns the whole `InteriorData` to write: the
floor, the props, the keeper NPCs, the lights and the `params`. The same spec always gives the same room.

```ts
layoutRoom({
  id, name?, town?,
  kind,          // ROOM_KINDS: shop, inn, guildhall, temple, smithy, library, house, tower, exotic-wares
  style,         // ROOM_STYLES: benalish, llanowar, morass, keldon, tolarian, vess
                 //   aliases: urborg/caligo -> morass, argive -> vess, keld -> keldon, orvada -> tolarian,
                 //   benalia -> benalish; anything else is benalish
  seed,          // varies the layout and the furniture
  building?: {w, d},  // the building's footprint in world units; the room's size is taken from it,
                      //   within ROOM_SIZES[kind]
  w?, d?,        // or the floor's size given outright
  exit,          // the world tile you come out on: the building's door tile
  specialty?,    // shop: cards | curios | books | weapons (else chosen by the seed)
  upstairs?,     // inn: false makes it a tavern, with no gallery and more tables
  keeper?,       // laid over the first keeper: {id, name, vendor, figure, palette...}
}) -> InteriorData
```

- **Sizes** (`ROOM_SIZES`, in tiles):

  | Kind | Width | Depth |
  | --- | --- | --- |
  | house | 8-10 | 6-7 |
  | shop, inn, guildhall, temple, smithy, library, exotic wares | 9-11 (an inn 10-11) | 6-7 |
  | tower (round, an even width across) | 8-10 | 8-10 |

  A room up to these sizes is seen whole at every heading at 1280 by 800 and 1920 by 1080. The exception is an inn with
  rooms upstairs: its gallery's tall back wall leaves its nearest corner a tile off the screen from a corner heading,
  until the player walks toward it. The way out is a two-tile gap in the middle of the front
  wall, with `entry` = `[floor(w / 2), d - 1]` (`w / 2` for the tower). The area takes in the sill row at `z = d`.
- **Keepers** (NPCs):
  - shop and exotic wares: a `vendor`, behind the counter;
  - inn: an `innkeeper` behind the bar, and a `spell-table` NPC;
  - guildhall (the mages' guild): a `spell-table` NPC and a guildmaster (`townsfolk`);
  - smithy: an `armorer`;
  - temple, library and tower: a priest, librarian or mage (`townsfolk`).

  Use `keeper` to set the vendor's id. A keeper's tile is open but cannot be reached from the door. Every other open
  tile is reached from the door.
- **`params`** the shells read:
  - `gallery: {y, depth, from, to, doors}`: an inn's gallery of rooms upstairs over its bar;
  - `specialty`: a shop's wares.
- **The recipes** (`ROOMS`):
  - `hall.ts`: the square kinds, in their style's finish;
  - `tower.ts`: the round floor;
  - `crypt.ts`: the slice's crypt.

  The finishes are in `styles.ts`: floor surfaces, wall bands, posts, the room's fill and daylight. Each style also names
  the palette its furniture takes, `room-<style>`, given as each prop's `tint`.
- **The room surfaces** (`room-*`): `room-elfwood`, `room-bogwood`, `room-keld-flags`, `room-mosaic`,
  `room-tolarian-flags`, `room-parquet`, `room-marble`, `room-checker`, `room-stone`, `room-earth`, `room-mossy-flags`.
- **Furniture** (`art/props`; anchors and args are in each entry's `about`):
  - house and common: `table`, `chair`, `bench-seat`, `tankards`, `bed`, `chest`, `wardrobe`, `plant`,
    `candle-stand`, `wall-lamp`, `carpet`, `fur-rug`;
  - inn: `bar-counter`, `bar-shelf`, `keg-rack`, `inn-stair`;
  - guildhall: `guild-banner`, `tapestry`, `notice-board`, `wall-map`, `spell-desk`;
  - temple: `altar`, `pew`, `pillar`, `stained-window`, `font`, `candle-rack`;
  - smithy: `forge`, `stump-anvil`, `quench-trough`, `grindstone`, `weapon-rack`, `armor-stand`, `tool-rack`, `coal-heap`,
    `ingots`;
  - library and tower: `bookcase`, `reading-desk`, `lectern`, `globe`, `book-pile`, `ladder`, `rune-circle`,
    `orrery`, `telescope`, `crystal-pedestal`, `floating-crystal`, `spiral-stair`;
  - shops: `card-case`, `booster-crate`, `weapon-barrel`, `curio-case`, `planar-rift`, `arcane-lamp`, `cauldron`,
    `relic-pedestal`.
- **Rotation:** a free-standing piece faces south and is turned by `rot`, in quarter turns as a building's (1 west,
  2 north, 3 east). A wall piece stands against the wall at its own `z` and turns the same way.
- **The slice's wall props** (`hearth`, `bookshelf`, `back-window`, `poster`, `blade-rack`, `shield`, `ossuary`,
  `buttress`, `tattered-banner`, `torch`) now take their wall's `z` and `rot`. With `z` = 0 and no `rot`, as in the
  slice, they are unchanged byte for byte.

##### Dungeons on squares: `dungeon/`

`generateDungeonFloor({theme, seed, floor, floors, run})` returns a `DungeonFloor` (`types.ts`):
- `w` by `d` tiles from (0, 0), in version 2's tile format (`tiles`, row by row);
- `cells`, the plan the walls are drawn from: rows of `#` wall, `.` floor, `~` water, `=` lava, ` ` void;
- `props`, `lights` (at most 16), and the spell-table `npcs` on floor 0;
- `arrive`, `up`, `down`, `wayOut` and `spots` (`{index, mob, role, x, z}`), all in tiles.

`realms/web/src/dungeon/` is the module (the hex generator is retired); `dungeon/index.ts` exports
`generateDungeonFloor`, `THEME_DEFS`, `assembleFloor`, `gridOfFloor`, `AssembledFloor`, `MAX_LIGHTS`, `wardenIndex`,
`bossIndex` and the types `DungeonFloor`, `FloorRequest`, `RunFloor` (net/api.ts's, the run as the server hands it out),
`Role` and `Spot`. Each theme has its own carver in `themes/`, seeded by `${theme}:${seed}:${floor}`. `finish.ts` places
the run's contract:
- Walking is eight ways, never cutting a corner.
- Every floor tile is reached from the arrival without crossing a stair or the way out. Those are walkable, but walked
  onto only to be taken.
- The warden's index is `Encounters.length` and the boss's is one more.

`assembleFloor(floor)` returns `{place, bounds, doorway}`. It draws the floor the way `assembleInterior` draws a room,
with the renderer's own `groundOf`, `underOf` and `propOf` (render/chunks.ts):
- walls in the theme's stone; a cave's are crags of living rock instead of blocks (`rock.ts`): outlines that wander back
  from the open ground, tops that rise and fall, the floor run on under them, darker rock falling away into the dark
  beyond them, and ragged lips over a chasm (`walls.test.ts`: no rock over a walked tile);
- near walls low, and east and west walls as camera cut-aways;
- skirts over the void;
- the theme's fill and its own lights;
- the `dungeon-*` surfaces and props.

`gridOfFloor(floor)` is the floor's walkable Grid. The page frames a floor as `{inside: true, turns: true, bounds}`.
A run's player arrives on `arrive` (each floor's, going down too) and reports it; the server took them into the run at
tile 0, 0 and takes any tile within it. Leaving is stepping onto `up` (`/api/dungeon/leave`; on floor 0 it is the way
in), going down is stepping onto `down` (`/api/dungeon/floor`, once the warden is beaten), and leaving after the boss is
stepping onto `wayOut` (`/api/dungeon/leave`). The fights stand on `spots`: each `{index, mob, role}` is the run's
`{Index, Mob}` (an encounter, the warden at `wardenIndex`, the boss at `bossIndex`), started by
`/api/encounter/start` `{Run, Floor, Index, Mob}`. Importing `dungeon/` registers every id it names.

##### Viewing them

`rooms.html` (dev only) shows a room or a floor with the hero in it:
- a room: `?room=<kind>&style=&seed=&specialty=&upstairs=0&heading=`;
- a floor: `?dungeon=<theme>&seed=&floor=&floors=&heading=`;
- no query: an index of links.

`e2e/rooms.spec.ts` renders every kind and theme at every heading. With `ROOMS_SHOTS=1` it writes them to
`e2e/screenshots/rooms/`. `ROOMS_ONLY=<query fragment>` renders only the pages that match.

#### Characters

`art/figures` (interfaces.md "Models" is the reference):

- **The rig** (rig.ts) gained part motions (`motion`: a quadruped's `leg`s in diagonal pairs, `wing`s that beat, a
  `tail` or a body of segments that sways, `bob`, an `orbit`ing relic, a cast's `spark`), `glow`ing parts, `hover`, a
  walking `lean`, `flies` (wings beating standing too), `leans` (how much of the sprite lean a long four-legged body
  takes), a tilt about y as well (coils curling round), a shadow's `footprint` (tiles; the Actor's `blobShadow(0.42)` should take `spec.footprint ?? 0.42`),
  and two actions: `figure.act("cast" | "interact", seconds?)` and `figure.acting`. The slice's seven figures use none of
  it and move exactly as before.
- **Players:** `playerFigure({body, palette, identity, slots})` (player.ts), and `lookFigure(Look, Identity)` for presence
  (`Look` as relayed; ring slots `ring1`/`ring2`). The game page draws the player and other players with these.
- **Mobs:** `mobFigure(model, id, creature)` (mobs.ts): the client should pass the mob's id and its `creature` (the card's
  name, from the mob file), which choose variations. `mobs.ts` (the old `mobInfo`) needs `creature` added to `MobInfo`.
- **NPCs:** the world generator names the NPC figures above with a `seed` each (and may give a `palette` of `cloth`,
  `trim`, `skin`, `hair`); `npcActor` draws them with `figureSpec(n.figure, palette, n.seed)`.
- **Content:** every mob of `realms/content/dominaria/mobs` has a new `model` (mesh and palette; sizes kept), chosen for
  what its creature is (Hurloon Minotaur a `minotaur`, Mesa Pegasus a `pegasus`, Sengir Vampire a `vampire`, the
  bosses their own). `tools/realms/sample-decks.py` writes these files and keeps every existing mob file's `model`, choosing one
  only for a new mob, from `RealmContent.MobMeshes`.
- **Server:** `RealmContent.MobMeshes` lists the mob meshes and `RealmContent.GearMeshes` the gear parts, each with the
  slot it is made for (a gear item's look is a part of its own slot: `circlet`, `crown`, `helm`, `hood`, `hat`; `amulet`;
  `armor`, `robe`, `cloak`; `gloves`, `gauntlets`; `boots`, `greaves`; `ring`; `relic`, `orb`).
- **The cast page:** `realms/web/cast.html?set=bodies|identities|gear|parts|creatures|roster|bosses|mages|npcs`, with
  `heading`, `zoom`, `face=front|angle|side`, `walk`, `act=cast|interact`, `ground`, `compare` (the slice's knight and
  goblin first on each page, the yardstick); four-legged beasts stand three-quarters on unless `face` says; `e2e/figures.spec.ts` renders every
  page, `FIGURE_SHOTS=1` writes its pictures to `e2e/screenshots/figures`.

#### Dominaria as generated

The world generator (`realms/web/scripts/worldgen/`, `npm run world`, about five seconds) writes Dominaria from
`realms/content/dominaria/layout.json` (ported to squares) and the mob roster; `npm run world:map` draws it from above
(`realms/web/e2e/screenshots/world2/`: world.png, zones.png, terraces.png and a close-up of the Hurloon terraces, a picture of
every town, stretches of each kind of country). The hex generator is gone.

- **Size.** 1024 by 1216 tiles from `[0, 0]`, 32 by 38 chunks (1,216 files), no `bounds`. Sized for walking at 4.2 tiles a
  second: four to five minutes north to south in a straight line; New Benalia's walls to Capashen Hold's or the elfhames'
  40 seconds by road, to Keld two minutes with the ferry; New Benalia's square 157 tiles (its walls about 140 across, 35
  seconds), home towns' 93 to 121, villages' 45 to 49. Ferries cross in 11 to 27 seconds. The old map's shape is kept:
  the hex layout's places turned so up is north, a tile to an old world unit, with a few landmasses added and towns moved
  where the old map had them in the sea.
- **Counts** (seed 1997): 16 towns, 461 buildings, 139 interiors, 36 dungeons (20 mage towers), 840 spawns, 223 chests,
  116 waymarkers, about 45,000 props, 4 ferries, 34 roads. The files come to about 20 MB.
- **Heights are terraces**, as the renderer draws them (`terraces`, land.ts): whole levels of 12 texels (`relief` 1;
  0 regenerates a flat world), each level flat, open neighbours at most a level apart, no terrace a single tile wide.
  Where a way climbs a level - a road, a street, a paved gate's way out, a dock, a door - its two tiles across the bank
  are a ramp (flag `RAMP`, 4: the lower at a quarter of the way up, the upper at three quarters, so the pair is one even
  slope); across the open country a straight two-tile ramp is cut where a bank runs straight, about one every 16 tiles of
  bank. Every other tile at the top of a bank (its rim) is blocked, so a level is left only by a ramp; `connect` grades
  any way it cuts, with ramps. A bridge's deck and a ford's stones are at their banks' level. Water tiles (sea,
  shallows, stream, bog, lava) are holes at their banks' height. dominaria.test.ts holds it: open tiles side by side
  are level (a bridge's 4 texels at most) unless one is a ramp, and every ramp climbs. `RAMP` is the renderer's format
  addition, mirrored here (format.ts and the lint accept flags 0-7).
- **Towns** are laid out by their `form` (layout.json; towns.ts):
  - the outline is a polygon of 9 to 13 corners round the centre, pulled in from the coast, rivers and cliffs, inside the
    town's square (`radius` along x and z, what the server calls the town); spawns, chests and waymarkers keep out of
    the square and its apron;
  - a wall (`wall-run`s along each edge, cut at chunk edges and 16 tiles at most, `wall-tower`s at the corners and beside
    the gates, a `gatehouse` in each gate, `args.kind` wall or palisade), or hedgerows, or nothing, with a gate where each
    road arrives (each road picks the cheapest) and onto the harbour (with its `pier`);
  - main streets jogging along x and z from the gates to the central square, a lane inside a big town's walls, lanes
    branching at right angles off the main streets and the square (wandering in an elfhame and the Morass), meeting or
    ending; plazas: the capital's market, a cathedral's close, the arena, a campus's courtyards;
  - districts round seeds - market, temple close, keep (New Benalia's citadel, Capashen Hold's keep), the nobles' manors
    (the Seven Houses), artisans by a gate, harbour, residential, outskirts toward the edge, park, orchard (rows of
    `fruit-tree`), allotments, the Vess estate's grounds (hedges and gravestones) - each building its own way: terraces
    along a main street, detached houses with yards toward the edge, warehouses by the water;
  - the forms: `capital` and `city` (Benalia: dense stone, long straight stretches), `village` (hedged hamlets),
    `elfhame` (Llanowar's: no wall, tree-houses spread among `great-tree`s, some with a `tree-platform`, winding
    paths), `stilts` (the Morass's: boardwalks of `planks` over `bog`, houses with `params.stilts`), `clan` (Keld's:
    longhouses deep off their paths round the great hall - the temple - in a palisade), `campus` (Tolarian: buildings
    round grass courtyards), `estate` (the Vess manor, its grounds and outbuildings, walled);
  - landmarks first and much bigger (kinds `keep` and `manor`; the cathedral, the great hall), then the town's own
    buildings: the inn on a main street by a gate, the shops round the square and the market, the guildhall, temple,
    library or tower, the smithy among the artisans, houses with interiors; then the rows. Every building faces the street
    its door opens on; one with an interior faces south, west or east (never north, away from the camera), its `door`
    the street tile before its front at the `at` of its `door` opening. The town's own buildings take their interiors'
    ids (`<town>-inn`, `<vendor>-shop`, `<town>-guildhall`, `-temple`, `-library` or `-tower`, `-smithy`,
    `-house-<n>`, a village's `-shrine`), landmarks `<town>-citadel`, `-keep`, `-manor`, `-manor-<n>`; the rest are
    `<town>-b<n>`. Every building is given Benalia's params (ground, upper, roof, rise, chimney, wall, openings); a
    style reads what it can.
- **What players use but nobody walks through** - a quest board, the arena's gate, a spell table, a waystone - is an NPC
  on a blocked tile of its own with `stand` at its middle, and a prop of the same id there to draw it.
- **Dungeon entrances** are props by theme over a blocked footprint (`args.w`, `args.d` from `x`, `z`, facing `rot`),
  the entrance tile before the middle of its front, the spell table and a tower's waystone two tiles either side.
- **Ferry lanes** are sea tiles made open (no other sea tile is, but the causeways roads raise to the near isles).
- **Interiors** are laid out by kind in rooms 9 by 7 (a house) to 16 by 11 (an inn), the exit's gap and sill as the
  slice's shop has them, furnished with indoor props, a hearth's and the door's light, and their people.

##### The world's ids

`realms/web/scripts/worldgen/ids.ts` lists every surface the world uses, and `PLACEHOLDERS`: an id the
generator names before the art has it, with what it should look like, so the lint (`onUnknown`) names it instead of
failing. Every id the world names is the art's, so the list is empty.

#### Playing it locally

`tools\realms\play.cmd` is the whole game on one machine, from a fresh clone. It builds what is stale - the native
engine host that checks duels (`cargo build --profile cards -p cantrip-host`), the engine for the browser
(`tools\build-engine-wasm.cmd`), the web client (`dotnet build dotnet\src\Cantrip.Client.Web`), the realm server, the
cards' faces for a card layer with no server (`cantrip-realms-server catalog realms\web\.cards\catalog.msgpack`) and the
overworld's packages - then runs `realms/web/scripts/play.mjs`: the realm server with the development sign-in on a SQLite
file of its own (`realms/web/.play/realms.db`, kept between runs; `/fresh` starts again), the card layer as static files
on a port of its own (`scripts/cardLayer.mjs`), the overworld's dev server told both, and the browser opened on
`<server>/dev/signin?id=1&name=Wanderer`, which signs in and goes on to the world (the character is made there, then
played). The overworld is on 5300, the server 5301, the card layer 5302 (`/port P` moves all three). `/player N` signs in
as another player; `/offline` plays the in-memory API instead, with the real card layer's duels; `/nobuild` starts what
was built last. Card art is served by the realm server (`REALMS_ART`, Cantrip.Art's `/art/{size}/{slug}.webp`) when a
content folder with illustrations is found - `CANTRIP_ART`, else the repository's own `content\mtg\images`, which the
`fetch-card-art` skill fills; art is never committed - and the card layer is told it (`?art=`); without, the cards are
drawn with no picture. The card layer only ever asks for those sized renditions (128 to 1024 pixels, webp, made once from
the illustration and kept in `realms/web/.play/art`), never a full-size illustration, which a face would decode whole.
Offline (`/offline`) the same server serves the art alone on the server's port (`cantrip-realms-server art`), so offline
duels and loot show the art too. In the card layer's own screens (the spell table, the inventory, the ante) a card's note
(copies left, price, relic) is a band under its name across the top of the art, not a veil over the picture. A world
client not signed in is sent to `<server>/signin`, which a server with the development sign-in alone answers with its
form.

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
- **The lab** (built): `tools\realms\balance.cmd`, the console app `realms/dotnet/Cantrip.Realms.Balance`
  (`cantrip-realm-balance`). It plays whole duels on the native engine with no server: each is the `Duel` the realm
  server would deal for that player and mob (`Encounters.Deal`, `PlayerSeat`, `MobSeat`: the player's deck, stats and
  gear emblems against the mob's deck, stats with its gear's, and its gear's emblems; with `--standing`, a color boss
  with what its dungeon's run adds for the player's standing to its color, `Dungeons.BossGains`, the reference's first
  color its starting one; without it, every boss as its file has it, as an own or ally color's run deals it), played to
  its end on the
  browser's `DuelTable`, the player's seat by the tactical bot and the mob's by `RealmBot` on the duel's seed. Each game's
  seed comes from the run's seed, the player, the mob and the game's number, so a run is repeatable; the win rates are a
  deliberate statistical sample, reported with Wilson 95% intervals by tier (wanderers apart from the mages and
  wardens), by boss, by deck and by mob. `--log` keeps every game as a JSON line and `--from` reports logs again.
  - **Reference players.** (a) Each color's starter deck with the starting kit. (b) An upgraded deck per color
    (`decks/realms/dominaria/reference/<color>.txt`): the starter with the pool's commons and uncommons a player could
    hold after about a dozen wins, wearing four uncommon items (Circlet of Foresight, Silver Pendant, Chain Hauberk,
    Boots of the March). (c) Two strong two-color decks of the pool, rares included (`white-blue`, `black-red`), with the
    same gear; a boss faces only those without the color it unlocks, since it is fought before that color is yours.
  - **The plan** (without `--decks`): T1 and T2 against the starters, T3 and T4 against the upgraded decks, the bosses
    against the upgraded and two-color decks. Targets for the player's win rate: T1 65-75%, T2 50-60% (starters); T3
    50-60%, T4 45-55%, bosses 35-45% (upgraded, without `--standing`: an own or ally color's run); every boss
    distinctly harder than T4. An enemy color's run is harder by design, its numbers measured with `--standing`.
  - **Tuning.** Mob stats and stats-only gear are `tools/realms/sample-decks.py`'s (`STATS`, `GEAR`, each boss's own
    `totals`), which writes the mob files and their decks - each deck rebuilt without any card that could never do
    anything in it (`dead_cards`); the lab's last measurements and what they changed are
    `realms/docs/balance.md`.
- **Gear costs** (to come): the same lab, with and without each item, spread over the worker pool
  (`tools\cantrip-workers.cmd`). Each effect's cost is fitted to the change in log-odds of winning.
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

- **Overworld:** vitest for the grid and its A* (the walk vectors the server checks too), spawn generation (the same golden vectors as the server), the world format, loader and lint (Dominaria's files lint clean and are what the generator writes), the art registries, rooms, dungeon floors, figures and the renderer's pieces, and the in-memory API.
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
