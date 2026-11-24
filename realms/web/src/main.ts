import * as THREE from "three";
import "./style.css";
import "./theme.css";
import { CardLayer, type CardScreens, OfflineCardLayer } from "./cardLayer";
import { StubCardLayer } from "./cardStub";
import { BODY_NAMES, type BodyName as Body, type ManaColor } from "./art/figures";
import { Overworld, type Start } from "./game";
import { bindDebug } from "./debug";
import { bindInput } from "./input";
import { ApiError, type Character, HttpApi, type RealmApi } from "./net/api";
import { MockApi } from "./net/mockApi";
import { LocalPresence, type Presence, SocketPresence } from "./net/presence";
import { HEADING_NAMES, type Zoom } from "./render/camera";
import type { WalkInput } from "./render/pointer";
import { createCharacter } from "./screens/create";
import { publishTestHooks } from "./testHooks";
import { type WorldSource, globSource, loadWorld } from "./world/load";
import { DOMINARIA, DUNGEONS, besideEntrance } from "./world/realm";

// The overworld page (tech.md, B5-B6), drawn by the renderer's stage (render/stage.ts) over a version-2 world. Its
// query says where everything comes from:
//   ?server=<url>   the realm server (also VITE_REALM_SERVER); with none, or with ?offline, the API is the in-memory
//                   MockApi and presence goes between this browser's tabs.
//   ?cards=<url>    the card layer to frame (also VITE_CARD_LAYER_URL, else the one the dev server serves when the web
//                   client is built: vite.config.ts); "stub" for the stand-in panels, which the offline suites ask for. It
//                   is told the realm server (its ?api=), which it calls itself. Offline, with no server to call, only its
//                   duel and loot are the card layer's: the screens that trade and save are the stand-in's.
//   ?art=<url>      where the card layer finds card art (also VITE_CARD_ART): a realm server started with REALMS_ART, for
//                   local play (tools/realms/play.cmd); else beside the card layer's page.
//   ?world=slice|large   another version-2 world than Dominaria (realms/content/dominaria, the default): the art
//                   slice's street (fixtures/slice-world) or the renderer's large synthetic one, for tests.
//   ?test           publishes globalThis.realmTest (and sliceTest); ?manual holds the clock until a test advances it;
//                   ?still stands the townsfolk still, ?nohud hides the HUD (pictures).
// and, for development and tests, forces a state rather than waiting on chance:
//   ?at=world:x,z | <town> | <dungeon> | <interior>  start there (a town at its middle, a dungeon outside its entrance); ?heading=left|front|right, ?zoom=0..2;
//   ?now=<unix seconds> pins the spawn clock; ?wander=0 keeps mobs at home, ?mobs=0 leaves them out;
//   ?name=&color=&body=&palette= makes the offline character without the screen; ?attuned=<tower>,... starts the
//   offline character with those mage towers' waystones attuned.

