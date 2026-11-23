"""Cantrip Realms' decks and mobs (realms/docs/design.md, A1, A3 and A6): the five starter decks, and Dominaria's whole
roster of mobs, each with its deck.

    python tools/realms/sample-decks.py

Writes:
    realms/content/dominaria/starters/<color>.txt    the 40-card deck a new character of that color starts with
    decks/realms/dominaria/<mob>.txt                  each mob's 40-card deck
    realms/content/dominaria/mobs/<mob>.json          each mob (realms/docs/interfaces.md, "Mobs")
and removes any mob file or mob deck it did not write, so those folders are exactly its output.

Every card is from the plane's pool (a view of realms/content/cards.json, tools/realms/realm_cards.py), legal in Vintage (one copy of a card restricted
there, only where a mob names it), no relic, and within the deck's colors - Vintage legality and color identity as
realms/content/cards.json gives them, which the server judges by too; starters take only commons and uncommons of
exactly their color, as design.md A1 says, 23 spells along a mana curve and 17 basic lands.

The roster (design.md A6, "Mobs are Dominaria's own creatures", in the Domains). Every mob names the pool card it is
(`creature`) and, but for the generic wardens, the Phyrexian Portal's mobs and the praetor, the region it belongs to by
that region's color: W Benalia (with Sursi's pegasi and Avenant's archers), U Orvada's isles, B the Caligo Morass and
Amjad, R Keld and Icehaven (with the Hurloon minotaurs, the Ironclaw orcs and Foriys's giants), G Llanowar (with the
Durkwood and Verdura):
- **Wanderers**, about fifteen a tier for tiers 1-4, three of each region's color: each is a real creature card,
  named and id'd for it (`llanowar-elves`), one mob a card. Low tiers are commons and uncommons, high tiers rares and
  mythics; the creature's rarity is within its tier's deck rarities.
- **Mage bosses** of the mage towers, `mage-<region>-<tier>` for the regions benalia, orvada, caligo, keld and llanowar
  and tiers 1-4: Dominaria's mages (wizards, clerics, druids, shamans and artificers), each a card of its own, with
  spell-heavy decks. They are paid as their tier and start with a warden's stats and gear.
- **Wardens**: the five dungeons' and the Portal's `*-warden` keepers (tier 4 mini-bosses), and the generic `warden-1`
  to `warden-4`, constructs keeping the mage towers and small wilderness dungeons at their tier.
- **Bosses**: the five that unlock a color, each a legend of its region, and the Phyrexian Portal's tier 4
  Phyrexians and its capstone, the five-color praetor, whose deck is written out card by card and whose stats with its
  gear are design.md's 42 life, a hand of 9 and a maximum of 10.

Each deck is built round its creature from data: the creature as a 2- to 4-of (more the higher the tier), its kin (its
`lean`, creature types), cards that do what its `themes` name (flyers, ramp, burn, removal, counters, ...), and its
`featured` cards; the rest by a plain reading of each card's cost, body and text, along a curve, ties to the name. The
tier sets the rarities a deck may hold and how many copies its best cards get.

A mob's file follows its tier (design.md A3): its prize (T1 100 gold, T2 300, T3 800, T4 2,000, a boss 6,000), its gold
range, its loot - its colors' cards of the rarities whose prices fit under its prize - its stats and stats-only gear,
and its model. The script checks every deck and file it writes (forty cards, copies, restrictions, pool, legality,
relics, colors, ids, meshes, gear) and writes nothing if any fails. The same inputs give the same files. They are a
start: mobs' decks are tuned by hand later (tech.md B7); a mob listed in HAND_TUNED is left alone.
"""

import json
import os
import re
import sys
import unicodedata
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import realm_cards  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
PLANE = "dominaria"
BASICS = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}
NAMES = {"W": "white", "U": "blue", "B": "black", "R": "red", "G": "green"}
WUBRG = "WUBRG"
# The Domains' regions by color (design.md A6), and the names the mage towers' ids give them.
REGIONS = {"W": "Benalia", "U": "Orvada", "B": "the Caligo Morass", "R": "Keld", "G": "Llanowar"}
TOWERS = {"benalia": "W", "orvada": "U", "caligo": "B", "keld": "R", "llanowar": "G"}

# The starters' shape: creatures by mana value and how many of each, 16 creatures and 7 other spells, with 17 lands.
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
# The setup values a mob starts from before its gear's (design.md A1's base, a little more the deeper it lives); mages
# and wardens start as wardens do.
STATS = {1: (20, 7, 7), 2: (20, 7, 7), 3: (22, 7, 7), 4: (24, 7, 7), "warden": (26, 7, 7), "boss": (30, 7, 7)}
# How many copies the best cards of a deck get, and its own creature: a tougher mob plays more of fewer, better cards.
MOST_COPIES = {1: 2, 2: 2, 3: 3, 4: 4, "boss": 4}
CREATURE_COPIES = {1: 2, 2: 3, 3: 4, 4: 4, "boss": 4}
# A deck's 23 spells: how many are creatures and how many other spells, and the highest mana value of those others.
SHAPES = {"wanderer": (16, 7, 4), "portal": (15, 8, 5), "mage": (9, 14, 6), "warden": (15, 8, 5), "boss": (15, 8, 5)}

