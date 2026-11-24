import { expect, test } from "@playwright/test";
import { doorOf } from "../places";
import { advance, openNear, realm, waitReady, waitSpace } from "../realm";
import { character, place, query } from "./server";

// Walking beside a shop on the real server: a held walk circling the player and clicks all round it are told to the
// relay as walks it takes - none refused (too many at once, or starting somewhere the server does not have the
// player), so the server never puts the player back where it thinks they are, and the figure never jumps. And when the
// server has lost track of the player all the same (a reconnection entering them where they last reported), the walk it
// refuses is followed by the way there (net/relay.ts catchUp), never a snap back.

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

test("a walk refused after the server lost track of the player is caught up, not snapped back: the figure never jumps", async ({ page }) => {
  test.setTimeout(180_000);
  await character(page.request, 72, "Wren");
  const start = openNear(doorOf("argive-goblin-trader-shop"), 2);
  await place(page.request, start);
  await page.goto(query("&mobs=0"));
  await waitReady(page);
  await waitSpace(page, "world");
  await advance(page, 2);
  await page.evaluate(() => {
    const g = globalThis as any;
    g.walkJumps = [] as number[];
    let last: { x: number; z: number; figure: unknown } | null = null;
    const watch = () => {
      const stage = g.sliceStage;
      const p = stage?.player.position;
      if (p && last && last.figure === stage.player && Math.hypot(p.x - last.x, p.z - last.z) > 0.3) g.walkJumps.push(Math.hypot(p.x - last.x, p.z - last.z));
      last = p ? { x: p.x, z: p.z, figure: stage.player } : null;
      requestAnimationFrame(watch);
    };
    watch();
  });
  // The server's record of the player moved a few tiles off (as a report lost, or a stale one), then the relay's socket
  // dropped: on reconnecting it enters the player there, away from where the figure stands.
  const elsewhere = openNear(start, 4);
  await place(page.request, elsewhere);
  await page.evaluate(() => (globalThis as any).realmTest.game.presence.socket.close());
  await advance(page, 2);
  // A held walk: its first walk told is refused (the server has the player elsewhere), and the relay catches up.
  const me = await page.evaluate(() => {
    const p = (globalThis as any).sliceStage.player.position;
    return { x: p.x as number, z: p.z as number };
  });
  for (const [dx, dz] of [[2, 0], [2, 2], [0, 2], [0, 0]] as const) {
    await page.evaluate(([x, z]) => (globalThis as any).sliceStage.player.steer({ x, z }), [me.x + dx, me.z + dz] as const);
    await advance(page, 1.2);
  }
  await page.evaluate(() => (globalThis as any).sliceStage.player.steer(null));
  await advance(page, 1);
  const refused = await realm<string[]>(page, "refused");
  expect(refused.length, `refusals: ${JSON.stringify(refused)}`).toBeGreaterThanOrEqual(1);
  expect(refused.length, `refusals: ${JSON.stringify(refused)}`).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => (globalThis as any).walkJumps as number[]), "jumps of the figure").toEqual([]);
  // Caught up: walking on is refused no more.
  for (const [dx, dz] of [[-2, 0], [0, 0]] as const) {
    await page.evaluate(([x, z]) => (globalThis as any).sliceStage.player.steer({ x, z }), [me.x + dx, me.z + dz] as const);
    await advance(page, 1.2);
  }
  await page.evaluate(() => (globalThis as any).sliceStage.player.steer(null));
  await advance(page, 1);
  expect(await realm<string[]>(page, "refused")).toEqual(refused);
});
