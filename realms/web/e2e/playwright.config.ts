import { defineConfig } from "@playwright/test";

// The overworld end to end (tech.md, B10): the offline overworld (?offline: the in-memory API, presence between tabs,
// the stand-in card layer) driven in Chromium with real mouse clicks at the places realmTest publishes. The dev
// server is started on its own port. WebGL runs on SwiftShader, so no GPU is needed.
const port = Number(process.env.REALM_E2E_PORT ?? 5174);

export default defineConfig({
  testDir: ".",
  // The suite against the real server is its own (server/playwright.config.ts, npm run e2e:server), and so is the
  // renderer's benchmark (bench/playwright.config.ts, npm run bench).
  testIgnore: [
    "server/**",
    "bench/**",
    // The game page's suites written for the hex world (Dominaria on hexes, positions as q, r): the page runs on the
    // renderer's stage over a version-2 world now (game.spec.ts), and integration ports these to the generated
    // Domains on squares (realms/docs/conversion.md, "The renderer at world scale"). The same for the tests marked
    // fixme in look, screens and screenshots.
    "duel.spec.ts",
    "dungeons.spec.ts",
    "interiors.spec.ts",
    "travel.spec.ts",
    "world.spec.ts",
  ],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    cwd: "..",
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
