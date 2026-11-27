import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { behindBuilding, underAwning } from "./places";
import { type Tile, advance, at, openRealm } from "./realm";

// The occluder fade (render/occlude.ts) and the view's steadiness (render/renderer.ts), in a town of the Domains at
// every heading: what fades is what stands in front of the player - a shop's awning over them, the roof of the house
// they stand behind - and nothing else of the building (never its far side); and the view following a walk draws the
// scene exactly as it was, moved by whole pixels, so no roof's line or shadow's edge flickers as it moves. The
// pictures go to test-results/occlude.

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "test-results", "occlude");
mkdirSync(out, { recursive: true });

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}
async function frame(page: Page): Promise<Frame> {
  const f = await page.evaluate(() => (globalThis as any).sliceTest.frame() as { width: number; height: number; rgba: string });
  return { width: f.width, height: f.height, rgba: new Uint8Array(Buffer.from(f.rgba, "base64")) };
}

/** Opens the town a step from a tile and walks onto it, so the player stands on its floor; the camera settled. */
async function standOn(page: Page, from: Tile, to: Tile, heading: string): Promise<void> {
  await openRealm(page, { at: at(from), extra: `&heading=${heading}&zoom=0&nohud&still&mobs=0` });
  await page.mouse.move(2, 2);
  expect(await page.evaluate(([x, z]) => (globalThis as any).sliceTest.walkTo(x, z), [to.x, to.z] as const)).toBe(true);
  await advance(page, 2);
  expect(await page.evaluate(() => (globalThis as any).sliceTest.player.tile)).toEqual(to);
}

/** The player's feet in the view, scene pixels from its upper left corner. */
const feet = (page: Page) => page.evaluate(() => (globalThis as any).sliceStage.renderer.scenePixel((globalThis as any).sliceStage.player.position) as { x: number; y: number });

/** The pixels the fade changed: the frame with it, and without. */
async function faded(page: Page, name: string): Promise<{ x: number; y: number }[]> {
  const on = await frame(page);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.evaluate(() => ((globalThis as any).sliceTest.occlude = false));
  const off = await frame(page);
  await page.screenshot({ path: join(out, `${name}-off.png`) });
  const changed: { x: number; y: number }[] = [];
  for (let y = 0; y < on.height; y++) {
    for (let x = 0; x < on.width; x++) {
      const i = (y * on.width + x) * 4;
      if (on.rgba[i] !== off.rgba[i] || on.rgba[i + 1] !== off.rgba[i + 1] || on.rgba[i + 2] !== off.rgba[i + 2]) changed.push({ x, y });
    }
  }
  return changed;
}

// The game looks north and never turns (one heading).
for (const heading of ["front"] as const) {
  test(`occlude: under a shop's awning only what covers the player fades, never the shop's far side, at the ${heading} heading`, async ({ page }) => {
    const { at: tile, from } = underAwning();
    await standOn(page, from, tile, heading);
    const f = await feet(page);
    const changed = await faded(page, `awning-${heading}`);
    // The awning over them fades: pixels over their figure (the figure's box above their feet).
    const over = changed.filter((p) => Math.abs(p.x - f.x) <= 8 && p.y <= f.y && p.y >= f.y - 26);
    expect(over.length, "the awning fades over the player").toBeGreaterThan(8);
    // And nothing far from them: before, the shop's back fell to a ghost while the awning stood. Near is the fade's own
    // reach - the ground round their feet (occlude.ts AROUND_RADIUS and AROUND_OVER, 2.75 tiles: 44 scene pixels), where
    // what stands past the shop's footprint in front of them (its stall's counter, its step) fades too - and up to
    // 44 above their feet, short of the shop's back.
    const far = changed.filter((p) => Math.abs(p.x - f.x) > 44 || p.y < f.y - 44 || p.y > f.y + 44);
    expect(far, "nothing fades away from the player").toEqual([]);
  });

  test(`occlude: behind a house its roof fades round the player, and only there, at the ${heading} heading`, async ({ page }) => {
    const { at: tile, from } = behindBuilding();
    await standOn(page, from, tile, heading);
    const f = await feet(page);
    const changed = await faded(page, `behind-${heading}`);
    const over = changed.filter((p) => Math.abs(p.x - f.x) <= 6 && p.y <= f.y && p.y >= f.y - 20);
    expect(over.length, "the player shows through the roof").toBeGreaterThan(20);
    // The ground round their feet the roof hid, at most three tiles off: a window in the roof, not the whole house.
    const far = changed.filter((p) => Math.hypot(p.x - f.x, (p.y - f.y) * 0.75) > 72);
    expect(far, "nothing fades far from the player").toEqual([]);
  });

  test(`occlude: the view following the player draws the scene exactly, moved by whole pixels, at the ${heading} heading`, async ({ page }) => {
    const { at: tile, from } = underAwning();
    await standOn(page, from, tile, heading);
    // The focus moved as the camera's easing moves it - by fractions of a pixel - along a walk of a tile and a half,
    // nothing else changing; each frame against the first, moved by as many pixels as the view moved.
    const result = await page.evaluate(() => {
      const s = (globalThis as any).sliceStage;
      const r = s.renderer;
      const scene = s.current.place.scene;
      const base = r.focus.clone();
      const window = r.post.uniforms.window.value;
      const cam = r.camera;
      const right = base.clone().set(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = base.clone().set(0, 1, 0).applyQuaternion(cam.quaternion);
      const pixel = () => [Math.round(cam.position.dot(right) / r.view.wppX + window.x), Math.round(cam.position.dot(up) / r.view.wppY + window.y)];
      const first = r.readFrame(scene);
      const [x0, y0] = pixel();
      const w = first.width;
      const h = first.height;
      let differing = 0;
      for (let k = 1; k <= 12; k++) {
        r.focus.copy(base).add(base.clone().set(k * 0.1137, 0, k * 0.0371));
        const f = r.readFrame(scene);
        const [x1, y1] = pixel();
        const dx = x1! - x0!;
        const dy = y1! - y0!;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const fx = x + dx;
            const fy = y - dy;
            if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
            const a = (y * w + x) * 4;
            const b = (fy * w + fx) * 4;
            if (f.rgba[a] !== first.rgba[b] || f.rgba[a + 1] !== first.rgba[b + 1] || f.rgba[a + 2] !== first.rgba[b + 2]) differing++;
          }
        }
      }
      r.focus.copy(base);
      return differing;
    });
    expect(result, "pixels drawn differently once the view has moved").toBe(0);
  });
}
