import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, test } from "@playwright/test";
import { type Tile, openNear, openWorld, world } from "../realm";

// The renderer's benchmark on the game page (see playwright.config.ts here): the same walks every run, timed frame by
// frame on the manual clock with streaming on its real budget. The generated Domains - New Benalia's streets, the
// forest of Llanowar, the Caligo Morass - at the closest zoom and the furthest (where the small props and the grass are
// left out, and the trees are their far stand-ins), once turning the camera while it walks; and the large synthetic
// world's town and forest, the yardstick the renderer was first measured on.

const here = dirname(fileURLToPath(import.meta.url));

interface Leg {
  readonly name: string;
  readonly waypoints: readonly Tile[];
  readonly heading: number;
  readonly zoom: number;
  readonly turning?: boolean;
}

async function bench(page: Page, query: string, legs: readonly Leg[], file: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?test&manual&offline&name=Bench&mobs=0&heading=front&zoom=0&${query}`);
  await page.waitForFunction(() => (globalThis as any).realmTest?.ready === true, undefined, { timeout: 120_000 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  const report = await page.evaluate((l) => (globalThis as any).realmTest.bench(l), legs);
  const out = { gpu, viewport: "1920x1080", at: new Date().toISOString(), legs: report, errors };
  mkdirSync(join(here, "..", "..", "test-results"), { recursive: true });
  writeFileSync(join(here, "..", "..", "test-results", file), JSON.stringify(out, null, 2));
  console.log(`GPU: ${gpu}`);
  for (const r of report as any[]) {
    console.log(
      `${r.name.padEnd(44)} ${String(r.frames).padStart(5)} frames  mean ${r.meanMs.toFixed(2)} ms  p50 ${r.p50Ms.toFixed(2)}  p95 ${r.p95Ms.toFixed(2)}  p99 ${r.p99Ms.toFixed(2)}  worst ${r.worstMs.toFixed(1)}  >16.7ms ${r.over16}  calls ${r.calls.mean.toFixed(0)} (max ${r.calls.max})  tris ${(r.triangles.mean / 1000).toFixed(0)}k  build worst ${r.worstBuildMs.toFixed(1)} ms  chunks ${r.chunksBuilt}  ${r.scenePixels}  [${r.worstStep}]`,
    );
  }
  if (errors.length > 0) console.log(`errors: ${errors.join(" | ")}`);
}

/** A loop of open tiles round a point: the corners of a square `r` out, each the nearest open tile to it. */
function loop(at: Tile, r: number): Tile[] {
  const corners = [
    { x: at.x + r, z: at.z },
    { x: at.x + r, z: at.z - r },
    { x: at.x - r, z: at.z - r },
    { x: at.x - r, z: at.z + r },
    { x: at.x + r, z: at.z + r },
    { x: at.x, z: at.z },
  ];
  return corners.map((c) => openNear(c, 0, openWorld));
}

test("bench: the Domains at 1080p - New Benalia's streets, Llanowar's forest, the Morass", async ({ page }) => {
  const nb = world().towns.find((t) => t.id === "new-benalia")!;
  const town = loop({ x: nb.center[0], z: nb.center[1] }, 26);
  const forest = loop({ x: 736, z: 846 }, 22);
  const morass = loop({ x: 333, z: 386 }, 22);
  await bench(
    page,
    `at=world:${town[5]!.x},${town[5]!.z}`,
    [
      { name: "New Benalia, closest zoom", waypoints: town, heading: 0, zoom: 0 },
      { name: "New Benalia, furthest zoom", waypoints: town, heading: 0, zoom: 2 },
      { name: "New Benalia, turning while walking", waypoints: town, heading: 0, zoom: 0, turning: true },
    ],
    "bench-new-benalia.json",
  );
  await bench(
    page,
    `at=world:${forest[5]!.x},${forest[5]!.z}`,
    [
      { name: "Llanowar's forest, closest zoom", waypoints: forest, heading: 0, zoom: 0 },
      { name: "Llanowar's forest, furthest zoom", waypoints: [...forest].reverse(), heading: -1, zoom: 2 },
    ],
    "bench-llanowar.json",
  );
  await bench(
    page,
    `at=world:${morass[5]!.x},${morass[5]!.z}`,
    [
      { name: "the Morass, closest zoom", waypoints: morass, heading: 0, zoom: 0 },
      { name: "the Morass, furthest zoom", waypoints: [...morass].reverse(), heading: 1, zoom: 2 },
    ],
    "bench-morass.json",
  );
});

test("bench: the large synthetic world's town and forest at 1080p", async ({ page }) => {
  const town = [
    { x: 155, z: 137 },
    { x: 155, z: 118 },
    { x: 119, z: 118 },
    { x: 119, z: 154 },
    { x: 137, z: 154 },
    { x: 137, z: 137 },
    { x: 128, z: 137 },
  ];
  const road = [
    { x: 101, z: 137 },
    { x: 81, z: 121 },
    { x: 62, z: 106 },
    { x: 42, z: 90 },
    { x: 23, z: 75 },
  ];
  const forest = [
    { x: 30, z: 52 },
    { x: 50, z: 34 },
    { x: 76, z: 48 },
    { x: 60, z: 76 },
    { x: 36, z: 70 },
  ];
  await bench(
    page,
    "world=large&at=world:128,137",
    [
      { name: "town, closest zoom", waypoints: town, heading: 0, zoom: 0 },
      { name: "town, furthest zoom (detail left out)", waypoints: town, heading: 0, zoom: 2 },
      { name: "town, turning while walking", waypoints: town, heading: 0, zoom: 0, turning: true },
      { name: "the road out to the forest", waypoints: road, heading: 1, zoom: 1 },
      { name: "forest, closest zoom", waypoints: forest, heading: 0, zoom: 0 },
      { name: "forest, furthest zoom", waypoints: [...forest].reverse(), heading: -1, zoom: 2 },
    ],
    "bench.json",
  );
});
