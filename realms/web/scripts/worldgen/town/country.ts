// The country round a town: its ground by biome, the sea and its shore, the river; the roads out from the gates to the
// grounds' edge (site.ts, `roadPath`), each leaving the walked ground by its exit with a signpost beside it; the walked
// ground's edge closed by hedgerow, wood, palisade or bog, and the apron past it; then the fields along the roads, a farm,
// the graveyard, and woods and scatter by Poisson-disc sampling, kept off the roads and out of the camera's way.

import type { PropData, XZ } from "../../../src/world/format";
import { BARE, BLOCKED } from "../../../src/world/format";
import { tilesOf } from "../../../src/art/props";
import { S } from "../ids";
import { Use, fbm, texel } from "../land";
import { makeBuilding } from "./buildings";
import type { Ctx } from "./index";
import { type Fields, apron, countryOf, roadPath, treeProp } from "./site";
import { smoothLevels } from "./terrain";
import type { Side } from "./types";
import { propHides } from "./view";

/** Points at least `r` apart over a rectangle, each kept by `ok` (Bridson's Poisson-disc sampling), in a seeded order. */
export function poisson(x0: number, z0: number, x1: number, z1: number, r: number, random: () => number, ok: (x: number, z: number) => boolean, tries = 18): XZ[] {
  const cell = r / Math.SQRT2;
  const cols = Math.ceil((x1 - x0) / cell);
  const rows = Math.ceil((z1 - z0) / cell);
  const grid = new Int32Array(cols * rows).fill(-1);
  const pts: [number, number][] = [];
  const active: number[] = [];
  const fits = (x: number, z: number) => {
    if (x < x0 || z < z0 || x >= x1 || z >= z1) return false;
    const cx = Math.floor((x - x0) / cell);
    const cz = Math.floor((z - z0) / cell);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= cols || gz >= rows) continue;
        const k = grid[gz * cols + gx]!;
        if (k >= 0 && Math.hypot(pts[k]![0] - x, pts[k]![1] - z) < r) return false;
      }
    }
    return true;
  };
  const add = (x: number, z: number) => {
    pts.push([x, z]);
    grid[Math.floor((z - z0) / cell) * cols + Math.floor((x - x0) / cell)] = pts.length - 1;
    active.push(pts.length - 1);
  };
  // Seeds across the rectangle, so a region cut off by what is not ok still fills.
  for (let s = 0; s < Math.max(4, ((x1 - x0) * (z1 - z0)) / (r * r * 20)); s++) {
    const x = x0 + random() * (x1 - x0);
    const z = z0 + random() * (z1 - z0);
    if (fits(x, z)) add(x, z);
  }
  while (active.length > 0) {
    const k = Math.floor(random() * active.length);
    const [px, pz] = pts[active[k]!]!;
    let found = false;
    for (let t = 0; t < tries; t++) {
      const a = random() * Math.PI * 2;
      const d = r * (1 + random());
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d;
      if (fits(x, z)) {
        add(x, z);
        found = true;
      }
    }
    if (!found) active.splice(k, 1);
  }
  return pts.filter(([x, z]) => ok(Math.floor(x), Math.floor(z)));
}

const SIDE_STEP: Record<Side, XZ> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

export function country(ctx: Ctx, f: Fields, phase: "ground" | "roads" | "scenery"): void {
  if (phase === "ground") ground(ctx, f);
  else if (phase === "roads") roads(ctx, f);
  else scenery(ctx, f);
}

