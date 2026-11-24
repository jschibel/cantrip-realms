# Cantrip Realms - game design

The game as players see it: every rule, number and place. `tech.md` is how it is built.

## Why

The goal is a browser RPG in the spirit of the 1997 MTG overworld games. You walk an isometric world with click-to-move travel in the style of Fallout 1/2. You collect cards and gear and win duels against monsters to grow a collection and unlock colors. Every fight is a real Magic duel played by the Cantrip engine in the existing Cantrip table UI. The first plane is Dominaria; there is no Universes Beyond. Duels against the computer run entirely in the player's browser. The server owns the economy (collections, gold, vendors) and replicates only other players' positions and looks. PvE comes first; the PvP duel zone and ladders are designed now but built last.

What the game is built on:
- **Engine.** The engine is native-only. `cantrip-native-host` (stdin/stdout JSON lines, `crates/cantrip-host`) runs behind `IRulesHost` / `NativeRulesHost` in `dotnet/src/Cantrip.Server`.
  - `IRulesHost` is synchronous, and `Cantrip.Server` is plain .NET with no ASP.NET.
  - `Cantrip.Client.Embedded` (`HostAndPlay.cs`, `LoopbackTransport.cs`) already runs table and client in one process.
- **Game setup.** `cantrip_rules::Setup` (`crates/cantrip-rules/src/lib.rs:540`) has no life or hand fields.
  - Life is `Player::starting(20)` (`cantrip-state/src/state.rs:541`).
  - The opening hand is a literal 7 in `turn::opening` (`cantrip-rules/src/turn.rs:398-476`).
  - Maximum hand size is `actions::maximum_hand_size` (`actions.rs:8674`), a fixed 7 plus effects.
  - Emblems exist (`ops::create_emblem`), but nothing puts command-zone objects into the game before turn 1.
- **Bots.** The tactical bot (`dotnet/src/Cantrip.Client/Tactics/TacticalPlay`) is a pure client that already runs in a browser tab and plays any decklist. The draft bot's `DeckBuilder` builds decks from pools.
- **Client.** The client is Uno WASM drawn with Skia (`dotnet/src/Cantrip.Client.Web`).
  - Its colors come from `Theme.cs`: window `#111318`, panel `#1d2127`, text `#e8eaee`, gold `#f1b44c`. Its fonts are Beleren and MPlantin.
  - The deck editor (`MainPage.Decks.cs`, `?decks`) has search, columns, legality and limited-pool mode, all filtered through `Cantrip.Decks.DeckRules.Fits`, which already handles color identity.
- **Server and data.**
  - The server is Kestrel with raw WebSockets and MessagePack (`Cantrip.Protocol`).
  - Storage is JSON files (`EventStore`, `--data`), sign-in is Discord OAuth (`Cantrip.Discord/SiteSignIn.cs`), and art comes from `Cantrip.Art` at `/art/{size}/{slug}.webp`.
- **Card data.** There are 8,322 cards implemented. There is no rarity, set or price data, though `tools/maintenance/scryfall.py` caches the Scryfall bulk files. DOM is about 12% implemented and DMU about 19%.

The owner's decisions:
- **Repo:** a public GitHub fork `jschibel/cantrip-realms` of `cantrip-rs/cantrip-rs`.
- **Upstream first:** the WASM engine, per-player starting stats, start-of-game command-zone objects and any new cards land on cantrip-rs `main` under its rules and are merged into the fork. The fork holds only the RPG.
- **Rarity surcharge:** +$0.50 common, +$1 uncommon, +$5 rare, +$10 mythic, added to the price of the median-priced printing.
- **Hosting:** somewhere else, independent of the current cantrip-rs.dev server and its deploy. The game is designed to be provider-neutral (B8) and reuses none of that host's configuration.




