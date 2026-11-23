import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, test } from "@playwright/test";
import { INTERIOR_KINDS, frontStep } from "../src/world/format";
import { encodeGif } from "./gif";
import { doorOf, spawnNear } from "./places";
import { TRADERS_IN, advance, at, chebyshev, chunk, clickEntity, openNear, openRealm, openWorld, player, realm, until, waitSpace, world } from "./realm";
import { enter } from "./runs";

// The tour (realms/docs/tech.md B5): pictures of the real game page on the generated Domains, for eyes - every town at
// street level (front and turned 45 degrees), the furthest zoom over open country in each region, an interior of each
// kind, a floor of each dungeon theme, a duel's splash, a vendor, a trader's caravan, the maps, and a walk out of New
// Benalia's gate into the country as a GIF. Not compared against anything: the other suites check behaviour. Written to
// test-results/tour, or with REALM_TOUR=1 to the committed e2e/screenshots/tour.

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.REALM_TOUR ? join(here, "screenshots", "tour") : join(here, "..", "test-results", "tour");
mkdirSync(out, { recursive: true });

/** Lets the view settle (streaming, the camera's easing) on the manual clock, the pointer out of the way. */
async function settle(page: Page, seconds = 2): Promise<void> {
  await page.mouse.move(2, 2);
  await advance(page, seconds);
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`) });

// --- Towns ------------------------------------------------------------------------------------------------------------

for (const town of world().towns) {
  test(`tour: town ${town.id}`, async ({ page }) => {
    for (const heading of ["front", "left"] as const) {
      await openRealm(page, { at: town.id, extra: `&mobs=0&heading=${heading}&zoom=0` });
      await settle(page);
      await shot(page, `town-${town.id}-${heading}`);
    }
  });
}

// --- Regions, from the furthest zoom ------------------------------------------------------------------------------------

const layout = JSON.parse(readFileSync(join(here, "..", "..", "content", "dominaria", "layout.json"), "utf8")) as { regions: { id: string; at: [number, number] }[] };

for (const region of layout.regions) {
  test(`tour: region ${region.id} from afar`, async ({ page }) => {
    // Open country near the region's heart, away from any town.
    const [x, z] = region.at;
    const towns = world().towns;
    const away = (t: { x: number; z: number }) => openWorld(t) && towns.every((tw) => chebyshev(t, { x: tw.center[0], z: tw.center[1] }) > tw.radius + 10);
    const start = openNear({ x, z }, 0, away);
    await openRealm(page, { at: at(start), extra: "&mobs=0&heading=front&zoom=2" });
    await settle(page, 3);
    await shot(page, `region-${region.id}-far`);
  });
}

// --- Interiors, one of each kind -------------------------------------------------------------------------------------------

const ROOMS: Readonly<Record<string, string>> = {
  shop: "argive-goblin-trader-shop",
  "exotic-wares": "new-benalia-exotic-wares-shop",
  inn: "new-benalia-inn",
  guildhall: "new-benalia-guildhall",
  temple: "new-benalia-temple",
  smithy: "new-benalia-smithy",
  library: "new-benalia-library",
  house: "new-benalia-house-1",
  tower: "tolarian-academy-tower",
};

test("tour: an interior of each kind", async ({ page }) => {
  test.setTimeout(240_000);
  for (const kind of INTERIOR_KINDS) {
    const id = ROOMS[kind];
    if (!id) continue;
    // Walked into through its door, as a player comes in.
    const door = doorOf(id);
    await openRealm(page, { at: at(openNear(door, 2)), extra: "&mobs=0&heading=front&zoom=0" });
    await clickEntity(page, (e) => e.kind === "door" && e.to === id, `the door of ${id}`);
    await waitSpace(page, id);
    await settle(page, 1.5);
    await shot(page, `interior-${kind}`);
  }
});

// --- Dungeons, a floor of each theme ---------------------------------------------------------------------------------------

const THEMES: readonly { id: string; color?: string }[] = [
  { id: "hurloon-caves" },
  { id: "benalish-keep" },
  { id: "academy-tower" },
  { id: "vess-crypts" },
  { id: "elfhame-hollow" },
  { id: "ironclaw-delvings" },
  { id: "phyrexian-portal", color: "WUBRG" },
];

for (const t of THEMES) {
  test(`tour: dungeon ${t.id}`, async ({ page }) => {
    const theme = (JSON.parse(readFileSync(join(here, "..", "..", "content", "dominaria", "dungeons", `${t.id}.json`), "utf8")) as { theme: string }).theme;
    await openRealm(page, { at: t.id, color: t.color, extra: "&mobs=0&heading=front" });
    await settle(page, 1);
    await shot(page, `dungeon-${theme}-entrance`);
    await enter(page, t.id);
    await waitSpace(page, /^run:/, 30);
    await settle(page, 1.5);
    await shot(page, `dungeon-${theme}`);
  });
}

// --- A duel, a vendor, a trader, the maps ----------------------------------------------------------------------------------

test("tour: a duel's splash", async ({ page }) => {
  const spawn = spawnNear("capashen-hold");
  await openRealm(page, { at: at(openNear(spawn, 3)), extra: "&heading=front&zoom=0" });
  await clickEntity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await until(page, async () => (await realm<string>(page, "screen")) === "duel", "the duel", 20);
  await shot(page, "duel");
});

test("tour: a vendor's wares", async ({ page }) => {
  const id = "argive-goblin-trader-shop";
  await openRealm(page, { at: id, extra: "&mobs=0" });
  await clickEntity(page, (e) => e.kind === "vendor", "the vendor");
  await until(page, async () => (await realm<string>(page, "screen")) === "vendor", "the wares", 20);
  await advance(page, 0.5);
  await shot(page, "vendor");
});

test("tour: a traveling trader's caravan at the pitch", async ({ page }) => {
  const pitch = world().pitches.find((p) => p.town === "new-benalia")!;
  await openRealm(page, { at: at(openNear(pitch, 3)), extra: "&mobs=0&heading=front&zoom=0", now: TRADERS_IN });
  await until(page, async () => (await realm<{ kind: string; tile: { x: number; z: number } }[]>(page, "entities")).some((e) => e.kind === "vendor" && e.tile.x === pitch.x && e.tile.z === pitch.z), "the trader");
  await settle(page, 1);
  await shot(page, "caravan");
});

test("tour: the regional map and the whole map", async ({ page }) => {
  await openRealm(page, { at: "cabal-crossing", extra: "&mobs=0" });
  await settle(page, 1);
  await page.locator("#hud-place").screenshot({ path: join(out, "map-regional.png") });
  await page.mouse.click(...(await minimap(page)));
  await advance(page, 0.5);
  await shot(page, "map-world");
});

async function minimap(page: Page): Promise<[number, number]> {
  const c = (await realm<{ name: string; x: number; y: number }[]>(page, "controls")).find((k) => k.name === "hud:minimap")!;
  return [c.x, c.y];
}

// --- A walk out of New Benalia's gate ---------------------------------------------------------------------------------------

test("tour: walking out of New Benalia's gate into the country", async ({ page }) => {
  test.setTimeout(240_000);
  const town = world().towns.find((t) => t.id === "new-benalia")!;
  // A gatehouse of its walls, and the way out through it.
  const gates = [];
  for (let cx = Math.floor((town.center[0] - town.radius - 8) / 32); cx <= Math.floor((town.center[0] + town.radius + 8) / 32); cx++)
    for (let cz = Math.floor((town.center[1] - town.radius - 8) / 32); cz <= Math.floor((town.center[1] + town.radius + 8) / 32); cz++) gates.push(...(chunk(cx, cz)?.props ?? []).filter((p) => p.id === "gatehouse"));
  // The south gate if there is one (the camera looks north: the walk comes toward it), else the first.
  const gate = gates.find((g) => (g.rot ?? 0) === 0) ?? gates[0]!;
  const [sx, sz] = frontStep(gate.rot ?? 0);
  const g = { x: Math.floor(gate.x), z: Math.floor(gate.z) };
  const from = openNear({ x: g.x - sx * 9, z: g.z - sz * 9 }, 0);
  const to = openNear({ x: g.x + sx * 12, z: g.z + sz * 12 }, 0);
  await openRealm(page, { at: at(from), extra: "&mobs=0&heading=front&zoom=0" });
  await settle(page, 1.5);
  const view = page.viewportSize()!;
  const clip = { x: view.width / 2 - 240, y: view.height / 2 - 190, width: 480, height: 320 };
  const shots: Buffer[] = [];
  for (let leg = 0; leg < 12; leg++) {
    const me = (await player(page)).tile;
    if (chebyshev(me, to) <= 1) break;
    const path = (await page.evaluate(([x, z]) => (globalThis as any).realmTest.pathTo(x, z), [to.x, to.z] as const)) as { x: number; z: number }[] | null;
    if (!path || path.length === 0) break;
    const step = path[Math.min(6, path.length - 1)]!;
    const s = await page.evaluate(([x, z]) => (globalThis as any).realmTest.screenOfTile(x, z), [step.x, step.z] as const);
    await page.mouse.click(s.x, s.y);
    await page.mouse.move(2, 2);
    for (let f = 0; f < 60; f++) {
      await advance(page, 1 / 12);
      shots.push(await page.screenshot({ clip }));
      if (!(await player(page)).moving) break;
    }
  }
  const decoded = await page.evaluate(async (pngs) => {
    const images = await Promise.all(
      pngs.map(
        (b64) =>
          new Promise<HTMLImageElement>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = `data:image/png;base64,${b64}`;
          }),
      ),
    );
    const w = images[0]!.width;
    const h = images[0]!.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g2 = canvas.getContext("2d")!;
    const frames: string[] = [];
    for (const img of images) {
      g2.drawImage(img, 0, 0);
      const data = g2.getImageData(0, 0, w, h).data;
      let s = "";
      for (let i = 0; i < data.length; i += 8192) s += String.fromCharCode(...data.subarray(i, i + 8192));
      frames.push(btoa(s));
    }
    return { w, h, frames };
  }, shots.map((b) => b.toString("base64")));
  writeFileSync(join(out, "walk-new-benalia-gate.gif"), encodeGif(decoded.w, decoded.h, decoded.frames.map((b64) => ({ rgba: new Uint8Array(Buffer.from(b64, "base64")), delay: 8 }))));
  writeFileSync(join(out, "walk-new-benalia-gate-last.png"), shots.at(-1)!);
});
