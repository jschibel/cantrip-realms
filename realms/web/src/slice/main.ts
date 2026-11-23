import * as THREE from "three";
import { Figure, figureSpec } from "../art/figures";
import { namedPalette } from "../art/paint/palette";
import { seeded } from "../art/paint/pixmap";
import { Actor, behaviourOf, centre } from "../render/actor";
import { assembleInterior, assembleWorld } from "../render/assemble";
import { CameraRig, type Framing, HEADING_NAMES, type Heading, NAME_OF, ZOOM_EASE, type Zoom } from "../render/camera";
import type { Place } from "../render/place";
import { type View, blendViews } from "../render/view";
import { type InteriorData, type NpcData, type Rect, type XZ, frontStep } from "../world/format";
import type { Grid, Tile } from "../world/grid";
import { globSource, gridOfInterior, gridOfWorld, loadChunks, loadInterior, loadWorld } from "../world/load";

// The art slice (slice.html): New Benalia's street, Grizzlegom's Goblins inside, and a crypt below the churchyard, in
// the 3D pixel-art look - a real 3D scene drawn small and shown in big pixels, on square tiles, seen as a 16-bit RPG
// sees its towns and rooms. Click to walk; walk through a door to go in or out. All of it is a version-2 world's data
// (fixtures/slice-world: world.json, its chunks and two interiors), drawn by the art registries (render/assemble.ts).
//
//   ?heading=left|front|right   the camera's heading: looking north, or swung 45 degrees round to the left or the
//                     right. Q and E (or the turn buttons) step it one heading, easing round about the player; it never
//                     goes past 45 degrees. The heading is remembered (localStorage) for the next visit
//   ?zoom=0|1|2       the outdoor zoom step: 0 closest, each step out one screen pixel fewer to the scene's pixel.
//                     The mouse wheel, + and - (or the zoom buttons) step it, easing; it is remembered. Rooms are
//                     always seen at the closest scale.
//   ?scene=street|shop|crypt   where to start; ?at=x,z the tile
//   ?test             publishes globalThis.sliceTest (screen places of everything, the state, a frame reader)
//   ?still            the townsfolk stand still (for screenshots)
//   ?edges=0          no outlines or edge highlights, to compare
//   ?cast             every figure in a row by the start (?cast=walk: walking on the spot)
//   ?manual           the clock moves only when a test advances it; ?nohud hides the labels

THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const still = query.has("still");

/** Where the heading is kept between visits. Storage may be refused: then it lasts the visit. */
const HEADING_KEY = "cantrip-realms.slice.heading";
function storedHeading(): Heading | null {
  try {
    return HEADING_NAMES[localStorage.getItem(HEADING_KEY) ?? ""] ?? null;
  } catch {
    return null;
  }
}
const ZOOM_KEY = "cantrip-realms.slice.zoom";
function storedZoom(): Zoom | null {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY) ?? "x");
    return v === 0 || v === 1 || v === 2 ? v : null;
  } catch {
    return null;
  }
}
const askedZoom = Number(query.get("zoom") ?? "x");

// --- The places: the world's street and country, and the rooms behind its doors ----------------------------------------

/** "street" for the world outside, else an interior's id. */
type SceneId = string;

/** A door as the page walks through it: stand on `tile`, step `step`, come out in `to` on `arrive` facing `arriveFacing`. */
interface Door {
  readonly tile: Tile;
  readonly step: readonly [number, number];
  readonly to: SceneId;
  readonly arrive: Tile;
  readonly arriveFacing: readonly [number, number];
  /** The doorway itself, for the iris to close on. */
  readonly at: THREE.Vector3;
  readonly name: string;
}

/** A place as the page holds it: what is drawn, where one walks, its doors and the figures living there. */
interface SliceScene extends Framing {
  readonly id: SceneId;
  readonly title: string;
  readonly place: Place;
  readonly scene: THREE.Scene;
  readonly grid: Grid;
  readonly doors: readonly Door[];
  readonly actors: readonly Actor[];
  readonly start: Tile;
  readonly bounds: Rect;
}

