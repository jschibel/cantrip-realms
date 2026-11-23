import * as THREE from "three";
import "./style.css";
import "./theme.css";
import { CardLayer, type CardScreens } from "./cardLayer";
import { StubCardLayer } from "./cardStub";
import { BODIES, type Body, type ManaColor } from "./character";
import { Overworld, type Start } from "./game";
import { bindInput } from "./input";
import { HttpApi, type RealmApi } from "./net/api";
import { MockApi } from "./net/mockApi";
import { LocalPresence, type Presence, SocketPresence } from "./net/presence";
import { HEADING_NAMES, type Zoom } from "./render/camera";
import type { WalkInput } from "./render/pointer";
import { createCharacter } from "./screens/create";
import { publishTestHooks } from "./testHooks";
import { DUNGEONS } from "./world/content";
import { type WorldSource, globSource, loadWorld } from "./world/load";

// The overworld page (tech.md, B5-B6), drawn by the renderer's stage (render/stage.ts) over a version-2 world. Its
// query says where everything comes from:
//   ?server=<url>   the realm server (also VITE_REALM_SERVER); with none, or with ?offline, the API is the in-memory
//                   MockApi and presence goes between this browser's tabs.
//   ?cards=<url>    the card layer to frame (also VITE_CARD_LAYER_URL); "stub" for the stand-in panels, which offline
//                   play uses unless told otherwise. It is told the realm server (its ?api=), which it calls itself.
//   ?world=slice|large   which version-2 world: the slice's street (fixtures/slice-world, the default until the
//                   generated Domains are written in version 2) or the renderer's large synthetic one.
//   ?test           publishes globalThis.realmTest; ?manual holds the clock until a test advances it.
// and, for development and tests, forces a state rather than waiting on chance:
//   ?at=world:x,z | <town> | <interior>  start there (a town at its middle); ?heading=left|front|right, ?zoom=0..2;
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
  if (query.get("world") === "large") return (await import("../fixtures/large-world/source")).largeSource();
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
  const body = (BODIES as readonly string[]).includes(query.get("body") ?? "") ? (query.get("body") as Body) : "lithe";
  const attuned = (query.get("attuned") ?? "").split(",").filter((t) => DUNGEONS.get(t)?.waystone);
  const api: RealmApi = offline
    ? new MockApi(1, preset ? { name: preset, body, palette: Number(query.get("palette") ?? 0) % 6, color } : undefined, attuned)
    : new HttpApi(new URL(server!, window.location.href).toString());
  if (api instanceof MockApi) api.now = now;

  const cards = query.get("cards") ?? (offline ? "stub" : ((import.meta.env.VITE_CARD_LAYER_URL as string | undefined) ?? "http://localhost:5100/"));
  const layer: CardScreens = cards === "stub" ? new StubCardLayer() : new CardLayer(cards, offline ? undefined : server);

  let game: Overworld | null = null;
  let input: WalkInput | null = null;
  if (query.has("test")) publishTestHooks(() => game, layer, () => input);

  const source = await worldSource();
  const world = await loadWorld(source);
  const character = (await api.me()) ?? (await createCharacter(api));
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
    },
    source,
    world,
  );
  const start = parseAt(query.get("at"), world.towns);
  // The start is the game's to make; input binds to its stage once it stands.
  const started = game.start(character, start);
  await started;
  input = bindInput(game);
}

function socketUrl(server: string): string {
  const url = new URL("realm/ws", new URL(server, window.location.href));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** `world:x,z`, a town (its middle), or a room's id (`<interior>`, `<interior>:x,z`). */
function parseAt(at: string | null, towns: readonly { readonly id: string; readonly center: readonly [number, number] }[]): Start | undefined {
  if (!at) return undefined;
  const [space, where] = at.split(":");
  if (!space) return undefined;
  const [x, z] = (where ?? "").split(",").map(Number);
  const tile = where && Number.isFinite(x) && Number.isFinite(z) ? { x: x!, z: z! } : undefined;
  if (space === "world") return { space: "world", tile };
  const town = towns.find((t) => t.id === space);
  if (town) return { space: "world", tile: { x: town.center[0], z: town.center[1] } };
  return { space, tile };
}
