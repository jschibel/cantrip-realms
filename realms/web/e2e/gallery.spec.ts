import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";

// The art gallery (gallery.html, dev only): every board - the surfaces and where biomes meet, the props by kind, each
// region's building style - loads and draws without an error. With ART_SHOTS=1 it also writes the pictures for review
// to e2e/screenshots/art: each board at the three headings one zoom step out (where most boards are seen whole) and at
// the closest step from the front; the building styles row by row from the front and whole at the farthest step at all
// three headings; the trees at the farthest step too, in their far stand-ins; otherwise to test-results/art.

const here = dirname(fileURLToPath(import.meta.url));
const shots = !!process.env.ART_SHOTS;
const out = shots ? join(here, "screenshots", "art") : join(here, "..", "test-results", "art");
mkdirSync(out, { recursive: true });

/** Opens a board on the manual clock (the gallery stands still until a test advances it). */
async function open(page: Page, board: string, heading: string, zoom: number, focus?: readonly [number, number]): Promise<void> {
  await page.goto(`/gallery.html?test&manual&board=${board}&heading=${heading}&zoom=${zoom}${focus ? `&focus=${focus[0]},${focus[1]}` : ""}`);
  await page.waitForFunction(() => (globalThis as any).galleryTest?.ready === true, undefined, { timeout: 45_000 });
  await page.evaluate(() => (globalThis as any).galleryTest.advance(0.5));
}

/** How many colors the scene shows: a board that drew shows dozens (a blank or broken one a handful). */
async function colorCount(page: Page): Promise<number> {
  const f = await page.evaluate(() => (globalThis as any).galleryTest.frame() as { rgba: string });
  const rgba = Buffer.from(f.rgba, "base64");
  const seen = new Set<number>();
  for (let i = 0; i < rgba.length; i += 4) seen.add((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
  return seen.size;
}

/** The boards, as the page lists them (the registries decide them, so they are read from the page). */
async function boardIds(page: Page): Promise<string[]> {
  await page.goto("/gallery.html?test&manual");
  await page.waitForFunction(() => (globalThis as any).galleryTest?.ready === true, undefined, { timeout: 45_000 });
  return page.evaluate(() => (globalThis as any).galleryTest.boards as string[]);
}

// The boards are fixed by the registries; listed here so each is its own test (and runs in parallel).
const BOARDS = [
  "surfaces-green",
  "surfaces-forest-swamp",
  "surfaces-cold-stone",
  "surfaces-coast-fire",
  "surfaces-waste",
  "surfaces-roads",
  "surfaces-waters",
  "meet-coast",
  "meet-cold",
  "meet-swamp",
  "meet-fire",
  "meet-farm",
  "meet-forest",
  "props-trees",
  "props-plants",
  "props-stone",
  "props-country",
  "props-road",
  "props-goods",
  "props-water",
  "props-phyrexian",
  "props-entrances",
  "style-benalish",
  "style-llanowar",
  "style-morass",
  "style-keldon",
  "style-tolarian",
  "style-vess",
  "style-village",
  "style-phyrexian",
];

test("gallery: its boards are the ones this suite walks", async ({ page }) => {
  expect((await boardIds(page)).sort()).toEqual([...BOARDS].sort());
});

for (const board of BOARDS) {
  test(`gallery: ${board} draws at every heading`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // A style's street is seen whole at the far step, so its turned headings are pictured there (and its rows up close
    // from the front); every other board at the three headings one step out.
    const style = board.startsWith("style-");
    const views: [string, number][] = style
      ? [
          ["front", 1],
          ["left", 2],
          ["right", 2],
          ["front", 0],
          ["front", 2],
        ]
      : [
          ["front", 1],
          ["left", 1],
          ["right", 1],
          ["front", 0],
          ...(board === "props-trees" || board === "props-plants" ? ([["front", 2]] as [string, number][]) : []),
        ];
    await open(page, board, "front", 1);
    const places = (await page.evaluate(() => (globalThis as any).galleryTest.views)) as [number, number][];
    for (const [heading, zoom] of shots ? views : views.slice(0, 3)) {
      // A style's board is a picture per row of buildings one step out; the rest one picture a view.
      const where: ([number, number] | undefined)[] = zoom === 1 && places.length > 1 ? places : [undefined];
      for (const [k, focus] of where.entries()) {
        await open(page, board, heading, zoom, focus);
        expect(await page.evaluate(() => (globalThis as any).galleryTest.heading)).toBe(heading);
        expect(await colorCount(page), `${board} ${heading} zoom ${zoom}: painted`).toBeGreaterThan(30);
        if (shots) await page.screenshot({ path: join(out, `${board}-${heading}-z${zoom}${where.length > 1 ? `-row${k + 1}` : ""}.png`) });
      }
    }
    expect(errors).toEqual([]);
  });
}
