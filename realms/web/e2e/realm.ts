import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect } from "@playwright/test";
import { type Hex, distance, findPath, hex, spiral } from "../src/hex";
import type { MapData } from "../src/maps/schema";

// The realm's page as the tests drive it: everything is read from globalThis.realmTest (src/testHooks.ts) and every
// action is a real mouse click at the place it publishes.

export interface Entity {
  readonly name: string;
  readonly kind: string;
  readonly id: string;
  readonly hex: string;
  readonly x: number;
  readonly y: number;
  readonly to?: string;
  readonly spawn?: string;
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

/** Opens the offline overworld with a made character, at a place, with chance turned off. */
export async function openRealm(page: Page, options: { at: string; name?: string; color?: string; encounters?: string; extra?: string }): Promise<void> {
  const query = `offline&test&name=${options.name ?? "Tester"}&color=${options.color ?? "W"}&now=${NOW}&wander=0&encounters=${options.encounters ?? "never"}&at=${options.at}${options.extra ?? ""}`;
  await page.goto(`/?${query}`);
  await waitReady(page);
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (globalThis as any).realmTest?.ready === true, undefined, { timeout: 30_000 });
}

/** Reads a property of realmTest by its path ("map.id", "layer"). */
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

/** Clicks a hex of the current map. */
export async function clickHex(page: Page, q: number, r: number): Promise<void> {
  const at = await page.evaluate(([a, b]) => (globalThis as any).realmTest.screenOfHex(a, b), [q, r] as const);
  await page.mouse.click(at.x, at.y);
}

export async function waitMap(page: Page, id: string | RegExp): Promise<void> {
  await expect.poll(async () => (await realm<string | undefined>(page, "map.id")) ?? "", { timeout: 30_000 }).toMatch(id);
  await waitReady(page);
}

const mapsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "dominaria", "maps");

/** A map's file, for planning where a test starts. */
export function mapData(id: string): MapData {
  return JSON.parse(readFileSync(join(mapsDir, `${id}.json`), "utf8")) as MapData;
}

/** An open hex `steps` from `target` (or as near as there is one), the one nearest the middle of the map. */
export function openNear(map: MapData, target: Hex, steps: number): Hex {
  const open = new Set(map.tiles.filter((t) => t[4] === 0).map((t) => `${t[0]},${t[1]}`));
  const things = new Set([...map.npcs, ...map.chests, ...map.exits, ...map.spawns].map((t) => `${t.q},${t.r}`));
  for (let d = steps; d >= 1; d--) {
    const ring = spiral(target, d).filter((h) => distance(h, target) === d && open.has(`${h.q},${h.r}`) && !things.has(`${h.q},${h.r}`));
    ring.sort((a, b) => distance(a, hex(0, 0)) - distance(b, hex(0, 0)) || a.q - b.q || a.r - b.r);
    if (ring[0]) return ring[0];
  }
  throw new Error(`nowhere open near ${target.q},${target.r} of ${map.id}`);
}

/** The `at` of a hex of a map, for openRealm. */
export const at = (map: MapData, h: Hex): string => `${map.id}:${h.q},${h.r}`;

/**
 * Walks across a map toward a hex too far off to be on screen, by clicks on the way: a hex a few steps along the
 * path at a time, until the goal is near enough to click itself.
 */
export async function walkNear(page: Page, map: MapData, goal: Hex, near = 5): Promise<void> {
  const open = new Set(map.tiles.filter((t) => t[4] === 0).map((t) => `${t[0]},${t[1]}`));
  for (let tries = 0; tries < 12; tries++) {
    await expect.poll(async () => (await player(page)).moving).toBe(false);
    const [q, r] = (await player(page)).hex.split(",").map(Number);
    const from = hex(q!, r!);
    if (distance(from, goal) <= near) return;
    const path = findPath(from, goal, (h) => open.has(`${h.q},${h.r}`) || (h.q === goal.q && h.r === goal.r), undefined, 20000);
    expect(path, `a way to ${goal.q},${goal.r}`).not.toBeNull();
    const step = path![Math.min(near, path!.length - 1)]!;
    await clickHex(page, step.q, step.r);
    await expect.poll(async () => (await player(page)).hex).toBe(`${step.q},${step.r}`);
  }
}
