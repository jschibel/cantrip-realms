import { expect, test } from "@playwright/test";
import { NOW, clickControl, clickHex, entity, mapData, openRealm, player, realm, waitMap, walkNear } from "./realm";

test("character creation: a name, a body, a palette and a color, and you begin in that color's home town", async ({ page }) => {
  await page.goto(`/?offline&test&now=${NOW}&wander=0&encounters=never`);
  await expect.poll(() => realm<string>(page, "screen")).toBe("create");
  await clickControl(page, "create:create");
  await expect(page.locator("[data-problem]")).toHaveText(/at least two letters/);
  await clickControl(page, "create:name");
  await page.keyboard.type("Jhoira");
  await clickControl(page, "create:body:tall");
  await clickControl(page, "create:palette:3");
  await clickControl(page, "create:color:U");
  await clickControl(page, "create:create");
  await waitMap(page, "tolarian-academy");
  expect(await realm<string>(page, "character.name")).toBe("Jhoira");
  expect(await realm<string[]>(page, "character.identity")).toEqual(["U"]);
  const made = (await realm<{ name: string; body?: Record<string, unknown> }[]>(page, "api")).find((c) => c.name === "createCharacter");
  expect(made?.body).toEqual({ Name: "Jhoira", Body: "tall", Palette: 3, Color: "U" });
});

test("other players on the same map walk where the relay says, in their looks", async ({ browser }) => {
  // Two tabs of one browser: offline, presence goes between them as the server's relay would.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const alice = await context.newPage();
  const bob = await context.newPage();
  await openRealm(alice, { at: "benalish-meadow:0,0", name: "Alice", extra: "&mobs=0" });
  await openRealm(bob, { at: "benalish-meadow:1,0", name: "Bob", color: "R", extra: "&mobs=0" });
  const seen = await entity(bob, (e) => e.kind === "other" && e.name === "Alice", "Alice, seen from Bob's tab");
  expect(seen.hex).toBe("0,0");
  await entity(alice, (e) => e.kind === "other" && e.name === "Bob", "Bob, seen from Alice's tab");

  await clickHex(alice, 3, -3);
  await expect.poll(async () => (await player(alice)).hex).toBe("3,-3");
  await expect.poll(async () => (await entity(bob, (e) => e.kind === "other" && e.name === "Alice", "Alice")).hex).toBe("3,-3");

  // Leaving the map takes you off the others' screens.
  await alice.goto("about:blank");
  await expect.poll(async () => (await realm<{ kind: string }[]>(bob, "entities")).some((e) => e.kind === "other")).toBe(false);
  await context.close();
});

test("the map editor paints terrain and lints as it goes", async ({ page }) => {
  await page.goto("/?editor=benalish-meadow");
  await page.waitForFunction(() => (globalThis as any).realmEditor !== undefined);
  expect(await page.evaluate(() => (globalThis as any).realmEditor.tile(2, -2)[3])).toBe("dirt");
  await page.locator("[data-test='editor:terrain']").selectOption("cobble");
  await page.locator("[data-test='editor:tool:terrain']").click();
  const at = await page.evaluate(() => (globalThis as any).realmEditor.screenOfHex(2, -2));
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => (globalThis as any).realmEditor.tile(2, -2)[3])).toBe("cobble");
  await expect(page.locator("[data-test='editor:problems']")).toHaveText("No problems.");
  const download = page.waitForEvent("download");
  await page.locator("[data-test='editor:save']").click();
  expect((await download).suggestedFilename()).toBe("benalish-meadow.json");
});

test("dungeon floors join up by their stairs", async ({ page }) => {
  const floor = mapData("tomb-of-yawgmoth-1");
  const stairs = floor.exits.find((e) => e.to === "tomb-of-yawgmoth-2")!;
  await openRealm(page, { at: "tomb-of-yawgmoth-1", extra: "&mobs=0" });
  await walkNear(page, floor, stairs);
  const down = await entity(page, (e) => e.kind === "exit" && e.to === "tomb-of-yawgmoth-2", "the stairs down");
  await page.mouse.click(down.x, down.y);
  await waitMap(page, "tomb-of-yawgmoth-2");
  const up = mapData("tomb-of-yawgmoth-2").exits.find((e) => e.to === "tomb-of-yawgmoth-1")!;
  const [q, r] = (await player(page)).hex.split(",").map(Number);
  expect(Math.max(Math.abs(q! - up.q), Math.abs(r! - up.r), Math.abs(q! + r! - up.q - up.r))).toBe(1);
});