/** The country's ground, the sea and the shore, the river; the land's levels from the site's height. */
function ground(ctx: Ctx, f: Fields): void {
  const { land } = ctx;
  const C = countryOf(f.setting.biome);
  const rough = fbm(`${ctx.tag}:rough`, 7, 2);
  for (let z = 0; z < land.depth; z++) {
    for (let x = 0; x < land.width; x++) {
      const i = land.idx(x, z);
      ctx.level[i] = Math.round(f.height(x, z));
      land.flags[i] = 0;
      land.use[i] = Use.Wild;
      land.surface[i] = rough(x, z) > 0.62 ? C.rough : C.ground;
      if (f.isSea(x, z)) {
        land.surface[i] = S.sea;
        land.flags[i] = BLOCKED;
        ctx.level[i] = 0;
      }
    }
  }
  // Shallows along the shore, sand above it in the country.
  const near: number[] = [];
  for (let i = 0; i < land.size; i++) {
    if (land.surface[i] !== S.sea) continue;
    const x = land.xOf(i);
    const z = land.zOf(i);
    let shore = false;
    for (let dz = -2; dz <= 2 && !shore; dz++) for (let dx = -2; dx <= 2 && !shore; dx++) if (land.inside(x + dx, z + dz) && !f.isSea(x + dx, z + dz)) shore = true;
    if (shore) land.surface[i] = S.shallows;
  }
  for (let i = 0; i < land.size; i++) {
    if (land.isWater(i)) continue;
    const x = land.xOf(i);
    const z = land.zOf(i);
    let wet = false;
    for (let dz = -2; dz <= 2 && !wet; dz++) for (let dx = -2; dx <= 2 && !wet; dx++) if (land.inside(x + dx, z + dz) && f.isSea(x + dx, z + dz)) wet = true;
    if (wet) land.surface[i] = S.sand;
  }
  for (const i of ctx.river) {
    land.surface[i] = S.stream;
    land.flags[i] = BLOCKED;
    land.decor.delete(i);
  }
  void near;
}

/**
 * The roads out from the gates, the exits, the walked ground's closed edge and the apron. The country's levels are eased
 * to meet the town's first (a road climbs what it must, by ramps).
 */
