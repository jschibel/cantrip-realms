import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { advance, at as atTile, openNear, openRealm, realm, until, world } from "./realm";

// The world's whole map and the regional map (tech.md B5, "The tier zones are shown"): opened with M, filling the
// window at the Domains' 2:3, every town named and no two names over each other at any zoom, more names as it zooms in,
// the tiers tinted with its toggle, dragged about and closed with Escape; and the minimap on the travel map. With
// MAP_SHOTS=<dir> it keeps the pictures: the whole map fitted at 1280x800 and 1920x1080, zoomed on Benalia and Llanowar,
// on North Aerona and on Icehaven, with the tiers off and on, and the minimap at a coast, a pass and a forest.

const shots = process.env.MAP_SHOTS ?? null;
if (shots) mkdirSync(shots, { recursive: true });

type Whole = { zoom: number; steps: number[]; tiers: boolean; ready: boolean; left: number; top: number; names: { id: string; text: string; kind: string }[] };

async function openMap(page: Page): Promise<Whole> {
  await page.keyboard.press("m");
  await until(page, async () => (await realm<Whole | null>(page, "map.whole"))?.ready === true, "the whole map drawn");
  return (await realm<Whole>(page, "map.whole"))!;
}

/** Zooms the open map to a step (0: fitted), centred on a tile, and waits for it to be drawn. */
async function view(page: Page, step: number, at: { x: number; z: number } | null, tiers = false): Promise<Whole> {
  await page.evaluate(([s, x, z, t]) => (globalThis as any).realmTest.showWholeMap(s, x, z, t), [step, at?.x ?? null, at?.z ?? null, tiers] as const);
  await until(page, async () => {
    const w = await realm<Whole | null>(page, "map.whole");
    return !!w && w.ready && w.zoom === w.steps[Math.min(step, w.steps.length - 1)] && w.tiers === tiers;
  }, "the map zoomed and drawn");
  await page.waitForTimeout(50);
  return (await realm<Whole>(page, "map.whole"))!;
}

/** The boxes of the names on the map, as the page lays them out. */
async function nameBoxes(page: Page): Promise<{ text: string; x0: number; y0: number; x1: number; y1: number }[]> {
  return page.evaluate(() => {
    const frame = document.querySelector(".wm-frame")!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".wm-name")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > frame.left && r.left < frame.right && r.bottom > frame.top && r.top < frame.bottom)
      .map(({ el, r }) => ({ text: el.textContent ?? "", x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }));
  });
}

function overlaps(boxes: { text: string; x0: number; y0: number; x1: number; y1: number }[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      // A pixel's give: text boxes are a little taller than their letters.
      if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1) out.push(`${a.text} / ${b.text}`);
    }
  return out;
}

const BENALIA = { x: 120, z: 340 };
const LLANOWAR = { x: 196, z: 392 };
const NORTH_AERONA = { x: 300, z: 230 };
const ICEHAVEN = { x: 150, z: 100 };