// The world's data is read up front (it is small); each place is put together the first time it is visited.
const source = globSource(
  () => import("../../fixtures/slice-world/world.json"),
  import.meta.glob("../../fixtures/slice-world/chunks/*.json", { import: "default" }),
  import.meta.glob("../../fixtures/slice-world/interiors/*.json", { import: "default" }),
);
const world = await loadWorld(source);
const chunks = await loadChunks(source, world);
const rooms = new Map<string, InteriorData>();
for (const id of new Set(chunks.flatMap((c) => c.buildings.flatMap((b) => (b.interior ? [b.interior] : []))))) rooms.set(id, await loadInterior(source, id));
const town = world.towns.find((t) => t.start) ?? world.towns[0]!;
const tileOf = ([x, z]: XZ): Tile => ({ x, z });

/** The figures that live in a place, as its NPCs say: their look, their manner and their pace. */
function actorsOf(npcs: readonly NpcData[], grid: Grid, place: Place): Actor[] {
  const actors = npcs.map((n) => {
    const spec = figureSpec(n.figure ?? "townswoman", n.palette ? namedPalette(n.palette) : undefined);
    const a = new Actor(spec, { x: n.x, z: n.z }, grid, behaviourOf(n.behaviour), n.name ?? n.id, n.seed !== undefined ? seeded(n.seed) : Math.random);
    if (n.stand) a.position.set(...n.stand);
    return a;
  });
  for (const a of actors) place.addFigure(a.figure.root);
  npcs.forEach((n, i) => {
    if (n.speed !== undefined) actors[i]!.speed = n.speed;
  });
  return actors;
}

function buildStreet(): SliceScene {
  const built = assembleWorld(world, chunks);
  const grid = gridOfWorld(world, chunks);
  const actors = actorsOf(chunks.flatMap((c) => c.npcs), grid, built.place);
  const doors: Door[] = built.doors.map((d) => {
    const room = rooms.get(d.to)!;
    return {
      name: `door:${d.to}`,
      tile: tileOf(d.tile),
      step: d.step,
      to: d.to,
      // One arrives a step in from the room's door, facing in.
      arrive: { x: room.entry[0], z: room.entry[1] - 1 },
      arriveFacing: [0, -1],
      at: new THREE.Vector3(...d.at),
    };
  });
  return { id: "street", title: town.name, inside: false, turns: true, place: built.place, scene: built.place.scene, grid, doors, actors, start: tileOf(town.center), bounds: built.bounds };
}

function buildRoom(id: SceneId): SliceScene {
  const room = rooms.get(id)!;
  const built = assembleInterior(room);
  const grid = gridOfInterior(room);
  const actors = actorsOf(room.npcs, grid, built.place);
  // Out through the room's door onto the world's tile before the building's door, facing out of the building.
  const building = chunks.flatMap((c) => c.buildings).find((b) => b.interior === id && b.door?.[0] === room.exit[0] && b.door?.[1] === room.exit[1]);
  const doors: Door[] = [
    {
      name: "door:street",
      tile: tileOf(room.entry),
      step: [0, 1],
      to: "street",
      arrive: tileOf(room.exit),
      arriveFacing: frontStep(building?.rot ?? 0),
      at: new THREE.Vector3(...built.doorway),
    },
  ];
  return { id, title: room.name, inside: true, turns: true, place: built.place, scene: built.place.scene, grid, doors, actors, start: { x: room.entry[0], z: room.entry[1] - 1 }, bounds: built.bounds };
}

const scenes = new Map<SceneId, SliceScene>();
const sceneOf = (id: SceneId) => {
  let s = scenes.get(id);
  if (!s) {
    s = id === "street" ? buildStreet() : buildRoom(id);
    scenes.set(id, s);
  }
  return s;
};

const asked = query.get("scene") ?? "";
const startId: SceneId = rooms.has(asked) ? asked : "street";
let current = sceneOf(startId);
const rig = new CameraRig(
  canvas,
  HEADING_NAMES[query.get("heading") ?? ""] ?? storedHeading() ?? 0,
  askedZoom === 0 || askedZoom === 1 || askedZoom === 2 ? askedZoom : (storedZoom() ?? 0),
  current,
);
const renderer = rig.renderer;
if (query.get("edges") === "0") renderer.setEdges(0, 0);
/** A place's view: the rig's, for the place. */
const viewFor = (s: Framing): View => rig.viewFor(s);

