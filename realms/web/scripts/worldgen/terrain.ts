// The travel map's land, grown from the geography's sketch (geography.json, geography.ts): the coast, the regions and
// biomes, the relief as a field, the mountain ranges, the rivers and lakes, quantised to terraces and dressed in their
// grounds. Each layer is a field over the map's tiles:
//
// - The coast: a signed distance field of the traced landmasses (an exact Euclidean distance transform of their raster),
//   sampled through a domain warp and nudged by fractal noise of about a tile - so the coast is ragged at the tile's scale
//   but every bay, cape, strait and islet stays where the sketch put it.
// - Regions: each land tile to its nearest region seed on its landmass, distance over the region's weight, the borders
//   waved by noise. Biomes: the areas painted in order, sampled through a domain warp of several tiles, so a border is
//   a dithered, wandering line, never a ruler's; land no area covers is its region's biome.
// - Relief, in terrace levels: low at the coast and rising inland (by the distance from the sea), each biome's base
//   height and its hills' amplitude (blurred across borders) over fractal noise, mesas for the badlands, ridged dunes for
//   the deserts; the ranges as ridged multifractal noise in a band along each crest by its width and height, with
//   foothills round it; the rivers carved along their lines with a meander and a floodplain graded to their beds; the
//   lakes' shores graded down to them; each place's ground (an icon, an entrance, a landmark, a dock) levelled.
// - The ranges of height 2 and 3 are walls: their band is closed ground (peaks are stood over it, wilds.ts), but for the
//   passes the sketch names (a corridor across the crest, its saddle at the foothills' height) and, in a range of height
//   2, gaps wherever a noise along the crest says. Ranges of height 1 are hills, walked over.
// - Then whole levels (12 texels), the open ground settled so no two open neighbours are more than a level apart
//   (land.ts `settle`), and a ground for every tile by its biome, its wetness and its height.

import { BLOCKED } from "../../src/world/format";
import { distanceTo, fractal, gradient, ridged, signedDistance, warp } from "./fields";
import { GEO_BIOMES, type GeoBiome, type Geography, type XZ, fillPolygon, iconSize, landGrid } from "./geography";
import { S } from "./ids";
import { Heap, LEVEL, type Land, Use } from "./land";
import type { Layout } from "./layout";

/** What the land's fields say of each tile beyond the Land's own arrays (indexed as the Land is, travel map only). */
export interface Terrain {
  /** The travel map's size, tiles (from the world's origin). */
  readonly W: number;
  readonly H: number;
  /** The landmass of each land tile (an index into geo.landmasses), -1 at sea. */
  readonly mass: Int16Array;
  /** Tiles from the sea, inland (0 at sea). */
  readonly inland: Float32Array;
  /** Each land tile's biome, an index into GEO_BIOMES. */
  readonly biome: Uint8Array;
  /** Water: 0 none, 1 river, 2 lake, 3 a mere of the swamp, 4 the sea. */
  readonly water: Uint8Array;
  /** The range a tile's peaks belong to: 1 + its index in geo.mountains where its band is closed, else 0. */
  readonly band: Uint8Array;
  /** How near a range's crest a tile lies, 1 on it and 0 at its band's edge (or beyond). */
  readonly crest: Float32Array;
  /** The crest of a hill range (height 1) a tile lies on (1 + its index), for scattered peaks; else 0. */
  readonly hill: Uint8Array;
  /** Tiles into a wood (forest and jungle), 0 outside it; and into a swamp. */
  readonly forest: Float32Array;
  readonly swamp: Float32Array;
  /** Places' ground (icons, entrances, landmarks, docks and the rings round them): nothing grows or stands there. */
  readonly reserved: Uint8Array;
  /** Each river's tiles' river (1 + its index), for bridges and fords. */
  readonly river: Uint8Array;
}

/** Each biome's ground before the hills, and its hills' height, in levels. */
const RELIEF: Record<GeoBiome, { readonly base: number; readonly amp: number }> = {
  heartland: { base: 0.7, amp: 0.8 },
  plains: { base: 0.6, amp: 0.55 },
  coast: { base: 0.3, amp: 0.6 },
  swamp: { base: 0.0, amp: 0.35 },
  mountains: { base: 2.0, amp: 2.0 },
  volcanic: { base: 1.6, amp: 1.6 },
  forest: { base: 0.9, amp: 1.0 },
  tundra: { base: 1.0, amp: 1.8 },
  waste: { base: 0.9, amp: 1.2 },
  desert: { base: 0.7, amp: 0.8 },
  badlands: { base: 1.2, amp: 1.4 },
  highlands: { base: 1.8, amp: 2.4 },
  jungle: { base: 0.6, amp: 0.9 },
};

