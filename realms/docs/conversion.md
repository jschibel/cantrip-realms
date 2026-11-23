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
| `art/paint/` | the painting toolkit: pixmaps, ramps and palettes, procedural surface painting, text sprites, the material helpers, the mesh builder | foundation, then shared (changes by agreement in this file) |
| `art/recipe.ts` | what every registry is: `Registry`, `Recipe`, `Built` | shared, as `art/paint/` |
| `art/surfaces/` | tiling surfaces by id, per biome | **Art library** |
| `art/props/` | props by id (trees per biome, rocks, fences, lamps, ruins, wares, furniture...) | **Art library** (outdoors), **Interiors & dungeons** (furniture, `indoors.ts`) |
| `art/buildings/` | building recipes by style (one per region) and size, with doors and signs | **Art library** |
| `art/rooms/` | room recipes by interior kind (shop, inn, guildhall, temple, smithy, library, house, tower, exotic wares) | **Interiors & dungeons** |
| `dungeon/` | the dungeon generators per theme, on squares, in the new look | **Interiors & dungeons** |
| `art/figures/` | the figure rig, bodies, palettes, gear parts per slot, every creature model | **Characters** |
| `world/` | the world data format (types, loader, lint), chunk data, pathing across chunks | **World** |
| `game.ts`, `entities.ts`, `input.ts`, `hud.ts`, `screens/`, `net/` | the game around it | **Renderer** (game loop and input) and **World** (data), as today |

Each recipe module is a registry: an id maps to a pure function from a recipe and a palette to meshes and materials.
The world data names ids; nothing in the world data is three.js.

`world/` also still holds the hex world's files (`schema.ts`, `content.ts`, `space.ts`, `world.test.ts`), which the game
page uses until integration retires them; version 2 is `format.ts`, `load.ts`, `lint.ts` and `grid.ts` beside them.
`slice/main.ts` is the slice's page: input, doors, the HUD and the test hooks over the modules below, until integration
makes the game page the slice's.

## Module interfaces (as built in phase 1)

Six agents build on these at once. Change one only as "Rules for every agent" says: the smallest change, backward
compatible, named in the commit and the report.

### `render/` (index.ts lists it all)

The world calls the renderer with a scene of chunks, figures, doors and lights:

