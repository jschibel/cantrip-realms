import { type Page, expect, test } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNear } from "./places";
import { at, chebyshev, clickClear, clickControl, clickEntity, enterTown, entities, entity, groundsHere, openNear, openRealm, playerTile, realm, until, waitReady, walkTo, winDuel, world } from "./realm";
import { descend, engageInside, enter, run, toShrine, walkInside } from "./runs";

// Hearts (design.md A3, A3b), offline with the stand-in card layer: a lost duel costs a heart and pays nothing; a world
// mob offers its buyout or a rematch, the rematch sideboarded and dealt with the mob at the life it kept; a dungeon's mob
// is only fought again; the last heart lost is death, and home; a town fills the hearts and a temple's healer sells more.
// A heartbloom of the wilds gives one back, picked walking onto it, and is gone; a dungeon run's shrine once in the run;
// neither is used up by a character whose hearts are full.
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
  // At the inn's door, in the capital's grounds (from the travel map, where the duel was).
  const inn = world().inns.find((i) => i.town === capital.id)!;
  expect(await groundsHere(page)).toBe(capital.id);
  expect(chebyshev(await playerTile(page), { x: inn.x, z: inn.z })).toBeLessThanOrEqual(1);
  expect(await realm<boolean>(page, "transitioning")).toBe(false);
  expect((await realm<string[]>(page, "messages")).some((m) => /You wake at the inn in New Benalia, your hearts restored/.test(m))).toBe(true);
  await expect(page.locator("[data-test='hud:hearts']")).toHaveAttribute("data-hearts", "2");
});

test("a town fills the hearts: walking into its grounds from its icon on the travel map", async ({ page }) => {
  await engage(page);
  await lose(page, 10, "defeat");
  await clickControl(page, "defeat:pay");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "back in the world");
  expect((await me(page)).hearts).toBe(1);
  await page.screenshot({ path: join(SHOTS, "hud-hearts.png") });

  // To the capital's icon (the way nearest), and in: the hearts filled there, before the player stands in the grounds.
  const capital = world().towns.find((t) => t.kind === "capital")!;
  const here = await playerTile(page);
  const way = [...capital.ways!].sort((a, b) => chebyshev(here, { x: a.outside[0], z: a.outside[1] }) - chebyshev(here, { x: b.outside[0], z: b.outside[1] }))[0]!;
  await walkTo(page, { x: way.outside[0], z: way.outside[1] }, 3);
  expect((await me(page)).hearts, "the travel map fills no hearts").toBe(1);
  await enterTown(page, capital.id);
  await until(page, async () => (await me(page)).hearts === 2, "the hearts filled", 30);
  expect((await realm<string[]>(page, "messages")).some((m) => m === `Safe within ${capital.name}, your hearts are restored: 2 of 2.`)).toBe(true);
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

const messaged = async (page: Page, pattern: RegExp) => (await realm<string[]>(page, "messages")).some((m) => pattern.test(m));

test("a heartbloom of the wilds gives back a heart, picked walking onto it, and is left standing while the hearts are full", async ({ page }) => {
  test.setTimeout(120_000);
  // A heartbloom stood in the wilds by the capital (the server's POST /dev/find): finds come and go, none kept in the world.
  const tile = openNear(spawn, 6);
  await openRealm(page, { at: at(openNear(tile, 3)), extra: "&mobs=0" });
  const bloom = await page.evaluate(([x, z]) => (globalThis as any).realmTest.placeFind("heartbloom", x, z), [tile.x, tile.z] as const);
  const isBloom = (e: { kind: string; id: string }) => e.kind === "heartbloom" && e.id === bloom.Id;
  await entity(page, isBloom, "the heartbloom", 30);
  await page.screenshot({ path: join(SHOTS, "heartbloom.png") });

  // The hearts full: walked onto, it keeps.
  await clickEntity(page, isBloom, "the heartbloom");
  await until(page, () => messaged(page, /Your hearts are full\. The heartbloom will keep/), "the hearts full", 30);
  expect(await playerTile(page)).toEqual(tile);
  expect((await realm<{ id: string }[]>(page, "finds")).map((f) => f.id)).toEqual([bloom.Id]);
  expect((await me(page)).hearts).toBe(2);

  // A heart missing (arranged): picked, the heart back, the bloom gone.
  await page.evaluate(() => (globalThis as any).realmTest.setHearts(1));
  await expect(page.locator("[data-test='hud:hearts']")).toHaveAttribute("data-hearts", "1");
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [tile.x, tile.z] as const);
  await until(page, async () => (await me(page)).hearts === 2, "a heart given back", 30);
  expect(await messaged(page, /You pick the heartbloom, and its warmth fills you: 2 of 2 hearts/)).toBe(true);
  await expect(page.locator("[data-test='hud:hearts']")).toHaveAttribute("data-hearts", "2");
  expect(await realm<unknown[]>(page, "finds")).toEqual([]);
  expect((await entities(page)).some(isBloom)).toBe(false);
  expect((await realm<{ name: string; body?: any }[]>(page, "api")).filter((c) => c.name === "openChest").map((c) => c.body.Chest)).toEqual([bloom.Id, bloom.Id]);
  await walkTo(page, openNear(tile, 2), 0);
  await page.screenshot({ path: join(SHOTS, "heartbloom-picked.png") });

  // Picked, nothing is there: walking back onto its tile gives nothing.
  await page.evaluate(() => (globalThis as any).realmTest.setHearts(1));
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [tile.x, tile.z] as const);
  await until(page, async () => chebyshev(await playerTile(page), tile) === 0 && !(await entity(page, (e) => e.kind === "player", "the player")).moving, "on its tile again", 30);
  expect((await me(page)).hearts).toBe(1);
});

