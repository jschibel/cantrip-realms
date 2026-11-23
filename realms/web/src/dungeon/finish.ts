// The run's contract on a carved floor (interfaces.md, "Dungeons"; design.md A6): the way up at the arrival, the run's
// encounters through the rooms, the floor's warden on the walk to the stairs down, the boss in the farthest room of the
// last floor with the way out beside it, the spell table by the arrival of the first floor - and every tile of floor
// walked to from the arrival without stepping onto a stair or the way out, which are walked onto only to be taken.
// Then the theme dresses the floor where nobody's way is cut, and the floor's lights are chosen.

import type { LightData, NpcData, TileData } from "../world/format";
import { BLOCKED } from "../world/format";
import { FLOOR, LAVA, type Plan, type Room, STEPS, VOID, WALL, WATER, wallKind } from "./plan";
import type { DungeonFloor, FloorRequest, Spot } from "./types";

/** What a theme's dressing is handed. */
export interface DressContext {
  readonly plan: Plan;
  readonly request: FloorRequest;
  readonly rooms: readonly Room[];
  readonly last: boolean;
  /** The stairs' and arch's stone, for props that match. */
  readonly stone: string;
  /** Whether a prop may stand on (and block) a tile: walkable, crossed by nobody's way, and kept clear of no one. */
  free(x: number, z: number): boolean;
  /** Whether a tile is kept clear (a spot, the stairs, the spell table and round them). */
  kept(x: number, z: number): boolean;
  /** The floor tiles under a back wall (a wall seen face on, north of them), row by row. */
  backWalls(): [number, number][];
}

export interface ThemeDef {
  /** The floor's own surface, and the stone its stairs are built of. */
  readonly floor: string;
  readonly stone: string;
  /** The floor's size in tiles. */
  readonly size: (request: FloorRequest) => readonly [number, number];
  /** Carves the floor's rooms and ways; the first room is the arrival's. */
  readonly carve: (plan: Plan, request: FloorRequest) => Room[];
  /** Dresses the floor once the run's contract is placed: props where they cut no way off, light offers. */
  readonly dress: (ctx: DressContext) => void;
}

/** The most point lights a floor keeps. */
export const MAX_LIGHTS = 16;

/** The `Index` a floor's warden is fought by: the count of its encounters. */
export const wardenIndex = (request: FloorRequest): number => request.run.Encounters.length;
/** The `Index` a floor's boss is fought by: one past its warden's. */
export const bossIndex = (request: FloorRequest): number => request.run.Encounters.length + 1;

const cheb = (ax: number, az: number, bx: number, bz: number) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) ** 2 + (az - bz) ** 2;