# The mob meshes of realms/content/models a mob may be drawn with, the first ten there today.
MESHES = {
    "humanoid", "ghoul", "angel", "drake", "elf", "goblin", "wurm", "construct", "spirit", "phyrexian",
    "dragon", "bird", "beast", "cat", "merfolk", "insect", "treefolk", "serpent", "giant", "wizard", "knight",
}
# A creature's mesh by its types, the first that matches.
MESH_BY_TYPE = [
    ("phyrexian", ["Phyrexian"]),
    ("angel", ["Angel"]),
    ("dragon", ["Dragon"]),
    ("drake", ["Drake", "Wyvern"]),
    ("wurm", ["Wurm"]),
    ("merfolk", ["Merfolk"]),
    ("elf", ["Elf"]),
    ("goblin", ["Goblin", "Kobold", "Orc"]),
    ("treefolk", ["Treefolk"]),
    ("serpent", ["Serpent", "Leviathan", "Octopus", "Fish", "Turtle"]),
    ("giant", ["Giant", "Ogre", "Minotaur", "Orgg", "Demon"]),
    ("insect", ["Insect", "Spider"]),
    ("cat", ["Cat"]),
    ("bird", ["Bird", "Griffin", "Pegasus", "Gargoyle"]),
    ("ghoul", ["Zombie", "Skeleton", "Horror", "Imp"]),
    ("knight", ["Knight"]),
    ("construct", ["Construct", "Golem", "Myr", "Thopter", "Wall"]),
    ("spirit", ["Spirit", "Elemental", "Illusion", "Djinn", "Wraith", "Shade", "Sphinx"]),
    ("beast", ["Beast", "Bear", "Boar", "Ape", "Elephant", "Hippo", "Rhino", "Wolf", "Lhurgoyf", "Dinosaur", "Kavu", "Lizard", "Frog", "Yeti", "Rat"]),
    ("wizard", ["Wizard", "Cleric", "Druid", "Artificer"]),
]
# Each region's colors, a mob's palette by its id among them; the colorless ones for constructs of no region.
PALETTES = {
    "W": [["#f2efe6", "#f1b44c", "#93c8dc"], ["#d8d6d0", "#3a5f8f", "#f1b44c"], ["#e8e4d8", "#b3b5bc", "#c08a62"], ["#f2efe6", "#8f6340"]],
    "U": [["#5b8fd6", "#f4ecc2", "#2f5fa8"], ["#3d8fa8", "#93c8dc", "#f4ecc2"], ["#2f5fa8", "#a97fd0"], ["#62a4c2", "#f1b44c", "#2a2b36"]],
    "B": [["#2a2b36", "#7a1f24", "#8c909c"], ["#4b2f5e", "#5d6646", "#2a2b36"], ["#8c909c", "#4b2f5e"], ["#5d6646", "#7a1f24", "#0d0f14"]],
    "R": [["#c8432c", "#f1b44c", "#2e1f17"], ["#8f2f2f", "#4a3122", "#f1b44c"], ["#c8432c", "#6b963e"], ["#e0703a", "#2e1f17", "#f4ecc2"]],
    "G": [["#3e9a4a", "#8f6340", "#d6ae7e"], ["#2a4524", "#d6ae7e", "#c08a62"], ["#4f7a34", "#2a4524"], ["#6b963e", "#8f6340", "#f1b44c"]],
    "C": [["#8c909c", "#62a4c2", "#2a2b36"], ["#b3b5bc", "#8f6340"], ["#8c909c", "#f1b44c", "#2a2b36"], ["#9aa0aa", "#4a4f58", "#62a4c2"]],
}
# Stats-only gear by region and level: a wanderer wears its tier less one, a mage or a generic warden its tier plus one.
GEAR = {
    "W": [[], ["padded-jerkin"], ["padded-jerkin", "kjeldoran-helm"], ["chain-hauberk", "kjeldoran-helm"], ["chain-hauberk", "silver-pendant"], ["serran-vestments", "silver-pendant"]],
    "U": [[], ["novice-robe"], ["novice-robe", "scholars-circlet"], ["tolarian-robe", "scholars-circlet"], ["tolarian-robe", "tolarian-circlet", "silver-band"], ["serran-vestments", "tolarian-circlet"]],
    "B": [[], ["marsh-waders"], ["marsh-waders", "urborg-bone-charm"], ["chain-hauberk", "urborg-bone-charm"], ["chain-hauberk", "silver-pendant"], ["chain-hauberk", "marsh-waders", "silver-pendant"]],
    "R": [[], ["travelers-boots"], ["travelers-boots", "leather-cap"], ["keldon-greaves", "leather-cap"], ["keldon-greaves", "silver-pendant"], ["ghitu-firewalkers", "silver-pendant"]],
    "G": [[], ["silver-band"], ["silver-band", "copper-amulet"], ["elvish-striders", "copper-amulet"], ["elvish-striders", "silver-pendant", "copper-ring"], ["elvish-striders", "padded-jerkin", "silver-pendant"]],
    "C": [[], ["copper-ring"], ["padded-jerkin", "copper-amulet"], ["chain-hauberk", "copper-amulet"], ["chain-hauberk", "silver-pendant"], ["benalish-plate", "silver-pendant"]],
}


def wanderer(creature, tier, region, lean=None, themes=(), **more):
    return dict(kind="wanderer", creature=creature, tier=tier, region=region, lean=lean, themes=list(themes), **more)


def mage(tower, tier, creature, lean=None, themes=(), **more):
    return dict(kind="mage", id=f"mage-{tower}-{tier}", creature=creature, tier=tier, region=TOWERS[tower], lean=lean, themes=list(themes), **more)


