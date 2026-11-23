import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { type Tile, dungeon, openWorld, realm } from "../realm";

// What the suites against the real realm server share (playwright.config.ts here): the server's address, the page's
// query, the development sign-in, the API as the server answers it, and the development calls a test arranges with
// (POST /dev/place, /dev/verdict: a server started with REALMS_DEV_SIGNIN=1 alone, for development and tests).

export const SERVER = process.env.REALMS_E2E_SERVER!;

/** The page's query: the real server, the stand-in card layer, the test hooks, and nothing left to chance. */
export const query = (extra = "") => `/?server=${encodeURIComponent(SERVER)}&cards=stub&test&manual&wander=0&encounters=never${extra}`;

/** Signs a player in on the server by the development sign-in: the cookie goes to the page's browser context. */
export async function signIn(request: APIRequestContext, id: number, name: string): Promise<void> {
  const response = await request.post(new URL("dev/signin", SERVER).toString(), { data: { Id: id, Name: name } });
  expect(response.ok(), await response.text()).toBe(true);
}

/** A call to the server's API on the signed-in cookie: what the server says, not what the page shows. */
export async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(new URL(`api/${path}`, SERVER).toString());
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

async function post(request: APIRequestContext, path: string, data: unknown): Promise<void> {
  const response = await request.post(new URL(path, SERVER).toString(), { data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
}

/** Signs a player in and makes their character through the API: it begins outside New Benalia's inn. */
export async function character(request: APIRequestContext, id: number, name: string, color = "W"): Promise<void> {
  await signIn(request, id, name);
  await post(request, "api/character", { Name: name, Body: "tall", Palette: 1, Color: color });
}

/** Puts the signed-in character on a tile of the world (or an interior) at once: a test's start, test-only (POST /dev/place). */
export const place = (request: APIRequestContext, at: Tile, space = "world") => post(request, "dev/place", { Space: space, X: at.x, Z: at.z });

/** Has the server judge the signed-in player's duels as said, a stand-in win counting (POST /dev/verdict); null replays them. */
export const verdict = (request: APIRequestContext, outcome: "won" | "lost" | null) => post(request, "dev/verdict", { Outcome: outcome });

/** The server's order of the eight steps (Tile.Steps): south, east, west, north, then the diagonals. */
const STEPS = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;

/** The tile beside a dungeon's way in where leaving it puts a character: its first open neighbour in the server's order. */
export function besideEntrance(id: string): Tile {
  const [x, z] = dungeon(id).entrance;
  return STEPS.map(([dx, dz]) => ({ x: x + dx, z: z + dz })).find(openWorld)!;
}

export interface Me {
  readonly Id: string;
  readonly Name: string;
  readonly Body: string;
  readonly Identity: string;
  readonly Space: string;
  readonly X: number;
  readonly Z: number;
  readonly AnteValue: number;
  readonly Attuned: readonly string[];
  readonly Loadout: Record<string, { readonly InstanceId: number } | null>;
}

/** What the stand-in card layer has been asked for, in order. */
export const requests = (page: Page) => realm<{ screen: string; args: Record<string, any> }[]>(page, "layer.requests");
