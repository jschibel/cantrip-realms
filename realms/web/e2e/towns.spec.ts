import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, test } from "@playwright/test";
import type { WorldData } from "../src/world/format";
import { advance, openRealm, realm, until } from "./realm";

// The towns as the town template lays them out, seen from the camera (realms/docs/tech.md B5, "Dominaria as generated":
// Towns): the preview world the generator's harness writes (scripts/worldgen/town-preview.ts into town-preview/, opened
// with ?world=towns), each town where one arrives through its gate, in its market, on its walk and at its inn's door, at
// each zoom. Only with TOWN_SHOTS=1 (and the preview written): pictures for eyes, into test-results/towns;
// TOWN_SHOTS=tour also copies each town's arrival to e2e/screenshots/tour/town-<id>.png.

const here = dirname(fileURLToPath(import.meta.url));
const preview = join(here, "..", "town-preview", "world.json");
const out = join(here, "..", "test-results", "towns");
const tour = join(here, "screenshots", "tour");
const enabled = !!process.env.TOWN_SHOTS && existsSync(preview);
const world = enabled ? (JSON.parse(readFileSync(preview, "utf8")) as WorldData) : null;
const only = (process.env.TOWN_ONLY ?? "").split(",").filter(Boolean);

type At = { x: number; z: number };

/** Where to stand in a town: where its gate lets one in, its market's middle, its walk's middle, its inn's door. */
function spots(t: WorldData["towns"][number]): { gate: At; market: At; walk: At; inn: At } {
  const plan = t.plan!;
  const [walk, market] = [plan.squares.find((s) => s.name === "The walk")!, plan.squares.find((s) => s.name === "The market")!];
  const inn = world!.inns.find((i) => i.town === t.id)!;
  // Its gate's road end, a few steps in (the preview world has no travel map, so its towns have no ways).
  const gate = plan.nodes[plan.gates[0]!]!;
  return {
    gate: { x: gate[0], z: gate[1] - 5 },
    market: { x: market.x + Math.floor(market.w / 2) + 3, z: market.z + Math.floor(market.d / 2) },
    walk: { x: walk.x + Math.floor(walk.w / 2) + 3, z: walk.z + 1 },
    inn: { x: inn.x, z: inn.z + 1 },
  };
}

async function settle(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await advance(page, 1.2);
  await until(page, () => realm<boolean>(page, "streamed"), "the view streamed", 30);
  await advance(page, 0.4);
}

async function zoom(page: Page, want: number): Promise<void> {
  for (let guard = 0; guard < 4; guard++) {
    const z = await page.evaluate(() => (globalThis as any).sliceTest.zoom.step as number);
    if (z === want) return;
    await page.evaluate((s) => (globalThis as any).sliceTest.zoomBy(s), want > z ? 1 : -1);
    await advance(page, 0.6);
  }
}

test.describe("towns from the camera", () => {
  test.skip(!enabled, "TOWN_SHOTS=1 and the preview world (scripts/worldgen/town-preview.ts) take these pictures");
  for (const t of world?.towns ?? []) {
    if (only.length > 0 && !only.includes(t.id)) continue;
    test(`town ${t.id}`, async ({ page }) => {
      test.setTimeout(300_000);
      mkdirSync(out, { recursive: true });
      const at = spots(t);
      await openRealm(page, { at: `world:${at.gate.x},${at.gate.z}`, extra: "&world=towns&mobs=0&still&nohud&zoom=1" });
      const shots: [string, At, number][] = [
        ["gate", at.gate, 0],
        ["gate", at.gate, 1],
        ["gate", at.gate, 2],
        ["market", at.market, 1],
        ["walk", at.walk, 1],
        ["inn", at.inn, 0],
      ];
      for (const [name, p, z] of shots) {
        await page.evaluate(([x, zz]) => (globalThis as any).realmTest.placePlayer(x, zz), [p.x, p.z] as const);
        await zoom(page, z);
        await settle(page);
        const file = join(out, `${t.id}-${name}-z${z}.png`);
        await page.screenshot({ path: file });
        if (process.env.TOWN_SHOTS === "tour" && name === "gate" && z === 1) copyFileSync(file, join(tour, `town-${t.id}.png`));
      }
    });
  }
});
