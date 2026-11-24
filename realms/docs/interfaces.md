# Cantrip Realms - interfaces

What the realm's parts agree on: the content files, the server's HTTP API, the presence protocol and the spawn
algorithm. `design.md` is the game, `tech.md` how it is built; this is the contract between the overworld
(`realms/web`), the card layer (`?realm` in `Cantrip.Client.Web`), the realm server (`realms/dotnet`) and the gear in the
engine (the gear's card files, realms/docs/gear.md). A change here changes every side that reads it, in the same commit.

All JSON is UTF-8, PascalCase on the wire between C# and anything else (as `Cantrip.Protocol` is), camelCase in the
content files (as `content/mtg/cards/*.json` is). Gold is an integer. Times are UTC ISO-8601.

## Content (`realms/content`)

Everything here is data, read by the server at start and by the overworld at build time (`realms/web` imports what it
draws). Ids are kebab-case and never reused.

### Cards, planes and pools (`cards.json`, `planes.json`)

The realm's own card database, in this fork only: `cards.json`, written by `tools/realms/card-economy.py` from Scryfall's
default-cards file, one record per card the engine has, in name order, a record a line:

```json
{ "source": "...", "surcharge": {"common": 0.5, "uncommon": 1.0, "rare": 5.0, "mythic": 10.0}, "cards": [
{"name":"Llanowar Elves","origin":"dominaria","planes":["dominaria"],"sets":["lea","leb","2ed","..."],"usd":0.19,
 "rarity":"common","gold":69,"vintage":"legal","identity":"G","types":["Creature"],"subtypes":["Elf","Druid"],
 "universesBeyond":false,"relic":false}
] }
```

- `origin` is the plane of the card's first paper printing, by release date; `"multiverse"` when that printing places it
  on no plane; null for a card never printed on paper. `planes` are every plane it has been printed on, in planes.json's
  order; `sets` its paper set codes, oldest first.
- A printing places its card on its set's plane (planes.json's `planes[].sets`), except in a set of one of
  `reprintSetTypes` (core sets after Beta, Masters, Commander, Secret Lair, promos, ...), where only the card's own first
  printing does, and only when a plane lists that set (Alpha and Beta, and Dominaria's Commander decks, are
  Dominaria's). Sets of many planes (`ignoredSets`, each with why) place none, and Universes Beyond printings
  (`universesBeyondSets`, or the triangle security stamp) are left out of every price and plane. Every expansion and
  draft-innovation set Scryfall lists is placed, ignored or known as Universes Beyond: the script refuses to write while
  one is not, so a new set can't slip in unplaced.
- `usd` is the median TCGplayer market price of its paper printings (the lower middle of an even number, so a real
  printing's), `rarity` that printing's, `gold` the list price, `round(100 x (usd + surcharge))` (design.md A5); all three
  null for a card with no paper price.
- `vintage` is its Vintage legality (`legal`, `restricted`, `banned`, `not_legal`) and `identity` its color identity
  (WUBRG letters), Scryfall's: the realm deals by them - its pools, its deck checks and `/api/catalog`'s legalities and
  identities - in place of `content/mtg/legality.json`, which lags the cards the engine has.
- `types` and `subtypes` are its front face's, for vendor specialties: the engine's own (the catalog's) agree.
- `universesBeyond` marks a card printed only in Universes Beyond, `relic` one of `relics.json`.

A card is **dealt** - in reach of vendors, loot and starter decks - when it is legal or restricted in Vintage, priced,
not Universes Beyond and no relic. **The pools are views of `cards.json`, computed by the server as it loads** (and the
same way by the tools, `tools/realms/realm_cards.py`); there are no pool files:

- a walked plane's pool (planes.json's `"walked": true`: Dominaria) is every dealt card printed on it but the basic
  lands, which are free (design.md A1);
- the off-plane pool is every dealt card printed on no walked plane (no basic land), with its planes (perhaps none): the exotic dealers'
  wares (Vendors, below).

### Relics (`relics.json`)

```json
{ "relics": [{ "card": "Black Lotus", "bosses": ["phyrexian-praetor"], "chance": 0.02 }] }
```

The cards that drop only from bosses, at most once per account ever (design.md A3a). `card` is a card the engine
plays. `bosses` are the mobs (each `"boss": true`) it drops from. `chance` is its chance on each win against one of
them: more than 0, at most 1. A relic is in no pool, so no vendor stock, loot offer, starter deck or mob deck holds one.
The server refuses to start if a pool lists one, a starter deck holds one, or an entry names no boss.

### Gear (`gear/*.json`, one file per item)

```json
{
  "id": "circlet-of-foresight",
  "name": "Circlet of Foresight",
  "slot": "head",
  "rarity": "uncommon",
  "gold": 1200,
  "stats": { "life": 0, "hand": 0, "maxHand": 1 },
  "effects": [{ "family": "draw-on-turn", "turn": 4, "count": 1 }],
  "text": "Your maximum hand size is increased by one.\nAt the beginning of your draw step, if it's your fourth turn, draw a card.",
  "look": { "mesh": "circlet", "palette": ["#f1b44c", "#5b8fd6"] },
  "unique": false
}
```

- `slot` is one of `head`, `neck`, `body`, `hands`, `feet`, `ring`, `relic` (a ring fits either ring slot).
- `stats` change the setup values (design.md A1): `life` the starting life, `hand` the starting hand size, `maxHand` the
  maximum hand size; negative refunds points.
- `effects` are the item's abilities, each an effect family and its parameters (`turn`, `count`, `mana`, `token`: gear.md's
  table). The engine has one emblem definition per item, named `"<name> (gear)"`: a card file generated from this file by
  `tools/realms/gear-cards.py`, which refuses an effect its slot may not carry or points over its rarity's budget. An item
  with no effects has none.
- `text` is what the item does in words: its stat lines, then its effects' rules text, as the generator writes it (it
  rewrites a `text` that differs).
- `gold` is what an armorer sells it for; it buys at half.
- `points` is what the item costs of its rarity's budget (gear.md, "Budgets": its stat lines' and effects' points,
  refunds subtracted), as the generator writes it beside `text`; the server refuses an item over its budget.
- `look` is how it shows on a character: a gear mesh (Models, below) and its palette.

### Mobs (`<plane>/mobs/*.json`)

```json
{
  "id": "llanowar-elves",
  "name": "Llanowar Elves",
  "creature": "Llanowar Elves",
  "region": "G",
  "tier": 1,
  "deck": "decks/realms/dominaria/llanowar-elves.txt",
  "stats": { "life": 20, "hand": 7, "maxHand": 7 },
  "gear": [],
  "prize": 100,
  "goldRange": [20, 60],
  "loot": { "pool": "dominaria", "colors": "G", "types": [], "subtypes": ["Elf", "Druid"], "rarities": ["common"] },
  "model": { "mesh": "elf", "palette": ["#2a4524", "#d6ae7e", "#c08a62"], "size": 0.9 },
  "boss": false
}
```

