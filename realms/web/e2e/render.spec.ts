import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";

// The renderer at world scale (src/render/), on the large synthetic world (fixtures/large-world, the game page ?world=large)
// and on the manual clock: chunks streamed in and out as the player crosses their borders, the camera turned and zoomed
// while walking, a door into a room and back out at every heading, the x-ray through what stands in front of the player,
// the furthest zoom's level of detail, and the way up a terrace's ramp. With RENDER_SHOTS=1 the pictures go to
// e2e/screenshots/render; otherwise to test-results/render. The benchmark is its own (e2e/bench, npm run bench).

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.RENDER_SHOTS ? join(here, "screenshots", "render") : join(here, "..", "test-results", "render");
mkdirSync(out, { recursive: true });

const hooks = <T>(page: Page, read: string): Promise<T> =>
  page.evaluate((r) => r.split(".").reduce((o: any, k) => o?.[k], (globalThis as any).sliceTest), read) as Promise<T>;


/** The game page (index.html) offline, on the slice's street or another test world, with the slice's query: its scene=,
 * at=x,z, heading=, zoom=, still and nohud as the game page takes them. */
function gamePage(query: string, world: string): string {
  const q = new URLSearchParams(query);
  const out = new URLSearchParams(`test&manual&offline&name=Tester&mobs=0&world=${world}`);
  const scene = q.get("scene");
  const at = q.get("at");
  if (scene && scene !== "street") out.set("at", at ? `${scene}:${at}` : scene);
  else if (at) out.set("at", `world:${at}`);
  for (const [k, v] of q) if (k !== "scene" && k !== "at") out.set(k, v);
  return `/?${out.toString().replace(/=(&|$)/g, "$1")}`;
}
async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(gamePage(query, "large"));
  await page.waitForFunction(() => (globalThis as any).sliceTest?.ready === true, undefined, { timeout: 60_000 });
  return errors;
}

const advance = (page: Page, seconds: number) => page.evaluate((s) => (globalThis as any).sliceTest.advance(s), seconds);

interface Player {
  readonly tile: { x: number; z: number };
  readonly moving: boolean;
  readonly x: number;
  readonly y: number;
  readonly at: { x: number; z: number };
  readonly height: number;
}
const player = (page: Page) => hooks<Player>(page, "player");
interface RenderState {
  readonly loaded: string[];
  readonly built: string[];
  readonly idle: boolean;
  readonly calls: number;
  readonly detail: boolean;
  readonly lights: number;
}
const render = (page: Page) => hooks<RenderState>(page, "render");

/** Walks the player toward a tile, sampling a tenth of a second at a time until it stands (or `seconds` pass). */
async function walk(page: Page, x: number, z: number, seconds = 20): Promise<Player[]> {
  expect(await page.evaluate(([tx, tz]) => (globalThis as any).sliceTest.walkTo(tx, tz), [x, z] as const), `a way to ${x},${z}`).toBe(true);
  const seen: Player[] = [];
  for (let t = 0; t < seconds; t += 0.1) {
    await advance(page, 0.1);
    const p = await player(page);
    seen.push(p);
    if (!p.moving) break;
  }
  return seen;
}

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}
async function frame(page: Page): Promise<Frame> {
  const f = await page.evaluate(() => (globalThis as any).sliceTest.frame() as { width: number; height: number; rgba: string });
  return { width: f.width, height: f.height, rgba: new Uint8Array(Buffer.from(f.rgba, "base64")) };
}
function colorCount(f: Frame): number {
  const seen = new Set<number>();
  for (let i = 0; i < f.rgba.length; i += 4) seen.add((f.rgba[i]! << 16) | (f.rgba[i + 1]! << 8) | f.rgba[i + 2]!);
  return seen.size;
}