/** A range's crest above its feet by its height (1 hills, 2 mountains, 3 the great ranges), levels. */
const RANGE_RISE = [0, 1.6, 3.6, 5.4];

export const biomeIndex = (b: GeoBiome): number => (GEO_BIOMES as readonly string[]).indexOf(b);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A box blur of a travel-map field, `r` tiles each way, in two separable passes over running sums. */
function blur(v: Float32Array, W: number, H: number, LW: number, r: number): Float32Array {
  const tmp = new Float32Array(v.length);
  const out = new Float32Array(v.length);
  for (let z = 0; z < H; z++) {
    let sum = 0;
    let n = 0;
    for (let x = -r; x < W; x++) {
      if (x + r < W) {
        sum += v[z * LW + x + r]!;
        n++;
      }
      if (x - r - 1 >= 0) {
        sum -= v[z * LW + x - r - 1]!;
        n--;
      }
      if (x >= 0) tmp[z * LW + x] = sum / n;
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    let n = 0;
    for (let z = -r; z < H; z++) {
      if (z + r < H) {
        sum += tmp[(z + r) * LW + x]!;
        n++;
      }
      if (z - r - 1 >= 0) {
        sum -= tmp[(z - r - 1) * LW + x]!;
        n--;
      }
      if (z >= 0) out[z * LW + x] = sum / n;
    }
  }
  return out;
}

/** A polyline's points a half tile apart, each with its distance along it and the way it runs there. */
interface Run {
  readonly x: number;
  readonly z: number;
  /** Tiles along the line from its first point. */
  readonly s: number;
  /** The way the line runs here, a unit vector. */
  readonly ux: number;
  readonly uz: number;
}

function densify(points: readonly XZ[], step = 0.5): Run[] {
  const out: Run[] = [];
  let s = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k]!;
    const [bx, bz] = points[k + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len === 0) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    for (let t = 0; t < len; t += step) out.push({ x: ax + ux * t, z: az + uz * t, s: s + t, ux, uz });
    s += len;
  }
  const last = points[points.length - 1]!;
  const prev = out[out.length - 1];
  out.push({ x: last[0], z: last[1], s, ux: prev?.ux ?? 1, uz: prev?.uz ?? 0 });
  return out;
}

/** The line moved sideways by a noise along it, `amount` tiles at most, none at its ends (`taper` tiles to come in). */
function wander(run: Run[], noise: (s: number) => number, amount: number, taper: number): Run[] {
  const length = run[run.length - 1]?.s ?? 0;
  return run.map((p) => {
    const t = Math.min(1, p.s / taper, (length - p.s) / taper);
    const d = noise(p.s) * amount * Math.max(0, t);
    return { ...p, x: p.x - p.uz * d, z: p.z + p.ux * d };
  });
}