const startAt = query.get("at")?.split(",").map(Number);
const startTile = startAt && startAt.length === 2 ? { x: startAt[0]!, z: startAt[1]! } : current.start;
let player = new Actor(figureSpec("hero"), startTile, current.grid, {}, "player", seeded(7));
player.speed = 4.2;
current.place.addFigure(player.figure.root);
const focus = player.position.clone();
renderer.focus.copy(focus);

// ?cast lines every figure up beside the start, facing the camera (?cast=walk: walking on the spot), to judge them.
const cast: Figure[] = [];
if (query.has("cast")) {
  ["knight", "grizzlegom", "goblin", "townswoman", "skeleton", "ghoul"].map((id) => figureSpec(id)).forEach((spec, i) => {
    const f = new Figure(spec);
    // Two tiles apart, so that seen from a 45-degree heading too each stands clear of the next.
    f.root.position.set(startTile.x + 0.5 + (i < 3 ? -6 + 2 * i : 2 * (i - 2)), 0, startTile.z + 0.5);
    f.root.traverse((o) => (o.castShadow = o.receiveShadow = true));
    current.place.addFigure(f.root);
    cast.push(f);
  });
}

// --- The HUD: the place's name, and how to play. -------------------------------------------------------------------

const style = document.createElement("style");
style.textContent = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
  #world { position: fixed; image-rendering: pixelated; cursor: pointer; }
  .slice-panel { position: fixed; font: 600 15px/1.2 Georgia, serif; color: #f4ecd4; background: #1b1830e8; border: 2px solid #c6b496;
    box-shadow: 0 0 0 2px #140f1e, inset 0 0 0 1px #5e5058; padding: 6px 12px; border-radius: 3px; letter-spacing: .02em; user-select: none; }
  #slice-place { left: 16px; top: 16px; }
  #slice-help { left: 50%; bottom: 14px; transform: translateX(-50%); font-weight: 400; font-size: 13px; color: #e0d2b2; }
  #slice-help b { color: #f8d04c; font-weight: 600; }
  #slice-turns { right: 16px; top: 16px; display: flex; gap: 6px; padding: 4px 6px; }
  #slice-turns button { font: 600 18px/1 Georgia, serif; color: #f4ecd4; background: #2c2840; border: 1px solid #c6b496; border-radius: 3px;
    width: 34px; height: 30px; cursor: pointer; padding: 0; }
  #slice-turns button:hover:not(:disabled) { border-color: #f8d04c; color: #f8d04c; }
  #slice-turns button:disabled { opacity: .35; cursor: default; }
