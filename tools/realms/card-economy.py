"""Cantrip Realms' card economy (realms/docs/design.md, A5): every card the engine has, priced, and each plane's pool of
the cards loot and vendors draw from.

    python tools/realms/card-economy.py              # from the newest Scryfall default-cards file, downloading today's
                                                     # if there is none from today

Writes:
    realms/content/prices.json        {"source", "surcharge", "cards": {name: {"gold", "usd", "rarity", "planes",
                                                                               "vintage", "identity"}}}
    realms/content/pools/<plane>.json {"plane", "cards": [name, ...]}, for each plane walked (not a trader's)
    realms/content/off-plane.json     {"comment", "cards": {name: [trader plane, ...]}}

A card's list price is the median TCGplayer market price of its paper printings (Scryfall's prices.usd, else usd_foil,
else usd_etched), plus a surcharge by the rarity of the printing at that median: +$0.50 common, +$1 uncommon, +$5 rare,
+$10 mythic. Prices are gold, a hundred to the dollar. The median of an even number of printings is the lower middle one,
so it is always a real printing's price and rarity. Universes Beyond printings (realms/content/planes.json's sets, and
any printing with the triangle security stamp) are left out of everything: a card printed only there is in no pool.

A card's Vintage legality and color identity are Scryfall's, from the same default-cards file (every printing carries
`legalities` and `color_identity`): `vintage` ("legal", "restricted", "banned" or "not_legal") and `identity` (WUBRG
letters) in prices.json, which the realm server deals by, so the realm never waits on content/mtg/legality.json, an
upstream file that lags the cards the engine has.

A plane's pool is every card the engine has that is legal or restricted in Vintage (which leaves out ante, Conspiracy
and Un- cards), has a price, and was printed in one of the plane's sets - except the relics (realms/content/relics.json,
design.md A3a), which drop only from the bosses their entries name and are in no pool, so that no vendor, loot offer or
starter deck ever holds one. A relic is still priced, for reference.

The off-plane pool (design.md A5, "Wares from other planes") is every card the engine has that is legal or restricted in
Vintage, priced, no relic, and printed in no set of a walked plane (a plane of planes.json without "trader": true), each
tagged with the traders' planes it was printed on (none for a card printed only in core sets and the like, which the
exotic wares shops still sell). Only exotic dealers deal in it; no walked plane's pool shares a card with it.
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
    have = engine_names()
    relics = {entry["card"] for entry in json.load(open(os.path.join(CONTENT, "relics.json"), encoding="utf-8"))["relics"]}

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
    walked = {plane for plane, spec in planes["planes"].items() if not spec.get("trader")}
    pools = {plane: [] for plane in planes["planes"] if plane in walked}
    off_plane = {}
    for name in sorted(printings):
        priced = sorted(((price(p), p) for p in printings[name] if price(p) is not None), key=lambda pair: pair[0])
        if not priced:
            continue
        usd, middle = priced[(len(priced) - 1) // 2]
        rarity = RARITY.get(middle.get("rarity"), "rare")
        on = sorted({plane_of_set[p["set"]] for p in printings[name] if p["set"] in plane_of_set})
        # Legality and identity are the card's, the same on every printing: the newest printing's (its latest word).
        newest = max(printings[name], key=lambda p: p.get("released_at", ""))
        vintage = (newest.get("legalities") or {}).get("vintage", "not_legal")
        identity = "".join(c for c in "WUBRG" if c in (newest.get("color_identity") or []))
        cards[name] = {"gold": round((usd + SURCHARGE[rarity]) * 100), "usd": usd, "rarity": rarity, "planes": on,
                       "vintage": vintage, "identity": identity}
        if vintage in ("legal", "restricted") and name not in relics:
            for plane in on:
                if plane in walked:
                    pools[plane].append(name)
            if not any(plane in walked for plane in on):
                off_plane[name] = [plane for plane in on if plane not in walked]

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
    json.dump(
        {
            "comment": "Cards from other planes (design.md A5): Vintage-legal, priced, no relic, printed on no walked plane; each with the traders' planes it was printed on. Written by tools/realms/card-economy.py.",
            "cards": off_plane,
        },
        open(os.path.join(CONTENT, "off-plane.json"), "w", encoding="utf-8", newline="\n"),
        indent=0,
        sort_keys=True,
        ensure_ascii=False,
    )
    unpriced = len(have) - len(cards)
    print(f"card-economy: {len(cards)} cards priced, {unpriced} the engine has without a paper price")
    for plane, names in pools.items():
        print(f"  {plane}: {len(names)} cards in its pool")
    print(f"  off-plane: {len(off_plane)} cards, {sum(1 for tags in off_plane.values() if tags)} of them a trader's")


if __name__ == "__main__":
    main()
