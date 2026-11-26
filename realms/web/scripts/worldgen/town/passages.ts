// Footpaths through the yards (design.md A6 "Every town is easy to cross"): once the town's places stand, wherever the
// walk along the ways between two of them (or from a gate to one) is the long way round - more than the lint allows
// (lint.ts TOWN_LIMITS: past `apart` tiles, `detour` times the straight line; nearer, no more than 30 tiles over it) - a
// footpath two tiles wide is cut through the yards between: the cheapest route over a cost field (the ways at their
// length, yards dearer, never under a building or through what the camera cannot see past), its new stretches paved and
// kept in the plan as ways of their own. Any planner's town gets them. And the graph's normalization: a way that ends on
// another's middle line splits that one there, so every junction is a node.

import type { StreetWay, XZ } from "../../../src/world/format";
import { TOWN_LIMITS } from "../../../src/world/lint";
import { pathTiles } from "../../../src/world/streets";
import { Use } from "../land";
import { groundsOf } from "./forms";
import type { Ctx } from "./index";
import { Grid, corners, route } from "./organic";
import type { Placed } from "./place";
import type { Graph } from "./planner";
import { buildingHides } from "./view";

/** A footpath's width. */
export const FOOTPATH = 2;

/** Walks over the town's ways (its must-see open tiles), eight ways without cutting a corner, from a set of tiles. */
function walkFrom(ctx: Ctx, from: readonly XZ[]): Float64Array {
  const { land } = ctx;
  const d = new Float64Array(land.size).fill(Infinity);
  const ok = (x: number, z: number) => land.inside(x, z) && ctx.mustSee[land.idx(x, z)] === 1 && land.open(land.idx(x, z));
  const heap: [number, number][] = [];
  const push = (v: number, i: number) => {
    heap.push([v, i]);
    for (let k = heap.length - 1; k > 0; ) {
      const p = (k - 1) >> 1;
      if (heap[p]![0] <= heap[k]![0]) break;
      [heap[p], heap[k]] = [heap[k]!, heap[p]!];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k]!, heap[m]!];
        k = m;
      }
    }
    return top;
  };
  for (const [x, z] of from) if (ok(x, z)) {
    d[land.idx(x, z)] = 0;
    push(0, land.idx(x, z));
  }
  while (heap.length > 0) {
    const [v, i] = pop();
    if (v > d[i]!) continue;
    const x = land.xOf(i);
    const z = land.zOf(i);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dz) || !ok(x + dx, z + dz)) continue;
      if (dx && dz && !(ok(x + dx, z) && ok(x, z + dz))) continue;
      const j = land.idx(x + dx, z + dz);
      const nv = v + (dx && dz ? Math.SQRT2 : 1);
      if (nv < d[j]!) {
        d[j] = nv;
        push(nv, j);
      }
    }
  }
  return d;
}

/** The open way tiles a walk from a point starts on: the point's own, or those beside it. */
function startsAt(ctx: Ctx, p: XZ): XZ[] {
  const { land } = ctx;
  const out: XZ[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const x = p[0] + dx;
    const z = p[1] + dz;
    if (land.inside(x, z) && ctx.mustSee[land.idx(x, z)] === 1 && land.open(land.idx(x, z))) out.push([x, z]);
  }
  return out;
}

/**
 * Cuts footpaths where walks between the town's key places, and from its gates to them, are the long way round. `points`
 * are those places (their doors, what is used from beside it) and the gates' junctions inside. Returns the paths cut.
 */
