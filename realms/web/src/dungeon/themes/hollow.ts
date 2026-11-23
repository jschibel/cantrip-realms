// Root hollow (forests: Llanowar, the Durkwood, Verdura): tunnels worn through living roots, wandering, opening into
// glades under the canopy where light falls through onto grass and a spring; roots hang down the walls, mushrooms glow
// in the tunnels' dark.

import type { ThemeDef } from "../finish";
import { type Plan, type Room, WATER } from "../plan";
import { alongWalls, flood, glowLight, onBackWalls, roomAt, spread, strew } from "./common";

export const HOLLOW: ThemeDef = {
  floor: "dungeon-moss",
  stone: "root",
  size: () => [44, 36],
  carve(plan: Plan): Room[] {
    const { w, d } = plan;
    const glades: Room[] = spread(plan, 6, 11, 6, 6, w - 7, d - 7).map(([x, z]) => ({ x, z, size: 3, kind: "glade" }));
    // Wandering tunnels between the glades, two tiles wide; then the glades opened round them.
    for (let i = 1; i < glades.length; i++) plan.corridor(glades[i - 1]!.x, glades[i - 1]!.z, glades[i]!.x, glades[i]!.z, 2, "dungeon-moss", 0.35);
    // Side roots: dead ends worn by something.
    for (let k = 0; k < 6; k++) {
      const g = glades[plan.int(0, glades.length - 1)]!;
      let x = g.x;
      let z = g.z;
      for (let s = 0; s < 9; s++) {
        const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][plan.int(0, 3)]!;
        x = Math.max(2, Math.min(w - 3, x + dx! * 2));
        z = Math.max(2, Math.min(d - 3, z + dz! * 2));
        plan.rect(x, z, x + 1, z + 1, "dungeon-moss");
      }
    }
    for (const g of glades) {
      plan.disc(g.x, g.z, 3.6, "dungeon-moss");
      plan.disc(g.x, g.z, 2.4, "grass");
    }
    // A spring in one glade.
    const spring = glades[Math.floor(glades.length / 2)]!;
    for (const [dx, dz] of [[2, 1], [3, 1], [2, 2], [3, 2], [3, 0]] as const) flood(plan, spring.x + dx, spring.z + dz, WATER, "dungeon-water");
    return glades;
  },
  dress(ctx) {
    const { plan, rooms } = ctx;
    for (const g of rooms) {
      // A tree at the glade's heart (off its middle, where the way runs), the canopy's light falling on it.
      for (const [dx, dz] of [[-2, -1], [2, -2], [-1, 2]] as const) {
        const x = g.x + dx;
        const z = g.z + dz;
        if (ctx.free(x, z)) {
          plan.block(x, z, { id: "tree", x: x + 0.5, z: z + 0.5, scale: 0.85, seed: (x * 3 + z) % 6 });
          break;
        }
      }
      plan.put({ id: "dungeon-sunpool", x: g.x + 0.5, z: g.z + 0.5, args: { r: 2.2 } });
      plan.light({ kind: "point", at: [g.x + 0.5, 5, g.z + 0.5], color: [0.85, 1, 0.6], intensity: 11, reach: 9, decay: 1.2 }, 50);
      for (const [dx, dz] of [[2, -1], [-2, 1], [1, 2]] as const) {
        const x = g.x + dx;
        const z = g.z + dz;
        if (ctx.free(x, z) && plan.random() < 0.6) plan.block(x, z, { id: "bush", x: x + 0.5, z: z + 0.5, args: { flowering: (x + z) % 2 === 0 } });
      }
    }
    onBackWalls(ctx, 0.35, [], (x, z) => ({ id: "dungeon-roots", x, z, args: { w: 1 } }));
    // Glowing mushrooms along the tunnels' walls, each giving a little light; logs and stones.
    alongWalls(
      ctx,
      0.14,
      (x, z) => {
        const r = plan.random();
        if (r < 0.55) {
          const hue = (x + z) % 3 === 0 ? "blue" : "green";
          plan.light(glowLight([x + 0.5, 0.6, z + 0.5], hue === "blue" ? [0.4, 0.7, 1] : [0.45, 1, 0.55], 2.6, 3.5), 18);
          return { id: "dungeon-mushrooms", x: x + 0.5, z: z + 0.5, seed: x * 3 + z, args: { hue } };
        }
        if (r < 0.8) return { id: "boulder", x: x + 0.5, z: z + 0.5, seed: (x + z) % 7, args: { r: 0.35 } };
        return { id: "bush", x: x + 0.5, z: z + 0.5 };
      },
      (x, z) => roomAt(rooms, x, z) === undefined,
    );
    strew(ctx, 0.04, (x, z) => (plan.surface[plan.index(x, z)] === "grass" ? null : { id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) }));
    strew(ctx, 0.012, (x, z) => ({ id: "bones", x: x + 0.5, z: z + 0.5, seed: 1 + ((x + z) % 5), y: 0.004 + ((x * 7 + z) % 5) * 0.0004 }));
  },
};