export function finish(plan: Plan, rooms: readonly Room[], request: FloorRequest, theme: ThemeDef): DungeonFloor {
  const last = request.floor === request.floors - 1;
  const first = rooms[0]!;
  const nearestWalkable = (x: number, z: number): [number, number] => {
    const all = plan.walkables();
    if (all.length === 0) throw new Error(`${request.theme}: nothing carved`);
    all.sort((a, b) => dist2(a[0], a[1], x, z) - dist2(b[0], b[1], x, z) || a[1] - b[1] || a[0] - b[0]);
    return all[0]!;
  };
  // Pockets nobody can walk to from the arrival room are filled in.
  const fillPockets = (fromX: number, fromZ: number) => {
    const reached = plan.steps(fromX, fromZ);
    for (const [x, z] of plan.walkables()) if (!reached.has(plan.index(x, z))) plan.fill(x, z, WALL);
  };
  const [sx, sz] = nearestWalkable(first.x, first.z);
  fillPockets(sx, sz);

  // The way up: a floor tile of the arrival room under a back wall (the flight climbs into it), the arrival the tile
  // south of it. It is walked onto only to be taken, so it may be no tile any way of the floor goes through.
  const cells = (x: number, z: number) => plan.cell(x, z);
  const underBack = (x: number, z: number) => wallKind(cells, x, z - 1) === "back";
  const upOk = (x: number, z: number) => plan.safe(x, z) && plan.passable(x, z + 1);
  const byNear = (a: [number, number], b: [number, number]) => dist2(a[0], a[1], first.x, first.z) - dist2(b[0], b[1], first.x, first.z) || a[1] - b[1] || a[0] - b[0];
  const walk = plan.walkables().sort(byNear);
  const inFirst = walk.filter(([x, z]) => cheb(x, z, first.x, first.z) <= first.size + 2);
  const up =
    inFirst.find(([x, z]) => underBack(x, z) && upOk(x, z)) ??
    walk.find(([x, z]) => underBack(x, z) && upOk(x, z)) ??
    walk.find(([x, z]) => upOk(x, z)) ??
    walk.find(([x, z]) => plan.safe(x, z)) ??
    walk[0]!;
  plan.stops.add(plan.index(up[0], up[1]));
  const arriveAt: [number, number] = plan.passable(up[0], up[1] + 1)
    ? [up[0], up[1] + 1]
    : ([[0, 1], [1, 0], [-1, 0], [0, -1]] as const).map(([dx, dz]) => [up[0] + dx, up[1] + dz] as [number, number]).find(([x, z]) => plan.passable(x, z)) ?? [sx, sz];
  const [ax, az] = arriveAt;
  fillPockets(ax, az);

  let steps = plan.steps(ax, az);
  const far = (x: number, z: number) => steps.get(plan.index(x, z)) ?? -1;
  /** A room's middle as walked: its own tile if one stands there, else the nearest reached tile. */
  const centreOf = (r: Room): [number, number] => {
    if (plan.passable(r.x, r.z) && far(r.x, r.z) >= 0) return [r.x, r.z];
    const reached = plan.walkables().filter(([x, z]) => far(x, z) >= 0 && plan.passable(x, z));
    reached.sort((a, b) => dist2(a[0], a[1], r.x, r.z) - dist2(b[0], b[1], r.x, r.z) || a[1] - b[1] || a[0] - b[0]);
    return reached[0] ?? [ax, az];
  };
  const others = rooms
    .slice(1)
    .map((room) => ({ room, at: centreOf(room) }))
    .filter((r) => far(r.at[0], r.at[1]) >= 0)
    .sort((a, b) => far(a.at[0], a.at[1]) - far(b.at[0], b.at[1]) || a.at[1] - b.at[1] || a.at[0] - b.at[0]);
  const farthestTile = (): [number, number] => {
    let best: [number, number] = [ax, az];
    for (const [x, z] of plan.walkables()) if (plan.passable(x, z) && far(x, z) > far(best[0], best[1])) best = [x, z];
    return best;
  };
  const end = others.at(-1) ?? { room: { x: farthestTile()[0], z: farthestTile()[1], size: 2 }, at: farthestTile() };

  const taken = new Set<number>([plan.index(up[0], up[1]), plan.index(ax, az)]);
  const isTaken = (x: number, z: number) => taken.has(plan.index(x, z));
  const claim = (x: number, z: number) => taken.add(plan.index(x, z));
  const spots: Spot[] = [];
  /** A free tile near a point, `apart` from everything taken, away from the arrival when it can be. */
  const freeNear = (cx: number, cz: number, apart: number, avoidArrive = 5): [number, number] | null => {
    const want = Math.min(avoidArrive, Math.max(0, far(cx, cz)));
    const options = plan.walkables().filter(([x, z]) => {
      if (!plan.passable(x, z) || isTaken(x, z) || far(x, z) < want) return false;
      for (const t of taken) if (cheb(x, z, t % plan.w, Math.floor(t / plan.w)) < apart) return false;
      return true;
    });
    options.sort((a, b) => dist2(a[0], a[1], cx, cz) - dist2(b[0], b[1], cx, cz) || a[1] - b[1] || a[0] - b[0]);
    return options[0] ?? null;
  };

  let down: [number, number] | null = null;
  let wayOut: [number, number] | null = null;
  if (!last) {
    // The stairs down at the far side of the farthest room.
    const inRoom = plan.walkables().filter(([x, z]) => far(x, z) >= 0 && cheb(x, z, end.at[0], end.at[1]) <= Math.max(2, end.room.size) && !isTaken(x, z));
    inRoom.sort((a, b) => far(b[0], b[1]) - far(a[0], a[1]) || a[1] - b[1] || a[0] - b[0]);
    // A flight down runs north, so the tile south of it is where one steps on from: it must be open.
    down = inRoom.find(([x, z]) => plan.safe(x, z) && plan.passable(x, z + 1) && !isTaken(x, z + 1)) ?? inRoom.find(([x, z]) => plan.safe(x, z)) ?? null;
    if (!down) {
      const any = plan.walkables().filter(([x, z]) => far(x, z) > 0 && !isTaken(x, z) && plan.safe(x, z));
      any.sort((a, b) => far(b[0], b[1]) - far(a[0], a[1]) || a[1] - b[1] || a[0] - b[0]);
      down = any[0] ?? null;
    }
    if (!down) throw new Error(`${request.theme} ${request.seed}/${request.floor}: no place for the stairs down`);
    claim(down[0], down[1]);
    plan.stops.add(plan.index(down[0], down[1]));
    if (request.run.Warden) {
      // On the way to the stairs: two steps back along the walk there.
      const path = plan.path(ax, az, down[0], down[1]);
      const back = [path.at(-3), path.at(-2)].find((t) => t && !isTaken(t[0], t[1]) && plan.passable(t[0], t[1]));
      const at = back ?? freeNear(down[0], down[1], 1, 0);
      if (!at) throw new Error(`${request.theme} ${request.seed}/${request.floor}: no place for the warden`);
      spots.push({ index: wardenIndex(request), mob: request.run.Warden, role: "warden", x: at[0], z: at[1] });
      claim(at[0], at[1]);
    }
  } else if (request.run.Boss) {
    const [bx, bz] = end.at;
    spots.push({ index: bossIndex(request), mob: request.run.Boss, role: "boss", x: bx, z: bz });
    claim(bx, bz);
    const beside = STEPS.slice(0, 4)
      .map(([dx, dz]) => [bx + dx, bz + dz] as [number, number])
      .filter(([x, z]) => plan.passable(x, z) && !isTaken(x, z))
      .sort((a, b) => far(b[0], b[1]) - far(a[0], a[1]) || a[1] - b[1] || a[0] - b[0]);
    wayOut = beside.find(([x, z]) => plan.safe(x, z)) ?? null;
    if (!wayOut) {
      // Further out from the boss if nothing beside it may be taken.
      const near = plan.walkables().filter(([x, z]) => far(x, z) > 0 && !isTaken(x, z) && plan.safe(x, z) && cheb(x, z, bx, bz) <= 3);
      near.sort((a, b) => dist2(a[0], a[1], bx, bz) - dist2(b[0], b[1], bx, bz) || a[1] - b[1] || a[0] - b[0]);
      wayOut = near[0] ?? null;
    }
    if (wayOut) {
      claim(wayOut[0], wayOut[1]);
      plan.stops.add(plan.index(wayOut[0], wayOut[1]));
    }
    if (request.run.Warden) {
      const at = freeNear(bx, bz, 2) ?? freeNear(bx, bz, 1, 0);
      if (!at) throw new Error(`${request.theme} ${request.seed}/${request.floor}: no place for the warden`);
      spots.push({ index: wardenIndex(request), mob: request.run.Warden, role: "warden", x: at[0], z: at[1] });
      claim(at[0], at[1]);
    }
  }
  // The stops are all chosen: whatever they cut off (nothing, as chosen) is no floor.
  fillPockets(ax, az);
  steps = plan.steps(ax, az);

  // The run's encounters, spread over the rooms between, nearest first.
  const between = others.filter((r) => r !== end);
  request.run.Encounters.forEach((encounter, n) => {
    const room = between.length > 0 ? between[n % between.length]! : end;
    const at = freeNear(room.at[0], room.at[1], 3) ?? freeNear(room.at[0], room.at[1], 2) ?? freeNear(room.at[0], room.at[1], 1, 2) ?? freeNear(room.at[0], room.at[1], 1, 0);
    if (!at) throw new Error(`no room on floor ${request.floor} for encounter ${encounter.Index}`);
    spots.push({ index: encounter.Index, mob: encounter.Mob, role: "encounter", x: at[0], z: at[1] });
    claim(at[0], at[1]);
  });

  // What is kept clear: everything taken and round it, the arrival's and the stairs' surroundings.
  const keep = new Set<number>();
  const keepRound = (x: number, z: number, r = 1) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (plan.inside(x + dx, z + dz)) keep.add(plan.index(x + dx, z + dz));
  };
  for (const t of taken) keepRound(t % plan.w, Math.floor(t / plan.w));
  keepRound(ax, az, 1);

  // The entrance's spell table, beside the arrival: against a wall if it can be.
  const npcs: NpcData[] = [];
  if (request.floor === 0) {
    const options: [number, number][] = [];
    for (let r = 1; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) options.push([ax + dx, az + dz]);
    const ok = ([x, z]: [number, number]) => plan.walkable(x, z) && !isTaken(x, z) && plan.safe(x, z) && far(x, z) >= 0 && !plan.stops.has(plan.index(x, z)) && plan.passable(x, z + 1);
    const table = options.find((t) => ok(t) && plan.cell(t[0], t[1] - 1) === WALL && cheb(t[0], t[1], up[0], up[1]) > 1) ?? options.find((t) => ok(t) && cheb(t[0], t[1], up[0], up[1]) > 1) ?? options.find(ok);
    if (!table) throw new Error(`${request.theme} ${request.seed}: no room for the entrance's spell table`);
    plan.block(table[0], table[1], { id: "spell-desk", x: table[0] + 0.5, z: table[1] + 0.45 });
    claim(table[0], table[1]);
    keepRound(table[0], table[1]);
    npcs.push({ id: "spell-desk", x: table[0], z: table[1], kind: "spell-table", name: "Spell table" });
  }

  // The stairs and the way out, drawn.
  plan.put({ id: "dungeon-stairs-up", x: up[0], z: up[1], args: { stone: theme.stone } });
  if (down) {
    plan.surface[plan.index(down[0], down[1])] = "dungeon-stairwell";
    plan.put({ id: "dungeon-stairs-down", x: down[0], z: down[1], args: { stone: theme.stone } });
  }
  if (wayOut) plan.put({ id: "dungeon-way-out", x: wayOut[0], z: wayOut[1] });
  // The way up's arch shows whence one came: a cold light down the stair, as the slice's crypt has.
  plan.light({ kind: "point", at: [up[0] + 0.5, 1.2, up[1] + 0.9], color: [0.45, 0.6, 1], intensity: 2.5, reach: 3.5 }, 100);
  if (wayOut) plan.light({ kind: "point", at: [wayOut[0] + 0.5, 1.4, wayOut[1] + 0.8], color: [1, 0.92, 0.7], intensity: 5, reach: 5 }, 90);

  const ctx: DressContext = {
    plan,
    request,
    rooms,
    last,
    stone: theme.stone,
    kept: (x, z) => keep.has(plan.index(x, z)),
    free: (x, z) => plan.passable(x, z) && !keep.has(plan.index(x, z)) && (steps.get(plan.index(x, z)) ?? -1) >= 0,
    backWalls: () => {
      const out: [number, number][] = [];
      for (let z = 1; z < plan.d; z++) for (let x = 0; x < plan.w; x++) if (plan.cell(x, z) === FLOOR && wallKind(cells, x, z - 1) === "back" && !(x === up[0] && z === up[1])) out.push([x, z]);
      return out;
    },
  };
  theme.dress(ctx);

  return {
    theme: request.theme,
    floor: request.floor,
    last,
    w: plan.w,
    d: plan.d,
    cells: plan.rows(),
    tiles: tilesOf(plan),
    props: plan.props,
    npcs,
    lights: chooseLights(plan, spots, [ax, az]),
    arrive: [ax, az],
    up,
    down,
    wayOut,
    spots,
  };
}

