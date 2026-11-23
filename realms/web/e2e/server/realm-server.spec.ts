import { expect, test } from "@playwright/test";
import { doorOf, spawnNear } from "../places";
import { clickControl, clickHex, entity, openNear, player, playerHex, realm, steady, waitSpace, walkNear, world } from "../realm";
import { type Me, api, character, query, requests, signIn, verdict } from "./server";

// The overworld against the real realm server on the real world (playwright.config.ts here): a player signs in by the
// development sign-in, makes a character on the creation screen, walks New Benalia's streets and is seen walking by the
// server, goes into a shop and asks its vendor for its screen, and starts an encounter in the wilds through the real
// API - the duel screen itself is the card layer's (its stand-in records the request, and the test stops there); and
// two players see each other walk in the world and in an inn.

test("a player signs in, makes a character, walks, visits a vendor and starts an encounter on the real server", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page.request, 1, "Ann");

  // No character yet: the creation screen, and what it makes is the server's: it begins outside the start town's inn.
  await page.goto(query());
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 30_000 }).toBe("create");
  await clickControl(page, "create:name");
  await page.keyboard.type("Ann");
  await clickControl(page, "create:body:stocky");
  await clickControl(page, "create:palette:4");
  await clickControl(page, "create:color:G");
  await clickControl(page, "create:create");
  await waitSpace(page, "world");
  const made = await api<Me>(page.request, "me");
  const capital = world().towns.find((t) => t.kind === "capital")!;
  expect(capital.id).toBe("new-benalia");
  const inn = world().inns.find((i) => i.town === capital.id)!;
  expect(made).toMatchObject({ Id: "dev-1", Name: "Ann", Body: "stocky", Identity: "G", Space: "world", Q: inn.q, R: inn.r, AnteValue: 0 });
  expect(Object.values(made.Loadout).filter((worn) => worn !== null)).toHaveLength(3);
  expect(await realm<string>(page, "character.name")).toBe("Ann");
  expect(await realm<string[]>(page, "character.identity")).toEqual(["G"]);

  // Along New Benalia's streets to Grizzlegom's shop: the server takes every step of the walk, and hears where it stops.
  const { exit } = doorOf("argive-goblin-trader-shop");
  await walkNear(page, exit, 3);
  const stopped = await playerHex(page);
  await expect.poll(async () => {
    const me = await api<Me>(page.request, "me");
    return `${me.Space}:${me.Q},${me.R}`;
  }).toBe(`world:${stopped.q},${stopped.r}`);

  // Into the shop: the overworld asks the card layer for the vendor's screen, of a vendor the server keeps there.
  const door = await steady(page, (e) => e.kind === "door" && e.to === "argive-goblin-trader-shop", "the shop's door");
  await page.mouse.click(door.x, door.y);
  await waitSpace(page, "argive-goblin-trader-shop");
  await expect.poll(async () => (await api<Me>(page.request, "me")).Space).toBe("argive-goblin-trader-shop");
  const vendor = await steady(page, (e) => e.kind === "vendor", "Grizzlegom");
  await page.mouse.click(vendor.x, vendor.y);
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe("vendor");
  expect((await requests(page)).find((r) => r.screen === "vendor")?.args).toMatchObject({ id: "argive-goblin-trader" });
  const shop = await api<{ Vendor: { Id: string; Town: string; Kind: string }; Purse: number; Stock: unknown[] }>(page.request, "vendor/argive-goblin-trader");
  expect(shop.Vendor).toMatchObject({ Id: "argive-goblin-trader", Town: capital.id, Kind: "shop" });
  expect(shop.Stock.length).toBeGreaterThan(0);
  await clickControl(page, "layer:close");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");
  const out = await steady(page, (e) => e.kind === "leave", "the door out");
  await page.mouse.click(out.x, out.y);
  await waitSpace(page, "world");
  await expect.poll(async () => (await api<Me>(page.request, "me")).Space).toBe("world");

  // Out through the gate to a spawn of the wilds by the capital: the mob the page shows is the one the server holds
  // there, so the encounter starts, and the duel the card layer is asked for is the server's. (A mob that comes for Ann
  // on the way is beaten by the stand-in, which the server counts as a win for this test: POST /dev/verdict.)
  await verdict(page.request, "won");
  const spawn = spawnNear(capital.id);
  const near = openNear(spawn, 6);
  await walkNear(page, near, 6);
  await walkNear(page, near, 2);
  const mob = await steady(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await page.mouse.click(mob.x, mob.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 30_000 }).toBe("duel");
  const duel = (await requests(page)).filter((r) => r.screen === "duel").at(-1)!.args;
  expect(duel.mob).toMatchObject({ id: mob.id, name: mob.name, map: "world", spawn: spawn.id });
  expect(duel.token).toEqual(expect.any(String));
  expect(duel.token).not.toMatch(/^duel-/);
  expect(duel.seed).toBe(duel.duel.Seed);
  expect(duel.duel.MinimumDeckSize).toBe(40);
  expect(duel.duel.Mob).toMatchObject({ Name: mob.name, Tier: spawn.tier });
  expect(duel.duel.Seats).toHaveLength(2);
  expect(duel.duel.Seats[0]).toMatchObject({ Name: "Ann", StartingLife: expect.any(Number), StartingHandSize: 7 });
  expect(duel.duel.Seats[0].Deck).toHaveLength(40);
  expect(duel.duel.Seats[1].Name).toBe(mob.name);
});

