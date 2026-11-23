// The Phyrexian Portal (the capstone): the praetor's realm - islands of plating hanging over the void, joined by
// bridges of crystal, pylons of glowing ichor, altars and vats; on the last floor the praetor's hall, its sigil ringed
// by pylons.

import type { ThemeDef } from "../finish";
import type { FloorRequest } from "../types";
import type { Plan, Room } from "../plan";
import { alongWalls, glowLight, spread } from "./common";

export const PORTAL: ThemeDef = {
  floor: "dungeon-plates",
  stone: "plate",
  size: () => [46, 38],
  carve(plan: Plan, request: FloorRequest): Room[] {
    const last = request.floor === request.floors - 1;
    const { w, d } = plan;
    const spots = spread(plan, last ? 5 : 7, 11, 6, 6, w - 7, d - 7);
    const islands: Room[] = spots.map(([x, z], i) => ({ x, z, size: last && i === spots.length - 1 ? 5 : 3, kind: last && i === spots.length - 1 ? "hall" : "island" }));
    for (const isl of islands) plan.disc(isl.x, isl.z, isl.kind === "hall" ? 5.6 : 2.6 + plan.random() * 0.8);
    // Bridges of crystal over the void, each island to the next.
    for (let i = 1; i < islands.length; i++) plan.corridor(islands[i - 1]!.x, islands[i - 1]!.z, islands[i]!.x, islands[i]!.z, 2, "dungeon-crystal");
    // The islands' own plating over the bridges' ends.
    for (const isl of islands) plan.disc(isl.x, isl.z, isl.kind === "hall" ? 5.6 : 2.4);
    return islands;
  },
  dress(ctx) {
    const { plan, rooms } = ctx;
    for (const isl of rooms) {
      if (isl.kind === "hall") {
        plan.put({ id: "dungeon-sigil", x: isl.x + 0.5, z: isl.z + 0.5, args: { r: 2.5 } });
        plan.light(glowLight([isl.x + 0.5, 1.5, isl.z + 0.5], [0.5, 1, 0.45], 10, 9), 60);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const x = Math.round(isl.x + Math.cos(a) * 4.3);
          const z = Math.round(isl.z + Math.sin(a) * 4.3);
          if (ctx.free(x, z) && plan.block(x, z, { id: "dungeon-pylon", x: x + 0.5, z: z + 0.5, args: { h: 2.6 } }) && k % 2 === 0) plan.light(glowLight([x + 0.5, 1.8, z + 0.8], [0.45, 1, 0.4], 5, 5), 40);
        }
        continue;
      }
      // A pylon and an altar or a vat on each island, off its middle.
      const options: [number, number][] = [[isl.x - 2, isl.z - 1], [isl.x + 2, isl.z - 1], [isl.x - 1, isl.z + 2], [isl.x + 1, isl.z - 2]];
      let n = 0;
      for (const [x, z] of options) {
        if (n >= 2 || !ctx.free(x, z)) continue;
        const pylon = n === 0;
        const id = pylon ? "dungeon-pylon" : plan.random() < 0.5 ? "dungeon-vat" : "dungeon-altar";
        if (!plan.block(x, z, { id, x: x + 0.5, z: z + 0.5 })) continue;
        plan.light(glowLight([x + 0.5, pylon ? 1.8 : 1.2, z + 0.8], pylon ? [0.45, 1, 0.4] : [0.6, 1, 0.5], pylon ? 7 : 4, pylon ? 6 : 4), pylon ? 42 : 24);
        n++;
      }
    }
    // Violet ichor-glow from below the islands' edges, the void's only light.
    alongWalls(ctx, 0.03, (x, z) => {
      plan.light(glowLight([x + 0.5, 0.6, z + 0.5], [0.8, 0.4, 1], 2.5, 3.5), 12);
      return { id: "dungeon-crystal", x: x + 0.5, z: z + 0.5, seed: x + z, args: { hue: "violet", size: 0.7 } };
    });
  },
};
