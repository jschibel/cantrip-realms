import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { hex } from "../../src/hex";
import { at, clickControl, clickHex, entity, mapData, openNear, player, realm, waitMap, waitReady, walkNear } from "../realm";

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
  readonly Map: string;
  readonly Q: number;
  readonly R: number;
  readonly AnteValue: number;
  readonly Loadout: Record<string, { readonly InstanceId: number } | null>;
}

const requests = (page: Page) => realm<{ screen: string; args: Record<string, any> }[]>(page, "layer.requests");

test("a player signs in, makes a character, walks, visits a vendor and starts an encounter on the real server", async ({ page }) => {
  await signIn(page.request, 1, "Ann");

  // No character yet: the creation screen, and what it makes is the server's.
  await page.goto(query());
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 30_000 }).toBe("create");
  await clickControl(page, "create:name");
  await page.keyboard.type("Ann");
  await clickControl(page, "create:body:stocky");
  await clickControl(page, "create:palette:4");
  await clickControl(page, "create:color:G");
  await clickControl(page, "create:create");
  await waitMap(page, "new-argive");
  const made = await api<Me>(page.request, "me");
  expect(made).toMatchObject({ Id: "dev-1", Name: "Ann", Body: "stocky", Identity: "G", Map: "new-argive", AnteValue: 0 });
  expect(Object.values(made.Loadout).filter((worn) => worn !== null)).toHaveLength(3);
  expect(await realm<string>(page, "character.name")).toBe("Ann");
  expect(await realm<string[]>(page, "character.identity")).toEqual(["G"]);

  // Walking: the server hears where the character stops.
  const town = mapData("new-argive");
  const vendor = town.npcs.find((n) => n.kind === "vendor" && n.vendor === "argive-goblin-trader")!;
  await walkNear(page, town, hex(vendor.q, vendor.r), 3);
  const stopped = (await player(page)).hex;
  await expect.poll(async () => {
    const me = await api<Me>(page.request, "me");
    return `${me.Map}:${me.Q},${me.R}`;
  }).toBe(`new-argive:${stopped}`);

  // A vendor's stall: the overworld asks the card layer for the vendor's screen, of a vendor the server keeps.
  const stall = await entity(page, (e) => e.id === vendor.id, "Grizzlegom's stall");
  await page.mouse.click(stall.x, stall.y);
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe("vendor");
  expect((await requests(page)).find((r) => r.screen === "vendor")?.args).toEqual({ id: "argive-goblin-trader", name: vendor.name });
  const shop = await api<{ Vendor: { Id: string; Town: string }; Purse: number; Stock: unknown[] }>(page.request, "vendor/argive-goblin-trader");
  expect(shop.Vendor).toMatchObject({ Id: "argive-goblin-trader", Town: "new-argive" });
  expect(shop.Stock.length).toBeGreaterThan(0);
  await clickControl(page, "layer:close");
  await expect.poll(() => realm<string>(page, "screen")).toBe("world");

  // The meadow, by its spawn of a lone Phyrexian scout: the mob the page shows is the one the server holds there, so
  // the encounter starts, and the duel the card layer is asked for is the server's.
  const meadow = mapData("benalish-meadow");
  const spawn = meadow.spawns.find((s) => s.id === "s1")!;
  await page.goto(query(`&at=${at(meadow, openNear(meadow, spawn, 6))}`));
  await waitReady(page);
  await expect.poll(async () => (await api<Me>(page.request, "me")).Map).toBe("benalish-meadow");
  const scout = await entity(page, (e) => e.kind === "mob" && e.spawn === "s1", "the Phyrexian scout");
  expect(scout.id).toBe("phyrexian-scout");
  await page.mouse.click(scout.x, scout.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 30_000 }).toBe("duel");
  const duel = (await requests(page)).find((r) => r.screen === "duel")!.args;
  expect(duel.mob).toMatchObject({ id: "phyrexian-scout", name: "Phyrexian Scout", map: "benalish-meadow", spawn: "s1" });
  expect(duel.token).toEqual(expect.any(String));
  expect(duel.token).not.toMatch(/^duel-/);
  expect(duel.seed).toBe(duel.duel.Seed);
  expect(duel.duel.MinimumDeckSize).toBe(40);
  expect(duel.duel.Mob).toEqual({ Name: "Phyrexian Scout", Tier: 1, Prize: 100 });
  expect(duel.duel.Seats).toHaveLength(2);
  expect(duel.duel.Seats[0]).toMatchObject({ Name: "Ann", StartingLife: expect.any(Number), StartingHandSize: 7 });
  expect(duel.duel.Seats[0].Deck).toHaveLength(40);
  expect(duel.duel.Seats[1].Name).toBe("Phyrexian Scout");
});

test("players on the same map see each other walk through the real relay", async ({ browser }) => {
  const make = async (id: number, name: string, color: string) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await signIn(page.request, id, name);
    const made = await page.request.post(new URL("api/character", SERVER).toString(), { data: { Name: name, Body: "tall", Palette: 1, Color: color } });
    expect(made.ok(), await made.text()).toBe(true);
    await page.goto(query("&mobs=0"));
    await waitMap(page, "new-argive");
    return { context, page };
  };
  const alice = await make(2, "Alice", "U");
  const bob = await make(3, "Bob", "R");

  const seen = await entity(bob.page, (e) => e.kind === "other" && e.name === "Alice", "Alice, seen by Bob");
  await entity(alice.page, (e) => e.kind === "other" && e.name === "Bob", "Bob, seen by Alice");

  // Alice walks a few hexes; Bob sees her get there.
  const town = mapData("new-argive");
  const from = (await player(alice.page)).hex.split(",").map(Number);
  const goal = openNear(town, hex(from[0]!, from[1]!), 3);
  await clickHex(alice.page, goal.q, goal.r);
  await expect.poll(async () => (await player(alice.page)).hex).toBe(`${goal.q},${goal.r}`);
  const there = (await player(alice.page)).hex;
  expect(there).not.toBe(seen.hex);
  await expect.poll(async () => (await entity(bob.page, (e) => e.kind === "other" && e.name === "Alice", "Alice")).hex).toBe(there);

  await alice.context.close();
  await expect.poll(async () => (await realm<{ kind: string }[]>(bob.page, "entities")).some((e) => e.kind === "other")).toBe(false);
  await bob.context.close();
});