function tilesOf(plan: Plan): TileData[] {
  const tiles: TileData[] = [];
  for (let z = 0; z < plan.d; z++) {
    for (let x = 0; x < plan.w; x++) {
      const i = plan.index(x, z);
      const c = plan.cells[i];
      if (c === FLOOR) tiles.push([0, plan.surface[i] || plan.floorSurface, plan.blocked[i] ? BLOCKED : 0]);
      else if (c === WATER) tiles.push([0, plan.surface[i] || "dungeon-water", BLOCKED]);
      else if (c === LAVA) tiles.push([0, "dungeon-lava", BLOCKED]);
      else tiles.push([0, "", BLOCKED]);
    }
  }
  void VOID;
  return tiles;
}

/**
 * The floor's lights: the brightest offers first, each kept only if it is not crowding one already kept, up to
 * `MAX_LIGHTS` - those by the arrival, the stairs and the fights weigh more, so the light is where the player goes.
 */
function chooseLights(plan: Plan, spots: readonly Spot[], arrive: readonly [number, number]): LightData[] {
  const near = (l: LightData, x: number, z: number, r: number) => dist2(l.at[0], l.at[2], x + 0.5, z + 0.5) <= r * r;
  const scored = plan.lights.map((o, k) => {
    let w = o.weight;
    if (near(o.light, arrive[0], arrive[1], 6)) w += 20;
    for (const s of spots) if (near(o.light, s.x, s.z, 5)) w += 8;
    return { o, w, k };
  });
  scored.sort((a, b) => b.w - a.w || a.k - b.k);
  const kept: LightData[] = [];
  for (const { o } of scored) {
    if (kept.length >= MAX_LIGHTS) break;
    if (o.weight < 50 && kept.some((l) => dist2(l.at[0], l.at[2], o.light.at[0], o.light.at[2]) < 16)) continue;
    kept.push(o.light);
  }
  return kept;
}
