import { type Page, expect, test } from "@playwright/test";
import { at, clickControl, entity, mapData, openNear, openRealm, realm, waitMap } from "./realm";

// The card layer is absent here: its stand-in (?offline uses it) records every request, and these tests assert the
// duel and loot requests through it, then answer them with its buttons.

const meadow = mapData("benalish-meadow");
const scoutSpawn = meadow.spawns.find((s) => s.id === "s1")!;

async function engageScout(page: Page): Promise<void> {
  await openRealm(page, { at: at(meadow, openNear(meadow, scoutSpawn, 8)) });
  const scout = await entity(page, (e) => e.kind === "mob" && e.spawn === "s1", "the Phyrexian scout");
  expect(scout.id).toBe("phyrexian-scout");
  await page.mouse.click(scout.x, scout.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 20_000 }).toBe("duel");
  const requests = await realm<{ screen: string; args: Record<string, any> }[]>(page, "layer.requests");
  const duel = requests.find((r) => r.screen === "duel")!;
  expect(duel.args.mob).toMatchObject({ id: "phyrexian-scout", map: "benalish-meadow", spawn: "s1" });
  expect(duel.args.token).toMatch(/^duel-/);
  expect(duel.args.duel.Cap).toBe(Math.min(duel.args.duel.AnteValue, duel.args.duel.Mob.Prize));
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.find((c) => c.name === "startEncounter")?.body).toEqual({ Map: "benalish-meadow", Spawn: "s1", Mob: "phyrexian-scout" });
}

test("engaging a mob asks for a duel; winning offers loot and the mob is gone", async ({ page }) => {
  await engageScout(page);
  await clickControl(page, "layer:win");
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe("loot");
  await clickControl(page, "layer:take");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");
  const calls = (await realm<{ name: string }[]>(page, "api")).map((c) => c.name);
  expect(calls).toEqual(expect.arrayContaining(["startEncounter", "finishEncounter", "takeLoot"]));
  expect((await realm<{ kind: string; spawn?: string }[]>(page, "entities")).some((e) => e.kind === "mob" && e.spawn === "s1")).toBe(false);
  expect((await realm<string[]>(page, "messages")).some((m) => /You defeated the Phyrexian Scout/.test(m))).toBe(true);
});

test("losing a duel wakes you at the nearest inn", async ({ page }) => {
  await engageScout(page);
  await clickControl(page, "layer:lose");
  await waitMap(page, /^(new-benalia|capashen-hold|new-argive)$/);
  await expect.poll(() => realm<string>(page, "message")).toMatch(/You lost the duel, and wake at the inn/);
  expect(["town", "village"]).toContain(await realm<string>(page, "map.kind"));
});