export function shapeTravel(land: Land, geo: Geography, layout: Layout): Terrain {
  const seed = layout.seed;
  const [W, H] = geo.size;
  const LW = land.width;
  const N = land.size;
  const at = (x: number, z: number) => z * LW + x;
  const tw = (i: number) => (i % LW) + Math.floor(i / LW) * W; // travel-grid index of a land tile on the travel map
  const inTravel = (i: number) => i % LW < W && Math.floor(i / LW) < H;

  // --- The coast ------------------------------------------------------------------------------------------------------
  const sketch = landGrid(geo);
  const sdf = signedDistance(W, H, (t) => sketch.land[t]! >= 0);
  const coastWarp = warp(`${seed}:coast`, 22, 1.6);
  const coastNoise = fractal(`${seed}:coast-noise`, 9, 3);
  const mass = new Int16Array(N).fill(-1);
  const sampleSdf = (x: number, z: number) => {
    // Bilinear over the travel grid's tile middles.
    const u = Math.max(0, Math.min(W - 1.001, x - 0.5));
    const v = Math.max(0, Math.min(H - 1.001, z - 0.5));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const k = j * W + i;
    return (sdf[k]! * (1 - fu) + sdf[k + 1]! * fu) * (1 - fv) + (sdf[k + W]! * (1 - fu) + sdf[k + W + 1]! * fu) * fv;
  };
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const [wx, wz] = coastWarp(x, z);
      const d = sampleSdf(x + 0.5 + wx, z + 0.5 + wz) + coastNoise(x, z) * 0.7;
      if (d <= 0) continue;
      // Its landmass: the sketch's where it was land, else the one the warp brought it from (or a neighbour's).
      let m = sketch.land[z * W + x]!;
      if (m < 0) {
        const sx = Math.max(0, Math.min(W - 1, Math.floor(x + 0.5 + wx)));
        const sz = Math.max(0, Math.min(H - 1, Math.floor(z + 0.5 + wz)));
        m = sketch.land[sz * W + sx]!;
      }
      for (let r = 1; m < 0 && r <= 3; r++) {
        for (let dz = -r; dz <= r && m < 0; dz++) for (let dx = -r; dx <= r && m < 0; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          if (xx >= 0 && zz >= 0 && xx < W && zz < H) m = sketch.land[zz * W + xx]!;
        }
      }
      if (m >= 0) mass[at(x, z)] = m;
    }
  }
  // A landmass the noise cut in two (a neck of land a few tiles wide) is joined again along the sketch's own land.
  {
    const comp = new Int32Array(W * H).fill(-1);
    const queue = new Int32Array(W * H);
    const sizes: number[] = [];
    const owner: number[] = [];
    for (let t = 0; t < W * H; t++) {
      const li = mass[at(t % W, Math.floor(t / W))]!;
      if (li < 0 || comp[t]! >= 0) continue;
      const id = sizes.length;
      let head = 0;
      let tail = 0;
      queue[tail++] = t;
      comp[t] = id;
      while (head < tail) {
        const u = queue[head++]!;
        const ux = u % W;
        for (const v of [ux > 0 ? u - 1 : -1, ux < W - 1 ? u + 1 : -1, u - W, u + W]) {
          if (v < 0 || v >= W * H || comp[v]! >= 0 || mass[at(v % W, Math.floor(v / W))] !== li) continue;
          comp[v] = id;
          queue[tail++] = v;
        }
      }
      sizes.push(tail);
      owner.push(li);
    }
    const biggest = new Map<number, number>();
    sizes.forEach((n, id) => {
      const li = owner[id]!;
      const b = biggest.get(li);
      if (b === undefined || n > sizes[b]!) biggest.set(li, id);
    });
    const came = new Int32Array(W * H);
    sizes.forEach((n, id) => {
      const li = owner[id]!;
      const main = biggest.get(li)!;
      if (id === main || n < 12) return;
      // The cheapest way over the sketch's land (a step 1), or a tile or two of its sea where its raster's neck is only
      // a diagonal (a step 6).
      came.fill(-2);
      const cost = new Float64Array(W * H).fill(Infinity);
      const heap = new Heap();
      for (let t = 0; t < W * H; t++) if (comp[t] === id) {
        cost[t] = 0;
        came[t] = -1;
        heap.push(t, 0);
      }
      let reached = -1;
      while (heap.size > 0) {
        const u = heap.pop();
        if (comp[u] === main) {
          reached = u;
          break;
        }
        const ux = u % W;
        for (const v of [ux > 0 ? u - 1 : -1, ux < W - 1 ? u + 1 : -1, u - W, u + W]) {
          if (v < 0 || v >= W * H) continue;
          const other = mass[at(v % W, Math.floor(v / W))]!;
          if (other >= 0 && other !== li) continue;
          const c = cost[u]! + (sketch.land[v] === li ? 1 : 6);
          if (c >= cost[v]! || c > 60) continue;
          cost[v] = c;
          came[v] = u;
          heap.push(v, c);
        }
      }
      for (let u = reached; u >= 0 && comp[u] !== id; u = came[u]!) {
        // The neck two tiles wide at the least.
        for (const v of [u, u + 1, u + W]) if (v < W * H && (v === u || sketch.land[v] === li)) {
          mass[at(v % W, Math.floor(v / W))] = li;
          comp[v] = main;
        }
      }
    });
  }
  // The places' ground is land whatever the noise says, and so is the sketch's ground under them.
  const reserved = new Uint8Array(N);
  const places: { at: XZ; half: number; ring: number }[] = [
    ...Object.entries(geo.towns).map(([id, t]) => ({ at: t.at, half: (iconSize(layout.towns.find((l) => l.id === id)?.kind ?? "village") - 1) / 2, ring: 2 })),
    ...Object.values(geo.dungeons).map((d) => ({ at: d.at, half: 2, ring: 1 })),
    ...geo.landmarks.map((l) => ({ at: l.at, half: 1, ring: 2 })),
    ...geo.ferries.flatMap((f) => [f.from, f.to].map((p) => ({ at: p, half: 0, ring: 1 }))),
  ];
  for (const p of places) {
    const r = p.half + p.ring;
    for (let z = p.at[1] - r; z <= p.at[1] + r; z++) for (let x = p.at[0] - r; x <= p.at[0] + r; x++) {
      const m = sketch.land[z * W + x]!;
      if (m >= 0 && mass[at(x, z)]! < 0) mass[at(x, z)] = m;
      if (m >= 0) reserved[at(x, z)] = 1;
    }
  }
  // No one-tile islet the noise made of the sea: a lone land tile with sea all round goes back under.
  for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
    const i = at(x, z);
    if (mass[i]! < 0 || reserved[i]) continue;
    if (mass[i - 1]! < 0 && mass[i + 1]! < 0 && mass[i - LW]! < 0 && mass[i + LW]! < 0) mass[i] = -1;
  }
  const isLand = (i: number) => inTravel(i) && mass[i]! >= 0;
  const inlandT = distanceTo(W, H, (t) => mass[at(t % W, Math.floor(t / W))]! < 0);
  const fromLandT = distanceTo(W, H, (t) => mass[at(t % W, Math.floor(t / W))]! >= 0);
  const inland = new Float32Array(N);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) inland[at(x, z)] = mass[at(x, z)]! >= 0 ? inlandT[z * W + x]! : 0;

  // --- Regions ----------------------------------------------------------------------------------------------------------
  const regionWave = fractal(`${seed}:region-borders`, 40, 3);
  const seedsOn = geo.landmasses.map((l, li) => {
    const own = geo.regions.flatMap((r, k) => r.seeds.filter((s) => sketch.land[s[1] * W + s[0]] === li).map((s) => ({ k, s, w: r.weight ?? 1 })));
    return own.length > 0 ? own : geo.regions.flatMap((r, k) => r.seeds.map((s) => ({ k, s, w: r.weight ?? 1 })));
  });
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, z);
      if (!isLand(i)) continue;
      const wave = 1 + 0.12 * regionWave(x, z);
      let best = 0;
      let bestD = Infinity;
      for (const { k, s, w } of seedsOn[mass[i]!]!) {
        const d = (Math.hypot(x - s[0], z - s[1]) / w) * (k % 2 === 0 ? wave : 2 - wave);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      land.region[i] = best;
    }
  }

  // --- Biomes: the areas, painted in order, sampled through a warp --------------------------------------------------------
  const areaT = new Int16Array(W * H).fill(-1);
  geo.areas.forEach((a, k) => {
    const one = fillPolygon(a.points, W, H);
    const li = a.landmass === undefined ? -1 : geo.landmasses.findIndex((l) => l.id === a.landmass);
    for (let t = 0; t < W * H; t++) if (one[t] && (li < 0 || sketch.land[t] === li)) areaT[t] = k;
  });
  const biomeWarp = warp(`${seed}:biomes`, 20, 7);
  const biome = new Uint8Array(N);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, z);
      if (!isLand(i)) continue;
      const [wx, wz] = biomeWarp(x, z);
      const sx = Math.max(0, Math.min(W - 1, Math.floor(x + 0.5 + wx)));
      const sz = Math.max(0, Math.min(H - 1, Math.floor(z + 0.5 + wz)));
      const same = mass[at(sx, sz)] === mass[i];
      const k = areaT[same ? sz * W + sx : z * W + x]!;
      const b = k >= 0 ? geo.areas[k]!.biome : geo.regions[land.region[i]!]!.biome;
      biome[i] = biomeIndex(b);
    }
  }
  const biomeOf = (i: number): GeoBiome => GEO_BIOMES[biome[i]!]!;

  // --- Lakes ------------------------------------------------------------------------------------------------------------
  const water = new Uint8Array(N);
  const lakeWarp = warp(`${seed}:lakes`, 8, 1.2);
  const lakeOf = new Int16Array(N).fill(-1);
  geo.lakes.forEach((lake, k) => {
    const xs = lake.points.map((p) => p[0]);
    const zs = lake.points.map((p) => p[1]);
    const one = fillPolygon(lake.points, W, H);
    for (let z = Math.floor(Math.min(...zs)) - 3; z <= Math.ceil(Math.max(...zs)) + 3; z++) {
      for (let x = Math.floor(Math.min(...xs)) - 3; x <= Math.ceil(Math.max(...xs)) + 3; x++) {
        const [wx, wz] = lakeWarp(x, z);
        const sx = Math.round(x + wx);
        const sz = Math.round(z + wz);
        const i = at(x, z);
        if (!isLand(i) || reserved[i] || !one[sz * W + sx]) continue;
        water[i] = lake.kind === "swamp" ? 3 : 2;
        lakeOf[i] = k;
      }
    }
  });

  // --- Rivers: their lines wandered, stamped as distance fields -------------------------------------------------------------
  const river = new Uint8Array(N);
  const riverD = new Float32Array(N).fill(1e9);
  /** The river point each tile is nearest, by river and its point (for the bed's level). */
  const riverAt = new Int32Array(N).fill(-1);
  const runs = geo.rivers.map((r, k) => {
    const n = gradient(`${seed}:meander:${r.id}`, 9);
    return wander(densify(r.points), (s) => n(s, k * 31.7), 1.3, 6);
  });
  runs.forEach((run, k) => {
    const half = geo.rivers[k]!.width / 2;
    const reach = half + 8;
    run.forEach((p, pi) => {
      for (let z = Math.floor(p.z - reach); z <= Math.ceil(p.z + reach); z++) {
        for (let x = Math.floor(p.x - reach); x <= Math.ceil(p.x + reach); x++) {
          if (x < 0 || z < 0 || x >= W || z >= H) continue;
          const i = at(x, z);
          const d = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) - half;
          if (d < riverD[i]!) {
            riverD[i] = d;
            riverAt[i] = (k << 16) | pi;
          }
        }
      }
    });
  });
  for (let i = 0; i < N; i++) {
    if (!isLand(i) || riverD[i]! > 0.12 || reserved[i] || water[i]) continue;
    water[i] = 1;
    river[i] = (riverAt[i]! >> 16) + 1;
  }

  // --- Ranges: crest distance, band, gaps and passes -------------------------------------------------------------------------
  const rangeD = new Float32Array(N).fill(1e9);
  const rangeOf = new Int16Array(N).fill(-1);
  const rangeS = new Float32Array(N);
  const crests = geo.mountains.map((m, k) => {
    const n = gradient(`${seed}:crest:${m.id}`, 14);
    return wander(densify(m.points), (s) => n(s, k * 17.3), Math.min(2.5, m.width / 5), 8);
  });
  crests.forEach((run, k) => {
    const m = geo.mountains[k]!;
    const reach = m.width / 2 + 12;
    for (const p of run) {
      for (let z = Math.floor(p.z - reach); z <= Math.ceil(p.z + reach); z++) {
        for (let x = Math.floor(p.x - reach); x <= Math.ceil(p.x + reach); x++) {
          if (x < 0 || z < 0 || x >= W || z >= H) continue;
          const i = at(x, z);
          const d = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) / (m.width / 2);
          if (d < rangeD[i]!) {
            rangeD[i] = d;
            rangeOf[i] = k;
            rangeS[i] = p.s;
          }
        }
      }
    }
  });
  // A pass: a corridor straight across the crest at its place, five tiles wide, its saddle opened wider.
  const corridor = new Float32Array(N);
  for (const pass of geo.passes) {
    const k = geo.mountains.findIndex((m) => m.id === pass.range);
    const m = geo.mountains[k]!;
    const run = crests[k]!;
    let near = run[0]!;
    for (const p of run) if (Math.hypot(p.x - pass.at[0] - 0.5, p.z - pass.at[1] - 0.5) < Math.hypot(near.x - pass.at[0] - 0.5, near.z - pass.at[1] - 0.5)) near = p;
    const [cx, cz] = [pass.at[0] + 0.5, pass.at[1] + 0.5];
    const [nx, nz] = [-near.uz, near.ux];
    const long = m.width / 2 + 6;
    const R = Math.ceil(long + 4);
    for (let z = Math.floor(cz) - R; z <= Math.floor(cz) + R; z++) {
      for (let x = Math.floor(cx) - R; x <= Math.floor(cx) + R; x++) {
        const px = x + 0.5 - cx;
        const pz = z + 0.5 - cz;
        const along = px * nx + pz * nz;
        const across = Math.abs(px * near.ux + pz * near.uz);
        const width = 2.6 + 1.6 * Math.max(0, 1 - Math.abs(along) / (m.width / 2 + 1));
        if (Math.abs(along) > long) continue;
        const c = 1 - smooth(width, width + 2.5, across);
        const i = at(x, z);
        if (c > corridor[i]!) corridor[i] = c;
      }
    }
  }
  const gapNoise = geo.mountains.map((m) => gradient(`${seed}:gaps:${m.id}`, 26));
  const edgeNoise = fractal(`${seed}:band-edge`, 7, 2);
  const ridge = ridged(`${seed}:ridges`, 16, 4);
  const band = new Uint8Array(N);
  const crest = new Float32Array(N);
  const hill = new Uint8Array(N);
  /** A range's rise at a tile, levels, and whether its band closes it. */
  const rise = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = rangeOf[i]!;
    if (k < 0 || !isLand(i)) continue;
    const m = geo.mountains[k]!;
    const t = rangeD[i]!;
    const x = i % LW;
    const z = Math.floor(i / LW);
    const top = RANGE_RISE[m.height]!;
    const gap = m.height === 2 ? smooth(0.32, 0.5, gapNoise[k]!(rangeS[i]!, k * 13.1)) : 0;
    const open = Math.max(gap, corridor[i]!);
    const r = ridge(x, z);
    if (t < 1) {
      const body = top * (1 - 0.55 * t * t) * (0.7 + 0.6 * r);
      rise[i] = body * (1 - open) + Math.min(body, top * 0.35) * open;
    } else {
      const foot = (t - 1) * (m.width / 2);
      rise[i] = top * 0.35 * Math.max(0, 1 - foot / 10) ** 2 * (1 - 0.5 * open);
    }
    const edge = 0.94 + 0.22 * edgeNoise(x, z);
    if (m.height >= 2 && t < edge && open < 0.5 && !reserved[i]) {
      band[i] = k + 1;
      crest[i] = Math.max(0, 1 - t / edge);
    }
    if (m.height === 1 && t < 0.5) hill[i] = k + 1;
  }

  // --- The relief, levels ---------------------------------------------------------------------------------------------------
  const baseF = new Float32Array(N);
  const ampF = new Float32Array(N);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = at(x, z);
    if (!isLand(i)) continue;
    const r = RELIEF[biomeOf(i)];
    baseF[i] = r.base;
    ampF[i] = r.amp;
  }
  const base = blur(baseF, W, H, LW, 9);
  const amp = blur(ampF, W, H, LW, 9);
  const hills = fractal(`${seed}:hills`, 80, 3);
  const mesas = fractal(`${seed}:mesas`, 26, 3);
  const dunes = ridged(`${seed}:dunes`, 11, 2);
  const E = new Float32Array(N);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, z);
      if (!isLand(i)) continue;
      const d = inland[i]!;
      const up = 0.25 * Math.min(1, d / 3) + 0.75 * smooth(0, 20, d);
      const h01 = Math.max(0, Math.min(1, 0.5 + 0.65 * hills(x, z)));
      let e = up * (base[i]! + amp[i]! * h01);
      const b = biomeOf(i);
      if (b === "badlands") e += up * 1.4 * smooth(0.12, 0.2, mesas(x, z));
      if (b === "desert") e += up * 0.6 * dunes(x, z);
      e += rise[i]! * Math.min(1, d / 3);
      E[i] = e * layout.relief;
    }
  }
  // The rivers' beds: each point's level the lowest of the land's upstream of it, so the water runs down to the sea.
  const beds = runs.map((run) => {
    const out = new Float32Array(run.length);
    let low = Infinity;
    run.forEach((p, pi) => {
      const x = Math.floor(p.x);
      const z = Math.floor(p.z);
      const i = x >= 0 && z >= 0 && x < W && z < H ? at(x, z) : -1;
      const here = i >= 0 && isLand(i) ? E[i]! - 0.3 : 0;
      low = Math.min(low, Math.max(0, here));
      out[pi] = low;
    });
    return out;
  });
  for (let i = 0; i < N; i++) {
    if (!isLand(i) || riverAt[i]! < 0 || riverD[i]! > 7) continue;
    const bed = beds[riverAt[i]! >> 16]![riverAt[i]! & 0xffff]!;
    const plain = bed + Math.max(0, riverD[i]! - 1.5) * 0.22;
    if (plain < E[i]!) E[i] = plain;
  }
  // The lakes' shores, graded down to their water.
  const lakeLevel = geo.lakes.map(() => Infinity);
  for (let i = 0; i < N; i++) if (lakeOf[i]! >= 0) lakeLevel[lakeOf[i]!] = Math.min(lakeLevel[lakeOf[i]!]!, E[i]!);
  const toLake = distanceTo(W, H, (t) => water[at(t % W, Math.floor(t / W))] === 2 || water[at(t % W, Math.floor(t / W))] === 3);
  const lakeNear = new Int16Array(N).fill(-1);
  {
    // The lake each tile near a lake is nearest: grown out from the lakes, ring by ring.
    let front: number[] = [];
    for (let i = 0; i < N; i++) if (lakeOf[i]! >= 0) {
      lakeNear[i] = lakeOf[i]!;
      front.push(i);
    }
    const near: number[] = [];
    for (let ring = 0; ring < 8; ring++) {
      const next: number[] = [];
      for (const i of front) for (const n of land.n4(i, near)) if (inTravel(n) && lakeNear[n]! < 0) {
        lakeNear[n] = lakeNear[i]!;
        next.push(n);
      }
      front = next;
    }
  }
  for (let i = 0; i < N; i++) {
    if (!isLand(i) || lakeNear[i]! < 0) continue;
    const d = toLake[tw(i)]!;
    const level = lakeLevel[lakeNear[i]!]! + Math.max(0, d - 1) * 0.3;
    if (level < E[i]!) E[i] = level;
  }
  // Each place's ground levelled, and blended into the land round it.
  for (const p of places) {
    const c = at(p.at[0], p.at[1]);
    const target = Math.floor(E[c]!) + 0.5;
    const r = p.half + p.ring;
    for (let z = p.at[1] - r - 4; z <= p.at[1] + r + 4; z++) {
      for (let x = p.at[0] - r - 4; x <= p.at[0] + r + 4; x++) {
        const i = at(x, z);
        if (!isLand(i)) continue;
        const d = Math.max(Math.abs(x - p.at[0]), Math.abs(z - p.at[1])) - r;
        const k = d <= 0 ? 1 : 1 - d / 5;
        E[i] = E[i]! * (1 - k) + target * k;
      }
    }
  }

  // The field smoothed before it is cut into levels (two box blurs, near enough a Gaussian of three tiles), so the brinks
  // follow long, easy contours and not the noise's every wrinkle; the places' level ground kept as it was.
  {
    const soft = blur(blur(E, W, H, LW, 3), W, H, LW, 3);
    // Then read on a lattice of 3-tile cells, so a brink runs straight for a cell's width before it steps (a staircase of
    // bold 3-tile steps, never one of single tiles); the lattice slides by noise across the map, so it is never a grid.
    const slideX = gradient(`${seed}:lattice-x`, 40);
    const slideZ = gradient(`${seed}:lattice-z`, 40);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const i = at(x, z);
        if (!isLand(i) || reserved[i]) continue;
        const ox = Math.floor((slideX(z, 0) + 1) * 1.5);
        const oz = Math.floor((slideZ(x, 0) + 1) * 1.5);
        const sx = Math.min(W - 1, Math.max(0, Math.floor((x + ox) / 3) * 3 + 1 - ox));
        const sz = Math.min(H - 1, Math.max(0, Math.floor((z + oz) / 3) * 3 + 1 - oz));
        const j = at(sx, sz);
        E[i] = isLand(j) ? soft[j]! : soft[i]!;
      }
    }
  }

  // --- Levels, and what each tile is ----------------------------------------------------------------------------------------
  const wet = fractal(`${seed}:wet`, 34, 3);
  const fine = gradient(`${seed}:fine`, 4);
  const forestMask = new Uint8Array(W * H);
  const swampMask = new Uint8Array(W * H);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, z);
      land.use[i] = Use.Wild;
      if (!isLand(i)) {
        // A band of shallow water two tiles wide along every shore, the deep sea beyond.
        land.surface[i] = fromLandT[z * W + x]! <= 2 ? S.shallows : S.sea;
        land.height[i] = 0;
        land.flags[i] = BLOCKED;
        water[i] = 4;
        continue;
      }
      const level = Math.max(0, Math.min(12, Math.floor(E[i]!)));
      land.height[i] = level * LEVEL;
      const b = biomeOf(i);
      const m = wet(x, z);
      const f = fine(x, z);
      const shore = inland[i]! < 1.6;
      let s: number;
      switch (b) {
        case "heartland":
          s = m < -0.1 ? S.meadow : S.grass;
          break;
        case "plains":
          s = m < -0.05 ? S.meadow : S.grass;
          break;
        case "coast":
          s = m > 0.3 && f < 0 ? S.sand : S.grass;
          break;
        case "swamp":
          s = m > 0.15 ? S.mud : f < -0.2 ? S.mud : S.moss;
          break;
        case "mountains":
          // Rough upland grass, grass in the hollows, bare rock here and there; snow up high.
          s = level >= 5 ? (m < 0 ? S.snow : S.highland) : m < -0.15 ? S.grass : f > 0.5 ? S.rock : S.highland;
          break;
        case "volcanic":
          s = m < 0 ? S.ash : S.rock;
          break;
        case "forest":
          s = m > 0.25 ? S.moss : S["forest-floor"];
          break;
        case "tundra":
          s = m < -0.15 || level >= 4 ? S.snow : S.tundra;
          break;
        case "waste":
          s = m < -0.15 ? S.ash : f < 0.1 ? S["cracked-earth"] : S.rock;
          break;
        case "desert":
          s = m > 0.25 ? S.sand : S.dunes;
          break;
        case "badlands":
          s = m > 0.2 ? S["cracked-earth"] : S.badlands;
          break;
        case "highlands":
          s = m > 0.3 ? S.grass : f > 0.45 ? S.rock : S.highland;
          break;
        case "jungle":
          s = m > 0.3 ? S.moss : S["jungle-floor"];
          break;
      }
      if (shore) s = b === "swamp" ? S.mud : b === "mountains" || b === "waste" || b === "volcanic" ? S.rock : b === "tundra" ? S.ice : b === "desert" || b === "badlands" ? S.sand : S.sand;
      land.surface[i] = s;
      land.flags[i] = 0;
      if (b === "forest" || b === "jungle") forestMask[z * W + x] = 1;
      if (b === "swamp") swampMask[z * W + x] = 1;
      // Mere water and the swamp's pools of bog.
      if (b === "swamp" && !reserved[i] && m > 0.42 && inland[i]! > 3 && water[i] === 0) water[i] = 3;
      if (water[i] === 1) {
        land.surface[i] = S.stream;
        land.flags[i] = BLOCKED;
      } else if (water[i] === 2) {
        land.surface[i] = S.shallows;
        land.flags[i] = BLOCKED;
      } else if (water[i] === 3) {
        land.surface[i] = S.bog;
        land.flags[i] = BLOCKED;
      }
      if (band[i]) {
        const k = band[i]! - 1;
        const kind = geo.mountains[k]!.kind;
        land.surface[i] = kind === "snow" || kind === "ice" ? (crest[i]! > 0.4 ? S.snow : S.rock) : kind === "ash" ? S.ash : kind === "redrock" || kind === "sandstone" ? S.badlands : S.rock;
        land.flags[i] = BLOCKED;
        // A peak's ground stands two levels at least over its feet, so a range reads as a wall from below.
        land.height[i] = Math.max(land.height[i]!, (level + 2) * LEVEL);
      }
    }
  }
  // Each level's ground closed and opened (a majority filter over the 5-by-5 round each open tile, twice): no level a
  // tongue or a notch a tile or two wide, so a brink runs on in long strokes instead of zigzagging.
  {
    const ground = (i: number) => isLand(i) && land.flags[i] === 0 && water[i] === 0 && !band[i] && !reserved[i];
    const votes = new Int32Array(16);
    for (let pass = 0; pass < 2; pass++) {
      const next = land.height.slice();
      for (let z = 2; z < H - 2; z++) {
        for (let x = 2; x < W - 2; x++) {
          const i = at(x, z);
          if (!ground(i)) continue;
          votes.fill(0);
          for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
            const j = i + dz * LW + dx;
            if (ground(j)) votes[land.height[j]! / LEVEL]!++;
          }
          let best = land.height[i]! / LEVEL;
          for (let l = 0; l < votes.length; l++) if (votes[l]! > votes[best]!) best = l;
          if (votes[best]! >= 17) next[i] = best * LEVEL;
        }
      }
      land.height.set(next);
    }
  }
  // The water's floor: a river's or a lake's at its lowest bank's level, the sea at 0.
  const near: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      if (!inTravel(i) || water[i] === 0 || water[i] === 4) continue;
      let low = land.height[i]!;
      for (const n of land.n4(i, near)) if (inTravel(n) && water[n] === 0 && !band[n]) low = Math.min(low, land.height[n]!);
      land.height[i] = low;
    }
  }
  // Lakes deep in the middle: the open water's darker blue.
  for (let i = 0; i < N; i++) if (water[i] === 2 && toLake[tw(i)] === 0) {
    let deep = true;
    for (let dz = -2; dz <= 2 && deep; dz++) for (let dx = -2; dx <= 2; dx++) if (water[i + dz * LW + dx] !== 2) deep = false;
    if (deep) land.surface[i] = S.sea;
  }

  const forestT = distanceTo(W, H, (t) => !forestMask[t]);
  const swampT = distanceTo(W, H, (t) => !swampMask[t]);
  const forest = new Float32Array(N);
  const swamp = new Float32Array(N);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    forest[at(x, z)] = forestMask[z * W + x] ? forestT[z * W + x]! : 0;
    swamp[at(x, z)] = swampMask[z * W + x] ? swampT[z * W + x]! : 0;
  }
  return { W, H, mass, inland, biome, water, band, crest, hill, forest, swamp, reserved, river };
}
