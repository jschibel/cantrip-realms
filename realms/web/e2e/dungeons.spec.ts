import { type Page, expect, test } from "@playwright/test";
import { chebyshev, clickControl, clickEntity, dungeon, entities, entity, groundsHere, openRealm, player, realm, until, waitSpace } from "./realm";
import { beat, beatOne, descend, enter, run, toBoard, toGate, walkInside, winRound } from "./runs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The character's gold, as the page has it. */
const gold = async (page: Page): Promise<number> => (await realm<{ gold: number }>(page, "character")).gold;

const mobTier = (id: string): number =>
  (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "dominaria", "mobs", `${id}.json`), "utf8")) as { tier: number }).tier;

// Dungeons are tournaments (design.md A6): the board at the entrance before a run - its rounds and their rule, its boss,
// its prizes, the hearts at stake; a round's arena generated in the browser from the run the server hands out, its three
// challengers on their circles, the gate at its head shut until two of them are beaten, the third a bonus fight that still
// pays, the open gate's panel - stay, go down, or leave with the winnings; the Phyrexian Portal sealed to all but five
// colors; and a mage tower's round and then its mage's hall, the mage beaten attuning its waystone for fast travel.

test("a color's dungeon by the character's standing: an enemy color's hold is tier 4, its mobs tier 3 and 4, and says so", async ({ page }) => {
  test.setTimeout(120_000);
  const id = "benalish-keep";
  // A black character: Benalia's white is across the wheel from black.
  await openRealm(page, { at: id, color: "B", extra: "&mobs=0" });
  const marked = (await realm<{ markers: { id: string; tier: number }[] }>(page, "map")).markers.find((m) => m.id === id);
  expect(marked?.tier).toBe(4);
  await toBoard(page, id);
  await until(page, async () => (await realm<string>(page, "screen")) === "board", "the board", 30);
  await expect(page.locator("[data-test='tournament-board']")).toContainText("A tier 4 tournament");
  await expect(page.locator("[data-test='tournament-board']")).toContainText("An enemy color's hold: tier 4");
  await clickControl(page, "board:enter");
  await waitSpace(page, /^run:/);
  expect(await realm<{ tier: number }>(page, "area")).toMatchObject({ tier: 4 });
  expect((await realm<string[]>(page, "messages")).some((m) => /An enemy color's hold: tier 4/.test(m))).toBe(true);
  const mobs = (await realm<{ kind: string; role: string | null; id: string }[]>(page, "entities")).filter((e) => e.kind === "mob" && e.role === "encounter");
  expect(mobs).toHaveLength(3);
  for (const m of mobs) expect(mobTier(m.id)).toBeGreaterThanOrEqual(3);
  if (process.env.REALMS_SHOTS) await page.screenshot({ path: `${process.env.REALMS_SHOTS}/dungeon-enemy-standing.png` });
});

test("the board, then a round: three challengers, the gate shut at one win and open at two, the third still paying, the gate's panel, and down", async ({ page }) => {
  test.setTimeout(240_000);
  const id = "benalish-keep";
  await openRealm(page, { at: id, extra: "&mobs=0" });

  // The board: the tournament as the page knows it, and Not now keeps the character in the world.
  await toBoard(page, id);
  await until(page, async () => (await realm<string>(page, "screen")) === "board", "the board", 30);
  const board = page.locator("[data-test='tournament-board']");
  await expect(board).toContainText(dungeon(id).name);
  await expect(board).toContainText("Beat 2 of the 3 challengers in a round to open its gate");
  await expect(board).toContainText("Lyra Dawnbringer's hall");
  await expect(page.locator("[data-test='board:boss-gold']")).toContainText("1,500 gold");
  await expect(page.locator("[data-test='board:gold']")).toContainText("gold");
  await expect(page.locator("[data-test='board:hearts']")).toContainText("2 of 2");
  await expect(board).toContainText("Leave between rounds to keep your winnings. Lose your last heart and this run's winnings are lost.");
  if (process.env.REALMS_SHOTS) await page.screenshot({ path: `${process.env.REALMS_SHOTS}/dungeon-board.png` });
  await clickControl(page, "board:not-now");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "transitioning")), "back in the world");
  expect(await realm<string>(page, "space.id")).toBe("world");
  expect((await realm<{ name: string }[]>(page, "api")).some((c) => c.name === "enterDungeon")).toBe(false);

  // Enter: round 1, arrived at the arena's foot, its spell table by the way in.
  await enter(page, id);
  await waitSpace(page, /^run:/);
  const state = (await run(page))!;
  expect(state.floor).toBe(0);
  expect(state.floors).toBeGreaterThanOrEqual(dungeon(id).floors[0]);
  expect(state.round).toEqual({ beaten: 0, of: 3, need: 2, open: false });
  await until(page, async () => !(await player(page)).moving, "standing");
  await entity(page, (e) => e.kind === "spell-table", "the entrance's spell table");
  expect((await realm<{ name: string; body?: unknown }[]>(page, "api")).find((c) => c.name === "enterDungeon")?.body).toEqual({ Dungeon: id });
  expect((await realm<string[]>(page, "messages")).some((m) => /Round 1 of \d: beat 2 of the 3 challengers to open the gate/.test(m))).toBe(true);
  // Going in, no area of the travel map is crossed into (the keep's doorway lies past a tier's border): nothing said of one.
  expect((await realm<string[]>(page, "messages")).filter((m) => /: tier \d\.( |$)/.test(m))).toEqual([]);
  // Three challengers, each named and tiered under the pointer, standing still on their circles.
  const challengers = (await entities(page)).filter((e) => e.kind === "mob" && e.role === "encounter");
  expect(challengers).toHaveLength(3);
  await page.mouse.move(challengers[0]!.x, challengers[0]!.y);
  await until(page, async () => / - tier \d$/.test((await realm<string | null>(page, "tooltip")) ?? ""), "a challenger's name and tier");
  if (process.env.REALMS_SHOTS) await page.screenshot({ path: `${process.env.REALMS_SHOTS}/dungeon-round.png` });

  // The gate is shut before a win, and after one.
  await toGate(page);
  await until(page, async () => (await realm<string[]>(page, "messages")).some((m) => m === "Beat 2 of the 3 challengers to open the gate."), "told the gate is shut", 20);
  expect(await realm<string>(page, "screen")).toBe("world");
  await beatOne(page, "encounter");
  expect((await run(page))!.round).toMatchObject({ beaten: 1, open: false });
  await toGate(page);
  await until(page, async () => (await realm<string[]>(page, "messages")).filter((m) => m === "Beat 2 of the 3 challengers to open the gate.").length === 2, "told again", 20);
  expect((await realm<{ name: string }[]>(page, "api")).some((c) => c.name === "dungeonFloor")).toBe(false);

  // Two of three: the round is won and the gate opens.
  await winRound(page);
  expect((await run(page))!.round).toMatchObject({ beaten: 2, open: true });
  expect((await realm<string[]>(page, "messages")).some((m) => /^Round 1 won: the gate to .* stands open\./.test(m))).toBe(true);

  // At the open gate the panel asks; Stay keeps the round, and its last challenger still fights and pays.
  await toGate(page);
  await until(page, async () => (await realm<string>(page, "screen")) === "gate", "the gate's panel", 30);
  await expect(page.locator("[data-test='round-won']")).toContainText("Round 1 of");
  await expect(page.locator("[data-test='gate:descend']")).toContainText("Descend to");
  await expect(page.locator("[data-test='gate:leave']")).toContainText("Leave with your winnings");
  if (process.env.REALMS_SHOTS) await page.screenshot({ path: `${process.env.REALMS_SHOTS}/dungeon-gate.png` });
  await clickControl(page, "gate:stay");
  await until(page, async () => (await realm<string>(page, "screen")) === "world", "the panel closed");
  expect((await run(page))!.floor).toBe(0);
  const before = await gold(page);
  await beatOne(page, "encounter");
  expect((await run(page))!.round).toMatchObject({ beaten: 3, open: true });
  expect(await gold(page)).toBeGreaterThan(before);

  // Down through the gate to round 2.
  await toGate(page);
  await until(page, async () => (await realm<string>(page, "screen")) === "gate", "the gate's panel", 30);
  await clickControl(page, "gate:descend");
  await until(page, async () => (await run(page))?.floor === 1, "in round 2", 60);
  await waitSpace(page, /^run:/);
  expect((await realm<{ name: string; body?: unknown }[]>(page, "api")).find((c) => c.name === "dungeonFloor")?.body).toEqual({ Run: state.id, Floor: 1 });
  expect((await realm<string[]>(page, "messages")).some((m) => /^Round 2 of/.test(m) || /^The boss's hall/.test(m))).toBe(true);
});

test("a round won and the winnings taken: Leave at the open gate ends the run beside the entrance", async ({ page }) => {
  test.setTimeout(180_000);
  const id = "hurloon-caves";
  await openRealm(page, { at: id, extra: "&mobs=0" });
  await enter(page, id);
  await waitSpace(page, /^run:/);
  await winRound(page);
  await toGate(page);
  await until(page, async () => (await realm<string>(page, "screen")) === "gate", "the gate's panel", 30);
  await clickControl(page, "gate:leave");
  await waitSpace(page, "world");
  expect((await realm<{ name: string }[]>(page, "api")).some((c) => c.name === "leaveDungeon")).toBe(true);
  expect((await realm<string[]>(page, "messages")).some((m) => /with your winnings/.test(m))).toBe(true);
  expect(chebyshev((await player(page)).tile, { x: dungeon(id).entrance[0], z: dungeon(id).entrance[1] })).toBe(1);
});

test("the Phyrexian Portal stays sealed to a mage without all five colors", async ({ page }) => {
  await openRealm(page, { at: "phyrexian-portal", extra: "&mobs=0" });
  await toBoard(page, "phyrexian-portal");
  await until(page, async () => (await realm<string[]>(page, "messages")).some((m) => /sealed/.test(m)), "told it is sealed", 20);
  expect(await realm<string>(page, "screen")).toBe("world");
  expect(await realm<string>(page, "space.id")).toBe("world");
  expect((await realm<{ name: string }[]>(page, "api")).some((c) => c.name === "enterDungeon")).toBe(false);
});

test("a mage tower: a round, then its mage's hall; the mage beaten attunes it, then its waystone's travel to another attuned tower", async ({ page }) => {
  test.setTimeout(240_000);
  const tower = "benalia-1";
  const other = "orvada-1";
  await openRealm(page, { at: tower, extra: `&mobs=0&attuned=${other}` });
  // Dormant until its mage is beaten.
  const stone = await entity(page, (e) => e.kind === "waystone" && e.id === tower, "the tower's waystone");
  await page.mouse.move(stone.x, stone.y);
  await until(page, async () => /dormant/.test((await realm<string | null>(page, "tooltip")) ?? ""), "dormant");
  await toBoard(page, tower);
  await until(page, async () => (await realm<string>(page, "screen")) === "board", "the board", 30);
  await expect(page.locator("[data-test='board:waystone']")).toContainText("the tower's waystone");
  await clickControl(page, "board:enter");
  await waitSpace(page, /^run:/);
  await descend(page);
  // The mage's hall: the mage alone at its head.
  expect((await run(page))!.round).toBeNull();
  expect((await entities(page)).filter((e) => e.kind === "mob").map((e) => e.role)).toEqual(["boss"]);
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
