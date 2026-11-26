import { expect, test } from "@playwright/test";
import { TRADERS_IN, at, chebyshev, clickControl, clickEntity, enterTown, openNear, openRealm, playerTile, realm, until, world } from "./realm";

// Across the world: a ferry to a far isle, crossed seamlessly; the traveling vendors from other planes at their
// caravan pitches by the schedule, and the HUD saying who is in town.

test("a ferry crosses to the far isle: board at the dock, ride the lane, step off on the other shore", async ({ page }) => {
  test.setTimeout(180_000);
  const ferry = world().ferries.find((f) => f.id === "keldon-ferry")!;
  const dock = { x: ferry.from[0], z: ferry.from[1] };
  await openRealm(page, { at: at(openNear(dock, 3)), extra: "&mobs=0" });
  // The lane is closed to walking.
  const [lx, lz] = ferry.lane[Math.floor(ferry.lane.length / 2)]!;
  expect(await page.evaluate(([x, z]) => (globalThis as any).realmTest.walkable(x, z), [lx, lz] as const)).toBe(false);
  await clickEntity(page, (e) => e.kind === "ferryman" && chebyshev(e.tile, dock) <= 2, "the ferryman");
  await until(page, async () => (await realm<string>(page, "screen")) === "dialog", "the ferryman's word", 20);
  await clickControl(page, "dialog:board");
  await until(page, async () => (await realm<string[]>(page, "messages")).some((m) => m.startsWith(`You board ${ferry.name}`)), "aboard", 20);
  expect(await realm<boolean>(page, "ferrying")).toBe(true);
  await until(page, async () => (await realm<string[]>(page, "messages")).some((m) => m.startsWith("You step off at")), "stepped off", 120);
  expect(chebyshev(await playerTile(page), { x: ferry.to[0], z: ferry.to[1] })).toBeLessThanOrEqual(1);
  expect(await realm<boolean>(page, "ferrying")).toBe(false);
  expect(await realm<string>(page, "space.id")).toBe("world");
});

test("a trader from another plane keeps a caravan at the pitch while the schedule says, and opens their wares", async ({ page }) => {
  const pitch = world().pitches.find((p) => p.town === "new-benalia")!;
  await openRealm(page, { at: at(openNear(pitch, 3)), extra: "&mobs=0", now: TRADERS_IN });
  type Traveler = { Id: string; Visit: { Town: string } | null };
  await until(page, async () => (await realm<Traveler[]>(page, "travelers")).length > 0, "the schedule");
  const visit = (await realm<Traveler[]>(page, "travelers")).find((t) => t.Visit?.Town === "new-benalia")!;
  expect(visit.Id).toMatch(/-trader$/);
  const trader = await clickEntity(page, (e) => e.kind === "vendor" && e.id === visit.Id, "the trader at the pitch");
  expect(trader.tile).toEqual({ x: pitch.x, z: pitch.z });
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "vendor", "the trader's wares", 20);
  const requests = await realm<{ screen: string; args: { id?: string } }[]>(page, "layer.requests");
  expect(requests.at(-1)).toMatchObject({ screen: "vendor", args: { id: visit.Id } });
});

test("coming into a town, the HUD says which trader is there and until when", async ({ page }) => {
  test.setTimeout(120_000);
  const town = world().towns.find((t) => t.id === "capashen-hold")!;
  const road = world().roads.find((r) => r.from === town.id || r.to === town.id)!;
  const tiles = (road.from === town.id ? road.tiles : [...road.tiles].reverse()).map(([x, z]) => ({ x, z }));
  // A few tiles out along a road from the town's icon on the travel map, then in by the icon.
  const site = { x: town.site![0], z: town.site![1] };
  const outside = tiles.findIndex((t) => chebyshev(t, site) > 8);
  await openRealm(page, { at: at(tiles[Math.max(0, outside)]!), extra: "&mobs=0", now: TRADERS_IN });
  await until(page, async () => (await realm<unknown[]>(page, "travelers")).length > 0, "the schedule");
  expect((await realm<string[]>(page, "messages")).some((m) => /^A trader from/.test(m)), "no trader told of on the travel map").toBe(false);
  await enterTown(page, town.id);
  await until(page, async () => (await realm<string[]>(page, "messages")).some((m) => /^A trader from [\w ]+ is in Capashen Hold until \d\d:\d\d\.$/.test(m)), "the trader announced");
});
