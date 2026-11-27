// Foundry (the orcs' delvings in the Ironclaw Mountains, Keldon forges): each round a forge hall - soot-black flags with
// embers in their joints, a channel of lava down each side, forges glowing against the back wall with anvils before them,
// chains hanging, crucibles of melt, coal and crates; the boss's hall a greater foundry.

import type { ThemeDef } from "../finish";
import { LAVA } from "../plan";
import { alongWalls, brazier, fireLight, flood, glowLight, hall, onBackWalls, strew } from "./common";

export const FOUNDRY: ThemeDef = {
  floor: "dungeon-ash",
  stone: "soot",
  hue: "fire",
  size: (big, random) => (big ? [27 + Math.floor(random() * 2), 13] : [23 + Math.floor(random() * 3), 13]),
  carve(plan, arena) {
    hall(plan, arena);
    // The lava channels, down the hall's sides between its head and its foot.
    for (let z = arena.z0 + 3; z <= arena.z1 - 3; z++) for (const x of [arena.x0, arena.x1]) flood(plan, x, z, LAVA);
  },
  dress(ctx) {
    const { plan, arena, last } = ctx;
    const { x0, x1, z0, z1, cx } = arena;
    // Forges against the back wall: two tiles wide, an anvil before each.
    const forges: [number, number][] = [];
    for (const [x, z] of ctx.backWalls()) {
      if (forges.some(([fx, fz]) => fz === z && Math.abs(fx - x) < 5)) continue;
      if (!ctx.free(x, z) || !ctx.free(x + 1, z)) continue;
      if (!plan.block(x, z, null)) continue;
      if (!plan.block(x + 1, z, null)) {
        plan.blocked[plan.index(x, z)] = 0;
        continue;
      }
      forges.push([x, z]);
      plan.put({ id: "dungeon-forge", x: x + 1, z });
      plan.light(fireLight([x + 1, 1.3, z + 1.2], 9, x, [1, 0.5, 0.2]), 45);
      const [ax, az] = [x + 1, z + 2];
      if (ctx.free(ax, az)) plan.block(ax, az, { id: "dungeon-anvil", x: ax + 0.5, z: az + 0.5, rot: x % 2 });
    }
    onBackWalls(ctx, 0.35, forges.flatMap(([x, z]) => [[x, z], [x + 1, z]] as [number, number][]), (x, z) => (plan.random() < 0.6 ? { id: "dungeon-chains", x: x + 0.5, z } : { id: "torch", x: x + 0.5, z }));
    // The lava's glow along each channel.
    for (const x of [x0, x1]) for (let z = z0 + 4; z <= z1 - 3; z += 4) plan.light(glowLight([x + 0.5, 0.8, z + 0.5], [1, 0.45, 0.15], 7, 5.5), 40);
    if (last) for (const dx of [-3, 3]) brazier(ctx, cx + dx, z0 + 2, 70, 9);
    // Crucibles, coal barrels and crates along the walls.
    alongWalls(ctx, 0.1, (x, z) => {
      const r = plan.random();
      if (r < 0.3) {
        plan.light(glowLight([x + 0.5, 1.2, z + 0.5], [1, 0.55, 0.2], 3, 3.5), 20);
        return { id: "dungeon-crucible", x: x + 0.5, z: z + 0.5 };
      }
      if (r < 0.65) return { id: "barrel", x: x + 0.5, z: z + 0.5 };
      return { id: "crate", x: x + 0.5, z: z + 0.5, args: { size: 0.75 } };
    });
    strew(ctx, 0.05, (x, z) => ({ id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) }));
  },
};
