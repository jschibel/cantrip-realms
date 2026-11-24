import { type APIRequestContext, type Frame, type Page, expect, test } from "@playwright/test";
import { spawnNear } from "../places";
import { entity, openNear, realm, waitReady } from "../realm";

// The spell table and a card vendor in the real card layer against the real realm server (playwright.config.ts here): the
// overworld frames the web client's ?realm page, and every edit, save, purchase and sale is a real mouse click (or drag)
// at the place the card layer publishes on cantripTest. The server is the judge of a deck: the editor shows what it
// says, Save keeps only what it takes, and the duel that follows deals exactly the deck it kept, with its ante.

const SERVER = process.env.REALMS_E2E_SERVER!;
const CARDS = process.env.REALMS_E2E_CARDS!;

/** The players' ids, moved on by REALMS_E2E_IDS for a run against a server kept from an earlier one. */
const id = (n: number): number => n + Number(process.env.REALMS_E2E_IDS ?? 0);

const query = (extra = "") =>
  `/?server=${encodeURIComponent(SERVER)}&cards=${encodeURIComponent(`${CARDS}?test`)}&test&wander=0&encounters=never${extra}`;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Control extends Box {
  readonly kind: string;
  readonly label: string;
  readonly enabled: boolean;
}

interface Card extends Box {
  readonly name: string;
  readonly row: string;
  readonly visible: boolean;
}

interface CardLayerState {
  readonly ready: boolean;
  readonly prompt: string;
  readonly controls: readonly Control[];
  readonly cards: readonly Card[];
  readonly deckEditor?: {
    readonly status: string;
    readonly unsaved: boolean;
    readonly problems: readonly string[];
    readonly checked: boolean;
    readonly main: readonly string[];
    readonly side: readonly string[];
  };
  readonly realm?: {
    readonly screen: string;
    readonly facts: string;
    readonly status: string;
    readonly table?: { readonly ante: string; readonly anteValue: number; readonly curve: string; readonly colors: string; readonly notes: Record<string, string> };
    readonly duel?: { readonly mob: string; readonly over: boolean };
  };
}

interface CardCount {
  readonly Name: string;
  readonly Count: number;
}

interface Deck {
  readonly Main: readonly CardCount[];
  readonly Ante: readonly CardCount[];
  readonly AnteValue: number;
}

interface Collection {
  readonly Cards: Record<string, number>;
  readonly Prices: Record<string, number>;
}

interface Vendor {
  readonly Vendor: { readonly Id: string; readonly Kind: string };
  readonly Purse: number;
  readonly Gold: number;
  readonly Stock: readonly { readonly Name: string; readonly Gold: number; readonly Count: number }[];
  readonly Buying: readonly { readonly Name: string; readonly Gold: number; readonly Owned: number; readonly Spare: number }[];
}

