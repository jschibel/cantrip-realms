// The interiors behind the towns' doors (interfaces.md, "Interiors"): each building's room, laid out for its kind - its
// floor, its furniture as props (art/props/indoors.ts, and the placeholders ids.ts lists), its fire's and window's light,
// and its people: the vendor behind the shop's counter, the innkeeper behind the bar with the spell table across the
// room, the armorer at the smithy's anvil, the guild's spell table, the priest, the librarian, the folk at home. The room
// recipe of its kind (art/rooms) draws the shell; the file holds what the generator chose. The floor is `w` by `d`
// tiles; the exit is the two-tile gap in the front (south) wall, `entry` its east tile, as in the slice's shop.

import type { InteriorData, LightData, NpcData, PropData, TileData } from "../../src/world/format";
import { BARE, BLOCKED } from "../../src/world/format";
import { fnv1a32, mulberry32 } from "../../src/random";
import type { InteriorSpec } from "./towns";

/** Floor sizes, tiles, by kind. */
const ROOM_SIZE: Record<string, readonly [number, number]> = {
  shop: [12, 8],
  "exotic-wares": [12, 9],
  inn: [16, 11],
  guildhall: [14, 10],
  temple: [12, 14],
  smithy: [11, 9],
  library: [13, 10],
  tower: [11, 11],
  house: [9, 7],
};

const FLOOR: Record<string, string> = { temple: "flagstones", tower: "flagstones", smithy: "flagstones" };

/** Who keeps a room, by the town's style (the outdoors' folk: towns.ts). */
const KEEPER: Record<string, string> = { benalish: "townsman", llanowar: "elf", urborg: "townswoman", keldon: "humanoid", tolarian: "wizard", argive: "townsman" };

const WARM: readonly [number, number, number] = [1, 0.75, 0.4];
const FIRE: readonly [number, number, number] = [1, 0.55, 0.25];

class Room {
  readonly w: number;
  readonly d: number;
  readonly tiles: [number, string, number][];
  readonly props: PropData[] = [];
  readonly npcs: NpcData[] = [];
  readonly lights: LightData[] = [];
  readonly entry: readonly [number, number];
  readonly random: () => number;

  constructor(
    readonly spec: InteriorSpec,
    size: readonly [number, number],
  ) {
    [this.w, this.d] = size;
    this.random = mulberry32(fnv1a32(`interior:${spec.id}`));
    const floor = FLOOR[spec.kind] ?? "floorboards";
    this.entry = [Math.floor(this.w / 2), this.d - 1];
    this.tiles = [];
    for (let z = 0; z <= this.d; z++) {
      for (let x = 0; x < this.w; x++) {
        // The sill row past the front wall: nothing but the exit's gap, which is walked out of, never onto.
        if (z === this.d) this.tiles.push(x === this.entry[0] || x === this.entry[0] - 1 ? [0, floor, BLOCKED] : [0, "", BLOCKED]);
        else this.tiles.push([0, floor, 0]);
      }
    }
    // The back wall's row is furniture's: shelves, the hearth, windows.
    for (let x = 0; x < this.w; x++) this.block(x, 0);
  }

  at(x: number, z: number): [number, string, number] | undefined {
    return x >= 0 && z >= 0 && x < this.w && z <= this.d ? this.tiles[z * this.w + x] : undefined;
  }

  block(x: number, z: number): void {
    const t = this.at(x, z);
    if (t) t[2] = BLOCKED | BARE;
  }

  open(x: number, z: number): boolean {
    const t = this.at(x, z);
    return !!t && t[1] !== "" && (t[2] & BLOCKED) === 0;
  }

  floor(x: number, z: number, surface: string): void {
    const t = this.at(x, z);
    if (t) t[1] = surface;
  }

