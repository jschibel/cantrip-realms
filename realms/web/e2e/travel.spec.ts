import { expect, test } from "@playwright/test";
import { DIRECTIONS, distance, hex } from "../src/hex";
import { TRADERS_IN, at, clickControl, clickHex, entity, openNear, openRealm, player, playerHex, realm, world } from "./realm";

// Across the world: a ferry to a far isle, crossed seamlessly; the traveling vendors from other planes at their
// caravan pitches by the schedule, and the HUD saying who is in town.

test("a ferry crosses to the far isle: board at the dock, ride the lane, step off on the other shore", async ({ page }) => {
  test.setTimeout(120_000);
  const ferry = world().ferries.find((f) => f.id === "keldon-ferry")!;
  const dock = hex(ferry.from[0], ferry.from[1]);
  await openRealm(page, { at: at(openNear(dock, 2)), extra: "&mobs=0" });
  const man = await entity(page, (e) => e.kind === "ferryman" && distance(hex(...(e.hex.split(",").map(Number) as [number, number])), dock) === 1, "the ferryman");
  await page.mouse.click(man.x, man.y);
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
  await clickControl(page, "dialog:board");
  await expect.poll(() => realm<string>(page, "message"), { timeout: 60_000 }).toMatch(/You step off The Keldon Ferry/);
  const far = hex(ferry.to[0], ferry.to[1]);
  expect(distance(await playerHex(page), far)).toBeLessThanOrEqual(2);
  expect((await realm<string[]>(page, "messages")).some((m) => m.startsWith("You board The Keldon Ferry"))).toBe(true);
  expect(await realm<string>(page, "space.id")).toBe("world");
});

test("a trader from another plane keeps a caravan at the pitch while the schedule says, and opens their wares", async ({ page }) => {
  const pitch = world().pitches.find((p) => p.town === "new-benalia")!;
  await openRealm(page, { at: at(openNear(hex(pitch.q, pitch.r), 3)), extra: "&mobs=0", now: TRADERS_IN });
  type Traveler = { Id: string; Visit: { Town: string } | null };
  await expect.poll(async () => (await realm<Traveler[]>(page, "travelers")).length).toBe(15);
  const visit = (await realm<Traveler[]>(page, "travelers")).find((t) => t.Visit?.Town === "new-benalia")!;
  expect(visit.Id).toMatch(/-trader$/);
  const trader = await entity(page, (e) => e.kind === "vendor" && e.id === visit.Id, "the trader at the pitch");
  expect(trader.hex).toBe(`${pitch.q},${pitch.r}`);
  await page.mouse.click(trader.x, trader.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 20_000 }).toBe("vendor");
  const requests = await realm<{ screen: string; args: { id?: string } }[]>(page, "layer.requests");
  expect(requests.at(-1)).toMatchObject({ screen: "vendor", args: { id: visit.Id } });
});

test("coming into a town, the HUD says which trader is there and until when", async ({ page }) => {
  const town = world().towns.find((t) => t.id === "capashen-hold")!;
  const centre = hex(town.center[0], town.center[1]);
  const road = world().roads.find((r) => r.from === town.id || r.to === town.id)!;
  const hexes = (road.from === town.id ? road.hexes : [...road.hexes].reverse()).map(([q, r]) => hex(q, r));
  const gate = DIRECTIONS.map((d) => hex(hexes[0]!.q + d.q, hexes[0]!.r + d.r)).find((h) => distance(h, centre) === town.radius)!;
  await openRealm(page, { at: at(hexes[3]!), extra: "&mobs=0", now: TRADERS_IN });
  await clickHex(page, gate.q, gate.r);
  await expect.poll(async () => (await player(page)).hex, { timeout: 20_000 }).toBe(`${gate.q},${gate.r}`);
  await expect.poll(async () => (await realm<string[]>(page, "messages")).some((m) => /^A trader from [\w ]+ is in Capashen Hold until 10:00\.$/.test(m))).toBe(true);
});
