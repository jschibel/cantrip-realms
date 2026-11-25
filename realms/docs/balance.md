# Cantrip Realms - mob difficulty, as the balance lab measures it

The balance lab (`tools\realms\balance.cmd`, tech.md C5) plays reference players against every mob, whole duels on the
native engine dealt as the realm server deals an encounter, the tactical bot in both seats. This is what it measured on
2026-11-23 and 24, and what the mobs' stats and the generator's decks were changed to. Re-run it after any change to mob
decks, stats, gear or the bot:

```
tools\realms\balance.cmd --games 6 --boss-games 24 --log run.jsonl --out run.md
```

That is 3,732 games, about 15-25 minutes on 14 hosts. Each game's seed comes from `--seed` (1 by default), so a run is
repeatable. Bosses are dealt as an own or ally color's dungeon deals them (no gains); `--standing` deals each color boss
as the deck's colors would meet it, an enemy color's with its dungeon's gains.

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
| Boss (own or ally color's run) | | 35-45%, every boss distinctly harder than T4 |

The tiers are reported in two groups, the wanderers and their mages and wardens (the mage towers' bosses and the
dungeons' floor wardens), each held to its tier's target. Each starter is to be within about 10 points of the five's
average at T1 and T2.

The lab deals each game as an encounter's first (design.md A3): both seats at their full starting life, nobody
sideboarded, who plays first from the seed. What a loss costs is no longer the lab's to measure - a heart, never cards
(design.md A3b) - and a rematch only helps the player: the mob begins it at the life it kept, so an encounter fought to
the end is won more often than one game, by a margin the lab does not report. The win rates above are a single game's,
the same as before hearts.

### What a loss costs, against what a win pays

A loss pays nothing and costs a heart; a world mob then asks its buyout, at most its tier's base. At the target win
rates a player loses about one game in three at tier 1 and one in two at tier 4, so the buyouts are set against a
win's gold (design.md A3), the base at its fullest:

| Tier | A win's gold | Its mean | Buyout base | Base / mean |
|---|---|---|---|---|
| 1 | 20-60 | 40 | 30 | 0.75 |
| 2 | 50-150 | 100 | 120 | 1.2 |
| 3 | 120-300 | 210 | 400 | 1.9 |
| 4 | 250-600 | 425 | 1,200 | 2.8 |

Paying off a tier 1 mob costs less than the win would have paid; a tier 4 mob's flawless win costs nearly three wins'
gold, so fighting it again (at its carried life) is the cheaper answer there, and a heart spent on it is the price. The
hearts a healer sells (1,000, 3,000 and 8,000 gold for the 3rd, 4th and 5th) are 25, 75 and 200 mean tier 1 wins, or
2.4, 7 and 19 of tier 4: the third within reach of a few hours' wandering, the fifth a late goal.

## Results

Wins/games, the rate and its Wilson 95% interval. **Before**: the stats and decks as they first were (seed 1). **First
tuning**: stats only (seed 4; T2's mages and wardens, Lyra and Teferi on seed 5). **Now**: after the follow-up below -
decks fixed in the generator, the starters evened out, stats re-fitted (seed 7; the T1 mobs and Liliana re-measured on
seed 8 after their last change).

| Opponent | Decks | Before | First tuning | Now |
|---|---|---|---|---|
| T1 mages & wardens | starter | 143/180, 79% (73-85%) | 127/180, 71% (64-77%) | 126/180, 70% (63-76%) |
| T1 wanderers | starter | 272/450, 60% (56-65%) | 300/450, 67% (62-71%) | 317/450, 70% (66-74%) |
| T2 mages & wardens | starter | 131/180, 73% (66-79%) | 97/180, 54% (47-61%) | 104/180, 58% (50-65%) |
| T2 wanderers | starter | 238/450, 53% (48-57%) | 244/450, 54% (50-59%) | 250/450, 56% (51-60%) |
| T3 mages & wardens | upgraded | 157/180, 87% (82-91%) | 131/180, 73% (66-79%) | 94/180, 52% (45-59%) |
| T3 wanderers | upgraded | 363/450, 81% (77-84%) | 264/450, 59% (54-63%) | 236/450, 52% (48-57%) |
| T4 mages & wardens | upgraded | 261/360, 72% (68-77%) | 176/360, 49% (44-54%) | 166/360, 46% (41-51%) |
| T4 wanderers | upgraded | 370/570, 65% (61-69%) | 284/570, 50% (46-54%) | 265/570, 46% (42-51%) |
| Boss: garna | duo | 17/24, 71% (51-85%) | 12/24, 50% (31-69%) | 14/24, 58% (39-76%) |
| Boss: garna | upgraded | 75/120, 62% (54-71%) | 38/120, 32% (24-40%) | 42/120, 35% (27-44%) |
| Boss: liliana | duo | 23/24, 96% (80-99%) | 23/24, 96% (80-99%) | 16/24, 67% (47-82%) |
| Boss: liliana | upgraded | 111/120, 92% (86-96%) | 97/120, 81% (73-87%) | 45/120, 38% (29-46%) |
| Boss: lyra-dawnbringer | duo | 1/24, 4% (1-20%) | 11/24, 46% (28-65%) | 12/24, 50% (31-69%) |
| Boss: lyra-dawnbringer | upgraded | 20/120, 17% (11-24%) | 40/120, 33% (26-42%) | 44/120, 37% (29-46%) |
| Boss: phyrexian-praetor | duo | 12/48, 25% (15-39%) | 29/48, 60% (46-73%) | 23/48, 48% (34-62%) |
| Boss: phyrexian-praetor | upgraded | 6/120, 5% (2-10%) | 51/120, 42% (34-51%) | 38/120, 32% (24-40%) |
| Boss: rofellos | duo | 24/48, 50% (36-64%) | 33/48, 69% (55-80%) | 28/48, 58% (44-71%) |
| Boss: rofellos | upgraded | 32/120, 27% (20-35%) | 50/120, 42% (33-51%) | 51/120, 42% (34-51%) |
| Boss: teferi | duo | 15/24, 62% (43-79%) | 14/24, 58% (39-76%) | 15/24, 62% (43-79%) |
| Boss: teferi | upgraded | 91/120, 76% (67-83%) | 57/120, 48% (39-56%) | 51/120, 42% (34-51%) |

**The starters**, each against the tier's wanderers, 90 games each. Before is the first tuning's run; now, T1's
average is 70% and T2's 56%.

| Starter | T1 before | T1 now | T2 before | T2 now |
|---|---|---|---|---|
| white | 57% | 68% | 42% | 58% |
| blue | 60% | 72% | 41% | 51% |
| black | 68% | 64% | 58% | 58% |
| red | 86% | 72% | 73% | 59% |
| green | 63% | 76% | 57% | 52% |

**An enemy color's run** (`--standing`, seed 9): each boss with its dungeon's gains (+6 life, +1 hand, +1 maximum
hand), against the upgraded decks of its two enemy colors, 24 games each. The praetor has no color dungeon and no gains.

| Boss | Enemy decks | Wins/games |
|---|---|---|
| Lyra Dawnbringer | black, red | 10/48, 21% (12-34%) |
| Teferi | red, green | 8/48, 17% (9-30%) |
| Liliana of the Veil | white, green | 11/48, 23% (13-37%) |
| Garna, Bloodfist of Keld | white, blue | 14/48, 29% (18-43%) |
| Rofellos, Llanowar Emissary | blue, black | 18/48, 38% (25-52%) |
| All five | | 61/240, 25% (20-31%) |

## What was changed

**Stats** (life / starting hand / maximum hand). Mobs' base stats, before their gear (`tools/realms/sample-decks.py`,
`STATS` and `WARDEN_STATS`); the bosses' with their gear (`totals`). The gear itself is unchanged.

| Who | Before | Now |
|---|---|---|
| T1 wanderers | 20/7/7 | 18/7/7 |
| T2 wanderers | 20/7/7 | 18/7/7 |
| T3 wanderers | 22/7/7 | 34/9/9 |
| T4 wanderers and the Portal's mobs | 24/7/7 | 27/8/8 |
| T1 mages and wardens | 26/7/7 | 34/8/8 |
| T2 mages and wardens | 26/7/7 | 32/8/8 |
| T3 mages and wardens | 26/7/7 | 40/10/10 |
| T4 mages and wardens | 26/7/7 | 36/9/9 |
| Lyra Dawnbringer (with gear) | 38/8/8 | 22/7/7 |
| Teferi | 37/8/8 | 64/11/11 |
| Liliana of the Veil | 38/7/10 | 40/9/10 |
| Garna, Bloodfist of Keld | 38/8/8 | 42/10/9 |
| Rofellos, Llanowar Emissary | 38/8/8 | 35/7/7 |
| Phyrexian Praetor | 42/9/10 | 32/6/7 |

The numbers follow how strongly each group's decks play, not a ladder. Tier 3's generated decks play much weaker than
tier 4's, so tier 3's mobs start with more than tier 4's. Lyra's deck (four Lyra, Serra Angels, Archangels, Swords) and
the praetor's were nearly unbeatable and start with less than a player. Teferi's counter-heavy deck starts with a great
deal more.

**Decks, in the generator** (`sample-decks.py`; no deck was edited by hand):

- **Cards that can never do anything in their deck.** `dead_cards` finds a card that needs something of its own deck
  that nothing else in the deck is: an artifact to enchant, sacrifice or untap, Walls of its own, or snow mana. Both
  builders leave such a card out and build again, and the script refuses to write a deck that still holds one. It took
  Yawgmoth Demon out of nine decks with no artifacts (with none to sacrifice it taps itself and deals 2 to its own side
  every upkeep), Living Artifact out of `mage-llanowar-3`, and Fortified Area out of `benalish-hero`, which had no
  Walls.
- **Cards that help no one, or hurt their own side**, now in the generator's exclusions: the one-color wards (White,
  Blue, Red and Green Ward, beside Black Ward already there); Blood Moon, which touches only nonbasic lands that hardly
  any deck plays (`mage-keld-4` no longer features it); and an upkeep toll on its own side ("damage to you unless you
  sacrifice": Minion of Leshrac, Lord of the Pit).
- **Liliana** has creatures enough to close a game: 17 creatures and 6 other spells (was 12 and 11), featuring Sengir
  Vampire and Hypnotic Specter. Her first deck lost long games at any stats (81% at 44/9/10, no better at 60/11/11). The
  new one is fitted at 40/9/10.
- **Tier 3's mages and warden** play 15 creatures and 8 other spells (the mage's shape is 9 and 14). Three of the mages
  (Benalia's, the Caligo's and Llanowar's) lean to no creature type, so their creatures are their colors' best bodies
  rather than their kin's 1/1s. That alone took them from 73% to 52% at the same stats.
- **The starters** each swap a few cards for commons and uncommons of their own pool (`STARTER_SWAPS`):
  - white: Benalish Hero, Yotian Medic, Ardent Militia and Mana Tithe for Blade of the Sixth Pride, Pegasus Charger,
    Melesse Spirit and Pacifism;
  - blue: Aven Envoy, Force Spike and Force Void for Coral Merfolk, Air Elemental and Prodigal Sorcerer;
  - red: Chain Lightning and Giant Cindermaw for Shock and Hill Giant;
  - green: Rime Dryad and Foxfire for Llanowar Elves and Bite Down.

  Every starter is now within 7 points of the average at T1 and at T2.

## What is still short

- **The praetor at 32% (24-40%)** is a little under 35%, with the target inside its interval; the capstone is left as
  the hardest boss.
- **Rofellos and Teferi at 42%** are inside the boss target but only 4 points under tier 4's 46%.
- **An enemy color's run** is much harder than the boss target (25% over all five), by design. Teferi's and Lyra's
  enemy runs are the hardest (17% and 21%).

## Odd things the bot did

- Spell-heavy and control decks (the mages', Teferi's, Liliana's first) play far below their cards: the bot wins with
  creatures and burn and makes little of counterspells and planeswalkers. More creatures did what more stats could not.
- Against the bosses, green fares worst and blue best among the upgraded decks: Teferi beats upgraded green 23 games in
  24 with its gains and without them alike.