  /** A prop, blocking the tiles listed (whole tiles, x0..x1 and z0..z1 included). */
  prop(p: PropData, blocks?: readonly [number, number, number, number]): void {
    this.props.push(p);
    if (blocks) for (let z = blocks[1]; z <= blocks[3]; z++) for (let x = blocks[0]; x <= blocks[2]; x++) this.block(x, z);
  }

  person(n: NpcData): void {
    this.npcs.push(n);
  }

  /** Something people use, standing on a tile of its own: a spell table. */
  object(id: string, kind: NpcData["kind"], name: string, x: number, z: number, prop: string): void {
    this.prop({ id: prop, x: x + 0.5, z: z + 0.5 }, [x, z, x, z]);
    this.npcs.push({ id, x, z, kind, name, stand: [x + 0.5, 0, z + 0.5] });
  }

  /** A counter facing the room, from x0 to x1 along its front row (z 2), its ends running back to the wall. */
  counter(x0: number, x1: number): void {
    this.prop({ id: "shop-counter", x: x0 + 0.25, z: 1, args: { to: [x1 + 0.25, 3] } });
    for (let x = x0; x <= x1; x++) this.block(x, 2);
    this.block(x0, 1);
    this.block(x1, 1);
  }

  /** A table with stools either side, its middle at a tile corner (tx, tz): it takes the four tiles round it. */
  table(tx: number, tz: number, candle = false): void {
    this.prop({ id: "card-table", x: tx, z: tz }, [tx - 1, tz - 1, tx, tz]);
    this.props.push({ id: "stool", x: tx - 1.5, z: tz }, { id: "stool", x: tx + 1.5, z: tz });
    if (candle) this.props.push({ id: "candle", x: tx + 0.3, z: tz + 0.2, y: 0.8125 });
  }

  light(at: readonly [number, number, number], color: readonly [number, number, number], intensity: number, reach: number, flicker = false): void {
    this.lights.push({ kind: "point", at, color, intensity, reach, ...(flicker ? { flicker: { base: intensity * 0.9, steps: [0, 1.6, 0.7], rate: 8, phase: this.lights.length } } : {}) });
  }

  /** A hearth against the back wall, centred on x, with its fire's light. */
  hearth(x: number): void {
    this.prop({ id: "hearth", x, z: 0 });
    this.floor(Math.floor(x) - 1, 1, "hearthstone");
    this.floor(Math.floor(x), 1, "hearthstone");
    this.floor(Math.floor(x) + 1, 1, "hearthstone");
    this.light([x, 1, 1.2], FIRE, 9, 7.5, true);
  }

  /** Shelves, windows and posters along the back wall, skipping what stands there. */
  backWall(skip: readonly [number, number][], goods: boolean): void {
    for (let x = 1.25; x < this.w - 1; x += 2.5) {
      if (skip.some(([a, b]) => x + 1 > a && x - 1 < b)) continue;
      const roll = this.random();
      if (roll < 0.25) this.props.push({ id: "back-window", x, z: 0, y: 1.125 });
      else this.props.push({ id: "bookshelf", x, z: 0, seed: Math.floor(this.random() * 16), ...(goods ? { args: { goods: true } } : {}) });
    }
  }

  /** The daylight through the door, as the slice's shop has it. */
  daylight(): void {
    this.lights.push({ kind: "spot", at: [this.w / 2, 4, -1.6], to: [this.w / 2, 0, this.d / 2 - 0.4], color: [1, 0.94, 0.78], intensity: 40, reach: 14, angle: 0.36, penumbra: 0.05, decay: 1.2 });
  }

  /** A keeper's figure and look. */
  keeper(): string {
    return KEEPER[this.spec.style] ?? "townsman";
  }

  data(): InteriorData {
    return {
      id: this.spec.id,
      name: this.spec.name,
      kind: this.spec.kind,
      town: this.spec.town,
      style: this.spec.style,
      w: this.w,
      d: this.d,
      area: [0, 0, this.w, this.d + 1],
      tiles: this.tiles as unknown as TileData[],
      props: this.props,
      npcs: this.npcs,
      lights: this.lights,
      entry: this.entry,
      exit: this.spec.exit,
    };
  }
}

