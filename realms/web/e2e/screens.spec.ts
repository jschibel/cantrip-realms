import { expect, test } from "@playwright/test";
import { NOW, at, clickControl, clickHex, entity, openNear, openRealm, player, playerHex, realm, waitSpace, world } from "./realm";

test("character creation: a name, a body, a palette and a color, and you begin outside the start town's inn", async ({ page }) => {
  await page.goto(`/?offline&test&now=${NOW}&wander=0`);
  await expect.poll(() => realm<string>(page, "screen")).toBe("create");
  await clickControl(page, "create:create");
  await expect(page.locator("[data-problem]")).toHaveText(/at least two letters/);
  await clickControl(page, "create:name");
  await page.keyboard.type("Jhoira");
  await clickControl(page, "create:body:tall");
  await clickControl(page, "create:palette:3");
  await clickControl(page, "create:color:U");
  await clickControl(page, "create:create");
  await waitSpace(page, "world");
  expect(await realm<string>(page, "character.name")).toBe("Jhoira");
  expect(await realm<string[]>(page, "character.identity")).toEqual(["U"]);
  const capital = world().towns.find((t) => t.kind === "capital")!;
  expect(await realm<{ name: string }>(page, "area")).toMatchObject({ name: capital.name });
  const inn = world().inns.find((i) => i.town === capital.id)!;
  expect(await playerHex(page)).toEqual({ q: inn.q, r: inn.r });
  const made = (await realm<{ name: string; body?: Record<string, unknown> }[]>(page, "api")).find((c) => c.name === "createCharacter");
  expect(made?.body).toEqual({ Name: "Jhoira", Body: "tall", Palette: 3, Color: "U" });
});

test("other players nearby walk where the relay says, in their looks", async ({ browser }) => {
  // Two tabs of one browser: offline, presence goes between them as the server's relay would.
  // On a road out of New Benalia, past its gate, where nothing stands in the way of a click.
  const road = world().roads.find((r) => r.from === "new-benalia" || r.to === "new-benalia")!;
  const hexes = (road.from === "new-benalia" ? road.hexes : [...road.hexes].reverse()).map(([q, r]) => ({ q, r }));
  const here = hexes[6]!;
  const there = hexes[9]!;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const alice = await context.newPage();
  const bob = await context.newPage();
  await openRealm(alice, { at: at(here), name: "Alice", extra: "&mobs=0" });
  await openRealm(bob, { at: at(openNear(here, 1)), name: "Bob", color: "R", extra: "&mobs=0" });
  const seen = await entity(bob, (e) => e.kind === "other" && e.name === "Alice", "Alice, seen from Bob's tab");
  expect(seen.hex).toBe(`${here.q},${here.r}`);
  await entity(alice, (e) => e.kind === "other" && e.name === "Bob", "Bob, seen from Alice's tab");

  await clickHex(alice, there.q, there.r);
  await expect.poll(async () => (await player(alice)).hex).toBe(`${there.q},${there.r}`);
  await expect.poll(async () => (await entity(bob, (e) => e.kind === "other" && e.name === "Alice", "Alice")).hex).toBe(`${there.q},${there.r}`);

  // Leaving takes you off the others' screens.
  await alice.goto("about:blank");
  await expect.poll(async () => (await realm<{ kind: string }[]>(bob, "entities")).some((e) => e.kind === "other")).toBe(false);
  await context.close();
});
