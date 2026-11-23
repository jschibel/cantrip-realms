import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { hex } from "../src/hex";
import { doorOf, spawnNear } from "./places";
import { TRADERS_IN, at, clickControl, dungeon, entity, openNear, openRealm, realm, waitSpace, world } from "./realm";

// Pictures of the world, for eyes: each region of the Domains, the capital, a shop and the exotic wares shop inside,
// a caravan at its pitch, the regional and whole maps with their tier zones, and a floor of every dungeon theme. Not
// compared against anything - the other suites check behaviour. Written to test-results/screenshots/world, or to the
// committed e2e/screenshots/world when REALM_SCREENSHOTS is set.

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.REALM_SCREENSHOTS ? join(here, "screenshots", "world") : join(here, "..", "test-results", "screenshots", "world");
mkdirSync(out, { recursive: true });

async function settle(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(900);
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`) });

// Each region in its wilds: by a spawn point near its home, or (the neutral lands) at a dungeon of theirs.
const regions: readonly { file: string; at: () => string }[] = [
  { file: "region-benalia", at: () => at(openNear(spawnNear("capashen-hold"), 3)) },
  { file: "region-llanowar", at: () => at(openNear(spawnNear("llanowar"), 3)) },
  { file: "region-caligo-morass", at: () => at(openNear(spawnNear("vess-estate"), 3)) },
  { file: "region-keld", at: () => at(openNear(spawnNear("keld"), 3)) },
  { file: "region-orvada-walassa", at: () => at(openNear(spawnNear("tolarian-academy"), 3)) },
  { file: "region-hurloon-mountains", at: () => "hurloon-caves" },
  { file: "region-ironclaw-mountains", at: () => "ironclaw-delvings" },
  { file: "region-desolate-waste", at: () => "phyrexian-portal" },
];

for (const r of regions) {
  test(`screenshot: ${r.file}`, async ({ page }) => {
    await openRealm(page, { at: r.at() });
    await settle(page);
    await shot(page, r.file);
  });
}

for (const town of ["new-benalia", "capashen-hold", "llanowar", "vess-estate", "keld", "tolarian-academy"]) {
  test(`screenshot: town ${town}`, async ({ page }) => {
    await openRealm(page, { at: town, extra: "&mobs=0" });
    await settle(page);
    await shot(page, `town-${town}`);
  });
}

test("screenshot: a shop inside, and the exotic wares shop", async ({ page }) => {
  for (const [id, file] of [["argive-goblin-trader-shop", "interior-shop"], ["new-benalia-exotic-wares-shop", "interior-exotic-wares"], ["new-benalia-inn", "interior-inn"]] as const) {
    await openRealm(page, { at: id, extra: "&mobs=0" });
    await settle(page);
    await shot(page, file);
  }
  void doorOf;
});

test("screenshot: a traveling trader's caravan at the pitch", async ({ page }) => {
  const pitch = world().pitches.find((p) => p.town === "new-benalia")!;
  await openRealm(page, { at: at(openNear(hex(pitch.q, pitch.r), 2)), extra: "&mobs=0", now: TRADERS_IN });
  await entity(page, (e) => e.kind === "vendor" && e.hex === `${pitch.q},${pitch.r}`, "the trader");
  await settle(page);
  await shot(page, "caravan");
});

test("screenshot: the regional map and the whole map, with the tier zones", async ({ page }) => {
  await openRealm(page, { at: "cabal-crossing", extra: "&mobs=0" });
  await settle(page);
  await page.locator("#hud-place").screenshot({ path: join(out, "map-regional.png") });
  await clickControl(page, "hud:minimap");
  await expect.poll(async () => (await realm<{ open: boolean }>(page, "map")).open).toBe(true);
  await page.waitForTimeout(400);
  await shot(page, "map-world");
});

// A floor of each dungeon theme, entered as a player does.
const themes: readonly { id: string; color?: string }[] = [
  { id: "benalish-keep" },
  { id: "elfhame-hollow" },
  { id: "vess-crypts" },
  { id: "keldon-fortress" },
  { id: "academy-tower" },
  { id: "ironclaw-delvings" },
  { id: "phyrexian-portal", color: "WUBRG" },
];

for (const t of themes) {
  test(`screenshot: dungeon ${dungeon(t.id).theme} (${t.id})`, async ({ page }) => {
    await openRealm(page, { at: t.id, color: t.color, extra: "&mobs=0" });
    const way = await entity(page, (e) => e.kind === "entrance" && e.to === t.id, "the way in");
    await page.mouse.click(way.x, way.y);
    await waitSpace(page, /^run:/);
    await settle(page);
    await shot(page, `dungeon-${dungeon(t.id).theme}`);
  });
}
