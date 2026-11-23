// Foundry (the orcs' delvings in the Ironclaw Mountains, Keldon forges): forge halls in a winding row, lava channels
// running through them, iron gantries over the lava where the way crosses, forges glowing against the walls with
// anvils before them, crucibles of melt and chains hanging.

import type { ThemeDef } from "../finish";
import { LAVA, type Plan, type Room } from "../plan";
import { alongWalls, fireLight, glowLight, onBackWalls, strew } from "./common";

interface Hall {
  readonly x: number;
  readonly z: number;
  readonly hw: number;
  readonly hd: number;
  /** The lava channel's first column, and the gantry's rows. */
  readonly channel?: { readonly x: number; readonly z0: number; readonly z1: number };
}

const halls = new WeakMap<Plan, Hall[]>();

export const FOUNDRY: ThemeDef = {
  floor: "dungeon-ash",
  stone: "soot",
  size: () => [46, 34],
  carve(plan: Plan): Room[] {
    const list: Hall[] = [];
    for (let k = 0; k < 5; k++) {
      const x = Math.round(6 + k * 8.5);
      const z = (k % 2 === 0 ? 10 : 23) + plan.int(-2, 2);
      const hw = k === 0 || k === 4 ? 3 : plan.int(3, 4);
      const hd = plan.int(4, 5);
      plan.rect(x - hw, z - hd, x + hw, z + hd);
      list.push({ x, z, hw, hd });
    }
    // A lava channel down each middle hall, laid before the ways through, which cross it.
    const withChannels = list.map((h, k) => {
      if (k === list.length - 1) return h;
      const cx = h.x + 1;
      for (let z = h.z - h.hd; z <= h.z + h.hd; z++) for (const x of [cx, cx + 1]) plan.fill(x, z, LAVA);
      return { ...h, channel: { x: cx, z0: h.z - 1, z1: h.z + 1 } };
    });
    for (let k = 1; k < withChannels.length; k++) plan.corridor(withChannels[k - 1]!.x, withChannels[k - 1]!.z, withChannels[k]!.x, withChannels[k]!.z, 2);
    // The gantries: grating over the channel where the way runs.
    for (const h of withChannels) {
      if (!h.channel) continue;
      for (let z = h.channel.z0; z <= h.channel.z1; z++) for (const x of [h.channel.x, h.channel.x + 1]) plan.carve(x, z, "dungeon-grating");
      // Where a corridor crossed the channel elsewhere, it is a gantry too.
      for (let z = h.z - h.hd; z <= h.z + h.hd; z++) for (const x of [h.channel.x, h.channel.x + 1]) if (plan.cell(x, z) === 1) plan.surface[plan.index(x, z)] = "dungeon-grating";
    }
    halls.set(plan, withChannels);
    return withChannels.map((h, k) => ({ x: h.channel ? h.x - 2 : h.x, z: h.z, size: Math.min(h.hw, h.hd), kind: k === 0 ? "gate" : "forge" }));
  },
  dress(ctx) {
    const { plan } = ctx;
    const list = halls.get(plan) ?? [];
    // Forges against the back walls: two tiles wide, an anvil before each.
    const forges: [number, number][] = [];
    for (const [x, z] of ctx.backWalls()) {
      if (forges.some(([fx, fz]) => fz === z && Math.abs(fx - x) < 5)) continue;
      if (!ctx.free(x, z) || !ctx.free(x + 1, z) || plan.cell(x + 1, z - 1) === 1) continue;
      if (!plan.block(x, z, null)) continue;
      if (!plan.block(x + 1, z, null)) {
        plan.blocked[plan.index(x, z)] = 0;
        continue;
      }
      forges.push([x, z]);
      plan.put({ id: "dungeon-forge", x: x + 1, z });
      plan.light(fireLight([x + 1, 1.3, z + 1.2], 9, x, [1, 0.5, 0.2]), 45);
      const [ax, az] = [x + 1, z + 2];
      if (ctx.free(ax, az)) plan.block(ax, az, { id: "dungeon-anvil", x: ax + 0.5, z: az + 0.5, rot: x % 2 });
    }
    onBackWalls(ctx, 0.3, forges.flatMap(([x, z]) => [[x, z], [x + 1, z]] as [number, number][]), (x, z) => (plan.random() < 0.6 ? { id: "dungeon-chains", x: x + 0.5, z } : { id: "torch", x: x + 0.5, z }));
    // Braziers in each hall, west of its channel.
    for (const h of list) {
      for (const [dx, dz] of [[-2, -2], [-2, 2]] as const) {
        const x = h.x + dx - (h.channel ? 1 : 0);
        const z = h.z + dz;
        if (ctx.free(x, z) && plan.block(x, z, { id: "brazier", x: x + 0.5, z: z + 0.5 })) plan.light(fireLight([x + 0.5, 1.5, z + 0.8], 8.5, x + z), 42);
      }
    }
    // The lava's glow along each channel, and rails along the gantries.
    for (const h of list) {
      if (!h.channel) continue;
      for (let z = h.z - h.hd; z <= h.z + h.hd; z += 3) plan.light(glowLight([h.channel.x + 1, 0.8, z + 0.5], [1, 0.45, 0.15], 7, 5.5), 34);
      const { x, z0, z1 } = h.channel;
      plan.put({ id: "railings", x, z: z0 + 0.06, args: { to: [x + 2, z0 + 0.06] } });
      plan.put({ id: "railings", x, z: z1 + 0.94, args: { to: [x + 2, z1 + 0.94] } });
    }
    // Crucibles, coal barrels and crates along the walls.
    alongWalls(ctx, 0.07, (x, z) => {
      const r = plan.random();
      if (r < 0.3) {
        plan.light(glowLight([x + 0.5, 1.2, z + 0.5], [1, 0.55, 0.2], 3, 3.5), 20);
        return { id: "dungeon-crucible", x: x + 0.5, z: z + 0.5 };
      }
      if (r < 0.65) return { id: "barrel", x: x + 0.5, z: z + 0.5 };
      return { id: "crate", x: x + 0.5, z: z + 0.5, args: { size: 0.75 } };
    });
    strew(ctx, 0.05, (x, z) => (plan.surface[plan.index(x, z)] === "dungeon-grating" ? null : { id: "dungeon-grime", x: x + 0.5, z: z + 0.5, seed: 4 + ((x + z) % 3) }));
  },
};