// Colors are given as the palette's own sRGB values and lit as they are; the bands snap the result, so no color
// management is wanted between them.
THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(window.location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;

void boot();

async function worldSource(): Promise<WorldSource> {
  const which = query.get("world");
  if (which === "large") return (await import("../fixtures/large-world/source")).largeSource();
  if (which !== "slice") return DOMINARIA;
  return globSource(
    () => import("../fixtures/slice-world/world.json"),
    import.meta.glob("../fixtures/slice-world/chunks/*.json", { import: "default" }),
    import.meta.glob("../fixtures/slice-world/interiors/*.json", { import: "default" }),
  );
}

async function boot(): Promise<void> {
  const server = query.get("server") ?? (import.meta.env.VITE_REALM_SERVER as string | undefined);
  const offline = query.has("offline") || !server;
  const pinned = query.get("now");
  const now = pinned ? () => Number(pinned) : () => Date.now() / 1000;

  const preset = query.get("name");
  const color = (query.get("color") ?? "W").toUpperCase() as ManaColor;
  const body = (BODY_NAMES as readonly string[]).includes(query.get("body") ?? "") ? (query.get("body") as Body) : "lithe";
  const attuned = (query.get("attuned") ?? "").split(",").filter((t) => DUNGEONS.get(t)?.waystone);
  const api: RealmApi = offline
    ? new MockApi(1, preset ? { name: preset, body, palette: Number(query.get("palette") ?? 0) % 6, color } : undefined, attuned)
    : new HttpApi(new URL(server!, window.location.href).toString());
  if (api instanceof MockApi) api.now = now;

  const served = document.querySelector<HTMLMetaElement>('meta[name="card-layer"]')?.content;
  const cards = query.get("cards") ?? (import.meta.env.VITE_CARD_LAYER_URL as string | undefined) ?? served ?? (offline ? "stub" : "http://localhost:5100/");
  const art = query.get("art") ?? (import.meta.env.VITE_CARD_ART as string | undefined);
  const layer: CardScreens = cards === "stub" ? new StubCardLayer() : offline ? new OfflineCardLayer(new CardLayer(cards, undefined, art), new StubCardLayer()) : new CardLayer(cards, server, art);

  let game: Overworld | null = null;
  let input: WalkInput | null = null;
  if (query.has("test")) publishTestHooks(() => game, layer, () => input);

  const source = await worldSource();
  const world = await loadWorld(source);
  const character = (await signedIn(api, server)) ?? (await createCharacter(api));
  const presence: Presence = offline
    ? new LocalPresence({ Player: Math.floor(Math.random() * 2 ** 31), Name: character.Name, Identity: character.Identity })
    : new SocketPresence(socketUrl(server!));

  const zoom = Number(query.get("zoom") ?? "x");
  game = new Overworld(
    canvas,
    api,
    layer,
    presence,
    {
      wander: query.get("wander") !== "0",
      mobs: query.get("mobs") !== "0",
      now,
      manual: query.has("manual"),
      heading: HEADING_NAMES[query.get("heading") ?? ""],
      zoom: zoom === 0 || zoom === 1 || zoom === 2 ? (zoom as Zoom) : undefined,
      still: query.has("still"),
    },
    source,
    world,
    source === DOMINARIA ? DUNGEONS : new Map(),
  );
  // Another world than Dominaria (a test's): the character's place is Dominaria's, so start at its start town.
  const town = world.towns.find((t) => t.start) ?? world.towns[0];
  const start = (await parseAt(query.get("at"), world.towns, source)) ?? (source !== DOMINARIA && town ? { space: "world", tile: { x: town.center[0], z: town.center[1] } } : undefined);
  if (query.has("nohud")) document.body.classList.add("nohud");
  // The start is the game's to make; input binds to its stage once it stands.
  const started = game.start(character, start);
  await started;
  input = bindInput(game);
  bindDebug(game);
}

/** The character, or null with none yet; a player not signed in is sent to sign in, and comes back here after. */
async function signedIn(api: RealmApi, server: string | undefined): Promise<Character | null> {
  try {
    return await api.me();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401) || !server) throw e;
    window.location.assign(new URL("signin", new URL(server, window.location.href)).toString());
    return new Promise<never>(() => {});
  }
}

function socketUrl(server: string): string {
  const url = new URL("realm/ws", new URL(server, window.location.href));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** `world:x,z`, a town (its middle), a dungeon (outside its entrance), or a room's id (`<interior>`, `<interior>:x,z`). */
async function parseAt(at: string | null, towns: readonly { readonly id: string; readonly center: readonly [number, number] }[], source: WorldSource): Promise<Start | undefined> {
  if (!at) return undefined;
  const [space, where] = at.split(":");
  if (!space) return undefined;
  const [x, z] = (where ?? "").split(",").map(Number);
  const tile = where && Number.isFinite(x) && Number.isFinite(z) ? { x: x!, z: z! } : undefined;
  if (space === "world") return { space: "world", tile };
  const town = towns.find((t) => t.id === space);
  if (town) return { space: "world", tile: { x: town.center[0], z: town.center[1] } };
  const dungeon = source === DOMINARIA ? DUNGEONS.get(space) : undefined;
  if (dungeon) {
    const [dx, dz] = await besideEntrance(dungeon.entrance);
    return { space: "world", tile: { x: dx, z: dz } };
  }
  return { space, tile };
}
