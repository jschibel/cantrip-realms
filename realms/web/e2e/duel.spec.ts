import { type Page, expect, test } from "@playwright/test";
import { spawnNear } from "./places";
import { at, clickClear, clickControl, entities, openNear, openRealm, realm, until, waitReady } from "./realm";

// Duels in the Domains: the card layer is absent here; its stand-in (?offline uses it) records every request, and these
// tests assert the duel and loot requests through it, then answer them with its buttons.

const spawn = spawnNear("new-benalia");

async function engage(page: Page): Promise<void> {
  await openRealm(page, { at: at(openNear(spawn, 4)) });
  // A click on the spawn's mob (which may come for you first, being near).
  let clicked = false;
  await until(
    page,
    async () => {
      if ((await realm<string | null>(page, "layer.open")) === "duel") return true;
      const mob = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === spawn.id);
      if (mob && !clicked) {
        await clickClear(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
        clicked = true;
      }
      return false;
    },
    "the duel opens",
    30,
  );
  const requests = await realm<{ screen: string; args: Record<string, any> }[]>(page, "layer.requests");
  const duel = requests.find((r) => r.screen === "duel")!;
  expect(spawn.mobs).toContain(duel.args.mob.id);
  expect(duel.args.mob).toMatchObject({ map: "world", spawn: spawn.id });
  expect(duel.args.duel.Cap).toBe(Math.min(duel.args.duel.AnteValue, duel.args.duel.Mob.Prize));
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.find((c) => c.name === "startEncounter")?.body).toEqual({ Spawn: spawn.id, Mob: duel.args.mob.id });
}

test("engaging a wanderer asks for a duel; winning offers loot and the mob is gone", async ({ page }) => {
  await engage(page);
  await clickControl(page, "layer:win");
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "loot", "the loot");
  await clickControl(page, "layer:take");
  await until(page, async () => (await realm<string>(page, "screen")) === "world", "back in the world");
  const calls = (await realm<{ name: string }[]>(page, "api")).map((c) => c.name);
  expect(calls).toEqual(expect.arrayContaining(["startEncounter", "finishEncounter", "takeLoot"]));
  expect((await realm<{ kind: string; spawn?: string }[]>(page, "entities")).some((e) => e.kind === "mob" && e.spawn === spawn.id)).toBe(false);
  expect((await realm<string[]>(page, "messages")).some((m) => /You defeated the/.test(m))).toBe(true);
});

test("losing a duel wakes you outside your inn: the start town's, with none set", async ({ page }) => {
  await engage(page);
  await clickControl(page, "layer:lose");
  await until(page, async () => /You lost the duel, and wake at the inn in New Benalia/.test((await realm<string>(page, "message")) ?? ""), "woken at the inn", 30);
  await waitReady(page);
  expect(await realm<{ name: string; tier: number }>(page, "area")).toMatchObject({ name: "New Benalia", tier: 0 });
});
