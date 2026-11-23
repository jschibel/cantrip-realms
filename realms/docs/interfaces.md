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

### Vendors (`<plane>/vendors/*.json`)

```json
{ "id": "argive-goblin-trader", "name": "Grizzlegom's Goblins", "town": "new-argive",
  "specialty": { "subtypes": ["Goblin"] }, "purse": 50000 }
```

`specialty` is any of `colors` (a color identity the card's is within), `types`, `subtypes`, `rarities`, `names` (a theme
listed outright) - all that are given must hold. Its pool is the plane's pool filtered by it.

## The realm server's API (`/api`)

Every call but sign-in needs the signed-in cookie (`SiteSignIn`'s). A refused call is HTTP 4xx with
`{"Error": "<code>", "Detail": "<words>"}`; codes are named below.

| Call | Body | Reply |
| --- | --- | --- |
| `GET /api/me` | | the `Character` (below), or 404 `NoCharacter` |
| `POST /api/character` | `{Name, Body, Palette, Color}` | the new `Character`; 409 `HasCharacter` |
| `GET /api/collection` | | `{Cards: {name: count}}` |
| `PUT /api/deck` | `{Main: [{Name, Count}], Ante: [{Name, Count}]}` | the `Deck`; 409 `NotAtTable`, 422 `IllegalDeck` with `Problems` |
| `PUT /api/loadout` | `{Slots: {slot: gearInstanceId or null}}` | the `Character`; 422 `IllegalLoadout` |
| `GET /api/vendor/{id}` | | `{Vendor, Purse, Stock: [{Name, Gold, Count, Until}]}`; a visit is counted |
| `POST /api/vendor/{id}/buy` | `{Name}` | `{Gold, Collection}`; 409 `SoldOut`, `CannotAfford` |
| `POST /api/vendor/{id}/sell` | `{Name}` | `{Gold, Collection}`; 409 `NotTheirTrade`, `VendorCannotAfford`, `VendorFull`, `InDeck` |
| `GET /api/armorer/{town}` | | `{Stock: [Gear]}` |
| `POST /api/armorer/{town}/buy` / `sell` | `{GearId}` / `{InstanceId}` | `{Gold, Gear}` |
| `POST /api/encounter/start` | `{Map, Spawn, Mob}` | `{Token, Seed, Duel}` (below); 409 `NotNear`, `TooSoon`, `Unfinished` |
| `POST /api/encounter/finish` | `{Token, Log}` | `{Outcome: "won" or "lost", Gold, Offer: [card], Cap}` |
| `POST /api/encounter/loot` | `{Token, Picks: [name]}` | `{Collection}`; 422 `OverCap` |
| `POST /api/chest/open` | `{Map, Chest}` | `{Gold}`; 409 `NotNear`, `Empty` |
| `POST /api/travel` | `{Map, Q, R}` | `{}`: where the character is, for the inn and the checks above |

- `Character`: `{Name, Body, Palette, Identity, Gold, Map, Q, R, Stats: {Life, Hand, MaxHand}, Loadout: {slot: Gear},
  Gear: [GearInstance], Unlocked: [color]}`.
- `Duel`: everything the browser deals the game from - `{Seats: [the NewGame seat of docs/host-protocol.md, with
  StartingLife, StartingHandSize, MaximumHandSize, Emblems], MinimumDeckSize: 40, Seed, Mob: {Name, Tier, Prize},
  AnteValue, Cap}`. The player is seat 1, the mob seat 2.
- `Log` is what seat 1 sent the table, in order: each `Cantrip.Protocol` client message the player's `GameClient` sent,
  MessagePack-serialised and base64-encoded, as a JSON array of strings. Seat 2's answers are not in it. The server deals
  the same `Duel` on the native engine behind a `GameSession`, as the browser did; plays seat 1's messages back in
  order; and answers seat 2 with `TacticalPlay` on the duel's seed, as the browser's bot seat did. It takes the result
  only if the game is over at the end of the log and no message was refused. A log the bot's answers would have made
  play out otherwise (a tampered bot) ends in a different game, which fails that check.

## Presence (`/realm/ws`)

A WebSocket of MessagePack messages, one per frame, on the signed-in cookie. The server relays positions and looks
within a map instance (40 players); nothing else is shared between players (design.md A6).

| From | Message | Fields |
| --- | --- | --- |
| client | `Enter` | `Map` |
| client | `Move` | `From: [q, r]`, `Path: [[q, r], ...]`, `Speed` (hexes a second) |
| client | `Look` | `Body, Palette, Slots: {slot: mesh}` |
| client | `Emote` | `Emote` |
| server | `Welcome` | `Instance`, `Others: [Other]` |
| server | `Other` | `Player, Name, Identity, Look, At: [q, r], Path, Since` |
| server | `Moved` / `Looked` / `Emoted` / `Left` | `Player` and the change |

The server refuses a `Move` whose path leaves the map, crosses a blocked hex, starts more than one hex from where the
player last was, or is walked faster than walking allows; a refusal sends the player's true `At` back.

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
