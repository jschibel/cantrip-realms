import * as THREE from "three";
import type { CardScreens } from "./cardLayer";
import type { Overworld } from "./game";
import { type Hex, key } from "./hex";
import { identityOf } from "./net/api";
import { MockApi } from "./net/mockApi";
import { WORLD } from "./world/content";
import { areaAt } from "./world/schema";

// Playwright's view of the page (?test): where everything is, by name, with its position on the page in CSS pixels,
// the way the card table publishes cantripTest - the space you are in and the area and tier, every entity (you, mobs,
// people, chests, doors, ways in and out, waymarkers, other players), every control (by its data-test name), the
// regional map's zones and markers, the screen that is open, the message line, and the requests made of the card layer
// and (offline) of the API. Read live: every property is computed when it is asked for.

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
    /** The overworld itself, for poking at in a debugger; tests read the properties below. */
    get game() {
      return game();
    },
    get ready() {
      return game()?.screen === "world";
    },
    get screen() {
      if (document.querySelector("[data-test=create]")) return "create";
      return game()?.screen ?? "loading";
    },
    /** The space you are in: "world", an interior, a dungeon run. */
    get space() {
      const o = game();
      return o?.space ? { id: o.space.id, kind: o.space.kind, name: o.space.name } : null;
    },
    /** The area and tier you stand in, as the HUD says. */
    get area() {
      return game()?.area ?? null;
    },
    /** The chunks loaded and built. */
    get chunks() {
      const o = game();
      return o ? { loaded: [...o.world.chunks.keys()].sort(), built: o.worldScene.patchKeys.sort() } : null;
    },
    get run() {
      const o = game();
      return o?.run ? { id: o.run.id, dungeon: o.run.dungeon.id, floor: o.run.floor, floors: o.run.floors.length, down: o.run.plan.down ? key(o.run.plan.down) : null, up: key(o.run.plan.up), wayOut: o.run.plan.wayOut ? key(o.run.plan.wayOut) : null } : null;
    },
    /** The open hexes of a room or a dungeon floor (the world's are in its files). */
    get openHexes() {
      const o = game();
      if (!o?.space || o.space.kind === "world") return null;
      return [...(o.space as unknown as { all: Iterable<{ hex: Hex; blocked: boolean }> }).all].filter((t) => !t.blocked).map((t) => key(t.hex));
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
    get tooltip() {
      return game()?.hud.tooltipText ?? null;
    },
    get character() {
      const o = game();
      return o?.data
        ? { name: o.data.Name, gold: o.data.Gold, ante: o.data.AnteValue, identity: identityOf(o.data), attuned: [...(o.data.Attuned ?? [])], loadout: Object.entries(o.data.Loadout).filter(([, worn]) => worn).map(([slot]) => slot) }
        : null;
    },
    get entities() {
      const o = game();
      if (!o?.scene || o.screen === "loading") return [];
      const at = (object: THREE.Object3D, lift: number) => o.pixels.toScreen(object.position.clone().add(new THREE.Vector3(0, lift, 0)));
      const hexAt = (h: Hex, lift = 0.4) => o.pixels.toScreen(o.scene.surface(h).add(new THREE.Vector3(0, lift, 0)));
      const found: Record<string, unknown>[] = [
        { name: o.data.Name, kind: "player", id: "player", hex: key(o.player.hex), moving: o.player.moving, ...at(o.character.root, o.character.height * 0.5) },
        ...o.mobs.map((m) => ({ name: m.info.name, kind: "mob", id: m.info.id, spawn: m.spawn.id, tier: m.spawn.tier, role: m.run?.role ?? null, hex: key(m.walker.hex), moving: m.walker.moving, ...at(m.walker.character.root, m.walker.character.height * 0.5) })),
        ...[...o.visitors.values()].map((v) => ({ name: v.name, kind: "other", id: v.player, hex: key(v.walker.hex), moving: v.walker.moving, ...at(v.walker.character.root, v.walker.character.height * 0.5) })),
      ];
      // What stands on the ground near the player: people, chests, doors, ways in and out, waymarkers.
      const near = (h: Hex) => Math.max(Math.abs(h.q - o.player.hex.q), Math.abs(h.r - o.player.hex.r)) <= 40;
      const things: [Hex, Record<string, unknown>][] = [];
      if (o.space.kind === "world") {
        for (const c of o.world.chunks.values()) {
          if (!o.worldScene.hasPatch(c.key)) continue;
          for (const n of c.data.npcs) things.push([n, { name: n.name ?? n.kind, kind: n.kind, id: n.id, ...(n.tower ? { tower: n.tower } : {}) }]);
          for (const ch of c.data.chests) things.push([ch, { name: `chest ${ch.id}`, kind: "chest", id: ch.id }]);
          for (const d of c.data.doors) things.push([d, { name: `door to ${d.interior}`, kind: "door", id: d.interior, to: d.interior }]);
          for (const e of c.data.entrances) things.push([e, { name: `entrance to ${e.dungeon}`, kind: "entrance", id: e.dungeon, to: e.dungeon }]);
          for (const p of c.data.props) if (p.kind === "waymarker") things.push([p, { name: `waymarker ${p.tier}`, kind: "waymarker", id: key(p), tier: p.tier }]);
        }
      } else {
        const space = o.space as unknown as { npcs: readonly { q: number; r: number; kind: string; id: string; name?: string }[] };
        for (const n of space.npcs) things.push([n, { name: n.name ?? n.kind, kind: n.kind, id: n.id }]);
        const run = o.run;
        if (run) {
          things.push([run.plan.up, { name: "the way up", kind: "leave", id: "up" }]);
          if (run.plan.down) things.push([run.plan.down, { name: "the stairs down", kind: "stairs-down", id: "down" }]);
          if (o.space.thing(run.plan.wayOut ?? { q: NaN, r: NaN })?.kind === "leave") things.push([run.plan.wayOut!, { name: "the way out", kind: "leave", id: "way-out" }]);
        } else {
          const room = o.interiors.get(o.space.id);
          if (room) things.push([room.data.entry, { name: "the door out", kind: "leave", id: "door" }]);
        }
      }
      for (const [h, info] of things) if (near(h)) found.push({ ...info, hex: key(h), ...hexAt({ q: h.q, r: h.r }, info.kind === "door" || info.kind === "leave" || info.kind === "entrance" || info.kind === "stairs-down" ? 0 : 0.6) });
      return found;
    },
    get controls() {
      return controls();
    },
    /** The regional map: the zones it draws, the markers shown, and whether the whole map is open. */
    get map() {
      const o = game();
      if (!o) return null;
      const zones = o.hud.zones();
      return { space: o.hud.mapState.space, markers: o.hud.mapState.markers.map((m) => ({ id: m.id, kind: m.kind, tier: m.tier, lit: m.lit ?? null })), drawn: zones.drawn, open: o.hud.mapOpen };
    },
    /** Which tier's zone the map shows at a hex, and which the world's data says. */
    zoneAt(q: number, r: number) {
      const o = game();
      if (!o) return null;
      return { drawn: o.hud.zones().tierAt(q, r), data: areaAt(WORLD.zones, { q, r })?.tier ?? 0 };
    },
    get layer() {
      return { ready: layer.isReady, open: layer.openScreen, requests: layer.requests.map((r) => ({ screen: r.screen, args: JSON.parse(JSON.stringify(r.args)) as unknown })) };
    },
    get api() {
      const o = game();
      return o?.api instanceof MockApi ? o.api.calls.map((c) => ({ ...c })) : [];
    },
    /** Where a hex of the current space is on the page. */
    screenOfHex(q: number, r: number) {
      const o = game();
      return o?.scene ? o.pixels.toScreen(o.scene.surface({ q, r })) : null;
    },
    /** Whether a hex can be walked onto now. */
    passable(q: number, r: number) {
      const o = game();
      return o?.space ? o.space.passable({ q, r }) : false;
    },
  };
}
