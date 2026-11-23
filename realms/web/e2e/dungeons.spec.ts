import { type Page, expect, test } from "@playwright/test";
import { type Hex, hex } from "../src/hex";
import { clickControl, dungeon, entities, entity, openRealm, realm, waitSpace, walkNear, winDuel } from "./realm";

// Dungeons: a run generated in the browser from the run the server hands out, the warden before the stairs, the stair
// down to the next floor; the Phyrexian Portal sealed to all but five colors; and a mage tower attuned with the
// stand-in duel, then its waystone's fast travel to another attuned tower.

const parse = (k: string): Hex => {
  const [q, r] = k.split(",").map(Number);
  return hex(q!, r!);
};

/** Walks a room or a floor by clicks, over the open hexes the page says it has. */
async function walkInside(page: Page, goal: Hex, near = 1): Promise<void> {
  // Not the stairs or the way out: walking onto one is using it.
  const run = await realm<{ up: string; down: string | null; wayOut: string | null } | null>(page, "run");
  const stops = new Set([run?.up, run?.down, run?.wayOut].filter((k): k is string => typeof k === "string"));
  const open = new Set((await realm<string[]>(page, "openHexes")).filter((k) => !stops.has(k)));
  await walkNear(page, goal, near, (h) => open.has(`${h.q},${h.r}`));
}

/** Clicks a mob of the floor (walking near it first), and wins the duel and takes the loot. */
async function beat(page: Page, role: string): Promise<void> {
  const mob = await entity(page, (e) => e.kind === "mob" && e.role === role, `the ${role}`);
  await walkInside(page, parse(mob.hex), 3);
  const there = (await entities(page)).find((e) => e.kind === "mob" && e.role === role);
  if (there) {
    await page.mouse.click(there.x, there.y);
    await winDuel(page);
  }
  // Another may have come for you first: the one asked for is beaten in the end.
  for (let tries = 0; tries < 4 && (await entities(page)).some((e) => e.kind === "mob" && e.role === role); tries++) {
    const again = await entity(page, (e) => e.kind === "mob" && e.role === role, `the ${role}`);
    await walkInside(page, parse(again.hex), 2);
    const next = (await entities(page)).find((e) => e.kind === "mob" && e.role === role);
    if (!next) break;
    await page.mouse.click(next.x, next.y);
    await winDuel(page);
  }
}

async function enter(page: Page, id: string): Promise<void> {
  const way = await entity(page, (e) => e.kind === "entrance" && e.to === id, `the way into ${id}`);
  await page.mouse.click(way.x, way.y);
}

test("into a dungeon: the run's floor with its spell table, the warden before the stair, and the stair down", async ({ page }) => {
  const id = "serras-fallen-sanctum";
  await openRealm(page, { at: id, extra: "&mobs=0" });
  await enter(page, id);
  await waitSpace(page, /^run:/);
  const run = (await realm<{ id: string; dungeon: string; floor: number; floors: number; down: string | null }>(page, "run"))!;
  expect(run).toMatchObject({ dungeon: id, floor: 0 });
  expect(run.floors).toBeGreaterThanOrEqual(dungeon(id).floors[0]);
  await entity(page, (e) => e.kind === "spell-table", "the entrance's spell table");
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.find((c) => c.name === "enterDungeon")?.body).toEqual({ Dungeon: id });

  // The stair is barred while the warden stands.
  const mobs = (await realm<{ kind: string; role: string | null }[]>(page, "entities")).filter((e) => e.kind === "mob");
  expect(mobs.filter((m) => m.role === "warden")).toHaveLength(1);
  await beat(page, "warden");
  await walkInside(page, parse(run.down!), 3);
  const down = await entity(page, (e) => e.kind === "stairs-down", "the stairs down");
  await page.mouse.click(down.x, down.y);
  await expect.poll(async () => (await realm<{ floor: number }>(page, "run")).floor, { timeout: 30_000 }).toBe(1);
  await waitSpace(page, /^run:/);
  expect((await realm<{ name: string; body?: unknown }[]>(page, "api")).find((c) => c.name === "dungeonFloor")?.body).toEqual({ Run: run.id, Floor: 1 });
  expect(await realm<string>(page, "message")).toMatch(/Floor 2 of/);
});

test("the Phyrexian Portal stays sealed to a mage without all five colors", async ({ page }) => {
  await openRealm(page, { at: "phyrexian-portal", extra: "&mobs=0" });
  await enter(page, "phyrexian-portal");
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
  expect((await realm<{ name: string; text: string }[]>(page, "controls")).find((c) => c.name === "dialog")?.text).toMatch(/sealed/);
  await clickControl(page, "dialog:close");
  expect(await realm<string>(page, "space.id")).toBe("world");
  expect((await realm<{ name: string }[]>(page, "api")).some((c) => c.name === "enterDungeon")).toBe(false);
});

test("a mage tower attuned by beating its mage, then its waystone's travel to another attuned tower", async ({ page }) => {
  test.setTimeout(120_000);
  const tower = "benalia-1";
  const other = "tolaria-1";
  await openRealm(page, { at: tower, extra: `&mobs=0&attuned=${other}` });
  // Dormant until its mage is beaten.
  const stone = await entity(page, (e) => e.kind === "waystone" && e.tower === tower, "the tower's waystone");
  await page.mouse.move(stone.x, stone.y);
  await expect.poll(() => realm<string | null>(page, "tooltip")).toMatch(/dormant/);
  await enter(page, tower);
  await waitSpace(page, /^run:/);
  await beat(page, "boss");
  await expect.poll(async () => (await realm<{ attuned: string[] }>(page, "character")).attuned).toContain(tower);
  expect((await realm<string[]>(page, "messages")).some((m) => /is attuned to you/.test(m))).toBe(true);

  // The way out opens beside the mage; out, and the waystone is lit.
  const out = await entity(page, (e) => e.kind === "leave" && e.id === "way-out", "the way out");
  await page.mouse.click(out.x, out.y);
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
  await clickControl(page, "dialog:leave");
  await waitSpace(page, "world");
  const lit = await entity(page, (e) => e.kind === "waystone" && e.tower === tower, "the tower's waystone");
  await page.mouse.move(lit.x, lit.y);
  await expect.poll(() => realm<string | null>(page, "tooltip")).toMatch(/attuned/);
  await page.mouse.click(lit.x, lit.y);
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
  await clickControl(page, `dialog:${dungeon(other).name.toLowerCase()}`);
  await expect.poll(() => realm<string>(page, "message"), { timeout: 30_000 }).toMatch(/The waystone carries you to/);
  // Beside the other tower's way in.
  const there = dungeon(other).entrance;
  const [q, r] = (await entity(page, (e) => e.kind === "player", "you")).hex.split(",").map(Number);
  expect(Math.max(Math.abs(q! - there[0]), Math.abs(r! - there[1]), Math.abs(q! + r! - there[0] - there[1]))).toBe(1);
  expect((await realm<{ name: string; body?: unknown }[]>(page, "api")).find((c) => c.name === "waystone")?.body).toEqual({ Tower: other });
});
