// The run's contract on an arena (interfaces.md, "Dungeons"; design.md A6, "Dungeon runs"): a dungeon is a tournament,
// each floor one arena room. A round has the way back out at the south with the arrival beside it, the gate down at the
// north, and the round's challengers - the run's encounters for the floor - each on a circle of its own spread across the
// floor between; the boss's hall (the last floor) has the boss alone at its head on its throne's circle, and the way out
// beside it. The spell table stands by the arrival of the first floor, the run's shrine at one side of the floor that
// holds it - and every tile of floor is walked to from the arrival without stepping onto the way back, the gate or the
// way out, which are walked onto only to be taken. Then the theme dresses the floor where nobody's way is cut, and the
// floor's lights are chosen.

import type { LightData, NpcData, TileData } from "../world/format";
import { BLOCKED } from "../world/format";
import { FLOOR, LAVA, type Plan, VOID, WALL, WATER, wallKind } from "./plan";
import type { DungeonFloor, FloorRequest, Spot } from "./types";

/** The arena's open floor, the rectangle the theme carves its room in: `x0..x1` by `z0..z1`, both included. */
export interface Arena {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  /** The middle column: the way in at its south end, the gate (or the boss) at its north. */
  readonly cx: number;
  /** The boss's hall: the run's last floor. */
  readonly hall: boolean;
}

/** What a theme's dressing is handed. */
export interface DressContext {
  readonly plan: Plan;
  readonly request: FloorRequest;
  readonly arena: Arena;
  readonly last: boolean;
  /** The stairs' and arch's stone, for props that match. */
  readonly stone: string;
  /** Where the fights stand (the challengers, or the boss). */
  readonly spots: readonly Spot[];
  /** Whether a prop may stand on (and block) a tile: walkable, crossed by nobody's way, and kept clear of no one. */
  free(x: number, z: number): boolean;
  /** Whether a tile is kept clear (a spot, the ways, the spell table and round them). */
  kept(x: number, z: number): boolean;
  /** The floor tiles under a back wall (a wall seen face on, north of them), row by row. */
  backWalls(): [number, number][];
}

/** The colour a theme's challengers' circles and standards glow in (props.ts, `dungeon-ring`). */
export type Hue = "gold" | "red" | "violet" | "green" | "fire" | "blue" | "ichor";

export interface ThemeDef {
  /** The floor's own surface, and the stone its stairs are built of. */
  readonly floor: string;
  readonly stone: string;
  readonly hue: Hue;
  /** The arena's open floor, w by d tiles, for a round or the boss's hall, by the dice. */
  readonly size: (hall: boolean, random: () => number) => readonly [number, number];
  /** Opens the arena's room within its rectangle: its floor, its outline, its pools. */
  readonly carve: (plan: Plan, arena: Arena, request: FloorRequest) => void;
  /** Dresses the floor once the run's contract is placed: props where they cut no way off, light offers. */
  readonly dress: (ctx: DressContext) => void;
}

/** The most point lights a floor keeps. */
export const MAX_LIGHTS = 16;

/**
 * How many of a round's challengers open its gate (design.md A6): all but one of them, at least one - two of three. A
 * floor with none has its gate open.
 */
export const winsToOpen = (challengers: number): number => (challengers <= 0 ? 0 : Math.max(1, challengers - 1));

/** The `Index` a floor's boss is fought by: past its encounters (the hall has none, so 0). */
export const bossIndex = (request: FloorRequest): number => request.run.Encounters.length;

const cheb = (ax: number, az: number, bx: number, bz: number) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) ** 2 + (az - bz) ** 2;

