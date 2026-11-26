import { expect, test } from "@playwright/test";
import { type Tile, chebyshev, clickEntity, clickWalk, enterTown, openRealm, playerTile, realm, until, waitGround, waitSpace, world } from "./realm";

// A journey across the world of two scales (design.md A6, "One world, two scales"), played as a player plays it, with
// real mouse clicks on the page: from New Benalia's inn out of its door, through the streets to the gate whose road leads
// to Capashen Hold, out along the road to the edge of the grounds and onto the travel map beside the capital's icon; along
// the road there to Capashen Hold's icon, into its grounds by a click on it, the hearts filled there; and through its
// streets into its inn. Never a jump, never a walk the relay refuses. Everything is read from world.json: the towns' ways
// and the roads between them, the inns.

const jumps = (page: Parameters<typeof realm>[0]) => page.evaluate(() => ((globalThis as any).realmTest.game.jumps as unknown[]).map((j) => JSON.stringify(j)));
const tile = (p: readonly [number, number]): Tile => ({ x: p[0], z: p[1] });

test("a journey: New Benalia's inn, out of its gate onto the travel map, the road to Capashen Hold, in by its icon, to its inn", async ({ page }) => {
  test.setTimeout(300_000);
  const from = world().towns.find((t) => t.id === "new-benalia")!;
  const to = world().towns.find((t) => t.id === "capashen-hold")!;
  // The way out of New Benalia whose road leads to Capashen Hold, and Capashen Hold's way in from New Benalia.
  const out = from.ways!.find((w) => w.to === to.id)!;
  const into = to.ways!.find((w) => w.to === from.id)!;
  expect(out, "New Benalia has a way to Capashen Hold").toBeDefined();
  expect(into, "Capashen Hold has a way to New Benalia").toBeDefined();
  const road = world().roads.find((r) => (r.from === from.id && r.to === to.id) || (r.from === to.id && r.to === from.id))!;
  const roadTiles = (road.from === from.id ? road.tiles : [...road.tiles].reverse()).map(tile);
  const inn = world().inns.find((i) => i.town === to.id)!;

  const errors = await openRealm(page, { at: `${from.id}-inn`, extra: "&mobs=0" });
  expect(await realm<string>(page, "space.id")).toBe(`${from.id}-inn`);

  // Out of the inn's door, onto the street in New Benalia's grounds.
  await clickEntity(page, (e) => e.kind === "leave", "the inn's door out");
  await waitGround(page, from.id);
  expect(await realm<string>(page, "area.name")).toBe(from.name);

  // Through the streets to the road in from the gate, and on to the edge of the grounds: an exit, clicked.
  await clickWalk(page, tile(out.inside), 1);
  await clickEntity(page, (e) => e.kind === "town-out" && e.to === `way:${from.id}:${out.side}:out`, "the road out");
  await waitGround(page, null);
  expect(await playerTile(page)).toEqual(tile(out.outside));
  expect(await realm<string | null>(page, "map.town")).toBeNull();

  // A heart missing (arranged): the travel map's wilds fill none.
  await page.evaluate(() => (globalThis as any).realmTest.setHearts(1));
  // Along the road to Capashen Hold's icon, then a click on it: in by the way nearest, the road from New Benalia.
  for (let i = 6; i < roadTiles.length; i += 6) await clickWalk(page, roadTiles[i]!, 1);
  await clickWalk(page, tile(into.outside), 2);
  expect(await realm<{ hearts: number }>(page, "character")).toMatchObject({ hearts: 1 });
  await enterTown(page, to.id);
  expect(chebyshev(await playerTile(page), tile(into.inside))).toBeLessThanOrEqual(1);
  expect(await realm<string>(page, "area.name")).toBe(to.name);
  await until(page, async () => (await realm<{ hearts: number }>(page, "character")).hearts === 2, "the hearts filled in the town", 10);
  const said = await realm<string[]>(page, "messages");
  expect(said.some((m) => m.startsWith(`Safe within ${to.name}, your hearts are restored`)), JSON.stringify(said.slice(-6))).toBe(true);
  await until(page, async () => (await realm<string | null>(page, "map.town")) === to.id, "the town's map");

  // Through its streets to its inn, and in.
  await clickWalk(page, { x: inn.x, z: inn.z + 1 }, 2);
  await clickEntity(page, (e) => e.kind === "door" && e.to === inn.interior, "the inn's door");
  await waitSpace(page, inn.interior);

  expect(await jumps(page), "no jump all the way").toEqual([]);
  expect(await realm<string[]>(page, "refused"), "no walk refused").toEqual([]);
  expect(errors).toEqual([]);
});
