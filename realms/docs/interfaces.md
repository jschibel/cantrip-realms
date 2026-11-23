# Cantrip Realms - interfaces

What the realm's parts agree on: the content files, the server's HTTP API, the presence protocol and the spawn
algorithm. `design.md` is the game, `tech.md` how it is built; this is the contract between the overworld
(`realms/web`), the card layer (`?realm` in `Cantrip.Client.Web`), the realm server (`realms/dotnet`) and the gear in the
engine (`realms/crates/realms-gear`). A change here changes every side that reads it, in the same commit.

All JSON is UTF-8, PascalCase on the wire between C# and anything else (as `Cantrip.Protocol` is), camelCase in the
content files (as `content/mtg/cards/*.json` is). Gold is an integer. Times are UTC ISO-8601.

## Content (`realms/content`)

Everything here is data, read by the server at start and by the overworld at build time (`realms/web` imports what it
draws). Ids are kebab-case and never reused.

### Planes and pools

- `planes.json`, `prices.json`, `pools/<plane>.json`: `tools/realms/card-economy.py` (the card economy, design.md A5).

### Gear (`gear/*.json`, one file per item)

```json
{
  "id": "circlet-of-foresight",
  "name": "Circlet of Foresight",
  "slot": "head",
  "rarity": "uncommon",
  "gold": 1200,
  "stats": { "life": 0, "hand": 0, "maxHand": 1 },
  "effects": [{ "family": "draw-on-turn", "turn": 3, "count": 1 }],
  "text": "Your maximum hand size is increased by one.\nAt the beginning of your draw step on your third turn, draw a card.",
  "look": { "mesh": "circlet", "palette": ["#f1b44c", "#5b8fd6"] },
  "unique": false
}
```

- `slot` is one of `head`, `neck`, `body`, `hands`, `feet`, `ring`, `relic` (a ring fits either ring slot).
- `stats` change the setup values (design.md A1): `life` the starting life, `hand` the starting hand size, `maxHand` the
  maximum hand size; negative refunds points.
- `effects` are the item's abilities, each an effect family and its parameters (gear.md, M4). The engine has one emblem
  definition per item, named `"<name> (gear)"`, generated from this file; an item with no effects has none.
- `gold` is what an armorer sells it for; it buys at half.
- `look` is how it shows on a character: a mesh of `realms/content/models` and its palette.

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
- A boss has `"boss": true` and `"unlocks": "W"`.

### Maps (`<plane>/maps/*.json`)

```json
{
  "id": "benalish-meadow",
  "name": "Benalish Meadow",
  "kind": "wilderness",
  "region": "W",
  "radius": 16,
  "tiles": [[q, r, height, "grass", 0]],
  "props": [{ "q": -3, "r": 3, "kind": "spell-table" }],
  "exits": [{ "q": 16, "r": -8, "to": "world" }],
  "spawns": [{ "id": "s1", "q": 7, "r": 3, "mobs": ["phyrexian-scout"], "radius": 4, "respawnSeconds": 600 }],
  "chests": [{ "id": "c1", "q": -8, "r": -2, "gold": [50, 200], "respawnSeconds": 86400 }],
  "npcs": [{ "id": "inn", "q": 0, "r": 2, "kind": "inn" }],
  "inn": { "q": 0, "r": 0 }
}
```