### A1. Character
- **Creation:** you pick a name, a body (4 voxel bodies × 6 skin and hair palettes) and **one starting color**: W, U, B, R or G.
- **Color identity** works like Commander's: every deck card's identity must be within the character's identity, and colorless cards are always allowed. The check reuses `DeckRules.Within` and `IdentityOf`.
- **Base stats:**

  | Stat | Base | Allowed range with gear |
  |---|---|---|
  | Starting life | 20 | 10–40 |
  | Starting hand size | 7 | 4–9 |
  | Maximum hand size | 7 | 4–10 |

  The range limits are loadout validation and never reach the engine.
- **Progression** comes from the collection, gear and unlocked colors. There are no XP levels; your power is what you own and how you combine it.
- **Starting kit:**
  - A 40-card starter deck in your color, built from the Dominaria pool (commons and uncommons).
  - 10 extra commons, 2,000 gold, and common gear in 3 slots.
  - Free, unlimited basic lands of your identity's colors. Basics are never part of the collection, and Wastes are always available.

### A2. Decks, the spell table and the ante
- **Deck rules:**
  - At least 40 cards, no maximum.
  - At most 4 copies of any non-basic card; cards restricted in Vintage are limited to 1.
  - The card pool is implemented cards that are legal or restricted in Vintage, minus Universes Beyond printings. That rule also removes the ante cards, conspiracies and Un-cards.
- **The spell table** is where you edit your deck and your ante. Every town and some dungeon antechambers have one; everywhere else your deck is locked. It is the existing deck editor in a "realm" mode: search runs over your collection, and the counts left show copies not already used in the deck or the ante. Each card shows its list price, a card outside your identity is marked for the ante only, the free basic lands of your colors are added and taken out with a button each, and the deck's mana curve and colors are drawn beside it. The server judges the deck and the ante as they change, and Save keeps them only when it would deal them.
- **The ante slot** holds 0–10 cards from the collection, outside the deck, like a sideboard. A copy can't be in both the deck and the ante.
  - Ante value is the sum of the cards' list prices.
  - It is shown on the HUD, and the duel splash shows it beside the prize cap.

### A3. Duels and rewards
- **Starting a duel:**
  - A wandering mob that reaches your tile, or one you click, starts a duel.
  - The splash shows the mob's name, its tier, its stats and gear traits, three cards from its deck, your ante value, the prize cap and its gold range. Then the table opens.
  - The mob's seat is played by the tactical bot in your tab.
  - The duel is a single game. Who plays first is decided at random, as CR 103.1 says.
