import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { type Tile, openRealm } from "./realm";

// The sun's shadows (render/lights.ts, lighting.ts) where they meet what casts them: the foot of a terrace's east face,
// the side its shadow falls on, on the large world's terraced hills (?world=large: the Domains' terraces now stand in
// towns' grounds among their scenery, and on the travel map among peaks and groves, where no stretch of open foot is
// sure to be). The ground just past the foot is in the shadow from the first texel the edge's outline leaves - no strip
// of sunlight between the step and its shadow. Shadowed is darker than the same frame drawn with the sun's shadows off,
// the same instant. At the front heading the face is seen edge on, at the right one head on; at the left heading (from
// the south-west, the sun's side) the terrace hides its own shadow side. The standing grass is left out for the check: a
// blade taller than the shadow's edge there is rightly in the sun. The pictures go to test-results/shadows.

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "test-results", "shadows");
mkdirSync(out, { recursive: true });

/** A tile by the hills' ramp (fixtures/large-world/source.ts HILLS). */
const HILLS = { x: 200, z: 72 };

/**
 * The foot of a terrace's east face out in the open, read from the grid the page walks, ring by ring out from the hills'
 * ramp: a straight run of at least six rows where the ground stands a level (0.75) or more above flat open ground east
 * of it, three tiles of that ground level, nothing standing within six tiles toward the sun and four the other ways, and
 * no higher ground near enough to shade it. `x` is the face's line, rows `z0` to `z1` the run, `y` the lower ground's
 * height; `stand` an open tile a few tiles north of the run, for the player, whose figure and shadow are then clear of it.
 */
function terraceFoot(page: Page): Promise<{ x: number; z0: number; z1: number; y: number; stand: Tile } | null> {
  return page.evaluate(([hx, hz]) => {
    const g = (globalThis as any).sliceStage.current.grid;
    const h = (x: number, z: number) => g.heightAt(x, z) as number;
    const open = (x: number, z: number) => g.walkable(x, z) as boolean;
    const step = (x: number, z: number): number | null => {
      if (!open(x, z) || !open(x + 1, z) || h(x, z) - h(x + 1, z) < 0.75 - 1e-6) return null;
      for (let k = 2; k <= 3; k++) if (!open(x + k, z) || Math.abs(h(x + k, z) - h(x + 1, z)) > 1e-6) return null;
      return h(x + 1, z);
    };
    const clear = (x0: number, z0: number, x1: number, z1: number, lo: number) => {
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (!open(x, z) && h(x, z) <= lo + 0.8) return false;
      return true;
    };
    const unshaded = (x: number, z0: number, z1: number, hi: number, lo: number) => {
      for (let tz = z0 - 8; tz <= z1 + 16; tz++) {
        for (let tx = x - 16; tx <= x + 6; tx++) {
          if (h(tx, tz) <= hi + 1e-6) continue;
          const far = Math.max(Math.abs(tx - (x + 1)), tz < z0 ? z0 - tz : tz > z1 ? tz - z1 : 0);
          if ((h(tx, tz) - lo) * 1.1 >= far) return false;
        }
      }
      return true;
    };
    for (let r = 0; r < 120; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = hx + dx;
          const z0 = hz + dz;
          const y = step(x, z0);
          if (y === null || step(x, z0 - 1) !== null) continue;
          let z1 = z0;
          while (step(x, z1 + 1) === y && z1 - z0 < 9) z1++;
          if (z1 - z0 < 5 || !clear(x + 1, z0 - 4, x + 6, z1 + 6, y) || !unshaded(x, z0, z1, h(x, z0), y)) continue;
          for (const [sx, sz] of [[2, -3], [1, -3], [3, -3], [2, -2], [2, -4]]) if (open(x + sx!, z0 + sz!)) return { x: x + 1, z0, z1, y, stand: { x: x + sx!, z: z0 + sz! } };
        }
      }
    }
    return null;
  }, [HILLS.x, HILLS.z] as const);
}

for (const heading of ["front", "right"] as const) {
  test(`shadows: a terrace's shadow meets the foot of its face with no gap, at the ${heading} heading`, async ({ page }) => {
    await openRealm(page, { at: `world:${HILLS.x},${HILLS.z}`, extra: "&world=large&mobs=0" });
    const foot = await terraceFoot(page);
    expect(foot, "a terrace's foot in the open on the hills").not.toBeNull();
    const errors = await openRealm(page, { at: `world:${foot!.stand.x},${foot!.stand.z}`, extra: `&world=large&heading=${heading}&zoom=0&nohud&still&mobs=0` });
    await page.mouse.move(2, 2);
    await page.screenshot({ path: join(out, `terrace-foot-${heading}.png`) });
    // Ground points the second to fourth texels east of the face (the first is under the edge's outline), along the
    // run's inner rows four to a tile: where they are in the view, and whether each is darker with shadows than without.
    const points: [number, number, number][] = [];
    for (let z = foot!.z0 + 1; z < foot!.z1; z += 0.25) for (const k of [1, 2, 3]) points.push([foot!.x + (k + 0.5) / 16, foot!.y, z + 0.125]);
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
