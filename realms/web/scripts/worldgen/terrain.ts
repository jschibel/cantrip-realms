// The lie of the land: the continent and its coast, the islands off Tolaria, each region's ground and hills shading
// into its neighbours', the mountains of Keld and the lava of Shiv, Urborg's swamps, the forests of Llanowar and
// Yavimaya, the hub's farmland, rivers running from the heartland to the sea along the regions' borders, and lakes.

import type { Region, Terrain } from "../../src/world/schema";
import { Grid, HUB, SIZE, STEP, T, angleGap, angleOf, around, atAngle, disc, fbm, hexDistance, idx, noise, randomFor } from "./grid";
import { REGION_ANGLE } from "./plan";

export const REGION_ORDER: readonly Region[] = ["W", "U", "B", "R", "G"];
export const HUB_REGION = 5;

/** How far the coast is from the hub at a screen angle: Tolaria's coast comes closest. */
function coastAt(angle: number, wobble: number): number {
  const tolaria = Math.max(0, 1 - angleGap(angle, REGION_ANGLE.U) / 34);
  return 286 - 74 * tolaria * tolaria * (3 - 2 * tolaria) + (wobble - 0.5) * 26;
}

export function shapeLand(grid: Grid, seed: number): void {
  const wobble = fbm(`${seed}:coast`, 60, 3);
  const isles = fbm(`${seed}:isles`, 26, 3);
  const hills = fbm(`${seed}:hills`, 34, 4);
  const ridge = fbm(`${seed}:ridge`, 22, 3);
  const wet = fbm(`${seed}:wet`, 28, 3);
  const fine = noise(`${seed}:fine`, 5);
  const blend = REGION_ORDER.map((r) => fbm(`${seed}:blend:${r}`, 40, 2));

  for (let q = 0; q < SIZE; q++) {
    for (let r = 0; r < SIZE; r++) {
      const i = idx(q, r);
      const d = hexDistance(q, r, HUB.q, HUB.r);
      const angle = d === 0 ? 0 : angleOf(HUB, { q, r });
      const coast = coastAt(angle, wobble(q, r));
      const tolarian = angleGap(angle, REGION_ANGLE.U) < 46;
      const island = tolarian && d > coast && d < 300 && isles(q, r) > 0.6;

      // Which region: the one whose direction is nearest, its border waved by noise, the hub in the middle.
      let best = 0;
      let bestWeight = -1;
      REGION_ORDER.forEach((region, k) => {
        const gap = angleGap(angle, REGION_ANGLE[region]);
        const weight = Math.exp(-((gap / 30) ** 2)) * (0.7 + 0.6 * blend[k]!(q, r));
        if (weight > bestWeight) {
          bestWeight = weight;
          best = k;
        }
      });
      const hubReach = 70 + (blend[0]!(q, r) - 0.5) * 24;
      grid.region[i] = d < hubReach ? HUB_REGION : best;

      if (d > coast && !island) {
        const out = d - coast;
        grid.terrain[i] = out < 4 ? T.water : T["deep-water"];
        grid.height[i] = out < 4 ? -0.1 : -0.2;
        grid.blocked[i] = 1;
        continue;
      }
      const shore = island ? isles(q, r) < 0.64 : d > coast - 2.5;
      const region = grid.region[i] === HUB_REGION ? null : REGION_ORDER[grid.region[i]!]!;
      const m = wet(q, r);
      const e = hills(q, r);
      const f = fine(q, r);
      let terrain: Terrain = "grass";
      let steps = 0;
      let blocked = false;
      switch (region) {
        case null:
          terrain = m < 0.42 ? "meadow" : "grass";
          steps = Math.max(0, Math.round((e - 0.5) * 4));
          break;
        case "W":
          terrain = m < 0.4 ? "meadow" : "grass";
          steps = Math.max(0, Math.round((e - 0.38) * 9));
          if (steps >= 3) terrain = "hills";
          if (d > 236 && m > 0.55) terrain = "snow";
          break;
        case "U":
          terrain = m < 0.46 ? "grass" : f < 0.5 ? "sand" : "grass";
          steps = Math.max(0, Math.round((e - 0.42) * 5));
          if (m > 0.7 && e < 0.45) {
            terrain = "water";
            blocked = true;
          }
          break;
        case "B":
          terrain = m > 0.62 ? "swamp" : m > 0.5 ? "mud" : f < 0.4 ? "mud" : "moss";
          blocked = terrain === "swamp";
          steps = Math.max(0, Math.round((e - 0.5) * 3));
          break;
        case "R": {
          // Keld's mountains nearer the hub, Shiv's volcanic land beyond them.
          const shiv = d > 192;
          const ridgeline = ridge(q, r);
          steps = Math.max(0, Math.round((e - 0.32) * 12));
          terrain = shiv ? (m < 0.5 ? "ash" : "rock") : m < 0.35 ? "dirt" : m < 0.6 ? "rock" : "stone";
          if (ridgeline > 0.64 && d > 80) {
            terrain = "mountain";
            steps += 5;
            blocked = true;
            if (!shiv && ridgeline > 0.7) terrain = "snow";
          }
          if (shiv && m > 0.74 && ridgeline < 0.6) {
            terrain = "lava";
            steps = 0;
            blocked = true;
          }
          break;
        }
        case "G":
          terrain = m < 0.3 ? "meadow" : m < 0.62 ? "grass" : "moss";
          if (d > 200 && f < 0.5) terrain = "forest";
          steps = Math.max(0, Math.round((e - 0.4) * 6));
          break;
      }
      if (shore && !blocked) {
        terrain = region === "B" ? "mud" : region === "R" ? "rock" : "sand";
        steps = Math.min(steps, 1);
      }
      grid.terrain[i] = T[terrain];
      grid.height[i] = terrain === "water" || terrain === "lava" || terrain === "swamp" ? -0.1 : steps * STEP;
      grid.blocked[i] = blocked ? 1 : 0;
    }
  }
}

