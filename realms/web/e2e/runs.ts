import type { Page } from "@playwright/test";
import { type Hex, hex } from "../src/hex";
import { entities, entity, realm, steady, walkNear, winDuel } from "./realm";

// Dungeon runs, as the suites play them: walking a floor, beating a floor's mob with the stand-in duel, going in.

export const parse = (k: string): Hex => {
  const [q, r] = k.split(",").map(Number);
  return hex(q!, r!);
};

/** Walks a room or a floor by clicks, over the open hexes the page says it has. */
export async function walkInside(page: Page, goal: Hex, near = 1): Promise<void> {
  // Not the stairs or the way out: walking onto one is using it.
  const run = await realm<{ up: string; down: string | null; wayOut: string | null } | null>(page, "run");
  const stops = new Set([run?.up, run?.down, run?.wayOut].filter((k): k is string => typeof k === "string"));
  const open = new Set((await realm<string[]>(page, "openHexes")).filter((k) => !stops.has(k)));
  await walkNear(page, goal, near, (h) => open.has(`${h.q},${h.r}`));
}

/** Clicks a mob of the floor (walking near it first), and wins the duel and takes the loot. */
export async function beat(page: Page, role: string): Promise<void> {
  const mob = await entity(page, (e) => e.kind === "mob" && e.role === role, `the ${role}`);
  await walkInside(page, parse(mob.hex), 3);
  const there = (await entities(page)).some((e) => e.kind === "mob" && e.role === role) ? await steady(page, (e) => e.kind === "mob" && e.role === role, `the ${role}`) : undefined;
  if (there) {
    // (It may have come for you while the view settled.)
    if ((await realm<string | null>(page, "layer.open")) === null) await page.mouse.click(there.x, there.y);
    await winDuel(page);
  }
  // Another may have come for you first: the one asked for is beaten in the end.
  for (let tries = 0; tries < 4 && (await entities(page)).some((e) => e.kind === "mob" && e.role === role); tries++) {
    const again = await entity(page, (e) => e.kind === "mob" && e.role === role, `the ${role}`);
    await walkInside(page, parse(again.hex), 2);
    if (!(await entities(page)).some((e) => e.kind === "mob" && e.role === role)) break;
    const next = await steady(page, (e) => e.kind === "mob" && e.role === role, `the ${role}`);
    if ((await realm<string | null>(page, "layer.open")) === null) await page.mouse.click(next.x, next.y);
    await winDuel(page);
  }
}

export async function enter(page: Page, id: string): Promise<void> {
  const way = await steady(page, (e) => e.kind === "entrance" && e.to === id, `the way into ${id}`);
  await page.mouse.click(way.x, way.y);
}
