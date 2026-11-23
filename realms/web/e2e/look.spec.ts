import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { spawnNear } from "./places";
import { advance, at, openNear, openRealm, realm, waitSpace } from "./realm";
import { enter } from "./runs";

// The look (tech.md B5), for eyes: the same scenes every time - a town, the farmland, the Morass, a dungeon floor,
// character creation - to show a change to the look beside what it changed. Written to test-results/look; with
// REALM_LOOK=<prefix> (before, after) to e2e/screenshots/look/<prefix>-*.png. REALM_LOOK_QUERY is added to every page's
// query (the renderer's options: "&outline=0"). The whole tour of the Domains is tour.spec.ts.

const here = dirname(fileURLToPath(import.meta.url));
const prefix = process.env.REALM_LOOK;
const choice = process.env.REALM_LOOK_QUERY ?? "";
const out = prefix ? join(here, "screenshots", "look") : join(here, "..", "test-results", "look");
const name = (file: string) => join(out, `${prefix ?? "look"}-${file}`);
mkdirSync(out, { recursive: true });

async function settle(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await advance(page, 2);
}

const scenes: readonly { file: string; at: () => string; extra?: string }[] = [
  { file: "new-benalia", at: () => "new-benalia" },
  { file: "benalish-farmland", at: () => at(openNear(spawnNear("capashen-hold"), 2)) },
  { file: "caligo-morass", at: () => "vess-estate" },
];

for (const scene of scenes) {
  test(`look: ${scene.file}`, async ({ page }) => {
    await openRealm(page, { at: scene.at(), extra: `&heading=front&zoom=0${scene.extra ?? ""}${choice}` });
    await settle(page);
    await page.screenshot({ path: name(`${scene.file}.png`) });
  });
}

test("look: a dungeon floor", async ({ page }) => {
  await openRealm(page, { at: "ironclaw-delvings", extra: `&mobs=0${choice}` });
  await enter(page, "ironclaw-delvings");
  await waitSpace(page, /^run:/, 30);
  await settle(page);
  await page.screenshot({ path: name("dungeon-foundry.png") });
});

test("look: character creation", async ({ page }) => {
  await page.goto(`/?offline&test${choice}`);
  await expect.poll(() => realm<string>(page, "screen")).toBe("create");
  await page.locator("[data-test='create:name']").fill("Jhoira");
  await page.locator("[data-test='create:body:broad']").click();
  await page.locator("[data-test='create:color:G']").click();
  // The preview turns on the page's own frames: let a few draw.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: name("character-creation.png") });
});
