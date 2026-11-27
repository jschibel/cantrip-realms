import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, test } from "@playwright/test";
import { INTERIOR_KINDS, sideStep } from "../src/world/format";
import { encodeGif } from "./gif";
import { doorOf, nearAWay, spawnNear } from "./places";
import { TRADERS_IN, advance, at, chebyshev, clickEntity, openNear, openRealm, openWorld, player, realm, until, waitSpace, world } from "./realm";
import { enter } from "./runs";

// The tour (realms/docs/tech.md B5): pictures of the real game page on the generated Domains, for eyes - every town at
// street level in its grounds (front and turned 45 degrees), each region of the travel map from its furthest zoom, an
// interior of each kind, a dungeon of each theme at its entrance on the travel map and a floor of it, a duel's splash, a
// vendor, a trader's caravan, the maps (the regional and the world's, a town's on the minimap and whole), and a walk out
// of New Benalia down its road and onto the travel map as a GIF. Not compared against anything: the other suites check
// behaviour. Written to test-results/tour, or with REALM_TOUR=1 to the committed e2e/screenshots/tour; TOUR_ONLY=towns,
// regions, rooms, dungeons, rest picks some.

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.REALM_TOUR ? join(here, "screenshots", "tour") : join(here, "..", "test-results", "tour");
const only = (process.env.TOUR_ONLY ?? "").split(",").filter(Boolean);
const part = (name: string) => only.length === 0 || only.includes(name);

/** Lets the view settle (streaming, the camera's easing) on the manual clock, the pointer out of the way. */
async function settle(page: Page, seconds = 2): Promise<void> {
  // The pointer over the HUD's character panel: off the world, so no tooltip.
  await page.mouse.move(60, 40);
  await advance(page, seconds);
  await until(page, () => realm<boolean>(page, "streamed"), "the view streamed", 30);
  await advance(page, 0.2);
}

// (Made as each is written: the run's output folder is emptied after this file is read.)
const shot = (page: Page, name: string) => {
  mkdirSync(out, { recursive: true });
  return page.screenshot({ path: join(out, `${name}.png`) });
};

// --- Towns ------------------------------------------------------------------------------------------------------------

for (const town of part("towns") ? world().towns : []) {
  test(`tour: town ${town.id}`, async ({ page }) => {
    for (const heading of ["front", "left"] as const) {
      await openRealm(page, { at: town.id, extra: `&mobs=0&heading=${heading}&zoom=0` });
      await settle(page);
      await shot(page, `town-${town.id}-${heading}`);
    }
  });
}

// --- Regions of the travel map, from the furthest zoom ----------------------------------------------------------------------

// The regions as the travel map's sketch (geography.json) seeds them: each seen from open ground by the first of its seeds
// with some, away from any icon, entrance or dock.
const geography = JSON.parse(readFileSync(join(here, "..", "..", "content", "dominaria", "geography.json"), "utf8")) as { regions?: { id: string; seeds: [number, number][] }[] };

for (const region of part("regions") ? (geography.regions ?? []) : []) {
  test(`tour: region ${region.id} from afar`, async ({ page }) => {
    const away = (t: { x: number; z: number }) => openWorld(t) && !nearAWay(t, 8);
    const start = region.seeds.map(([x, z]) => openNear({ x, z }, 0, away)).find((t) => region.seeds.some(([x, z]) => chebyshev(t, { x, z }) <= 8)) ?? openNear({ x: region.seeds[0]![0], z: region.seeds[0]![1] }, 0, away);
    await openRealm(page, { at: at(start), extra: "&mobs=0&zoom=2" });
    await settle(page, 3);
    await shot(page, `region-${region.id}-far`);
  });
}

// --- Interiors, one of each kind -------------------------------------------------------------------------------------------

