import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// The overworld against the real realm server (tech.md, B10): Cantrip.Realms.Server started with the development
// sign-in on a SQLite file of its own, and the overworld's dev server, which the page reaches it from
// across origins as a deployed world client does (?server=). Most of it frames the card layer's stand-in (?cards=stub),
// which records what it is asked; card-layer.spec.ts frames the real one - the web client's built ?realm page, served
// as static files on an origin of its own (cards.mjs) - and plays its duel, which the server checks on the native engine
// host. `npm run e2e:server`, after building the realm server, the web client (with the rules engine for the page,
// tools\build-engine-wasm.cmd) and the engine host (cargo build --profile cards -p cantrip-host).
// The ports, each overridable where another run holds it (REALMS_E2E_PORTS=web,realm,cards).
const [web, realm, cards] = (process.env.REALMS_E2E_PORTS ?? "5175,5181,5197").split(",").map(Number) as [number, number, number];
const here = dirname(fileURLToPath(import.meta.url));
const server = resolve(here, "..", "..", "..", "dotnet", "Cantrip.Realms.Server");

// One store for the whole run, a fresh SQLite file in .data (git ignores it): made once, by the run's first reading of
// this file - the workers that read it again inherit the setting and leave the store alone. The last run's server is
// gone by then, so its file is free to go.
if (!process.env.REALMS_E2E_DATABASE) {
  const data = join(here, ".data");
  rmSync(data, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  process.env.REALMS_E2E_DATABASE = join(data, "realms.db");
}
process.env.REALMS_E2E_SERVER = `http://localhost:${realm}/`;
process.env.REALMS_E2E_CARDS = `http://localhost:${cards}/`;

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${web}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: [
    {
      command: `npx vite --port ${web} --strictPort`,
      cwd: join(here, "..", ".."),
      // Every page here names its card layer (?cards=): the dev server serves none of its own.
      env: { REALM_CARD_LAYER: "stub" },
      url: `http://localhost:${web}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `node cards.mjs ${cards}`,
      cwd: here,
      url: `http://localhost:${cards}/`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `dotnet run --project "${server}" --no-launch-profile --urls http://localhost:${realm}`,
      cwd: server,
      url: `http://localhost:${realm}/healthz`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        REALMS_DEV_SIGNIN: "1",
        // No finds spawn by the dice: a test stands its own (POST /dev/find, server.ts `find`).
        REALMS_CHESTS_PER_ZONE: "0",
        REALMS_HEARTBLOOMS: "0",
        REALMS_DATABASE: `sqlite:${process.env.REALMS_E2E_DATABASE}`,
        REALMS_CLIENT: `http://localhost:${web}/`,
        REALMS_CARDS: `http://localhost:${cards}/`,
      },
    },
  ],
});