- **Prize cap** = min(your ante value, the mob's prize value).
  - Mob prize values by tier: T1 $1, T2 $3, T3 $8, T4 $20, boss $60.
  - With an empty ante the cap is $0: you still get gold, but no cards.
- **Winning:**
  - Gold is rolled from the tier and is **not** limited by the ante. Base ranges: T1 20–60, T2 50–150, T3 120–300, T4 250–600, boss 1,500.
  - You are **offered 3 cards** from the mob's loot table, and you take **any subset whose total value fits under the cap**. At least one offered card always fits.
  - Gear drops with a chance of 10% / 15% / 20% / 30% by tier, and bosses always drop one.
- **Losing:**
  - **A random card from your ante is lost**, chosen uniformly. It is gone; it does not go to a vendor.
  - You are returned to the **nearest town's inn**.
  - Gold is not lost.
- **Conceding** counts as a loss.
- **Leaving mid-duel:** the duel's log is saved locally and resumes on reload. A duel that is never finished counts as lost when you start your next encounter, or after 24 hours.

### A3a. Relics

Some cards are too powerful to come any way but one: the Power 9 to begin with (Black Lotus, Mox Pearl, Mox Sapphire, Mox
Jet, Mox Ruby, Mox Emerald, Ancestral Recall, Time Walk, Timetwister), listed in `realms/content/relics.json`, which the
owner may extend.

- **Only from the highest-level bosses.** A relic drops only from the bosses its entry names: the capstone dungeon's
  boss (the Phyrexian praetor that ends the Dominaria arc), and later planes' capstones. The chance is small, about 1 in
  50 per win, in the entry. It is rolled after the duel, apart from the three-card offer and outside the prize cap, since
  no ante could cover a relic's value. Each relic the boss holds is rolled on its own, so one win may drop more than one,
  and every relic that drops goes straight to the collection; the duel's result names them.
- **One per account, ever.** The server keeps a ledger of every relic each account has received. One already in the
  ledger never drops for that account again, and is not even rolled, even if the card has since left the collection.
  Each account's ledger is its own.
- **Never anywhere else.** Relics are in no plane's pool: no vendor sells or buys one, no loot offer holds one, no starter
  deck has one.
- **Kept.** A relic can't be put in the ante and can't be sold, so it is never lost or passed on. A deck holds one copy at
  most (they are restricted in Vintage).

### A4. Equipment (gear)
- **Eight fixed slots:** Head, Neck, Body, Hands, Feet, Ring ×2 and Relic.
- **What gear is in the game:** each worn item becomes a Vanguard-style object in your command zone from the start of the game. It can't be targeted, removed or interacted with, and it can do anything a card can do. Its stat lines change the setup values.
- **Effect families allowed in each slot** (this is where balance comes from):

  | Slot | Effect families |
  |---|---|
  | Head (circlets, helms) | starting hand, maximum hand, card selection (scry, surveil, draw at a set time) |
  | Neck (amulets) | mana (extra mana on turn N, a one-shot cost reduction, color fixing), maximum hand |
  | Body (armor, robes) | starting life, protection (prevent damage on turn N, life gain triggers) |
  | Hands (gloves) | combat (your first creature each game gets +1/+1 counters, a once-per-game ping), start-of-game tokens |
  | Feet (boots) | tempo (an extra land drop on turn N, haste for your first creature), starting life |
  | Rings ×2 | color-keyed mana or cost effects (the color must be in your identity to work), disruption (the opponent discards on turn N, the opponent starts with less life) |
  | Relic (talismans) | one activated ability, once per game, from the command zone; start-of-game permanents; disruption |

- **Point budget:** every effect has a point cost, and items may have negative lines that refund points, as Vanguard cards trade one stat for another.
  - Budget by rarity: common ≤3, uncommon ≤5, rare ≤8, mythic ≤12. Boss uniques go to 14 and come with a drawback.
  - Starting costs: +1 life = 1, +1 starting hand = 6, +1 maximum hand = 2, "draw a card at the beginning of your draw step on turn 3" = 3, and so on.
  - The balance lab (C5) re-fits these costs from measured win-rate changes.
- **Items are a fixed catalogue** with no random rolls: about 30 per slot, about 240 in total, plus 15 boss uniques.
  - Each item is a definition with a name, slot, rarity, stat lines, effect lines and a look (its voxel mesh and palette).
  - You can own duplicates.
  - The armorer buys gear at half its gold price.
- **Gear sources:** loot drops, chests, armorers in towns (6–10 items, rotating daily), and quest bounties.
- **Gear changes your look:** each slot's item has its own mesh on your character, and that look is what other players see.

### A5. Economy
- **Gold:** 1 gold = $0.01. A card's list price = round(100 × (median USD over its paper printings + rarity surcharge)).
  - The rarity is that of the median-priced printing.
  - Prices are the non-foil TCGplayer market price; if a printing has none, the foil price, then the etched price.
  - The data comes from Scryfall's default-cards bulk file, which carries TCGplayer prices. A card with no paper price is left out of loot and vendors.
- **Vendors** are global, shared server-side state.
  - Each has a **specialty**: a color, a card type (artifacts, lands, enchantments), a creature type (Goblins, Knights, Elves…), a theme (instants and sorceries, Dominaria-legends), or a rarity tier ("curio dealer").
  - It only buys and sells cards that match its specialty.
  - It **sells** at list price and **buys** at 50%, paid from a **finite purse**.
  - Purse: it starts with 50,000 g. Every hour it gains 2,000 g + 300 g × the unique players who visited in the past hour, up to a 500,000 g ceiling.
  - Stock:
    - 12 seeded cards when it is created.
    - **3 random new cards each hour** from its specialty pool; one not sold within 24 hours leaves.
    - Cards players sell stay until bought, up to 60. When that is full the vendor buys nothing more.
  - A card a player sells shows up at full price for everyone.
  - There is no trading between players.
- **Wares from other planes.** Until other planes can be explored, cards printed only beyond Dominaria come in a
  slow, small trickle, through two kinds of exotic dealer and nowhere else:
  - **Exotic wares shops** in the biggest towns (New Benalia and Capashen Hold), inside like any shop. Each shows at most 6
    off-plane cards and gains one new card every 6 hours; a card not sold within 3 days leaves.
  - **Traveling vendors from other planes:** planeswalker traders whose caravan visits one of the big towns for a few
    hours each day, by a schedule the server keeps and everyone sees. They rotate through New Benalia, Capashen Hold, the
    Llanowar elfhames, Keld and Walassa. Each visit brings 3 cards from that trader's own plane (Ravnica, Zendikar,
    Innistrad, Kamigawa, ...), so who is in town says what can be found.
  - The off-plane pool is every card the engine has that is legal in Vintage, priced, not Universes Beyond and no relic,
    and was never printed in a Dominaria set. Each card is tagged with the planes it was printed on (`planes.json`
    grows a plane per trader).
  - Exotic dealers buy and sell only off-plane cards, at list price and half back as any vendor does, so what players
    sell them circulates. Dominaria's own vendors, loot and starter decks never hold an off-plane card.
