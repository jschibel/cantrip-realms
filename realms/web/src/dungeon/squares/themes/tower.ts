// Mage tower (coasts and isles: the Academy on Walassa; and the mage towers whose waystones carry travellers): a round
// floor - a ring corridor round the stair column, rooms off it, libraries of shelves and time-rift rooms of crystal, a
// study inside the column - and on the top floor the mage's open hall, a ring of pillars round a heart of crystal.

import type { ThemeDef } from "../finish";
import type { FloorRequest } from "../types";
import type { Plan, Room } from "../plan";
import { alongWalls, fireLight, glowLight, roomAt, strew, torches } from "./common";

const C = 20;

const around = (r: number, a: number): [number, number] => [Math.round(C + Math.cos(a) * r), Math.round(C + Math.sin(a) * r)];

export const TOWER: ThemeDef = {
  floor: "dungeon-tower-floor",
  stone: "tower",
  size: () => [41, 41],
  carve(plan: Plan, request: FloorRequest): Room[] {
    const start = plan.random() * Math.PI * 2;
    if (request.floor === request.floors - 1) {
      // The mage's hall: the whole floor open, pillars round it, crystal at its heart.
      plan.disc(C, C, 15.5);
      plan.disc(C, C, 2.2, "dungeon-crystal");
      plan.disc(C, C, 5.5, "dungeon-marble");
      plan.disc(C, C, 2.2, "dungeon-crystal");
      const [ax, az] = around(12, start);
      return [
        { x: ax, z: az, size: 2, kind: "landing" },
        { ...xz(around(8, start + 2.2)), size: 2, kind: "hall" },
        { ...xz(around(8, start - 2.2)), size: 2, kind: "hall" },
        { x: C, z: C, size: 3, kind: "heart" },
      ];
    }
    // The ring round the stair column.
    for (let z = 0; z < plan.d; z++) {
      for (let x = 0; x < plan.w; x++) {
        const d = Math.hypot(x - C, z - C);
        if (d >= 6.6 && d <= 8.7) plan.carve(x, z);
      }
    }
    const rooms: Room[] = [];
    for (let s = 0; s < 6; s++) {
      const a = start + ((s + 0.5) / 6) * Math.PI * 2;
      const [x, z] = around(14, a);
      const library = s % 2 === 0;
      plan.disc(x, z, 3.3, library ? "dungeon-tower-floor" : "dungeon-rift");
      const [rx, rz] = around(8, a);
      plan.corridor(rx, rz, x, z, 2, "dungeon-tower-floor");
      plan.disc(x, z, 3.3, library ? "dungeon-tower-floor" : "dungeon-rift");
      rooms.push({ x, z, size: 3, kind: library ? "library" : "rift" });
    }
    // The study in the stair column, through one gap in its wall.
    plan.disc(C, C, 3.4, "dungeon-marble");
    const [gx, gz] = around(7, start);
    plan.corridor(C, C, gx, gz, 2, "dungeon-marble");
    rooms.splice(2, 0, { x: C, z: C, size: 3, kind: "study" });
    return rooms;
  },
  dress(ctx) {
    const { plan, rooms } = ctx;
    const hung = torches(ctx, 5, 0.8);
    void hung;
    for (const room of rooms) {
      if (room.kind === "library" || room.kind === "study") {
        // Shelves along the back walls, a desk in the middle.
        for (const [x, z] of ctx.backWalls()) {
          if (Math.max(Math.abs(x - room.x), Math.abs(z - room.z)) > room.size + 1) continue;
          if (ctx.free(x, z) && plan.random() < 0.8) plan.block(x, z, { id: "bookshelf", x, z, seed: 3 + ((x * 7 + z) % 9), args: { goods: (x + z) % 5 === 0 } });
        }
        const [dx, dz] = [room.x, room.z + 1];
        if (ctx.free(dx, dz) && plan.block(dx, dz, { id: "dungeon-desk", x: dx + 0.5, z: dz + 0.5 })) plan.light(fireLight([dx + 1, 1.3, dz + 0.6], 4, dx, [1, 0.7, 0.4]), 30);
        const [bx, bz] = [room.x - 2, room.z];
        if (ctx.free(bx, bz) && plan.block(bx, bz, { id: "brazier", x: bx + 0.5, z: bz + 0.5 })) plan.light(fireLight([bx + 0.5, 1.5, bz + 0.8], 7, bx), 35);
      } else if (room.kind === "rift") {
        if (ctx.free(room.x, room.z) && plan.block(room.x, room.z, { id: "dungeon-rift", x: room.x + 0.5, z: room.z + 0.5 })) plan.light(glowLight([room.x + 0.5, 1.2, room.z + 0.8], [0.5, 0.75, 1], 9, 7), 50);
      } else if (room.kind === "hall" || room.kind === "landing") {
        const [bx, bz] = [room.x, room.z];
        if (ctx.free(bx, bz) && plan.block(bx, bz, { id: "brazier", x: bx + 0.5, z: bz + 0.5 })) plan.light(fireLight([bx + 0.5, 1.5, bz + 0.8], 8, bx), 40);
      } else if (room.kind === "heart") {
        plan.light(glowLight([C + 0.5, 1.5, C + 0.5], [0.55, 0.8, 1], 10, 8), 60);
        for (const [x, z] of [[C - 1, C - 1], [C + 1, C + 1], [C + 1, C - 1], [C - 1, C + 1]] as const) if (ctx.free(x, z)) plan.block(x, z, { id: "dungeon-crystal", x: x + 0.5, z: z + 0.5, seed: x + z, args: { hue: "blue", size: 1.3 } });
      }
    }
    if (!ctx.last) {
      // Braziers round the ring corridor, against its outer wall.
      for (let k = 0; k < 6; k++) {
        const [x, z] = around(8.2, (k / 6) * Math.PI * 2 + 0.3);
        if (ctx.free(x, z) && plan.block(x, z, { id: "brazier", x: x + 0.5, z: z + 0.5 })) plan.light(fireLight([x + 0.5, 1.5, z + 0.8], 7.5, k), 36);
      }
    }
    if (ctx.last) {
      // The hall's ring of pillars, braziers between some.
      for (let k = 0; k < 12; k++) {
        const [x, z] = around(10.5, (k / 12) * Math.PI * 2);
        if (!ctx.free(x, z)) continue;
        if (k % 3 === 1) {
          if (plan.block(x, z, { id: "brazier", x: x + 0.5, z: z + 0.5 })) plan.light(fireLight([x + 0.5, 1.5, z + 0.8], 8, k), 38);
        } else plan.block(x, z, { id: "crypt-pillar", x: x + 0.5, z: z + 0.5 });
      }
    }
    const rifts = rooms.filter((r) => r.kind === "rift");
    alongWalls(ctx, 0.3, (x, z) => ({ id: "dungeon-crystal", x: x + 0.5, z: z + 0.5, seed: x * 5 + z, args: { hue: (x + z) % 2 ? "blue" : "violet", size: 0.7 } }), (x, z) => roomAt(rifts, x, z) !== undefined);
    alongWalls(ctx, 0.04, (x, z) => (plan.random() < 0.5 ? { id: "pot", x: x + 0.5, z: z + 0.5, args: { r: 0.2 } } : { id: "crate", x: x + 0.5, z: z + 0.5, args: { size: 0.625 } }), (x, z) => roomAt(rifts, x, z) === undefined);
    strew(ctx, 0.015, (x, z) => ({ id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) }));
  },
};

function xz([x, z]: [number, number]): { x: number; z: number } {
  return { x, z };
}
