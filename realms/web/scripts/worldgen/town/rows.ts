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
//
// The row planner (planner.ts) of the capital, the cities, the campus and the estate.

import type { StreetWay, TownSquare, XZ } from "../../../src/world/format";
import { BARE, BLOCKED } from "../../../src/world/format";
import { brushOf } from "../../../src/world/streets";
import { S } from "../ids";
import { Use } from "../land";
import { STREET_LIGHT, stand } from "./dress";
import { formOf, groundsOf } from "./forms";
import type { Ctx } from "./index";
import type { Band, Block, Box, ExtraWay, Gate, Graph, Plan, PlanInput, Planner, Site } from "./planner";
import type { Side } from "./types";

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

/** A town of rows' plan: the shared plan, and its rows. */
export interface RowPlan extends Plan {
  /** Each row's ground: its yards at the north, its buildings at the south along the street before it. */
  readonly bands: readonly Band[];
  /** How far each row reaches, x0..x1 (x1 excluded): the town's shape. */
  readonly ext: readonly (readonly [number, number])[];
  readonly streets: readonly Street[];
  readonly connectors: readonly Connector[];
  readonly square: Box & { readonly a: number };
  /** A quay along the north (the sea to the north), or none. */
  readonly northQuay: Band | null;
  /** The level of each row and its street (whole terraces), north to south. */
  readonly levels: readonly number[];
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

export function planTown(input: PlanInput): RowPlan {
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
      fixed.set(a - 1, Math.max(fixed.get(a - 1) ?? 0, a - 1 === 0 && northQuayDepth === 0 ? input.civic[0] + 1 : input.civic[1]));
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
        // In the middle across, not jammed against the walls (on the axis of a landmark at the north edge: the estate's
        // village at its manor's gate, the capital's citadel above its square); level ground.
        cost += Math.abs(midX - (box.x0 + box.x1) / 2) * (tall > 0 ? 1.6 : 0.35);
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
        // No sliver of a block between the square and a lane: its side either on the lane or a block's length from it.
        for (const gap of [qx - (LX0 + westLane), LX1 - eastLane - (qx + sqW)]) if (gap > 0 && gap < F.block[0]) cost += 200;
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

  // --- How far each row reaches: grown out from the square, not the box ------------------------------------------------
  // Each row runs as far east and west as the town's shape and the land let it: the form's profile (an oval for a clan,
  // a lozenge for a city, a loose blob for a village or an elfhame) with each end of each row pulled in by its own noise,
  // never so far that the square, an artery or a block's worth beside them is lost. The wall then traces what is built.
  const ext: [number, number][] = [];
  {
    const half = (LX1 - LX0) / 2;
    const grain = input.shape.noise;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const u = Math.abs(2 * t - 1);
      const base = input.shape.profile === "oval" ? half * (1 - Math.sqrt(Math.max(0, 1 - u * u))) * 0.85 : input.shape.profile === "lozenge" ? half * 0.3 * u ** 1.5 : input.shape.profile === "blob" ? 2 : 0;
      // A side on the sea runs straight along its quay.
      const pull = (side: number) => ((side === 0 && sea.has("west")) || (side === 1 && sea.has("east")) || (k === n - 1 && sea.has("south")) ? 0 : pulled(side));
      const pulled = (side: number) => Math.round(Math.max(0, Math.min(input.shape.most, (base + grain(k * 3.1, side * 5.3) * input.shape.most) * input.shape.scale)));
      ext.push([LX0 + pull(0), LX1 - pull(1)]);
    }
    // What a row must keep: the square (a lane against it, or a block's length beside it), every artery crossing it with a
    // block's length beside it, and a north row no wider than the row after it (whose lanes its street ends on).
    const keep = (k: number, x0: number, x1: number) => {
      const [e0, e1] = ext[k]!;
      let w = Math.min(e0, x0 - westLane - F.block[0]);
      if (x0 - westLane - e0 >= 0 && x0 - westLane - e0 < F.block[0]) w = x0 - westLane;
      let e = Math.max(e1, x1 + eastLane + F.block[0]);
      if (e1 - eastLane - x1 >= 0 && e1 - eastLane - x1 < F.block[0]) e = x1 + eastLane;
      ext[k] = [Math.max(LX0, w), Math.min(LX1, e)];
    };
    keep(a, square.x0, square.x1);
    for (const r of arteries) for (let k = 0; k < n; k++) if (r.z0 < bands[k]!.z1 + W && r.z1 > bands[k]!.z0) keep(k, r.x, r.x + aw);
    if (n > 1) ext[0] = [Math.max(ext[0]![0], ext[1]![0]), Math.min(ext[0]![1], ext[1]![1])];
  }
  const ex0 = (k: number) => ext[Math.max(0, Math.min(n - 1, k))]![0];
  const ex1 = (k: number) => ext[Math.max(0, Math.min(n - 1, k))]![1];
  /** A street's reach: the wider of the rows either side of it. */
  const streetSpan = (k: number): [number, number] => (k < n - 1 ? [Math.min(ex0(k), ex0(k + 1)), Math.max(ex1(k), ex1(k + 1))] : [ex0(k), ex1(k)]);
  // An east or west gate opens where its street ends.
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i]!;
    if (g.side !== "east" && g.side !== "west") continue;
    const k = streetZ.findIndex((z) => mid(z) === g.inner[1]);
    const [s0, s1] = streetSpan(k);
    const mz = g.inner[1];
    gates[i] =
      g.side === "west"
        ? { ...g, passage: { x0: s0 - 1, z0: mz + glo, x1: s0, z1: mz + glo + gw }, node: [s0 - 4, mz], inner: [s0 + Math.floor((westLane - 1) / 2), mz] }
        : { ...g, passage: { x0: s1, z0: mz + glo, x1: s1 + 1, z1: mz + glo + gw }, node: [s1 + 3, mz], inner: [s1 - eastLane + Math.floor((eastLane - 1) / 2), mz] };
  }

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
    let lo = -Infinity;
    let hi = Infinity;
    for (let k = k0; k <= k1; k++) {
      lo = Math.max(lo, ex0(k) + (k === 0 ? 0 : westLane + lw));
      hi = Math.min(hi, ex1(k) - (k === 0 ? 0 : eastLane + lw));
    }
    /** What already takes the way in a row: its lanes, the arteries, the square, the landmarks placed. */
    const takenIn = (k: number): [number, number][] => {
      const out: [number, number][] = [];
      if (k > 0) out.push([ex0(k), ex0(k) + westLane], [ex1(k) - eastLane, ex1(k)]);
      else out.push([ex0(k) - 1, ex0(k)], [ex1(k), ex1(k) + 1]);
      for (const r of arteries) if (r.z0 < bands[k]!.z1 && r.z1 > bands[k]!.z0) out.push([r.x, r.x + aw]);
      for (const s of sites) if (k >= s.k0 && k <= s.k1) out.push([s.box.x0, s.box.x1]);
      if (k === a) out.push([square.x0, square.x1]);
      return out;
    };
    for (let x = lo; x + req.w <= hi; x++) {
      if (blockedX(x, x + req.w, z0, z1)) continue;
      // Room for a connector each side where the rows below the first need one.
      if (k1 > k0 && [...Array(k1 - k0 + 1).keys()].some((d) => x - lw < ex0(k0 + d) + westLane || x + req.w + lw > ex1(k0 + d) - eastLane)) continue;
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
      connectors.push({ x: ex0(k), w: westLane, z0: top - (river && k === a + 1 ? RIVER_WIDTH : 0), z1: b.z1, kind: "lane" });
      connectors.push({ x: ex1(k) - eastLane, w: eastLane, z0: top - (river && k === a + 1 ? RIVER_WIDTH : 0), z1: b.z1, kind: "lane" });
      taken.push([ex0(k), ex0(k) + westLane], [ex1(k) - eastLane, ex1(k)]);
      bandConnectors[k]!.push(ex0(k), ex1(k) - eastLane);
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
      // In line with a connector of the row above only where nothing else can be.
      const any = [...Array(hi2 - lo2 + 1).keys()].some((d) => above.every((c) => Math.abs(c - (lo2 + d)) >= 7));
      for (let x = lo2; x <= hi2; x++) {
        if (any && above.some((c) => Math.abs(c - x) < 7)) continue;
        // Near the middle, but never in line with a connector of the row above: the rows meet the ways down at T
        // junctions, a brick bond rather than a grid.
        const middle = Math.abs(x + lw / 2 - (x0 + x1) / 2) * 0.6;
        const stagger = above.some((c) => Math.abs(c - x) < 7) ? 14 : 0;
        const score = middle + stagger + random() * len * 0.2;
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
    let at = ex0(k);
    for (const [t0, t1] of taken) {
      if (t0 > at) split(at, t0);
      at = Math.max(at, t1);
    }
    if (at < ex1(k)) split(at, ex1(k));
  }

  // --- Streets: each row's, cut where a landmark spans the rows either side ---------------------------------------------
  const streets: Street[] = [];
  for (let k = 0; k < n; k++) {
    let runs: [number, number][] = [streetSpan(k)];
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
    let at = ex0(k);
    let west: Block["west"] = "wall";
    for (const c of all) {
      if (c.p > at) blocks.push({ k, x0: at, x1: c.p, z0, z1: b.z1, west, east: c.what });
      at = Math.max(at, c.q);
      west = c.what;
    }
    if (at < ex1(k)) blocks.push({ k, x0: at, x1: ex1(k), z0, z1: b.z1, west, east: "wall" });
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
  // What the square's furniture keeps off: the arteries' columns through it. Bridges: every way across the river.
  const across = connectors.filter((c) => c.kind === "artery").map((c) => ({ x0: c.x, z0: c.z0, x1: c.x + c.w, z1: c.z1 }));
  const bridges = river ? connectors.filter((c) => !(c.z0 > river.z0 || c.z1 < river.z1)).map((c) => ({ x0: c.x, z0: river.z0 - 1, x1: c.x + c.w, z1: river.z1 + 1 })) : [];
  return { box, inner, bands, ext, streets, connectors, square, gates, sites, blocks, south, northQuay, river, levels, sea, through: across, bridges };
}

// --- The plan as the world keeps it ---------------------------------------------------------------------------------------

/** The plan's streets as a graph (format.ts, `TownPlan`): junctions, the ways between them, the squares, the gates. */
export function planGraph(plan: RowPlan, extra: readonly ExtraWay[] = []): Graph {
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

// --- The ground ------------------------------------------------------------------------------------------------------------

/** Lays the town's ground: its lots, its streets and square, its wall's ring, its quays, the river through it. */
function paintTown(ctx: Ctx): void {
  const { land, F, town } = ctx;
  const plan = ctx.plan as RowPlan;
  const g = groundsOf(town);
  const { box } = plan;
  const tagN = ctx.spec.index + 1;
  const I = (x: number, z: number) => land.idx(x, z);
  const levelAt = (z: number): number => {
    // The row a tile's z lies in (its band or the street after it), by the levels north to south.
    for (let k = 0; k < plan.bands.length; k++) {
      const s = plan.streets[k]!;
      if (z < s.z + s.w) return plan.levels[k]!;
    }
    return plan.levels[plan.levels.length - 1]!;
  };
  // What the town takes of its box: its rows as far as each reaches, its streets, a strip of garden south of a street
  // where the row below it is shorter (so no wall stands close south of a street, hiding it), the river through it, the
  // gardens or the quay inside its south edge, the quay to the north; any hole filled. The ring round that is its edge.
  const mask = ctx.inTown;
  const mark = (x0: number, z0: number, x1: number, z1: number) => {
    for (let z = Math.max(box.z0 + 1, z0); z < Math.min(box.z1 - 1, z1); z++) for (let x = Math.max(box.x0 + 1, x0); x < Math.min(box.x1 - 1, x1); x++) mask[I(x, z)] = 1;
  };
  const n = plan.bands.length;
  plan.bands.forEach((b, k) => mark(plan.ext[k]![0], b.z0, plan.ext[k]![1], b.z1));
  for (const s of plan.streets) {
    for (const [x0, x1] of s.runs) mark(x0, s.z, x1, s.z + s.w);
    const k = s.k;
    if (k < n - 1) {
      const below = plan.bands[k + 1]!;
      const [x0, x1] = s.runs.reduce(([p, q], [a, b]) => [Math.min(p, a), Math.max(q, b)], [Infinity, -Infinity]);
      mark(x0, s.z + s.w, x1, below.z0 + 4);
    }
  }
  const [lx0, lx1] = plan.ext[n - 1]!;
  mark(lx0, plan.south.z0, lx1, plan.south.z1);
  if (plan.northQuay) mark(plan.ext[0]![0], plan.northQuay.z0, plan.ext[0]![1], plan.northQuay.z1);
  for (const c of plan.connectors) mark(c.x, c.z0, c.x + c.w, c.z1);
  {
    // Holes: what the box's edge cannot reach without crossing the town.
    const outside = new Uint8Array(land.size);
    const queue: number[] = [];
    for (let z = box.z0; z < box.z1; z++) for (let x = box.x0; x < box.x1; x++) if ((x === box.x0 || z === box.z0 || x === box.x1 - 1 || z === box.z1 - 1) && !mask[I(x, z)]) {
      outside[I(x, z)] = 1;
      queue.push(I(x, z));
    }
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h]!;
      const x = land.xOf(i);
      const z = land.zOf(i);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < box.x0 || nz < box.z0 || nx >= box.x1 || nz >= box.z1) continue;
        const j = I(nx, nz);
        if (outside[j] || mask[j]) continue;
        outside[j] = 1;
        queue.push(j);
      }
    }
    for (let z = box.z0; z < box.z1; z++) for (let x = box.x0; x < box.x1; x++) if (!outside[I(x, z)]) mask[I(x, z)] = 1;
  }
  for (let z = box.z0; z < box.z1; z++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = I(x, z);
      if (mask[i] === 1) continue;
      let edge = false;
      for (let dz = -1; dz <= 1 && !edge; dz++) for (let dx = -1; dx <= 1 && !edge; dx++) if (mask[I(x + dx, z + dz)] === 1) edge = true;
      if (edge) mask[i] = 2;
    }
  }
  for (let z = box.z0; z < box.z1; z++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = I(x, z);
      if (!mask[i]) continue;
      land.town[i] = tagN;
      land.decor.delete(i);
      land.flags[i] = 0;
      land.surface[i] = g.yard;
      land.use[i] = Use.Lot;
      ctx.level[i] = levelAt(z);
    }
  }
  // The ring: a wall (or hedge, or palisade) where the form has one and the sea does not take the side.
  const sideOf = (x: number, z: number): Side | null => {
    if (mask[I(x, z)] !== 2) return null;
    const inner = (dx: number, dz: number) => mask[I(x + dx, z + dz)] === 1;
    return inner(0, -1) || inner(-1, -1) || inner(1, -1) ? "south" : inner(0, 1) || inner(-1, 1) || inner(1, 1) ? "north" : inner(-1, 0) ? "east" : "west";
  };
  for (let z = box.z0; z < box.z1; z++) {
    for (let x = box.x0; x < box.x1; x++) {
      const side = sideOf(x, z);
      if (!side) continue;
      const i = I(x, z);
      if (plan.sea.has(side) || F.enclosure === "none") {
        // No wall: the town's edge is open ground (a quay's edge on the sea).
        land.surface[i] = plan.sea.has(side) ? g.street : land.surface[i]!;
        land.use[i] = plan.sea.has(side) ? Use.Street : Use.Lot;
        continue;
      }
      land.use[i] = Use.Wall;
      land.flags[i] = BLOCKED | BARE;
    }
  }
  const pave = (x: number, z: number, surface: number, use = Use.Street) => {
    if (!land.inside(x, z)) return;
    const i = I(x, z);
    land.flags[i] = 0;
    land.surface[i] = surface;
    land.use[i] = use;
    land.decor.delete(i);
    ctx.mustSee[i] = 1;
  };
  // The south band: gardens, or the quay on the sea; the north quay.
  if (plan.sea.has("south")) for (let z = plan.south.z0; z < box.z1; z++) for (let x = box.x0; x < box.x1; x++) if (mask[I(x, z)]) pave(x, z, S.planks === g.street ? g.street : S.flagstones);
  if (plan.northQuay) for (let z = box.z0; z < plan.northQuay.z1; z++) for (let x = box.x0; x < box.x1; x++) if (mask[I(x, z)]) pave(x, z, S.flagstones);
  for (const s of plan.streets) for (const [x0, x1] of s.runs) for (let z = s.z; z < s.z + s.w; z++) for (let x = x0; x < x1; x++) pave(x, z, s.quay ? S.flagstones : g.street);
  for (const c of plan.connectors) {
    for (let z = c.z0; z < c.z1; z++) {
      for (let x = c.x; x < c.x + c.w; x++) {
        if (!land.inside(x, z)) continue;
        // Sea-side lanes are quays.
        const quay = (plan.sea.has("west") && c.x === plan.inner.x0) || (plan.sea.has("east") && c.x + c.w === plan.inner.x1);
        pave(x, z, quay ? S.flagstones : c.kind === "artery" ? g.street : F.yards === "open" ? g.path : g.street);
      }
    }
  }
  const sq = plan.square;
  for (let z = sq.z0; z < sq.z1; z++) {
    for (let x = sq.x0; x < sq.x1; x++) {
      if (F.round && Math.hypot((x + 0.5 - (sq.x0 + sq.x1) / 2) / ((sq.x1 - sq.x0) / 2), (z + 0.5 - (sq.z0 + sq.z1) / 2) / ((sq.z1 - sq.z0) / 2)) > 1.05) {
        // Outside the round clearing's ellipse: still its streets where they run.
        if (land.use[I(x, z)] === Use.Street) continue;
      }
      pave(x, z, g.square, Use.Kept);
    }
  }
  // The street along its open south side, in front of it, paved as it is.
  const south = plan.streets[sq.a]!;
  for (let z = south.z; z < south.z + south.w; z++) for (let x = sq.x0; x < sq.x1; x++) if (land.use[I(x, z)] === Use.Street) land.surface[I(x, z)] = g.square;
  // The gates' passages: through the ring, paved.
  for (const gate of plan.gates) for (let z = gate.passage.z0; z < gate.passage.z1; z++) for (let x = gate.passage.x0; x < gate.passage.x1; x++) pave(x, z, g.street);
  // A river through the town: water under the quay, bridges where the connectors cross it.
  if (plan.river) {
    for (let z = plan.river.z0; z < plan.river.z1; z++) {
      for (let x = box.x0; x < box.x1; x++) {
        const i = I(x, z);
        const bridge = land.use[i] === Use.Street;
        land.surface[i] = S.stream;
        land.flags[i] = bridge ? 0 : BLOCKED;
        if (!bridge) {
          land.use[i] = Use.Wild;
          ctx.mustSee[i] = 0;
        }
      }
    }
  }
}

