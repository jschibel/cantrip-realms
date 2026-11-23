"""The realm server's test world (realms/docs/interfaces.md, "The world, interiors and dungeons"): a small but real
Dominaria, in the files the world generator (realms/web/scripts/world.ts) writes, for the server's tests to walk until -
and beside - the generated world.

    python realms/dotnet/Cantrip.Realms.Server.Tests/World/make-world.py

Writes realms/dotnet/Cantrip.Realms.Server.Tests/World/dominaria/{world/world.json, world/chunks/*.json,
interiors/*.json, dungeons/*.json}: four by four chunks of 32 hexes (q and r 0 to 127), open grass but for a wall of
rock in chunk 0_0; every town the vendors name, each with an inn (its innkeeper and a spell table inside) and a shop
for each of its vendors, New Argive and New Benalia a smithy with an armorer too, and a spell table in New Argive's
square; spawns of every tier, each listing the roster's wanderers of that tier; the five region dungeons, the
Phyrexian Portal, a cave, and a mage tower for each region and tier with its mage at the top; and two chests. Every mob
of realms/content/dominaria/mobs is met somewhere, as the server's content check asks. The same roster gives the same
files.
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
CONTENT = os.path.join(ROOT, "realms", "content", "dominaria")
OUT = os.path.join(HERE, "dominaria")
CHUNK = 32
CHUNKS = 4

# The Domains' five regions (design.md A6): their colors, names and ids.
REGIONS = [("W", "Benalia", "benalia"), ("U", "Orvada", "orvada"), ("B", "Caligo", "caligo"), ("R", "Keld", "keld"), ("G", "Llanowar", "llanowar")]

# The towns: their kinds and centers. New Benalia, the hub, is the capital, in chunk 0_0; the rest are every town a
# vendor names.
TOWNS = {
    "new-benalia": ("New Benalia", "capital", (16, 16), 10, "benalish"),
    "new-argive": ("New Argive", "town", (48, 16), 8, "argive"),
    "tolarian-academy": ("Tolarian Academy", "town", (80, 16), 8, "tolarian"),
    "urborg": ("Urborg", "town", (112, 16), 8, "urborg"),
    "keld": ("Keld", "town", (16, 48), 8, "keldon"),
    "llanowar": ("Llanowar", "town", (48, 48), 8, "llanowar"),
    "bogwater": ("Bogwater", "village", (80, 48), 5, "urborg"),
    "capashen-hold": ("Capashen Hold", "village", (112, 48), 5, "benalish"),
    "ghitu-encampment": ("Ghitu Encampment", "village", (16, 80), 5, "keldon"),
    "lat-nam": ("Lat-Nam", "village", (48, 80), 5, "tolarian"),
    "yavimaya-hollow": ("Yavimaya Hollow", "village", (80, 80), 5, "llanowar"),
}
SMITHIES = ["new-benalia", "new-argive"]

# Where each door of a town stands, from its center: the inn's first, then a smithy's, then one shop a vendor.
DOOR_OFFSETS = [(-3, 0), (3, 0), (0, -3), (0, 3), (-3, 3), (3, -3), (-2, -2), (2, 2), (-4, 2), (4, -2), (-1, 4), (1, -4)]

# The wall of rock nobody walks through: chunk 0_0, q 26, r 2 to 12.
ROCK = {(26, r) for r in range(2, 13)}

# The five regions' dungeons (design.md A6, "Geography: the Domains"), each with its warden and the boss who unlocks its
# color: the boss is the mob of the region's color with "boss": true and that "unlocks".
REGION_DUNGEONS = [
    ("benalish-castle", "The Benalish Castle", "castle", "W", "sanctum-warden", (40, 112)),
    ("academy-tower", "The Tower of the Tolarian Academy", "tower", "U", "rift-warden", (56, 112)),
    ("vess-crypts", "The Vess Crypts", "crypt", "B", "tomb-warden", (72, 112)),
    ("keldon-fortress", "The Keldon Fortress", "caves", "R", "foundry-warden", (88, 112)),
    ("elfhame-hollow", "The Hollow under the Elfhames", "hollow", "G", "heart-warden", (104, 112)),
]
PORTAL = ["phyrexian-ravager", "phyrexian-negator", "phyrexian-gorger", "gitaxian-mindcutter"]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def disc(radius):
    return [(q, r) for q in range(-radius, radius + 1) for r in range(-radius, radius + 1) if max(abs(q), abs(r), abs(q + r)) <= radius]


def main():
    mobs = {m["id"]: m for m in (load(os.path.join(CONTENT, "mobs", f)) for f in sorted(os.listdir(os.path.join(CONTENT, "mobs"))) if f.endswith(".json"))}
    vendors = [load(os.path.join(CONTENT, "vendors", f)) for f in sorted(os.listdir(os.path.join(CONTENT, "vendors"))) if f.endswith(".json")]

    chunks = {(cq, cr): {"tiles": [], "props": [], "doors": [], "npcs": [], "spawns": [], "chests": [], "entrances": []} for cq in range(CHUNKS) for cr in range(CHUNKS)}

    def chunk_of(q, r):
        return chunks[(q // CHUNK, r // CHUNK)]

    for q in range(CHUNK * CHUNKS):
        for r in range(CHUNK * CHUNKS):
            chunk_of(q, r)["tiles"].append([q, r, 0, "rock" if (q, r) in ROCK else "grass", 1 if (q, r) in ROCK else 0])

    interiors = {}
    inns = []
    towns = []

    def interior(id, name, kind, door, npcs):
        q, r = door
        chunk_of(q, r)["doors"].append({"q": q, "r": r, "interior": id})
        interiors[id] = {
            "id": id,
            "name": name,
            "kind": kind,
            "tiles": [[a, b, 0, "floor", 0] for a, b in disc(3)],
            "props": [],
            "npcs": npcs,
            "exit": {"q": q, "r": r + 1},
        }

    for town, (name, kind, (cq, cr), radius, style) in TOWNS.items():
        towns.append({"id": town, "name": name, "kind": kind, "center": [cq, cr], "radius": radius, "style": style})
        doors = iter(DOOR_OFFSETS)
        dq, dr = next(doors)
        interior(f"{town}-inn", f"The {name} Inn", "inn", (cq + dq, cr + dr), [
            {"id": "innkeeper", "kind": "innkeeper", "q": 0, "r": -2},
            {"id": "spell-table", "kind": "spell-table", "q": 1, "r": -1},
        ])
        inns.append({"id": f"{town}-inn", "town": town, "q": cq, "r": cr + 2})
        if town in SMITHIES:
            dq, dr = next(doors)
            interior(f"{town}-smithy", f"{name} Smithy", "smithy", (cq + dq, cr + dr), [{"id": "armorer", "kind": "armorer", "q": 0, "r": -2}])
        for vendor in (v for v in vendors if v.get("town") == town):
            dq, dr = next(doors)
            interior(f"{vendor['id']}-shop", vendor["name"], "shop", (cq + dq, cr + dr), [{"id": vendor["id"], "kind": "vendor", "vendor": vendor["id"], "q": 0, "r": -2}])
        chunk_of(cq, cr)["npcs"].append({"id": f"{town}-board", "kind": "quest-board", "q": cq + 1, "r": cr + 3})

    # A spell table in New Argive's square, in the world.
    chunks[(0, 0)]["props"].append({"kind": "spell-table", "q": 18, "r": 12})

    dungeons = []

    def dungeon(data, entrance):
        q, r = entrance
        data["entrance"] = [q, r]
        chunk_of(q, r)["entrances"].append({"q": q, "r": r, "dungeon": data["id"]})
        chunk_of(q, r - 1)["props"].append({"kind": "spell-table", "q": q, "r": r - 1})
        dungeons.append(data)

    placed = set()

    def wanderers(tier, color=None):
        return sorted(m["id"] for m in mobs.values() if not m.get("boss") and m["tier"] == tier and not m["id"].startswith("mage-")
                      and "warden" not in m["id"] and m["id"] not in PORTAL and (color is None or m.get("region") == color))

    for id, name, theme, color, warden, at in REGION_DUNGEONS:
        boss = next(m["id"] for m in mobs.values() if m.get("boss") and m.get("unlocks") == color)
        tables = [wanderers(3, color) or wanderers(3), wanderers(4, color) or wanderers(4)]
        dungeon({"id": id, "name": name, "theme": theme, "floors": [3, 5], "tier": 4, "encounters": [2, 4], "mobs": tables,
                 "warden": warden, "boss": boss, "region": color}, at)

    dungeon({"id": "phyrexian-portal", "name": "The Phyrexian Portal", "theme": "portal", "requires": "WUBRG", "floors": [4, 4], "tier": 4,
             "encounters": [2, 3], "mobs": [PORTAL[:3], PORTAL], "warden": "portal-warden", "boss": "phyrexian-praetor"}, (16, 30))

    dungeon({"id": "keldon-caves", "name": "The Keldon Caves", "theme": "caves", "floors": [1, 2], "tier": 2, "encounters": [1, 3],
             "mobs": wanderers(2, "R") or wanderers(2), "warden": "warden-2", "boss": (wanderers(2, "R") or wanderers(2))[0], "region": "R"}, (24, 56))

    # A mage tower for each region and tier: <region>-<tier>, its mage mage-<region>-<tier> at the top.
    for i, (color, region_name, region) in enumerate(REGIONS):
        for tier in range(1, 5):
            tower = f"{region}-{tier}"
            dungeon({"id": tower, "name": f"The {region_name} Tower ({tier})", "theme": "tower", "waystone": True, "floors": [1, 2],
                     "tier": tier, "encounters": [1, 2], "mobs": wanderers(tier, color) or wanderers(tier), "warden": f"warden-{tier}",
                     "boss": f"mage-{region}-{tier}", "region": color}, (8 + 24 * i, 64 + 10 * tier))

    for d in dungeons:
        tables = d["mobs"] if d["mobs"] and isinstance(d["mobs"][0], list) else [d["mobs"]]
        placed.update(m for t in tables for m in t)
        placed.update([d["warden"], d["boss"]])

    # Spawns: two of each tier, the first in chunk 0_0 near New Argive, each holding every wanderer of the tier.
    spawn_places = {1: [(10, 4), (44, 36)], 2: [(4, 22), (60, 40)], 3: [(22, 26), (100, 70)], 4: [(30, 6), (120, 120)]}
    counts = {}
    for tier, places in spawn_places.items():
        held = wanderers(tier)
        for q, r in places:
            key = (q // CHUNK, r // CHUNK)
            counts[key] = counts.get(key, 0) + 1
            chunk_of(q, r)["spawns"].append({"id": f"{key[0]}_{key[1]}:{counts[key]}", "q": q, "r": r, "mobs": held, "radius": 3,
                                              "respawnSeconds": 600, "tier": tier})
        placed.update(held)

    chunks[(0, 0)]["chests"].append({"id": "0_0:1", "q": 6, "r": 28, "gold": [50, 500], "respawnSeconds": 86400})
    chunks[(1, 1)]["chests"].append({"id": "1_1:1", "q": 40, "r": 40, "gold": [50, 500], "respawnSeconds": 3600})

    unplaced = sorted(set(mobs) - placed)
    if unplaced:
        raise SystemExit(f"make-world: no place holds {', '.join(unplaced)}")

    world = {
        "size": [CHUNK * CHUNKS, CHUNK * CHUNKS],
        "chunk": CHUNK,
        "regions": [{"color": c, "name": n, "hexes": []} for c, n, _ in REGIONS],
        "towns": towns,
        "inns": inns,
        "dungeons": [{"id": d["id"], "q": d["entrance"][0], "r": d["entrance"][1]} for d in dungeons],
        "roads": [],
    }

    for folder in ("world/chunks", "interiors", "dungeons"):
        path = os.path.join(OUT, *folder.split("/"))
        if os.path.isdir(path):
            for name in os.listdir(path):
                if name.endswith(".json"):
                    os.remove(os.path.join(path, name))
    write(os.path.join(OUT, "world", "world.json"), world)
    for (cq, cr), chunk in chunks.items():
        write(os.path.join(OUT, "world", "chunks", f"{cq}_{cr}.json"), chunk)
    for id, data in interiors.items():
        write(os.path.join(OUT, "interiors", f"{id}.json"), data)
    for data in dungeons:
        write(os.path.join(OUT, "dungeons", f"{data['id']}.json"), data)
    print(f"make-world: {len(chunks)} chunks, {len(towns)} towns, {len(interiors)} interiors, {len(dungeons)} dungeons")


if __name__ == "__main__":
    main()
