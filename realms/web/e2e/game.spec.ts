import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { clickClear } from "./realm";

// The game page (index.html) on the renderer's stage and a version-2 world, offline and on the manual clock: walking the
// slice's street into the shop and talking to its vendor (the card layer's stand-in answers), a mob of the large world
// chasing the player into a duel over the world, and two tabs seeing each other walk. The rest of the game's suites
// (world, travel, dungeons, screens) are on the hex world still, until integration retires it.

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.RENDER_SHOTS ? join(here, "screenshots", "render") : join(here, "..", "test-results", "render");
mkdirSync(out, { recursive: true });

interface Entity {
  readonly name: string;
  readonly kind: string;
  readonly id: string;
  readonly to?: string;
  readonly tile: { x: number; z: number };
  readonly moving?: boolean;
  readonly x: number;
  readonly y: number;
}

const realm = <T>(page: Page, read: string): Promise<T> =>
  page.evaluate((r) => r.split(".").reduce((o: any, k) => o?.[k], (globalThis as any).realmTest), read) as Promise<T>;
const advance = (page: Page, seconds: number) => page.evaluate((s) => (globalThis as any).realmTest.advance(s), seconds);
const entities = (page: Page) => realm<Entity[]>(page, "entities");

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?test&manual&offline&name=Tester&${query}`);
  await page.waitForFunction(() => (globalThis as any).realmTest?.ready === true, undefined, { timeout: 60_000 });
  return errors;
}

test("game: the street, into the shop, its vendor's wares, and back out", async ({ page }) => {
  const errors = await open(page, "world=slice&at=world:13,13&mobs=0&heading=front&zoom=0");
  expect(await realm<{ kind: string }>(page, "space")).toMatchObject({ kind: "world" });
  expect((await realm<{ name: string }>(page, "area"))?.name).toBe("New Benalia");
  await page.screenshot({ path: join(out, "game-street.png") });
  // The shop's door, clicked.
  const door = (await entities(page)).find((e) => e.kind === "door" && e.to === "shop")!;
  await page.mouse.click(door.x, door.y);
  await advance(page, 3.5);
  expect(await realm<{ id: string; kind: string }>(page, "space")).toMatchObject({ id: "shop", kind: "interior" });
  expect(await realm<string[]>(page, "api").then((calls: any) => calls.filter((c: any) => c.name === "position").at(-1)?.body)).toMatchObject({ Space: "shop", X: expect.any(Number), Z: expect.any(Number) });
  // Grizzlegom, behind his counter: walked up to and talked to.
  await clickClear(page, (e) => e.kind === "vendor" && e.name === "Grizzlegom", "Grizzlegom");
  await advance(page, 4);
  const requests = await realm<{ screen: string }[]>(page, "layer.requests");
  expect(requests.at(-1)?.screen).toBe("vendor");
  expect(await realm<string>(page, "screen")).toBe("vendor");
  await page.screenshot({ path: join(out, "game-vendor.png") });
  const close = (await realm<{ name: string; x: number; y: number }[]>(page, "controls")).find((c) => c.name.startsWith("layer:"))!;
  await page.mouse.click(close.x, close.y);
  await advance(page, 0.2);
  expect(await realm<string>(page, "screen")).toBe("world");
  // Out by the door.
  const leave = (await entities(page)).find((e) => e.kind === "leave")!;
  await page.mouse.click(leave.x, leave.y);
  await advance(page, 4);
  expect(await realm<{ kind: string }>(page, "space")).toMatchObject({ kind: "world" });
  const me = (await entities(page)).find((e) => e.kind === "player")!;
  expect(Math.max(Math.abs(me.tile.x - 13), Math.abs(me.tile.z - 10))).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("game: a goblin of the large world chases the player down and a duel opens over the world; won, it is gone", async ({ page }) => {
  const errors = await open(page, "world=large&at=world:94,132&wander=0&heading=front&zoom=0");
  const mobs = () => entities(page).then((es) => es.filter((e) => e.kind === "mob"));
  expect((await mobs()).length).toBeGreaterThan(0);
  // Walk toward the nearest; it comes the rest of the way.
  const goblin = (await mobs()).sort((a, b) => a.tile.x - b.tile.x).at(-1)!;
  await page.evaluate(([x, z]) => {
    const o = (globalThis as any).realmTest.game;
    o.stage.player.goTo(o.stage.reachableNear({ x: x + 3, z }, 3));
  }, [goblin.tile.x, goblin.tile.z] as const);
  for (let i = 0; i < 80 && (await realm<string>(page, "screen")) !== "duel"; i++) await advance(page, 0.1);
  expect(await realm<string>(page, "screen")).toBe("duel");
  expect((await realm<{ screen: string }[]>(page, "layer.requests")).at(-1)?.screen).toBe("duel");
  await page.screenshot({ path: join(out, "game-duel.png") });
  const win = (await realm<{ name: string; x: number; y: number }[]>(page, "controls")).find((c) => c.name === "layer:win")!;
  await page.mouse.click(win.x, win.y);
  // The gear found may follow: close it.
  for (let i = 0; i < 20 && (await realm<string>(page, "screen")) !== "world"; i++) {
    const c = (await realm<{ name: string; x: number; y: number }[]>(page, "controls")).find((b) => b.name.startsWith("layer:"));
    if (c) await page.mouse.click(c.x, c.y);
    await advance(page, 0.1);
  }
  expect(await realm<string>(page, "screen")).toBe("world");
  expect((await realm<string[]>(page, "messages")).some((m) => m.startsWith("You defeated"))).toBe(true);
  expect((await mobs()).some((m) => m.tile.x === goblin.tile.x && m.tile.z === goblin.tile.z && m.id === goblin.id)).toBe(false);
  expect(errors).toEqual([]);
});

test("game: two tabs see each other walk the street", async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  await open(a, "world=slice&at=world:10,13&mobs=0");
  await open(b, "world=slice&at=world:16,13&mobs=0");
  await advance(a, 0.2);
  await advance(b, 0.2);
  // A walks east; B sees another player walk to where A goes.
  const to = await a.evaluate(() => (globalThis as any).realmTest.screenOfTile(12, 14));
  await a.mouse.click(to.x, to.y);
  await advance(a, 1.5);
  let seen: Entity | undefined;
  for (let i = 0; i < 30 && !(seen = (await entities(b)).find((e) => e.kind === "other" && e.tile.x === 12 && e.tile.z === 14)); i++) await advance(b, 0.1);
  expect(seen, "A walking in B's street").toBeDefined();
  await context.close();
});