- **Other gold sources:** treasure chests on maps (50–500 g, respawning per player on a timer) and the quest board's bounties ("defeat 5 Caligo bog-wraiths" for gold or gear).

### A6. The world — Dominaria
- **One connected world.** Dominaria is one continuous isometric map, walked by clicking in real time, the Fallout way:
  no separate travel screen and no local maps to load between. It is big (1024 by 1216 square tiles, walked eight
  ways) and streamed in chunks as you walk. Roads join the towns, wilderness lies between them, and the regions' terrain shades into each other.
- **The scale.** A tile is the art's: a house is five to eight tiles across, a street two to five wide. The world is
  sized for walking at 4.2 tiles a second: four to five minutes north to south in a straight line; from New Benalia's
  walls 40 seconds by road to Capashen Hold or the elfhames, a minute to the Vess estate, two to Keld with the ferry;
  35 seconds across New Benalia; a ferry crossing 10 to 30 seconds. The Domains keep their shape: Aerona about 600
  tiles across, Icehaven 250, Walassa 160, the small isles 80 to 140. Waystones and ferries make the far places near.
- **Difficulty grows with distance.** The five home towns and New Benalia are the starting areas. Around them and along
  their roads the wilds are tier 1; they grow harder the farther you go, to tier 4 in the far wilds, the borders between
  enemy regions and the edges of the world. A wanderer's tier is its place's: the world generator gives each spawn point
  the tier of its distance from the nearest starting area. A dungeon takes the tier of where it stands, never less than
  its own floor; a mage tower keeps its circle's tier (its mage's and its mobs') wherever it stands.
  **The tiers are visible:** the regional map shows each area's tier as a tinted band, with a legend, and marks the towers and
  dungeons with theirs. Waymarker stones stand where the tier changes on the land, and the HUD names the area you are in
  and its tier, and warns as you cross into a harder one.
- **Fast travel through mage towers.** Mage towers stand across Dominaria, a few in each region and some far out in the
  wilds. Each is a short dungeon (the mage-tower theme, one or two floors) with a mage boss at the top. Beating the mage
  attunes that tower's waystone to you. From any attuned tower you can travel at once to any other you have attuned:
  your fast-travel network, which grows as you go. Towers far from the starting areas hold harder mages, so the network
  reaches the far wilds only as you can face them.
