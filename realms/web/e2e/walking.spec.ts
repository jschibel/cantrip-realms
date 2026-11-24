import { type Page, expect, test } from "@playwright/test";
import { doorOf } from "./places";
import { type Tile, advance, at, openNear, openRealm, realm } from "./realm";

// Walking beside buildings, frame by frame (realmTest.track notes where the figure is drawn every sixtieth): holding the
// button walks straight at the cursor and slides along the shop's walls, never jumping, turning back and forth or
// stopping and starting; a held walk goes up to the shop's door but never in; letting go stops the player where it
// stands; a click walks round the shop without a jump, in straight legs, and a line of sight is one straight walk; and
// a player opened on a raised square stands on it from the first frame.

interface Frame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly fx: number;
  readonly fz: number;
  readonly facing: number;
  readonly moving: boolean;
}

/** The most a figure walking at 4.2 tiles a second goes in a sixtieth, and a little over. */
const STRIDE = (4.2 / 60) * 1.1;
const SHOP = "argive-goblin-trader-shop";

const track = (page: Page, seconds: number) => page.evaluate((s) => (globalThis as any).realmTest.track(s) as Promise<Frame[]>, seconds);

const playerOnPage = (page: Page) =>
  page.evaluate(() => {
    const s = (globalThis as any).sliceStage;
    const p = s.player.position;
    return s.toScreen(p.clone().setY(p.y + 0.4)) as { x: number; y: number };
  });

const tileOnPage = (page: Page, t: Tile) => page.evaluate(([x, z]) => (globalThis as any).realmTest.screenOfTile(x, z) as { x: number; y: number }, [t.x, t.z] as const);

const walkable = (page: Page, t: Tile) => page.evaluate(([x, z]) => (globalThis as any).realmTest.walkable(x, z) as boolean, [t.x, t.z] as const);

/** How the figure moved over some frames: its longest step and the camera's, and how often it turned back or stopped and went on. */
function motion(frames: readonly Frame[]) {
  let step = 0;
  let camera = 0;
  let rise = 0;
  let reversals = 0;
  let restarts = 0;
  let stood = false;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    step = Math.max(step, d);
    camera = Math.max(camera, Math.hypot(b.fx - a.fx, b.fz - a.fz));
    rise = Math.max(rise, Math.abs(b.y - a.y));
    if (d < 1e-5) stood = true;
    else if (stood) {
      restarts++;
      stood = false;
    }
    if (i >= 2) {
      const c = frames[i - 2]!;
      const ux = a.x - c.x;
      const uz = a.z - c.z;
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const lu = Math.hypot(ux, uz);
      const lv = Math.hypot(vx, vz);
      if (lu > 0.004 && lv > 0.004 && ux * vx + uz * vz < -0.5 * lu * lv) reversals++;
    }
  }
  return { step, camera, rise, reversals, restarts };
}

/** No jump, no turning back, the camera as smooth as the walk. */
function smooth(what: string, frames: readonly Frame[]): ReturnType<typeof motion> {
  const m = motion(frames);
  expect(m.step, `${what}: the longest step in a frame`).toBeLessThanOrEqual(STRIDE);
  expect(m.camera, `${what}: the camera's longest step in a frame`).toBeLessThanOrEqual(STRIDE);
  // A step up or down is eased over a few frames, never popped.
  expect(m.rise, `${what}: up or down in a frame`).toBeLessThan(0.25);
  expect(m.reversals, `${what}: turned back`).toBe(0);
  return m;
}

/** Whether every frame that moves heads the same way, within a degree: a straight walk. */
function straight(frames: readonly Frame[]): boolean {
  const ways: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const dx = frames[i]!.x - frames[i - 1]!.x;
    const dz = frames[i]!.z - frames[i - 1]!.z;
    if (Math.hypot(dx, dz) > 0.01) ways.push(Math.atan2(dz, dx));
  }
  return ways.length > 10 && ways.every((w) => Math.abs(Math.atan2(Math.sin(w - ways[0]!), Math.cos(w - ways[0]!))) < Math.PI / 180);
}

