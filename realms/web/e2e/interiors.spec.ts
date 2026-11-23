import { expect, test } from "@playwright/test";
import { doorOf } from "./places";
import { at, clickControl, entity, openNear, openRealm, playerHex, realm, waitSpace } from "./realm";

// Interiors: through a door with no loading screen, the shop's vendor at their counter, the inn's keeper and spell
// table, and out again to the street the door opens on.

test("into a shop and out again: the vendor inside, and back on the street before the door", async ({ page }) => {
  const shop = "argive-goblin-trader-shop";
  const { door, exit } = doorOf(shop);
  await openRealm(page, { at: at(openNear(exit, 2)), extra: "&mobs=0" });
  const way = await entity(page, (e) => e.kind === "door" && e.to === shop, "the shop's door");
  await page.mouse.move(way.x, way.y);
  await expect.poll(() => realm<string>(page, "cursor")).toBe("exit");
  await expect.poll(() => realm<string | null>(page, "tooltip")).toBe("Grizzlegom's Goblins");
  await page.mouse.click(way.x, way.y);
  await waitSpace(page, shop);
  expect(await realm<string>(page, "space.kind")).toBe("interior");
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.filter((c) => c.name === "position").at(-1)?.body).toMatchObject({ Space: shop });

  const vendor = await entity(page, (e) => e.kind === "vendor", "the vendor");
  expect(vendor.id).toBe("argive-goblin-trader");
  await page.mouse.click(vendor.x, vendor.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 20_000 }).toBe("vendor");
  const requests = await realm<{ screen: string; args: { id?: string } }[]>(page, "layer.requests");
  expect(requests.at(-1)).toMatchObject({ screen: "vendor", args: { id: "argive-goblin-trader" } });
  await clickControl(page, "layer:close");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");

  const out = await entity(page, (e) => e.kind === "leave", "the door out");
  await page.mouse.click(out.x, out.y);
  await waitSpace(page, "world");
  expect(await playerHex(page)).toEqual(exit);
  void door;
});

test("the inn: its keeper lets you rest, and its spell table opens the spellbook", async ({ page }) => {
  const inn = "new-benalia-inn";
  await openRealm(page, { at: inn, extra: "&mobs=0" });
  expect(await realm<string>(page, "space.id")).toBe(inn);
  const table = await entity(page, (e) => e.kind === "spell-table", "the spell table");
  await page.mouse.click(table.x, table.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 20_000 }).toBe("spell-table");
  await clickControl(page, "layer:close");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");
  const keeper = await entity(page, (e) => e.kind === "inn", "the innkeeper");
  await page.mouse.click(keeper.x, keeper.y);
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
  await clickControl(page, "dialog:rest");
  await expect.poll(() => realm<string>(page, "message")).toMatch(/You rest at/);
});

test("the quest board stands outside the inn's door", async ({ page }) => {
  await openRealm(page, { at: "new-benalia", extra: "&mobs=0" });
  const board = await entity(page, (e) => e.kind === "quest-board", "the quest board");
  await page.mouse.click(board.x, board.y);
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
  await clickControl(page, "dialog:close");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");
});