# The roster. A wanderer or a mage names its creature, its tier and region (or tower); its deck's colors are the
# region's and the creature's; `lean` is the creature types it leans to (by default the creature's own, Human aside),
# `themes` what it supports (THEMES below), `featured` cards it plays as many of as its best cards, `artifacts` whether
# it takes colorless artifacts (a colorless creature's deck always does), `prefer` the colors a gold deck weighs up.
# Wardens, bosses and the Portal's mobs keep their ids and names and name their creature; a mob with `decklist`
# plays exactly that, one with `stats` starts from them, and one with `gear` or `model` wears or looks so.
MOBS = [
    # Benalia (W): soldiers and knights on its fields, Sursi's pegasi and Avenant's archers, Serra's angels further out.
    wanderer("Benalish Hero", 1, "W", lean=["Soldier"], themes=["pump", "anthem"]),
    wanderer("Mesa Pegasus", 1, "W", lean=["Pegasus", "Bird", "Griffin"], themes=["flyers"]),
    wanderer("D'Avenant Archer", 1, "W", lean=["Archer", "Soldier"], themes=["firststrike", "pump"]),
    wanderer("Benalish Knight", 2, "W", lean=["Knight"], themes=["firststrike", "pump"]),
    wanderer("Pegasus Charger", 2, "W", lean=["Pegasus", "Bird", "Griffin"], themes=["flyers", "firststrike"]),
    wanderer("Longbow Archer", 2, "W", lean=["Archer", "Soldier"], themes=["firststrike", "reach"]),
    wanderer("Guardian of New Benalia", 3, "W", lean=["Soldier", "Knight"], themes=["pump", "anthem"]),
    wanderer("Northern Paladin", 3, "W", lean=["Knight"], themes=["firststrike", "removal"]),
    wanderer("Commander Eesha", 3, "W", lean=["Bird", "Soldier"], themes=["flyers", "protection"]),
    wanderer("Serra Angel", 4, "W", lean=["Angel"], themes=["flyers", "vigilance"], featured=["Glorious Anthem"]),
    wanderer("Serra Paragon", 4, "W", lean=["Angel", "Cleric"], themes=["flyers", "lifegain"]),
    wanderer("Torsten, Founder of Benalia", 4, "W", colors="WG", prefer="W", lean=["Soldier", "Knight"], themes=["big", "pump"]),
    # Orvada (U): merfolk and drakes on the isles' shores, serpents in the straits, djinn over the far reefs.
    wanderer("Coral Merfolk", 1, "U", lean=["Merfolk"], themes=["bounce", "landwalk"]),
    wanderer("Soaring Drake", 1, "U", lean=["Drake", "Bird"], themes=["flyers", "counters"]),
    wanderer("Vodalian Soldiers", 1, "U", lean=["Merfolk", "Soldier"], themes=["counters", "bounce"]),
    wanderer("Merfolk Raiders", 2, "U", lean=["Merfolk"], themes=["landwalk", "bounce"]),
    wanderer("Azure Drake", 2, "U", lean=["Drake"], themes=["flyers", "counters"]),
    wanderer("Sandbar Serpent", 2, "U", lean=["Serpent", "Leviathan", "Octopus", "Fish", "Turtle"], themes=["big", "bounce"]),
    wanderer("Lord of Atlantis", 3, "U", lean=["Merfolk"], themes=["landwalk", "anthem"]),
    wanderer("River Merfolk", 3, "U", lean=["Merfolk"], themes=["landwalk", "counters"]),
    wanderer("Air Elemental", 3, "U", lean=["Elemental", "Djinn"], themes=["flyers", "counters"]),
    wanderer("Mahamoti Djinn", 4, "U", lean=["Djinn", "Elemental"], themes=["flyers", "counters"]),
    wanderer("Tempest Djinn", 4, "U", lean=["Djinn", "Elemental"], themes=["flyers", "counters"]),
    wanderer("Sibilant Spirit", 4, "U", lean=["Spirit", "Serpent", "Leviathan"], themes=["flyers", "big"]),
    # The Caligo Morass and Amjad (B): bog creatures and the Cabal's servants in the fens, fallen knights and Amjad's
    # horrors deeper in, vampires and demons in the dark.
    wanderer("Bog Imp", 1, "B", lean=["Imp"], themes=["flyers", "removal"]),
    wanderer("Bog Rats", 1, "B", lean=["Rat"], themes=["removal", "discard"]),
    wanderer("Bog Raiders", 1, "B", lean=["Zombie"], themes=["landwalk", "removal"]),
    wanderer("Bog Wraith", 2, "B", lean=["Wraith", "Spirit", "Shade"], themes=["landwalk", "removal"]),
    wanderer("Moor Fiend", 2, "B", lean=["Horror", "Nightstalker"], themes=["landwalk", "discard"]),
    wanderer("Lost Soul", 2, "B", lean=["Minion", "Spirit", "Cleric"], themes=["landwalk", "removal"]),
    wanderer("Knight of Malice", 3, "B", lean=["Knight"], themes=["firststrike", "removal"]),
    wanderer("Abomination", 3, "B", lean=["Horror"], themes=["removal", "discard"]),
    wanderer("Eater of the Dead", 3, "B", lean=["Horror", "Zombie"], themes=["graveyard", "removal"]),
    wanderer("Sengir Vampire", 4, "B", lean=["Vampire"], themes=["flyers", "removal"], model=("humanoid", None, None)),
    wanderer("Fallen Angel", 4, "B", lean=["Angel", "Demon"], themes=["flyers", "removal"]),
    wanderer("Tombstalker", 4, "B", lean=["Demon", "Horror"], themes=["landwalk", "removal"]),
    # Keld and Icehaven (R): Hurloon minotaurs, Ironclaw orcs and Keldon raiders near home, Foriys's giants and Parma's
    # ice giants beyond, dragons over Keld's mountains.
    wanderer("Hurloon Minotaur", 1, "R", lean=["Minotaur", "Giant"], themes=["burn"]),
    wanderer("Ironclaw Orcs", 1, "R", lean=["Orc"], themes=["burn", "haste"]),
    wanderer("Balduvian Barbarians", 1, "R", lean=["Barbarian", "Warrior"], themes=["haste", "burn"]),
    wanderer("Keldon Warlord", 2, "R", lean=["Barbarian", "Warrior", "Berserker"], themes=["haste", "burn"], model=("humanoid", None, None)),
    wanderer("Talruum Minotaur", 2, "R", lean=["Minotaur"], themes=["haste", "burn"]),
    wanderer("Orcish Artillery", 2, "R", lean=["Orc"], themes=["burn"]),
    wanderer("Two-Headed Giant of Foriys", 3, "R", lean=["Giant"], themes=["trample", "burn"]),
    wanderer("Frost Giant", 3, "R", lean=["Giant", "Yeti"], themes=["big", "burn"]),
    wanderer("Márton Stromgald", 3, "R", lean=["Knight", "Barbarian", "Warrior"], themes=["pump", "burn"], model=("knight", None, None)),
    wanderer("Shivan Dragon", 4, "R", lean=["Dragon"], themes=["burn", "flyers"]),
    wanderer("Rorix Bladewing", 4, "R", lean=["Dragon"], themes=["haste", "burn"]),
    wanderer("Karplusan Yeti", 4, "R", lean=["Yeti", "Giant"], themes=["removal", "burn"]),
    # Llanowar (G): elves on the elfhames' edges, the Durkwood's beasts and wurms, the deep forest's great ones.
    wanderer("Llanowar Elves", 1, "G", lean=["Elf", "Druid"], themes=["ramp", "big"]),
    wanderer("Elvish Warrior", 1, "G", lean=["Elf", "Warrior"], themes=["pump"]),
    wanderer("Durkwood Boars", 1, "G", lean=["Boar", "Beast"], themes=["big", "trample"]),
    wanderer("Elven Riders", 2, "G", lean=["Elf"], themes=["pump", "ramp"]),
    wanderer("Craw Wurm", 2, "G", lean=["Wurm", "Beast"], themes=["big", "trample"]),
    wanderer("Cradle Guard", 2, "G", lean=["Treefolk"], themes=["big", "reach"]),
    wanderer("Elvish Archers", 3, "G", lean=["Elf", "Archer"], themes=["firststrike", "pump"]),
    wanderer("Arrogant Wurm", 3, "G", lean=["Wurm"], themes=["big", "trample"]),
    wanderer("Birds of Paradise", 3, "G", lean=["Bird"], themes=["ramp", "big"]),
    wanderer("Tarmogoyf", 4, "G", lean=["Lhurgoyf", "Beast"], themes=["pump", "big"]),
    wanderer("Enormous Baloth", 4, "G", lean=["Beast"], themes=["big", "ramp"]),
    wanderer("Marhault Elsdragon", 4, "G", colors="RG", prefer="G", lean=["Elf", "Warrior"], themes=["pump", "burn"]),
    # The mage towers: each region's mages, the farther the tower the stronger.
    mage("benalia", 1, "Keepers of the Faith", lean=["Cleric"], themes=["lifegain", "removal"]),
    mage("benalia", 2, "Mother of Runes", lean=["Cleric"], themes=["protection", "removal"]),
    mage("benalia", 3, "Loran of the Third Path", lean=["Artificer", "Cleric"], themes=["artifacts", "removal"], artifacts=True),
    mage("benalia", 4, "Anointed Peacekeeper", lean=["Cleric"], themes=["wrath", "removal"]),
    mage("orvada", 1, "Tolarian Scholar", lean=["Wizard"], themes=["counters", "bounce"]),
    mage("orvada", 2, "Prodigal Sorcerer", lean=["Wizard"], themes=["counters", "draw"]),
    mage("orvada", 3, "Naban, Dean of Iteration", lean=["Wizard"], themes=["counters", "draw"]),
    mage("orvada", 4, "Arcanis the Omnipotent", lean=["Wizard"], themes=["counters", "draw"]),
    mage("caligo", 1, "Cabal Evangel", lean=["Cleric", "Minion"], themes=["removal", "discard"]),
    mage("caligo", 2, "Thrull Wizard", lean=["Wizard", "Thrull"], themes=["removal", "discard"]),
    mage("caligo", 3, "Nebuchadnezzar", colors="UB", prefer="B", lean=["Wizard"], themes=["removal", "discard"]),
    mage("caligo", 4, "Zur, Eternal Schemer", colors="WUB", prefer="B", lean=["Wizard", "Minion"], themes=["removal", "enchantments"]),
    mage("keld", 1, "Brothers of Fire", lean=["Shaman", "Wizard"], themes=["burn"]),
    mage("keld", 2, "Pyromantic Pilgrim", lean=["Wizard", "Shaman"], themes=["burn", "draw"]),
    mage("keld", 3, "Dragon Mage", lean=["Wizard", "Dragon"], themes=["burn", "draw"]),
    mage("keld", 4, "Magus of the Moon", lean=["Wizard"], themes=["burn", "wrath"], featured=["Blood Moon"]),
    mage("llanowar", 1, "Woodland Druid", lean=["Druid", "Elf"], themes=["ramp", "pump"]),
    mage("llanowar", 2, "Argothian Elder", lean=["Druid", "Elf"], themes=["ramp", "big"]),
    mage("llanowar", 3, "Verduran Enchantress", lean=["Druid"], themes=["enchantments", "pump"]),
    mage("llanowar", 4, "Silverback Elder", lean=["Shaman", "Ape"], themes=["big", "ramp"], model=("beast", ["#3e9a4a", "#8f6340", "#f1b44c"], 1.3)),
    # The dungeons' floor wardens (tier 4 mini-bosses), and the generic wardens of the towers and wilderness dungeons.
    dict(kind="warden", id="sanctum-warden", name="Sanctum Warden", creature="Archangel", region="W", lean=["Angel", "Knight"], themes=["flyers", "vigilance"], gear=["benalish-plate", "silver-pendant"], model=("angel", ["#f1b44c", "#f2efe6", "#93c8dc"], 1.35)),
    dict(kind="warden", id="rift-warden", name="Rift Warden", creature="Zephid", region="U", lean=["Illusion", "Wizard", "Drake", "Sphinx"], themes=["counters", "flyers"], gear=["tolarian-robe", "tolarian-circlet"], model=("spirit", ["#2f5fa8", "#a97fd0", "#f4ecc2"], 1.3)),
    dict(kind="warden", id="tomb-warden", name="Tomb Warden", creature="Zombie Master", region="B", lean=["Zombie", "Skeleton"], themes=["removal", "landwalk"], gear=["chain-hauberk", "thran-amulet"], model=("ghoul", ["#2a2b36", "#7a1f24", "#8c909c"], 1.35)),
    dict(kind="warden", id="foundry-warden", name="Foundry Warden", creature="Orcish Mechanics", region="R", artifacts=True, lean=["Orc", "Artificer", "Construct", "Golem"], themes=["artifacts", "burn"], gear=["benalish-plate", "silver-pendant"], model=("goblin", ["#2a2b36", "#c8432c", "#f1b44c"], 1.4)),
    dict(kind="warden", id="heart-warden", name="Heart Warden", creature="Wirewood Guardian", region="G", lean=["Elf", "Treefolk", "Wurm", "Elemental"], themes=["big", "ramp"], gear=["benalish-plate", "silver-pendant"], model=("treefolk", ["#2a4524", "#f1b44c", "#3e9a4a"], 1.45)),
    dict(kind="warden", id="warden-1", name="Yotian Soldier", creature="Yotian Soldier", tier=1, colors="U", artifacts=True, artifact_creatures=True, shape=(12, 11, 5), lean=["Construct", "Golem", "Soldier", "Thopter"], themes=["artifacts", "defenders"]),
    dict(kind="warden", id="warden-2", name="Obsianus Golem", creature="Obsianus Golem", tier=2, colors="U", artifacts=True, artifact_creatures=True, shape=(12, 11, 5), lean=["Construct", "Golem", "Thopter"], themes=["artifacts"]),
    dict(kind="warden", id="warden-3", name="Triskelion", creature="Triskelion", tier=3, colors="U", artifacts=True, artifact_creatures=True, shape=(12, 11, 5), lean=["Construct", "Golem", "Myr", "Thopter"], themes=["artifacts"]),
    dict(kind="warden", id="warden-4", name="Cityscape Leveler", creature="Cityscape Leveler", tier=4, colors="U", artifacts=True, artifact_creatures=True, shape=(12, 11, 5), lean=["Construct", "Golem", "Myr", "Thopter"], themes=["artifacts", "counters"]),
    # The five bosses, each unlocking its color: its region's legend the pool has.
    dict(kind="boss", id="lyra-dawnbringer", name="Lyra Dawnbringer", creature="Lyra Dawnbringer", region="W", unlocks="W", lean=["Angel"], themes=["flyers", "lifegain"], featured=["Serra Angel", "Archangel"], gear=["benalish-plate", "argivian-crown"], model=("angel", ["#f2efe6", "#f1b44c", "#93c8dc"], 1.6)),
    dict(kind="boss", id="teferi", name="Teferi", creature="Teferi, Hero of Dominaria", region="U", colors="WU", unlocks="U", prefer="U", lean=["Wizard", "Drake", "Bird"], themes=["counters", "draw"], shape=(10, 13, 6), gear=["serran-vestments", "argivian-crown"], model=("wizard", ["#5b8fd6", "#f1b44c", "#f2efe6"], 1.4)),
    # Liliana Vess at her family's estate in the Morass: the pool's one Liliana.
    dict(kind="boss", id="liliana", name="Liliana of the Veil", creature="Liliana of the Veil", region="B", unlocks="B", lean=["Zombie", "Horror", "Minion"], themes=["removal", "discard"], shape=(12, 11, 5), gear=["benalish-plate", "thran-amulet"], model=("wizard", ["#2a2b36", "#4b2f5e", "#c9ced8"], 1.5)),
    # Keld's warlord: the pool's Keldon legend, with the Keldon Warlord.
    dict(kind="boss", id="garna", name="Garna, Bloodfist of Keld", creature="Garna, Bloodfist of Keld", region="R", colors="BR", unlocks="R", prefer="R", lean=["Berserker", "Barbarian", "Warrior"], themes=["haste", "burn"], featured=["Keldon Warlord"], gear=["benalish-plate", "argivian-crown"], model=("humanoid", ["#8f2f2f", "#2e1f17", "#f1b44c"], 1.6)),
    # Llanowar's emissary, round his Forests: big green creatures and green ramp.
    dict(kind="boss", id="rofellos", name="Rofellos, Llanowar Emissary", creature="Rofellos, Llanowar Emissary", region="G", unlocks="G", lean=["Elf", "Druid", "Beast", "Wurm"], themes=["big", "ramp"], featured=["Llanowar Elves", "Silverback Elder", "Primordial Wurm", "Enormous Baloth"], shape=(19, 4, 4), gear=["benalish-plate", "argivian-crown"], model=("elf", ["#3e9a4a", "#8f6340", "#f1b44c"], 1.6)),
    # The Phyrexian Portal (the capstone): the invasion's war-machines and priests, its warden, and the praetor.
    dict(kind="portal", id="phyrexian-ravager", name="Phyrexian Ravager", creature="Phyrexian Dragon Engine", tier=4, colors="BR", artifacts=True, lean=["Phyrexian", "Horror", "Construct", "Dragon"], themes=["artifacts", "burn"], gear=["mantle-of-the-ancients", "thran-amulet"], model=("phyrexian", ["#8c909c", "#c8432c", "#2a2b36"], 1.35)),
    dict(kind="portal", id="phyrexian-negator", name="Phyrexian Negator", creature="Gallowbraid", tier=4, colors="B", artifacts=True, lean=["Phyrexian", "Horror", "Imp", "Demon"], themes=["removal", "discard"], gear=["serran-vestments", "thran-amulet"], model=("phyrexian", ["#2a2b36", "#7a1f24", "#b3b5bc"], 1.4)),
    dict(kind="portal", id="gitaxian-mindcutter", name="Gitaxian Mindcutter", creature="Ertai Resurrected", tier=4, colors="UB", artifacts=True, prefer="B", lean=["Phyrexian", "Wizard", "Horror"], themes=["counters", "discard"], gear=["serran-vestments", "sages-circlet"], model=("phyrexian", ["#5b8fd6", "#b3b5bc", "#0d0f14"], 1.3)),
    dict(kind="portal", id="phyrexian-gorger", name="Phyrexian Gorger", creature="Phyrexian Fleshgorger", tier=4, colors="BG", artifacts=True, prefer="B", lean=["Phyrexian", "Beast", "Horror", "Wurm"], themes=["removal", "big"], gear=["mantle-of-the-ancients", "silver-pendant"], model=("phyrexian", ["#5d6646", "#7a1f24", "#2a4524"], 1.4)),
    dict(kind="warden", id="portal-warden", name="Portal Warden", creature="Yawgmoth Demon", colors="UBR", artifacts=True, prefer="B", lean=["Phyrexian", "Construct", "Horror", "Golem"], themes=["artifacts", "removal"], gear=["mantle-of-the-ancients", "thran-amulet", "sages-circlet"], model=("phyrexian", ["#b3b5bc", "#c8432c", "#0d0f14"], 1.5)),
    dict(
        kind="boss",
        id="phyrexian-praetor",
        name="Phyrexian Praetor",
        creature="Sheoldred, the Apocalypse",
        colors="WUBRG",
        lean=["Phyrexian", "Praetor"],
        # 42 life, a hand of 9 and a maximum of 10 with its gear (design.md A6): it starts from what the gear leaves.
        totals=(42, 9, 10),
        gear=["mantle-of-the-ancients", "crown-of-the-ages", "thran-amulet"],
        model=("phyrexian", ["#f2efe6", "#7a1f24", "#0d0f14"], 1.9),
        # Five colors on the ten original duals and five fetches, round Sheoldred, the Apocalypse (the pool's one
        # praetor): the best creatures, removal and card advantage of each color the pool holds.
        decklist=[
            (2, "Sheoldred, the Apocalypse"),
            (2, "Birds of Paradise"),
            (2, "Hypnotic Specter"),
            (2, "Tarmogoyf"),
            (1, "Silverback Elder"),
            (1, "Firestorm Hellkite"),
            (1, "Ertai Resurrected"),
            (1, "Lightning Angel"),
            (1, "Lyra Dawnbringer"),
            (1, "Muldrotha, the Gravetide"),
            (1, "Teferi, Hero of Dominaria"),
            (2, "Lightning Bolt"),
            (1, "Vindicate"),
            (1, "Swords to Plowshares"),
            (1, "Go for the Throat"),
            (1, "Hymn to Tourach"),
            (1, "Mana Drain"),
            (1, "Demonic Tutor"),
            (1, "Underground Sea"),
            (1, "Tundra"),
            (1, "Volcanic Island"),
            (1, "Tropical Island"),
            (1, "Scrubland"),
            (1, "Badlands"),
            (1, "Bayou"),
            (1, "Plateau"),
            (1, "Savannah"),
            (1, "Taiga"),
            (1, "Polluted Delta"),
            (1, "Bloodstained Mire"),
            (1, "Flooded Strand"),
            (1, "Windswept Heath"),
            (1, "Wooded Foothills"),
            (2, "Swamp"),
        ],
    ),
]

