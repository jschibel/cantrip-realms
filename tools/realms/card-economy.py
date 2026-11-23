"""Cantrip Realms' card database (realms/docs/design.md, A5): one record per card the engine has - where it comes from,
where it has been printed, what it is worth and whether the realm may deal in it - from Scryfall's default-cards file.

    python tools/realms/card-economy.py              # from the newest Scryfall default-cards file, downloading today's
                                                     # if there is none from today

Writes realms/content/cards.json, {"source", "surcharge", "cards": [record, ...]} in name order, a record a line:

    name             the card's name, as the engine's content file gives it (a split or two-faced card's front face's)
    origin           the plane of its first paper printing, by set release date; "multiverse" when that printing places
                     it on no plane; null for a card never printed on paper
    planes           every plane it has been printed on, in planes.json's order: a printing places a card on its set's
                     plane (planes.json), except in a set of a reprint type (core sets, Masters, Commander, Secret Lair,
                     promos, ...), where only a card's own first printing does, and only when planes.json places that set
                     (Alpha and Beta, Dominaria's Commander decks); sets of many planes place none
    sets             its paper set codes, oldest first
    usd              the median TCGplayer market price over its paper printings (prices.usd, else usd_foil, else
                     usd_etched; the lower middle of an even number, so always a real printing's); null for none
    rarity           the rarity of the printing at that median
    gold             the list price: round(100 x (usd + the rarity's surcharge)), +$0.50 common, +$1 uncommon, +$5 rare,
                     +$10 mythic; null with no price
    vintage          "legal", "restricted", "banned" or "not_legal", Scryfall's legalities (the newest printing's)
    identity         its color identity, WUBRG letters
    types, subtypes  its front face's card types and subtypes, from its type line, for vendor specialties
    universesBeyond  printed only in Universes Beyond (planes.json's universesBeyondSets, or the triangle security stamp)
    relic            a relic (realms/content/relics.json, design.md A3a)

Universes Beyond printings are left out of every price and plane. The rarities Scryfall gives beyond the four are priced
as theirs ("special" a rare, "bonus" a mythic).

The pools are views of this file, computed the same way by the realm server as it loads and by the tools
(tools/realms/realm_cards.py): a walked plane's pool is every card legal or restricted in Vintage, priced, not Universes
Beyond and no relic, printed on that plane; the off-plane pool is every such card printed on no walked plane.

The script refuses (and writes nothing) while an expansion or draft-innovation set Scryfall lists is neither a plane's nor
in planes.json's ignoredSets or universesBeyondSets, so a new set can't slip in unplaced.
"""

import datetime
import gzip
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "maintenance"))
import scryfall  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONTENT = os.path.join(ROOT, "realms", "content")
SURCHARGE = {"common": 0.50, "uncommon": 1.00, "rare": 5.00, "mythic": 10.00}
RARITY = {"common": "common", "uncommon": "uncommon", "rare": "rare", "mythic": "mythic", "special": "rare", "bonus": "mythic"}
# Printings that are no cards a player plays: tokens, art and the like, digital-only sets.
SKIPPED_SET_TYPES = {"token", "memorabilia", "minigame", "alchemy", "treasure_chest"}
# Sets that bring new cards, which planes.json must place, ignore or know as Universes Beyond.
NEW_CARD_SET_TYPES = {"expansion", "draft_innovation"}
CARD_TYPES = {"Artifact", "Battle", "Creature", "Enchantment", "Instant", "Kindred", "Land", "Planeswalker", "Sorcery", "Tribal"}


def engine_names():
    """Every card the engine has, by the name its content file gives (the front face's)."""
    names = set()
    folder = os.path.join(ROOT, "content", "mtg", "cards")
    for entry in os.listdir(folder):
        if entry.endswith(".json"):
            text = open(os.path.join(folder, entry), encoding="utf-8").read()
            match = re.search(r'"name"\s*:\s*("(?:[^"\\]|\\.)*")', text)
            if match:
                names.add(json.loads(match.group(1)))
    return names


def default_cards():
    """Today's default-cards bulk file, downloaded into the shared Scryfall cache if it isn't there yet."""
    path = scryfall._download("default-cards")
    if path is None:
        raise SystemExit("card-economy: no default-cards file, and Scryfall could not be reached")
    with gzip.open(path) as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def price(printing):
    prices = printing.get("prices") or {}
    for kind in ("usd", "usd_foil", "usd_etched"):
        if prices.get(kind):
            return float(prices[kind])
    return None


