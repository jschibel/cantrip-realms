import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { type Tile, advance, openRealm, realm } from "./realm";

// Hopping a ledge a level high (world/format.ts HOP) on the large world's terraced hills (?world=large), with the real
// mouse (the camera looking north, as ever): held off the brink, the player hops down; a click on the terrace above
// walks to the brink and hops up. Each is followed frame by frame (realmTest.track): every frame a walk's step, the
// figure rising and falling on an arc over several frames and never popped, across the edge only mid-hop and no longer
// than a hop takes, landing on the other level. Frames of each hop are pictured (REALM_SHOTS=1 writes
// e2e/screenshots/hop, else test-results/hop).

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.REALM_SHOTS ? join(here, "screenshots", "hop") : join(here, "..", "test-results", "hop");
mkdirSync(out, { recursive: true });

interface Frame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly moving: boolean;
  readonly hopping: boolean;
}

/** The most a walk at 4.2 tiles a second goes in a sixtieth, and a little over. */
const STRIDE = (4.2 / 60) * 1.2;
/** The most frames a hop at 4.2 tiles a second takes to cross 0.6 tiles (the body's width), and a little over. */
const HOP_FRAMES = Math.ceil(0.6 / (4.2 / 60)) + 2;
/** A tile by the hills' ramp (fixtures/large-world/source.ts HILLS). */
const HILLS = { x: 200, z: 72 };

const track = (page: Page, seconds: number) => page.evaluate((s) => (globalThis as any).realmTest.track(s) as Promise<Frame[]>, seconds);
const screenOf = (page: Page, t: Tile) => page.evaluate(([x, z]) => (globalThis as any).realmTest.screenOfTile(x, z) as { x: number; y: number }, [t.x, t.z] as const);

/**
 * The brink of a straight ledge a level high on the hills, nearest the ramp: an open tile with open ground a level below
 * it to the west, the same for two rows either side, its own level east of it and the low ground west for three tiles -
 * read from the grid the page walks.
 */
function brinkOf(page: Page): Promise<{ at: Tile; below: Tile; top: number; low: number }> {
  return page.evaluate(([hx, hz]) => {
    const g = (globalThis as any).sliceStage.current.grid;
    const level = (x: number, z: number, h: number) => g.walkable(x, z) && Math.abs(g.heightAt(x, z) - h) < 1e-6;
    for (let r = 0; r < 60; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = hx + dx;
          const z = hz + dz;
          const top = g.heightAt(x, z);
          const low = top - 0.75;
          let room = top > 0;
          for (let k = -2; k <= 2 && room; k++) {
            room = g.hops(x - 1, z + k, x, z + k);
            for (let e = 0; e <= 3 && room; e++) room = level(x + e, z + k, top) && level(x - 1 - e, z + k, low);
          }
          if (room) return { at: { x, z }, below: { x: x - 1, z }, top, low };
        }
      }
    }
    throw new Error("no ledge a level high on the hills");
  }, [HILLS.x, HILLS.z] as const);
}

/** Every frame a walk at most STRIDE, up or down no more than 0.25; mid-hop at most HOP_FRAMES running, and some. */
function hopped(what: string, frames: readonly Frame[]): Frame[] {
  let run = 0;
  for (let i = 1; i < frames.length; i++) {
    const [a, b] = [frames[i - 1]!, frames[i]!];
    expect(Math.hypot(b.x - a.x, b.z - a.z), `${what}: frame ${i}'s step`).toBeLessThanOrEqual(STRIDE);
    expect(Math.abs(b.y - a.y), `${what}: frame ${i} up or down`).toBeLessThan(0.25);
    run = b.hopping ? run + 1 : 0;
    expect(run, `${what}: mid-hop frames running`).toBeLessThanOrEqual(HOP_FRAMES);
  }
  const mid = frames.filter((f) => f.hopping);
  expect(mid.length, `${what}: frames mid-hop`).toBeGreaterThan(3);
  return mid;
}

/** Tracks frame by frame while `going`, a picture of every second frame from just before the hop to just after. */
async function hopFrames(page: Page, name: string, seconds: number, aim?: () => Promise<void>): Promise<Frame[]> {
  const frames: Frame[] = [];
  let shots = 0;
  let after = 0;
  for (let i = 0; i < seconds * 60; i++) {
    if (aim && i % 6 === 0) await aim();
    const f = (await track(page, 1 / 60))[0]!;
    frames.push(f);
    if (f.hopping) after = 4;
    else if (after > 0) after--;
    if ((f.hopping || after > 0) && i % 2 === 0 && shots < 8) await page.screenshot({ path: join(out, `${name}-${String(shots++).padStart(2, "0")}.png`) });
  }
  return frames;
}

