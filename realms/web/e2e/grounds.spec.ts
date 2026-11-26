import { type Page, expect, test } from "@playwright/test";
import { advance, groundsHere, openRealm, playerTile, realm, until, world } from "./realm";

// Every town's grounds as `?at=<town>` opens them (main.ts parseAt): the player standing at the inn's door, in the
// town's grounds and out of any door, and the camera there never showing the void past the grounds at any heading or
// zoom it allows (render/camera.ts Framing.contained: a zoom out the grounds cannot hold is refused) - the frame's
// pixels counted, as travel-map.spec.ts counts them on the small world of two scales. GROUNDS_SHOTS=<dir> keeps the
// pictures.

const SHOTS = process.env.GROUNDS_SHOTS;

/** The share of the view's scene pixels that are the open air's bare background: the void past any ground. */
const voidShare = (page: Page) =>
  page.evaluate(() => {
    const f = (globalThis as any).sliceTest.frame() as { width: number; height: number; rgba: string };
    const bytes = atob(f.rgba);
    let n = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      const r = bytes.charCodeAt(i);
      const g = bytes.charCodeAt(i + 1);
      const b = bytes.charCodeAt(i + 2);
      if (Math.abs(r - 0x1a) <= 2 && Math.abs(g - 0x2a) <= 2 && Math.abs(b - 0x22) <= 2) n++;
    }
    return n / (f.width * f.height);
  });

for (const town of world().towns) {
  test(`?at=${town.id}: at the inn's door in its grounds, and no void at any heading or zoom`, async ({ page }) => {
    test.setTimeout(120_000);
    const inn = world().inns.find((i) => i.town === town.id)!;
    const errors = await openRealm(page, { at: town.id, extra: "&mobs=0&still" });
    expect(await playerTile(page), "standing on the inn's door").toEqual({ x: inn.x, z: inn.z });
    expect(await groundsHere(page)).toBe(town.id);
    expect(await realm<string>(page, "area.name")).toBe(town.name);
    // Standing there goes nowhere: still at the door, outside, a few seconds on.
    await advance(page, 3);
    expect(await realm<string>(page, "space.id")).toBe("world");
    expect(await realm<boolean>(page, "transitioning")).toBe(false);
    expect(await playerTile(page)).toEqual({ x: inn.x, z: inn.z });
    const shares: string[] = [];
    for (const heading of [-1, 0, 1] as const) {
      // Turned to the heading, then every zoom out from the closest: those the grounds cannot hold are refused.
      await page.evaluate((h) => {
        const t = (globalThis as any).sliceTest;
        const now = { left: -1, front: 0, right: 1 }[t.heading as "left" | "front" | "right"];
        for (let k = now; k < h; k++) t.turn(1);
        for (let k = now; k > h; k--) t.turn(-1);
        for (let k = 0; k < 3; k++) t.zoomBy(-1);
      }, heading);
      for (let zoom = 0; zoom < 3; zoom++) {
        if (zoom > 0) await page.evaluate(() => (globalThis as any).sliceTest.zoomBy(1));
        await advance(page, 0.8);
        await until(page, async () => (await realm<boolean>(page, "streamed")) === true, "the grounds built", 20);
        const step = await realm<number>(page, "zoom.step");
        const share = await voidShare(page);
        shares.push(`heading ${heading} zoom ${step}: ${(share * 100).toFixed(3)}%`);
        if (SHOTS && zoom === step) await page.screenshot({ path: `${SHOTS}/${town.id}-${heading}-${step}.png` });
        expect(share, `${town.id} ${shares.at(-1)}`).toBeLessThan(0.0005);
      }
    }
    expect(errors).toEqual([]);
  });
}
