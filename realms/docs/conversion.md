# Cantrip Realms - converting the world to the slice's look

The owner chose the art slice (`realms/web/src/slice/`, `slice.html`) as the game's look and asked for the whole world to
be built in it. This is the plan, and the contract the agents doing it work to. When it is done, the slice's code has
become the game's, `slice.html` and the hex renderer are gone, and this file is folded into tech.md B5 and interfaces.md.

## What the game becomes

- **The look** is the slice's: low-poly 3D with textures painted by code, drawn small and scaled up in whole pixels;
  light quantized into colored bands (warm sun, cool shade, orange firelight); soft outlines in each object's own
  darkened color; swaying grass; figures leaning back toward the camera as SNES sprites face it.
- **One camera:** three-quarter (pitched 45°, stretched by 1/sin 45° so a floor texel is one scene pixel). It has three
  headings, front and 45° to either side and never further round, so nothing is drawn from behind, turned with Q/E or
  the ⟲/⟳ buttons. Stepped zoom outdoors (whole-number screen-pixel scales only; mouse wheel, +/−); rooms and dungeons
  stay at the closest step.
- **Movement:** click to walk, and hold to keep walking toward the cursor. It re-paths when the cursor is more than 1.25
  tiles from the path's target, with a 0.1 s cap for slow drift. Doors and gates are entered only by a click, or by
  holding still on them.
- **Square tiles, eight-way walking**, never cutting a corner past a blocked tile (`slice/grid.ts`). **Hexes are retired
  everywhere**: the client, the content, the server, presence and the tests.
- Everything else in design.md stands: one connected world of the Domains, towns with interiors entered seamlessly,
  dungeons generated in the browser per theme, tiers visible on the map, waystones, ferries, caravans, presence.

## The module layout (`realms/web/src`)

| Module | What it is | Owner (phase 2) |
| --- | --- | --- |
| `render/` | the renderer: pixel target and upscale, camera (headings, zoom, texel snapping), band lighting, the edge pass, the ground shader, grass, shadows, chunk manager, cut-aways, door transitions | **Renderer** |
| `art/paint/` | the painting toolkit: pixmaps, ramps and palettes, procedural surface painting, text sprites, the material helpers | foundation, then shared (changes by agreement in this file) |
| `art/surfaces/` | tiling surfaces by id, per biome | **Art library** |
| `art/props/` | props by id (trees per biome, rocks, fences, lamps, ruins, wares...) | **Art library** |
| `art/buildings/` | building recipes by style (one per region) and size, with doors and signs | **Art library** |
| `art/rooms/` | room recipes by interior kind (shop, inn, guildhall, temple, smithy, library, house, tower, exotic wares) | **Interiors & dungeons** |
| `dungeon/` | the dungeon generators per theme, on squares, in the new look | **Interiors & dungeons** |
| `art/figures/` | the figure rig, bodies, palettes, gear parts per slot, every creature model | **Characters** |
| `world/` | the world data format (types, loader, lint), chunk data, pathing across chunks | **World** |
| `game.ts`, `entities.ts`, `input.ts`, `hud.ts`, `screens/`, `net/` | the game around it | **Renderer** (game loop and input) and **World** (data), as today |

Each recipe module is a registry: an id maps to a pure function from a recipe and a palette to meshes and materials.
The world data names ids; nothing in the world data is three.js.

## The world data, version 2 (`realms/content/dominaria/world`)

- `world.json`:
  - `{size: [width, height] (tiles), chunk: 32, tile: 1 (world units)}`;
  - plus the existing content: `regions`, `towns` (with `style`, `center`, `radius`, `start`, `home`), `inns`, `dungeons`,
    `ferries`, `pitches`, `roads`, `zones` (the tier grid), `overview`.
  - Every position is `[x, z]` in tiles, with x east and z south.
- `chunks/<cx>_<cz>.json`, 32 by 32 tiles:
  - `tiles`: one entry per tile, `[height, surface, blocked]`, row by row (z then x), so a chunk is 1,024 entries. `height`
    is in quarter-units, `surface` a surface id, `blocked` 0 or 1.
  - `props`: `[{id, x, z, rot (0..3), scale?, tint?}]`.
  - `buildings`: `[{id, style, x, z, w, d, rot, door: [x, z], interior, sign?}]`, where the door tile is walkable.
  - `npcs`, `spawns`, `chests`, `entrances`, `waymarkers`: as before, in tiles.
