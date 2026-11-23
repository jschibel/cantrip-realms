// The lie of the land, from the layout (layout.ts): the landmasses and their coasts, bays cut into them and islets
// scattered over the sea, each region's ground by its biome shading into its neighbours', mountain ranges, rivers
// running to the sea, and lakes.

import { toWorld } from "../../src/hex";
import type { Terrain } from "../../src/world/schema";
import { Grid, SIZE, STEP, T, around, disc, fbm, hexDistance, idx, line, noise } from "./grid";
import type { Biome, Layout } from "./layout";

const SQRT3 = Math.sqrt(3);

/** How far a hex lies inside a landmass's coast, hexes: negative past it. */
function inside(q: number, r: number, mass: Layout["landmasses"][number], wobble: number): number {
  const p = toWorld({ q, r });
  const c = toWorld({ q: mass.center[0], r: mass.center[1] });
  const turn = ((mass.turn ?? 0) * Math.PI) / 180;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const x = (dx * Math.cos(turn) + dz * Math.sin(turn)) / (mass.stretch?.[0] ?? 1);
  const z = (-dx * Math.sin(turn) + dz * Math.cos(turn)) / (mass.stretch?.[1] ?? 1);
  return mass.radius + (wobble - 0.5) * 2 * (mass.wobble ?? 0) - Math.hypot(x, z) / SQRT3;
}

/** The biome of each region index. */
export const biomeOf = (layout: Layout, region: number): Biome => layout.regions[region]?.biome ?? "plains";

export function shapeLand(grid: Grid, layout: Layout): void {
  const seed = layout.seed;
  const wobble = fbm(`${seed}:coast`, 60, 3);
  const isles = fbm(`${seed}:isles`, 26, 3);
  const hills = fbm(`${seed}:hills`, 34, 4);
  const ridge = fbm(`${seed}:ridge`, 22, 3);
  const wet = fbm(`${seed}:wet`, 28, 3);
  const fine = noise(`${seed}:fine`, 5);
  const blend = layout.regions.map((r) => fbm(`${seed}:blend:${r.id}`, 40, 2));

  for (let q = 0; q < SIZE; q++) {
    for (let r = 0; r < SIZE; r++) {
      const i = idx(q, r);
      // Which region: the one whose middle is nearest, by its weight, its border waved by noise.
      let best = 0;
      let bestScore = Infinity;
      layout.regions.forEach((region, k) => {
        const d = hexDistance(q, r, region.at[0], region.at[1]) / (region.weight ?? 1);
        const score = d * (0.82 + 0.36 * blend[k]!(q, r));
        if (score < bestScore) {
          bestScore = score;
          best = k;
        }
      });
      grid.region[i] = best;

      // Land or sea: within a landmass's coast, out of its bays, or on an islet of an archipelago.
      const w = wobble(q, r);
      let depth = Math.max(...layout.landmasses.map((m) => inside(q, r, m, w)), -99);
      for (const bay of layout.bays) {
        const into = bay.radius + (w - 0.5) * 20 - hexDistance(q, r, bay.center[0], bay.center[1]);
        if (into > 0) depth = Math.min(depth, -into);
      }
      for (const isle of layout.archipelagos) {
        const d = hexDistance(q, r, isle.center[0], isle.center[1]);
        if (d < isle.radius && isles(q, r) > 1 - (isle.density ?? 0.4) * 0.5) depth = Math.max(depth, (isles(q, r) - (1 - (isle.density ?? 0.4) * 0.5)) * 40);
      }
      if (depth < 0) {
        grid.terrain[i] = depth > -4 ? T.water : T["deep-water"];
        grid.height[i] = depth > -4 ? -0.1 : -0.2;
        grid.blocked[i] = 1;
        continue;
      }
      const shore = depth < 2.5;
      const biome = biomeOf(layout, best);
      const m = wet(q, r);
      const e = hills(q, r);
      const f = fine(q, r);
      let terrain: Terrain = "grass";
      let steps = 0;
      let blocked = false;
      switch (biome) {
        case "heartland":
          terrain = m < 0.42 ? "meadow" : "grass";
          steps = Math.max(0, Math.round((e - 0.5) * 4));
          break;
        case "plains":
          terrain = m < 0.4 ? "meadow" : "grass";
          steps = Math.max(0, Math.round((e - 0.38) * 9));
          if (steps >= 3) terrain = "hills";
          break;
        case "tundra":
          terrain = m < 0.45 ? "snow" : f < 0.3 ? "ice" : "snow";
          steps = Math.max(0, Math.round((e - 0.4) * 7));
          break;
        case "coast":
          terrain = m < 0.46 ? "grass" : f < 0.5 ? "sand" : "grass";
          steps = Math.max(0, Math.round((e - 0.42) * 5));
          if (m > 0.7 && e < 0.45) {
            terrain = "water";
            blocked = true;
          }
          break;
        case "swamp":
          terrain = m > 0.62 ? "swamp" : m > 0.5 ? "mud" : f < 0.4 ? "mud" : "moss";
          blocked = terrain === "swamp";
          steps = Math.max(0, Math.round((e - 0.5) * 3));
          break;
        case "mountains":
        case "volcanic": {
          const ridgeline = ridge(q, r);
          steps = Math.max(0, Math.round((e - 0.32) * 12));
          const ashen = biome === "volcanic" && m < 0.55;
          terrain = ashen ? (f < 0.5 ? "ash" : "rock") : m < 0.35 ? "dirt" : m < 0.6 ? "rock" : "stone";
          if (ridgeline > 0.66) {
            terrain = biome === "mountains" && ridgeline > 0.72 ? "snow" : "mountain";
            steps += 5;
            blocked = true;
          }
          if (biome === "volcanic" && m > 0.74 && ridgeline < 0.6) {
            terrain = "lava";
            steps = 0;
            blocked = true;
          }
          break;
        }
        case "waste":
          terrain = m < 0.4 ? "ash" : f < 0.5 ? "rock" : "dirt";
          steps = Math.max(0, Math.round((e - 0.45) * 5));
          break;
        case "forest":
          terrain = m < 0.3 ? "meadow" : m < 0.62 ? "grass" : "moss";
          if (f < 0.3) terrain = "forest";
          steps = Math.max(0, Math.round((e - 0.4) * 6));
          break;
      }
      if (shore && !blocked) {
        terrain = biome === "swamp" ? "mud" : biome === "volcanic" || biome === "mountains" || biome === "waste" ? "rock" : biome === "tundra" ? "ice" : "sand";
        steps = Math.min(steps, 1);
      }
      grid.terrain[i] = T[terrain];
      grid.height[i] = terrain === "water" || terrain === "lava" || terrain === "swamp" ? -0.1 : steps * STEP;
      grid.blocked[i] = blocked ? 1 : 0;
    }
  }
}

