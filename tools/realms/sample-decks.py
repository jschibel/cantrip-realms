"""Cantrip Realms' decks and mobs (realms/docs/design.md, A1, A3 and A6): the five starter decks, and every mob the
maps name, with its deck.

    python tools/realms/sample-decks.py

Writes:
    realms/content/dominaria/starters/<color>.txt    the 40-card deck a new character of that color starts with
    decks/realms/dominaria/<mob>.txt                  each mob's 40-card deck
    realms/content/dominaria/mobs/<mob>.json          each mob (realms/docs/interfaces.md, "Mobs")

Every card is from the plane's pool (realms/content/pools/dominaria.json), legal (not restricted) in Vintage, and
within the deck's color identity (content/mtg/legality.json); starters take only commons and uncommons of exactly
their color, as design.md A1 says. A deck is 23 spells and 17 basic lands: creatures picked along a mana curve and the
rest from the spells that answer or draw, each the best-scoring card of its slot by a plain reading of its cost, body
and text, ties to the name. A mob leans to its creature types and its featured cards, and the higher its tier the
rarer its cards and the more copies of its best ones: wilderness mobs are tiers 1-2, dungeon mobs 3-4, a floor's
warden a tier 4 mini-boss, and the five bosses strong decks round their namesake card where the pool has it.

A mob's file follows its tier (design.md A3): its prize (T1 100 gold, T2 300, T3 800, T4 2,000, a boss 6,000), its gold
range, its loot - its colors' cards of the rarities whose prices fit under its prize - its stats and stats-only gear,
and its model, one of the mob meshes of realms/content/models. The same inputs give the same files. They are a start:
mobs' decks are tuned by hand later (tech.md B7); a mob listed in HAND_TUNED is left alone.
"""

import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
PLANE = "dominaria"
BASICS = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}
NAMES = {"W": "white", "U": "blue", "B": "black", "R": "red", "G": "green"}
WUBRG = "WUBRG"

# Creatures by mana value, and how many cards of each: 16 creatures and 7 other spells, with 17 lands.
CREATURE_CURVE = {1: 1, 2: 3, 3: 2, 4: 1, 5: 1}
SPELLS = 4
CREATURES = sum(CREATURE_CURVE.values())
SPELL_CARDS = 23

# What each tier is worth and pays (design.md A3); a boss is "boss" here, tier 0 in a duel.
PRIZE = {1: 100, 2: 300, 3: 800, 4: 2000, "boss": 6000}
GOLD = {1: [20, 60], 2: [50, 150], 3: [120, 300], 4: [250, 600], "boss": [1500, 1500]}
# The rarities a mob's deck is built from, and those its loot offers: the ones whose list prices can fit its prize.
DECK_RARITIES = {
    1: ["common"],
    2: ["common", "uncommon"],
    3: ["common", "uncommon", "rare"],
    4: ["common", "uncommon", "rare", "mythic"],
    "boss": ["common", "uncommon", "rare", "mythic"],
}
LOOT_RARITIES = {1: ["common"], 2: ["common", "uncommon"], 3: ["common", "uncommon", "rare"], 4: ["uncommon", "rare", "mythic"], "boss": ["rare", "mythic"]}
# The setup values a mob starts from before its gear's (design.md A1's base, a little more the deeper it lives).
STATS = {1: (20, 7, 7), 2: (20, 7, 7), 3: (22, 7, 7), 4: (24, 7, 7), "warden": (26, 7, 7), "boss": (30, 7, 7)}
# How many copies the best cards of a deck get: a tougher mob plays more of fewer, better cards.
MOST_COPIES = {1: 2, 2: 2, 3: 3, 4: 4, "boss": 4}

