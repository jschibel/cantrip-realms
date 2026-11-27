import type { Page } from "@playwright/test";
import { type Entity, type Tile, advance, clickControl, clickEntity, entities, entity, realm, until, walkTo, winDuel } from "./realm";

// Dungeon runs, as the suites play them (design.md A6: a dungeon is a tournament): the entrance's board, walking an arena,
// beating its challengers with the stand-in duel until its gate opens, the gate's panel and the way down.

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
  /** The round as it stands: its challengers beaten, of how many, how many open its gate, and whether it stands open. */
  readonly round: { readonly beaten: number; readonly of: number; readonly need: number; readonly open: boolean } | null;
}

export const run = (page: Page) => realm<RunState | null>(page, "run");

/** The tiles a click on would use a way of the floor: each way, and the doorway past it (south of the way back, north of the rest). */
async function stopsOf(page: Page): Promise<Set<string>> {
  const r = await run(page);
  const ways: [Tile | null | undefined, number][] = [[r?.up, 1], [r?.down, -1], [r?.wayOut, -1]];
  return new Set(ways.filter((w): w is [Tile, number] => !!w[0]).flatMap(([t, dz]) => [`${t.x},${t.z}`, `${t.x},${t.z + dz}`]));
}

/** Walks a floor toward a tile, never clicking its ways (a click on one, or its doorway, is using it). */
export async function walkInside(page: Page, goal: Tile, near = 1): Promise<void> {
  const stops = await stopsOf(page);
  await walkTo(page, goal, near, (t) => stops.has(`${t.x},${t.z}`));
}

/**
 * Engages a floor's mob of a role and leaves its duel open, unanswered, for the test to play as it means to (lose it,
 * say): toward it a few steps at a time, then a click on it. The duel's mob.
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
    const stops = await stopsOf(page);
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

/** Beats one of the floor's mobs of a role: walked up to, clicked, its duel won with the stand-in. False with none left. */
export async function beatOne(page: Page, role: string): Promise<boolean> {
  for (let tries = 0; tries < 4; tries++) {
    const all = (await entities(page)).filter((e) => e.kind === "mob" && e.role === role);
    if (all.length === 0) return false;
    const mob = all[0]!;
    await walkInside(page, mob.tile, 2);
    if ((await realm<string | null>(page, "layer.open")) === null) {
      const same = (e: Entity) => e.kind === "mob" && e.role === role && e.spawn === mob.spawn;
      if (!(await entities(page)).some(same)) continue;
      await clickEntity(page, same, `the ${role}`);
    }
    await winDuel(page);
    return true;
  }
  return false;
}

/** Beats every one of the floor's mobs of a role (the boss, say). */
export async function beat(page: Page, role: string): Promise<void> {
  for (let tries = 0; tries < 8 && (await beatOne(page, role)); tries++);
}

/** Wins the round shown: its challengers beaten one by one until its gate opens. */
export async function winRound(page: Page): Promise<void> {
  for (let tries = 0; tries < 8 && !(await run(page))?.round?.open; tries++) await beatOne(page, "encounter");
  await until(page, async () => (await run(page))?.round?.open === true, "the round won, its gate open", 30);
}

/** Walks to the round's gate and clicks it: its panel opens (the round won), or the page says it is shut. */
export async function toGate(page: Page): Promise<void> {
  const r = (await run(page))!;
  await walkInside(page, { x: r.down!.x, z: r.down!.z + 1 }, 1);
  await clickEntity(page, (e) => e.kind === "down", "the gate");
}

/** Wins the round shown and goes down through its gate, as its panel offers. */
export async function descend(page: Page): Promise<void> {
  const r = (await run(page))!;
  await winRound(page);
  await toGate(page);
  await until(page, async () => (await realm<string>(page, "screen")) === "gate", "the gate's panel", 30);
  await clickControl(page, "gate:descend");
  await until(page, async () => (await run(page))?.floor === r.floor + 1, "down through the gate", 60);
  await until(page, async () => !(await realm<boolean>(page, "transitioning")), "the iris open again", 30);
}

/** Clicks the floor's shrine until its dialog opens. */
export async function toShrine(page: Page): Promise<void> {
  const open = () => realm<string | null>(page, "layer.open");
  for (let tries = 0; ; tries++) {
    if ((await open()) !== null) await winDuel(page);
    await clickEntity(page, (e) => e.kind === "heart-shrine", "the shrine");
    await until(page, async () => (await realm<string>(page, "screen")) === "dialog" || (await open()) !== null, "the shrine's dialog", 20);
    if ((await realm<string>(page, "screen")) === "dialog" || tries >= 3) return;
  }
}

/** Clicks the way into a dungeon (an entrance of the world): its tournament's board opens, unless it is sealed. */
export async function toBoard(page: Page, id: string): Promise<void> {
  await clickEntity(page, (e) => e.kind === "entrance" && e.to === `dungeon:${id}`, `the way into ${id}`);
}

/** Goes into a dungeon: its way clicked, and Enter on its board. */
export async function enter(page: Page, id: string): Promise<void> {
  await toBoard(page, id);
  await until(page, async () => (await realm<string>(page, "screen")) === "board", "the tournament's board", 30);
  await clickControl(page, "board:enter");
}