test("a treasure chest of the wilds is opened walking onto it, its gold the character's, and it is gone", async ({ page }) => {
  const tile = openNear(spawn, 6);
  await openRealm(page, { at: at(openNear(tile, 3)), extra: "&mobs=0" });
  const gold = (await me(page)).gold;
  const chest = await page.evaluate(([x, z]) => (globalThis as any).realmTest.placeFind("chest", x, z), [tile.x, tile.z] as const);
  const isChest = (e: { kind: string; id: string }) => e.kind === "chest" && e.id === chest.Id;
  await entity(page, isChest, "the chest", 30);
  await page.screenshot({ path: join(SHOTS, "chest.png") });
  await clickEntity(page, isChest, "the chest");
  await until(page, () => messaged(page, /You open the chest: [\d,]+ gold/), "the chest opened", 30);
  expect((await me(page)).gold).toBeGreaterThan(gold);
  expect(await realm<unknown[]>(page, "finds")).toEqual([]);
  expect((await entities(page)).some(isChest)).toBe(false);
});

test("a dungeon run's shrine gives back a heart once in the run, prayed at from beside it", async ({ page }) => {
  test.setTimeout(180_000);
  // A mage tower (a round, then the mage's hall), its run made to hold a shrine (as the server's POST /dev/drop {Shrine}
  // does), walked down to the floor that holds it.
  const id = "benalia-1";
  await openRealm(page, { at: id, extra: "&mobs=0" });
  await page.evaluate(() => (globalThis as any).realmTest.forceShrine(true));
  await enter(page, id);
  await until(page, async () => /^run:/.test((await realm<string>(page, "space.id")) ?? ""), "in the run", 20);
  const held = (await run(page))!.shrineFloor!;
  expect(held).not.toBeNull();
  for (let floor = 0; floor < held; floor++) await descend(page);
  const r = (await run(page))!;
  expect(r).toMatchObject({ floor: held, shrineUsed: false });
  const shrine = await entity(page, (e) => e.kind === "heart-shrine", "the shrine");
  expect(shrine.tile).toEqual(r.shrine);

  // The hearts full: the blessing keeps.
  await walkInside(page, r.shrine!, 1);
  await page.screenshot({ path: join(SHOTS, "shrine.png") });
  await toShrine(page);
  await clickControl(page, "dialog:pray");
  await until(page, () => messaged(page, /Your hearts are full\. The shrine's blessing will keep/), "the hearts full", 20);

  // A heart missing: prayed at, the heart back, the heart over the stone cold.
  await page.evaluate(() => (globalThis as any).realmTest.setHearts(1));
  await toShrine(page);
  await expect(page.locator(".dialog")).toContainText("A forgotten shrine of Serra");
  await page.screenshot({ path: join(SHOTS, "shrine-prayer.png") });
  await clickControl(page, "dialog:pray");
  await until(page, async () => (await me(page)).hearts === 2, "a heart given back", 20);
  expect(await messaged(page, /Serra's blessing: a heart comes back to you, 2 of 2/)).toBe(true);
  await expect(page.locator("[data-test='hud:hearts']")).toHaveAttribute("data-hearts", "2");
  expect(await run(page)).toMatchObject({ shrineUsed: true });
  expect((await realm<{ name: string }[]>(page, "api")).filter((c) => c.name === "prayAtShrine")).toHaveLength(2);
  await page.screenshot({ path: join(SHOTS, "shrine-spent.png") });

  // Once in the run: its heart gone cold.
  await page.evaluate(() => (globalThis as any).realmTest.setHearts(1));
  await toShrine(page);
  await expect(page.locator(".dialog")).toContainText("gone cold");
  await clickControl(page, "dialog:leave");
  expect((await me(page)).hearts).toBe(1);
});

test("in a dungeon the mob can't be bought off: only fought again", async ({ page }) => {
  test.setTimeout(180_000);
  const id = "benalish-keep";
  await openRealm(page, { at: id, extra: "&mobs=0" });
  await enter(page, id);
  await until(page, async () => /^run:/.test((await realm<string>(page, "space.id")) ?? ""), "in the run", 20);
  // A challenger engaged with a click and its duel lost: one encounter started, none finished before the loss.
  const mob = await engageInside(page, "encounter");
  const started = (await realm<{ name: string; body?: { Floor?: number; Index?: number; Mob?: string } }[]>(page, "api")).filter((c) => c.name === "startEncounter");
  expect(started.map((c) => `${c.body?.Floor}:${c.body?.Index} ${c.body?.Mob}`)).toEqual([`${mob.spawn} ${mob.id}`]);
  expect((await realm<{ name: string }[]>(page, "api")).some((c) => c.name === "finishEncounter")).toBe(false);
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
