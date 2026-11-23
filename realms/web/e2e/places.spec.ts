import { expect, test } from "@playwright/test";
import { at, clickControl, entity, mapData, openNear, openRealm, player, realm, waitMap } from "./realm";

test("an exit takes you to the next map, beside its way back", async ({ page }) => {
  const meadow = mapData("benalish-meadow");
  const exit = meadow.exits.find((e) => e.to === "new-benalia")!;
  await openRealm(page, { at: at(meadow, openNear(meadow, exit, 2)) });
  const way = await entity(page, (e) => e.kind === "exit" && e.to === "new-benalia", "the road to New Benalia");
  await page.mouse.click(way.x, way.y);
  await waitMap(page, "new-benalia");
  const back = mapData("new-benalia").exits.find((e) => e.to === "benalish-meadow")!;
  const [q, r] = (await player(page)).hex.split(",").map(Number);
  expect(Math.max(Math.abs(q! - back.q), Math.abs(r! - back.r), Math.abs(q! + r! - back.q - back.r))).toBe(1);
});

test("the world map: travel along the roads to New Argive", async ({ page }) => {
  const meadow = mapData("benalish-meadow");
  const exit = meadow.exits.find((e) => e.to === "world")!;
  await openRealm(page, { at: at(meadow, openNear(meadow, exit, 2)) });
  const way = await entity(page, (e) => e.kind === "exit" && e.to === "world", "the way to the world map");
  await page.mouse.click(way.x, way.y);
  await expect.poll(() => realm<string>(page, "screen")).toBe("travel");
  expect(await realm<string>(page, "travel.here")).toBe("benalish-meadow");
  // Every place's name loads.
  await expect.poll(async () => (await realm<{ name: string; id: string }[]>(page, "travel.places")).find((p) => p.id === "new-argive")?.name).toBe("New Argive");
  const argive = (await realm<{ id: string; x: number; y: number }[]>(page, "travel.places")).find((p) => p.id === "new-argive")!;
  await page.mouse.click(argive.x, argive.y);
  await expect.poll(() => realm<boolean>(page, "travel.moving")).toBe(true);
  await waitMap(page, "new-argive");
  expect(await realm<string>(page, "map.kind")).toBe("town");
});

test("the Phyrexian Portal is sealed on the world map to a mage without all five colors", async ({ page }) => {
  const argive = mapData("new-argive");
  const exit = argive.exits.find((e) => e.to === "world")!;
  await openRealm(page, { at: at(argive, openNear(argive, exit, 1)), extra: "&mobs=0" });
  const way = await entity(page, (e) => e.kind === "exit" && e.to === "world", "the way to the world map");
  await page.mouse.click(way.x, way.y);
  await expect.poll(() => realm<string>(page, "screen")).toBe("travel");
  type Place = { id: string; name: string; locked: boolean; x: number; y: number };
  await expect.poll(async () => (await realm<Place[]>(page, "travel.places")).find((p) => p.id === "phyrexian-portal-1")?.name).toBe("The Phyrexian Portal, floor 1");
  const places = await realm<Place[]>(page, "travel.places");
  expect(places.find((p) => p.id === "phyrexian-portal-1")!.locked).toBe(true);
  expect(places.filter((p) => p.locked).map((p) => p.id)).toEqual(["phyrexian-portal-1"]);

  // The marker goes there, and stays on the world map: the way in is sealed.
  const portal = places.find((p) => p.id === "phyrexian-portal-1")!;
  await page.mouse.click(portal.x, portal.y);
  await expect.poll(() => realm<string | null>(page, "travel.here"), { timeout: 20_000 }).toBe("phyrexian-portal-1");
  await expect.poll(() => realm<string | null>(page, "travel.notice")).toMatch(/sealed/);
  expect(await realm<string>(page, "screen")).toBe("travel");
  expect(await realm<boolean>(page, "travel.moving")).toBe(false);
});

test("an encounter on the road drops you onto a small map with the mob", async ({ page }) => {
  const meadow = mapData("benalish-meadow");
  const exit = meadow.exits.find((e) => e.to === "world")!;
  await openRealm(page, { at: at(meadow, openNear(meadow, exit, 1)), encounters: "always" });
  const way = await entity(page, (e) => e.kind === "exit" && e.to === "world", "the way to the world map");
  await page.mouse.click(way.x, way.y);
  await expect.poll(() => realm<string>(page, "screen")).toBe("travel");
  const town = (await realm<{ id: string; x: number; y: number }[]>(page, "travel.places")).find((p) => p.id === "new-benalia")!;
  await page.mouse.click(town.x, town.y);
  await waitMap(page, "encounter-benalia");
  const mob = await entity(page, (e) => e.kind === "mob", "the mob of the encounter");
  expect(["phyrexian-scout", "benalish-deserter", "kjeldoran-raider", "serra-zealot"]).toContain(mob.id);
});

test("the people of a town: the spell table, a vendor, the quest board and the inn", async ({ page }) => {
  const town = mapData("new-benalia");
  const table = town.npcs.find((n) => n.kind === "spell-table")!;
  await openRealm(page, { at: at(town, openNear(town, table, 1)), extra: "&mobs=0" });

  const tableAt = await entity(page, (e) => e.kind === "spell-table", "the spell table");
  await page.mouse.click(tableAt.x, tableAt.y);
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe("spell-table");
  await clickControl(page, "layer:close");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");

  const vendor = town.npcs.find((n) => n.kind === "vendor")!;
  const vendorAt = await entity(page, (e) => e.id === vendor.id, "a vendor");
  await page.mouse.click(vendorAt.x, vendorAt.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 20_000 }).toBe("vendor");
  const requests = await realm<{ screen: string; args: { id?: string } }[]>(page, "layer.requests");
  expect(requests.at(-1)).toMatchObject({ screen: "vendor", args: { id: vendor.vendor } });
  await clickControl(page, "layer:close");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");

  const board = await entity(page, (e) => e.kind === "quest-board", "the quest board");
  await page.mouse.click(board.x, board.y);
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
  await clickControl(page, "dialog:close");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");

  const inn = await entity(page, (e) => e.kind === "inn", "the innkeeper");
  await page.mouse.click(inn.x, inn.y);
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
  await clickControl(page, "dialog:rest");
  await expect.poll(() => realm<string>(page, "message")).toMatch(/You rest at/);
});

test("a chest gives gold, once", async ({ page }) => {
  const meadow = mapData("benalish-meadow");
  const chest = meadow.chests.find((c) => c.id === "c2")!;
  await openRealm(page, { at: at(meadow, openNear(meadow, chest, 3)), extra: "&mobs=0" });
  const before = await realm<number>(page, "character.gold");
  const box = await entity(page, (e) => e.kind === "chest" && e.id === "c2", "the chest");
  await page.mouse.move(box.x, box.y);
  await expect.poll(() => realm<string>(page, "cursor")).toBe("open");
  await page.mouse.click(box.x, box.y);
  await expect.poll(() => realm<string>(page, "message")).toMatch(/You open the chest: \d+ gold/);
  expect(await realm<number>(page, "character.gold")).toBeGreaterThan(before);
  // The camera has followed you to the chest: find it again.
  const opened = await entity(page, (e) => e.kind === "chest" && e.id === "c2", "the chest");
  await page.mouse.click(opened.x, opened.y);
  await expect.poll(() => realm<string>(page, "message")).toBe("The chest is empty.");
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.filter((c) => c.name === "openChest")).toEqual([
    { name: "openChest", body: { Map: "benalish-meadow", Chest: "c2" } },
    { name: "openChest", body: { Map: "benalish-meadow", Chest: "c2" } },
  ]);
});