for (const size of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]) {
  test(`the whole map at ${size.width}x${size.height}: fills the window, names every town, no names over each other, zooms and tints the tiers`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    const errors = await openRealm(page, { at: atTile(openNear({ x: 300, z: 640 }, 0)), extra: "&mobs=0" });
    await advance(page, 0.5);
    const fitted = await openMap(page);
    // The frame: the map's 2:3, as tall as the window lets it.
    const frame = await page.locator(".wm-frame").boundingBox();
    expect(frame!.height / size.height, "the map fills the window's height").toBeGreaterThan(0.8);
    expect(Math.abs(frame!.width / frame!.height - 512 / 768)).toBeLessThan(0.01);
    // Every town named, and no two names over each other.
    const towns = fitted.names.filter((n) => n.kind === "town").map((n) => n.text);
    if (shots) await page.screenshot({ path: join(shots, `map-world-${size.width}.png`) });
    for (const t of world().towns) expect(towns, `${t.name} named`).toContain(t.name);
    expect(overlaps(await nameBoxes(page))).toEqual([]);
    // Zoomed in: more names, still none over another.
    const close = await view(page, 2, BENALIA);
    expect(close.zoom).toBeGreaterThan(fitted.zoom);
    expect(overlaps(await nameBoxes(page))).toEqual([]);
    if (shots) await page.screenshot({ path: join(shots, `map-benalia-${size.width}.png`) });
    // A dungeon named on hover, with its tier and its boss.
    const keep = world().dungeons.find((d) => d.id === "benalish-keep")!;
    const frameBox = (await page.locator(".wm-frame").boundingBox())!;
    await page.mouse.move(frameBox.x + (keep.x + 0.5) * close.zoom - close.left, frameBox.y + (keep.z + 0.5) * close.zoom - close.top);
    await until(page, async () => /tier \d/.test((await realm<string | null>(page, "tooltip")) ?? ""), "the dungeon's tooltip", 5);
    if (shots) await page.screenshot({ path: join(shots, `map-hover-${size.width}.png`) });
    await page.mouse.move(2, 2);
    const nearer = await view(page, 3, LLANOWAR);
    expect(nearer.names.filter((n) => n.kind !== "town").length).toBeGreaterThanOrEqual(fitted.names.filter((n) => n.kind !== "town").length);
    expect(overlaps(await nameBoxes(page))).toEqual([]);
    if (shots) await page.screenshot({ path: join(shots, `map-llanowar-${size.width}.png`) });
    await view(page, 2, NORTH_AERONA);
    expect(overlaps(await nameBoxes(page))).toEqual([]);
    if (shots) await page.screenshot({ path: join(shots, `map-north-aerona-${size.width}.png`) });
    await view(page, 2, ICEHAVEN, true);
    expect(overlaps(await nameBoxes(page))).toEqual([]);
    if (shots) await page.screenshot({ path: join(shots, `map-icehaven-tiers-${size.width}.png`) });
    // The tiers' toggle, fitted.
    await view(page, 0, null);
    await page.locator("[data-test='map:tiers']").click();
    await until(page, async () => (await realm<Whole>(page, "map.whole")).tiers === true && (await realm<Whole>(page, "map.whole")).ready, "the tiers tinted");
    if (shots) await page.screenshot({ path: join(shots, `map-world-tiers-${size.width}.png`) });
    // Dragged: the map moves under the mouse.
    await page.locator("[data-test='map:zoom-in']").click();
    await page.locator("[data-test='map:zoom-in']").click();
    const box = (await page.locator(".wm-frame").boundingBox())!;
    const before = await page.evaluate(() => document.querySelector<HTMLElement>(".wm-frame .labels")!.style.transform);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => document.querySelector<HTMLElement>(".wm-frame .labels")!.style.transform)).not.toBe(before);
    await page.keyboard.press("Escape");
    await until(page, async () => (await realm<boolean>(page, "map.open")) === false, "the map closed");
    expect(errors).toEqual([]);
  });
}

test("in a town's grounds the whole map opens on the town's, and turns to the world's with the player at the town's icon", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openRealm(page, { at: "capashen-hold", extra: "&mobs=0" });
  await until(page, async () => (await realm<{ town: string | null }>(page, "map")).town === "capashen-hold", "the town's map");
  await page.keyboard.press("m");
  await until(page, async () => (await realm<string>(page, "map.view")) === "town" && (await realm<boolean>(page, "map.open")), "the town's whole map");
  await page.locator("[data-test='map:switch']").click();
  await until(page, async () => (await realm<Whole | null>(page, "map.whole"))?.ready === true, "the world's whole map drawn");
  expect(await realm<string>(page, "map.view")).toBe("world");
  if (shots) await page.screenshot({ path: join(shots, "map-world-from-town.png") });
  await page.keyboard.press("Escape");
  await until(page, async () => (await realm<boolean>(page, "map.open")) === false, "the map closed");
});

test("the minimap on the travel map: the land round the player, the marks near, a coast, a pass and a forest", async ({ page }) => {
  test.setTimeout(120_000);
  for (const [name, at] of [
    ["coast", { x: 64, z: 340 }],
    ["pass", { x: 340, z: 560 }],
    ["forest", { x: 200, z: 392 }],
  ] as const) {
    await openRealm(page, { at: atTile(openNear(at, 0)), extra: "&mobs=0" });
    await advance(page, 1);
    const state = await realm<{ centre: { x: number; z: number } | null; town: string | null }>(page, "map");
    expect(state.town).toBeNull();
    expect(state.centre).not.toBeNull();
    if (shots) await page.locator("#hud-place").screenshot({ path: join(shots, `minimap-${name}.png`) });
  }
});
