import { expect, test } from "@playwright/test";
import { spawnNear } from "../places";
import { entity, openNear, realm, until, waitReady, world } from "../realm";
import { CARDS, cardState, clickCardControl } from "./cardLayer";
import { SERVER, signIn } from "./server";

// Both layers on one page against the real realm server (playwright.config.ts here): the overworld frames the real card
// layer - the web client's ?realm page, on an origin of its own - and a duel started in the world is dealt and played on
// the rules engine in that page, the mob's seat answered there. The player concedes with real clicks; the overworld
// hands the duel's log to /api/encounter/finish, which replays it on the native engine and takes it: a whole game the mob
// won ("The mob won."), so a loss, not a rejected log; and the character wakes at the inn.

const query = (extra = "") =>
  `/?server=${encodeURIComponent(SERVER)}&cards=${encodeURIComponent(`${CARDS}?test`)}&test&wander=0&encounters=never${extra}`;

test("a duel started in the world is played in the real card layer, and its log is taken by the server", async ({ page }) => {
  test.setTimeout(360_000);
  await signIn(page.request, 21, "Cass");
  const made = await page.request.post(new URL("api/character", SERVER).toString(), { data: { Name: "Cass", Body: "lithe", Palette: 0, Color: "W" } });
  expect(made.ok(), await made.text()).toBe(true);

  // By a spawn of the wilds near New Benalia, where the test puts the character (POST /dev/place, test-only); the card
  // layer boots behind the world meanwhile.
  const spawn = spawnNear("new-benalia");
  const start = openNear(spawn, 6);
  const placed = await page.request.post(new URL("dev/place", SERVER).toString(), { data: { Space: "world", X: start.x, Z: start.z } });
  expect(placed.ok(), await placed.text()).toBe(true);
  await page.goto(query());
  await waitReady(page);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);

  // The scout engaged: the encounter starts on the server and the duel opens in the card layer, dealt on its engine.
  const scout = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await page.mouse.click(scout.x, scout.y);
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "the duel", 60);
  // The encounter's splash first, then the duel dealt.
  await clickCardControl(page, "Fight");
  await expect
    .poll(async () => {
      const state = await cardState(page);
      return state?.ready === true && state.prompt.length > 0 && state.realm?.duel?.mob === scout.name;
    }, { timeout: 120_000, message: "the duel dealt in the card layer" })
    .toBe(true);

  // Conceded from the duel's bar, then said again in its question: the card layer closes the duel as lost, with its log.
  const finished = page.waitForResponse((response) => response.url().endsWith("/api/encounter/finish"), { timeout: 60_000 });
  await clickCardControl(page, "Concede");
  await expect.poll(async () => (await cardState(page))?.controls.some((c) => c.label === "Play on") ?? false).toBe(true);
  await clickCardControl(page, "Concede");

  const finish = await finished;
  const sent = finish.request().postDataJSON() as { Token: string; Log: string[] };
  expect(sent.Log.length).toBeGreaterThan(0);
  const outcome = (await finish.json()) as { Outcome: string; Detail: string | null };
  expect(outcome).toMatchObject({ Outcome: "lost", Detail: "The mob won." });

  // Back in the world, waking outside the start town's inn.
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe(null);
  await until(page, async () => /You lost the duel, and wake at the inn/.test((await realm<string>(page, "message")) ?? ""), "woken at the inn", 60);
  const me = (await (await page.request.get(new URL("api/me", SERVER).toString())).json()) as { Space: string; X: number; Z: number };
  const capital = world().towns.find((t) => t.kind === "capital")!;
  const inn = world().inns.find((i) => i.town === capital.id)!;
  expect(me).toMatchObject({ Space: "world", X: inn.x, Z: inn.z });
});