# Every mob the maps name (realms/web/scripts/maps.ts): its id and name, its tier (1-4, "warden" for a floor's
# mini-boss, "boss"), its colors, the creature types its deck leans to, its featured cards (as many copies as its best
# cards get), whether its deck takes colorless artifacts, the stats-only gear it wears, its model (mesh, palette, size),
# and for a boss the color it unlocks.
MOBS = [
    # Benalia (W): Phyrexian stragglers and deserters in the meadows, Serra's angels in her fallen sanctum.
    dict(id="phyrexian-scout", name="Phyrexian Scout", tier=1, colors="B", lean=["Phyrexian", "Horror", "Zombie"], model=("phyrexian", ["#8c909c", "#7a1f24"], 1.0)),
    dict(id="benalish-deserter", name="Benalish Deserter", tier=1, colors="W", lean=["Soldier", "Human"], model=("humanoid", ["#d8d6d0", "#8f6340"], 1.0)),
    dict(id="kjeldoran-raider", name="Kjeldoran Raider", tier=2, colors="W", lean=["Knight", "Soldier"], gear=["padded-jerkin"], model=("humanoid", ["#c9ced8", "#3a5f8f"], 1.05)),
    dict(id="serra-zealot", name="Serra Zealot", tier=2, colors="W", lean=["Cleric", "Monk", "Angel", "Bird"], gear=["novice-robe"], model=("humanoid", ["#f2efe6", "#f1b44c"], 1.0)),
    dict(id="sanctum-guardian", name="Sanctum Guardian", tier=3, colors="W", lean=["Angel", "Spirit", "Wall"], gear=["padded-jerkin", "copper-amulet"], model=("angel", ["#e8e4d8", "#b3b5bc", "#93c8dc"], 1.1)),
    dict(id="fallen-seraph", name="Fallen Seraph", tier=4, colors="WB", lean=["Angel", "Demon", "Spirit"], gear=["chain-hauberk", "silver-pendant"], model=("angel", ["#4b2f5e", "#8c909c", "#7a1f24"], 1.2)),
    dict(id="sanctum-warden", name="Sanctum Warden", tier="warden", colors="W", lean=["Angel", "Knight"], gear=["benalish-plate", "silver-pendant"], model=("angel", ["#f1b44c", "#f2efe6", "#93c8dc"], 1.35)),
    dict(id="lyra-dawnbringer", name="Lyra Dawnbringer", tier="boss", colors="W", unlocks="W", lean=["Angel"], featured=["Lyra Dawnbringer", "Serra Angel"], gear=["benalish-plate", "argivian-crown"], model=("angel", ["#f2efe6", "#f1b44c", "#93c8dc"], 1.6)),
    # Tolaria (U): apprentices and merfolk on the shore, automatons and drifters in the rifts, Teferi at their heart.
    dict(id="tolarian-apprentice", name="Tolarian Apprentice", tier=1, colors="U", lean=["Wizard", "Bird", "Drake"], model=("humanoid", ["#5b8fd6", "#f4ecc2"], 0.95)),
    dict(id="coral-merfolk", name="Coral Merfolk", tier=1, colors="U", lean=["Merfolk", "Fish", "Crab"], featured=["Coral Merfolk"], model=("humanoid", ["#3d8fa8", "#c8432c"], 0.95)),
    dict(id="academy-automaton", name="Academy Automaton", tier=2, colors="U", artifacts=True, lean=["Construct", "Golem", "Thopter"], gear=["travelers-boots"], model=("construct", ["#8c909c", "#5b8fd6", "#62a4c2"], 1.1)),
    dict(id="time-drifter", name="Time Drifter", tier=2, colors="U", lean=["Spirit", "Illusion", "Wizard"], gear=["leather-cap"], model=("spirit", ["#93c8dc", "#5b8fd6", "#f4ecc2"], 1.0)),
    dict(id="rift-elemental", name="Rift Elemental", tier=3, colors="U", lean=["Elemental", "Djinn", "Leviathan"], gear=["novice-robe", "scholars-circlet"], model=("spirit", ["#5b8fd6", "#a97fd0", "#f4ecc2"], 1.25)),
    dict(id="temporal-sentinel", name="Temporal Sentinel", tier=4, colors="U", artifacts=True, lean=["Construct", "Golem", "Wizard"], gear=["tolarian-robe", "silver-pendant"], model=("construct", ["#62a4c2", "#f1b44c", "#2a2b36"], 1.3)),
    dict(id="rift-warden", name="Rift Warden", tier="warden", colors="U", lean=["Wizard", "Drake", "Sphinx"], gear=["tolarian-robe", "tolarian-circlet"], model=("humanoid", ["#2f5fa8", "#a97fd0"], 1.3)),
    dict(id="teferi", name="Teferi", tier="boss", colors="WU", unlocks="U", lean=["Wizard", "Drake", "Bird"], prefer="U", featured=["Teferi, Hero of Dominaria"], gear=["serran-vestments", "argivian-crown"], model=("humanoid", ["#5b8fd6", "#f1b44c"], 1.4)),
    # Urborg (B): ghouls and initiates in the bog, the Cabal's cultists and Phyrexian horrors in Yawgmoth's tomb.
    dict(id="urborg-ghoul", name="Urborg Ghoul", tier=1, colors="B", lean=["Zombie", "Skeleton", "Spirit"], model=("ghoul", ["#8c909c", "#4b2f5e", "#5d6646"], 1.0)),
    dict(id="cabal-initiate", name="Cabal Initiate", tier=1, colors="B", lean=["Human", "Cleric", "Minion"], model=("humanoid", ["#2a2b36", "#7a1f24"], 1.0)),
    dict(id="bog-wraith", name="Bog Wraith", tier=2, colors="B", lean=["Wraith", "Spirit", "Shade", "Specter"], featured=["Bog Wraith"], gear=["marsh-waders"], model=("spirit", ["#4b2f5e", "#5d6646", "#2a2b36"], 1.05)),
    dict(id="phyrexian-plaguelord", name="Phyrexian Plaguelord", tier=2, colors="B", lean=["Phyrexian", "Carrier", "Rat"], gear=["padded-jerkin"], model=("phyrexian", ["#5d6646", "#7a1f24", "#2a2b36"], 1.1)),
    dict(id="yawgmoth-cultist", name="Yawgmoth Cultist", tier=3, colors="B", lean=["Cleric", "Minion", "Human"], gear=["novice-robe", "urborg-bone-charm"], model=("humanoid", ["#4b2f5e", "#c8432c"], 1.05)),
    dict(id="phyrexian-horror", name="Phyrexian Horror", tier=4, colors="B", artifacts=True, lean=["Phyrexian", "Horror"], gear=["chain-hauberk", "keldon-greaves"], model=("phyrexian", ["#b3b5bc", "#7a1f24", "#2a2b36"], 1.3)),
    dict(id="tomb-warden", name="Tomb Warden", tier="warden", colors="B", lean=["Zombie", "Phyrexian", "Demon"], gear=["chain-hauberk", "thran-amulet"], model=("ghoul", ["#2a2b36", "#7a1f24", "#8c909c"], 1.35)),
    dict(id="sheoldred", name="Sheoldred", tier="boss", colors="B", unlocks="B", lean=["Phyrexian", "Praetor", "Demon"], featured=["Sheoldred, the Apocalypse"], gear=["benalish-plate", "thran-amulet"], model=("phyrexian", ["#b3b5bc", "#7a1f24", "#0d0f14"], 1.6)),
    # Shiv (R): Ghitu firebrands and goblins on the highlands, Keldons and drakes further out, the foundry's constructs.
    dict(id="ghitu-firebrand", name="Ghitu Firebrand", tier=1, colors="R", lean=["Human", "Wizard", "Shaman"], model=("humanoid", ["#c8432c", "#f1b44c"], 1.0)),
    dict(id="goblin-warband", name="Goblin Warband", tier=1, colors="R", lean=["Goblin"], model=("goblin", ["#6b963e", "#c8432c", "#4a3122"], 0.9)),
    dict(id="keldon-raider", name="Keldon Raider", tier=2, colors="R", lean=["Human", "Warrior", "Barbarian"], gear=["travelers-boots"], model=("humanoid", ["#8f2f2f", "#4a3122"], 1.15)),
    dict(id="shivan-drake", name="Shivan Drake", tier=2, colors="R", lean=["Dragon", "Drake", "Viashino"], gear=["leather-cap"], model=("drake", ["#c8432c", "#f1b44c", "#2e1f17"], 1.2)),
    dict(id="foundry-construct", name="Foundry Construct", tier=3, colors="R", artifacts=True, lean=["Construct", "Golem", "Goblin"], gear=["padded-jerkin", "keldon-greaves"], model=("construct", ["#8c909c", "#c8432c", "#f1b44c"], 1.25)),
    dict(id="flame-elemental", name="Flame Elemental", tier=4, colors="R", lean=["Elemental", "Dragon"], gear=["chain-hauberk", "silver-pendant"], model=("spirit", ["#c8432c", "#f1b44c", "#f4ecc2"], 1.3)),
    dict(id="foundry-warden", name="Foundry Warden", tier="warden", colors="R", artifacts=True, lean=["Construct", "Dragon", "Warrior"], gear=["benalish-plate", "silver-pendant"], model=("construct", ["#2a2b36", "#c8432c", "#f1b44c"], 1.4)),
    dict(id="darigaaz", name="Darigaaz", tier="boss", colors="R", unlocks="R", lean=["Dragon", "Giant"], featured=["Rorix Bladewing", "Volcanic Dragon", "Phyrexian Dragon Engine"], gear=["benalish-plate", "argivian-crown"], model=("drake", ["#c8432c", "#2e1f17", "#f1b44c"], 1.7)),
    # Llanowar (G): elves on the trails, wurms and Multani's guard in the forest, beasts and ancients in Yavimaya's heart.
    dict(id="llanowar-elves-pack", name="Llanowar Elves", tier=1, colors="G", lean=["Elf"], model=("elf", ["#3e9a4a", "#8f6340", "#c08a62"], 0.95)),
    dict(id="elvish-scout", name="Elvish Scout", tier=1, colors="G", lean=["Elf", "Scout", "Druid"], model=("elf", ["#2a4524", "#d6ae7e", "#c08a62"], 0.95)),
    dict(id="yavimaya-wurm", name="Yavimaya Wurm", tier=2, colors="G", lean=["Wurm", "Beast"], featured=["Yavimaya Wurm"], gear=["marsh-waders"], model=("wurm", ["#4f7a34", "#d6ae7e", "#2a4524"], 1.2)),
    dict(id="multani-guard", name="Multani's Guard", tier=2, colors="G", lean=["Treefolk", "Elemental", "Dryad"], gear=["padded-jerkin"], model=("spirit", ["#3e9a4a", "#8f6340", "#d6ae7e"], 1.15)),
    dict(id="krosan-beast", name="Krosan Beast", tier=3, colors="G", lean=["Beast", "Squirrel"], gear=["elvish-striders", "copper-ring"], model=("wurm", ["#8f6340", "#3e9a4a", "#2a4524"], 1.25)),
    dict(id="yavimaya-ancient", name="Yavimaya Ancient", tier=4, colors="G", lean=["Treefolk", "Elemental", "Wurm"], gear=["chain-hauberk", "elvish-striders"], model=("spirit", ["#2a4524", "#8f6340", "#3e9a4a"], 1.4)),
    dict(id="heart-warden", name="Heart Warden", tier="warden", colors="G", lean=["Elemental", "Wurm", "Beast"], gear=["benalish-plate", "silver-pendant"], model=("wurm", ["#2a4524", "#f1b44c", "#3e9a4a"], 1.45)),
    dict(id="multani", name="Multani", tier="boss", colors="G", unlocks="G", lean=["Elemental", "Wurm", "Treefolk", "Avatar"], featured=["Enormous Baloth", "Arrogant Wurm"], gear=["benalish-plate", "argivian-crown"], model=("spirit", ["#3e9a4a", "#8f6340", "#f1b44c"], 1.8)),
]

