import { type Page, expect, test } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { heartbloomNear, spawnNear } from "../places";
import { chebyshev, clickClear, clickControl, clickEntity, entities, entity, interior, openNear, playerTile, realm, until, waitReady, waitSpace, walkTo, winDuel, world } from "../realm";
import { enter, run, toShrine, walkInside } from "../runs";
import { type Me, SERVER, api, besideEntrance, character, drop, hearts, place, query, verdict } from "./server";

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", "hearts");

// Hearts against the real realm server (design.md A3, A3b), the stand-in card layer framed over the world: the server
// counts its duels as the development verdict says, the mob ending at the life the test gives it (POST /dev/verdict,
// test-only). A loss costs a heart, the buyout is the server's measure of the life the mob kept, paid from the
// character's gold; a dungeon's mob is fought again, never paid; a town fills the hearts from where the server knows
// the character stands; a temple's healer sells another; a heartbloom of the wilds gives one back and stays picked for
// the week whatever the page says, and a run's shrine - its run made to hold one (POST /dev/drop {Shrine}) - blesses
// once. A heart missing is arranged (POST /dev/hearts) where losing one is not the point. The real duel, its replay and the sideboarding in the real card
// layer are duel-loop.spec.ts's.

const spawn = spawnNear("new-benalia");
const open = (page: Page) => realm<string | null>(page, "layer.open");
const inWorld = async (page: Page) => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused"));

/** A character by the spawn, the world open, its mob engaged: the stand-in's duel opens. */
async function engage(page: Page, id: number, name: string): Promise<void> {
  await character(page.request, id, name);
  await place(page.request, openNear(spawn, 6));
  await page.goto(query());
  await waitReady(page);
  const mob = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob", 30);
  await clickClear(page, (e) => e.kind === "mob" && e.spawn === mob.spawn, "the spawn's mob");
  await until(page, async () => (await open(page)) === "duel", "the duel", 60);
}

test("a lost duel on the real server: a heart gone, the buyout by the life the mob kept, paid", async ({ page }) => {
  test.setTimeout(240_000);
  await engage(page, 81, "Penny");
  await verdict(page.request, "lost", 4);
  const before = await api<Me>(page.request, "me");
  await clickControl(page, "layer:lose");
  await until(page, async () => (await page.locator("[data-test='defeat']").count()) > 0, "the defeat", 60);

  const lost = await api<Me>(page.request, "me");
  expect(lost.Hearts).toBe(1);
  expect(lost.Gold).toBe(before.Gold);
  expect(lost.Defeat!.MobLife).toBe(4);
  const price = Math.max(1, Math.round(30 * Math.min(1, 4 / lost.Defeat!.MobFullLife)));
  expect(lost.Defeat!.Price).toBe(price);
  await expect(page.locator("[data-test='defeat:offer']")).toContainText(`${price} gold`);

  // A reload comes back to the answer still owed.
  await page.reload();
  await waitReady(page);
  await until(page, async () => (await page.locator("[data-test='defeat']").count()) > 0, "the defeat again after a reload", 60);

  await clickControl(page, "defeat:pay");
  await until(page, () => inWorld(page), "the world", 60);
  const paid = await api<Me>(page.request, "me");
  expect(paid).toMatchObject({ Hearts: 1, Gold: before.Gold - price, Defeat: null });
  expect((await entities(page)).some((e) => e.kind === "mob" && e.spawn === spawn.id)).toBe(false);

  // Walked back into New Benalia, the server sees the town where the character stands: the hearts fill.
  const capital = world().towns.find((t) => t.kind === "capital")!;
  const inn = world().inns.find((i) => i.town === capital.id)!;
  await verdict(page.request, null);
  await walkTo(page, { x: inn.x, z: inn.z }, 4);
  await expect.poll(async () => (await api<Me>(page.request, "me")).Hearts, { timeout: 30_000 }).toBe(2);
  await until(page, async () => (await page.locator("[data-test='hud:hearts']").getAttribute("data-hearts")) === "2", "the HUD's hearts filled", 30);
});