- `CameraRig(canvas, heading, zoom, framing)` (camera.ts): the view. It owns the `PixelRenderer` (`rig.renderer`) and
  decides what it sees: `heading` (-1, 0, 1) and `zoom` (0-2 steps out), `viewFor(framing)`, `turn(step, framing)` and
  `zoomBy(step, framing)` (false where refused), `stepTurn(dt, framing)` and `stepZoom(dt)` each frame, `halt()` (a
  door's easing takes over), `settled`, `clampFocus(point, framing)`. A `Framing` is what a place says about how it is
  seen: `{inside, turns, bounds}`. The page keeps the heading and zoom between visits; the rig keeps no storage.
- `PixelRenderer` (renderer.ts): draws a `THREE.Scene` small and shows it in whole pixels; `view`, `setView`, `focus`,
  `snap`, `iris` (a doorway's), `fade`, `setEdges`, `toScreen`, `rayAt`, `readFrame`. `View`, `THREE_QUARTER`,
  `blendViews` are in view.ts.
- `Place` (place.ts): one place as drawn - a `scene` with its ground, its scenery merged into a handful of meshes, its
  cut-aways, flipbooks (flames), scrolling materials (water), standing grass and lights. `addGround`, `addPieces(built[],
  name)`, `addLight(spec)`, `addSun(x, z, reach)`, `addGrass(field)`, `addFigure(root)` / `removeFigure(root)`. Each
  frame: `update(time, yaw, toward)` (grass, water, flames and their light, the walls on the camera's side) and
  `follow(player)` (a cut-away the player stands behind).
- `assembleWorld(world, chunks)` and `assembleInterior(room)` (assemble.ts): the one place world ids meet the art
  registries. A world's loaded chunks become a `Place` and its `doors` (`DoorSpot`: `{tile, step, to, at}`); an interior
  becomes a `Place`, its `doorway` and `bounds`. Phase 1 draws all loaded chunks as one place; the chunk manager calls the
  same recipes per chunk.
- `Actor` (actor.ts): a figure walking a grid - `goTo`, `retarget`, `walkTo`, `stopAfterStep`, `update(dt, player)`;
  `behaviourOf(npc.behaviour)` turns the data's behaviour into its own.
- Underneath: `buildGround` (ground.ts: the ground shader over a block of tiles, texels counted from an `anchor` - the
  world's origin - so blocks join without a seam), `grassField` (grass.ts: tufts per tile, visited row by row),
  `lit`/`glow`/`bandShader`/`textureOf` (lighting.ts: the bands), `normalMaterialFor` (edges.ts: the normal pass),
  `sunlight`, `addLight`, `stepFlicker` (lights.ts), `blobShadow` (shadow.ts).

### `art/paint/` (index.ts lists it all)

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

### The registries (art/recipe.ts)

```ts
type Recipe<R> = (recipe: R, palette: Palette) => Built;
interface Built {
  model: Model;                    // still geometry, world coordinates: merged into the place's scenery
  frames?: Frames[];               // flipbooks: {models, rate}, one shown at a time (flames)
  cutaways?: Cutaway[];            // {full, low, when: {player: rect} | {camera: "east" | "west"}}
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
  `town-wall` (cut-away gate tower), `bridge`, `terrace`, `ruined-tower`; indoors: `hearth` (flames), `candle`, `skull`,
  `bookshelf`, `back-window`, `poster`, `blade-rack`, `shield`, `shop-counter`, `scales`, `coins`, `ledger`,
  `card-table`, `stool`, `rug`, `ossuary`, `buttress`, `tattered-banner`, `torch` (flames), `cobweb`, `crypt-pillar`,
  `fallen-drum`, `crypt-dais`, `brazier` (flames), `candles`, `coffin`, `bones`, `rubble`. Each entry's `about` says
  where its anchor is and what its `args` are.
- `BUILDINGS: Registry<BuildingData>` by style (art/buildings): `benalish` (kinds `house`, `shop` - `params`: `ground`,
  `upper`, `roof` tile|slate, `rise`, `chimney`, `wall` limestone|plaster, `openings` [{at, kind: door, shopDoor, window,
  windowUp, display, banner, bannerUp, sign, lamp}] - and `mausoleum`). `placeBuilding(building, draw)` lays a style's
  drawing (facing south on its footprint) out at the building's `rot`, its doorway turned with it.
- `ROOMS: Registry<InteriorData>` by interior kind (art/rooms): `shop`, `crypt`. `roomShell(builder, spec)` draws the
  back and front walls and returns the side walls as camera cut-aways; `exitGap(entry.x)` is the exit's two-tile gap.
- `SURFACES` (art/surfaces): `defineSurface(id, about, palette, (palette) => {picture, priority, hole?, under?,
  tufts?})`; `SURFACES.look(id, palette?)`. Ids: `grass` (tufts 3), `cobbles`, `flagstones`, `dirt`, `straw`,
  `furrows`, `wheat`, `stream` (a hole, water under), `floorboards`, `hearthstone`, `crypt-floor`.
- `FIGURES` (art/figures): `defineFigure(id, about, palette, (palette, seed) => FigureSpec, seeded?)`;
  `figureSpec(id, palette?, seed?)`. Ids: the slice's `hero`, `knight`, `grizzlegom`, `goblin`, `skeleton`, `ghoul`,
  `townswoman`, and (phase 2, seeded) `townsfolk-<region>` and `guard-<region>` for `benalia`, `orvada`, `caligo`, `keld`,
  `llanowar`, `shopkeeper`, `innkeeper`, `ferryman`, `planar-trader`. Mobs, players and gear are their own registries
  beside it (see "Characters" below).

### Figure specs (art/figures/rig.ts)

A `FigureSpec` is `{name, parts: PartSpec[], stride?, armSwing?, hunch?}`. A `PartSpec` is a box of `size` texels
`[w, h, d]` on a pivot `at` (texels, on its `parent` part or the body), the box at `box` from the pivot, its six faces
painted (`faces`: `front`, `back`, `left`, `right`, `top`, `bottom`, each a `Paint` - `(pixmap) => void` - unpainted
faces filled with `fill`), with an optional fixed `tilt`, `round`ing and head `shape`. Every rig has `leg.l`, `leg.r`,
`torso`, `arm.l`, `arm.r` and `head` (the walk swings them; `cape`, `ear.l`, `ear.r` move too). `new Figure(spec)`
packs the faces into one picture per spec `name` (its material: a palette's look needs its own name, which `figureSpec`
gives it), and animates with `update(dt, speed)`, `face(dx, dz)` and `setLean(angle, pitch, yaw)`. Painting helpers are
faces.ts (`cloth`, `layer`, `rows`, `stamp`, `hairRows`, `hairAll`, `hairCrown`, `spikes`); the cast is cast.ts. Colors
`GHOUL_EYE` and `BONE_EYE` glow wherever painted.

### `world/` (three-free)

- format.ts: the version-2 types below, and `chunkOf`, `chunkKey`, `parseChunkKey`, `worldRect`, `viewBounds`,
  `chunksOver`, `chunkTile`, `interiorArea`, `interiorTile`, `heightOf`, `isBlocked`, `isBare`, `frontStep`.
- load.ts: a `WorldSource` (`globSource` over Vite's `import.meta.glob`, or `fetchSource(baseUrl)`), `loadWorld`,
  `loadChunk`, `loadChunks(source, world, rect?)`, `loadAllChunks`, `loadInterior` - each file checked as it comes, a bad
  one a `WorldFormatError` - and the walkable `Grid`s: `gridOfWorld(world, chunks)`, `gridOfInterior(room)`.
- lint.ts: per file, `checkWorld`, `checkChunk`, `checkInterior`; the whole, `lintWorld(world, chunks, interiors,
  known?)`, with `known` the art's ids (and its props' and buildings' own checks) so the lint stays three-free.
  art/registries.test.ts builds `known` from the registries and lints the sample with it.
- grid.ts: `Grid`, the square A* (eight ways, never cutting a blocked corner), with `setWalkable`, `setHeight`,
  `raise`, `block`, `heightAt`, `walkable`, `path`.

## The world data, version 2 (`realms/content/dominaria/world`)

Types in `realms/web/src/world/format.ts`; the sample is `realms/web/fixtures/slice-world`.

- `world.json`:
  - `{size: [width, height] (tiles), origin?: [x, z] (default [0, 0]), chunk: 32, tile: 1 (world units), bounds?:
    [x0, z0, x1, z1]}`: the world's tiles are `size` from `origin`; `bounds` (default the whole world) is where the
    camera keeps its view - tiles past it are scenery seen from a corner (the sample's wood round its edges). Dominaria
    keeps `origin` [0, 0] and no `bounds`.
  - plus the existing content: `regions` (`{color, name, tiles}`), `towns` (with `style`, `center: [x, z]`, `radius`,
    `start`, `home`), `inns` (`{id, town, x, z, interior}`), `dungeons` (`{id, x, z}`), `ferries`, `pitches` (`{town, x,
    z}`), `roads` (`{from, to, tiles}`), `zones` (the tier grid: squares of `cell` tiles from the origin), `overview`.
  - Every position is `[x, z]` in tiles, with x east and z south; an entity in a list has fields `x` and `z`.
- `chunks/<cx>_<cz>.json`, 32 by 32 tiles, chunk (cx, cz) holding x from `cx * 32`, likewise z (negative chunks are
  named `-1_0.json`):
  - `tiles`: one entry per tile, `[height, surface, flags]`, row by row (z then x), so a chunk is 1,024 entries.
    `height` is in texels (a sixteenth of a tile, so a dais of 3/16 is 3 and a terrace of 3/4 is 12), `surface` a
    surface id or `""` (nothing: not drawn, never walked), `flags` 1 blocked, 2 bare (nothing grows up off it - no
    standing grass under a tree or a house). A tile past the world's edge is blocked.
  - `props`: `[{id, x, z, y?, rot? (0..3), turn? (radians), scale?, tint? (a palette name), seed?, args?}]`. `x`, `z`
    (and `y`) are world units, fractions allowed: the prop's anchor, as its registry entry says; `args` are its own
    (a line's far end `to`, a crate's `goods`). A prop belongs to the chunk its anchor is in.
  - `buildings`: `[{id, style, kind?, x, z, w, d, rot, door?: [x, z], interior?, sign?, palette?, params?}]`, the
    footprint `w` by `d` world units from (x, z) (fractions allowed), the front toward `rot` (0 south, quarter turns
    clockwise), `params` the style's choices. The door tile is walkable; a door with no `interior` is only painted.
  - `npcs`: `[{id, x, z, kind, name?, vendor?, tower?, ferry?, text?, figure?, palette?, behaviour?, speed?, seed?,
    stand?}]`: `figure` and `palette` its look, `behaviour` `{wander?: {home, reach, pause}, beat?: {stops, pause},
    watch?, rest?}` (tiles), `speed` tiles a second, `seed` makes its wandering the same every visit, `stand: [x, y, z]`
    where it stands when not on its tile's middle (a vendor on a crate). Kinds add `ambient` (only there to be seen).
  - `spawns`, `chests`, `entrances`, `waymarkers`: as before, in tiles (`{x, z, ...}`).
  - `lights?`: `[{kind: point | spot, at: [x, y, z], color: [r, g, b] (linear, 0-1), intensity, reach, decay?, to?,
    angle?, penumbra?, shadow?, flicker?: {base, steps, rate, phase?}}]`: a fire, a candle, a window's daylight. A
    flicker's intensity is `base + steps[(floor(time * rate) + phase) % steps.length]`, in step with the flames.
- `interiors/<id>.json`:
  - `{id, name, kind, town?, style, w, d, area?: [x0, z0, x1, z1], tiles, props, npcs, lights?, entry: [x, z], exit:
    [x, z], params?}`: the floor is `w` by `d` tiles from (0, 0); `tiles` cover `area` (default the floor), so an area
    may reach past the floor where something is drawn (the sill of the front wall's gap); props may stand against the
    walls, a tile past the area. `entry` is the room's tile at its door (stepping onto it leaves; one arrives a step in,
    north); `exit` the world tile one comes out on, the door tile of the building that leads in. The exit is in the
    front (south) wall, the gap two tiles wide with `entry` its east tile.
  - Kinds: `shop`, `inn`, `guildhall`, `temple`, `smithy`, `library`, `house`, `tower`, `exotic-wares`, and `crypt`
    (the sample's crypt is a fixed interior; the game's crypts are dungeon runs).
  - the room is laid out by its recipe, and the file holds what the generator chose: its furniture is its `props`,
    its fires' and windows' light its `lights`.
- `dungeons/<id>.json`: as before, but `entrance` is `[x, z]`. A run's layout is the browser's, on squares.
- Spawn ids stay `"<cx>_<cz>:<n>"`. The spawn algorithm is unchanged, and its golden vectors hold.

### Changes from the first draft of this section (phase 1)

- Heights are in texels, not quarter-units: the crypt's dais (3/16, 6/16) needed it.
- A tile's third field is `flags`, 1 blocked and 2 bare: whether grass stands on a tile is not whether it is walked
  (the wood past the sample's edge has grass; a lawn under a tree has none). 0 and 1 mean what `blocked` meant.
- `world.json` has `origin` and `bounds`; chunk coordinates may be negative. The sample needs both to keep the slice's
  tile coordinates and its camera exactly (Dominaria uses neither).
- Props take `y`, `turn`, `seed` and `args`, and `x`, `z` in world units; `tint` names a palette. Buildings take `kind`,
  `palette` and `params`, `door` and `interior` are optional, and their sizes are world units.
- NPCs take `figure`, `palette`, `behaviour`, `speed`, `seed` and `stand`; kind `ambient` is new.
- Chunks and interiors take `lights`. Interiors take `id`, `name`, `town`, `area`, `lights` and `params`; `exit` is
  `[x, z]` like every other lone position.
- Interior kinds add `crypt`.

## Adding to the art

- **A surface:** paint its picture in `art/paint/textures.ts` (64 by 64, seamless, seeded), then `defineSurface` it in
  `art/surfaces/index.ts` with the ramps it paints from as its palette and a `priority` among its likely neighbours
  (the higher grows over the lower: grass over paths over cobbles over flagstones; a room's floors alike). Give it
  `tufts` if grass stands on it, `hole` and `under` if it is water.
- **A prop:** draw it in `art/props/draw.ts` (or beside its definition) on a `MeshBuilder` in world units, then
  `drawn(id, about, draw, palette?, needs({...}))` it in `art/props/outdoors.ts` or `indoors.ts` (or a new file imported
  by `art/props/index.ts`). Read its `args` with `num`, `bool`, `str`, `point`; return `{frames}` for flames,
  `{cutaways}` for what must drop out of the player's way. Draw in world coordinates (tiled faces follow the world's
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

## What phase 2 should know

- **The sample world** is `realms/web/fixtures/slice-world`: world.json (the street, its country, the margin of wood:
  136 by 78 tiles from `[-78, -24]`, `bounds` the 100 by 42 walked), 15 chunks and the interiors `shop` and `crypt`.
  It is the source now - its scene code is gone - so edit the JSON (by a script if large). `slice.html` loads it through
  `globSource`, `assembleWorld` and `assembleInterior`; its frames were checked pixel for pixel against the scene code's
  in 32 states (every scene, heading and zoom step, walking, a doorway's iris, the cast).
- **Pixel-exact comparisons** of the slice need the figures' clocks held: `Figure` and the townsfolk draw on
  `Math.random`, and three.js names every object it makes with it, so a seeded `Math.random` alone shifts with any
  change in what is built. Seed by caller (a stream for `new Figure`, one for `Actor`, one for the rest).
- **Draw order:** three.js sorts opaque meshes by material id (creation order), so where two faces of different
  materials lie in one plane the later material wins. The slice has a few such faces (a gravestone's picture over its
  stone). Merging per chunk keeps materials in first-use order; avoid coplanar faces in new art.
- **The ground** is drawn per block of tiles, its texels counted from the world's origin (`buildGround`'s `anchor`),
  so chunks drawn apart join without a seam. Standing grass is laid out row by row over the world; per chunk it would
  stand elsewhere (it is random), which is fine.
- **Heights** in the tiles are walked (and grass stands at them), but the ground is drawn flat: a rise is a prop
  (`terrace`). Drawing terrain from heights is the Renderer's.
- **Palettes** are threaded through the Benalish house (stone, plaster, roof, timber, darkTimber), trees, bushes and
  hedges (leaves), surfaces whose painters take a ramp (flagstones, hearthstone), the shop's walls and every figure's
  main slots. The rest paint their own colors still: parameterize as you add styles.
- **Buildings turned** (`rot` 1 to 3) are drawn about their footprint's middle; the slice has none, so nothing has been
  looked at that way yet.
- **Rooms** are seen from the south, their exit in the front wall: a room recipe for another plan needs `Framing` and
  the door's step from the data.
- `render/assemble.ts` puts all loaded chunks in one `Place`; the chunk manager should keep `Place` per chunk (or
  `addPieces` per chunk) and use `assembleWorld`'s per-chunk loop as its model.

## Characters (phase 2, as built)

The Characters agent's `art/figures` (interfaces.md "Models" is the reference):

- **The rig** (rig.ts) gained part motions (`motion`: a quadruped's `leg`s in diagonal pairs, `wing`s that beat, a
  `tail` or a body of segments that sways, `bob`, an `orbit`ing relic, a cast's `spark`), `glow`ing parts, `hover`, a
  walking `lean`, `flies` (wings beating standing too), `leans` (how much of the sprite lean a long four-legged body
  takes), a tilt about y as well (coils curling round), a shadow's `footprint` (tiles; the Actor's `blobShadow(0.42)` should take `spec.footprint ?? 0.42`),
  and two actions: `figure.act("cast" | "interact", seconds?)` and `figure.acting`. The slice's seven figures use none of
  it and move exactly as before.
- **Players:** `playerFigure({body, palette, identity, slots})` (player.ts), and `lookFigure(Look, Identity)` for presence
  (`Look` as relayed; ring slots `ring1`/`ring2`). Integration replaces character.ts's voxel bodies with these.
- **Mobs:** `mobFigure(model, id, creature)` (mobs.ts): the client should pass the mob's id and its `creature` (the card's
  name, from the mob file), which choose variations. `mobs.ts` (the old `mobInfo`) needs `creature` added to `MobInfo`.
- **NPCs:** the World agent's generator may name the NPC figures above with a `seed` each (and a `palette` of `cloth`,
  `trim`, `skin`, `hair`). The slice page still calls `figureSpec(n.figure, palette)` without the seed: integration
  passes `n.seed`.
- **Content:** every mob of `realms/content/dominaria/mobs` has a new `model` (mesh and palette; sizes kept), chosen for
  what its creature is (Hurloon Minotaur a `minotaur`, Mesa Pegasus a `pegasus`, Sengir Vampire a `vampire`, the
  bosses their own). `tools/realms/sample-decks.py` writes these files and still holds the old meshes (`MESHES`,
  `MESH_BY_TYPE`, `PALETTES` and its `model=` overrides): **before it is run again, its owner must give it the new
  models** (the table is in the mob files as they are now), or it will write the old ones back.
- **Server (a minimal change in the Server agent's module):** `RealmContent.MobMeshes` lists the new mob meshes.
  The gear check still reads `realms/content/models` (gear models); the new gear parts (`crown`, `hood`, `hat`,
  `cloak`, `gauntlets`, `greaves`, `orb`) can be named by content once that check is a list, as MobMeshes is.
- **The cast page:** `realms/web/cast.html?set=bodies|identities|gear|parts|creatures|roster|bosses|mages|npcs`, with
  `heading`, `zoom`, `face=front|angle|side`, `walk`, `act=cast|interact`, `ground`, `compare` (the slice's knight and
  goblin first on each page, the yardstick); four-legged beasts stand three-quarters on unless `face` says; `e2e/figures.spec.ts` renders every
  page, `FIGURE_SHOTS=1` writes its pictures to `e2e/screenshots/figures`.

## The server (`realms/dotnet`)

Positions are tiles `{Space, X, Z}`. A walk is eight-way steps with no corner-cutting past a blocked tile. Presence
paths are `[[x, z], ...]`. Walking speed is in tiles a second. Every check that was on hexes is on squares.
`interfaces.md` is updated by the **Server** agent in the same commits, and the **World** agent's format is its input.

## Phases

1. **Foundation** (one agent, alone) - done:
   - Move the slice's code into the layout above with no change in behavior: `slice.html` still works and its e2e still
     passes.
   - Write the `world/` format types and a loader for version 2.
   - Write a tiny version-2 sample world (the slice's street, the wilderness and the shop) that the slice page loads from
     data instead of from its scene code. That proves the format end to end before anyone builds on it.
   - As built: "Module interfaces", "Adding to the art" and "What phase 2 should know" above.
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