/** A shop as the slice's: hearth and shelves behind, the counter across the back half, a card table, wares in the corners. */
function shop(r: Room, exotic: boolean): void {
  const { w, d } = r;
  r.hearth(2);
  r.props.push({ id: "candle", x: 0.75, z: 0.3, y: 1.875 }, { id: "candle", x: 3.25, z: 0.3, y: 1.875 }, { id: "pot", x: 2.75, z: 0.3, y: 1.875, args: { r: 0.12 } });
  r.backWall([[0, 4]], true);
  const x0 = Math.floor(w / 2);
  const x1 = w - 1;
  r.counter(x0, x1);
  const vx = Math.floor((x0 + x1) / 2);
  r.props.push({ id: "crate", x: vx + 0.5, z: 1.75, args: { size: 0.5 } });
  r.props.push({ id: "scales", x: x0 + 1.5, z: 2.6, y: 1.0625 }, { id: "coins", x: x0 + 2.5, z: 2.55, y: 1.0625 }, { id: "ledger", x: x0 + 3.25, z: 2.35, y: 1.0625 });
  r.props.push({ id: "candle", x: x1 - 0.25, z: 2.6, y: 1.0625 });
  r.light([x1 - 0.25, 1.6, 2.7], WARM, 2.2, 3.2);
  const v = r.spec.vendor!;
  r.person({ id: v.id, x: vx, z: 1, kind: "vendor", vendor: v.id, name: v.name, figure: r.keeper(), stand: [vx + 0.5, 0.5, 1.75], behaviour: { rest: [0, 1], watch: 5 } });
  r.table(2, 4, true);
  r.light([2.3, 1.4, 4.2], WARM, 2.2, 3.2);
  r.prop({ id: "rug", x: 3.75, z: 4.25, args: { to: [w - 4.25, d - 1.25] } });
  if (exotic) {
    r.prop({ id: "curio-cabinet", x: 0.5, z: d - 2 }, [0, d - 3, 0, d - 1]);
    r.prop({ id: "planar-mirror", x: w - 0.5, z: d - 2 }, [w - 1, d - 3, w - 1, d - 1]);
    r.prop({ id: "crystal", x: 1.5, z: d - 1.5 }, [1, d - 1, 1, d - 1]);
  } else {
    r.prop({ id: "barrel", x: 0.55, z: d - 1.6 }, [0, d - 2, 0, d - 1]);
    r.prop({ id: "barrel", x: 1.3, z: d - 0.8, args: { h: 0.75 } }, [1, d - 1, 1, d - 1]);
    r.props.push({ id: "sack", x: 0.6, z: d - 0.65 });
    r.prop({ id: "crate", x: w - 1.4, z: d - 1.5, args: { size: 0.75, goods: "apples" } }, [w - 2, d - 2, w - 1, d - 2]);
    r.prop({ id: "crate", x: w - 0.55, z: d - 1.4, turn: 0.2, args: { size: 0.625 } }, [w - 1, d - 1, w - 1, d - 1]);
  }
}

