import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { MESAS, mesaAt } from "../fixtures/large-world/mesas";
import { openRealm } from "./realm";

// The terrain's edges (render/ground.ts, renderer.ts): every terrace's brink and foot read at every heading, on the large
// synthetic world's mesas (fixtures/large-world: a snow, a sand, a rock and a tundra mesa, each a two-level cliff and a
// one-level bank with an inner corner and a ramp) and its grass hills. With EDGES_SHOTS=1 every view at every heading and
// zoom goes to test-results/edges for looking at (EDGES_SHOTS=snow,hills names some; hurloon and hurloon-north are
// places in the generated Domains; EDGES_ZOOMS=0,1 the zoom steps).

/** The large world's hills, by their ramp (fixtures/large-world/source.ts HILLS). */
const HILLS = [200, 72] as const;

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "test-results", "edges");
mkdirSync(out, { recursive: true });

function gamePage(at: readonly [number, number], heading: string, zoom: number): string {
  return `/?test&manual&offline&name=Tester&mobs=0&world=large&still&nohud&at=world:${at[0]},${at[1]}&heading=${heading}&zoom=${zoom}`;
}
async function open(page: Page, at: readonly [number, number], heading: string, zoom: number): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(gamePage(at, heading, zoom));
  await page.waitForFunction(() => (globalThis as any).sliceTest?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => (globalThis as any).sliceTest.advance(0.5));
  await page.mouse.move(2, 2);
  return errors;
}

const HEADINGS = ["left", "front", "right"] as const;

/** A texel in world units. */
const T = 1 / 16;

interface Probe {
  /** What the points are, for the failure's message. */
  readonly what: string;
  readonly points: readonly (readonly [number, number, number])[];
  /**
   * Whether each should be lighter or darker with the edges drawn than without; "lit", lighter by more than the plain
   * ground of its own level is (the point `inward` world units in from it, past the rim).
   */
  readonly expect: "lighter" | "lit" | "darker" | "same";
  readonly inward?: readonly [number, number];
}

/**
 * Where to look on a mesa (fixtures/large-world/mesas.ts) at a heading: the lip of its north brink (a drop away from
 * the camera at every heading), of its east bank's brink and of its west cliff's (seen along the view at the front
 * heading), the shade at the foot of its west cliff (hidden at the right heading, which looks from the south-east) and
 * of its east bank (hidden at the left), the cliff's shade reaching where the bank's does not, and the top of its cliff
 * lighter than the same ground drawn flat.
 */
function probes(i: number, heading: (typeof HEADINGS)[number]): Probe[] {
  const { x: x0, z: z0 } = mesaAt(i);
  const along = (from: number, to: number) => Array.from({ length: Math.round((to - from) * 4) + 1 }, (_, k) => from + k / 4);
  const out: Probe[] = [
    { what: "the north brink's lip", points: along(x0 + 1, x0 + 10).map((x) => [x, x < x0 + 6 ? 1.5 : 0.75, z0 + 1.5 * T] as const), expect: "lit", inward: [0, 9 * T] },
    { what: "the east bank's lip", points: along(z0 + 6, z0 + 13).map((z) => [x0 + 16 - 1.5 * T, 0.75, z] as const), expect: "lit", inward: [-9 * T, 0] },
    { what: "the west cliff's lip", points: along(z0 + 1, z0 + 13).map((z) => [x0 + 1.5 * T, 1.5, z] as const), expect: "lit", inward: [9 * T, 0] },
    { what: "the cliff's top", points: along(z0 + 4, z0 + 10).map((z) => [x0 + 3, 1.5, z] as const), expect: "lighter" },
  ];
  if (heading !== "right") out.push({ what: "the west cliff's foot", points: along(z0 + 1, z0 + 13).map((z) => [x0 - 1.5 * T, 0, z] as const), expect: "darker" });
  if (heading !== "left") out.push({ what: "the east bank's foot", points: along(z0 + 6, z0 + 13).map((z) => [x0 + 16 + 1.5 * T, 0, z] as const), expect: "darker" });
  if (heading === "front") {
    out.push(
      { what: "the cliff's shade, 7.5 texels out", points: along(z0 + 1, z0 + 13).map((z) => [x0 - 7.5 * T, 0, z] as const), expect: "darker" },
      { what: "the bank's shade, 7.5 texels out", points: along(z0 + 6, z0 + 13).map((z) => [x0 + 16 + 7.5 * T, 0, z] as const), expect: "same" },
    );
  }
  return out;
}

