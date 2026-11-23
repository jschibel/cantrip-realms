import { expect, test } from "@playwright/test";
import { clickHex, entity, openRealm, player, realm } from "./realm";

test("a click walks you there along the road", async ({ page }) => {
  await openRealm(page, { at: "benalish-meadow:0,0" });
  expect((await player(page)).hex).toBe("0,0");
  await clickHex(page, 3, -3);
  await expect.poll(async () => (await player(page)).hex).toBe("3,-3");
  await expect.poll(async () => (await player(page)).moving).toBe(false);
});

test("the cursor says what a click would do", async ({ page }) => {
  await openRealm(page, { at: "benalish-meadow:0,0" });
  const table = await entity(page, (e) => e.kind === "spell-table", "the spell table");
  await page.mouse.move(table.x, table.y);
  await expect.poll(() => realm<string>(page, "cursor")).toBe("talk");
  const scout = await entity(page, (e) => e.kind === "mob" && e.spawn === "s1", "the scout");
  await page.mouse.move(scout.x, scout.y);
  await expect.poll(() => realm<string>(page, "cursor")).toBe("attack");
  await clickHex(page, 3, -3);
  await expect.poll(async () => (await player(page)).hex).toBe("3,-3");
  await clickHex(page, 9, -9);
  await expect.poll(async () => (await player(page)).hex).toBe("9,-9");
  const exit = await entity(page, (e) => e.kind === "exit" && e.to === "world", "the way to the world map");
  await page.mouse.move(exit.x, exit.y);
  await expect.poll(() => realm<string>(page, "cursor")).toBe("exit");
});