`;
document.head.append(style);
const placeLabel = document.createElement("div");
placeLabel.id = "slice-place";
placeLabel.className = "slice-panel";
const help = document.createElement("div");
help.id = "slice-help";
help.className = "slice-panel";
// The turn buttons: one heading to the left, one to the right.
const turns = document.createElement("div");
turns.id = "slice-turns";
turns.className = "slice-panel";
const turnButton = (step: -1 | 1, glyph: string, label: string) => {
  const button = document.createElement("button");
  button.textContent = glyph;
  button.title = label;
  button.dataset.test = step < 0 ? "slice:turn-left" : "slice:turn-right";
  button.addEventListener("click", () => turn(step));
  turns.append(button);
  return button;
};
const turnLeft = turnButton(-1, "\u27F2", "Turn the camera left (Q)");
const turnRight = turnButton(1, "\u27F3", "Turn the camera right (E)");
const zoomButton = (step: -1 | 1, glyph: string, label: string) => {
  const button = document.createElement("button");
  button.textContent = glyph;
  button.title = label;
  button.dataset.test = step < 0 ? "slice:zoom-in" : "slice:zoom-out";
  button.addEventListener("click", () => zoomBy(step));
  turns.append(button);
  return button;
};
const zoomIn = zoomButton(-1, "+", "Zoom in (+ or the wheel)");
const zoomOut = zoomButton(1, "\u2212", "Zoom out (- or the wheel)");
document.body.append(placeLabel, help, turns);
const showHud = !query.has("nohud");
placeLabel.hidden = help.hidden = turns.hidden = !showHud;
function updateHud(): void {
  placeLabel.textContent = current.title;
  turnLeft.disabled = !current.turns || rig.heading === -1;
  turnRight.disabled = !current.turns || rig.heading === 1;
  zoomIn.disabled = current.inside || rig.zoom === 0;
  zoomOut.disabled = current.inside || rig.zoom === rig.maxZoom();
  help.innerHTML = current.inside
    ? "<b>Click</b> to walk &middot; <b>Q</b> / <b>E</b> turn the camera &middot; walk out the door to leave"
    : "<b>Click</b> or hold to walk &middot; <b>Q</b> / <b>E</b> turn &middot; <b>wheel</b>, <b>+</b> / <b>-</b> zoom &middot; out through the west gate";
}
updateHud();

// --- Going through doors -------------------------------------------------------------------------------------------

interface Transition {
  readonly door: Door;
  readonly from: View;
  t: number;
  phase: "in" | "out";
  readonly focusFrom: THREE.Vector3;
}
let transition: Transition | null = null;
let pendingDoor: Door | null = null;
const IN = 0.55;
const OUT = 0.45;

function startDoor(door: Door): void {
  pendingDoor = null;
  // Going through ends a hold: in the next room the button must be pressed again.
  hold = null;
  // A camera turn under way gives way to the doorway's own easing, which starts from wherever the camera is.
  rig.halt();
  player.walkTo(centre(door.tile).add(new THREE.Vector3(door.step[0] * 0.9, 0, door.step[1] * 0.9)));
  transition = { door, from: renderer.view, t: 0, phase: "in", focusFrom: focus.clone() };
}

function arrive(door: Door): void {
  current.place.removeFigure(player.figure.root);
  current = sceneOf(door.to);
  const next = new Actor(figureSpec("hero"), door.arrive, current.grid, {}, "player", seeded(7));
  next.speed = player.speed;
  player = next;
  // Out of the doorway a step, then onto the tile.
  const back = centre(door.arrive).add(new THREE.Vector3(-door.arriveFacing[0] * 0.8, 0, -door.arriveFacing[1] * 0.8));
  player.position.copy(back);
  player.figure.face(door.arriveFacing[0], door.arriveFacing[1]);
  player.walkTo(centre(door.arrive));
  current.place.addFigure(player.figure.root);
  focus.copy(rig.clampFocus(player.position, current));
  updateHud();
}


function stepTransition(dt: number): void {
  const tr = transition;
  if (!tr) return;
  tr.t += dt;
  if (tr.phase === "in") {
    const k = Math.min(1, tr.t / IN);
    // The camera eases towards where it will be on the other side (into the room's view going in), closing on the door.
    const target = viewFor(sceneOf(tr.door.to));
    renderer.setView(blendViews(tr.from, current.inside && !sceneOf(tr.door.to).inside ? tr.from : target, k));
    focus.lerpVectors(tr.focusFrom, tr.door.at.clone().setY(0), k * k);
    renderer.iris = { at: tr.door.at, radius: Math.max(0, (1 - k) * 260) };
    if (k >= 1) {
      arrive(tr.door);
      transition = { door: tr.door, from: renderer.view, t: 0, phase: "out", focusFrom: focus.clone() };
    }
  } else {
    const k = Math.min(1, tr.t / OUT);
    renderer.setView(blendViews(tr.from, viewFor(current), k));
    renderer.iris = { at: player.position.clone().setY(0.7), radius: k * 280 };
    if (k >= 1) {
      renderer.iris = null;
      renderer.setView(viewFor(current));
      transition = null;
    }
  }
}

// --- The camera ------------------------------------------------------------------------------------------------------

/** Steps the outdoor zoom out (+1) or in (-1); in a room, or past the last step, it does nothing. */
function zoomBy(step: -1 | 1): void {
  if (transition || !rig.zoomBy(step, current)) return;
  try {
    localStorage.setItem(ZOOM_KEY, String(rig.zoom));
  } catch {
    // Storage refused: the step lasts this visit only.
  }
  const url = new URL(location.href);
  url.searchParams.set("zoom", String(rig.zoom));
  history.replaceState(null, "", url);
  updateHud();
}

/** Steps the camera one heading left or right; a step past 45 degrees, or in a room that does not turn, does nothing. */
function turn(step: -1 | 1): void {
  if (transition || !rig.turn(step, current)) return;
  try {
    localStorage.setItem(HEADING_KEY, NAME_OF[rig.heading]);
  } catch {
    // Storage refused (a private window, blocked site data): the heading lasts this visit only.
  }
  const url = new URL(location.href);
  url.searchParams.set("heading", NAME_OF[rig.heading]);
  history.replaceState(null, "", url);
  updateHud();
}

// --- Input -------------------------------------------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
/** The tile under a point on the page: the first thing the ray meets, read a hair towards the camera. */
function tileAt(x: number, y: number): { x: number; z: number } | null {
  const ray = renderer.rayAt(x, y);
  raycaster.ray.copy(ray);
  const hits = raycaster.intersectObjects(current.scene.children, true).filter((h) => !isFigure(h.object));
  const hit = hits[0];
  let point: THREE.Vector3 | null = null;
  if (hit && hit.point.y < 3.2) point = hit.point.clone().addScaledVector(ray.direction, -0.02);
  if (!point) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    point = ray.intersectPlane(plane, new THREE.Vector3());
  }
  if (!point) return null;
  return { x: Math.floor(point.x), z: Math.floor(point.z) };
}

function isFigure(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === player.figure.root || current.actors.some((a) => a.figure.root === p)) return true;
  return false;
}

/** Walks to a tile; a door's tile (or the doorway itself) walks there and goes through. */
function clickTile(tile: { x: number; z: number }): void {
  if (transition) return;
  const door = current.doors.find((d) => (d.tile.x === tile.x && d.tile.z === tile.z) || (d.tile.x + d.step[0] === tile.x && d.tile.z + d.step[1] === tile.z));
  if (door) {
    pendingDoor = door;
    if (player.tile.x === door.tile.x && player.tile.z === door.tile.z && !player.moving) startDoor(door);
    else if (!player.goTo(door.tile)) pendingDoor = null;
    return;
  }
  pendingDoor = null;
  const to = reachableNear(tile, 2);
  if (to) player.goTo(to);
}

/**
 * The tile to walk to for a tile pointed at: itself if one can stand there, else the open tile nearest it within
 * `reach` - of those equally near, the one nearest the player, so a walk heads for the near side of what is in the way.
 */
function reachableNear(tile: { x: number; z: number }, reach: number): { x: number; z: number } | null {
  if (current.grid.walkable(tile.x, tile.z)) return tile;
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  const me = player.tile;
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const t = { x: tile.x + dx, z: tile.z + dz };
      const d = Math.hypot(dx, dz) + 0.01 * Math.hypot(t.x - me.x, t.z - me.z);
      if (current.grid.walkable(t.x, t.z) && d < bestD) {
        best = t;
        bestD = d;
      }
    }
  }
  return best;
}

// --- Holding the button: walking after the cursor ---------------------------------------------------------------------
//
// A press is a click as it always was. Held, it becomes a drag once the pointer reaches another tile or has been down
// HOLD_AFTER seconds. From then the player is re-aimed at the tile under the cursor the moment that tile is more than
// REPATH_DISTANCE tiles from where the current path goes - measured from that path-to tile, not from the player - so a
// fast sweep is answered at once, on the very event that crosses the distance; and every RETARGET_EVERY seconds besides,
// for a cursor drifting slowly (or the view moving under a still one). So the walk always heads where the cursor is now,
// at every heading and while the camera turns, follows or zooms. Re-aiming keeps the step being walked (Actor.retarget): no snap, no
// restarted stride. A cursor over something blocked walks to the open tile nearest it. A held walk goes up to a door but
// never through it - only a click goes in (a press on the door, or holding still on it) - so sweeping past the shop
// never pulls you inside. Letting go of a drag (or the cursor leaving the window, or the window losing focus) finishes
// the step under way and stops there.

const HOLD_AFTER = 0.3;
const RETARGET_EVERY = 0.1;
const REPATH_DISTANCE = 1.25;
let hold: {
  x: number;
  y: number;
  tile: string;
  since: number;
  last: number;
  dragging: boolean;
  /** Where the current path goes: the tile the last re-aim chose. */
  target: { x: number; z: number } | null;
} | null = null;
const tileKey = (t: { x: number; z: number } | null) => (t ? `${t.x},${t.z}` : "");

function holdStep(): void {
  if (!hold || transition) return;
  hold.last = time;
  const pointed = tileAt(hold.x, hold.y);
  if (!pointed) return;
  // Holding still on the door clicked keeps going in; anywhere else, the held walk only walks.
  if (pendingDoor && isDoorTile(pointed)) return;
  pendingDoor = null;
  const to = reachableNear(pointed, 4);
  if (to) {
    player.retarget(to);
    hold.target = to;
  }
}

function release(): void {
  if (!hold) return;
  if (hold.dragging && !transition && !pendingDoor) player.stopAfterStep();
  hold = null;
}

window.addEventListener("pointermove", (e) => {
  if (!hold) return;
  // A release missed outside the window ends the hold all the same.
  if ((e.buttons & 1) === 0) return release();
  hold.x = e.clientX;
  hold.y = e.clientY;
  const under = floorTileAt(e.clientX, e.clientY);
  if (!hold.dragging && tileKey(under) !== hold.tile) hold.dragging = true;
  if (!hold.dragging || !under) return;
  const from = hold.target;
  if (!from || Math.hypot(under.x - from.x, under.z - from.z) > REPATH_DISTANCE) holdStep();
});
window.addEventListener("pointerup", (e) => {
  if (e.button === 0) release();
});
window.addEventListener("blur", release);
document.documentElement.addEventListener("pointerleave", release);

function stepHold(): void {
  if (!hold) return;
  if (!hold.dragging && time - hold.since >= HOLD_AFTER) hold.dragging = true;
  if (hold.dragging && time - hold.last >= RETARGET_EVERY) holdStep();
}

/** The tile on the floor under a point on the page, whatever stands in front of it. */
function floorTileAt(x: number, y: number): { x: number; z: number } | null {
  const point = renderer.rayAt(x, y).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  return point ? { x: Math.floor(point.x), z: Math.floor(point.z) } : null;
}

const isDoorTile = (t: { x: number; z: number } | null) =>
  !!t && current.doors.some((d) => (d.tile.x === t.x && d.tile.z === t.z) || (d.tile.x + d.step[0] === t.x && d.tile.z + d.step[1] === t.z));

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  // A doorway seen past the corner of a wall (the camera swung round) still takes you through it.
  const floor = floorTileAt(e.clientX, e.clientY);
  const tile = isDoorTile(floor) ? floor : tileAt(e.clientX, e.clientY);
  if (tile) clickTile(tile);
  hold = { x: e.clientX, y: e.clientY, tile: tileKey(floor), since: time, last: time, dragging: false, target: tile };
});

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "q" || e.key === "Q") turn(-1);
  if (e.key === "e" || e.key === "E") turn(1);
  if (e.key === "+" || e.key === "=") zoomBy(-1);
  if (e.key === "-" || e.key === "_") zoomBy(1);
});
// The wheel: a notch (or a trackpad's worth of scrolling) a step, and no faster than a step per easing.
let wheelAt = -Infinity;
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (Math.abs(e.deltaY) < 1 || time - wheelAt < ZOOM_EASE * 0.6) return;
    wheelAt = time;
    zoomBy(e.deltaY > 0 ? 1 : -1);
  },
  { passive: false },
);
window.addEventListener("resize", () => renderer.setView(transition || rig.turning ? { ...renderer.view, scale: viewFor(current).scale } : viewFor(current)));

// --- The loop --------------------------------------------------------------------------------------------------------

let last = performance.now();
let time = 0;
/** With ?manual the clock stands still until a test advances it (sliceTest.advance), so clips are evenly timed. */
const manual = query.has("manual");
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!manual) tick(dt);
  renderer.render(current.scene);
  requestAnimationFrame(frame);
}

/** How far figures lean back from the camera (characters.ts, setLean), at every heading. */
const LEAN = (25 * Math.PI) / 180;

function tick(dt: number): void {
  time += dt;
  for (const f of cast) f.update(dt, query.get("cast") === "walk" ? 3 : 0);
  stepHold();
  player.update(dt);
  if (pendingDoor && !player.moving && player.tile.x === pendingDoor.tile.x && player.tile.z === pendingDoor.tile.z) startDoor(pendingDoor);
  for (const a of current.actors) {
    if (still) a.figure.update(dt, 0);
    else a.update(dt, player);
  }
  stepTransition(dt);
  if (!transition) rig.stepTurn(dt, current);
  if (!transition) rig.stepZoom(dt);
  if (!transition) renderer.snap = rig.settled;
  current.place.update(time, renderer.view.yaw, viewFor(current).yaw);
  current.place.follow(player.position);
  if (!transition) {
    const target = rig.clampFocus(player.position, current);
    focus.lerp(target, Math.min(1, dt * 8));
  }
  renderer.focus.copy(focus);
  // Every figure leans for the camera as it is this frame, so the lean turns with the camera and never lags it.
  const { pitch, yaw } = renderer.view;
  for (const f of [player.figure, ...current.actors.map((a) => a.figure), ...cast]) f.setLean(LEAN, pitch, yaw);
}
requestAnimationFrame(frame);

// --- Test hooks ------------------------------------------------------------------------------------------------------

if (query.has("test")) {
  const screen = (p: THREE.Vector3) => renderer.toScreen(p);
  (globalThis as Record<string, unknown>).sliceTest = {
    ready: true,
    get scene() {
      return current.id;
    },
    /** The heading: "left", "front" or "right". */
    get heading() {
      return NAME_OF[rig.heading];
    },
    /** The camera as it is now (its turn and pitch, radians), and whether it has settled into its view. */
    get view() {
      return { yaw: renderer.view.yaw, pitch: renderer.view.pitch, snapped: renderer.snap, scale: renderer.view.scale };
    },
    /** Whether the button is held down walking the player after the cursor. */
    get dragging() {
      return hold?.dragging ?? false;
    },
    get cameraSettled() {
      return rig.settled && transition === null;
    },
    /** The outdoor zoom step, and the screen pixels to each scene pixel now. */
    get zoom() {
      return { step: rig.zoom, scale: renderer.view.scale, steps: rig.maxZoom() + 1 };
    },
    zoomBy,
    get transitioning() {
      return transition !== null;
    },
    get player() {
      const s = screen(player.position.clone().setY(0.4));
      return { tile: player.tile, moving: player.moving, x: s.x, y: s.y, at: { x: player.position.x, z: player.position.z }, goal: player.goal };
    },
    /** Where a tile's middle is on the page. */
    tile(x: number, z: number) {
      return screen(centre({ x, z }));
    },
    walkable(x: number, z: number) {
      return current.grid.walkable(x, z);
    },
    get entities() {
      return [
        ...current.doors.map((d) => ({ name: d.name, kind: "door", to: d.to, tile: d.tile, ...screen(centre(d.tile)) })),
        ...current.actors.map((a) => ({ name: a.name, kind: "figure", tile: a.tile, moving: a.moving, ...screen(a.position.clone().setY(0.4)) })),
      ];
    },
    turn,
    /** Moves the clock on by some seconds, in steps of a sixtieth (with ?manual). */
    advance(seconds: number) {
      for (let t = 0; t < seconds - 1e-6; t += 1 / 60) tick(1 / 60);
    },
    /**
     * Renders a frame now and returns the middle `w` by `h` of the window as it is shown - the scene's pixels at the
     * screen's scale - so a clip shows the zoom (base64 RGBA, top row first).
     */
    shown(w: number, h: number) {
      renderer.render(current.scene);
      const rect = canvas.getBoundingClientRect();
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const g = out.getContext("2d")!;
      g.imageSmoothingEnabled = false;
      g.fillStyle = "#000";
      g.fillRect(0, 0, w, h);
      g.drawImage(canvas, rect.left - (window.innerWidth - w) / 2, rect.top - (window.innerHeight - h) / 2, rect.width, rect.height);
      const data = g.getImageData(0, 0, w, h).data;
      let s = "";
      for (let i = 0; i < data.length; i += 8192) s += String.fromCharCode(...data.subarray(i, i + 8192));
      return { width: w, height: h, rgba: btoa(s) };
    },
    /** Renders a frame now and returns its scene pixels (base64 RGBA, top row first). */
    frame() {
      const { width, height, rgba } = renderer.readFrame(current.scene);
      let s = "";
      for (let i = 0; i < rgba.length; i += 8192) s += String.fromCharCode(...rgba.subarray(i, i + 8192));
      return { width, height, rgba: btoa(s) };
    },
  };
} else {
  (globalThis as Record<string, unknown>).sliceTest = { ready: true };
}
