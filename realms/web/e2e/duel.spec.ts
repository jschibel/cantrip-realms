import { type Page, expect, test } from "@playwright/test";
import { spawnNear } from "./places";
import { at, clickControl, entity, openNear, openRealm, realm, waitReady } from "./realm";

// The card layer is absent here: its stand-in (?offline uses it) records every request, and these tests assert the
// duel and loot requests through it, then answer them with its buttons.

const spawn = spawnNear("new-benalia");

async function engage(page: Page): Promise<void> {
  await openRealm(page, { at: at(openNear(spawn, 6)) });
  const mob = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  expect(spawn.mobs).toContain(mob.id);
  await page.mouse.click(mob.x, mob.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 20_000 }).toBe("duel");
  const requests = await realm<{ screen: string; args: Record<string, any> }[]>(page, "layer.requests");
  const duel = requests.find((r) => r.screen === "duel")!;
  expect(duel.args.mob).toMatchObject({ id: mob.id, map: "world", spawn: spawn.id });
  expect(duel.args.duel.Cap).toBe(Math.min(duel.args.duel.AnteValue, duel.args.duel.Mob.Prize));
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.find((c) => c.name === "startEncounter")?.body).toEqual({ Spawn: spawn.id, Mob: mob.id });
}

test("engaging a wanderer asks for a duel; winning offers loot and the mob is gone", async ({ page }) => {
  await engage(page);
  await clickControl(page, "layer:win");
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe("loot");
  await clickControl(page, "layer:take");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");
  const calls = (await realm<{ name: string }[]>(page, "api")).map((c) => c.name);
  expect(calls).toEqual(expect.arrayContaining(["startEncounter", "finishEncounter", "takeLoot"]));
  expect((await realm<{ kind: string; spawn?: string }[]>(page, "entities")).some((e) => e.kind === "mob" && e.spawn === spawn.id)).toBe(false);
  expect((await realm<string[]>(page, "messages")).some((m) => /You defeated the/.test(m))).toBe(true);
});

test("losing a duel wakes you outside your inn: the start town's, with none set", async ({ page }) => {
  await engage(page);
  await clickControl(page, "layer:lose");
  await expect.poll(() => realm<string>(page, "message"), { timeout: 20_000 }).toMatch(/You lost the duel, and wake at the inn in New Argive/);
  await waitReady(page);
  expect(await realm<{ name: string; tier: number }>(page, "area")).toMatchObject({ name: "New Argive", tier: 0 });
});
