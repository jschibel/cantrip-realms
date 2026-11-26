import { expect, test } from "@playwright/test";
import { chebyshev, clickControl, clickEntity, dungeon, entity, groundsHere, openRealm, player, realm, until, waitSpace } from "./realm";
import { beat, enter, run, walkInside } from "./runs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mobTier = (id: string): number =>
  (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "dominaria", "mobs", `${id}.json`), "utf8")) as { tier: number }).tier;

// Dungeons: a run generated in the browser from the run the server hands out, on squares - arriving where the floor
// says, the warden before the stairs, the stair down to the next floor; the Phyrexian Portal sealed to all but five
// colors; and a mage tower attuned with the stand-in duel, then its waystone's fast travel to another attuned tower.

test("a color's dungeon by the character's standing: an enemy color's hold is tier 4, its mobs tier 3 and 4, and says so", async ({ page }) => {
  test.setTimeout(120_000);
  const id = "benalish-keep";
  // A black character: Benalia's white is across the wheel from black.
  await openRealm(page, { at: id, color: "B", extra: "&mobs=0" });
  const marked = (await realm<{ markers: { id: string; tier: number }[] }>(page, "map")).markers.find((m) => m.id === id);
  expect(marked?.tier).toBe(4);
  await enter(page, id);
  await waitSpace(page, /^run:/);
  expect(await realm<{ tier: number }>(page, "area")).toMatchObject({ tier: 4 });
  expect((await realm<string[]>(page, "messages")).some((m) => /An enemy color's hold: tier 4/.test(m))).toBe(true);
  const mobs = (await realm<{ kind: string; role: string | null; id: string }[]>(page, "entities")).filter((e) => e.kind === "mob" && e.role === "encounter");
  expect(mobs.length).toBeGreaterThan(0);
  for (const m of mobs) expect(mobTier(m.id)).toBeGreaterThanOrEqual(3);
  if (process.env.REALMS_SHOTS) await page.screenshot({ path: `${process.env.REALMS_SHOTS}/dungeon-enemy-standing.png` });
});

test("into a dungeon: the run's floor with its spell table, the warden before the stair, and the stair down", async ({ page }) => {
  test.setTimeout(180_000);
  const id = "benalish-keep";
  await openRealm(page, { at: id, extra: "&mobs=0" });
  await enter(page, id);
  await waitSpace(page, /^run:/);
  const state = (await run(page))!;
  expect(state.floor).toBe(0);
  expect(state.floors).toBeGreaterThanOrEqual(dungeon(id).floors[0]);
  // Arrived where the floor says.
  await until(page, async () => !(await player(page)).moving, "standing");
  await entity(page, (e) => e.kind === "spell-table", "the entrance's spell table");
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.find((c) => c.name === "enterDungeon")?.body).toEqual({ Dungeon: id });

  // The stair is barred while the warden stands.
  const mobs = (await realm<{ kind: string; role: string | null }[]>(page, "entities")).filter((e) => e.kind === "mob");
  expect(mobs.filter((m) => m.role === "warden")).toHaveLength(1);
  await beat(page, "warden");
  await walkInside(page, state.down!, 2);
  await clickEntity(page, (e) => e.kind === "down", "the stairs down");
  await until(page, async () => (await run(page))?.floor === 1, "on the second floor", 30);
  await waitSpace(page, /^run:/);
  expect((await realm<{ name: string; body?: unknown }[]>(page, "api")).find((c) => c.name === "dungeonFloor")?.body).toEqual({ Run: state.id, Floor: 1 });
  expect((await realm<string[]>(page, "messages")).some((m) => /Floor 2 of/.test(m))).toBe(true);
});

test("the Phyrexian Portal stays sealed to a mage without all five colors", async ({ page }) => {
  await openRealm(page, { at: "phyrexian-portal", extra: "&mobs=0" });
  await enter(page, "phyrexian-portal");
  await until(page, async () => (await realm<string[]>(page, "messages")).some((m) => /sealed/.test(m)), "told it is sealed", 20);
  await until(page, async () => !(await realm<boolean>(page, "transitioning")), "the iris open again");
  expect(await realm<string>(page, "space.id")).toBe("world");
  expect((await realm<{ name: string }[]>(page, "api")).some((c) => c.name === "enterDungeon")).toBe(false);
});

test("a mage tower attuned by beating its mage, then its waystone's travel to another attuned tower", async ({ page }) => {
  test.setTimeout(180_000);
  const tower = "benalia-1";
  const other = "orvada-1";
  await openRealm(page, { at: tower, extra: `&mobs=0&attuned=${other}` });
  // Dormant until its mage is beaten.
  const stone = await entity(page, (e) => e.kind === "waystone" && e.id === tower, "the tower's waystone");
  await page.mouse.move(stone.x, stone.y);
  await until(page, async () => /dormant/.test((await realm<string | null>(page, "tooltip")) ?? ""), "dormant");
  await enter(page, tower);
  await waitSpace(page, /^run:/);
  await beat(page, "boss");
  await until(page, async () => (await realm<{ attuned: string[] }>(page, "character")).attuned.includes(tower), "attuned");
  expect((await realm<string[]>(page, "messages")).some((m) => /is attuned to you/.test(m))).toBe(true);

  // The way out beside the mage; out, and the waystone is lit.
  const out = (await run(page))!.wayOut!;
  await walkInside(page, out, 1);
  await clickEntity(page, (e) => e.kind === "leave" && e.name === "way-out", "the way out");
  await waitSpace(page, "world");
  // Out on the travel map, beside the tower's way in.
  const entrance = { x: dungeon(tower).entrance[0], z: dungeon(tower).entrance[1] };
  expect(chebyshev((await player(page)).tile, entrance)).toBe(1);
  expect(await groundsHere(page)).toBeNull();
  const lit = await entity(page, (e) => e.kind === "waystone" && e.id === tower, "the tower's waystone");
  await page.mouse.move(lit.x, lit.y);
  await until(page, async () => /attuned/.test((await realm<string | null>(page, "tooltip")) ?? ""), "lit");
  await page.mouse.click(lit.x, lit.y);
  await until(page, async () => (await realm<string>(page, "screen")) === "dialog", "the waystone's word", 20);
  await clickControl(page, `dialog:${dungeon(other).name.toLowerCase()}`);
  await until(page, async () => /The waystone carries you to/.test((await realm<string>(page, "message")) ?? ""), "carried", 30);
  // Beside the other tower's way in.
  expect(chebyshev((await player(page)).tile, { x: dungeon(other).entrance[0], z: dungeon(other).entrance[1] })).toBe(1);
  expect((await realm<{ name: string; body?: unknown }[]>(page, "api")).find((c) => c.name === "waystone")?.body).toEqual({ Tower: other });
});