export function passages(ctx: Ctx, placed: readonly Placed[], points: readonly { readonly at: XZ; readonly gate: boolean }[]): number {
  const { land } = ctx;
  const g = new Grid(land.width, land.depth);
  // What the camera must see past: the ground the buildings standing hide at any heading is no place for a path.
  const hidden = new Uint8Array(land.size);
  for (const p of placed) {
    // What stands there: the building, the arena's ring, the board beside the inn.
    for (let z = p.f.z; z < p.f.z + p.f.d; z++) for (let x = p.f.x; x < p.f.x + p.f.w; x++) if (land.inside(x, z)) hidden[land.idx(x, z)] = 1;
    if (p.spot && land.inside(p.spot[0], p.spot[1])) hidden[land.idx(p.spot[0], p.spot[1])] = 1;
    if (!p.b) continue;
    for (const [x, z] of buildingHides(p.b, 0)) if (land.inside(x, z)) hidden[land.idx(x, z)] = 1;
  }
  const yard = (i: number) => land.use[i] === Use.Lot && land.open(i) && !land.isWater(i);
  const way = (i: number) => ctx.mustSee[i] === 1 && land.open(i);
  const free = (x: number, z: number) => {
    if (!land.inside(x, z)) return false;
    const i = land.idx(x, z);
    return way(i) || (yard(i) && !hidden[i]);
  };
  // The middle line passes a tile where its width (FOOTPATH: the tile and those east and south of it) is free.
  const pass = (x: number, z: number) => free(x, z) && free(x + 1, z) && free(x, z + 1) && free(x + 1, z + 1);
  const cost = (x: number, z: number) => (way(land.idx(x, z)) ? 1 : 2.2);
  let cut = 0;
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (let a = 0; a < points.length; a++) {
      const from = startsAt(ctx, points[a]!.at);
      if (from.length === 0) continue;
      let walked = walkFrom(ctx, from);
      for (let b = a + 1; b < points.length; b++) {
        if (points[a]!.gate && points[b]!.gate) continue;
        const pa = points[a]!.at;
        const pb = points[b]!.at;
        const straight = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
        if (straight < 6) continue;
        const to = startsAt(ctx, pb);
        if (to.length === 0) continue;
        const walk = Math.min(...to.map(([x, z]) => walked[land.idx(x, z)]!));
        // The lint's rule, with a little to spare (it measures from the gates' road ends outside).
        const long = straight >= TOWN_LIMITS.apart ? walk > straight * TOWN_LIMITS.detour * 0.9 : walk > straight + 26;
        // Not walked to at all is not for a footpath to mend (a place is reached once the rest is laid, or the checks say).
        if (!long || !Number.isFinite(walk)) continue;
        const targets = new Set(to.map(([x, z]) => land.idx(x, z)));
        const t0 = performance.now();
        const r = route(g, { from, goal: (x, z) => targets.has(land.idx(x, z)), toward: pb, pass: (x, z) => pass(x, z) || targets.has(land.idx(x, z)) || from.some((f) => f[0] === x && f[1] === z), cost, turn: 0.3, limit: straight * 3 + 12 });
        if (process.env.DEBUG_PASSAGES) console.log(`route ${pa.join(",")} -> ${pb.join(",")} straight ${straight.toFixed(0)} walk ${walk.toFixed(0)}: ${r ? r.length : "none"} in ${Math.round(performance.now() - t0)} ms`);
        if (!r) continue;
        const tiles = pathTiles(r);
        // Only what is not a way yet is cut; each stretch of it, with the way tile at either end, is a footpath.
        const before = cut;
        let run: XZ[] = [];
        const flush = () => {
          if (run.length >= 2) {
            for (const [x, z] of run) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
              const i = land.idx(x + dx, z + dz);
              if (way(i)) continue;
              land.use[i] = Use.Street;
              land.flags[i] = 0;
              land.decor.delete(i);
              land.surface[i] = groundsOf(ctx.town).path;
              ctx.mustSee[i] = 1;
            }
            const c = corners(run);
            ctx.extraWays.push({ a: c[0]!, b: c[c.length - 1]!, width: FOOTPATH, via: c.slice(1, -1) });
            cut++;
            changed = true;
          }
          run = [];
        };
        for (let k = 0; k < tiles.length; k++) {
          const [x, z] = tiles[k]!;
          const isNew = !way(land.idx(x, z)) || !way(land.idx(x + 1, z)) || !way(land.idx(x, z + 1)) || !way(land.idx(x + 1, z + 1));
          if (isNew) {
            if (run.length === 0 && k > 0) run.push(tiles[k - 1]!);
            run.push([x, z]);
          } else if (run.length > 0) {
            run.push([x, z]);
            flush();
          }
        }
        flush();
        if (cut > before) walked = walkFrom(ctx, from);
      }
    }
    if (!changed) break;
  }
  if (process.env.DEBUG_PASSAGES) console.log(`passages: ${cut} cut`);
  return cut;
}

