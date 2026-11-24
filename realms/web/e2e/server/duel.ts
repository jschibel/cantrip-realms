import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { interior } from "../realm";
import { SERVER, api } from "./server";
import { CARDS, type CardLayerState, cardState, clickCardControl } from "./cardLayer";

// A duel as the suites against the server play it in the real card layer: a position forced as a scenario forces one,
// never a seed - the server deals the next duel with a seat's setup changed (POST /dev/duel, test-only), and the game
// that follows is the engine's, replayed and judged on the native host like any other.

/** A seat's setup to deal the next duels with (POST /dev/duel); unnamed values are the seat's own. */
export interface ForcedSeat {
  readonly StartingLife?: number;
  readonly StartingHandSize?: number;
  readonly MaximumHandSize?: number;
  readonly Deck?: readonly string[];
  readonly Emblems?: readonly string[];
}

/** Has the server deal the signed-in player's next duels with these seats' setup; nulls for both deal them as they are. */
export async function forceDuel(request: APIRequestContext, duel: { Player?: ForcedSeat | null; Mob?: ForcedSeat | null }): Promise<void> {
  const response = await request.post(new URL("dev/duel", SERVER).toString(), { data: { Player: duel.Player ?? null, Mob: duel.Mob ?? null } });
  expect(response.ok(), await response.text()).toBe(true);
}

interface Deck {
  readonly Main: readonly { Name: string; Count: number }[];
  readonly Ante: readonly { Name: string; Count: number }[];
  readonly AnteValue: number;
}

/**
 * Puts `count` cards of the collection that are not in the deck into the ante, through the API at New Benalia's
 * guildhall's spell table (a deck is saved only at one), where the test puts the character: the ante's cards.
 */
export async function setAnte(request: APIRequestContext, count = 2): Promise<{ names: string[]; value: number }> {
  const hall = interior("new-benalia-guildhall");
  const table = hall.npcs.find((n) => n.kind === "spell-table")!;
  let placed = false;
  for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const response = await request.post(new URL("dev/place", SERVER).toString(), { data: { Space: hall.id, X: table.x + dx, Z: table.z + dz } });
    if (response.ok()) {
      placed = true;
      break;
    }
  }
  expect(placed, "a tile beside the guildhall's spell table").toBe(true);
  const deck = await api<Deck>(request, "deck");
  const collection = await api<{ Cards: Record<string, number> }>(request, "collection");
  const inDeck = new Set(deck.Main.map((c) => c.Name));
  const names = Object.entries(collection.Cards).filter(([name, n]) => n > 0 && !inDeck.has(name)).map(([name]) => name).sort().slice(0, count);
  expect(names.length, "cards of the collection outside the deck").toBe(count);
  const saved = await request.put(new URL("api/deck", SERVER).toString(), { data: { Main: deck.Main, Ante: names.map((Name) => ({ Name, Count: 1 })) } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return { names, value: ((await saved.json()) as Deck).AnteValue };
}

/** The answers a duel's opening asks of the player, which a forced position decides nothing by: keep, and go first. */
const OPENING = ["Keep 7", "Keep", "Play First"];

/**
 * Plays the duel open in the card layer until the game is over and its end is said: past the splash (Fight), then
 * answering the opening's questions as a player would, with real clicks. The forced position decides the game.
 */
export async function playDuel(page: Page, cards = CARDS): Promise<CardLayerState> {
  await clickCardControl(page, "Fight", cards);
  let state: CardLayerState | null = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    state = await cardState(page, cards);
    if (state?.realm?.duel?.ended) return state;
    // Clicked where this reading of the page has it, never waited for: once answered, the next reading moves on.
    const opening = state?.dock.find((d) => d.enabled && OPENING.includes(d.label));
    const control = opening && !state?.busy ? state?.controls.filter((c) => c.label === opening.label).sort((a, b) => b.y - a.y)[0] : undefined;
    if (control) {
      await page.mouse.click(control.x, control.y);
      await page.waitForTimeout(750);
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`the duel never ended: ${JSON.stringify({ prompt: state?.prompt, title: state?.title, dock: state?.dock, realm: state?.realm })}`);
}
