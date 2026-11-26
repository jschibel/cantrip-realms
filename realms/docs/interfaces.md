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
them: more than 0, at most 1. A relic is in no pool, so no vendor stock, boss's loot, starter deck or mob deck holds one.
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
  "goldRange": [20, 60],
  "model": { "mesh": "elf", "palette": ["#2a4524", "#d6ae7e", "#c08a62"], "size": 0.9 },
  "boss": false,
  "hops": true,
  "lines": {
    "flawless": ["Mana in the morning, victory by noon. Such is Llanowar!", "..."],
    "solid": ["You trampled a few of us, but the forest always grows back.", "..."],
    "close": ["Oh, oh my. We are very glad that is over. Very glad.", "..."]
  }
}
```

- `gear` names gear items the mob wears, whose stats and emblems it starts with as a player does.
- `goldRange` is what a win against it pays, rolled between the two (design.md A3); a win pays gold and gear, never cards.
- A boss has `"boss": true` and `"unlocks": "W"`. A plane's capstone boss (`phyrexian-praetor`) has no `unlocks`: it
  ends the arc instead, and the relics drop from it. A boss names its own unique gear item, `"unique": "<gear id>"` (a
  gear item with `"unique": true`), and its `loot` - a filter of the plane's pool, `{pool, colors, types, subtypes,
  rarities}`, which only a boss has - holds rares or mythics for its gift (`/api/encounter/finish`).
- `model.mesh` is a mob mesh and `model.palette` its colors (Models, below).
- `creature` is the card the mob is (design.md A6): a creature (or, for a mage, a planeswalker) card the engine plays,
  held in its deck - a wanderer's name is its creature's, and its deck holds 2 to 4 of it.
- `named` (optional, `true`) marks a proper name: a legend the mob is named for, by the card's whole name or the start of
  it ("Teferi"). The world says it bare ("Rofellos, Llanowar Emissary attacks!"), any other mob with its article ("The
  Llanowar Elves attacks!", "the Phyrexian Praetor"); `realms/web/src/mobs.test.ts` holds it to the card's type line.
- `hops` says whether the mob hops a ledge a level high as a player does (Places, "Walking"), judged creature by
  creature: most that walk on legs and everything that flies do (`true`); zombies, oozes and slitherers, wurms and
  serpents, treefolk, giants and beasts too heavy to jump, constructs and an artillery crew do not (`false`), and go
  round by the ramps - or give up a chase at the brink. Only the browser walks mobs, so the server reads past it; it is
  written by hand, and `sample-decks.py` keeps it when it rewrites the file. `realms/web/src/mobs.test.ts` holds every
  file to having it.
- `region` is the region, by its color (world.json's `regions[].color`), the mob roams or belongs to; absent for a mob of
  none (the generic wardens, the Portal's mobs, the praetor). A world spawn of a region lists mobs of that region and its
  tier.
- `lines` is what the mob says when it beats the player, two or three lines of each kind: `flawless` when it lost no
  life, `solid` when it took some damage, `close` when it won on 25% of its life or less. A legend or a speaking people
  speaks in its own voice; a beast, an elemental or a construct gets a short narrated action in italics instead
  (`*The wurm settles back into its coils, unbothered.*`). The same line is said wherever the duel was, so none speaks of
  gold, paying or fighting a second time (the client adds the offer that follows); `realms/web/src/mobs.test.ts` holds
  each line to 160 characters and those words. The lines are written by hand: `sample-decks.py` keeps them when it
  rewrites the file. The client picks one at random of the kind the game's end calls for (`realms/web/src/hearts.ts`,
  `defeatLine`: `flawless` at its full starting life or more, `close` at a quarter or less), and a generic line where the
  file has none.
- `tools/realms/sample-decks.py` writes the whole roster and its decks (design.md A3, A6), each deck built round its
  creature - the creature, its kin, the cards that support what it does - and by tier: its gold range (tier 1 20-60,
  2 50-150, 3 120-300, 4 250-600, a boss 1,500), stats-only gear, and a boss's loot of its colors' rares and mythics
  within 6,000 gold.
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
    `phyrexian-gorger`, `gitaxian-mindcutter`); and the capstone's praetor (`phyrexian-praetor`, 32 life, a hand of 6, a
    maximum of 7 with its gear, as the balance lab fitted them), whose deck the script writes out card by card.

### The world, interiors and dungeons (`<plane>/world`, `<plane>/interiors`, `<plane>/dungeons`)

Design.md A6: one connected world, interiors entered through doors, and dungeons generated in the browser (the first
overworld's per-map files are gone). The server starts on the generated world; its tests also keep a small world of the
same files and ids (`realms/dotnet/Cantrip.Realms.Server.Tests/World/make-world.py`).

The server reads these files in version 2 of the world data, on square tiles ("Version 2 of the world data", below;
Places, below): what it reads of a chunk is its `cx`, `cz` and `tiles`, its buildings' `door` and `interior`
(the doors into interiors), its `npcs` (vendors, armorers, innkeepers, spell tables: a spell table is a `spell-table`
NPC), `spawns` and `entrances`; of an interior its `w`, `d`, `area`, `tiles`, `npcs`, `entry`, `exit` and `town`; of
world.json its `size`, `origin`, `chunk`, `tile`, `towns`, `inns`, `dungeons`, `pitches`, `ferries` and `zones` (what the
finds of the wilds spawn by: "Finds of the wilds", below). No file holds a chest or a heartbloom: they come and go.

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
  radius, style, region (a color, optional), start, home (a color, optional), plan (its streets: "Town plans",
  below)}], inns: [{id, town, x, z, interior}] (the
  inn's door tile, outside, which is its interior's `exit`), dungeons: [{id, x, z}], roads: [{from, to, tiles: [[x, z],
  ...]}] (each road's middle line, tile by tile, edge to edge), ferries, pitches, zones, overview}`:
  - a town is the square of tiles within `radius` of its `center` along x and along z (Chebyshev distance; `inTown`,
    `townAt` in format.ts): its walls (or its edge, where it has none) are an outline inside that square, hugging the
    land, and no spawn or waymarker stands within it (nor any find of the wilds);
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
  `entrances` and `waymarkers`, all in tiles but props' places, in world units. In Dominaria:
  - `npcs` stand outdoors on open tiles: townsfolk and guards who walk, ferrymen. What a player uses but nobody walks
    through - quest boards, the arena's gate, a dungeon's spell table and a mage tower's `waystone` (`tower` names it) -
    stands on a blocked tile of its own with `stand` (its middle), an open tile beside it, and a prop of the same id
    drawn there;
  - `spawns` are `[{id, x, z, mobs, radius, respawnSeconds, tier}]` on open tiles, with ids unique across the world
    (`"<cx>_<cz>:<n>"`: the chunk the spawn stands in, and a number);
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
  ferryman at each dock, pitches stand open in their towns, each town's streets are as its plan says ("Town plans",
  below), every id the art does not have is a documented placeholder, and the files are what the generator writes.