function roads(ctx: Ctx, f: Fields): void {
  const { land, plan } = ctx;
  const C = countryOf(f.setting.biome);
  const box = plan.box;
  const inBox = (x: number, z: number) => x >= box.x0 && x < box.x1 && z >= box.z0 && z < box.z1;
  smoothLevels(ctx, (i) => inBox(land.xOf(i), land.zOf(i)) || land.surface[i] === S.sea);
  const random = ctx.random("roads");
  const W = f.walked;
  const inWalked = (x: number, z: number) => x >= W.x0 && x < W.x1 && z >= W.z0 && z < W.z1;
  const onRing = (x: number, z: number) => !inWalked(x, z) && x >= W.x0 - 1 && x <= W.x1 && z >= W.z0 - 1 && z <= W.z1;
  const roadSurface = ctx.town.kind === "capital" || ctx.town.style === "benalish" ? S.road : C.track === S.planks ? S.planks : S.dirt;
  const roadTiles = new Set<number>();
  const flank = new Set<number>();
  plan.gates.forEach((gate) => {
    const way = ctx.spec.setting.ways[gate.way];
    const side = gate.side;
    const [sx, sz] = SIDE_STEP[side];
    // From the passage out to the node, straight.
    const start: XZ = gate.node;
    const wanted = side === "north" || side === "south" ? start[0] : start[1];
    const path = roadPath(
      land,
      start,
      side,
      ctx.level,
      (i) => inBox(land.xOf(i), land.zOf(i)) || land.surface[i] === S.sea || land.surface[i] === S.shallows,
      (i) => ctx.river.has(i),
      wanted,
    );
    if (path.length === 0) throw new Error(`${ctx.town.id}: no road out of its ${side} gate`);
    // The stretch from the passage to the node.
    const lead: XZ[] = [];
    for (let s = 1; s <= 3; s++) lead.push([start[0] - sx * s, start[1] - sz * s]);
    const middle: XZ[] = [...lead.reverse(), ...path.map((i) => [land.xOf(i), land.zOf(i)] as XZ)];
    const half = Math.floor((gate.width - 1) / 2);
    const lo = -half;
    const hi = gate.width - 1 - half;
    let exitAt = -1;
    const crossing: number[] = [];
    const finishBridge = () => {
      if (crossing.length === 0) return;
      const xs = crossing.map((i) => land.xOf(i));
      const zs = crossing.map((i) => land.zOf(i));
      const along = side === "north" || side === "south" ? "z" : "x";
      const [bx0, bz0, bx1, bz1] = along === "z" ? [Math.min(...xs), Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 2] : [Math.min(...xs) - 1, Math.min(...zs), Math.max(...xs) + 2, Math.max(...zs) + 1];
      land.fixtures.push({ id: "bridge", x: bx0, z: bz0, args: { to: [bx1, bz1], y: 0 } });
      crossing.length = 0;
    };
    middle.forEach(([mx, mz], k) => {
      if (exitAt < 0 && k > 3 && onRing(mx, mz)) exitAt = k;
      let wet = false;
      for (let a = lo; a <= hi; a++) {
        for (let b = lo; b <= hi; b++) {
          const x = mx + a;
          const z = mz + b;
          if (!land.inside(x, z) || inBox(x, z)) continue;
          const i = land.idx(x, z);
          if (land.surface[i] === S.sea) continue;
          if (ctx.river.has(i)) {
            wet = true;
            if (!crossing.includes(i)) crossing.push(i);
            land.flags[i] = 0;
            land.use[i] = Use.Road;
            roadTiles.add(i);
            continue;
          }
          land.surface[i] = roadSurface;
          land.flags[i] = 0;
          land.use[i] = Use.Road;
          land.decor.delete(i);
          roadTiles.add(i);
          if (inWalked(x, z) && Math.max(Math.abs(x - start[0]), Math.abs(z - start[1])) < 24) ctx.mustSee[i] = 1;
        }
      }
      if (!wet) finishBridge();
    });
    finishBridge();
    if (exitAt < 0) throw new Error(`${ctx.town.id}: its ${side} road never leaves the walked ground`);
    // The exit: the road's tiles across it on the edge's ring; where one arrives, three in from it.
    const [ex, ez] = middle[exitAt]!;
    const exit: XZ[] = [];
    for (let a = lo; a <= hi; a++) {
      const t: XZ = side === "north" || side === "south" ? [ex + a, ez] : [ex, ez + a];
      if (land.open(land.idx(t[0], t[1]))) exit.push(t);
    }
    const inside = middle[Math.max(0, exitAt - 3)]!;
    ctx.ways.push({ side, inside, exit, ...(way?.to ? { to: way.to } : {}) });
    // The signpost beside the road, just inside the exit, on whichever side is open ground.
    const before = middle[Math.max(0, exitAt - 1)]!;
    for (const s of [hi + 1, lo - 1]) {
      const t: XZ = side === "north" || side === "south" ? [before[0] + s, before[1]] : [before[0], before[1] + s];
      const i = land.idx(t[0], t[1]);
      if (!land.inside(t[0], t[1]) || !land.open(i) || land.use[i] === Use.Road || land.isWater(i)) continue;
      land.put(i, { id: "signpost", x: t[0] + 0.5, z: t[1] + 0.5, args: { arrows: 1, ...(way?.to ? { text: way.to } : {}) } });
      land.use[i] = Use.Kept;
      break;
    }
    // Past the exit, the road runs on into the apron between hedgerows.
    for (let k = exitAt + 1; k < middle.length; k++) {
      const [mx, mz] = middle[k]!;
      for (const s of [lo - 1, hi + 1]) {
        const t: XZ = side === "north" || side === "south" ? [mx + s, mz] : [mx, mz + s];
        if (land.inside(t[0], t[1])) flank.add(land.idx(t[0], t[1]));
      }
    }
  });
  // The walked ground's edge, closed: a ring of hedgerow, wood, palisade or bog; the apron past it, drawn and closed.
  for (let i = 0; i < land.size; i++) {
    const x = land.xOf(i);
    const z = land.zOf(i);
    if (inWalked(x, z) || roadTiles.has(i) || land.isWater(i)) continue;
    apron(land, i);
  }
  const ring: number[] = [];
  for (let i = 0; i < land.size; i++) {
    const x = land.xOf(i);
    const z = land.zOf(i);
    if (!onRing(x, z) || roadTiles.has(i) || land.isWater(i)) continue;
    ring.push(i);
  }
  for (const i of flank) if (!roadTiles.has(i) && !land.isWater(i)) ring.push(i);
  closeEdge(ctx, ring, C.edge, C.trees, random);
}

