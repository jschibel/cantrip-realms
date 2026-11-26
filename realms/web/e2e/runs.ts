import type { Page } from "@playwright/test";
import { type Entity, type Tile, advance, clickEntity, entities, entity, realm, until, walkTo, winDuel } from "./realm";

// Dungeon runs, as the suites play them: walking a floor, beating a floor's mob with the stand-in duel, going in.

interface RunState {
  readonly id: string;
  readonly floor: number;
  readonly floors: number;
  readonly up: Tile | null;
  readonly down: Tile | null;
  readonly wayOut: Tile | null;
  /** The run's shrine on the floor shown (design.md A6), which floor of the run holds it, and whether it has blessed. */
  readonly shrine: Tile | null;
  readonly shrineFloor: number | null;
  readonly shrineUsed: boolean;
}

export const run = (page: Page) => realm<RunState | null>(page, "run");

/** Walks a floor toward a tile, never clicking its ways (a click on one, or its doorway, is using it). */
export async function walkInside(page: Page, goal: Tile, near = 1): Promise<void> {
  const r = await run(page);
  // Each way, and the doorway past it (a step north: a click there goes through too).
  const stops = new Set([r?.up, r?.down, r?.wayOut].filter((t): t is Tile => !!t).flatMap((t) => [`${t.x},${t.z}`, `${t.x},${t.z - 1}`]));
  await walkTo(page, goal, near, (t) => stops.has(`${t.x},${t.z}`));
}

/**
 * Engages a floor's mob of a role and leaves its duel open, unanswered, for the test to play as it means to (lose it,
 * say): toward it a few steps at a time, then a click on it - whichever comes first, its own coming for the player or the
 * click, the duel that opens is left as it is, never won on the way (walkInside wins any duel it meets). The duel's mob.
 */
export async function engageInside(page: Page, role: string): Promise<{ id: string; spawn: string }> {
  const open = () => realm<string | null>(page, "layer.open");
  for (let tries = 0; tries < 30 && (await open()) === null; tries++) {
    const mob = await entity(page, (e) => e.kind === "mob" && e.role === role, `the ${role}`, 30);
    if ((await open()) !== null) break;
    const me = (await entity(page, (e) => e.kind === "player", "the player")).tile;
    if (Math.max(Math.abs(me.x - mob.tile.x), Math.abs(me.z - mob.tile.z)) <= 2) {
      await clickEntity(page, (e) => e.kind === "mob" && e.spawn === mob.spawn, `the ${role}`).catch(() => null);
      await until(page, async () => (await open()) !== null, "the duel", 20);
      break;
    }
    const r = await run(page);
    const stops = new Set([r?.up, r?.down, r?.wayOut].filter((t): t is Tile => !!t).flatMap((t) => [`${t.x},${t.z}`, `${t.x},${t.z - 1}`]));
    const path = ((await page.evaluate(([x, z]) => (globalThis as any).realmTest.pathTo(x, z), [mob.tile.x, mob.tile.z] as const)) ?? []) as Tile[];
    let k = Math.min(6, Math.max(1, path.length - 3));
    while (k > 1 && stops.has(`${path[k]?.x},${path[k]?.z}`)) k--;
    const step = path[k];
    if (!step) break;
    await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [step.x, step.z] as const);
    await advance(page, 0.2);
    await until(page, async () => (await open()) !== null || !(await entity(page, (e) => e.kind === "player", "the player")).moving, "the step taken", 20);
  }
  await until(page, async () => (await open()) === "duel", "the duel", 30);
  const duel = (await realm<{ screen: string; args: { mob: { id: string; spawn: string } } }[]>(page, "layer.requests")).filter((x) => x.screen === "duel").at(-1)!;
  return duel.args.mob;
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

/** Clicks the floor's shrine until its dialog opens: a duel a mob of the floor starts meanwhile is won first. */
export async function toShrine(page: Page): Promise<void> {
  const open = () => realm<string | null>(page, "layer.open");
  for (let tries = 0; ; tries++) {
    if ((await open()) !== null) await winDuel(page);
    await clickEntity(page, (e) => e.kind === "heart-shrine", "the shrine");
    await until(page, async () => (await realm<string>(page, "screen")) === "dialog" || (await open()) !== null, "the shrine's dialog", 20);
    if ((await realm<string>(page, "screen")) === "dialog" || tries >= 3) return;
  }
}

/** Clicks the way into a dungeon (an entrance of the world). */
export async function enter(page: Page, id: string): Promise<void> {
  await clickEntity(page, (e) => e.kind === "entrance" && e.to === `dungeon:${id}`, `the way into ${id}`);
}
