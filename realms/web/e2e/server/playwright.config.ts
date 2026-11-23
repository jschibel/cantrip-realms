import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// The overworld against the real realm server (tech.md, B10): Cantrip.Realms.Server started with the development
// sign-in on a SQLite file of its own, and the overworld's dev server, which the page reaches it from
// across origins as a deployed world client does (?server=). The card layer is the stand-in (?cards=stub), which records
// what it is asked: the duel screen itself is the card layer's to play. `npm run e2e:server`; the engine host is not
// needed (nothing here finishes a duel).
const web = 5175;
const realm = 5181;
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
      url: `http://localhost:${web}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `dotnet run --project "${server}" --no-launch-profile --urls http://localhost:${realm}`,
      cwd: server,
      url: `http://localhost:${realm}/healthz`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        REALMS_DEV_SIGNIN: "1",
        REALMS_DATABASE: `sqlite:${process.env.REALMS_E2E_DATABASE}`,
        REALMS_CLIENT: `http://localhost:${web}/`,
      },
    },
  ],
});
