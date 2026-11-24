import { type Page, expect, test } from "@playwright/test";
import { chebyshev, clickControl, clickEntity, dungeon, entities, entity, playerTile, realm, until, waitReady, waitSpace, winDuel, world } from "../realm";
import { beat, enter, run, walkInside } from "../runs";
import { CARDS, cardState, clickCardControl } from "./cardLayer";
import { type ForcedSeat, forceDuel, playDuel } from "./duel";
import { type Me, SERVER, api, besideEntrance, character, place, query, verdict } from "./server";

// Dungeon runs and their bosses against the real realm server (playwright.config.ts here): a run resumed after a reload
// on the floor it reached; Rofellos beaten - green unlocked, the deck taking green at the antechamber's spell table, his
// hall empty for the week; and his duel in the real card layer, whose log the server replays - won from a forced position
// (he begins at 0 life, POST /dev/duel), green unlocked with its moment; and lost by conceding, the run over and the
// character at the inn. A test starts beside the dungeon (POST /dev/place) and has the server count the stand-in's wins
// (POST /dev/verdict) on the floors it only walks through.

async function besideDungeon(page: Page, id: string, extra = "&mobs=0"): Promise<void> {
  await place(page.request, besideEntrance(id));
  await page.goto(query(extra));
  await waitReady(page);
  await waitSpace(page, "world");
}

/** Beats the floor's warden and takes its stair down; the server lets the character by. */
async function down(page: Page): Promise<void> {
  const r = (await run(page))!;
  await beat(page, "warden");
  // A mob of the floor that comes for the player on the way is beaten, and the stair clicked again.
  for (let tries = 0; tries < 4 && (await run(page))?.floor === r.floor; tries++) {
    await walkInside(page, r.down!, 2);
    await clickEntity(page, (e) => e.kind === "down", "the stairs down");
    await until(page, async () => (await run(page))?.floor === r.floor + 1 || (await realm<string | null>(page, "layer.open")) !== null, "down the stair, or stopped by a mob", 60);
    if ((await realm<string | null>(page, "layer.open")) !== null) await winDuel(page);
  }
  await until(page, async () => (await run(page))?.floor === r.floor + 1, "down the stair", 60);
  await waitSpace(page, /^run:/);
}

test("a run resumed after a reload, on the floor it reached with its warden beaten", async ({ page }) => {
  test.setTimeout(300_000);
  await character(page.request, 31, "Fenna");
  await verdict(page.request, "won");
  const id = "benalish-keep";
  await besideDungeon(page, id);
  await enter(page, id);
  await waitSpace(page, /^run:/, 60);
  const r = (await run(page))!;
  await down(page);

  // Closed and opened again: the overworld asks the server for the run and stands the character on its floor.
  await page.goto(query("&mobs=0"));
  await waitReady(page);
  await waitSpace(page, `run:${r.id}`, 60);
  expect((await run(page))?.floor).toBe(1);
  expect((await realm<string[]>(page, "messages")).some((m) => m.startsWith(`You are back in ${dungeon(id).name}, on floor 2 of`))).toBe(true);
  const resumed = await api<{ Run: string; Floor: number; Beaten: string[]; Floors: { Encounters: unknown[] }[] }>(page.request, "dungeon/run");
  expect(resumed).toMatchObject({ Run: r.id, Floor: 1 });
  expect(resumed.Beaten).toContain(`0:${resumed.Floors[0]!.Encounters.length}`);

  // The way up from any floor leaves the run.
  const up = (await run(page))!.up!;
  await walkInside(page, { x: up.x, z: up.z + 1 }, 1);
  await clickEntity(page, (e) => e.kind === "leave" && e.name === "way-up", "the way up");
  await waitSpace(page, "world", 60);
  expect((await page.request.get(new URL("api/dungeon/run", SERVER).toString())).status()).toBe(404);
});

