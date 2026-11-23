// Crypt (swamps and dark realms: the Caligo Morass, Amjad; the Vess crypts): catacombs dug as a maze of passages, the
// slice's crypt grown into a warren - ossuaries where the passages meet, their walls niched with skulls, burial halls of
// coffins, flooded tombs half under black water; crypt brick and cold flags, braziers and torches in the violet dark.

import type { ThemeDef } from "../finish";
import { type Plan, type Room, WATER } from "../plan";
import { alongWalls, fireLight, flood, onBackWalls, roomAt, strew, torches } from "./common";

export const CRYPT: ThemeDef = {
  floor: "crypt-floor",
  stone: "crypt",
  size: () => [45, 37],
  carve(plan: Plan): Room[] {
    // A maze on a coarse grid of cells, dug by a walk that turns back when stuck.
    const cols = 5;
    const rows = 4;
    const at = (i: number, j: number): [number, number] => [5 + Math.round(i * 8.6), 5 + j * 9];
    const seen = new Set<string>(["0,0"]);
    const stack: [number, number][] = [[0, 0]];
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    while (stack.length > 0) {
      const [i, j] = stack.at(-1)!;
      const next = steps.map(([di, dj]) => [i + di, j + dj] as const).filter(([a, c]) => a >= 0 && c >= 0 && a < cols && c < rows && !seen.has(`${a},${c}`));
      if (next.length === 0) {
        stack.pop();
        continue;
      }
      const [a, c] = next[Math.floor(plan.random() * next.length)]!;
      seen.add(`${a},${c}`);
      const [x0, z0] = at(i, j);
      const [x1, z1] = at(a, c);
      plan.corridor(x0, z0, x1, z1, 2);
      stack.push([a, c]);
    }
    // A few loops, so it is not all dead ends.
    for (let k = 0; k < 4; k++) {
      const i = plan.int(0, cols - 2);
      const j = plan.int(0, rows - 1);
      const [x0, z0] = at(i, j);
      const [x1, z1] = at(i + 1, j);
      plan.corridor(x0, z0, x1, z1, 2);
    }
    // Ossuaries at the corners and at some crossings; burial halls; a flooded tomb or two.
    const rooms: Room[] = [];
    const order: [number, number][] = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) order.push([i, j]);
    order.sort((x, y) => x[0] + x[1] - (y[0] + y[1]) || x[0] - y[0]);
    for (const [i, j] of order) {
      const corner = (i === 0 && j === 0) || (i === cols - 1 && j === rows - 1);
      if (!corner && plan.random() > 0.5) continue;
      const [x, z] = at(i, j);
      const hw = corner ? 3 : plan.int(2, 3);
      const hd = corner ? 2 : 2;
      plan.rect(x - hw, z - hd, x + hw, z + hd);
      const kind = corner && i === 0 ? "ossuary" : plan.random() < 0.3 ? "flooded" : plan.random() < 0.5 ? "tomb" : "ossuary";
      rooms.push({ x, z, size: Math.max(hw, hd), kind });
    }
    // The flooded tombs: black water over the south of the room, never cutting a way.
    for (const r of rooms) {
      if (r.kind !== "flooded") continue;
      for (let z = r.z + 1; z <= r.z + 2; z++) for (let x = r.x - 3; x <= r.x + 3; x++) if (plan.random() < 0.85 && Math.abs(x - r.x) > 0) flood(plan, x, z, WATER, "dungeon-water");
    }
    return rooms;
  },
  dress(ctx) {
    const { plan, rooms } = ctx;
    const hung = torches(ctx, 5, 0.75);
    onBackWalls(ctx, 0.4, hung, (x, z) => {
      const r = plan.random();
      if (r < 0.6) return { id: "ossuary", x: x + 0.5, z };
      if (r < 0.8) return { id: "tattered-banner", x: x + 0.5, z };
      return { id: "buttress", x: x + 0.5, z, args: { h: 3.2 } };
    });
    for (const r of rooms) {
      // A brazier or two in each room, candles, pillars in the larger.
      for (const [dx, dz] of r.size >= 3 ? [[-2, 0], [2, 0]] : [[0, 1]]) {
        const x = r.x + dx!;
        const z = r.z + dz!;
        if (ctx.free(x, z) && plan.block(x, z, { id: "brazier", x: x + 0.5, z: z + 0.5 })) plan.light(fireLight([x + 0.5, 1.5, z + 0.8], 8.5, x + z), 45);
      }
      if (r.kind === "tomb") {
        // Coffins against the back wall, each two tiles deep.
        for (const [x, z] of ctx.backWalls()) {
          if (Math.abs(x - r.x) > r.size || Math.abs(z - (r.z - 2)) > 0 || (x - r.x) % 2 !== 0) continue;
          if (!ctx.free(x, z) || !ctx.free(x, z + 1)) continue;
          if (plan.block(x, z, null)) {
            if (plan.block(x, z + 1, null)) plan.put({ id: "coffin", x: x + 0.05, z: z + 0.05, args: { open: (x + z) % 3 === 0 } });
            else plan.blocked[plan.index(x, z)] = 0;
          }
        }
      }
      if (r.kind === "ossuary" && r.size >= 3) {
        for (const [dx, dz] of [[-2, -1], [2, -1], [-2, 1], [2, 1]] as const) {
          const x = r.x + dx;
          const z = r.z + dz;
          if (ctx.free(x, z)) plan.block(x, z, { id: "crypt-pillar", x: x + 0.5, z: z + 0.5 });
        }
      }
    }
    // Rubble and urns along the passages' walls; bones and grime underfoot; webs in the corners.
    alongWalls(ctx, 0.05, (x, z) => {
      const r = plan.random();
      if (r < 0.4) return { id: "rubble", x: x + 0.5, z: z + 0.5, args: { size: 0.375 } };
      if (r < 0.7) return { id: "pot", x: x + 0.5, z: z + 0.5, args: { r: 0.18 } };
      return { id: "fallen-drum", x: x + 0.5, z: z + 0.5, turn: (x * 0.7 + z) % 3 };
    });
    strew(ctx, 0.05, (x, z) => ({ id: "bones", x: x + 0.5, z: z + 0.5, seed: 1 + ((x * 3 + z) % 5), y: 0.004 + ((x * 7 + z) % 5) * 0.0004 }));
    strew(ctx, 0.04, (x, z) => (roomAt(rooms, x, z) ? { id: "candles", x: x + 0.3, z: z + 0.3 } : null));
    for (const [x, z] of ctx.backWalls()) {
      const left = plan.cell(x - 1, z) !== 1;
      const right = plan.cell(x + 1, z) !== 1;
      if (left && plan.random() < 0.6) plan.put({ id: "cobweb", x, z: z + 0.27, y: 2.2, args: { size: 0.9 } });
      if (right && plan.random() < 0.6) plan.put({ id: "cobweb", x: x + 1, z: z + 0.27, y: 2.2, args: { size: 0.9, flip: true } });
    }
  },
};