- **Interiors.** A building with a door has an interior: its own small scene, not part of the world map. Walking through
  the door is seamless. The door opens, the view eases into the room and the player is inside, with no loading screen and
  no jump cut, and leaving reverses it. Shops, inns, guildhalls, temples, smithies, libraries and houses have interiors.
- **Dungeons** are not on the world map. A dungeon's entrance stands in the world (a cave mouth, a castle gate, a tower
  door); stepping in starts a **single-player instance generated in the browser**, new each run, that no other player
  sees. Each dungeon has a theme that fits the land it is in:

  | Theme | Where | Layout |
  |---|---|---|
  | Caves | mountains and hills (Keld, the Hurloon and Ironclaw Mountains) | winding caverns, chasms, underground lakes |
  | Castle | plains and farmland (Benalia) | keep, halls, courtyards, battlements |
  | Mage tower | coasts, isles and lonely heights (Orvada's academy, and mage towers everywhere) | round floors climbing upward, libraries, time-rift rooms |
  | Crypt | swamps and dark realms (the Caligo Morass, Amjad) | catacombs, ossuaries, flooded tombs |
  | Root hollow | forests (Llanowar, the Durkwood, Verdura) | organic tunnels through living roots, glades under the canopy |
  | Foundry | the orcs' delvings in the Ironclaw Mountains, and Keldon forges | forges, lava channels, gantries |
  | Phyrexian Portal | the capstone | the praetor's realm |

  A dungeon's content (its theme, its floors, its mobs by tier and its boss) is data. The layout is the generator's,
  from a seed the server hands out for the run (B4).
- **Geography: the Domains.** The world is the Domains of Dominaria as the 2018 *Dominaria* set and its supplements
  show them: the continent of **Aerona**, **Icehaven** to its north, and the islands around them. Places beyond the
  Domains (Tolaria's old island, Urborg in the Burning Isles, Shiv, Yavimaya and New Argive in Terisiare) are not in it.
  Where the sources are silent the layout is ours, kept true to what they do say.

  | Color | Region | Home | Land | Dungeon (theme) | Boss |
  |---|---|---|---|---|---|
  | — | the hub | **New Benalia**, the capital that holds sway over most of Aerona | south-central Aerona, plains | — | — |
  | W | Benalia | Capashen Hold, a Benalish town | southern Aerona: plains, farmland, river valleys | a Benalish castle (castle) | Lyra Dawnbringer |
  | G | Llanowar | the elfhames of Llanowar | the great forest south-east of Benalia, across the Suder River | a root hollow under the elfhames (hollow) | Rofellos, Llanowar Emissary: a mono-green deck of big creatures and ramp round him |
  | B | the Caligo Morass and Amjad | the Vess estate's village | the Morass, a Benalian forest the Cabal turned to fetid swamp, in Aerona's north-west; and Amjad, a dark realm on Shanodin's island | the Vess crypts (crypt) | Liliana Vess (Liliana of the Veil), at her ancestral home |
  | R | Keld | Keld's longhouse town | Icehaven, north of Aerona: frozen mountains and tundra | a Keldon fortress in the mountains (caves) | Garna, Bloodfist of Keld |
  | U | Orvada | the Tolarian Academy on Walassa | Orvada's isles, Walassa and Denawa, off Aerona's coast | the academy's tower (tower) | Teferi |

  - **Aerona** is split north from south by the **Hurloon Mountains**, home of the minotaurs. North of them are the
    Durkwood, Sursi of the pegasi, Foriys of the two-headed giants, Avenant of the archers, and the **Ironclaw
    Mountains** of the orcs. South of them lie Benalia and Llanowar, with the Suder River between.
  - **Icehaven**, across a strait to the north, holds Keld in its south and **Parma** of the ice giants in its frozen
    north. A **desolate waste** divides Keld from the rest of the Domains; the **Phyrexian Portal** stands in it.
  - **Islands:** **Verdura**, lush druid woodland, to the south; **Shanodin's island** to the east, with the forest of
    Shanodin, the small nation of Oneah and the dark realm of Amjad; **Orvada's isles** to the west; and **Stahaan**,
    the xenophobic minotaurs' isle, north of Orvada.
  - **One connected world:** the islands are reached as the land is walked. Causeways and fords join the near ones, and
    ferries at harbor docks cross to the far ones. A ferry crossing is seamless, as a door is: you board, the crossing
    eases by, and you step off on the other shore.
  - **Difficulty by distance** from the starting areas (New Benalia and the five homes): Benalia's fields and the edges
    of Llanowar are the gentlest. The Hurloon passes, the Durkwood and Sursi are harder, and the hardest are the
    Ironclaw Mountains, Parma's ice, Stahaan, the depths of Amjad and the desolate waste.
  - The bosses are kept to cards that are implemented.
- **Dungeon runs:**
  - 3–5 floors each, generated anew each run. Each floor ends at a stair guarded by a floor warden. The boss waits on the
    last floor.
  - Within a run, beaten mobs stay beaten, and the run remembers the floor reached until it ends: closing the page and
    coming back resumes it on that floor. Leaving, or losing a duel, ends the run; the next run is a new layout from the
    first floor. A lost duel wakes you at your inn with what the run won (gold, cards, gear) kept, and a card of the ante
    lost as any loss takes one.
  - The entrance has a spell table, outside in the world and inside on the first floor (the antechamber).
  - Ally-color dungeons are tier 3 with T2–T3 mobs. Enemy-color dungeons are tier 4 with T3–T4 mobs and stronger boss
    traits. Ally and enemy are by the character's starting color (W U B R G: the two beside it are allies, the two across
    from it enemies); a color the character holds, started with or unlocked, is their own, and its dungeon is as written.
    Smaller dungeons dot the wilderness (a cave, a ruined watchtower) for lower tiers.
- **Bosses:**
  - Beating one **unlocks that color**, drops a unique item and offers 3 cards with a rare or mythic guaranteed.
    - The color is yours at once: the HUD's five pips light it (the locked ones stay faint rings), a panel marks the
      moment, and every spell table takes its cards and basic lands from then on.
    - The rare or mythic is the boss's **gift**: one card of its loot, straight into the collection, whatever the ante and
      outside the prize cap. The usual 3-card offer under the cap comes beside it.
    - The unique item is the boss's own (the mob file names it); once you own it, a later win drops a rare or mythic
      item instead, never a second unique.
  - You can fight them again each week for loot: a boss beaten **rests a week** from the win. A run begun meanwhile
    finds its hall empty, says when it is back, and its way out stands open.
  - The regional map rings each boss's dungeon in its color, filled once that color is yours.
  - **Capstone:** once all five colors are unlocked, the Phyrexian Portal opens. A five-color praetor boss ends the Dominaria arc, and later planes come in as data packs.
- **The Phyrexian Portal** (the capstone dungeon):
  - Its gate stands in the desolate waste between Keld and the rest of the Domains, and belongs to no region.
  - It is **sealed until the character's identity holds all five colors**: their starting color and the four others unlocked by beating those bosses. Until then its gate stays shut, and the server refuses to start a run of it.
  - Four floors. The entrance antechamber has a spell table. Every floor holds tier 4 Phyrexians: the Phyrexian Ravager (B/R), the Phyrexian Negator (B), the Phyrexian Gorger (B/G) and, below the first floor, the Gitaxian Mindcutter (U/B). The Portal Warden (U/B/R) keeps each floor.
  - The last floor is the praetor's hall. The **Phyrexian Praetor** is five-color, with boss stats and the strongest gear a mob wears. Its deck is the strongest the Dominaria pool allows, so its stats are set so that it plays no easier than the other bosses (the balance lab's fit, `balance.md`: 32 life, a starting hand of 6 and a maximum hand of 7 with its gear, where 42, 9 and 10 made it unbeatable). It is built around Sheoldred, the Apocalypse, the pool's one implemented praetor, and runs on the ten original dual lands and five fetch lands.
  - Beating it unlocks no color, since every color is already yours. It pays a boss's gold and offer, and it is the boss the relics drop from (A3a). Its unique gear item comes with the gear catalogue's boss uniques.
