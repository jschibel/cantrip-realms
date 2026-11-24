# Cantrip Realms - gear in the engine

What a worn item does in a duel (design.md A4): its stat lines change the seat's start (`SeatVariant`: starting life,
starting hand size, maximum hand size), and its effect lines are the abilities of one emblem the seat begins the game
with in its command zone (CR 114.4, 902.3). This is milestone 4: the effect families, the exact rules text each produces,
their parameters, the slots that may carry them and what they cost, and how they are built.

Gear is engine content, held to the engine's bar (CLAUDE.md, "No rules deviations"). Every ability is exactly its text,
built from `cantrip-mechanics` and the core's bricks. Every family has scenarios over its parameter range, and every item
a generated scenario that deals it and sees its emblem act.

## How it is built

Gear touches no upstream code: its emblems are card files, which the engine already finds, built only from what the
engine already has.

- **The families** are `crates/cantrip-cards/src/cards/realm_gear.rs`, a file of the card crate that defines no card: one
  `const fn` per family, its parameters const generics (a trigger's matcher, its intervening "if" and its effect are
  plain `fn` pointers), taking the text it is printed with. `draw_on_turn::<4, 1>(text)` is "draw on turn" at turn four,
  one card. Nothing in `cantrip-mechanics` or the core is added or changed.
