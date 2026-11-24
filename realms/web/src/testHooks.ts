import * as THREE from "three";
import type { CardScreens } from "./cardLayer";
import type { Overworld } from "./game";
import { identityOf } from "./net/api";
import { type DevDuel, MockApi } from "./net/mockApi";
import { centre } from "./render/actor";
import { type BenchLeg, runBench, yieldFrame } from "./render/bench";
import { NAME_OF } from "./render/camera";
import { CHUNK, OBJECT_KINDS, areaAt, chunkKey } from "./world/format";
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
    /** Whether the world has read and built everything round the view (nothing streaming). */
    get streamed() {
      const o = live();
      return !o || !o.inWorld || o.world.streamer.idle;
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
      // The chunks round the player (the world), or the room's own lists.
      const near = o.inWorld
        ? [...o.world.streamer.builtKeys].map((k) => o.world.streamer.data.get(k)).filter((c) => c && Math.abs(c.cx * CHUNK + 16 - p.tile.x) < 48 && Math.abs(c.cz * CHUNK + 16 - p.tile.z) < 48)
        : [];
      const things = o.inWorld ? near.flatMap((c) => c!.npcs) : o.roomNpcsHere;
      const npcs = new Map(things.map((n) => [n.name ?? n.id, n]));
      const markers = near.flatMap((c) => c!.waymarkers);
      const chests = near.flatMap((c) => c!.chests);
      return [
        { name: o.data.Name, kind: "player", id: "player", tile: p.tile, moving: p.moving, ...at(p.position, 0.6) },
        ...o.mobs
          .filter((m) => m.actor.figure.root.parent === o.spot.place.scene)
          .map((m) => ({ name: m.info.name, kind: "mob", id: m.info.id, spawn: m.spawn.id, tier: m.spawn.tier, role: m.run?.role ?? null, tile: m.actor.tile, moving: m.actor.moving, ...at(m.actor.position, 0.6) })),
        ...[...o.visitors.values()].map((v) => ({ name: v.name, kind: "other", id: v.player, tile: v.actor.tile, moving: v.actor.moving, ...at(v.actor.position, 0.6) })),
        ...o.spot.actors.map((a) => {
          const n = npcs.get(a.name);
          return { name: a.name, kind: n?.kind ?? "npc", id: n?.vendor ?? n?.id ?? a.name, tile: a.tile, moving: a.moving, ...at(a.position, 0.6) };
        }),
        ...o.traderActors.map(({ actor, npc }) => ({ name: npc.name ?? npc.id, kind: npc.kind, id: npc.vendor ?? npc.id, tile: actor.tile, moving: actor.moving, ...at(actor.position, 0.6) })),
        ...things.filter((n) => OBJECT_KINDS.has(n.kind)).map((n) => ({ name: n.name ?? n.kind, kind: n.kind, id: n.tower ?? n.id, tile: { x: n.x, z: n.z }, ...at(centre({ x: n.x, z: n.z }, floor(n.x, n.z)), 0.15) })),
        ...markers.map((w) => ({ name: `Tier ${w.tier}`, kind: "waymarker", id: `${w.x},${w.z}`, tier: w.tier, tile: { x: w.x, z: w.z }, ...at(centre({ x: w.x, z: w.z }, floor(w.x, w.z)), 0.8) })),
        ...chests.map((c) => ({ name: "A chest", kind: "chest", id: c.id, tile: { x: c.x, z: c.z }, ...at(centre({ x: c.x, z: c.z }, floor(c.x, c.z)), 0.3) })),
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
    /**
     * Offline, deals the next duels with these seats' setup changed (MockApi.devDuel), as the server's POST /dev/duel does:
     * a test forcing a position, never a seed.
     */
    forceDuel(duel: DevDuel | null) {
      const o = game();
      if (o?.api instanceof MockApi) o.api.devDuel = duel;
    },
    /** The regional map as drawn: each tier's zone's pixels, the markers on it, whether the whole map is open. */
    get map() {
      const o = live();
      if (!o) return null;
      const hud = o.hud;
      return { drawn: hud.hasWorldMap ? hud.zones().drawn : [], markers: hud.mapState.markers.map((m) => ({ id: m.id, kind: m.kind, tier: m.tier, lit: m.lit ?? null, well: m.well ?? null, won: m.won ?? null })), centre: hud.mapState.centre, open: hud.mapOpen };
    },
    /** The tier the map draws at a world tile, and the world's data's. */
    zoneAt(x: number, z: number) {
      const o = live();
      if (!o) return null;
      return { drawn: o.hud.zones().tierAt(x, z), data: areaAt(o.worldData, x, z)?.tier ?? 0 };
    },
    /** The open tiles of the place, as "x,z", within `reach` of the player. */
    openTiles(reach = 40) {
      const o = live();
      if (!o) return [];
      const me = o.player.tile;
      const out: string[] = [];
      for (let z = me.z - reach; z <= me.z + reach; z++) for (let x = me.x - reach; x <= me.x + reach; x++) if (o.spot.grid.walkable(x, z)) out.push(`${x},${z}`);
      return out;
    },
    /** The path the place's grid finds from the player to a tile (tiles, eight ways), or null. */
    pathTo(x: number, z: number) {
      const o = live();
      if (!o) return null;
      const grid = o.spot.grid;
      // A blocked tile (a board, a table): the way to the nearest open tile beside it.
      if (!grid.walkable(x, z)) {
        let best: { x: number; z: number; path: { x: number; z: number }[] } | null = null;
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            if (!grid.walkable(x + dx, z + dz)) continue;
            const path = grid.path(o.player.tile, { x: x + dx, z: z + dz });
            if (path && (!best || path.length < best.path.length)) best = { x: x + dx, z: z + dz, path };
          }
        return best?.path ?? null;
      }
      return grid.path(o.player.tile, { x, z }) ?? null;
    },
    /** The renderer's benchmark (render/bench.ts) on the game's stage: walks the legs, timing every frame. */
    bench(legs: BenchLeg[], maxFrames?: number) {
      const o = live();
      return o ? runBench(o.stage, legs, maxFrames) : Promise.resolve([]);
    },
    /** What a click on a tile does (the stage's own handling of it), without finding the tile on the page first. */
    clickTile(x: number, z: number) {
      live()?.stage.clickTile({ x, z });
    },
    /** A dungeon run under way: its floor, and the floor's ways (`up`, `down`, `wayOut`) as tiles. */
    get run() {
      return live()?.runState ?? null;
    },
    /** Whether the player is crossing on a ferry. */
    get ferrying() {
      return live()?.ferrying ?? false;
    },
    /** The chunk a world tile is in, as its key. */
    chunkOf(x: number, z: number) {
      return chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    },
    /**
     * The figure a click at a point on the page would land on (a person, a mob), as the tile it stands on; null where none
     * is: what an e2e click checks first, so a guard walking past or a wanderer in the way never takes a click meant for
     * what is behind it.
     */
    figureAt(x: number, y: number) {
      return live()?.stage.pickFigure(x, y) ?? null;
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
      // On its own clock (no ?manual: against a real server, whose walks are timed by its clock), the page's time is let
      // run on by as much instead.
      if (!o.options.manual) {
        const until = o.stage.time + seconds;
        while (live() && o.stage.time < until) await new Promise((r) => requestAnimationFrame(r));
        return;
      }
      for (let t = 0; t < seconds - 1e-6; t += 1 / 60) {
        o.tick(1 / 60);
        await yieldFrame();
      }
    },
  };

  // The art slice's hooks (sliceTest, as slice.html published them before the game page took its place), over the game's
  // stage: the stage's own view of the camera, the player, the place and its doors, for the suites of the renderer and
  // of walking, turning and zooming (e2e/slice.spec.ts, render.spec.ts).
  const stage = () => live()?.stage ?? null;
  const screenOf = (p: THREE.Vector3) => stage()!.toScreen(p);
  const floorOf = (x: number, z: number) => stage()?.current.floorAt?.(x + 0.5, z + 0.5) ?? 0;
  Object.defineProperty(g, "sliceStage", { get: () => stage(), configurable: true });
  g.sliceTest = {
    get ready() {
      return game()?.screen === "world";
    },
    /** The place: "street" for the world, else the room's id. */
    get scene() {
      const s = stage();
      return s ? (s.current.id === "world" ? "street" : s.current.id) : null;
    },
    get heading() {
      const s = stage();
      return s ? NAME_OF[s.rig.heading] : null;
    },
    get view() {
      const r = stage()!.renderer;
      return { yaw: r.view.yaw, pitch: r.view.pitch, snapped: r.snap, scale: r.view.scale };
    },
    get dragging() {
      return input()?.dragging ?? false;
    },
    get cameraSettled() {
      const s = stage()!;
      return s.rig.settled && s.transition === null;
    },
    get zoom() {
      const s = stage()!;
      return { step: s.rig.zoom, scale: s.renderer.view.scale, steps: s.rig.maxZoom() + 1 };
    },
    zoomBy(step: -1 | 1) {
      game()?.zoomBy(step);
    },
    turn(step: -1 | 1) {
      game()?.turn(step);
    },
    get transitioning() {
      return stage()?.transition !== null;
    },
    get player() {
      const p = stage()!.player;
      const at = screenOf(p.position.clone().setY(p.position.y + 0.4));
      return { tile: p.tile, moving: p.moving, x: at.x, y: at.y, at: { x: p.position.x, z: p.position.z }, height: p.position.y, goal: p.goal };
    },
    tile(x: number, z: number) {
      return screenOf(centre({ x, z }, floorOf(x, z)));
    },
    walkable(x: number, z: number) {
      return stage()?.current.grid.walkable(x, z) ?? false;
    },
    get entities() {
      const s = stage();
      if (!s) return [];
      return [
        ...s.current.doors.map((d) => ({ name: d.name, kind: "door", to: d.to === "world" ? "street" : d.to, tile: d.tile, ...screenOf(centre(d.tile, floorOf(d.tile.x, d.tile.z))) })),
        ...s.current.actors.map((a) => ({ name: a.name, kind: "figure", tile: a.tile, moving: a.moving, ...screenOf(a.position.clone().setY(a.position.y + 0.4)) })),
      ];
    },
    advance(seconds: number) {
      return (g.realmTest as { advance(s: number): Promise<void> }).advance(seconds);
    },
    shown(w: number, h: number) {
      const s = stage()!;
      s.render();
      const canvas = s.renderer.canvas;
      const rect = canvas.getBoundingClientRect();
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const c = out.getContext("2d")!;
      c.imageSmoothingEnabled = false;
      c.fillStyle = "#000";
      c.fillRect(0, 0, w, h);
      c.drawImage(canvas, rect.left - (window.innerWidth - w) / 2, rect.top - (window.innerHeight - h) / 2, rect.width, rect.height);
      const data = c.getImageData(0, 0, w, h).data;
      let t = "";
      for (let i = 0; i < data.length; i += 8192) t += String.fromCharCode(...data.subarray(i, i + 8192));
      return { width: w, height: h, rgba: btoa(t) };
    },
    bench(legs: BenchLeg[], maxFrames?: number) {
      const s = stage();
      return s ? runBench(s, legs, maxFrames) : Promise.resolve([]);
    },
    get render() {
      const s = stage()!;
      const st = s.current.streamer;
      return {
        loaded: st?.loadedKeys ?? [],
        built: st?.builtKeys ?? [],
        idle: st?.idle ?? true,
        window: st?.window ?? null,
        calls: s.renderer.stats.calls,
        detail: s.current.place.detail,
        lights: s.current.place.pooledNow.filter((l) => l !== null).length,
        occlude: s.current.inside ? null : s.occlude,
      };
    },
    set occlude(on: boolean) {
      const s = stage();
      if (s) s.occlude = on;
    },
    floor(x: number, z: number) {
      return floorOf(x, z);
    },
    walkTo(x: number, z: number) {
      const s = stage();
      const to = s?.reachableNear({ x, z }, 3);
      return !!to && s!.player.goTo(to);
    },
    frame() {
      const s = stage()!;
      s.render();
      const { width, height, rgba } = s.renderer.readFrame(s.current.place.scene);
      let t = "";
      for (let i = 0; i < rgba.length; i += 8192) t += String.fromCharCode(...rgba.subarray(i, i + 8192));
      return { width, height, rgba: btoa(t) };
    },
  };
}
