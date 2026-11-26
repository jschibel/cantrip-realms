// A town's streets, planned whole before anything is built, for a camera that looks north from 45 degrees up.
//
// The town is rows. East-west streets are the stages: each row's buildings stand along the north side of the street
// before them, facing south onto it, their yards behind them deep enough that what they hide of the ground behind
// (their height, carried north by the camera's line) falls in the yards and never on the street beyond. So the south
// side of every east-west street is yards, hedges and garden walls - low - and both the street and the fronts across it
// are seen. North-south streets are short connectors between the stages.
//
// - The rows: the town's depth between its north wall and the gardens inside its south wall, partitioned into rows of
//   a form's depth with jitter (`partition`), each followed by its street.
// - The square: the row (and the x) that minimises the walk to every gate, the main gate's counting double, with room
//   north of it for the tall row that commands it; it takes that row's ground in its x-range and the streets either
//   side, so the row north of it fronts onto it and its south side is the yards of the row below, open toward the main
//   gate.
// - The gates: one for each way of the setting, on its side, its artery running straight to the square - a north or
//   south gate's along the square's columns, an east or west gate's along the square's own street.
// - Landmarks (a citadel, a keep, a manor's grounds) take ground across rows first, cutting the streets between and
//   bounded by connectors.
// - The connectors: within each row, the stretches between the lanes inside the walls, the arteries, the square and the
//   landmarks are split recursively, at a jittered point near their middle staggered from the row above's, until no
//   block is longer than the form allows: every block is bounded by streets on all sides, so every walk loops.
// - A river through the town runs along the square's south street (its quay) with a bridge on every connector; the sea
//   takes a side's wall and gives a quay.
// The plan keeps the town's streets as a graph (format.ts, `TownPlan`) for the maps and the lint.

import type { StreetWay, TownSquare, XZ } from "../../../src/world/format";
import { brushOf } from "../../../src/world/streets";
import type { FormSpec } from "./forms";
import type { Side } from "./types";

