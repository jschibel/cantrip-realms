// Interiors (design.md A6): the room behind a door, made for its building's use - a shop's counter with its vendor
// and shelves, an inn's bar and its keeper, tables and the spell table, a temple's pews and altar, a smithy's forge
// and its armorer, a library's stacks, a house's bed and hearth, a mage's round tower. The camera looks in from the
// door's side, so the far walls stand full height and the near ones are cut low. Everything is reached from the door.

import { DIRECTIONS, type Hex, hex, key, toWorld } from "../../src/hex";
import { mulberry32, fnv1a32 } from "../../src/random";
import type { InteriorData, NpcData, PropData, Terrain, TileData, TownStyle } from "../../src/world/schema";
import { reach } from "../../src/world/schema";
import type { InteriorSpec } from "./towns";

const FLOORS: Record<TownStyle, Terrain> = { argive: "wood", benalish: "marble", tolarian: "stone", urborg: "wood", keldon: "wood", llanowar: "moss" };

/** Rooms' sizes in world units, across (x) and deep (z). */
const ROOMS: Record<InteriorData["kind"], readonly [number, number]> = {
  shop: [10.5, 8.5],
  inn: [15, 12],
  guildhall: [13.5, 11],
  temple: [12, 15],
  smithy: [10.5, 9],
  library: [12, 11],
  house: [8.5, 7.5],
  tower: [10, 10],
};

class Room {
  readonly tiles = new Map<string, [number, number, number, Terrain, number]>();
  readonly props = new Map<string, PropData>();
  readonly npcs: NpcData[] = [];
  readonly random: () => number;
  entry: Hex = hex(0, 0);

  constructor(readonly spec: InteriorSpec) {
    this.random = mulberry32(fnv1a32(`interior:${spec.id}`));
  }

  open = (h: Hex): boolean => this.tiles.get(key(h))?.[4] === 0;

  /** Whether a hex may take furniture: open, off the door's way, and blocking it cuts nothing off. */
  free(h: Hex): boolean {
    if (!this.open(h) || this.props.has(key(h))) return false;
    if (Math.max(Math.abs(h.q - this.entry.q), Math.abs(h.r - this.entry.r), Math.abs(h.q + h.r - this.entry.q - this.entry.r)) <= 1) return false;
    const tile = this.tiles.get(key(h))!;
    tile[4] = 1;
    const reached = reach(this.inward(), this.open);
    const all = [...this.tiles.values()].filter((t) => t[4] === 0).length;
    const npcsReached = this.npcs.every((n) => DIRECTIONS.some((d) => reached.has(`${n.q + d.q},${n.r + d.r}`)));
    tile[4] = 0;
    return reached.size === all && npcsReached;
  }

  /** The hex a step in from the door: where a player arrives. */
  inward(): Hex {
    const options = DIRECTIONS.map((d) => hex(this.entry.q + d.q, this.entry.r + d.r)).filter(this.open);
    options.sort((a, b) => toWorld(a).z - toWorld(b).z || a.q - b.q);
    return options[0] ?? this.entry;
  }

  put(h: Hex, kind: string, extra: Partial<PropData> = {}): boolean {
    if (!this.free(h)) return false;
    this.tiles.get(key(h))![4] = 1;
    this.props.set(key(h), { q: h.q, r: h.r, kind, ...extra });
    return true;
  }

  person(h: Hex, npc: Omit<NpcData, "q" | "r">): boolean {
    if (!this.free(h)) return false;
    this.tiles.get(key(h))![4] = 1;
    this.npcs.push({ ...npc, q: h.q, r: h.r });
    return true;
  }

  /** The open hex nearest a point of the room, world units from its middle, that `ok` takes. */
  near(x: number, z: number, ok: (h: Hex) => boolean = (h) => this.free(h)): Hex | null {
    const all = [...this.tiles.values()].map((t) => hex(t[0], t[1]));
    all.sort((a, b) => {
      const pa = toWorld(a);
      const pb = toWorld(b);
      return Math.hypot(pa.x - x, pa.z - z) - Math.hypot(pb.x - x, pb.z - z) || a.q - b.q || a.r - b.r;
    });
    return all.find(ok) ?? null;
  }