test("a dungeon's mob on the real server is never bought off: the defeat offers only another game", async ({ page }) => {
  test.setTimeout(300_000);
  await character(page.request, 82, "Delve");
  const id = "benalish-keep";
  await place(page.request, besideEntrance(id));
  await page.goto(query("&mobs=0"));
  await waitReady(page);
  await waitSpace(page, "world");
  await enter(page, id);
  await waitSpace(page, /^run:/, 60);
  await verdict(page.request, "lost", 2);
  // Toward an encounter step by step (it may come for the player itself), then at it: the walk never answers a duel itself.
  for (let tries = 0; tries < 30 && (await open(page)) === null; tries++) {
    const mob = await entity(page, (e) => e.kind === "mob" && e.role === "encounter", "an encounter", 30);
    if (chebyshev(await playerTile(page), mob.tile) <= 2) {
      await clickEntity(page, (e) => e.kind === "mob" && e.spawn === mob.spawn, "the encounter");
      break;
    }
    const path = (await page.evaluate(([x, z]) => (globalThis as any).realmTest.pathTo(x, z), [mob.tile.x, mob.tile.z] as const)) as { x: number; z: number }[];
    const step = path[Math.min(6, Math.max(1, path.length - 3))]!;
    await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [step.x, step.z] as const);
    await until(page, async () => (await open(page)) !== null || !(await entity(page, (e) => e.kind === "player", "the player")).moving, "the step taken", 20);
  }
  await until(page, async () => (await open(page)) === "duel", "the duel", 60);
  await clickControl(page, "layer:lose");
  await until(page, async () => (await page.locator("[data-test='defeat']").count()) > 0, "the defeat", 60);
  await expect(page.locator("[data-test='defeat']")).toHaveAttribute("data-dungeon", "true");
  expect(await page.locator("[data-test='defeat:pay']").count()).toBe(0);
  expect((await api<Me>(page.request, "me")).Defeat!.Price).toBeNull();
  const refused = await page.request.post(new URL("api/encounter/pay", SERVER).toString(), { data: { Token: (await api<{ Defeat: { Token: string } }>(page.request, "me")).Defeat.Token } });
  expect(refused.status()).toBe(409);

  // Fought again, with the stand-in's deck as it was: the next game's mob at the 2 it kept; won this time.
  await verdict(page.request, "won");
  await clickControl(page, "defeat:fight");
  await until(page, async () => (await open(page)) === "sideboard", "the sideboard", 30);
  const rematch = page.waitForResponse((r) => r.url().endsWith("/api/encounter/rematch"));
  await clickControl(page, "layer:play first");
  const second = (await (await rematch).json()) as { Duel: { Game: number; FirstPlayer: number; Seats: { StartingLife: number }[] } };
  expect(second.Duel).toMatchObject({ Game: 2, FirstPlayer: 1 });
  expect(second.Duel.Seats[1]!.StartingLife).toBe(2);
  await winDuel(page);
  expect(await realm<string>(page, "space.id")).toMatch(/^run:/);
});

test("a temple's healer on the real server sells a heart for gold, to hold one more", async ({ page }) => {
  test.setTimeout(180_000);
  await character(page.request, 83, "Vow");
  const temple = interior("new-benalia-temple");
  const healer = temple.npcs.find((n) => n.kind === "healer")!;
  let placed = false;
  for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2]] as const) {
    if ((await page.request.post(new URL("dev/place", SERVER).toString(), { data: { Space: temple.id, X: healer.x + dx, Z: healer.z + dz } })).ok()) {
      placed = true;
      break;
    }
  }
  expect(placed, "a tile beside the priest").toBe(true);
  await page.goto(query("&mobs=0"));
  await waitReady(page);
  await waitSpace(page, temple.id);
  await clickEntity(page, (e) => e.kind === "healer", "the priest");
  await until(page, async () => (await realm<string>(page, "screen")) === "dialog", "the priest's word", 20);
  const bought = page.waitForResponse((r) => r.url().endsWith("/api/hearts/buy"));
  await clickControl(page, "dialog:buy a heart (1,000 gold)");
  expect((await (await bought).json()) as unknown).toMatchObject({ Hearts: 3, MaxHearts: 3, Price: 3000 });
  expect(await api<Me>(page.request, "me")).toMatchObject({ Hearts: 3, MaxHearts: 3, Gold: 1000 });
  await until(page, async () => (await page.locator("[data-test='hud:hearts']").getAttribute("data-max")) === "3", "three hearts on the HUD", 30);
});

