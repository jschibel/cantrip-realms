import { type Page, expect, test } from "@playwright/test";
import { BASIN, CENTER, GROUNDS, SITE, SOUTH, TRAVEL, WEST } from "../fixtures/two-world/places";
import { type Tile, advance, chebyshev, clickControl, clickTile, openRealm, realm, until } from "./realm";

// A world of two scales (interfaces.md, "Two scales"), on its fixture (fixtures/two-world, the page's ?world=two), offline
// against the MockApi: the travel map, where the town of Twoford is an icon, and its grounds at walking scale in a pocket of
// their own. A click on the icon walks to its nearest way and goes in behind the iris; walking onto an exit of the grounds
// comes out beside the icon, and standing there goes nowhere; a held walk into the icon from its way goes in; the camera
// in the grounds never shows the void past them, at any heading or zoom; the maps switch with the ground. TRAVEL_SHOTS=<dir>
// keeps the pictures taken.

const SHOTS = process.env.TRAVEL_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const open = (page: Page, at: Tile) => openRealm(page, { at: `world:${at.x},${at.z}`, extra: "&world=two&mobs=0" });
const tile = (p: readonly [number, number]): Tile => ({ x: p[0], z: p[1] });
const here = (page: Page) => page.evaluate(() => (globalThis as any).sliceTest.player.tile) as Promise<Tile>;
const inGrounds = (t: Tile) => t.x >= GROUNDS[0] && t.x < GROUNDS[2] && t.z >= GROUNDS[1] && t.z < GROUNDS[3];
const onTravel = (t: Tile) => t.x >= TRAVEL[0] && t.x < TRAVEL[2] && t.z >= TRAVEL[1] && t.z < TRAVEL[3];

/** Advances until the player stands still on a tile `near` of a goal, out of any door; whether the iris was seen shut on the way. */
async function arrive(page: Page, goal: Tile, near: number, what: string, seconds = 40): Promise<{ iris: boolean }> {
  let iris = false;
  await until(
    page,
    async () => {
      if (await realm<boolean>(page, "transitioning")) iris = true;
      const at = await here(page);
      return !(await realm<boolean>(page, "transitioning")) && chebyshev(at, goal) <= near && !(await page.evaluate(() => (globalThis as any).sliceTest.player.moving));
    },
    what,
    seconds,
  );
  return { iris };
}

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

const jumps = (page: Page) => page.evaluate(() => ((globalThis as any).realmTest.game.jumps as unknown[]).length);

test("a click on the town's icon walks to its nearest way and goes in behind the iris, to the road into town", async ({ page }) => {
  const errors = await open(page, { x: 36, z: 40 });
  await until(page, async () => (await realm<boolean>(page, "streamed")) === true, "the travel map built");
  expect(await realm<string | null>(page, "map.town")).toBeNull();
  await shot(page, "1-travel-map");
  // A tile of the icon south of its middle (clear of the HUD's buttons): the west way's outside is the nearest.
  await clickTile(page, SITE[0] - 1, SITE[1] + 1);
  const { iris } = await arrive(page, tile(WEST.inside), 1, "in Twoford by its west way");
  expect(iris, "the iris closed on the way").toBe(true);
  expect(inGrounds(await here(page))).toBe(true);
  expect(await realm<string>(page, "area.name")).toBe("Twoford");
  expect(await realm<string>(page, "space.id")).toBe("world");
  // The minimap is the town's now; the chunks round the travel map's icon are let go.
  await until(page, async () => (await realm<string | null>(page, "map.town")) === "twoford", "the town's map");
  const built = await realm<string[]>(page, "chunks.built");
  expect(built).toContain("6_1");
  expect(built.some((k) => Number(k.split("_")[0]) < 3)).toBe(false);
  // The server (the stand-in) was told the outside, then the inside: the way taken.
  const told = (await realm<{ name: string; body?: { X: number; Z: number } }[]>(page, "api")).filter((c) => c.name === "position").map((c) => `${c.body!.X},${c.body!.Z}`);
  expect(told).toContain(WEST.outside.join(","));
  expect(told).toContain(WEST.inside.join(","));
  expect(await jumps(page)).toBe(0);
  await shot(page, "2-arrived-west");
  expect(errors).toEqual([]);
});

