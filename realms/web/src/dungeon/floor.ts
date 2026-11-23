// A dungeon floor as the browser builds it (interfaces.md, "Dungeons"; design.md A6): a theme's generator carves rooms
// and ways between them out of solid ground, and this places what the run's floor holds - the way up at the arrival,
// the run's encounters through the rooms, the floor's warden before the stairs down, the boss in the last room of the
// last floor, a spell table at the entrance - so that every open hex is reached from the arrival, and nothing placed
// can cut a way off. The same seed gives the same floor.

import { DIRECTIONS, type Hex, distance, hex, key, toWorld } from "../hex";
import { fnv1a32, mulberry32 } from "../random";
import type { NpcData, PropData, Terrain, Theme, TileData } from "../world/schema";

/** What the run's floor holds (`POST /api/dungeon/enter`'s `Floors`). */
export interface RunFloor {
  readonly Encounters: readonly { readonly Index: number; readonly Mob: string }[];
  readonly Warden: string | null;
  readonly Boss: string | null;
}

/** The `Index` the warden and the boss of a floor are fought by (interfaces.md, the dungeon encounter). */
export const WARDEN_INDEX = -1;
export const BOSS_INDEX = -2;

export type Role = "encounter" | "warden" | "boss";

export interface Spot {
  readonly index: number;
  readonly mob: string;
  readonly role: Role;
  readonly q: number;
  readonly r: number;
}

export interface Floor {
  readonly theme: Theme;
  /** From 0 at the entrance. */
  readonly floor: number;
  readonly last: boolean;
  readonly tiles: readonly TileData[];
  readonly props: readonly PropData[];
  readonly npcs: readonly NpcData[];
  /** Where a player stands on arriving. */
  readonly arrive: Hex;
  /** The way up: out of the dungeon (it ends the run). */
  readonly up: Hex;
  /** The stairs down, on every floor but the last. */
  readonly down: Hex | null;
  /** Beside the boss: the way out once it is beaten. */
  readonly wayOut: Hex | null;
  readonly spots: readonly Spot[];
}

export interface Room {
  readonly at: Hex;
  readonly size: number;
}

export interface Look {
  readonly floor: Terrain;
  readonly wall: Terrain;
  readonly wallHeight: number;
  readonly decor: readonly string[];
  readonly lights: boolean;
}

interface Cell {
  terrain: Terrain;
  height: number;
  blocked: boolean;
  prop?: PropData;
}

export const REACH = 26;

/** The ground being carved: every hex within REACH starts solid. */
export class FloorBuilder {
  readonly cells = new Map<string, Cell>();
  readonly random: () => number;

  constructor(
    readonly seed: string,
    readonly look: Look,
  ) {
    this.random = mulberry32(fnv1a32(seed));
    for (let q = -REACH; q <= REACH; q++) {
      for (let r = -REACH; r <= REACH; r++) {
        if (distance(hex(q, r), hex(0, 0)) <= REACH) this.cells.set(`${q},${r}`, { terrain: look.wall, height: look.wallHeight, blocked: true });
      }
    }
  }

  cell(h: Hex): Cell | undefined {
    return this.cells.get(key(h));
  }

  has(h: Hex): boolean {
    return this.cells.has(key(h));
  }

  open = (h: Hex): boolean => this.cells.get(key(h))?.blocked === false;

  /** Opens a hex as floor (never the outermost ring, so every floor is walled in). */
  carve(h: Hex, terrain: Terrain = this.look.floor, height = 0): void {
    const c = this.cells.get(key(h));
    if (!c || distance(h, hex(0, 0)) >= REACH) return;
    c.terrain = terrain;
    c.height = height;
    c.blocked = false;
    c.prop = undefined;
  }

  /** Makes a hex solid again, or a blocking pool. */
  fill(h: Hex, terrain: Terrain = this.look.wall, height = this.look.wallHeight): void {
    const c = this.cells.get(key(h));
    if (!c) return;
    c.terrain = terrain;
    c.height = height;
    c.blocked = true;
    c.prop = undefined;
  }

  disc(at: Hex, radius: number, terrain?: Terrain): void {
    for (let q = -radius; q <= radius; q++) for (let r = -radius; r <= radius; r++) if (distance(hex(q, r), hex(0, 0)) <= radius) this.carve(hex(at.q + q, at.r + r), terrain);
  }