function inn(r: Room): void {
  const { w, d, spec } = r;
  r.hearth(Math.floor(w / 2));
  r.backWall([[Math.floor(w / 2) - 2, Math.floor(w / 2) + 2]], false);
  // The bar along the west, the innkeeper behind it, barrels at its back.
  r.counter(1, 6);
  r.props.push({ id: "barrel", x: 2.5, z: 1.4, args: { h: 0.875 } }, { id: "barrel", x: 4.5, z: 1.4, args: { h: 0.875 } });
  r.props.push({ id: "candle", x: 5.6, z: 2.6, y: 1.0625 }, { id: "pot", x: 2, z: 2.5, y: 1.0625, args: { r: 0.13 } });
  r.light([5.6, 1.6, 2.7], WARM, 2.2, 3.2);
  r.person({ id: `${spec.town}-innkeeper`, x: 3, z: 1, kind: "innkeeper", name: spec.innkeeper!.name, text: spec.innkeeper!.text, figure: r.keeper(), behaviour: { rest: [0, 1], watch: 5 } });
  // Tables about the room.
  for (const [tx, tz] of [[10, 4], [13, 4], [10, 7], [13, 7], [4, 7]] as const) if (tx < w - 1 && tz < d - 2) r.table(tx, tz, true);
  r.light([11.5, 1.4, 5.5], WARM, 2.4, 4);
  r.prop({ id: "rug", x: 6.25, z: 4.25, args: { to: [9, d - 1.75] } });
  // The spell table in the corner by the door.
  r.object(`${spec.town}-inn-spell-table`, "spell-table", "Spell table", w - 2, d - 2, "spell-table");
  r.prop({ id: "barrel", x: 0.55, z: d - 1.5 }, [0, d - 2, 0, d - 1]);
  r.props.push({ id: "sack", x: 1.4, z: d - 0.6 });
}

function guildhall(r: Room): void {
  const { w, d, spec } = r;
  r.hearth(2);
  r.backWall([[0, 4]], false);
  for (const x of [w / 2 - 3, w / 2 + 3]) r.props.push({ id: "tattered-banner", x, z: 0, y: 1.6 });
  r.object(`${spec.town}-guild-spell-table`, "spell-table", "Spell table", Math.floor(w / 2), 4, "spell-table");
  r.props.push({ id: "candles", x: Math.floor(w / 2) - 0.6, z: 4.5 }, { id: "candles", x: Math.floor(w / 2) + 1.6, z: 4.5 });
  r.light([w / 2, 1.2, 4.5], WARM, 3, 5, true);
  r.prop({ id: "lectern", x: 2.5, z: 4.5 }, [2, 4, 2, 4]);
  r.table(w - 3, 4, true);
  r.table(w - 3, 7, true);
  r.prop({ id: "bookshelf", x: 0.5, z: d - 3, turn: Math.PI / 2, seed: 3 }, [0, d - 4, 0, d - 2]);
  r.person({ id: `${spec.id}-master`, x: 3, z: 6, kind: "townsfolk", name: spec.resident!.name, text: spec.resident!.text, figure: "wizard", speed: 1.2, seed: 1, behaviour: { wander: { home: [3, 6], reach: 2, pause: [3, 7] }, watch: 4 } });
  r.daylight();
}

function temple(r: Room): void {
  const { w, d, spec } = r;
  const mid = Math.floor(w / 2);
  r.prop({ id: "altar", x: mid, z: 1.5 }, [mid - 1, 1, mid, 1]);
  r.props.push({ id: "candles", x: mid - 1.8, z: 0.6 }, { id: "candles", x: mid + 1.8, z: 0.6 });
  r.light([mid, 1.4, 1.2], WARM, 4, 6, true);
  for (const x of [1.5, w - 1.5]) r.props.push({ id: "back-window", x, z: 0, y: 1.5 });
  for (let z = 4; z <= d - 3; z += 2) {
    r.prop({ id: "pew", x: (1 + mid - 1) / 2 + 0.5, z: z + 0.5, args: { width: mid - 2 } }, [1, z, mid - 2, z]);
    r.prop({ id: "pew", x: (mid + 1 + w - 1) / 2, z: z + 0.5, args: { width: w - mid - 3 } }, [mid + 1, z, w - 2, z]);
  }
  r.person({ id: `${spec.id}-priest`, x: mid, z: 2, kind: "townsfolk", name: spec.resident!.name, text: spec.resident!.text, figure: r.keeper(), behaviour: { rest: [0, 1], watch: 5 } });
  r.daylight();
}

