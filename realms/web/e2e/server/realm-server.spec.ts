import { expect, test } from "@playwright/test";
import { doorOf, spawnNear } from "../places";
import { advance, chebyshev, clickControl, clickEntity, entity, openNear, player, playerTile, realm, until, waitReady, waitSpace, walkTo, world } from "../realm";
import { type Me, api, character, query, requests, signIn, verdict } from "./server";

// The overworld against the real realm server on the generated Domains (playwright.config.ts here): a player signs in by
// the development sign-in, makes a character on the creation screen, walks New Benalia's streets and is seen walking by
// the server, goes into a shop and asks its vendor for its screen, and starts an encounter in the wilds through the real
// API - the duel screen itself is the card layer's (its stand-in records the request, and the test stops there); and
// two players see each other walk in the world and in an inn. The page runs on the manual clock; the server answers in
// its own time, which the tests wait on by moving the page's clock until it has.

test("a player signs in, makes a character, walks, visits a vendor and starts an encounter on the real server", async ({ page }) => {
  test.setTimeout(300_000);
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
  await waitReady(page);
  await waitSpace(page, "world");
  const made = await api<Me>(page.request, "me");
  const capital = world().towns.find((t) => t.kind === "capital")!;
  expect(capital.id).toBe("new-benalia");
  const inn = world().inns.find((i) => i.town === capital.id)!;
  expect(made).toMatchObject({ Id: "dev-1", Name: "Ann", Body: "stocky", Identity: "G", Space: "world", X: inn.x, Z: inn.z, AnteValue: 0 });
  expect(Object.values(made.Loadout).filter((worn) => worn !== null)).toHaveLength(3);
  expect(await realm<string>(page, "character.name")).toBe("Ann");
  expect(await realm<string[]>(page, "character.identity")).toEqual(["G"]);

  // Along New Benalia's streets to Grizzlegom's shop: the server takes every step of the walk, and hears where it stops.
  const door = doorOf("argive-goblin-trader-shop");
  await walkTo(page, door, 3);
  const stopped = await playerTile(page);
  await until(page, async () => {
    const me = await api<Me>(page.request, "me");
    return `${me.Space}:${me.X},${me.Z}` === `world:${stopped.x},${stopped.z}`;
  }, "the server heard where the walk stopped", 60);

  // Into the shop: the overworld asks the card layer for the vendor's screen, of a vendor the server keeps there.
  await clickEntity(page, (e) => e.kind === "door" && e.to === "argive-goblin-trader-shop", "the shop's door");
  await waitSpace(page, "argive-goblin-trader-shop");
  await until(page, async () => (await api<Me>(page.request, "me")).Space === "argive-goblin-trader-shop", "the server has Ann in the shop", 60);
  await clickEntity(page, (e) => e.kind === "vendor", "Grizzlegom");
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "vendor", "the vendor's screen", 60);
  expect((await requests(page)).find((r) => r.screen === "vendor")?.args).toMatchObject({ id: "argive-goblin-trader" });
  const shop = await api<{ Vendor: { Id: string; Town: string; Kind: string }; Purse: number; Stock: unknown[] }>(page.request, "vendor/argive-goblin-trader");
  expect(shop.Vendor).toMatchObject({ Id: "argive-goblin-trader", Town: capital.id, Kind: "shop" });
  expect(shop.Stock.length).toBeGreaterThan(0);
  await clickControl(page, "layer:close");
  await until(page, async () => (await realm<string>(page, "screen")) === "world", "back in the shop");
  await clickEntity(page, (e) => e.kind === "leave", "the door out");
  await waitSpace(page, "world");
  await until(page, async () => (await api<Me>(page.request, "me")).Space === "world", "the server has Ann outside", 60);

  // Out through the gate to a spawn of the wilds by the capital: the mob the page shows is the one the server holds
  // there, so the encounter starts, and the duel the card layer is asked for is the server's. (A mob that comes for Ann
  // on the way is beaten by the stand-in, which the server counts as a win for this test: POST /dev/verdict.)
  await verdict(page.request, "won");
  const spawn = spawnNear(capital.id);
  await walkTo(page, openNear(spawn, 4), 1);
  // The mob is clicked once - and again after any duel with another that came for Ann on the way cut the walk short.
  let clickedAfter = -1;
  await until(
    page,
    async () => {
      const open = (await realm<string | null>(page, "layer.open")) === "duel";
      const duels = (await requests(page)).filter((r) => r.screen === "duel");
      const last = duels.at(-1);
      // The spawn's duel was asked of the card layer (the stand-in may have won it and closed already).
      if (last?.args.mob.spawn === spawn.id) return true;
      const mob = (await realm<{ kind: string; spawn?: string; x: number; y: number }[]>(page, "entities")).find((e) => e.kind === "mob" && e.spawn === spawn.id);
      if (mob && clickedAfter < duels.length && !open) {
        await page.mouse.click(mob.x, mob.y);
        clickedAfter = duels.length;
      }
      return false;
    },
    "the spawn's duel",
    60,
  );
  const duel = (await requests(page)).filter((r) => r.screen === "duel").at(-1)!.args;
  expect(spawn.mobs).toContain(duel.mob.id);
  expect(duel.mob).toMatchObject({ map: "world", spawn: spawn.id });
  expect(duel.token).toEqual(expect.any(String));
  expect(duel.token).not.toMatch(/^duel-/);
  expect(duel.seed).toBe(duel.duel.Seed);
  expect(duel.duel.MinimumDeckSize).toBe(40);
  expect(duel.duel.Mob).toMatchObject({ Name: duel.mob.name, Tier: spawn.tier });
  expect(duel.duel.Seats).toHaveLength(2);
  expect(duel.duel.Seats[0]).toMatchObject({ Name: "Ann", StartingLife: expect.any(Number), StartingHandSize: 7 });
  expect(duel.duel.Seats[0].Deck).toHaveLength(40);
  expect(duel.duel.Seats[1].Name).toBe(duel.mob.name);
});