/** Lamps in the gaps between buildings along the main streets' north sides (every street's, in the capital). */
function rowLights(ctx: Ctx, id: string): void {
  const { land, town } = ctx;
  const plan = ctx.plan as RowPlan;
  // In the gaps between buildings along the main streets' north sides, every ten tiles or so.
  for (const s of plan.streets) {
    if (!s.main && formOf(town) !== "capital") continue;
    let last = -100;
    for (const [x0, x1] of s.runs) {
      for (let x = x0 + 2; x < x1 - 2; x++) {
        const z = s.z - 1;
        const i = land.idx(x, z);
        if (land.use[i] !== Use.Lot || x - last < 9) continue;
        if (land.use[land.idx(x - 1, z)] !== Use.Building && land.use[land.idx(x + 1, z)] !== Use.Building) continue;
        stand(ctx, { id, x: x + 0.5, z: z + 0.5 }, Use.Yard);
        last = x;
      }
    }
  }
}

/** The row planner: the capital's, the cities', the campus's and the estate's. */
export const ROWS: Planner = {
  plan: planTown,
  paint: paintTown,
  graph: (plan, extra) => planGraph(plan as RowPlan, extra),
  lights: (ctx) => {
    const id = STREET_LIGHT[ctx.town.style] ?? null;
    if (id) rowLights(ctx, id);
  },
};
