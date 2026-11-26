import { type Page, expect, test } from "@playwright/test";
import { ledgeBrink } from "./places";
import { advance, at, openNear, openRealm, realm, world } from "./realm";

// The player walked about towns and the country round them, frame by frame, looking for teleports: clicks to open tiles
// across streets and squares and held walks steered every way - into walls, along them, up to doors and the brinks of
// terraces, and over them - each frame checked as it is drawn: no move further than a walk goes in a frame, no rise or
// drop popped (a hop's arc rises and falls over several), the body never over a closed tile nor across a ledge but
// mid-hop, and never mid-hop longer than a hop takes. And a ledge a level high itself: walked up to and along, hopped
// whole, held or clicked, flush to flush. Every finding names its walk and both positions. SWEEP_TOWNS (town ids,
// comma-separated) and SWEEP_WALKS sweep more.

/** The most a walk at 4.2 tiles a second goes in a sixtieth, and a little over. */
const STRIDE = (4.2 / 60) * 1.2;
/** The most frames a hop at 4.2 tiles a second takes to cross 0.6 tiles (the body's width), and a little over. */
const HOP_FRAMES = Math.ceil(0.6 / (4.2 / 60)) + 2;
const TOWNS = (process.env.SWEEP_TOWNS ?? "new-benalia,capashen-hold").split(",");
const WALKS = Number(process.env.SWEEP_WALKS ?? 16);

interface Finding {
  readonly kind: string;
  readonly walk: string;
  readonly from: readonly number[];
  readonly to: readonly number[];
}

/**
 * `walks` walks from where the player stands, each a click on an open tile within `radius` (never a door) or a held walk
 * steered at a point a few tiles off for a few seconds, chosen by a seeded draw; every frame watched.
 */
function sweep(page: Page, walks: number, radius: number, seed: number): Promise<Finding[]> {
  return page.evaluate(
    async ({ walks, radius, seed, stride, hopFrames }) => {
      const o = (globalThis as any).realmTest.game;
      const out: Finding[] = [];
      let s = seed;
      const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
      const frame = () => new Promise<void>((r) => {
        const c = new MessageChannel();
        c.port1.onmessage = () => r();
        c.port2.postMessage(0);
      });
      let last: { figure: unknown; x: number; y: number; z: number } | null = null;
      let hopping = 0;
      const watch = (walk: string) => {
        const st = o.stage;
        const pl = st.player;
        const p = pl.figure.root.position;
        if (last && last.figure === pl && !st.transition) {
          const flat = Math.hypot(p.x - last.x, p.z - last.z);
          if (flat > stride) out.push({ kind: `moved ${flat.toFixed(2)} in a frame`, walk, from: [last.x, last.z], to: [p.x, p.z] });
          if (Math.abs(p.y - last.y) > 0.25) out.push({ kind: `rose ${(p.y - last.y).toFixed(2)} in a frame`, walk, from: [last.x, last.z], to: [p.x, p.z] });
        }
        // The body (0.3 either way of its middle) on open tiles and across no ledge, but mid-hop - never for longer than
        // a hop takes.
        hopping = pl.hopping ? hopping + 1 : 0;
        if (hopping === hopFrames + 1) out.push({ kind: `across a hop's edge ${hopping} frames`, walk, from: [pl.position.x, pl.position.z], to: [] });
        const g = st.current.grid;
        const r = 0.3 - 1e-6;
        const x0 = Math.floor(pl.position.x - r);
        const x1 = Math.floor(pl.position.x + r);
        const z0 = Math.floor(pl.position.z - r);
        const z1 = Math.floor(pl.position.z + r);
        let fits = true;
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            if (!g.walkable(x, z) || (x < x1 && !g.passes(x, z, x + 1, z)) || (z < z1 && !g.passes(x, z, x, z + 1))) fits = false;
          }
        }
        if (!fits && !pl.hopping && !st.transition && !o.ferrying) out.push({ kind: "the body over a closed tile or a ledge", walk, from: [pl.position.x, pl.position.z], to: [x0, z0] });
        last = { figure: pl, x: p.x, y: p.y, z: p.z };
      };
      const run = async (frames: number, walk: string, stop?: () => boolean) => {
        for (let i = 0; i < frames && !stop?.(); i++) {
          o.tick(1 / 60);
          watch(walk);
          if (o.stage.transition) return;
          if (i % 2 === 0) await frame();
        }
      };
      const centre = { x: o.player.position.x, z: o.player.position.z };
      for (let w = 0; w < walks && o.stage.current.id === "world"; w++) {
        const st = o.stage;
        const me = st.player.position;
        const from = `from ${me.x.toFixed(2)},${me.z.toFixed(2)}`;
        if (rnd() < 0.5) {
          let to: { x: number; z: number } | null = null;
          for (let k = 0; k < 40 && !to; k++) {
            const x = Math.floor(centre.x + (rnd() * 2 - 1) * radius);
            const z = Math.floor(centre.z + (rnd() * 2 - 1) * radius);
            if (st.current.grid.walkable(x, z) && !st.doorAt({ x, z })) to = { x, z };
          }
          if (!to) continue;
          st.clickTile(to);
          await run(60 * 20, `click ${to.x},${to.z} ${from}`, () => !st.player.moving);
        } else {
          const a = rnd() * Math.PI * 2;
          const d = 3 + rnd() * 10;
          const point = { x: me.x + Math.cos(a) * d, z: me.z + Math.sin(a) * d };
          st.player.steer(point);
          await run(60 * (1 + rnd() * 3), `held toward ${point.x.toFixed(2)},${point.z.toFixed(2)} ${from}`);
          st.player.steer(null);
        }
        if (st.transition || st.current.id !== "world") out.push({ kind: `went through a door into ${st.current.id}`, walk: `walk ${w}`, from: [me.x, me.z], to: [] });
      }
      return out;
    },
    { walks, radius, seed, stride: STRIDE, hopFrames: HOP_FRAMES },
  );
}

