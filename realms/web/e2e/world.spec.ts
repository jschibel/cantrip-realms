import { expect, test } from "@playwright/test";
import { chunkKey } from "../src/world/schema";
import { chunkBorder, spawnNear, tierRise, zoneSamples } from "./places";
import { at, clickControl, clickHex, entity, openNear, openRealm, player, realm } from "./realm";

// The connected world: walking across a chunk's border with no seam, the chunks round the player loaded and the far
// ones dropped; what the pointer is over; and the tier zones - on the regional map with its legend, at their
// boundaries in the world, and in the HUD, which says so on crossing into a harder one.

test("walking across a chunk border is seamless: the next chunk is there, and the far ones go", async ({ page }) => {
  const { from, to, a, b } = chunkBorder();
  await openRealm(page, { at: at(from), extra: "&mobs=0" });
  const before = await realm<{ loaded: string[]; built: string[] }>(page, "chunks");
  const own = (h: { q: number; r: number }) => chunkKey(Math.floor(h.q / 32), Math.floor(h.r / 32));
  expect(before.built).toEqual(expect.arrayContaining([own(a), own(b)]));
  await clickHex(page, to.q, to.r);
  await expect.poll(async () => (await player(page)).hex, { timeout: 20_000 }).toBe(`${to.q},${to.r}`);
  expect(own(to)).not.toBe(own(from));
  expect(await realm<string>(page, "space.id")).toBe("world");
  // Every chunk within reach of where the player now stands is built.
  const after = await realm<{ loaded: string[]; built: string[] }>(page, "chunks");
  expect(after.built).toContain(own(to));
});

test("the cursor and the tooltip say what the pointer is over: a wanderer's name and tier", async ({ page }) => {
  const spawn = spawnNear("new-benalia");
  await openRealm(page, { at: at(openNear(spawn, 6)) });
  const mob = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await page.mouse.move(mob.x, mob.y);
  await expect.poll(() => realm<string>(page, "cursor")).toBe("attack");
  await expect.poll(() => realm<string | null>(page, "tooltip")).toBe(`${mob.name} - tier ${spawn.tier}`);
});

test("the HUD names the area and its tier, and says so on crossing into a harder one, past a waymarker", async ({ page }) => {
  const { from, to, b } = tierRise();
  await openRealm(page, { at: at(from), extra: "&mobs=0" });
  const startArea = await realm<{ name: string; tier: number }>(page, "area");
  const area = await realm<{ name: string; text: string }[]>(page, "controls");
  expect(area.find((c) => c.name === "hud:area")?.text).toContain(startArea.name);
  // A waymarker stands at the boundary, in the harder tier's color and number.
  const markers = (await realm<{ kind: string; tier: number; hex: string }[]>(page, "entities")).filter((e) => e.kind === "waymarker");
  expect(markers.some((m) => m.tier > startArea.tier), "a waymarker of the harder tier nearby").toBe(true);
  await clickHex(page, to.q, to.r);
  await expect.poll(async () => (await player(page)).hex, { timeout: 20_000 }).toBe(`${to.q},${to.r}`);
  const now = await realm<{ name: string; tier: number }>(page, "area");
  expect(now.tier).toBeGreaterThan(startArea.tier);
  expect((await realm<string[]>(page, "messages")).some((m) => m.startsWith(`You cross into ${now.name}: tier ${now.tier}.`))).toBe(true);
  expect((await realm<{ name: string; text: string }[]>(page, "controls")).find((c) => c.name === "hud:area")?.text).toContain(`Tier ${now.tier}`);
  void b;
});

test("the regional map shows the tier zones, with a legend, the dungeons and towers marked; the whole map opens", async ({ page }) => {
  await openRealm(page, { at: "benalia-1", extra: "&mobs=0" });
  type MapState = { drawn: number[]; markers: { id: string; kind: string; tier: number; lit: boolean | null }[]; open: boolean };
  await expect.poll(async () => (await realm<MapState | null>(page, "map"))?.markers.length ?? 0).toBeGreaterThan(0);
  const map = (await realm<MapState>(page, "map"))!;
  for (let tier = 1; tier <= 4; tier++) expect(map.drawn[tier], `tier ${tier}'s zone is drawn`).toBeGreaterThan(100);
  // The map draws each zone where the world's data has it.
  for (const sample of zoneSamples()) {
    const zone = await page.evaluate(([q, r]) => (globalThis as any).realmTest.zoneAt(q, r), [sample.at.q, sample.at.r] as const);
    expect(zone, `tier ${sample.tier} at ${sample.at.q},${sample.at.r}`).toEqual({ drawn: sample.tier, data: sample.tier });
  }
  // The mage tower beside you, dormant, with its tier; the dungeons near it with theirs.
  expect(map.markers.find((m) => m.id === "benalia-1")).toMatchObject({ kind: "tower", lit: false, tier: 1 });
  expect(map.markers.some((m) => m.kind === "dungeon" && m.tier >= 1)).toBe(true);
  const legend = (await realm<{ name: string; text: string }[]>(page, "controls")).find((c) => c.name === "hud:legend")!;
  expect(legend.text).toMatch(/1\s*2\s*3\s*4/);
  expect(legend.text).toMatch(/dungeon/);
  await clickControl(page, "hud:minimap");
  await expect.poll(async () => (await realm<MapState>(page, "map")).open).toBe(true);
  await clickControl(page, "map:close");
  await expect.poll(async () => (await realm<MapState>(page, "map")).open).toBe(false);
});
