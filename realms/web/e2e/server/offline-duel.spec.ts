import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNear } from "../places";
import { at, clickClear, clickControl, openNear, realm, until, waitReady } from "../realm";
import { CARDS, cardState, clickCardControl } from "./cardLayer";
import { playDuel } from "./duel";

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "hearts");

// Offline play with the real card layer (no realm server: the in-memory API, ?offline): the duel is dealt as the server
// deals it (MockApi, net/mockDuel.ts) - the starter deck of the character's color against the mob's themed deck - and
// played on the rules engine in the card layer's page; a rematch's deck is sideboarded there too, while the screens that
// trade and save through the server stay the stand-in's. The position is forced as the server's suite forces it
// (realmTest.forceDuel: a seat beginning at 0 life), never a seed. It is here, beside the server's suites, because it
// needs the card layer built and served (cards.mjs), as they do.

// The card faces a card layer with no realm server reads from its own origin (scripts/cardLayer.mjs): the launcher writes
// them (tools/realms/play.cmd); here the realm server this suite built writes them, if they are not there yet. The
// spell table's editor, which sideboards a rematch, lays its cards out from them.
test.beforeAll(() => {
  const catalog = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".cards", "catalog.msgpack");
  if (existsSync(catalog)) return;
  const server = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dotnet", "Cantrip.Realms.Server", "bin", "Debug", "net10.0", "cantrip-realms-server.dll");
  execFileSync("dotnet", [server, "catalog", catalog], { stdio: "inherit", timeout: 120_000 });
});

const engage = async (page: import("@playwright/test").Page, color: string, forced: unknown) => {
  const spawn = spawnNear("new-benalia");
  await page.goto(`/?offline&test&name=Ash&color=${color}&wander=0&encounters=never&at=${at(openNear(spawn, 6))}&cards=${encodeURIComponent(`${CARDS}?test`)}`);
  await waitReady(page);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);
  await page.evaluate((duel) => (globalThis as any).realmTest.forceDuel(duel), forced);
  const mob = await clickClear(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "the duel", 60);
  await expect.poll(async () => (await cardState(page))?.realm?.title ?? "", { timeout: 60_000 }).toBe(`${mob.name} attacks!`);
  return mob;
};

test("offline, a duel is a real game in the real card layer, and a win pays its gold", async ({ page }) => {
  test.setTimeout(300_000);
  const mob = await engage(page, "R", { Mob: { StartingLife: 0 } });

  // Dealt as the server deals it: the red starter deck, forty cards, against the mob's own.
  const [request] = (await realm<{ screen: string; args: any }[]>(page, "layer.requests")).filter((r) => r.screen === "duel");
  expect(request!.args.duel.Seats[0].Deck).toHaveLength(40);
  expect(request!.args.duel.Seats[0].Deck.filter((c: string) => c === "Mountain")).toHaveLength(17);
  expect(request!.args.duel.Seats[1].Name).toBe(mob.name);

  const ended = await playDuel(page);
  expect(ended.realm!.duel).toMatchObject({ over: true, won: true, end: "Victory" });
  await clickCardControl(page, "Return to the world");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "the world resumed", 30);
  const calls = await realm<{ name: string; body?: any }[]>(page, "api");
  expect(calls.find((c) => c.name === "finishEncounter")?.body.Log).toBeGreaterThan(0);
  expect((await realm<string[]>(page, "messages")).some((m) => /You defeated .*: \d+ gold\./.test(m))).toBe(true);
});

test("offline, a lost game is fought again: sideboarded in the real card layer, the mob at the life the game left it", async ({ page }) => {
  test.setTimeout(360_000);
  // The player begins at 0 life, the mob at 11: the card layer reads the mob's life from the game as it ends.
  await engage(page, "W", { Player: { StartingLife: 0 }, Mob: { StartingLife: 11 } });
  const ended = await playDuel(page);
  expect(ended.realm!.duel).toMatchObject({ over: true, won: false, mobLife: 11 });
  await page.evaluate(() => (globalThis as any).realmTest.forceDuel(null));
  await clickCardControl(page, "Return to the world");
  await expect.poll(() => page.locator("[data-test='defeat']").count(), { timeout: 60_000 }).toBe(1);
  await clickControl(page, "defeat:fight");

  // The sideboard screen in the real card layer: the deck and its two stand-in sideboard cards; Fight, then draw.
  await expect.poll(async () => (await cardState(page))?.realm?.table?.sideboarding ?? false, { timeout: 120_000 }).toBe(true);
  expect((await cardState(page))!.realm!.table!).toMatchObject({ main: 40, side: 2 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SHOTS, "sideboarding-offline.png") });
  await clickCardControl(page, "Fight");
  await clickCardControl(page, "Draw first");

  // The second game: the mob at 11 as the game begins, read in the card layer; the player at their full life.
  await expect.poll(async () => (await cardState(page))?.realm?.facts ?? "", { timeout: 60_000 }).toContain("game 2");
  await clickCardControl(page, "Fight");
  await expect.poll(async () => (await cardState(page))?.realm?.duel?.game ?? 0, { timeout: 120_000 }).toBe(2);
  const game = (await cardState(page))!.realm!.duel!;
  expect(game.mobLife).toBe(11);
  const second = (await realm<{ screen: string; args: any }[]>(page, "layer.requests")).filter((r) => r.screen === "duel")[1]!;
  expect(second.args.duel).toMatchObject({ Game: 2, FirstPlayer: 2 });
  expect(game.playerLife).toBe(second.args.duel.Seats[0].StartingLife);
});