# Mobs whose files and decks were tuned by hand: not overwritten.
HAND_TUNED = set()

RARITY_BONUS = {"common": 0, "uncommon": 0.5, "rare": 1.5, "mythic": 2.5}

# Cards no deck here plays, whatever they score: a combo piece that exiles its own side's permanents, a creature that
# dies as it enters, a win by an empty library.
EXCLUDED = {"Worldgorger Dragon", "Force of Savagery", "Laboratory Maniac"}
# Nor a mob's: cards that do nothing alone or help both players alike, combo and storm pieces, text-changers, and
# draws, tutors and graveyard tricks that need a plan around them.
MOB_EXCLUDED = {
    "Abundance", "Artificial Evolution", "Bitter Reunion", "Brain Freeze", "Bubbling Muck", "Candelabra of Tawnos",
    "Chains of Mephistopheles", "Crop Rotation", "Damping Sphere", "Decaying Soil", "Defense Grid", "Diabolic Intent",
    "Doomsday", "Entomb", "Exhume", "Fastbond", "Fecundity", "Final Fortune", "Helm of Awakening", "High Tide",
    "Hurkyl's Recall", "Last Chance", "Leyline of the Void", "Life and Limb", "Lure", "Magical Hack", "Mana Flare",
    "Manifold Key", "Mind Bend", "Mishra's Bauble", "Opalescence", "Paradoxical Outcome", "Planar Void", "Rain of Filth",
    "Rebuild", "Shallow Grave", "Show and Tell", "Sleight of Mind", "Soul-Guide Lantern", "Squandered Resources",
    "Stifle", "Tendrils of Agony", "The Stone Brain", "Thrumming Stone", "Time Spiral", "Tormod's Crypt",
    "Transmute Artifact", "Upheaval", "Urza's Bauble", "Voltaic Key", "Words of Wind", "Zuran Orb", "Crimson Kobolds",
    "Crookshank Kobolds", "Kobolds of Kher Keep", "Phyrexian Altar", "Ashnod's Altar", "Lim-Dûl's Vault",
    "Sorcerous Spyglass", "Mox Amber", "Everflowing Chalice", "Natural Order", "Worldly Tutor",
    "Enlightened Tutor", "Bontu's Monument", "Panharmonicon", "Mind Twist", "Dancing Scimitar", "Moat",
    "Ensnaring Bridge", "Gix's Command", "Haywire Mite", "Elvish Spirit Guide", "Simian Spirit Guide",
    # Hosers of one color or kind, dead against most decks.
    "Annul", "Deathmark", "Flashfreeze", "Pyroblast", "Black Ward", "Avoid Fate",
    # Cards that do as much for the opponent: board-wide, every player alike.
    "The Abyss", "Concordant Crossroads", "Land's Edge",
}