async function call<T>(request: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const response = await request.fetch(new URL(path, SERVER).toString(), { method, data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

const api = <T>(request: APIRequestContext, path: string) => call<T>(request, "GET", `api/${path}`);

/** Signs a player in, makes a white character, gives them cards (POST /dev/cards, test-only) and puts them where the test starts. */
async function character(request: APIRequestContext, id: number, name: string, cards: Record<string, number>, space: string, at: { x: number; z: number }): Promise<void> {
  await call(request, "POST", "dev/signin", { Id: id, Name: name });
  await call(request, "POST", "api/character", { Name: name, Body: "tall", Palette: 2, Color: "W" });
  const owned = (await api<Collection>(request, "collection")).Cards;
  for (const [card, count] of Object.entries(cards)) {
    const more = count - (owned[card] ?? 0);
    if (more !== 0) await call(request, "POST", "dev/cards", { Name: card, Count: more });
  }
  await call(request, "POST", "dev/place", { Space: space, X: at.x, Z: at.z });
}

/** The card layer's frame: the page the overworld framed from ?cards. */
const cardFrame = (page: Page): Frame => page.frames().find((frame) => frame.url().startsWith(CARDS))!;

async function cardState(page: Page): Promise<CardLayerState> {
  const json = await cardFrame(page).evaluate(() => (globalThis as { cantripTest?: string }).cantripTest ?? null);
  expect(json, "the card layer's test state").not.toBeNull();
  return JSON.parse(json!) as CardLayerState;
}

/** Waits until the card layer's state holds what `check` asks, and gives it. */
async function cardsUntil(page: Page, check: (state: CardLayerState) => boolean, what: string, timeout = 30_000): Promise<CardLayerState> {
  let last: CardLayerState | undefined;
  await expect
    .poll(async () => {
      last = await cardState(page).catch(() => undefined);
      return last !== undefined && check(last);
    }, { message: what, timeout })
    .toBe(true);
  return last!;
}

/** A card layer control by what it says, once it is there and can be used. */
async function control(page: Page, label: string | RegExp): Promise<Control> {
  const matches = (c: Control) => (typeof label === "string" ? c.label === label : label.test(c.label)) && c.enabled;
  const state = await cardsUntil(page, (s) => s.controls.some(matches), `the card layer's ${String(label)}`);
  return state.controls.find(matches)!;
}

async function clickControl(page: Page, label: string | RegExp): Promise<void> {
  const found = await control(page, label);
  await page.mouse.click(found.x, found.y);
}

/** A card in view on a row of the card layer, by name. */
async function card(page: Page, row: string, name: string): Promise<Card> {
  const state = await cardsUntil(page, (s) => s.cards.some((c) => c.row === row && c.name === name && c.visible), `${name} in the ${row}`);
  return state.cards.find((c) => c.row === row && c.name === name && c.visible)!;
}

/**
 * Double-clicks a card of a row: the deck editor's "to or from the ante" (and a search result's "into the deck"). A card
 * of the deck's columns is clicked on its top edge, the part of it no card below it in the column covers.
 */
async function doubleClick(page: Page, row: string, name: string): Promise<void> {
  const at = await card(page, row, name);
  await page.mouse.dblclick(at.x, row === "pool" ? at.y - at.h / 2 + 6 : at.y);
}

/** Waits for the realm server's word on the deck as it stands now. */
const judged = (page: Page, check: (state: CardLayerState) => boolean = () => true, what = "the realm's check of the deck") =>
  cardsUntil(page, (s) => s.deckEditor?.checked === true && check(s), what);

/** Types into the search, its box clicked first and what it held cleared. */
async function search(page: Page, words: string): Promise<void> {
  const box = await control(page, /^Search your cards/);
  await page.mouse.click(box.x, box.y);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  if (words.length > 0) await page.keyboard.type(words);
}

const copies = (list: readonly string[], name: string): number => {
  const line = list.find((entry) => entry.endsWith(` ${name}`));
  return line ? Number(line.split(" ")[0]) : 0;
};

/** The overworld up with the real card layer behind it, and a thing in the place the character stands clicked. */
async function openAndClick(page: Page, kind: string): Promise<void> {
  await page.goto(query());
  await waitReady(page);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);
  const thing = await entity(page, (e) => e.kind === kind, kind, 30);
  await page.mouse.click(thing.x, thing.y);
}

test("the spell table builds a deck from the collection, refuses what the realm refuses, and the duel deals what it saved", async ({ page }) => {
  test.setTimeout(480_000);
  // A white character owning five Benalish Heroes and a Goblin King, beside the spell table of New Benalia's inn.
  await character(page.request, id(51), "Wren", { "Benalish Hero": 5, "Goblin King": 1 }, "new-benalia-inn", { x: 2, z: 5 });
  const prices = (await api<Collection>(page.request, "collection")).Prices;
  const starter = await api<Deck>(page.request, "deck");
  await openAndClick(page, "spell-table");
  const opened = await judged(page, (s) => s.realm?.screen === "spell-table" && s.realm.table !== undefined);
  expect(opened.deckEditor!.problems).toEqual([]);
  expect(opened.realm!.table!.ante).toMatch(/^Ante: none/);

  // Copies: the search counts what is left, and stops at what is owned; the realm refuses a fifth copy in a deck.
  await search(page, "Benalish Hero");
  const inStarter = starter.Main.find((c) => c.Name === "Benalish Hero")?.Count ?? 0;
  for (let n = inStarter; n < 5; n++) {
    await doubleClick(page, "search", "Benalish Hero");
    await cardsUntil(page, (s) => copies(s.deckEditor!.main, "Benalish Hero") === n + 1, `${n + 1} Benalish Heroes in the deck`);
  }
  let state = await judged(page, (s) => s.realm!.table!.notes["Benalish Hero"]?.startsWith("0 of 5 left") ?? false, "none left");
  await doubleClick(page, "search", "Benalish Hero");
  state = await judged(page, (s) => s.deckEditor!.problems.length > 0, "the copies refused");
  expect(copies(state.deckEditor!.main, "Benalish Hero")).toBe(5);
  expect(state.deckEditor!.problems).toContain("Benalish Hero: 5 copies, more than the 4 a deck may have.");
  expect(state.deckEditor!.status).toMatch(/^Not legal in the realm/);

  // Save is refused by the server, which says why; the deck it keeps is still the starter.
  const refused = page.waitForResponse((r) => r.url().endsWith("/api/deck") && r.request().method() === "PUT");
  await clickControl(page, "Save");
  expect((await refused).status()).toBe(422);
  await cardsUntil(page, (s) => /Benalish Hero: 5 copies/.test(s.deckEditor!.status), "the refusal shown");
  expect(await api<Deck>(page.request, "deck")).toEqual(starter);

  // The fifth goes to the ante with a double-click: legal again, and the ante's worth is the server's.
  await doubleClick(page, "pool", "Benalish Hero");
  state = await judged(page, (s) => s.deckEditor!.side.length === 1 && s.deckEditor!.problems.length === 0, "a Benalish Hero anted");
  expect(state.deckEditor!.side).toEqual(["1 Benalish Hero"]);
  expect(state.realm!.table!.anteValue).toBe(prices["Benalish Hero"]);

  // Color identity: a red card is shown for the ante only; dragged into the deck it is refused, and double-clicked out of
  // the deck it goes to the ante, where it may be.
  await search(page, "Goblin King");
  state = await cardsUntil(page, (s) => s.realm!.table!.notes["Goblin King"] !== undefined, "the Goblin King in the search");
  expect(state.realm!.table!.notes["Goblin King"]).toMatch(/^1 of 1 left · ante only/);
  const king = await card(page, "search", "Goblin King");
  const hero = await card(page, "pool", "Benalish Hero");
  await page.mouse.move(king.x, king.y);
  await page.mouse.down();
  await page.mouse.move((king.x + hero.x) / 2, (king.y + hero.y) / 2, { steps: 8 });
  await page.mouse.move(hero.x, hero.y - hero.h / 2 + 6, { steps: 8 });
  await page.mouse.up();
  state = await judged(page, (s) => copies(s.deckEditor!.main, "Goblin King") === 1 && s.deckEditor!.problems.length > 0, "the Goblin King in the deck, refused");
  expect(state.deckEditor!.problems).toEqual(["Goblin King is outside the color identity W."]);
  await doubleClick(page, "pool", "Goblin King");
  state = await judged(page, (s) => copies(s.deckEditor!.side, "Goblin King") === 1 && s.deckEditor!.problems.length === 0, "the Goblin King anted");

  // Forty cards at least: the free Plains taken out one at a time below it are refused, and one put back is legal.
  const total = (s: CardLayerState) => s.deckEditor!.main.reduce((sum, line) => sum + Number(line.split(" ")[0]), 0);
  for (let n = total(state); n > 39; n--) await clickControl(page, "Remove Plains");
  state = await judged(page, (s) => total(s) === 39 && s.deckEditor!.problems.length > 0, "39 cards, refused");
  expect(state.deckEditor!.problems).toEqual(["A deck is at least 40 cards: this one is 39."]);
  await clickControl(page, "Add Plains");
  state = await judged(page, (s) => total(s) === 40 && s.deckEditor!.problems.length === 0, "40 cards, legal");
  const anteValue = prices["Benalish Hero"]! + prices["Goblin King"]!;
  expect(state.realm!.table!.anteValue).toBe(anteValue);
  expect(state.realm!.table!.ante).toMatch(/^Ante: 2 of 10 cards, worth /);

  // Saved: the server keeps the deck and the ante as the table shows them.
  await clickControl(page, "Save");
  state = await cardsUntil(page, (s) => s.deckEditor!.unsaved === false && /^Saved/.test(s.deckEditor!.status), "saved");
  const saved = await api<Deck>(page.request, "deck");
  const shown = (list: readonly string[]) => [...list].sort();
  expect(shown(saved.Main.map((c) => `${c.Count} ${c.Name}`))).toEqual(shown(state.deckEditor!.main));
  expect(saved.Main.find((c) => c.Name === "Benalish Hero")?.Count).toBe(4);
  expect(saved.Ante).toEqual([{ Name: "Benalish Hero", Count: 1 }, { Name: "Goblin King", Count: 1 }]);
  expect(saved.AnteValue).toBe(anteValue);

  // Done: back in the inn, with the ante's worth on the HUD.
  await clickControl(page, "Done");
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe(null);
  await expect.poll(() => page.locator("[data-test='hud:ante']").textContent()).toBe(anteValue.toLocaleString("en-US"));

  // The duel that follows deals that deck: by a spawn of the wilds, the mob clicked, the encounter the server starts
  // holds the saved deck card for card, the ante's worth and the prize cap; and the card layer deals it.
  const spawn = spawnNear("new-benalia");
  const start = openNear(spawn, 6);
  await call(page.request, "POST", "dev/place", { Space: "world", X: start.x, Z: start.z });
  await page.goto(query());
  await waitReady(page);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);
  const started = page.waitForResponse((r) => r.url().endsWith("/api/encounter/start"), { timeout: 60_000 });
  const mob = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob", 30);
  await page.mouse.click(mob.x, mob.y);
  const encounter = (await (await started).json()) as { Duel: { AnteValue: number; Cap: number; Mob: { Prize: number }; Seats: { Deck: string[] }[] } };
  const dealt = [...encounter.Duel.Seats[0]!.Deck].sort();
  const deck = saved.Main.flatMap((c) => Array<string>(c.Count).fill(c.Name)).sort();
  expect(dealt).toEqual(deck);
  expect(encounter.Duel.AnteValue).toBe(anteValue);
  expect(encounter.Duel.Cap).toBe(Math.min(anteValue, encounter.Duel.Mob.Prize));
  // The encounter's splash says the same ante and cap; Fight deals the duel.
  const gold = (n: number) => `${n.toLocaleString("en-US")} gold`;
  const splash = await cardsUntil(page, (s) => s.realm?.screen === "duel" && /prize cap/.test(s.realm.facts), "the encounter's splash", 60_000);
  expect(splash.realm!.facts).toContain(`ante ${gold(anteValue)}  ·  prize cap ${gold(encounter.Duel.Cap)}`);
  await clickControl(page, "Fight");
  await cardsUntil(page, (s) => s.ready && s.realm?.duel?.mob === mob.name && s.prompt.length > 0, "the duel dealt in the card layer", 120_000);
});

test("a vendor sells at list price and buys at half from its purse, and the spell table has the card at once", async ({ page }) => {
  test.setTimeout(420_000);
  // A white character inside Grizzlegom's goblin shop in New Benalia, at its door.
  const shop = "argive-goblin-trader-shop";
  await character(page.request, id(52), "Odo", {}, shop, { x: 5, z: 6 });
  await openAndClick(page, "vendor");
  await cardsUntil(page, (s) => s.realm?.screen === "vendor" && s.cards.some((c) => c.row === "stock"), "the vendor's shelves", 60_000);
  const before = await api<Vendor>(page.request, "vendor/argive-goblin-trader");
  expect(before.Buying).toEqual([]);
  const header = await cardState(page);
  expect(header.realm!.facts).toContain(`their purse ${before.Purse.toLocaleString("en-US")} gold`);

  // Bought: the cheapest card on the shelf, clicked and then Buy: its list price leaves the character's gold for the
  // vendor's purse, and the card is in the collection.
  const cheapest = [...before.Stock].sort((a, b) => a.Gold - b.Gold || a.Name.localeCompare(b.Name))[0]!;
  await page.mouse.click(...xy(await card(page, "stock", cheapest.Name)));
  await clickControl(page, "Buy");
  await cardsUntil(page, (s) => s.realm!.status.startsWith(`You bought ${cheapest.Name}`), "bought");
  const bought = await api<Vendor>(page.request, "vendor/argive-goblin-trader");
  expect(bought.Gold).toBe(before.Gold - cheapest.Gold);
  expect(bought.Purse).toBe(before.Purse + cheapest.Gold);
  expect((await api<Collection>(page.request, "collection")).Cards[cheapest.Name]).toBe(1);
  expect(bought.Buying).toEqual([{ Name: cheapest.Name, Gold: Math.floor(cheapest.Gold / 2), Owned: 1, Spare: 1 }]);

  // Sold back: half the list price from the purse, and it is on the shelf at full price for anyone.
  await card(page, "buying", cheapest.Name);
  await page.mouse.click(...xy(await card(page, "buying", cheapest.Name)));
  await clickControl(page, "Sell");
  await cardsUntil(page, (s) => s.realm!.status.startsWith(`You sold ${cheapest.Name}`), "sold");
  const sold = await api<Vendor>(page.request, "vendor/argive-goblin-trader");
  const half = Math.floor(cheapest.Gold / 2);
  expect(sold.Gold).toBe(bought.Gold + half);
  expect(sold.Purse).toBe(bought.Purse - half);
  expect(sold.Stock.some((s) => s.Name === cheapest.Name && s.Gold === cheapest.Gold)).toBe(true);
  expect((await api<Collection>(page.request, "collection")).Cards[cheapest.Name]).toBeUndefined();

  // Bought again, and the screen closed: at the spell table the card is there, a goblin of red for the ante only.
  await page.mouse.click(...xy(await card(page, "stock", cheapest.Name)));
  await clickControl(page, "Buy");
  await cardsUntil(page, (s) => s.realm!.status.startsWith(`You bought ${cheapest.Name}`), "bought again");
  await clickControl(page, "Done");
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe(null);
  await call(page.request, "POST", "dev/place", { Space: "new-benalia-inn", X: 2, Z: 5 });
  await openAndClick(page, "spell-table");
  await judged(page, (s) => s.realm?.screen === "spell-table");
  await search(page, cheapest.Name);
  const note = (await cardsUntil(page, (s) => s.realm!.table!.notes[cheapest.Name] !== undefined, "the bought card at the table")).realm!.table!.notes[cheapest.Name]!;
  expect(note).toMatch(/^1 of 1 left/);
});

const xy = (box: Box): [number, number] => [box.x, box.y];
