import * as THREE from "three";
import type { CardScreens } from "./cardLayer";
import type { Overworld } from "./game";
import { identityOf } from "./net/api";
import { MockApi } from "./net/mockApi";
import { centre } from "./render/actor";
import { yieldFrame } from "./render/bench";
import { NAME_OF } from "./render/camera";
import type { WalkInput } from "./render/pointer";

// Playwright's view of the page (?test): where everything is, by name, with its position on the page in CSS pixels,
// the way the card table publishes cantripTest - the place you are in and the area and tier, every entity (you, mobs,
// people, doors, other players) with its tile `{x, z}`, every control (by its data-test name), the screen that is
// open, the message line, and the requests made of the card layer and (offline) of the API. Read live: every property
// is computed when it is asked for. With ?manual the clock stands still until `advance` moves it.

export function publishTestHooks(game: () => Overworld | null, layer: CardScreens, input: () => WalkInput | null): void {
  const g = globalThis as Record<string, unknown>;
  const controls = () =>
    [...document.querySelectorAll<HTMLElement>("[data-test]")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.dataset.test!, x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height, text: el.textContent?.trim() ?? "" };
      });
  const live = () => {
    const o = game();
    return o && o.screen !== "loading" && o.stage ? o : null;
  };

  g.realmTest = {
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
    /** The place you are in: "world", a room, a dungeon run's floor. */
    get space() {
      const o = live();
      return o ? { id: o.spaceId, kind: o.inWorld ? "world" : o.spot.id.startsWith("run:") ? "dungeon" : "interior", name: o.spot.title } : null;
    },
    get area() {
      return game()?.area ?? null;
    },
    /** The chunks read and built round the player. */
    get chunks() {
      const s = live()?.world.streamer;
      return s ? { loaded: s.loadedKeys, built: s.builtKeys } : null;
    },
    get travelers() {
      return game()?.travelers.map((t) => ({ ...t })) ?? [];
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
    get dragging() {
      return input()?.dragging ?? false;
    },
    get heading() {
      const o = live();
      return o ? NAME_OF[o.stage.rig.heading] : null;
    },
    get zoom() {
      const o = live();
      return o ? { step: o.stage.rig.zoom, scale: o.stage.renderer.view.scale } : null;
    },
    get transitioning() {
      return (live()?.stage.transition ?? null) !== null;
    },
    get character() {
      const o = game();
      return o?.data
        ? { name: o.data.Name, gold: o.data.Gold, ante: o.data.AnteValue, identity: identityOf(o.data), attuned: [...(o.data.Attuned ?? [])], loadout: Object.entries(o.data.Loadout).filter(([, worn]) => worn).map(([slot]) => slot) }
        : null;
    },
    get entities() {
      const o = live();
      if (!o) return [];
      const at = (p: THREE.Vector3, lift: number) => o.stage.toScreen(p.clone().add(new THREE.Vector3(0, lift, 0)));
      const floor = (x: number, z: number) => o.spot.floorAt?.(x + 0.5, z + 0.5) ?? 0;
      const p = o.player;
      return [
        { name: o.data.Name, kind: "player", id: "player", tile: p.tile, moving: p.moving, ...at(p.position, 0.6) },
        ...o.mobs
          .filter((m) => m.actor.figure.root.parent === o.spot.place.scene)
          .map((m) => ({ name: m.info.name, kind: "mob", id: m.info.id, spawn: m.spawn.id, tier: m.spawn.tier, role: m.run?.role ?? null, tile: m.actor.tile, moving: m.actor.moving, ...at(m.actor.position, 0.6) })),
        ...[...o.visitors.values()].map((v) => ({ name: v.name, kind: "other", id: v.player, tile: v.actor.tile, moving: v.actor.moving, ...at(v.actor.position, 0.6) })),
        ...o.spot.actors.map((a) => ({ name: a.name, kind: "npc", id: a.name, tile: a.tile, moving: a.moving, ...at(a.position, 0.6) })),
        ...o.spot.doors.map((d) => ({ name: d.name, kind: d.kind ?? "door", id: d.to, to: d.to, tile: d.tile, ...at(centre(d.tile, floor(d.tile.x, d.tile.z)), 0) })),
      ];
    },
    get controls() {
      return controls();
    },
    get layer() {
      return { ready: layer.isReady, open: layer.openScreen, requests: layer.requests.map((r) => ({ screen: r.screen, args: JSON.parse(JSON.stringify(r.args)) as unknown })) };
    },
    get api() {
      const o = game();
      return o?.api instanceof MockApi ? o.api.calls.map((c) => ({ ...c })) : [];
    },
    /** Where a tile of the current place is on the page. */
    screenOfTile(x: number, z: number) {
      const o = live();
      return o ? o.stage.toScreen(centre({ x, z }, o.spot.floorAt?.(x + 0.5, z + 0.5) ?? 0)) : null;
    },
    /** Whether a tile can be walked onto now. */
    walkable(x: number, z: number) {
      return live()?.spot.grid.walkable(x, z) ?? false;
    },
    /** Moves the clock on by some seconds, in steps of a sixtieth (with ?manual), the page's own work between frames. */
    async advance(seconds: number) {
      const o = live();
      if (!o) return;
      for (let t = 0; t < seconds - 1e-6; t += 1 / 60) {
        o.tick(1 / 60);
        await yieldFrame();
      }
    },
  };
}
