import { type Page, expect, test } from "@playwright/test";
import { hex } from "../../src/hex";
import { clickControl, dungeon, entity, playerHex, realm, steady, waitSpace } from "../realm";
import { beat, enter, parse, walkInside } from "../runs";
import { type Me, SERVER, api, besideEntrance, character, place, query, verdict } from "./server";

// Dungeon runs against the real realm server on the real world (playwright.config.ts here): the run the server hands
// out at a dungeon's entrance, its warden beaten before the stair, the stair the server lets the character take; and a
// mage tower attuned by beating its mage, then its waystone's fast travel to another attuned tower. A test starts its
// character beside the entrance (POST /dev/place, test-only) and has the server count the stand-in card layer's wins
// (POST /dev/verdict, test-only): the real duel and its replay are card-layer.spec.ts's.

interface Run {
  readonly id: string;
  readonly dungeon: string;
  readonly floor: number;
  readonly floors: number;
  readonly down: string | null;
}

/** Opens the overworld where the server has the character, beside a dungeon's way in. */
async function besideDungeon(page: Page, id: string): Promise<void> {
  await place(page.request, besideEntrance(id));
  await page.goto(query("&mobs=0"));
  await waitSpace(page, "world");
}

/** Beats the warden of the floor the run stands on and takes its stair down: the server lets the character by. */
async function down(page: Page): Promise<void> {
  const run = (await realm<Run>(page, "run"))!;
  await beat(page, "warden");
  await walkInside(page, parse(run.down!), 3);
  const stair = await steady(page, (e) => e.kind === "stairs-down", "the stairs down");
  await page.mouse.click(stair.x, stair.y);
  await expect.poll(async () => (await realm<Run>(page, "run")).floor, { timeout: 30_000 }).toBe(run.floor + 1);
  await waitSpace(page, /^run:/);
}

test("a dungeon run on the real server: in at its entrance, the warden before the stair, and the stair down", async ({ page }) => {
  test.setTimeout(240_000);
  await character(page.request, 11, "Dara");
  await verdict(page.request, "won");
  const id = "benalish-keep";
  await besideDungeon(page, id);

  await enter(page, id);
  await waitSpace(page, /^run:/);
  const run = (await realm<Run>(page, "run"))!;
  expect(run).toMatchObject({ dungeon: id, floor: 0 });
  expect(run.floors).toBeGreaterThanOrEqual(dungeon(id).floors[0]);
  expect((await api<Me>(page.request, "me")).Space).toBe(`run:${run.id}`);
  await entity(page, (e) => e.kind === "spell-table", "the entrance's spell table");

  // The server bars the stair while the warden stands; once it is beaten, it takes the character down.
  const barred = await page.request.post(new URL("api/dungeon/floor", SERVER).toString(), { data: { Run: run.id, Floor: 1 } });
  expect(barred.status()).toBe(409);
  expect(((await barred.json()) as { Error: string }).Error).toBe("WardenStands");
  await down(page);
  expect(await realm<string>(page, "message")).toMatch(/Floor 2 of/);
  expect((await api<Me>(page.request, "me")).Space).toBe(`run:${run.id}`);
});

test("mage towers attuned by beating their mages on the real server, then a waystone's travel between them", async ({ page }) => {
  test.setTimeout(420_000);
  await character(page.request, 12, "Edda");
  await verdict(page.request, "won");
  const towers = ["benalia-1", "benalia-2"];

  for (const tower of towers) {
    await besideDungeon(page, tower);
    const stone = await steady(page, (e) => e.kind === "waystone" && e.tower === tower, "the tower's waystone");
    await page.mouse.move(stone.x, stone.y);
    await expect.poll(() => realm<string | null>(page, "tooltip")).toMatch(/dormant/);
    await enter(page, tower);
    await waitSpace(page, /^run:/);
    const run = (await realm<Run>(page, "run"))!;
    for (let floor = 0; floor < run.floors - 1; floor++) await down(page);
    await beat(page, "boss");
    await expect.poll(async () => (await api<Me>(page.request, "me")).Attuned).toContain(tower);
    expect(await realm<string[]>(page, "character.attuned")).toContain(tower);

    // Out by the way that opens beside the mage, to the entrance in the world.
    const out = await steady(page, (e) => e.kind === "leave" && e.id === "way-out", "the way out");
    await page.mouse.click(out.x, out.y);
    await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
    await clickControl(page, "dialog:leave");
    await waitSpace(page, "world");
    const [q, r] = dungeon(tower).entrance;
    const me = await api<Me>(page.request, "me");
    expect(me.Space).toBe("world");
    expect(Math.max(Math.abs(me.Q - q), Math.abs(me.R - r), Math.abs(me.Q + me.R - q - r))).toBe(1);
  }

  // From the second tower's lit waystone to the first's, at once.
  const [from, to] = [towers[1]!, towers[0]!];
  const lit = await steady(page, (e) => e.kind === "waystone" && e.tower === from, "the tower's waystone");
  await page.mouse.move(lit.x, lit.y);
  await expect.poll(() => realm<string | null>(page, "tooltip")).toMatch(/attuned/);
  await page.mouse.click(lit.x, lit.y);
  await expect.poll(() => realm<string>(page, "screen"), { timeout: 20_000 }).toBe("dialog");
  await clickControl(page, `dialog:${dungeon(to).name.toLowerCase()}`);
  await expect.poll(() => realm<string>(page, "message"), { timeout: 30_000 }).toMatch(/The waystone carries you to/);
  const there = hex(...dungeon(to).entrance);
  const me = await api<Me>(page.request, "me");
  expect(me.Space).toBe("world");
  expect(Math.max(Math.abs(me.Q - there.q), Math.abs(me.R - there.r), Math.abs(me.Q + me.R - there.q - there.r))).toBe(1);
  const standing = await playerHex(page);
  expect([standing.q, standing.r]).toEqual([me.Q, me.R]);
});
