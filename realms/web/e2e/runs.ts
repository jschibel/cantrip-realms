import type { Page } from "@playwright/test";
import { type Entity, type Tile, clickEntity, entities, entity, realm, walkTo, winDuel } from "./realm";

// Dungeon runs, as the suites play them: walking a floor, beating a floor's mob with the stand-in duel, going in.

interface RunState {
  readonly id: string;
  readonly floor: number;
  readonly floors: number;
  readonly up: Tile | null;
  readonly down: Tile | null;
  readonly wayOut: Tile | null;
}

export const run = (page: Page) => realm<RunState | null>(page, "run");

/** Walks a floor toward a tile, never clicking its ways (a click on one, or its doorway, is using it). */
export async function walkInside(page: Page, goal: Tile, near = 1): Promise<void> {
  const r = await run(page);
  // Each way, and the doorway past it (a step north: a click there goes through too).
  const stops = new Set([r?.up, r?.down, r?.wayOut].filter((t): t is Tile => !!t).flatMap((t) => [`${t.x},${t.z}`, `${t.x},${t.z - 1}`]));
  await walkTo(page, goal, near, (t) => stops.has(`${t.x},${t.z}`));
}

/** Beats a floor's mob of a role (walking near it first; another that comes for you is beaten on the way). */
export async function beat(page: Page, role: string): Promise<void> {
  for (let tries = 0; tries < 6 && (await entities(page)).some((e) => e.kind === "mob" && e.role === role); tries++) {
    const mob = await entity(page, (e) => e.kind === "mob" && e.role === role, `the ${role}`);
    await walkInside(page, mob.tile, 2);
    if ((await realm<string | null>(page, "layer.open")) === null) {
      // The same mob walked to (another of the role may stand far off), if it still stands; else the next.
      const same = (e: Entity) => e.kind === "mob" && e.role === role && e.spawn === mob.spawn;
      if (!(await entities(page)).some(same)) continue;
      await clickEntity(page, same, `the ${role}`);
    }
    await winDuel(page);
  }
}

/** Clicks the way into a dungeon (an entrance of the world). */
export async function enter(page: Page, id: string): Promise<void> {
  await clickEntity(page, (e) => e.kind === "entrance" && e.to === `dungeon:${id}`, `the way into ${id}`);
}
