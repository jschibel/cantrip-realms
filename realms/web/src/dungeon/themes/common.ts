// What the themes share: the arena's outline (a hall's rectangle, a cave's or a glade's ragged round, a tower's round),
// the wall-hung and floor-standing dressing, and the lights fires give.

import type { LightData, PropData, RGB } from "../../world/format";
import type { Arena, DressContext } from "../finish";
import { FLOOR, type Plan, STEPS, WALL } from "../plan";

/** Opens the whole arena: a hall's rectangle of floor. */
export function hall(plan: Plan, arena: Arena, surface?: string): void {
  plan.rect(arena.x0, arena.z0, arena.x1, arena.z1, surface);
}

/**
 * Opens a round arena within the rectangle: an ellipse filling it, its edge wandering in by up to `rough` of its reach
 * (a cave's chamber, a glade), the dice choosing how; `square` rounds it only that much toward a rectangle's corners
 * (0 an ellipse, 1 the rectangle).
 */
export function round(plan: Plan, arena: Arena, rough: number, square = 0, surface?: string): void {
  const { x0, z0, x1, z1 } = arena;
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const a = (x1 - x0) / 2 + 0.5;
  const b = (z1 - z0) / 2 + 0.5;
  const waves = [1, 2, 3].map((k) => ({ k: k + 1, phase: plan.random() * Math.PI * 2, size: (0.5 + plan.random()) / k }));
  const total = waves.reduce((sum, w) => sum + w.size, 0);
  for (const w of waves) w.size *= rough / total;
  const p = 2 + square * 6;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const u = (x - mx) / a;
      const v = (z - mz) / b;
      const angle = Math.atan2(v, u);
      const reach = 1 - waves.reduce((s, w) => s + w.size * (0.5 + 0.5 * Math.sin(angle * w.k + w.phase)), 0);
      if (Math.abs(u) ** p + Math.abs(v) ** p <= reach ** p) plan.carve(x, z, surface);
    }
  }
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

/**
 * Stands a pair of things either side of the arena's middle column (pillars down a hall, statues to a throne) at each
 * row from `from` to `to` every `every` rows, `apart` tiles out from the middle - where each may stand.
 */
export function flanking(ctx: DressContext, apart: number, from: number, to: number, every: number, make: (x: number, z: number) => PropData): [number, number][] {
  const out: [number, number][] = [];
  const { cx } = ctx.arena;
  for (let z = from; z <= to; z += every) {
    for (const x of [cx - apart, cx + apart]) {
      if (ctx.free(x, z) && ctx.plan.block(x, z, make(x, z))) out.push([x, z]);
    }
  }
  return out;
}

/** A brazier on a free tile, burning: its light offered at `weight`. */
export function brazier(ctx: DressContext, x: number, z: number, weight = 45, strength = 8.5): boolean {
  if (!ctx.free(x, z) || !ctx.plan.block(x, z, { id: "brazier", x: x + 0.5, z: z + 0.5 })) return false;
  ctx.plan.light(fireLight([x + 0.5, 1.5, z + 0.8], strength, x + z), weight);
  return true;
}

/** Fills a tile with water or lava (or the void) only where that cuts no way off. */
export function flood(plan: Plan, x: number, z: number, cell: 2 | 3 | 4, surface = ""): boolean {
  if (!plan.safe(x, z)) return false;
  plan.fill(x, z, cell, surface);
  return true;
}

export { WALL };