# A drawback that turns a card on its own side - an upkeep to keep it, a body that phases or will not attack, a
# card handed to the opponent, a coin flip - which no deck here takes unless a mob is that card.
DRAWBACKS = re.compile(
    r"cumulative upkeep|\becho\b|\bphasing\b|at the beginning of your upkeep, (sacrifice|destroy|tap|you lose)|unless you pay"
    r"|can't attack unless|doesn't untap during your untap step|when you control no \w+s?, sacrifice|flip a coin"
    r"|gains? control of [^.]*you control|an opponent gains control|gains control of this creature|skip your|you lose the game"
    r"|when this creature enters, sacrifice|can't attack if|skip (it|that step)\b|destroy target [^.]*you own"
    # A hoser of one color or of artifacts, dead against most decks.
    r"|target (black|white|blue|red|green)( or (black|white|blue|red|green))? (spell|creature|permanent)|if it's (black|white|blue|red|green)"
    r"|from an artifact source|counter target artifact|casts an? (black|white|blue|red|green) spell"
)

# What a mob's themes look for in a card: (card, its lowered text, whether it is a creature) -> whether it does that.
THEMES = {
    "flyers": lambda c, t, cr: cr and has_keyword(c, "flying"),
    "reach": lambda c, t, cr: cr and (has_keyword(c, "reach") or has_keyword(c, "flying")),
    "firststrike": lambda c, t, cr: has_keyword(c, "first strike") or has_keyword(c, "double strike") or (not cr and "first strike" in t),
    "vigilance": lambda c, t, cr: has_keyword(c, "vigilance"),
    "trample": lambda c, t, cr: has_keyword(c, "trample") or "trample" in t,
    "haste": lambda c, t, cr: "haste" in t,
    "protection": lambda c, t, cr: "protection from" in t or "hexproof" in t,
    "landwalk": lambda c, t, cr: bool(re.search(r"\b(swamp|island|forest|mountain|plains)walk\b", t)),
    "big": lambda c, t, cr: cr and number(c.get("power")) >= 5,
    "ramp": lambda c, t, cr: bool(re.search(r"add \{|add one mana|add two mana|basic land card|untap two target lands", t)),
    "burn": lambda c, t, cr: bool(re.search(r"deals (\d+|x) damage to (any target|target|any one target)", t)),
    "removal": lambda c, t, cr: bool(re.search(REMOVAL, t)),
    "wrath": lambda c, t, cr: bool(re.search(r"destroy all creatures|damage to each creature|each player sacrifices", t)),
    "counters": lambda c, t, cr: "counter target" in t,
    "draw": lambda c, t, cr: bool(re.search(r"\bdraws? (a|two|three|\w+) cards?\b", t)),
    "pump": lambda c, t, cr: bool(re.search(r"target creature gets \+|creatures you control get \+|\+1/\+1 counter", t)),
    "anthem": lambda c, t, cr: bool(re.search(r"(other [a-z]+s?|creatures you control) (you control )?(get|have) \+", t)),
    "discard": lambda c, t, cr: bool(re.search(r"(target player|target opponent|each player|each opponent)[^.]*(discards|reveals)", t)),
    "graveyard": lambda c, t, cr: bool(re.search(r"from (your|a) graveyard|creature card (in|from) (your|a) graveyard", t)),
    "lifegain": lambda c, t, cr: bool(re.search(r"gains? (\d+|x) life|lifelink", t)),
    "bounce": lambda c, t, cr: bool(re.search(r"return target [^.]*to (its|their) owner's hand", t)),
    "artifacts": lambda c, t, cr: "Artifact" in c.get("type", "") or "artifact" in t,
    "defenders": lambda c, t, cr: has_keyword(c, "defender"),
    "enchantments": lambda c, t, cr: "Enchantment" in c.get("type", "") or "enchantment spell" in t,
}
REMOVAL = r"destroy target (creature|nonblack|nonartifact|tapped|attacking|nonland permanent|permanent|green or white|blocking)|exile target (creature|permanent|nonland)|target creature gets -|target player sacrifices a creature"
# What a spell is worth by what it does, before its cost.
# A sweeper only where the deck means one (its "wrath" theme): it kills a creature deck's own.
ROLES = {"removal": 5, "burn": 4, "counters": 3, "draw": 2, "discard": 2, "pump": 1}
# A creature deck's curve: the share of its creatures at each mana value (6 and up as 6), and a big creatures' deck's.
CURVE = {1: 0.12, 2: 0.3, 3: 0.22, 4: 0.16, 5: 0.1, 6: 0.1}
CURVE_BIG = {1: 0.12, 2: 0.22, 3: 0.16, 4: 0.14, 5: 0.16, 6: 0.2}


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


