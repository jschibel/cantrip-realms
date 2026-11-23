"""Cantrip Realms' card database, as the realm's tools read it: realms/content/cards.json (tools/realms/card-economy.py
writes it) and the pools that are views of it - the same rules the realm server computes them by at load
(realms/docs/interfaces.md, "Cards and pools").

    import realm_cards
    cards = realm_cards.load()                  # {name: record}
    realm_cards.pool(cards, "dominaria")        # a walked plane's pool, in name order
    realm_cards.off_plane(cards)                # {name: [plane, ...]}, the off-plane pool
"""

import json
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONTENT = os.path.join(ROOT, "realms", "content")


def load():
    """Every card the engine has, by name: its cards.json record."""
    with open(os.path.join(CONTENT, "cards.json"), encoding="utf-8") as f:
        return {card["name"]: card for card in json.load(f)["cards"]}


def walked():
    """The planes a character walks (planes.json's "walked": true): the ones with a pool."""
    with open(os.path.join(CONTENT, "planes.json"), encoding="utf-8") as f:
        return {plane for plane, spec in json.load(f)["planes"].items() if spec.get("walked")}


# The basic lands: free, unlimited and never owned (design.md A1), so in no pool.
BASICS = {"Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
          "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp", "Snow-Covered Mountain", "Snow-Covered Forest"}


def dealt(card):
    """Whether any vendor or loot may deal in a card: legal or restricted in Vintage, priced, not Universes Beyond, no relic."""
    return card["vintage"] in ("legal", "restricted") and card["gold"] is not None and not card["universesBeyond"] and not card["relic"]


def pool(cards, plane):
    """A walked plane's pool: every card dealt in that was printed on the plane."""
    return sorted(name for name, card in cards.items() if dealt(card) and name not in BASICS and plane in card["planes"])


def off_plane(cards):
    """The off-plane pool: every card dealt in that was printed on no walked plane, with the planes it was printed on."""
    home = walked()
    return {name: card["planes"] for name, card in sorted(cards.items())
            if dealt(card) and name not in BASICS and not any(plane in home for plane in card["planes"])}