export function finish(plan: Plan, arena: Arena, request: FloorRequest, theme: ThemeDef): DungeonFloor {
  const last = arena.hall;
  const { x0, z0, x1, z1, cx } = arena;

  // What the contract stands on is open whatever the theme carved: the way in, the head of the arena, and the notch in
  // the south wall the way back climbs out through.
  plan.open(cx - 1, z1 - 1, cx + 1, z1);
  plan.open(cx - (last ? 4 : 2), z0, cx + (last ? 4 : 2), z0 + (last ? 4 : 2));
  const up: [number, number] = [cx, z1 + 1];
  plan.open(up[0], up[1], up[0], up[1]);
  const [ax, az]: [number, number] = [cx, z1];

  // Pockets nobody can walk to from the arrival are filled in: rock, or (round the portal's island) nothing.
  const nothing = request.theme === "portal" ? VOID : WALL;
  const fillPockets = () => {
    const reached = plan.steps(ax, az);
    for (const [x, z] of plan.walkables()) if (!reached.has(plan.index(x, z))) plan.fill(x, z, nothing);
  };
  plan.stops.add(plan.index(up[0], up[1]));
  fillPockets();

  const taken = new Set<number>([plan.index(up[0], up[1]), plan.index(ax, az)]);
  const isTaken = (x: number, z: number) => taken.has(plan.index(x, z));
  const claim = (x: number, z: number) => taken.add(plan.index(x, z));
  let steps = plan.steps(ax, az);
  const far = (x: number, z: number) => steps.get(plan.index(x, z)) ?? -1;
  /** A free tile near a point: reached, crossed by nobody, `apart` from everything taken. */
  const freeNear = (px: number, pz: number, apart: number): [number, number] | null => {
    const options = plan.walkables().filter(([x, z]) => {
      if (!plan.passable(x, z) || isTaken(x, z) || far(x, z) < 0) return false;
      for (const t of taken) if (cheb(x, z, t % plan.w, Math.floor(t / plan.w)) < apart) return false;
      return true;
    });
    options.sort((a, b) => dist2(a[0], a[1], px, pz) - dist2(b[0], b[1], px, pz) || a[1] - b[1] || a[0] - b[0]);
    return options[0] ?? null;
  };
  const underBack = (x: number, z: number) => plan.cell(x, z) === FLOOR && wallKind((cx2, cz2) => plan.cell(cx2, cz2), x, z - 1) === "back";

  const spots: Spot[] = [];
  let down: [number, number] | null = null;
  let wayOut: [number, number] | null = null;
  let throne: [number, number] | null = null;
  if (!last) {
    // The gate at the head of the arena, its posts on the tiles either side: only the tile south of it walks onto it.
    down = [cx, z0];
    plan.stops.add(plan.index(cx, z0));
    for (const x of [cx - 1, cx + 1]) plan.blocked[plan.index(x, z0)] = 1;
    claim(cx, z0);
    claim(cx, z0 + 1);
  } else {
    // The boss at the head of its hall before its throne, the way out a few steps beside it under the back wall; a boss
    // that rests this run (design.md A6: refought weekly) leaves its place empty, and the way out stands there all the same.
    throne = [cx, z0];
    plan.blocked[plan.index(cx, z0)] = 1;
    claim(cx, z0);
    const [bx, bz] = [cx, z0 + 2];
    if (request.run.Boss) spots.push({ index: bossIndex(request), mob: request.run.Boss, role: "boss", x: bx, z: bz });
    claim(bx, bz);
    claim(cx, z0 + 1);
    const side = plan.random() < 0.5 ? 1 : -1;
    const options = plan.walkables().filter(([x, z]) => z <= z0 + 2 && underBack(x, z) && plan.safe(x, z) && !isTaken(x, z) && plan.passable(x, z + 1) && cheb(x, z, bx, bz) >= 3);
    options.sort((a, b) => Math.abs(a[0] - (cx + side * 4)) - Math.abs(b[0] - (cx + side * 4)) || a[1] - b[1] || a[0] - b[0]);
    wayOut = options[0] ?? freeNear(cx + side * 4, z0, 2);
    if (!wayOut) throw new Error(`${request.theme} ${request.seed}/${request.floor}: no place for the way out`);
    claim(wayOut[0], wayOut[1]);
    plan.stops.add(plan.index(wayOut[0], wayOut[1]));
  }
  fillPockets();
  steps = plan.steps(ax, az);

  // The round's challengers, spread across the arena between the way in and the gate: a shallow arc, the middle ones
  // nearer the gate, each on a circle of its own with room round it.
  const n = request.run.Encounters.length;
  const iw = x1 - x0 + 1;
  const mid = z0 + (z1 - z0) * 0.5;
  request.run.Encounters.forEach((encounter, i) => {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const px = n === 1 ? cx : x0 + iw * (0.18 + 0.64 * ((t + 1) / 2));
    const pz = mid - (1 - t * t) * (z1 - z0) * 0.18 - (n > 3 && i % 2 === 1 ? 2 : 0);
    const at = freeNear(Math.round(px), Math.round(pz), 4) ?? freeNear(px, pz, 3) ?? freeNear(px, pz, 2) ?? freeNear(px, pz, 1);
    if (!at) throw new Error(`no room on floor ${request.floor} for challenger ${encounter.Index}`);
    spots.push({ index: encounter.Index, mob: encounter.Mob, role: "encounter", x: at[0], z: at[1] });
    claim(at[0], at[1]);
  });

  // What is kept clear: everything taken and round it, wider round the fights and before the gate.
  const keep = new Set<number>();
  const keepRound = (x: number, z: number, r = 1) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (plan.inside(x + dx, z + dz)) keep.add(plan.index(x + dx, z + dz));
  };
  for (const t of taken) keepRound(t % plan.w, Math.floor(t / plan.w));
  for (const s of spots) keepRound(s.x, s.z, 2);
  keepRound(ax, az, 1);
  if (down) for (let x = cx - 2; x <= cx + 2; x++) for (let z = z0; z <= z0 + 2; z++) if (plan.inside(x, z)) keep.add(plan.index(x, z));
  if (wayOut) keepRound(wayOut[0], wayOut[1] + 1, 1);

  // Each challenger's standard behind it, where it cuts no way off.
  for (const s of spots) if (s.role === "encounter" && !isTaken(s.x, s.z - 1)) plan.block(s.x, s.z - 1, { id: "dungeon-standard", x: s.x + 0.5, z: s.z - 0.5, args: { hue: theme.hue } });

  // The entrance's spell table, a few steps beside the arrival.
  const npcs: NpcData[] = [];
  const ok = ([x, z]: [number, number]) => plan.walkable(x, z) && !isTaken(x, z) && !keep.has(plan.index(x, z)) && plan.safe(x, z) && far(x, z) >= 0 && plan.passable(x, z + 1);
  if (request.floor === 0) {
    const options: [number, number][] = [];
    for (const dz of [-1, -2, -3]) for (const dx of [-3, 3, -4, 4, -2, 2, -5, 5]) options.push([cx + dx, z1 + dz]);
    const table = options.find(ok) ?? plan.walkables().filter(ok).sort((a, b) => dist2(a[0], a[1], ax, az) - dist2(b[0], b[1], ax, az) || a[1] - b[1] || a[0] - b[0])[0];
    if (!table) throw new Error(`${request.theme} ${request.seed}: no room for the entrance's spell table`);
    plan.block(table[0], table[1], { id: "spell-desk", x: table[0] + 0.5, z: table[1] + 0.45 });
    claim(table[0], table[1]);
    keepRound(table[0], table[1]);
    npcs.push({ id: "spell-desk", x: table[0], z: table[1], kind: "spell-table", name: "Spell table" });
  }

  // The run's shrine, on the floor that holds it (design.md A6): at one side of the arena, by its west or east wall halfway
  // down, with open floor before it to pray from; it blocks no way.
  let shrine: [number, number] | null = null;
  if (request.run.Shrine) {
    const west = plan.random() < 0.5;
    const edge = west ? x0 + 1 : x1 - 1;
    const options = plan.walkables().filter(ok);
    const score = ([x, z]: [number, number]) => Math.abs(x - edge) * 2 + Math.abs(z - Math.round(mid));
    options.sort((a, b) => score(a) - score(b) || a[1] - b[1] || a[0] - b[0]);
    shrine = options[0] ?? null;
    if (!shrine) throw new Error(`${request.theme} ${request.seed}/${request.floor}: no room for the shrine`);
    plan.block(shrine[0], shrine[1], { id: "dungeon-shrine", x: shrine[0] + 0.5, z: shrine[1] + 0.5, args: { stone: theme.stone } });
    claim(shrine[0], shrine[1]);
    keepRound(shrine[0], shrine[1]);
    keepRound(shrine[0], shrine[1] + 1);
    npcs.push({ id: "heart-shrine", x: shrine[0], z: shrine[1], kind: "heart-shrine", name: "A shrine of Serra" });
    plan.light({ kind: "point", at: [shrine[0] + 0.5, 1.1, shrine[1] + 0.8], color: [1, 0.62, 0.62], intensity: 3, reach: 4 }, 85);
  }

  // The ways, the circles and the throne, drawn.
  plan.put({ id: "dungeon-way-back", x: up[0], z: up[1], args: { stone: theme.stone } });
  plan.light({ kind: "point", at: [up[0] + 0.5, 1.4, up[1] + 0.3], color: [0.6, 0.72, 1], intensity: 3, reach: 4.5 }, 95);
  if (down) {
    plan.put({ id: "dungeon-gate", x: down[0], z: down[1], args: { stone: theme.stone } });
    plan.light({ kind: "point", at: [down[0] + 0.5, 2.2, down[1] + 1.4], color: [1, 0.78, 0.45], intensity: 7, reach: 6.5 }, 100);
  }
  if (wayOut) {
    plan.put({ id: "dungeon-way-out", x: wayOut[0], z: wayOut[1] });
    plan.light({ kind: "point", at: [wayOut[0] + 0.5, 1.4, wayOut[1] + 0.8], color: [1, 0.92, 0.7], intensity: 5, reach: 5 }, 90);
  }
  if (throne) plan.put({ id: "dungeon-throne", x: throne[0] + 0.5, z: throne[1], args: { stone: theme.stone, hue: theme.hue } });
  const glow = HUE_LIGHT[theme.hue];
  for (const s of spots) {
    const boss = s.role === "boss";
    plan.put({ id: "dungeon-ring", x: s.x + 0.5, z: s.z + 0.5, args: { hue: theme.hue, r: boss ? 2.2 : 1.3 } });
    plan.light({ kind: "point", at: [s.x + 0.5, boss ? 3 : 2.2, s.z + 0.9], color: glow, intensity: boss ? 9 : 5.5, reach: boss ? 7.5 : 5 }, boss ? 98 : 80);
  }

  const cells = (x: number, z: number) => plan.cell(x, z);
  const ctx: DressContext = {
    plan,
    request,
    arena,
    last,
    stone: theme.stone,
    spots,
    kept: (x, z) => keep.has(plan.index(x, z)),
    free: (x, z) => plan.passable(x, z) && !keep.has(plan.index(x, z)) && (steps.get(plan.index(x, z)) ?? -1) >= 0,
    backWalls: () => {
      const out: [number, number][] = [];
      for (let z = 1; z < plan.d; z++) for (let x = 0; x < plan.w; x++) if (plan.cell(x, z) === FLOOR && wallKind(cells, x, z - 1) === "back" && !keep.has(plan.index(x, z))) out.push([x, z]);
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
    shrine,
    spots,
  };
}

