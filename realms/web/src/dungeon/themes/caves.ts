// Caves (mountains and hills: Keld, the Hurloon and Ironclaw Mountains; the Keldon fortress): each round a great cavern
// chamber, its rock wandering in and out round a floor of packed earth, a still pool in one side of it, stalagmites,
// boulders and crystals glowing along its walls, the raiders' braziers burning; the boss's hall a vaster chamber.

import type { ThemeDef } from "../finish";
import { FLOOR, WATER } from "../plan";
import { alongWalls, brazier, flood, glowLight, round, strew, torches } from "./common";

export const CAVES: ThemeDef = {
  floor: "dungeon-cave-floor",
  stone: "cave",
  hue: "red",
  size: (big, random) => (big ? [28, 13] : [25 + Math.floor(random() * 3), 13]),
  carve(plan, arena) {
    round(plan, arena, 0.12, 0.45);
    // A pool in the south-west or the south-east of the chamber, its shore dry round it.
    const east = plan.random() < 0.5;
    const px = east ? arena.x1 - 3 : arena.x0 + 3;
    const pz = arena.z1 - 3;
    for (let z = pz - 2; z <= pz + 2; z++) {
      for (let x = px - 3; x <= px + 3; x++) {
        if (((x - px) / 3) ** 2 + ((z - pz) / 1.8) ** 2 > 1 || plan.cell(x, z) !== FLOOR) continue;
        flood(plan, x, z, WATER, "dungeon-water");
      }
    }
  },
  dress(ctx) {
    const { plan, arena, last } = ctx;
    const { x0, x1, z0, z1, cx } = arena;
    // The raiders' braziers: by the head of the chamber and down its sides.
    for (const [x, z] of [[cx - 4, z0 + 2], [cx + 4, z0 + 2], [x0 + 2, Math.round((z0 + z1) / 2)], [x1 - 2, Math.round((z0 + z1) / 2)]] as const) brazier(ctx, x, z, last ? 60 : 48, 9);
    torches(ctx, 7, 0.5);
    alongWalls(ctx, 0.3, (x, z) => {
      const roll = plan.random();
      if (roll < 0.3) {
        const hue = (x + z) % 3 === 0 ? "violet" : "blue";
        plan.light(glowLight([x + 0.5, 1.0, z + 0.5], hue === "blue" ? [0.4, 0.65, 1] : [0.7, 0.45, 1], 3.5, 4.5), 22);
        return { id: "dungeon-crystal", x: x + 0.5, z: z + 0.5, seed: x * 7 + z, args: { hue, size: 0.8 + plan.random() * 0.5 } };
      }
      if (roll < 0.62) return { id: "dungeon-stalagmite", x: x + 0.5, z: z + 0.5, seed: x + z, args: { h: 0.8 + plan.random() * 1.0 } };
      if (roll < 0.84) return { id: "boulder", x: x + 0.5, z: z + 0.5, seed: (x * 3 + z) % 9, args: { r: 0.35 + plan.random() * 0.15 } };
      if (roll < 0.94) {
        plan.light(glowLight([x + 0.5, 0.6, z + 0.5], [0.4, 1, 0.6], 2, 3), 10);
        return { id: "dungeon-mushrooms", x: x + 0.5, z: z + 0.5, seed: x + z * 3, args: { hue: "green" } };
      }
      return { id: "barrel", x: x + 0.5, z: z + 0.5 };
    });
    strew(ctx, 0.025, (x, z) => ({ id: "bones", x: x + 0.5, z: z + 0.5, seed: 1 + ((x + z) % 5), y: 0.004 + ((x * 7 + z) % 5) * 0.0004 }));
    strew(ctx, 0.04, (x, z) => (plan.cell(x, z) === FLOOR ? { id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) } : null));
  },
};