def type_line(printing):
    """A printing's front face's types and subtypes."""
    line = printing.get("type_line") or ""
    if printing.get("card_faces") and printing["card_faces"][0].get("type_line"):
        line = printing["card_faces"][0]["type_line"]
    line = line.split(" // ")[0]
    left, _, right = line.partition("—")
    return [word for word in left.split() if word in CARD_TYPES], right.split()


def main():
    planes = json.load(open(os.path.join(CONTENT, "planes.json"), encoding="utf-8"))
    order = list(planes["planes"])
    plane_of_set = {code: plane for plane, spec in planes["planes"].items() for code in spec["sets"]}
    beyond = set(planes["universesBeyondSets"])
    reprint_types = set(planes["reprintSetTypes"])
    ignored = set(planes["ignoredSets"])
    have = engine_names()
    relics = {entry["card"] for entry in json.load(open(os.path.join(CONTENT, "relics.json"), encoding="utf-8"))["relics"]}

    printings = {}
    sets = {}
    for card in default_cards():
        sets.setdefault(card["set"], (card.get("set_type"), card.get("set_name")))
        if "paper" not in card.get("games", []) or card.get("set_type") in SKIPPED_SET_TYPES or card.get("oversized"):
            continue
        name = card["name"]
        front = name.split(" // ")[0]
        key = name if name in have else front if front in have else None
        if key is not None:
            printings.setdefault(key, []).append(card)

    unplaced = sorted(f"{code} ({name}, {kind})" for code, (kind, name) in sets.items()
                      if kind in NEW_CARD_SET_TYPES and code not in plane_of_set and code not in ignored and code not in beyond)
    if unplaced:
        sys.exit("card-economy: planes.json places none of these sets, nor ignores them: " + "; ".join(unplaced))

    def universes_beyond(printing):
        return printing["set"] in beyond or printing.get("security_stamp") == "triangle"

    def plane_of(printing):
        """The plane a printing places its card on: its set's, unless the set is of a reprint type and this is a reprint."""
        if printing.get("set_type") in reprint_types and printing.get("reprint", False):
            return None
        return plane_of_set.get(printing["set"])

    records = []
    for name in sorted(have):
        mine = sorted(printings.get(name, []), key=lambda p: (p.get("released_at", ""), p["set"]))
        ours = [p for p in mine if not universes_beyond(p)]
        priced = sorted(((price(p), p) for p in ours if price(p) is not None), key=lambda pair: pair[0])
        usd, middle = priced[(len(priced) - 1) // 2] if priced else (None, None)
        rarity = RARITY.get(middle.get("rarity"), "rare") if middle else None
        on = {plane_of(p) for p in ours} - {None}
        newest = mine[-1] if mine else {}
        types, subtypes = type_line(newest) if newest else ([], [])
        first = mine[0] if mine else None
        records.append({
            "name": name,
            "origin": None if first is None else "multiverse" if universes_beyond(first) else plane_of(first) or "multiverse",
            "planes": [plane for plane in order if plane in on],
            "sets": list(dict.fromkeys(p["set"] for p in mine)),
            "usd": usd,
            "rarity": rarity,
            "gold": round((usd + SURCHARGE[rarity]) * 100) if priced else None,
            "vintage": (newest.get("legalities") or {}).get("vintage", "not_legal"),
            "identity": "".join(c for c in "WUBRG" if c in (newest.get("color_identity") or [])),
            "types": types,
            "subtypes": subtypes,
            "universesBeyond": bool(mine) and not ours,
            "relic": name in relics,
        })

    stamp = datetime.date.today().isoformat()
    with open(os.path.join(CONTENT, "cards.json"), "w", encoding="utf-8", newline="\n") as f:
        f.write("{\n")
        f.write(f'"source": {json.dumps(f"Scryfall default-cards {stamp}: TCGplayer market prices, the median paper printing; legalities and identities Scryfall")},\n')
        f.write(f'"surcharge": {json.dumps(SURCHARGE)},\n')
        f.write('"cards": [\n')
        f.write(",\n".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) for record in records))
        f.write("\n]\n}\n")

    sys.path.insert(0, os.path.dirname(__file__))
    import realm_cards  # noqa: E402

    cards = realm_cards.load()
    print(f"card-economy: {len(records)} cards, {sum(1 for r in records if r['gold'] is not None)} priced")
    for plane in sorted(realm_cards.walked()):
        print(f"  {plane}: {len(realm_cards.pool(cards, plane))} cards in its pool")
    off = realm_cards.off_plane(cards)
    print(f"  off-plane: {len(off)} cards, {sum(1 for tags in off.values() if tags)} of them a plane's")


if __name__ == "__main__":
    main()