/** Closes tiles of the walked ground's edge with what the biome closes it with, a prop drawn on every one. */
function closeEdge(ctx: Ctx, tiles: number[], edge: "hedgerow" | "wood" | "palisade" | "bog", trees: readonly string[], random: () => number): void {
  const { land } = ctx;
  const set = new Set(tiles);
  const done = new Set<number>();
  if (edge === "hedgerow" || edge === "palisade") {
    // Straight runs along rows and columns, cut at chunk edges, 12 tiles at most.
    const id = edge === "hedgerow" ? "hedgerow" : "palisade";
    for (const dir of [
      [1, 0],
      [0, 1],
    ] as const) {
      for (const i of tiles) {
        if (done.has(i)) continue;
        const x = land.xOf(i);
        const z = land.zOf(i);
        const prev = land.inside(x - dir[0], z - dir[1]) ? land.idx(x - dir[0], z - dir[1]) : -1;
        if (prev >= 0 && set.has(prev) && !done.has(prev) && Math.floor((x - dir[0]) / 32) === Math.floor(x / 32) && Math.floor((z - dir[1]) / 32) === Math.floor(z / 32)) continue;
        let n = 1;
        while (n < 12) {
          const nx = x + dir[0] * n;
          const nz = z + dir[1] * n;
          if (!land.inside(nx, nz) || Math.floor(nx / 32) !== Math.floor(x / 32) || Math.floor(nz / 32) !== Math.floor(z / 32)) break;
          const j = land.idx(nx, nz);
          if (!set.has(j) || done.has(j)) break;
          n++;
        }
        if (n < 2 && dir[0] === 1) continue;
        const ex = x + dir[0] * (n - 1);
        const ez = z + dir[1] * (n - 1);
        const p: PropData = { id, x: x + 0.5, z: z + 0.5, seed: Math.floor(random() * 16), args: { to: [ex + 0.5, ez + 0.5] } };
        land.fixtures.push(p);
        for (let k = 0; k < n; k++) {
          const j = land.idx(x + dir[0] * k, z + dir[1] * k);
          done.add(j);
          land.flags[j] = BLOCKED | BARE;
          land.use[j] = Use.Wall;
        }
      }
    }
    return;
  }
  for (const i of tiles) {
    const x = land.xOf(i);
    const z = land.zOf(i);
    const id = edge === "bog" && random() < 0.5 ? "reeds" : trees[Math.floor(random() * trees.length)]!;
    if (id === "reeds") {
      land.surface[i] = S.bog;
      land.flags[i] = BLOCKED;
      land.put(i, { id, x: x + 0.5, z: z + 0.5 }, false);
      land.flags[i] = BLOCKED;
    } else land.put(i, treeProp(id, x, z, random, id === "great-tree" ? 0.55 : 1), true);
    land.use[i] = Use.Wall;
  }
}