function smithy(r: Room): void {
  const { w, d, spec } = r;
  r.prop({ id: "forge", x: 2, z: 0 });
  for (const x of [1, 2, 3]) r.floor(x, 1, "hearthstone");
  r.light([2, 1, 1], FIRE, 11, 8, true);
  r.prop({ id: "anvil", x: 3.5, z: 2.5 }, [3, 2, 3, 2]);
  r.props.push({ id: "blade-rack", x: 6.5, z: 0, y: 1.25 }, { id: "shield", x: 8.25, z: 0, y: 2 });
  r.prop({ id: "weapon-rack", x: w - 0.5, z: 3 }, [w - 1, 2, w - 1, 3]);
  r.prop({ id: "armor-stand", x: w - 0.5, z: 5.5 }, [w - 1, 5, w - 1, 5]);
  r.prop({ id: "barrel", x: 0.55, z: d - 1.5 }, [0, d - 2, 0, d - 1]);
  r.prop({ id: "crate", x: 1.4, z: d - 0.6, args: { size: 0.625 } }, [1, d - 1, 1, d - 1]);
  if (spec.armorer) r.person({ id: `${spec.town}-armorer`, x: 5, z: 2, kind: "armorer", name: "Armorer", figure: "humanoid", behaviour: { rest: [0, 1], watch: 5 } });
  else r.person({ id: `${spec.id}-smith`, x: 5, z: 2, kind: "townsfolk", name: "Smith", text: ["Nothing for sale here. Try the town's armorer."], figure: "humanoid" });
  r.daylight();
}

function library(r: Room): void {
  const { w, d, spec } = r;
  r.backWall([], false);
  for (const z of [3, 6]) {
    if (z >= d - 2) continue;
    r.prop({ id: "bookshelf", x: 2.5, z: z + 0.5, seed: z }, [1, z, 3, z]);
    r.prop({ id: "bookshelf", x: w - 2.5, z: z + 0.5, seed: z + 1 }, [w - 4, z, w - 2, z]);
  }
  r.table(Math.floor(w / 2) + 1, 4, true);
  r.light([w / 2, 1.4, 4.2], WARM, 2.6, 4);
  r.prop({ id: "lectern", x: Math.floor(w / 2) + 0.5, z: 7.5 }, [Math.floor(w / 2), 7, Math.floor(w / 2), 7]);
  r.person({ id: `${spec.id}-keeper`, x: Math.floor(w / 2) - 2, z: 2, kind: "townsfolk", name: spec.resident!.name, text: spec.resident!.text, figure: r.keeper(), behaviour: { rest: [0, 1], watch: 5 } });
  r.daylight();
}

function tower(r: Room): void {
  const { w, d, spec } = r;
  r.backWall([], false);
  const mid = Math.floor(w / 2);
  r.prop({ id: "orrery", x: mid, z: 5 }, [mid - 1, 4, mid, 5]);
  r.prop({ id: "crystal", x: 1.5, z: 2.5 }, [1, 2, 1, 2]);
  r.prop({ id: "crystal", x: w - 1.5, z: 2.5 }, [w - 2, 2, w - 2, 2]);
  r.props.push({ id: "candles", x: mid - 2, z: 2 }, { id: "candles", x: mid + 2, z: 2 });
  r.light([mid, 1.6, 4.5], [0.6, 0.7, 1], 4, 6, true);
  r.prop({ id: "lectern", x: mid + 0.5, z: 8.5 }, [mid, 8, mid, 8]);
  r.person({ id: `${spec.id}-archmage`, x: mid, z: 2, kind: "townsfolk", name: spec.resident!.name, text: spec.resident!.text, figure: "wizard", behaviour: { rest: [0, 1], watch: 5 } });
  r.object(`${spec.id}-spell-table`, "spell-table", "Spell table", 2, d - 3, "spell-table");
  void d;
}

