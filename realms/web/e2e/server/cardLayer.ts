import { type Frame, type Page, expect } from "@playwright/test";

// The real card layer as the suites against the server drive it: the web client's ?realm page, framed over the world from
// its own origin (cards.mjs), which publishes cantripTest (docs/web-client.md) in its frame - every card and control
// with its place on the page, the frame filling the page - and is clicked there with real mouse clicks.

export const CARDS = process.env.REALMS_E2E_CARDS!;

export interface CardControl {
  readonly kind: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export interface CardOnTable {
  readonly name: string;
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
}

export interface CardLayerState {
  readonly ready: boolean;
  readonly busy: boolean;
  readonly over: boolean;
  readonly phase: string;
  readonly prompt: string;
  readonly title: string;
  readonly dock: readonly { readonly label: string; readonly enabled: boolean }[];
  readonly controls: readonly CardControl[];
  readonly cards: readonly CardOnTable[];
  readonly realm?: {
    readonly screen: string;
    readonly loading: string;
    readonly title: string;
    readonly body: string;
    readonly facts: string;
    readonly status: string;
    readonly duel?: {
      readonly mob: string;
      readonly log: number;
      readonly over: boolean;
      readonly won: boolean;
      readonly ended: boolean;
      readonly end: string;
      readonly game: number;
      readonly mobLife: number;
      readonly playerLife: number;
    };
    /** The spell table, or a rematch's sideboarding: the deck's count and the sideboard's. */
    readonly table?: { readonly sideboarding: boolean; readonly sideboard: string; readonly main: number; readonly side: number };
    /** The duel's gear strip: each seat's gear emblems in the game, and whether the panel of their cards is open. */
    readonly duelGear?: { readonly line: string; readonly open: boolean; readonly emblems: readonly string[]; readonly mobEmblems: readonly string[] };
  };
}

/** The card layer's frame: the page the overworld framed from ?cards. */
export const cardFrame = (page: Page, cards = CARDS): Frame => page.frames().find((frame) => frame.url().startsWith(cards))!;

/** What the card layer publishes on cantripTest, read in its frame. */
export async function cardState(page: Page, cards = CARDS): Promise<CardLayerState | null> {
  const frame = cardFrame(page, cards);
  if (!frame) return null;
  const json = await frame.evaluate(() => (globalThis as { cantripTest?: string }).cantripTest ?? null);
  return json === null ? null : (JSON.parse(json) as CardLayerState);
}

/** Clicks a card layer control by what it says - the lowest of those that say it - where it is on the page: the frame fills it. */
export async function clickCardControl(page: Page, label: string | RegExp, cards = CARDS): Promise<void> {
  let found: CardControl | undefined;
  const says = (c: CardControl) => (typeof label === "string" ? c.label === label : label.test(c.label));
  await expect
    .poll(async () => {
      const state = await cardState(page, cards);
      found = state?.controls.filter(says).sort((a, b) => b.y - a.y)[0];
      return found !== undefined;
    }, { message: `the card layer's ${label}`, timeout: 60_000 })
    .toBe(true);
  await page.mouse.click(found!.x, found!.y);
}

/** Clicks a card on the card layer's page by name: the first shown that is named so. */
export async function clickCard(page: Page, name: string, cards = CARDS): Promise<void> {
  let found: CardOnTable | undefined;
  await expect
    .poll(async () => {
      found = (await cardState(page, cards))?.cards.find((c) => c.name === name && c.visible);
      return found !== undefined;
    }, { message: `the card ${name}` })
    .toBe(true);
  await page.mouse.click(found!.x, found!.y);
}
