// Caves (mountains and hills: Keld, the Hurloon and Ironclaw Mountains; the Keldon fortress): winding caverns grown by
// a cellular automaton, chambers joined by passages that wander, an underground lake, a chasm spanned by a neck of
// rock, stalagmites and crystals glowing in the dark, the raiders' braziers in their chambers.

import type { ThemeDef } from "../finish";
import { FLOOR, type Plan, type Room, VOID, WALL, WATER } from "../plan";
import { alongWalls, fireLight, glowLight, spread, strew, torches } from "./common";

export const CAVES: ThemeDef = {
  floor: "dungeon-cave-floor",
  stone: "cave",
  size: () => [44, 36],
  carve(plan: Plan): Room[] {
    const { w, d } = plan;
    // Caverns: random ground, smoothed four times (a tile is floor if most of its eight neighbours are).
    let alive = new Uint8Array(w * d);
    for (let z = 2; z < d - 2; z++) for (let x = 2; x < w - 2; x++) alive[z * w + x] = plan.random() < 0.5 ? 1 : 0;
    for (let round = 0; round < 4; round++) {
      const next = new Uint8Array(w * d);
      for (let z = 2; z < d - 2; z++) {
        for (let x = 2; x < w - 2; x++) {
          let n = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && alive[(z + dz) * w + x + dx]) n++;
          next[z * w + x] = n >= 5 || (alive[z * w + x] && n >= 4) ? 1 : 0;
        }
      }
      alive = next;
    }
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (alive[z * w + x]) plan.carve(x, z);
    // Small knots of rock left standing in the open are worn away: a cave's walls are its edges and a few great pillars.
    const seen = new Uint8Array(w * d);
    for (let z = 1; z < d - 1; z++) {
      for (let x = 1; x < w - 1; x++) {
        if (seen[z * w + x] || plan.cell(x, z) !== WALL) continue;
        const blob: number[] = [];
        let edge = false;
        const stack = [z * w + x];
        seen[z * w + x] = 1;
        while (stack.length > 0) {
          const i = stack.pop()!;
          blob.push(i);
          const bx = i % w;
          const bz = (i - bx) / w;
          if (bx <= 1 || bz <= 1 || bx >= w - 2 || bz >= d - 2) edge = true;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = bx + dx;
            const nz = bz + dz;
            const ni = nz * w + nx;
            if (nx < 0 || nz < 0 || nx >= w || nz >= d || seen[ni] || plan.cell(nx, nz) !== WALL) continue;
            seen[ni] = 1;
            stack.push(ni);
          }
        }
        if (!edge && blob.length < 12) for (const i of blob) plan.carve(i % w, Math.floor(i / w));
      }
    }
    // Chambers, spread out.
    const rooms: Room[] = spread(plan, 7, 10, 5, 5, w - 6, d - 6).map(([x, z], i) => ({ x, z, size: 3, kind: i % 3 === 1 ? "crystal" : "chamber" }));
    for (const r of rooms) plan.disc(r.x, r.z, 2.6 + plan.random());
    // The lake beside the middle chamber, and a chasm by the next but one: laid before the passages, which cut through.
    const lake = rooms[Math.floor(rooms.length / 2)]!;
    const lx = lake.x + (lake.x < w / 2 ? 4 : -4);
    const lz = lake.z + plan.int(-1, 1);
    for (let z = lz - 3; z <= lz + 3; z++) {
      for (let x = lx - 4; x <= lx + 4; x++) {
        if (((x - lx) / 4) ** 2 + ((z - lz) / 2.6) ** 2 > 1) continue;
        if (plan.inner(x, z)) plan.fill(x, z, WATER, "dungeon-water");
      }
    }
    const chasm = rooms[Math.max(1, rooms.length - 3)]!;
    const cx = chasm.x + (chasm.z < d / 2 ? 0 : 0);
    const cz = chasm.z + (chasm.z < d / 2 ? 4 : -4);
    for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 5; x <= cx + 5; x++) if (plan.inner(x, z) && plan.random() < 0.92) plan.fill(x, z, VOID);
    // Passages from each chamber to the next, wandering, two tiles wide: one cave.
    for (let i = 1; i < rooms.length; i++) plan.corridor(rooms[i - 1]!.x, rooms[i - 1]!.z, rooms[i]!.x, rooms[i]!.z, 2, undefined, 0.3);
    // The lake's shore stays dry round each chamber's middle.
    for (const r of rooms) plan.disc(r.x, r.z, 1.5);
    return rooms;
  },
  dress(ctx) {
    const { plan, rooms } = ctx;
    // Braziers in the raiders' chambers; crystals glowing in the others.
    rooms.forEach((r, i) => {
      if (r.kind === "crystal") return;
      const spots: [number, number][] = [[r.x - 2, r.z - 1], [r.x + 2, r.z + 1], [r.x + 1, r.z - 2], [r.x - 1, r.z + 2]];
      let lit = 0;
      for (const [x, z] of spots) {
        if (lit >= (i % 2 ? 1 : 2)) break;
        if (ctx.free(x, z) && plan.block(x, z, { id: "brazier", x: x + 0.5, z: z + 0.5 })) {
          plan.light(fireLight([x + 0.5, 1.5, z + 0.8], 9, x + z), 45);
          lit++;
        }
      }
    });
    torches(ctx, 6, 0.5);
    alongWalls(ctx, 0.16, (x, z) => {
      const roll = plan.random();
      const inCrystal = rooms.some((r) => r.kind === "crystal" && Math.max(Math.abs(r.x - x), Math.abs(r.z - z)) <= 5);
      if (inCrystal && roll < 0.55) {
        const hue = (x + z) % 3 === 0 ? "violet" : "blue";
        plan.light(glowLight([x + 0.5, 1.0, z + 0.5], hue === "blue" ? [0.4, 0.65, 1] : [0.7, 0.45, 1], 3.5, 4.5), 22);
        return { id: "dungeon-crystal", x: x + 0.5, z: z + 0.5, seed: x * 7 + z, args: { hue, size: 0.8 + plan.random() * 0.5 } };
      }
      if (roll < 0.55) return { id: "dungeon-stalagmite", x: x + 0.5, z: z + 0.5, seed: x + z, args: { h: 0.8 + plan.random() * 1.0 } };
      if (roll < 0.75) return { id: "boulder", x: x + 0.5, z: z + 0.5, seed: (x * 3 + z) % 9, args: { r: 0.35 + plan.random() * 0.15 } };
      if (roll < 0.88) {
        plan.light(glowLight([x + 0.5, 0.6, z + 0.5], [0.4, 1, 0.6], 2, 3), 10);
        return { id: "dungeon-mushrooms", x: x + 0.5, z: z + 0.5, seed: x + z * 3, args: { hue: "green" } };
      }
      return { id: "barrel", x: x + 0.5, z: z + 0.5 };
    });
    strew(ctx, 0.03, (x, z) => ({ id: "bones", x: x + 0.5, z: z + 0.5, seed: 1 + ((x + z) % 5), y: 0.004 + ((x * 7 + z) % 5) * 0.0004 }));
    strew(ctx, 0.04, (x, z) => (plan.cell(x, z) === FLOOR ? { id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) } : null));
  },
};
