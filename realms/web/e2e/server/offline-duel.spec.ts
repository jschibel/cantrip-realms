import { expect, test } from "@playwright/test";
import { spawnNear } from "../places";
import { at, entity, openNear, realm, until, waitReady } from "../realm";
import { CARDS, cardState, clickCard, clickCardControl } from "./cardLayer";
import { playDuel } from "./duel";

// Offline play with the real card layer (no realm server: the in-memory API, ?offline): the duel is dealt as the server
// deals it (MockApi, net/mockDuel.ts) - the starter deck of the character's color against the mob's themed deck - and
// played on the rules engine in the card layer's page; its loot is picked there too, while the screens that trade and save
// through the server stay the stand-in's. The position is forced as the server's suite forces it (realmTest.forceDuel:
// the mob beginning at 0 life), never a seed. It is here, beside the server's suites, because it needs the card layer
// built and served (cards.mjs), as they do.

test("offline, a duel is a real game in the real card layer, and its loot is picked there", async ({ page }) => {
  test.setTimeout(300_000);
  const spawn = spawnNear("new-benalia");
  await page.goto(`/?offline&test&name=Ash&color=R&wander=0&encounters=never&at=${at(openNear(spawn, 6))}&cards=${encodeURIComponent(`${CARDS}?test`)}`);
  await waitReady(page);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);
  await page.evaluate(() => (globalThis as any).realmTest.forceDuel({ Mob: { StartingLife: 0 } }));

  const mob = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await page.mouse.click(mob.x, mob.y);
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "the duel", 60);
  await expect.poll(async () => (await cardState(page))?.realm?.title ?? "", { timeout: 60_000 }).toBe(`${mob.name} attacks!`);

  // Dealt as the server deals it: the red starter deck, forty cards, against the mob's own.
  const [request] = (await realm<{ screen: string; args: any }[]>(page, "layer.requests")).filter((r) => r.screen === "duel");
  expect(request!.args.duel.Seats[0].Deck).toHaveLength(40);
  expect(request!.args.duel.Seats[0].Deck.filter((c: string) => c === "Mountain")).toHaveLength(17);
  expect(request!.args.duel.Seats[1].Name).toBe(mob.name);

  const ended = await playDuel(page);
  expect(ended.realm!.duel).toMatchObject({ over: true, won: true, end: "Victory" });
  await clickCardControl(page, "Return to the world");

  // The win's loot, in the real card layer: the cheapest card offered taken.
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "loot", "the loot", 30);
  const loot = (await realm<{ screen: string; args: any }[]>(page, "layer.requests")).find((r) => r.screen === "loot")!;
  const offer = loot.args.offer as { Name: string; Gold: number }[];
  const cheapest = [...offer].sort((a, b) => a.Gold - b.Gold)[0]!;
  expect(cheapest.Gold).toBeLessThanOrEqual(loot.args.cap);
  await clickCard(page, cheapest.Name);
  await clickCardControl(page, "Take 1 card");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "the world resumed", 30);
  const calls = await realm<{ name: string; body?: any }[]>(page, "api");
  expect(calls.find((c) => c.name === "takeLoot")?.body).toMatchObject({ Picks: [cheapest.Name] });
  expect(calls.find((c) => c.name === "finishEncounter")?.body.Log).toBeGreaterThan(0);
});
