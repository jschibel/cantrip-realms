import { type Page, expect, test } from "@playwright/test";
import { spawnNear } from "../places";
import { clickClear, entity, openNear, realm, until, waitReady, world } from "../realm";
import { SERVER, api, character, place } from "./server";
import { CARDS, cardState, clickCard, clickCardControl } from "./cardLayer";
import { forceDuel, playDuel, setAnte } from "./duel";

// The whole duel loop against the real realm server, played in the real card layer with real clicks: a mob engaged in the
// world, the encounter's splash, the duel dealt and played on the rules engine in the page, its end said, its log replayed
// and judged by the server on the native host - then, for a win, the loot picked within the prize cap and the world
// resumed; for a loss, a card of the ante gone and the character awake at the inn. Each game is a forced position (the
// mob, or the player, beginning at 0 life: it loses as it would first receive priority, CR 704.5a), never a seed.

const query = `/?server=${encodeURIComponent(SERVER)}&cards=${encodeURIComponent(`${CARDS}?test`)}&test&wander=0&encounters=never`;

interface Me {
  readonly Gold: number;
  readonly Space: string;
  readonly X: number;
  readonly Z: number;
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

test("a duel won in the real card layer: splash, the game, victory, the server's verdict, the loot, the world", async ({ page }, info) => {
  test.setTimeout(360_000);
  await character(page.request, 61, "Wren", "R");
  const ante = await setAnte(page.request);
  // The mob begins at 0 life; the player wears an item with effects, whose emblem begins in their command zone.
  await forceDuel(page.request, { Mob: { StartingLife: 0 }, Player: { Emblems: ["Circlet of Foresight (gear)"] } });
  // No gear drops from this win (the gear suite's to show), so the loot is the cards alone.
  const noDrop = await page.request.post(new URL("dev/drop", SERVER).toString(), { data: { Gear: false } });
  expect(noDrop.ok(), await noDrop.text()).toBe(true);
  const before = await api<Me>(page.request, "me");

  const mob = await engage(page);
  // The splash: three cards of the mob's deck, what is at stake.
  const splash = (await cardState(page))!;
  expect(splash.cards.filter((c) => c.visible && c.name.length > 0).length).toBe(3);
  expect(splash.realm!.facts).toContain(`prize cap`);
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

  // Back to the world: the server replays the log and takes the win; the loot is offered within the cap.
  const finished = page.waitForResponse((r) => r.url().endsWith("/api/encounter/finish"));
  await clickCardControl(page, "Return to the world");
  const result = (await (await finished).json()) as { Outcome: string; Gold: number; Offer: { Name: string; Gold: number }[]; Cap: number };
  expect(result.Outcome).toBe("won");
  expect(result.Cap).toBeGreaterThan(0);
  expect(result.Cap).toBeLessThanOrEqual(ante.value);
  expect(result.Offer.length).toBeGreaterThan(0);
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "loot", "the loot", 30);
  await expect.poll(async () => (await cardState(page))?.realm?.loot?.cap ?? -1).toBe(result.Cap);
  const fits = result.Offer.filter((c) => c.Gold <= result.Cap).sort((a, b) => a.Gold - b.Gold)[0]!;
  await clickCard(page, fits.Name);
  await expect.poll(async () => (await cardState(page))?.realm?.loot?.picked ?? []).toEqual([fits.Name]);
  await page.screenshot({ path: info.outputPath("3-loot.png") });
  const owned = (await api<{ Cards: Record<string, number> }>(page.request, "collection")).Cards[fits.Name] ?? 0;
  const looted = page.waitForResponse((r) => r.url().endsWith("/api/encounter/loot"));
  await clickCardControl(page, "Take 1 card");
  expect((await looted).ok()).toBe(true);

  // The world again: the mob gone, the gold and the card the player's.
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe(null);
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "the world resumed", 30);
  await expect.poll(() => realm<string>(page, "message")).toContain(`You take ${fits.Name}`);
  const after = await api<Me>(page.request, "me");
  expect(after.Gold).toBe(before.Gold + result.Gold);
  expect((await api<{ Cards: Record<string, number> }>(page.request, "collection")).Cards[fits.Name]).toBe(owned + 1);
  expect((await realm<{ kind: string; spawn?: string }[]>(page, "entities")).some((e) => e.kind === "mob" && e.spawn === mob.spawn)).toBe(false);
  await page.screenshot({ path: info.outputPath("4-world.png") });
});

test("a duel lost in the real card layer: defeat, a card of the ante gone, awake at the inn", async ({ page }, info) => {
  test.setTimeout(360_000);
  await character(page.request, 62, "Moss", "G");
  const ante = await setAnte(page.request);
  await forceDuel(page.request, { Player: { StartingLife: 0 } });

  await engage(page);
  const ended = await playDuel(page);
  expect(ended.realm!.duel).toMatchObject({ over: true, won: false, end: "Defeat" });
  await page.screenshot({ path: info.outputPath("1-defeat.png") });

  const finished = page.waitForResponse((r) => r.url().endsWith("/api/encounter/finish"));
  await clickCardControl(page, "Return to the world");
  const result = (await (await finished).json()) as { Outcome: string; Detail: string | null; Lost: string | null };
  expect(result).toMatchObject({ Outcome: "lost", Detail: "The mob won." });
  expect(ante.names).toContain(result.Lost);

  // A card of the ante is lost, and the character wakes at the start town's inn.
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe(null);
  await until(page, async () => /You lost the duel, and wake at the inn/.test((await realm<string>(page, "message")) ?? ""), "woken at the inn", 60);
  expect(await realm<string>(page, "message")).toContain(`${result.Lost} of your ante is gone.`);
  const deck = await api<{ Ante: { Name: string; Count: number }[] }>(page.request, "deck");
  expect(deck.Ante.reduce((n, c) => n + c.Count, 0)).toBe(ante.names.length - 1);
  const me = await api<Me>(page.request, "me");
  const capital = world().towns.find((t) => t.kind === "capital")!;
  const inn = world().inns.find((i) => i.town === capital.id)!;
  expect(me).toMatchObject({ Space: "world", X: inn.x, Z: inn.z });
  await page.screenshot({ path: info.outputPath("2-inn.png") });
});