- **The emblems** are generated card files beside it: `realm_gear_<item>.rs`, one per item with effects, holding one
  static emblem `CardDef` named `"<item name> (gear)"`, with no card type and no mana cost, its abilities its families'
  instances in the content file's order and its text their texts joined, in its `EXTRA` with any token it makes. An item
  with only stat lines has no emblem. `realm_gear_families.rs` holds the emblems the families' own scenarios deal (`Gear
  test: <family>, <parameters>`), each family over its parameter range; no item wears them.
- **The generator** is `tools/realms/gear-cards.py`: from `realms/content/gear/*.json` it writes those files, each item's
  smoke scenario, and each item's `text` (its stat lines, then its effects' texts) and `points` (Budgets, below: what the
  gear screen shows against the rarity's budget, and the server refuses over it). It refuses an item - and writes
  nothing - whose effect names no family, has a parameter out of range or is not one its slot may carry, or whose points
  are over its rarity's budget. `--check` writes nothing and fails when anything is out of date. The generated files are
  committed like any card file.
- **Why card files.** The card crate's build script (upstream) registers every file in `src/cards`, and a file without
  `pub static CARD` is a plain module (the families') or brings only its `EXTRA` (an emblem, as Chandra, Awakened
  Inferno's file brings its emblem). So the gear is in the engine's one card table with no hook, no second table and no
  new binary, and every fork file is a new file, which an upstream merge never meets. Generating the emblems at build time
  would mean changing the card crate's build script, an upstream file; a checked-in generator does not.
- **Where it runs.** `cantrip-native-host` and `crates/cantrip-wasm`, built from the fork, know the gear as they know
  every card. The realm server's verifier runs the fork's own `cantrip-native-host` (`NativeHostProcess`: the
  `CANTRIP_NATIVE_HOST` variable, else the workspace's build output), and the browser loads the fork's
  `cantrip_wasm.wasm` (`tools\build-engine-wasm.cmd`), so a duel and its replay see the same emblems.
- An emblem can't be targeted, chosen or moved by anything in a duel; its abilities are its controller's and function
  from the command zone (CR 114.4, 113.6p). Triggered abilities use the stack.
- "Your Nth turn" is asked of the history's turn records (`Event::TurnBegan`), never of a counter; so is "the first
  creature to enter under your control this game" (`Event::Entered`).

## Stats (setup values, not abilities)

| Line | Changes | Points | Text |
| --- | --- | --- | --- |
| `life: n` | starting life by n (CR 103.4) | 1 per life | You start the game with n additional (less) life. |
| `hand: n` | starting hand size by n (CR 103.5a) | 6 per card | You draw an additional card (two additional cards, one fewer card) for your opening hand. |
| `maxHand: n` | maximum hand size by n (CR 402.2) | 2 per card | Your maximum hand size is increased (reduced) by one. |

A negative line refunds its points. The sum over the loadout is bounded by design.md A1's ranges (life 10-40, hand 4-9,
maximum 4-10), which the server's loadout check enforces.

## Effect families

"Your Nth turn" is the Nth turn the emblem's controller has begun this game, counted from the history's turn records, an
extra turn (CR 500.7) counting as one. Each "at the beginning of ..., if ..." is an intervening if (CR 603.4). Numbers are
written as the cards print them ("draw two cards", "scry 2"), the ordinal as a word ("if it's your third turn").

| Family | Text (with its parameters) | Content parameters | Slots | Points |
| --- | --- | --- | --- | --- |
| `draw-on-turn` | At the beginning of your draw step, if it's your Nth turn, draw K cards. | `turn` N 2-6, `count` K 1-2 | head | 3 per card, +1 if N ≤ 3 |
| `scry-on-turn` | At the beginning of your upkeep, if it's your Nth turn, scry K. | `turn` N 1-6, `count` K 1-3 | head | 1 per 2 scry, rounded up |
| `surveil-on-turn` | At the beginning of your upkeep, if it's your Nth turn, surveil K. | `turn` N 1-6, `count` K 1-3 | head | 1 per 2 surveil, rounded up |
| `mana-on-turn` | At the beginning of your precombat main phase, if it's your Nth turn, add M. | `turn` N 1-4, `mana` M: `{C}`, `{C}{C}`, or one of `{W}` `{U}` `{B}` `{R}` `{G}` | neck, ring | 3 per mana, +1 if N = 1 |
| `extra-land-on-turn` | At the beginning of your upkeep, if it's your Nth turn, you may play an additional land this turn. | `turn` N 1-3 | feet | 3 |
| `first-creature-haste` | Whenever a creature you control enters, if it's the first creature to enter the battlefield under your control this game, it gains haste until end of turn. | - | feet | 3 |
| `counters-first-creature` | Whenever a creature you control enters, if it's the first creature to enter the battlefield under your control this game, put K +1/+1 counters on it. | `count` K 1-2 | hands | 2 per counter |
| `token-on-turn` | At the beginning of your upkeep, if it's your Nth turn, create [token]. | `turn` N 1-4, `token`: `soldier` (a 1/1 white Soldier creature token: 2), `goblin` (1/1 red Goblin: 2), `elf-warrior` (1/1 green Elf Warrior: 2), `spirit` (1/1 white Spirit with flying: 3), `thopter` (1/1 colorless Thopter artifact creature with flying: 3) | hands, relic | by the token |
| `gain-life-on-turn` | At the beginning of your upkeep, if it's your Nth turn, you gain K life. | `turn` N 2-6, `count` K 2-5 | body | 1 per 2 life, rounded up |
| `prevent-damage-on-turn` | At the beginning of your upkeep, if it's your Nth turn, prevent all damage that would be dealt to you this turn. | `turn` N 1-3 | body | 3 |
| `opponent-discards-on-turn` | At the beginning of each opponent's upkeep, if it's that player's Nth turn, that player discards a card. | `turn` N 2-4 | ring, relic | 4 |
| `opponent-mills-on-turn` | At the beginning of each opponent's upkeep, if it's that player's Nth turn, that player mills K cards. | `turn` N 1-4, `count` K 2-4 | ring | 1 per 2 milled, rounded up |

How the rules read them:

- **The first creature.** "The first creature to enter the battlefield under your control this game" is one no creature
  entered under your control before. Creatures that enter together as the first are each the first (Dragon Fodder's two
  Goblins each get the counters); a creature of an opponent's never counts. Once true of a creature it stays true, so the
  resolution's second asking of the "if" (CR 603.4) agrees with the first.
- **Prevention** is an effect the triggered ability makes for the turn (CR 615.3), so it lasts whatever becomes of its
  source, and damage that "can't be prevented" is dealt (CR 615.12).
- **Mana** from a triggered ability uses the stack (CR 605.1b) and empties from the pool at the end of the phase (CR
  500.4). A colored M is in the wearer's color identity: the loadout check's to enforce (a duel has no identity to ask).
- **Scry, surveil and mill** of more cards than the library holds do what the rules say: look at, or mill, those there are
  (CR 701.22, 701.25, 701.17b). A discard from an empty hand asks nothing.

### Not built yet: what the engine lacks

These families of the design need an emblem ability the engine does not let function from the command zone today. They
are left out, and the generator refuses them, until an upstream change lets them:

| Family | Text | What the engine lacks |
| --- | --- | --- |
| `first-spell-discount` | The first [color/type] spell you cast each game costs {K} less to cast. | An emblem's static cost changes: `cost_change_sources` (cantrip-rules `actions.rs`) reads only the battlefield, though an emblem's static abilities function in the command zone (CR 114.4). |
| `ping-once` | {K}: This emblem deals 1 damage to any target. Activate only as a sorcery and only once each game. | An emblem's activated abilities: `activated_options` offers those of the battlefield, the hand, the graveyard and exile only. "Once each game" would be asked of the history's activation records. |
| `loot-once` | {K}: Draw a card, then discard a card. Activate only once each game. | The same. |

Two families are worded as triggered abilities for the same reason: "you may play an additional land on your Nth turn" as
a static ability needs an emblem's play rules counted for land plays (`land_rules` asks the battlefield's only), and
"prevent all damage that would be dealt to you during your Nth turn" a static prevention effect that functions in the
command zone (`replace.rs`'s printed preventions function on the battlefield only). The triggered wording is exact for
what it does; the static one can come back once the engine counts an emblem's static abilities there.

The points are where balancing starts. The balance lab (tech.md C5) refits them from measured win rates, and the table
here is updated from its results.

## Budgets

An item's points (stats and effects together, refunds subtracted) are at most its rarity's budget: common 3, uncommon 5,
rare 8, mythic 12. A boss's unique item goes up to 14 and carries a drawback line (a negative stat; no family favors an
opponent yet). The generator checks every item against its slot's families and its budget.

## Testing

- **Each family:** scenarios `scenarios/realm-gear-<family>-*.cantrip` deal its test emblems with the `[Variant]` section's
  `emblem` (scenarios/README.md) over its parameter range: that it acts when it should, does nothing when its condition
  fails (a wrong turn, an opponent's turn), and interacts rightly where the rules have something to say (a scry on an
  empty library, a surveil or mill of more than the library holds, a discard from an empty hand, prevention against
  "damage can't be prevented", creatures entering together, an extra turn counted). They are the stock corpus's, so
  `cargo test -p cantrip-script` runs each as a test and `corpus -- --scenario realm-gear` runs them all.
- **Each item:** a generated `scenarios/realm-gear-item-<item>.cantrip` deals its emblem with its stat lines' start, checks
  it is in the command zone, and sees its first effect happen. `gear-cards.py --smoke-cases DIR` writes the same
  scenario for each family test emblem, so every family's template is tried before an item wears it.
- **Content:** `crates/cantrip-cards/tests/realm_gear_matches_content.rs` holds the card table to the content (every item
  with effects has its typeless emblem, an ability per effect, its text the item's), and `gear-cards.py --check` the
  generated files.
- **Coverage:** `python tools/realms/gear-coverage.py` (card-coverage.py for the gear, whose emblems no deck holds) runs
  the gear scenarios under cargo-llvm-cov and reports every line of `realm_gear*.rs` they never run.