  /** Opens a box of the ground plane, `w` by `d` world units round a hex. */
  rect(at: Hex, w: number, d: number, terrain?: Terrain): void {
    const c = toWorld(at);
    const reach = Math.ceil(Math.max(w, d));
    for (let q = -reach; q <= reach; q++) {
      for (let r = -reach; r <= reach; r++) {
        const h = hex(at.q + q, at.r + r);
        const p = toWorld(h);
        if (Math.abs(p.x - c.x) <= w / 2 && Math.abs(p.z - c.z) <= d / 2) this.carve(h, terrain);
      }
    }
  }

  /** A way between two hexes, `width` hexes either side of the line; wandering when `wander` is given. */
  corridor(a: Hex, b: Hex, width = 0, terrain?: Terrain, wander = 0): void {
    let at = a;
    for (let guard = 0; guard < 400 && (at.q !== b.q || at.r !== b.r); guard++) {
      if (width === 0) this.carve(at, terrain);
      else this.disc(at, width, terrain);
      const steps = DIRECTIONS.map((d) => hex(at.q + d.q, at.r + d.r));
      steps.sort((x, y) => distance(x, b) - distance(y, b) || x.q - y.q || x.r - y.r);
      at = wander > 0 && this.random() < wander && distance(steps[1]!, b) <= distance(at, b) ? steps[1]! : steps[0]!;
    }
    if (width === 0) this.carve(b, terrain);
    else this.disc(b, width, terrain);
  }

  /** Puts scenery on an open hex, blocking it, only where that cuts no way off. */
  put(h: Hex, kind: string, extra: Partial<PropData> = {}, keepOpen = false): boolean {
    const c = this.cells.get(key(h));
    if (!c || c.blocked || c.prop) return false;
    if (keepOpen) {
      c.prop = { q: h.q, r: h.r, kind, ...extra };
      return true;
    }
    if (!this.safe(h)) return false;
    c.blocked = true;
    c.prop = { q: h.q, r: h.r, kind, ...extra };
    return true;
  }

  /** Whether blocking an open hex leaves every way past it open (its open neighbours make one unbroken run). */
  safe(h: Hex): boolean {
    const flags = DIRECTIONS.map((d) => this.open(hex(h.q + d.q, h.r + d.r)));
    if (!flags.some(Boolean)) return false;
    let runs = 0;
    for (let k = 0; k < 6; k++) if (flags[k] && !flags[(k + 5) % 6]) runs++;
    return runs <= 1;
  }

  /** The open hexes, in a fixed order. */
  openHexes(): Hex[] {
    const found: Hex[] = [];
    for (const [k, c] of this.cells) {
      if (c.blocked) continue;
      const [q, r] = k.split(",").map(Number);
      found.push(hex(q!, r!));
    }
    return found.sort((a, b) => a.q - b.q || a.r - b.r);
  }

