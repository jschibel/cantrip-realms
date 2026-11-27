// Castle (plains and farmland: Benalia): each round a hall of the keep - flagstones, a red runner from the way in to the
// gate, pillars down its sides, the order's banners and shields on the back wall between torches, braziers by the
// walls, stores of barrels and crates in its corners; the boss's hall grander: marble from wall to wall down its middle,
// knights' statues lining the way to the throne.

import type { ThemeDef } from "../finish";
import { alongWalls, brazier, flanking, hall, onBackWalls, strew, torches } from "./common";

export const CASTLE: ThemeDef = {
  floor: "dungeon-keep-flags",
  stone: "keep",
  hue: "gold",
  size: (big, random) => (big ? [27 + Math.floor(random() * 2), 13] : [23 + Math.floor(random() * 3), 13]),
  carve(plan, arena) {
    hall(plan, arena);
    // The boss's hall's marble, wall to wall down its middle.
    if (arena.hall) plan.rect(arena.cx - 3, arena.z0, arena.cx + 3, arena.z1, "dungeon-marble");
  },
  dress(ctx) {
    const { plan, arena, last } = ctx;
    const { x0, x1, z0, z1, cx } = arena;
    // A runner of the order's red from the way in to the gate, or to the throne.
    plan.put({ id: "dungeon-runner", x: cx - 1, z: z0 + 1, args: { to: z1 + 1, hue: "red" } });
    const hung = torches(ctx, 4, 0.95);
    onBackWalls(ctx, 0.5, hung, (x, z) => (plan.random() < 0.7 ? { id: "dungeon-banner", x: x + 0.5, z } : { id: "shield", x: x + 0.19, z, y: 1.7 }));
    // Pillars down the hall's sides; in the boss's hall, knights' statues lining the way to the throne as well.
    flanking(ctx, Math.floor((x1 - x0) / 2) - 2, z0 + 3, z1 - 2, 4, (x, z) => ({ id: "dungeon-column", x: x + 0.5, z: z + 0.5, args: { stone: "keep", h: 2.9 } }));
    if (last) {
      flanking(ctx, 4, z0 + 5, z1 - 3, 3, (x, z) => ({ id: "dungeon-statue", x: x + 0.5, z: z + 0.5 }));
      for (const dx of [-3, 3]) brazier(ctx, cx + dx, z0 + 2, 70, 9.5);
    }
    // Braziers along the side walls, halfway down.
    for (const x of [x0, x1]) brazier(ctx, x, Math.round((z0 + z1) / 2), 50);
    // Stores in the corners: barrels, crates and sacks.
    const goods = ["apples", "cabbages", "bread"] as const;
    const corner = (x: number, z: number) => (x - x0 <= 2 || x1 - x <= 2) && (z - z0 <= 2 || z1 - z <= 1);
    alongWalls(
      ctx,
      0.55,
      (x, z) => {
        const r = plan.random();
        if (r < 0.4) return { id: "barrel", x: x + 0.5, z: z + 0.5 };
        if (r < 0.75) return { id: "crate", x: x + 0.5, z: z + 0.5, turn: (x % 3) * 0.1, args: { size: 0.75, goods: goods[(x + z) % 3] } };
        return { id: "sack", x: x + 0.5, z: z + 0.5 };
      },
      corner,
    );
    strew(ctx, 0.02, (x, z) => (plan.surface[plan.index(x, z)] === "dungeon-marble" ? null : { id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) }));
  },
};
