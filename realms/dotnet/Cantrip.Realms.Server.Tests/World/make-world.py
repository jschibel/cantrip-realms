"""The realm server's test world (realms/docs/interfaces.md, "The world, interiors and dungeons"): a small but real
Dominaria in version 2 of the world data (realms/docs/interfaces.md, "Version 2 of the world data": square tiles, the
types of realms/web/src/world/format.ts), for the server's tests to walk until - and beside - the generated world.

    python realms/dotnet/Cantrip.Realms.Server.Tests/World/make-world.py

Writes realms/dotnet/Cantrip.Realms.Server.Tests/World/dominaria/{world/world.json, world/chunks/*.json,
interiors/*.json, dungeons/*.json}: five by four chunks of 32 tiles - x from -32 to 127 (origin [-32, 0]: the west
chunks are -1_0 to -1_3) and z from 0 to 127 - open grass but for a wall of rock at x 26, z 2 to 12, and the buildings,
whose footprints are blocked and bare. The Domains' towns (layout.json's ids, names and styles) the vendors keep shops
in and the traders' caravans visit, each a street between two rows of buildings: an inn (its innkeeper and a spell table
inside, a dais by the hearth), a shop for each of its vendors (an exotic one's kind exotic-wares; a vendor of STALLS
keeps a stall in the street instead), New Benalia and
Capashen Hold a smithy with an armorer and a temple with a healer too, a quest board, a spell table in New Benalia's street and a pitch in each
traders' town. Spawns of every tier, each listing the roster's wanderers of that tier; the five region dungeons, the
Phyrexian Portal, the Hurloon caves, and a mage tower for each region and tier with its mage at the top and its waystone
(layout.json's ids, the roster's bosses, wardens and mages), each with a spell table beside its entrance; and a ferry (the finds
of the wilds - chests, heartblooms - are the server's to spawn, in the zones, and none is kept here). Every mob of realms/content/dominaria/mobs is met somewhere, as the server's
content check asks. The same roster gives the same files.

It also writes the same world as one of two scales (realms/docs/interfaces.md, "Two scales") to
realms/dotnet/Cantrip.Realms.Server.Tests/World/two/dominaria: the map above is its travel map (`travel`, the towns on it
standing there at walking scale, as a world of two scales allows), and the village of Avenant is an icon on it - a
blocked 3 by 3 square at TWO_SITE, its west way's outside beside it - whose grounds are a pocket of their own four chunks
east of it (TWO_GROUNDS: open grass, its inn's house and door, its west way's exit and inside).
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
CONTENT = os.path.join(ROOT, "realms", "content", "dominaria")
OUT = os.path.join(HERE, "dominaria")
CHUNK = 32
# The chunks written: cx from -1 to 3, cz from 0 to 3.
CHUNKS_X = range(-1, 4)
CHUNKS_Z = range(0, 4)
ORIGIN = (CHUNKS_X[0] * CHUNK, CHUNKS_Z[0] * CHUNK)
SIZE = (len(CHUNKS_X) * CHUNK, len(CHUNKS_Z) * CHUNK)

# Tile flags (format.ts): 1 blocked, 2 bare.
BLOCKED = 1
BARE = 2

# The Domains' five regions (design.md A6): their colors, names and ids.
REGIONS = [("W", "Benalia", "benalia"), ("U", "Orvada", "orvada"), ("B", "Caligo", "caligo"), ("R", "Keld", "keld"), ("G", "Llanowar", "llanowar")]

# The vendors who keep a stall in their town's street rather than a shop (design.md A5: every card vendor of the
# generated world stands at a stall in its town's market).
STALLS = {"argive-knights"}

# The towns: the Domains' (realms/content/dominaria/layout.json, whose names, kinds and styles they take), each at a
# center of the test world with the radius of its kind. New Benalia, the hub, is the capital, in chunk 0_0; the rest are
# every town a vendor keeps a shop in or a trader's caravan visits.
PLACES = {
    "new-benalia": (16, 16),
    "capashen-hold": (48, 16),
    "tolarian-academy": (80, 16),
    "vess-estate": (112, 16),
    "keld": (16, 48),
    "llanowar": (48, 48),
    "cabal-crossing": (80, 48),
    "keldon-watch": (112, 48),
    "denawa": (16, 80),
    "steelleaf-glade": (48, 80),
}
RADII = {"capital": 10, "town": 8, "village": 5}
SMITHIES = ["new-benalia", "capashen-hold"]
# The towns with a temple, whose priest is a healer (design.md A3b): the last building of its town, so the rest stand as before.
TEMPLES = ["new-benalia", "capashen-hold"]

# A town is a street running east and west through its center (z - 1 to z + 1), between two rows of buildings three
# tiles wide and two deep, their doors on the street; two more rows stand behind them. A slot is where a building's door
# is, from the center, and which way it faces (rot 0 south, 2 north); its footprint is the three tiles round its door's
# x, behind the door. The inn takes the first slot, then a smithy's, then a shop a vendor, nearest the center first.
SLOTS = [(dx, dz, rot) for dz, rot in ((-2, 0), (2, 2), (-6, 0), (6, 2)) for dx in (0, -4, 4)] + \
        [(dx, dz, rot) for dz, rot in ((-2, 0), (2, 2), (-6, 0), (6, 2)) for dx in (-8, 8)]

# The wall of rock nobody walks through: x 26, z 2 to 12.
ROCK = {(26, z) for z in range(2, 13)}

# The five regions' dungeons (design.md A6, "Geography: the Domains"), by layout.json's ids, names and themes, each
# with its warden and the boss who unlocks its color: the boss is the mob of the region's color with "boss": true and
# that "unlocks", as layout.json names it.
REGION_DUNGEONS = [
    ("benalish-keep", "W", "sanctum-warden", (40, 112)),
    ("academy-tower", "U", "rift-warden", (56, 112)),
    ("vess-crypts", "B", "tomb-warden", (72, 112)),
    ("keldon-fortress", "R", "foundry-warden", (88, 112)),
    ("elfhame-hollow", "G", "heart-warden", (104, 112)),
]
PORTAL = ["phyrexian-ravager", "phyrexian-negator", "phyrexian-gorger", "gitaxian-mindcutter"]

# An interior: a floor of W by D tiles, and a sill row past it (the front wall's, nothing to walk); the exit's gap in the
# front wall is two tiles wide, its east tile the entry.
ROOM_W, ROOM_D = 7, 5
ENTRY = (4, ROOM_D - 1)

# The two-scale world's village: its icon on the travel map, its grounds' pocket (chunks 7 and 8 by 0 and 1: three empty
# chunks, 4 to 6, between it and the travel map), its middle, and its west way.
TWO_TOWN = "avenant"
TWO_SITE = (100, 84)
TWO_GROUNDS = (224, 0, 288, 64)
TWO_CENTER = (256, 32)
TWO_WAY = {"side": "west", "outside": [TWO_SITE[0] - 2, TWO_SITE[1]], "inside": [230, 32], "exit": [[225, 31], [225, 32], [225, 33]], "to": "new-benalia"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def main():
    build(two=False)
    build(two=True)


def build(two):
    out_root = os.path.join(HERE, "two", "dominaria") if two else OUT
    layout = load(os.path.join(CONTENT, "layout.json"))
    plans = {t["id"]: t for t in layout["towns"]}
    dungeon_plans = {d["id"]: d for d in layout["dungeons"]}
    mobs = {m["id"]: m for m in (load(os.path.join(CONTENT, "mobs", f)) for f in sorted(os.listdir(os.path.join(CONTENT, "mobs"))) if f.endswith(".json"))}
    vendors = [load(os.path.join(CONTENT, "vendors", f)) for f in sorted(os.listdir(os.path.join(CONTENT, "vendors"))) if f.endswith(".json")]

    pocket = [(cx, cz) for cx in range(TWO_GROUNDS[0] // CHUNK, TWO_GROUNDS[2] // CHUNK) for cz in range(TWO_GROUNDS[1] // CHUNK, TWO_GROUNDS[3] // CHUNK)] if two else []
    chunks = {(cx, cz): {"cx": cx, "cz": cz, "tiles": None, "props": [], "buildings": [], "npcs": [], "spawns": [],
                         "entrances": [], "waymarkers": []} for (cx, cz) in [(cx, cz) for cx in CHUNKS_X for cz in CHUNKS_Z] + pocket}
    # Every tile: [height (texels), surface, flags].
    ground = {(x, z): [0, "grass", 0] for x in range(ORIGIN[0], ORIGIN[0] + SIZE[0]) for z in range(ORIGIN[1], ORIGIN[1] + SIZE[1])}
    if two:
        ground.update({(x, z): [0, "grass", 0] for x in range(TWO_GROUNDS[0], TWO_GROUNDS[2]) for z in range(TWO_GROUNDS[1], TWO_GROUNDS[3])})
    taken = {}

    def chunk_of(x, z):
        return chunks[(x // CHUNK, z // CHUNK)]

    def take(x, z, what):
        if (x, z) in taken:
            raise SystemExit(f"make-world: {what} at ({x}, {z}) stands where {taken[(x, z)]} does")
        if (x, z) not in ground:
            raise SystemExit(f"make-world: {what} at ({x}, {z}) is off the world")
        taken[(x, z)] = what

    def block(x, z, what, surface="grass", flags=BLOCKED | BARE):
        take(x, z, what)
        ground[(x, z)] = [0, surface, flags]

    for x, z in sorted(ROCK):
        block(x, z, "the rock", "rock", BLOCKED)

    interiors = {}
    inns = []
    towns = []
    pitches = []

    def room(id, name, kind, town, style, exit, npcs, dais=False):
        tiles = []
        blocked = {(n["x"], n["z"]) for n in npcs}
        for z in range(ROOM_D + 1):
            for x in range(ROOM_W):
                if z == ROOM_D:
                    tiles.append([0, "", BLOCKED])
                elif (x, z) in blocked:
                    tiles.append([0, "floorboards", BLOCKED | BARE])
                else:
                    tiles.append([3 if dais and (x, z) == (0, 1) else 0, "hearthstone" if dais and (x, z) == (0, 1) else "floorboards", 0])
        interiors[id] = {
            "id": id,
            "name": name,
            "kind": kind,
            "town": town,
            "style": style,
            "w": ROOM_W,
            "d": ROOM_D,
            "area": [0, 0, ROOM_W, ROOM_D + 1],
            "tiles": tiles,
            "props": [],
            "npcs": npcs,
            "entry": list(ENTRY),
            "exit": list(exit),
        }

    def building(id, town, style, kind, slot, center, interior=None, sign=None):
        dx, dz, rot = slot
        door = (center[0] + dx, center[1] + dz)
        back = -1 if rot == 0 else 1
        footprint = [(door[0] + fx, door[1] + back * depth) for fx in (-1, 0, 1) for depth in (1, 2)]
        for x, z in footprint:
            block(x, z, f"building {id}")
        take(*door, f"the door of {id}")
        ground[door] = [0, "cobbles", 0]
        x0 = door[0] - 1
        z0 = door[1] - 2 if rot == 0 else door[1] + 1
        entry = {"id": id, "style": style, "kind": kind, "x": x0, "z": z0, "w": 3, "d": 2, "rot": rot, "door": list(door)}
        if interior:
            entry["interior"] = interior
        if sign:
            entry["sign"] = sign
        chunk_of(x0, z0)["buildings"].append(entry)
        return door

    named = {v["town"] for v in vendors if v.get("town")} | {t for v in vendors if v.get("trader") for t in v["trader"]["towns"]}
    missing = sorted(named - set(PLACES))
    if missing:
        raise SystemExit(f"make-world: no place for the towns {', '.join(missing)}")
    traded = {t for v in vendors if v.get("trader") for t in v["trader"]["towns"]}
    for town, (cx, cz) in PLACES.items():
        plan = plans[town]
        name, kind, style = plan["name"], plan["kind"], plan["style"]
        radius = RADII[kind]
        towns.append({"id": town, "name": name, "kind": kind, "center": [cx, cz], "radius": radius, "style": style, "start": town == "new-benalia"})
        slots = iter(s for s in SLOTS if max(abs(s[0]) + 1, abs(s[1]) + 2) <= radius)

        def next_slot():
            try:
                return next(slots)
            except StopIteration:
                raise SystemExit(f"make-world: {town} has no room for another building")

        for x in range(cx - radius, cx + radius + 1):
            for z in (cz - 1, cz, cz + 1):
                if (x, z) in ground and (x, z) not in taken:
                    ground[(x, z)] = [0, "cobbles", 0]

        door = building(f"{town}-inn", town, style, "house", next_slot(), (cx, cz), f"{town}-inn", f"The {name} Inn")
        room(f"{town}-inn", f"The {name} Inn", "inn", town, style, door, [
            {"id": "innkeeper", "kind": "innkeeper", "x": 3, "z": 1},
            {"id": "spell-table", "kind": "spell-table", "x": 5, "z": 1},
        ], dais=True)
        # A character wakes in the street, a step out from the inn's door.
        inns.append({"id": f"{town}-inn", "town": town, "x": door[0], "z": door[1] + 1, "interior": f"{town}-inn"})
        if town in SMITHIES:
            door = building(f"{town}-smithy", town, style, "shop", next_slot(), (cx, cz), f"{town}-smithy", f"{name} Smithy")
            room(f"{town}-smithy", f"{name} Smithy", "smithy", town, style, door, [{"id": "armorer", "kind": "armorer", "x": 3, "z": 1}])
        # A shop for each vendor of the town, an exotic wares shop's as any; a traveling trader keeps none. A vendor of
        # STALLS keeps a stall in the street instead, as every card vendor of the generated world does in its market.
        for vendor in (v for v in vendors if v.get("town") == town):
            if vendor["id"] in STALLS:
                take(cx + 4, cz, f"{vendor['id']}'s stall")
                chunk_of(cx + 4, cz)["npcs"].append({"id": vendor["id"], "kind": "vendor", "vendor": vendor["id"], "x": cx + 4, "z": cz})
                continue
            shop = f"{vendor['id']}-shop"
            door = building(shop, town, style, "shop", next_slot(), (cx, cz), shop, vendor["name"])
            room(shop, vendor["name"], "exotic-wares" if vendor.get("exotic") else "shop", town, style, door,
                 [{"id": vendor["id"], "kind": "vendor", "vendor": vendor["id"], "x": 3, "z": 1}])
        if town in TEMPLES:
            door = building(f"{town}-temple", town, style, "temple", next_slot(), (cx, cz), f"{town}-temple", f"The Temple of {name}")
            room(f"{town}-temple", f"The Temple of {name}", "temple", town, style, door, [{"id": f"{town}-temple-keeper", "kind": "healer", "name": "Priest", "x": 3, "z": 1}])
        block(cx + 2, cz, f"{town}'s quest board", "cobbles")
        chunk_of(cx + 2, cz)["npcs"].append({"id": f"{town}-board", "kind": "quest-board", "x": cx + 2, "z": cz})
        if town in traded:
            take(cx - 2, cz, f"{town}'s pitch")
            pitches.append({"town": town, "x": cx - 2, "z": cz})

    if two:
        # Avenant: its icon on the travel map, and in its grounds its street, its inn and its way's ends.
        plan = plans[TWO_TOWN]
        for x in range(TWO_SITE[0] - 1, TWO_SITE[0] + 2):
            for z in range(TWO_SITE[1] - 1, TWO_SITE[1] + 2):
                block(x, z, f"{TWO_TOWN}'s icon")
        take(*TWO_WAY["outside"], f"{TWO_TOWN}'s west way")
        cx, cz = TWO_CENTER
        for x in range(TWO_GROUNDS[0] + 1, cx + 6):
            for z in (cz - 1, cz, cz + 1):
                if (x, z) not in taken:
                    ground[(x, z)] = [0, "cobbles", 0]
        door = building(f"{TWO_TOWN}-inn", TWO_TOWN, plan["style"], "house", (0, -2, 0), TWO_CENTER, f"{TWO_TOWN}-inn", f"The {plan['name']} Inn")
        room(f"{TWO_TOWN}-inn", f"The {plan['name']} Inn", "inn", TWO_TOWN, plan["style"], door, [
            {"id": "innkeeper", "kind": "innkeeper", "x": 3, "z": 1},
        ])
        inns.append({"id": f"{TWO_TOWN}-inn", "town": TWO_TOWN, "x": door[0], "z": door[1] + 1, "interior": f"{TWO_TOWN}-inn"})
        towns.append({"id": TWO_TOWN, "name": plan["name"], "kind": plan["kind"], "center": list(TWO_CENTER), "radius": RADII[plan["kind"]],
                      "style": plan["style"], "start": False, "site": list(TWO_SITE), "grounds": list(TWO_GROUNDS), "ways": [TWO_WAY]})

    # A spell table in New Benalia's street, in the world.
    block(19, 16, "New Benalia's spell table", "cobbles")
    chunks[(0, 0)]["npcs"].append({"id": "new-benalia-spell-table", "kind": "spell-table", "x": 19, "z": 16})

    dungeons = []

    def dungeon(data, entrance):
        x, z = entrance
        data["entrance"] = [x, z]
        take(x, z, f"the entrance of {data['id']}")
        ground[(x, z)] = [0, "flagstones", 0]
        chunk_of(x, z)["entrances"].append({"x": x, "z": z, "dungeon": data["id"]})
        block(x, z - 1, f"the spell table of {data['id']}", "flagstones")
        chunk_of(x, z - 1)["npcs"].append({"id": f"{data['id']}-spell-table", "kind": "spell-table", "x": x, "z": z - 1})
        if data.get("waystone"):
            block(x - 1, z - 1, f"the waystone of {data['id']}", "flagstones")
            chunk_of(x - 1, z - 1)["npcs"].append({"id": f"{data['id']}-waystone", "kind": "waystone", "tower": data["id"], "x": x - 1, "z": z - 1})
        dungeons.append(data)

    placed = set()

    def wanderers(tier, color=None):
        return sorted(m["id"] for m in mobs.values() if not m.get("boss") and m["tier"] == tier and not m["id"].startswith("mage-")
                      and "warden" not in m["id"] and m["id"] not in PORTAL and (color is None or m.get("region") == color))

    for id, color, warden, at in REGION_DUNGEONS:
        plan = dungeon_plans[id]
        name, theme = plan["name"], plan["theme"]
        boss = next(m["id"] for m in mobs.values() if m.get("boss") and m.get("unlocks") == color)
        if (plan["boss"], plan["warden"]) != (boss, warden):
            raise SystemExit(f"make-world: layout.json's {id} has {plan['warden']} and {plan['boss']}, the roster {warden} and {boss}")
        tables = [wanderers(3, color) or wanderers(3), wanderers(4, color) or wanderers(4)]
        data = {"id": id, "name": name, "theme": theme, "floors": [3, 5], "tier": 4, "encounters": [2, 4], "mobs": tables,
                "warden": warden, "boss": boss, "region": color}
        # How the real dungeon is dealt by the character's standing to its color (design.md A6), as written there.
        with open(os.path.join(CONTENT, "dungeons", f"{id}.json"), encoding="utf-8") as f:
            standing = json.load(f).get("standing")
        if standing:
            data["standing"] = standing
        dungeon(data, at)

    dungeon({"id": "phyrexian-portal", "name": "The Phyrexian Portal", "theme": "portal", "requires": "WUBRG", "floors": [4, 4], "tier": 4,
             "encounters": [2, 3], "mobs": [PORTAL[:3], PORTAL], "warden": "portal-warden", "boss": "phyrexian-praetor"}, (16, 30))

    dungeon({"id": "hurloon-caves", "name": dungeon_plans["hurloon-caves"]["name"], "theme": "caves", "floors": [1, 2], "tier": 2, "encounters": [1, 3],
             "mobs": wanderers(2), "warden": "warden-2", "boss": wanderers(2)[0]}, (24, 56))

    # A mage tower for each region and tier: <region>-<tier>, its mage mage-<region>-<tier> at the top.
    for i, (color, region_name, region) in enumerate(REGIONS):
        for tier in range(1, 5):
            tower = f"{region}-{tier}"
            dungeon({"id": tower, "name": dungeon_plans[tower]["name"], "theme": "tower", "waystone": True, "floors": [1, 2],
                     "tier": tier, "encounters": [1, 2], "mobs": wanderers(tier, color) or wanderers(tier), "warden": f"warden-{tier}",
                     "boss": f"mage-{region}-{tier}", "region": color}, (4 + 24 * i, 92 + 8 * tier))

    for d in dungeons:
        tables = d["mobs"] if d["mobs"] and isinstance(d["mobs"][0], list) else [d["mobs"]]
        placed.update(m for t in tables for m in t)
        placed.update([d["warden"], d["boss"]])

    # Spawns: two of each tier, the first in chunk 0_0 near New Benalia, each holding every wanderer of the tier.
    spawn_places = {1: [(10, 4), (44, 36)], 2: [(4, 22), (60, 40)], 3: [(22, 26), (100, 70)], 4: [(30, 6), (120, 120)]}
    counts = {}
    for tier, places in spawn_places.items():
        held = wanderers(tier)
        for x, z in places:
            take(x, z, f"a spawn of tier {tier}")
            key = (x // CHUNK, z // CHUNK)
            counts[key] = counts.get(key, 0) + 1
            chunk_of(x, z)["spawns"].append({"id": f"{key[0]}_{key[1]}:{counts[key]}", "x": x, "z": z, "mobs": held, "radius": 3,
                                             "respawnSeconds": 600, "tier": tier})
        placed.update(held)

    # A ferry along the east edge: docks at z 4 and z 28, its lane straight between them.
    ferry_from, ferry_to = (124, 4), (124, 28)
    lane = [[124, z] for z in range(ferry_from[1], ferry_to[1] + 1)]
    for x, z in lane:
        take(x, z, "the ferry's lane")
        ground[(x, z)] = [0, "dirt", 0]
    for (x, z), end in ((ferry_from, "from"), (ferry_to, "to")):
        block(x + 1, z, f"the ferryman at {end}", "dirt")
        chunk_of(x + 1, z)["npcs"].append({"id": f"test-ferry-{end}", "kind": "ferryman", "ferry": "test-ferry", "x": x + 1, "z": z})
    ferries = [{"id": "test-ferry", "name": "The Test Ferry", "from": list(ferry_from), "to": list(ferry_to), "lane": lane}]

    unplaced = sorted(set(mobs) - placed)
    if unplaced:
        raise SystemExit(f"make-world: no place holds {', '.join(unplaced)}")

    for (cx, cz), chunk in chunks.items():
        chunk["tiles"] = [ground[(cx * CHUNK + x, cz * CHUNK + z)] for z in range(CHUNK) for x in range(CHUNK)]

    # The tier zones, a chunk a cell: tier 1 by New Benalia, rising with distance; and the overview, a letter a chunk.
    areas = [{"id": f"tier-{t}", "name": f"Tier {t}", "region": "W", "tier": t} for t in range(1, 5)]
    world = {
        "size": [TWO_GROUNDS[2] - ORIGIN[0], SIZE[1]] if two else list(SIZE),
        "origin": list(ORIGIN),
        "chunk": CHUNK,
        "tile": 1,
        "seed": 1,
        "regions": [{"color": c, "name": n, "tiles": 0} for c, n, _ in REGIONS],
        "towns": towns,
        "inns": inns,
        "dungeons": [{"id": d["id"], "x": d["entrance"][0], "z": d["entrance"][1]} for d in dungeons],
        "roads": [],
        "ferries": ferries,
        "pitches": pitches,
        "zones": {"cell": CHUNK, "cols": len(CHUNKS_X), "rows": len(CHUNKS_Z), "areas": areas,
                  "grid": [[min(3, max(abs(cx), cz)) for cx in CHUNKS_X] for cz in CHUNKS_Z]},
        "overview": {"cell": CHUNK, "legend": {"G": "grass"}, "rows": ["G" * len(CHUNKS_X) for _ in CHUNKS_Z]},
    }
    if two:
        world["travel"] = [ORIGIN[0], ORIGIN[1], ORIGIN[0] + SIZE[0], ORIGIN[1] + SIZE[1]]
        world["labels"] = [{"name": "Aerona", "x": 48, "z": 64, "kind": "land"}]

    for folder in ("world/chunks", "interiors", "dungeons"):
        path = os.path.join(out_root, *folder.split("/"))
        if os.path.isdir(path):
            for name in os.listdir(path):
                if name.endswith(".json"):
                    os.remove(os.path.join(path, name))
    write(os.path.join(out_root, "world", "world.json"), world)
    for (cx, cz), chunk in chunks.items():
        write(os.path.join(out_root, "world", "chunks", f"{cx}_{cz}.json"), chunk)
    for id, data in interiors.items():
        write(os.path.join(out_root, "interiors", f"{id}.json"), data)
    for data in dungeons:
        write(os.path.join(out_root, "dungeons", f"{data['id']}.json"), data)
    print(f"make-world{' (two scales)' if two else ''}: {len(chunks)} chunks, {len(towns)} towns, {len(interiors)} interiors, {len(dungeons)} dungeons")


if __name__ == "__main__":
    main()
