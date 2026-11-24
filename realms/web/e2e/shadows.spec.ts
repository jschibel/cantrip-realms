import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { terraceFoot } from "./places";
import { at, openRealm } from "./realm";

// The sun's shadows (render/lights.ts, lighting.ts) where they meet what casts them: the foot of a terrace's east face
// in the Domains, the side its shadow falls on. The ground just past the foot is in the shadow from the first texel the
// edge's outline leaves - no strip of sunlight between the step and its shadow. Shadowed is darker than the same frame
// drawn with the sun's shadows off, the same instant. At the front heading the face is seen edge on, at the right one
// head on; at the left heading (from the south-west, the sun's side) the terrace hides its own shadow side. The
// standing grass is left out for the check: a blade taller than the shadow's edge there is rightly in the sun. The
// pictures go to test-results/shadows.

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "test-results", "shadows");
mkdirSync(out, { recursive: true });

for (const heading of ["front", "right"] as const) {
  test(`shadows: a terrace's shadow meets the foot of its face with no gap, at the ${heading} heading`, async ({ page }) => {
    const foot = terraceFoot();
    const errors = await openRealm(page, { at: at(foot.stand), extra: `&heading=${heading}&zoom=0&nohud&still&mobs=0` });
    await page.mouse.move(2, 2);
    await page.screenshot({ path: join(out, `terrace-foot-${heading}.png`) });
    // Ground points the second to fourth texels east of the face (the first is under the edge's outline), along the
    // run's inner rows four to a tile: where they are in the view, and whether each is darker with shadows than without.
    const points: [number, number, number][] = [];
    for (let z = foot.z0 + 1; z < foot.z1; z += 0.25) for (const k of [1, 2, 3]) points.push([foot.x + (k + 0.5) / 16, foot.y, z + 0.125]);
    const seen = await page.evaluate((pts) => {
      const s = (globalThis as any).sliceStage;
      const place = s.current.place;
      const sun = place.sunLight;
      const read = () => {
        s.render();
        return s.renderer.readFrame(place.scene) as { width: number; height: number; rgba: Uint8Array };
      };
      place.setDetail(false);
      const shadowed = read();
      sun.shadow.intensity = 0;
      const bare = read();
      sun.shadow.intensity = 1;
      place.setDetail(true);
      s.render();
      return pts.map(([x, y, z]) => {
        const p = s.renderer.scenePixel(s.player.position.clone().set(x, y, z));
        const i = (Math.floor(p.y) * shadowed.width + Math.floor(p.x)) * 4;
        const sum = (f: { rgba: Uint8Array }) => f.rgba[i]! + f.rgba[i + 1]! + f.rgba[i + 2]!;
        return { at: [x, z], pixel: [Math.floor(p.x), Math.floor(p.y)], inView: p.x >= 0 && p.y >= 0 && p.x < shadowed.width && p.y < shadowed.height, shadowed: sum(shadowed) < sum(bare) };
      });
    }, points);
    expect(seen.filter((p) => !p.inView), "every point in the view").toEqual([]);
    expect(seen.filter((p) => !p.shadowed), "every point past the foot in the shadow").toEqual([]);
    expect(errors).toEqual([]);
  });
}