- `prize` is the mob's prize value in gold; the prize cap of a duel is `min(ante value, prize)` (design.md A3).
- `gear` names gear items the mob wears, whose stats and emblems it starts with as a player does.
- `loot` filters the plane's pool for the three cards offered after a win.
- A boss has `"boss": true` and `"unlocks": "W"`. A plane's capstone boss (`phyrexian-praetor`) has no `unlocks`: it
  ends the arc instead, and the relics drop from it.
- `model.mesh` is a mob mesh and `model.palette` its colors (Models, below).
- `creature` is the card the mob is (design.md A6): a creature (or, for a mage, a planeswalker) card the engine plays,
  held in its deck - a wanderer's name is its creature's, and its deck holds 2 to 4 of it.
- `region` is the region, by its color (world.json's `regions[].color`), the mob roams or belongs to; absent for a mob of
  none (the generic wardens, the Portal's mobs, the praetor). A world spawn of a region lists mobs of that region and its
  tier.
- `tools/realms/sample-decks.py` writes the whole roster and its decks (design.md A3, A6), each deck built round its
  creature - the creature, its kin, the cards that support what it does - and by tier: its prize (tier 1 100 gold, 2 300,
  3 800, 4 2,000, a boss 6,000), its gold range, loot of its colors in the rarities its prize can buy, and stats-only gear.
  The roster's ids (the Domains, design.md A6):
  - **Wanderers**, fifteen a tier for tiers 1-4, three of each region a tier: a real creature card each that fits its
    region (Benalish knights and Sursi pegasi, Orvada's merfolk and drakes, the Morass's bog creatures and Amjad's
    horrors, Hurloon minotaurs, Ironclaw orcs and Keldon and Foriys giants, Llanowar's elves), its id the card's name in
    kebab-case (`llanowar-elves`, `serra-angel`, `shivan-dragon`, `two-headed-giant-of-foriys`).
  - **Mages**: a mage tower's id is `<region>-<tier>` (regions `benalia` W, `orvada` U, `caligo` B, `keld` R, `llanowar`
    G; tiers 1-4: `benalia-1` ... `llanowar-4`), and its boss is `mage-<tower>` (`mage-orvada-4`, Urza): a wizard,
    cleric, shaman, artificer or planeswalker of the region, of the tower's tier, `"boss": false`.
  - **Wardens**: the region dungeons' and the Portal's (`sanctum-warden` Benalia's, `rift-warden` the academy's,
    `tomb-warden` the Vess crypts', `foundry-warden` the Keldon fortress's, `heart-warden` the elfhames' hollow's,
    `portal-warden`; tier 4), and `warden-1` ... `warden-4`, by tier, for mage towers and the smaller dungeons of the wilds.
  - **Bosses**, who unlock their color: `lyra-dawnbringer` (W), `teferi` (U, at the Walassa academy), `liliana` (B,
    Liliana of the Veil at the Vess estate in the Caligo Morass), `garna` (R, Garna, Bloodfist of Keld), `rofellos` (G,
    Rofellos, Llanowar Emissary, a mono-green deck); the Phyrexian Portal's tier 4 mobs (`phyrexian-ravager`, `phyrexian-negator`,
    `phyrexian-gorger`, `gitaxian-mindcutter`); and the capstone's praetor (`phyrexian-praetor`, 42 life, a hand of 9, a
    maximum of 10 with its gear), whose deck the script writes out card by card.

### The world, interiors and dungeons (`<plane>/world`, `<plane>/interiors`, `<plane>/dungeons`)