// --- The graph's junctions -------------------------------------------------------------------------------------------------

/**
 * Every junction a node: a way that ends on another's middle line (inside it, not at its ends) splits that one there; a
 * way that ends beside one (on a tile it paves) is joined to its middle line by a step.
 */
export function normalize(graph: Graph, ends: readonly XZ[]): Graph {
  const wanted = new Set(ends.map((e) => `${e[0]},${e[1]}`));
  const nodes = graph.nodes.map((n) => [n[0], n[1]] as XZ);
  const index = new Map(nodes.map((n, k) => [`${n[0]},${n[1]}`, k]));
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
  let ways: StreetWay[] = [...graph.ways];
  const cache = new Map<StreetWay, XZ[]>();
  const middle = (w: StreetWay) => {
    let m = cache.get(w);
    if (!m) cache.set(w, (m = pathTiles([nodes[w.a]!, ...(w.via ?? []), nodes[w.b]!])));
    return m;
  };
  const degree = () => {
    const d = new Map<number, number>();
    for (const w of ways) {
      d.set(w.a, (d.get(w.a) ?? 0) + 1);
      d.set(w.b, (d.get(w.b) ?? 0) + 1);
    }
    return d;
  };
  for (let guard = 0; guard < 400; guard++) {
    const deg = degree();
    let done = false;
    for (const [k, n] of deg) {
      const p = nodes[k]!;
      if (n !== 1 || graph.gates.includes(k) || !wanted.has(`${p[0]},${p[1]}`)) continue;
      if (graph.squares.some((s) => p[0] >= s.x && p[0] < s.x + s.w && p[1] >= s.z && p[1] < s.z + s.d)) continue;
      // Beside another way's middle line (on a tile it paves): a step to the nearest tile of it, which is then the end.
      let near: { w: StreetWay; at: number; t: XZ; d: number } | null = null;
      for (const w of ways) {
        if (w.a === k || w.b === k) continue;
        const reach = Math.ceil(w.width / 2);
        middle(w).forEach((t, at) => {
          const d = Math.abs(t[0] - p[0]) + Math.abs(t[1] - p[1]);
          if (Math.max(Math.abs(t[0] - p[0]), Math.abs(t[1] - p[1])) <= reach && (!near || d < near.d)) near = { w, at, t, d };
        });
      }
      if (!near) continue;
      const { w, at, t } = near as { w: StreetWay; at: number; t: XZ; d: number };
      const m = middle(w);
      if (t[0] !== p[0] || t[1] !== p[1]) {
        ways.push({ a: k, b: node(t), width: 2 });
        done = true;
      }
      {
        if (at > 0 && at < m.length - 1) {
          // Inside it: it splits there.
          const j = node(t);
          const left = corners(m.slice(0, at + 1));
          const right = corners(m.slice(at));
          const { via: _, ...rest } = w;
          const one: StreetWay = { ...rest, b: j, ...(left.length > 2 ? { via: left.slice(1, -1) } : {}) };
          const two: StreetWay = { ...rest, a: j, ...(right.length > 2 ? { via: right.slice(1, -1) } : {}) };
          ways = ways.filter((x) => x !== w).concat([one, two]);
          done = true;
        }
      }
      if (done) break;
    }
    if (!done) break;
  }
  return { nodes, ways, gates: graph.gates.map((g) => node(graph.nodes[g]!)), squares: graph.squares };
}