test("walking onto an exit of the grounds comes out beside the icon facing away, and standing there goes nowhere", async ({ page }) => {
  const errors = await open(page, { x: 204, z: 44 });
  await until(page, async () => (await realm<boolean>(page, "streamed")) === true, "the grounds built");
  expect(await realm<string | null>(page, "map.town")).toBe("twoford");
  expect(await realm<string>(page, "area.name")).toBe("Twoford");
  await clickTile(page, WEST.exit[1][0], WEST.exit[1][1]);
  const { iris } = await arrive(page, tile(WEST.outside), 0, "out on the travel map by the west way");
  expect(iris).toBe(true);
  expect(onTravel(await here(page))).toBe(true);
  // Facing west, away from the icon.
  const facing = await page.evaluate(() => (globalThis as any).realmTest.game.player.figure.facing as number);
  expect(Math.abs(Math.sin(facing) + 1)).toBeLessThan(0.05);
  await until(page, async () => (await realm<string | null>(page, "map.town")) === null, "the regional map");
  expect(await realm<string>(page, "area.name")).toBe("The Twofields");
  await shot(page, "3-out-west");
  // Standing on the way's outside is no way in: a few seconds later the player is still there.
  await advance(page, 4);
  expect(await here(page)).toEqual(tile(WEST.outside));
  expect(await realm<boolean>(page, "transitioning")).toBe(false);
  expect(await jumps(page)).toBe(0);
  expect(errors).toEqual([]);
});

test("a held walk pushing into the icon from its south way goes in, onto the road from the south", async ({ page }) => {
  const errors = await open(page, { x: 48, z: 47 });
  await until(page, async () => (await realm<boolean>(page, "streamed")) === true, "the travel map built");
  const press = await page.evaluate(([x, z]) => (globalThis as any).realmTest.screenOfTile(x, z), [48, 46] as const);
  const icon = await page.evaluate(([x, z]) => (globalThis as any).realmTest.screenOfTile(x, z), [SITE[0], SITE[1] - 1] as const);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await advance(page, 0.2);
  await page.mouse.move(icon.x, icon.y, { steps: 6 });
  let iris = false;
  await until(page, async () => (iris ||= await realm<boolean>(page, "transitioning")), "the iris closes on the icon", 15);
  await page.mouse.up();
  await arrive(page, tile(SOUTH.inside), 1, "in Twoford by its south way");
  expect(iris).toBe(true);
  expect(await realm<string>(page, "area.name")).toBe("Twoford");
  // Facing north, into the town.
  const facing = await page.evaluate(() => (globalThis as any).realmTest.game.player.figure.facing as number);
  expect(Math.abs(Math.cos(facing) + 1)).toBeLessThan(0.05);
  await shot(page, "4-held-in-south");
  expect(errors).toEqual([]);
});

test("the grounds are left only by walking onto an exit: a held walk steered far past their edge beside the road stays, along the road it leaves", async ({ page }) => {
  const errors = await open(page, tile(CENTER));
  await until(page, async () => (await realm<boolean>(page, "streamed")) === true, "the grounds built");
  const steer = (x: number, z: number) => page.evaluate(([a, b]) => (globalThis as any).sliceStage.player.steer({ x: a, z: b }), [x, z] as const);
  // Far west past the grounds' edge, north of the west road's exits: it slides along the bank and stops, in the grounds.
  await steer(GROUNDS[0] - 60, WEST.exit[0][1] - 20);
  await advance(page, 25);
  expect(await realm<boolean>(page, "transitioning")).toBe(false);
  expect(inGrounds(await here(page)), `still in the grounds at ${JSON.stringify(await here(page))}`).toBe(true);
  // From the middle again, far south-west past the edge, south of the exits: the same. (Steered on from the bank by
  // the road, a walk slides along the bank into the road and onto an exit - walked onto, it leaves.)
  await page.evaluate(() => (globalThis as any).sliceStage.player.steer(null));
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.placePlayer(x, z), [CENTER[0], CENTER[1]] as const);
  await advance(page, 0.5);
  await steer(GROUNDS[0] - 60, WEST.exit[2][1] + 30);
  await advance(page, 20);
  expect(inGrounds(await here(page)), (await page.evaluate(() => (globalThis as any).realmTest.game.trace as string[])).slice(-12).join(" | ")).toBe(true);
  await page.evaluate(() => (globalThis as any).sliceStage.player.steer(null));
  // A click far past the edge walks as near as it may, in the grounds.
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [WEST.exit[1][0] - 1, WEST.exit[0][1] - 6] as const);
  await advance(page, 15);
  expect(inGrounds(await here(page))).toBe(true);
  expect(await realm<boolean>(page, "transitioning")).toBe(false);
  // Along the road from its inside, steered far past its exit: onto the exit, and out beside the icon.
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.placePlayer(x, z), [WEST.inside[0], WEST.inside[1]] as const);
  await advance(page, 0.5);
  await steer(GROUNDS[0] - 60, WEST.inside[1] + 0.5);
  await arrive(page, tile(WEST.outside), 0, "out by the west way");
  expect(errors).toEqual([]);
});