  /** Puts something as near a point as it will go. */
  putNear(x: number, z: number, kind: string, extra: Partial<PropData> = {}): Hex | null {
    const h = this.near(x, z);
    return h && this.put(h, kind, extra) ? h : null;
  }

  personNear(x: number, z: number, npc: Omit<NpcData, "q" | "r">): Hex | null {
    const h = this.near(x, z);
    if (!h || !this.person(h, npc)) throw new Error(`${this.spec.id}: no room for ${npc.id}`);
    return h;
  }
}

export function buildInterior(spec: InteriorSpec): InteriorData {
  const room = new Room(spec);
  const [W, D] = ROOMS[spec.kind];
  const floor: Terrain = spec.kind === "temple" ? "marble" : spec.kind === "smithy" ? "stone" : spec.kind === "tower" ? "crystal" : FLOORS[spec.style];
  const round = spec.kind === "tower";
  const inRoom = (h: Hex) => {
    const { x, z } = toWorld(h);
    return round ? Math.hypot(x, z) <= W / 2 : Math.abs(x) <= W / 2 && Math.abs(z) <= D / 2;
  };
  for (let q = -12; q <= 12; q++) {
    for (let r = -14; r <= 14; r++) {
      const h = hex(q, r);
      if (inRoom(h)) room.tiles.set(key(h), [q, r, 0, floor, 0]);
    }
  }
  // Walls: every hex of the room with a neighbour outside it. The far ones (toward -x, -z) stand tall.
  for (const tile of [...room.tiles.values()]) {
    const h = hex(tile[0], tile[1]);
    const outside = DIRECTIONS.filter((d) => !room.tiles.has(`${h.q + d.q},${h.r + d.r}`));
    if (outside.length === 0) continue;
    tile[4] = 1;
    const far = outside.some((d) => toWorld(d).x + toWorld(d).z < -0.5);
    room.props.set(key(h), { q: h.q, r: h.r, kind: "wall", style: spec.style, h: far ? 2.6 : 0.45 });
  }
  // The door: in the middle of the near (+z) wall.
  const door = [...room.tiles.values()]
    .map((t) => hex(t[0], t[1]))
    .filter((h) => room.props.get(key(h))?.kind === "wall")
    .map((h) => ({ h, score: Math.abs(toWorld(h).x) - 2 * toWorld(h).z }))
    .sort((a, b) => a.score - b.score || a.h.q - b.h.q)[0]!.h;
  room.props.delete(key(door));
  room.tiles.get(key(door))![4] = 0;
  room.tiles.get(key(door))![3] = "wood";
  room.entry = door;

  const back = -D / 2 + 1.8;
  switch (spec.kind) {
    case "shop": {
      // The counter across the back, the vendor at its middle, shelves behind, crates by the walls.
      for (let x = -W / 2 + 2.5; x <= W / 2 - 2.5; x += 1.5) if (Math.abs(x) > 0.8) room.putNear(x, back + 1.2, "counter");
      room.personNear(0, back + 1.2, { id: spec.vendor!.id, kind: "vendor", vendor: spec.vendor!.id, name: spec.vendor!.name });
      for (let x = -W / 2 + 1.5; x <= W / 2 - 1.5; x += 1.5) room.putNear(x, back - 0.3, "shelf");
      room.putNear(-W / 2 + 1.5, D / 2 - 2, "crate");
      room.putNear(W / 2 - 1.5, D / 2 - 2.5, "barrel");
      break;
    }
    case "inn": {
      // The bar along the left wall with its keeper, the hearth at the back, tables, and the spell table.
      for (let z = back; z <= D / 2 - 3.5; z += 1.6) if (Math.abs(z - 0) > 0.8) room.putNear(-W / 2 + 2.6, z, "counter");
      room.personNear(-W / 2 + 2.6, 0, { id: `${spec.town}-innkeeper`, kind: "innkeeper", name: spec.innkeeper!.name, text: spec.innkeeper!.text });
      room.putNear(-W / 2 + 1.2, back, "barrel");
      room.putNear(1, back - 0.4, "hearth");
      for (const [x, z] of [[1, -1], [4, -1.5], [1.5, 2.5], [4.5, 2]] as const) room.putNear(x, z, "table");
      room.personNear(W / 2 - 2, back + 0.8, { id: `${spec.town}-inn-spell-table`, kind: "spell-table", name: "Spell table" });
      break;
    }
    case "guildhall": {
      room.personNear(0, -0.5, { id: `${spec.town}-guild-spell-table`, kind: "spell-table", name: "Spell table" });
      for (let x = -W / 2 + 1.5; x <= W / 2 - 1.5; x += 1.5) if (Math.abs(x) > 1.6) room.putNear(x, back - 0.3, "bookshelf");
      room.putNear(0, back - 0.3, "banner", { style: spec.style });
      room.personNear(-W / 2 + 2.5, 1.5, { id: `${spec.id}-master`, kind: "townsfolk", name: spec.resident!.name, text: spec.resident!.text });
      room.putNear(W / 2 - 2.5, 1.5, "table");
      break;
    }
    case "temple": {
      room.putNear(0, back, "altar");
      room.personNear(1.6, back + 0.6, { id: `${spec.id}-priest`, kind: "townsfolk", name: spec.resident!.name, text: spec.resident!.text });
      for (let z = back + 3; z <= D / 2 - 3; z += 2.2) {
        for (const x of [-W / 4 - 0.5, W / 4 + 0.5]) room.putNear(x, z, "pew");
      }
      room.putNear(-W / 2 + 1.5, back, "brazier");
      room.putNear(W / 2 - 1.5, back, "brazier");
      break;
    }
    case "smithy": {
      room.putNear(-W / 2 + 1.6, back - 0.2, "forge");
      room.putNear(-1, back + 1.4, "anvil");
      if (spec.armorer) room.personNear(1.2, back + 1.2, { id: `${spec.town}-armorer`, kind: "armorer", name: "Armorer" });
      else room.personNear(1.2, back + 1.2, { id: `${spec.id}-smith`, kind: "townsfolk", name: "Smith", text: ["Nothing for sale here. Try the town's armorer."] });
      room.putNear(W / 2 - 1.5, back, "barrel");
      room.putNear(W / 2 - 1.5, D / 2 - 2.2, "crate");
      break;
    }
    case "library": {
      for (let z = back; z <= D / 2 - 3.5; z += 2.4) {
        for (let x = -W / 2 + 2; x <= W / 2 - 2; x += 1.5) if (Math.abs(x) > 1.2) room.putNear(x, z, "bookshelf");
      }
      room.personNear(0, back, { id: `${spec.id}-keeper`, kind: "townsfolk", name: spec.resident!.name, text: spec.resident!.text });
      room.putNear(0, D / 2 - 3.2, "table");
      break;
    }
    case "tower": {
      for (let a = 0; a < 360; a += 40) {
        const x = Math.cos((a * Math.PI) / 180) * (W / 2 - 1.6);
        const z = Math.sin((a * Math.PI) / 180) * (W / 2 - 1.6);
        if (z < D / 2 - 3.5) room.putNear(x, z, a % 80 === 0 ? "bookshelf" : "crystal");
      }
      room.personNear(0, -1, { id: `${spec.id}-archmage`, kind: "townsfolk", name: spec.resident!.name, text: spec.resident!.text });
      break;
    }
    case "house": {
      room.putNear(-W / 2 + 1.6, back, "bed");
      room.putNear(W / 2 - 1.6, back - 0.2, "hearth");
      room.putNear(0.5, 0, "table");
      if (spec.resident) room.personNear(-1.5, 1, { id: `${spec.id}-resident`, kind: "townsfolk", name: spec.resident.name, text: spec.resident.text });
      room.putNear(W / 2 - 1.4, D / 2 - 2, "barrel");
      break;
    }
  }
  if (spec.spellTable && !room.npcs.some((n) => n.kind === "spell-table")) {
    room.personNear(W / 4, 0, { id: `${spec.id}-spell-table`, kind: "spell-table", name: "Spell table" });
  }
  const order = (a: { q: number; r: number }, b: { q: number; r: number }) => a.q - b.q || a.r - b.r;
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    town: spec.town,
    style: spec.style,
    exit: { q: spec.exit.q, r: spec.exit.r },
    entry: { q: door.q, r: door.r },
    tiles: [...room.tiles.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((t) => [t[0], t[1], t[2], t[3], t[4]] as TileData),
    props: [...room.props.values()].sort(order),
    npcs: room.npcs.slice().sort(order),
  };
}
