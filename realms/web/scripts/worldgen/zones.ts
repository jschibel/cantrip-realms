// The tier zones (design.md A6, interfaces.md "Tier zones"): difficulty by distance. Each 8-by-8 square of the world
// takes the tier of how far it is from the nearest starting area (the capital's and the home towns' walls), the main
// roads out of the hub keeping the wilds along them tame, and the far edges of the world the hardest. The sea is no
// tier's. Every spawn point takes its square's tier, and the waymarkers stand where the tier changes.

import type { Region, ZoneArea, Zones } from "../../src/world/schema";
import { Grid, HUB, SIZE, T, distanceField, hexDistance, idx } from "./grid";
import { AREA_NAMES } from "./plan";
import { HUB_REGION, REGION_ORDER } from "./terrain";

export const CELL = 8;

/** The tier of an effective distance from the starting areas. */
export function tierOfDistance(distance: number): number {
  return distance <= 40 ? 1 : distance <= 80 ? 2 : distance <= 125 ? 3 : 4;
}

export function makeZones(grid: Grid, starts: Iterable<number>, mainRoads: Uint8Array): Zones {
  const fromStart = distanceField(starts, 2000);
  const roadHexes: number[] = [];
  for (let i = 0; i < mainRoads.length; i++) if (mainRoads[i]) roadHexes.push(i);
  const fromRoad = distanceField(roadHexes, 2000);

  const cols = SIZE / CELL;
  const areas: ZoneArea[] = [{ id: "the-sea", name: "The Sea", region: null, tier: 0 }];
  const byKey = new Map<string, number>();
  const area = (region: Region | null, tier: number): number => {
    const k = `${region ?? "hub"}:${tier}`;
    let index = byKey.get(k);
    if (index === undefined) {
      const name = AREA_NAMES[region ?? "hub"][tier - 1]!;
      index = areas.length;
      areas.push({ id: name.toLowerCase().replace(/^the /, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), name, region, tier });
      byKey.set(k, index);
    }
    return index;
  };

  const grid2: number[][] = [];
  for (let row = 0; row < cols; row++) {
    const line: number[] = [];
    for (let col = 0; col < cols; col++) {
      let land = 0;
      const regions = new Array<number>(6).fill(0);
      for (let dq = 0; dq < CELL; dq++) {
        for (let dr = 0; dr < CELL; dr++) {
          const i = idx(col * CELL + dq, row * CELL + dr);
          const t = grid.terrain[i]!;
          if (t !== T["deep-water"] && t !== T.water) {
            land++;
            regions[grid.region[i]!]!++;
          }
        }
      }
      if (land < (CELL * CELL) / 4) {
        line.push(0);
        continue;
      }
      const q = col * CELL + CELL / 2;
      const r = row * CELL + CELL / 2;
      const c = idx(q, r);
      const effective = Math.min(fromStart[c]!, 25 + 2.5 * fromRoad[c]!);
      let tier = tierOfDistance(effective);
      if (hexDistance(q, r, HUB.q, HUB.r) > 250) tier = 4;
      const most = regions.indexOf(Math.max(...regions));
      const region = most === HUB_REGION ? null : REGION_ORDER[most]!;
      line.push(area(region, region === null ? 1 : tier));
    }
    grid2.push(line);
  }
  return { cell: CELL, cols, rows: cols, areas, grid: grid2 };
}
