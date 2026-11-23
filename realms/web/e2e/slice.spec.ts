import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { type GifFrame, encodeGif } from "./gif";

// The art slice (slice.html): New Benalia's street, Grizzlegom's Goblins inside it, and the crypt under the churchyard,
// in the 3D pixel-art look on square tiles. The smoke tests load each scene and check it draws, and walk through the
// shop's door and back with real clicks. With SLICE_SHOTS=1 they also write the slice's pictures for the owner to
// judge - each scene, the street in both outside cameras, and a walking clip of each, with the doorway's transition -
// to e2e/screenshots/slice; otherwise to test-results/slice.

const here = dirname(fileURLToPath(import.meta.url));
const shots = !!process.env.SLICE_SHOTS;
const out = shots ? join(here, "screenshots", "slice") : join(here, "..", "test-results", "slice");
mkdirSync(out, { recursive: true });

interface Point {
  readonly x: number;
  readonly y: number;
}

const slice = <T>(page: Page, read: string): Promise<T> =>
  page.evaluate((r) => r.split(".").reduce((o: any, k) => o?.[k], (globalThis as any).sliceTest), read) as Promise<T>;

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/slice.html?test&${query}`);
  await page.waitForFunction(() => (globalThis as any).sliceTest?.ready === true, undefined, { timeout: 30_000 });
}

const tileOnPage = (page: Page, x: number, z: number) => page.evaluate(([tx, tz]) => (globalThis as any).sliceTest.tile(tx, tz) as Point, [x, z] as const);

async function advance(page: Page, seconds: number): Promise<void> {
  await page.evaluate((s) => (globalThis as any).sliceTest.advance(s), seconds);
}

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

async function readFrame(page: Page): Promise<Frame> {
  const f = await page.evaluate(() => (globalThis as any).sliceTest.frame() as { width: number; height: number; rgba: string });
  return { width: f.width, height: f.height, rgba: new Uint8Array(Buffer.from(f.rgba, "base64")) };
}

/** How many colors a frame shows: a scene that drew is rich in them, a blank or broken one is not. */
function colorCount(f: Frame): number {
  const seen = new Set<number>();
  for (let i = 0; i < f.rgba.length; i += 4) seen.add((f.rgba[i]! << 16) | (f.rgba[i + 1]! << 8) | f.rgba[i + 2]!);
  return seen.size;
}

for (const scene of ["street", "shop", "crypt"] as const) {
  test(`slice: the ${scene} loads and draws`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, `scene=${scene}&still`);
    expect(await slice<string>(page, "scene")).toBe(scene);
    await page.waitForTimeout(500);
    const frame = await readFrame(page);
    expect(colorCount(frame), "a scene full of painted color").toBeGreaterThan(200);
    expect(errors).toEqual([]);
    if (shots || scene !== "street") await page.screenshot({ path: join(out, `${scene}${scene === "street" ? "-34" : ""}.png`) });
  });
}

interface CameraView {
  readonly yaw: number;
  readonly pitch: number;
  readonly snapped: boolean;
}

/** Waits for the camera to settle, then says which view it settled in. */
async function settledView(page: Page): Promise<"iso" | "34"> {
  await expect.poll(() => slice<boolean>(page, "cameraSettled"), { timeout: 10_000 }).toBe(true);
  const v = await slice<CameraView>(page, "view");
  expect(v.snapped, "snapped to whole pixels once settled").toBe(true);
  if (Math.abs(v.yaw - Math.PI / 4) < 1e-6 && Math.abs(v.pitch - Math.PI / 6) < 1e-6) return "iso";
  expect(v.yaw).toBeCloseTo(0, 6);
  expect(v.pitch).toBeCloseTo(Math.PI / 4, 6);
  return "34";
}

test("slice: the street's camera turns between its two views, by key and by button, and is remembered", async ({ page }) => {
  await open(page, "still");
  expect(await settledView(page)).toBe("34");

  // V: the camera eases round - part-way through it is neither view - and settles isometric.
  await page.keyboard.press("v");
  expect(await slice<string>(page, "outside")).toBe("iso");
  await page.waitForTimeout(250);
  const mid = await slice<CameraView>(page, "view");
  expect(mid.yaw > 0 && mid.yaw < Math.PI / 4, "mid-turn").toBe(true);
  expect(await settledView(page)).toBe("iso");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, "street-iso.png") });

  // The choice outlasts the visit.
  await open(page, "still");
  expect(await slice<string>(page, "outside")).toBe("iso");
  expect(await settledView(page)).toBe("iso");

  // The on-screen button turns it back.
  const button = page.locator("[data-test='slice:camera']");
  await expect(button).toContainText("isometric");
  await button.click();
  expect(await settledView(page)).toBe("34");
  await expect(button).toContainText("three-quarter");
});

test("slice: through the shop's door and back out, by clicking", async ({ page }) => {
  await open(page, "still");
  for (const [from, to] of [
    ["street", "shop"],
    ["shop", "street"],
  ] as const) {
    expect(await slice<string>(page, "scene")).toBe(from);
    const door = await page.evaluate(() => ((globalThis as any).sliceTest.entities as { kind: string; x: number; y: number }[]).find((e) => e.kind === "door")!);
    await page.mouse.click(door.x, door.y);
    await expect.poll(() => slice<string>(page, "scene"), { timeout: 20_000 }).toBe(to);
    await expect.poll(() => slice<boolean>(page, "transitioning"), { timeout: 20_000 }).toBe(false);
  }
});

test("slice: down into the crypt from the churchyard and back up, by clicking", async ({ page }) => {
  await open(page, "still&outside=iso&at=34,11");
  for (const [from, to] of [
    ["street", "crypt"],
    ["crypt", "street"],
  ] as const) {
    expect(await slice<string>(page, "scene")).toBe(from);
    const door = await page.evaluate((t) => ((globalThis as any).sliceTest.entities as { kind: string; to: string; x: number; y: number }[]).find((e) => e.kind === "door" && e.to === t)!, to);
    await page.mouse.click(door.x, door.y);
    await expect.poll(() => slice<string>(page, "scene"), { timeout: 20_000 }).toBe(to);
    await expect.poll(() => slice<boolean>(page, "transitioning"), { timeout: 20_000 }).toBe(false);
  }
  // Back on the street, in the camera it left in.
  expect(await slice<string>(page, "outside")).toBe("iso");
});

// --- Pictures for the owner ------------------------------------------------------------------------------------------

/** Where a crop of a size sits in a frame: about its middle (frames differ in size while the view zooms). */
function cropOf(f: Frame, crop: { w: number; h: number }): { x: number; y: number } {
  return { x: Math.floor((f.width - crop.w) / 2), y: Math.floor((f.height - crop.h) / 2) };
}

/** Frames to a GIF: the 256 colors seen most, every other mapped to the nearest of them, scaled up by whole pixels. */
function gifOf(frames: readonly Frame[], crop: { w: number; h: number }, scale: number, delay: number): Buffer {
  const counts = new Map<number, number>();
  for (const f of frames) {
    const { x: cx, y: cy } = cropOf(f, crop);
    for (let y = cy; y < cy + crop.h; y++) {
      for (let x = cx; x < cx + crop.w; x++) {
        if (x < 0 || y < 0 || x >= f.width || y >= f.height) continue;
        const i = (y * f.width + x) * 4;
        const c = (f.rgba[i]! << 16) | (f.rgba[i + 1]! << 8) | f.rgba[i + 2]!;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
  }
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(([c]) => c);
  const mapped = new Map<number, number>();
  const nearest = (c: number) => {
    let m = mapped.get(c);
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
    mapped.set(c, m);
    return m;
  };
  const w = crop.w * scale;
  const h = crop.h * scale;
  const out: GifFrame[] = frames.map((f) => {
    const rgba = new Uint8Array(w * h * 4);
    const { x: cx, y: cy } = cropOf(f, crop);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = cx + Math.floor(x / scale);
        const sy = cy + Math.floor(y / scale);
        const inside = sx >= 0 && sy >= 0 && sx < f.width && sy < f.height;
        const i = (sy * f.width + sx) * 4;
        const c = inside ? nearest((f.rgba[i]! << 16) | (f.rgba[i + 1]! << 8) | f.rgba[i + 2]!) : nearest(0);
        const o = (y * w + x) * 4;
        rgba[o] = (c >> 16) & 255;
        rgba[o + 1] = (c >> 8) & 255;
        rgba[o + 2] = c & 255;
        rgba[o + 3] = 255;
      }
    }
    return { rgba, delay };
  });
  return encodeGif(w, h, out);
}

/** Clicks a tile, then records the walk there at 10 frames a second of game time. */
async function recordWalk(page: Page, to: Point, seconds: number): Promise<Frame[]> {
  const at = await tileOnPage(page, to.x, to.y);
  await page.mouse.click(at.x, at.y);
  const frames: Frame[] = [];
  for (let t = 0; t < seconds - 1e-6; t += 0.1) {
    await advance(page, 0.1);
    frames.push(await readFrame(page));
  }
  return frames;
}

const clips: readonly { name: string; query: string; to: Point; seconds: number; then?: Point; thenSeconds?: number }[] = [
  { name: "street-34-walk", query: "at=18,13", to: { x: 13, y: 10 }, seconds: 3.2 },
  { name: "street-iso-walk", query: "outside=iso&at=18,13", to: { x: 13, y: 10 }, seconds: 3.2 },
  { name: "shop-walk", query: "scene=shop", to: { x: 3, y: 6 }, seconds: 1.2, then: { x: 9, y: 4 }, thenSeconds: 1.8 },
  { name: "crypt-walk", query: "scene=crypt", to: { x: 4, y: 5 }, seconds: 1.2, then: { x: 10, y: 5 }, thenSeconds: 2.0 },
];

test("slice clip: street-camera-toggle", async ({ page }) => {
  test.skip(!shots, "pictures only with SLICE_SHOTS");
  test.setTimeout(240_000);
  // Walking along the street while the camera turns to isometric and back, at 20 frames a second of game time.
  await open(page, "manual&nohud&outside=34&at=10,12");
  await advance(page, 0.5);
  const target = await tileOnPage(page, 18, 12);
  await page.mouse.click(target.x, target.y);
  const frames: Frame[] = [];
  const record = async (seconds: number) => {
    for (let t = 0; t < seconds - 1e-6; t += 0.05) {
      await advance(page, 0.05);
      frames.push(await readFrame(page));
    }
  };
  await record(0.3);
  await page.keyboard.press("v");
  await record(1.0);
  await page.keyboard.press("v");
  await record(1.0);
  writeFileSync(join(out, "street-camera-toggle.gif"), gifOf(frames, { w: 288, h: 180 }, 2, 5));
});

for (const c of clips) {
  test(`slice clip: ${c.name}`, async ({ page }) => {
    test.skip(!shots, "pictures only with SLICE_SHOTS");
    test.setTimeout(240_000);
    await open(page, `manual&nohud&${c.query}`);
    await advance(page, 0.5);
    const frames = await recordWalk(page, c.to, c.seconds);
    if (c.then) frames.push(...(await recordWalk(page, c.then, c.thenSeconds ?? 2)));
    writeFileSync(join(out, `${c.name}.gif`), gifOf(frames, { w: 288, h: 180 }, 2, 10));
  });
}