Design.md A6: one connected world, interiors entered through doors, and dungeons generated in the browser (the first
overworld's per-map files are gone). The server starts on the generated world; its tests also keep a small world of the
same files and ids (`realms/dotnet/Cantrip.Realms.Server.Tests/World/make-world.py`).

The server reads these files in version 2 of the world data, on square tiles ("Version 2 of the world data", below;
Places, below): what it reads of a chunk is its `cx`, `cz` and `tiles`, its buildings' `door` and `interior`
(the doors into interiors), its `npcs` (vendors, armorers, innkeepers, spell tables: a spell table is a `spell-table`
NPC), `spawns`, `chests` and `entrances`; of an interior its `w`, `d`, `area`, `tiles`, `npcs`, `entry`, `exit`, `town`
and its own `chests` (`{id, x, z, gold, respawnSeconds}`, as a chunk's); of world.json its `size`, `origin`, `chunk`,
`tile`, `towns`, `inns`, `dungeons`, `pitches` and `ferries`.

- **The layout.** `layout.json` is the world's geography as data (design.md A6, the Domains), in square tiles `[x, z]`
  (x east, z south) and lengths in tiles: its `size` (whole chunks each way) and `relief` (how much the land rolls, 1 as
  designed, 0 flat); its landmasses (`center`, `radius`, `wobble`, `stretch`, `turn`), `bays` and `archipelagos`; its
  `regions` (`{id, name, color or null, biome: heartland|plains|coast|swamp|mountains|volcanic|forest|tundra|waste,
  style, at, weight, minTier, areas: [4 names]}`, every tile the region's whose `at` is nearest by its `weight`, `minTier`
  the least tier of its wilds); `mountains`, `rivers` and `lakes`; the `towns` (`{id, name, kind, region, style, at,
  radius, inn, innkeeper, board, folk, centrepiece, start, home, temple, guild, exotic, caravan}`, `radius` the tiles
  from the centre to the walls along x and z, `exotic` the id of the town's exotic wares vendor, whose shop is
  `<vendor>-shop`); the `roads` between towns, dungeons and ferry docks (`ferry:<id>:from`, `ferry:<id>:to`); the
  `dungeons` (as `dungeons/<id>.json` below, at a place, their mobs, warden and boss mob ids or asked of the roster:
  `@wanderers:2`, `@wanderers:2-3`, `@wanderer:3`, `@warden:2`); and the `ferries` (`{id, name, from, to}`, each dock the
  open shore nearest its place). The world generator reads it (and refuses one whose towns stand within 16 tiles of each
  other, wall to wall), and the server tests' world takes its towns' and dungeons' ids from it.
- **The world** is the version-2 format ("Version 2 of the world data", below; types in
  `realms/web/src/world/format.ts`). Dominaria is 1024 by 1216 tiles from `[0, 0]` (32 by 38 chunks), no `bounds`.
  `world/world.json` holds `{size: [width, height], chunk: 32, tile: 1, seed, regions: [{color, name, tiles}] (each
  colored region and how many tiles of land it has), towns: [{id, name, kind: capital|town|village, center: [x, z],
  radius, style, region (a color, optional), start, home (a color, optional)}], inns: [{id, town, x, z, interior}] (the
  inn's door tile, outside, which is its interior's `exit`), dungeons: [{id, x, z}], roads: [{from, to, tiles: [[x, z],
  ...]}] (each road's middle line, tile by tile, edge to edge), ferries, pitches, zones, overview}`:
  - a town is the square of tiles within `radius` of its `center` along x and along z (Chebyshev distance; `inTown`,
    `townAt` in format.ts): its walls (or its edge, where it has none) are an outline inside that square, hugging the
    land, and no spawn, chest or waymarker stands within it;
  - `ferries` are `[{id, name, from: [x, z], to: [x, z], lane: [[x, z], ...]}]`: a ferry to a far isle. `from` and `to`
    are its docks, open shore tiles with a `ferryman` NPC (`ferry` names the ferry) beside each; `lane` runs from one dock
    to the other (`lane[0]` is `from`, the last `to`), sea tiles edge to edge, open (a walk of eight-way steps with no
    corner cut, as every walk is). A passenger rides the lane at a walk (design.md A6: board, the crossing eases by, step
    off), so a ferry is walking as far as the server is concerned; the overworld lets nobody but a passenger onto a lane.
    No other sea tile is open but the causeways the roads raise to the near isles;
  - `pitches` are `[{town, x, z}]`: an open tile of a town's market (or square), open all round, where a traveling
    vendor's caravan stands while the schedule (`GET /api/travelers`) has them in that town (design.md A5); the trader
    stands on it;
  - `zones` are the tier zones (design.md A6): `{cell, cols, rows, areas: [{id, name, region (a color or null), tier}],
    grid}`, the world cut into `cell`-by-`cell` squares of tiles from its origin (16: 64 by 76), `grid[row][col]` the
    index in `areas` of the square at `x = col * cell`, `z = row * cell`. An area is a region's band of one tier (named in
    `layout.json`), or the sea (tier 0); a town within its walls is no tier's. A tile's tier is its square's area's
    (`areaAt`, `tierAt`);
  - `overview` is the world from above for the regional map: `{cell, legend: {letter: surface, T: town, F: woods},
    rows}`, a letter for each `cell`-by-`cell` square (8).

  `world/chunks/<cx>_<cz>.json` is each 32-by-32 chunk ("Version 2 of the world data" has every field): its `tiles` (`[height, surface,
  flags]`, row by row; flags 1 blocked, 2 bare, 4 a ramp, which is walked as any open tile), `props`, `buildings` (a door into an interior has `door` and `interior`), `npcs`, `spawns`,
  `chests`, `entrances` and `waymarkers`, all in tiles but props' places, in world units. In Dominaria:
  - `npcs` stand outdoors on open tiles: townsfolk and guards who walk, ferrymen. What a player uses but nobody walks
    through - quest boards, the arena's gate, a dungeon's spell table and a mage tower's `waystone` (`tower` names it) -
    stands on a blocked tile of its own with `stand` (its middle), an open tile beside it, and a prop of the same id
    drawn there;
  - `spawns` are `[{id, x, z, mobs, radius, respawnSeconds, tier}]` on open tiles, with ids unique across the world
    (`"<cx>_<cz>:<n>"`: the chunk the spawn stands in, and a number);
  - `chests` are `[{id, x, z, gold: [low, high], respawnSeconds}]`, each on a blocked tile of its own with open ground
    round it, ids unique across the world (`"<cx>_<cz>:c<n>"`);
  - `entrances` are `[{x, z, dungeon}]`: the open tile before the dungeon's structure (a prop of its theme over a
    blocked footprint), walked onto to start a run, with an open step out of it;
  - `waymarkers` are `[{x, z, tier}]`: where the tier rises, in the harder side's tier, on a blocked tile beside a road
    or along the boundary.

  A tile `(x, z)` is in chunk `(floor(x / 32), floor(z / 32))`: the chunk's file holds exactly its tiles, and is named
  for them. A spell table is a `spell-table` NPC (a `spell-table` prop only draws one); one stands beside each dungeon's
  entrance (its antechamber's, design.md A6).

  A chunk is loaded as the player nears it and dropped as they leave (`gridOfChunks` in load.ts walks the loaded chunks
  as one ground). Every file is written offline by the world generator (`realms/web/scripts/world.ts`, `npm run world`,
  about five seconds) from `layout.json` and the mob roster, and checked in: the same layout, seed and roster give the
  same files, and a rerun after the roster changes is all a new roster needs. Set pieces (town squares, the portal's
  gate) are placed in its code; there is no map editor. The lint (`lintRealm` in realms/web/src/world/lint.ts, run on
  Dominaria by `src/world/dominaria.test.ts`) checks the whole world is walked from the first inn (every open tile, and
  beside everything not stood on), every door has its interior in the town the door stands in, every entrance its
  dungeon where world.json and the dungeon say, with its spell table (and a tower's waystone) beside it, each spawn's
  tier is its zone's and its mobs', tiers grow with distance, waymarkers stand at rises, ferries' lanes are walks with a
  ferryman at each dock, pitches stand open in their towns, every id the art does not have is a documented placeholder,
  and the files are what the generator writes.
- **Interiors.** `interiors/<id>.json` is a room in the version-2 format (below): `{id, name, kind, town, style,
  w, d, area, tiles, props, npcs, lights, entry: [x, z], exit: [x, z]}`, `exit` the world tile it comes out on - its
  building's door tile - and `entry` its own tile at the door (stepping onto it leaves; one arrives a step in from it).
  Kinds: shop, inn, guildhall, temple, smithy, library, house, tower, and `exotic-wares` for an exotic wares shop
  (design.md A5). Its npcs include the vendors (`"kind": "vendor", "vendor": "<id>"`, id the vendor's), the armorer
  (`<town>-armorer`, in the smithy), the innkeeper (`<town>-innkeeper`) and the spell tables (`spell-table`:
  `<town>-inn-spell-table`, `<town>-guild-spell-table`); vendors and armorers work only inside. An interior belongs to
  the town its door stands in (a vendor file's `town`, an armorer's town); its doors stand in one town at most.
- **Mage towers** are dungeons of theme `tower` with `"waystone": true`: beating the run's boss attunes the tower to the
  character (`Character.Attuned: [tower ids]`, kept by the server), and its waystone stands beside its entrance in the
  world. A tower's id is `<region>-<tier>` (regions `benalia`, `llanowar`, `caligo`, `keld`, `orvada`, tiers 1-4), its
  boss `mage-<tower>`, and its `tier` its circle's wherever it stands (any other dungeon takes at least its zone's tier).
- **Spawn tiers.** Each world spawn point carries `tier`, the tier of the zone it stands in (world.json's `zones`: the
  tier of its distance from the nearest starting area, and at least its region's `minTier`), and lists only mobs of that
  tier and of its region where the roster has them; every wanderer of the roster is listed by some spawn.
- **Dungeons.** `dungeons/<id>.json` is `{id, name, theme: caves|castle|tower|crypt|hollow|foundry|portal, entrance:
  [x, z], requires: "WUBRG" (optional), floors: [min, max], tier, encounters: [min, max] per floor, mobs: [[mob ids] per
  floor (the last for the floors past it) or one list for all], warden, boss, region (a color, optional), waystone
  (optional)}`. The `warden` keeps the stair of every floor but the last (a dungeon that may have only one floor still
  names one if it may have two); the `boss` waits on the last floor; neither is a floor's encounter. A run's layout is
  the browser's (`realms/web/src/dungeon/generate.ts`, one generator per theme, on squares), made from the run's seed, and holds
  exactly the encounters the run names, each with its mob. world.json's `dungeons` places each at its entrance, where a
  chunk's `entrances` leads into it.

#### Version 2 of the world data (types in `realms/web/src/world/format.ts`)

The art slice's small world is `realms/web/fixtures/slice-world`.

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
    standing grass under a tree or a house), 4 ramp (its floor slopes between its neighbours' levels: see "The
    renderer at world scale"). A tile past the world's edge is blocked.
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

### Places

A character's place is `{Space, X, Z}`: `Space` is `"world"`, an interior's id, or `"run:<run>"` for a dungeon run, and
`X`, `Z` a square tile of it (x east, z south; the world's may be negative, from its `origin`). The server reads the world,
its interiors and its dungeons in version 2 of the world data (above):

- **Open tiles.** A tile is open - someone may stand on it - when it is a tile of the space (in the world: within `size`
  from `origin`, in a chunk with a file; in an interior: within its `area`), has a surface (not `""`) and is not blocked
  (flag 1), exactly as the overworld's grid (`realms/web/src/world/load.ts`) makes it walkable. Heights and the bare flag
  (2) are read and kept, and change nothing about walking. The camera's `bounds` change nothing either.
- **Walking.** A walk is steps to any of the eight tiles round, and a diagonal step only where both tiles it passes
  between are open: it never cuts the corner of a blocked tile (`realms/web/src/world/grid.ts`'s rule, exactly). It
  starts on an open tile (the overworld's A* does not check the tile it starts from; nobody stands on a closed one).
  Golden vectors of paths and walks are `realms/content/walk-vectors.json` (`tools/realms/walk-vectors.ts`), which the
  TypeScript and C# tests both check. A walk's length is counted along it, 1 tile a straight step and the square root
  of 2 a diagonal one, walked at a speed in tiles a second.
- **Proximity.** "Within N tiles" of a tile is the Chebyshev distance - the most of the two axes' differences - at most
  N; "beside" a tile is within 1 (on it or one of the eight round it). Every check by distance is this one: a spawn's
  reach, standing at a door, an exit, an entrance, a waystone, a chest or a spell table, being in a town (its `radius`
  from its `center`), and a report against the walking speed (a walk of eight-way steps never covers fewer tiles of
  Chebyshev distance than it walks).

The server keeps the last reported place (`POST /api/position`):

- a world or interior place is an open tile of it (422 `NoSuchPlace`);
- within the same space it is reached by walking: at most `REALMS_WALKING_SPEED` (5) tiles a second since the last
  report or move, plus 2, in Chebyshev distance (409 `NoWay`), so a client reports at least as often as it could be
  refused;
- an interior is entered from on or beside one of its doors in the world (a building's `door` with that `interior`), and
  left to its `exit` (the door tile) or beside it (409 `NoWay` otherwise, and from one interior straight into another);
- a dungeon run is entered by `/api/dungeon/enter` and left by `/api/dungeon/leave` or a lost duel; within a live run of
  theirs any tile is taken (the layout is the browser's), and no other space is reported until it ends (409 `NoWay`).
  The server puts the character in the run at tile 0, 0, a placeholder: the browser stands them on the floor's `arrive`
  tile (each floor's, going down too) and reports it. Stepping onto the floor's `up` leaves the run (on floor 0 the way
  in), onto `down` takes the stair (`/api/dungeon/floor`), and onto `wayOut`, beside the beaten boss, leaves it too
  (realms/web/src/dungeon/types.ts). A waystone is travelled by `/api/waystone`;
- the tile of a dungeon's entrance is refused 409 `Locked` while the dungeon's `requires` is not all in the identity;
- a character whose place the content no longer has (an old map's id, or a place from before squares: the database's
  move to tiles empties every place outside a run) may report any open tile.

A lost duel sends the character to their inn, outside it in the world (world.json's `inns[].x, z`): the one they set with
`POST /api/inn` inside an inn, else the start town's (`REALMS_START_TOWN`, New Benalia), where a new character begins.

### Models (figures: `realms/web/src/art/figures`)

What characters, mobs and gear look like. Every figure is painted by code on the slice's rig (`art/figures/rig.ts`): a
3D rig of boxes - legs, torso, arms, a big round head, and whatever a figure adds (wings, a tail, a second head, a
staff) - each face painted texel by texel from ramps and packed into one picture per look, sixteen texels to a tile. A
figure walks, stands and breathes, casts (`Figure.act("cast")`: arms up, a spark of its color over its head; a beast
rears, its wings spread) and reaches out (`act("interact")`). A mob's, a gear item's and a body's colors are plain
`#rrggbb`; each is made a seven-step ramp about the color (`rampOf`, darker steps cooler, lighter warmer) as the
slice's own ramps run, so content colors are best taken from the plane's palette. A figure is never scaled: a bigger
mob is built bigger in whole texels, so every size stays crisp. `realms/web/cast.html` (dev only) shows them all.

- **Bodies** (a character's `Body`, presence's `Look.Body`): `lithe`, `broad`, `tall`, `stocky` (`BUILDS`, `person.ts`),
  each with its own hair: long on the lithe, cropped with a short beard on the broad, a tail on the tall, the slice
  hero's spikes on the stocky. A body name the client does not know is drawn as `lithe`.
- **Palettes** (`Look.Palette`, 0-5, `SKINS` in `ramps.ts`): fair with brown hair, fair with red, olive with black,
  bronze with black, umber with dark, deep with silver. Out of range is clamped.
- **Identity** (presence's `Other.Identity`, the character's colors in WUBRG order): the tunic and the cape in the
  first color's cloth, trimmed in the second's (`IDENTITY`, `IDENTITY_TRIM`): white cream and gold, blue, violet, red, an
  emerald far bluer than grass; colorless grey. The cloth is saturated, in hues the land does not use, so a character
  stands out on any ground.
- **Gear meshes** (a gear item's `look.mesh`; its palette's first color the stuff, its second the trim or the stone;
  `gear.ts`): `circlet`, `crown`, `helm` (an open helm with a plume), `hood`, `hat` (a wizard's), for the head; `amulet`
  (a chain to a stone on the chest) for the neck; `armor` (plate and pauldrons), `robe` (to the ankles), `cloak` for the
  body; `gloves`, `gauntlets` for the hands; `boots`, `greaves` for the feet; `ring` (a band and a glowing stone, on the
  right hand in `ring1`, the left in `ring2`); `relic` (a talisman) and `orb` (a caged light), each floating round the
  character. An unknown mesh is worn as nothing. A gear item names only these, each in the slot it is made for
  (`RealmContent.GearMeshes`: a ring's is `ring`, a talisman's and an orb's `relic`), and presence's looks wear only
  these.
- **Mob meshes** (a mob's `model.mesh`; `model.size` builds it bigger, 1 as made; `mobs.ts`): each reads its palette
  as the colors its `slots` name, and picks its variations by the words of the mob's id and its creature's name (an
  archer's bow, a mechanic's goggles and wrench, a Triskelion's third arm, a Leveler's tower, a fallen angel's dark
  wings), then by a seed from the id:
  - people: `humanoid` (a soldier: open helm, tabard over mail, spear and shield; a hood and a bow for an archer; a
    leader's cape and sword), `knight`, `barbarian`, `elf`, `elf-druid`, `goblin`, `orc`, `minotaur`, `giant`, `ettin`
    (two heads), `merfolk`, `vampire`, `angel`, `demon`, `imp`, `aven`, `ghoul`, `horror`, `phyrexian`, `thrull`;
  - mages: `wizard`, `cleric`, `warlock`, `shaman`, `druid`, `artificer` (with `thrull`, `djinn`, `ape` and `dragon`
    the twenty tower mages, no two alike);
  - floating: `djinn`, `spirit`, `wraith`, `elemental`;
  - big and shaggy, wooden, made: `yeti`, `ape`, `treefolk`, `construct`, `golem`;
  - beasts: `beast` (a baloth), `boar`, `rat`, `cat`, `lhurgoyf`, `horse`, `pegasus`, `elk-rider`, `dragon`,
    `dragon-engine`, `drake`, `bird`, `serpent`, `wurm`, `insect`;
  - the bosses, each its own: `lyra`, `teferi`, `liliana`, `garna`, `rofellos`, `praetor`.

  A color a mob's palette does not give is the mesh's own (a `knight`'s fourth, its armor, is iron). Big meshes are made
  big at size 1 (a giant, an ettin, a treefolk, a wurm, a serpent, a dragon, a baloth): `model.size` grows them from
  there.

  An unknown mesh is drawn as `humanoid`; a mob names only these (`RealmContent.MobMeshes`). The voxel model files
  (`models/<id>.vox.json`, `realms/web/src/voxel`) are the old renderer's, retired at integration.
- **NPC figures** (the world data's `npcs[].figure`, varied by `seed`, recolored by `palette` slots `cloth`, `trim`,
  `skin`, `hair`; `npcs.ts`): `townsfolk-<region>` and `guard-<region>` for `benalia`, `orvada`, `caligo`, `keld`,
  `llanowar`; `shopkeeper`, `innkeeper`, `ferryman`, `planar-trader`; and the slice's `hero`, `knight`, `grizzlegom`,
  `goblin`, `skeleton`, `ghoul`, `townswoman`.
- A spell table is a `spell-table` NPC; a character stands at one beside it.
- The client draws a player as `playerFigure({body, palette, identity, slots})` and another player from presence as
  `lookFigure(Look, Identity)`, a mob as `mobFigure(model, id, creature)`, an NPC as `figureSpec(figure, palette, seed)`;
  `new Figure(spec)` builds any of them (`art/figures/index.ts`).

### Vendors (`<plane>/vendors/*.json`)

```json
{ "id": "argive-goblin-trader", "name": "Grizzlegom's Goblins", "town": "new-benalia",
  "specialty": { "subtypes": ["Goblin"] }, "purse": 50000 }
```

`specialty` is any of `colors` (a color identity the card's is within), `types`, `subtypes`, `rarities`, `names` (a theme
listed outright) - all that are given must hold. Its pool is the plane's pool filtered by it. `town` is a town of
world.json; every vendor keeps a shop there, the interior `<vendor>-shop`: a `vendor` NPC of an interior of that town
names it.

**Wares from other planes** (design.md A5) come only through the exotic dealers, who deal in the off-plane pool alone,
and no other vendor deals in it:

- The off-plane pool is the view of `cards.json` above: every dealt card printed on no walked plane, each with the planes
  it was printed on. A trader's plane is any plane of `planes.json` not walked (the traders' are Ravnica, Zendikar,
  Innistrad, Kamigawa, Theros, Kaladesh, Amonkhet, Ixalan, Eldraine, Mirrodin, Alara, Tarkir, Lorwyn, Kaldheim and
  Strixhaven).
- An **exotic wares shop** is a vendor with `"exotic": true`, in its shop like any (`new-benalia-exotic-wares` and
  `capashen-hold-exotic-wares`, layout.json's towns' `exotic`): its stock
  is off-plane cards within its `specialty`; it shows at most 6 cards, gains one at each six-hour mark of the clock (00, 06,
  12, 18 UTC) while it shows fewer, lets a card go unsold after 3 days, and is created with 6 that leave six hours apart.
  It buys off-plane cards of its specialty at half; a card sold to it stays until bought, and while it shows 6 it buys
  nothing (409 `VendorFull`).
- A **traveling trader** is a vendor `<plane>-trader` (fifteen) with `"trader": {plane, towns: [town ids], hour, hours}`
  and no `town`, and keeps no shop: on Unix day
  `d` (UTC) its caravan is in `towns[d mod towns.length]` from `hour` o'clock UTC for `hours` hours (within the day), a
  schedule of the date alone. Each visit brings 3 cards of its plane's off-plane cards, which leave with it; it buys any
  off-plane card at half, and that card too leaves with it. It trades only while its caravan is in the character's town:
  the character in the world within the town's radius (in tiles, Chebyshev: Places), or in a building of the town (409
  `NotNear` otherwise). The
  traders' towns are New Benalia, Capashen Hold, the Llanowar elfhames, Keld and Walassa's Tolarian Academy
  (`new-benalia`, `capashen-hold`, `llanowar`, `keld`, `tolarian-academy`), each with a pitch (world.json's `pitches`)
  where the overworld stands a trader's caravan while its visit lasts; their hours are set so that one caravan at a time
  is in a town.

The server reads all of this at start and refuses to start on content that does not hold together: one plane has a world;
every mob, interior, dungeon and vendor a place names is there (spawns' mobs of the spawn's tier and no boss, doors'
interiors, entrances' dungeons as world.json places them, dungeons' mobs, wardens and bosses, vendor NPCs of the vendor's
town, inns' towns, traders' towns, an interior's `town` its doors' town); every tile a character is put on or meets
something at is open (inns, doors, exits - each on or beside a door into its interior -, entries, entrances, spawns,
pitches - each in its town -), and every ferry's lane is a walk from its `from` to its `to`; every chunk is its file's
(`cx`, `cz`) and 32 by 32 well-formed tiles; every mob's deck, gear, creature and mesh resolve; every mob is met
somewhere and every shop is kept
somewhere; every relic is a card from a boss and in no pool; the off-plane pool shares no card with any pool, its cards
are legal and priced and its tags are planes; every record of cards.json is a card the engine has, priced by the formula, its
relic flag relics.json's; every trader's plane is a plane not walked with cards to bring; and
every `requires` is colors' letters (`ContentTests`).

## The realm server's API (`/api`)

Every call but sign-in needs the signed-in cookie (`SiteSignIn`'s; 401 `NotSignedIn` without it). A refused call is HTTP
4xx with `{"Error": "<code>", "Detail": "<words>", "Problems": [...] or null}`; codes are named below. Any call of a
player with no character is 404 `NoCharacter`.

| Call | Body | Reply |
| --- | --- | --- |
| `GET /api/me` | | the `Character` (below), or 404 `NoCharacter` |
| `POST /api/character` | `{Name, Body, Palette, Color}` | the new `Character`; 409 `HasCharacter`; 400 for a name (2-24 letters, digits, spaces, `'` and `-`), body (`lithe`, `broad`, `tall`, `stocky`), palette (0-5) or color (W U B R G) that is none |
| `GET /api/collection` | | `{Cards: {name: count}}` |
| `GET /api/inventory` | | `{Cards: [{Name, Count, Gold, Deck, Ante, Relic}], Value}`: the collection card by card, in name order, each with its list price (0 for none), the copies the deck and the ante use and whether it is a relic; `Value` the collection at list price. The gear is the `Character`'s |
| `GET /api/catalog` | | every card the engine plays, as printed: `Cantrip.Protocol`'s `CardCatalogView`, MessagePack (`application/x-msgpack`), as the deck site's `/decks/api/catalog` is: the card layer's faces |
| `GET /api/deck` | | the `Deck` |
| `POST /api/deck/check` | `{Main, Ante}` | `{Problems: [...], AnteValue}`: what `PUT /api/deck` would refuse them for (empty when it would take them), anywhere the character stands, and the ante's worth |
| `PUT /api/deck` | `{Main: [{Name, Count}], Ante: [{Name, Count}]}` | the `Deck`; 409 `NotAtTable`, 422 `IllegalDeck` with `Problems` (a relic in the ante is one) |
| `PUT /api/loadout` | `{Slots: {slot: gearInstanceId or null}}` | the `Character`; 422 `IllegalLoadout` with `Problems` |
| `GET /api/vendor/{id}` | | `{Vendor: {Id, Name, Town, Specialty, Kind, Plane}, Purse, Stock: [{Name, Gold, Count, Until}], Gold, Buying: [{Name, Gold, Owned, Spare}]}`: `Kind` is `shop`, `exotic` or `trader`, `Plane` a trader's home plane (else null), `Town` a trader's caravan's town now; a visit is counted; 404 `NoVendor`, 409 `NotNear` |
| `GET /api/travelers` | | `{Travelers: [{Id, Name, Plane, PlaneName, Visit: {Town, From, Until} or null, Next: {Town, From, Until}}]}`: every traveling trader, in id order, the visit its caravan is on now (null between visits) and the next to begin |
| `POST /api/vendor/{id}/buy` | `{Name}` | `{Gold, Collection}`; 409 `SoldOut`, `CannotAfford` |
| `POST /api/vendor/{id}/sell` | `{Name}` | `{Gold, Collection}`; 409 `Relic` (a relic is never sold, whatever the vendor), `NotTheirTrade`, `VendorCannotAfford`, `VendorFull`, `InDeck`, `NotOwned` |
| `GET /api/armorer/{town}` | | `{Stock: [Gear]}`; 404 `NoArmorer` |
| `POST /api/armorer/{town}/buy` / `sell` | `{GearId}` / `{InstanceId}` | `{Gold, Gear: [GearInstance]}`; 409 `NotInStock`, `CannotAfford` / `NotOwned`, `Worn` |
| `POST /api/encounter/start` | `{Spawn, Mob}` in the world, or `{Run, Floor, Index, Mob}` in a dungeon | `{Token, Seed, Duel}` (below); 409 `NotNear`, `NotThere`, `TooSoon`, `Unfinished`; 404 `NotThere`; 422 `IllegalDeck` |
| `POST /api/dungeon/enter` | `{Dungeon}` | `{Run, Seed, Floors: [{Encounters: [{Index, Mob}], Warden: mob or null, Boss: mob or null}]}`: the run, its seed for the layout, and every encounter it holds; the character is in it (`run:<Run>`, tile 0, 0 until the browser reports the floor's `arrive`), and a run of theirs still live ends; 409 `NotNear` away from its entrance (on it or beside it, in the world), `Locked`; 404 `NotThere` |
| `POST /api/dungeon/floor` | `{Run, Floor}` | `{}`: the character took the stair to `Floor`, the next floor down, allowed once the warden of the floor they stand on is beaten; 409 `WardenStands`, `NoWay` for any floor but the next, `NotNear` out of the run, `NotThere` for a run over; 404 `NotThere` |
| `POST /api/dungeon/leave` | `{Run}` | `{}`: the run ends, and the character stands beside its entrance in the world (the first tile a step from it, in the order south, east, west, north, south-east, south-west, north-east, north-west, that is no door or entrance); 409 `NotThere` for a run over; 404 `NotThere` |
| `POST /api/waystone` | `{Tower}` | `{Place: {Space, X, Z}}`: travel at once from an attuned tower's waystone (the character in the world on or beside one of its `waystone` NPCs' tiles, or its entrance) to another attuned tower's, beside its entrance as leaving a run puts them; 409 `NotNear` away from a waystone, `NotAttuned` for either tower; 404 `NotThere` for no tower with a waystone |
| `POST /api/inn` | `{}` | `{Inn}`: the inn the character stands in (an interior of kind `inn` of a town) is their home now, world.json's inn of that town nearest its door; 409 `NotNear` anywhere else |
| `POST /api/encounter/finish` | `{Token, Log}` | `{Outcome: "won" or "lost", Gold, Offer: [{Name, Gold}], Cap, Gear, Relics: [name], Detail}`; 404 `NoDuel`, 409 `Finished` |
| `POST /api/encounter/loot` | `{Token, Picks: [name]}` | `{Cards: {name: count}}`, the collection; 422 `OverCap`, `NotOffered`; 409 `Finished` |
| `POST /api/chest/open` | `{Space, Chest}` | `{Gold, Found, Gear}`: the character's gold, and what the chest held, standing on or beside it (Places, "Proximity") in its space: `Found` gold, and `Gear` a gear item now theirs (`GearInstance`, or null: one chest in ten, uncommon in a chest whose gold starts at 300 or more, else common); 409 `NotNear`, `Empty`; 404 `NoSuchPlace` |
| `POST /api/position` | `{Space, X, Z}` | `{}`: where the character is (Places, above); 422 `NoSuchPlace` off the space or on a tile nobody stands on, 409 `NoWay` for a space reached without a door, entrance or waystone, `Locked` for a dungeon whose `requires` the identity lacks |

- `Character`: `{Id, Name, Body, Palette, Identity, Gold, AnteValue, Space, X, Z, Inn, Stats: {Life, Hand, MaxHand},
  Loadout: {slot: GearInstance or null}, Gear: [GearInstance], Unlocked: [color], Attuned: [tower]}`. `Space`, `X`, `Z`
  are their place (Places, above; a live run's space names the run to resume); `Inn` their home inn's id; `Attuned` the
  mage towers whose waystones they have attuned, by dungeon id. `Id` is the player id (`discord-<id>`,
  `dev-<id>`) the spawn algorithm hashes; `AnteValue` the sum of the ante's list prices, for the HUD. `Body` is one of
  `lithe`, `broad`, `tall`, `stocky` (as `POST /api/character` takes it); `Palette` 0-5, the skin and hair palette
  (`realms/web/src/character.ts`). `Identity` is the starting color and the unlocked ones, as one string of letters in WUBRG
  order (`"WU"`). The
  loadout's slots are `head`, `neck`, `body`, `hands`, `feet`, `ring1`, `ring2` and `relic`; a `ring` item fits either
  ring slot. `Stats` are the base (20, 7, 7) plus every worn item's.
- `Gear` is a gear item as its content file has it, PascalCase, with its `Emblem` (`"<name> (gear)"`, or null for an
  item with no effects) and its rarity's `Budget` of points (14 for a unique). `GearInstance` is one a character owns: `{InstanceId, Gear}`.
- `Deck`: `{Main: [{Name, Count}], Ante: [{Name, Count}], AnteValue}`. The main deck holds the basic lands too, which
  are free (any number of a basic land of the character's identity, and Wastes) and never in the collection; the ante
  holds no basic land and no relic, and the main deck at most one copy of a relic. Every other copy in the deck and the
  ante together is owned.
- `PUT /api/loadout` changes only the slots it names; null empties one.
- A vendor's `Gold` is the character's; `Buying` is every card of theirs it deals in, with what it pays for one (`Gold`, half
  the list price rounded down), how many they own and how many of those are `Spare` (in neither the deck nor the ante):
  what the `vendor` screen offers to sell.
- A vendor trades with a character inside its shop (an interior with its `vendor` NPC), an armorer inside a smithy of
  its town (an interior of the town with an `armorer` NPC), else 409 `NotNear`; `/api/armorer/{town}` takes a town's id.
  A vendor sells at list price, the copy that would leave its shelf soonest first, and buys at half the list price
  rounded down.
- A dungeon encounter is the run's: the server checks that the run is the character's (404 `NotThere`) and live (409
  `NotThere`), that they stand in it (409 `NotNear`), that `Floor` is the one they stand on (0 the first; 409
  `NotThere`), that `Index` is an encounter of that floor (404 `NotThere`) not yet fought (409 `TooSoon`), and that `Mob`
  is its mob (409 `NotThere`). A floor's encounters are indexed from 0; its warden's index is the count of its
  encounters, its boss's one more. Losing any duel of a run ends the run; beating the boss of a dungeon with a waystone
  attunes it.
- `POST /api/encounter/start` in the world checks, in order: an unfinished duel (it counts as lost now - a card of its ante gone and
  the character at the inn - and the call is refused 409 `Unfinished`); the spawn (404 `NotThere`); that the mob
  is one of the spawn's (409 `NotThere`); that the character is in the world within `radius + 8` tiles of the spawn point
  (its wander radius, the 6 it chases, and 2 for walking on since the last report; Chebyshev, Places; 409 `NotNear`);
  that the spawn holds
  that mob for the character this epoch or the one before (409 `NotThere`) and that it has not been fought in that epoch
  (409 `TooSoon`); and that the deck is legal (422 `IllegalDeck`). Then it commits the duel. A duel not finished within
  24 hours counts as lost.
- `POST /api/encounter/finish`: `won` only when the log is accepted and seat 1 alone won it; a draw, the mob's win and a
  log not accepted are `lost`, with the reason in `Detail`. A win's `Gold` is rolled from the mob's gold range and paid at
  once; `Offer` is up to three different cards of the mob's loot, each with its list price (`Gold`) and within `Cap`
  (none with an empty ante): what the `loot` screen shows; `Gear` is the gear item a win dropped (`GearInstance`, or
  null), already the character's: 10, 15, 20 or 30 wins in a hundred by tier, common in tiers 1 and 2, uncommon in 3, rare
  in 4; a boss always drops its unique. `Relics` are the relics a boss win dropped, in `relics.json`'s order, already in the collection; empty for any
  other win and every loss. A win against a boss rolls, at its chance, each relic whose entry names that boss and that is
  not in the account's relic ledger. The roll is apart from the offer and outside the cap. Each relic that comes up is
  added to the collection and to the ledger in the same transaction as the win. A loss moves the character to their inn
  (Places), and ends the dungeon run it was fought in.
- `Duel`: everything the browser deals the game from - `{Seats: [the NewGame seat of docs/host-protocol.md, with
  StartingLife, StartingHandSize, MaximumHandSize, Emblems], MinimumDeckSize: 40, Seed, Mob: {Name, Tier, Prize},
  AnteValue, Cap}`. The player is seat 1, the mob seat 2. Each seat's setup values are always given: its stats with its
  gear's, and an emblem per worn item with effects. `Seed` is below 2^53, so a JavaScript number carries it whole; nobody
  chooses who plays first (CR 103.1, decided from the seed). `Mob.Tier` is 0 for a boss.
- `Log` is what seat 1 sent the table, in order: each `Cantrip.Protocol` client message the player's `GameClient` sent,
  MessagePack-serialised and base64-encoded, as a JSON array of strings. Seat 2's answers are not in it. The server deals
  the same `Duel` on the native engine behind a `GameSession`, as the browser did; plays seat 1's messages back in
  order; and answers seat 2 with `TacticalPlay` on the duel's seed, as the browser's bot seat did. It takes the result
  only if the game is over at the end of the log and no message was refused. A log the bot's answers would have made
  play out otherwise (a tampered bot) ends in a different game, which fails that check.
- Both sides play the mob's seat the same way, through `realms/dotnet/Cantrip.Realms`, which the browser's realm mode
  references as the server does: the bot is `RealmBot.Create(Seed)`, a `TacticalPlay` seeded with the seed's low 31
  bits; and the mob's seat answers everything it has been asked (`RealmBot.Settle`) before each of seat 1's messages goes
  to the table, and once more after the last (`RecordingTransport.BeforeSend`). The order the two seats' answers reach the table is then
  the same in the browser and in the replay, even where both are asked at once.
- Sign-in: `GET /signin` (Discord), then `/home`, which passes the player on to the world client. A server started with
  `REALMS_DEV_SIGNIN=1` also takes `POST /dev/signin {Id, Name}`, signing in as `dev-<Id>`: development and tests only.
  Such a server alone also takes two calls for tests, on the signed-in cookie, that arrange what play would take long to
  reach (the end-to-end suite against the real server, `realms/web/e2e/server/`): `POST /dev/place {Space, X, Z}` puts
  the character at once on an open tile of the world or an interior (422 `NoSuchPlace` otherwise), and `POST /dev/verdict
  {Outcome}` (`"won"`, `"lost"`, or null to replay again) judges the player's duels as it says in place of replaying
  their logs, so the card layer's stand-in counts as a win; and `POST /dev/drop {Gear}` (`true`, `false`, or null for the
  dice again) decides whether the player's gear rolls, a win's and a chest's, come up. Never in production.

## The card layer (`window.postMessage`)

The overworld asks the card layer (`?realm` in `Cantrip.Client.Web`, framed over the world) for a screen with
`{realm: 1, op: "open", id, screen, args}` and hears `{realm: 1, op: "closed", id, outcome, result?}` when it closes
(`realms/web/src/cardLayer.ts`, `Realm.js`). What each screen is opened on, and what it hands back:

| `screen` | `args` | `outcome` and `result` |
| --- | --- | --- |
| `duel` | `{token, seed, duel: Duel, mob: {id, name, tier, map, spawn}}` (the encounter's start) | `won` or `lost`; `result.log`: the `Log` for `/api/encounter/finish` |
| `loot` | `{token, offer: [{Name, Gold}], cap, mob, gear}`; from a chest `{offer: [], cap: 0, mob, source: "chest", gear}` | `closed`; `result.picks`: the names taken, for `/api/encounter/loot` |
| `spell-table` | `{map, name}` | `closed` |
| `vendor` | `{id, name}`: the vendor's id | `closed` |
| `gear` | `{name}`, or `{armorer: <town id>, name}` at an armorer | `closed` |
| `inventory` | `{name}` | `closed` |

The overworld calls the API around the screens (start before a duel, finish and loot after it); the card layer calls
the API for what happens inside one (buying, selling, saving the deck and the loadout), on the signed-in cookie. It is
framed as `<card layer>?realm&api=<server>`: `api` is the realm server the overworld talks to, absent when the card
layer is served from the server's own origin. A card layer on an origin of its own is named to the server as
`REALMS_CARDS`, the one origin beside the world client's (`REALMS_CLIENT`) that the API answers from a browser. A screen cut short closes
`dismissed` or `replaced`, which the overworld treats as a loss for a duel; a duel cut short still hands back its log so
far (the server takes it as a loss, the game not being over), and a loot pick cut short no picks.

- `duel`: the card layer deals the `Duel` on the rules engine in its page (`engine/cantrip_wasm.wasm` beside it, or
  `?engine=`) through `Cantrip.Realms`' `DuelTable`, the table the server's replay deals on, with no clocks. It closes
  `won` only when seat 1 alone won, after the player has seen the result; a concession closes `lost` at once.
- `loot` takes any subset of the offer whose prices fit under `cap`, and shows `gear` - the `GearInstance` a win dropped
  or a chest held, already the character's, or null - as its Vanguard-style card, with a button that wears it
  (`PUT /api/loadout`); the overworld opens it for a win that offers cards or dropped gear, and for a chest that held gear; `spell-table` reads the collection, the deck and
  `/api/catalog`, judges the deck by `/api/deck/check` and saves with `PUT /api/deck`; `vendor` and `gear` trade and
  wear through their calls, saying a refusal's `Detail` (and `Problems`) in words; `inventory` reads `/api/inventory`,
  `/api/me` and `/api/catalog` and changes nothing.
- `gear` asks the overworld for a picture of the character wearing what its paper doll shows worn: the card layer posts
  `{realm: 1, op: "portrait", id, slots: {slot: {mesh, palette}}}` and the overworld answers `{realm: 1, op: "portrait",
  id, args: {image}}`, `image` a PNG data URL of the player's figure (`portrait.ts`), or null; the card layer shows the
  answer to the last it asked.
- In a `duel`, each seat's worn gear is shown on a strip under the duel's bar: the emblems in its command zone, read
  from the game, and its setup values; a panel shows each as its card.

## Presence (`/realm/ws`)

A WebSocket of MessagePack messages, one per binary frame (16 KB at most), on the signed-in cookie. The server relays
positions and looks by area: in the world, among the players of a layer within two chunks of each other (their chunks
at most 2 apart along each axis, each player's chunk (cx, cz) = (floor(x / 32), floor(z / 32)) of the tile their walk
ends in); a player entering the world takes the
first layer whose players within two chunks of them number fewer than 40 (`REALMS_INSTANCE_SIZE`), and keeps it until
they leave. In an interior, among those in the same instance of it (40 to an instance, another opening when one is
full). A dungeon run is single-player and shares nothing. Nothing else is shared between players (design.md A6). Each frame is a MessagePack union, `[key, {Field: value, ...}]`, as `Cantrip.Protocol`'s messages
are: the key names the message, its fields by name, PascalCase. A tile is `[x, z]`, a time Unix milliseconds on the
server's clock. A frame whose key a client doesn't know is ignored. `realms/web/src/net/presence.ts` is the client.

| From | Key | Message | Fields |
| --- | --- | --- | --- |
| client | 0 | `Enter` | `Space` (`"world"` or an interior's id, the place last reported through `/api/position`; frame `920081a55370616365a5776f726c64` for the world) |
| client | 1 | `Move` | `From: [x, z]`, `Path: [[x, z], ...]` (the tiles after `From`, each a step of eight ways from the one before), `Speed` (tiles a second) |
| client | 2 | `Look` | `Body, Palette, Slots: {slot: {Mesh, Palette: ["#rrggbb", ...]}}` (a body name, and a worn item's `look`) |
| client | 3 | `Emote` | `Emote` |
| server | 0 | `Welcome` | `Instance` (the world's layer, or the interior's instance, from 1), `Player` (this connection's own number), `Others: [Other]` |
| server | 1 | `Other` | `Player, Name, Identity` (letters, as `Character`'s), `Look: {Body, Palette, Slots}, At: [x, z], Path, Speed, Since` |
| server | 2 | `Moved` | `Player, From, Path, Speed, Since` |
| server | 3 | `Looked` | `Player, Look` |
| server | 4 | `Emoted` | `Player, Emote` |
| server | 5 | `Left` | `Player` |
| server | 6 | `Refused` | `Reason, At`: a message refused, and where the player truly is |

- `Other` is sent for everyone the player sees in `Welcome`, and again whenever someone comes into sight: enters, or in
  the world walks within two chunks; `Left` when someone leaves or walks out of sight. `Moved`, `Looked` and `Emoted`
  reach those who see the player. `At` and `Path` are the walk the player is on (`Path` empty when standing), begun at
  `Since`, so a client that hears of it late starts it partway: a walk's length is counted along it (1 tile a straight
  step, the square root of 2 a diagonal one), and at a moment the player stands on the last tile of it they have reached
  at `Speed` since `Since`.
- `Player` is a number for the connection, never the player's account. A connection from a page of another origin than
  the world client's (`REALMS_CLIENT`) or the server's own is refused.
- `Enter` enters the space the character last reported standing in (`/api/position`), at that tile; another space, and
  any dungeon run, is refused. The character's look starts as their loadout's meshes.
- The server refuses a `Move` that starts on a tile nobody stands on, or more than one tile (Chebyshev) from where the
  player is (as far along their last walk as its speed has taken them); whose path leaves the space (off the world's
  chunks or the interior's tiles), crosses a tile nobody stands on, steps anywhere but to one of the eight tiles round,
  or cuts the corner of a blocked tile (Places, "Walking"); that is walked faster than walking allows
  (`REALMS_WALKING_SPEED`, 5 tiles a second; the overworld walks the player at 4.2), is longer than 256 steps, or comes
  more than 10 to a second; a refusal sends `Refused` with the player's true `At`, and they stay there.
- An emote is a lower-case id (`[a-z0-9-]`, 32 at most), two a second; a look is a body of `Character`'s, a palette 0-5,
  and for loadout slots only a gear mesh (Models, `RealmContent.GearMeshes`) and up to eight `#rrggbb` colors.
- The overworld reports where it is (`/api/position`) before it sends `Enter` for a space, so the server knows it is there.

## Spawns

A world spawn point's mobs are the client's to show and walk, and nobody else's; the server checks that a duel's mob
could be there. Both sides make a spawn's mob the same way, `<map>` being `world` (the key the golden vectors were made
with, so they hold as they are):

```
epoch  = floor(unix seconds / spawn.respawnSeconds)
seed   = fnv1a32("<player>|<map>|<spawn.id>|<epoch>")
mob    = spawn.mobs[seed % spawn.mobs.length]
```

`fnv1a32` is FNV-1a over the UTF-8 bytes, 32-bit; `<player>` is the character's id. The server accepts an encounter with
the mob of this epoch or the one before (a fight started just before the turn of an epoch), once per spawn per epoch.
Golden vectors are in `realms/content/spawn-vectors.json`, which the TypeScript and C# tests both check.
