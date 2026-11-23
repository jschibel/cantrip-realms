import { type APIRequestContext, type Frame, type Page, expect, test } from "@playwright/test";
import { at, entity, mapData, openNear, realm, waitReady } from "../realm";

// Both layers on one page against the real realm server (playwright.config.ts here): the overworld frames the real card
// layer - the web client's ?realm page, on an origin of its own - and a duel started in the world is dealt and played on
// the rules engine in that page, the mob's seat answered there. The player concedes with real clicks; the overworld
// hands the duel's log to /api/encounter/finish, which replays it on the native engine and takes it: a whole game the mob
// won ("The mob won."), so a loss, not a rejected log; and the character wakes at the inn.

const SERVER = process.env.REALMS_E2E_SERVER!;
const CARDS = process.env.REALMS_E2E_CARDS!;

const query = (extra = "") =>
  `/?server=${encodeURIComponent(SERVER)}&cards=${encodeURIComponent(`${CARDS}?test`)}&test&wander=0&encounters=never${extra}`;

async function signIn(request: APIRequestContext, id: number, name: string): Promise<void> {
  const response = await request.post(new URL("dev/signin", SERVER).toString(), { data: { Id: id, Name: name } });
  expect(response.ok(), await response.text()).toBe(true);
}

interface Control {
  readonly kind: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

interface CardLayerState {
  readonly ready: boolean;
  readonly phase: string;
  readonly prompt: string;
  readonly controls: readonly Control[];
  readonly realm?: { readonly screen: string; readonly duel?: { readonly mob: string; readonly log: number; readonly over: boolean } };
}

/** The card layer's frame: the page the overworld framed from ?cards. */
const cardFrame = (page: Page): Frame => page.frames().find((frame) => frame.url().startsWith(CARDS))!;

/** What the card layer publishes on cantripTest (the web client's ?test), read in its frame. */
async function cardState(page: Page): Promise<CardLayerState | null> {
  const json = await cardFrame(page).evaluate(() => (globalThis as { cantripTest?: string }).cantripTest ?? null);
  return json === null ? null : (JSON.parse(json) as CardLayerState);
}

/** Clicks a card layer control by what it says - the lowest of those that say it - where it is on the page: the frame fills it. */
async function clickCardControl(page: Page, label: string): Promise<void> {
  let found: Control | undefined;
  await expect
    .poll(async () => {
      const state = await cardState(page);
      found = state?.controls.filter((c) => c.label === label).sort((a, b) => b.y - a.y)[0];
      return found !== undefined;
    }, { message: `the card layer's ${label}` })
    .toBe(true);
  await page.mouse.click(found!.x, found!.y);
}

test("a duel started in the world is played in the real card layer, and its log is taken by the server", async ({ page }) => {
  test.setTimeout(360_000);
  await signIn(page.request, 21, "Cass");
  const made = await page.request.post(new URL("api/character", SERVER).toString(), { data: { Name: "Cass", Body: "lithe", Palette: 0, Color: "W" } });
  expect(made.ok(), await made.text()).toBe(true);

  // At Benalish Meadow, by its spawn of a lone Phyrexian scout; the card layer boots behind the world meanwhile.
  const meadow = mapData("benalish-meadow");
  const spawn = meadow.spawns.find((s) => s.id === "s1")!;
  await page.goto(query(`&at=${at(meadow, openNear(meadow, spawn, 6))}`));
  await waitReady(page);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);

  // The scout engaged: the encounter starts on the server and the duel opens in the card layer, dealt on its engine.
  const scout = await entity(page, (e) => e.kind === "mob" && e.spawn === "s1", "the Phyrexian scout");
  await page.mouse.click(scout.x, scout.y);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 30_000 }).toBe("duel");
  await expect
    .poll(async () => {
      const state = await cardState(page);
      return state?.ready === true && state.prompt.length > 0 && state.realm?.duel?.mob === "Phyrexian Scout";
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

  // Back in the world, waking at the inn the meadow names.
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe(null);
  await expect.poll(() => realm<string>(page, "map.id"), { timeout: 30_000 }).toBe(meadow.inn!.map ?? meadow.id);
  const me = await page.request.get(new URL("api/me", SERVER).toString());
  expect(((await me.json()) as { Map: string }).Map).toBe(meadow.inn!.map ?? meadow.id);
});
