import { type APIRequestContext, type Frame, type Page, expect, test } from "@playwright/test";
import { spawnNear } from "../places";
import { entity, openNear, realm, until, waitReady } from "../realm";
import { SERVER, api, character, find, place, verdict } from "./server";

// Gear end to end (design.md A4, A3, A5) against the real realm server, with the real card layer framed over the world
// (playwright.config.ts here): the paper doll's equipping by click and by drag, saved on the server; the armorer's
// stock bought and sold; the inventory's cards and gear; a gear drop on the loot screen, from a won duel and from a
// chest; and worn gear's emblems in a real duel's command zone. Every action is a real mouse click (or drag) at the
// place the card layer publishes on cantripTest. What drops is decided by the development server's /dev/drop, never by
// sweeping seeds; a win is the development verdict (the duel itself is conceded).

const CARDS = process.env.REALMS_E2E_CARDS!;
const SHOTS = "e2e/screenshots/gear";

const query = () => `/?server=${encodeURIComponent(SERVER)}&cards=${encodeURIComponent(`${CARDS}?test`)}&test&wander=0&encounters=never`;

interface Spot {
  readonly name: string;
  readonly place: string;
  readonly instance: number;
  readonly selected: boolean;
  readonly x: number;
  readonly y: number;
}

interface CardState {
  readonly ready: boolean;
  readonly prompt: string;
  readonly controls: readonly { readonly kind: string; readonly label: string; readonly x: number; readonly y: number; readonly enabled: boolean }[];
  readonly realm?: {
    readonly screen: string;
    readonly status: string;
    readonly gear: readonly Spot[];
    readonly inventory?: { readonly tab: string; readonly sort: string; readonly cards: readonly { name: string; count: number; gold: number; deck: number; sideboard: number }[] };
    readonly duel?: { readonly mob: string };
    readonly duelGear?: { readonly line: string; readonly open: boolean; readonly emblems: readonly string[]; readonly life: number; readonly cards: readonly { seat: string; name: string }[] };
  };
}

interface Gear {
  readonly Id: string;
  readonly Name: string;
  readonly Slot: string;
  readonly Stats: { readonly Life: number; readonly Hand: number; readonly MaxHand: number };
}
interface Owned {
  readonly InstanceId: number;
  readonly Gear: Gear;
}
interface Me {
  readonly Gold: number;
  readonly Stats: { readonly Life: number; readonly Hand: number; readonly MaxHand: number };
  readonly Loadout: Record<string, Owned | null>;
  readonly Gear: readonly Owned[];
}

const cardFrame = (page: Page): Frame => page.frames().find((frame) => frame.url().startsWith(CARDS))!;

async function cardState(page: Page): Promise<CardState | null> {
  const json = await cardFrame(page).evaluate(() => (globalThis as { cantripTest?: string }).cantripTest ?? null);
  return json === null ? null : (JSON.parse(json) as CardState);
}

/** Waits for the card layer to show what `check` asks, and gives back that state. */
async function cardUntil(page: Page, check: (state: CardState) => boolean, what: string, timeout = 30_000): Promise<CardState> {
  let seen: CardState | null = null;
  await expect.poll(async () => ((seen = await cardState(page)) !== null && check(seen)), { timeout, message: what }).toBe(true);
  return seen!;
}

/** A gear spot of the card layer (a slot, a row, a card), once it is there. */
async function spot(page: Page, match: (s: Spot) => boolean, what: string): Promise<Spot> {
  const state = await cardUntil(page, (s) => (s.realm?.gear ?? []).some(match), what);
  return state.realm!.gear.find(match)!;
}

async function clickSpot(page: Page, match: (s: Spot) => boolean, what: string): Promise<void> {
  const found = await spot(page, match, what);
  await page.mouse.click(found.x, found.y);
}

/** Clicks a card layer control by what it says (or begins with), the lowest of those. */
async function clickCardControl(page: Page, label: string | RegExp): Promise<void> {
  const matches = (l: string) => (typeof label === "string" ? l === label : label.test(l));
  const state = await cardUntil(page, (s) => s.controls.some((c) => matches(c.label)), `the card layer's ${label}`);
  const found = state.controls.filter((c) => matches(c.label)).sort((a, b) => b.y - a.y)[0]!;
  await page.mouse.click(found.x, found.y);
}

