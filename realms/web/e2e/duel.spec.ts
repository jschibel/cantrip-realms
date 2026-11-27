import { type Page, expect, test } from "@playwright/test";
import { spawnNear } from "./places";
import { advance, at, chebyshev, clickClear, clickControl, entities, openNear, openRealm, playerTile, realm, until, world } from "./realm";

// Duels in the Domains: the card layer is absent here; its stand-in (?offline uses it) records every request, and these
// tests assert the duel requests through it, then answer them with its buttons. Every fight is the player's choice: a
// wanderer a player comes near watches them and waits to be clicked. A loss and its hearts are hearts.spec.ts.

const spawn = spawnNear("new-benalia");
async function engage(page: Page): Promise<void> {
  await openRealm(page, { at: at(openNear(spawn, 4)) });
  // A click on the spawn's mob.
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

test("a wanderer a player comes near stops and watches them, and no duel starts until they click it", async ({ page }) => {
  // A few tiles from its spawn, within its notice (entities.ts NOTICE_RANGE): the player stands still for twenty seconds.
  const start = openNear(spawn, 3);
  await openRealm(page, { at: at(start) });
  expect(world().travel && start.x < world().travel![2], "on the travel map").toBe(true);
  const first = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === spawn.id);
  expect(first, "the spawn's mob").toBeDefined();
  let moved = 0;
  let last = first!.tile;
  for (let i = 0; i < 100; i++) {
    await advance(page, 0.2);
    expect(await realm<string | null>(page, "layer.open"), "no duel the player did not ask for").toBeNull();
    const m = (await entities(page)).find((e) => e.kind === "mob" && e.spawn === spawn.id)!;
    if (m.tile.x !== last.x || m.tile.z !== last.z) moved++;
    last = m.tile;
  }
  // It came no nearer than a step it may have been taking when the player arrived, and never to the player's side.
  expect(moved, "it stood to watch").toBeLessThanOrEqual(1);
  expect(chebyshev(last, start), "it kept its distance").toBeGreaterThan(1);
  expect(await playerTile(page)).toEqual(start);
  // Clicked, it is engaged: the player walks up to it and the duel opens.
  await clickClear(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "the duel opens on a click", 30);
});

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