/** The shop beside the player: the first closed tile north of it, and an open tile past the shop on the far side. */
async function shopFrom(page: Page, me: Tile): Promise<{ wall: Tile; past: Tile }> {
  let k = 1;
  while (k < 8 && (await walkable(page, { x: me.x, z: me.z - k }))) k++;
  const wall = { x: me.x, z: me.z - k };
  expect(await walkable(page, wall), "the shop north of the door").toBe(false);
  let past = wall;
  for (let j = k + 1; j < k + 16; j++) {
    past = { x: me.x, z: me.z - j };
    if (await walkable(page, past)) break;
  }
  expect(await walkable(page, past), "open ground behind the shop").toBe(true);
  return { wall, past };
}

test("walking: held beside a shop, the player follows the cursor smoothly, slides along its walls and never goes in", async ({ page }) => {
  const errors = await openRealm(page, { at: at(openNear(doorOf(SHOP), 2)), extra: "&mobs=0" });
  await advance(page, 0.5);
  const centre = await playerOnPage(page);

  // The cursor circles the player twice, held: the walk turns with it all the way round, against the shop's front too.
  await page.mouse.move(centre.x + 160, centre.y);
  await page.mouse.down();
  const circle: Frame[] = [];
  for (let i = 0; i <= 80; i++) {
    const a = (i / 40) * Math.PI * 2;
    await page.mouse.move(centre.x + 160 * Math.cos(a), centre.y + 160 * Math.sin(a));
    circle.push(...(await track(page, 3 / 60)));
  }
  expect(await realm<boolean>(page, "dragging")).toBe(true);
  const round = smooth("circling", circle.slice(20));
  expect(round.restarts, "circling: never stopped and went on").toBe(0);

  // Held still at points all round, the shop among them: the walk goes at each, slides along what is in the way and
  // stops where it can go no further - once, never stepping back and forth there.
  for (const [dx, dy] of [[0, -220], [220, -40], [-220, -40], [160, -200], [-160, -200], [0, 200]] as const) {
    await page.mouse.move(centre.x + dx, centre.y + dy);
    const held = await track(page, 1.6);
    const m = smooth(`held at ${dx},${dy}`, held.slice(2));
    expect(m.restarts, `held at ${dx},${dy}: stopped and went on`).toBe(0);
  }

  // The shop's door, held on by a drag: the walk goes up to it and stays outside.
  const door = await tileOnPage(page, doorOf(SHOP));
  await page.mouse.move(door.x, door.y);
  smooth("held on the door", await track(page, 2));
  await page.mouse.move(door.x, door.y - 30);
  smooth("held past the door", await track(page, 1));
  expect(await realm<string>(page, "space.id"), "a drag never goes through a door").toBe("world");

  // Let go mid-walk: it stops where it is, at once.
  await page.mouse.move(centre.x, centre.y + 220);
  await track(page, 0.5);
  await page.mouse.up();
  const after = await track(page, 0.5);
  expect(motion(after.slice(1)).step, "stopped where it was let go").toBeLessThan(1e-6);
  expect(after.at(-1)!.moving).toBe(false);
  expect(await realm<boolean>(page, "dragging")).toBe(false);
  expect(errors).toEqual([]);
});

