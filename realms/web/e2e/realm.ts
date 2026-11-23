import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect } from "@playwright/test";
import { type Hex, distance, findPath, hex, spiral } from "../src/hex";
import { CHUNK, type ChunkData, type DungeonData, type InteriorData, type WorldData, chunkKey } from "../src/world/schema";

// The realm's page as the tests drive it: everything is read from globalThis.realmTest (src/testHooks.ts) and every
// action is a real mouse click at the place it publishes. Where a test starts is planned from the world's files.

export interface Entity {
  readonly name: string;
  readonly kind: string;
  readonly id: string;
  readonly hex: string;
  readonly x: number;
  readonly y: number;
  readonly to?: string;
  readonly spawn?: string;
  readonly tier?: number;
  readonly role?: string | null;
  readonly tower?: string;
  readonly moving?: boolean;
}

export interface Control {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/** The pinned spawn clock every test plays at, so a spawn's mob is the same on every run. */
export const NOW = 1763856000;

/** Opens the offline overworld with a made character, at a place. */
export async function openRealm(page: Page, options: { at: string; name?: string; color?: string; extra?: string }): Promise<void> {
  const query = `offline&test&name=${options.name ?? "Tester"}&color=${options.color ?? "W"}&now=${NOW}&wander=0&at=${options.at}${options.extra ?? ""}`;
  await page.goto(`/?${query}`);
  await waitReady(page);
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (globalThis as any).realmTest?.ready === true, undefined, { timeout: 30_000 });
}

/** Reads a property of realmTest by its path ("space.id", "layer"). */
export const realm = <T>(page: Page, read: string): Promise<T> =>
  page.evaluate((r) => r.split(".").reduce((o: any, k) => o?.[k], (globalThis as any).realmTest), read) as Promise<T>;

export const entities = (page: Page) => realm<Entity[]>(page, "entities");

export async function entity(page: Page, match: (e: Entity) => boolean, what: string): Promise<Entity> {
  let found: Entity | undefined;
  await expect
    .poll(async () => {
      found = (await entities(page)).find(match);
      return found !== undefined;
    }, { message: what })
    .toBe(true);
  return found!;
}

export const player = (page: Page) => entity(page, (e) => e.kind === "player", "the player");

export async function playerHex(page: Page): Promise<Hex> {
  const [q, r] = (await player(page)).hex.split(",").map(Number);
  return hex(q!, r!);
}

export async function control(page: Page, name: string): Promise<Control> {
  let found: Control | undefined;
  await expect
    .poll(async () => {
      found = (await realm<Control[]>(page, "controls")).find((c) => c.name === name);
      return found !== undefined;
    }, { message: `control ${name}` })
    .toBe(true);
  return found!;
}

export async function clickControl(page: Page, name: string): Promise<void> {
  const c = await control(page, name);
  await page.mouse.click(c.x, c.y);
}

/** Clicks a hex of the current space. */
export async function clickHex(page: Page, q: number, r: number): Promise<void> {
  const at = await page.evaluate(([a, b]) => (globalThis as any).realmTest.screenOfHex(a, b), [q, r] as const);
  await page.mouse.click(at.x, at.y);
}

export async function waitSpace(page: Page, id: string | RegExp): Promise<void> {
  await expect.poll(async () => (await realm<string | undefined>(page, "space.id")) ?? "", { timeout: 30_000 }).toMatch(id);
  await waitReady(page);
}

// --- The world's files --------------------------------------------------------------------------------------------------

const plane = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "dominaria");
const read = <T>(path: string): T => JSON.parse(readFileSync(join(plane, path), "utf8")) as T;

export const world = (): WorldData => read<WorldData>("world/world.json");
export const dungeon = (id: string): DungeonData => read<DungeonData>(`dungeons/${id}.json`);
export const interior = (id: string): InteriorData => read<InteriorData>(`interiors/${id}.json`);

const chunks = new Map<string, ChunkData>();
export function chunk(cq: number, cr: number): ChunkData {
  const k = chunkKey(cq, cr);
  let c = chunks.get(k);
  if (!c) {
    c = read<ChunkData>(`world/chunks/${k}.json`);
    chunks.set(k, c);
  }
  return c;
}

