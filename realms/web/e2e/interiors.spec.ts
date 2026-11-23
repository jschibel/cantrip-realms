import { expect, test } from "@playwright/test";
import { doorOf } from "./places";
import { at, chebyshev, clickControl, clickEntity, entity, openNear, openRealm, playerTile, realm, until, waitSpace, walkTo, world } from "./realm";

// Interiors: through a door with no loading screen, the shop's vendor at their counter, the inn's keeper and spell
// table, and out again to the street the door opens on.

const open = (page: Parameters<typeof realm>[0]) => realm<string | null>(page, "layer.open");

test("into a shop and out again: the vendor inside, and back on the street before the door", async ({ page }) => {
  const shop = "argive-goblin-trader-shop";
  const door = doorOf(shop);
  await openRealm(page, { at: at(openNear(door, 3)), extra: "&mobs=0" });
  const way = await entity(page, (e) => e.kind === "door" && e.to === shop, "the shop's door");
  await page.mouse.move(way.x, way.y);
  await until(page, async () => (await realm<string>(page, "cursor")) === "exit", "the cursor says a way in");
  await page.mouse.click(way.x, way.y);
  await waitSpace(page, shop);
  expect(await realm<string>(page, "space.kind")).toBe("interior");
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.filter((c) => c.name === "position").at(-1)?.body).toMatchObject({ Space: shop });

  await clickEntity(page, (e) => e.kind === "vendor" && e.id === "argive-goblin-trader", "the vendor");
  await until(page, async () => (await open(page)) === "vendor", "the vendor's wares", 20);
  const requests = await realm<{ screen: string; args: { id?: string } }[]>(page, "layer.requests");
  expect(requests.at(-1)).toMatchObject({ screen: "vendor", args: { id: "argive-goblin-trader" } });
  await clickControl(page, "layer:close");
  await until(page, async () => (await realm<string>(page, "screen")) === "world", "back from the wares");

  await clickEntity(page, (e) => e.kind === "leave", "the door out");
  await waitSpace(page, "world");
  expect(chebyshev(await playerTile(page), door)).toBeLessThanOrEqual(1);
});

test("the inn: its keeper lets you rest, and its spell table opens the spellbook", async ({ page }) => {
  const inn = "new-benalia-inn";
  await openRealm(page, { at: inn, extra: "&mobs=0" });
  expect(await realm<string>(page, "space.id")).toBe(inn);
  await clickEntity(page, (e) => e.kind === "spell-table", "the spell table");
  await until(page, async () => (await open(page)) === "spell-table", "the spellbook", 20);
  await clickControl(page, "layer:close");
  await until(page, async () => (await realm<string>(page, "screen")) === "world", "back from the spellbook");
  await clickEntity(page, (e) => e.kind === "innkeeper", "the innkeeper");
  await until(page, async () => (await realm<string>(page, "screen")) === "dialog", "the innkeeper's word", 20);
  await clickControl(page, "dialog:rest");
  await until(page, async () => /You rest at/.test((await realm<string>(page, "message")) ?? ""), "rested");
});

test("the quest board stands in the town, used from beside it", async ({ page }) => {
  const town = world().towns.find((t) => t.id === "new-benalia")!;
  await openRealm(page, { at: "new-benalia", extra: "&mobs=0" });
  const board = await entity(page, (e) => e.kind === "quest-board", "the quest board", 5).catch(() => null);
  if (!board) {
    // Not in view from the square: walk to it (its tile from the world's files).
    const { chunk } = await import("./realm");
    const near = [];
    for (let cx = Math.floor((town.center[0] - 80) / 32); cx <= Math.floor((town.center[0] + 80) / 32); cx++)
      for (let cz = Math.floor((town.center[1] - 80) / 32); cz <= Math.floor((town.center[1] + 80) / 32); cz++) near.push(...(chunk(cx, cz)?.npcs ?? []));
    const q = near.find((n) => n.kind === "quest-board")!;
    await walkTo(page, { x: q.x, z: q.z }, 2);
  }
  await clickEntity(page, (e) => e.kind === "quest-board", "the quest board");
  await until(page, async () => (await realm<string>(page, "screen")) === "dialog", "the board's notices", 20);
  await clickControl(page, "dialog:close");
  await until(page, async () => (await realm<string>(page, "screen")) === "world", "back from the board");
});

test("the exotic wares shop: the dealer in wares from other planes", async ({ page }) => {
  const shop = "new-benalia-exotic-wares-shop";
  const door = doorOf(shop);
  await openRealm(page, { at: at(openNear(door, 3)), extra: "&mobs=0" });
  await clickEntity(page, (e) => e.kind === "door" && e.to === shop, "the shop's door");
  await waitSpace(page, shop);
  await clickEntity(page, (e) => e.kind === "vendor" && e.id === "new-benalia-exotic-wares", "the dealer");
  await until(page, async () => (await open(page)) === "vendor", "the dealer's wares", 20);
  expect((await realm<{ screen: string; args: { id?: string } }[]>(page, "layer.requests")).at(-1)).toMatchObject({ screen: "vendor", args: { id: "new-benalia-exotic-wares" } });
});
