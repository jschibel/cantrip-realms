import * as THREE from "three";
import { type RunFloor, assembleFloor, generateDungeonFloor, gridOfFloor } from "../../dungeon";
import { Actor, behaviourOf } from "../../render/actor";
import { assembleInterior } from "../../render/assemble";
import { CameraRig, type Framing, HEADING_NAMES } from "../../render/camera";
import type { Place } from "../../render/place";
import { type InteriorKind, type NpcData, THEMES, type Theme } from "../../world/format";
import type { Grid } from "../../world/grid";
import { gridOfInterior } from "../../world/load";
import { figureSpec } from "../figures";
import { seeded } from "../paint/pixmap";
import { ROOM_KINDS, ROOM_STYLES, type RoomKind, layoutRoom, roomTitle } from "./layout";

// The rooms and dungeons gallery (rooms.html, dev only): every room kind in every regional style, and every dungeon
// theme's floors, drawn at a heading with the hero standing in them - to judge them by eye and to screenshot them
// (e2e/rooms.spec.ts). No query: an index of links.
//
//   ?room=<kind>&style=<style>&seed=N   a room as layoutRoom lays it out; &w=&d= its floor (else from &bw=&bd=, the
//                                       building's footprint), &specialty= a shop's wares, &upstairs=0 a tavern
//   ?dungeon=<theme>&seed=N&floor=K&floors=M   a run's floor (a made-up run: three encounters, a warden or a boss)
//   ?heading=left|front|right           the camera's heading
//   ?at=x,z                             where the hero stands and the camera looks (else the arrival)
//   ?time=T                             the flames' clock, seconds (still: nothing moves but by it)
//   ?test                               publishes globalThis.roomsTest

THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const num = (key: string, fallback: number): number => {
  const v = Number(query.get(key) ?? "x");
  return Number.isFinite(v) ? v : fallback;
};
const at = query.get("at")?.split(",").map(Number);

interface Shown extends Framing {
  readonly title: string;
  readonly place: Place;
  readonly grid: Grid;
  readonly start: { x: number; z: number };
  readonly npcs: readonly NpcData[];
}

/** A made-up run's floor: three encounters, the warden on every floor but the last, the boss on the last. */
export function sampleRun(floor: number, floors: number): RunFloor {
  return {
    Encounters: [0, 1, 2].map((i) => ({ Index: i, Mob: `mob-${i}` })),
    Warden: floor < floors - 1 ? "warden" : null,
    Boss: floor === floors - 1 ? "boss" : null,
  };
}

function showRoom(kind: RoomKind): Shown {
  const style = query.get("style") ?? "benalish";
  const room = layoutRoom({
    id: `${kind}-${style}`,
    kind,
    style,
    seed: num("seed", 1),
    ...(query.has("w") && query.has("d") ? { w: num("w", 12), d: num("d", 8) } : {}),
    ...(query.has("bw") && query.has("bd") ? { building: { w: num("bw", 8), d: num("bd", 6) } } : {}),
    exit: [0, 0],
    ...(query.has("specialty") ? { specialty: query.get("specialty")! } : {}),
    ...(query.has("upstairs") ? { upstairs: query.get("upstairs") !== "0" } : {}),
  });
  const built = assembleInterior(room);
  const start = at && at.length === 2 ? { x: at[0]!, z: at[1]! } : { x: room.entry[0], z: room.entry[1] - 1 };
  return { title: room.name, inside: true, turns: true, bounds: built.bounds, place: built.place, grid: gridOfInterior(room), start, npcs: room.npcs };
}

function showDungeon(theme: Theme): Shown {
  const floors = num("floors", 3);
  const floor = num("floor", 0);
  const f = generateDungeonFloor({ theme, seed: num("seed", 1), floor, floors, run: sampleRun(floor, floors) });
  const built = assembleFloor(f);
  const start = at && at.length === 2 ? { x: at[0]!, z: at[1]! } : { x: f.arrive[0], z: f.arrive[1] };
  return { title: `${theme}, floor ${floor + 1} of ${floors}`, inside: true, turns: true, bounds: built.bounds, place: built.place, grid: gridOfFloor(f), start, npcs: f.npcs };
}

function index(): void {
  document.body.style.cssText = "margin:0;background:#140f1e;color:#f4ecd4;font:15px/1.5 Georgia,serif;padding:16px 24px";
  canvas.remove();
  const link = (q: string, text: string) => `<a style="color:#f8d04c;margin-right:10px" href="?${q}">${text}</a>`;
  const rows = [
    "<h2>Rooms</h2>",
    ...ROOM_KINDS.map((k) => `<div><b>${k}</b>: ${ROOM_STYLES.map((s) => link(`room=${k}&style=${s}`, s)).join("")}</div>`),
    "<h2>Dungeons</h2>",
    ...THEMES.map((t) => `<div><b>${t}</b>: ${[0, 1, 2].map((f) => link(`dungeon=${t}&floor=${f}`, `floor ${f + 1}`)).join("")}</div>`),
  ];
  document.body.innerHTML = rows.join("\n");
  (globalThis as Record<string, unknown>).roomsTest = { ready: true, kinds: ROOM_KINDS, styles: ROOM_STYLES, themes: THEMES };
}

const roomKind = query.get("room");
const theme = query.get("dungeon");
if (roomKind && (ROOM_KINDS as readonly string[]).includes(roomKind)) start(showRoom(roomKind as RoomKind));
else if (theme && (THEMES as readonly string[]).includes(theme)) start(showDungeon(theme as Theme));
else index();

function start(shown: Shown): void {
  document.title = `${shown.title} - ${roomKind ? roomTitle(roomKind as InteriorKind) : "dungeon"}`;
  document.body.style.cssText = "margin:0;height:100%;overflow:hidden;background:#000";
  canvas.style.cssText = "position:fixed;image-rendering:pixelated";
  const rig = new CameraRig(canvas, HEADING_NAMES[query.get("heading") ?? ""] ?? 0, 0, shown);
  const renderer = rig.renderer;
  const hero = new Actor(figureSpec("hero"), shown.start, shown.grid, {}, "hero", seeded(7));
  hero.figure.face(0, 1);
  shown.place.addFigure(hero.figure.root);
  const actors = shown.npcs
    .filter((n) => n.kind !== "spell-table")
    .map((n) => {
      const a = new Actor(figureSpec(n.figure ?? "townswoman"), { x: n.x, z: n.z }, shown.grid, behaviourOf(n.behaviour), n.name ?? n.id, seeded(n.seed ?? 1));
      if (n.stand) a.position.set(...n.stand);
      a.figure.root.position.copy(a.position);
      shown.place.addFigure(a.figure.root);
      return a;
    });
  const time = num("time", 0);
  const LEAN = (25 * Math.PI) / 180;
  let frames = 0;
  const frame = () => {
    const view = rig.viewFor(shown);
    renderer.setView(view);
    shown.place.update(time, view.yaw, view.yaw);
    renderer.focus.copy(rig.clampFocus(hero.position, shown));
    for (const f of [hero.figure, ...actors.map((a) => a.figure)]) {
      f.update(0, 0);
      f.setLean(LEAN, view.pitch, view.yaw);
    }
    renderer.render(shown.place.scene);
    frames++;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (query.has("test")) {
    (globalThis as Record<string, unknown>).roomsTest = {
      ready: true,
      title: shown.title,
      get frames() {
        return frames;
      },
      /** Where a world point is on the page. */
      screen: (x: number, y: number, z: number) => renderer.toScreen(new THREE.Vector3(x, y, z)),
    };
  }
}