test("players near each other see each other walk through the real relay, in the world and in an inn", async ({ browser }) => {
  test.setTimeout(180_000);
  const make = async (id: number, name: string, color: string) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await character(page.request, id, name, color);
    await page.goto(query("&mobs=0"));
    await waitSpace(page, "world");
    return { context, page };
  };
  const alice = await make(2, "Alice", "U");
  const bob = await make(3, "Bob", "R");

  const seen = await entity(bob.page, (e) => e.kind === "other" && e.name === "Alice", "Alice, seen by Bob");
  await entity(alice.page, (e) => e.kind === "other" && e.name === "Bob", "Bob, seen by Alice");

  // Alice walks a few hexes; Bob sees her get there.
  const goal = openNear(await playerHex(alice.page), 3);
  await clickHex(alice.page, goal.q, goal.r);
  await expect.poll(async () => (await player(alice.page)).hex).toBe(`${goal.q},${goal.r}`);
  const there = (await player(alice.page)).hex;
  expect(there).not.toBe(seen.hex);
  await expect.poll(async () => (await entity(bob.page, (e) => e.kind === "other" && e.name === "Alice", "Alice")).hex).toBe(there);

  // Both go into New Benalia's inn through its door and see each other inside, where Bob sees Alice walk too.
  for (const { page } of [alice, bob]) {
    const door = await steady(page, (e) => e.kind === "door" && e.to === "new-benalia-inn", "the inn's door");
    await page.mouse.click(door.x, door.y);
    await waitSpace(page, "new-benalia-inn");
    await expect.poll(async () => (await api<Me>(page.request, "me")).Space).toBe("new-benalia-inn");
  }
  await entity(alice.page, (e) => e.kind === "other" && e.name === "Bob", "Bob, seen by Alice in the inn");
  await entity(bob.page, (e) => e.kind === "other" && e.name === "Alice", "Alice, seen by Bob in the inn");
  const from = await playerHex(alice.page);
  const door = (await entity(alice.page, (e) => e.kind === "leave", "the door out")).hex;
  const step = (await realm<string[]>(alice.page, "openHexes"))
    .filter((k) => k !== door)
    .map((k) => k.split(",").map(Number) as [number, number])
    .filter(([q, r]) => Math.max(Math.abs(q - from.q), Math.abs(r - from.r), Math.abs(q + r - from.q - from.r)) === 2)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]!;
  await clickHex(alice.page, step[0], step[1]);
  await expect.poll(async () => (await player(alice.page)).hex).toBe(`${step[0]},${step[1]}`);
  await expect.poll(async () => (await entity(bob.page, (e) => e.kind === "other" && e.name === "Alice", "Alice")).hex).toBe(`${step[0]},${step[1]}`);

  await alice.context.close();
  await expect.poll(async () => (await realm<{ kind: string }[]>(bob.page, "entities")).some((e) => e.kind === "other")).toBe(false);
  await bob.context.close();
});