/** Fields along the roads, a farm, the graveyard, the woods and the scatter, and the apron's trees. */
function scenery(ctx: Ctx, f: Fields): void {
  const { land, plan } = ctx;
  const C = countryOf(f.setting.biome);
  const random = ctx.random("scenery");
  const box = plan.box;
  const W = f.walked;
  const inWalked = (x: number, z: number) => x >= W.x0 && x < W.x1 && z >= W.z0 && z < W.z1;
  const nearBox = (x: number, z: number, m: number) => x >= box.x0 - m && x < box.x1 + m && z >= box.z0 - m && z < box.z1 + m;
  const I = (x: number, z: number) => land.idx(x, z);
  const free = (x: number, z: number) => land.inside(x, z) && land.use[I(x, z)] === Use.Wild && land.open(I(x, z)) && !land.isWater(I(x, z));
  const nearRoad = (x: number, z: number, m: number) => {
    for (let dz = -m; dz <= m; dz++) for (let dx = -m; dx <= m; dx++) if (land.inside(x + dx, z + dz) && land.use[I(x + dx, z + dz)] === Use.Road) return true;
    return false;
  };
  // Fields: in farming country, rectangles beside the roads.
  const farming = C.fields.some((s) => s === S.wheat || s === S.furrows || s === S.straw);
  if (farming) {
    const spots = poisson(W.x0 + 2, W.z0 + 2, W.x1 - 2, W.z1 - 2, 9, random, (x, z) => free(x, z) && !nearBox(x, z, 4) && nearRoad(x, z, 9) && !nearRoad(x, z, 2));
    for (const [px, pz] of spots) {
      const w = 6 + Math.floor(random() * 5);
      const d = 4 + Math.floor(random() * 3);
      const x0 = Math.floor(px - w / 2);
      const z0 = Math.floor(pz - d / 2);
      let ok = true;
      for (let z = z0 - 1; z <= z0 + d && ok; z++) for (let x = x0 - 1; x <= x0 + w && ok; x++) ok = free(x, z) && !nearBox(x, z, 3) && !nearRoad(x, z, 1) && inWalked(x, z);
      if (!ok) continue;
      const surface = C.fields[Math.floor(random() * C.fields.length)]!;
      for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) {
        land.surface[I(x, z)] = surface;
        land.use[I(x, z)] = Use.Field;
      }
    }
  }
  // A farmhouse and its barn by a road outside a town (not the stilts' or the elfhames').
  let farms = 0;
  const style = ctx.town.style === "benalish" ? "village" : ctx.town.style;
  if (!["urborg", "llanowar"].includes(ctx.town.style)) {
    const spots = poisson(W.x0 + 4, W.z0 + 4, W.x1 - 4, W.z1 - 4, 14, random, (x, z) => free(x, z) && !nearBox(x, z, 5) && nearRoad(x, z, 3) && !nearRoad(x, z, 1));
    for (const [px, pz] of spots) {
      if (farms >= (ctx.town.kind === "village" ? 1 : 2)) break;
      // Facing south onto a road below it.
      const x0 = Math.floor(px) - 3;
      const z0 = Math.floor(pz) - 6;
      const w = 7;
      const d = 5;
      let ok = true;
      for (let z = z0 - 1; z <= z0 + d; z++) for (let x = x0 - 1; x <= x0 + w; x++) if (!free(x, z) || nearBox(x, z, 4)) ok = false;
      if (!ok || !nearRoad(x0 + 3, z0 + d + 1, 1)) continue;
      const door: XZ = [x0 + 3, z0 + d];
      const b = makeBuilding(`${ctx.town.id}-farm-${++farms}`, style, "house", { x: x0, z: z0, w, d, rot: 0, door }, random, { storeys: 1 });
      ctx.buildings.push(b);
      for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) {
        land.use[I(x, z)] = Use.Building;
        land.flags[I(x, z)] = BLOCKED | BARE;
      }
      const hay = { id: "haystack", x: x0 + w + 1.5, z: z0 + 2 };
      if (free(x0 + w + 1, z0 + 2) && free(x0 + w + 2, z0 + 2)) place(ctx, hay);
    }
  }
  // The graveyard, outside the walls by a road (towns that have walls).
  if (ctx.F.enclosure === "wall" || ctx.F.enclosure === "palisade") {
    const spots = poisson(W.x0 + 3, W.z0 + 3, W.x1 - 3, W.z1 - 3, 10, random, (x, z) => free(x, z) && !nearBox(x, z, 4) && nearRoad(x, z, 6) && !nearRoad(x, z, 2));
    for (const [px, pz] of spots) {
      const w = 9;
      const d = 6;
      const x0 = Math.floor(px - w / 2);
      const z0 = Math.floor(pz - d / 2);
      let ok = true;
      for (let z = z0 - 1; z <= z0 + d; z++) for (let x = x0 - 1; x <= x0 + w; x++) if (!free(x, z) || nearBox(x, z, 3)) ok = false;
      if (!ok) continue;
      const wall = ctx.town.style === "keldon" ? "palisade" : "stone-wall";
      const runs: [number, number, number, number][] = [
        [x0, z0, x0 + w - 1, z0],
        [x0, z0 + d - 1, x0 + w - 1, z0 + d - 1],
        [x0, z0 + 1, x0, z0 + d - 2],
        [x0 + w - 1, z0 + 1, x0 + w - 1, z0 + d - 2],
      ];
      for (const [ax, az, bx, bz] of runs) land.fixtures.push({ id: wall, x: ax + 0.5, z: az + 0.5, args: { to: [bx + 0.5, bz + 0.5] } });
      for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) {
        const i = I(x, z);
        land.flags[i] = BLOCKED;
        land.use[i] = Use.Wall;
        land.surface[i] = S.grass;
      }
      for (let z = z0 + 1; z < z0 + d - 1; z += 2) for (let x = x0 + 1; x < x0 + w - 1; x += 2) if (random() < 0.7) land.put(I(x, z), { id: "gravestone", x: x + 0.5, z: z + 0.5, turn: texel((random() - 0.5) * 0.3) });
      break;
    }
  }
  // Woods and scatter over the rest of the walked country, kept off the roads and the town's shoulders, never hiding a
  // road near the town; the apron's sparser.
  const wood = C.wood;
  const treeOk = (x: number, z: number, m: number) => free(x, z) && !nearBox(x, z, m) && !nearRoad(x, z, 1) && land.use[I(x, z)] !== Use.Field;
  const r = wood > 0.4 ? 1.8 : wood > 0.2 ? 2.6 : 3.6;
  const dense = fbm(`${ctx.tag}:woods`, 18, 2);
  for (const [px, pz] of poisson(1, 1, land.width - 1, land.depth - 1, r, random, (x, z) => treeOk(x, z, inWalked(x, z) ? 4 : 2))) {
    const x = Math.floor(px);
    const z = Math.floor(pz);
    const walked = inWalked(x, z);
    const d = dense(x, z);
    if (walked && d < 1 - wood - 0.1) {
      if (random() < 0.08) place(ctx, { id: C.undergrowth[Math.floor(random() * C.undergrowth.length)]!, x: x + 0.5, z: z + 0.5, seed: Math.floor(random() * 16) });
      continue;
    }
    if (!walked && d < 0.45 - wood * 0.4) continue;
    const id = C.trees[Math.floor(random() * C.trees.length)]!;
    const p = treeProp(id, x, z, random, id === "great-tree" ? 0.55 : 1);
    if (walked && propHides(p, 0).some(([hx, hz]) => land.inside(hx, hz) && ctx.mustSee[I(hx, hz)] === 1)) continue;
    land.put(I(x, z), p, true);
    if (!walked) land.flags[I(x, z)] = BLOCKED | BARE;
  }
  // The apron in farming country: fields seen beyond the hedges.
  if (farming) {
    const field = fbm(`${ctx.tag}:apron-fields`, 11, 1);
    for (let i = 0; i < land.size; i++) {
      const x = land.xOf(i);
      const z = land.zOf(i);
      if (inWalked(x, z) || land.use[i] !== Use.Wild || land.decor.has(i) || land.isWater(i)) continue;
      const v = field(x, z);
      if (v > 0.58) land.surface[i] = C.fields[Math.floor(v * 97) % C.fields.length]!;
    }
  }
}

/** Stands a prop on the open ground, blocking the tiles it covers as the art catalogue says. */
export function place(ctx: Ctx, p: PropData): void {
  const { tiles, blocks } = tilesOf(p);
  for (const [x, z] of tiles) {
    if (!ctx.land.inside(x, z)) continue;
    const i = ctx.land.idx(x, z);
    if (blocks) {
      ctx.land.flags[i] = BLOCKED | BARE;
      if (ctx.land.use[i] === Use.Wild) ctx.land.use[i] = Use.Kept;
    }
  }
  ctx.land.fixtures.push(p);
}