- `interiors/<id>.json`:
  - `{kind, style, w, d, tiles, props, npcs, entry: [x, z], exit: {x, z}}`;
  - the room is laid out by its recipe, and the file holds what the generator chose.
- `dungeons/<id>.json`: as before. A run's layout is the browser's, on squares.
- Spawn ids stay `"<cx>_<cz>:<n>"`. The spawn algorithm is unchanged, and its golden vectors hold.

## The server (`realms/dotnet`)

Positions are tiles `{Space, X, Z}`. A walk is eight-way steps with no corner-cutting past a blocked tile. Presence
paths are `[[x, z], ...]`. Walking speed is in tiles a second. Every check that was on hexes is on squares.
`interfaces.md` is updated by the **Server** agent in the same commits, and the **World** agent's format is its input.

## Phases

1. **Foundation** (one agent, alone):
   - Move the slice's code into the layout above with no change in behavior: `slice.html` still works and its e2e still
     passes.
   - Write the `world/` format types and a loader for version 2.
   - Write a tiny version-2 sample world (the slice's street, the wilderness and the shop) that the slice page loads from
     data instead of from its scene code. That proves the format end to end before anyone builds on it.
2. **In parallel**, each agent in its own worktree, each touching only its modules:
   - **Renderer:** the world at scale: chunk streaming, scenery merged per chunk, shadows that follow the camera,
     cut-aways, LOD for the far zoom step, door transitions to interiors, performance budget (60 fps at 1080p on a
     mid-range laptop's integrated GPU, measured).
   - **World:**
     - the generator on squares: the Domains' layout, biomes, roads, rivers and coasts, towns laid out with buildings by
       style, and props by biome;
     - chunk data version 2, the lint, the tier zones, and pathing across chunks;
     - the overworld game logic moved onto it (spawns, mobs, chests, waymarkers, ferries, caravans).
   - **Art library:**
     - surfaces for every biome (plains, farmland, forest floor, swamp and morass, tundra and snow, mountain rock,
       coast and sand, the desolate waste, Phyrexian ground) and road kinds;
     - props per biome;
     - a building style per region (Benalish stone and banners, Llanowar tree-houses, the Morass's dark stilt-houses,
       Keldon longhouses, Tolarian domes, the Vess estate), each in several sizes, with doors, signs and wares.
   - **Interiors & dungeons:** a room recipe per interior kind, and the seven dungeon themes (caves, castle, tower, crypt,
     hollow, foundry, portal) on squares in the new look, with exactly the run's encounters, as now.
   - **Characters:**
     - the player bodies (4) and palettes (6) on the new rig;
     - gear as painted parts per slot, with each gear item's `look` mapped onto them;
     - every creature the roster names (its `model.mesh` ids, adding those it lacks: dragon, bird, beast, cat, merfolk,
       insect, treefolk, serpent, giant, wizard, knight, minotaur, orc, pegasus...), with their palettes;
     - looks for presence.
   - **Server:** the port to squares (positions, walk checks, presence, spawns and runs), the loader for version 2, and
     every test.
3. **Integration** (one agent): merges the six, retires the hex code and the old renderer, and makes the game page the
   slice's. Gets every suite green: server fast and WallClock, vitest, typecheck, offline e2e, e2e against the server,
   and the card layer's realm screens. Then retakes the screenshots of every region, town, interior and dungeon theme.

## Rules for every agent

- Work only in your own worktree and branch, touch only your modules, and keep `slice.html` (until integration) and the
  game page building. If you need a change in another agent's module or in `art/paint/`, make the smallest one, say so
  in your commit and your report, and keep it backward compatible.
- Tests run on the manual clock, never wall-clock waits. Screenshots of what you made go under
  `realms/web/e2e/screenshots/<your area>/`.
- Pin versions. No downloaded assets: everything is painted by code, as in the slice.
- Report concisely: what you built, test counts, images, and what integration needs to know.
