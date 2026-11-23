// The lie of the land, from the layout (layout.ts): the landmasses and their coasts, bays cut into them and islets
// scattered over the sea, each region's ground by its biome shading into its neighbours', heights rolling with the land,
// mountain ranges, rivers running to the sea, and lakes. Heights are texels (1/16 tile); the sea is at 0, the land above.

import { BLOCKED } from "../../src/world/format";
import { S } from "./ids";
import { Land, fbm, noise } from "./land";
import type { Biome, Landmass, Layout } from "./layout";

/** The biome of each region index. */
export const biomeOf = (layout: Layout, region: number): Biome => layout.regions[region]?.biome ?? "plains";

/** How high each biome's land rolls, texels at the most, before the layout's relief. */
const AMPLITUDE: Record<Biome, number> = { heartland: 16, plains: 28, coast: 14, swamp: 4, mountains: 56, volcanic: 44, forest: 22, tundra: 32, waste: 18 };

/** Where the woods are thick: the terrain's forest floor and the scenery's trees follow the same noise. */
export const woodsNoise = (seed: number) => fbm(`${seed}:woods`, 48, 3);

/** How far a tile lies inside a landmass's coast, tiles: negative past it. */
function inside(x: number, z: number, mass: Landmass, wobble: number): number {
  const turn = ((mass.turn ?? 0) * Math.PI) / 180;
  const dx = x - mass.center[0];
  const dz = z - mass.center[1];
  const u = (dx * Math.cos(turn) + dz * Math.sin(turn)) / (mass.stretch?.[0] ?? 1);
  const v = (-dx * Math.sin(turn) + dz * Math.cos(turn)) / (mass.stretch?.[1] ?? 1);
  return mass.radius + (wobble - 0.5) * 4 * (mass.wobble ?? 0) - Math.hypot(u, v);
}

/** The land and the sea, the regions, each tile's ground by its region's biome, and the land's rise and fall. */
export function shapeLand(land: Land, layout: Layout): void {
  const seed = layout.seed;
  const relief = layout.relief;
  const wobble = fbm(`${seed}:coast`, 90, 4);
  const isles = fbm(`${seed}:isles`, 46, 3);
  const hills = fbm(`${seed}:hills`, 90, 3);
  const ridge = fbm(`${seed}:ridge`, 34, 3);
  const wet = fbm(`${seed}:wet`, 50, 3);
  const fine = noise(`${seed}:fine`, 9);
  const woods = woodsNoise(seed);
  const blend = layout.regions.map((r) => fbm(`${seed}:blend:${r.id}`, 70, 2));
  const W = land.width;

  for (let z = 0; z < land.depth; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      // Which region: the one whose middle is nearest, by its weight, its border waved by noise.
      let best = 0;
      let bestScore = Infinity;
      for (let k = 0; k < layout.regions.length; k++) {
        const region = layout.regions[k]!;
        const d = Math.hypot(x - region.at[0], z - region.at[1]) / (region.weight ?? 1);
        const score = d * (0.82 + 0.36 * blend[k]!(x, z));
        if (score < bestScore) {
          bestScore = score;
          best = k;
        }
      }
      land.region[i] = best;

      // Land or sea: within a landmass's coast, out of its bays, or on an islet of an archipelago.
      const w = wobble(x, z);
      let depth = -99;
      for (const m of layout.landmasses) depth = Math.max(depth, inside(x, z, m, w));
      for (const bay of layout.bays) {
        const into = bay.radius + (w - 0.5) * 34 - Math.hypot(x - bay.center[0], z - bay.center[1]);
        if (into > 0) depth = Math.min(depth, -into);
      }
      for (const isle of layout.archipelagos) {
        const d = Math.hypot(x - isle.center[0], z - isle.center[1]);
        const threshold = 1 - (isle.density ?? 0.4) * 0.5;
        if (d < isle.radius) {
          const n = isles(x, z);
          if (n > threshold) depth = Math.max(depth, (n - threshold) * 70);
        }
      }
      if (depth < 0) {
        land.surface[i] = S.sea;
        land.height[i] = 0;
        land.flags[i] = BLOCKED;
        continue;
      }
      const biome = layout.regions[best]!.biome;
      const m = wet(x, z);
      const f = fine(x, z);
      const e = hills(x, z);
      let surface = S.grass;
      let blocked = false;
      let rise = Math.max(0, e - 0.25) * 1.33;
      switch (biome) {
        case "heartland":
          surface = m < 0.42 ? S.meadow : S.grass;
          break;
        case "plains":
          surface = m < 0.4 ? S.meadow : S.grass;
          break;
        case "coast":
          surface = m > 0.62 && f < 0.4 ? S.sand : f > 0.9 ? S.rock : S.grass;
          break;
        case "swamp":
          surface = m > 0.63 ? S.bog : m > 0.5 ? S.mud : f < 0.45 ? S.mud : S.moss;
          blocked = surface === S.bog;
          break;
        case "mountains":
        case "volcanic": {
          const ash = biome === "volcanic" && m < 0.55;
          surface = ash ? (f < 0.5 ? S.ash : S.rock) : m < 0.35 ? S.grass : m < 0.6 ? S.scree : S.rock;
          const r = ridge(x, z);
          if (r > 0.67) {
            surface = biome === "mountains" && r > 0.73 ? S.snow : S.rock;
            blocked = true;
            rise = 1 + (r - 0.67) * 8;
          }
          if (biome === "volcanic" && m > 0.75 && r < 0.6) {
            surface = S.lava;
            blocked = true;
          }
          break;
        }
        case "waste":
          surface = m < 0.4 ? S.ash : f < 0.5 ? S["cracked-earth"] : S.rock;
          break;
        case "forest":
          surface = woods(x, z) > 0.47 ? S["forest-floor"] : m > 0.6 ? S.moss : S.grass;
          break;
        case "tundra":
          surface = m < 0.38 || e > 0.62 ? S.snow : f < 0.14 && m > 0.66 ? S.ice : S.tundra;
          break;
      }
      // The shore: sand, or what the land's own edge is.
      if (depth < 3 && !blocked) {
        surface = biome === "swamp" ? S.mud : biome === "volcanic" || biome === "mountains" || biome === "waste" ? S.rock : biome === "tundra" ? S.ice : S.sand;
        rise = Math.min(rise, 0.05);
      }
      land.surface[i] = surface;
      land.flags[i] = blocked ? BLOCKED : 0;
      // Land stands above the sea, its height smoothed toward the shore so the coast is low.
      const shore = Math.min(1, depth / 12);
      land.height[i] = surface === S.bog || surface === S.lava ? 1 : 1 + Math.round(relief * AMPLITUDE[biome] * rise * shore);
    }
  }
}

