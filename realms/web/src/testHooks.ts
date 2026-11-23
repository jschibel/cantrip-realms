import * as THREE from "three";
import type { CardScreens } from "./cardLayer";
import type { Overworld } from "./game";
import { type Hex, key } from "./hex";
import { MockApi } from "./net/mockApi";

// Playwright's view of the page (?test): where everything is, by name, with its position on the page in CSS pixels,
// the way the card table publishes cantripTest - the map, every entity (you, mobs, people, chests, exits, other
// players), every control (by its data-test name), the screen that is open, the message line, and the requests made
// of the card layer and (offline) of the API. Read live: every property is computed when it is asked for.

export function publishTestHooks(game: () => Overworld | null, layer: CardScreens): void {
  const g = globalThis as Record<string, unknown>;
  const controls = () =>
    [...document.querySelectorAll<HTMLElement>("[data-test]")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.dataset.test!, x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height, text: el.textContent?.trim() ?? "" };
      });

  g.realmTest = {
    get ready() {
      return game()?.screen === "world";
    },
    get screen() {
      if (document.querySelector("[data-test=create]")) return "create";
      return game()?.screen ?? "loading";
    },
    get map() {
      const o = game();
      return o?.map ? { id: o.map.id, name: o.map.name, kind: o.map.kind } : null;
    },
    get paused() {
      return game()?.paused ?? true;
    },
    get message() {
      return game()?.hud.lastMessage ?? null;
    },
    get messages() {
      return game()?.hud.log.slice() ?? [];
    },
    get cursor() {
      return game()?.canvas.dataset.cursor ?? "none";
    },
    get character() {
      const o = game();
      return o?.data ? { name: o.data.Name, gold: o.data.Gold, ante: o.data.AnteValue, identity: o.data.Identity, loadout: Object.keys(o.data.Loadout) } : null;
    },
    get entities() {
      const o = game();
      if (!o?.world || o.screen === "loading") return [];
      const at = (object: THREE.Object3D, lift: number) => o.pixels.toScreen(object.position.clone().add(new THREE.Vector3(0, lift, 0)));
      const hexAt = (h: Hex, lift = 0.4) => o.pixels.toScreen(o.world.surface(h).add(new THREE.Vector3(0, lift, 0)));
      return [
        { name: o.data.Name, kind: "player", id: "player", hex: key(o.player.hex), moving: o.player.moving, ...at(o.character.root, o.character.height * 0.5) },
        ...o.mobs.map((m) => ({ name: m.info.name, kind: "mob", id: m.info.id, spawn: m.spawn.id, hex: key(m.walker.hex), moving: m.walker.moving, ...at(m.walker.character.root, m.walker.character.height * 0.5) })),
        ...o.map.data.npcs.map((n) => ({ name: n.name ?? n.kind, kind: n.kind, id: n.id, hex: key(n), ...hexAt({ q: n.q, r: n.r }, 0.6) })),
        ...o.map.data.chests.map((c) => ({ name: `chest ${c.id}`, kind: "chest", id: c.id, hex: key(c), ...hexAt({ q: c.q, r: c.r }, 0.3) })),
        ...o.map.data.exits.map((e, i) => ({ name: `exit to ${e.to}`, kind: "exit", id: `exit-${i}`, to: e.to, hex: key(e), ...hexAt({ q: e.q, r: e.r }, 0) })),
        ...[...o.visitors.values()].map((v) => ({ name: v.name, kind: "other", id: v.player, hex: key(v.walker.hex), moving: v.walker.moving, ...at(v.walker.character.root, v.walker.character.height * 0.5) })),
      ];
    },
    get controls() {
      return controls();
    },
    get travel() {
      const t = game()?.travelScreen;
      return t?.isOpen ? { at: key(t.at), moving: t.moving, here: t.here?.id ?? null, places: t.describe() } : null;
    },
    get layer() {
      return { ready: layer.isReady, open: layer.openScreen, requests: layer.requests.map((r) => ({ screen: r.screen, args: JSON.parse(JSON.stringify(r.args)) as unknown })) };
    },
    get api() {
      const o = game();
      return o?.api instanceof MockApi ? o.api.calls.map((c) => ({ ...c })) : [];
    },
    /** Where a hex of the current map is on the page. */
    screenOfHex(q: number, r: number) {
      const o = game();
      return o?.world ? o.pixels.toScreen(o.world.surface({ q, r })) : null;
    },
    /** Whether a hex can be walked onto now. */
    passable(q: number, r: number) {
      const o = game();
      return o?.map ? o.map.passable({ q, r }) : false;
    },
  };
}
