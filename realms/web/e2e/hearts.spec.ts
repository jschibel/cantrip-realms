import { type Page, expect, test } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNear } from "./places";
import { at, clickClear, clickControl, clickEntity, entities, entity, openNear, openRealm, realm, until, waitReady, walkTo, winDuel, world } from "./realm";
import { enter, walkInside } from "./runs";

// Hearts (design.md A3, A3b), offline with the stand-in card layer: a lost duel costs a heart and pays nothing; a world
// mob offers its buyout or a rematch, the rematch sideboarded and dealt with the mob at the life it kept; a dungeon's mob
// is only fought again; the last heart lost is death, and home; a town fills the hearts and a temple's healer sells more.
// The stand-in's loss says the mob's life at the end as the real card layer reads it from the game (realmTest.duelEnd).

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "screenshots", "hearts");
const spawn = spawnNear("new-benalia");

interface Hearts {
  readonly hearts: number;
  readonly maxHearts: number;
  readonly gold: number;
  readonly defeat: { readonly Price: number | null; readonly MobLife: number; readonly MobFullLife: number } | null;
}
const me = (page: Page) => realm<Hearts>(page, "character");
const open = (page: Page) => realm<string | null>(page, "layer.open");
const duels = async (page: Page) => (await realm<{ screen: string; args: any }[]>(page, "layer.requests")).filter((r) => r.screen === "duel");

/** Stands by the spawn and engages its mob, until the duel opens. */
async function engage(page: Page): Promise<void> {
  await openRealm(page, { at: at(openNear(spawn, 4)) });
  let clicked = false;
  await until(
    page,
    async () => {
      if ((await open(page)) === "duel") return true;
      const mob = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === spawn.id);
      if (mob && !clicked) {
        await clickClear(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
        clicked = true;
      }
      return false;
    },
    "the duel opens",
    30,
  );
}

/** Loses the open duel with the mob ending at `mobLife` (null: untouched), and waits for what the loss comes to. */
async function lose(page: Page, mobLife: number | null, then: "defeat" | "death"): Promise<void> {
  await until(page, async () => (await open(page)) === "duel", "a duel", 20);
  await page.evaluate((life) => (globalThis as any).realmTest.duelEnd(life), mobLife);
  await clickControl(page, "layer:lose");
  await until(page, async () => (await page.locator(`[data-test='${then}']`).count()) > 0, `the ${then} screen`, 30);
}

test("a lost duel costs a heart and pays nothing; the mob's buyout, paid, lets you go and it is dealt with", async ({ page }) => {
  await engage(page);
  const gold = (await me(page)).gold;
  await lose(page, 5, "defeat");

  // The dialog: the mob's line, the hearts left, its offer measured by the life it kept.
  const c = await me(page);
  expect(c.hearts).toBe(1);
  const full = c.defeat!.MobFullLife;
  expect(c.defeat!.MobLife).toBe(5);
  const price = c.defeat!.Price!;
  expect(price).toBe(Math.max(1, Math.round(30 * Math.min(1, 5 / full))));
  await expect(page.locator("[data-test='defeat:line']")).not.toBeEmpty();
  await expect(page.locator("[data-test='defeat:hearts']")).toHaveAttribute("data-hearts", "1");
  await expect(page.locator("[data-test='defeat:offer']")).toContainText(`${price} gold`);
  await expect(page.locator("[data-test='hud:hearts']")).toHaveAttribute("data-hearts", "1");
  await page.screenshot({ path: join(SHOTS, "defeat-world.png") });

  await clickControl(page, "defeat:pay");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "back in the world");
  expect(await me(page)).toMatchObject({ hearts: 1, gold: gold - price, defeat: null });
  expect((await realm<{ name: string }[]>(page, "api")).map((x) => x.name)).toContain("payEncounter");
  expect((await entities(page)).some((e) => e.kind === "mob" && e.spawn === spawn.id)).toBe(false);
  expect((await realm<string[]>(page, "messages")).some((m) => /and it lets you go/.test(m))).toBe(true);
});

test("fighting again: sideboarding, play or draw, and the next game's mob at the life it kept", async ({ page }) => {
  await engage(page);
  const first = (await duels(page))[0]!;
  expect((await me(page)).hearts).toBe(2);
  await lose(page, 7, "defeat");
  await clickControl(page, "defeat:fight");

  // The sideboard screen, opened on the last game's deck and sideboard; the loser chooses to draw.
  await until(page, async () => (await open(page)) === "sideboard", "the sideboard", 20);
  const side = (await realm<{ screen: string; args: any }[]>(page, "layer.requests")).at(-1)!;
  expect(side.args.main.reduce((n: number, c: { Count: number }) => n + c.Count, 0)).toBe(40);
  expect(side.args.sideboard.length).toBeGreaterThan(0);
  expect(side.args.game).toBe(2);
  await clickControl(page, "layer:draw first");

  // The second game: the player at their full starting life, the mob at the 7 it ended with, the mob playing first.
  await until(page, async () => (await duels(page)).length === 2 && (await open(page)) === "duel", "the second game", 20);
  const second = (await duels(page))[1]!;
  expect(second.args.duel).toMatchObject({ Game: 2, FirstPlayer: 2 });
  expect(second.args.duel.Seats[1].StartingLife).toBe(7);
  expect(second.args.duel.Seats[0].StartingLife).toBe(first.args.duel.Seats[0].StartingLife);
  expect(second.args.hearts).toEqual({ have: 1, hold: 2 });
  expect((await realm<{ name: string; body?: any }[]>(page, "api")).find((x) => x.name === "rematch")?.body).toMatchObject({ PlayFirst: false });

  // Won, the encounter is over: its gold, the mob gone.
  await winDuel(page);
  expect((await realm<string[]>(page, "messages")).some((m) => /You defeated/.test(m))).toBe(true);
  expect((await entities(page)).some((e) => e.kind === "mob" && e.spawn === spawn.id)).toBe(false);
});