/** Rivers from the heartland to the sea, one along each border between two regions, and a lake or two in each region. */
export function waters(grid: Grid, seed: number): void {
  const random = randomFor(seed, "rivers");
  const meander = noise(`${seed}:meander`, 18);
  REGION_ORDER.forEach((region, k) => {
    const border = REGION_ANGLE[region] + 36;
    let angle = border + (random() - 0.5) * 6;
    let at = atAngle(HUB, angle, 78 + Math.floor(random() * 10));
    for (let step = 0; step < 400; step++) {
      const i = idx(at.q, at.r);
      if (grid.terrain[i] === T["deep-water"]) break;
      const wide = step > 60 ? 1 : 0;
      for (const w of wide ? [i, ...around(i)] : [i]) {
        if (grid.terrain[w] === T["deep-water"]) continue;
        grid.terrain[w] = region === "R" && step > 140 ? T.lava : T.water;
        grid.height[w] = -0.1;
        grid.blocked[w] = 1;
      }
      angle += (meander(at.q + k * 50, at.r) - 0.5) * 14;
      angle = border + Math.max(-14, Math.min(14, angle - border));
      const d = hexDistance(at.q, at.r, HUB.q, HUB.r);
      const next = atAngle(HUB, angle, d + 1);
      at = next.q === at.q && next.r === at.r ? atAngle(HUB, angle, d + 2) : next;
    }
  });
  const lakes = randomFor(seed, "lakes");
  for (const region of REGION_ORDER) {
    for (let n = 0; n < 2; n++) {
      const at = atAngle(HUB, REGION_ANGLE[region] + (lakes() - 0.5) * 50, 95 + Math.floor(lakes() * 120));
      const size = 3 + Math.floor(lakes() * 4);
      const water = region === "R" ? T.lava : region === "B" ? T.swamp : T.water;
      for (const i of disc(at, size + 1)) {
        if (grid.terrain[i] === T["deep-water"]) continue;
        const d = hexDistance(Math.floor(i / SIZE), i % SIZE, at.q, at.r);
        if (d <= size && lakes() < 0.92) {
          grid.terrain[i] = water;
          grid.height[i] = -0.1;
          grid.blocked[i] = 1;
        } else if (grid.blocked[i] === 0) {
          grid.terrain[i] = region === "B" ? T.mud : region === "R" ? T.ash : T.sand;
        }
      }
    }
  }
}
