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
  - Tables: players (their hearts with them, design.md A3b), collection, gear_owned, loadout, deck, sideboard, unlocks, relics (each relic an account ever received, design.md A3a), vendors, vendor_stock, vendor_visits, duels (one row a game of an encounter), chests (when a character last took each find: a treasure chest, a heartbloom, a run's shrine), quests, runs, attuned.
  - The `Hearts` migration dropped the ante (its table, and the duels' ante, value and cap) and gave every character 2 of 2 hearts.
- **Authority:** the server owns everything of value, and the client only asks. The endpoints are a JSON API: character, collection, deck and sideboard save (only accepted while you stand at a spell table), loadout, vendor buy and sell, armorer, hearts bought at a healer, hearts found (a heartbloom picked, a run's shrine prayed at: whether each is there and was taken is the server's), quests.
- **The encounter protocol** (single-player, but it can't be cheated):
  1. **Start:** `POST /encounter/start {map, spawnId}`. The server checks that the spawn exists in that map's **deterministic spawn table** (seeded by player, map and spawn epoch; the client and server share golden test vectors) and that your last reported position is close. It then **commits** the seed, the mob, a snapshot of your deck, sideboard and loadout, and the mob's full starting life, and returns a duel token.
  2. **Play:** the browser plays the duel in WASM.
  3. **Report:** `POST /encounter/finish {token, decisionLog}`.
  4. **Verify:** the server **replays the log** with the native engine of the same version and recomputes the mob's answers with the same seeded `TacticalPlay`. Any mismatch rejects the report and counts the duel as a loss.
  5. **Win:** the server pays the gold and rolls the gear drop (and a boss's gift and relics).
  6. **Loss:** the server takes a heart. With hearts left it keeps the game awaiting an answer, with the buyout it measured
     from the mob's life at the end of the replayed log: `POST /encounter/pay` pays it (a world mob's alone), and
     `POST /encounter/rematch` commits the encounter's next game - the deck swapped from the sideboard, the player's
     choice of play or draw (`FirstPlayer`), and the mob's seat at the life it ended with, its variant start's
     `StartingLife` - which is played and verified as any game is. With none left the character dies: home, hearts full,
     a dungeon run ended and its winnings taken back.
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
- **Movement:** square tiles, eight-way walking, never cutting a corner past a blocked tile and never walking over a
  ledge (`world/grid.ts` `canStep`): a bank higher than a quarter of a tile (`LEDGE`, 4 texels) between two tiles not
  both ramps - a terrace's edge, a road's embankment - is walked up to and along, both its tiles open. One no higher
  than a terrace's level (`HOP`, 12 texels) is **hopped**, automatically, straight across it and never on a diagonal
  step (nor does a diagonal step cut past one): players always hop, a mob as its file says (`hops`); higher is a cliff
  nobody crosses, left only by a ramp or a pass. The player walks between tile middles as a body 0.6 tiles square that
  never overlaps a closed tile nor stands across a ledge but mid-hop (`render/motion.ts`), so it stops flush at the
  brink of a cliff as at a wall, and slides along a ledge's brink walked along. A hop goes from a stand flush with the
  brink on one side straight across to a stand flush on the other, at walking pace (the server times walks by its
  clock), the figure on a short arc - up and over, or off and down - while it crosses (`hopUnder`, `hopHeight`: by where
  the body is, so another player's figure walking the relay's points and a mob walking tile to tile arc alike). The A*
  counts a hop as two steps (`HOP_COST`), so a ramp or level ground about as short is taken instead.
  A click walks the grid's A* path pulled straight: from where the player stands to the furthest corner of the path in
  plain sight, and on from there; a hop on the path is a leg of its own, from the brink to the far side, and the path is
  pulled straight afresh after it. A held button finds no path: every frame it steers the player straight at the
  cursor's point on the ground, sliding along whatever is in the way and stopping only where nothing is left to go; held
  against a ledge's brink, pushed into it (within 60 degrees of straight across) at a point past it, it takes the hop
  whole (`hopToward`), and a hop under way is always finished, even let go.
  Letting go stops the player where it stands. Doors and gates are entered by a click, by holding still on them, or by
  a held walk that pushes into the doorway from the door's tile (the cursor in the doorway, the walk heading within 55
  degrees of the way the door goes: `render/pointer.ts`), never by sweeping past. The tile the game uses (encounters,
  doors, the server's place) is the one under the body's middle.
  Presence is not tile-based: the relay is told points, where the figure truly is and goes (`net/relay.ts`, at most one
  walk each 150 ms) - a click's walk from the figure through the points ahead, told again when the figure and the
  server's reckoning are half a tile apart; a held walk as it is walked, from where the last ended through where the
  figure has been. The server checks each line crosses tiles a step of the grid's apart (`legClear`, which the body's
  every line keeps) and that a walk starts within 1.5 tiles of where it has the player, so the two never drift apart.
  A walk the server still refuses (it had the player elsewhere: a reconnection entered them where they last reported
  standing) is followed by the grid's way from where it has them to where the figure stands, at the fastest, so the
  server catches up and the figure is never snapped back; only a way longer than 24 steps, or a refusal of that way
  too, stands the figure where the server says.
  **Towns are entered from their icons** (a world of two scales, interfaces.md "Two scales"): each of a town's ways is a
  door of the travel map, stood on its `outside` and stepped into the icon, its doorway the whole icon - so a click on
  the icon from anywhere walks to the nearest way's outside the player can reach and goes in, and a held walk pushing
  into the icon from an outside goes in as one into a doorway does (`StageDoor.area`). In the grounds each tile of a
  way's `exit` is a door out, and walking onto one leaves. Going through, the iris closes on the icon (or the road's
  end), the tile stood on and then the other side's are told the server, and the other side is read and built round
  where the player will stand while it is shut (`ChunkStreamer.settle` keeping what is built: the place left is still
  seen) - no loading screen; it opens on the way's `inside`, facing into the town, or its `outside`, facing away from
  the icon, where standing still goes nowhere (a figure arriving steps out of the doorway onto its tile only where the
  doorway is ground one stands on: out of an icon it stands on the outside from the first frame, so the page never tells
  the server a tile of the icon). The streamer then drops what was left.
- **The debug overlay** (F3, or `?debug`; `src/debug.ts`): the place, chunk, the player's exact position, tile and
  floor height, the tile under the pointer (open or closed, its floor), and every jump of the player's figure - a move
  in one frame further than 0.6 of a tile, or a rise or drop of more than 0.3 - with the tiles it went from and to, also
  logged to the console (a door, a waystone or a lost duel stands a new figure behind the iris: no jump). A click
  copies it, so a teleport or an invisible obstruction seen in play is reported by its coordinates.
- **The world:** one map of the Domains streamed in 32-by-32 chunks (interfaces.md, "The world, interiors and
  dungeons"), of two scales (interfaces.md, "Two scales"): a travel map, where each town is an icon, and each town's
  grounds at walking scale in a pocket of its own; chunks exist only over the two, and the streamer never asks for
  another (`hasGround`). The camera keeps to the ground the player is on - the grounds, or the travel map - and in a world
  of two scales never shows past it at any heading or zoom (`Framing.contained`, `CameraRig.footprint`: the view's
  ground as the camera stands, for floors as high as the place's highest, `rise`); a zoom step out it would not fit is
  refused, a turn to a corner steps the zoom in as far as it needs. Wanderers live, spawn and chase on the travel map
  alone, and the finds of the wilds stand there alone. It is made offline by a seeded generator (`scripts/worldgen`,
  `npm run world`, about six seconds) from `realms/content/dominaria/geography.json` and `layout.json`, checked in, and
  linted: a travel map of 512 by 768 tiles and sixteen towns' grounds, 1568 by 768 tiles in all, 705 chunk files. Nobody edits the map in the game: there is no map
  editor. Chunks near the view are read and built a step at a time (the ground, terrain from heights, the scenery merged
  per chunk) and those far away are dropped; paths are found over the chunks read, a bounded search.
- **The tier zones are shown:** the regional map (the minimap, opening to the whole world's: in a world of two scales the
  travel map's alone, the towns at their icons) is the travel map drawn as an atlas (`mapArt.ts`, from world.json's
  `overview`, a letter and a level a tile, and its peaks): the coast smoothed and outlined over shallows and lines of
  depth, the land by biome in the map's own palette (plains, fields, forest, jungle, swamp, highland, desert, badlands,
  tundra, snow, ice, waste) with its relief shaded from the levels under a light from the north-west, the woods as
  miniature trees, the ranges as rows of peaks (snow-capped where the range is), rivers and lakes, the roads (those
  between towns bolder) and the ferries' lanes dashed over the sea. Each tier's zone is bordered in its color where the
  tier changes, washed faintly, and numbered; the whole map's Tiers toggle tints the zones strongly. It is drawn at any
  scale in squares of 256 pixels kept once drawn (a few tens of milliseconds a screenful), so a view is a few images
  copied. The minimap is it at three pixels a tile round the player, the marks near; the whole map (the minimap
  clicked, or M; `worldMap.ts`) fills the window at the Domains' 2:3 beside its legend - the marks drawn as the map draws
  them - and zooms (the wheel, + and -, its buttons; clamped) and drags. Its names are placed afresh at each zoom
  (`mapLabels.ts`): the towns' first, each beside its mark (joined to it by a line where a crowd pushes it off), then the
  lands' (large and spaced), the seas' (italic), the regions', the features' and, closer in, the wonders' and the
  zones' tier numbers, each nudged off what was placed before it, shrunk, or left out at that zoom - never two over each
  other, so more appear as it closes in. It marks the towns by kind (the capital's keep, the home towns' houses in
  their color, the villages), the player's inn ringed in gold, the dungeons with their tiers (a color's boss ringed in
  its color, filled once it is held), the mage towers (lit when attuned), the wonders (world.json's `landmarks`), the
  Phyrexian Portal, the ferries' docks, the players near and the player, ringed and pointing the way they go; each mark
  is named on hover with its tier and its boss or its waystone, and the land with its area and tier. Escape or M closes
  it. Waymarkers in the tier's color and number stand where it rises; the HUD names the area and its tier, and says so
  on crossing into a harder one; a wanderer under the pointer shows its name and tier.
- **Towns are mapped:** in a town (or at its gates; in a world of two scales, anywhere in its grounds, the area line
  naming the town there too) the minimap is the town's map round the player instead
  (`townMap.ts`, from the town's street plan in world.json): its streets and squares paved light with dark kerbs, its
  buildings as blocks (those with a door brighter), its wall and gates, its key places as lettered icons (the inn and
  the mages' guild with their spell tables, the shops, the exotic wares, the temple or shrine, the library or mage's
  tower, the smithy and its armorer, the quest board, the arena, the caravans' pitch) with a legend under it; any
  dungeon or tower near is marked as on the regional map. The whole map opens on the town's, as big as the window lets
  it, every place named and every gate named for where its road leads ("To New Benalia": in a grounds, by its way's `to`),
  and turns to the world's map and back - in a grounds, the player marked on it at the town's icon.
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
  themed deck, both seats' stats and gear emblems), the real card layer plays them, shows the gear they drop and
  sideboards a rematch, and only the verdict - and the mob's life at the end, which the card layer reads from the game -
  is taken on trust, there being no server to replay the log; the screens that trade and save through the API
  (spell table, vendors, gear) are the stand-in panels' (`OfflineCardLayer`). The card layer is the real one whenever
  one is built: the dev server serves the web client's built page on a port of its own (its port + 100, or
  `REALM_CARD_LAYER_PORT`; `vite.config.ts`) and says where in a `<meta name="card-layer">`; `?cards=stub` (or
  `REALM_CARD_LAYER=stub`, as the offline suites set) asks for the stand-in panels (`cardStub.ts`). `?at=` (`world:x,z`, a town, an interior or a dungeon),
  `?now=`, `?wander=0`, `?mobs=0`, `?attuned=`, `?heading=`, `?zoom=`, `?still` and `?nohud` force a state for tests and
  development (src/main.ts): `?at=` a town is its inn's door (in its grounds, in a world of two scales), `world:x,z` a
  tile of either scale. `?world=slice|large|two` plays the art slice's street, the renderer's large synthetic world or
  the small world of two scales (`fixtures/two-world`: a travel map with Twoford's icon, its two ways, the caves and a
  spawn of each tier; Twoford's grounds three chunks east) instead of the Domains; offline, the MockApi plays the world
  shown (`MockApi.useWorld`). `e2e/travel-map.spec.ts` plays the two scales on it: the icon clicked and gone into behind
  the iris, an exit walked out of to stand beside the icon (and stay), a held walk into the icon, the camera in the
  grounds showing no void at any heading or zoom (the frame's pixels counted, `TRAVEL_SHOTS=<dir>` keeping the
  pictures), and the maps switching.
- **Test hooks:** `?test` publishes `globalThis.realmTest`, the screen position of every entity and control by name,
  the way `cantripTest` does (and `sliceTest`, the stage's view for the renderer's suites). `?manual` holds the clock
  until a test advances it: the offline suites never wait on the wall clock. `npm test` runs vitest; `npm run e2e` runs
  the Playwright suite (`e2e/`) against the offline overworld with real clicks. Where a test starts is read from
  world.json and the chunk files (`e2e/places.ts`: a spawn near a town's icon, a road's crossings, a ledge's brink in a
  grounds or on the travel map, the travel map's places to walk), never a tile written in a test, so a regenerated world
  or a town laid out anew still has a place for every test. `journey.spec.ts` plays the two scales as a player does,
  every walk a real mouse click on the ground: out of New Benalia's inn and through its streets to the road out, onto
  the exit and out beside the icon, along the road to Capashen Hold, in by a click on its icon (the hearts filled there,
  the travel map's wilds filling none) and through its streets into its inn - no jump, no walk refused.
  `grounds.spec.ts` opens each of the sixteen towns with `?at=<town>`: the player at the inn's door in its grounds, out
  of any door a few seconds on, and no void's pixel in the frame at any heading or zoom the camera allows there
  (`GROUNDS_SHOTS=<dir>` keeps the pictures). `walking.spec.ts` follows the player beside a shop frame by frame
  (`realmTest.track`), held and clicked: no jump, no turning back; `sweep.spec.ts` walks and steers the player about
  towns' grounds and, on the travel map, along a road, among a wood's groves, against a range's peaks, over a bridge and
  up and down a bank, every frame checked for a jump and the body for a closed tile or a ledge under it but mid-hop (and
  mid-hop no longer than a hop takes), and after each walk for a way back to where it began (never shut in a pocket);
  and walks a ledge's brink and hops it, held and clicked, in a grounds and on the travel map; `hop.spec.ts` hops a
  terrace of the large world with the real mouse at each heading, held down and clicked up, frame by frame and pictured;
  SWEEP_TOWNS, SWEEP_TRAVEL (road, wood, range, bridge, bank), SWEEP_WALKS sweep more, and `e2e/server/sweep.spec.ts`,
  with REALMS_SWEEP=1, sweeps on the real server, every refused walk noted too). `duel.spec.ts` has a wanderer of the
  travel map engaged with a click, one that chases a player standing near into a duel itself, and one that does not hop
  come as near as it can and stop at a bank's brink; `hearts.spec.ts` fills the hearts walking into a town's grounds
  from its icon, and wakes the dead at their inn's door in its grounds; `dungeons.spec.ts` leaves a mage tower onto the
  travel map beside its way in and travels by its waystone to another; `travel.spec.ts` crosses the Rip on the Keldon
  ferry. `map.spec.ts` opens the whole map with M at 1280x800 and 1920x1080 - filling the window at 2:3, every town
  named, no two names over each other fitted and zoomed in on Benalia, Llanowar, North Aerona and Icehaven, a dungeon
  named on hover, the tiers tinted, dragged, closed with Escape - from a town's grounds too, and the minimap at a coast,
  a pass and a forest (`MAP_SHOTS=<dir>` keeps the pictures); `tour.spec.ts` takes the pictures of the Domains
  (`REALM_TOUR=1` writes `e2e/screenshots/tour`, `TOUR_ONLY=towns,regions,rooms,dungeons,rest` some of them): each town
  at its inn's door, each region of the travel map (geography.json's) from the furthest zoom, an interior of each kind,
  each dungeon's entrance on the travel map and a floor of it, and a walk out of New Benalia down its road and onto the
  travel map as a GIF; `occlude.spec.ts` holds the occluder fade and the steady view in New Benalia at every heading;
  `shadows.spec.ts` the sun's shadow meeting the foot of a terrace's face, on the large world's hills. `npm run
  e2e:server` runs `e2e/server/` against the real realm server on the generated world instead (the page on its own
  clock there, as the server times walks by its clock; its ports `REALMS_E2E_PORTS=web,realm,cards`, the card layer
  another checkout's build with `REALM_CARD_LAYER_ROOT=<its wwwroot>`, the engine host with `CANTRIP_NATIVE_HOST`): it
  starts `Cantrip.Realms.Server` with the development sign-in on a fresh SQLite file and the overworld across origins
  (`?server=`), signs in, makes a character, walks New Benalia's streets (held and clicked beside a shop, the relay
  refusing none of the walks told: `walking.spec.ts`), goes into a shop and asks for its vendor's
  screen, starts a world encounter through the API (the card layer's stand-in records the duel), enters a dungeon run and
  takes its stair once the warden is beaten, resumes a run after a reload, beats Rofellos (green unlocked, his hall empty
  for the week after; `bosses.spec.ts`) and plays his duel in the real card layer (won from a forced position), attunes two mage towers by beating their mages and travels between their
  waystones, has two players see each other walk in the world and in an inn, and plays duels in the real card layer
  whose logs the server replays on the native host: one conceded, and the whole loop won and lost
  (`duel-loop.spec.ts`: the encounter's splash, the game, its end, the server's verdict, then its gold and the world
  resumed; or a heart gone, the mob's buyout measured from the replayed log, the deck sideboarded in the card layer, the
  next game dealt with the mob at the life it kept and conceded, and death and home), each a position forced through
  `POST /dev/duel` (a seat beginning at 0 life, the mob at a life it keeps), never a seed; hearts with the stand-in
  (`hearts.spec.ts`: a buyout paid and the answer coming back after a reload, a town filling the hearts, a dungeon's mob
  fought again, a temple's healer, a heartbloom stood in the wilds (`POST /dev/find`) picked and gone for all, a run's shrine made to
  stand by `POST /dev/drop {Shrine}` blessing once, each with a heart missing arranged by `POST /dev/hearts`); an offline duel and a rematch sideboarded in the real card layer
  (`offline-duel.spec.ts`, forced through `realmTest.forceDuel`); and builds a deck and a sideboard at a spell table in the
  real card layer (the server's refusals shown, the saved deck the one the next duel deals) and buys and sells at a card
  vendor there (`spell-table.spec.ts`). A test starts its character where it needs to be and has the server
  count the stand-in's wins and losses through the development server's test-only calls (`POST /dev/place`, `/dev/verdict` with the mob's life at the end, `/dev/duel`, `/dev/cards`,
  interfaces.md); everything else is walked and clicked. `npm run bench` times the renderer on walks through the
  Domains - New Benalia's streets in its grounds, a wood and a range of the travel map - and the large world
  (`e2e/bench`). The dev galleries are `gallery.html` (the art library), `rooms.html`
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
| `world/` | the world data format (types, loader, lint), towns' street plans (`streets.ts`), the walk grid, and Dominaria's files (`realm.ts`) |
| `game.ts`, `entities.ts`, `input.ts`, `hud.ts`, `townMap.ts`, `mapArt.ts`, `worldMap.ts`, `mapLabels.ts`, `screens/`, `net/`, `testHooks.ts` | the game around it (the maps: a town's, the travel map's atlas, the whole map's view and marks, its names' placing) |

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
- `Actor` (actor.ts): a figure walking a grid - `goTo`, `retarget`, `steer`, `walkTo`, `update(dt, player)`; the
  player's is `smooth` (its walks pulled straight, motion.ts). `behaviourOf(npc.behaviour)` turns the data's behaviour
  into its own.
- Underneath: `buildGround` (ground.ts: the ground shader over a block of tiles, texels counted from an `anchor` - the
  world's origin - so blocks join without a seam; given a block's `relief`, terrain.ts `reliefMap`, it draws the
  terraces' edges on it), `grassField` (grass.ts: tufts per tile, visited row by row, none where `bareAt` says),
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

- format.ts: the two scales (interfaces.md, "Two scales": `WorldData.travel`, `labels`, `TownData.site`, `grounds`,
  `ways`, `TownWay`) and their helpers - `inTravel`, `travelRect`, `groundsAt`, `siteAt`, `siteRect`, `ICON_SIZE`,
  `sideStep`, `wayAt`, `scaleAt`, `framingAt`, `groundRects`, `groundChunks`, `hasGround`; the version-2 types below,
  and `chunkOf`, `chunkKey`, `parseChunkKey`, `worldRect`, `viewBounds`,
  `chunksOver`, `chunkTile`, `interiorArea`, `interiorTile`, `heightOf`, `isBlocked`, `isBare`, `LEDGE`, `noLedge`,
  `HOP`, `isHop`,
  `frontStep`; and (phase
  2, World) `areaAt`, `tierAt` (a tile's tier zone and tier), `inTown`, `townAt` (a town is the square of tiles within
  its `radius` of its `center` along x and z).
- load.ts: a `WorldSource` (`globSource` over Vite's `import.meta.glob`, or `fetchSource(baseUrl)`), `loadWorld`,
  `loadChunk(source, cx, cz, world?)` (given the world, a chunk over no ground is none, never asked for), `loadChunks(source, world, rect?)`, `loadAllChunks`, `loadInterior` - each file checked as it comes, a bad
  one a `WorldFormatError` - and the walkable `Grid`s: `gridOfWorld(world, chunks)`, `gridOfInterior(room)`, and (phase
  2) `gridOfChunks(world, chunks)`, a grid over only the rectangle the loaded chunks cover, so a walk crosses chunk edges
  as one ground without a grid the size of the world (the chunk manager remakes it as chunks come and go).
- lint.ts: per file, `checkWorld`, `checkChunk`, `checkInterior`; the whole, `lintWorld(world, chunks, interiors,
  known?)`, with `known` the art's ids (and its props' and buildings' own checks) so the lint stays three-free.
  art/registries.test.ts builds `known` from the registries and lints the sample with it. `known.onUnknown(kind, id,
  where)`, given, takes an id the art does not have instead of its being a problem (while the art is built beside the
  world). The realm, `lintRealm(world, chunks, interiors, dungeons, {known, tiers})`: `lintWorld` and the
  whole world as the game plays it - walked whole from the first inn as a player walks (`canStep`: eight ways, no
  corner cut, no ledge stepped over but a hop straight across; a town's ways taken as doors, an exit tile stepped onto
  and left by but never walked on past), everything stood on
  open and reached, the rest reached beside, interiors in the towns their doors stand in, entrances and dungeons where
  world.json says with spell tables and waystones beside them and an open step out, spawns of their zone's tier and their
  mobs', tiers growing with distance, waymarkers at rises, ferry lanes walks from dock to dock with ferrymen, pitches open
  in their towns, spell tables spell-table NPCs, each town's streets (`lintTown`, below), the two scales (the walk
  through the towns' ways, spawns, waymarkers and entrances on the travel map, none within 10 tiles of an icon), and - given `known.propTiles`
  and `known.liquid` - nothing closed unseen: every closed tile a walker comes up against on its own level (not seen as a
  bank from below) has what closes it drawn there (no ground, a liquid, a building, a prop that blocks over it, a thing
  used from beside it, a waymarker, a ferry's lane), so no invisible obstruction stands on the ground (a closed tile a
  hop above a walked one is come up against, as a player would hop onto it). (The renderer
  keeps a small prop on a closed tile at every zoom, `sortScenery`'s `solid`, so none is left out far either.)
  src/world/dominaria.test.ts runs it on Dominaria. `lintTown(town, open, buildings, limits?)` holds a town to its street
  plan: its nodes, ways, gates and places well formed; every way's ends, every door of the town and every key place
  walked to from every gate along the open street tiles alone (every door opening onto a street); no street running on
  more than a lot's depth (`TOWN_LIMITS.spur`, 8 tiles) past its last junction to end at no door; and no walk along the
  streets between two key places (its gates, doors and what is used from beside it, at least `apart` 12 tiles apart,
  gate to gate aside: the road outside joins those) longer than `detour` (2) times the straight line between them.
- streets.ts: a town plan's tiles as the generator paves them, the lint walks them and the maps draw them - `lineTiles`
  (a straight run, four-connected), `pathTiles`, `brushOf`, `wayPoints`, `wayMiddle`, `wayTiles` (a way's middle line
  widened by its square brush), `inSquare`, `squareTiles`, `streetTiles`, `inPolygon`.
- grid.ts: `canStep(ground, ax, az, bx, bz)`, the one rule of a step (eight ways, never cutting a blocked corner, never
  over a ledge but a hop straight across, for one who hops) over a `Ground` (`open` tiles, the edges that `pass`, and -
  for one who hops - the edges that are a `hop`), which the A*, the body, the relay, the lint and the generator all walk
  by and the server's `RealmSpace.CanStep` copies; `HOP_COST`; and `Grid`, the square A*, with `setWalkable`,
  `setHeight`, `setRamp`, `raise`, `block`, `heightAt`, `walkable`, `passes`, `hops`, `canStep(from, to, hops = true)`,
  `ground` (a hopper's), `still` (one's who does not hop), `groundFor(hops)`, `path(from, to, hops = true)`.

#### The renderer at world scale

What the renderer does with the interfaces above at the scale of the whole world.

- **The stage** (`render/stage.ts`) is the frame every page runs, the slice's and the game's alike: the `CameraRig`, the
  `Spot` the player is in (a `Framing` with its `place`, `grid`, `doors`, `actors`, `start`, optional `floorAt` and
  `streamer`), walking and doors (`clickTile`, `startDoor`, `arrive`; the slice's iris and camera easing; `Spots.through`
  says where a door leads, and may answer a promise - the iris stays shut until it settles, and opens back on the place
  if it fails), `pick` / `floorTileAt` / `floorPointAt` / `pickFigure`, `tick(dt)` and `render()`. The page hooks `intercept` (a click on
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
  slopes along the axis it is walked on - the one with more ends walked onto freely (a ramp a step up or down, or ground
  no more than a ledge from it), else the one its neighbours differ most on - from the level on one side to the level
  on the other, half-way to a ramp neighbour, so a run of ramps is one even slope; a neighbour more than a level from it
  is a cliff beside it, never an end (a road's ramp along a range's foot slopes along the road). `floorAt(x, z)` is the surface anywhere; figures and grass stand
  on it. **Edges read from every heading** - a bank's face is hidden where the high ground is nearer the camera and
  seen edge on where the bank runs along the view, so the cues are on the ground's top, which always shows: the chunk's
  relief (`reliefMap`: each tile's corner heights, over the ground map's tiles and their border, so edges join across
  chunks) goes to the ground's shader (`render/ground.ts` `EDGES_GLSL`), which finds every texel's drop to each side and
  corner neighbour wherever along the edge it falls - so a ramp, level with the ground at its ends, breaks both cues -
  and paints, counted from the world's anchor so it holds still: along a brink a ragged rim 1.5-4 texels deep (6 over
  a cliff), worn toward its bank's stone (`brink`, art/surfaces/biomes.ts `brinkOf`: paler on grass and sand, packed
  and bluer on snow) with stones of it through, and a lit lip one texel in from the brink (two over a cliff of two levels
  or more); along a foot a shade of the cool shadow's color in two bands, about 5 texels out from a one-level bank and
  8-11 from a cliff; and higher ground a touch lighter and warmer (at level L its color times about 1 + 0.2 L/(L+4),
  more in red than in blue), so two levels never meet in one color. Standing grass keeps off a brink's rim and a bank's foot (`nearBank`). Terrain
  ground is outlined where it stands in front of lower ground (normal-pass kind 0.875) - the brink of a drop away from
  the camera or along the view, just past the lip - and two pixels deep over a cliff (a depth gap of 1.75, between one
  level's 1.06 and two levels' 2.12 at the 45 degree pitch); the lower ground seen just past such a brink is shaded a
  pixel (two past a cliff), so a drop away from the camera reads as lip, line and shadow. `e2e/edges.spec.ts` holds it on the large world's mesas
  (snow, sand, rock and tundra: a two-level cliff, a bank, an inner corner, a ramp) at every heading. For
  the generator: hills as terraces of whole texels (12 is a good step), banks a tile apart, ramps in straight runs; a
  terrace's bank of one level is a ledge the grid walks up to and hops (`HOP`), two levels or more a cliff left by its
  ramps alone. Rooms are still drawn level.
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
  default, so a house's shadow was its walls' alone, with light through every seam between its parts. So a lit face
  is lit against its own depth, and two biases keep it off it (`render/lights.ts`): a normal bias of 0.04 (more than
  seven tenths of the coarsest fit's texel, 0.055) lifts the point it is lit at off the face, so a slope the sun grazes
  never speckles; and a depth bias of 0.01 world units along the sun's beam (`sunDepth` sets it as that share of the
  map's depth) for corners. The depth bias is also how far a shadow stands off what casts it, so it is kept that
  small: as a fixed share of the map's 240 units of depth it was 0.14 units, and lit a strip a texel and more wide at
  the foot of every terrace's face and wall on its shadow side (`e2e/shadows.spec.ts`). The normal bias lifts the
  ground at a foot up the face, never away from it, and leaves no gap. **Lights** of the chunks (fires, lamps) go to a pool of eight
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
  with shops and rooms, a forest, terraced hills with ramps, four mesas of snow, sand, rock and tundra
  (`fixtures/large-world/mesas.ts`), a lake, fields, roads, townsfolk, lamps, spawns), for the
  renderer's tests and benchmark: the game page's `?world=large`. `fixtures/two-world/source.ts` is a world of two
  scales (a 96 by 96 travel map, a town's 96 by 96 grounds in a pocket): `?world=two`, and written as files for the
  realm server's tests by `npm run two-world`.
- **The game page** (`index.html`, `src/main.ts`, `game.ts`, `entities.ts`, `input.ts`, `testHooks.ts`) runs on the
  stage over the generated Domains (`world/realm.ts`), or `?world=slice` / `?world=large` for tests. Positions are
  `{Space, X, Z}`, presence paths `[x, z]` from the open tile the player stands on along the grid's path, speeds at most
  5 tiles a second, nearness Chebyshev. The minimap is the regional map in the world, the town's map in a town, and the
  place's tiles in a room or a run (`Hud.drawMap`, `Hud.drawSquares`); the town's map draws the buildings of the chunks
  loaded (`Hud.chunks`). Dungeon runs are the floors of `dungeon/` (`Overworld.floors`), the
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
  Phyrexian metal), a 32-square picture whose top row is the ground's edge, and `brink`, a light tone of the bank's
  ramp, the stone that shows through the worn rim of the surface's brinks (render/ground.ts).
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
| desert | `dunes` (4.3), `badlands` (3.9) |
| upland | `highland` (5.35; tufts 2) |
| jungle | `jungle-floor` (4.9) |
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
| plant | `heartbloom` | 0.6x0.6 | any |  |  |
| plant | `bush` | 0.8x0.8 **B** | plains, town, forest |  |  |
| plant | `mushroom` | 1x1 **B** | morass, forest, llanowar |  |  |
| plant | `flower-bed` | 1x1 | town, plains |  |  |
| miniature | `peak` | args.w square (1, 3, 5) **B** | mountain, keld, tundra, waste, volcanic |  |  |
| miniature | `grove` | 1x1 **B** | forest, llanowar, swamp, morass, tundra, keld, coast, verdura, waste, plains |  | 90-130 / 28-78 |
| miniature | `town-icon` | args.size square (3, 5, 7) **B** | any |  |  |
| miniature | `landmark` | 3x3 **B** | any | lighthouse: LANDMARK_LIGHTS |  |
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
| sign | `signpost` (args.text: a name board) | 0.3x0.3 **B** | road, any |  |  |
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

###### The travel map's miniatures (`art/props/travel.ts`, `travelTowns.ts`, `travelLandmarks.ts`)

The land outside the towns is a map of the Domains at travel scale, walked by the figure at its usual size (1.6 tiles
tall): its mountains, woods, towns and wonders are miniatures, each over a square of tiles all blocked, `x, z` the
square's middle, drawn in the game's look and seen right at the three headings and three zoom steps (the gallery's
`travel-*` boards). `scale` scales any of them, its square with it (the catalogue's `scaleOf`).

- **`peak`**: `args.w` 1, 3 or 5 tiles across; `args.h` its height (0.9 w + 1: 1.9, 3.7, 5.5); `args.kind` `rock`,
  `snow` (snow above one line, 2.3 up or 0.6 of a lower peak, so a range's line is level), `ice` (blue-grey stone,
  glaciers above 1.5, snow on top), `ash` (dark cinder, a glowing crater from w 3), `sandstone` and `redrock` (banded, in
  rings at their band lines); `seed` its shape: single, twin summits, a shoulder, a spur along its ridge, jagged, or (the
  banded stones) a mesa. A broad foot sunk half a tile (it meets lower ground), slopes steepening to the summit, a ridge
  along a seeded direction: overlapped at their squares' edges, peaks read as one range. 77-270 triangles (the banded
  stones 130-570). Tall: an occluder, its square its footprint.
- **`grove`**: one tile; `args.kind` `broadleaf`, `pine`, `snowpine`, `swamp` (drooping olive crowns, moss, dark
  water), `dead` (bleached snags), `palm`, `jungle`, `elfwood` (one of Llanowar's giants, 2.3-2.5 high, platforms round
  its trunk, a lesser tree beside it: an occluder); `seed` its three to five trees, whose crowns reach past the tile so
  groves side by side are one canopy. 1.3-1.75 high; 90-130 triangles, a far stand-in of 28-78. On a closed tile it is
  never left out at the far zoom (`sortScenery`'s `solid`). Its palette's `leaves` recolors the crowns.
- **`town-icon`**: `args.size` `capital` (7x7), `town` (5x5), `village` (3x3); `args.style` `benalish` (a white keep,
  red-roofed turrets, blue banners; a village, a chapel), `tolarian` (the Academy's copper dome on a marble drum, a
  slender tower), `urborg` (a village: stilt houses over dark water on boardwalks; larger, the Vess manor), `argive` (the
  Vess manor: black stone, slate, spires, dead trees on a dark lawn), `keldon` (turf-roofed longhouses, a great hall with
  horned gables and a fire, a palisade), `llanowar` (giant trees with platforms, leaf-roofed huts, a living hedge),
  `village` (thatch, a well, a windmill); `args.walled` a wall round it, a gatehouse in the middle of each side; its
  streets cross at its middle and run out on all four sides, walled or not; `seed` its houses. 1.1-3.2 high, 76-1450
  triangles.
- **`landmark`**: 3x3; `args.kind` `cathedral` (the Cathedral of Serra: white stone, gold roofs, twin spired towers, a
  rose window, 3.3 high), `great-oak` (the Oak of the Oath, its crown over the whole square, a ring of stones),
  `floating-towers` (three islands of rock hanging 0.85-1.75 up, towers on them, their shadows on the ground below),
  `ruin`, `obelisk` (runes glowing), `arena` (tiers round a floor of sand, gates north and south), `lighthouse` (its
  lantern lit; its light is `LANDMARK_LIGHTS.lighthouse`, added to the chunk's lights as a lit prop's catalogue `light`
  is); turned by `rot`, its front south. 48-940 triangles.
- **`signpost`**: the road sign, one tile; `args.text` a name board under its arrows.
- **Dungeon entrances** keep their ids and draw to the footprint `args.w` by `args.d` they are given (at least half their
  full size; they do not read `scale`). On the travel map: `TRAVEL_ENTRANCES` (art/props/wilds.ts), 3x2 each (`castle-gate`
  5x2), odd widths so the door stays on a tile's middle: a cave mouth 1.7 high, a keep 3.4, a mage tower 4, a crypt 2.3, a
  root hollow 1.4, a foundry 3.2, the Portal 3.
- The existing props the travel map reuses stand at the figure's scale as they are: `stepping-stone`, `boulder`
  (`args.r`), `bush` (`args.r`), `ferry-post`, `ferry` and `waymarker` also honour `scale` about their anchor (the
  registry's `scaledAbout`), as `tilesOf` scales their footprints; `bridge` is an area, its args' rectangle at any scale.

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
- `props`, `lights` (at most 16), the spell-table `npcs` on floor 0, and the run's shrine's (`heart-shrine`) on the
  floor whose `run.Shrine` says it holds one;
- `arrive`, `up`, `down`, `wayOut`, `shrine` and `spots` (`{index, mob, role, x, z}`), all in tiles.

`realms/web/src/dungeon/` is the module (the hex generator is retired); `dungeon/index.ts` exports
`generateDungeonFloor`, `THEME_DEFS`, `assembleFloor`, `gridOfFloor`, `AssembledFloor`, `MAX_LIGHTS`, `wardenIndex`,
`bossIndex` and the types `DungeonFloor`, `FloorRequest`, `RunFloor` (net/api.ts's, the run as the server hands it out),
`Role` and `Spot`. Each theme has its own carver in `themes/`, seeded by `${theme}:${seed}:${floor}`. `finish.ts` places
the run's contract:
- Walking is eight ways, never cutting a corner.
- Every floor tile is reached from the arrival without crossing a stair or the way out. Those are walkable, but walked
  onto only to be taken.
- The warden's index is `Encounters.length` and the boss's is one more.
- A shrine (`dungeon-shrine`, its heart `dungeon-shrine-heart` drawn by the page, lit or spent) stands on a blocked tile
  in a room on the way, against a wall where it can, with open floor before it to pray from, cutting no way off.

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

The world generator (`realms/web/scripts/worldgen/`, `npm run world`, about six seconds) writes Dominaria from
`realms/content/dominaria/geography.json` (the travel map's sketch), `layout.json` (the towns' and dungeons' definitions:
nothing of where they stand), the mob roster and the vendors. `npm run world:map` draws it from above into
`realms/web/e2e/screenshots/world2/`: world.png (the travel map, two pixels a tile, with its labels), zones.png,
terraces.png, close-ups at eight pixels a tile (`close-hurloon-passes`, `close-benalia-coast`, `close-llanowar-rivers`,
`close-the-rip`, `close-sursi-cathedral`) and pockets.png (the whole world file); `npm run world:map -- <dir> crop x0 z0
x1 z1 [scale]` any stretch. The towns' own pictures are the town generator's (`town-preview.ts`).

**The travel map's geography** is `realms/content/dominaria/geography.json`: the Domains at travel scale, 512 by 768
tiles, as authored curves to grow the map from - the coast traced from the classic map (`realms/docs/ref/domains2.jpg`,
untracked) by color at 0.6 tiles a pixel, Walassa, Denawa and Stahaan drawn by hand, and the lakes, rivers, ranges and
their passes, areas of each biome, regions (seeds), towns, dungeons, landmarks, ferries, roads and labels placed from all
five reference maps. `scripts/worldgen/geography.ts` types it (each field's units and what a generator may assume) and
checks it (`geography.test.ts`: closed, simple, clockwise polygons inside a 12-tile sea margin; places on open land in
the landmass and region they name; rivers to the sea, a lake or another river; passes on their crests; every town
reached over roads and ferries; the Hurloons a wall between North and South Aerona but at their two passes; the towns
and dungeons exactly layout.json's). `python tools/realms/geography-map.py` draws it (`e2e/screenshots/world2/
geography.png`, the regions, and the map beside the reference; `--crop x0,z0,x1,z1` a close-up with a tile grid).

**The travel map, grown from the sketch** (`terrain.ts`, `fields.ts`), each layer a field over its tiles:
- **The coast**: a signed distance field of the landmasses' raster (an exact Euclidean distance transform,
  Felzenszwalb and Huttenlocher's), sampled through a domain warp of 1.6 tiles and nudged by fractal noise of 0.7: ragged
  at the tile's scale, every bay, cape, strait and islet where the sketch has it; a neck the noise cut is joined again
  along the sketch's own land; a lone tile of land in the sea goes under. Shallows two tiles out (light,
  green-blue water over a sandy bed: the art's `shallows`), the deep sea beyond.
- **Regions** by the nearest seed on the tile's landmass (distance over weight), the borders waved by noise. **Biomes**
  from the areas painted in order (a region's own biome where none is), sampled through a domain warp of 7 tiles, so a
  border is a wandering, dithered line.
- **Relief** in levels: low at the coast, rising inland (a smoothstep of the distance from the sea over 20 tiles); each
  biome's base height and hill amplitude, box-blurred across its borders, over fractal Brownian motion of gradient
  noise (plains nearly flat, highlands and tundra rolling, mesas for the badlands, ridged dunes for the deserts); the
  ranges as ridged multifractal noise in a band along each crest (wandered a little), their height by the range's (1
  hills, 2 mountains, 3 the great ranges), foothills round them; the rivers' lines wandered by noise and stamped as a
  distance field, their beds graded down to the sea and a floodplain to either side; the lakes' shores graded to them;
  each place's ground levelled. Then the field is smoothed (two box blurs, about a Gaussian of three tiles) and read on a
  lattice of 3-tile cells that slides by noise across the map, so a brink runs straight for a cell before it steps (a
  staircase of bold steps, never of single tiles: 8% of brink edges are single-tile steps, 43% before), cut into whole
  levels of 12 texels, and each level's small tongues and notches taken out by a 5-by-5 majority filter.
- **The ranges are walls**: a range of height 2 or 3 is closed ground in a band along its crest (its edge noisy), its
  tiles two levels at least above their feet, crowned with a few big **peaks** (`wilds.ts` `placePeaks`: blue noise from
  the crest out, peaks 5 tiles square where the band holds one, then 3 between them, each at least 0.65 of their widths
  apart so their feet overlap and their summits stand apart; each the taller the nearer the crest line; its kind the
  range's; a single-tile peak only now and then on a rim). What no peak covers is ground that reads as mountain - rock,
  scree, snow, a boulder here and there - two levels at least above any walked tile beside it, a cliff never come up
  against. A great range (3) opens only at its named passes - a corridor five tiles wide straight across the
  crest, its saddle at the foothills' height - and a road through a pass is routed through it (the sketch's `via`); a
  range of height 2 also opens at gaps where a noise along its crest says, and where a road must cross it the road cuts
  its own gap (dearly: the cost field prefers the way round). Hills (1) are walked over, a low peak here and there on
  their crests.
- **Open ground is terraced for the hop** (`settle`, land.ts): no terrace or pit a tile wide, and no two open neighbours
  more than a level apart - one level is hopped by the players and most mobs (world/grid.ts `canStep`, `HOP`), so the
  hills are no obstacle; the land's walls are the sea, the water and the ranges. Roads, places' grounds and docks are
  held while the land settles round them. Where a road climbs a level, its two tiles across the bank are a ramp (flag
  `RAMP`; `rampWays`). Water tiles (sea, shallows, stream, bog) are holes at their banks' height.
- **Woods and scatter** (`scatter`): groves (`grove`, a miniature clump of trees) by Poisson-disc sampling at tile
  resolution with a radius by how deep into a wood a tile lies (a distance field of the forest and jungle biomes): sparse
  at a wood's edge, thick in its heart; swamp groves over the Morass and Amjad; copses where a noise says in the open
  country. Their kind is the region's woods (Llanowar's `elfwood`, Skyshroud's and Keld's `snowpine`, the Morass's
  `swamp` and `dead`, Verdura's `jungle` and `palm`) or the biome's. Then a sparser blue noise of small things by biome
  (boulders, bushes, reeds by water, ferns, ice rocks) at 0.6 scale. Everything that blocks one tile stands alone - no
  other closed tile in the eight round it - so a wood is always walked through and no scatter ever closes a way.
  Farmland (`farmland`): the country round Benalia's and Sursi's towns cut into fields (a Voronoi patchwork of wheat,
  furrows and meadow).
- **Roads** (`roads.ts`): each of the sketch's roads the least-cost path over a cost field - A* in eight directions, a
  level's rise dearer, a wood by its depth, a river crossed straight (a bridge on a main road, stepping stones on a
  lesser one), cheap along a road already laid (main roads first, so the network merges), never over the sea, a lake, a
  mere or a great range's band - then smoothed by string pulling (straight between two of its points wherever the line
  costs no more) and drawn four-connected. Main roads two tiles wide (`road`), the rest one (`dirt`; `planks` over mud,
  `scree` in the rocks). A **signpost** stands beside each fork, its text the places its roads lead to.
- **Sightlines** (`sightlines.ts`): the camera looks north 45 degrees down, turning 45 degrees either side, so a thing
  h tiles high hides about h tiles of ground behind it to the north, north-west or north-east. South of every tile that
  must be seen - roads, the places' grounds (icons and their ways, entrances, their spell tables and waystones,
  landmarks, the rings round them), docks, signposts, the passes - `clearance` holds how high anything may stand: its
  distance along those three lines, less what its ground stands above the seen tile's. Peaks step down toward such
  places (lower, then smaller, then none: the band's bare rock), groves keep a tile and a half clear (1.75 high) and
  Llanowar's giants (2.5) further. worldgen.test.ts checks it by the art's heights: no peak hides a road, an entrance or
  a town's icon at the front heading.
- **Places** (`places.ts`): each town's `town-icon` (size by its kind, style by its style - a Benalish village's
  `village` - walled by its form) over its blocked footprint at its site, the ring round it open and level; its ways on
  each side a road arrives (never a side the sea lies on), their `outside` the open tile beside the footprint, `to` where
  the road leads (over a ferry, the town beyond it); each dungeon's entrance prop by theme over its footprint
  (`ENTRANCE_ON_MAP`, wilds.ts: 5 by 3 tiles, the tower's and the crypt's 3 by 3, the Portal's 5 by 2 - as big as the
  5-by-5 square allows, so each draws at three quarters of its size or more), facing south toward the
  camera (turned east or west a gate is seen edge on, a pillar), the entrance tile before its front, the spell table
  and a tower's waystone two tiles either side, in the 5-by-5 square the sketch keeps; the `landmark`s (the lighthouse's light in its chunk's `lights`);
  the ferries (a dock on each shore nearest the sketch's place, the lane straight over the sea where it can be, the
  ferryman beside each dock). Each town's `TownSetting` for its grounds comes from the land round its icon: the biome
  there, the sea within 12 tiles on the sides the sketch names (checked: a side the land does not bear out is a note),
  the sketch's river and relief, its ways.
- **One world** (`connect`): the travel map walked as one who hops walks it (`hopSteps`, `hopPieces`) from New
  Benalia's icon; a pocket of fewer than 48 tiles with nothing in it is closed, a bigger one joined by the cheapest way
  through (stepping stones over a river, a dry path over a bog, a notch through a range's band), never over the sea. The
  islets no ferry reaches are closed: only seen.
- **Tiers** (`zones.ts`): every tile's walking distance (hops and the ferries' lanes counted) from the nearest starting
  town's icon - tier 1 within 55 tiles, 2 within 120, 3 within 200, 4 beyond; each 16-by-16 cell of the travel map its
  land's middle distance's tier, never under its region's `minTier`, smoothed twice by the commonest tier round it.
  Waymarkers beside the roads where the tier rises along them, on the harder side, and a few standing stones along the
  rest of each rise.
- **Spawns** (`populate`): about one per 3,500 tiles of land - one at the heart of every region of 400 tiles or more,
  then blue noise 53 tiles apart - on open ground where a mob can wander (its radius of 4 tiles mostly walked ground),
  never within 10 tiles of a town's icon, 6 of a main road in tier 1 country, 8 of an entrance or 6 of a landmark or a
  dock, never in a town's grounds. Their mobs from the roster by tier and the zone's region's color, as before: a
  colorless region (the Hurloons, Sursi, the regions the travel map added) takes any wanderer of its tier. Every
  wanderer is met: one nobody drew joins the two spawns of its tier with fewest mobs.
- **Size and counts** (seed 1997): the travel map `[0, 0, 512, 768]` (16 by 24 chunks, 161,655 tiles of land), the
  towns' grounds packed in columns east of it two empty chunks apart, the world 1568 by 768 tiles, 705 chunk files. About
  1,129 peaks (193,000 triangles, `npx vite-node scripts/peak-triangles.ts`; 7,200 and 1.15 million before the ranges were drawn as a few big peaks), 6,500
  groves, 650 small things, 1,400 tiles of fields, 45 roads (3,600 tiles), 20 signposts, 14 bridges
  and fords, 52 spawns, 27 waymarkers, 36 dungeons (20 mage towers), 8 ferries, 12 landmarks, 69 labels. Walked at 4.2
  tiles a second, the travel map is about three minutes north to south. No chest or heartbloom is placed: the server
  spawns them (interfaces.md, "Finds of the wilds").
- **Towns** stand each in a pocket of grounds at walking scale, laid out whole by the town generator
  (`scripts/worldgen/town/`: `buildTown(land, spec, seed)` into the pocket at `spec.origin`, `groundsSize(plan)`): the
  town within its outline, the country round it that is walked (some 14 to 21 tiles out from what is built, its edge wandering by a noise; to
  the water on the sea's),
  and an apron of scenery 26 tiles deep past that, closed and only seen - whole chunks, 128 tiles square round a village,
  160 round a home town, 192 round the capital. Its plan comes from the **planner of its form** (`town/planner.ts`, the
  seam, its interface documented there: the box it may grow in, the centre, the gates, the south-facing frontages as
  blocks, landmarks' sites, the water; and the planner paints that ground, gives its streets as the world keeps them and
  stands its lights); everything after - the places' solver, the dressing, the country, the terraces, the camera's
  measures and the checks - is the same for every form. Every form is laid by the **amphitheatre planner**
  (`town/amphitheatre.ts`, below), each by its recipe; the **row planner** (`town/rows.ts`) is kept for the forms that
  were rows (capital, city, campus, estate), which fall back on it - noted - on a setting where their grown plan will not
  hold their places. **A town's size is whatever suits it**: its grounds are a pocket of their own, apart from the travel
  map, and the world generator packs the pockets as they come (`worldgen/pockets.ts`, from `groundsSize`). A grown town
  grows over the ground its form sets (`town/forms.ts` `GROWN_SIZE`): the capital 176 by 164 tiles, a home town 104 to
  120 by 98 to 112 (Capashen Hold 116 by 110, Llanowar 120 by 112, the Academy 112 by 104, the Vess estate 108 by 112,
  Keld 104 by 98), a village 72 to 74 by 66 to 70; the country walked round it grows with it (16 tiles and one more for
  every 16 of its size, `walkedMargin`), the apron past that 26. A town of rows keeps its box of 108 by 100 (the capital),
  72 by 72 or 44 by 40 within those grounds. Where the places will not all fit, or a rule breaks, the town is drawn again - a grown one
  with its inn grown by the main way in (between the gate and the centre, by walks along the ways laid) rather than
  beside its head, then at a smaller centre, then over a bigger built area; one of rows pulled in less (0.6, 0.3, then none of its pull), then with rows as
  deep as its great buildings and what they hide, then over a bigger built area - a fixed sequence, never a search over
  seeds; a setting it cannot honour (no way out, a way out over the sea, a river past a sea side) is refused by name.
  Every town is laid out on any setting the travel map may give it: `town/settings.json` holds the sixteen the world
  generator derives (`world.ts` writes it with the world, `town-preview.ts --settings` alone; worldgen.test.ts holds it
  to the generator), and `town.test.ts` builds every form, a home town and a village of each, on a covering matrix of settings
  (`town/preview.ts` `settingsMatrix`: each way alone, the pairs, three and four, the sea on sides with no way, a river on
  each side, through or none, relief 0 to 1, the biomes in turn), all strictly. The wall, palisade or hedge stands on the
  ring round what is built, traced (TownPlan.outline its corners), with towers at its outer corners (a grown town's every
  16 tiles or so) and gatehouses where the roads cross it; the capital's and a city's wall is **designed**: the ground
  they grow over, stepped in at each corner as deep as leaves what stands outside it and set in along a stretch of each
  side, straight curtains between, a tower at every bend, out or in, and a gatehouse on each way - the town grown to fill
  it. Its streets are kept in world.json (`towns[].plan`,
  interfaces.md "Town plans") for the maps and the lint. Wherever a walk between two of the town's places (or from a
  gate to one) would be the long way round, a **footpath** two tiles wide is cut through the yards (`town/passages.ts`:
  a least-cost route, over a town's river by a footbridge, past a handful of unseen tiles only where nothing else will
  do), and the graph is normalized so a path's end on another's middle is a junction. A town is laid out for the camera,
  which looks north from 45 degrees up and never sees a north face:
  - **rows facing south** (the row planner): the town is rows between east-west streets, the stages (3 tiles wide, 4 in the capital).
    Each row's buildings stand along the north side of the street before them, fronts and doors south onto it, their
    gardens behind them as deep as what the buildings hide: each building's model is measured from the art at each
    heading (`town/view.ts`: a point `y` high hides the ground `y` further along the camera's line, thin things such as
    chimneys and spires aside), so no building hides a street, a square or a door. The south side of every street is
    gardens - low - and every piece of garden has a use, by where it lies: a kitchen garden in beds, an orchard in rows, a
    paddock with its hay, a timber yard, a drying green, a flower garden, a churchyard by the temple, or a small green open
    to the street with a bench and a well; fenced on its street side by what suits it (a hedge, a wattle fence, a
    post-and-rail, a garden wall, a palisade). North-south connectors (3 wide) split each row into
    blocks of 11 to 34 tiles, split at a jittered point near the middle and staggered from the row above's, and lanes run
    inside the east and west walls: every block is bounded by streets, every walk loops. The north row is shallow
    (nothing north of it but the wall); gardens and orchards fill the strip inside the south wall;
  - **the square** is the row and the place across it where the walks to every gate are shortest (the main gate's
    counted twice: the south's when there is one), on the axis of a landmark at the north wall where the town has one:
    the row north of it fronts onto it, the rows' ends beside it close its east and west sides, and its south side is
    the street before the next row's gardens, open toward the main gate. It is 12 or 13 tiles deep, seen whole from its
    south edge, its centrepiece, benches, lamps and stalls placed so they hide no door;
  - **gates and arteries**: a gate for each way of the setting, on its side - a south gate on the square's middle
    column, a north gate at its corner (or, the main gate where no road comes from the south, down the square's middle),
    an east or west gate on the square's own street - each artery straight to the square. The main gate is the south's,
    else the first way's. A river through the town runs below the square's south street (its quay), bridged by every way
    across it (below its last row where the town is too small for it among its rows); the sea takes a side's wall and
    gives a quay, piers and moored boats (their decks planks: no open tile of the sea is walked);
  - **the grown towns** (the amphitheatre planner): the site first - the sea's shore kept clear, a stream or river that
    meanders by a noise (through or past the town as the setting says), and for an elfhame the great trees, scattered
    by Poisson-disc sampling and thinned by a noise into clearings; then the centre - a glade, a hall's yard, a green, a
    platform - an ellipse (the platform a rectangle) where a score over the grounds is best (room to the north, level
    ground, clear of the water and the sea, near the middle, in an elfhame among the fewest trees); then the places on
    lots in **arcs concave to the south** round the centre's north, east and west: each arc fitted to an ellipse about
    the centre and sampled to lots stepped along it, the head lot on the axis (the temple, the shrine, the great hall),
    the rest outward east and west in turn (the inn first, on the side of the main way in), each front on the arc over
    the lot's inner edge and a step below the one inside it, so every door is seen from the centre; a path runs along each arc's fronts and jogs down between its
    lots, a spoke from each jog into the centre; a second arc (a home town's) stands behind what the first hides. The
    roads in are laid next, from each side's edge (a clan's or a designed wall's from its line) to the centre or a way
    that leads straight on to it, by least-cost routes over a cost field (the
    lots and what they hide closed, a climb, a tree and water dearer, a way already laid cheaper so paths merge), pulled
    straight where the ground lets them, before anything else grows; what the arcs could not hold is grown outward from
    the paths over a field (nearer the centre and the ways, north rather than south, a shed by the shore, off the rows
    already taken), each lot with its own path joined to the nearest way, and every path that would end at nothing is
    carried on to the next. The outline is traced round what is built (a closing of it); a clan's palisade is an oval
    over its ground, shaved straight only where it meets that ground's edge. The centre and each lot are one terrace each,
    within a level of the centre, the rest eased. The forms: an **elfhame** (Llanowar, Steelleaf Glade, Oneah, Verdura
    Grove) a round glade among great trees, the Grove of Gaea or the shrine at its head, tree-houses round it, dirt paths
    and green lanterns, no wall; a **clan hold** (Keld, Keldon Watch, Foriys) the great hall at the head of a flagstone
    yard, longhouses in a horseshoe round it, a palisade oval, torches; a **village** (Serra's Rest, Avenant, Sursi) a
    green with its well and a pond, houses loosely round it, its lanes cobbled, a hedge where its yards meet the fields; the
    **stilts** (Cabal Crossing) a platform of planks and lesser platforms with arcs of their own, the boardwalks forking
    and joining again, a deck of its own size wherever three meet away from the centre (a stack of crates at its back
    corner, railings round its edge where no boardwalk comes onto it: set apart from the walks), every way a boardwalk
    over the bog, houses on stilts, a lantern at every junction, no enclosure. Llanowar's grove is bigger and denser,
    platforms in half its great trees, and a second glade, **the druids' circle** (standing stones about a fire), with an
    arc of its own; a clan hold on the sea has a **slip** (its first pier, the boat drawn up on it) with its sheds - the
    stores - grown by the shore, and its yards run to drying grounds; a village has a dozen cottages and barns round its
    green. **Lesser centres** (`Quarter`, each a recipe's): a square, close, yard, park, circle, quad or deck placed where
    the ground is free (near the centre, on the high ground, or by a gate other than the main one), a way from its
    south edge and one from its side to the rest, headed by the first still waiting of the roles it wants, its arcs
    holding the queue, the manors or so many extra lots, and dressed as its kind (`dress.ts` `quarters`);
  - **landmarks** take ground across rows first, the streets between cut and connectors either side: the capital's
    cathedral north of its square, its churchyard behind it, and its citadel (a bailey, its gatehouse onto a street, the
    keep and a hall within) at the north wall; the Hold's keep on its rise; the Vess manor at the north end of its walled
    grounds (the family's crypt, graves among dead trees, a drive down to the gate), the estate's village at its gate;
    Llanowar's Grove of Gaea;
  - **the places** (`town/place.ts`): every place the town needs - inn, its vendors' shops, the exotic wares, temple or a
    village's shrine, guildhall, library or (Tolarian) mage's tower, smithy, the houses with a door (10 in the capital, 6
    in a home town, 3 in a village), the arena, the capital's seven manors - is landed by a scored search with
    backtracking over every spot along every block's front: the shops on the square or a block off it, shoulder to
    shoulder, the inn nearest the main gate's walk, the temple commanding the square, the smithy by a side gate or the
    water, the houses spread through the quiet rows; each at two storeys, or one where two would hide a street. The
    districts grow from seeds where those places landed (market, temple, keep, nobles, artisans, harbour, homes,
    gardens: a weighted Voronoi) and build the rest of the fronts their own way, a garden left open now and then, the
    blocks beside the square closing its sides. Every building with a door or a sign faces south; only those without
    may face east or west; none faces north. The town's own buildings take their interiors' ids (`<town>-inn`,
    `<vendor>-shop`, `<town>-guildhall`, `-temple`, `-library` or `-tower`, `-smithy`, `-house-<n>`, a village's
    `-shrine`), landmarks `<town>-citadel`, `-keep`, `-manor`, `-manor-<n>`; the rest are `<town>-b<n>` (a farm's
    `<town>-farm-<n>`);
  - **the country** (`town/site.ts`, `town/country.ts`, `town/terrain.ts`): the land in whole levels rising toward the
    north (away from the sea where there is one) by the setting's `relief`, each row of the town one level, a level at
    most between open neighbours (a hop) and ramps of two tiles where a street or a road climbs; the roads out from the
    gates found by A* over the land (each climb, turn and crossing of water dearer), bridged over a river; fields in a
    jittered patchwork, a farm by a road, a graveyard outside a walled town, woods by Poisson-disc sampling, none of it
    hiding a road near the town; the walked ground's edge closed by hedgerow, wood, palisade or bog everywhere but where
    each road leaves - there the road's tiles across the edge are that way's `exit`, a signpost stands by it, the road
    runs on between hedgerows into the apron, and `inside` is on the road three tiles in;
  - the forms that were rows, grown: the **capital** (New Benalia) a city of quarters - its market square the heart,
    the shops, inn, guild, temple, exotic wares, arena, pitch and quest board on it or just off it, the cathedral at its
    head in its close, the citadel in its own wall at the head of the second ring on the highest terrace; a lesser
    square with the great places it holds; the Seven Houses' close on the high ground, their manors in arcs round it,
    each in its own walled garden with a gate onto the way beside the house (beds and fruit trees in it, walked); the
    smiths' yard by a gate other than the main one, the smithy at its head and workshops round it (anvil, wood, cart,
    barrels); a park (trees round it, a fountain, benches); a river always through it, bending, with a quay along its
    north bank, warehouses grown onto the quay, bridges over it besides the roads' and the designed wall meeting the
    water; houses grown to fill the wall, enterable ones still ten, the rest doors only painted, every one on a way and
    seen. A **city** (Capashen Hold) its square, the keep at the head of its second ring, three rings terraced up the
    rise, more houses grown to fill its designed wall, a quay where its water lies south of it; the **campus** (the
    Academy, Denawa) no wall, its great quad with the mage's tower to one side of its head and lesser quads (three in
    the Academy) with their own arcs of halls (the library's, the guild's), lawns between, a pond in the great quad's
    open ground and a walled physic garden (beds of herbs, its gate in the middle of its front); the **estate** (the
    Vess manor) the manor in its walled grounds at the head of the village green, a longer avenue up to it through a
    formal garden of clipped hedges and graves, the village round the green unwalled and larger. Every form keeps the
    rows' rule for the camera: each front faces south onto a way, nothing tall south of a way;
  - every town is checked as it is made (`town/check.ts`), and fails on any break: its plan's lint (`lintTown`); its
    fronts; the camera (no door hidden at any heading, no street or square tile at the front heading); its square's
    north side fronts (a landmark's wall counts; a round centre's north side is the top of its curve, the fronts there
    within a path's width of it) and its south side open; every place a short walk from the square (48 tiles in the
    capital, 36 in a home town, 22 in a village), the inn no further from the main gate than a little past the square
    or its side across from the way in, places close by never a long way round; every street at least 3 wide, a
    footpath 2; open neighbours a hop apart at most (a ramp is laid only where it climbs); every open tile of the grounds
    walked to from the main gate; each exit walked to; no closed tile one comes up against with nothing drawn there to
    close it (the realm lint's rule: a wall, palisade, hedge or fence closes only the tiles its footprint covers, and what
    the plan closed beyond them is opened again); and the places the town must hold. A grown town also: its head
    building at the head of its centre, fronts round the centre on both sides of its axis, no one row holding most of its
    fronts, from every door to its nearest neighbour's no long way round, and its form's signature (an elfhame's round
    glade among a dozen great trees at least and no wall, a clan's palisade an oval, the stilts' ways all boardwalk, a
    village's green, the capital's quay along its river - twenty tiles of street on its bank at least - and every one of
    its manors in its walled plot, the wall unbroken but at the gate and the gate open onto a way, and in a designed
    wall a tower at every bend away from the gates); and no two towns of one form share half their plan (`town.test.ts`).
    The capital's smithy, at the head of its smiths' yard by a gate, is the one place held to no walk from the square.
    `npx vite-node scripts/worldgen/town-preview.ts` builds the sixteen towns on the travel map's settings
    (`town/settings.json`), draws them from above (`e2e/screenshots/world2/town-<id>.png`, and `towns-sheet.png` all
    of them side by side) and writes them as a world of their own (`realms/web/town-preview/`), which the game opens
    with `?world=towns`; `--matrix` builds every town on its real setting, its invented one and the matrix and prints
    what breaks (`--draw` keeps a picture of each); `TOWN_SHOTS=1` with `e2e/towns.spec.ts` takes their pictures from
    the camera.
- **What players use but nobody walks through** - a quest board, the arena's gate, a spell table, a waystone - is an NPC
  on a blocked tile of its own with `stand` at its middle, and a prop of the same id there to draw it.
- **Dungeon entrances** are props by theme over a blocked footprint (`args.w`, `args.d` from `x`, `z`, facing `rot`),
  the entrance tile before the middle of its front, the spell table and a tower's waystone two tiles either side.
- **Ferry lanes** are sea tiles made open (no other sea tile of the travel map is).
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
duels show the art too. In the card layer's own screens (the spell table, the inventory, the sideboard) a card's note
(copies left, price, relic) is a band under its name across the top of the art, not a veil over the picture. A world
client not signed in is sent to `<server>/signin`, which a server with the development sign-in alone answers with its
form.

### B6. The two layers on one page
- **Two runtimes:** the page shows the three.js world at once and boots the Uno client (about 12 MB compressed) and the engine `.wasm` in the background, in a hidden full-screen layer.
- **Card screens open over the world**, as Fallout's barter screen does. The world pauses while they are open.
  - The screens: duel, sideboarding (a rematch's), spell table (deck and sideboard), vendor, gear found, collection, and gear and paper-doll.
  - Gear is drawn as Vanguard-style oversize cards, using the same face renderer.
- **The bridge:** `window.realmBridge`, using `JSImport`/`JSExport` on the Uno side.
  - Calls in: `openDuel(spec)`, `openSideboard(deck)`, `openSpellTable()`, `openVendor(id)`, `openLoot(gear)`, `openGear()`, `close()`.
  - Events out: results.
- **On the Uno side:** a `?realm` mode in the fork's `Cantrip.Client.Web`, in new partial files (`MainPage.Realm*.cs`) next to the existing ones.
  - The duel uses `WasmRulesHost` with the bot seat in the tab.
  - Deck building reuses the `MainPage.Decks.cs` editor in a collection-limited mode that respects identity and the sideboard; a rematch's sideboarding is the same editor over the last game's deck and sideboard alone.
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
- There is no ante in PvP, as there is none in PvE, unless a later decision adds it; nor hearts, which are PvE's.

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
  | Hearts | the start, the migration, a town's refill, a heart given back, buying to five, death |
  | Hearts found | a heartbloom picked from on or beside it, gone for everyone, left standing with the hearts full; a run's shrine in one run in eight, on its floor alone, once a run |
  | Finds | chests and heartblooms spawned a few to a zone on open ground of the wilds, never at a player's feet, crumbling in their time; a chest's tier gold, gone for everyone once opened (FindsTests) |
  | Losing | a heart and no reward; the buyout's measure, its payment and its refusal in a dungeon; the rematch's carried life and swapped deck; death taking back a run's winnings |
  | Vendors | buy and sell atomicity; a purse too small; a full stock; trickle and rotation on a fake `TimeProvider` |
  | Encounters | spawn-table validation against the golden vectors; a tampered log rejected; a mob answer that doesn't match rejected |
  | Duels | a duel left unfinished becomes a loss |
  | Persistence | storage round-trips |

- **Overworld:** vitest for the grid and its A* (the walk vectors the server checks too), spawn generation (the same golden vectors as the server), the world format, loader and lint (Dominaria's files lint clean and are what the generator writes), the art registries, rooms, dungeon floors, figures and the renderer's pieces, and the in-memory API.
- **Browser end to end:** Playwright in `realms/web/e2e` (B5, "Test hooks"), driving `realmTest` and `cantripTest` with real clicks: `npm run e2e` offline against the in-memory API and the stand-in card layer, `npm run e2e:server` against the realm server, the native engine host and the real card layer.
  - The flow: create a character → walk → engage a mob → the duel → its gold → a vendor sale → spell table edits → a loss, a heart gone, the buyout or a rematch → the last heart lost returns you home, to your inn's door in its town's grounds.
  - The two scales: a journey from one town's inn out onto the travel map and into the next town's by its icon, walked with real clicks; every town's grounds opened at its inn with no void at any heading or zoom; the travel map and towns' grounds swept by held and clicked walks for jumps and pockets; wanderers chasing on the travel map, and one that does not hop stopping at a bank's brink; a dungeon left onto the travel map beside its way in.
  - The duel is forced with a `.cantrip` scenario, never a seed hunt.
  - Two browser contexts see each other move and change gear.
  - Screenshot checks of the world rendering: the void's pixels counted in towns' grounds, the occluder fade, the shadows at a terrace's foot; the tour's pictures for eyes.
- **Load:** headless presence bots (200 clients) against the WebSocket relay.
- **Deployment:**
  - The compose stack runs locally from the published image.
  - A staging environment is deployed by CI, with `/healthz` checked and one rollback to the previous image exercised.
  - Migrations are applied to a copy of the database.
  - A by-hand play-through on the live domain.