test("walking: a click round a shop walks it in straight legs with no jump, and a clear line is one straight walk", async ({ page }) => {
  const errors = await openRealm(page, { at: at(openNear(doorOf(SHOP), 2)), extra: "&mobs=0" });
  await advance(page, 0.5);
  const me = (await realm<{ kind: string; tile: Tile }[]>(page, "entities")).find((e) => e.kind === "player")!.tile;
  const { past } = await shopFrom(page, me);

  // Behind the shop: round it, every frame a step at walking pace, never turning back; then back again.
  const walk = async (to: Tile, what: string) => {
    await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [to.x, to.z] as const);
    const frames: Frame[] = [];
    for (let i = 0; i < 20 && (frames.length === 0 || frames.at(-1)!.moving); i++) frames.push(...(await track(page, 0.5)));
    smooth(what, frames);
    return frames;
  };
  const there = await walk(past, "round the shop");
  expect(Math.floor(there.at(-1)!.x) === past.x && Math.floor(there.at(-1)!.z) === past.z, "behind the shop").toBe(true);
  await walk(me, "back round the shop");

  // A click in the middle of a walk takes it somewhere else from where it is: no jump.
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [past.x, past.z] as const);
  const before = await track(page, 0.4);
  const aside = openNear(me, 3);
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [aside.x, aside.z] as const);
  const turned = await track(page, 2);
  smooth("a click mid-walk", [...before, ...turned]);

  // A tile in plain sight off the eight ways (two across, five along, all open between): one straight walk, not a
  // diagonal then a straight.
  const here = (await realm<{ kind: string; tile: Tile }[]>(page, "entities")).find((e) => e.kind === "player")!.tile;
  let target: Tile | null = null;
  for (const [dx, dz] of [[5, 2], [-5, 2], [5, -2], [-5, -2], [2, 5], [-2, 5], [2, -5], [-2, -5], [4, 1], [-4, 1], [4, -1], [-4, -1], [1, 4], [-1, 4], [3, 1], [-3, 1]] as const) {
    // Every tile a body a little wider than the player's would touch on the line between the two tiles' middles is open.
    const touched = new Set<string>();
    for (let k = 0; k <= 100; k++) {
      const x = here.x + 0.5 + (dx * k) / 100;
      const z = here.z + 0.5 + (dz * k) / 100;
      for (const [ox, oz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) touched.add(`${Math.floor(x + ox!)},${Math.floor(z + oz!)}`);
    }
    let open = true;
    for (const t of touched) {
      const [x, z] = t.split(",").map(Number);
      if (!(await walkable(page, { x: x!, z: z! }))) open = false;
    }
    if (open) {
      target = { x: here.x + dx, z: here.z + dz };
      break;
    }
  }
  expect(target, "open ground off the eight ways near the shop").not.toBeNull();
  const onPage = await tileOnPage(page, target!);
  await page.mouse.click(onPage.x, onPage.y);
  const line: Frame[] = [];
  for (let i = 0; i < 8 && (line.length === 0 || line.at(-1)!.moving); i++) line.push(...(await track(page, 0.5)));
  smooth("in plain sight", line);
  expect(straight(line), "in plain sight: one straight line").toBe(true);
  expect(Math.floor(line.at(-1)!.x) === target!.x && Math.floor(line.at(-1)!.z) === target!.z).toBe(true);
  expect(errors).toEqual([]);
});

test("walking: opened by ?at= on a raised square, the player stands on it from the first frame, not sunk to its foot", async ({ page }) => {
  // New Benalia's square stands three quarters of a tile up, and a start at a world tile is put there before its chunk
  // is read.
  const errors = await openRealm(page, { at: "world:523,733", extra: "&mobs=0" });
  const stood = await page.evaluate(() => {
    const s = (globalThis as any).sliceStage;
    const p = s.player.position;
    return { y: p.y, floor: s.current.floorAt ? s.current.floorAt(p.x, p.z) : s.current.grid.heightAt(Math.floor(p.x), Math.floor(p.z)) };
  });
  expect(stood.floor, "the square is raised").toBeGreaterThan(0.5);
  expect(Math.abs(stood.y - stood.floor), "on the floor").toBeLessThan(0.01);
  const frames = await track(page, 0.5);
  expect(Math.max(...frames.map((f) => Math.abs(f.y - stood.floor))), "and stays there standing").toBeLessThan(0.01);
  expect(errors).toEqual([]);
});
