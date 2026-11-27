import { type Page, expect, test } from "@playwright/test";
import { chebyshev, clickControl, clickEntity, dungeon, entities, entity, playerTile, realm, until, waitReady, waitSpace, winDuel } from "../realm";
import { beat, beatOne, descend, enter, run, toGate, walkInside } from "../runs";
import { type Me, SERVER, api, besideEntrance, character, place, query, verdict } from "./server";

// Dungeon runs against the real realm server on the generated Domains (playwright.config.ts here), each a tournament
// (design.md A6): the run the server hands out at a dungeon's entrance, its first round's gate the server keeps shut
// until two of three challengers are beaten, then lets the character through; and a mage tower attuned by beating its
// mage in its hall, then its waystone's fast travel to another attuned tower. A test starts
// its character beside the entrance (POST /dev/place, test-only) and has the server count the stand-in card layer's
// wins (POST /dev/verdict, test-only): the real duel and its replay are card-layer.spec.ts's.

/** Opens the overworld where the server has the character, beside a dungeon's way in. */
async function besideDungeon(page: Page, id: string): Promise<void> {
  await place(page.request, besideEntrance(id));
  await page.goto(query("&mobs=0"));
  await waitReady(page);
  await waitSpace(page, "world");
}

/** What the server says to the gate down from the floor the run stands on. */
async function tryGate(page: Page, run: string, floor: number): Promise<{ status: number; error: string | null }> {
  const r = await page.request.post(new URL("api/dungeon/floor", SERVER).toString(), { data: { Run: run, Floor: floor } });
  return { status: r.status(), error: r.ok() ? null : ((await r.json()) as { Error: string }).Error };
}

test("a dungeon run on the real server: in at its entrance by its board, the gate shut at one win of three, open at two, and down", async ({ page }) => {
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

  // The server keeps the gate shut until two of the round's three challengers are beaten; then it lets the character by.
  expect(r.round).toEqual({ beaten: 0, of: 3, need: 2, open: false });
  expect(await tryGate(page, r.id, 1)).toEqual({ status: 409, error: "RoundOpen" });
  await beatOne(page, "encounter");
  expect(await tryGate(page, r.id, 1)).toEqual({ status: 409, error: "RoundOpen" });
  await toGate(page);
  await until(page, async () => (await realm<string[]>(page, "messages")).includes("Beat 2 of the 3 challengers to open the gate."), "told the gate is shut", 20);
  await descend(page);
  expect((await realm<string[]>(page, "messages")).some((m) => /^Round 2 of/.test(m) || /^The boss's hall/.test(m))).toBe(true);
  expect((await api<Me>(page.request, "me")).Space).toBe(`run:${r.id}`);
  expect((await api<{ Floor: number }>(page.request, "dungeon/run")).Floor).toBe(1);
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
    for (let floor = 0; floor < r.floors - 1; floor++) await descend(page);
    // The mage alone in its hall.
    expect((await entities(page)).filter((e) => e.kind === "mob").map((e) => e.role)).toEqual(["boss"]);
    await beat(page, "boss");
    await until(page, async () => (await api<Me>(page.request, "me")).Attuned.includes(tower), "attuned on the server", 60);
    expect(await realm<string[]>(page, "character.attuned")).toContain(tower);

    // Out by the way that opens beside the mage, to the entrance in the world.
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
  const travelled = page.waitForResponse((response) => response.url().endsWith("/api/waystone"), { timeout: 60_000 });
  await clickControl(page, `dialog:${dungeon(to).name.toLowerCase()}`);
  // Where the server put Edda: beside the other tower's way in (the first open step from it, Dungeons.Outside).
  const landed = ((await (await travelled).json()) as { Place: { Space: string; X: number; Z: number } }).Place;
  expect(landed.Space).toBe("world");
  expect(chebyshev({ x: landed.X, z: landed.Z }, { x: dungeon(to).entrance[0], z: dungeon(to).entrance[1] })).toBeLessThanOrEqual(1);
  await until(page, async () => /The waystone carries you to/.test((await realm<string>(page, "message")) ?? ""), "carried", 60);
  // The page stands her on that tile, and the server has her there still once the page has reported where it is.
  await until(page, async () => !(await realm<boolean>(page, "transitioning")), "the iris open again", 30);
  expect(await playerTile(page)).toEqual({ x: landed.X, z: landed.Z });
  const me = await api<Me>(page.request, "me");
  expect({ Space: me.Space, X: me.X, Z: me.Z }).toEqual(landed);
});
