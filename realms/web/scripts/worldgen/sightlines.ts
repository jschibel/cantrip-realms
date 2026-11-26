// What the camera must see on the travel map, and how tall anything may stand south of it. The camera looks north,
// pitched 45 degrees, turning at most 45 degrees either side: a thing standing h tiles above the ground hides about h
// tiles of ground behind it along the way the camera looks - north at the front heading, north-west and north-east at
// the turned ones. So south of every tile that must be seen (a road, a pass, a dungeon's entrance and what stands beside
// it, a town's icon and its ways, a landmark, a dock, a signpost) nothing may rise higher than its distance from it along
// those three lines: `clearance` is that height, tiles above the ground, for every tile of the travel map.

import type { Land } from "./land";

/** How far south of a seen tile a tall thing is looked for, tiles. */
export const SIGHT_REACH = 16;

/** The three ways the camera looks, as steps from what hides to what is hidden: north, north-west, north-east. */
const LOOKS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, -1],
  [1, -1],
];

/**
 * For every tile, the most a thing standing on it may rise above its own ground, tiles, so that no tile `seen` lies
 * hidden behind it at any of the camera's headings: for a seen tile p and a tile c a distance d (tiles, along one of the
 * three lines) south of it, a thing at c may stand d tiles over p's ground - less what c's ground stands above p's.
 * Infinity where nothing seen lies within SIGHT_REACH.
 */
export function clearance(land: Land, seen: Iterable<number>, inMap: (i: number) => boolean): Float32Array {
  const out = new Float32Array(land.size).fill(Infinity);
  const W = land.width;
  for (const p of seen) {
    const px = p % W;
    const pz = Math.floor(p / W);
    const gp = land.height[p]! / 16;
    for (const [lx, lz] of LOOKS) {
      const step = Math.hypot(lx, lz);
      for (let k = 1; k <= SIGHT_REACH; k++) {
        const x = px - lx * k;
        const z = pz - lz * k;
        if (x < 0 || z < 0 || x >= W || z >= land.depth) break;
        const c = z * W + x;
        if (!inMap(c)) break;
        const along = k * step;
        const limit = along - 0.5 - (land.height[c]! / 16 - gp);
        if (limit < out[c]!) out[c] = limit;
      }
    }
  }
  return out;
}

/**
 * The highest a peak `w` tiles square may stand on tile `i` under the clearance: its summit at its middle, its sides
 * falling to nothing at its square's edge, so each tile of its square holds it to the height it reaches there.
 */
export function peakRoom(land: Land, room: Float32Array, i: number, w: number): number {
  const W = land.width;
  const half = (w - 1) / 2;
  let most = Infinity;
  for (let dz = -half; dz <= half; dz++) {
    for (let dx = -half; dx <= half; dx++) {
      const share = 1 - Math.max(Math.abs(dx), Math.abs(dz)) / (half + 0.5);
      const r = room[i + dz * W + dx]!;
      if (r !== Infinity) most = Math.min(most, r / share);
    }
  }
  return most;
}