# Mobs whose files and decks were tuned by hand: not overwritten.
HAND_TUNED = set()

RARITY_BONUS = {"common": 0, "uncommon": 0.5, "rare": 1.5, "mythic": 2.5}

# Cards no mob plays, whatever they score: a combo piece that exiles its own side's permanents, a creature that dies as
# it enters, a win by an empty library.
EXCLUDED = {"Worldgorger Dragon", "Force of Savagery", "Laboratory Maniac"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def cards_by_name():
    folder = os.path.join(ROOT, "content", "mtg", "cards")
    found = {}
    for entry in sorted(os.listdir(folder)):
        if entry.endswith(".json"):
            card = load(os.path.join(folder, entry))
            found.setdefault(card["name"], card)
    return found


def mana_value(cost):
    total = 0
    for symbol in re.findall(r"\{([^}]*)\}", cost or ""):
        if symbol.isdigit():
            total += int(symbol)
        elif symbol not in ("X", "Y", "Z"):
            total += 1
    return total


def number(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def subtypes_of(card):
    return card["type"].split("—")[-1].split() if "—" in card["type"] else []


def creature_score(card, mv, leaning, rarity=None, lean_bonus=2):
    keywords = card.get("keywords", [])
    lean = lean_bonus if any(t in subtypes_of(card) for t in leaning) else 0
    # A wall holds the ground but never wins: a mob leaning to other creature types wants few.
    wall = -4 if leaning and "Defender" in keywords and "Wall" not in leaning else 0
    return number(card.get("power")) + number(card.get("toughness")) - 1.5 * mv + len(keywords) + lean + wall + RARITY_BONUS.get(rarity, 0)


def spell_score(card, mv, rarity=None):
    text = card.get("oracleText", "").lower()
    score = 0.0
    if re.search(r"destroy target (creature|nonblack creature|tapped creature|attacking creature)", text):
        score += 5
    if re.search(r"deals \d+ damage to (any target|target creature)", text):
        score += 4
    if "counter target spell" in text:
        score += 3
    if "draw" in text and "card" in text:
        score += 2
    if re.search(r"target creature gets \+", text):
        score += 1
    if "x" in (card.get("manaCost") or "").lower():
        score -= 2
    return score - 0.5 * mv + RARITY_BONUS.get(rarity, 0)


def within(identity, colors, artifacts):
    """Whether a card's color identity fits a deck's: inside its colors; colorless only in a deck that takes artifacts."""
    if identity == "":
        return artifacts
    return all(c in colors for c in identity)


def candidates_for(colors, rarities, pool, prices, legality, cards, exact, artifacts):
    found = []
    for name in pool:
        card = cards.get(name)
        info = legality.get(name)
        if card is None or info is None or info.get("legalities", {}).get("vintage") != "legal":
            continue
        identity = info.get("identity")
        if (identity != colors) if exact else not within(identity, colors, artifacts):
            continue
        if prices[name]["rarity"] not in rarities or "Land" in card["type"] or card.get("halves"):
            continue
        if not card.get("manaCost") or name in EXCLUDED:
            continue
        if "Creature" in card["type"] and card.get("toughness") in (0, "0"):
            continue
        found.append((name, card, mana_value(card["manaCost"])))
    return found


def build(colors, rarities, leaning, pool, prices, legality, cards, *, exact=False, artifacts=False, featured=(), most=2, scored=False, prefer=""):
    """A deck: 23 spells along the curve and 17 basic lands of its colors.

    `exact` takes only cards of exactly `colors` (a starter's); otherwise any card within them. `most` is how many
    copies the best cards get: at two, each slot's best cards two apiece (the starters' and the weakest mobs'); at three
    or four, each slot's count of cards in fewer, better cards, the `featured` ones first, leaning harder to the deck's
    creature types. `scored` weighs rarer cards up; `prefer` weighs up cards of those colors (a two-color deck's own).
    """
    candidates = candidates_for(colors, rarities, pool, prices, legality, cards, exact, artifacts)
    rarity = (lambda n: prices[n]["rarity"]) if scored else (lambda n: None)
    lean_bonus = 2 if most <= 2 else 4
    liked = lambda n: 2 if prefer and any(c in prefer for c in legality[n].get("identity", "")) else 0
    creature_rank = lambda mvs: [n for _, n in sorted((-creature_score(c, v, leaning, rarity(n), lean_bonus) - liked(n), n) for n, c, v in candidates if v in mvs and "Creature" in c["type"])]
    spell_rank = [n for _, n in sorted((-spell_score(c, v, rarity(n)) - liked(n), n) for n, c, v in candidates if "Creature" not in c["type"] and v <= 4)]
    creatures = creature_rank(range(0, 7))

    if most <= 2 and not featured:
        chosen = []
        for mv, count in CREATURE_CURVE.items():
            picked = [n for n in creature_rank([mv]) if n not in chosen][:count]
            if len(picked) < count:
                # A thin slot borrows from the next mana value up.
                picked += [n for n in creature_rank([mv + 1]) if n not in chosen and n not in picked][: count - len(picked)]
            chosen += picked
        # A color thin at some mana value fills its creatures from the best of the rest.
        chosen += [n for n in creatures if n not in chosen][: max(0, CREATURES - len(chosen))]
        chosen += spell_rank[:SPELLS]
        chosen += [n for n in creatures if n not in chosen][: max(0, CREATURES + SPELLS - len(chosen))]

        # Two copies of each, the last card one, to 23 spells; a short list takes a third copy of its first cards.
        copies = {n: 0 for n in chosen}
        left = SPELL_CARDS
        for cap in (2, 3, 4):
            for n in chosen:
                take = min(cap - copies[n], left)
                copies[n] += take
                left -= take
        order = chosen
    else:
        # Each slot's cards, `most` copies of its best: the featured cards first, then the curve, then the spells.
        copies = {}
        order = []
        mv_of = {n: v for n, _, v in candidates}

        def put(ranked, wanted):
            for n in ranked:
                if wanted <= 0:
                    break
                take = min(most - copies.get(n, 0), wanted)
                if take > 0:
                    if n not in copies:
                        order.append(n)
                    copies[n] = copies.get(n, 0) + take
                    wanted -= take
            return wanted

        slots = {mv: 2 * count for mv, count in CREATURE_CURVE.items()}
        spells = SPELL_CARDS - sum(slots.values())
        for n in featured:
            if n in mv_of:
                put([n], most)
                is_creature = "Creature" in cards[n]["type"]
                if is_creature and mv_of[n] in slots:
                    slots[mv_of[n]] = max(0, slots[mv_of[n]] - copies[n])
                elif not is_creature:
                    spells = max(0, spells - copies[n])
        budget = lambda wanted: min(wanted, SPELL_CARDS - sum(copies.values()))
        put(spell_rank, budget(spells))
        for mv, wanted in slots.items():
            # A thin slot borrows from the next mana value up.
            put(creature_rank([mv + 1]), put(creature_rank([mv]), budget(wanted)))
        put(creatures + spell_rank, budget(SPELL_CARDS))
    if sum(copies.values()) != SPELL_CARDS:
        sys.exit(f"sample-decks: {colors} {rarities} has too few cards for {SPELL_CARDS} spells")
    deck = [(copies[n], n) for n in order if copies[n]]
    deck += lands(deck, colors, cards)
    return deck


def lands(deck, colors, cards):
    """17 basic lands, split between the deck's colors by the colored mana symbols of its spells."""
    pips = {c: 0 for c in colors}
    for count, name in deck:
        for symbol in re.findall(r"\{([^}]*)\}", cards[name].get("manaCost") or ""):
            for c in symbol.split("/"):
                if c in pips:
                    pips[c] += count
    used = [c for c in WUBRG if c in colors and pips[c] > 0] or [colors[0]]
    total = sum(pips[c] for c in used) or 1
    split = {c: max(1, round(17 * pips[c] / total)) for c in used}
    # Rounding may miss by one or two: the most-used color takes up the difference.
    split[max(used, key=lambda c: (pips[c], -WUBRG.index(c)))] += 17 - sum(split.values())
    return [(split[c], BASICS[c]) for c in used]


def write(path, header, deck):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(header)
        for count, name in deck:
            f.write(f"{count} {name}\n")


def tier_of(mob):
    """The tier a mob is paid and looted as: a warden as tier 4, a boss as "boss"."""
    return {"warden": 4}.get(mob["tier"], mob["tier"])


def loot(mob, pool, prices, legality, cards):
    """A mob's loot filter (interfaces.md, "Mobs"): its colors' cards of the rarities its prize can buy, and of its
    creature types too where the pool has a good handful of those within its prize."""
    tier = tier_of(mob)
    rarities = LOOT_RARITIES[tier]
    prize = PRIZE[tier]

    def fits(name, subtypes):
        info = legality.get(name, {})
        if not within(info.get("identity", "?"), mob["colors"], True):
            return False
        if prices[name]["rarity"] not in rarities or prices[name]["gold"] > prize:
            return False
        return not subtypes or (name in cards and any(t in subtypes for t in subtypes_of(cards[name])))

    subtypes = mob["lean"] if sum(1 for n in pool if fits(n, mob["lean"])) >= 8 else []
    if sum(1 for n in pool if fits(n, subtypes)) < 3:
        sys.exit(f"sample-decks: {mob['id']}'s loot has fewer than three cards within its prize")
    return {"pool": PLANE, "colors": mob["colors"], "types": [], "subtypes": subtypes, "rarities": rarities}


def mob_file(mob, deck_path, pool, prices, legality, cards):
    tier = tier_of(mob)
    life, hand, max_hand = STATS[mob["tier"]]
    mesh, palette, size = mob["model"]
    data = {
        "id": mob["id"],
        "name": mob["name"],
        "tier": 4 if mob["tier"] in ("warden", "boss") else mob["tier"],
        "deck": deck_path,
        "stats": {"life": life, "hand": hand, "maxHand": max_hand},
        "gear": mob.get("gear", []),
        "prize": PRIZE[tier],
        "goldRange": GOLD[tier],
        "loot": loot(mob, pool, prices, legality, cards),
        "model": {"mesh": mesh, "palette": palette, "size": size},
        "boss": mob["tier"] == "boss",
    }
    if mob["tier"] == "boss":
        data["unlocks"] = mob["unlocks"]
    return data


def main():
    pool = load(os.path.join(ROOT, "realms", "content", "pools", f"{PLANE}.json"))["cards"]
    prices = load(os.path.join(ROOT, "realms", "content", "prices.json"))["cards"]
    legality = load(os.path.join(ROOT, "content", "mtg", "legality.json"))["cards"]
    cards = cards_by_name()

    for color, name in NAMES.items():
        deck = build(color, ["common", "uncommon"], [], pool, prices, legality, cards, exact=True)
        write(os.path.join(ROOT, "realms", "content", PLANE, "starters", f"{name}.txt"),
              f"# The {name} starter deck (realms/docs/design.md, A1): written by tools/realms/sample-decks.py.\n\n", deck)

    for mob in MOBS:
        if mob["id"] in HAND_TUNED:
            continue
        tier = tier_of(mob)
        missing = [n for n in mob.get("featured", []) if n not in pool]
        if missing:
            sys.exit(f"sample-decks: {mob['id']} features {', '.join(missing)}, which the {PLANE} pool does not have")
        deck = build(mob["colors"], DECK_RARITIES[tier], mob["lean"], pool, prices, legality, cards,
                     artifacts=mob.get("artifacts", False), featured=mob.get("featured", []), most=MOST_COPIES[tier],
                     scored=tier in (3, 4, "boss"), prefer=mob.get("prefer", ""))
        deck_path = f"decks/realms/{PLANE}/{mob['id']}.txt"
        kind = {"warden": "a dungeon floor's warden", "boss": "a boss"}.get(mob["tier"], f"a tier {mob['tier']} mob")
        write(os.path.join(ROOT, *deck_path.split("/")),
              f"# {mob['name']} ({mob['id']}), {kind}: written by tools/realms/sample-decks.py; tune it by hand.\n\n", deck)
        path = os.path.join(ROOT, "realms", "content", PLANE, "mobs", f"{mob['id']}.json")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(mob_file(mob, deck_path, pool, prices, legality, cards), f, indent=2, ensure_ascii=False)
            f.write("\n")


if __name__ == "__main__":
    main()