export const chunkOfHex = (h: Hex): ChunkData => chunk(Math.floor(h.q / CHUNK), Math.floor(h.r / CHUNK));

let lanes: Set<string> | null = null;

/** Whether a hex of the world is open ground, with nothing on it that walking onto would use, and no ferry's lane. */
export function openWorld(h: Hex): boolean {
  lanes ??= new Set(world().ferries.flatMap((f) => f.lane.slice(1, -1).map(([q, r]) => `${q},${r}`)));
  if (lanes.has(`${h.q},${h.r}`)) return false;
  if (h.q < 0 || h.r < 0 || h.q >= 640 || h.r >= 640) return false;
  const c = chunkOfHex(h);
  const tile = c.tiles[(h.q - c.cq * CHUNK) * CHUNK + (h.r - c.cr * CHUNK)]!;
  if (tile[4] !== 0) return false;
  return !c.doors.some((d) => d.q === h.q && d.r === h.r) && !c.entrances.some((e) => e.q === h.q && e.r === h.r);
}

/** An open hex `steps` from `target` (or as near as there is one), with nothing on it, that can walk to it. */
export function openNear(target: Hex, steps: number, open: (h: Hex) => boolean = openWorld): Hex {
  for (let d = steps; d >= 1; d--) {
    const ring = spiral(target, d).filter((h) => distance(h, target) === d && open(h));
    ring.sort((a, b) => a.q - b.q || a.r - b.r);
    for (const h of ring) if (findPath(h, target, (x) => open(x) || (x.q === target.q && x.r === target.r), undefined, 20000)) return h;
  }
  throw new Error(`nowhere open near ${target.q},${target.r}`);
}

/** The `at` of a hex of the world, for openRealm. */
export const at = (h: Hex): string => `world:${h.q},${h.r}`;

/** Walks across the world toward a hex too far off to be on screen, by clicks a few hexes along the way at a time. */
export async function walkNear(page: Page, goal: Hex, near = 5, open: (h: Hex) => boolean = openWorld): Promise<void> {
  for (let tries = 0; tries < 40; tries++) {
    await expect.poll(async () => (await player(page)).moving).toBe(false);
    const from = await playerHex(page);
    if (distance(from, goal) <= near) return;
    // Round the mobs: a click on one is an attack, not a walk.
    // Round the mobs, out of the reach of their bodies on screen: a click on one is an attack, not a walk.
    const mobs = (await entities(page)).filter((e) => e.kind === "mob" || e.kind === "other").map((e) => {
      const [q, r] = e.hex.split(",").map(Number);
      return hex(q!, r!);
    });
    const clear = (h: Hex) => mobs.every((m) => distance(m, h) > 2);
    const path = findPath(from, goal, (h) => (open(h) && clear(h)) || (h.q === goal.q && h.r === goal.r), undefined, 40000)
      ?? findPath(from, goal, (h) => open(h) || (h.q === goal.q && h.r === goal.r), undefined, 40000);
    expect(path, `a way to ${goal.q},${goal.r}`).not.toBeNull();
    // A few hexes along, never onto or right beside a mob.
    let k = Math.min(near, path!.length - 1);
    while (k > 0 && !clear(path![k]!) && k < path!.length - 1 && distance(path![k]!, goal) > near) k--;
    const step = path![Math.max(0, k)]!;
    await clickHex(page, step.q, step.r);
    // Reached, or stopped by a mob that came for you (dungeon mobs chase): win its duel, take the loot, walk on.
    // (Or stopped short, a mob in the way: the next round plans again from where the player stands.)
    await page.waitForTimeout(150);
    await expect
      .poll(async () => (await realm<string | null>(page, "layer.open")) !== null || (await player(page)).hex === `${step.q},${step.r}` || !(await player(page)).moving, { timeout: 20_000 })
      .toBe(true);
    if ((await realm<string | null>(page, "layer.open")) !== null) await winDuel(page);
  }
}

/** Wins the duel the stand-in card layer has open, and takes the loot offered. */
export async function winDuel(page: Page): Promise<void> {
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 20_000 }).toBe("duel");
  await clickControl(page, "layer:win");
  await expect.poll(() => realm<string | null>(page, "layer.open")).not.toBe("duel");
  if ((await realm<string | null>(page, "layer.open")) === "loot") await clickControl(page, "layer:take");
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("world");
}