// The edges hold: the same frame drawn with the terraces' edges and without them (the ground's `edges` switched off), the
// standing grass left out, at every heading, on the sand and the rock mesas. Every lip is lighter, every foot that shows
// darker, the cliff's shade reaches where the bank's does not, and the higher ground is lighter.
for (const i of [1, 2]) {
  for (const heading of HEADINGS) {
    test(`edges: the ${MESAS[i]} mesa's brinks, feet and levels read at the ${heading} heading`, async ({ page }) => {
      const { x, z } = mesaAt(i);
      const errors = await open(page, [x + 8, z + 7], heading, 1);
      const list = probes(i, heading);
      const seen = await page.evaluate((groups) => {
        const s = (globalThis as any).sliceStage;
        const place = s.current.place;
        const grounds: any[] = [];
        place.scene.traverse((o: any) => {
          if (o.name === "ground" && o.material?.userData?.edges) grounds.push(o.material.userData.edges);
        });
        const read = () => {
          s.render();
          return s.renderer.readFrame(place.scene) as { width: number; height: number; rgba: Uint8Array };
        };
        place.setDetail(false);
        const on = read();
        for (const g of grounds) g.value = 0;
        const off = read();
        for (const g of grounds) g.value = 1;
        place.setDetail(true);
        s.render();
        const at = (px: number, py: number, pz: number) => {
          const p = s.renderer.scenePixel(s.player.position.clone().set(px, py, pz));
          const k = (Math.floor(p.y) * on.width + Math.floor(p.x)) * 4;
          const sum = (f: { rgba: Uint8Array }) => f.rgba[k]! + f.rgba[k + 1]! + f.rgba[k + 2]!;
          return { inView: p.x >= 0 && p.y >= 0 && p.x < on.width && p.y < on.height, on: sum(on), off: sum(off) };
        };
        return groups.map((g) =>
          g.points.map(([px, py, pz]) => {
            const here = at(px, py, pz);
            const inside = g.inward ? at(px + g.inward[0]!, py, pz + g.inward[1]!) : here;
            return { ...here, gain: here.on / Math.max(1, here.off), plain: inside.on / Math.max(1, inside.off) };
          }),
        );
      }, list);
      for (const [g, probe] of list.entries()) {
        const points = seen[g]!;
        expect(points.filter((p) => !p.inView).length, `${probe.what}: every point in the view`).toBe(0);
        const right = points.filter((p) =>
          probe.expect === "lit" ? p.gain > p.plain + 0.05 : probe.expect === "lighter" ? p.on > p.off : probe.expect === "darker" ? p.on < p.off : p.on === p.off,
        ).length;
        // A lip is broken here and there, and an outline may fall on a point at a turned heading: most, not all.
        const share = probe.expect === "same" ? 1 : 0.8;
        expect(right / points.length, `${probe.what} ${probe.expect} with the edges drawn (${right} of ${points.length})`).toBeGreaterThanOrEqual(share);
      }
      await page.screenshot({ path: join(out, `check-${MESAS[i]}-${heading}.png`) });
      expect(errors).toEqual([]);
    });
  }
}

/** The views looked at: each mesa from its east half's middle, and the grass hills by their ramp. */
const VIEWS: { name: string; at: readonly [number, number] }[] = [
  ...MESAS.map((s, i) => ({ name: s, at: [mesaAt(i).x + 9, mesaAt(i).z + 8] as const })),
  { name: "hills", at: [HILLS[0] - 14, HILLS[1] - 8] },
];

/** Places in the generated Domains to look at as well (EDGES_SHOTS=hurloon,...): the Hurloon Mountains' terraces. */
const DOMAINS: { name: string; at: readonly [number, number] }[] = [
  { name: "hurloon", at: [520, 630] },
  { name: "hurloon-north", at: [553, 572] },
];

if (process.env.EDGES_SHOTS) {
  const only = process.env.EDGES_SHOTS === "1" ? null : new Set(process.env.EDGES_SHOTS.split(","));
  const zooms = (process.env.EDGES_ZOOMS ?? "0,1,2").split(",").map(Number);
  for (const v of DOMAINS.filter((d) => only !== null && only.has(d.name))) {
    for (const heading of HEADINGS) {
      for (const zoom of zooms) {
        test(`edges: the Domains' ${v.name} at the ${heading} heading, zoom ${zoom}`, async ({ page }) => {
          const errors = await openRealm(page, { at: `world:${v.at[0]},${v.at[1]}`, extra: `&heading=${heading}&zoom=${zoom}&nohud&still&mobs=0` });
          await page.mouse.move(2, 2);
          await page.screenshot({ path: join(out, `${v.name}-${heading}-${zoom}.png`) });
          expect(errors).toEqual([]);
        });
      }
    }
  }
  for (const v of VIEWS.filter((v) => !only || only.has(v.name))) {
    for (const heading of HEADINGS) {
      for (const zoom of zooms) {
        test(`edges: ${v.name} at the ${heading} heading, zoom ${zoom}`, async ({ page }) => {
          const errors = await open(page, v.at, heading, zoom);
          await page.screenshot({ path: join(out, `${v.name}-${heading}-${zoom}.png`) });
          expect(errors).toEqual([]);
        });
      }
    }
  }
}
