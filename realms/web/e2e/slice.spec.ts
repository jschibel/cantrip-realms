import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { type GifFrame, encodeGif } from "./gif";

// The art slice (slice.html): New Benalia's street, Grizzlegom's Goblins inside it, and the crypt under the churchyard,
// in the 3D pixel-art look on square tiles. The smoke tests load each scene and check it draws, and walk through the
// shop's door and back with real clicks. With SLICE_SHOTS=1 they also write the slice's pictures for the owner to
// judge - each scene, the street at each of the camera's three headings, a room from a corner, a walking clip of each
// scene with the doorway's transition, and the street turning both ways -
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

/**
 * Opens the slice on its manual clock (?manual): the game stands still until a test advances it (sliceTest.advance), so
 * no test waits on the wall clock - what moves, moves by exactly the game time the test gives it.
 */
async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/slice.html?test&manual&${query}`);
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
    await advance(page, 0.5);
    const frame = await readFrame(page);
    expect(colorCount(frame), "a scene full of painted color").toBeGreaterThan(200);
    expect(errors).toEqual([]);
    if (scene !== "street") await page.screenshot({ path: join(out, `${scene}.png`) });
  });
}

interface CameraView {
  readonly yaw: number;
  readonly pitch: number;
  readonly snapped: boolean;
}

/** Gives the camera a second and a half of game time (it is there to the eye in under half a second, to the last hair in about one), then says which heading it settled at (and that it is a true three-quarter view). */
async function settledHeading(page: Page): Promise<"left" | "front" | "right"> {
  await advance(page, 1.5);
  expect(await slice<boolean>(page, "cameraSettled"), "settled").toBe(true);
  const v = await slice<CameraView>(page, "view");
  expect(v.snapped, "snapped to whole pixels once settled").toBe(true);
  expect(v.pitch).toBeCloseTo(Math.PI / 4, 6);
  const byYaw = ([[-Math.PI / 4, "left"], [0, "front"], [Math.PI / 4, "right"]] as const).find(([yaw]) => Math.abs(v.yaw - yaw) < 1e-6);
  expect(byYaw, `a heading, not a yaw of ${v.yaw}`).toBeDefined();
  expect(await slice<string>(page, "heading")).toBe(byYaw![1]);
  return byYaw![1];
}

test("slice: the camera turns 45 degrees either way and no further, by key and by button, and is remembered", async ({ page }) => {
  await open(page, "still");
  expect(await settledHeading(page)).toBe("front");
  await page.screenshot({ path: join(out, "street-front.png") });

  // E: it eases round to the right - part-way through it is between headings - and settles at 45 degrees.
  await page.keyboard.press("e");
  await advance(page, 0.1);
  const mid = await slice<CameraView>(page, "view");
  expect(mid.yaw > 0.05 && mid.yaw < Math.PI / 4 - 0.05, "mid-turn after a tenth of a second").toBe(true);
  expect(mid.snapped, "gliding while it turns").toBe(false);
  expect(await settledHeading(page)).toBe("right");
  await page.screenshot({ path: join(out, "street-right45.png") });
  // A third step the same way is refused: it never goes past 45 degrees.
  await page.keyboard.press("e");
  expect(await settledHeading(page)).toBe("right");
  await expect(page.locator("[data-test='slice:turn-right']")).toBeDisabled();

  // The heading outlasts the visit.
  await open(page, "still");
  expect(await settledHeading(page)).toBe("right");

  // The buttons step it back to the front and on to the left; Q past the left is refused.
  const left = page.locator("[data-test='slice:turn-left']");
  await left.click();
  expect(await settledHeading(page)).toBe("front");
  await left.click();
  expect(await settledHeading(page)).toBe("left");
  await page.screenshot({ path: join(out, "street-left45.png") });
  await page.keyboard.press("q");
  expect(await settledHeading(page)).toBe("left");
  await expect(left).toBeDisabled();
});

interface PlayerState {
  readonly tile: { x: number; z: number };
  readonly moving: boolean;
  readonly x: number;
  readonly y: number;
  readonly at: { x: number; z: number };
}
const playerOf = (page: Page) => slice<PlayerState>(page, "player");

test("slice: a click walks to the tile, and on to it after the button is let go", async ({ page }) => {
  await open(page, "still&at=10,12");
  const to = await tileOnPage(page, 14, 12);
  await page.mouse.click(to.x, to.y);
  // Four tiles at 4.2 a second: there in under a second of game time, and standing.
  await advance(page, 0.5);
  expect((await playerOf(page)).moving, "still walking half-way").toBe(true);
  await advance(page, 1);
  expect(await playerOf(page)).toMatchObject({ tile: { x: 14, z: 12 }, moving: false });
});

test("slice: holding the button walks after the cursor, turning with it and never stopping, then stops on release", async ({ page }) => {
  await open(page, "still&at=12,12");
  await advance(page, 0.2);
  const stops: string[] = [];
  /** Advances the game a tenth of a second at a time, noting where the player is and whether it ever stood. */
  const walk = async (seconds: number): Promise<{ x: number; z: number }[]> => {
    const at: { x: number; z: number }[] = [];
    for (let t = 0; t < seconds - 1e-6; t += 0.1) {
      await advance(page, 0.1);
      const p = await playerOf(page);
      at.push(p.at);
      if (!p.moving) stops.push(`stood at ${p.at.x.toFixed(2)},${p.at.z.toFixed(2)}`);
    }
    return at;
  };

  // Press ahead of the player, east along the street, and hold: it walks east after the cursor.
  const start = await playerOf(page);
  await page.mouse.move(start.x + 180, start.y);
  await page.mouse.down();
  await advance(page, 0.35);
  expect(await slice<boolean>(page, "dragging"), "a hold, after 0.3 s").toBe(true);
  const east = await walk(1.0);
  for (let i = 1; i < east.length; i++) expect(east[i]!.x, "heading east every tenth").toBeGreaterThan(east[i - 1]!.x);
  // At 4.2 tiles a second, a second's walk is about four tiles (a diagonal step or two among them).
  expect(east.at(-1)!.x - east[0]!.x).toBeGreaterThan(3);
  for (const p of east) expect(Math.abs(p.z - start.at.z), "along the street").toBeLessThan(1.1);

  // Sweep the cursor round to the west of the player in small moves, a twentieth of a second apart, button held.
  const now = await playerOf(page);
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(now.x + 180 - i * 50, now.y + 30 * Math.sin(i / 2));
    await advance(page, 0.05);
  }
  const west = await walk(1.2);
  const furthest = Math.max(now.at.x, ...west.map((p) => p.x));
  // It finishes the step it was on (at most a tile further east), then walks west every tenth after that.
  expect(furthest - now.at.x, "no more than the step under way past the turn").toBeLessThan(1.5);
  const after = west.slice(west.findIndex((p) => p.x === furthest) + 1);
  for (let i = 1; i < after.length; i++) expect(after[i]!.x, "heading west every tenth").toBeLessThanOrEqual(after[i - 1]!.x + 1e-9);
  expect(west.at(-1)!.x).toBeLessThan(furthest - 2.5);

  // A camera turn while dragging: it keeps walking after the cursor.
  await page.keyboard.press("e");
  await walk(0.8);
  expect(stops, "never stood still while the button was held").toEqual([]);

  // Let go: it finishes the step it is on - at most a tile, a diagonal one - and stands.
  const released = (await playerOf(page)).at;
  await page.mouse.up();
  await advance(page, 0.5);
  const rest = await playerOf(page);
  expect(rest.moving).toBe(false);
  expect(Math.hypot(rest.at.x - released.x, rest.at.z - released.z), "stopped after the step under way").toBeLessThanOrEqual(Math.SQRT2 + 1e-6);
  expect(await slice<boolean>(page, "dragging")).toBe(false);
});

test("slice: a held sweep re-aims the walk the moment the cursor is more than a tile and a quarter from its goal", async ({ page }) => {
  await open(page, "still&at=12,12");
  await advance(page, 0.2);
  const start = await playerOf(page);
  const goalOf = async () => (await slice<{ goal: { x: number; z: number } | null }>(page, "player")).goal;
  // Hold east of the player until the hold has become a drag and aimed the walk.
  await page.mouse.move(start.x + 144, start.y);
  await page.mouse.down();
  await advance(page, 0.4);
  const aimed = (await goalOf())!;
  expect(aimed).not.toBeNull();
  // No game time passes from here: every re-aim below happens on the mouse event itself, in the same frame.
  const near = await tileOnPage(page, aimed.x + 1, aimed.z);
  await page.mouse.move(near.x, near.y);
  expect(await goalOf(), "a tile off the goal: no re-path yet").toEqual(aimed);
  const past = await tileOnPage(page, aimed.x + 2, aimed.z);
  await page.mouse.move(past.x, past.y);
  expect(await goalOf(), "two tiles off: re-aimed at once").toEqual({ x: aimed.x + 2, z: aimed.z });
  // A fast sweep - one jump of six tiles the other way - is followed at once too.
  const far = await tileOnPage(page, aimed.x - 4, aimed.z + 1);
  await page.mouse.move(far.x, far.y);
  expect(await goalOf(), "a fast sweep: re-aimed at once").toEqual({ x: aimed.x - 4, z: aimed.z + 1 });
  expect((await playerOf(page)).moving, "and never stopped").toBe(true);
  await page.mouse.up();
});

test("slice: the rooms turn too, their near wall cut down", async ({ page }) => {
  for (const [scene, heading] of [
    ["shop", "right"],
    ["crypt", "left"],
  ] as const) {
    await open(page, `scene=${scene}&still&heading=${heading}`);
    expect(await settledHeading(page)).toBe(heading);
    expect(colorCount(await readFrame(page))).toBeGreaterThan(200);
    await page.screenshot({ path: join(out, `${scene}-${heading}45.png`) });
  }
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
    // A couple of tiles' walk and the doorway's second: three seconds of game time is ample.
    await advance(page, 3);
    expect(await slice<string>(page, "scene")).toBe(to);
    expect(await slice<boolean>(page, "transitioning")).toBe(false);
  }
});

test("slice: down into the crypt from the churchyard and back up, by clicking", async ({ page }) => {
  await open(page, "still&heading=right&at=34,11");
  for (const [from, to] of [
    ["street", "crypt"],
    ["crypt", "street"],
  ] as const) {
    expect(await slice<string>(page, "scene")).toBe(from);
    const door = await page.evaluate((t) => ((globalThis as any).sliceTest.entities as { kind: string; to: string; x: number; y: number }[]).find((e) => e.kind === "door" && e.to === t)!, to);
    await page.mouse.click(door.x, door.y);
    await advance(page, 3);
    expect(await slice<string>(page, "scene")).toBe(to);
    expect(await slice<boolean>(page, "transitioning")).toBe(false);
  }
  // Back on the street, at the heading it left at.
  expect(await settledHeading(page)).toBe("right");
});

interface ZoomState {
  readonly step: number;
  readonly scale: number;
  readonly steps: number;
}
const zoomOf = (page: Page) => slice<ZoomState>(page, "zoom");

/** Gives the zoom its easing's game time, then says where it settled: its step and its whole-pixel scale. */
async function settledZoom(page: Page): Promise<{ step: number; scale: number }> {
  await advance(page, 0.5);
  expect(await slice<boolean>(page, "cameraSettled"), "settled").toBe(true);
  expect((await slice<CameraView>(page, "view")).snapped, "snapped once settled").toBe(true);
  const z = await zoomOf(page);
  expect(Number.isInteger(z.scale), `a whole-pixel scale, not ${z.scale}`).toBe(true);
  return { step: z.step, scale: z.scale };
}

test("slice: the outdoor zoom steps out and in by wheel, keys and buttons, holds rooms close, and is remembered", async ({ page }) => {
  // At 1280 by 800 the closest outdoor view is 3 screen pixels to a scene pixel; the steps out are 2 and 1.
  await open(page, "still&at=8,12");
  expect(await settledZoom(page)).toEqual({ step: 0, scale: 3 });
  expect((await zoomOf(page)).steps).toBe(3);

  // The wheel, down: a step out, easing - part-way it is between scales, unsnapped - then settled at 2.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await advance(page, 0.15);
  const mid = await slice<CameraView & { scale: number }>(page, "view");
  expect(mid.scale > 2 && mid.scale < 3 && !mid.snapped, "mid-zoom").toBe(true);
  expect(await settledZoom(page)).toEqual({ step: 1, scale: 2 });
  // The minus key: the furthest step; once more is refused, and its button is disabled.
  await page.keyboard.press("-");
  expect(await settledZoom(page)).toEqual({ step: 2, scale: 1 });
  await page.keyboard.press("-");
  expect(await settledZoom(page)).toEqual({ step: 2, scale: 1 });
  await expect(page.locator("[data-test='slice:zoom-out']")).toBeDisabled();
  // The wheel up, then the plus button: back in to the closest.
  await page.mouse.wheel(0, -120);
  expect(await settledZoom(page)).toEqual({ step: 1, scale: 2 });
  await page.locator("[data-test='slice:zoom-in']").click();
  expect(await settledZoom(page)).toEqual({ step: 0, scale: 3 });
  await page.keyboard.press("-");
  expect(await settledZoom(page)).toEqual({ step: 1, scale: 2 });

  // The step outlasts the visit.
  await open(page, "still&at=13,11");
  expect(await settledZoom(page)).toEqual({ step: 1, scale: 2 });

  // A room is always seen closest (4); zooming there does nothing; out again, the street is back at its step.
  for (const [to, scale] of [
    ["shop", 4],
    ["street", 2],
  ] as const) {
    const door = await page.evaluate(() => ((globalThis as any).sliceTest.entities as { kind: string; x: number; y: number }[]).find((e) => e.kind === "door")!);
    await page.mouse.click(door.x, door.y);
    await advance(page, 3);
    expect(await slice<string>(page, "scene")).toBe(to);
    expect(await settledZoom(page)).toEqual({ step: 1, scale });
    if (to === "shop") {
      await page.keyboard.press("-");
      await page.mouse.wheel(0, 120);
      expect(await settledZoom(page)).toEqual({ step: 1, scale: 4 });
      await expect(page.locator("[data-test='slice:zoom-out']")).toBeDisabled();
    }
  }
});

test("slice: out through the west gate into open country, and back", async ({ page }) => {
  await open(page, "still&at=4,12&zoom=1");
  // Just outside the gate, then on west: the gate is open, the country beyond walkable as one place with the town.
  const gate = await tileOnPage(page, -3, 12);
  await page.mouse.click(gate.x, gate.y);
  await advance(page, 2.5);
  expect((await playerOf(page)).tile).toEqual({ x: -3, z: 12 });
  const beyond = await tileOnPage(page, -10, 13);
  await page.mouse.click(beyond.x, beyond.y);
  await advance(page, 3);
  expect((await playerOf(page)).tile).toEqual({ x: -10, z: 13 });
  expect(await slice<string>(page, "scene")).toBe("street");
  const back = await tileOnPage(page, 3, 12);
  await page.mouse.click(back.x, back.y);
  await advance(page, 4);
  expect((await playerOf(page)).tile).toEqual({ x: 3, z: 12 });
});

test.describe("slice pictures at 1080p", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  for (const [name, at] of [
    ["street", "at=13,12"],
    ["wilderness", "at=-38,16"],
  ] as const) {
    test(`slice: the ${name} at each zoom step`, async ({ page }) => {
      for (const step of [0, 1, 2]) {
        await open(page, `still&zoom=${step}&${at}`);
        await advance(page, 0.5);
        expect(await zoomOf(page)).toMatchObject({ step, scale: 4 - step });
        expect(colorCount(await readFrame(page))).toBeGreaterThan(200);
        await page.screenshot({ path: join(out, `${name}-zoom${step}.png`) });
      }
    });
  }
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
  { name: "street-walk", query: "at=18,13", to: { x: 13, y: 10 }, seconds: 3.2 },
  { name: "shop-walk", query: "scene=shop", to: { x: 3, y: 6 }, seconds: 1.2, then: { x: 9, y: 4 }, thenSeconds: 1.8 },
  { name: "crypt-walk", query: "scene=crypt", to: { x: 4, y: 5 }, seconds: 1.2, then: { x: 10, y: 5 }, thenSeconds: 2.0 },
];

test("slice clip: street-zoom-gate", async ({ page }) => {
  test.skip(!shots, "pictures only with SLICE_SHOTS");
  test.setTimeout(240_000);
  // Walking west out through the gate while the camera steps out twice and back in, as shown on screen, 20 a second.
  await open(page, "nohud&zoom=0&at=4,12");
  await advance(page, 0.3);
  // A tile past the gate that is on screen at the closest step.
  const to = await tileOnPage(page, -5, 13);
  await page.mouse.click(to.x, to.y);
  const frames: Frame[] = [];
  const record = async (seconds: number) => {
    for (let t = 0; t < seconds - 1e-6; t += 0.05) {
      await advance(page, 0.05);
      const f = await page.evaluate(() => (globalThis as any).sliceTest.shown(640, 400) as { width: number; height: number; rgba: string });
      frames.push({ width: f.width, height: f.height, rgba: new Uint8Array(Buffer.from(f.rgba, "base64")) });
    }
  };
  await record(0.4);
  for (const key of ["-", "-", "+", "+"]) {
    await page.keyboard.press(key);
    await record(0.5);
  }
  writeFileSync(join(out, "street-zoom-gate.gif"), gifOf(frames, { w: 640, h: 400 }, 1, 5));
});

test("slice clip: street-rotate", async ({ page }) => {
  test.skip(!shots, "pictures only with SLICE_SHOTS");
  test.setTimeout(240_000);
  // The camera stepping round about the player: right, back to the front, left, and back - at 20 frames a second.
  await open(page, "nohud&heading=front&at=14,13");
  await advance(page, 0.5);
  const frames: Frame[] = [];
  const record = async (seconds: number) => {
    for (let t = 0; t < seconds - 1e-6; t += 0.05) {
      await advance(page, 0.05);
      frames.push(await readFrame(page));
    }
  };
  await record(0.25);
  for (const key of ["e", "q", "q", "e"]) {
    await page.keyboard.press(key);
    await record(0.7);
  }
  writeFileSync(join(out, "street-rotate.gif"), gifOf(frames, { w: 288, h: 180 }, 2, 5));
});

for (const c of clips) {
  test(`slice clip: ${c.name}`, async ({ page }) => {
    test.skip(!shots, "pictures only with SLICE_SHOTS");
    test.setTimeout(240_000);
    await open(page, `nohud&${c.query}`);
    await advance(page, 0.5);
    const frames = await recordWalk(page, c.to, c.seconds);
    if (c.then) frames.push(...(await recordWalk(page, c.then, c.thenSeconds ?? 2)));
    writeFileSync(join(out, `${c.name}.gif`), gifOf(frames, { w: 288, h: 180 }, 2, 10));
  });
}