- **Mobs are Dominaria's own creatures.** Every wanderer is a real creature of the plane: a creature card the engine has,
  printed in a Dominaria set (planes.json), drawn as that creature. Examples are a pack of Llanowar Elves, a Shivan
  Dragon, Serra Angels, Benalish Marshals, Keldon Raiders, Hurloon minotaurs and Phyrexian horrors. Its deck is themed around
  it: the creature itself, its kin and tribe, and cards that support what it does. A Llanowar Elves pack ramps into
  the forest's big creatures; a Shivan Dragon brings dragons, burn and red mana. Each has stats and gear traits, through the same
  Vanguard-object system as the player, which is what makes the far ones harder. Mage bosses are Dominaria's mages
  (wizard creatures and planeswalkers the engine has), and dungeon bosses its legends.
  - Behavior: they wander within a home radius and give chase when you come within 8 tiles, a little slower than you walk. In the world they respawn on their spawn point's timer; in a dungeon, not within the run.
- **Towns** are big walled cities (New Benalia about 140 tiles across within its walls, home towns about 100, villages
  about 40), shaped by the land they stand on, with gates,
  streets, districts and a varied skyline. Building types: houses and tenements, shops, an inn or tavern, a temple, a
  guildhall, a smithy, a library or mage's tower, warehouses, a market square, and docks where there is water. Each
  region's towns are built in its own style: Benalish stone and banners, Tolarian domes on Walassa, the Morass's dark stilt-houses,
  Keldon longhouses, Llanowar's tree-houses.
  - **Every town is easy to cross.** Its streets are planned before anything is built: main streets from its gates
    to the central square, where the shops are, and side streets that meet other streets in loops, never alleys to
    nowhere - laid out as a grid in Benalia's cities, rings round the great hall or the great tree in Keld and Llanowar,
    a high street between back lanes in a village. Buildings front the streets, their doors on them, and the walls meet
    the roads at their gates.
  - **The map shows the way.** In a town the minimap is the town's: its streets, buildings, gates and places - the inn,
    the shops, the guild, the temple, the smithy, the quest board - and the whole map names each place and where each
    gate's road leads.
  - **Vendors work inside their shops**, the armorer inside the smithy, the innkeeper inside the inn. A shop's sign says
    what it trades in.
  - An **inn**, where you respawn and set your home. The spell table is inside it, and another is in the mages' guild.
  - A **quest board** outside the inn.
  - A **PvP arena**, locked with a "coming soon" sign until Part B9.
- **Story:** after the Phyrexian invasion, Dominaria's five color-wells are held by guardians. The player is a mage who must earn each well's attunement. The tone is light, with the story text on quest boards and NPC barks. The owner can rewrite it; it is all data.
- **Social:** you see the other players near you in the world (those in the chunks around you), with their gear and
  their identity pips, and those in the same interior. Dungeons are single-player. Clicking a player shows their
  loadout. There is no chat in v1 (it would need moderation); there is an emote wheel.

### A7. IP stance
- This is unofficial fan content under the Wizards Fan Content Policy: free, no paywall, with the required notice.
- Plane, character and card names are Magic's. Nothing is taken from the 1997 game: no names, maps, characters or art. Nothing is taken from Fallout beyond the camera and movement style.

---
