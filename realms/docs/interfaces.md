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

### Planes and pools

- `planes.json`, `prices.json`, `pools/<plane>.json`: `tools/realms/card-economy.py` (the card economy, design.md A5).
  A relic is priced but in no pool.

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
- `look` is how it shows on a character: a gear mesh of `realms/content/models` (below) and its palette.

### Mobs (`<plane>/mobs/*.json`)

```json
{
  "id": "phyrexian-scout",
  "name": "Phyrexian Scout",
  "tier": 1,
  "deck": "decks/realms/dominaria/phyrexian-scout.txt",
  "stats": { "life": 20, "hand": 7, "maxHand": 7 },
  "gear": [],
  "prize": 100,
  "goldRange": [20, 60],
  "loot": { "pool": "dominaria", "colors": "B", "types": [], "subtypes": ["Phyrexian"], "rarities": ["common", "uncommon"] },
  "model": { "mesh": "humanoid", "palette": ["#8c909c", "#7a1f24"], "size": 1.15 },
  "boss": false
}
```

- `prize` is the mob's prize value in gold; the prize cap of a duel is `min(ante value, prize)` (design.md A3).
- `gear` names gear items the mob wears, whose stats and emblems it starts with as a player does.
- `loot` filters the plane's pool for the three cards offered after a win.
- A boss has `"boss": true` and `"unlocks": "W"`. A plane's capstone boss (`phyrexian-praetor`) has no `unlocks`: it
  ends the arc instead, and the relics drop from it.
- `model.mesh` is a mob mesh of `realms/content/models` (below).
- `tools/realms/sample-decks.py` writes every mob the maps name, and its deck, by tier (design.md A3, A6): its prize
  (tier 1 100 gold, 2 300, 3 800, 4 2,000, a boss 6,000), its gold range, loot of its colors in the rarities its prize can
  buy, and stats-only gear. Wilderness and encounter maps hold tiers 1-2, a dungeon's floors 2-4 (3-4 below the first),
  each floor's `*-warden` keeper is a tier 4 mini-boss, and the last floor's `boss` spawn one of the five bosses. The
  Phyrexian Portal's floors hold tier 4 mobs only, the `portal-warden`, and the capstone's praetor, whose deck the script
  writes out card by card.

### The world, interiors and dungeons (`<plane>/world`, `<plane>/interiors`, `<plane>/dungeons`)

Design.md A6: one connected world, interiors entered through doors, and dungeons generated in the browser. This section
replaces the per-map files of the first overworld (`<plane>/maps/*.json`), which the world's generator retires.

