import { type Page, expect, test } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNear } from "../places";
import { clickClear, clickControl, openNear, realm, until, waitReady, world } from "../realm";
import { SERVER, api, character, place } from "./server";
import { CARDS, cardState, clickCardControl } from "./cardLayer";
import { forceDuel, playDuel, setSideboard } from "./duel";

// The whole duel loop against the real realm server, played in the real card layer with real clicks: a mob engaged in the
// world, the encounter's splash, the duel dealt and played on the rules engine in the page, its end said, its log replayed
// and judged by the server on the native host - then, for a win, its gold and the world resumed; for a loss, a heart gone
// and the mob over the player (design.md A3): fought again, the deck sideboarded in the card layer, play or draw chosen,
// and the next game dealt with the mob at the life the server read from the last game's log; the last heart lost, death
// and home. Each game is a forced position (a seat beginning at 0 life: it loses as it would first receive priority, CR
// 704.5a; or a concession), never a seed.

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "hearts");
const query = `/?server=${encodeURIComponent(SERVER)}&cards=${encodeURIComponent(`${CARDS}?test`)}&test&wander=0&encounters=never`;

interface Me {
  readonly Gold: number;
  readonly Hearts: number;
  readonly MaxHearts: number;
  readonly Space: string;
  readonly X: number;
  readonly Z: number;
  readonly Defeat: { readonly Token: string; readonly Price: number | null; readonly MobLife: number; readonly MobFullLife: number } | null;
}

/** Opens the world by a spawn of New Benalia's wilds and engages its mob, once the card layer is up: the splash is shown. */
async function engage(page: Page): Promise<{ name: string; spawn: string }> {
  const spawn = spawnNear("new-benalia");
  await place(page.request, openNear(spawn, 6));
  await page.goto(query);
  await waitReady(page);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);
  const mob = await clickClear(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "the duel", 60);
  await expect.poll(async () => (await cardState(page))?.realm?.title ?? "", { timeout: 60_000 }).toBe(`${mob.name} attacks!`);
  return { name: mob.name, spawn: spawn.id };
}

test("a duel won in the real card layer: splash, the game, victory, the server's verdict, its gold, the world", async ({ page }, info) => {
  test.setTimeout(360_000);
  await character(page.request, 61, "Wren", "R");
  // The mob begins at 0 life; the player wears an item with effects, whose emblem begins in their command zone.
  await forceDuel(page.request, { Mob: { StartingLife: 0 }, Player: { Emblems: ["Circlet of Foresight (gear)"] } });
  // No gear drops from this win (the gear suite's to show).
  const noDrop = await page.request.post(new URL("dev/drop", SERVER).toString(), { data: { Gear: false } });
  expect(noDrop.ok(), await noDrop.text()).toBe(true);
  const before = await api<Me>(page.request, "me");

  const mob = await engage(page);
  // The splash: no cards of the mob's deck, and what is at stake - the game, and the player's hearts.
  const splash = (await cardState(page))!;
  expect(splash.cards.filter((c) => c.visible && c.name.length > 0)).toHaveLength(0);
  expect(splash.realm!.facts).toContain("game 1  ·  hearts 2 of 2");
  await page.screenshot({ path: info.outputPath("1-splash.png") });

  const ended = await playDuel(page);
  expect(ended.realm!.duel).toMatchObject({ over: true, won: true, end: "Victory" });
  // The worn item's emblem was in the player's command zone all game, named under the duel's bar; a click shows its card.
  expect(ended.realm!.duelGear?.emblems).toEqual(["Circlet of Foresight (gear)"]);
  await clickCardControl(page, "Gear in play");
  await expect.poll(async () => (await cardState(page))?.realm?.duelGear?.open).toBe(true);
  await page.screenshot({ path: info.outputPath("2-victory-gear.png") });
  await clickCardControl(page, "Close gear");
  await expect.poll(async () => (await cardState(page))?.realm?.duelGear?.open).toBe(false);
  await page.screenshot({ path: info.outputPath("2-victory.png") });

  // Back to the world: the server replays the log and takes the win; it pays gold, and no cards.
  const finished = page.waitForResponse((r) => r.url().endsWith("/api/encounter/finish"));
  await clickCardControl(page, "Return to the world");
  const result = (await (await finished).json()) as { Outcome: string; Gold: number; Hearts: number };
  expect(result).toMatchObject({ Outcome: "won", Hearts: 2 });
  expect(result.Gold).toBeGreaterThan(0);

  // The world again: the mob gone, the gold the player's.
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe(null);
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "the world resumed", 30);
  const after = await api<Me>(page.request, "me");
  expect(after.Gold).toBe(before.Gold + result.Gold);
  expect((await realm<{ kind: string; spawn?: string }[]>(page, "entities")).some((e) => e.kind === "mob" && e.spawn === mob.spawn)).toBe(false);
  await page.screenshot({ path: info.outputPath("3-world.png") });
});