/** The distance from a point to a segment. */
function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
}

/** The mountain ranges: a jagged band of peaks along each, walkable scree at its feet. */
export function mountains(land: Land, layout: Layout): void {
  const jag = noise(`${layout.seed}:ranges`, 14);
  for (const range of layout.mountains) {
    const [ax, az] = range.from;
    const [bx, bz] = range.to;
    const pad = Math.ceil(range.width * 1.4 + 6);
    for (const i of land.rect(Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad)) {
      if (land.isSea(i)) continue;
      const x = land.xOf(i);
      const z = land.zOf(i);
      const d = toSegment(x, z, ax, az, bx, bz);
      const reach = range.width * (0.6 + 0.8 * jag(x, z));
      const biome = biomeOf(layout, land.region[i]!);
      if (d <= reach) {
        land.surface[i] = d <= reach * 0.45 && biome !== "volcanic" && biome !== "waste" ? S.snow : S.rock;
        land.height[i] = Math.max(land.height[i]!, Math.round(64 + (reach - d) * 14));
        land.flags[i] = BLOCKED;
      } else if (d <= reach + 5 && land.open(i)) {
        land.surface[i] = S.scree;
        land.height[i] = Math.max(land.height[i]!, land.height[i]! + Math.round((reach + 5 - d) * 4 * layout.relief));
      }
    }
  }
}

/** Rivers running from their springs toward their mouths, wandering on the way and widening, and lakes. */
export function waters(land: Land, layout: Layout): void {
  const meander = noise(`${layout.seed}:meander`, 40);
  layout.rivers.forEach((river, k) => {
    const [tx, tz] = river.to;
    let x = river.from[0];
    let z = river.from[1];
    for (let step = 0; step < 4000; step++) {
      const width = 1 + Math.min(1.6, step / 110);
      const ix = Math.round(x);
      const iz = Math.round(z);
      if (!land.inside(ix, iz)) break;
      if (step > 12 && land.isSea(land.idx(ix, iz))) break;
      for (const i of land.disc(ix, iz, width)) {
        if (land.isSea(i)) continue;
        land.decor.delete(i);
        land.surface[i] = river.lava ? S.lava : S.stream;
        land.flags[i] = BLOCKED;
      }
      if (Math.hypot(tx - x, tz - z) < 1.5) break;
      const toward = Math.atan2(tz - z, tx - x);
      const lean = (meander(x + k * 400, z) - 0.5) * 2.2;
      x += Math.cos(toward + lean);
      z += Math.sin(toward + lean);
    }
  });
  const edge = noise(`${layout.seed}:lakes`, 6);
  for (const lake of layout.lakes) {
    const water = lake.kind === "lava" ? S.lava : lake.kind === "swamp" ? S.bog : S.shallows;
    const shore = lake.kind === "swamp" ? S.mud : lake.kind === "lava" ? S.ash : S.sand;
    const [cx, cz] = lake.at;
    for (const i of land.disc(cx, cz, lake.radius * 1.3 + 3)) {
      if (land.isSea(i)) continue;
      const x = land.xOf(i);
      const z = land.zOf(i);
      const d = Math.hypot(x - cx, z - cz) / (0.8 + 0.4 * edge(x, z));
      if (d <= lake.radius) {
        land.surface[i] = water;
        land.flags[i] = BLOCKED;
        land.height[i] = Math.max(1, Math.min(land.height[i]!, 4));
      } else if (d <= lake.radius + 2 && land.open(i)) land.surface[i] = shore;
    }
  }
}

/** The sea's two waters: shallows along the coasts, the open sea beyond. */
export function seas(land: Land): Float32Array {
  const shore: number[] = [];
  for (let i = 0; i < land.size; i++) if (!land.isSea(i)) shore.push(i);
  const fromLand = land.distances(shore, 64);
  for (let i = 0; i < land.size; i++) if (land.isSea(i)) land.surface[i] = fromLand[i]! <= 6 ? S.shallows : S.sea;
  return fromLand;
}