test("Rofellos beaten on the real server: green unlocked, taken at the antechamber's table, and his hall empty for the week", async ({ page }) => {
  test.setTimeout(480_000);
  await character(page.request, 32, "Galen", "W");
  await verdict(page.request, "won");
  const id = "elfhame-hollow";
  await besideDungeon(page, id);
  await enter(page, id);
  await waitSpace(page, /^run:/, 60);

  // Green is outside a white character's identity, at the antechamber's spell table as anywhere.
  const green = { Main: [{ Name: "Forest", Count: 40 }], Ante: [] };
  const refused = await page.request.put(new URL("api/deck", SERVER).toString(), { data: green });
  expect(refused.status()).toBe(422);
  expect(((await refused.json()) as { Problems: string[] }).Problems).toContain("Forest is outside the color identity W.");

  for (let floor = 0; floor < (await run(page))!.floors - 1; floor++) await down(page);
  for (let tries = 0; tries < 6 && (await realm<string>(page, "screen")) !== "boss"; tries++) {
    const boss = await entity(page, (e) => e.kind === "mob" && e.role === "boss", "Rofellos");
    await walkInside(page, boss.tile, 2);
    // He may have come for Galen on the way, and been beaten by the stand-in already.
    if ((await realm<string>(page, "screen")) === "boss") break;
    if ((await realm<string | null>(page, "layer.open")) === null) await clickEntity(page, (e) => e.kind === "mob" && e.role === "boss", "Rofellos");
    await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "a duel", 30);
    if ((await realm<{ args: { mob: { id: string } } }[]>(page, "layer.requests")).at(-1)!.args.mob.id !== "rofellos") {
      await winDuel(page);
      continue;
    }
    await clickControl(page, "layer:win");
    // His torc is found first (the loot screen shows a gear drop), then his moment opens.
    await until(
      page,
      async () => {
        if ((await realm<string | null>(page, "layer.open")) === "loot") await clickControl(page, "layer:take");
        return (await realm<string>(page, "screen")) === "boss";
      },
      "his moment",
      60,
    );
  }
  await expect(page.locator("[data-test='boss-beaten']")).toContainText("Green is yours");
  await expect(page.locator("[data-test='boss-beaten:gear']")).toContainText("Rofellos's Emissary Torc");
  await clickControl(page, "boss-beaten:onward");
  await expect(page.locator("[data-test='hud:pip-g']")).toHaveAttribute("data-state", "held");
  const me = await api<Me & { Unlocked: string[]; Gear: { Gear: { Id: string } }[] }>(page.request, "me");
  expect(me.Identity).toBe("WG");
  expect(me.Gear.some((g) => g.Gear.Id === "rofellos-emissary-torc")).toBe(true);

  // Out, and in again: the hall below is empty this week; the antechamber's table takes green now.
  const out = (await run(page))!.wayOut!;
  await walkInside(page, out, 1);
  await clickEntity(page, (e) => e.kind === "leave" && e.name === "way-out", "the way out");
  await waitSpace(page, "world", 60);
  await enter(page, id);
  await waitSpace(page, /^run:/, 60);
  const resting = await api<{ Floors: { Boss: string | null }[]; Resting: { Boss: string } | null }>(page.request, "dungeon/run");
  expect(resting.Resting?.Boss).toBe("rofellos");
  expect(resting.Floors.at(-1)!.Boss).toBeNull();
  expect((await realm<string[]>(page, "messages")).some((m) => /rests until/.test(m))).toBe(true);
  const saved = await page.request.put(new URL("api/deck", SERVER).toString(), { data: green });
  expect(saved.ok(), await saved.text()).toBe(true);
});

/**
 * A run of the elfhames' hollow walked with the stand-in to Rofellos's floor (every warden and stair, the floor's other
 * mobs beaten too), then the page opened again on the real card layer - the run resumed - and Rofellos engaged: his
 * duel's splash is up.
 */
async function toRofellosForReal(page: Page, id: number, name: string, mob?: ForcedSeat): Promise<void> {
  await character(page.request, id, name, "W");
  if (mob) await forceDuel(page.request, { Mob: mob });
  await verdict(page.request, "won");
  const hollow = "elfhame-hollow";
  await besideDungeon(page, hollow);
  await enter(page, hollow);
  await waitSpace(page, /^run:/, 60);
  const r = (await run(page))!;
  for (let floor = 0; floor < r.floors - 1; floor++) await down(page);
  // The boss's floor's other mobs beaten too (they would come for the player on the way to him), so his is the duel played.
  for (let tries = 0; tries < 8 && (await entities(page)).some((e) => e.kind === "mob" && e.role === "encounter"); tries++) await beat(page, "encounter");

  await verdict(page.request, null);
  await page.goto(`/?server=${encodeURIComponent(SERVER)}&cards=${encodeURIComponent(`${CARDS}?test`)}&test&wander=0&encounters=never&mobs=0`);
  await waitReady(page);
  await waitSpace(page, `run:${r.id}`, 60);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);
  // Toward him step by step (he may come for the player himself), then at him: the walk never answers a duel itself.
  for (let tries = 0; tries < 30 && (await realm<string | null>(page, "layer.open")) === null; tries++) {
    const boss = await entity(page, (e) => e.kind === "mob" && e.role === "boss", "Rofellos");
    if (chebyshev(await playerTile(page), boss.tile) <= 2) {
      await clickEntity(page, (e) => e.kind === "mob" && e.role === "boss", "Rofellos");
      await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "a duel", 30);
      break;
    }
    const path = (await page.evaluate(([x, z]) => (globalThis as any).realmTest.pathTo(x, z), [boss.tile.x, boss.tile.z] as const)) as { x: number; z: number }[];
    const step = path[Math.min(6, Math.max(1, path.length - 3))]!;
    await page.evaluate(([x, z]) => (globalThis as any).realmTest.clickTile(x, z), [step.x, step.z] as const);
    await until(page, async () => (await realm<string | null>(page, "layer.open")) !== null || !(await entity(page, (e) => e.kind === "player", "the player")).moving, "the step taken", 20);
  }
  expect((await realm<{ args: { mob: { id: string } } }[]>(page, "layer.requests")).at(-1)!.args.mob.id).toBe("rofellos");
}