- **The world.** `world/world.json` holds `{size: [width, height], chunk: 32, regions: [{color, name, hexes}], towns: [{id,
  name, kind: town|village|capital, center: [q, r], radius, style}], inns: [{id, town, q, r}], dungeons: [{id, q, r}],
  roads: [...]}`. `world/chunks/<cq>_<cr>.json` is each 32-by-32 chunk, in the axial hexes of `realms/web/src/hex.ts`:
  - `tiles` are `[q, r, height, terrain, blocked]`, as before;
  - `props` are scenery (trees, rocks, buildings' outer shells, walls, lamps);
  - `doors` are `[{q, r, interior}]`: walking onto one enters that interior;
  - `npcs` stand outdoors (quest boards, townsfolk, guards);
  - `spawns` are `[{id, q, r, mobs, radius, respawnSeconds}]`, with ids unique across the world (`"<cq>_<cr>:<n>"`);
  - `chests` are as before;
  - `entrances` are `[{q, r, dungeon}]`.

  A chunk is loaded as the player nears it and dropped as they leave. Every file is written by the world generator
  (`realms/web/scripts/world.ts`) and checked in. The generator is seeded, and hand-made set pieces (town squares, the
  portal's gate) are placed in its code. The lint checks the whole world is reachable from every inn.
- **Interiors.** `interiors/<id>.json` is a small scene of the same tiles, props and npcs, with `kind` (shop, inn,
  guildhall, temple, smithy, library, house, tower) and `exit: {q, r}`, where its door comes out in the world. Its npcs
  include the vendors (`"kind": "vendor", "vendor": "<id>"`), the armorer, the innkeeper and the spell table. An interior
  belongs to the town whose door leads into it (a vendor file's `town`, an armorer's town).
- **Mage towers** are dungeons of theme `tower` with `"waystone": true`: beating the run's boss attunes the tower to the
  character (`Character.Attuned: [tower ids]`, kept by the server), and its waystone stands at its entrance in the world.
- **Spawn tiers.** Each world spawn point carries `tier`, the tier of its distance from the nearest starting area (A6),
  and lists only mobs of that tier.
- **Dungeons.** `dungeons/<id>.json` is `{id, name, theme: caves|castle|tower|crypt|hollow|foundry|portal, entrance:
  [q, r], requires: "WUBRG" (optional), floors: [min, max], tier, encounters: [min, max] per floor, mobs: [[mob ids] per
  floor or one list for all], warden, boss, region}`. A run's layout is the browser's
  (`realms/web/src/dungeon/generate.ts`, one generator per theme), made from the run's seed, and holds exactly the
  encounters the run names, each with its mob.

### Places

A character's place is `{Space, Q, R}`: `Space` is `"world"`, an interior's id, or `"run:<run>"` for a dungeon run, and
`Q`, `R` a hex of it. The server keeps the last reported place (`POST /api/position`, which replaces `/api/travel`): it
checks that a world or interior place is walkable, and that a move between spaces goes through a door, an entrance or a
waystone. A lost duel sends the character to the inn they set (or their home town's), as before.

### Models (`models/<id>.vox.json`)

What characters, mobs and gear look like: palette-indexed voxels cut into parts, meshed in the browser (greedy, at
load) and drawn larger than life, a voxel to one and a half scene pixels (`FIGURE_SCALE`, `realms/web/src/character.ts`).
Each color is shown as the plane's palette color nearest it, a step down or up its ramp for the light band
(`realms/web/src/palette.ts`), so a model's colors, a mob's `model.palette` and a gear item's `look.palette` are best
taken from the palette, and a model is a few bold areas of color rather than stripes or speckles. The format is
`realms/web/src/voxel/format.ts`; the files are
written by `realms/web/scripts/models.ts` (`npm run models`) and may be tuned by hand. `realms/web/models.html` shows
them all.

```json
{ "id": "helm", "kind": "gear", "voxel": 0.0625, "palette": ["$0", "$1", "#0b0c10"],
  "parts": [{ "name": "helm", "mount": "head-top", "pivot": [0, 0, 0], "origin": [4, 4, 4], "size": [8, 7, 8], "fit": [6, 0, 6],
              "layers": [[".000000.", "0......0", "..."], ["..."]] }] }
```

- `kind` is `body`, `mob` or `gear`. A part's `layers[y][z]` is a row of voxels along x: `.` empty, else a palette index
  in base 36. Parts hang from a `parent` part (bodies and mobs) or a body's attachment point, `mount` (gear), and turn
  about their `pivot` with their `motion` (legs and arms swing, wings beat, a wurm's segments ripple).
- `"$n"` in a palette is the n-th color of the palette the model is drawn with: a mob's `model.palette`, a gear item's
  `look.palette`, or a body's `[skin, hair, cloth, trim, leather]` (cloth and trim from the character's identity).
  A `$n` past the colors given takes the last one given.
- Bodies: `body-lithe`, `body-broad`, `body-tall`, `body-stocky`, each with every attachment point (`head-top`, `brow`,
  `neck`, `torso`, `back`, `arm-left`, `arm-right`, `hand-left`, `hand-right`, `leg-left`, `leg-right`, `foot-left`,
  `foot-right`, `orbit`) and the size of the region there, which gear is stretched to by its `fit`.
- Gear meshes (a gear item's `look.mesh`): `circlet`, `helm`, `amulet`, `armor`, `robe`, `gloves`, `boots`, `ring` (on the
  right hand in `ring1`, the left in `ring2`; it glows) and `relic` (it floats beside you).
- Mob meshes (a mob's `model.mesh`; `model.size` scales it): `humanoid` (a soldier), `ghoul`, `angel`, `drake`, `elf`,
  `goblin`, `wurm`, `construct`, `spirit`, `phyrexian`. An unknown mesh is drawn as `humanoid`.
- A spell table is a `spell-table` NPC; a character stands at one beside it.

### Vendors (`<plane>/vendors/*.json`)

```json
{ "id": "argive-goblin-trader", "name": "Grizzlegom's Goblins", "town": "new-argive",
  "specialty": { "subtypes": ["Goblin"] }, "purse": 50000 }
```

`specialty` is any of `colors` (a color identity the card's is within), `types`, `subtypes`, `rarities`, `names` (a theme
listed outright) - all that are given must hold. Its pool is the plane's pool filtered by it. Every vendor keeps a stall on
its town's map: a `vendor` NPC there names it.

The server reads all of this at start and refuses to start on content that does not hold together: every mob, vendor and
map a map names is there (spawns' mobs, vendor NPCs, exits, the world map's encounter maps, inns), every mob's deck, gear
and model resolve, every mob and vendor is met on some map, every relic is a card from a boss and in no pool, and every
`requires` is colors' letters (`ContentTests`).

## The realm server's API (`/api`)

Every call but sign-in needs the signed-in cookie (`SiteSignIn`'s; 401 `NotSignedIn` without it). A refused call is HTTP
4xx with `{"Error": "<code>", "Detail": "<words>", "Problems": [...] or null}`; codes are named below. Any call of a
player with no character is 404 `NoCharacter`.

| Call | Body | Reply |
| --- | --- | --- |
| `GET /api/me` | | the `Character` (below), or 404 `NoCharacter` |
| `POST /api/character` | `{Name, Body, Palette, Color}` | the new `Character`; 409 `HasCharacter`; 400 for a name (2-24 letters, digits, spaces, `'` and `-`), body (`lithe`, `broad`, `tall`, `stocky`), palette (0-5) or color (W U B R G) that is none |
| `GET /api/collection` | | `{Cards: {name: count}}` |
| `GET /api/catalog` | | every card the engine plays, as printed: `Cantrip.Protocol`'s `CardCatalogView`, MessagePack (`application/x-msgpack`), as the deck site's `/decks/api/catalog` is: the card layer's faces |
| `GET /api/deck` | | the `Deck` |
| `POST /api/deck/check` | `{Main, Ante}` | `{Problems: [...], AnteValue}`: what `PUT /api/deck` would refuse them for (empty when it would take them), anywhere the character stands, and the ante's worth |
| `PUT /api/deck` | `{Main: [{Name, Count}], Ante: [{Name, Count}]}` | the `Deck`; 409 `NotAtTable`, 422 `IllegalDeck` with `Problems` (a relic in the ante is one) |
| `PUT /api/loadout` | `{Slots: {slot: gearInstanceId or null}}` | the `Character`; 422 `IllegalLoadout` with `Problems` |
| `GET /api/vendor/{id}` | | `{Vendor: {Id, Name, Town, Specialty}, Purse, Stock: [{Name, Gold, Count, Until}], Gold, Buying: [{Name, Gold, Owned, Spare}]}`; a visit is counted; 404 `NoVendor` |
| `POST /api/vendor/{id}/buy` | `{Name}` | `{Gold, Collection}`; 409 `SoldOut`, `CannotAfford` |
| `POST /api/vendor/{id}/sell` | `{Name}` | `{Gold, Collection}`; 409 `Relic` (a relic is never sold, whatever the vendor), `NotTheirTrade`, `VendorCannotAfford`, `VendorFull`, `InDeck`, `NotOwned` |
| `GET /api/armorer/{town}` | | `{Stock: [Gear]}`; 404 `NoArmorer` |
| `POST /api/armorer/{town}/buy` / `sell` | `{GearId}` / `{InstanceId}` | `{Gold, Gear: [GearInstance]}`; 409 `NotInStock`, `CannotAfford` / `NotOwned`, `Worn` |
| `POST /api/encounter/start` | `{Spawn, Mob}` in the world, or `{Run, Floor, Index, Mob}` in a dungeon | `{Token, Seed, Duel}` (below); 409 `NotNear`, `NotThere`, `TooSoon`, `Unfinished`, `Locked`; 404 `NotThere`; 422 `IllegalDeck` |
| `POST /api/dungeon/enter` | `{Dungeon}` | `{Run, Seed, Floors: [{Encounters: [{Index, Mob}], Warden, Boss: mob or null}]}`: the run, its seed for the layout, and every encounter it holds; 409 `NotNear` away from its entrance, `Locked` |
| `POST /api/dungeon/floor` | `{Run, Floor}` | `{}`: the character took the stair to `Floor`, allowed once that floor's warden before it is beaten; 409 `WardenStands` |
| `POST /api/dungeon/leave` | `{Run}` | `{}`: the run ends, and the character stands at its entrance |
| `POST /api/waystone` | `{Tower}` | `{Place}`: travel at once from an attuned tower's waystone (where the character stands) to another attuned tower's; 409 `NotNear` away from a waystone, `NotAttuned` for either tower |
| `POST /api/encounter/finish` | `{Token, Log}` | `{Outcome: "won" or "lost", Gold, Offer: [{Name, Gold}], Cap, Gear, Relics: [name], Detail}`; 404 `NoDuel`, 409 `Finished` |
| `POST /api/encounter/loot` | `{Token, Picks: [name]}` | `{Cards: {name: count}}`, the collection; 422 `OverCap`, `NotOffered`; 409 `Finished` |
| `POST /api/chest/open` | `{Map, Chest}` | `{Gold, Found}`: the character's gold, and what the chest held; 409 `NotNear`, `Empty`; 404 `NoSuchPlace` |
| `POST /api/position` | `{Space, Q, R}` | `{}`: where the character is (Places, above); 422 `NoSuchPlace` off the space or on a blocked hex, 409 `NoWay` for a space reached without a door, entrance or waystone, `Locked` for a dungeon whose `requires` the identity lacks |

- `Character`: `{Id, Name, Body, Palette, Identity, Gold, AnteValue, Map, Q, R, Stats: {Life, Hand, MaxHand},
  Loadout: {slot: GearInstance or null}, Gear: [GearInstance], Unlocked: [color]}`. `Id` is the player id (`discord-<id>`,
  `dev-<id>`) the spawn algorithm hashes; `AnteValue` the sum of the ante's list prices, for the HUD. `Body` is one of
  `lithe`, `broad`, `tall`, `stocky` (as `POST /api/character` takes it); `Palette` 0-5, the skin and hair palette
  (`realms/web/src/character.ts`). `Identity` is the starting color and the unlocked ones, as one string of letters in WUBRG
  order (`"WU"`). The
  loadout's slots are `head`, `neck`, `body`, `hands`, `feet`, `ring1`, `ring2` and `relic`; a `ring` item fits either
  ring slot. `Stats` are the base (20, 7, 7) plus every worn item's.
- `Gear` is a gear item as its content file has it, PascalCase, with its `Emblem` (`"<name> (gear)"`, or null for an
  item with no effects). `GearInstance` is one a character owns: `{InstanceId, Gear}`.
- `Deck`: `{Main: [{Name, Count}], Ante: [{Name, Count}], AnteValue}`. The main deck holds the basic lands too, which
  are free (any number of a basic land of the character's identity, and Wastes) and never in the collection; the ante
  holds no basic land and no relic, and the main deck at most one copy of a relic. Every other copy in the deck and the
  ante together is owned.
- `PUT /api/loadout` changes only the slots it names; null empties one.
- A vendor's `Gold` is the character's; `Buying` is every card of theirs it deals in, with what it pays for one (`Gold`, half
  the list price rounded down), how many they own and how many of those are `Spare` (in neither the deck nor the ante):
  what the `vendor` screen offers to sell.
- A vendor or an armorer trades with a character on its town's map (`/api/travel`), else 409 `NotNear`. A vendor sells at
  list price, the copy that would leave its shelf soonest first, and buys at half the list price rounded down.
- A dungeon encounter is the run's: the server checks that the run is the character's and live, that `Floor` is the one
  they stand on, that `Index` is an encounter of that floor not yet fought, and that `Mob` is its mob. Losing any duel
  of a run ends the run.
- `POST /api/encounter/start` in the world checks, in order: an unfinished duel (it counts as lost now - a card of its ante gone and
  the character at the inn - and the call is refused 409 `Unfinished`); the map (404 `NotThere`), that it is open to the
  character (409 `Locked`, its `requires`), and the spawn (404 `NotThere`); that the mob
  is one of the spawn's (409 `NotThere`); that the character is on the map within `radius + 8` hexes of the spawn point
  (its wander radius, the 6 it chases, and 2 for walking on since the last report; 409 `NotNear`); that the spawn holds
  that mob for the character this epoch or the one before (409 `NotThere`) and that it has not been fought in that epoch
  (409 `TooSoon`); and that the deck is legal (422 `IllegalDeck`). Then it commits the duel. A duel not finished within
  24 hours counts as lost.
- `POST /api/encounter/finish`: `won` only when the log is accepted and seat 1 alone won it; a draw, the mob's win and a
  log not accepted are `lost`, with the reason in `Detail`. A win's `Gold` is rolled from the mob's gold range and paid at
  once; `Offer` is up to three different cards of the mob's loot, each with its list price (`Gold`) and within `Cap`
  (none with an empty ante): what the `loot` screen shows; `Gear` is the gear item a win dropped (`GearInstance`, or
  null). `Relics` are the relics a boss win dropped, in `relics.json`'s order, already in the collection; empty for any
  other win and every loss. A win against a boss rolls, at its chance, each relic whose entry names that boss and that is
  not in the account's relic ledger. The roll is apart from the offer and outside the cap. Each relic that comes up is
  added to the collection and to the ledger in the same transaction as the win. A loss moves the character to the inn the
  duel's map names.
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

## The card layer (`window.postMessage`)

The overworld asks the card layer (`?realm` in `Cantrip.Client.Web`, framed over the world) for a screen with
`{realm: 1, op: "open", id, screen, args}` and hears `{realm: 1, op: "closed", id, outcome, result?}` when it closes
(`realms/web/src/cardLayer.ts`, `Realm.js`). What each screen is opened on, and what it hands back:

| `screen` | `args` | `outcome` and `result` |
| --- | --- | --- |
| `duel` | `{token, seed, duel: Duel, mob: {id, name, tier, map, spawn}}` (the encounter's start) | `won` or `lost`; `result.log`: the `Log` for `/api/encounter/finish` |
| `loot` | `{token, offer: [{Name, Gold}], cap, mob}` | `closed`; `result.picks`: the names taken, for `/api/encounter/loot` |
| `spell-table` | `{map, name}` | `closed` |
| `vendor` | `{id, name}`: the vendor's id | `closed` |
| `gear` | `{name}`, or `{armorer: <town map id>, name}` at an armorer | `closed` |

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
- `loot` takes any subset of the offer whose prices fit under `cap`; `spell-table` reads the collection, the deck and
  `/api/catalog`, judges the deck by `/api/deck/check` and saves with `PUT /api/deck`; `vendor` and `gear` trade and
  wear through their calls, saying a refusal's `Detail` (and `Problems`) in words.

## Presence (`/realm/ws`)

A WebSocket of MessagePack messages, one per binary frame (16 KB at most), on the signed-in cookie. The server relays
positions and looks by area: in the world, among the players within two chunks of each other (an area holds 40 at most;
another layer of it opens when one is full); in an interior, among those inside it. A dungeon run is single-player and
shares nothing. Nothing else is shared between players (design.md A6). Each frame is a MessagePack union, `[key, {Field: value, ...}]`, as `Cantrip.Protocol`'s messages
are: the key names the message, its fields by name, PascalCase. A hex is `[q, r]`, a time Unix milliseconds on the
server's clock. A frame whose key a client doesn't know is ignored. `realms/web/src/net/presence.ts` is the client.

| From | Key | Message | Fields |
| --- | --- | --- | --- |
| client | 0 | `Enter` | `Space` (`"world"` or an interior's id, the place last reported through `/api/position`) |
| client | 1 | `Move` | `From: [q, r]`, `Path: [[q, r], ...]` (the hexes after `From`), `Speed` (hexes a second) |
| client | 2 | `Look` | `Body, Palette, Slots: {slot: {Mesh, Palette: ["#rrggbb", ...]}}` (a body name, and a worn item's `look`) |
| client | 3 | `Emote` | `Emote` |
| server | 0 | `Welcome` | `Instance`, `Player` (this connection's own number), `Others: [Other]` |
| server | 1 | `Other` | `Player, Name, Identity` (letters, as `Character`'s), `Look: {Body, Palette, Slots}, At: [q, r], Path, Speed, Since` |
| server | 2 | `Moved` | `Player, From, Path, Speed, Since` |
| server | 3 | `Looked` | `Player, Look` |
| server | 4 | `Emoted` | `Player, Emote` |
| server | 5 | `Left` | `Player` |
| server | 6 | `Refused` | `Reason, At`: a message refused, and where the player truly is |

- `Other` is sent for everyone on the instance in `Welcome`, and again whenever someone enters it. `At` and `Path` are the
  walk the player is on (`Path` empty when standing), begun at `Since`, so a client that hears of it late starts it
  partway.
- `Player` is a number for the connection, never the player's account. A connection from a page of another origin than
  the world client's (`REALMS_CLIENT`) or the server's own is refused.
- `Enter` enters the map the character last reported standing on (`/api/travel`), at that hex; another map is refused.
  The character's look starts as their loadout's meshes.
- The server refuses a `Move` whose path leaves the map, crosses a blocked hex, steps anywhere but to a neighbour, starts
  more than one hex from where the player is (as far along their last walk as its speed has taken them), is walked
  faster than walking allows (`REALMS_WALKING_SPEED`, 4 hexes a second), is longer than 256 hexes, or comes more than 10
  to a second; a refusal sends `Refused` with the player's true `At`, and they stay there.
- An emote is a lower-case id (`[a-z0-9-]`, 32 at most), two a second; a look is a body of `Character`'s, a palette 0-5,
  and for loadout slots only a gear mesh of `realms/content/models` and up to eight `#rrggbb` colors.
- The overworld reports where it is (`/api/travel`) before it sends `Enter` for a map, so the server knows it is there.

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
