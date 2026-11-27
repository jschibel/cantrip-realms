// Mage tower (coasts and isles: the Academy on Walassa; and the mage towers whose waystones carry travellers): each round
// a round floor of the tower - blue-grey squares, a ring of marble round its heart, shelves of books along its back wall,
// time-rifts standing open at its sides, crystals glowing at its edge; the mage's hall at the top a wider floor ringed by
// pillars.

import type { ThemeDef } from "../finish";
import { alongWalls, brazier, fireLight, glowLight, round, strew, torches } from "./common";

export const TOWER: ThemeDef = {
  floor: "dungeon-tower-floor",
  stone: "tower",
  hue: "blue",
  size: (big, random) => (big ? [27 + Math.floor(random() * 2), 13] : [23 + Math.floor(random() * 3), 13]),
  carve(plan, arena) {
    round(plan, arena, 0, 0.2);
    // A ring of marble round the floor's heart.
    const mx = (arena.x0 + arena.x1) / 2;
    const mz = (arena.z0 + arena.z1) / 2;
    for (let z = arena.z0; z <= arena.z1; z++) {
      for (let x = arena.x0; x <= arena.x1; x++) {
        const d = Math.hypot((x - mx) / 1.6, z - mz);
        if (plan.cell(x, z) === 1 && d > 3.2 && d < 4.4) plan.surface[plan.index(x, z)] = "dungeon-marble";
      }
    }
  },
  dress(ctx) {
    const { plan, arena, last } = ctx;
    const { x0, x1, z0, z1, cx } = arena;
    const mz = Math.round((z0 + z1) / 2);
    torches(ctx, 5, 0.8);
    // Shelves of books along the back walls.
    for (const [x, z] of ctx.backWalls()) if (ctx.free(x, z) && plan.random() < 0.55) plan.block(x, z, { id: "bookshelf", x, z, seed: 3 + ((x * 7 + z) % 9), args: { goods: (x + z) % 5 === 0 } });
    // Time-rifts at the floor's sides, a desk by each.
    for (const x of [x0 + 2, x1 - 2]) {
      if (ctx.free(x, mz) && plan.block(x, mz, { id: "dungeon-rift", x: x + 0.5, z: mz + 0.5 })) plan.light(glowLight([x + 0.5, 1.2, mz + 0.8], [0.5, 0.75, 1], 9, 7), 55);
      const dz = mz + 3;
      if (ctx.free(x, dz) && plan.block(x, dz, { id: "dungeon-desk", x: x + 0.5, z: dz + 0.5 })) plan.light(fireLight([x + 1, 1.3, dz + 0.6], 4, x, [1, 0.7, 0.4]), 30);
    }
    if (last) {
      // The mage's hall: a ring of pillars, braziers between some.
      const mx = (x0 + x1) / 2;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const x = Math.round(mx + Math.cos(a) * (x1 - x0) * 0.36);
        const z = Math.round(mz + Math.sin(a) * (z1 - z0) * 0.36);
        if (k % 4 === 1) brazier(ctx, x, z, 40, 8);
        else if (ctx.free(x, z)) plan.block(x, z, { id: "dungeon-column", x: x + 0.5, z: z + 0.5, args: { stone: "tower", h: 2.9 } });
      }
      for (const dx of [-3, 3]) brazier(ctx, cx + dx, z0 + 2, 70, 9);
    }
    alongWalls(ctx, 0.25, (x, z) => ({ id: "dungeon-crystal", x: x + 0.5, z: z + 0.5, seed: x * 5 + z, args: { hue: (x + z) % 2 ? "blue" : "violet", size: 0.7 } }), (x, z) => z > z0 + 1);
    alongWalls(ctx, 0.04, (x, z) => (plan.random() < 0.5 ? { id: "pot", x: x + 0.5, z: z + 0.5, args: { r: 0.2 } } : { id: "crate", x: x + 0.5, z: z + 0.5, args: { size: 0.625 } }));
    strew(ctx, 0.015, (x, z) => ({ id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) }));
  },
};
