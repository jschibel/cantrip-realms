import { expect, test } from "@playwright/test";
import { chunkBorder, spawnNear, tierRise, zoneSamples } from "./places";
import { at, clickControl, clickTile, entities, entity, openNear, openRealm, playerTile, realm, until, walkTo } from "./realm";

// The connected world: walking across a chunk's border with no seam, the chunks round the player built; what the
// pointer is over; and the tier zones - on the regional map with its legend, at their boundaries in the world, and in
// the HUD, which says so on crossing into a harder one.

const own = (t: { x: number; z: number }) => `${Math.floor(t.x / 32)}_${Math.floor(t.z / 32)}`;

test("walking across a chunk border is seamless: the next chunk is there, and the far ones go", async ({ page }) => {
  const { from, to, a, b } = chunkBorder();
  await openRealm(page, { at: at(from), extra: "&mobs=0" });
  const before = await realm<{ loaded: string[]; built: string[] }>(page, "chunks");
  expect(before.built).toEqual(expect.arrayContaining([own(a), own(b)]));
  await clickTile(page, to.x, to.z);
  await until(page, async () => {
    const t = await playerTile(page);
    return t.x === to.x && t.z === to.z;
  }, "walked over the border", 20);
  expect(own(to)).not.toBe(own(from));
  expect(await realm<string>(page, "space.id")).toBe("world");
  expect((await realm<{ built: string[] }>(page, "chunks")).built).toContain(own(to));
});

test("the cursor and the tooltip say what the pointer is over: a wanderer's name and tier", async ({ page }) => {
  const spawn = spawnNear("new-benalia");
  await openRealm(page, { at: at(openNear(spawn, 5)) });
  await advance1(page);
  const mob = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await page.mouse.move(mob.x, mob.y);
  await until(page, async () => (await realm<string>(page, "cursor")) === "attack", "the attack cursor", 5);
  await until(page, async () => (await realm<string | null>(page, "tooltip")) === `${mob.name} - tier ${spawn.tier}`, "the mob's name and tier", 5);
});

async function advance1(page: Parameters<typeof realm>[0]): Promise<void> {
  await page.evaluate(() => (globalThis as any).realmTest.advance(0.5));
}

test("the HUD names the area and its tier, and says so on crossing into a harder one, past a waymarker", async ({ page }) => {
  const { from, to } = tierRise();
  await openRealm(page, { at: at(from), extra: "&mobs=0" });
  const startArea = await realm<{ name: string; tier: number }>(page, "area");
  const area = await realm<{ name: string; text: string }[]>(page, "controls");
  expect(area.find((c) => c.name === "hud:area")?.text).toContain(startArea.name);
  // A waymarker stands at the boundary, in the harder tier's color and number.
  const markers = (await entities(page)).filter((e) => e.kind === "waymarker");
  expect(markers.some((m) => (m.tier ?? 0) > startArea.tier), "a waymarker of the harder tier nearby").toBe(true);
  await walkTo(page, to);
  const now = await realm<{ name: string; tier: number }>(page, "area");
  expect(now.tier).toBeGreaterThan(startArea.tier);
  expect((await realm<string[]>(page, "messages")).some((m) => m.startsWith(`You cross into ${now.name}: tier ${now.tier}.`))).toBe(true);
  expect((await realm<{ name: string; text: string }[]>(page, "controls")).find((c) => c.name === "hud:area")?.text).toContain(`Tier ${now.tier}`);
});

test("the regional map shows the tier zones, with a legend, the dungeons and towers marked; the whole map opens", async ({ page }) => {
  await openRealm(page, { at: "benalia-1", extra: "&mobs=0" });
  type MapState = { drawn: number[]; markers: { id: string; kind: string; tier: number; lit: boolean | null }[]; open: boolean };
  await until(page, async () => ((await realm<MapState | null>(page, "map"))?.markers.length ?? 0) > 0, "the map's markers");
  const map = (await realm<MapState>(page, "map"))!;
  for (let tier = 1; tier <= 4; tier++) expect(map.drawn[tier], `tier ${tier}'s zone is drawn`).toBeGreaterThan(100);
  // The map draws each zone where the world's data has it.
  for (const sample of zoneSamples()) {
    const zone = await page.evaluate(([x, z]) => (globalThis as any).realmTest.zoneAt(x, z), [sample.at.x, sample.at.z] as const);
    expect(zone, `tier ${sample.tier} at ${sample.at.x},${sample.at.z}`).toEqual({ drawn: sample.tier, data: sample.tier });
  }
  // The mage tower beside you, dormant, with its tier; the dungeons near it with theirs.
  expect(map.markers.find((m) => m.id === "benalia-1")).toMatchObject({ kind: "tower", lit: false, tier: 1 });
  expect(map.markers.some((m) => m.kind === "dungeon" && m.tier >= 1)).toBe(true);
  const legend = (await realm<{ name: string; text: string }[]>(page, "controls")).find((c) => c.name === "hud:legend")!;
  expect(legend.text).toMatch(/1\s*2\s*3\s*4/);
  expect(legend.text).toMatch(/dungeon/);
  await clickControl(page, "hud:minimap");
  await until(page, async () => (await realm<MapState>(page, "map")).open, "the whole map");
  await clickControl(page, "map:close");
  await until(page, async () => !(await realm<MapState>(page, "map")).open, "the map closed");
});
