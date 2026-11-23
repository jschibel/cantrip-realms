import * as THREE from "three";
import "./style.css";
import "./theme.css";
import { CardLayer, type CardScreens } from "./cardLayer";
import { StubCardLayer } from "./cardStub";
import { BODIES, type Body, type ManaColor } from "./character";
import { Overworld } from "./game";
import { type Hex, hex } from "./hex";
import { bindInput } from "./input";
import { HttpApi, type RealmApi } from "./net/api";
import { MockApi } from "./net/mockApi";
import { LocalPresence, type Presence, SocketPresence } from "./net/presence";
import { createCharacter } from "./screens/create";
import type { EncounterMode } from "./screens/travel";
import { publishTestHooks } from "./testHooks";

// The overworld page (tech.md, B5-B6). Its query says where everything comes from:
//   ?server=<url>   the realm server (also VITE_REALM_SERVER); with none, or with ?offline, the API is the in-memory
//                   MockApi and presence goes between this browser's tabs.
//   ?cards=<url>    the card layer to frame (also VITE_CARD_LAYER_URL); "stub" for the stand-in panels, which offline
//                   play uses unless told otherwise.
//   ?editor[=<map>] the map editor instead (development builds only).
//   ?test           publishes globalThis.realmTest.
// and, for development and tests, forces a state rather than waiting on chance:
//   ?at=<map>[:q,r] start there; ?now=<unix seconds> pins the spawn clock; ?wander=0 keeps mobs at home;
//   ?encounters=always|never|roll; ?name=&color=&body=&palette= makes the offline character without the screen.

// Colors are given as the palette's own sRGB values and lit as they are; the post pass snaps the result to the
// palette, so no color management is wanted between them.
THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(window.location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;

if (query.has("editor") && import.meta.env.DEV) {
  void import("./editor/editor").then((editor) => editor.runEditor(canvas, query.get("editor") || null));
} else {
  void boot();
}

async function boot(): Promise<void> {
  const server = query.get("server") ?? (import.meta.env.VITE_REALM_SERVER as string | undefined);
  const offline = query.has("offline") || !server;
  const pinned = query.get("now");
  const now = pinned ? () => Number(pinned) : () => Date.now() / 1000;

  const preset = query.get("name");
  const color = (query.get("color") ?? "W").toUpperCase() as ManaColor;
  const body = (BODIES as readonly string[]).includes(query.get("body") ?? "") ? (query.get("body") as Body) : "lithe";
  const api: RealmApi = offline
    ? new MockApi(1, preset ? { name: preset, body, palette: Number(query.get("palette") ?? 0) % 6, color } : undefined)
    : new HttpApi(new URL(server!, window.location.href).toString());
  if (api instanceof MockApi) api.now = now;

  const cards = query.get("cards") ?? (offline ? "stub" : ((import.meta.env.VITE_CARD_LAYER_URL as string | undefined) ?? "http://localhost:5100/"));
  const layer: CardScreens = cards === "stub" ? new StubCardLayer() : new CardLayer(cards);

  let game: Overworld | null = null;
  if (query.has("test")) publishTestHooks(() => game, layer);

  const character = (await api.me()) ?? (await createCharacter(api));
  const presence: Presence = offline
    ? new LocalPresence({ Player: `offline-${Math.random().toString(36).slice(2, 10)}`, Name: character.Name, Identity: character.Identity })
    : new SocketPresence(socketUrl(server!));

  const options = {
    wander: query.get("wander") !== "0",
    encounters: (["always", "never", "roll"] as const).find((m) => m === query.get("encounters")) ?? ("roll" as EncounterMode),
    now,
  };
  game = new Overworld(canvas, api, layer, presence, options);
  bindInput(game);
  await game.start(character, parseAt(query.get("at")));
}

function socketUrl(server: string): string {
  const url = new URL("realm/ws", new URL(server, window.location.href));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function parseAt(at: string | null): { map: string; hex?: Hex } | undefined {
  if (!at) return undefined;
  const [map, where] = at.split(":");
  if (!map) return undefined;
  const [q, r] = (where ?? "").split(",").map(Number);
  return { map, hex: where && q !== undefined && r !== undefined && Number.isFinite(q) && Number.isFinite(r) ? hex(q, r) : undefined };
}