test("players near each other see each other walk through the real relay, in the world and in an inn", async ({ browser }) => {
  test.setTimeout(240_000);
  const make = async (id: number, name: string, color: string) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await character(page.request, id, name, color);
    await page.goto(query("&mobs=0"));
    await waitReady(page);
    await waitSpace(page, "world");
    return { context, page };
  };
  const alice = await make(2, "Alice", "U");
  const bob = await make(3, "Bob", "R");
  const other = (page: typeof alice.page, name: string) => entity(page, (e) => e.kind === "other" && e.name === name, name, 60);

  const seen = await other(bob.page, "Alice");
  await other(alice.page, "Bob");

  // Alice walks a few tiles; Bob sees her get there.
  const from = await playerTile(alice.page);
  const goal = openNear(from, 3);
  await walkTo(alice.page, goal);
  const there = await playerTile(alice.page);
  expect(chebyshev(there, seen.tile)).toBeGreaterThan(0);
  await until(bob.page, async () => {
    const a = await other(bob.page, "Alice");
    return a.tile.x === there.x && a.tile.z === there.z;
  }, "Bob sees Alice there", 60);

  // Both go into New Benalia's inn through its door and see each other inside, where Bob sees Alice walk too.
  for (const { page } of [alice, bob]) {
    await walkTo(page, doorOf("new-benalia-inn"), 2);
    await clickEntity(page, (e) => e.kind === "door" && e.to === "new-benalia-inn", "the inn's door");
    await waitSpace(page, "new-benalia-inn");
    await until(page, async () => (await api<Me>(page.request, "me")).Space === "new-benalia-inn", "the server has them in the inn", 60);
  }
  await other(alice.page, "Bob");
  await other(bob.page, "Alice");
  const inside = await playerTile(alice.page);
  const open = (await alice.page.evaluate(() => (globalThis as any).realmTest.openTiles(12) as string[]))
    .map((k) => k.split(",").map(Number) as [number, number])
    .filter(([x, z]) => chebyshev({ x, z }, inside) === 2 && z < inside.z)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]!;
  await walkTo(alice.page, { x: open[0], z: open[1] });
  const step = await playerTile(alice.page);
  await until(bob.page, async () => {
    const a = await other(bob.page, "Alice");
    return a.tile.x === step.x && a.tile.z === step.z;
  }, "Bob sees Alice walk in the inn", 60);

  await alice.context.close();
  await until(bob.page, async () => !(await realm<{ kind: string }[]>(bob.page, "entities")).some((e) => e.kind === "other"), "Alice gone", 60);
  await bob.context.close();
  void advance;
  void player;
});