async function give(request: APIRequestContext, id: string): Promise<Owned> {
  const response = await request.post(new URL("dev/gear", SERVER).toString(), { data: { GearId: id } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Owned;
}

async function drop(request: APIRequestContext, gear: boolean | null): Promise<void> {
  const response = await request.post(new URL("dev/drop", SERVER).toString(), { data: { Gear: gear } });
  expect(response.ok(), await response.text()).toBe(true);
}

async function open(page: Page): Promise<void> {
  await page.goto(query());
  await waitReady(page);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);
}

test("the gear screen equips by click and by drag, and the server keeps the loadout", async ({ page }) => {
  test.setTimeout(300_000);
  await character(page.request, 41, "Gearwen", "U");
  const ring = await give(page.request, "ring-of-thorns");
  const circlet = await give(page.request, "tolarian-circlet");
  await open(page);

  await page.click("[data-test='hud:gear']");
  await cardUntil(page, (s) => s.realm?.screen === "gear" && s.realm.gear.some((g) => g.place === "worn:head"), "the gear screen");
  // Eight slots, every one drawn, and every item owned in the list.
  const opened = await cardState(page);
  expect(opened!.realm!.gear.filter((g) => g.place.startsWith("worn:")).map((g) => g.place)).toEqual(
    ["head", "neck", "body", "hands", "ring1", "ring2", "feet", "relic"].map((s) => `worn:${s}`),
  );
  const me0 = await api<Me>(page.request, "me");
  for (const owned of me0.Gear) expect(opened!.realm!.gear.some((g) => g.instance === owned.InstanceId && g.place !== "detail")).toBe(true);
  await page.screenshot({ path: `${SHOTS}/gear-screen.png` });

  // A ring, picked in the list, worn on the left hand by its button.
  await clickSpot(page, (g) => g.instance === ring.InstanceId && g.place === "owned", "the ring's row");
  await cardUntil(page, (s) => s.realm!.gear.some((g) => g.place.startsWith("detail") && g.name === "Ring of Thorns"), "the ring's card");
  await clickCardControl(page, "Wear on the left hand");
  await spot(page, (g) => g.place === "worn:ring2" && g.instance === ring.InstanceId, "the ring on the left hand");
  expect((await api<Me>(page.request, "me")).Loadout.ring2?.InstanceId).toBe(ring.InstanceId);

  // The circlet dragged onto the head: worn in place of the helm, the maximum hand up by its two.
  const row = await spot(page, (g) => g.instance === circlet.InstanceId && g.place === "owned", "the circlet's row");
  const head = await spot(page, (g) => g.place === "worn:head", "the head slot");
  await page.mouse.move(row.x, row.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(row.x + ((head.x - row.x) * i) / 10, row.y + ((head.y - row.y) * i) / 10);
  await page.mouse.up();
  await spot(page, (g) => g.place === "worn:head" && g.instance === circlet.InstanceId, "the circlet on the head");
  const me1 = await api<Me>(page.request, "me");
  expect(me1.Loadout.head?.InstanceId).toBe(circlet.InstanceId);
  expect(me1.Stats.MaxHand).toBe(me0.Stats.MaxHand - (me0.Loadout.head?.Gear.Stats.MaxHand ?? 0) + 2);
  await page.screenshot({ path: `${SHOTS}/gear-dragged.png` });

  // The ring dragged off the doll back to the list: taken off.
  const worn = await spot(page, (g) => g.place === "worn:ring2", "the left hand");
  const list = await spot(page, (g) => g.place === "owned" || g.place.startsWith("wearing:"), "a row of the list");
  await page.mouse.move(worn.x, worn.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(worn.x + ((list.x - worn.x) * i) / 10, worn.y + ((list.y - worn.y) * i) / 10);
  await page.mouse.up();
  await spot(page, (g) => g.place === "worn:ring2" && g.instance === 0, "the left hand empty");
  expect((await api<Me>(page.request, "me")).Loadout.ring2 ?? null).toBe(null);

  // Closed: the world's figure and HUD take the loadout up.
  await clickCardControl(page, "Done");
  await expect.poll(() => realm<string | null>(page, "layer.open")).toBe(null);
});

test("the armorer sells gear as item cards, buys it back at half, and never what is worn", async ({ page }) => {
  test.setTimeout(300_000);
  await character(page.request, 42, "Smithson", "W");
  const room = "new-benalia-smithy";
  await place(page.request, { x: 8, z: 5 }, room);
  await open(page);

  const armorer = await entity(page, (e) => e.kind === "armorer", "the armorer", 30);
  await page.mouse.click(armorer.x, armorer.y);
  const shop = await cardUntil(page, (s) => s.realm?.screen === "gear" && s.realm.gear.some((g) => g.place === "stock"), "the armorer's stock", 90_000);
  const stock = await api<{ Stock: readonly (Gear & { Gold: number })[] }>(page.request, "armorer/new-benalia");
  expect(shop.realm!.gear.filter((g) => g.place === "stock").map((g) => g.name).sort()).toEqual(stock.Stock.map((g) => g.Name).sort());
  await page.screenshot({ path: `${SHOTS}/armorer.png` });

  const before = await api<Me>(page.request, "me");
  const item = stock.Stock.filter((g) => g.Gold <= before.Gold).sort((a, b) => a.Gold - b.Gold)[0]!;
  // Its slot's filter keeps the list short enough to see it whole.
  await clickCardControl(page, `${item.Slot === "ring" ? "Rings" : item.Slot[0]!.toUpperCase() + item.Slot.slice(1)} gear`);
  const kind = stock.Stock.filter((g) => g.Slot === item.Slot).map((g) => g.Name).sort();
  await cardUntil(page, (s) => JSON.stringify(s.realm!.gear.filter((g) => g.place === "stock").map((g) => g.name).sort()) === JSON.stringify(kind), "the stock of its slot");
  await clickSpot(page, (g) => g.place === "stock" && g.name === item.Name, "the cheapest item for sale");
  await cardUntil(page, (s) => s.realm!.gear.some((g) => g.place === "stock" && g.name === item.Name && g.selected), "the item picked");
  await clickCardControl(page, /^Buy for /);
  await cardUntil(page, (s) => /You bought/.test(s.realm!.status), "bought");
  const bought = await api<Me>(page.request, "me");
  expect(bought.Gold).toBe(before.Gold - item.Gold);
  const mine = bought.Gear.find((g) => !before.Gear.some((b) => b.InstanceId === g.InstanceId))!;
  expect(mine.Gear.Id).toBe(item.Id);
  await page.screenshot({ path: `${SHOTS}/armorer-bought.png` });

  // What was bought is picked, as the same card; sold back at half.
  await cardUntil(page, (s) => s.realm!.gear.some((g) => g.place === "detail:owned" && g.instance === mine.InstanceId), "the bought item's card");
  await clickCardControl(page, /^Sell for /);
  await cardUntil(page, (s) => /You sold/.test(s.realm!.status), "sold");
  const sold = await api<Me>(page.request, "me");
  expect(sold.Gold).toBe(bought.Gold + Math.floor(item.Gold / 2));
  expect(sold.Gear.some((g) => g.InstanceId === mine.InstanceId)).toBe(false);

  // A worn item has no sell button.
  const wornHead = sold.Loadout.head!;
  await clickSpot(page, (g) => g.place === "worn:head", "the head slot");
  await cardUntil(page, (s) => s.realm!.gear.some((g) => g.place === "detail:worn:head" && g.instance === wornHead.InstanceId), "the worn helm's card");
  const state = await cardState(page);
  expect(state!.controls.some((c) => c.label.startsWith("Sell for"))).toBe(false);
  expect(state!.controls.some((c) => c.label === "Take off")).toBe(true);
});

test("the inventory shows every card with its count, price and use, searched and sorted, and the gear", async ({ page }) => {
  test.setTimeout(300_000);
  await character(page.request, 43, "Hoarder", "G");
  await open(page);
  const inventory = await api<{ Cards: readonly { Name: string; Count: number; Gold: number; Deck: number; Sideboard: number }[]; Value: number }>(page.request, "inventory");

  await page.click("[data-test='hud:inventory']");
  const shown = await cardUntil(page, (s) => s.realm?.screen === "inventory" && (s.realm.inventory?.cards.length ?? 0) > 0, "the inventory", 90_000);
  expect(shown.realm!.inventory!.cards.map((c) => c.name)).toEqual(inventory.Cards.map((c) => c.Name));
  for (const card of shown.realm!.inventory!.cards) {
    const server = inventory.Cards.find((c) => c.Name === card.name)!;
    expect([card.count, card.gold, card.deck, card.sideboard]).toEqual([server.Count, server.Gold, server.Deck, server.Sideboard]);
  }
  await page.screenshot({ path: `${SHOTS}/inventory.png` });

  // Sorted by price, dearest first.
  await clickCardControl(page, "Sort by price");
  const byPrice = await cardUntil(page, (s) => s.realm!.inventory!.sort === "price", "sorted by price");
  const golds = byPrice.realm!.inventory!.cards.map((c) => c.gold);
  expect(golds).toEqual([...golds].sort((a, b) => b - a));

  // Searched: typed into the box, a card's name narrows it to the cards that say it.
  const wanted = inventory.Cards[0]!.Name;
  // The box as the screen, laid out again after the sort, has it (read once laid out, never mid-rebuild).
  const box = (await cardUntil(page, (s) => s.controls.some((c) => c.kind === "textbox"), "the search box")).controls.find((c) => c.kind === "textbox")!;
  await page.mouse.click(box.x, box.y);
  await page.keyboard.type(wanted);
  const found = await cardUntil(page, (s) => s.realm!.inventory!.cards.length < inventory.Cards.length && s.realm!.inventory!.cards.some((c) => c.name === wanted), "the search");
  expect(found.realm!.inventory!.cards.length).toBeGreaterThan(0);

  // The gear tab: every item owned.
  await clickCardControl(page, "Gear");
  const me = await api<Me>(page.request, "me");
  await cardUntil(page, (s) => s.realm!.inventory!.tab === "gear" && me.Gear.every((g) => s.realm!.gear.some((r) => r.instance === g.InstanceId)), "the gear tab");
  await page.screenshot({ path: `${SHOTS}/inventory-gear.png` });
});

test("worn gear is in the duel's command zone, and a won duel's gear drop and a chest's are shown as cards", async ({ page }) => {
  test.setTimeout(480_000);
  await character(page.request, 44, "Lootra", "W");
  const ring = await give(page.request, "ring-of-thorns");
  const wear = await page.request.put(new URL("api/loadout", SERVER).toString(), { data: { Slots: { ring1: ring.InstanceId } } });
  expect(wear.ok(), await wear.text()).toBe(true);
  const me = await api<Me>(page.request, "me");

  // By a spawn near New Benalia; every duel counts as won and every gear roll comes up (test-only calls).
  const spawn = spawnNear("new-benalia");
  await place(page.request, openNear(spawn, 6));
  await verdict(page.request, "won");
  await drop(page.request, true);
  await open(page);

  const scout = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await page.mouse.click(scout.x, scout.y);
  // Past the encounter's splash (MainPage.RealmDuel.cs), then the duel dealt: the ring's emblem in the player's command zone, the setup values the loadout's.
  await clickCardControl(page, "Fight");
  const dealt = await cardUntil(page, (s) => (s.realm?.duelGear?.emblems.length ?? 0) > 0 && s.prompt.length > 0, "the duel with its gear", 180_000);
  expect(dealt.realm!.duelGear!.emblems).toEqual(["Ring of Thorns (gear)"]);
  expect(dealt.realm!.duelGear!.life).toBe(me.Stats.Life);
  await clickCardControl(page, "Gear in play");
  await cardUntil(page, (s) => s.realm!.duelGear!.open && s.realm!.duelGear!.cards.some((c) => c.seat === "you" && c.name === "Ring of Thorns"), "the gear panel");
  await page.screenshot({ path: `${SHOTS}/duel-gear.png` });
  await clickCardControl(page, "Close gear");

  // Conceded; the server's verdict is a win, and its gear roll came up: the loot screen shows the item as its card.
  const finished = page.waitForResponse((response) => response.url().endsWith("/api/encounter/finish"), { timeout: 60_000 });
  await clickCardControl(page, "Concede");
  await cardUntil(page, (s) => s.controls.some((c) => c.label === "Play on"), "the concession asked");
  await clickCardControl(page, "Concede");
  const outcome = (await (await finished).json()) as { Outcome: string; Gear: Owned | null };
  expect(outcome.Outcome).toBe("won");
  expect(outcome.Gear).not.toBe(null);
  await cardUntil(page, (s) => s.realm?.screen === "loot" && s.realm.gear.some((g) => g.place === "drop" && g.instance === outcome.Gear!.InstanceId), "the drop on the loot screen", 60_000);
  await page.screenshot({ path: `${SHOTS}/loot-drop.png` });
  expect((await api<Me>(page.request, "me")).Gear.some((g) => g.InstanceId === outcome.Gear!.InstanceId)).toBe(true);
  await clickCardControl(page, /^Take|^Leave them|^Done$/);
  await expect.poll(() => realm<string | null>(page, "layer.open"), { timeout: 30_000 }).toBe(null);

  // A chest stood in the wilds by the capital (POST /dev/find), its gear roll come up: the item on the loot screen as well.
  const tile = openNear(spawnNear("new-benalia"), 6);
  await place(page.request, openNear(tile, 1));
  const chest = await find(page.request, "chest", tile);
  await page.reload();
  await open(page);
  const lid = await entity(page, (e) => e.kind === "chest" && e.id === chest.Id, "the chest", 30);
  const opened = page.waitForResponse((response) => response.url().endsWith("/api/chest/open"), { timeout: 60_000 });
  await page.mouse.click(lid.x, lid.y);
  const found = (await (await opened).json()) as { Found: number; Gear: Owned | null };
  expect(found.Gear).not.toBe(null);
  await cardUntil(page, (s) => s.realm?.screen === "loot" && s.realm.gear.some((g) => g.place === "drop" && g.instance === found.Gear!.InstanceId), "the chest's item on the loot screen", 60_000);
  await page.screenshot({ path: `${SHOTS}/chest-drop.png` });
  await clickCardControl(page, "Wear it now");
  await cardUntil(page, (s) => /You wear/.test(s.realm!.status), "worn from the loot screen");
  const worn = await api<Me>(page.request, "me");
  expect(Object.values(worn.Loadout).some((g) => g?.InstanceId === found.Gear!.InstanceId)).toBe(true);
  await drop(page.request, null);
  await verdict(page.request, null);
});
