// Root hollow (forests: Llanowar, the Durkwood, Verdura): each round a glade under the canopy, opened among living roots -
// grass at its heart where the light falls through, moss and leaf-litter round it, trees and bushes at its edge, roots
// hanging down its back, mushrooms glowing in its corners, a spring at one side; the boss's hall a wider glade.

import type { ThemeDef } from "../finish";
import { FLOOR, WATER } from "../plan";
import { alongWalls, flood, glowLight, onBackWalls, round, strew } from "./common";

export const HOLLOW: ThemeDef = {
  floor: "dungeon-moss",
  stone: "root",
  hue: "green",
  size: (big, random) => (big ? [28, 13] : [25 + Math.floor(random() * 3), 13]),
  carve(plan, arena) {
    round(plan, arena, 0.1, 0.3, "dungeon-moss");
    const mx = (arena.x0 + arena.x1) / 2;
    const mz = (arena.z0 + arena.z1) / 2;
    for (let z = arena.z0; z <= arena.z1; z++) {
      for (let x = arena.x0; x <= arena.x1; x++) if (plan.cell(x, z) === FLOOR && Math.hypot((x - mx) / 1.7, z - mz) < 4.6) plan.surface[plan.index(x, z)] = "grass";
    }
    // A spring at one side of the glade.
    const east = plan.random() < 0.5;
    const sx = east ? arena.x1 - 3 : arena.x0 + 3;
    const sz = arena.z1 - 3;
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]] as const) if (plan.cell(sx + dx, sz + dz) === FLOOR) flood(plan, sx + dx, sz + dz, WATER, "dungeon-water");
  },
  dress(ctx) {
    const { plan, arena, last } = ctx;
    const { x0, x1, z0, z1 } = arena;
    const mx = Math.round((x0 + x1) / 2);
    const mz = Math.round((z0 + z1) / 2);
    // The canopy's light falling on the glade's heart.
    plan.put({ id: "dungeon-sunpool", x: mx + 0.5, z: mz + 0.5, args: { r: 2.2 } });
    plan.light({ kind: "point", at: [mx + 0.5, 6, mz + 0.5], color: [0.85, 1, 0.6], intensity: 14, reach: 12, decay: 1.1 }, 75);
    // Trees and bushes at the glade's edge, where they shut nobody out.
    alongWalls(ctx, 0.32, (x, z) => {
      const r = plan.random();
      if (r < 0.4) return { id: "tree", x: x + 0.5, z: z + 0.5, scale: 0.8, seed: (x * 3 + z) % 6 };
      if (r < 0.7) return { id: "bush", x: x + 0.5, z: z + 0.5, args: { flowering: (x + z) % 2 === 0 } };
      if (r < 0.88) {
        const hue = (x + z) % 3 === 0 ? "blue" : "green";
        plan.light(glowLight([x + 0.5, 0.6, z + 0.5], hue === "blue" ? [0.4, 0.7, 1] : [0.45, 1, 0.55], 2.6, 3.5), 18);
        return { id: "dungeon-mushrooms", x: x + 0.5, z: z + 0.5, seed: x * 3 + z, args: { hue } };
      }
      return { id: "boulder", x: x + 0.5, z: z + 0.5, seed: (x + z) % 7, args: { r: 0.35 } };
    });
    onBackWalls(ctx, 0.45, [], (x, z) => ({ id: "dungeon-roots", x, z, args: { w: 1 } }));
    // Fireflies of a sort: a few glows over the glade's edge.
    for (const [x, z] of [[x0 + 3, z0 + 2], [x1 - 3, z0 + 2], [x0 + 2, mz], [x1 - 2, mz]] as const) plan.light(glowLight([x + 0.5, 1.6, z + 0.5], [0.6, 1, 0.5], 4, 6), 40);
    strew(ctx, 0.05, (x, z) => (plan.surface[plan.index(x, z)] === "grass" ? null : { id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) }));
    strew(ctx, 0.01, (x, z) => ({ id: "bones", x: x + 0.5, z: z + 0.5, seed: 1 + ((x + z) % 5), y: 0.004 + ((x * 7 + z) % 5) * 0.0004 }));
  },
};