test("a heartbloom on the real server gives back a heart, and stays picked for the week the server keeps", async ({ page }) => {
  test.setTimeout(180_000);
  await character(page.request, 84, "Bloom");
  const bloom = heartbloomNear("new-benalia");
  await place(page.request, openNear(bloom, 2));
  await hearts(page.request, 1);
  await page.goto(query("&mobs=0"));
  await waitReady(page);
  const isBloom = (e: { kind: string; id: string }) => e.kind === "heartbloom" && e.id === bloom.id;
  expect((await entity(page, isBloom, "the heartbloom", 30)).picked).toBe(false);

  // Walked onto: the server gives the heart back and keeps the bloom picked for a week.
  const picked = page.waitForResponse((r) => r.url().endsWith("/api/chest/open"));
  await clickEntity(page, isBloom, "the heartbloom");
  expect((await (await picked).json()) as unknown).toMatchObject({ Found: 0, Hearts: 2, Heart: true });
  const me = await api<Me>(page.request, "me");
  expect(me.Hearts).toBe(2);
  expect(me.Picked.map((p) => p.Chest)).toEqual([bloom.id]);
  expect(Date.parse(me.Picked[0]!.Until) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
  await until(page, async () => (await page.locator("[data-test='hud:hearts']").getAttribute("data-hearts")) === "2", "the HUD's heart back", 30);
  await until(page, async () => (await entity(page, isBloom, "the heartbloom")).picked === true, "the bloom picked", 30);
  await page.screenshot({ path: join(SHOTS, "server-heartbloom.png") });

  // After a reload the page draws it picked, as the server says; and the server gives nothing more for it.
  await hearts(page.request, 1);
  await page.reload();
  await waitReady(page);
  await until(page, async () => (await entity(page, isBloom, "the heartbloom", 30)).picked === true, "still picked after a reload", 30);
  const again = await page.request.post(new URL("api/chest/open", SERVER).toString(), { data: { Space: "world", Chest: bloom.id } });
  expect(again.status()).toBe(409);
  expect(((await again.json()) as { Error: string }).Error).toBe("Empty");
  expect((await api<Me>(page.request, "me")).Hearts).toBe(1);
});

test("a run's shrine on the real server blesses once: a heart back, and the run remembers", async ({ page }) => {
  test.setTimeout(240_000);
  await character(page.request, 85, "Prayer");
  // A mage tower of one floor, its run made to hold a shrine; any duel a mob of it starts counted won.
  const id = "benalia-1";
  await drop(page.request, { Shrine: true });
  await verdict(page.request, "won");
  await place(page.request, besideEntrance(id));
  await hearts(page.request, 1);
  await page.goto(query("&mobs=0"));
  await waitReady(page);
  await waitSpace(page, "world");
  await enter(page, id);
  await waitSpace(page, /^run:/, 60);
  const live = await api<{ Run: string; Floors: { Shrine?: boolean }[]; ShrineUsed: boolean }>(page.request, "dungeon/run");
  expect(live.Floors.map((f) => f.Shrine ?? false)).toEqual([true]);
  expect(live.ShrineUsed).toBe(false);
  const r = (await run(page))!;
  expect(r).toMatchObject({ shrineFloor: 0, shrineUsed: false });

  await walkInside(page, r.shrine!, 1);
  await toShrine(page);
  const prayed = page.waitForResponse((x) => x.url().endsWith("/api/dungeon/shrine"));
  await clickControl(page, "dialog:pray");
  expect((await (await prayed).json()) as unknown).toEqual({ Hearts: 2 });
  expect((await api<Me>(page.request, "me")).Hearts).toBe(2);
  expect((await api<{ ShrineUsed: boolean }>(page.request, "dungeon/run")).ShrineUsed).toBe(true);
  await until(page, async () => (await page.locator("[data-test='hud:hearts']").getAttribute("data-hearts")) === "2", "the HUD's heart back", 30);
  await page.screenshot({ path: join(SHOTS, "server-shrine.png") });

  // Once in the run: the server refuses another blessing, a heart missing or not.
  await hearts(page.request, 1);
  const again = await page.request.post(new URL("api/dungeon/shrine", SERVER).toString(), { data: { Run: live.Run } });
  expect(again.status()).toBe(409);
  expect(((await again.json()) as { Error: string }).Error).toBe("Empty");
  await verdict(page.request, null);
  await drop(page.request, { Shrine: null });
});
