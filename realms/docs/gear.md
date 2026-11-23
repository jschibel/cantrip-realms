# Cantrip Realms - gear in the engine

What a worn item does in a duel (design.md A4): its stat lines change the seat's start (`SeatVariant`: starting life,
starting hand size, maximum hand size), and its effect lines are the abilities of one emblem the seat begins the game
with in its command zone (CR 114.4, 902.3). This is the brief milestone 4 builds: the effect families, the exact rules
text each produces, their parameters, the slots that may carry them and what they cost.

Gear is engine content, held to the engine's bar (CLAUDE.md, "No rules deviations"). Every ability is exactly its text,
built from `cantrip-mechanics` and the core's bricks. Every family has scenarios over its parameter range, and every item
a generated scenario that deals it and sees its emblem act.

## How it is built

- `realms/crates/realms-gear`: one function or generic per family, its parameters as const generics, since a
  `TriggerCondition` and an effect are plain `fn` pointers. `draw_on_turn::<3, 1>` is the family "draw on turn" at turn
  three, one card.
- A build script reads `realms/content/gear/*.json` (interfaces.md) and generates one static emblem `CardDef` per item with
  effects, named `"<item name> (gear)"`, with no card type. Its abilities are its families' instances in the file's
  order, and its text is their texts joined. Items with only stat lines have no emblem.
- The engine's card table gains the gear's definitions through `cantrip_engine`'s hook for a fork's extra definitions
  (an upstream change of this milestone). The fork's browser engine and its native replay host both register them before
  the first game, so a duel and its replay see the same emblems.
- An emblem can't be targeted, chosen or moved by anything in a duel; its abilities are its controller's (CR 114.4).
  Triggered abilities use the stack. "Once per game" activated abilities are tracked by the event history (an activation
  record of that ability), never by a counter.

## Stats (setup values, not abilities)

| Line | Changes | Points |
| --- | --- | --- |
| `life: n` | starting life by n (CR 103.4) | 1 per life |
| `hand: n` | starting hand size by n (CR 103.5a) | 6 per card |
| `maxHand: n` | maximum hand size by n (CR 402.2) | 2 per card |

A negative line refunds its points. The sum over the loadout is bounded by design.md A1's ranges (life 10-40, hand 4-9,
maximum 4-10), which the server's loadout check enforces.

## Effect families

"Your Nth turn" is the Nth turn the emblem's controller has begun this game, counted from the history's turn records.
N is between 1 and 6. Each "at the beginning of ..., if ..." is an intervening if (CR 603.4).

| Family | Text (with its parameters) | Params | Slots | Points |
| --- | --- | --- | --- | --- |
| `draw-on-turn` | At the beginning of your draw step, if it's your Nth turn, draw K cards. | N 2-6, K 1-2 | head | 3 per card, +1 if N ≤ 3 |
| `scry-on-turn` | At the beginning of your upkeep, if it's your Nth turn, scry K. | N 1-6, K 1-3 | head | 1 per 2 scry |
| `surveil-on-turn` | At the beginning of your upkeep, if it's your Nth turn, surveil K. | N 1-6, K 1-3 | head | 1 per 2 surveil |
| `mana-on-turn` | At the beginning of your precombat main phase, if it's your Nth turn, add M. | N 1-4, M a mana string ({C}, {C}{C}, or {W}...{G} in the wearer's identity) | neck, ring | 3 per mana, +1 if N = 1 |
| `first-spell-discount` | The first [color/type] spell you cast each game costs {K} less to cast. | color/type, K 1-2 | neck, ring | 2 per {1} (3 if any spell) |
| `extra-land-on-turn` | You may play an additional land on your Nth turn. | N 1-3 | feet | 3 |
| `first-creature-haste` | The first creature spell you cast each game gains haste until end of turn after it resolves... (CR wording to be settled with the delayed-trigger form the engine has) | - | feet | 3 |
| `counters-first-creature` | Whenever a creature you control enters, if it's the first creature to enter under your control this game, put K +1/+1 counters on it. | K 1-2 | hands | 2 per counter |
| `token-on-turn` | At the beginning of your upkeep, if it's your Nth turn, create a [token]. | N 1-4, a token of `tokens.rs` (1/1 Soldier, Goblin, Elf Warrior, Spirit flier, Thopter...) | hands, relic | by the token, 2-4 |
| `gain-life-on-turn` | At the beginning of your upkeep, if it's your Nth turn, you gain K life. | N 2-6, K 2-5 | body | 1 per 2 life |
| `prevent-damage-on-turn` | Prevent all damage that would be dealt to you during your Nth turn. | N 1-3 | body | 3 |
| `ping-once` | {K}: This emblem deals 1 damage to any target. Activate only as a sorcery and only once each game. | K 1-3 | relic | 4 - K |
| `loot-once` | {K}: Draw a card, then discard a card. Activate only once each game. | K 1-2 | relic, head | 3 - K + 1 |
| `opponent-discards-on-turn` | At the beginning of each opponent's upkeep, if it's that player's Nth turn, that player discards a card. | N 2-4 | ring, relic | 4 |
| `opponent-mills-on-turn` | At the beginning of each opponent's upkeep, if it's that player's Nth turn, that player mills K cards. | N 1-4, K 2-4 | ring | 1 per 2 milled |

The points are where balancing starts. The balance lab (tech.md C5) refits them from measured win rates, and the table
here is updated from its results.

## Budgets

An item's points (stats and effects together, refunds subtracted) are at most its rarity's budget: common 3, uncommon 5,
rare 8, mythic 12. A boss's unique item goes up to 14 and carries a drawback line (a negative stat, or an
opponent-favoring effect). The content lint checks every item against its slot's families and its budget.

## Testing

- Each family: scenarios with the `[Variant]` section's `emblem` (scenarios/README.md) over its parameter range: that it
  acts when it should, does nothing when its condition fails (a wrong turn, an opponent's turn), and interacts rightly
  where the rules have something to say (a scry on an empty library, a discount with a cost increase, prevention with
  "damage can't be prevented").
- Each item: a generated scenario that deals its emblem and checks it is in the command zone with its text, and that its
  first effect happens.
- Coverage: `tools/card-coverage.cmd` over `realms-gear`, every line run.
