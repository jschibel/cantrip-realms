import { expect, test } from "@playwright/test";
import { NOW, advance, at, chebyshev, clickControl, clickTile, entity, openRealm, playerTile, realm, until, waitReady, world } from "./realm";

test("character creation: a name, a body, a palette and a color, and you begin outside the start town's inn", async ({ page }) => {
  await page.goto(`/?offline&test&manual&now=${NOW}&wander=0`);
  await expect.poll(() => realm<string>(page, "screen")).toBe("create");
  await clickControl(page, "create:create");
  await expect(page.locator("[data-problem]")).toHaveText(/at least two letters/);
  await clickControl(page, "create:name");
  await page.keyboard.type("Jhoira");
  await clickControl(page, "create:body:tall");
  await clickControl(page, "create:palette:3");
  await clickControl(page, "create:color:U");
  await clickControl(page, "create:create");
  await waitReady(page);
  await advance(page, 0.5);
  expect(await realm<string>(page, "space.id")).toBe("world");
  expect(await realm<string>(page, "character.name")).toBe("Jhoira");
  expect(await realm<string[]>(page, "character.identity")).toEqual(["U"]);
  const capital = world().towns.find((t) => t.kind === "capital")!;
  expect(await realm<{ name: string }>(page, "area")).toMatchObject({ name: capital.name });
  const inn = world().inns.find((i) => i.town === capital.id)!;
  // On the inn's door tile, or the nearest open one to it.
  expect(chebyshev(await playerTile(page), { x: inn.x, z: inn.z })).toBeLessThanOrEqual(1);
  const made = (await realm<{ name: string; body?: Record<string, unknown> }[]>(page, "api")).find((c) => c.name === "createCharacter");
  expect(made?.body).toEqual({ Name: "Jhoira", Body: "tall", Palette: 3, Color: "U" });
});

test("other players nearby walk where the relay says, in their looks", async ({ browser }) => {
  // Two tabs of one browser: offline, presence goes between them as the server's relay would. On a road out of New
  // Benalia, past its gate, where nothing stands in the way of a click.
  const town = world().towns.find((t) => t.id === "new-benalia")!;
  const road = world().roads.find((r) => r.from === town.id || r.to === town.id)!;
  const tiles = (road.from === town.id ? road.tiles : [...road.tiles].reverse()).map(([x, z]) => ({ x, z }));
  const out = tiles.findIndex((t) => chebyshev(t, { x: town.center[0], z: town.center[1] }) > town.radius + 6);
  const here = tiles[out]!;
  const there = tiles[out + 3]!;
  const beside = tiles[out + 1]!;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const alice = await context.newPage();
  const bob = await context.newPage();
  await openRealm(alice, { at: at(here), name: "Alice", extra: "&mobs=0" });
  await openRealm(bob, { at: at(beside), name: "Bob", color: "R", extra: "&mobs=0" });
  await advance(alice, 0.3);
  const seen = await entity(bob, (e) => e.kind === "other" && e.name === "Alice", "Alice, seen from Bob's tab");
  expect(seen.tile).toEqual(here);
  await entity(alice, (e) => e.kind === "other" && e.name === "Bob", "Bob, seen from Alice's tab");

  await clickTile(alice, there.x, there.z);
  await until(alice, async () => {
    const t = await playerTile(alice);
    return t.x === there.x && t.z === there.z;
  }, "Alice walked");
  await until(bob, async () => {
    const a = await entity(bob, (e) => e.kind === "other" && e.name === "Alice", "Alice");
    return a.tile.x === there.x && a.tile.z === there.z;
  }, "Alice seen walking", 20);

  // Leaving takes you off the others' screens.
  await alice.goto("about:blank");
  await until(bob, async () => !(await realm<{ kind: string }[]>(bob, "entities")).some((e) => e.kind === "other"), "Alice gone", 20);
  await context.close();
});