function house(r: Room): void {
  const { w, d, spec } = r;
  r.hearth(2);
  r.props.push({ id: "pot", x: 1.2, z: 0.3, y: 1.875, args: { r: 0.12 } }, { id: "candle", x: 3, z: 0.3, y: 1.875 });
  r.prop({ id: "bed", x: w - 1.5, z: 0.5 }, [w - 2, 1, w - 1, 1]);
  r.props.push({ id: "back-window", x: 5, z: 0, y: 1.125 });
  r.table(3, 4, true);
  r.prop({ id: "rug", x: 4.25, z: 2.25, args: { to: [w - 1.25, d - 2.25] } });
  r.prop({ id: "barrel", x: w - 0.55, z: d - 1.5 }, [w - 1, d - 2, w - 1, d - 1]);
  r.props.push({ id: "sack", x: 0.6, z: d - 0.65 });
  if (spec.resident) {
    r.person({ id: `${spec.id}-resident`, x: 5, z: 3, kind: "townsfolk", name: spec.resident.name, text: spec.resident.text, figure: r.keeper(), speed: 1.2, seed: 2, behaviour: { wander: { home: [5, 3], reach: 2, pause: [3, 8] }, watch: 3 } });
  }
  r.daylight();
}

/** The interior file of a building's room. */
export function buildInterior(spec: InteriorSpec): InteriorData {
  const r = new Room(spec, ROOM_SIZE[spec.kind] ?? ROOM_SIZE.house!);
  switch (spec.kind) {
    case "shop":
      shop(r, false);
      break;
    case "exotic-wares":
      shop(r, true);
      break;
    case "inn":
      inn(r);
      break;
    case "guildhall":
      guildhall(r);
      break;
    case "temple":
      temple(r);
      break;
    case "smithy":
      smithy(r);
      break;
    case "library":
      library(r);
      break;
    case "tower":
      tower(r);
      break;
    default:
      house(r);
  }
  // A spell table wherever the town's own building has one but its layout did not place it.
  if (spec.spellTable && !r.npcs.some((n) => n.kind === "spell-table")) r.object(`${spec.id}-spell-table`, "spell-table", "Spell table", r.w - 2, r.d - 3, "spell-table");
  const problems = roomProblems(r.data());
  if (problems.length > 0) throw new Error(`${spec.id}: ${problems.join("; ")}`);
  return r.data();
}

/**
 * What would leave a room unusable: its way in blocked, a stretch of its floor cut off from the door that is not behind
 * a counter, someone nobody can reach to speak to (within two tiles, across a counter).
 */
export function roomProblems(room: InteriorData): string[] {
  const problems: string[] = [];
  const W = room.w;
  const open = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < room.d && (room.tiles[z * W + x]![2] & BLOCKED) === 0 && room.tiles[z * W + x]![1] !== "";
  const [ex, ez] = room.entry;
  if (!open(ex, ez) || !open(ex, ez - 1)) return [`its way in at ${ex},${ez} is not open`];
  const seen = new Set<number>([ez * W + ex]);
  const queue = [[ex, ez] as const];
  while (queue.length > 0) {
    const [x, z] = queue.shift()!;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        if ((!dx && !dz) || !open(nx, nz) || seen.has(nz * W + nx)) continue;
        if (dx && dz && !(open(x + dx, z) && open(x, z + dz))) continue;
        seen.add(nz * W + nx);
        queue.push([nx, nz]);
      }
    }
  }
  for (const n of room.npcs) {
    const reach = n.kind === "spell-table" ? 1 : 2;
    let ok = false;
    for (let dz = -reach; dz <= reach && !ok; dz++) for (let dx = -reach; dx <= reach && !ok; dx++) ok = seen.has((n.z + dz) * W + (n.x + dx)) && n.x + dx >= 0 && n.x + dx < W;
    if (!ok) problems.push(`nobody can reach ${n.id} at ${n.x},${n.z}`);
  }
  let walked = 0;
  for (let z = 0; z < room.d; z++) for (let x = 0; x < W; x++) if (open(x, z)) walked++;
  if (seen.size < walked * 0.8) problems.push(`only ${seen.size} of its ${walked} open tiles are reached from the door`);
  return problems;
}
