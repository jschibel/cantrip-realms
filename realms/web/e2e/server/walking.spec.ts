import { expect, test } from "@playwright/test";
import { doorOf } from "../places";
import { advance, openNear, realm, waitReady, waitSpace } from "../realm";
import { character, place, query } from "./server";

// Walking beside a shop on the real server: a held walk circling the player and clicks all round it are told to the
// relay as walks it takes - none refused (too many at once, or starting somewhere the server does not have the
// player), so the server never puts the player back where it thinks they are, and the figure never jumps.

test("walking beside a shop: the relay refuses none of a held walk's or the clicks' walks, and the player never jumps", async ({ page }) => {
  test.setTimeout(180_000);
  await character(page.request, 71, "Wanda");
  await place(page.request, openNear(doorOf("argive-goblin-trader-shop"), 2));
  await page.goto(query("&mobs=0"));
  await waitReady(page);
  await waitSpace(page, "world");
  await advance(page, 2);
  // Every frame, how far the figure went since the last (the page's own clock: a frame is at most a twentieth).
  await page.evaluate(() => {
    const g = globalThis as any;
    g.walkJumps = [] as number[];
    let last: { x: number; z: number; space: string } | null = null;
    const watch = () => {
      // Through a door to another place is no jump.
      const stage = g.sliceStage;
      const p = stage?.player.position;
      const space = stage?.current.id;
      if (p && last && last.space === space && Math.hypot(p.x - last.x, p.z - last.z) > 0.3) g.walkJumps.push(Math.hypot(p.x - last.x, p.z - last.z));
      last = p ? { x: p.x, z: p.z, space } : null;
      requestAnimationFrame(watch);
    };
    watch();
  });
  const centre = await page.evaluate(() => {
    const s = (globalThis as any).sliceStage;
    const p = s.player.position;
    return s.toScreen(p.clone().setY(p.y + 0.4)) as { x: number; y: number };
  });

  // Held, the cursor circling the player twice, against the shop's front too.
  await page.mouse.move(centre.x + 160, centre.y);
  await page.mouse.down();
  for (let i = 0; i <= 160; i++) {
    const a = (i / 40) * Math.PI * 2;
    await page.mouse.move(centre.x + 160 * Math.cos(a), centre.y + 160 * Math.sin(a));
    await advance(page, 0.03);
  }
  await page.mouse.up();
  await advance(page, 0.5);
  // Clicks all round, each a little after the last, some across the shop.
  for (const [dx, dy] of [[0, -200], [0, 200], [-200, 0], [200, 0], [150, -150], [-150, 150], [100, -40], [-100, -60]] as const) {
    await page.mouse.click(centre.x + dx, centre.y + dy);
    await advance(page, 0.6);
  }
  await advance(page, 1);
  expect(await realm<string[]>(page, "refused"), "walks the relay refused").toEqual([]);
  expect(await page.evaluate(() => (globalThis as any).walkJumps as number[]), "jumps of the figure").toEqual([]);
});
