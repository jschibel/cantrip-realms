// The grounds as terraces (the world revamp's "Movement"): every height a whole level of 12 texels, open neighbours a
// level apart at most (a hop for whoever hops), the town's rows each one level, the country eased to meet them; ramps of
// two tiles wherever a street or a road climbs a level (flag RAMP, the lower a quarter of the way up, the upper three
// quarters); water at its banks' level and a bridge's deck at its banks'.

import { BLOCKED, RAMP } from "../../../src/world/format";
import { S } from "../ids";
import { Use } from "../land";
import type { Ctx } from "./index";

export const STEP = 12;

/** Whether a tile is a way that climbs by ramps: a street, a road, a quay, a door, the square. */
function way(ctx: Ctx, i: number): boolean {
  const u = ctx.land.use[i]!;
  return (ctx.land.flags[i]! & BLOCKED) === 0 && (u === Use.Street || u === Use.Road || u === Use.Door || u === Use.Kept || u === Use.Dock);
}

/**
 * Eases the country's levels to a level at most between neighbours, the town's own (and the sea's) held: lowered from
 * the low ground up, then raised from the high ground down, so every pair of neighbours ends a level apart at most.
 */
export function smoothLevels(ctx: Ctx, fixed: (i: number) => boolean): void {
  const { land, level } = ctx;
  const W = land.width;
  const near: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    // Lowering: a tile no more than a level above its lowest neighbour (a Dijkstra from every tile, cheapest first).
    const order = Array.from({ length: land.size }, (_, i) => i).sort((a, b) => (pass === 0 ? level[a]! - level[b]! : level[b]! - level[a]!) || a - b);
    const queue = [...order];
    let head = 0;
    const inQueue = new Uint8Array(land.size).fill(1);
    while (head < queue.length) {
      const i = queue[head++]!;
      inQueue[i] = 0;
      for (const n of land.n4(i, near)) {
        if (fixed(n)) continue;
        const want = pass === 0 ? Math.min(level[n]!, level[i]! + 1) : Math.max(level[n]!, level[i]! - 1);
        if (want !== level[n]) {
          level[n] = want;
          if (!inQueue[n]) {
            inQueue[n] = 1;
            queue.push(n);
          }
        }
      }
    }
  }
  void W;
}

/** The final heights: levels to texels, water at its banks, ramps where ways climb, bridges' decks. */
export function levelGrounds(ctx: Ctx): void {
  const { land, level } = ctx;
  const near: number[] = [];
  const water = (i: number) => land.isWater(i);
  for (let i = 0; i < land.size; i++) land.height[i] = level[i]! * STEP;
  // Water, and a bridge's deck over it: at the lowest of its banks.
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < land.size; i++) {
      if (!water(i)) continue;
      const banks = land.n4(i, near).filter((n) => !water(n)).map((n) => land.height[n]!);
      if (banks.length > 0) land.height[i] = Math.min(...banks);
      else {
        const others = land.n4(i, near).map((n) => land.height[n]!);
        land.height[i] = Math.min(land.height[i]!, ...others);
      }
    }
  }
  // An open water tile (a bridge's) takes the level of the open ground it joins.
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < land.size; i++) {
      if (!water(i) || !land.open(i)) continue;
      const ground = land.n4(i, near).filter((n) => land.open(n) && !water(n)).map((n) => land.height[n]!);
      const decks = land.n4(i, near).filter((n) => land.open(n) && water(n)).map((n) => land.height[n]!);
      const all = [...ground, ...decks];
      if (all.length > 0) land.height[i] = ground.length > 0 ? Math.min(...ground) : Math.max(...decks);
    }
  }
  for (const p of land.fixtures) {
    if (p.id !== "bridge") continue;
    const x = Math.floor(p.x) + 1;
    const z = Math.floor(p.z) + 1;
    const deck = land.inside(x, z) ? land.height[land.idx(x, z)]! : 0;
    (p as { args?: Record<string, unknown> }).args = { ...p.args, y: deck / 16 + 0.25 };
  }
  // Ramps: each tile of a way at the top of a bank whose way goes on a level below it, with the tile below.
  const ramp = new Uint8Array(land.size);
  // A ramp's upper tile is lowered a quarter and its lower raised a quarter: neither may then be more than a hop from an
  // open neighbour it does not ramp with (the upper one's higher neighbours, the lower one's lower).
  const steady = (i: number, sign: number) => land.n4(i, []).every((m) => !land.open(m) || sign * (land.height[m]! - land.height[i]!) <= 0);
  for (let i = 0; i < land.size; i++) {
    if (!way(ctx, i) || water(i) || ramp[i] || !steady(i, 1)) continue;
    for (const n of land.n4(i, near)) {
      if (!way(ctx, n) || water(n) || ramp[n] || land.height[n] !== land.height[i]! - STEP || !steady(n, -1)) continue;
      ramp[i] = 1;
      ramp[n] = 1;
      break;
    }
  }
  const quarter = STEP / 4;
  for (let i = 0; i < land.size; i++) {
    if (!ramp[i]) continue;
    const low = land.n4(i, near).some((n) => ramp[n] && land.height[n]! > land.height[i]!);
    land.height[i] = low ? land.height[i]! + quarter : land.height[i]! - quarter;
    land.flags[i] = (land.flags[i]! & ~BLOCKED) | RAMP;
  }
  land.levelled = true;
  void S;
}
