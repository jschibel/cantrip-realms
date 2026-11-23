import * as THREE from "three";
import "./style.css";
import "./theme.css";
import { CardLayer, type CardScreens } from "./cardLayer";
import { StubCardLayer } from "./cardStub";
import { BODIES, type Body, type ManaColor } from "./character";
import { Overworld, type Start } from "./game";
import { hex } from "./hex";
import { bindInput } from "./input";
import { HttpApi, type RealmApi } from "./net/api";
import { MockApi } from "./net/mockApi";
import { LocalPresence, type Presence, SocketPresence } from "./net/presence";
import { createCharacter } from "./screens/create";
import { publishTestHooks } from "./testHooks";
import { DUNGEONS, WORLD, besideEntrance, hasInterior, innOf } from "./world/content";

// The overworld page (tech.md, B5-B6). Its query says where everything comes from:
//   ?server=<url>   the realm server (also VITE_REALM_SERVER); with none, or with ?offline, the API is the in-memory
//                   MockApi and presence goes between this browser's tabs.
//   ?cards=<url>    the card layer to frame (also VITE_CARD_LAYER_URL); "stub" for the stand-in panels, which offline
//                   play uses unless told otherwise. It is told the realm server (its ?api=), which it calls itself.
//   ?test           publishes globalThis.realmTest.
// and, for development and tests, forces a state rather than waiting on chance:
//   ?at=world:q,r | <town> | <interior>[:q,r] | <dungeon>  start there (a town at its inn's door, a dungeon before its
//   way in); ?now=<unix seconds> pins the spawn clock; ?wander=0 keeps mobs at home, ?mobs=0 leaves them out;
//   ?name=&color=&body=&palette= makes the offline character without the screen; ?attuned=<tower>,... starts the
//   offline character with those mage towers' waystones attuned.

// Colors are given as the palette's own sRGB values and lit as they are; the post pass snaps the result to the
// palette, so no color management is wanted between them.
THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(window.location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;

void boot();

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
  if (query.has("test")) publishTestHooks(() => game, layer);

  const character = (await api.me()) ?? (await createCharacter(api));
  const presence: Presence = offline
    ? new LocalPresence({ Player: Math.floor(Math.random() * 2 ** 31), Name: character.Name, Identity: character.Identity })
    : new SocketPresence(socketUrl(server!));

  game = new Overworld(canvas, api, layer, presence, { wander: query.get("wander") !== "0", mobs: query.get("mobs") !== "0", now });
  bindInput(game);
  await game.start(character, await parseAt(query.get("at")));
}

function socketUrl(server: string): string {
  const url = new URL("realm/ws", new URL(server, window.location.href));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function parseAt(at: string | null): Promise<Start | undefined> {
  if (!at) return undefined;
  const [space, where] = at.split(":");
  if (!space) return undefined;
  const [q, r] = (where ?? "").split(",").map(Number);
  const given = where && Number.isFinite(q) && Number.isFinite(r) ? hex(q!, r!) : undefined;
  if (space === "world") return { space: "world", hex: given };
  if (WORLD.towns.some((t) => t.id === space)) {
    const inn = innOf(space);
    return { space: "world", hex: hex(inn.q, inn.r) };
  }
  const dungeon = DUNGEONS.get(space);
  if (dungeon) {
    // Beside its way in, where leaving it would put you.
    return { space: "world", hex: await besideEntrance(hex(dungeon.entrance[0], dungeon.entrance[1])) };
  }
  if (hasInterior(space)) return { space, hex: given };
  return undefined;
}