def kebab(name):
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower().replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")


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
    # A split card's halves have their own type lines (Life // Death's are sorceries): none of them has subtypes here.
    kind = card.get("type", "")
    return kind.split("—")[-1].split() if "—" in kind else []


def text_of(card):
    """A card's Oracle text, lowered, without its reminder text."""
    return re.sub(r"\([^)]*\)", "", card.get("oracleText") or "").lower()


def has_keyword(card, keyword):
    """Whether a card has a keyword ability: listed, or on one of its keyword lines ("Flying, first strike")."""
    if any(k.lower() == keyword for k in card.get("keywords", [])):
        return True
    for line in text_of(card).split("\n"):
        parts = [p.strip() for p in line.split(",")]
        if keyword in parts and all(len(p.split()) <= 3 and "." not in p for p in parts):
            return True
    return False


def creature_score(card, mv, leaning, rarity=None, lean_bonus=2):
    keywords = card.get("keywords", [])
    lean = lean_bonus if any(t in subtypes_of(card) for t in leaning) else 0
    # A wall holds the ground but never wins: a mob leaning to other creature types wants few.
    wall = -4 if leaning and "Defender" in keywords and "Wall" not in leaning else 0
    return number(card.get("power")) + number(card.get("toughness")) - 1.5 * mv + len(keywords) + lean + wall + RARITY_BONUS.get(rarity, 0)


def role_score(card, mv, sweepers=False, anyway=False):
    """What a spell is worth by what it does (ROLES), less its cost: None for one that does none of it (unless `anyway`)
    or, unless `sweepers`, one that sweeps the board."""
    text = text_of(card)
    if THEMES["wrath"](card, text, False) and not sweepers:
        return None
    roles = sum(points for role, points in ROLES.items() if THEMES[role](card, text, False))
    if roles == 0 and not anyway:
        return None
    if "additional cost to cast this spell, sacrifice a" in text:
        roles -= 3
    cost = -2 if "x" in (card.get("manaCost") or "").lower() else 0
    return roles - 0.5 * mv + cost


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
        if prices[name]["rarity"] not in rarities or card.get("halves") or "Land" in card["type"]:
            continue
        if not card.get("manaCost") or name in EXCLUDED or name in MOB_EXCLUDED or DRAWBACKS.search(text_of(card)):
            continue
        if "Creature" in card["type"] and card.get("toughness") in (0, "0"):
            continue
        found.append((name, card, mana_value(card["manaCost"])))
    return found


def build(colors, rarities, pool, prices, legality, cards):
    """A starter: 23 spells along the curve and 17 basic lands, of exactly `colors`, each slot's best cards two apiece."""
    candidates = candidates_for(colors, rarities, pool, prices, legality, cards, True, False)
    # A wall holds the ground but never wins; a spell is worth what it does (role_score), and one that does none of it
    # is no starter's.
    wall = lambda c: 4 if has_keyword(c, "defender") else 0
    creature_rank = lambda mvs: [n for _, n in sorted((-creature_score(c, v, []) + wall(c), n) for n, c, v in candidates if v in mvs and "Creature" in c["type"])]
    scored = [(role_score(c, v), n) for n, c, v in candidates if "Creature" not in c["type"] and v <= 4]
    spell_rank = [n for _, n in sorted((-score, n) for score, n in scored if score is not None)]
    creatures = creature_rank(range(0, 7))

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
    if sum(copies.values()) != SPELL_CARDS:
        sys.exit(f"sample-decks: {colors} {rarities} has too few cards for {SPELL_CARDS} spells")
    deck = [(copies[n], n) for n in chosen if copies[n]]
    deck += lands(deck, colors, cards)
    return deck


def restricted(name, legality):
    return legality.get(name, {}).get("legalities", {}).get("vintage") == "restricted"