const ROOMS: Readonly<Record<string, string>> = {
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
  test.skip(!part("rooms"));
  test.setTimeout(240_000);
  for (const kind of INTERIOR_KINDS) {
    const id = ROOMS[kind];
    if (!id) continue;
    // Walked into through its door, as a player comes in.
    const door = doorOf(id);
    await openRealm(page, { at: at(openNear(door, 2)), extra: "&mobs=0&zoom=0" });
    // The stage's click on the door tile (from some headings a roof stands over it on the page).
    await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [door.x, door.z] as const);
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

for (const t of part("dungeons") ? THEMES : []) {
  test(`tour: dungeon ${t.id}`, async ({ page }) => {
    const theme = (JSON.parse(readFileSync(join(here, "..", "..", "content", "dominaria", "dungeons", `${t.id}.json`), "utf8")) as { theme: string }).theme;
    await openRealm(page, { at: t.id, color: t.color, extra: "&mobs=0" });
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
  test.skip(!part("rest"));
  const spawn = spawnNear("capashen-hold");
  await openRealm(page, { at: at(openNear(spawn, 3)), extra: "&zoom=0" });
  await clickEntity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await until(page, async () => (await realm<string>(page, "screen")) === "duel", "the duel", 20);
  await shot(page, "duel");
});

test("tour: a vendor's wares", async ({ page }) => {
  test.skip(!part("rest"));
  // At the goblin trader's stall in New Benalia's market, in through the gate.
  const inside = world().towns.find((t) => t.id === "new-benalia")!.ways![0]!.inside;
  const stall = world().towns.find((t) => t.id === "new-benalia")!.plan!.places.find((p) => p.kind === "shop" && p.name === "Grizzlegom's Goblins")!;
  await openRealm(page, { at: at({ x: stall.x + 2, z: stall.z + 1 }), extra: "&mobs=0" });
  await clickEntity(page, (e) => e.kind === "vendor" && e.id === "argive-goblin-trader", "the vendor");
  await until(page, async () => (await realm<string>(page, "screen")) === "vendor", "the wares", 20);
  await advance(page, 0.5);
  await shot(page, "vendor");
});

test("tour: a traveling trader's caravan at the pitch", async ({ page }) => {
  test.skip(!part("rest"));
  const pitch = world().pitches.find((p) => p.town === "new-benalia")!;
  await openRealm(page, { at: at(openNear(pitch, 3)), extra: "&mobs=0&zoom=0", now: TRADERS_IN });
  await until(page, async () => (await realm<{ kind: string; tile: { x: number; z: number } }[]>(page, "entities")).some((e) => e.kind === "vendor" && e.tile.x === pitch.x && e.tile.z === pitch.z), "the trader");
  await settle(page, 1);
  await shot(page, "caravan");
});

test("tour: the regional map and the whole map", async ({ page }) => {
  test.skip(!part("rest"));
  // Out in the country (in a town the minimap is the town's).
  await openRealm(page, { at: "benalia-1", extra: "&mobs=0" });
  await settle(page, 1);
  await page.locator("#hud-place").screenshot({ path: join(out, "map-regional.png") });
  // The whole map at 1920x1080: fitted, closed in on Benalia and Llanowar, and with the tiers tinted.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.mouse.click(...(await minimap(page)));
  const drawn = async (zoomed: (w: { zoom: number; steps: number[]; tiers: boolean }) => boolean) =>
    until(page, async () => {
      const w = await realm<{ zoom: number; steps: number[]; tiers: boolean; ready: boolean } | null>(page, "map.whole");
      return !!w && w.ready && zoomed(w);
    }, "the whole map drawn");
  await drawn((w) => w.zoom === w.steps[0]);
  await page.mouse.move(2, 2);
  await shot(page, "map-world");
  await page.evaluate(() => (globalThis as any).realmTest.showWholeMap(3, 138, 362, false));
  await drawn((w) => w.zoom === w.steps[3]);
  await shot(page, "map-world-zoom");
  await page.evaluate(() => (globalThis as any).realmTest.showWholeMap(0, null, null, true));
  await drawn((w) => w.zoom === w.steps[0] && w.tiers);
  await shot(page, "map-world-tiers");
});

test("tour: a town's map, on the minimap and the whole map", async ({ page }) => {
  test.skip(!part("rest"));
  await openRealm(page, { at: "capashen-hold", extra: "&mobs=0" });
  await until(page, async () => (await realm<{ town: string | null }>(page, "map")).town === "capashen-hold", "the town's map");
  await settle(page, 1);
  await page.locator("#hud-place").screenshot({ path: join(out, "map-town-mini.png") });
  await page.mouse.click(...(await minimap(page)));
  await advance(page, 0.5);
  await shot(page, "map-town");
});

async function minimap(page: Page): Promise<[number, number]> {
  const c = (await realm<{ name: string; x: number; y: number }[]>(page, "controls")).find((k) => k.name === "hud:minimap")!;
  return [c.x, c.y];
}

// --- A walk out of New Benalia's gate ---------------------------------------------------------------------------------------

test("tour: walking out of New Benalia's gate, down its road and onto the travel map", async ({ page }) => {
  test.skip(!part("rest"));
  test.setTimeout(240_000);
  const town = world().towns.find((t) => t.id === "new-benalia")!;
  // The way out whose road leads to Capashen Hold (else the first): from a little way in from where it arrives, along the
  // road out to the edge of the grounds, through the iris, and on along the road on the travel map.
  const way = town.ways!.find((w) => w.to === "capashen-hold") ?? town.ways![0]!;
  const [sx, sz] = sideStep(way.side);
  const from = openNear({ x: way.inside[0] - sx * 14, z: way.inside[1] - sz * 14 }, 0);
  const road = world().roads.find((r) => r.from === town.id && r.tiles[0]![0] === way.outside[0] && r.tiles[0]![1] === way.outside[1]) ?? world().roads.find((r) => r.to === town.id)!;
  const tiles = road.from === town.id ? road.tiles : [...road.tiles].reverse();
  const beyond = { x: tiles[Math.min(12, tiles.length - 1)]![0], z: tiles[Math.min(12, tiles.length - 1)]![1] };
  await openRealm(page, { at: at(from), extra: "&mobs=0&zoom=0" });
  await settle(page, 1.5);
  const view = page.viewportSize()!;
  const clip = { x: view.width / 2 - 240, y: view.height / 2 - 190, width: 480, height: 320 };
  const shots: Buffer[] = [];
  const film = async () => {
    for (let f = 0; f < 90; f++) {
      await advance(page, 1 / 12);
      shots.push(await page.screenshot({ clip }));
      if (!(await player(page)).moving && !(await realm<boolean>(page, "transitioning"))) break;
    }
  };
  /** Clicks along the grid's way toward a tile, a few steps at a time, filming each leg. */
  const walk = async (to: { x: number; z: number }, near: number) => {
    for (let leg = 0; leg < 12; leg++) {
      const me = (await player(page)).tile;
      if (chebyshev(me, to) <= near) return;
      const path = (await page.evaluate(([x, z]) => (globalThis as any).realmTest.pathTo(x, z), [to.x, to.z] as const)) as { x: number; z: number }[] | null;
      if (!path || path.length === 0) return;
      const step = path[Math.min(6, path.length - 1)]!;
      await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [step.x, step.z] as const);
      await film();
    }
  };
  await walk({ x: way.inside[0], z: way.inside[1] }, 0);
  // Onto the road's end at the edge of the grounds: out, through the iris, beside the icon.
  const exit = way.exit[Math.floor(way.exit.length / 2)]!;
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [exit[0], exit[1]] as const);
  await film();
  await until(page, async () => !(await realm<boolean>(page, "transitioning")) && (await realm<boolean>(page, "streamed")), "out on the travel map", 20);
  await walk(beyond, 1);
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
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "walk-new-benalia-gate.gif"), encodeGif(decoded.w, decoded.h, decoded.frames.map((b64) => ({ rgba: new Uint8Array(Buffer.from(b64, "base64")), delay: 8 }))));
  writeFileSync(join(out, "walk-new-benalia-gate-last.png"), shots.at(-1)!);
});
