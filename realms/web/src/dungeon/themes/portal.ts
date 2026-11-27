// The Phyrexian Portal (the capstone): the praetor's realm - each round an island of plating hanging over the void, a
// causeway of crystal down its middle, pylons of glowing ichor at its edge, altars and vats, violet ichor-glow welling up
// from under its rim; the praetor's hall the greatest island, its sigil under the praetor.

import type { ThemeDef } from "../finish";
import { FLOOR } from "../plan";
import { alongWalls, glowLight, round } from "./common";

export const PORTAL: ThemeDef = {
  floor: "dungeon-plates",
  stone: "plate",
  hue: "ichor",
  size: (big, random) => (big ? [28, 13] : [25 + Math.floor(random() * 3), 13]),
  carve(plan, arena) {
    round(plan, arena, 0.08, 0.25);
    // A causeway of crystal from the way in to the gate.
    for (let z = arena.z0; z <= arena.z1; z++) for (let x = arena.cx - 1; x <= arena.cx + 1; x++) if (plan.cell(x, z) === FLOOR) plan.surface[plan.index(x, z)] = "dungeon-crystal";
  },
  dress(ctx) {
    const { plan, arena, last, spots } = ctx;
    const { x0, x1, z0, z1 } = arena;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    if (last) {
      const boss = spots.find((s) => s.role === "boss");
      const [bx, bz] = boss ? [boss.x, boss.z] : [arena.cx, z0 + 2];
      plan.put({ id: "dungeon-sigil", x: bx + 0.5, z: bz + 0.5, args: { r: 3 } });
      plan.light(glowLight([bx + 0.5, 1.5, bz + 0.5], [0.5, 1, 0.45], 10, 9), 70);
    }
    // Pylons round the island's edge, an altar or a vat between.
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.3;
      const x = Math.round(mx + Math.cos(a) * (x1 - x0) * 0.4);
      const z = Math.round(mz + Math.sin(a) * (z1 - z0) * 0.4);
      if (!ctx.free(x, z)) continue;
      const pylon = k % 2 === 0;
      const id = pylon ? "dungeon-pylon" : k % 4 === 1 ? "dungeon-vat" : "dungeon-altar";
      if (!plan.block(x, z, { id, x: x + 0.5, z: z + 0.5, ...(pylon ? { args: { h: 2.6 } } : {}) })) continue;
      plan.light(glowLight([x + 0.5, pylon ? 1.8 : 1.2, z + 0.8], pylon ? [0.45, 1, 0.4] : [0.6, 1, 0.5], pylon ? 7 : 4, pylon ? 6 : 4), pylon ? 42 : 24);
    }
    // Violet ichor-glow from below the island's edge, the void's only light.
    alongWalls(ctx, 0.1, (x, z) => {
      const violet = (x + z) % 3 !== 0;
      plan.light(glowLight([x + 0.5, 0.7, z + 0.5], violet ? [0.8, 0.4, 1] : [0.45, 1, 0.5], 3.5, 4), 16);
      return { id: "dungeon-crystal", x: x + 0.5, z: z + 0.5, seed: x + z, args: { hue: violet ? "violet" : "green", size: 0.6 + ((x * 7 + z) % 4) * 0.12 } };
    });
  },
};