test("render: chunks stream in ahead of the player and drop behind, across chunk borders, without a stop", async ({ page }) => {
  const errors = await open(page, "still&at=128,137&heading=front&zoom=0");
  await advance(page, 0.5);
  const start = await render(page);
  expect(start.built).toContain("4_4");
  expect(start.lights, "the market's lamps lit from the pool").toBeGreaterThan(0);
  // West along the street, out of town and up the road: across four chunk borders.
  const seen: Player[] = [];
  for (const [x, z] of [[101, 137], [81, 121], [62, 106]] as const) seen.push(...(await walk(page, x, z)));
  // It never stood between the legs' ends (a leg ends standing; there are three).
  expect(seen.filter((p) => !p.moving).length).toBeLessThanOrEqual(3);
  const end = await render(page);
  expect(end.built, "the chunk it stands in, built").toContain("1_3");
  expect(end.built, "the town's middle, dropped far behind").not.toContain("4_4");
  expect(end.loaded.length, "only a window of the world read").toBeLessThan(40);
  expect(colorCount(await frame(page))).toBeGreaterThan(200);
  await page.screenshot({ path: join(out, "streamed-road.png") });
  expect(errors).toEqual([]);
});

test("render: turning and zooming while walking keeps the walk going and settles snapped", async ({ page }) => {
  const errors = await open(page, "still&at=128,137&heading=front&zoom=0");
  await advance(page, 0.3);
  expect(await page.evaluate(() => (globalThis as any).sliceTest.walkTo(155, 137))).toBe(true);
  const xs: number[] = [];
  for (let i = 0; i < 30; i++) {
    if (i === 3) await page.keyboard.press("e");
    if (i === 8) await page.keyboard.press("-");
    if (i === 14) await page.keyboard.press("q");
    if (i === 20) await page.keyboard.press("+");
    await advance(page, 0.1);
    const p = await player(page);
    xs.push(p.at.x);
    if (!p.moving) break;
  }
  for (let i = 1; i < xs.length; i++) expect(xs[i]!, "east every tenth").toBeGreaterThanOrEqual(xs[i - 1]! - 1e-9);
  for (let i = 0; i < 40 && (await player(page)).moving; i++) await advance(page, 0.1);
  expect((await player(page)).tile).toEqual({ x: 155, z: 137 });
  await advance(page, 1.5);
  expect(await hooks<boolean>(page, "cameraSettled")).toBe(true);
  expect(await hooks<string>(page, "heading")).toBe("front");
  const v = await hooks<{ snapped: boolean; scale: number }>(page, "view");
  expect(v.snapped).toBe(true);
  expect((await hooks<{ step: number }>(page, "zoom")).step).toBe(0);
  expect(errors).toEqual([]);
});

for (const heading of ["left", "front", "right"] as const) {
  test(`render: through a shop's door into its room and back out, at the ${heading} heading`, async ({ page }) => {
    const errors = await open(page, `still&at=128,137&heading=${heading}&zoom=0`);
    await advance(page, 0.5);
    const door = await page.evaluate(() => {
      const t = (globalThis as any).sliceTest;
      const me = t.player.tile;
      const doors = (t.entities as { kind: string; to: string; tile: { x: number; z: number } }[]).filter((e) => e.kind === "door");
      doors.sort((a, b) => Math.max(Math.abs(a.tile.x - me.x), Math.abs(a.tile.z - me.z)) - Math.max(Math.abs(b.tile.x - me.x), Math.abs(b.tile.z - me.z)));
      return doors[0]!;
    });
    expect(door.to).toMatch(/^room-/);
    // Walk up to it, then click it on the page.
    await walk(page, door.tile.x, door.tile.z);
    const at = await page.evaluate((to) => ((globalThis as any).sliceTest.entities as { kind: string; to: string; x: number; y: number }[]).find((e) => e.kind === "door" && e.to === to)!, door.to);
    await page.mouse.click(at.x, at.y);
    await advance(page, 0.3);
    expect(await hooks<boolean>(page, "transitioning"), "the iris closing").toBe(true);
    await advance(page, 2.5);
    expect(await hooks<string>(page, "scene")).toBe(door.to);
    expect(await hooks<boolean>(page, "transitioning")).toBe(false);
    expect(await hooks<string>(page, "heading"), "the room seen at the same heading").toBe(heading);
    await page.screenshot({ path: join(out, `room-${heading}.png`) });
    const out2 = await page.evaluate(() => ((globalThis as any).sliceTest.entities as { kind: string; x: number; y: number }[]).find((e) => e.kind === "door")!);
    await page.mouse.click(out2.x, out2.y);
    await advance(page, 4);
    expect(await hooks<string>(page, "scene")).toBe("street");
    const back = await player(page);
    expect(Math.max(Math.abs(back.tile.x - door.tile.x), Math.abs(back.tile.z - door.tile.z)), "out on its door").toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(out, `door-out-${heading}.png`) });
    expect(errors).toEqual([]);
  });
}

