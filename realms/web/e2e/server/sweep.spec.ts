import { expect, test } from "@playwright/test";
import { openNear, waitReady, waitSpace, world } from "../realm";
import { character, place, query } from "./server";

// The sweep against the real server (e2e/sweep.spec.ts is the offline one), on the page's own clock: clicks and held walks
// round towns, every frame-to-frame move of the figure further than its walk could go and every walk the relay refused
// noted with the walk and where (each also logged as it happens, `[sweep] ...`). Minutes a town, so only on asking:
// REALMS_SWEEP=1, with SWEEP_TOWNS (town ids, comma-separated) and SWEEP_WALKS.

const TOWNS = (process.env.SWEEP_TOWNS ?? "new-benalia,capashen-hold").split(",");
const WALKS = Number(process.env.SWEEP_WALKS ?? 30);

for (const [n, id] of TOWNS.entries()) {
  test(`server sweep: walked about ${id}, no walk refused and the figure never jumps`, async ({ page }) => {
    test.skip(!process.env.REALMS_SWEEP, "the long sweep: REALMS_SWEEP=1");
    test.setTimeout(WALKS * 40_000);
    const town = world().towns.find((t) => t.id === id)!;
    await character(page.request, 900 + n, `Sweeper${n}`);
    await place(page.request, openNear({ x: town.center[0], z: town.center[1] }, 6));
    const logs: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "warning") logs.push(m.text());
      if (m.text().startsWith("[sweep]")) console.log(m.text());
    });
    await page.goto(query("&mobs=0"));
    await waitReady(page);
    await waitSpace(page, "world");
    const found = await page.evaluate(
      async ({ walks, radius, seed }) => {
        const rt = (globalThis as any).realmTest;
        const o = rt.game;
        const out: unknown[] = [];
        const say = (f: unknown) => {
          out.push(f);
          console.log(`[sweep] ${JSON.stringify(f)}`);
        };
        let s = seed;
        const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
        const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
        let last: { a: unknown; x: number; y: number; z: number; t: number } | null = null;
        let walk = "start";
        let refusals = 0;
        const after = o.stage.afterTick;
        o.stage.afterTick = (dt: number) => {
          after(dt);
          const st = o.stage;
          const pl = st.player;
          const p = pl.figure.root.position;
          if (last && last.a === pl && !st.transition) {
            const flat = Math.hypot(p.x - last.x, p.z - last.z);
            const rise = Math.abs(p.y - last.y);
            if (flat > 4.2 * dt * 1.2 + 0.01 || rise > 0.3) say({ kind: "jump", walk, dt, from: [last.x, last.y, last.z], to: [p.x, p.y, p.z], refused: o.refusals.slice(refusals) });
          }
          if (o.refusals.length > refusals) {
            say({ kind: "refused", walk, at: [p.x, p.z], reasons: o.refusals.slice(refusals) });
            refusals = o.refusals.length;
          }
          last = { a: pl, x: p.x, y: p.y, z: p.z, t: st.time };
        };
        const wait = async (seconds: number, stop?: () => boolean) => {
          const until = o.stage.time + seconds;
          while (o.stage.time < until && !(stop?.())) await frame();
        };
        const centre = { x: o.player.position.x, z: o.player.position.z };
        for (let w = 0; w < walks; w++) {
          const st = o.stage;
          if (st.current.id !== "world") break;
          const me = st.player.position;
          if (rnd() < 0.5) {
            let to = null;
            for (let k = 0; k < 40 && !to; k++) {
              const x = Math.floor(centre.x + (rnd() * 2 - 1) * radius);
              const z = Math.floor(centre.z + (rnd() * 2 - 1) * radius);
              if (st.current.grid.walkable(x, z) && !st.doorAt({ x, z })) to = { x, z };
            }
            if (!to) continue;
            walk = `click ${to.x},${to.z} from ${me.x.toFixed(2)},${me.z.toFixed(2)}`;
            st.clickTile(to);
            await wait(25, () => !st.player.moving);
          } else {
            const a = rnd() * Math.PI * 2;
            const dist = 3 + rnd() * 10;
            const point = { x: me.x + Math.cos(a) * dist, z: me.z + Math.sin(a) * dist };
            walk = `steer to ${point.x.toFixed(2)},${point.z.toFixed(2)} from ${me.x.toFixed(2)},${me.z.toFixed(2)}`;
            st.player.steer(point);
            await wait(2 + rnd() * 3);
            st.player.steer(null);
          }
          await wait(rnd() * 0.5);
        }
        o.stage.afterTick = after;
        return out;
      },
      { walks: WALKS, radius: Math.min(town.radius, 40), seed: 11 + n },
    );
    expect(found, logs.slice(0, 20).join(" | ")).toEqual([]);
  });
}
