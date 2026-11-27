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
  - 10 extra commons, 2,000 gold, common gear in 3 slots, and 2 hearts (A3b).
  - Free, unlimited basic lands of your identity's colors. Basics are never part of the collection, and Wastes are always available.

### A2. Decks, the spell table and the sideboard
- **Deck rules:**
  - At least 40 cards, no maximum.
  - At most 4 copies of any non-basic card; cards restricted in Vintage are limited to 1. The limit counts the deck and
    its sideboard together (CR 100.4a).
  - The card pool is implemented cards that are legal or restricted in Vintage, minus Universes Beyond printings. That rule also removes the ante cards, conspiracies and Un-cards.
- **The sideboard** holds 0–15 cards from the collection beside the deck. A copy can't be in both. Its cards are held to
  the character's identity as the deck's are, and the free basic lands of their colors may be in it. It is what a rematch
  swaps from (A3), and in a duel it is the cards the player owns outside the game (CR 100.4a), which a card that brings
  one in (a Wish) chooses among.
- **The spell table** is where you edit your deck and your sideboard. Every town has one, and every dungeon by the way into its first round; everywhere else your deck is locked. It is the existing deck editor in a "realm" mode: search runs over your collection, and the counts left show copies not already used in the deck or the sideboard. Each card shows its list price, a card outside your identity is shown dimmed and can be in neither, the free basic lands of your colors are added and taken out with a button each, and the deck's mana curve and colors are drawn beside it. The server judges the deck and the sideboard as they change, and Save keeps them only when it would deal them.

### A3. Duels and rewards
- **Starting a duel:**
  - **Every fight is the player's choice.** Clicking a mob walks the player up to it, and the duel starts beside it. No
    mob comes after anyone: a wanderer a player comes near stops, turns to watch them and waits to be challenged.
  - The splash shows the mob's name, its tier, its stats and gear traits, its gold range and your
    hearts. Then the table opens.
  - The mob's seat is played by the tactical bot in your tab.
  - A duel is a game, and an encounter is one game or more (fighting again, below). Who plays first in an encounter's
    first game is decided at random, as CR 103.1 says; in a game after it the loser of the last chooses.
- **Winning** pays gold and gear, and no cards:
  - Gold is rolled from the tier. Base ranges: T1 20–60, T2 50–150, T3 120–300, T4 250–600, boss 1,500.
  - Gear drops with a chance of 10% / 15% / 20% / 30% by tier, and bosses always drop one.
  - A boss also gives its gift (A6) and may drop a relic (A3a).