/** The pixels a frame differs in from another, and how far the furthest is from a point (scene pixels, top row first). */
function differences(a: Frame, b: Frame, cx: number, cy: number): { count: number; furthest: number } {
  let count = 0;
  let furthest = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2]) {
        count++;
        furthest = Math.max(furthest, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
      }
    }
  }
  return { count, furthest };
}

// The occluder fade (render/occlude.ts): what stands between the camera and the player fades, so their middle shows
// where it was hidden, and nothing else of the frame changes but the occluders.
for (const [place, at, heading] of [
  ["town", "134,133", "front"],
  ["forest", "40,60", "left"],
  ["forest", "40,60", "front"],
  ["forest", "40,60", "right"],
] as const) {
  test(`render: what stands in front of the player fades in the ${place}, at the ${heading} heading`, async ({ page }) => {
    const errors = await open(page, `still&nohud&at=${at}&heading=${heading}&zoom=0`);
    await advance(page, 1);
    const faded = await frame(page);
    const chest = await page.evaluate(() => {
      const q = (globalThis as any).sliceStage.player.position.clone();
      q.y += 0.75;
      const p = (globalThis as any).sliceStage.renderer.scenePixel(q);
      return { x: Math.floor(p.x), y: Math.floor(p.y) };
    });
    await page.screenshot({ path: join(out, `occlude-${place}-${heading}.png`) });
    await page.evaluate(() => ((globalThis as any).sliceTest.occlude = false));
    const whole = await frame(page);
    await page.screenshot({ path: join(out, `occlude-${place}-${heading}-off.png`) });
    const d = differences(faded, whole, chest.x, chest.y);
    expect(d.count, "something faded").toBeGreaterThan(40);
    // Round the player's middle, what hid them has faded.
    let near = 0;
    for (let y = chest.y - 14; y <= chest.y + 14; y++) {
      for (let x = chest.x - 10; x <= chest.x + 10; x++) {
        const i = (y * faded.width + x) * 4;
        if (faded.rgba[i] !== whole.rgba[i] || faded.rgba[i + 1] !== whole.rgba[i + 1] || faded.rgba[i + 2] !== whole.rgba[i + 2]) near++;
      }
    }
    expect(near, "the player shows through").toBeGreaterThan(20);
    expect(errors).toEqual([]);
  });
}

test("render: the furthest zoom leaves out the small props and the grass, and brings them back", async ({ page }) => {
  const errors = await open(page, "still&nohud&at=128,137&heading=front&zoom=0");
  await advance(page, 0.5);
  expect((await render(page)).detail).toBe(true);
  for (const z of [1, 2]) {
    await page.keyboard.press("-");
    await advance(page, 0.6);
    expect((await render(page)).detail, `at step ${z}`).toBe(z < 2);
  }
  await page.screenshot({ path: join(out, "far-town.png") });
  await page.keyboard.press("+");
  await advance(page, 0.6);
  expect((await render(page)).detail).toBe(true);
  expect(errors).toEqual([]);
});

test("render: up the ramps onto the hills' terraces, the player climbing as the floor does", async ({ page }) => {
  const errors = await open(page, "still&nohud&at=152,70&heading=right&zoom=0");
  await advance(page, 0.5);
  const seen = await walk(page, 196, 70, 30);
  const heights = seen.map((p) => p.height);
  expect(heights.at(-1)!, "on the top terrace").toBeCloseTo(2.25, 1);
  for (let i = 1; i < heights.length; i++) expect(heights[i]!, "never down on the way up").toBeGreaterThanOrEqual(heights[i - 1]! - 1e-6);
  // Up a ramp, not a step: the height takes in-between values.
  expect(heights.filter((h) => h > 0.05 && Math.abs(h - 0.75) > 0.05 && Math.abs(h - 1.5) > 0.05 && h < 2.2).length).toBeGreaterThan(3);
  await page.screenshot({ path: join(out, "hills-ramp.png") });
  expect(errors).toEqual([]);
});
