# Cantrip Realms - mob difficulty, as the balance lab measures it

The balance lab (`tools\realms\balance.cmd`, tech.md C5) plays reference players against every mob, whole duels on the
native engine dealt as the realm server deals an encounter, the tactical bot in both seats. This is what it measured on
2026-11-23 and what the mobs' stats were changed to. Re-run it after any change to mob decks, stats, gear or the bot:

```
tools\realms\balance.cmd --games 6 --boss-games 24 --log run.jsonl --out run.md
```

That is 3,732 games, about 15-25 minutes on 14 hosts. Each game's seed comes from `--seed` (1 by default), so a run is
repeatable.

## The reference players

| Kind | Decks | Gear | Faces |
|---|---|---|---|
| starter | each color's starter deck (`realms/content/dominaria/starters`) | the starting kit: Kjeldoran Helm, Copper Amulet, Novice Robe (22 life, hand 7, maximum 9) | T1, T2 |
| upgraded | `decks/realms/dominaria/reference/<color>.txt`: the starter with about ten of the pool's commons and uncommons swapped in (removal, evasive creatures, a few rares' worth of gold at most) | Circlet of Foresight, Silver Pendant, Chain Hauberk, Boots of the March (25 life, hand 7, maximum 10, a card on turn 4, an extra land on turn 2) | T3, T4, bosses |
| duo | `white-blue.txt`, `black-red.txt`: strong two-color decks of the pool, rares included | as upgraded | bosses whose color they do not hold (the praetor: both) |

## Targets (the player's win rate)

| Opponent | Starter | Upgraded |
|---|---|---|
| T1 | 65-75% | |
| T2 | 50-60% | |
| T3 | | 50-60% |
| T4 | | 45-55% |
| Boss | | 35-45%, every boss distinctly harder than T4 |

