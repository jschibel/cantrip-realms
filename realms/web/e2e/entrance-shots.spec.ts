import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import type { WorldData } from "../src/world/format";
import { advance, openRealm, realm, until } from "./realm";

// Pictures of every dungeon's entrance on the travel map (and the Hurloon passes, the Ironclaw road) at the three
// headings and zooms, the player two tiles before the entrance, and contact sheets of them (WORLD_SHOTS=<dir>; then
// again with `--grep sheets` for the sheets, sheet-<heading>-z<zoom>.png).

// Only when asked for (WORLD_SHOTS=<dir>): it is pictures to look at, not a check.
test.skip(!process.env.WORLD_SHOTS, "WORLD_SHOTS=<dir> takes the entrances' pictures");
const SHOTS = process.env.WORLD_SHOTS ?? "test-results/entrance-shots";
const world = JSON.parse(readFileSync(join(process.cwd(), "..", "content", "dominaria", "world", "world.json"), "utf8")) as WorldData;
const SPOTS: Record<string, readonly [number, number]> = Object.fromEntries([
  ...world.dungeons.map((d) => [`dungeon-${d.id}`, [d.x, d.z + 2]] as const),
  ["pass-minotaur-south", [164, 292]],
  ["pass-minotaur-north", [164, 266]],
  ["pass-dwarves-south", [190, 306]],
  ["pass-dwarves-north", [190, 281]],
  ["ironclaw-road", [262, 362]],
]);
// The game looks north and never turns (one heading).
const HEADINGS = ["front"];
const ZOOMS = [0, 1, 2];

for (const [name, [x, z]] of Object.entries(SPOTS)) {
  test(`${name}`, async ({ page }) => {
    for (const heading of HEADINGS) {
      for (const zoom of ZOOMS) {
        await openRealm(page, { at: `world:${x},${z}`, extra: `&mobs=0&nohud&still&zoom=${zoom}&heading=${heading}` });
        await until(page, async () => (await realm<boolean>(page, "streamed")) === true, "the map streamed", 60);
        await advance(page, 1);
        await page.screenshot({ path: `${SHOTS}/${name}-${heading}-z${zoom}.png` });
      }
    }
  });
}

test.describe.serial("sheets", () => {
  test.afterAll(async ({ browser }) => {
    // A contact sheet per heading and zoom: every spot's picture in a grid, named.
    const files = new Set(readdirSync(SHOTS));
    const names = Object.keys(SPOTS).filter((n) => files.has(`${n}-front-z1.png`));
    for (const heading of HEADINGS) {
      for (const zoom of ZOOMS) {
        const cells = names.map((n) => `<figure><img src="file:///${SHOTS.replace(/\\/g, "/")}/${n}-${heading}-z${zoom}.png"><figcaption>${n}</figcaption></figure>`).join("");
        const html = `<html><body style="margin:0;background:#111;color:#eee;font:12px sans-serif"><div style="display:grid;grid-template-columns:repeat(6,320px);gap:4px">${cells}</div></body></html>`;
        const file = join(SHOTS, `sheet-${heading}-z${zoom}.html`);
        writeFileSync(file, html.replace(/<figure>/g, '<figure style="margin:0">').replace(/<img /g, '<img style="width:320px;height:200px" '));
        const page = await browser.newPage({ viewport: { width: 6 * 324, height: 800 } });
        await page.goto(`file:///${file.replace(/\\/g, "/")}`);
        await page.screenshot({ path: join(SHOTS, `sheet-${heading}-z${zoom}.png`), fullPage: true });
        await page.close();
      }
    }
  });
  test("sheets made", () => {});
});