- A tile is `[q, r, height, terrain, blocked]` (`blocked` 1 or 0); the hexes and heights are `realms/web/src/hex.ts`'s.
- `kind` is `town`, `village`, `wilderness`, `dungeon` (with `"floor": n`) or `world` (the travel map).
- A town's `npcs` include its vendors (`"kind": "vendor", "vendor": "<id>"`), its armorer, its inn and its spell table.
- `inn` is where a character who loses a duel on this map wakes: a walkable hex of this map, or, with `"map": "<id>"`, of
  that map (the nearest town's inn, for a map with none of its own). Every map has one.
- A spell table is a `spell-table` prop or NPC; a character stands at one on its hex or next to it.

### Vendors (`<plane>/vendors/*.json`)

```json
{ "id": "argive-goblin-trader", "name": "Grizzlegom's Goblins", "town": "new-argive",
  "specialty": { "subtypes": ["Goblin"] }, "purse": 50000 }
```

`specialty` is any of `colors` (a color identity the card's is within), `types`, `subtypes`, `rarities`, `names` (a theme
listed outright) - all that are given must hold. Its pool is the plane's pool filtered by it.

## The realm server's API (`/api`)

Every call but sign-in needs the signed-in cookie (`SiteSignIn`'s; 401 `NotSignedIn` without it). A refused call is HTTP
4xx with `{"Error": "<code>", "Detail": "<words>", "Problems": [...] or null}`; codes are named below. Any call of a
player with no character is 404 `NoCharacter`.

| Call | Body | Reply |
| --- | --- | --- |
| `GET /api/me` | | the `Character` (below), or 404 `NoCharacter` |
| `POST /api/character` | `{Name, Body, Palette, Color}` | the new `Character`; 409 `HasCharacter`; 400 for a name (2-24 letters, digits, spaces, `'` and `-`), body (0-3), palette (0-5) or color (W U B R G) that is none |
| `GET /api/collection` | | `{Cards: {name: count}}` |
| `GET /api/deck` | | the `Deck` |
| `PUT /api/deck` | `{Main: [{Name, Count}], Ante: [{Name, Count}]}` | the `Deck`; 409 `NotAtTable`, 422 `IllegalDeck` with `Problems` |
| `PUT /api/loadout` | `{Slots: {slot: gearInstanceId or null}}` | the `Character`; 422 `IllegalLoadout` with `Problems` |
| `GET /api/vendor/{id}` | | `{Vendor: {Id, Name, Town, Specialty}, Purse, Stock: [{Name, Gold, Count, Until}]}`; a visit is counted; 404 `NoVendor` |
| `POST /api/vendor/{id}/buy` | `{Name}` | `{Gold, Collection}`; 409 `SoldOut`, `CannotAfford` |
| `POST /api/vendor/{id}/sell` | `{Name}` | `{Gold, Collection}`; 409 `NotTheirTrade`, `VendorCannotAfford`, `VendorFull`, `InDeck`, `NotOwned` |
| `GET /api/armorer/{town}` | | `{Stock: [Gear]}`; 404 `NoArmorer` |
| `POST /api/armorer/{town}/buy` / `sell` | `{GearId}` / `{InstanceId}` | `{Gold, Gear: [GearInstance]}`; 409 `NotInStock`, `CannotAfford` / `NotOwned`, `Worn` |
| `POST /api/encounter/start` | `{Map, Spawn, Mob}` | `{Token, Seed, Duel}` (below); 409 `NotNear`, `NotThere`, `TooSoon`, `Unfinished`; 404 `NotThere`; 422 `IllegalDeck` |
| `POST /api/encounter/finish` | `{Token, Log}` | `{Outcome: "won" or "lost", Gold, Offer: [card], Cap, Gear, Detail}`; 404 `NoDuel`, 409 `Finished` |
| `POST /api/encounter/loot` | `{Token, Picks: [name]}` | `{Cards: {name: count}}`, the collection; 422 `OverCap`, `NotOffered`; 409 `Finished` |
| `POST /api/chest/open` | `{Map, Chest}` | `{Gold, Found}`: the character's gold, and what the chest held; 409 `NotNear`, `Empty`; 404 `NoSuchPlace` |
| `POST /api/travel` | `{Map, Q, R}` | `{}`: where the character is, for the inn and the checks above; 422 `NoSuchPlace` off the map or on a blocked hex |

- `Character`: `{Name, Body, Palette, Identity, Gold, Map, Q, R, Stats: {Life, Hand, MaxHand}, Loadout: {slot:
  GearInstance or null}, Gear: [GearInstance], Unlocked: [color]}`. `Identity` is the starting color and the unlocked
  ones, as letters in WUBRG order. The loadout's slots are `head`, `neck`, `body`, `hands`, `feet`, `ring1`, `ring2` and
  `relic`; a `ring` item fits either ring slot. `Stats` are the base (20, 7, 7) plus every worn item's.
- `Gear` is a gear item as its content file has it, PascalCase, with its `Emblem` (`"<name> (gear)"`, or null for an
  item with no effects). `GearInstance` is one a character owns: `{InstanceId, Gear}`.
- `Deck`: `{Main: [{Name, Count}], Ante: [{Name, Count}], AnteValue}`. The main deck holds the basic lands too, which
  are free (any number of a basic land of the character's identity, and Wastes) and never in the collection; the ante
  holds no basic land. Every other copy in the deck and the ante together is owned.
- `PUT /api/loadout` changes only the slots it names; null empties one.
- A vendor or an armorer trades with a character on its town's map (`/api/travel`), else 409 `NotNear`. A vendor sells at
  list price, the copy that would leave its shelf soonest first, and buys at half the list price rounded down.
- `POST /api/encounter/start` checks, in order: an unfinished duel (it counts as lost now - a card of its ante gone and
  the character at the inn - and the call is refused 409 `Unfinished`); the map and spawn (404 `NotThere`); that the mob
  is one of the spawn's (409 `NotThere`); that the character is on the map within `radius + 8` hexes of the spawn point
  (its wander radius, the 6 it chases, and 2 for walking on since the last report; 409 `NotNear`); that the spawn holds
  that mob for the character this epoch or the one before (409 `NotThere`) and that it has not been fought in that epoch
  (409 `TooSoon`); and that the deck is legal (422 `IllegalDeck`). Then it commits the duel. A duel not finished within
  24 hours counts as lost.
- `POST /api/encounter/finish`: `won` only when the log is accepted and seat 1 alone won it; a draw, the mob's win and a
  log not accepted are `lost`, with the reason in `Detail`. A win's `Gold` is rolled from the mob's gold range and paid at
  once; `Offer` is up to three different cards of the mob's loot, each within `Cap` (none with an empty ante); `Gear` is
  the gear item a win dropped (`GearInstance`, or null).
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

## Presence (`/realm/ws`)

A WebSocket of MessagePack messages, one per binary frame (16 KB at most), on the signed-in cookie. The server relays
positions and looks within a map instance (40 players; another opens when one is full); nothing else is shared between
players (design.md A6). Each frame is a MessagePack union, `[key, {Field: value, ...}]`, its fields by name; a hex is
`[q, r]`, a time Unix milliseconds on the server's clock.

| From | Key | Message | Fields |
| --- | --- | --- | --- |
| client | 0 | `Enter` | `Map` |
| client | 1 | `Move` | `From: [q, r]`, `Path: [[q, r], ...]`, `Speed` (hexes a second) |
| client | 2 | `Look` | `Body, Palette, Slots: {slot: mesh}` |
| client | 3 | `Emote` | `Emote` |
| server | 0 | `Welcome` | `Instance`, `Player` (this connection's own number), `Others: [Other]` |
| server | 1 | `Other` | `Player, Name, Identity, Look: {Body, Palette, Slots}, At: [q, r], Path, Speed, Since` |
| server | 2 | `Moved` | `Player, From, Path, Speed, Since` |
| server | 3 | `Looked` | `Player, Look` |
| server | 4 | `Emoted` | `Player, Emote` |
| server | 5 | `Left` | `Player` |
| server | 6 | `Refused` | `Reason, At`: a message refused, and where the player truly is |

- `Player` is a number for the connection, never the player's account.
- `Enter` enters the map the character last reported standing on (`/api/travel`), at that hex; another map is refused.
  The character's look starts as their loadout's meshes.
- The server refuses a `Move` whose path leaves the map, crosses a blocked hex, steps anywhere but to a neighbour, starts
  more than one hex from where the player is (as far along their last walk as its speed has taken them), is walked
  faster than walking allows (`REALMS_WALKING_SPEED`, 4 hexes a second), is longer than 256 hexes, or comes more than 10
  to a second; a refusal sends `Refused` with the player's true `At`, and they stay there.
- An emote is a lower-case id (`[a-z0-9-]`, 32 at most), two a second; a look names only loadout slots.

## Spawns

A spawn point's mobs are the client's to show and walk, and nobody else's; the server checks that a duel's mob could be
there. Both sides make a spawn's mob the same way:

```
epoch  = floor(unix seconds / spawn.respawnSeconds)
seed   = fnv1a32("<player>|<map>|<spawn.id>|<epoch>")
mob    = spawn.mobs[seed % spawn.mobs.length]
```

`fnv1a32` is FNV-1a over the UTF-8 bytes, 32-bit; `<player>` is the character's id. The server accepts an encounter with
the mob of this epoch or the one before (a fight started just before the turn of an epoch), once per spawn per epoch.
Golden vectors are in `realms/content/spawn-vectors.json`, which the TypeScript and C# tests both check.