/** A rectangle of tiles, x0..x1 and z0..z1, the ends excluded. */
export interface Box {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** An east-west street: tiles z..z+w-1 from x0 to x1 (excluded); after row `k`. */
export interface Street {
  readonly k: number;
  readonly z: number;
  readonly w: number;
  /** Its stretches, x0..x1 each (a landmark may cut it). */
  readonly runs: readonly (readonly [number, number])[];
  /** A main street: the square's, a gate's way in. */
  readonly main: boolean;
  /** The quay along a river or the sea. */
  readonly quay?: boolean;
}

/** A north-south way: tiles x..x+w-1 from z0 to z1 (excluded). */
export interface Connector {
  readonly x: number;
  readonly w: number;
  readonly z0: number;
  readonly z1: number;
  readonly kind: "lane" | "artery" | "connector";
}

export interface Gate {
  readonly side: Side;
  /** The way of the setting it serves (its index), or -1. */
  readonly way: number;
  readonly main: boolean;
  /** Its passage through the outline: the tiles of the outline it crosses. */
  readonly passage: Box;
  /** The road's end just outside it: the plan's gate node, where the walk in starts. */
  readonly node: XZ;
  /** Where its way meets the streets inside: a junction of the plan. */
  readonly inner: XZ;
  readonly width: number;
}

/** A row's ground: its yards at the north, its buildings at the south along the street before it. */
export interface Band {
  readonly k: number;
  readonly z0: number;
  readonly z1: number;
}

/** A block: ground between streets, built along its south edge (the street at z1). */
export interface Block {
  readonly k: number;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** Which of its ends lie on a north-south way (it may front onto them too) or the square. */
  readonly west: "lane" | "street" | "square" | "wall" | "site";
  readonly east: "lane" | "street" | "square" | "wall" | "site";
}

/** Ground a landmark takes across rows: from the north of row k0 to the street before row k1. */
export interface Site {
  readonly id: string;
  readonly box: Box;
  readonly k0: number;
  readonly k1: number;
}

/** What the plan asks a landmark's ground to be. */
export interface SiteRequest {
  readonly id: string;
  /** Tiles across, and rows deep (the rows it spans, ending at the row before a street). */
  readonly w: number;
  readonly rows: number;
  /** Where it belongs: the town's north edge on the square's axis, or beside the square to the north. */
  readonly where: "north" | "square";
  /** The depth of what stands on it, when one row must hold it. */
  readonly d?: number;
}

export interface Plan {
  readonly box: Box;
  /** The interior: inside the walls. */
  readonly inner: Box;
  readonly bands: readonly Band[];
  readonly streets: readonly Street[];
  readonly connectors: readonly Connector[];
  readonly square: Box & { readonly a: number };
  readonly gates: readonly Gate[];
  readonly sites: readonly Site[];
  readonly blocks: readonly Block[];
  /** The gardens inside the south wall (or the quay on the sea), z0..z1. */
  readonly south: Band;
  /** A quay along the north (the sea to the north), or none. */
  readonly northQuay: Band | null;
  /** A river through the town: its band, below the square's south street. */
  readonly river: Band | null;
  /** The level of each row and its street (whole terraces), north to south. */
  readonly levels: readonly number[];
  /** Sides that are sea: no wall, a quay. */
  readonly sea: ReadonlySet<Side>;
}

/** The inputs a plan is made from. */
export interface PlanInput {
  readonly box: Box;
  readonly F: FormSpec;
  readonly ways: readonly { readonly side: Side; readonly to: string }[];
  readonly sea: ReadonlySet<Side>;
  readonly river: Side | "through" | undefined;
  /** The land's height, in levels (fractional), at a tile. */
  readonly height: (x: number, z: number) => number;
  readonly sites: readonly SiteRequest[];
  /**
   * What the row fronting the square from the north must hold: its great buildings' depth, and their depth and the
   * ground they hide behind them.
   */
  readonly civic: readonly [number, number];
  readonly random: () => number;
  readonly gateWidth: number;
  /** A tag for errors. */
  readonly id: string;
}

const RIVER_WIDTH = 5;

/**
 * `n` depths in [lo, hi] adding up to `total`, each near total / n, jittered; `fixed` holds some at a depth. Null if they
 * cannot.
 */
export function partition(total: number, n: number, lo: number, hi: number, random: () => number, least: ReadonlyMap<number, number> = new Map()): number[] | null {
  // Each row at its least (a row named in `least` at that, the rest at `lo`), then the rest of the depth handed out a
  // tile at a time: to the rows free to take it first, at random, up to `hi` (a named row up to two past the most of
  // `hi` and its least).
  const min = (k: number) => least.get(k) ?? lo;
  const max = (k: number) => (least.has(k) ? Math.max(least.get(k)!, hi) + 2 : hi);
  const out = Array.from({ length: n }, (_, k) => min(k));
  let rest = total - out.reduce((s, d) => s + d, 0);
  if (rest < 0) return null;
  for (let guard = 0; rest > 0 && guard < 4000; guard++) {
    const open = out.map((d, k) => k).filter((k) => out[k]! < max(k));
    if (open.length === 0) return null;
    const free = open.filter((k) => !least.has(k) || out[k]! < (least.get(k) ?? 0));
    const pool = free.length > 0 && random() < 0.85 ? free : open;
    const k = pool[Math.floor(random() * pool.length)]!;
    out[k]!++;
    rest--;
  }
  return rest === 0 ? out : null;
}

export function planTown(input: PlanInput): Plan {
  const { box, F, sea, random } = input;
  const W = F.street;
  const lw = F.lane;
  // The interior: inside the outline's ring.
  const inner: Box = { x0: box.x0 + 1, z0: box.z0 + 1, x1: box.x1 - 1, z1: box.z1 - 1 };
  // The lanes inside the east and west walls (a quay where the sea is).
  const westLane = sea.has("west") ? lw + 1 : lw;
  const eastLane = sea.has("east") ? lw + 1 : lw;
  const LX0 = inner.x0;
  const LX1 = inner.x1;
  // The rows run from the north (after a quay on the sea) to the gardens (or the quay) inside the south wall.
  // A town on a northern shore has its quay behind its north row; a village keeps its gardens to the water.
  const northQuayDepth = sea.has("north") && F.northQuay !== false ? W : 0;
  const southDepth = sea.has("south") ? W + (F.southBand >= 4 ? 2 : 0) : F.southBand;
  const ZA = inner.z0 + northQuayDepth;
  const ZB = inner.z1 - southDepth;
  const through = input.river === "through";
  const span = ZB - ZA - (through ? RIVER_WIDTH : 0);

  // --- The rows, and the square's row and place: what minimises the walk to every gate ---------------------------------
  const target = F.row[1];
  // The north row: shallow (nothing north of it to hide), but deep enough for what must stand in it.
  const deepest = input.sites.reduce((m, s) => Math.max(m, (s.d ?? 0) + 2), 0);
  // A quay to the north is a street behind the north row: that row keeps a yard as every row does.
  const row0 = Math.max(northQuayDepth > 0 ? F.row[1] : (F.row0 ?? F.row[0] + 1), deepest);
  const counts: number[] = [];
  for (let n = 2; n <= 9; n++) if ((span - n * W - row0) / (n - 1) >= F.row[0] - 1) counts.push(n);
  if (counts.length === 0) throw new Error(`${input.id}: no rows fit ${span} tiles`);
  const sqW = F.square[0];
  const sides = input.ways.map((w) => w.side);
  const mainSide: Side = sides.includes("south") ? "south" : (sides[0] ?? "south");
  const weight = (s: Side) => (s === mainSide ? 2 : 1) * sides.filter((t) => t === s).length;
  const tall = input.sites.reduce((m, s) => Math.max(m, s.where === "north" ? s.rows : 0), 0);
  type Choice = { n: number; a: number; depths: number[]; qx: number; cost: number };
  let best: Choice | null = null;
  for (const n of counts) {
    for (let a = 1; a < n; a++) {
      // The square's row as deep as the square wants; the north row as shallow as it may be (nothing north of it to
      // hide); the row that fronts the square from the north deep enough for the town's great buildings and the ground
      // they hide (none to keep in sight when it is the north row and no quay lies behind it).
      const fixed = new Map([[a, Math.max(F.row[0], Math.min(F.row[2] + 2, F.square[1]))]]);
      fixed.set(0, row0);
      fixed.set(a - 1, Math.max(fixed.get(a - 1) ?? 0, a - 1 === 0 && !sea.has("north") ? input.civic[0] + 1 : input.civic[1]));
      const depths = partition(span - n * W, n, F.row[0], F.row[2] + 1, random, fixed);
      if (process.env.DEBUG_PLAN) console.log("rows", n, a, [...fixed], depths);
      if (!depths) continue;
      const free = depths.filter((_, k) => !fixed.has(k));
      const mean = free.length > 0 ? free.reduce((s, d) => s + d, 0) / free.length : target;
      // Where the square's rows lie.
      let z = ZA;
      const zs: number[] = [];
      for (let k = 0; k < n; k++) {
        zs.push(z);
        z += depths[k]! + W + (through && k === a ? RIVER_WIDTH : 0);
      }
      const sqTop = zs[a]! - W;
      const sqBottom = zs[a]! + depths[a]! + W;
      for (let qx = LX0 + westLane + 2; qx + sqW <= LX1 - eastLane - 2; qx += 1) {
        let cost = 0;
        const midX = qx + sqW / 2;
        const midZ = (sqTop + sqBottom) / 2;
        for (const s of new Set(sides)) {
          const d = s === "north" ? sqTop - box.z0 : s === "south" ? box.z1 - sqBottom : s === "west" ? qx - box.x0 : box.x1 - (qx + sqW);
          cost += weight(s) * d;
        }
        // In the middle across, not jammed against the walls; the hall to the north of it with room behind; level ground.
        cost += Math.abs(midX - (box.x0 + box.x1) / 2) * 0.35;
        if (a < Math.max(1, tall)) cost += 400;
        if (a === n - 1 && sides.includes("south")) cost += 6;
        let lo = Infinity;
        let hi = -Infinity;
        for (let x = qx; x < qx + sqW; x += 3) {
          for (let zz = sqTop; zz < sqBottom; zz += 3) {
            const h = input.height(x, zz);
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
        cost += (hi - lo) * 6 + Math.abs(midZ - (box.z0 + box.z1) / 2) * 0.1;
        // Rows of the depth the form wants, and as many as fit: every row is a street's worth of fronts.
        cost += Math.abs(mean - target) * 3 - n * 60;
        cost += random() * 0.5;
        if (!best || cost < best.cost) best = { n, a, depths, qx, cost };
      }
    }
  }
  if (!best) throw new Error(`${input.id}: no place for its square`);
  const { n, a, depths, qx } = best;

  // --- Bands and streets ----------------------------------------------------------------------------------------------
  const bands: Band[] = [];
  const streetZ: number[] = [];
  let river: Band | null = null;
  {
    let z = ZA;
    for (let k = 0; k < n; k++) {
      bands.push({ k, z0: z, z1: z + depths[k]! });
      z += depths[k]!;
      streetZ.push(z);
      z += W;
      if (through && k === a) {
        river = { k: -1, z0: z, z1: z + RIVER_WIDTH };
        z += RIVER_WIDTH;
      }
    }
    if (z !== ZB) throw new Error(`${input.id}: rows end at ${z}, not ${ZB}`);
  }
  // A river's band belongs to the row after it: its blocks start below the water.
  // The square: its row's ground in its x-range and the street north of it, where the north row fronts onto it; the
  // street south of it runs along its open south side. Shallow enough to be seen whole from its south edge.
  const square = { x0: qx, x1: qx + sqW, z0: streetZ[a - 1]!, z1: streetZ[a]!, a };
  const south: Band = { k: n, z0: ZB, z1: inner.z1 };
  const northQuay: Band | null = northQuayDepth > 0 ? { k: -1, z0: inner.z0, z1: inner.z0 + northQuayDepth } : null;

  // --- Gates: one for each way, its artery straight to the square ------------------------------------------------------
  const gates: Gate[] = [];
  const arteries: { x: number; z0: number; z1: number }[] = [];
  // An artery is as wide as a stage; its gate as wide as it.
  const aw = W;
  const gw = aw;
  const [glo] = brushOf(gw);
  const mid = (z: number) => z + Math.floor((W - 1) / 2);
  const usedX = new Map<Side, number[]>();
  const usedZ = new Map<Side, number[]>();
  input.ways.forEach((way, index) => {
    const side = way.side;
    const main = side === mainSide && !gates.some((g) => g.main);
    if (side === "north" || side === "south") {
      const taken = usedX.get(side) ?? [];
      // A south gate on the square's middle column; a north gate at the square's corner (its north row unbroken); a
      // second gate on a side at the other corner, or further out.
      const options = side === "south" ? [qx + Math.floor((sqW - aw) / 2), qx - aw, square.x1, qx - aw - 14, square.x1 + 14] : [square.x1, qx - aw, qx + Math.floor((sqW - aw) / 2), square.x1 + 14, qx - aw - 14];
      const x = options.find((o) => o >= LX0 + westLane + 2 && o + aw <= LX1 - eastLane - 2 && taken.every((t) => Math.abs(t - o) >= aw + 6));
      if (x === undefined) throw new Error(`${input.id}: no room for a ${side} gate`);
      taken.push(x);
      usedX.set(side, taken);
      const mx = x + Math.floor((aw - 1) / 2);
      if (side === "north") {
        arteries.push({ x, z0: inner.z0, z1: streetZ[a - 1]! });
        gates.push({ side, way: index, main, passage: { x0: mx + glo, z0: box.z0, x1: mx + glo + gw, z1: box.z0 + 1 }, node: [mx, box.z0 - 3], inner: [mx, mid(streetZ[0]!)], width: gw });
      } else {
        arteries.push({ x, z0: streetZ[a]! + W, z1: inner.z1 });
        gates.push({ side, way: index, main, passage: { x0: mx + glo, z0: box.z1 - 1, x1: mx + glo + gw, z1: box.z1 }, node: [mx, box.z1 + 2], inner: [mx, mid(streetZ[n - 1]!)], width: gw });
      }
    } else {
      const taken = usedZ.get(side) ?? [];
      // Along the square's south street, else its north street, else another row's.
      const order = [a, a - 1, ...Array.from({ length: n }, (_, k) => k).filter((k) => k !== a && k !== a - 1)];
      const k = order.find((kk) => kk >= 0 && taken.every((t) => t !== kk));
      if (k === undefined) throw new Error(`${input.id}: no room for a ${side} gate`);
      taken.push(k);
      usedZ.set(side, taken);
      const mz = mid(streetZ[k]!);
      const lane = side === "west" ? LX0 + Math.floor((westLane - 1) / 2) : LX1 - eastLane + Math.floor((eastLane - 1) / 2);
      if (side === "west") gates.push({ side, way: index, main, passage: { x0: box.x0, z0: mz + glo, x1: box.x0 + 1, z1: mz + glo + gw }, node: [box.x0 - 3, mz], inner: [lane, mz], width: gw });
      else gates.push({ side, way: index, main, passage: { x0: box.x1 - 1, z0: mz + glo, x1: box.x1, z1: mz + glo + gw }, node: [box.x1 + 2, mz], inner: [lane, mz], width: gw });
    }
  });
  if (!gates.some((g) => g.main) && gates[0]) gates[0] = { ...gates[0], main: true };

  // --- Landmarks' ground, across rows -----------------------------------------------------------------------------------
  const sites: Site[] = [];
  const blockedX = (x0: number, x1: number, z0: number, z1: number) =>
    arteries.some((r) => r.x < x1 && r.x + aw > x0 && r.z0 < z1 && r.z1 > z0) ||
    sites.some((s) => s.box.x0 < x1 + lw + 1 && s.box.x1 + lw + 1 > x0 && s.box.z0 < z1 && s.box.z1 > z0) ||
    (square.x0 < x1 && square.x1 > x0 && square.z0 < z1 && square.z1 > z0);
  for (const req of input.sites) {
    const k1 = req.where === "north" ? Math.min(req.rows - 1, a - 1) : a - 1;
    const k0 = Math.max(0, k1 - req.rows + 1);
    if (k1 < 0) continue;
    const z0 = bands[k0]!.z0 - (k0 === 0 && northQuay ? 0 : 0);
    const z1 = bands[k1]!.z1;
    let found: Box | null = null;
    let bestCost = Infinity;
    const lo = LX0 + (k0 === 0 ? 0 : westLane + lw);
    const hi = LX1 - (k0 === 0 ? 0 : eastLane + lw);
    /** What already takes the way in a row: its lanes, the arteries, the square, the landmarks placed. */
    const takenIn = (k: number): [number, number][] => {
      const out: [number, number][] = [];
      if (k > 0) out.push([LX0, LX0 + westLane], [LX1 - eastLane, LX1]);
      else out.push([LX0 - 1, LX0], [LX1, LX1 + 1]);
      for (const r of arteries) if (r.z0 < bands[k]!.z1 && r.z1 > bands[k]!.z0) out.push([r.x, r.x + aw]);
      for (const s of sites) if (k >= s.k0 && k <= s.k1) out.push([s.box.x0, s.box.x1]);
      if (k === a) out.push([square.x0, square.x1]);
      return out;
    };
    for (let x = lo; x + req.w <= hi; x++) {
      if (blockedX(x, x + req.w, z0, z1)) continue;
      // Room for a connector each side where the rows below the first need one.
      if (k1 > k0 && (x - lw < LX0 + westLane || x + req.w + lw > LX1 - eastLane)) continue;
      const centre = x + req.w / 2;
      const axis = req.where === "north" ? Math.abs(centre - (square.x0 + square.x1) / 2) * 0.3 : Math.abs(centre - (square.x0 + square.x1) / 2) + (centre > square.x0 && centre < square.x1 ? 0 : 30);
      // No sliver of a block either side: the ground left between it and what stands beside it is none, a connector's,
      // or a block's worth.
      let sliver = 0;
      for (let k = k0; k <= k1; k++) {
        const t = takenIn(k);
        const west = Math.min(...t.filter(([, q]) => q <= x).map(([, q]) => x - q), 999);
        const east = Math.min(...t.filter(([p]) => p >= x + req.w).map(([p]) => p - x - req.w), 999);
        const need = k > 0 && k1 > k0 ? lw : 0;
        for (const g of [west, east]) {
          const left = g - (g > 0 ? need : 0);
          if (g > 0 && (left < 0 || (left > 0 && left < F.block[0]))) sliver += 40;
        }
      }
      const cost = axis + sliver + random() * 2;
      if (cost < bestCost) {
        bestCost = cost;
        found = { x0: x, z0, x1: x + req.w, z1 };
      }
    }
    if (found) sites.push({ id: req.id, box: found, k0, k1 });
  }

  // --- Connectors: lanes, arteries, landmarks' sides, and the stretches between split until no block is too long -----
  const connectors: Connector[] = [];
  for (const r of arteries) connectors.push({ x: r.x, w: aw, z0: r.z0, z1: r.z1, kind: "artery" });
  const bandConnectors: number[][] = bands.map(() => []);
  for (let k = 0; k < n; k++) {
    const b = bands[k]!;
    // Where the way is taken in this row: by the lanes (none in the north row, whose lots run to the walls), the
    // arteries, the square and the landmarks.
    const taken: [number, number][] = [];
    const top = k === 0 ? b.z0 : streetZ[k - 1]! + W + (river && k === a + 1 ? RIVER_WIDTH : 0);
    if (k > 0) {
      connectors.push({ x: LX0, w: westLane, z0: top - (river && k === a + 1 ? RIVER_WIDTH : 0), z1: b.z1, kind: "lane" });
      connectors.push({ x: LX1 - eastLane, w: eastLane, z0: top - (river && k === a + 1 ? RIVER_WIDTH : 0), z1: b.z1, kind: "lane" });
      taken.push([LX0, LX0 + westLane], [LX1 - eastLane, LX1]);
      bandConnectors[k]!.push(LX0, LX1 - eastLane);
    }
    for (const r of arteries) if (r.z0 < b.z1 && r.z1 > b.z0) {
      taken.push([r.x, r.x + aw]);
      bandConnectors[k]!.push(r.x);
    }
    if (k === a) taken.push([square.x0, square.x1]);
    for (const s of sites) {
      if (k < s.k0 || k > s.k1) continue;
      taken.push([s.box.x0, s.box.x1]);
      // A landmark across rows cuts the streets between: connectors either side carry the walk round it.
      if (s.k1 > s.k0 && k > 0) {
        for (const x of [s.box.x0 - lw, s.box.x1]) {
          if (taken.some(([t0, t1]) => x < t1 && x + lw > t0)) continue;
          connectors.push({ x, w: lw, z0: top, z1: b.z1, kind: "connector" });
          taken.push([x, x + lw]);
          bandConnectors[k]!.push(x);
        }
      }
    }
    if (k === 0) continue;
    taken.sort((p, q) => p[0] - q[0]);
    // The free stretches between what is taken, each split until its blocks are short enough.
    const above = bandConnectors[k - 1] ?? [];
    const split = (x0: number, x1: number) => {
      const len = x1 - x0;
      if (len <= F.block[1]) return;
      const lo2 = x0 + F.block[0];
      const hi2 = x1 - F.block[0] - lw;
      if (hi2 < lo2) return;
      let bestX = -1;
      let bestScore = Infinity;
      for (let x = lo2; x <= hi2; x++) {
        const middle = Math.abs(x + lw / 2 - (x0 + x1) / 2);
        const stagger = above.some((c) => Math.abs(c - x) > 0 && Math.abs(c - x) < 6) ? 6 : 0;
        const score = middle + stagger + random() * len * 0.15;
        if (score < bestScore) {
          bestScore = score;
          bestX = x;
        }
      }
      connectors.push({ x: bestX, w: lw, z0: top - (river && k === a + 1 ? RIVER_WIDTH : 0), z1: b.z1, kind: "connector" });
      bandConnectors[k]!.push(bestX);
      split(x0, bestX);
      split(bestX + lw, x1);
    };
    let at = LX0;
    for (const [t0, t1] of taken) {
      if (t0 > at) split(at, t0);
      at = Math.max(at, t1);
    }
    if (at < LX1) split(at, LX1);
  }

  // --- Streets: each row's, cut where a landmark spans the rows either side ---------------------------------------------
  const streets: Street[] = [];
  for (let k = 0; k < n; k++) {
    let runs: [number, number][] = [[LX0, LX1]];
    for (const s of sites) {
      if (k < s.k0 || k >= s.k1) continue;
      runs = runs.flatMap(([x0, x1]) => {
        const out: [number, number][] = [];
        if (s.box.x0 > x0) out.push([x0, Math.min(x1, s.box.x0)]);
        if (s.box.x1 < x1) out.push([Math.max(x0, s.box.x1), x1]);
        return out;
      });
    }
    const main = k === a || k === a - 1 || gates.some((g) => (g.side === "east" || g.side === "west") && g.inner[1] === mid(streetZ[k]!));
    streets.push({ k, z: streetZ[k]!, w: W, runs, main, ...(river && k === a ? { quay: true } : {}) });
  }

  // --- Blocks -------------------------------------------------------------------------------------------------------------
  const blocks: Block[] = [];
  for (let k = 0; k < n; k++) {
    const b = bands[k]!;
    const z0 = k === 0 ? b.z0 : b.z0;
    const cuts = connectors.filter((c) => c.z0 < b.z1 && c.z1 > b.z0).map((c) => [c.x, c.x + c.w, c.kind] as const);
    if (k === a) cuts.push([square.x0, square.x1, "lane"]);
    const siteCuts = sites.filter((s) => k >= s.k0 && k <= s.k1).map((s) => [s.box.x0, s.box.x1] as const);
    const all = [...cuts.map(([p, q, kind]) => ({ p, q, what: kind === "lane" && k === a && p === square.x0 ? ("square" as const) : kind === "lane" ? ("lane" as const) : ("street" as const) })), ...siteCuts.map(([p, q]) => ({ p, q, what: "site" as const }))].sort((u, v) => u.p - v.p);
    let at = LX0;
    let west: Block["west"] = "wall";
    for (const c of all) {
      if (c.p > at) blocks.push({ k, x0: at, x1: c.p, z0, z1: b.z1, west, east: c.what });
      at = Math.max(at, c.q);
      west = c.what;
    }
    if (at < LX1) blocks.push({ k, x0: at, x1: LX1, z0, z1: b.z1, west, east: "wall" });
  }

  // --- Levels: each row at the land's height under it, a level at most from the next, the square's rows one ----------
  const levels: number[] = [];
  for (let k = 0; k < n; k++) {
    const b = bands[k]!;
    let sum = 0;
    let count = 0;
    for (let z = b.z0; z < b.z1 + W; z += 2) for (let x = LX0; x < LX1; x += 3) {
      sum += input.height(x, z);
      count++;
    }
    levels.push(Math.max(1, Math.round(sum / Math.max(1, count))));
  }
  const tie = (p: number, q: number) => {
    const v = Math.max(levels[p]!, levels[q]!);
    levels[p] = v;
    levels[q] = v;
  };
  for (let pass = 0; pass < 6; pass++) {
    tie(a - 1, a);
    for (const s of sites) for (let k = s.k0; k < s.k1; k++) tie(k, k + 1);
    for (let k = 1; k < n; k++) {
      if (levels[k]! > levels[k - 1]! + 1) levels[k] = levels[k - 1]! + 1;
      if (levels[k]! < levels[k - 1]! - 1) levels[k] = levels[k - 1]! - 1;
    }
  }
  return { box, inner, bands, streets, connectors, square, gates, sites, blocks, south, northQuay, river, levels, sea };
}

// --- The plan as the world keeps it ---------------------------------------------------------------------------------------

/** The plan's streets as a graph (format.ts, `TownPlan`): junctions, the ways between them, the squares, the gates. */
export function planGraph(plan: Plan, extra: readonly { readonly a: XZ; readonly b: XZ; readonly width: number; readonly main?: boolean }[] = []): { nodes: XZ[]; ways: StreetWay[]; gates: number[]; squares: TownSquare[] } {
  const nodes: XZ[] = [];
  const index = new Map<string, number>();
  const node = (p: XZ) => {
    const k = `${p[0]},${p[1]}`;
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      index.set(k, i);
      nodes.push([p[0], p[1]]);
    }
    return i;
  };
  const ways: StreetWay[] = [];
  const way = (p: XZ, q: XZ, width: number, main: boolean) => {
    if (p[0] === q[0] && p[1] === q[1]) return;
    ways.push({ a: node(p), b: node(q), width, ...(main ? { main: true } : {}) });
  };
  const midOf = (z: number, w: number) => z + Math.floor((w - 1) / 2);
  // Junctions along each street: every connector meeting it from above or below, its ends.
  for (const s of plan.streets) {
    const zm = midOf(s.z, s.w);
    for (const [x0, x1] of s.runs) {
      const xs = new Set<number>();
      for (const c of plan.connectors) {
        const cm = c.x + Math.floor((c.w - 1) / 2);
        if (cm < x0 || cm >= x1) continue;
        if (c.z1 === s.z || c.z0 === s.z + s.w || (c.z0 <= s.z && c.z1 >= s.z + s.w)) xs.add(cm);
      }
      for (const g of plan.gates) if (g.inner[1] === zm && g.inner[0] >= x0 && g.inner[0] < x1) xs.add(g.inner[0]);
      const sorted = [...xs].sort((p, q) => p - q);
      if (sorted.length === 0) continue;
      for (let i = 1; i < sorted.length; i++) way([sorted[i - 1]!, zm], [sorted[i]!, zm], s.w, s.main);
    }
  }
  // Each connector through every street it meets or crosses, from the street above to the street below (an artery from
  // its gate's node outside).
  for (const c of plan.connectors) {
    const cm = c.x + Math.floor((c.w - 1) / 2);
    const stops = new Set<number>();
    for (const s of plan.streets) {
      if (!s.runs.some(([x0, x1]) => cm >= x0 && cm < x1)) continue;
      if (s.z + s.w >= c.z0 && s.z <= c.z1) stops.add(midOf(s.z, s.w));
    }
    for (const g of plan.gates) if ((g.side === "north" || g.side === "south") && g.node[0] === cm && (g.side === "north" ? c.z0 <= plan.inner.z0 : c.z1 >= plan.inner.z1)) stops.add(g.node[1]);
    const zs = [...stops].sort((p, q) => p - q);
    for (let i = 1; i < zs.length; i++) way([cm, zs[i - 1]!], [cm, zs[i]!], c.w, c.kind === "artery");
  }
  // An east or west gate's way out: from the lane inside to the road's end outside.
  const gates: number[] = [];
  for (const g of plan.gates) {
    if (g.side === "east" || g.side === "west") way(g.inner, g.node, g.width, true);
    gates.push(node(g.node));
  }
  for (const e of extra) way(e.a, e.b, e.width, e.main ?? false);
  // Ways that run the same tiles twice (an artery's stretch and the gate's) are one.
  const seen = new Set<string>();
  const kept = ways.filter((w) => {
    const k = `${Math.min(w.a, w.b)}-${Math.max(w.a, w.b)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const sq = plan.square;
  const squares: TownSquare[] = [{ x: sq.x0, z: sq.z0, w: sq.x1 - sq.x0, d: sq.z1 - sq.z0, name: "The square" }];
  return { nodes, ways: kept, gates, squares };
}