test("the last heart lost: death, and the character wakes at home with their hearts full", async ({ page }) => {
  await engage(page);
  await lose(page, null, "defeat");
  await clickControl(page, "defeat:fight");
  await until(page, async () => (await open(page)) === "sideboard", "the sideboard", 20);
  await clickControl(page, "layer:play first");
  await lose(page, 2, "death");
  await expect(page.locator("[data-test='death']")).toContainText("You wake at home");
  await page.screenshot({ path: join(SHOTS, "death.png") });

  await clickControl(page, "death:rise");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "awake in the world", 30);
  await waitReady(page);
  expect(await me(page)).toMatchObject({ hearts: 2, maxHearts: 2, defeat: null });
  const capital = world().towns.find((t) => t.kind === "capital")!;
  expect(await realm<{ name: string }>(page, "area")).toMatchObject({ name: capital.name });
  expect((await realm<string[]>(page, "messages")).some((m) => /You wake at the inn in New Benalia, your hearts restored/.test(m))).toBe(true);
  await expect(page.locator("[data-test='hud:hearts']")).toHaveAttribute("data-hearts", "2");
});

test("a town fills the hearts: walking in through its gate", async ({ page }) => {
  await engage(page);
  await lose(page, 10, "defeat");
  await clickControl(page, "defeat:pay");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "back in the world");
  expect((await me(page)).hearts).toBe(1);
  await page.screenshot({ path: join(SHOTS, "hud-hearts.png") });

  const capital = world().towns.find((t) => t.kind === "capital")!;
  const inn = world().inns.find((i) => i.town === capital.id)!;
  await walkTo(page, { x: inn.x, z: inn.z }, 4);
  await until(page, async () => (await me(page)).hearts === 2, "the hearts filled", 30);
  expect((await realm<string[]>(page, "messages")).some((m) => /your hearts are restored: 2 of 2/.test(m))).toBe(true);
  await expect(page.locator("[data-test='hud:hearts']")).toHaveAttribute("data-hearts", "2");
});

test("a temple's healer sells a heart, which fills as it is bought", async ({ page }) => {
  await openRealm(page, { at: "new-benalia-temple", extra: "&mobs=0" });
  expect(await realm<string>(page, "space.id")).toBe("new-benalia-temple");
  await clickEntity(page, (e) => e.kind === "healer", "the priest");
  await until(page, async () => (await realm<string>(page, "screen")) === "dialog", "the priest's word", 20);
  await page.screenshot({ path: join(SHOTS, "healer.png") });
  await clickControl(page, "dialog:buy a heart (1,000 gold)");
  await until(page, async () => (await me(page)).maxHearts === 3, "a third heart", 20);
  expect(await me(page)).toMatchObject({ hearts: 3, maxHearts: 3, gold: 1000 });
  await expect(page.locator("[data-test='hud:hearts']")).toHaveAttribute("data-max", "3");
  expect((await realm<string[]>(page, "messages")).some((m) => /you hold 3 hearts now/.test(m))).toBe(true);
});

test("in a dungeon the mob can't be bought off: only fought again", async ({ page }) => {
  test.setTimeout(180_000);
  const id = "benalish-keep";
  await openRealm(page, { at: id, extra: "&mobs=0" });
  await enter(page, id);
  await until(page, async () => /^run:/.test((await realm<string>(page, "space.id")) ?? ""), "in the run", 20);
  const mob = await entity(page, (e) => e.kind === "mob" && e.role === "encounter", "an encounter");
  await walkInside(page, mob.tile, 2);
  if ((await open(page)) === null) await clickEntity(page, (e) => e.kind === "mob" && e.spawn === mob.spawn, "the encounter");
  await lose(page, 3, "defeat");

  await expect(page.locator("[data-test='defeat']")).toHaveAttribute("data-dungeon", "true");
  await expect(page.locator("[data-test='defeat:offer']")).toContainText("no buying your way out");
  expect(await page.locator("[data-test='defeat:pay']").count()).toBe(0);
  expect((await me(page)).defeat?.Price).toBeNull();
  await page.screenshot({ path: join(SHOTS, "defeat-dungeon.png") });

  await clickControl(page, "defeat:fight");
  await until(page, async () => (await open(page)) === "sideboard", "the sideboard", 20);
  await clickControl(page, "layer:play first");
  await until(page, async () => (await duels(page)).length === 2 && (await open(page)) === "duel", "the second game", 20);
  expect((await duels(page))[1]!.args.duel.Seats[1].StartingLife).toBe(3);
  await winDuel(page);
  expect(await realm<string>(page, "space.id")).toMatch(/^run:/);
});
