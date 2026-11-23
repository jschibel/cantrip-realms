// Castle (plains and farmland: Benalia): a keep of halls on a grid joined by corridors, a great hall of marble in its
// heart, storerooms, a courtyard open to the sky with its well and trees, and the battlements along its north wall -
// a walk behind a crenellated parapet, the night sky beyond it.

import type { ThemeDef } from "../finish";
import { type Plan, type Room, VOID } from "../plan";
import { alongWalls, fireLight, onBackWalls, roomAt, strew, torches } from "./common";

interface Hall {
  readonly x: number;
  readonly z: number;
  readonly hw: number;
  readonly hd: number;
  readonly kind: string;
}

const halls = new WeakMap<Plan, Hall[]>();

const asRooms = (cells: readonly Hall[], kind: string): Room[] => cells.filter((c) => c.kind === kind).map((c) => ({ x: c.x, z: c.z, size: Math.max(c.hw, c.hd) }));

export const CASTLE: ThemeDef = {
  floor: "dungeon-keep-flags",
  stone: "keep",
  size: () => [46, 38],
  carve(plan: Plan): Room[] {
    const { w } = plan;
    const cells: Hall[] = [];
    const courtyard = [1, 3, 5, 7, 2, 6][plan.int(0, 5)]!;
    const stores = new Set([0, 2, 6, 8].filter((i) => i !== courtyard && plan.random() < 0.5));
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const i = row * 3 + col;
        const x = 8 + col * 15 + plan.int(-1, 1);
        const z = 9 + row * 11 + plan.int(-1, 0);
        const kind = i === 4 ? "great-hall" : i === courtyard ? "courtyard" : stores.has(i) ? "store" : "hall";
        const hw = kind === "great-hall" ? 5 : kind === "courtyard" ? 4 : plan.int(3, 4);
        const hd = kind === "courtyard" ? 4 : 3;
        cells.push({ x, z, hw, hd, kind });
      }
    }
    // The battlements: a walk along the north wall, open to the sky past its parapet.
    for (let x = 4; x <= w - 5; x++) plan.fill(x, 0, VOID);
    plan.rect(4, 1, w - 5, 2, "dungeon-keep-flags");
    const paint = () => {
      for (const c of cells) {
        const surface = c.kind === "great-hall" ? "dungeon-marble" : c.kind === "courtyard" ? "cobbles" : undefined;
        plan.rect(c.x - c.hw, c.z - c.hd, c.x + c.hw, c.z + c.hd, surface);
        if (c.kind === "courtyard") plan.rect(c.x - c.hw + 1, c.z - c.hd + 1, c.x + c.hw - 1, c.z + c.hd - 1, "grass");
      }
    };
    paint();
    // Corridors: a spine through the great hall, most neighbours joined so there is a way round, stairs up to the walls.
    const join = (i: number, j: number) => plan.corridor(cells[i]!.x, cells[i]!.z, cells[j]!.x, cells[j]!.z, 2, "dungeon-keep-flags");
    for (const [i, j] of [[1, 4], [4, 7], [3, 4], [4, 5], [0, 1], [6, 7], [2, 5], [8, 7]] as const) join(i, j);
    for (const [i, j] of [[0, 3], [1, 2], [3, 6], [5, 8]] as const) if (plan.random() < 0.6) join(i, j);
    for (const i of [0, 2]) {
      const x = cells[i]!.x + (i === 0 ? 1 : -1);
      plan.corridor(x, cells[i]!.z, x, 2, 2, "dungeon-keep-flags");
    }
    // The halls' own floors over the corridors that cross them.
    paint();
    halls.set(plan, cells);
    // From a corner hall across the keep to the far corner.
    return [0, 1, 3, 4, 2, 6, 5, 7, 8].map((i) => ({ x: cells[i]!.x, z: cells[i]!.z, size: Math.min(cells[i]!.hw, cells[i]!.hd), kind: cells[i]!.kind }));
  },
  dress(ctx) {
    const { plan } = ctx;
    const cells = halls.get(plan) ?? [];
    const hung = torches(ctx, 4, 0.95);
    onBackWalls(ctx, 0.45, hung, (x, z) => (plan.random() < 0.7 ? { id: "dungeon-banner", x: x + 0.5, z } : { id: "shield", x: x + 0.19, z, y: 1.7 }));
    // The battlements' parapet, and the moon over the walk.
    let x0 = -1;
    for (let x = 0; x <= plan.w; x++) {
      const sky = x < plan.w && plan.cell(x, 0) === VOID;
      if (sky && x0 < 0) x0 = x;
      if (!sky && x0 >= 0) {
        plan.put({ id: "dungeon-parapet", x: x0, z: 1, args: { to: [x, 1] } });
        for (let mx = x0 + 6; mx < x; mx += 12) plan.light({ kind: "point", at: [mx, 5, 2.5], color: [0.55, 0.65, 1], intensity: 7, reach: 9, decay: 1.2 }, 35);
        x0 = -1;
      }
    }
    for (const c of cells) {
      if (c.kind === "courtyard") {
        // The well at the middle (two tiles by two), trees at the corners, the sky's cold light.
        const well = [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const;
        if (well.every(([dx, dz]) => ctx.free(c.x + dx, c.z + dz))) {
          const placed = well.filter(([dx, dz]) => plan.block(c.x + dx, c.z + dz, null)).length;
          if (placed === well.length) plan.put({ id: "dungeon-well", x: c.x, z: c.z });
          else for (const [dx, dz] of well) plan.blocked[plan.index(c.x + dx, c.z + dz)] = 0;
        }
        for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) {
          const x = c.x + dx - (dx > 0 ? 1 : 0);
          const z = c.z + dz - (dz > 0 ? 1 : 0);
          if (ctx.free(x, z)) plan.block(x, z, { id: "tree", x: x + 0.5, z: z + 0.5, scale: 0.75, seed: (x + z) % 5 });
        }
        plan.light({ kind: "point", at: [c.x, 6, c.z + 1], color: [0.6, 0.7, 1], intensity: 10, reach: 11, decay: 1.1 }, 60);
        continue;
      }
      // Braziers either side of each hall's middle.
      for (const dx of c.kind === "great-hall" ? [-3, 3] : [-2, 2]) {
        const x = c.x + dx;
        const z = c.z;
        if (ctx.free(x, z) && plan.block(x, z, { id: "brazier", x: x + 0.5, z: z + 0.5 })) plan.light(fireLight([x + 0.5, 1.5, z + 0.8], 8.5, x), 45);
      }
      if (c.kind === "great-hall") {
        // Statues of the order's knights along its back.
        for (const dx of [-4, -2, 2, 4]) {
          const x = c.x + dx;
          const z = c.z - c.hd;
          if (ctx.free(x, z)) plan.block(x, z, { id: "dungeon-statue", x: x + 0.5, z: z + 0.5 });
        }
      }
    }
    // Storerooms of barrels, crates and sacks; a few about the halls.
    const stores = asRooms(cells, "store");
    const goods = ["apples", "cabbages", "bread"] as const;
    alongWalls(
      ctx,
      0.5,
      (x, z) => {
        const r = plan.random();
        if (r < 0.4) return { id: "barrel", x: x + 0.5, z: z + 0.5 };
        if (r < 0.75) return { id: "crate", x: x + 0.5, z: z + 0.5, turn: (x % 3) * 0.1, args: { size: 0.75, goods: goods[(x + z) % 3] } };
        return { id: "sack", x: x + 0.5, z: z + 0.5 };
      },
      (x, z) => roomAt(stores, x, z) !== undefined,
    );
    const rooms = asRooms(cells, "hall");
    alongWalls(ctx, 0.05, (x, z) => (plan.random() < 0.5 ? { id: "barrel", x: x + 0.5, z: z + 0.5 } : { id: "crate", x: x + 0.5, z: z + 0.5, args: { size: 0.625 } }), (x, z) => roomAt(rooms, x, z) !== undefined);
    strew(ctx, 0.025, (x, z) => (plan.surface[plan.index(x, z)] === "grass" ? null : { id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) }));
  },
};
