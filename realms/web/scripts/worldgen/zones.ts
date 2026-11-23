// The tier zones (design.md A6, interfaces.md "Spawn tiers"): difficulty by distance. Each 16-by-16 square of the world
// takes the tier of how far it is from the nearest starting area (the capital's and the home towns' walls), the main
// roads out of the starting areas keeping the wilds along them tame, the far coasts the hardest, and never less than its
// region's least tier. The sea is no tier's. Every spawn point takes its square's tier, and the waymarkers stand where
// the tier rises.

import type { ZoneArea, Zones } from "../../src/world/format";
import type { Land } from "./land";
import type { Layout } from "./layout";

export const CELL = 16;

/** The tier of an effective distance, tiles, from the starting areas. */
export function tierOfDistance(distance: number): number {
  return distance <= 70 ? 1 : distance <= 140 ? 2 : distance <= 220 ? 3 : 4;
}

export function makeZones(land: Land, layout: Layout, starts: Iterable<number>, mainRoads: Uint8Array, fromLand: Float32Array): Zones {
  const fromStart = land.distances(starts);
  const roadTiles: number[] = [];
  for (let i = 0; i < mainRoads.length; i++) if (mainRoads[i]) roadTiles.push(i);
  const fromRoad = land.distances(roadTiles);
  const cols = Math.ceil(land.width / CELL);
  const rows = Math.ceil(land.depth / CELL);
  const areas: ZoneArea[] = [{ id: "the-sea", name: "The Sea", region: null, tier: 0 }];
  const byKey = new Map<string, number>();
  const area = (k: number, tier: number): number => {
    const region = layout.regions[k]!;
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
  const grid: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: number[] = [];
    for (let col = 0; col < cols; col++) {
      let ground = 0;
      const regions = new Array<number>(layout.regions.length).fill(0);
      for (const i of land.rect(col * CELL, row * CELL, col * CELL + CELL - 1, row * CELL + CELL - 1)) {
        if (land.isSea(i)) continue;
        ground++;
        regions[land.region[i]!]!++;
      }
      if (ground < (CELL * CELL) / 5) {
        line.push(0);
        continue;
      }
      const c = land.idx(Math.min(land.width - 1, col * CELL + CELL / 2), Math.min(land.depth - 1, row * CELL + CELL / 2));
      const effective = Math.min(fromStart[c]!, 43 + 2.5 * fromRoad[c]!);
      let tier = tierOfDistance(effective);
      // The edges of the world, by the open sea far from any start, are the hardest.
      if (fromLand[c]! === 0 && seaNear(land, fromLand, c) && fromStart[c]! > 190) tier = 4;
      const k = regions.indexOf(Math.max(...regions));
      line.push(area(k, Math.max(tier, layout.regions[k]!.minTier ?? 1)));
    }
    grid.push(line);
  }
  return { cell: CELL, cols, rows, areas, grid };
}

/** Whether the open sea lies within 20 tiles of a tile. */
function seaNear(land: Land, fromLand: Float32Array, i: number): boolean {
  const x = land.xOf(i);
  const z = land.zOf(i);
  for (let dz = -20; dz <= 20; dz += 5) for (let dx = -20; dx <= 20; dx += 5) if (land.inside(x + dx, z + dz) && fromLand[land.idx(x + dx, z + dz)]! > 6) return true;
  return false;
}