test("Rofellos beaten in the real card layer from a forced position: the server replays the win, green unlocked with its moment", async ({ page }) => {
  test.setTimeout(600_000);
  // He begins at 0 life (CR 704.5a: he loses as the first player would receive priority); the game is the engine's.
  await toRofellosForReal(page, 34, "Iona", { StartingLife: 0 });
  const ended = await playDuel(page);
  expect(ended.realm!.duel).toMatchObject({ mob: "Rofellos, Llanowar Emissary", over: true, won: true, end: "Victory" });

  const finished = page.waitForResponse((response) => response.url().endsWith("/api/encounter/finish"), { timeout: 60_000 });
  await clickCardControl(page, "Return to the world");
  const outcome = (await (await finished).json()) as { Outcome: string; Unlocked: string | null; Gift: string | null; Gear: { Gear: { Id: string } } | null };
  expect(outcome).toMatchObject({ Outcome: "won", Unlocked: "G" });
  expect(outcome.Gift).not.toBeNull();
  expect(outcome.Gear?.Gear.Id).toBe("rofellos-emissary-torc");

  // His torc is found first in the card layer, then his moment opens over the world.
  for (let tries = 0; tries < 60 && (await realm<string>(page, "screen")) !== "boss"; tries++) {
    if ((await realm<string | null>(page, "layer.open")) === "loot") {
      const state = await cardState(page);
      const go = state?.controls.filter((c) => /^(Take|Leave them|Done)/.test(c.label)).sort((a, b) => b.y - a.y)[0];
      if (go) await page.mouse.click(go.x, go.y);
    }
    await page.waitForTimeout(500);
  }
  await expect(page.locator("[data-test='boss-beaten']")).toContainText("Green is yours");
  await expect(page.locator("[data-test='boss-beaten:gift']")).toContainText(outcome.Gift!);
  await clickControl(page, "boss-beaten:onward");
  await expect(page.locator("[data-test='hud:pip-g']")).toHaveAttribute("data-state", "held");
  expect((await api<Me>(page.request, "me")).Identity).toBe("WG");
  await forceDuel(page.request, { Player: null, Mob: null });
});

test("a boss duel lost in the real card layer: the server replays it, the run is over and the character wakes at the inn", async ({ page }) => {
  test.setTimeout(600_000);
  await toRofellosForReal(page, 33, "Hale");
  // The encounter's splash first, then the duel dealt.
  await clickCardControl(page, "Fight");
  await expect
    .poll(async () => {
      const state = await cardState(page);
      return state?.ready === true && state.prompt.length > 0 && state.realm?.duel?.mob === "Rofellos, Llanowar Emissary";
    }, { timeout: 120_000, message: "the boss duel dealt in the card layer" })
    .toBe(true);

  const finished = page.waitForResponse((response) => response.url().endsWith("/api/encounter/finish"), { timeout: 60_000 });
  await clickCardControl(page, "Concede");
  await expect.poll(async () => (await cardState(page))?.controls.some((c) => c.label === "Play on") ?? false).toBe(true);
  await clickCardControl(page, "Concede");
  const outcome = (await (await finished).json()) as { Outcome: string; Detail: string | null };
  expect(outcome).toMatchObject({ Outcome: "lost", Detail: "The mob won." });

  await until(page, async () => /Your run of The Hollow under the Elfhames is over/.test((await realm<string>(page, "message")) ?? ""), "woken at the inn, the run over", 60);
  const me = await api<Me>(page.request, "me");
  const capital = world().towns.find((t) => t.kind === "capital")!;
  const inn = world().inns.find((i) => i.town === capital.id)!;
  expect(me).toMatchObject({ Space: "world", X: inn.x, Z: inn.z });
  expect((await page.request.get(new URL("api/dungeon/run", SERVER).toString())).status()).toBe(404);
});
