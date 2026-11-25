import { type Page, expect, test } from "@playwright/test";
import { spawnNear } from "./places";
import { at, clickClear, clickControl, entities, openNear, openRealm, realm, until, waitReady } from "./realm";

// Duels in the Domains: the card layer is absent here; its stand-in (?offline uses it) records every request, and these
// tests assert the duel requests through it, then answer them with its buttons. A loss and its hearts are hearts.spec.ts.

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
  expect(duel.args.duel).toMatchObject({ Game: 1, FirstPlayer: null });
  expect(duel.args.hearts).toEqual({ have: 2, hold: 2 });
  const calls = await realm<{ name: string; body?: unknown }[]>(page, "api");
  expect(calls.find((c) => c.name === "startEncounter")?.body).toEqual({ Spawn: spawn.id, Mob: duel.args.mob.id });
}

test("engaging a wanderer asks for a duel; winning pays gold and the mob is gone", async ({ page }) => {
  await engage(page);
  await clickControl(page, "layer:win");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "back in the world");
  const calls = (await realm<{ name: string }[]>(page, "api")).map((c) => c.name);
  expect(calls).toEqual(expect.arrayContaining(["startEncounter", "finishEncounter"]));
  expect((await realm<{ kind: string; spawn?: string }[]>(page, "entities")).some((e) => e.kind === "mob" && e.spawn === spawn.id)).toBe(false);
  expect((await realm<string[]>(page, "messages")).some((m) => /You defeated .*: \d+ gold\./.test(m))).toBe(true);
  expect((await realm<{ screen: string }[]>(page, "layer.requests")).some((r) => r.screen === "loot")).toBe(false);
});
