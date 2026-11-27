import { expect, test } from "@playwright/test";
import { type Tile, chebyshev, clickEntity, clickWalk, enterTown, openRealm, standable, playerTile, realm, until, waitGround, waitSpace, world } from "./realm";

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
  // The way out of New Benalia whose road leads to Capashen Hold, and Capashen Hold's way in from New Benalia. Leaving a
  // town one did not come into by a way (waking at its inn), its gate leads out by its first way: New Benalia's is this.
  const out = from.ways!.find((w) => w.to === to.id)!;
  expect(from.ways![0], "New Benalia's gate leads out first to Capashen Hold").toBe(out);
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

  // Every place told the server was ground one stands on - never the icon's footprint, stepping out of it.
  const told = (await realm<{ name: string; body?: { Space: string; X: number; Z: number } }[]>(page, "api")).filter((c) => c.name === "position" && c.body?.Space === "world").map((c) => ({ x: c.body!.X, z: c.body!.Z }));
  expect(told.filter((t) => !standable(t)), "places told the server that nobody can stand on").toEqual([]);
  expect(await jumps(page), "no jump all the way").toEqual([]);
  expect(await realm<string[]>(page, "refused"), "no walk refused").toEqual([]);
  expect(errors).toEqual([]);
});

test("in by any road's way and out through the gate by the same way: the player comes out where they went in", async ({ page }) => {
  test.setTimeout(180_000);
  const town = world().towns.find((t) => t.id === "new-benalia")!;
  expect(town.ways!.length, "a town with more than one road").toBeGreaterThan(1);
  // The last way, not the one the gate leads out by when nobody came in.
  const way = town.ways!.at(-1)!;
  const errors = await openRealm(page, { at: `world:${way.outside[0]},${way.outside[1]}`, extra: "&mobs=0" });
  // In by the icon from where the player stands: that way's door of it (a click on another's walks round to that one).
  await clickEntity(page, (e) => e.kind === "town" && e.to === `way:${town.id}:${way.side}:in`, `${town.id}'s icon from its ${way.side} road`);
  await waitGround(page, town.id);
  expect(chebyshev(await playerTile(page), tile(way.inside))).toBeLessThanOrEqual(1);
  // Every way shares the gate; walking out through it leaves by the way taken in.
  await clickEntity(page, (e) => e.kind === "town-out", "the gate out");
  await waitGround(page, null);
  expect(await playerTile(page)).toEqual(tile(way.outside));
  expect(await jumps(page), "no jump").toEqual([]);
  expect(await realm<string[]>(page, "refused"), "no walk refused").toEqual([]);
  expect(errors).toEqual([]);
});