/** The light each hue's circles cast. */
const HUE_LIGHT: Record<Hue, [number, number, number]> = {
  gold: [1, 0.85, 0.5],
  red: [1, 0.45, 0.32],
  violet: [0.75, 0.5, 1],
  green: [0.55, 1, 0.6],
  fire: [1, 0.6, 0.28],
  blue: [0.5, 0.72, 1],
  ichor: [0.5, 1, 0.45],
};

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
  return tiles;
}

/**
 * The floor's lights: the brightest offers first, each kept only if it is not crowding one already kept, up to
 * `MAX_LIGHTS` - those by the arrival and the fights weigh more, so the light is where the player goes.
 */
function chooseLights(plan: Plan, spots: readonly Spot[], arrive: readonly [number, number]): LightData[] {
  const near = (l: LightData, x: number, z: number, r: number) => dist2(l.at[0], l.at[2], x + 0.5, z + 0.5) <= r * r;
  const scored = plan.lights.map((o, k) => {
    let w = o.weight;
    if (near(o.light, arrive[0], arrive[1], 6)) w += 10;
    for (const s of spots) if (near(o.light, s.x, s.z, 4)) w += 6;
    return { o, w, k };
  });
  scored.sort((a, b) => b.w - a.w || a.k - b.k);
  const kept: LightData[] = [];
  for (const { o } of scored) {
    if (kept.length >= MAX_LIGHTS) break;
    if (o.weight < 50 && kept.some((l) => dist2(l.at[0], l.at[2], o.light.at[0], o.light.at[2]) < 20)) continue;
    kept.push(o.light);
  }
  return kept;
}