test("a duel lost in the real card layer: a heart gone, fought again with the deck sideboarded and the mob at the life it kept, then death and home", async ({ page }, info) => {
  test.setTimeout(480_000);
  await character(page.request, 62, "Moss", "G");
  const sideboard = await setSideboard(page.request);
  // The player begins at 0 life; the mob at 9, which it keeps: the server reads it from the log it replays.
  await forceDuel(page.request, { Player: { StartingLife: 0 }, Mob: { StartingLife: 9 } });

  await engage(page);
  const ended = await playDuel(page);
  expect(ended.realm!.duel).toMatchObject({ over: true, won: false, end: "Defeat", mobLife: 9 });
  await page.screenshot({ path: info.outputPath("1-defeat.png") });

  const finished = page.waitForResponse((r) => r.url().endsWith("/api/encounter/finish"));
  await clickCardControl(page, "Return to the world");
  const result = (await (await finished).json()) as { Outcome: string; Detail: string | null; Hearts: number; Defeat: { MobLife: number; MobFullLife: number; Price: number } };
  expect(result).toMatchObject({ Outcome: "lost", Detail: "The mob won.", Hearts: 1 });
  expect(result.Defeat.MobLife).toBe(9);
  expect(result.Defeat.Price).toBe(Math.max(1, Math.round(30 * Math.min(1, 9 / result.Defeat.MobFullLife))));

  // The mob over the player in the world: its buyout or another game. Fought again, with the positions no longer forced.
  await expect.poll(() => page.locator("[data-test='defeat']").count(), { timeout: 60_000 }).toBe(1);
  await expect(page.locator("[data-test='defeat:offer']")).toContainText(`${result.Defeat.Price} gold`);
  await page.screenshot({ path: join(SHOTS, "defeat-world-server.png") });
  await forceDuel(page.request, { Player: null, Mob: null });
  await clickControl(page, "defeat:fight");

  // Sideboarding in the card layer: the last game's deck and sideboard; play or draw asked when Fight is clicked.
  await expect.poll(async () => (await cardState(page))?.realm?.table?.sideboarding ?? false, { timeout: 120_000, message: "the sideboard screen" }).toBe(true);
  const sided = (await cardState(page))!.realm!.table!;
  expect([sided.main, sided.side]).toEqual([40, sideboard.length]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SHOTS, "sideboarding.png") });
  const rematch = page.waitForResponse((r) => r.url().endsWith("/api/encounter/rematch"), { timeout: 60_000 });
  await clickCardControl(page, "Fight");
  await clickCardControl(page, "Draw first");
  const second = (await (await rematch).json()) as { Duel: { Game: number; FirstPlayer: number; Seats: { StartingLife: number }[] } };
  const me = await api<Me>(page.request, "me");
  expect(second.Duel).toMatchObject({ Game: 2, FirstPlayer: 2 });
  expect(second.Duel.Seats[1]!.StartingLife).toBe(9);
  expect(me.Defeat).toBeNull();

  // The second game, dealt in the card layer: the mob at 9 as it begins, read from the game itself; then conceded.
  await expect.poll(async () => (await cardState(page))?.realm?.facts ?? "", { timeout: 60_000 }).toContain("game 2");
  await clickCardControl(page, "Fight");
  await expect.poll(async () => (await cardState(page))?.realm?.duel?.game ?? 0, { timeout: 120_000 }).toBe(2);
  expect((await cardState(page))!.realm!.duel!.mobLife).toBe(9);
  const again = page.waitForResponse((r) => r.url().endsWith("/api/encounter/finish"), { timeout: 120_000 });
  await clickCardControl(page, "Concede");
  await expect.poll(async () => (await cardState(page))?.controls.some((c) => c.label === "Play on") ?? false).toBe(true);
  await clickCardControl(page, "Concede");
  const died = (await (await again).json()) as { Outcome: string; Detail: string; Died: boolean; Hearts: number };
  expect(died).toMatchObject({ Outcome: "lost", Detail: "The mob won.", Died: true, Hearts: 2 });

  // The last heart: death, and home at the start town's inn with the hearts full.
  await expect.poll(() => page.locator("[data-test='death']").count(), { timeout: 60_000 }).toBe(1);
  await page.screenshot({ path: join(SHOTS, "death-server.png") });
  await clickControl(page, "death:rise");
  await until(page, async () => /You wake at the inn in New Benalia, your hearts restored/.test((await realm<string>(page, "message")) ?? ""), "woken at home", 60);
  const home = await api<Me>(page.request, "me");
  const capital = world().towns.find((t) => t.kind === "capital")!;
  const inn = world().inns.find((i) => i.town === capital.id)!;
  expect(home).toMatchObject({ Space: "world", X: inn.x, Z: inn.z, Hearts: 2, MaxHearts: 2, Defeat: null });
  await page.screenshot({ path: info.outputPath("2-inn.png") });
});
