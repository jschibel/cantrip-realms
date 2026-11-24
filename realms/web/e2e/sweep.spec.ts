import { type Page, expect, test } from "@playwright/test";
import { ledgeBrink } from "./places";
import { advance, at, openNear, openRealm, world } from "./realm";

// The player walked about towns and the country round them, frame by frame, looking for teleports: clicks to open tiles
// across streets and squares and held walks steered every way - into walls, along them, up to doors and the brinks of
// terraces - each frame checked as it is drawn: no move further than a walk goes in a frame, no rise or drop popped, the
// body never over a closed tile nor across a ledge. And a ledge itself: walked up to and along, never over. Every
// finding names its walk and both positions. SWEEP_TOWNS (town ids, comma-separated) and SWEEP_WALKS sweep more.

/** The most a walk at 4.2 tiles a second goes in a sixtieth, and a little over. */
const STRIDE = (4.2 / 60) * 1.2;
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
    async ({ walks, radius, seed, stride }) => {
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
      const watch = (walk: string) => {
        const st = o.stage;
        const pl = st.player;
        const p = pl.figure.root.position;
        if (last && last.figure === pl && !st.transition) {
          const flat = Math.hypot(p.x - last.x, p.z - last.z);
          if (flat > stride) out.push({ kind: `moved ${flat.toFixed(2)} in a frame`, walk, from: [last.x, last.z], to: [p.x, p.z] });
          if (Math.abs(p.y - last.y) > 0.25) out.push({ kind: `rose ${(p.y - last.y).toFixed(2)} in a frame`, walk, from: [last.x, last.z], to: [p.x, p.z] });
        }
        // The body (0.3 either way of its middle) on open tiles and across no ledge.
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
        if (!fits && !st.transition && !o.ferrying) out.push({ kind: "the body over a closed tile or a ledge", walk, from: [pl.position.x, pl.position.z], to: [x0, z0] });
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
    { walks, radius, seed, stride: STRIDE },
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

test("sweep: a ledge is walked up to and along, never over, and the body stops flush with its brink", async ({ page }) => {
  const { at: brink, below } = ledgeBrink();
  await openRealm(page, { at: at({ x: brink.x + 2, z: brink.z }), extra: "&mobs=0" });
  const state = () =>
    page.evaluate(() => {
      const p = (globalThis as any).sliceStage.player.position;
      return { x: p.x as number, y: p.y as number, z: p.z as number };
    });
  const top = await state();
  const steer = (x: number, z: number) => page.evaluate(([a, b]) => (globalThis as any).sliceStage.player.steer({ x: a, z: b }), [x, z] as const);
  // Held west, off the brink: stopped flush with it, still on the top.
  await steer(below.x - 4, brink.z + 0.5);
  await advance(page, 2);
  const stopped = await state();
  expect(stopped.x).toBeCloseTo(brink.x + 0.3, 2);
  expect(stopped.y).toBeCloseTo(top.y, 2);
  // Held along it, a little into it: slides along the brink, still on the top.
  await steer(brink.x, brink.z + 2.5);
  await advance(page, 1);
  const along = await state();
  expect(along.z).toBeGreaterThan(stopped.z + 1);
  expect(along.x).toBeCloseTo(brink.x + 0.3, 2);
  expect(along.y).toBeCloseTo(top.y, 2);
  await page.evaluate(() => (globalThis as any).sliceStage.player.steer(null));
  // The tile below is no step from the brink.
  expect(await page.evaluate(([a, b, c, d]) => (globalThis as any).sliceStage.current.grid.canStep({ x: a, z: b }, { x: c, z: d }), [brink.x, brink.z, below.x, below.z] as const)).toBe(false);
});
