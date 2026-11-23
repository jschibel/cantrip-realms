import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { hex } from "../../src/hex";
import { doorOf, spawnNear } from "../places";
import { at, clickControl, clickHex, entity, openNear, player, playerHex, realm, waitReady, waitSpace, walkNear, world } from "../realm";

// The overworld against the real realm server (playwright.config.ts here): a player signs in by the development
// sign-in, makes a character on the creation screen, walks a town and is seen walking by the server, asks a vendor for
// its screen, and starts an encounter through the real API - the duel screen itself is the card layer's (its stand-in
// records the request, and the test stops there).

const SERVER = process.env.REALMS_E2E_SERVER!;

/** The page's query: the real server, the stand-in card layer, the test hooks, and nothing left to chance. */
const query = (extra = "") => `/?server=${encodeURIComponent(SERVER)}&cards=stub&test&wander=0&encounters=never${extra}`;

/** Signs a player in on the server by the development sign-in: the cookie goes to the page's browser context. */
async function signIn(request: APIRequestContext, id: number, name: string): Promise<void> {
  const response = await request.post(new URL("dev/signin", SERVER).toString(), { data: { Id: id, Name: name } });
  expect(response.ok(), await response.text()).toBe(true);
}

/** A call to the server's API on the signed-in cookie: what the server says, not what the page shows. */
async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(new URL(`api/${path}`, SERVER).toString());
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

interface Me {
  readonly Id: string;
  readonly Name: string;
  readonly Body: string;
  readonly Identity: string;
  readonly Space: string;
  readonly Q: number;
  readonly R: number;
  readonly AnteValue: number;
  readonly Loadout: Record<string, { readonly InstanceId: number } | null>;
}

const requests = (page: Page) => realm<{ screen: string; args: Record<string, any> }[]>(page, "layer.requests");

test("a player signs in, makes a character, walks, visits a vendor and starts an encounter on the real server", async ({ page }) => {
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
  const inn = world().inns.find((i) => i.town === capital.id)!;
  expect(made).toMatchObject({ Id: "dev-1", Name: "Ann", Body: "stocky", Identity: "G", Space: "world", Q: inn.q, R: inn.r, AnteValue: 0 });
  expect(Object.values(made.Loadout).filter((worn) => worn !== null)).toHaveLength(3);
  expect(await realm<string>(page, "character.name")).toBe("Ann");
  expect(await realm<string[]>(page, "character.identity")).toEqual(["G"]);

  // Walking to Grizzlegom's shop: the server hears where the character stops.
  const { exit } = doorOf("argive-goblin-trader-shop");
  await walkNear(page, exit, 3);
  const stopped = await playerHex(page);
  await expect.poll(async () => {
    const me = await api<Me>(page.request, "me");
    return `${me.Space}:${me.Q},${me.R}`;
  }).toBe(`world:${stopped.q},${stopped.r}`);

  // Into the shop: the overworld asks the card layer for the vendor's screen, of a vendor the server keeps.
  const door = await entity(page, (e) => e.kind === "door" && e.to === "argive-goblin-trader-shop", "the shop's door");
  await page.mouse.click(door.x, door.y);
  await waitSpace(page, "argive-goblin-trader-shop");
  await expect.poll(async () => (await api<Me>(page.request, "me")).Space).toBe("argive-goblin-trader-shop");
  const vendor = await entity(page, (e) => e.kind === "vendor", "Grizzlegom");
  await page.mouse.click(vendor.x, vendor.y);
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe("vendor");
  expect((await requests(page)).find((r) => r.screen === "vendor")?.args).toMatchObject({ id: "argive-goblin-trader" });
  const shop = await api<{ Vendor: { Id: string; Town: string }; Purse: number; Stock: unknown[] }>(page.request, "vendor/argive-goblin-trader");
  expect(shop.Vendor).toMatchObject({ Id: "argive-goblin-trader", Town: capital.id });
  expect(shop.Stock.length).toBeGreaterThan(0);
  await clickControl(page, "layer:close");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");
  const out = await entity(page, (e) => e.kind === "leave", "the door out");
  await page.mouse.click(out.x, out.y);
  await waitSpace(page, "world");

  // Out to a spawn of the wilds by the capital: the mob the page shows is the one the server holds there, so the
  // encounter starts, and the duel the card layer is asked for is the server's.
  const spawn = spawnNear(capital.id);
  await walkNear(page, openNear(spawn, 6), 2);
  const mob = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await page.mouse.click(mob.x, mob.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 30_000 }).toBe("duel");
  const duel = (await requests(page)).find((r) => r.screen === "duel")!.args;
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
  void at;
  void waitReady;
});

test("players near each other in the world see each other walk through the real relay", async ({ browser }) => {
  const make = async (id: number, name: string, color: string) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await signIn(page.request, id, name);
    const made = await page.request.post(new URL("api/character", SERVER).toString(), { data: { Name: name, Body: "tall", Palette: 1, Color: color } });
    expect(made.ok(), await made.text()).toBe(true);
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

  await alice.context.close();
  await expect.poll(async () => (await realm<{ kind: string }[]>(bob.page, "entities")).some((e) => e.kind === "other")).toBe(false);
  await bob.context.close();
});