  /** Walking steps from a hex to every open hex reached. */
  steps(from: Hex): Map<string, number> {
    const seen = new Map<string, number>([[key(from), 0]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const h = queue[i]!;
      const d = seen.get(key(h))!;
      for (const dir of DIRECTIONS) {
        const n = hex(h.q + dir.q, h.r + dir.r);
        if (this.open(n) && !seen.has(key(n))) {
          seen.set(key(n), d + 1);
          queue.push(n);
        }
      }
    }
    return seen;
  }
}

export interface FloorRequest {
  readonly theme: Theme;
  readonly seed: number;
  /** From 0 at the entrance. */
  readonly floor: number;
  readonly floors: number;
  readonly run: RunFloor;
}

/** What a theme's generator hands back: its rooms, the first the arrival's. */
export type Carver = (b: FloorBuilder, request: FloorRequest) => Room[];

/** Places what the run's floor holds in the rooms a theme carved. */
export function finish(b: FloorBuilder, rooms: readonly Room[], request: FloorRequest): Floor {
  const last = request.floor === request.floors - 1;
  const first = rooms[0]!;
  // The way up: a floor hex of the arrival room against its wall, the arrival a step in from it.
  let start = b.open(first.at) ? first.at : b.openHexes().sort((x, y) => distance(x, first.at) - distance(y, first.at))[0]!;
  const reachedFirst = b.steps(start);
  // Pockets nobody can walk to are filled in.
  for (const h of b.openHexes()) if (!reachedFirst.has(key(h))) b.fill(h);
  const nearWall = (h: Hex) => DIRECTIONS.some((d) => !b.open(hex(h.q + d.q, h.r + d.r)));
  const candidatesUp = b.openHexes().filter((h) => distance(h, first.at) <= first.size + 2 && nearWall(h));
  candidatesUp.sort((x, y) => toWorld(y).x + toWorld(y).z - (toWorld(x).x + toWorld(x).z) || x.q - y.q || x.r - y.r);
  const up = candidatesUp.find((h) => DIRECTIONS.filter((d) => b.open(hex(h.q + d.q, h.r + d.r))).length >= 2) ?? start;
  const arrive = DIRECTIONS.map((d) => hex(up.q + d.q, up.r + d.r)).filter(b.open).sort((x, y) => distance(x, first.at) - distance(y, first.at) || x.q - y.q || x.r - y.r)[0] ?? start;
  start = arrive;
  b.put(up, "stairs-up", {}, true);

  const steps = b.steps(arrive);
  const far = (h: Hex) => steps.get(key(h)) ?? 0;
  const roomOrder = rooms.slice(1).filter((r) => steps.has(key(r.at)) || b.openHexes().some((h) => distance(h, r.at) <= r.size && steps.has(key(h))));
  // The last room: the one farthest on foot.
  const centreOf = (room: Room): Hex => {
    if (b.open(room.at) && steps.has(key(room.at))) return room.at;
    return b.openHexes().filter((h) => steps.has(key(h))).sort((x, y) => distance(x, room.at) - distance(y, room.at) || x.q - y.q || x.r - y.r)[0]!;
  };
  const sortedRooms = roomOrder.map((r) => ({ room: r, at: centreOf(r) })).sort((x, y) => far(x.at) - far(y.at) || x.at.q - y.at.q || x.at.r - y.at.r);
  const end = sortedRooms.at(-1) ?? { room: first, at: b.openHexes().filter((h) => steps.has(key(h))).sort((x, y) => far(y) - far(x))[0]! };

  const taken = new Set<string>([key(up), key(arrive)]);
  const spots: Spot[] = [];
  const claim = (h: Hex) => taken.add(key(h));
  const freeNear = (centre: Hex, apart: number, avoidArrive = 5): Hex | null => {
    const options = b.openHexes().filter((h) => steps.has(key(h)) && !taken.has(key(h)) && far(h) >= Math.min(avoidArrive, far(centre)) && [...taken].every((t) => {
      const [q, r] = t.split(",").map(Number);
      return distance(hex(q!, r!), h) >= apart;
    }));
    options.sort((x, y) => distance(x, centre) - distance(y, centre) || x.q - y.q || x.r - y.r);
    return options[0] ?? null;
  };

  let down: Hex | null = null;
  let wayOut: Hex | null = null;
  if (!last) {
    // The stairs down in the far room, at its far side, the warden a step or two before them.
    const inRoom = b.openHexes().filter((h) => steps.has(key(h)) && distance(h, end.at) <= Math.max(2, end.room.size));
    inRoom.sort((x, y) => far(y) - far(x) || x.q - y.q || x.r - y.r);
    down = inRoom.find((h) => DIRECTIONS.filter((d) => b.open(hex(h.q + d.q, h.r + d.r))).length >= 2) ?? end.at;
    claim(down);
    b.put(down, "stairs-down", {}, true);
    if (request.run.Warden) {
      // On the way to the stairs: the hex two steps back along the walk there, or beside them.
      const back = pathTo(b, arrive, down);
      const at = back.length >= 3 ? back[back.length - 3]! : back.length >= 2 ? back[back.length - 2]! : freeNear(down, 1, 0)!;
      spots.push({ index: WARDEN_INDEX, mob: request.run.Warden, role: "warden", q: at.q, r: at.r });
      claim(at);
    }
  } else if (request.run.Boss) {
    spots.push({ index: BOSS_INDEX, mob: request.run.Boss, role: "boss", q: end.at.q, r: end.at.r });
    claim(end.at);
    wayOut = DIRECTIONS.map((d) => hex(end.at.q + d.q, end.at.r + d.r)).filter((h) => b.open(h) && !taken.has(key(h))).sort((x, y) => far(y) - far(x) || x.q - y.q)[0] ?? null;
    if (wayOut) claim(wayOut);
    if (request.run.Warden) {
      const at = freeNear(end.at, 2)!;
      spots.push({ index: WARDEN_INDEX, mob: request.run.Warden, role: "warden", q: at.q, r: at.r });
      claim(at);
    }
  }

  // The run's encounters, spread over the rooms between, nearest first.
  const between = sortedRooms.filter((r) => r !== end);
  request.run.Encounters.forEach((encounter, n) => {
    const room = between.length > 0 ? between[n % between.length]! : end;
    const at = freeNear(room.at, 3) ?? freeNear(room.at, 2) ?? freeNear(room.at, 1, 2);
    if (!at) throw new Error(`no room on floor ${request.floor} for encounter ${encounter.Index}`);
    spots.push({ index: encounter.Index, mob: encounter.Mob, role: "encounter", q: at.q, r: at.r });
    claim(at);
  });

  // The entrance's spell table, beside the arrival.
  const npcs: NpcData[] = [];
  if (request.floor === 0) {
    const table = DIRECTIONS.map((d) => hex(arrive.q + d.q, arrive.r + d.r))
      .concat(DIRECTIONS.map((d) => hex(arrive.q + d.q * 2, arrive.r + d.r * 2)))
      .find((h) => b.open(h) && !taken.has(key(h)) && b.safe(h) && DIRECTIONS.filter((d) => b.open(hex(h.q + d.q, h.r + d.r))).length >= 2);
    if (!table) throw new Error("no room for the entrance's spell table");
    b.cell(table)!.blocked = true;
    claim(table);
    npcs.push({ id: "spell-table", q: table.q, r: table.r, kind: "spell-table", name: "Spell table" });
  }

  // The theme's dressing along the walls, and lights, never in anyone's way.
  const keep = new Set([...taken]);
  for (const s of spots) for (const d of DIRECTIONS) keep.add(`${s.q + d.q},${s.r + d.r}`);
  for (const d of DIRECTIONS) keep.add(`${arrive.q + d.q},${arrive.r + d.r}`);
  if (down) for (const d of DIRECTIONS) keep.add(`${down.q + d.q},${down.r + d.r}`);
  if (wayOut) for (const d of DIRECTIONS) keep.add(`${wayOut.q + d.q},${wayOut.r + d.r}`);
  for (const h of b.openHexes()) {
    if (keep.has(key(h)) || !nearWall(h) || b.cell(h)!.prop) continue;
    const roll = b.random();
    if (b.look.lights && roll < 0.04) b.put(h, "brazier");
    else if (roll < 0.12) b.put(h, b.look.decor[Math.floor(b.random() * b.look.decor.length)]!);
  }

  const tiles: TileData[] = [];
  const props: PropData[] = [];
  for (const [k, c] of b.cells) {
    const [q, r] = k.split(",").map(Number);
    // Solid ground far from any floor is left out: nobody sees it.
    if (c.blocked && !DIRECTIONS.some((d) => b.open(hex(q! + d.q, r! + d.r))) && !DIRECTIONS.some((d) => DIRECTIONS.some((e) => b.open(hex(q! + d.q + e.q, r! + d.r + e.r))))) continue;
    tiles.push([q!, r!, Math.round(c.height * 100) / 100, c.terrain, c.blocked ? 1 : 0]);
    if (c.prop) props.push(c.prop);
  }
  tiles.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  props.sort((x, y) => x.q - y.q || x.r - y.r);
  return { theme: request.theme, floor: request.floor, last, tiles, props, npcs, arrive, up, down, wayOut, spots };
}

/** The shortest walk between two open hexes, both included. */
export function pathTo(b: FloorBuilder, from: Hex, to: Hex): Hex[] {
  const came = new Map<string, Hex | null>([[key(from), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const h = queue[i]!;
    if (h.q === to.q && h.r === to.r) break;
    for (const d of DIRECTIONS) {
      const n = hex(h.q + d.q, h.r + d.r);
      if ((b.open(n) || (n.q === to.q && n.r === to.r)) && !came.has(key(n))) {
        came.set(key(n), h);
        queue.push(n);
      }
    }
  }
  const path: Hex[] = [];
  for (let h: Hex | null | undefined = to; h; h = came.get(key(h))) path.push(h);
  return path.reverse();
}