for (const [n, id] of TOWNS.entries()) {
  test(`sweep: walked about ${id} and the country round it, the player never jumps`, async ({ page }) => {
    test.setTimeout(Math.max(120_000, WALKS * 12_000));
    const town = world().towns.find((t) => t.id === id)!;
    const errors = await openRealm(page, { at: at(openNear({ x: town.center[0], z: town.center[1] }, 6)), extra: "&mobs=0" });
    expect(await sweep(page, WALKS, Math.min(town.radius + 12, 48), 7 + n)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

interface Frame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hopping: boolean;
}

/** Every frame a walk at most STRIDE, up or down no more than 0.25; mid-hop at most HOP_FRAMES running. */
function hopsSmoothly(what: string, frames: readonly Frame[]): void {
  let run = 0;
  for (let i = 1; i < frames.length; i++) {
    const [a, b] = [frames[i - 1]!, frames[i]!];
    expect(Math.hypot(b.x - a.x, b.z - a.z), `${what}: frame ${i}'s step`).toBeLessThanOrEqual(STRIDE);
    expect(Math.abs(b.y - a.y), `${what}: frame ${i} up or down`).toBeLessThan(0.25);
    run = b.hopping ? run + 1 : 0;
    expect(run, `${what}: mid-hop frames running`).toBeLessThanOrEqual(HOP_FRAMES);
  }
}

test("sweep: a ledge a level high is walked up to and along, and hopped whole - held or clicked, flush to flush, on an arc", async ({ page }) => {
  const { at: brink, below } = ledgeBrink();
  await openRealm(page, { at: at({ x: brink.x + 2, z: brink.z }), extra: "&mobs=0" });
  const state = () =>
    page.evaluate(() => {
      const p = (globalThis as any).sliceStage.player.position;
      return { x: p.x as number, y: p.y as number, z: p.z as number };
    });
  const track = (seconds: number) => page.evaluate((s) => (globalThis as any).realmTest.track(s) as Promise<Frame[]>, seconds);
  const top = await state();
  const low = await page.evaluate(([x, z]) => (globalThis as any).sliceStage.current.floorAt(x + 0.5, z + 0.5) as number, [below.x, below.z] as const);
  expect(top.y - low).toBeCloseTo(0.75, 2);
  const steer = (x: number, z: number) => page.evaluate(([a, b]) => (globalThis as any).sliceStage.player.steer({ x: a, z: b }), [x, z] as const);
  // Held west at a point short of the brink: stopped flush with it, still on the top - no hop.
  await steer(brink.x + 0.1, brink.z + 0.5);
  await advance(page, 2);
  const stopped = await state();
  expect(stopped.x).toBeCloseTo(brink.x + 0.3, 2);
  expect(stopped.y).toBeCloseTo(top.y, 2);
  // Held along it, at a point on the top by the brink: slides along the brink, still on the top - no hop. (A point past
  // it below is hopped to once the walk is near enough that the push is mostly into the ledge.)
  await steer(brink.x + 0.1, brink.z + 2.5);
  await advance(page, 1);
  const along = await state();
  expect(along.z).toBeGreaterThan(stopped.z + 1);
  expect(along.x).toBeCloseTo(brink.x + 0.3, 2);
  expect(along.y).toBeCloseTo(top.y, 2);
  // Held west, off it: a hop down, straight across, off and down on an arc, and on west below.
  await steer(below.x - 3, along.z);
  const down = await track(1);
  await page.evaluate(() => (globalThis as any).sliceStage.player.steer(null));
  hopsSmoothly("held off the brink", down);
  const crossing = down.filter((f) => f.hopping);
  expect(crossing.length).toBeGreaterThan(3);
  for (const f of crossing) expect(f.z).toBeCloseTo(along.z, 6);
  expect(Math.max(...crossing.map((f) => f.y)), "a hop off the brink rises a little first").toBeGreaterThan(top.y + 0.03);
  const landed = down.at(-1)!;
  expect(landed.x).toBeLessThan(brink.x - 0.3);
  expect(landed.y).toBeCloseTo(low, 2);
  // The tile above is a step from below, a hop; a click on the top walks to the brink and hops up.
  expect(await page.evaluate(([a, b, c, d]) => (globalThis as any).sliceStage.current.grid.canStep({ x: a, z: b }, { x: c, z: d }), [below.x, brink.z, brink.x, brink.z] as const)).toBe(true);
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [brink.x + 1, brink.z] as const);
  const up = await track(2.5);
  hopsSmoothly("clicked up", up);
  const rising = up.filter((f) => f.hopping);
  expect(rising.length).toBeGreaterThan(3);
  expect(Math.max(...rising.map((f) => f.y)), "a hop up goes over the brink").toBeGreaterThan(top.y + 0.03);
  const there = up.at(-1)!;
  expect([Math.floor(there.x), Math.floor(there.z), there.y]).toEqual([brink.x + 1, brink.z, expect.closeTo(top.y, 2)]);
  expect(await realm<string[]>(page, "refused")).toEqual([]);
});