def themed(mob, pool, prices, legality, cards):
    """A mob's deck round its creature: the creature, its featured cards, then creatures and spells by what they are
    worth to it - their body and text, its creature types (`lean`) and what its `themes` look for - and 17 basics."""
    key = deck_key(mob)
    rarities = DECK_RARITIES[key]
    most = MOST_COPIES[key]
    scored = key in (3, 4, "boss")
    n_creatures, n_spells, spell_mv = mob.get("shape") or SHAPES[mob["kind"]]
    lean, themes, prefer = mob["lean"], mob["themes"], mob.get("prefer", "")
    lean_bonus = 3 if most <= 2 else 4
    # The bosses' own cards are theirs, and the legendary mages': another mob plays one only if it features it.
    reserved = {m["creature"] for m in MOBS if m["kind"] == "boss" and m.get("unlocks")}
    reserved |= {m["creature"] for m in MOBS if m["kind"] == "mage" and "Legendary" in cards[m["creature"]]["type"]}
    reserved |= {m["creature"] for m in MOBS if m.get("decklist")}
    reserved.discard(mob["creature"])
    candidates = [(n, c, v) for n, c, v in candidates_for(mob["colors"], rarities, pool, prices, legality, cards, False, mob["artifacts"]) if n not in MOB_EXCLUDED and n not in reserved]

    def worth(name, card, mv):
        text = text_of(card)
        is_creature = "Creature" in card["type"]
        matched = sum(1 for theme in themes if THEMES[theme](card, text, is_creature))
        rarity = RARITY_BONUS[prices[name]["rarity"]] if scored else 0
        identity = legality[name].get("identity", "")
        liked = 2 if prefer and any(c in prefer for c in identity) else 0
        # A colorless card in a colored deck is there for its artifacts, if the deck has them.
        stray = -1.5 if identity == "" and mob["colors"] and "artifacts" not in themes else 0
        if is_creature:
            base = creature_score(card, mv, lean, None, lean_bonus)
            if "defenders" in themes and has_keyword(card, "defender"):
                base += 4
            return base + 2.5 * min(matched, 2) + rarity + liked + stray
        if THEMES["wrath"](card, text, False) and "wrath" not in themes:
            return None
        if matched == 0:
            return role_score(card, mv, sweepers=True)
        return (role_score(card, mv, sweepers=True, anyway=True)) + 2.5 * min(matched, 2) + rarity + liked + stray

    ranked = []
    for name, card, mv in candidates:
        score = worth(name, card, mv)
        if score is not None:
            ranked.append((-score, name, card, mv))
    ranked.sort(key=lambda entry: (entry[0], entry[1]))
    # A construct's deck has artifact creatures alone.
    # Nor does it take a creature it could hardly cast (more than 8 mana) unless it names it.
    creatures = [(n, v) for _, n, c, v in ranked if "Creature" in c["type"] and v <= 8 and ("Artifact" in c["type"] or not mob.get("artifact_creatures"))]
    spells = [(n, v) for _, n, c, v in ranked if "Creature" not in c["type"] and v <= spell_mv]

    copies, order = {}, []

    def put(name, wanted):
        take = min(wanted - copies.get(name, 0), SPELL_CARDS - sum(copies.values()))
        if take > 0:
            if name not in copies:
                order.append(name)
            copies[name] = copies.get(name, 0) + take
        return max(0, take)

    def is_creature(name):
        return "Creature" in cards[name]["type"]

    put(mob["creature"], 1 if restricted(mob["creature"], legality) else CREATURE_COPIES[key])
    for name in mob.get("featured", []):
        put(name, 1 if restricted(name, legality) else most)
    have = lambda creature: sum(k for n, k in copies.items() if is_creature(n) == creature)

    # Creatures along a curve, each mana value its share (a deck of big creatures more at the top), the creature and
    # the featured ones counted where they fall; each share takes the best of its mana value, a thin one borrowing
    # from the next.
    bucket = lambda mv: min(max(mv, 1), 6)
    targets = {mv: round(n_creatures * part) for mv, part in (CURVE_BIG if "big" in themes else CURVE).items()}
    targets[2] += n_creatures - sum(targets.values())
    for name, k in copies.items():
        if is_creature(name):
            targets[bucket(mana_value(cards[name].get("manaCost")))] -= k
    for mv in sorted(targets, reverse=True):
        # A share the featured cards overfill takes its excess from the highest shares.
        while targets[mv] < 0:
            donor = max((m for m in targets if targets[m] > 0), key=lambda m: (targets[m], m), default=None)
            if donor is None:
                break
            targets[donor] -= 1
            targets[mv] += 1
    by_bucket = {mv: [n for n, v in creatures if bucket(v) == mv] for mv in targets}
    for mv in sorted(targets):
        wanted = max(0, targets[mv])
        for source in (mv, min(mv + 1, 6), max(mv - 1, 1)):
            for name in by_bucket[source]:
                if wanted <= 0 or have(True) >= n_creatures:
                    break
                if name not in copies:
                    wanted -= put(name, min(most, wanted))
    for name, _ in creatures:
        if have(True) >= n_creatures:
            break
        put(name, min(most, n_creatures - have(True)))
    for name, mv in spells:
        if have(False) >= n_spells:
            break
        put(name, min(most, n_spells - have(False)))
    # A thin color fills what is left from the best of the rest, creatures first.
    for name, _ in creatures + spells:
        put(name, most)
    for name, _ in creatures + spells:
        put(name, 4)
    if sum(copies.values()) != SPELL_CARDS:
        sys.exit(f"sample-decks: {mob['id']} has too few cards for {SPELL_CARDS} spells")
    # The creatures first, by mana value, then the other spells.
    order.sort(key=lambda n: (n != mob["creature"], not is_creature(n), mana_value(cards[n].get("manaCost")), n))
    deck = [(copies[n], n) for n in order]
    deck += lands(deck, mob["colors"], cards)
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


def deck_key(mob):
    """The tier a mob is built, paid and looted as: its tier, or "boss"."""
    return "boss" if mob["kind"] == "boss" else mob["tier"]


def normalize(mob, cards, legality):
    """A roster entry with its defaults filled in: id, name, tier, colors, lean, artifacts, gear and model."""
    mob = dict(mob)
    creature = mob["creature"]
    card = cards.get(creature)
    if card is None:
        sys.exit(f"sample-decks: {mob.get('id', creature)}'s creature {creature} is no card")
    identity = legality.get(creature, {}).get("identity", "")
    if mob["kind"] == "wanderer":
        mob.setdefault("id", kebab(creature))
        mob.setdefault("name", creature)
    elif mob["kind"] == "mage":
        mob.setdefault("name", creature)
    mob.setdefault("tier", 4)
    region = mob.get("region")
    if "colors" not in mob:
        own = set((region or "") + identity)
        mob["colors"] = "".join(c for c in WUBRG if c in own)
    if mob.get("lean") is None:
        mob["lean"] = [t for t in subtypes_of(card) if t != "Human"]
    mob.setdefault("themes", [])
    mob.setdefault("featured", [])
    mob.setdefault("artifacts", identity == "")
    if "gear" not in mob:
        level = mob["tier"] - 1 if mob["kind"] == "wanderer" else mob["tier"] + 1
        mob["gear"] = GEAR[region or "C"][level]
    mesh, palette, size = mob.get("model") or (None, None, None)
    if mesh is None:
        types = subtypes_of(card)
        mesh = "wizard" if mob["kind"] == "mage" else next((m for m, kinds in MESH_BY_TYPE if any(t in types for t in kinds)), "humanoid")
        if mesh == "humanoid" and "Artifact" in card["type"]:
            mesh = "construct"
    if palette is None:
        choices = PALETTES[region or "C"]
        palette = choices[zlib.crc32(mob["id"].encode("utf-8")) % len(choices)]
    if size is None:
        mv = mana_value(card.get("manaCost"))
        size = 1.0 + 0.05 * mob["tier"] if mob["kind"] == "mage" else min(1.9, max(0.8, 0.8 + 0.1 * mv + 0.05 * (mob["tier"] - 1)))
    mob["model"] = (mesh, palette, round(size, 2))
    return mob


def loot(mob, pool, prices, legality, cards):
    """A mob's loot filter (interfaces.md, "Mobs"): its colors' cards of the rarities its prize can buy, and of its
    creature types too where the pool has a good handful of those within its prize."""
    tier = deck_key(mob)
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


def mob_file(mob, deck_path, pool, prices, legality, cards, gear):
    key = deck_key(mob)
    stats = {"wanderer": key, "portal": key, "mage": "warden", "warden": "warden", "boss": "boss"}[mob["kind"]]
    life, hand, max_hand = mob.get("stats", STATS[stats])
    if "totals" in mob:
        worn = [gear[g]["stats"] for g in mob["gear"]]
        life, hand, max_hand = (mob["totals"][i] - sum(w[k] for w in worn) for i, k in enumerate(("life", "hand", "maxHand")))
    mesh, palette, size = mob["model"]
    data = {"id": mob["id"], "name": mob["name"], "creature": mob["creature"]}
    if mob.get("region"):
        data["region"] = mob["region"]
    data.update({
        "tier": mob["tier"],
        "deck": deck_path,
        "stats": {"life": life, "hand": hand, "maxHand": max_hand},
        "gear": mob["gear"],
        "prize": PRIZE[key],
        "goldRange": GOLD[key],
        "loot": loot(mob, pool, prices, legality, cards),
        "model": {"mesh": mesh, "palette": palette, "size": size},
        "boss": mob["kind"] == "boss",
    })
    if mob.get("unlocks"):
        data["unlocks"] = mob["unlocks"]
    return data


