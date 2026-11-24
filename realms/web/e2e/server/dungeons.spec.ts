import { type Page, expect, test } from "@playwright/test";
import { chebyshev, clickControl, clickEntity, dungeon, entity, playerTile, realm, until, waitReady, waitSpace, winDuel } from "../realm";
import { beat, enter, run, walkInside } from "../runs";
import { type Me, SERVER, api, besideEntrance, character, place, query, verdict } from "./server";

// Dungeon runs against the real realm server on the generated Domains (playwright.config.ts here): the run the server
// hands out at a dungeon's entrance, its warden beaten before the stair, the stair the server lets the character take;
// and a mage tower attuned by beating its mage, then its waystone's fast travel to another attuned tower. A test starts
// its character beside the entrance (POST /dev/place, test-only) and has the server count the stand-in card layer's
// wins (POST /dev/verdict, test-only): the real duel and its replay are card-layer.spec.ts's.

/** Opens the overworld where the server has the character, beside a dungeon's way in. */
async function besideDungeon(page: Page, id: string): Promise<void> {
  await place(page.request, besideEntrance(id));
  await page.goto(query("&mobs=0"));
  await waitReady(page);
  await waitSpace(page, "world");
}

/** Beats the warden of the floor the run stands on and takes its stair down: the server lets the character by. */
async function down(page: Page): Promise<void> {
  const r = (await run(page))!;
  await beat(page, "warden");
  await walkInside(page, r.down!, 2);
  await clickEntity(page, (e) => e.kind === "down", "the stairs down");
  await until(page, async () => (await run(page))?.floor === r.floor + 1, "down the stair", 60);
  await waitSpace(page, /^run:/);
}

test("a dungeon run on the real server: in at its entrance, the warden before the stair, and the stair down", async ({ page }) => {
  test.setTimeout(300_000);
  await character(page.request, 11, "Dara");
  await verdict(page.request, "won");
  const id = "benalish-keep";
  await besideDungeon(page, id);

  await enter(page, id);
  await waitSpace(page, /^run:/, 60);
  const r = (await run(page))!;
  expect(r.floor).toBe(0);
  expect(r.floors).toBeGreaterThanOrEqual(dungeon(id).floors[0]);
  expect((await api<Me>(page.request, "me")).Space).toBe(`run:${r.id}`);
  await entity(page, (e) => e.kind === "spell-table", "the entrance's spell table");

  // The server bars the stair while the warden stands; once it is beaten, it takes the character down.
  const barred = await page.request.post(new URL("api/dungeon/floor", SERVER).toString(), { data: { Run: r.id, Floor: 1 } });
  expect(barred.status()).toBe(409);
  expect(((await barred.json()) as { Error: string }).Error).toBe("WardenStands");
  await down(page);
  expect((await realm<string[]>(page, "messages")).some((m) => /Floor 2 of/.test(m))).toBe(true);
  expect((await api<Me>(page.request, "me")).Space).toBe(`run:${r.id}`);
});

test("mage towers attuned by beating their mages on the real server, then a waystone's travel between them", async ({ page }) => {
  test.setTimeout(480_000);
  await character(page.request, 12, "Edda");
  await verdict(page.request, "won");
  const towers = ["benalia-1", "benalia-2"];

  for (const tower of towers) {
    await besideDungeon(page, tower);
    const stone = await entity(page, (e) => e.kind === "waystone" && e.id === tower, "the tower's waystone");
    await page.mouse.move(stone.x, stone.y);
    await until(page, async () => /dormant/.test((await realm<string | null>(page, "tooltip")) ?? ""), "dormant");
    await enter(page, tower);
    await waitSpace(page, /^run:/, 60);
    const r = (await run(page))!;
    for (let floor = 0; floor < r.floors - 1; floor++) await down(page);
    await beat(page, "boss");
    await until(page, async () => (await api<Me>(page.request, "me")).Attuned.includes(tower), "attuned on the server", 60);
    expect(await realm<string[]>(page, "character.attuned")).toContain(tower);

    // Out by the way that opens beside the mage, to the entrance in the world.
    // A mob of the floor that comes for Edda on the way is beaten by the stand-in; then the way out is clicked again.
    const inWorld = async () => (await realm<string | undefined>(page, "space.id")) === "world" && !(await realm<boolean>(page, "transitioning"));
    const inDuel = async () => (await realm<string | null>(page, "layer.open")) === "duel";
    for (let tries = 0; tries < 4 && !(await inWorld()); tries++) {
      await walkInside(page, (await run(page))!.wayOut!, 1);
      await clickEntity(page, (e) => e.kind === "leave" && e.name === "way-out", "the way out");
      await until(page, async () => (await inWorld()) || (await inDuel()), "out, or stopped by a mob", 60);
      if (await inDuel()) await winDuel(page);
    }
    await waitSpace(page, "world", 60);
    const [x, z] = dungeon(tower).entrance;
    const me = await api<Me>(page.request, "me");
    expect(me.Space).toBe("world");
    expect(chebyshev({ x: me.X, z: me.Z }, { x, z })).toBe(1);
  }

  // From the second tower's lit waystone to the first's, at once.
  const [from, to] = [towers[1]!, towers[0]!];
  const lit = await entity(page, (e) => e.kind === "waystone" && e.id === from, "the tower's waystone");
  await page.mouse.move(lit.x, lit.y);
  await until(page, async () => /attuned/.test((await realm<string | null>(page, "tooltip")) ?? ""), "lit");
  await page.mouse.click(lit.x, lit.y);
  await until(page, async () => (await realm<string>(page, "screen")) === "dialog", "the waystone's word", 30);
  await clickControl(page, `dialog:${dungeon(to).name.toLowerCase()}`);
  await until(page, async () => /The waystone carries you to/.test((await realm<string>(page, "message")) ?? ""), "carried", 60);
  const there = { x: dungeon(to).entrance[0], z: dungeon(to).entrance[1] };
  const me = await api<Me>(page.request, "me");
  expect(me.Space).toBe("world");
  expect(chebyshev({ x: me.X, z: me.Z }, there)).toBe(1);
  expect(await playerTile(page)).toEqual({ x: me.X, z: me.Z });
});
