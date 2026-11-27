// Crypt (swamps and dark realms: the Caligo Morass, Amjad; the Vess crypts): each round a burial hall - cold flags under
// crypt brick, two rows of pillars, the back wall niched with skulls between torches and tattered banners, coffins along
// its sides, a flooded tomb's black water in a corner, candles and bones underfoot; the boss's hall a great ossuary.

import type { ThemeDef } from "../finish";
import { WATER } from "../plan";
import { alongWalls, brazier, flanking, flood, hall, onBackWalls, strew, torches } from "./common";

export const CRYPT: ThemeDef = {
  floor: "crypt-floor",
  stone: "crypt",
  hue: "violet",
  size: (big, random) => (big ? [27 + Math.floor(random() * 2), 13] : [23 + Math.floor(random() * 3), 13]),
  carve(plan, arena) {
    hall(plan, arena);
    // Black water over a corner at the hall's foot, never cutting a way.
    const east = plan.random() < 0.5;
    const x = east ? arena.x1 - 1 : arena.x0;
    for (let z = arena.z1 - 3; z <= arena.z1 - 1; z++) for (const dx of [0, 1]) if (plan.random() < 0.9) flood(plan, x + dx, z, WATER, "dungeon-water");
  },
  dress(ctx) {
    const { plan, arena, last } = ctx;
    const { x0, x1, z0, z1, cx } = arena;
    // A runner of faded violet down the hall, from the way in to the gate.
    plan.put({ id: "dungeon-runner", x: cx - 1, z: z0 + 1, args: { to: z1 + 1, hue: "violet" } });
    const hung = torches(ctx, 5, 0.8);
    onBackWalls(ctx, 0.55, hung, (x, z) => {
      const r = plan.random();
      if (r < 0.6) return { id: "ossuary", x: x + 0.5, z };
      if (r < 0.85) return { id: "tattered-banner", x: x + 0.5, z };
      return { id: "buttress", x: x + 0.5, z, args: { h: 3.2 } };
    });
    // Two rows of pillars down the hall.
    flanking(ctx, Math.floor((x1 - x0) / 2) - 3, z0 + 3, z1 - 2, 3, (x, z) => ({ id: "crypt-pillar", x: x + 0.5, z: z + 0.5 }));
    if (last) for (const dx of [-3, 3]) brazier(ctx, cx + dx, z0 + 2, 70, 9);
    for (const x of [x0 + 1, x1 - 1]) brazier(ctx, x, Math.round((z0 + z1) / 2) - 1, 50);
    // Coffins along the side walls, each two tiles deep, lying north to south.
    for (const x of [x0, x1]) {
      for (let z = z0 + 2; z < z1 - 3; z += 3) {
        if (!ctx.free(x, z) || !ctx.free(x, z + 1) || plan.random() < 0.3) continue;
        if (!plan.block(x, z, null)) continue;
        if (plan.block(x, z + 1, null)) plan.put({ id: "coffin", x: x + 0.05, z: z + 0.05, args: { open: (x + z) % 3 === 0 } });
        else plan.blocked[plan.index(x, z)] = 0;
      }
    }
    alongWalls(ctx, 0.06, (x, z) => {
      const r = plan.random();
      if (r < 0.4) return { id: "rubble", x: x + 0.5, z: z + 0.5, args: { size: 0.375 } };
      if (r < 0.75) return { id: "pot", x: x + 0.5, z: z + 0.5, args: { r: 0.18 } };
      return { id: "fallen-drum", x: x + 0.5, z: z + 0.5, turn: (x * 0.7 + z) % 3 };
    });
    strew(ctx, 0.05, (x, z) => ({ id: "bones", x: x + 0.5, z: z + 0.5, seed: 1 + ((x * 3 + z) % 5), y: 0.004 + ((x * 7 + z) % 5) * 0.0004 }));
    strew(ctx, 0.03, (x, z) => ({ id: "candles", x: x + 0.3, z: z + 0.3 }));
    for (const [x, z] of ctx.backWalls()) {
      const left = plan.cell(x - 1, z) !== 1;
      const right = plan.cell(x + 1, z) !== 1;
      if (left && plan.random() < 0.7) plan.put({ id: "cobweb", x, z: z + 0.27, y: 2.2, args: { size: 0.9 } });
      if (right && plan.random() < 0.7) plan.put({ id: "cobweb", x: x + 1, z: z + 0.27, y: 2.2, args: { size: 0.9, flip: true } });
    }
  },
};
