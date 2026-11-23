import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { type GifFrame, encodeGif } from "./gif";

// The cast (cast.html, dev only): every body, palette, gear part, creature, boss, mage and townsperson the figures make,
// in the game's own camera. Each page of each set loads and draws without an error; with FIGURE_SHOTS=1 the pictures
// for judging them - every page from the front, the bodies, creatures and bosses from every heading, the bodies at
// every zoom step, casting and reaching out, and walking clips - go to e2e/screenshots/figures (else test-results).

const here = dirname(fileURLToPath(import.meta.url));
const shots = !!process.env.FIGURE_SHOTS;
const out = shots ? join(here, "screenshots", "figures") : join(here, "..", "test-results", "figures");
mkdirSync(out, { recursive: true });

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

async function open(page: Page, query: string): Promise<{ pages: number; count: number }> {
  await page.goto(`/cast.html?test&manual&${query}`);
  await page.waitForFunction(() => (globalThis as any).castTest?.ready === true, undefined, { timeout: 30_000 });
  return page.evaluate(() => ({ pages: (globalThis as any).castTest.pages as number, count: (globalThis as any).castTest.count as number }));
}

const advance = (page: Page, seconds: number) => page.evaluate((s) => (globalThis as any).castTest.advance(s), seconds);

async function readFrame(page: Page): Promise<Frame> {
  const f = await page.evaluate(() => (globalThis as any).castTest.frame() as { width: number; height: number; rgba: string });
  return { width: f.width, height: f.height, rgba: new Uint8Array(Buffer.from(f.rgba, "base64")) };
}

function colorCount(f: Frame): number {
  const seen = new Set<number>();
  for (let i = 0; i < f.rgba.length; i += 4) seen.add((f.rgba[i]! << 16) | (f.rgba[i + 1]! << 8) | f.rgba[i + 2]!);
  return seen.size;
}

/** Frames to a looping GIF: the middle `w` by `h` scene pixels, the 256 colors seen most, scaled up by whole pixels. */
function gifOf(frames: readonly Frame[], w: number, h: number, scale: number, delay: number): Buffer {
  const counts = new Map<number, number>();
  const at = (f: Frame, x: number, y: number) => {
    const sx = Math.floor((f.width - w) / 2) + x;
    const sy = Math.floor((f.height - h) / 2) + y;
    if (sx < 0 || sy < 0 || sx >= f.width || sy >= f.height) return 0;
    const i = (sy * f.width + sx) * 4;
    return (f.rgba[i]! << 16) | (f.rgba[i + 1]! << 8) | f.rgba[i + 2]!;
  };
  for (const f of frames) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) counts.set(at(f, x, y), (counts.get(at(f, x, y)) ?? 0) + 1);
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(([c]) => c);
  const memo = new Map<number, number>();
  const nearest = (c: number) => {
    let m = memo.get(c);
    if (m !== undefined) return m;
    let best = Infinity;
    m = palette[0]!;
    for (const p of palette) {
      const dr = ((p >> 16) & 255) - ((c >> 16) & 255);
      const dg = ((p >> 8) & 255) - ((c >> 8) & 255);
      const db = (p & 255) - (c & 255);
      const d = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
      if (d < best) {
        best = d;
        m = p;
      }
    }
    memo.set(c, m);
    return m;
  };
  const W = w * scale;
  const H = h * scale;
  const gif: GifFrame[] = frames.map((f) => {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = nearest(at(f, Math.floor(x / scale), Math.floor(y / scale)));
        const o = (y * W + x) * 4;
        rgba[o] = (c >> 16) & 255;
        rgba[o + 1] = (c >> 8) & 255;
        rgba[o + 2] = c & 255;
        rgba[o + 3] = 255;
      }
    }
    return { rgba, delay };
  });
  return encodeGif(W, H, gif);
}

/** Every page of every set, from the front: it loads, it draws, it names its figures. */
const SETS = ["bodies", "identities", "gear", "parts", "creatures", "roster", "bosses", "mages", "npcs"] as const;