/** The mountain ranges: a jagged band of peaks along each, passable hills at its feet. */
export function mountains(grid: Grid, layout: Layout): void {
  const jag = noise(`${layout.seed}:ranges`, 9);
  for (const range of layout.mountains) {
    for (const h of line({ q: range.from[0], r: range.from[1] }, { q: range.to[0], r: range.to[1] })) {
      for (const i of disc(h, range.width + 2)) {
        if (grid.isWater(i) && grid.terrain[i] !== T.swamp) continue;
        const d = hexDistance(Math.floor(i / SIZE), i % SIZE, h.q, h.r);
        const reach = range.width * (0.6 + 0.8 * jag(Math.floor(i / SIZE), i % SIZE));
        if (d <= reach) {
          grid.terrain[i] = d <= reach * 0.4 && biomeOf(layout, grid.region[i]!) !== "volcanic" ? T.snow : T.mountain;
          grid.height[i] = Math.max(grid.height[i]!, STEP * (6 + Math.round((reach - d) * 1.5)));
          grid.blocked[i] = 1;
        } else if (d <= reach + 2 && grid.blocked[i] === 0) {
          grid.terrain[i] = T.hills;
          grid.height[i] = Math.max(grid.height[i]!, STEP * 3);
        }
      }
    }
  }
}

/** Rivers running from their springs toward the sea, wandering on the way, and lakes. */
export function waters(grid: Grid, layout: Layout): void {
  const meander = noise(`${layout.seed}:meander`, 18);
  layout.rivers.forEach((river, k) => {
    const to = { q: river.to[0], r: river.to[1] };
    let at = { q: river.from[0], r: river.from[1] };
    for (let step = 0; step < 900; step++) {
      if (at.q < 0 || at.r < 0 || at.q >= SIZE || at.r >= SIZE) break;
      const i = idx(at.q, at.r);
      if (grid.terrain[i] === T["deep-water"] && step > 4) break;
      for (const w of step > 60 ? [i, ...around(i)] : [i]) {
        if (grid.terrain[w] === T["deep-water"]) continue;
        grid.terrain[w] = river.lava ? T.lava : T.water;
        grid.height[w] = -0.1;
        grid.blocked[w] = 1;
      }
      if (at.q === to.q && at.r === to.r) break;
      // A step toward the mouth, or aside from it as the meander leans.
      const steps = around(i).map((n) => ({ q: Math.floor(n / SIZE), r: n % SIZE }));
      steps.sort((a, b) => hexDistance(a.q, a.r, to.q, to.r) - hexDistance(b.q, b.r, to.q, to.r) || a.q - b.q || a.r - b.r);
      const lean = meander(at.q + k * 50, at.r);
      at = lean > 0.68 && steps[1] ? steps[1] : lean < 0.32 && steps[2] && hexDistance(steps[2].q, steps[2].r, to.q, to.r) <= hexDistance(at.q, at.r, to.q, to.r) ? steps[2] : steps[0]!;
    }
  });
  for (const lake of layout.lakes) {
    const water = lake.kind === "lava" ? T.lava : lake.kind === "swamp" ? T.swamp : T.water;
    const shore = lake.kind === "swamp" ? T.mud : lake.kind === "lava" ? T.ash : T.sand;
    for (const i of disc({ q: lake.at[0], r: lake.at[1] }, lake.radius + 1)) {
      if (grid.terrain[i] === T["deep-water"]) continue;
      const d = hexDistance(Math.floor(i / SIZE), i % SIZE, lake.at[0], lake.at[1]);
      if (d <= lake.radius) {
        grid.terrain[i] = water;
        grid.height[i] = -0.1;
        grid.blocked[i] = 1;
      } else if (grid.blocked[i] === 0) grid.terrain[i] = shore;
    }
  }
}