test("hop: a walker that hops goes over the ledge tile to tile as a mob walks, one that does not goes round by a ramp or not at all", async ({ page }) => {
  const errors = await openRealm(page, { at: `world:${HILLS.x},${HILLS.z}`, extra: "&world=large&mobs=0&zoom=0" });
  const { at: brink, below, low, top } = await brinkOf(page);
  // The page's own walker (an Actor, as every mob is: render/actor.ts), walked as a mob walks - tile middle to tile
  // middle at a chase's pace - hopping or not as a mob's file says (entities.ts sets `hops` from it).
  const walk = (hops: boolean) =>
    page.evaluate(
      async ([bx, bz, tx, tz, hops]) => {
        const o = (globalThis as any).realmTest.game;
        const actor = o.stage.player;
        actor.smooth = false;
        actor.hops = hops;
        actor.speed = 2.6;
        actor.place({ x: bx, z: bz });
        const went = actor.goTo({ x: tx, z: tz }) as boolean;
        const frames: { x: number; y: number; z: number; hopping: boolean }[] = [];
        for (let i = 0; i < 60 * 30 && actor.moving; i++) {
          o.tick(1 / 60);
          const p = actor.position;
          frames.push({ x: p.x, y: p.y, z: p.z, hopping: actor.hopping });
        }
        return { went, frames };
      },
      [below.x - 1, below.z, brink.x + 1, brink.z, hops] as const,
    );
  // One that hops: straight up over the brink, on an arc, there.
  const hopper = await walk(true);
  expect(hopper.went).toBe(true);
  const over = hopper.frames.filter((f) => f.hopping);
  expect(over.length).toBeGreaterThan(3);
  expect(Math.max(...over.map((f) => f.y))).toBeGreaterThan(top + 0.03);
  expect(hopper.frames.at(-1)!.y).toBeCloseTo(top, 2);
  for (let i = 1; i < hopper.frames.length; i++) expect(Math.abs(hopper.frames[i]!.y - hopper.frames[i - 1]!.y)).toBeLessThan(0.25);
  // One that does not: never across the ledge; round by the hills' ramp if the grid read reaches it, else no way.
  const zombie = await walk(false);
  expect(zombie.frames.some((f) => f.hopping)).toBe(false);
  if (zombie.went) {
    expect(zombie.frames.at(-1)!.y).toBeCloseTo(top, 2);
    expect(zombie.frames.length, "a long way round").toBeGreaterThan(hopper.frames.length);
  } else expect(zombie.frames.length).toBe(0);
  expect(low).toBeLessThan(top);
  expect(errors).toEqual([]);
});

for (const heading of ["front"] as const) {
  test(`hop: held off a ledge the player hops down, a click above hops it up - real mouse, the camera ${heading}`, async ({ page }) => {
    const errors = await openRealm(page, { at: `world:${HILLS.x},${HILLS.z}`, extra: `&world=large&mobs=0&zoom=0` });
    const { at: brink, below, top, low } = await brinkOf(page);
    // Stood on the top, two tiles in from the brink.
    await page.evaluate(([x, z]) => (globalThis as any).sliceStage.player.place({ x, z }), [brink.x + 2, brink.z] as const);
    await advance(page, 0.5);
    expect(await realm<string>(page, "heading")).toBe(heading);

    // Held at the low ground west, the cursor kept on it as the camera follows: a hop down, straight across, on.
    const westTile = { x: below.x - 2, z: brink.z };
    let aim = await screenOf(page, westTile);
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down();
    const down = await hopFrames(page, `${heading}-down`, 1.2, async () => {
      aim = await screenOf(page, westTile);
      await page.mouse.move(aim.x, aim.y);
    });
    await page.mouse.up();
    expect(await realm<boolean>(page, "dragging")).toBe(false);
    const fell = hopped("held off the brink", down);
    // Straight across (no slant), off and down: rising a little first.
    for (const f of fell) expect(Math.floor(f.z)).toBe(brink.z);
    expect(Math.max(...fell.map((f) => f.y)), "off the brink, a little up first").toBeGreaterThan(top + 0.03);
    await advance(page, 0.5);
    const landed = down.at(-1)!;
    expect(landed.x).toBeLessThan(brink.x - 0.3);
    expect(landed.y).toBeCloseTo(low, 2);

    // A click on the top: to the brink, and up over it.
    const goal = { x: brink.x + 2, z: brink.z };
    const there = await screenOf(page, goal);
    await page.mouse.click(there.x, there.y);
    const up = await hopFrames(page, `${heading}-up`, 2);
    const rose = hopped("clicked up", up);
    expect(Math.max(...rose.map((f) => f.y)), "up and over the brink").toBeGreaterThan(top + 0.03);
    const end = up.at(-1)!;
    expect(end.moving).toBe(false);
    expect([Math.floor(end.x), Math.floor(end.z)]).toEqual([goal.x, goal.z]);
    expect(end.y).toBeCloseTo(top, 2);
    expect(errors).toEqual([]);
  });
}