- **Losing** a game costs a heart (A3b) and pays nothing: no gold, no gear. A draw counts as a loss.
  - **Hearts left, a world mob:** it stands over you - its portrait, its name, a line of its own about the game - and
    offers to let you go for gold, or to fight again. Paid, the encounter is over and the mob is dealt with until its
    spawn's next epoch; the button is greyed when you can't pay.
  - **Hearts left, a dungeon's mob** (a challenger or a boss): the only choice is to fight again. It can't be bought off.
  - **No hearts left:** you die (A3b).
  - What the mob says is one of its lines (its file's `lines`) for how the game went: **flawless** if it lost no life,
    **close** if it ended at a quarter of its full starting life or less, **solid** otherwise; a beast's is a narrated
    action.
- **The buyout** = base(tier) × min(1, the mob's life at the end ÷ its full starting life), rounded, never less than 1 gold.
  - Its full starting life is its life with its gear's and a dungeon standing's gains, the same in every game of the
    encounter, so a mob worn down across games is cheaper. Ending above it, the share is capped at the whole.
  - Bases by tier (cheap at tier 1 beside what a tier 1 win pays, dear at tier 4):

    | Tier | 1 | 2 | 3 | 4 |
    |---|---|---|---|---|
    | Buyout base | 30 g | 120 g | 400 g | 1,200 g |

    At 1 life of 20 a tier 4 mob asks 60 gold, a twentieth.
  - The server measures it from the life the verified log ends with.
- **Fighting again** (a rematch) is the encounter's next game:
  - **Sideboarding:** the deck is swapped with its sideboard on the sideboard screen (the spell table's editor, over the
    last game's deck and sideboard alone). The deck must stay legal (40 or more, the copy limits, the identity) and the
    sideboard at 15 or fewer. The swap is for the encounter alone: the saved deck is unchanged, as a match reverts.
  - **Play or draw:** you lost the last game, so you choose (CR 103.1).
  - You start at your full starting life; the mob starts at **exactly the life it ended the last game with** - not
    healed, not capped (only its buyout is). Both draw fresh hands from fresh libraries.
  - A rematch lost is another loss: another heart, and the choice again. A rematch won pays a win's rewards.
- **Conceding** counts as a loss.
- **Leaving mid-duel:** the duel's log is saved locally and resumes on reload. A duel that is never finished counts as lost when you start your next encounter, or after 24 hours. A defeat left unanswered (the page closed on its dialog) comes back when you return, and no other encounter starts until it is answered.

### A3a. Relics

Some cards are too powerful to come any way but one: the Power 9 to begin with (Black Lotus, Mox Pearl, Mox Sapphire, Mox
Jet, Mox Ruby, Mox Emerald, Ancestral Recall, Time Walk, Timetwister), listed in `realms/content/relics.json`, which the
owner may extend.

- **Only from the highest-level bosses.** A relic drops only from the bosses its entry names: the capstone dungeon's
  boss (the Phyrexian praetor that ends the Dominaria arc), and later planes' capstones. The chance is small, about 1 in
  50 per win, in the entry. It is rolled after the duel, apart from the boss's gift. Each relic the boss holds is rolled
  on its own, so one win may drop more than one, and every relic that drops goes straight to the collection; the duel's
  result names them.
- **One per account, ever.** The server keeps a ledger of every relic each account has received. One already in the
  ledger never drops for that account again, and is not even rolled, even if the card has since left the collection.
  Each account's ledger is its own. Dying in the dungeon run it was won in takes it back with the run's winnings (A3b),
  and its ledger entry with it, so it may drop again.
- **Never anywhere else.** Relics are in no plane's pool: no vendor sells or buys one, no boss's loot holds one, no
  starter deck has one.
- **Kept.** A relic can't be sold, so it is never passed on. A deck and its sideboard hold one copy at most between them
  (they are restricted in Vintage).

### A3b. Hearts
- **What they are:** how many duels you may lose before you die. A character has **hearts** (how many they have now) and
  a **capacity** (how many they can hold). A new character starts at 2 of 2. They show on the HUD as hearts, filled for
  those you have and empty for the rest you hold, and on the duel's splash.
- **Losing a game** costs one (A3).
- **Refilling:** entering a **safe town** - within a town's walls, or a building of one - fills them to the capacity. The
  server sees it from where you report standing, which it checks, never on the client's word. Waking at home after
  dying fills them too.
- **Hearts found:** two finds give one back, up to the capacity, out where no town is near. Neither is used up by a
  character whose hearts are full - it keeps until they need it - and the server alone says whether each is there and
  whether it was taken.
  - **Heartblooms** grow in the wilds between the towns: a low clump of dark leaves and, on its stem, a bloom shaped like
    a heart that glows rose-red in the grass. They come and go on the travel map, never in a town's grounds: never more
    than three across Dominaria at once, each in a clearing at least 85 tiles from the next (a third of the map's length
    across), a new one now and then (about every half hour while there are fewer),
    wilting after a few hours if nobody picks it - so one seen is worth the walk. Walking onto one, or clicking it,
    picks it: a heart back. It is everyone's: picked, it is gone for all.
  - **A shrine of Serra** stands in one dungeon run in eight, on one of its floors drawn at random: a stepped altar
    and a stele carved with an angel's wings, a heart of light hanging over it. Praying at it gives back a heart **once
    in the run**; its heart then goes cold. The next run of the dungeon is new, and may hold one again or not.
- **More hearts:** the capacity is raised one heart at a time, to **5**, at a **healer**: the priest of each town's temple
  and the keeper of each village's shrine - every town of the Domains has one. The heart bought is filled at once. The
  price rises with each (A5):

  | Heart | 3rd | 4th | 5th |
  |---|---|---|---|
  | Price | 1,000 g | 3,000 g | 8,000 g |

- **Death:** losing the last heart sends you **home**, to your inn (the one you set, else the start town's), with your
  hearts full. In a dungeon the run ends, and **that run's winnings are lost**: the gold of its wins (as much as you still
  have), the gear that dropped (taken off if worn) and the cards it gave (a boss's gift, a relic). Outside a dungeon
  nothing else is lost.

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
  - **Card vendors keep stalls in their town's market**, every one in sight of the gate: a counter of card racks under
    a canopy, the vendor standing before it. A player trades with them standing at the stall (within two tiles).
  - A card a player sells shows up at full price for everyone.
  - There is no trading between players.
- **Wares from other planes.** Until other planes can be explored, cards printed only beyond Dominaria come in a
  slow, small trickle, through two kinds of exotic dealer and nowhere else:
  - **Exotic wares shops** in the biggest towns (New Benalia and Capashen Hold), a shop of their own, indoors, beside the
    inn. Each shows at most 6
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
- **Other gold sources:** treasure chests in the wilds (50–500 g, richer the higher the zone's tier) and the quest board's bounties ("defeat 5 Caligo bog-wraiths" for gold or gear). Chests are not fixtures: they appear at random on open ground of the travel map, one to a zone at most, a new one about every ten minutes in a zone with none, and crumble after half an hour unopened. Each is everyone's - the first to open it has it.
- **Gold sinks beside cards and gear:** a world mob's buyout after a lost game (A3: 30 to 1,200 g at its fullest by
  tier), and hearts at a temple's or shrine's healer (A3b: 1,000, 3,000 and 8,000 g for the 3rd, 4th and 5th). A third
  heart is about 25 tier 1 wins' gold, or two or three of tier 4; the fifth a boss's purse five times over.

### A6. The world — Dominaria
- **One world, two scales.** Dominaria is one isometric world, walked by clicking in real time, the Fallout way, and
  streamed in chunks as you walk, with no loading screen anywhere. It is seen at two scales. **The travel map** is the
  Domains themselves, JRPG-overworld style: the player's figure walks it at its usual size and speed, mountains are
  miniature peaks, forests clumps of miniature trees, and each town an icon - a miniature of the town. Roads join the
  icons, wilderness lies between them, and the regions' terrain shades into each other. **A town** is at walking scale,
  as its streets, interiors and dungeons always were: its grounds hold the town within its wall and the country
  round it, which is only seen, and the camera never looks past them. Walking into a town's icon from the road beside
  it - a click on the icon walks there and in - closes the iris and opens it just inside the town's gate, in its market;
  walking out through the gate closes it and opens it beside the icon where the player went in, on the travel map.
  Getting in or out of a town takes a few seconds, never a walk through the country. A dungeon's or a mage tower's entrance stands on the travel
  map.
- **The scale.** A tile is the art's: a house is five to eight tiles across, a street two to five wide. The travel map is
  512 by 768 square tiles, walked eight ways at 4.2 tiles a second: about three minutes north to south in a straight
  line, a minute or so between neighbouring towns by road, a ferry crossing 10 to 30 seconds. A town is small enough to
  learn at a glance: New Benalia about 60 tiles across within its wall (15 seconds across), a home town about 54, a
  village about 34; from the gate to any stall or door is a few seconds' walk. The Domains keep their shape, compressed (see Geography below). Waystones and ferries make the far
  places near.
- **Wanderers are few, and only on the travel map:** about one spawn point to 3,500 tiles of land, none within 6 tiles of
  a main road in the gentlest country nor within 10 of a town's icon. A town's grounds are safe: no wanderer is ever
  there, and the hearts fill anywhere in them (A3b).
- **Difficulty grows with distance.** The five home towns and New Benalia are the starting areas. Around them and along
  their roads the wilds are tier 1; they grow harder the farther you go, to tier 4 in the far wilds, the borders between
  enemy regions and the edges of the world. A wanderer's tier is its place's: the world generator gives each spawn point
  the tier of its distance from the nearest starting area. A dungeon takes the tier of where it stands, never less than
  its own floor; a mage tower keeps its circle's tier (its mage's and its mobs') wherever it stands.
  **The tiers are visible:** the regional map shows each area's tier - bordered in the tier's color where it changes and
  numbered, the land under it left to be read, or tinted strongly at a toggle - with a legend, and marks the towers and
  dungeons with theirs. Waymarker stones stand where the tier changes on the land, and the HUD names the area you are in
  and its tier, and warns as you cross into a harder one.
- **Fast travel through mage towers.** Mage towers stand across Dominaria, a few in each region and some far out in the
  wilds. Each is a short tournament (the mage-tower theme): a round of challengers, then the mage's hall at the top.
  Beating the mage attunes that tower's waystone to you. From any attuned tower you can travel at once to any other you
  have attuned: your fast-travel network, which grows as you go. Towers far from the starting areas hold harder mages,
  so the network reaches the far wilds only as you can face them.
- **Interiors.** A building with a door has an interior: its own small scene, not part of the world map. Walking through
  the door is seamless. The door opens, the view eases into the room and the player is inside, with no loading screen and
  no jump cut, and leaving reverses it. Inns, guildhalls, temples and shrines, smithies, libraries and the mage's tower,
  the exotic wares shops and the houses of townsfolk have interiors.
- **Dungeons** are not on the world map, and each is a **tournament**, as a Magic event is: rounds of challengers, then
  a boss for the big prizes. A dungeon's entrance stands in the world (a cave mouth, a castle gate, a tower door);
  stepping onto it shows the tournament's board, and Enter starts a **single-player instance generated in the browser**,
  new each run, that no other player sees. Each floor is one arena room - seen whole on one screen at the closest zoom,
  level throughout - in a theme that fits the land the dungeon is in:

  | Theme | Where | A round's arena |
  |---|---|---|
  | Caves | mountains and hills (Keld, the Hurloon and Ironclaw Mountains) | a cavern chamber, its rock wandering round it, a still pool, crystals and the raiders' braziers |
  | Castle | plains and farmland (Benalia) | a hall of the keep, a red runner to the gate, pillars and the order's banners |
  | Mage tower | coasts, isles and lonely heights (Orvada's academy, and mage towers everywhere) | a round tower floor, shelves of books, time-rifts at its sides |
  | Crypt | swamps and dark realms (the Caligo Morass, Amjad) | a burial hall, pillars, coffins, niches of skulls, black water in a corner |
  | Root hollow | forests (Llanowar, the Durkwood, Verdura) | a glade under the canopy among living roots, a spring, glowing mushrooms |
  | Foundry | the orcs' delvings in the Ironclaw Mountains, and Keldon forges | a forge hall, lava channels down its sides, forges and anvils |
  | Phyrexian Portal | the capstone | an island of plating over the void, pylons of ichor |

  A dungeon's content (its theme, its floors, its mobs by tier and its boss) is data. The layout is the generator's,
  from a seed the server hands out for the run (B4).
- **Geography: the Domains.** The world is the Domains of Dominaria as the 2018 *Dominaria* set and its supplements
  show them (the map of Aerona of 2018, the classic map naming every region), compressed onto the travel map, north at
  the top: the continent of **Aerona**, **Icehaven** to its north, and the islands around them. Places beyond the
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

  - **Icehaven** across the north: **Keld** in its south-west (Keld's town, the Skyshroud forest within it), **Parma**
    of the ice giants in its north-east, glaciers along its north. **The Rip** is the strait between it and Aerona.
  - **North Aerona:** the Whispering Woods and the Wild Woods in its west, Oyster Bay and the Ice Rime Hills on the west
    coast, the Smoke Mountains north, the Bade Mountains in the middle, the K'Cur Mountains east toward Cape Tempest and
    Coralhelm; the desert of Surr in the north-east, the Badlands, Wrenna and Muronia in the south-east, Hammerheim on
    the east coast. The **desolate waste** is Surr's, by the Rip, and the **Phyrexian Portal** stands in it.
  - **The Hurloon Mountains** of the minotaurs run across the neck that joins North and South Aerona, the **Red Iron
    Mountains** at their west end, and the **Ironclaw Mountains** of the orcs run south-east from them down the east
    coast.
  - **South Aerona:** **Benalia** in the north-west - New Benalia the capital near the west coast, Capashen Hold south of
    it on the coast, the **Caligo Morass** and the Vess estate at the north-west tip, and **Avenant**'s isles off it in
    the Sea of Avenant; the **Kb'Briann Highlands** and the **Durkwood** south of Benalia; **Llanowar**, the great forest,
    in the middle (its elfhames, the rivers Fors, Moen and Selendine, Lake Ardkanor, and the Fors Basin south of it); the
    **Tonga Mountains** and the desert **Erg Mirab** to the south-east; **Sursi** of the pegasi in the east, with the
    Cathedral of Serra; **Vernalea** on the east coast; then the southern tail - **Kush**, Estark and Tantium, the Green
    Lands, Barbar, and **Verdura** at its south-west tip.
  - **Islands:** **Foriys** of the two-headed giants, an isle south-east of the tail; the long isle of **Oneah** and
    Shanodin to the east, the dark realm of **Amjad** at its south end; **Walassa and Denawa**, Orvada's isles with the
    Tolarian Academy, at the far east; and **Stahaan**, the xenophobic minotaurs' isle, north of Orvada in the
    north-east sea.
  - **One connected world:** every town, dungeon and landmark is reached on foot: bridges and fords cross the rivers,
    passes cross the ranges, and ferries at harbor docks cross to the isles (Avenant, Foriys, Shanodin's isle, Walassa
    and Denawa, Stahaan, Verdura, and over the Rip to Icehaven). The islets no ferry reaches are only seen. A ferry
    crossing is seamless, as a door is: you board, the crossing eases by, and you step off on the other shore.
  - **The land reads at a glance.** One level up or down is hopped, so hills are no obstacle; what stops a walker is
    deliberate and plain to see: the sea, the rivers and lakes, and the ranges - walls of miniature peaks, the great
    ranges (the Hurloons, the Ironclaws, the Smoke Mountains, the Gurdurings) crossed only at their named passes, the
    lesser ones at gaps and where a road cuts through. A wood is thick at its heart but always walked through between
    its trees. Each biome has its ground and its scenery (Benalia's fields round its towns, Llanowar's giant trees, the
    Morass's drowned trees and pools, Surr's and Erg Mirab's dunes, the Badlands' red earth, the snows of Icehaven), and
    a signpost at each fork of the roads says where each leads.
  - **Difficulty by distance** from the starting areas (New Benalia and the five homes): Benalia's fields and the edges
    of Llanowar are the gentlest. The Hurloon passes, the Durkwood and Sursi are harder, and the hardest are the
    Ironclaw Mountains, Parma's ice, Stahaan, the depths of Amjad and the desolate waste.
  - The bosses are kept to cards that are implemented.
- **Dungeon runs** - a tournament:
  - **The board.** Before a run begins, the entrance shows the tournament: the dungeon and its tier, how many rounds,
    the rule of a round, the boss by name, the prizes (what a challenger's win pays, the boss's purse, its gift and its
    own item, the color it unlocks or the waystone it attunes), your hearts, and in one line what is at stake: leave
    between rounds to keep your winnings; lose your last heart and this run's winnings are lost. Enter, or Not now.
  - **Rounds.** 2-5 floors (a mage tower 2, the color dungeons 3-5), generated anew each run; each but the last is a
    round. You arrive at the south of its arena, the way back out beside you; the gate down stands at its north, shut.
    The round's **three challengers** wait on circles of their own spread across the floor, each by its standard,
    watching you; none wanders. The pointer over one names it and its tier, and a click on it is a challenge.
  - **Win two of three.** The gate opens once all the round's challengers but one are beaten (two of three). The third
    is a bonus fight: it still stands, and still pays its rewards, until you go down.
  - **Cash out or push on.** At the open gate you choose: descend to the next round, or leave with your winnings (or
    stay, for the bonus fight). The way back out at the south leaves at any time.
  - **The boss's hall.** The last floor is the boss's hall, a grander arena: the boss alone at its head before its
    throne. Its way out opens beside it once it is beaten.
  - Within a run, beaten mobs stay beaten, and the run remembers the round reached until it ends: closing the page and
    coming back resumes it there. A lost game costs a heart and the mob is fought again (A3: a dungeon's mob is never
    bought off). Leaving, or dying (the last heart lost), ends the run; the next run is a new layout from the first
    round. Dying wakes you at your inn with your hearts full, and what the run won (gold, cards, gear) is lost (A3b).
  - The entrance has a spell table, outside in the world and inside by the way in of the first round.
  - Now and then a run holds a shrine of Serra at one side of one of its arenas (one run in eight), which gives back a
    heart once in the run (A3b).
  - Ally-color dungeons are tier 3 with T2–T3 mobs. Enemy-color dungeons are tier 4 with T3–T4 mobs and stronger boss
    traits. Ally and enemy are by the character's starting color (W U B R G: the two beside it are allies, the two across
    from it enemies); a color the character holds, started with or unlocked, is their own, and its dungeon is as written.
    Smaller dungeons dot the wilderness (a cave, a ruined watchtower) for lower tiers.
- **Bosses:**
  - Beating one **unlocks that color**, drops a unique item and gives a rare or mythic card.
    - The color is yours at once: the HUD's five pips light it (the locked ones stay faint rings), a panel marks the
      moment, and every spell table takes its cards and basic lands from then on.
    - The rare or mythic is the boss's **gift**: one card of its loot, straight into the collection.
    - The unique item is the boss's own (the mob file names it); once you own it, a later win drops a rare or mythic
      item instead, never a second unique.
  - You can fight them again each week for loot: a boss beaten **rests a week** from the win. A run begun meanwhile
    finds its hall empty, says when it is back, and its way out stands open.
  - The regional map rings each boss's dungeon in its color, filled once that color is yours.
  - **Capstone:** once all five colors are unlocked, the Phyrexian Portal opens. A five-color praetor boss ends the Dominaria arc, and later planes come in as data packs.
- **The Phyrexian Portal** (the capstone dungeon):
  - Its gate stands in the desolate waste between Keld and the rest of the Domains, and belongs to no region.
  - It is **sealed until the character's identity holds all five colors**: their starting color and the four others unlocked by beating those bosses. Until then its gate stays shut, and the server refuses to start a run of it.
  - Four floors: three rounds, then the praetor's hall. The first round has a spell table by its way in. Every round's challengers are tier 4 Phyrexians: the Phyrexian Ravager (B/R), the Phyrexian Negator (B), the Phyrexian Gorger (B/G) and, past the first round, the Gitaxian Mindcutter (U/B) and the Portal Warden (U/B/R).
  - The last floor is the praetor's hall. The **Phyrexian Praetor** is five-color, with boss stats and the strongest gear a mob wears. Its deck is the strongest the Dominaria pool allows, so its stats are set so that it plays no easier than the other bosses (the balance lab's fit, `balance.md`: 32 life, a starting hand of 6 and a maximum hand of 7 with its gear, where 42, 9 and 10 made it unbeatable). It is built around Sheoldred, the Apocalypse, the pool's one implemented praetor, and runs on the ten original dual lands and five fetch lands.
  - Beating it unlocks no color, since every color is already yours. It pays a boss's gold and gift, and it is the boss the relics drop from (A3a). Its unique gear item comes with the gear catalogue's boss uniques.
- **Mobs are Dominaria's own creatures.** Every wanderer is a real creature of the plane: a creature card the engine has,
  printed in a Dominaria set (planes.json), drawn as that creature. Examples are a pack of Llanowar Elves, a Shivan
  Dragon, Serra Angels, Benalish Marshals, Keldon Raiders, Hurloon minotaurs and Phyrexian horrors. Its deck is themed around
  it: the creature itself, its kin and tribe, and cards that support what it does. A Llanowar Elves pack ramps into
  the forest's big creatures; a Shivan Dragon brings dragons, burn and red mana. Each has stats and gear traits, through the same
  Vanguard-object system as the player, which is what makes the far ones harder. Mage bosses are Dominaria's mages
  (wizard creatures and planeswalkers the engine has), and dungeon bosses its legends.
  - Behavior: they wander within a home radius; one a player comes within 5 tiles of stops and watches them, waiting to
    be challenged. None gives chase. In the world they respawn on their spawn point's timer; in a dungeon, not within the run.
- **Towns are hubs**: where a player goes to buy and sell cards, rework their deck, take quests, train with the guild,
  buy gear and hearts, and rest - not places to get lost in. **Every town is the same plan** in its own region's style,
  so whoever has learned one knows them all, and everything in it faces south toward the camera:

  ```
          ====================== wall ======================
          [house] [Guild hall]  [ Temple ]  [Library] [house]     the head: the town's great buildings
          ---------------------- the walk ---------------------
             [Exotic wares] [Inn]  ||  [Smithy] [Arena]          by the way in
          ===================== THE MARKET =====================
               [stall][stall][stall] || [stall][stall]           the card vendors
               quest board       fountain        the pitch
          ====================== wall ===[gate]================
  ```

  - **One gate**, a gap in the low south wall the town is seen over: whichever road the player arrives by, they come in
    through it and stand in the middle of the market with every stall and the inn in sight, and leave through it to the
    travel map beside the icon where they came in. The avenue runs from the gate through the market and between the inn and the smithy to the temple's door.
  - **The market** is the heart: every card vendor of the town at a stall (A5), the quest board by the inn's door, the
    town's centrepiece at the head of the avenue (New Benalia's fountain, a statue, a well, a crystal, a great tree, a
    fire bowl), benches, lamps, produce stalls, and the traveling traders' pitch where caravans come.
  - **By the way in**: the **inn**, where you respawn and set your home, a spell table inside and the quest board
    outside; the **smithy**, its armorer inside; the **exotic wares** in the two big towns; the **arena** (a PvP arena,
    locked with a "coming soon" sign until Part B9).
  - **The head**, across the walk: the **temple** (a village's **shrine**), whose priest or keeper is a healer (hearts,
    A3b); the **guildhall** of mages, with a spell table; the **library** (the Academy's mage's tower).
  - **Light exploration**: houses fill the rows' ends, and a few are the homes of townsfolk who will talk; townsfolk
    walk the market; passages run between the buildings. Nothing is on terraces, and no way ends at nothing.
  - **A village** is the plan small: its shrine at the head between cottages, its inn by the way in, a green with its
    well and its one vendor's stall, if it has one, behind a hedge.
  - **Each region builds in its own style**: Benalish stone and banners behind a wall in New Benalia and Capashen Hold, a
    Benalish village's thatch, Tolarian domes, the Vess estate's black stone, the Morass's stilt-houses on boardwalks
    over the bog, Keldon longhouses behind a palisade, Llanowar's tree-houses among great trees. Outside the wall lies
    the country of the town's biome - fields, woods, the shore - seen from within, never walked.
  - **The map shows the way.** In a town the minimap is the town's: the walk, the market, its buildings, the gate and its
    places - the inn, the stalls, the guild, the temple, the smithy, the quest board - named on the whole map.
- **Story:** after the Phyrexian invasion, Dominaria's five color-wells are held by guardians. The player is a mage who must earn each well's attunement. The tone is light, with the story text on quest boards and NPC barks. The owner can rewrite it; it is all data.
- **Social:** you see the other players near you in the world (those in the chunks around you), with their gear and
  their identity pips, and those in the same interior. Dungeons are single-player. Clicking a player shows their
  loadout. There is no chat in v1 (it would need moderation); there is an emote wheel.

### A7. IP stance
- This is unofficial fan content under the Wizards Fan Content Policy: free, no paywall, with the required notice.
- Plane, character and card names are Magic's. Nothing is taken from the 1997 game: no names, maps, characters or art. Nothing is taken from Fallout beyond the camera and movement style.

---
