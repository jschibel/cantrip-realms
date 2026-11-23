import { defineConfig } from "@playwright/test";

// The renderer's benchmark (npm run bench): a scripted walk through the large synthetic world's town and forest at
// 1080p, on the manual clock, every frame timed to the GPU's finish (src/render/bench.ts). It runs on the machine's own
// GPU (ANGLE over Direct3D 11, or whatever Chromium picks), never SwiftShader - so its numbers are the machine's - and
// it is a report, not a pass or a fail: it prints each leg's frame times and draw calls, and writes them to
// test-results/bench.json.
const port = Number(process.env.REALM_E2E_PORT ?? 5175);

export default defineConfig({
  testDir: ".",
  timeout: 600_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1920, height: 1080 },
    launchOptions: { args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=" + (process.env.BENCH_ANGLE ?? "d3d11"), "--disable-gpu-vsync", "--disable-frame-rate-limit"] },
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    cwd: "../..",
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