test("on the travel map a click on ground past the icon walks there round it, and does not go in", async ({ page }) => {
  const errors = await open(page, { x: SITE[0] - 8, z: SITE[1] });
  await until(page, async () => (await realm<boolean>(page, "streamed")) === true, "the travel map built");
  // Open ground beyond the icon, north-east of it from the player: walked to, round the icon, never into the town.
  let beyond: Tile | null = null;
  for (const t of [{ x: SITE[0] + 5, z: SITE[1] - 4 }, { x: SITE[0] + 5, z: SITE[1] + 4 }, { x: SITE[0] + 6, z: SITE[1] }, { x: SITE[0], z: SITE[1] - 5 }])
    if (!beyond && (await page.evaluate(([x, z]) => (globalThis as any).realmTest.walkable(x, z), [t.x, t.z] as const))) beyond = t;
  expect(beyond, "open ground past the icon").not.toBeNull();
  await clickTile(page, beyond!.x, beyond!.z);
  let iris = false;
  await until(
    page,
    async () => {
      iris ||= await realm<boolean>(page, "transitioning");
      return !(await page.evaluate(() => (globalThis as any).sliceTest.player.moving));
    },
    "the walk ends",
    20,
  );
  expect(iris, "no way taken").toBe(false);
  expect(await here(page)).toEqual(beyond);
  expect(onTravel(await here(page))).toBe(true);
  expect(errors).toEqual([]);
});

test("in the grounds the camera never shows the void past them, at any heading or zoom", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await open(page, { x: BASIN[0] + 1, z: BASIN[1] + 1 });
  // Two corners of the walked ground (the bank round them two terraces high: raised ground is seen further up the screen)
  // and the town's middle.
  const corners: Tile[] = [{ x: BASIN[0] + 1, z: BASIN[1] + 1 }, { x: BASIN[2] - 2, z: BASIN[3] - 2 }, tile(CENTER)];
  const shares: string[] = [];
  for (const [i, at] of corners.entries()) {
    await page.evaluate(([x, z]) => (globalThis as any).realmTest.placePlayer(x, z), [at.x, at.z] as const);
    for (const heading of [-1, 0, 1] as const) {
      // Turn to the heading, then try every zoom out from the closest: those the grounds cannot hold are refused.
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
        const share = await voidShare(page);
        const step = await realm<number>(page, "zoom.step");
        shares.push(`${at.x},${at.z} heading ${heading} zoom ${step}: ${(share * 100).toFixed(3)}%`);
        if (zoom === step) await shot(page, `5-void-${i}-${heading}-${step}`);
        expect(share, shares.at(-1)).toBeLessThan(0.0005);
      }
    }
  }
  expect(errors).toEqual([]);
});

test("the whole map writes the land's names on the travel map, and in the grounds turns from the town's to the world's", async ({ page }) => {
  await open(page, { x: 30, z: 40 });
  await until(page, async () => (await realm<boolean>(page, "streamed")) === true, "the travel map built");
  await clickControl(page, "hud:minimap");
  await until(page, async () => (await realm<boolean>(page, "map.open")) === true, "the map open");
  const labels = (await realm<{ name: string; text: string }[]>(page, "controls")).filter((c) => c.name === "map:label").map((c) => c.text);
  expect(labels.sort()).toEqual(["Goblin Heights", "The Glass Sea", "Twoland"]);
  await shot(page, "6-world-map");
  await clickControl(page, "map:close");
  // In the grounds: the town's map, its south gate named for the caves its road leads to, and a way to the world's.
  await open(page, tile(SOUTH.inside));
  await until(page, async () => (await realm<string | null>(page, "map.town")) === "twoford", "the town's map");
  await clickControl(page, "hud:minimap");
  await until(page, async () => (await realm<string>(page, "map.view")) === "town", "the town's whole map");
  const gates = (await realm<{ name: string; text: string }[]>(page, "controls")).filter((c) => c.name === "map:gate").map((c) => c.text);
  expect(gates).toContain("To The Twoford Caves");
  await shot(page, "7-town-map");
  await clickControl(page, "map:switch");
  await until(page, async () => (await realm<string>(page, "map.view")) === "world", "the world's map from the town");
  await shot(page, "8-world-from-town");
});
