import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";

// The renderer's benchmark: see playwright.config.ts here. The walk is the same every run: the large world's town
// streets, the road west out of town into the forest, and the forest's paths, at the closest zoom and the furthest
// (where the small props and the grass are left out), and once turning the camera while it walks.

const here = dirname(fileURLToPath(import.meta.url));

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

test("bench: the town and the forest at 1080p", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/slice.html?test&manual&nohud&world=large&at=128,137&heading=front&zoom=0");
  await page.waitForFunction(() => (globalThis as any).sliceTest?.ready === true, undefined, { timeout: 120_000 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  const legs = [
    { name: "town, closest zoom", waypoints: town, heading: 0, zoom: 0 },
    { name: "town, furthest zoom (detail left out)", waypoints: town, heading: 0, zoom: 2 },
    { name: "town, turning while walking", waypoints: town, heading: 0, zoom: 0, turning: true },
    { name: "the road out to the forest", waypoints: road, heading: 1, zoom: 1 },
    { name: "forest, closest zoom", waypoints: forest, heading: 0, zoom: 0 },
    { name: "forest, furthest zoom", waypoints: [...forest].reverse(), heading: -1, zoom: 2 },
  ];
  const report = await page.evaluate((l) => (globalThis as any).sliceTest.bench(l), legs);
  const out = { gpu, viewport: "1920x1080", at: new Date().toISOString(), legs: report, errors };
  mkdirSync(join(here, "..", "..", "test-results"), { recursive: true });
  writeFileSync(join(here, "..", "..", "test-results", "bench.json"), JSON.stringify(out, null, 2));
  console.log(`GPU: ${gpu}`);
  for (const r of report as any[]) {
    console.log(
      `${r.name.padEnd(40)} ${String(r.frames).padStart(5)} frames  mean ${r.meanMs.toFixed(2)} ms  p50 ${r.p50Ms.toFixed(2)}  p95 ${r.p95Ms.toFixed(2)}  p99 ${r.p99Ms.toFixed(2)}  worst ${r.worstMs.toFixed(1)}  >16.7ms ${r.over16}  calls ${r.calls.mean.toFixed(0)} (max ${r.calls.max})  tris ${(r.triangles.mean / 1000).toFixed(0)}k  build worst ${r.worstBuildMs.toFixed(1)} ms  chunks ${r.chunksBuilt}  ${r.scenePixels}  [${r.worstStep}]`,
    );
  }
});