- **Interiors.** `interiors/<id>.json` is a room in the version-2 format (below): `{id, name, kind, town, style,
  w, d, area, tiles, props, npcs, lights, entry: [x, z], exit: [x, z]}`, `exit` the world tile it comes out on - its
  building's door tile - and `entry` its own tile at the door (stepping onto it leaves; one arrives a step in from it).
  Kinds: shop, inn, guildhall, temple, smithy, library, house, tower, and `exotic-wares` for an exotic wares shop
  (design.md A5). Its npcs include the vendors (`"kind": "vendor", "vendor": "<id>"`, id the vendor's), the armorer
  (`<town>-armorer`, in the smithy), the innkeeper (`<town>-innkeeper`), the healer (`"kind": "healer"`: the priest of a
  temple or the keeper of a shrine, `<interior>-keeper`, who sells hearts; design.md A3b) and the spell tables
  (`spell-table`: `<town>-inn-spell-table`, `<town>-guild-spell-table`); vendors, armorers and healers work only inside. An interior belongs to
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
  (optional), standing (optional)}`. `standing` deals a color's dungeon by where its color stands to the character's
  (design.md A6): `{own|ally|enemy: {tier, mobTiers: [low, high], bossStats: {life, hand, maxHand} (optional)}}`. A
  region's color is `own` when the character's identity holds it, else `ally` when it is next to their starting color on
  the wheel (W U B R G) and `enemy` when across from it - by the starting color, so a dungeon's standing never shifts with
  the order bosses are beaten in. A run dealt by a standing is of its `tier`; each floor's encounters are drawn from the
  mobs of its table of tiers `low` to `high`, or, where its table holds none, from every floor's that are; and the boss
  gains `bossStats` over its own. A standing not given deals the dungeon as written. The five color dungeons give
  `ally` (tier 3, T2-T3) and `enemy` (tier 4, T3-T4, the boss +6 life, +1 hand and maximum hand). The `warden` keeps the stair of every floor but the last (a dungeon that may have only one floor still
  names one if it may have two); the `boss` waits on the last floor; neither is a floor's encounter. A run's layout is
  the browser's (`realms/web/src/dungeon/generate.ts`, one generator per theme, on squares), made from the run's seed, and holds
  exactly the encounters the run names, each with its mob. world.json's `dungeons` places each at its entrance, where a
  chunk's `entrances` leads into it.

#### Town plans

A town in world.json carries its street plan, `plan` (`TownPlan` in format.ts; tiles of it in
`realms/web/src/world/streets.ts`), which the overworld's maps draw and the lint walks; the server reads nothing of it:

- `outline`: the corners of the town's outline, `[x, z]` tiles in order round it, which its wall, hedge or edge runs
  along (corner to corner in four-connected straight runs); `enclosure`: `wall`, `palisade`, `hedge` or `none`.
- `nodes`: `[[x, z], ...]`, the streets' junctions and ends; `ways`: `[{a, b, width, main?, via?}]`, each street between
  two junctions - nodes `a` and `b` (indices into `nodes`), its corners `via` between them - its tiles the straight
  four-connected runs from `a` through `via` to `b`, each run's tile widened by a square brush `width` tiles across
  (from `-floor((width - 1) / 2)` to `width - 1` more); `main` marks a main street (a gate's way in, those round or
  across the square).
- `squares`: `[{x, z, w, d, round?, name?}]`, the squares and plazas (the square, the market, a temple's close, the arena,
  a courtyard): `w` by `d` tiles from `(x, z)`, or the ellipse within them when `round`.
- `gates`: node indices, each gate's way out: the open tile outside the gate where a road arrives (a harbour's on its
  quay).
- `places`: `[{kind, name, x, z}]`, the places the maps name: the door tile of an `inn`, `shop`, `exotic-wares`,
  `guildhall`, `temple`, `shrine`, `library`, `tower` or `smithy`, the tile of the `quest-board` and the `arena`'s gate
  (used from beside them), and the caravans' `pitch`.

Every street tile of the town is a tile of a way or a square, and every door into the town's buildings opens onto one.
The lint (`lintTown`) holds a town to its plan: every way's ends, every door and every place walked to from every gate
over the open street tiles alone; no street running on more than a lot's depth (8 tiles) past its last junction to end
at no door; and no walk along the streets between two of its key places at least 12 tiles apart (gate to gate aside)
longer than twice the straight line between them.

#### Version 2 of the world data (types in `realms/web/src/world/format.ts`)

The art slice's small world is `realms/web/fixtures/slice-world`.

- `world.json`:
  - `{size: [width, height] (tiles), origin?: [x, z] (default [0, 0]), chunk: 32, tile: 1 (world units), bounds?:
    [x0, z0, x1, z1]}`: the world's tiles are `size` from `origin`; `bounds` (default the whole world) is where the
    camera keeps its view - tiles past it are scenery seen from a corner (the sample's wood round its edges). Dominaria
    keeps `origin` [0, 0] and no `bounds`.
  - plus the existing content: `regions` (`{color, name, tiles}`), `towns` (with `style`, `center: [x, z]`, `radius`,
    `start`, `home`, `plan`), `inns` (`{id, town, x, z, interior}`), `dungeons` (`{id, x, z}`), `ferries`, `pitches` (`{town, x,
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
  - `spawns`, `entrances`, `waymarkers`: as before, in tiles (`{x, z, ...}`).
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
  (flag 1), exactly as the overworld's grid (`realms/web/src/world/load.ts`) makes it walkable. The bare flag (2) is read
  and kept, and changes nothing about walking; heights and the ramp flag (4) make ledges (below). The camera's `bounds`
  change nothing.
- **Walking.** A walk is steps to any of the eight tiles round, over no ledge - two side-by-side tiles whose floors are
  more than 4 texels apart (a quarter of a tile, `LEDGE`), unless both are ramps - but a hop: a ledge no higher than 12
  texels (a terrace's one level, `HOP`), crossed straight across, never on a diagonal step. A player always hops; a mob
  as its file says (`hops`, Mobs above), and the server, which walks no mob, holds a player's walk to the hopping rule.
  Higher than 12 texels is a cliff nobody crosses. A diagonal step is taken only where both tiles it passes between are
  open and no ledge (nor hop) runs round the corner: it never cuts the corner of a blocked tile, nor steps up or down a
  bank on a slant (`realms/web/src/world/grid.ts`'s `canStep`, exactly; `RealmSpace.CanStep`). It starts on an open
  tile (the overworld's A* does not check the tile it starts from; nobody stands on a closed one). Golden vectors of
  paths and walks are `realms/content/walk-vectors.json` (`tools/realms/walk-vectors.ts`), a player's and (marked
  `"hops": false`) one's who does not hop, which the TypeScript and C# tests both check. A walk's length is counted along
  it, 1 tile a straight step and the square root of 2 a diagonal one, walked at a speed in tiles a second; a hop is part
  of a walk like any step, at the same speed (the overworld's figure arcs over it as it crosses, at walking pace).
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

Losing the last heart sends the character home to their inn, outside it in the world (world.json's `inns[].x, z`): the
one they set with `POST /api/inn` inside an inn, else the start town's (`REALMS_START_TOWN`, New Benalia), where a new
character begins. A game lost with hearts left leaves the character where they stand.

A place in a town fills the character's hearts to their capacity (design.md A3b): a world tile within a town's `radius`
of its `center` (Chebyshev), or any tile of an interior of a town. The server sees it in what `POST /api/position`
reports, the place it has checked as above, and answers with the hearts after it.

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
| `GET /api/collection` | | `{Cards: {name: count}, Prices: {name: gold}, Relics: [name]}`: `Prices` each owned card's list price (none for an unpriced card), for the spell table; `Relics` the owned cards that are relics (one copy in a deck and its sideboard), which the spell table marks |
| `GET /api/inventory` | | `{Cards: [{Name, Count, Gold, Deck, Sideboard, Relic}], Value}`: the collection card by card, in name order, each with its list price (0 for none), the copies the deck and the sideboard use and whether it is a relic; `Value` the collection at list price. The gear is the `Character`'s |
| `GET /api/catalog` | | every card the engine plays, as printed: `Cantrip.Protocol`'s `CardCatalogView`, MessagePack (`application/x-msgpack`), as the deck site's `/decks/api/catalog` is: the card layer's faces |
| `GET /api/deck` | | the `Deck` |
| `POST /api/deck/check` | `{Main, Sideboard}` | `{Problems: [...]}`: what `PUT /api/deck` would refuse them for (empty when it would take them), anywhere the character stands |
| `PUT /api/deck` | `{Main: [{Name, Count}], Sideboard: [{Name, Count}]}` | the `Deck`; 409 `NotAtTable`, 422 `IllegalDeck` with `Problems` |
| `PUT /api/loadout` | `{Slots: {slot: gearInstanceId or null}}` | the `Character`; 422 `IllegalLoadout` with `Problems` |
| `GET /api/vendor/{id}` | | `{Vendor: {Id, Name, Town, Specialty, Kind, Plane}, Purse, Stock: [{Name, Gold, Count, Until}], Gold, Buying: [{Name, Gold, Owned, Spare}]}`: `Kind` is `shop`, `exotic` or `trader`, `Plane` a trader's home plane (else null), `Town` a trader's caravan's town now; a visit is counted; 404 `NoVendor`, 409 `NotNear` |
| `GET /api/travelers` | | `{Travelers: [{Id, Name, Plane, PlaneName, Visit: {Town, From, Until} or null, Next: {Town, From, Until}}]}`: every traveling trader, in id order, the visit its caravan is on now (null between visits) and the next to begin |
| `POST /api/vendor/{id}/buy` | `{Name}` | `{Gold, Collection}`; 409 `SoldOut`, `CannotAfford` |
| `POST /api/vendor/{id}/sell` | `{Name}` | `{Gold, Collection}`; 409 `Relic` (a relic is never sold, whatever the vendor), `NotTheirTrade`, `VendorCannotAfford`, `VendorFull`, `InDeck`, `NotOwned` |
| `GET /api/armorer/{town}` | | `{Stock: [Gear]}`; 404 `NoArmorer` |
| `POST /api/armorer/{town}/buy` / `sell` | `{GearId}` / `{InstanceId}` | `{Gold, Gear: [GearInstance]}`; 409 `NotInStock`, `CannotAfford` / `NotOwned`, `Worn` |
| `POST /api/encounter/start` | `{Spawn, Mob}` in the world, or `{Run, Floor, Index, Mob}` in a dungeon | `{Token, Seed, Duel}` (below); 409 `NotNear`, `NotThere`, `TooSoon`, `Unfinished`, `Defeated` (a lost game still to answer); 404 `NotThere`; 422 `IllegalDeck` |
| `POST /api/dungeon/enter` | `{Dungeon}` | `{Run, Seed, Floors: [{Encounters: [{Index, Mob}], Warden: mob or null, Boss: mob or null, Tier: tier or null, BossStats: {Life, Hand, MaxHand} or null}], Dungeon, Floor: 0, Beaten: [], Resting: {Boss, Until} or null, Tier}`: the run (dealt by the character's standing to a color dungeon's color, Dungeons), its seed for the layout, and every encounter it holds - the last floor without its boss while the boss rests (`Resting`: a boss beaten within the week, back at `Until`); the character is in it (`run:<Run>`, tile 0, 0 until the browser reports the floor's `arrive`), and a run of theirs still live ends; 409 `NotNear` away from its entrance (on it or beside it, in the world), `Locked`; 404 `NotThere` |
| `GET /api/dungeon/run` | | the character's live run, as `/api/dungeon/enter` gives it with `Dungeon`, `Floor` (the floor reached) and `Beaten` (the encounters won, `<floor>:<index>`): what a reload resumes; 404 `NotThere` with none |
| `POST /api/dungeon/floor` | `{Run, Floor}` | `{}`: the character took the stair to `Floor`, the next floor down, allowed once the warden of the floor they stand on is beaten; 409 `WardenStands`, `NoWay` for any floor but the next, `NotNear` out of the run, `NotThere` for a run over; 404 `NotThere` |
| `POST /api/dungeon/shrine` | `{Run}` | `{Hearts}`: a prayer at the run's shrine (design.md A3b, A6), on the floor that holds it, where the character stands (the server holds them to the floor, the layout being the browser's): one heart given back, once in the run; 409 `NotThere` for a floor with no shrine or a run over, `Empty` once it has blessed, `FullHearts` with the hearts full (the blessing kept for later), `NotNear` out of the run; 404 `NotThere` for no run of theirs |
| `POST /api/dungeon/leave` | `{Run}` | `{}`: the run ends, and the character stands beside its entrance in the world (the first tile a step from it, in the order south, east, west, north, south-east, south-west, north-east, north-west, that is no door or entrance); 409 `NotThere` for a run over; 404 `NotThere` |
| `POST /api/waystone` | `{Tower}` | `{Place: {Space, X, Z}}`: travel at once from an attuned tower's waystone (the character in the world on or beside one of its `waystone` NPCs' tiles, or its entrance) to another attuned tower's, beside its entrance as leaving a run puts them; 409 `NotNear` away from a waystone, `NotAttuned` for either tower; 404 `NotThere` for no tower with a waystone |
| `POST /api/inn` | `{}` | `{Inn}`: the inn the character stands in (an interior of kind `inn` of a town) is their home now, world.json's inn of that town nearest its door; 409 `NotNear` anywhere else |
| `POST /api/encounter/finish` | `{Token, Log}` | `{Outcome: "won" or "lost", Gold, Gear, Relics: [name], Detail, Gift, Unlocked, Hearts, Defeat, Died, Forfeit}`; 404 `NoDuel`, 409 `Finished` |
| `POST /api/encounter/pay` | `{Token}` | `{Gold}`: the lost game's mob paid off (its `Defeat.Price`), the encounter over; 409 `NoBuyout` (a dungeon's mob), `CannotAfford`, `Finished` (no answer owed); 404 `NoDuel` |
| `POST /api/encounter/rematch` | `{Token, Main, Sideboard, PlayFirst}` | `{Token, Seed, Duel}`: the encounter's next game; 422 `IllegalDeck` with `Problems`; 409 `Finished`; 404 `NoDuel` |
| `POST /api/hearts/buy` | `{}` | `{Gold, Hearts, MaxHearts, Price}`: one more heart's capacity, filled, from a healer the character stands with (inside an interior with a `healer` NPC); `Price` the next one's, null at 5; 409 `NotNear`, `MostHearts`, `CannotAfford` |
| `GET /api/finds` | | `[{Id, Kind, X, Z, Until}]`: the finds of the wilds standing now (below), each `chest` or `heartbloom`, its tile, and when it goes if nobody takes it (UTC) |
| `POST /api/chest/open` | `{Space, Chest}` | `{Gold, Found, Gear, Hearts, Heart}`: a find of the wilds (`Chest` its `Id`; `Space` `world`) taken standing on or beside it (Places, "Proximity") - the character's gold and hearts after, and what it held; it is gone for everyone. A treasure chest: `Found` gold of its zone's tier (below), and `Gear` a gear item now theirs (`GearInstance`, or null: one chest in ten, uncommon in a chest whose gold starts at 300 or more, else common). A heartbloom (`Heart` true; design.md A3b): one heart given back, `Found` 0; 409 `FullHearts` with the hearts full (and the bloom left standing). 409 `NotNear`, `Empty` (taken by someone, crumbled, or never one); 404 `NoSuchPlace` for a space other than the world |
| `POST /api/position` | `{Space, X, Z}` | `{Hearts}`: where the character is (Places, above), and their hearts after it - a town fills them; 422 `NoSuchPlace` off the space or on a tile nobody stands on, 409 `NoWay` for a space reached without a door, entrance or waystone, `Locked` for a dungeon whose `requires` the identity lacks |

- `Character`: `{Id, Name, Body, Palette, Identity, Gold, Hearts, MaxHearts, HeartPrice, Defeat, Space, X, Z, Inn,
  Stats: {Life, Hand, MaxHand}, Loadout: {slot: GearInstance or null}, Gear: [GearInstance], Unlocked: [color], Attuned:
  [tower]}`. `Space`, `X`, `Z` are their place (Places, above; a live run's space names the run to resume); `Inn` their
  home inn's id; `Attuned` the mage towers whose waystones they have attuned, by dungeon id. `Id` is the player id
  (`discord-<id>`, `dev-<id>`) the spawn algorithm hashes. `Hearts` and `MaxHearts` are the hearts they have and hold
  (design.md A3b: 2 of 2 to start, 5 at most), `HeartPrice` what a healer asks for one more (null at 5), and `Defeat` a
  lost game still to answer (below), which a reload comes back to, or null. `Body` is one of
  `lithe`, `broad`, `tall`, `stocky` (as `POST /api/character` takes it); `Palette` 0-5, the skin and hair palette
  (`realms/web/src/character.ts`). `Identity` is the starting color and the unlocked ones, as one string of letters in WUBRG
  order (`"WU"`). The
  loadout's slots are `head`, `neck`, `body`, `hands`, `feet`, `ring1`, `ring2` and `relic`; a `ring` item fits either
  ring slot. `Stats` are the base (20, 7, 7) plus every worn item's.
- `Gear` is a gear item as its content file has it, PascalCase, with its `Emblem` (`"<name> (gear)"`, or null for an
  item with no effects) and its rarity's `Budget` of points (14 for a unique). `GearInstance` is one a character owns: `{InstanceId, Gear}`.
- `Deck`: `{Main: [{Name, Count}], Sideboard: [{Name, Count}]}`. Both may hold basic lands, which are free (any number of
  a basic land of the character's identity, and Wastes) and never in the collection. The sideboard is 15 cards at most;
  the copy limits (four, one of a card restricted in Vintage or a relic) count the deck and the sideboard together, and
  every card of both is within the identity. Every other copy in the deck and the sideboard together is owned.
- `PUT /api/loadout` changes only the slots it names; null empties one.
- A vendor's `Gold` is the character's; `Buying` is every card of theirs it deals in, with what it pays for one (`Gold`, half
  the list price rounded down), how many they own and how many of those are `Spare` (in neither the deck nor the sideboard):
  what the `vendor` screen offers to sell.
- A vendor trades with a character inside its shop (an interior with its `vendor` NPC), an armorer inside a smithy of
  its town (an interior of the town with an `armorer` NPC), else 409 `NotNear`; `/api/armorer/{town}` takes a town's id.
  A vendor sells at list price, the copy that would leave its shelf soonest first, and buys at half the list price
  rounded down.
- A run's shrine (design.md A6): as a run begins, one run in eight (`Dungeons.ShrineChance`) holds one, on a floor drawn
  at random, which says so (`Floors[n].Shrine`, true; the browser's layout stands it in a room on the way, a
  `heart-shrine` NPC on a blocked tile of its own, prayed at from beside it). The run says whether it has blessed
  (`ShrineUsed`, in `/api/dungeon/enter`'s and `/api/dungeon/run`'s reply); `/api/dungeon/shrine` is the prayer. A
  shrine's blessing is kept in the `chests` table (who, what, when; under the run's space, so it is once a run).
- **Finds of the wilds** (design.md A5, A3b; `Economy/Finds.cs`, and `realms/web/src/world/finds.ts` for the offline
  stand-in): treasure chests and heartblooms come and go, never kept in the world's files nor the store, and each is
  everyone's - the first to take it has it, and it is gone for all. Treasure chests spawn in each tier zone of the wilds
  (world.json's `zones`, a tier above 0): at most `REALMS_CHESTS_PER_ZONE` (2) at once, a new one about every
  `REALMS_CHEST_EVERY` (600 seconds, give or take half) while a zone has fewer, crumbling after `REALMS_CHEST_LASTS`
  (1,800) unopened; a chest's gold is its zone's tier's (1: 50-150, 2: 100-250, 3: 180-380, 4: 300-500). Heartblooms grow
  anywhere in the wilds: at most `REALMS_HEARTBLOOMS` (8) at once, each at least 150 tiles (Chebyshev) from the next, one
  about every `REALMS_HEARTBLOOM_EVERY` (1,800), wilting after `REALMS_HEARTBLOOM_LASTS` (10,800). A find stands on a
  random open tile of a zone with open, level ground all round (each of the eight round a step of the grid's) - never on
  worked ground (a `road`, `cobbles`, `flagstones`, `planks`, `wheat` or `furrows` tile), in a town, within 3 tiles of a
  door, an entrance, an NPC or a spawn point, within 8 of another find, or within 4 of a player the relay has there. A
  find closes no tile: it is walked onto (or clicked, which walks onto it) and taken there. The overworld asks for
  them every ten seconds in the world and on coming back into it. The world moves on when asked, on the server's clock;
  a server started anew grows its own.
- A dungeon encounter is the run's: the server checks that the run is the character's (404 `NotThere`) and live (409
  `NotThere`), that they stand in it (409 `NotNear`), that `Floor` is the one they stand on (0 the first; 409
  `NotThere`), that `Index` is an encounter of that floor (404 `NotThere`) not yet fought (409 `TooSoon`), and that `Mob`
  is its mob (409 `NotThere`). A floor's encounters are indexed from 0; its warden's index is the count of its
  encounters, its boss's one more. A game of a run lost with hearts left is fought again (its mob is never paid off);
  losing the last heart in a run ends it, and takes back what it won; leaving it ends it too, and a game of it lost and
  not yet answered with it. Beating the boss of a dungeon with a waystone attunes it. A boss (`"boss": true`) beaten rests for a week (`Dungeons.BossRest`, from the win): a run begun meanwhile
  has no boss on its last floor (so its boss's index is no encounter), and says so in `Resting`. A mage or a wanderer
  that ends a dungeon never rests. A run dealt by a standing (Dungeons, `standing`) keeps it as it began: each floor says
  its `Tier`, the last floor what its boss gains (`BossStats`, `{Life, Hand, MaxHand}`, added to the boss's seat), and
  the run its `Tier` (the dungeon's own for a run dealt as written).
- A deck is saved (`PUT /api/deck`) beside a spell table of the world or an interior, or in a dungeon's antechamber: the
  first floor of a live run of the character's, whose spell table is the layout's (the server takes any tile of a run).
- `POST /api/encounter/start` in the world checks, in order: an unfinished duel (it counts as lost now - a heart gone, as
  any loss - and the call is refused 409 `Unfinished`); a lost game still to answer (409 `Defeated`); the spawn (404
  `NotThere`); that the mob
  is one of the spawn's (409 `NotThere`); that the character is in the world within `radius + 8` tiles of the spawn point
  (its wander radius, the 6 it chases, and 2 for walking on since the last report; Chebyshev, Places; 409 `NotNear`);
  that the spawn holds
  that mob for the character this epoch or the one before (409 `NotThere`) and that it has not been fought in that epoch
  (409 `TooSoon`); and that the deck is legal (422 `IllegalDeck`). Then it commits the duel. A duel not finished within
  24 hours counts as lost.
- `POST /api/encounter/finish`: `won` only when the log is accepted and seat 1 alone won it; a draw, the mob's win and a
  log not accepted are `lost`, with the reason in `Detail`. A win's `Gold` is rolled from the mob's gold range and paid at
  once; `Gear` is the gear item a win dropped (`GearInstance`, or null), already the character's: 10, 15, 20 or 30 wins in
  a hundred by tier, common in tiers 1 and 2, uncommon in 3, rare in 4; a boss always drops its unique. A win offers no
  cards. `Relics` are the relics a boss win dropped, in `relics.json`'s order, already in the collection; empty for any
  other win and every loss. A win against a boss rolls, at its chance, each relic whose entry names that boss and that is
  not in the account's relic ledger, and also gives `Gift`, one rare or mythic of its loot (of its loot's subtypes where it
  has any), into the collection at once; `Unlocked` names the color the win unlocked, null when it was held already (or
  for the capstone); its `Gear` is its own unique item while the character owns none of it, else a rare or mythic item
  that is no unique. Any other win's `Gift` and `Unlocked` are null. Each relic that comes up is added to the collection
  and to the ledger in the same transaction as the win. `Hearts` are the character's after the game.
- A loss (design.md A3, A3b) pays nothing and takes a heart. With hearts left, `Defeat` is the game to answer, which the
  `Character` keeps until it is: `{Token, Mob, Spawn, Epoch, Game, Hearts, MaxHearts, MobLife, MobFullLife, Price, Main,
  Sideboard}` - the mob (its id), where it was met (a world spawn's id, or a run's `<floor>:<index>`) and the spawn's
  epoch, which game of the encounter it was (from 1), the mob's life at the game's end as the replayed log has it (its
  starting life for a game not played out), its full starting life for the encounter (its gear's and a run's gains with
  it), its buyout, and the deck and sideboard the game was played with. `Price` is `round(base x min(1, MobLife /
  MobFullLife))`, at least 1 gold, the base by the mob's tier (30, 120, 400, 1,200 gold for tiers 1-4), or null for a mob
  of a dungeon run, which is never paid off. The character stays where they stand. With no heart left, `Died`: the
  character is at their inn with their hearts full; in a run, the run is over and `Forfeit` is what it had won, taken
  back, `{Gold, Cards: [name], Gear: [name]}` - its wins' gold (as much as the character still has), the gear items
  they dropped (taken off if worn), and the cards they gave (a boss's gift, a relic, whose ledger entry goes too), from the
  collection and, where those held the copies gone, the sideboard and then the deck. Outside a run nothing else is lost.
- `POST /api/encounter/rematch` deals the encounter's next game: `Main` and `Sideboard` must be a legal deck and sideboard
  (as `PUT /api/deck` would judge them) holding between them exactly the cards, free basic lands aside, the last game's
  deck and sideboard held; the saved deck is unchanged. The player's seat is dealt from their loadout at their full
  starting life, with that deck and sideboard; the mob's seat is the last game's with `StartingLife` the life it ended
  that game with, carried as it is (never healed or capped); `Duel.Game` is one more, and `Duel.FirstPlayer` is 1 when
  `PlayFirst` (the loser of the last game chooses, CR 103.1), else 2. It is finished and judged as any game.
- `Duel`: everything the browser deals the game from - `{Seats: [the NewGame seat of docs/host-protocol.md, with
  StartingLife, StartingHandSize, MaximumHandSize, Emblems], MinimumDeckSize: 40, Seed, Mob: {Name, Tier}, Game,
  FirstPlayer}`. The player is seat 1, the mob seat 2. Each seat's setup values are always given: its stats with its
  gear's, and an emblem per worn item with effects; the player's `Sideboard` is their sideboard, the cards they own
  outside the game (CR 100.4a). `Seed` is below 2^53, so a JavaScript number carries it whole. In an encounter's first game
  `FirstPlayer` is null and nobody chooses who plays first (CR 103.1, decided from the seed); in a later one it is the
  seat the player chose, dealt as the host's `NewGame` `FirstPlayer`. `Mob.Tier` is 0 for a boss.
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
  `REALMS_DEV_SIGNIN=1` also takes `POST /dev/signin {Id, Name}`, signing in as `dev-<Id>`, and `GET
  /dev/signin?id=<Id>&name=<Name>` from a browser, which signs in the same way and goes on to the world client (without
  an id and a name it is a form asking for them; `/home` sends a player not signed in there when Discord is not
  configured, so the world's "sign in", `GET /signin`, lands on it): development and tests only.
  Such a server alone also takes calls for tests, on the signed-in cookie, that arrange what play would take long to
  reach (the end-to-end suite against the real server, `realms/web/e2e/server/`): `POST /dev/place {Space, X, Z}` puts
  the character at once on an open tile of the world or an interior (422 `NoSuchPlace` otherwise), `POST /dev/verdict
  {Outcome, MobLife}` (`"won"`, `"lost"`, or null to replay again) judges the player's duels as it says in place of
  replaying their logs, so the card layer's stand-in counts as a win, the mob ending each at `MobLife` (null: the life it
  began the game with); `POST /dev/drop {Gear, Shrine}` (each `true`, `false`, or null
  for the dice again) decides whether the player's gear rolls, a win's and a chest's, come up, and whether a run they
  begin holds a shrine; `POST /dev/hearts {Hearts, MaxHearts}` sets the character's hearts (and capacity, if given; 422
  `NoSuchHearts` for none a character can have), as a test arranges a heart missing; `POST /dev/duel {Player, Mob}`
  deals the player's next duels with a seat's setup changed - each `{StartingLife, StartingHandSize, MaximumHandSize,
  Deck, Emblems}`, any of them, or null to leave that seat; two nulls deal them as they are again - as a scenario forces a
  position (a mob beginning at 0 life loses as it would first receive priority, CR 704.5a): the duel is committed, played
  and replayed so, and its result is the engine's; and `POST /dev/cards {Name, Count}` adds copies of a card the engine
  plays to the collection (a negative count takes them; 422 `NoSuchCard` otherwise), as a test arranges what is owned;
  `GET /dev/where` says where the presence relay has each of the player's connections now (`[{Member, Space, X, Z}]`),
  what a test reads the page's walks against; `POST /dev/find {Kind, X, Z, Clear}` stands a find of the wilds (`chest` or
  `heartbloom`) on an open tile of the world now, every other taken away first when `Clear` (422 `NoSuchPlace`
  otherwise), as a test arranges one rather than waiting on the spawner's dice; and `POST /dev/log {Text}` writes what the page saw to the server's log
  (the overworld's report of a jump of the player's figure, with the presence events before it; at most 16 KB).
  Never in production.

## The card layer (`window.postMessage`)

The overworld asks the card layer (`?realm` in `Cantrip.Client.Web`, framed over the world) for a screen with
`{realm: 1, op: "open", id, screen, args}` and hears `{realm: 1, op: "closed", id, outcome, result?}` when it closes
(`realms/web/src/cardLayer.ts`, `Realm.js`). What each screen is opened on, and what it hands back:

| `screen` | `args` | `outcome` and `result` |
| --- | --- | --- |
| `duel` | `{token, seed, duel: Duel, mob: {id, name, tier, goldRange, map, spawn}, hearts: {have, hold}}` (a game's start) | `won` or `lost`; `result.log`: the `Log` for `/api/encounter/finish`; `result.life: {player, mob}`: each seat's life as the game ended (the offline API's word for the mob's) |
| `sideboard` | `{mob, game, main: [{Name, Count}], sideboard: [{Name, Count}], identity, mobLife}`: the last game's deck and sideboard (a `Defeat`'s) | `closed`; `result: {main, sideboard, playFirst}` for `/api/encounter/rematch`; cut short, nothing, and the overworld deals the deck as it was, playing first |
| `loot` | `{mob, gear}` from a won duel, `{mob: "The chest", source: "chest", gear}` from a chest | `closed` |
| `spell-table` | `{map, name}` | `closed` |
| `vendor` | `{id, name}`: the vendor's id | `closed` |
| `gear` | `{name}`, or `{armorer: <town id>, name}` at an armorer | `closed` |
| `inventory` | `{name}` | `closed` |

The overworld calls the API around the screens (start before a duel, finish and loot after it); the card layer calls
the API for what happens inside one (buying, selling, saving the deck and the loadout), on the signed-in cookie. It is
framed as `<card layer>?realm&api=<server>`: `api` is the realm server the overworld talks to, absent when the card
layer is served from the server's own origin, and absent offline, when the card layer reads `/api/catalog` from its own
origin (`realms/web/scripts/cardLayer.mjs` serves the file `cantrip-realms-server catalog <file>` writes) and is opened
only for `duel`, `sideboard` and `loot`. `&art=<address>` tells it where card art is when not beside its own page (a realm server
started with `REALMS_ART`, for local play). A card layer on an origin of its own is named to the server as
`REALMS_CARDS`, the one origin beside the world client's (`REALMS_CLIENT`) that the API answers from a browser. A screen cut short closes
`dismissed` or `replaced`, which the overworld treats as a loss for a duel; a duel cut short still hands back its log so
far (the server takes it as a loss, the game not being over).

- `duel`: the card layer first shows the encounter's splash (design.md A3: the mob's tier, life, hand and gear, three
  cards of its deck, its gold range, and the player's hearts; for a game after the first, which it is and the mob's
  carried life) while the engine loads, and deals the duel when the player goes on (`Fight`). It deals the `Duel` on the rules engine in its page (`engine/cantrip_wasm.wasm` beside it, or
  `?engine=`) through `Cantrip.Realms`' `DuelTable`, the table the server's replay deals on, with no clocks. It closes
  `won` only when seat 1 alone won, after the player has seen the result; a concession closes `lost` at once.
- `loot` shows `gear` - the `GearInstance` a win dropped or a chest held, already the character's - as its Vanguard-style
  card, with a button that wears it (`PUT /api/loadout`); the overworld opens it for a win that dropped gear, and for a
  chest that held gear. `sideboard` is the spell table's editor over the cards it was opened on alone, judged in the page
  (forty or more in the deck, fifteen or fewer beside it; the server judges the rematch's deck all the same), and asks
  play or draw when `Fight` is clicked. `spell-table` reads the collection, the deck and
  `/api/catalog`, judges the deck and the sideboard by `/api/deck/check` and saves with `PUT /api/deck`; `vendor` and `gear` trade and
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
ends on); a player entering the world takes the
first layer whose players within two chunks of them number fewer than 40 (`REALMS_INSTANCE_SIZE`), and keeps it until
they leave. In an interior, among those in the same instance of it (40 to an instance, another opening when one is
full). A dungeon run is single-player and shares nothing. Nothing else is shared between players (design.md A6). Each frame is a MessagePack union, `[key, {Field: value, ...}]`, as `Cantrip.Protocol`'s messages
are: the key names the message, its fields by name, PascalCase. A point is `[x, z]` in world units, at any fraction
(tile (x, z) covers [x, x + 1) by [z, z + 1), so its middle is (x + 0.5, z + 0.5); a whole number may be written as an
integer), a time Unix milliseconds on the server's clock. A frame whose key a client doesn't know is ignored. `realms/web/src/net/presence.ts` is the client.

| From | Key | Message | Fields |
| --- | --- | --- | --- |
| client | 0 | `Enter` | `Space` (`"world"` or an interior's id, the place last reported through `/api/position`; frame `920081a55370616365a5776f726c64` for the world) |
| client | 1 | `Move` | `From: [x, z]`, `Path: [[x, z], ...]` (the points after `From`, walked in straight lines from one to the next), `Speed` (tiles a second) |
| client | 2 | `Look` | `Body, Palette, Slots: {slot: {Mesh, Palette: ["#rrggbb", ...]}}` (a body name, and a worn item's `look`) |
| client | 3 | `Emote` | `Emote` |
| server | 0 | `Welcome` | `Instance` (the world's layer, or the interior's instance, from 1), `Player` (this connection's own number), `Others: [Other]` |
| server | 1 | `Other` | `Player, Name, Identity` (letters, as `Character`'s), `Look: {Body, Palette, Slots}, At: [x, z], Path, Speed, Since` |
| server | 2 | `Moved` | `Player, From, Path, Speed, Since` |
| server | 3 | `Looked` | `Player, Look` |
| server | 4 | `Emoted` | `Player, Emote` |
| server | 5 | `Left` | `Player` |
| server | 6 | `Refused` | `Reason, At`: a message refused, and where the player truly is (a point) |

- `Other` is sent for everyone the player sees in `Welcome`, and again whenever someone comes into sight: enters, or in
  the world walks within two chunks; `Left` when someone leaves or walks out of sight. `Moved`, `Looked` and `Emoted`
  reach those who see the player. `At` and `Path` are the walk the player is on (`Path` empty when standing), begun at
  `Since`, so a client that hears of it late starts it partway: at a moment the player is as far along its lines as
  `Speed` has taken them since `Since`.
- `Player` is a number for the connection, never the player's account. A connection from a page of another origin than
  the world client's (`REALMS_CLIENT`) or the server's own is refused.
- `Enter` enters the space the character last reported standing in (`/api/position`), at that tile's middle; another
  space, and any dungeon run, is refused. The character's look starts as their loadout's meshes.
- The server refuses a `Move` that starts on a tile nobody stands on, or more than 1.5 tiles (in a straight line) from
  where the player is (as far along their last walk as its speed has taken them); one of whose lines leaves the space
  (off the world's chunks or the interior's tiles) or crosses tiles that are not each a step of the grid's from the one
  before - a tile nobody stands on, a cliff, or (through a tile's corner, a diagonal step) the corner of a blocked tile or
  a ledge; a ledge a level high is hopped straight across (Places, "Walking"; `RealmSpace.CanWalk`, and `legClear` of
  `realms/web/src/render/motion.ts`, the same rule; the overworld's body, which never overlaps a blocked tile nor stands
  across a ledge but mid-hop, walks only such lines); that is
  walked faster than walking allows (`REALMS_WALKING_SPEED`, 5 tiles a second; the overworld walks the player at 4.2),
  has more than 256 points or is longer than 256 tiles, or comes more than 10 to a second; a refusal sends `Refused`
  with the player's true `At`, and they stay there. The overworld tells a click's walk from where its figure is through
  the points ahead (again whenever the figure and the server's reckoning are half a tile apart), and a held walk as it is
  walked, every 150 ms, from where the last ended through where the figure has been (`realms/web/src/net/relay.ts`).
  After a refusal it tells the grid's way from `At` to where its figure stands (24 steps at most) at the fastest, rather
  than snapping the figure back; only where there is none, or that is refused too, does it stand the figure on `At`.
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
