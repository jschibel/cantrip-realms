import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, test } from "@playwright/test";
import type { WorldData } from "../src/world/format";
import { advance, openRealm, realm, until } from "./realm";

// The towns as the town generator makes them, seen from the camera (realms/docs/tech.md B5, "Dominaria as generated":
// Towns): the preview world the generator's harness writes (scripts/worldgen/town-preview.ts into town-preview/, opened
// with ?world=towns), each town from its main gate looking in, on its square, at its inn's door and along a main street,
// at the three headings and the closest and middle zoom. Only with TOWN_SHOTS=1 (and the preview written): pictures for
// eyes, into test-results/towns; TOWN_SHOTS=tour also copies each town's best to e2e/screenshots/tour/town-<id>-*.png.

const here = dirname(fileURLToPath(import.meta.url));
const preview = join(here, "..", "town-preview", "world.json");
const out = join(here, "..", "test-results", "towns");
const tour = join(here, "screenshots", "tour");
const enabled = !!process.env.TOWN_SHOTS && existsSync(preview);
const world = enabled ? (JSON.parse(readFileSync(preview, "utf8")) as WorldData) : null;
const only = (process.env.TOWN_ONLY ?? "").split(",").filter(Boolean);

type At = { x: number; z: number };

/** Where to stand in a town: its main gate (outside, looking in), its square, its inn's door, a main street. */
function spots(t: WorldData["towns"][number]): { gate: At; square: At; inn: At; street: At } {
  const plan = t.plan!;
  const gates = plan.gates.map((g) => plan.nodes[g]!);
  // The main arrival: the south gate where there is one (the camera looks north, into the town).
  const gate = [...gates].sort((a, b) => b[1] - a[1])[0]!;
  const sq = plan.squares[0]!;
  const square = { x: sq.x + Math.floor(sq.w / 2), z: sq.z + Math.floor(sq.d * 0.7) };
  const inn = world!.inns.find((i) => i.town === t.id)!;
  // A main street a little way from the square: the middle of the main way furthest from it within 30 tiles.
  const mains = plan.ways.filter((w) => w.main).map((w) => {
    const a = plan.nodes[w.a]!;
    const b = plan.nodes[w.b]!;
    return { x: Math.round((a[0] + b[0]) / 2), z: Math.round((a[1] + b[1]) / 2) };
  });
  const far = mains.map((m) => ({ m, d: Math.hypot(m.x - square.x, m.z - square.z) })).filter((q) => q.d < 30).sort((a, b) => b.d - a.d)[0]?.m ?? square;
  return { gate: { x: gate[0], z: gate[1] - 2 }, square, inn: { x: inn.x, z: inn.z + 2 }, street: far };
}

async function settle(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await advance(page, 1.2);
  await until(page, () => realm<boolean>(page, "streamed"), "the view streamed", 30);
  await advance(page, 0.4);
}

async function heading(page: Page, want: -1 | 0 | 1): Promise<void> {
  const name = await page.evaluate(() => (globalThis as any).sliceTest.heading as string);
  const now = name === "left" ? -1 : name === "right" ? 1 : 0;
  for (let k = now; k !== want; k += want > k ? 1 : -1) {
    await page.evaluate((s) => (globalThis as any).sliceTest.turn(s), want > k ? 1 : -1);
    await advance(page, 0.8);
  }
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
      await openRealm(page, { at: `world:${at.gate.x},${at.gate.z}`, extra: "&world=towns&mobs=0&still&nohud&heading=front&zoom=1" });
      const shots: [string, At, number, readonly (-1 | 0 | 1)[]][] = [
        ["gate", at.gate, 1, [0, -1, 1]],
        ["square", at.square, 1, [0, -1, 1]],
        ["square", at.square, 0, [0]],
        ["inn", at.inn, 0, [0, -1, 1]],
        ["street", at.street, 0, [0]],
      ];
      for (const [name, p, z, headings] of shots) {
        await page.evaluate(([x, zz]) => (globalThis as any).realmTest.placePlayer(x, zz), [p.x, p.z] as const);
        await zoom(page, z);
        for (const h of headings) {
          await heading(page, h);
          await settle(page);
          const file = join(out, `${t.id}-${name}-${h === 0 ? "front" : h < 0 ? "left" : "right"}-z${z}.png`);
          await page.screenshot({ path: file });
          if (process.env.TOWN_SHOTS === "tour" && name === "gate" && z === 1) copyFileSync(file, join(tour, `town-${t.id}-${h === 0 ? "front" : h < 0 ? "left" : "right"}.png`));
        }
        await heading(page, 0);
      }
    });
  }
});