def problems_of(mob, deck, pool, prices, legality, cards, relics, gear):
    """What is wrong with a mob and its deck, as the server and the roster's own rules judge them."""
    found = []
    pool_set = set(pool)
    basics = set(BASICS.values())
    total = sum(count for count, _ in deck)
    if total != 40:
        found.append(f"its deck has {total} cards, not 40")
    for count, name in deck:
        if name in basics:
            if next(c for c, b in BASICS.items() if b == name) not in mob["colors"]:
                found.append(f"{name} is outside its colors {mob['colors']}")
            continue
        info = legality.get(name, {})
        status = info.get("legalities", {}).get("vintage")
        if count > 4:
            found.append(f"{count} copies of {name}")
        if status == "restricted" and count > 1:
            found.append(f"{count} copies of {name}, restricted in Vintage")
        if status not in ("legal", "restricted"):
            found.append(f"{name} is {status or 'unknown'} in Vintage")
        if name not in pool_set:
            found.append(f"{name} is not in the {PLANE} pool")
        if name in relics:
            found.append(f"{name} is a relic")
        if not within(info.get("identity", "?"), mob["colors"], True):
            found.append(f"{name} ({info.get('identity')}) is outside its colors {mob['colors']}")
    held = sum(count for count, name in deck if name == mob["creature"])
    need = 1 if mob["kind"] == "boss" or restricted(mob["creature"], legality) else 2
    if held < need:
        found.append(f"its deck holds {held} of its creature {mob['creature']}, fewer than {need}")
    if mob["kind"] in ("wanderer", "mage", "warden") and mob["creature"] in prices and prices[mob["creature"]]["rarity"] not in DECK_RARITIES[deck_key(mob)]:
        found.append(f"its creature {mob['creature']} is {prices[mob['creature']]['rarity']}, above its tier")
    if mob["kind"] == "wanderer" and (mob["id"] != kebab(mob["creature"]) or mob["name"] != mob["creature"]):
        found.append(f"a wanderer is named and id'd for its creature {mob['creature']}")
    if mob["kind"] in ("wanderer", "mage") and not mob.get("region"):
        found.append("a wanderer or mage has a region")
    if mob.get("region") and mob["region"] not in WUBRG:
        found.append(f"its region {mob['region']} is no color")
    if not 1 <= mob["tier"] <= 4:
        found.append(f"its tier {mob['tier']} is not 1-4")
    mesh, palette, size = mob["model"]
    if mesh not in MESHES:
        found.append(f"its mesh {mesh} is not a mob mesh")
    if not 2 <= len(palette) <= 3 or not all(re.fullmatch(r"#[0-9a-f]{6}", p) for p in palette):
        found.append(f"its palette {palette} is not two or three #rrggbb colors")
    if not 0.8 <= size <= 1.9:
        found.append(f"its size {size} is not 0.8-1.9")
    slots = []
    for item in mob["gear"]:
        if item not in gear:
            found.append(f"it wears {item}, which is no gear")
        elif gear[item].get("effects"):
            found.append(f"it wears {item}, which is not stats-only")
        else:
            slots.append(gear[item]["slot"])
    if len(slots) != len(set(slots)):
        found.append(f"its gear {mob['gear']} doubles a slot")
    return found


def main():
    # The realm's card database (realms/content/cards.json) and the plane's pool, a view of it computed as the server
    # computes it; each card's Vintage legality and color identity as cards.json gives them and the server judges them.
    records = realm_cards.load()
    pool = realm_cards.pool(records, PLANE)
    prices = {name: card for name, card in records.items() if card["gold"] is not None}
    legality = {name: {"identity": card.get("identity", ""), "legalities": {"vintage": card.get("vintage")}} for name, card in records.items()}
    relics = {entry["card"] for entry in load(os.path.join(ROOT, "realms", "content", "relics.json"))["relics"]}
    gear_folder = os.path.join(ROOT, "realms", "content", "gear")
    gear = {g["id"]: g for g in (load(os.path.join(gear_folder, f)) for f in sorted(os.listdir(gear_folder)) if f.endswith(".json"))}
    cards = cards_by_name()

    starters = {}
    for color, name in NAMES.items():
        starters[name] = build(color, ["common", "uncommon"], pool, prices, legality, cards)

    mobs = [normalize(mob, cards, legality) for mob in MOBS]
    problems = []
    ids = [mob["id"] for mob in mobs]
    for mob_id in sorted(set(i for i in ids if ids.count(i) > 1)):
        problems.append(f"{mob_id}: the id is taken twice")
    for mob_id in ids:
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", mob_id):
            problems.append(f"{mob_id}: the id is not kebab-case")
    roaming = [mob["creature"] for mob in mobs if mob["kind"] in ("wanderer", "mage")]
    for creature in sorted(set(c for c in roaming if roaming.count(c) > 1)):
        problems.append(f"{creature} is the creature of more than one wanderer or mage")

    written = []
    for mob in mobs:
        if mob["id"] in HAND_TUNED:
            continue
        missing = [n for n in [mob["creature"]] + mob["featured"] + [n for _, n in mob.get("decklist", [])] if n not in pool and n not in BASICS.values()]
        if missing:
            problems.append(f"{mob['id']}: plays {', '.join(missing)}, which the {PLANE} pool does not have")
            continue
        deck = mob.get("decklist") or themed(mob, pool, prices, legality, cards)
        problems += [f"{mob['id']}: {p}" for p in problems_of(mob, deck, pool, prices, legality, cards, relics, gear)]
        written.append((mob, deck))
    if problems:
        sys.exit("sample-decks: nothing written:\n  " + "\n  ".join(problems))

    for name, deck in starters.items():
        write(os.path.join(ROOT, "realms", "content", PLANE, "starters", f"{name}.txt"),
              f"# The {name} starter deck (realms/docs/design.md, A1): written by tools/realms/sample-decks.py.\n\n", deck)

    mob_folder = os.path.join(ROOT, "realms", "content", PLANE, "mobs")
    deck_folder = os.path.join(ROOT, "decks", "realms", PLANE)
    for mob, deck in written:
        deck_path = f"decks/realms/{PLANE}/{mob['id']}.txt"
        region = REGIONS.get(mob.get("region"), "")
        kind = {
            "wanderer": f"a tier {mob['tier']} wanderer of {region}",
            "mage": f"the mage of {region}'s tier {mob['tier']} tower",
            "warden": f"a tier {mob['tier']} warden",
            "portal": "a tier 4 Phyrexian of the Portal",
            "boss": "a boss" if mob.get("unlocks") else "the capstone boss",
        }[mob["kind"]]
        write(os.path.join(ROOT, *deck_path.split("/")),
              f"# {mob['name']} ({mob['id']}, {mob['creature']}), {kind}: written by tools/realms/sample-decks.py; tune it by hand.\n\n", deck)
        with open(os.path.join(mob_folder, f"{mob['id']}.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(mob_file(mob, deck_path, pool, prices, legality, cards, gear), f, indent=2, ensure_ascii=False)
            f.write("\n")

    # Mobs no longer on the roster go, with their decks.
    keep = {mob["id"] for mob in mobs}
    for folder, extension in ((mob_folder, ".json"), (deck_folder, ".txt")):
        for entry in sorted(os.listdir(folder)):
            if entry.endswith(extension) and entry[: -len(extension)] not in keep:
                os.remove(os.path.join(folder, entry))
                print(f"sample-decks: removed {os.path.relpath(os.path.join(folder, entry), ROOT)}")


if __name__ == "__main__":
    main()