for (const set of SETS) {
  test(`figures: the ${set} draw`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // The creatures and the roster stand beside the slice's knight and goblin, the yardstick they are judged by.
    const compare = set === "creatures" || set === "roster" ? "&compare" : "";
    const { pages, count } = await open(page, `set=${set}${compare}`);
    expect(count, `${set} has figures`).toBeGreaterThan(0);
    for (let n = 0; n < pages; n++) {
      if (n > 0) await open(page, `set=${set}&page=${n}${compare}`);
      await advance(page, 0.5);
      const figures = await page.evaluate(() => (globalThis as any).castTest.figures as { id: string; height: number }[]);
      expect(figures.length).toBeGreaterThan(0);
      for (const f of figures) expect(f.height, f.id).toBeGreaterThan(0.5);
      expect(colorCount(await readFrame(page)), "a page full of painted color").toBeGreaterThan(200);
      await page.screenshot({ path: join(out, `${set}${pages > 1 ? `-${n + 1}` : ""}.png`) });
    }
    expect(errors).toEqual([]);
  });
}

/** The bodies, the creatures and the bosses from each of the camera's headings. */
for (const [set, pageCount] of [
  ["bodies", 1],
  ["creatures", 6],
  ["bosses", 1],
] as const) {
  test(`figures: the ${set} from every heading`, async ({ page }) => {
    test.setTimeout(240_000);
    for (const heading of ["left", "right"] as const) {
      for (let n = 0; n < pageCount; n++) {
        await open(page, `set=${set}&page=${n}&heading=${heading}${set === "creatures" ? "&compare" : ""}`);
        await advance(page, 0.5);
        expect(await page.evaluate(() => (globalThis as any).castTest.heading)).toBe(heading);
        expect(colorCount(await readFrame(page))).toBeGreaterThan(200);
        await page.screenshot({ path: join(out, `${set}${pageCount > 1 ? `-${n + 1}` : ""}-${heading}45.png`) });
      }
    }
  });
}

test("figures: the bodies at every zoom step", async ({ page }) => {
  for (const zoom of [1, 2]) {
    await open(page, `set=bodies&zoom=${zoom}`);
    await advance(page, 0.5);
    expect(colorCount(await readFrame(page))).toBeGreaterThan(200);
    await page.screenshot({ path: join(out, `bodies-zoom${zoom}.png`) });
  }
});

test("figures: casting and reaching out", async ({ page }) => {
  for (const [set, act] of [
    ["bodies", "cast"],
    ["bosses", "cast"],
    ["creatures", "cast"],
    ["bodies", "interact"],
  ] as const) {
    await open(page, `set=${set}&per=8`);
    await advance(page, 0.2);
    await page.evaluate((a) => (globalThis as any).castTest.act(a), act);
    await advance(page, 0.45);
    expect(colorCount(await readFrame(page))).toBeGreaterThan(200);
    await page.screenshot({ path: join(out, `${set}-${act}.png`) });
  }
});

/** Walking on the spot, at ten frames a second of game time: the people, and the beasts turned to show their gait. */
for (const [name, query, w, h] of [
  ["bodies-walk", "set=bodies&per=8&walk&nolabels", 300, 110],
  ["creatures-walk", "set=creatures&page=1&per=6&walk&face=side&nolabels", 300, 120],
  ["bosses-walk", "set=bosses&walk&nolabels", 320, 120],
] as const) {
  test(`figures: ${name}`, async ({ page }) => {
    await open(page, query);
    await advance(page, 0.3);
    const frames: Frame[] = [];
    for (let i = 0; i < 12; i++) {
      await advance(page, 0.1);
      frames.push(await readFrame(page));
    }
    const moved = frames.some((f, i) => i > 0 && Buffer.compare(Buffer.from(f.rgba), Buffer.from(frames[0]!.rgba)) !== 0);
    expect(moved, "the figures move").toBe(true);
    writeFileSync(join(out, `${name}.gif`), gifOf(frames, w, h, 2, 10));
  });
}
