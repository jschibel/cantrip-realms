"""Cantrip Realms' first decks (realms/docs/design.md, A1 and A6): the five starter decks, and the sample mobs' decks.

    python tools/realms/sample-decks.py

Writes:
    realms/content/dominaria/starters/<color>.txt    the 40-card deck a new character of that color starts with
    decks/realms/dominaria/<mob>.txt                  each sample mob's 40-card deck

Every card is from the plane's pool (realms/content/pools/dominaria.json) and of exactly the deck's color identity
(content/mtg/legality.json); starters take only commons and uncommons, as design.md A1 says. A deck is 23 spells and
17 basic lands: creatures picked along a mana curve and the rest from the spells that answer or draw, each the
best-scoring card of its slot by a plain reading of its cost, body and text, ties to the name. The same inputs give the
same decks. They are a start: mobs' decks are tuned by hand later (tech.md B7).
"""

import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASICS = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}
NAMES = {"W": "white", "U": "blue", "B": "black", "R": "red", "G": "green"}

# Creatures by mana value, and how many copies of each: 16 creatures and 7 other spells, with 17 lands.
CREATURE_CURVE = {1: 1, 2: 3, 3: 2, 4: 1, 5: 1}
SPELLS = 4
CREATURES = sum(CREATURE_CURVE.values())

# The sample mobs (tech.md M5): an id, its color, the creature types its deck leans to, and the rarities it is built from.
MOBS = [
    ("phyrexian-scout", "B", ["Phyrexian", "Horror", "Zombie"], ["common"]),
    ("benalish-deserter", "W", ["Soldier", "Human"], ["common"]),
    ("kjeldoran-raider", "W", ["Knight", "Soldier"], ["common", "uncommon"]),
    ("urborg-ghoul", "B", ["Zombie", "Skeleton", "Spirit"], ["common", "uncommon"]),
    ("llanowar-elves-pack", "G", ["Elf"], ["common"]),
    ("shivan-raider", "R", ["Goblin", "Viashino", "Dragon"], ["common", "uncommon"]),
    ("tolarian-apprentice", "U", ["Wizard", "Bird", "Drake"], ["common"]),
]


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


def creature_score(card, mv, leaning):
    subtypes = card["type"].split("—")[-1].split() if "—" in card["type"] else []
    keywords = len(card.get("keywords", []))
    lean = 2 if any(t in subtypes for t in leaning) else 0
    return number(card.get("power")) + number(card.get("toughness")) - 1.5 * mv + keywords + lean


def spell_score(card, mv):
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
    return score - 0.5 * mv


def build(color, rarities, leaning, pool, prices, legality, cards):
    candidates = []
    for name in pool:
        card = cards.get(name)
        info = legality.get(name)
        if card is None or info is None or info.get("identity") != color:
            continue
        if prices[name]["rarity"] not in rarities or "Land" in card["type"] or card.get("halves"):
            continue
        if not card.get("manaCost"):
            continue
        candidates.append((name, card, mana_value(card["manaCost"])))

    chosen = []
    for mv, count in CREATURE_CURVE.items():
        slot = [(-creature_score(c, v, leaning), n) for n, c, v in candidates if v == mv and "Creature" in c["type"]]
        picked = [n for _, n in sorted(slot) if n not in chosen][:count]
        if len(picked) < count:
            # A thin slot borrows from the next mana value up.
            extra = [(-creature_score(c, v, leaning), n) for n, c, v in candidates if v == mv + 1 and "Creature" in c["type"]]
            picked += [n for _, n in sorted(extra) if n not in chosen and n not in picked][: count - len(picked)]
        chosen += picked
    creatures = [(-creature_score(c, v, leaning), n) for n, c, v in candidates if "Creature" in c["type"] and v <= 6]
    # A color thin at some mana value fills its creatures from the best of the rest.
    chosen += [n for _, n in sorted(creatures) if n not in chosen][: max(0, CREATURES - len(chosen))]
    spells = [(-spell_score(c, v), n) for n, c, v in candidates if "Creature" not in c["type"] and v <= 4]
    chosen += [n for _, n in sorted(spells)][:SPELLS]
    chosen += [n for _, n in sorted(creatures) if n not in chosen][: max(0, CREATURES + SPELLS - len(chosen))]

    # Two copies of each, the last card one, to 23 spells; a short list takes a third copy of its first cards.
    copies = {n: 0 for n in chosen}
    left = 23
    for most in (2, 3, 4):
        for n in chosen:
            take = min(most - copies[n], left)
            copies[n] += take
            left -= take
    if left:
        sys.exit(f"sample-decks: {color} {rarities} has too few cards for 23 spells")
    deck = [(copies[n], n) for n in chosen if copies[n]]
    deck.append((17, BASICS[color]))
    return deck


def write(path, header, deck):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(header)
        for count, name in deck:
            f.write(f"{count} {name}\n")


def main():
    pool = load(os.path.join(ROOT, "realms", "content", "pools", "dominaria.json"))["cards"]
    prices = load(os.path.join(ROOT, "realms", "content", "prices.json"))["cards"]
    legality = load(os.path.join(ROOT, "content", "mtg", "legality.json"))["cards"]
    cards = cards_by_name()

    for color, name in NAMES.items():
        deck = build(color, ["common", "uncommon"], [], pool, prices, legality, cards)
        write(os.path.join(ROOT, "realms", "content", "dominaria", "starters", f"{name}.txt"),
              f"# The {name} starter deck (realms/docs/design.md, A1): written by tools/realms/sample-decks.py.\n\n", deck)
    for mob, color, leaning, rarities in MOBS:
        deck = build(color, rarities, leaning, pool, prices, legality, cards)
        write(os.path.join(ROOT, "decks", "realms", "dominaria", f"{mob}.txt"),
              f"# {mob}: a sample mob's deck, written by tools/realms/sample-decks.py; tune it by hand.\n\n", deck)


if __name__ == "__main__":
    main()
