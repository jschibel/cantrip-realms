"""Cantrip Realms' card economy (realms/docs/design.md, A5): every card the engine has, priced, and each plane's pool of
the cards loot and vendors draw from.

    python tools/realms/card-economy.py              # from the newest Scryfall default-cards file, downloading today's
                                                     # if there is none from today

Writes:
    realms/content/prices.json        {"source", "surcharge", "cards": {name: {"gold", "usd", "rarity", "planes"}}}
    realms/content/pools/<plane>.json {"plane", "cards": [name, ...]}

A card's list price is the median TCGplayer market price of its paper printings (Scryfall's prices.usd, else usd_foil,
else usd_etched), plus a surcharge by the rarity of the printing at that median: +$0.50 common, +$1 uncommon, +$5 rare,
+$10 mythic. Prices are gold, a hundred to the dollar. The median of an even number of printings is the lower middle one,
so it is always a real printing's price and rarity. Universes Beyond printings (realms/content/planes.json's sets, and
any printing with the triangle security stamp) are left out of everything: a card printed only there is in no pool.

A plane's pool is every card the engine has that is legal or restricted in Vintage (which leaves out ante, Conspiracy
and Un- cards), has a price, and was printed in one of the plane's sets.
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
# Rarities Scryfall gives beyond the four: Time Spiral's "special" timeshifted cards and the like are priced as rares,
# the Mystical Archive's "bonus" cards as mythics.
RARITY = {"common": "common", "uncommon": "uncommon", "rare": "rare", "mythic": "mythic", "special": "rare", "bonus": "mythic"}
SKIPPED_SET_TYPES = {"token", "memorabilia", "minigame", "alchemy", "treasure_chest"}


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


def main():
    planes = json.load(open(os.path.join(CONTENT, "planes.json"), encoding="utf-8"))
    beyond = set(planes["universes_beyond_sets"])
    plane_of_set = {code: plane for plane, spec in planes["planes"].items() for code in spec["sets"]}
    legality = json.load(open(os.path.join(ROOT, "content", "mtg", "legality.json"), encoding="utf-8"))["cards"]
    have = engine_names()

    printings = {}
    for card in default_cards():
        if "paper" not in card.get("games", []) or card.get("set_type") in SKIPPED_SET_TYPES or card.get("oversized"):
            continue
        if card["set"] in beyond or card.get("security_stamp") == "triangle":
            continue
        name = card["name"]
        front = name.split(" // ")[0]
        key = name if name in have else front if front in have else None
        if key is None:
            continue
        printings.setdefault(key, []).append(card)

    cards = {}
    pools = {plane: [] for plane in planes["planes"]}
    for name in sorted(printings):
        priced = sorted(((price(p), p) for p in printings[name] if price(p) is not None), key=lambda pair: pair[0])
        if not priced:
            continue
        usd, middle = priced[(len(priced) - 1) // 2]
        rarity = RARITY.get(middle.get("rarity"), "rare")
        on = sorted({plane_of_set[p["set"]] for p in printings[name] if p["set"] in plane_of_set})
        cards[name] = {"gold": round((usd + SURCHARGE[rarity]) * 100), "usd": usd, "rarity": rarity, "planes": on}
        vintage = legality.get(name, {}).get("legalities", {}).get("vintage")
        if vintage in ("legal", "restricted"):
            for plane in on:
                pools[plane].append(name)

    stamp = datetime.date.today().isoformat()
    json.dump(
        {
            "source": f"Scryfall default-cards {stamp}: TCGplayer market prices, the median paper printing's",
            "surcharge": SURCHARGE,
            "cards": cards,
        },
        open(os.path.join(CONTENT, "prices.json"), "w", encoding="utf-8", newline="\n"),
        indent=0,
        sort_keys=True,
        ensure_ascii=False,
    )
    os.makedirs(os.path.join(CONTENT, "pools"), exist_ok=True)
    for plane, names in pools.items():
        json.dump(
            {"plane": plane, "cards": names},
            open(os.path.join(CONTENT, "pools", f"{plane}.json"), "w", encoding="utf-8", newline="\n"),
            indent=0,
            ensure_ascii=False,
        )
    unpriced = len(have) - len(cards)
    print(f"card-economy: {len(cards)} cards priced, {unpriced} the engine has without a paper price")
    for plane, names in pools.items():
        print(f"  {plane}: {len(names)} cards in its pool")


if __name__ == "__main__":
    main()
