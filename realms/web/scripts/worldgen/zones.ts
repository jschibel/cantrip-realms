// The tier zones of the travel map (design.md A6, interfaces.md "Spawn tiers"): difficulty by how far one walks. Every
// tile's walking distance (one who hops, the ferries' lanes taken as the walk over them) from the nearest starting town's
// icon; each 16-by-16 square of the travel map the tier of its land's middle distance, never less than its region's least
// tier, then smoothed by the commonest tier round it (twice), so a zone is a band as wide as a region, not confetti. The
// sea is no tier's, and so is everything off the travel map (the towns' grounds are tier 0: format.ts `tierAt`).

import type { ZoneArea, Zones } from "../../src/world/format";
import type { Geography } from "./geography";
import { Heap, type Land, hopSteps } from "./land";
import type { Terrain } from "./terrain";

export const CELL = 16;

/** The tier of a walking distance, tiles, from the nearest starting town's icon. */
export function tierOfDistance(distance: number): number {
  return distance <= 55 ? 1 : distance <= 120 ? 2 : distance <= 200 ? 3 : 4;
}

/**
 * Walking distances, tiles, over the travel map from `starts` (one who hops: a straight step 1, a hop 1.5, a diagonal
 * the root of 2; `links` a ferry's lane from dock to dock at its length). Tiles not walked to get Infinity.
 */
export function walkingDistances(land: Land, starts: readonly number[], mine: (i: number) => boolean, links: ReadonlyMap<number, readonly { to: number; cost: number }[]>): Float32Array {
  const d = new Float32Array(land.size).fill(Infinity);
  const heap = new Heap();
  for (const s of starts) {
    d[s] = 0;
    heap.push(s, 0);
  }
  const near: number[] = [];
  const W = land.width;
  while (heap.size > 0) {
    const i = heap.pop();
    const here = d[i]!;
    for (const n of hopSteps(land, i, near)) {
      if (!mine(n)) continue;
      const diagonal = n % W !== i % W && Math.floor(n / W) !== Math.floor(i / W);
      const step = diagonal ? Math.SQRT2 : Math.abs(land.height[n]! - land.height[i]!) > 4 ? 1.5 : 1;
      if (here + step < d[n]!) {
        d[n] = here + step;
        heap.push(n, d[n]!);
      }
    }
    for (const { to, cost } of links.get(i) ?? []) {
      if (here + cost < d[to]!) {
        d[to] = here + cost;
        heap.push(to, d[to]!);
      }
    }
  }
  return d;
}

export function makeZones(land: Land, terrain: Terrain, geo: Geography, distance: Float32Array): Zones {
  const W = land.width;
  const cols = Math.ceil(terrain.W / CELL);
  const rows = Math.ceil(terrain.H / CELL);
  const areas: ZoneArea[] = [{ id: "the-sea", name: "The Sea", region: null, tier: 0 }];
  const byKey = new Map<string, number>();
  const area = (k: number, tier: number): number => {
    const region = geo.regions[k]!;
    const key = `${region.id}:${tier}`;
    let index = byKey.get(key);
    if (index === undefined) {
      const name = region.areas[tier - 1]!;
      const id = name.toLowerCase().replace(/^the /, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      index = areas.length;
      areas.push({ id: areas.some((a) => a.id === id) ? `${region.id}-${id}` : id, name, region: region.color, tier });
      byKey.set(key, index);
    }
    return index;
  };
  // Each cell: its land's middle distance and its commonest region.
  const tier = new Int8Array(cols * rows);
  const region = new Int16Array(cols * rows).fill(-1);
  const minOf = (k: number) => geo.regions[k]!.minTier ?? 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ds: number[] = [];
      const counts = new Map<number, number>();
      for (let z = row * CELL; z < Math.min(terrain.H, row * CELL + CELL); z++) {
        for (let x = col * CELL; x < Math.min(terrain.W, col * CELL + CELL); x++) {
          const i = z * W + x;
          if (terrain.mass[i]! < 0) continue;
          ds.push(distance[i]!);
          counts.set(land.region[i]!, (counts.get(land.region[i]!) ?? 0) + 1);
        }
      }
      if (ds.length < (CELL * CELL) / 8) continue;
      ds.sort((a, b) => a - b);
      const k = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
      const mid = ds[Math.floor(ds.length / 2)]!;
      region[row * cols + col] = k;
      tier[row * cols + col] = Math.max(tierOfDistance(Number.isFinite(mid) ? mid : 1e9), minOf(k));
    }
  }
  // Smoothed: each land cell the commonest tier of the land cells round it (ties to its own), its region's least at the least.
  for (let pass = 0; pass < 2; pass++) {
    const next = tier.slice();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const c = row * cols + col;
        if (region[c]! < 0) continue;
        const votes = [0, 0, 0, 0, 0];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const r2 = row + dr;
          const c2 = col + dc;
          if (r2 < 0 || c2 < 0 || r2 >= rows || c2 >= cols || region[r2 * cols + c2]! < 0) continue;
          votes[tier[r2 * cols + c2]!]! += dr === 0 && dc === 0 ? 1.5 : 1;
        }
        let best = tier[c]!;
        for (let t = 1; t <= 4; t++) if (votes[t]! > votes[best]!) best = t;
        next[c] = Math.max(best, minOf(region[c]!));
      }
    }
    tier.set(next);
  }
  const grid: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: number[] = [];
    for (let col = 0; col < cols; col++) {
      const c = row * cols + col;
      line.push(region[c]! < 0 ? 0 : area(region[c]!, tier[c]!));
    }
    grid.push(line);
  }
  return { cell: CELL, cols, rows, areas, grid };
}
