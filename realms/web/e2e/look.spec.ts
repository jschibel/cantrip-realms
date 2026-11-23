import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { distance, findPath, hex, spiral } from "../src/hex";
import { encodeGif } from "./gif";
import { spawnNear } from "./places";
import { at, clickHex, entity, openNear, openRealm, openWorld, player, realm, waitSpace } from "./realm";

// The look (tech.md B5), for eyes: the same scenes every time - a town, the farmland, the Morass, a dungeon floor, the model
// gallery, character creation - and a clip of a character walking past mobs on grass, to judge how clearly they move.
// Written to test-results/look; with REALM_LOOK=<prefix> (before, after) to e2e/screenshots/look/<prefix>-*.png, so a
// change to the look can be shown beside what it changed. REALM_LOOK_QUERY is added to every page's query, to show one
// of the look's open choices (render.ts): "&bands=2", "&outline=ramp".

const here = dirname(fileURLToPath(import.meta.url));
const prefix = process.env.REALM_LOOK;
const choice = process.env.REALM_LOOK_QUERY ?? "";
const out = prefix ? join(here, "screenshots", "look") : join(here, "..", "test-results", "look");
const name = (file: string) => join(out, `${prefix ?? "look"}-${file}`);
mkdirSync(out, { recursive: true });

async function settle(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(800);
}

const scenes: readonly { file: string; at: () => string; extra?: string }[] = [
  { file: "new-benalia", at: () => "new-benalia" },
  { file: "benalish-farmland", at: () => at(openNear(spawnNear("capashen-hold"), 2)) },
  { file: "caligo-morass", at: () => "vess-estate" },
];

for (const scene of scenes) {
  test(`look: ${scene.file}`, async ({ page }) => {
    await openRealm(page, { at: scene.at(), extra: `${scene.extra ?? ""}${choice}` });
    await settle(page);
    await page.screenshot({ path: name(`${scene.file}.png`) });
  });
}

test("look: a dungeon floor", async ({ page }) => {
  await openRealm(page, { at: "ironclaw-delvings", extra: `&mobs=0${choice}` });
  const way = await entity(page, (e) => e.kind === "entrance" && e.to === "ironclaw-delvings", "the way in");
  await page.mouse.click(way.x, way.y);
  await waitSpace(page, /^run:/);
  await settle(page);
  await page.screenshot({ path: name("dungeon-foundry.png") });
});

test("look: the model gallery", async ({ page }) => {
  await page.goto(`/models.html?still${choice}`);
  await page.waitForFunction(() => (globalThis as any).galleryReady === true);
  await page.waitForTimeout(800);
  await page.screenshot({ path: name("models.png") });
});

test("look: character creation", async ({ page }) => {
  await page.goto(`/?offline&test${choice}`);
  await expect.poll(() => realm<string>(page, "screen")).toBe("create");
  await page.locator("[data-test='create:name']").fill("Jhoira");
  await page.locator("[data-test='create:body:broad']").click();
  await page.locator("[data-test='create:color:G']").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: name("character-creation.png") });
});

test("look: walking past mobs on grass", async ({ page }) => {
  // Past a spawn near Capashen Hold, a walk that passes near its mob, framed on the player.
  const s1 = spawnNear("capashen-hold");
  const home = hex(s1.q, s1.r);
  const free = (h: { q: number; r: number }) => openWorld(h) && !(h.q === s1.q && h.r === s1.r);
  const ring = spiral(home, 5).filter((h) => distance(h, home) === 5 && free(h) && findPath(h, home, (x) => free(x) || (x.q === home.q && x.r === home.r)) !== null);
  ring.sort((a, b) => a.q - b.q || a.r - b.r);
  const start = ring[0]!;
  const goal = ring.reduce((far, h) => (distance(h, start) > distance(far, start) && findPath(start, h, free) ? h : far), ring[0]!);
  expect(findPath(start, goal, free), "a walk past the spawn").not.toBeNull();

  await openRealm(page, { at: at(start), extra: choice });
  await settle(page);
  const view = page.viewportSize()!;
  // The camera follows the player's feet, which stay at the middle of the view.
  const clip = { x: view.width / 2 - 180, y: view.height / 2 - 190, width: 360, height: 270 };
  await clickHex(page, goal.q, goal.r);
  const shots: { png: Buffer; at: number }[] = [];
  const began = Date.now();
  while (Date.now() - began < 10000) {
    shots.push({ png: await page.screenshot({ clip }), at: Date.now() });
    if (shots.length > 4 && !(await player(page)).moving) break;
  }

  // Decoded on a canvas in the page, then written as a GIF and as a strip of eight frames.
  const decoded = await page.evaluate(async (pngs) => {
    const frames: string[] = [];
    let strip = "";
    const images = await Promise.all(
      pngs.map(
        (b64) =>
          new Promise<HTMLImageElement>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = `data:image/png;base64,${b64}`;
          }),
      ),
    );
    const w = images[0]!.width;
    const h = images[0]!.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d")!;
    for (const img of images) {
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, w, h).data;
      let s = "";
      for (let i = 0; i < data.length; i += 8192) s += String.fromCharCode(...data.subarray(i, i + 8192));
      frames.push(btoa(s));
    }
    const picks = 8;
    const stripCanvas = document.createElement("canvas");
    stripCanvas.width = w * 4;
    stripCanvas.height = h * 2;
    const sg = stripCanvas.getContext("2d")!;
    for (let i = 0; i < picks; i++) {
      const img = images[Math.floor((i * (images.length - 1)) / (picks - 1))]!;
      sg.drawImage(img, (i % 4) * w, Math.floor(i / 4) * h);
    }
    strip = stripCanvas.toDataURL("image/png").split(",")[1]!;
    return { w, h, frames, strip };
  }, shots.map((s) => s.png.toString("base64")));

  const frames = decoded.frames.map((b64, i) => ({
    rgba: new Uint8Array(Buffer.from(b64, "base64")),
    delay: Math.max(2, Math.round(((shots[i + 1]?.at ?? shots[i]!.at + 100) - shots[i]!.at) / 10)),
  }));
  writeFileSync(name("walking.gif"), encodeGif(decoded.w, decoded.h, frames));
  writeFileSync(name("walking-strip.png"), Buffer.from(decoded.strip, "base64"));
});
