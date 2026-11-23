// What the themes share: placing rooms apart, the wall-hung and floor-standing dressing, and the lights fires give.

import type { LightData, PropData, RGB } from "../../../world/format";
import type { DressContext } from "../finish";
import { FLOOR, type Plan, type Room, STEPS, WALL } from "../plan";

/**
 * `count` room middles within the rectangle (x0, z0)-(x1, z1), at least `apart` tiles from each other, chained from the
 * one farthest west, each next the nearest not yet taken: rooms in a winding order.
 */
export function spread(plan: Plan, count: number, apart: number, x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const found: [number, number][] = [];
  for (let tries = 0; tries < 900 && found.length < count; tries++) {
    const x = plan.int(x0, x1);
    const z = plan.int(z0, z1);
    if (found.some(([fx, fz]) => Math.hypot(fx - x, fz - z) < apart)) continue;
    found.push([x, z]);
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const chain = found.slice(0, 1);
  const left = found.slice(1);
  while (left.length > 0) {
    const [lx, lz] = chain.at(-1)!;
    left.sort((a, b) => Math.hypot(a[0] - lx, a[1] - lz) - Math.hypot(b[0] - lx, b[1] - lz) || a[0] - b[0] || a[1] - b[1]);
    chain.push(left.shift()!);
  }
  return chain;
}

/** A fire's flickering light, in step with the flames (the slice's torches and braziers). */
export function fireLight(at: readonly [number, number, number], strength: number, phase: number, color: RGB = [1, 0.58, 0.26]): LightData {
  return {
    kind: "point",
    at,
    color,
    intensity: strength,
    reach: 4 + strength * 0.4,
    flicker: { base: strength * 0.92, steps: [0, strength * 0.16, strength * 0.07], rate: 8, phase: phase % 3 },
  };
}

/** A steady glow (crystals, fungus, lava, ichor). */
export function glowLight(at: readonly [number, number, number], color: RGB, intensity: number, reach: number): LightData {
  return { kind: "point", at, color, intensity, reach, decay: 1.6 };
}

/**
 * Torches along the back walls, about `every` tiles apart, each giving its light; a tile beside one already hung is
 * skipped. Returns the tiles hung.
 */
export function torches(ctx: DressContext, every: number, chance = 1, id = "torch"): [number, number][] {
  const hung: [number, number][] = [];
  const { plan } = ctx;
  for (const [x, z] of ctx.backWalls()) {
    if (hung.some(([hx, hz]) => hz === z && Math.abs(hx - x) < every)) continue;
    if (plan.random() > chance) continue;
    hung.push([x, z]);
    plan.put({ id, x: x + 0.5, z });
    plan.light(fireLight([x + 0.5, 2.1, z + 0.8], 5.5, hung.length), 30);
  }
  return hung;
}

/** Puts things on the back walls (nothing they stand on is blocked): every so often, not beside the torches. */
export function onBackWalls(ctx: DressContext, chance: number, avoid: readonly [number, number][], make: (x: number, z: number) => PropData | null): void {
  for (const [x, z] of ctx.backWalls()) {
    if (avoid.some(([ax, az]) => az === z && Math.abs(ax - x) < 1)) continue;
    if (ctx.plan.random() > chance) continue;
    const p = make(x, z);
    if (p) ctx.plan.put(p);
  }
}

/** Whether a floor tile has a wall (or the end of the floor) beside it. */
export function byWall(plan: Plan, x: number, z: number): boolean {
  return STEPS.some(([dx, dz]) => plan.cell(x + dx, z + dz) !== FLOOR);
}

/**
 * Stands things that block their tile along the walls, where they cut no way off: each free tile beside a wall takes one
 * at `chance`, `make` saying what.
 */
export function alongWalls(ctx: DressContext, chance: number, make: (x: number, z: number) => PropData | null, near?: (x: number, z: number) => boolean): void {
  const { plan } = ctx;
  for (const [x, z] of plan.walkables()) {
    if (!ctx.free(x, z) || !byWall(plan, x, z) || (near && !near(x, z))) continue;
    if (plan.random() > chance) continue;
    const p = make(x, z);
    if (p) plan.block(x, z, p);
  }
}

/** Strews things that block nothing (bones, grime) over the floor. */
export function strew(ctx: DressContext, chance: number, make: (x: number, z: number) => PropData | null): void {
  const { plan } = ctx;
  for (const [x, z] of plan.walkables()) {
    if (ctx.kept(x, z) || plan.random() > chance) continue;
    const p = make(x, z);
    if (p) plan.put(p);
  }
}

/** The room a tile is in, if it is in one (within its size). */
export function roomAt(rooms: readonly Room[], x: number, z: number): Room | undefined {
  return rooms.find((r) => Math.max(Math.abs(r.x - x), Math.abs(r.z - z)) <= r.size);
}

/** Fills a tile with water or lava (or the void) only where that cuts no way off. */
export function flood(plan: Plan, x: number, z: number, cell: 2 | 3 | 4, surface = ""): boolean {
  if (!plan.safe(x, z)) return false;
  plan.fill(x, z, cell, surface);
  return true;
}

export { WALL };
