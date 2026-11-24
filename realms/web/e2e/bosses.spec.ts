import { type Page, expect, test } from "@playwright/test";
import { clickControl, clickEntity, entities, entity, openRealm, player, realm, until, waitSpace, winDuel } from "./realm";
import { beat, enter, run, walkInside } from "./runs";

// A color boss beaten in a run of its dungeon (design.md A6), offline with the stand-in card layer: every floor's warden
// and stair to the last floor, then Rofellos in the elfhames' hollow - the moment it deserves (green unlocked, the five
// pips with the new one lit, his gift and his own torc), the HUD's green pip lit after it, the regional map's ring round
// his dungeon filled; out by the way that opens beside him, and in again: his hall stands empty for the week, its way out
// open all the same.

/** Takes the floor's stair once its warden is beaten. */
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
  await until(page, async () => (await run(page))?.floor === r.floor + 1, "down the stair", 30);
  await waitSpace(page, /^run:/);
}

/** Beats the floor's boss with the stand-in, taking its loot, until its moment opens. */
async function beatTheBoss(page: Page): Promise<void> {
  for (let tries = 0; tries < 6 && (await realm<string>(page, "screen")) !== "boss"; tries++) {
    const boss = await entity(page, (e) => e.kind === "mob" && e.role === "boss", "the boss");
    await walkInside(page, boss.tile, 2);
    if ((await realm<string>(page, "screen")) === "boss") break;
    if ((await realm<string | null>(page, "layer.open")) === null) await clickEntity(page, (e) => e.kind === "mob" && e.role === "boss", "the boss");
    await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "a duel", 20);
    // A floor's mob that came for the player first is beaten on the way.
    const against = (await realm<{ screen: string; args: { mob: { id: string } } }[]>(page, "layer.requests")).at(-1)!.args.mob.id;
    if (against !== "rofellos") {
      await winDuel(page);
      continue;
    }
    await clickControl(page, "layer:win");
    await until(
      page,
      async () => {
        if ((await realm<string | null>(page, "layer.open")) === "loot") await clickControl(page, "layer:take");
        return (await realm<string>(page, "screen")) === "boss";
      },
      "the boss's moment",
      30,
    );
  }
}

test("Rofellos beaten: green unlocked with its moment, his gift and his torc, then his hall empty for the week", async ({ page }) => {
  test.setTimeout(420_000);
  const id = "elfhame-hollow";
  await openRealm(page, { at: id, extra: "&mobs=0" });
  await expect(page.locator("[data-test='hud:pip-g']")).toHaveAttribute("data-state", "locked");
  await expect(page.locator("[data-test='hud:pip-w']")).toHaveAttribute("data-state", "held");
  const ring = async () => (await realm<{ markers: { id: string; well: string | null; won: boolean | null }[] }>(page, "map")).markers.find((m) => m.id === id);
  await until(page, async () => (await ring()) !== undefined, "the hollow on the regional map");
  expect(await ring()).toMatchObject({ well: "G", won: false });

  await enter(page, id);
  await waitSpace(page, /^run:/);
  const floors = (await run(page))!.floors;
  for (let floor = 0; floor < floors - 1; floor++) await down(page);
  await beatTheBoss(page);

  // The moment: green is the character's, the pips with green new, his gift and his own unique item.
  const panel = page.locator("[data-test='boss-beaten']");
  await expect(panel).toHaveAttribute("data-unlocked", "G");
  await expect(panel).toContainText("Green is yours");
  await expect(page.locator("[data-test='boss-beaten:pip-g']")).toHaveAttribute("data-state", "new");
  await expect(page.locator("[data-test='boss-beaten:pip-w']")).toHaveAttribute("data-state", "held");
  await expect(page.locator("[data-test='boss-beaten:pip-u']")).toHaveAttribute("data-state", "locked");
  await expect(page.locator("[data-test='boss-beaten:gift']")).toContainText("Its gift");
  await expect(page.locator("[data-test='boss-beaten:gear']")).toContainText("Rofellos's Emissary Torc");
  if (process.env.REALM_SHOTS) await page.screenshot({ path: "e2e/screenshots/boss-beaten.png" });
  await clickControl(page, "boss-beaten:onward");
  await until(page, async () => (await realm<string>(page, "screen")) === "world" && !(await realm<boolean>(page, "paused")), "on, after the moment");

  await expect(page.locator("[data-test='hud:pip-g']")).toHaveAttribute("data-state", "held");
  expect((await realm<{ identity: string[] }>(page, "character")).identity).toEqual(["W", "G"]);
  expect((await realm<{ name: string; body?: { Outcome: string } }[]>(page, "api")).filter((c) => c.name === "finishEncounter").length).toBeGreaterThan(0);

  // Out by the way beside him; the map's ring round the hollow filled now.
  const out = (await run(page))!.wayOut!;
  await walkInside(page, out, 1);
  await clickEntity(page, (e) => e.kind === "leave" && e.name === "way-out", "the way out");
  await waitSpace(page, "world");
  await until(page, async () => (await ring())?.won === true, "the ring filled");

  // In again within the week: his hall is empty, and its way out stands open.
  await enter(page, id);
  await waitSpace(page, /^run:/);
  expect((await realm<string[]>(page, "messages")).some((m) => /Rofellos, Llanowar Emissary was beaten here this week and rests until/.test(m))).toBe(true);
  const again = (await run(page))!;
  for (let floor = 0; floor < again.floors - 1; floor++) await down(page);
  expect((await entities(page)).some((e) => e.kind === "mob" && e.role === "boss")).toBe(false);
  expect((await realm<string[]>(page, "messages")).some((m) => /The hall is empty/.test(m))).toBe(true);
  const wayOut = (await run(page))!.wayOut!;
  expect(wayOut).not.toBeNull();
  await walkInside(page, wayOut, 1);
  await clickEntity(page, (e) => e.kind === "leave" && e.name === "way-out", "the way out");
  await waitSpace(page, "world");
  void player;
});
