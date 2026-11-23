import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { at, entity, mapData, openNear, openRealm, realm } from "./realm";

// A picture of each kind of place, for looking at (realms/web/e2e/screenshots/): a town, the hub, a village, the
// wilderness, a dungeon floor and a boss's hall, a travel encounter, the world map and character creation. Not
// compared against anything: the other tests check behaviour; these are for eyes.

const out = join(dirname(fileURLToPath(import.meta.url)), "screenshots");
mkdirSync(out, { recursive: true });

async function settle(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(800);
}

const places: readonly { file: string; at: string }[] = [
  { file: "town-new-argive", at: "new-argive:0,4" },
  { file: "town-urborg", at: "urborg" },
  { file: "village-yavimaya-hollow", at: "yavimaya-hollow" },
  { file: "wilderness-benalish-meadow", at: "benalish-meadow:0,0" },
  { file: "wilderness-smoldering-crater", at: "smoldering-crater" },
  { file: "wilderness-tolarian-shore", at: "tolarian-shore" },
  { file: "dungeon-shivan-foundry-1", at: "shivan-foundry-1" },
  { file: "encounter-llanowar", at: "encounter-llanowar" },
];

for (const place of places) {
  test(`screenshot: ${place.file}`, async ({ page }) => {
    await openRealm(page, { at: place.at });
    await settle(page);
    await page.screenshot({ path: join(out, `${place.file}.png`) });
  });
}

test("screenshot: a boss's hall", async ({ page }) => {
  const hall = mapData("serras-fallen-sanctum-4");
  const boss = hall.spawns.find((s) => s.id === "boss")!;
  await openRealm(page, { at: at(hall, openNear(hall, boss, 3)), extra: "&mobs=1" });
  await settle(page);
  await page.screenshot({ path: join(out, "dungeon-boss-hall.png") });
});

test("screenshot: the world map", async ({ page }) => {
  const meadow = mapData("benalish-meadow");
  const exit = meadow.exits.find((e) => e.to === "world")!;
  await openRealm(page, { at: at(meadow, openNear(meadow, exit, 1)), extra: "&mobs=0" });
  const way = await entity(page, (e) => e.kind === "exit" && e.to === "world", "the way to the world map");
  await page.mouse.click(way.x, way.y);
  await expect.poll(() => realm<string>(page, "screen")).toBe("travel");
  await expect.poll(async () => (await realm<{ name: string; id: string }[]>(page, "travel.places")).every((p) => p.name !== p.id)).toBe(true);
  const argive = (await realm<{ id: string; x: number; y: number }[]>(page, "travel.places")).find((p) => p.id === "new-argive")!;
  await page.mouse.move(argive.x, argive.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "world-map.png") });
});

test("screenshot: character creation", async ({ page }) => {
  await page.goto("/?offline&test");
  await expect.poll(() => realm<string>(page, "screen")).toBe("create");
  await page.locator("[data-test='create:name']").fill("Jhoira");
  await page.locator("[data-test='create:body:broad']").click();
  await page.locator("[data-test='create:color:G']").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "character-creation.png") });
});

test("screenshot: the map editor", async ({ page }) => {
  await page.goto("/?editor=keld");
  await page.waitForFunction(() => (globalThis as any).realmEditor !== undefined);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "map-editor.png") });
});