The tiers are reported in two groups, the wanderers and their mages and wardens (the mage towers' bosses and the
dungeons' floor wardens), each held to its tier's target.

## Before and after

Wins/games, the rate and its Wilson 95% interval. Before: 3,732 games on the stats as they were (seed 1). After: 3,732
games on the stats below (seed 4, with T2's mages and wardens, Lyra and Teferi re-measured on seed 5 after a last
adjustment).

| Opponent | Decks | Before | After |
|---|---|---|---|
| T1 mages & wardens | starter | 143/180, 79% (73-85%) | 127/180, 71% (64-77%) |
| T1 wanderers | starter | 272/450, 60% (56-65%) | 300/450, 67% (62-71%) |
| T2 mages & wardens | starter | 131/180, 73% (66-79%) | 97/180, 54% (47-61%) |
| T2 wanderers | starter | 238/450, 53% (48-57%) | 244/450, 54% (50-59%) |
| T3 mages & wardens | upgraded | 157/180, 87% (82-91%) | 131/180, 73% (66-79%) |
| T3 wanderers | upgraded | 363/450, 81% (77-84%) | 264/450, 59% (54-63%) |
| T4 mages & wardens | upgraded | 261/360, 72% (68-77%) | 176/360, 49% (44-54%) |
| T4 wanderers | upgraded | 370/570, 65% (61-69%) | 284/570, 50% (46-54%) |
| Boss: garna | duo | 17/24, 71% (51-85%) | 12/24, 50% (31-69%) |
| Boss: garna | upgraded | 75/120, 62% (54-71%) | 38/120, 32% (24-40%) |
| Boss: liliana | duo | 23/24, 96% (80-99%) | 23/24, 96% (80-99%) |
| Boss: liliana | upgraded | 111/120, 92% (86-96%) | 97/120, 81% (73-87%) |
| Boss: lyra-dawnbringer | duo | 1/24, 4% (1-20%) | 11/24, 46% (28-65%) |
| Boss: lyra-dawnbringer | upgraded | 20/120, 17% (11-24%) | 40/120, 33% (26-42%) |
| Boss: phyrexian-praetor | duo | 12/48, 25% (15-39%) | 29/48, 60% (46-73%) |
| Boss: phyrexian-praetor | upgraded | 6/120, 5% (2-10%) | 51/120, 42% (34-51%) |
| Boss: rofellos | duo | 24/48, 50% (36-64%) | 33/48, 69% (55-80%) |
| Boss: rofellos | upgraded | 32/120, 27% (20-35%) | 50/120, 42% (33-51%) |
| Boss: teferi | duo | 15/24, 62% (43-79%) | 14/24, 58% (39-76%) |
| Boss: teferi | upgraded | 91/120, 76% (67-83%) | 57/120, 48% (39-56%) |

## The stats (life / starting hand / maximum hand)

Mobs' base stats, before their gear (`tools/realms/sample-decks.py`, `STATS` and `WARDEN_STATS`); the bosses' with their
gear (`totals`). The gear itself is unchanged.

| Who | Before | After |
|---|---|---|
| T1 wanderers | 20/7/7 | 15/7/7 |
| T2 wanderers | 20/7/7 | 18/7/7 |
| T3 wanderers | 22/7/7 | 34/9/9 |
| T4 wanderers and the Portal's mobs | 24/7/7 | 27/8/8 |
| T1 mages and wardens | 26/7/7 | 32/8/8 |
| T2 mages and wardens | 26/7/7 | 32/8/8 |
| T3 mages and wardens | 26/7/7 | 40/10/10 |
| T4 mages and wardens | 26/7/7 | 36/9/9 |
| Lyra Dawnbringer (with gear) | 38/8/8 | 22/7/7 |
| Teferi | 37/8/8 | 64/11/11 |
| Liliana of the Veil | 38/7/10 | 44/9/10 |
| Garna, Bloodfist of Keld | 38/8/8 | 42/10/9 |
| Rofellos, Llanowar Emissary | 38/8/8 | 35/7/7 |
| Phyrexian Praetor | 42/9/10 | 32/6/7 |

The numbers follow how strongly each group's decks play, not a ladder. Tier 3's generated decks play much weaker than
tier 4's (81% against 65% for the same upgraded decks at nearly the same stats), so tier 3's mobs now start with more
than tier 4's. The bosses' decks differ even more: Lyra's (four Lyra, Serra Angels, Archangels, Swords) and the
praetor's were nearly unbeatable and now start with less than a player; Teferi's counter-heavy deck and Liliana's start
with a great deal more.

## What the lab could not reach

- **Liliana of the Veil: 81% (73-87%) for the upgraded decks**, far above the boss target and easier than tier 4. More
  stats do not help: at 60 life and a hand of 11 two runs gave 67% and 88%, no better than 44/9/10 (79%), and her games
  run longest of all (38 turns on average at 60 life, against 23 for the other bosses). Her deck (eleven creatures, four
  Liliana of the Veil, seven removal spells) does not close games as the bot plays it. It is a deck question, not a
  stats one, and the deck is not broken (its mana casts everything), so it is left for a decision: more threats in her
  deck (her roster entry's `shape`) is the likely fix. She keeps the modest 44/9/10.
- **Tier 3 mages and wardens: 73% (66-79%)** against 50-60%. Their spell-heavy decks (nine creatures, fourteen other
  spells) play weakly; meeting the target would take about 45 life and a hand of 11, more than most bosses, so they
  were left at 40/10/10.
- **Lyra 33% (26-42%) and Teferi 48% (39-56%)** are a little outside 35-45% at their point estimates, with the target
  inside both intervals.
- **Garna 32% (24-40%)** is a little under 35%, the target inside the interval.

## Odd things the bot did

- Spell-heavy and control decks (the mages', Teferi's, Liliana's) play far below their cards: the bot wins with
  creatures and burn and makes little of counterspells and planeswalkers. Their stats compensate.
- `mage-llanowar-3` plays two Living Artifact with no artifact in the deck, two cards it can never cast.
- The blue and white starters are the weakest (T1 wanderers 60% and 57%, T2 41% and 42%) and the red starter the
  strongest (86% and 73%); the tier targets are met on the average of the five.
- Against the bosses, green fares worst (Teferi 8%, Garna 12%, Rofellos 21%) and blue best.
