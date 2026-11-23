import * as THREE from "three";
import { Figure, ghoul, goblin, hero, knight, skeleton, townswoman } from "./characters";
import { seeded } from "./pixmap";
import { SliceRenderer, THREE_QUARTER, type View, blendViews } from "./renderer";
import { buildCrypt } from "./scenes/crypt";
import { buildShop } from "./scenes/shop";
import { buildStreet } from "./scenes/street";
import { Actor, type Door, type SceneId, type SliceScene, centre } from "./world";

// The art slice (slice.html): New Benalia's street, Grizzlegom's Goblins inside, and a crypt below the churchyard, in
// the 3D pixel-art look - a real 3D scene drawn small and shown in big pixels, on square tiles, seen as a 16-bit RPG
// sees its towns and rooms. Click to walk; walk through a door to go in or out.
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

/**
 * The camera's three headings: -1 swung 45 degrees round to the left (looking north-east from the south-west), 0 looking
 * north as a 16-bit RPG does, 1 swung to the right (looking north-west from the south-east). Never further: past 45
 * degrees walls and signs would be seen from the side and then from behind, and nothing is made to be seen so.
 */
type Heading = -1 | 0 | 1;
const HEADING_NAMES: Record<string, Heading> = { left: -1, front: 0, right: 1 };
const NAME_OF: Record<Heading, string> = { [-1]: "left", 0: "front", 1: "right" };
/** Where the heading is kept between visits. Storage may be refused: then it lasts the visit. */
const HEADING_KEY = "cantrip-realms.slice.heading";
function storedHeading(): Heading | null {
  try {
    return HEADING_NAMES[localStorage.getItem(HEADING_KEY) ?? ""] ?? null;
  } catch {
    return null;
  }
}
let heading: Heading = HEADING_NAMES[query.get("heading") ?? ""] ?? storedHeading() ?? 0;
const outsideScale = () => Math.max(2, Math.round(window.innerHeight / 270));

/**
 * The outdoor zoom: how many steps out from the closest view. A step changes only the screen's whole-pixel scale - one
 * screen pixel fewer to each of the scene's - never the art: a texel is still one scene pixel, crisp, with no shimmer.
 * Two steps out at most, and never below one screen pixel to a scene pixel.
 */
type Zoom = 0 | 1 | 2;
const ZOOM_KEY = "cantrip-realms.slice.zoom";
const maxZoom = (): Zoom => Math.max(0, Math.min(2, outsideScale() - 1)) as Zoom;
function storedZoom(): Zoom | null {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY) ?? "x");
    return v === 0 || v === 1 || v === 2 ? v : null;
  } catch {
    return null;
  }
}
const askedZoom = Number(query.get("zoom") ?? "x");
let zoom: Zoom = Math.min(maxZoom(), askedZoom === 0 || askedZoom === 1 || askedZoom === 2 ? askedZoom : (storedZoom() ?? 0)) as Zoom;
const outdoorScale = () => Math.max(1, outsideScale() - zoom);

/** A scene's view: the three-quarter camera at the heading (where the scene turns); rooms closest, outdoors at the zoom. */
const viewFor = (s: SliceScene): View => ({
  ...THREE_QUARTER,
  yaw: (s.turns ? heading : 0) * (Math.PI / 4),
  scale: s.inside ? outsideScale() + 1 : outdoorScale(),
});

const builders: Record<SceneId, () => SliceScene> = { street: () => buildStreet(), shop: () => buildShop(), crypt: () => buildCrypt() };
const scenes = new Map<SceneId, SliceScene>();
const sceneOf = (id: SceneId) => {
  let s = scenes.get(id);
  if (!s) {
    s = builders[id]();
    scenes.set(id, s);
  }
  return s;
};

const startId = (["street", "shop", "crypt"] as const).find((id) => id === query.get("scene")) ?? "street";
let current = sceneOf(startId);
const renderer = new SliceRenderer(canvas, viewFor(current));
if (query.get("edges") === "0") renderer.setEdges(0, 0);

const startAt = query.get("at")?.split(",").map(Number);
const startTile = startAt && startAt.length === 2 ? { x: startAt[0]!, z: startAt[1]! } : current.start;
let player = new Actor(hero(), startTile, current.grid, {}, "player", seeded(7));
player.speed = 4.2;
current.scene.add(player.figure.root);
const focus = player.position.clone();
renderer.focus.copy(focus);

// ?cast lines every figure up beside the start, facing the camera (?cast=walk: walking on the spot), to judge them.
const cast: Figure[] = [];
if (query.has("cast")) {
  [knight(), goblin(true), goblin(false), townswoman(), skeleton(), ghoul()].forEach((spec, i) => {
    const f = new Figure(spec);
    f.root.position.set(startTile.x + 0.5 + (i < 3 ? -3 + i : i - 2), 0, startTile.z + 0.5);
    f.root.traverse((o) => (o.castShadow = o.receiveShadow = true));
    current.scene.add(f.root);
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
  turnLeft.disabled = !current.turns || heading === -1;
  turnRight.disabled = !current.turns || heading === 1;
  zoomIn.disabled = current.inside || zoom === 0;
  zoomOut.disabled = current.inside || zoom === maxZoom();
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
  turning = false;
  turnSpeed = 0;
  zoomEase = null;
  renderer.snap = true;
  player.walkTo(centre(door.tile).add(new THREE.Vector3(door.step[0] * 0.9, 0, door.step[1] * 0.9)));
  transition = { door, from: renderer.view, t: 0, phase: "in", focusFrom: focus.clone() };
}

function arrive(door: Door): void {
  current.scene.remove(player.figure.root);
  current = sceneOf(door.to);
  const next = new Actor(hero(), door.arrive, current.grid, {}, "player", seeded(7));
  next.speed = player.speed;
  player = next;
  // Out of the doorway a step, then onto the tile.
  const back = centre(door.arrive).add(new THREE.Vector3(-door.arriveFacing[0] * 0.8, 0, -door.arriveFacing[1] * 0.8));
  player.position.copy(back);
  player.figure.face(door.arriveFacing[0], door.arriveFacing[1]);
  player.walkTo(centre(door.arrive));
  current.scene.add(player.figure.root);
  focus.copy(clampFocus(player.position));
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

/**
 * Keeps the camera's focus where the view stays on the scene's ground: a room smaller than the view is centred. Looking
 * north the view is held to the scene's edges; swung round to a corner it looks across them at a slant and follows the
 * player freely; between the two, while the camera turns, the focus slides from one to the other with the turn.
 */
function clampFocus(p: THREE.Vector3): THREE.Vector3 {
  const [x0, z0, x1, z1] = current.bounds;
  const v = renderer.view;
  const halfX = (renderer.width * THREE_QUARTER.wppX) / 2;
  const halfZ = (renderer.height * THREE_QUARTER.wppY) / Math.sin(THREE_QUARTER.pitch) / 2;
  const clamp = (value: number, lo: number, hi: number) => (hi - lo < 0 ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, value)));
  const held = new THREE.Vector3(clamp(p.x, x0 + halfX, x1 - halfX), 0, clamp(p.z, z0 + halfZ, z1 - halfZ));
  const free = Math.min(1, Math.abs(v.yaw) / (Math.PI / 4));
  // Seen from a corner a room is wider than the view: frame it between the player and the room's middle (the back wall
  // included), so the player and most of the room are on screen together.
  const loose = new THREE.Vector3(p.x, 0, p.z);
  if (current.inside) loose.lerp(new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), 0.45);
  return held.lerp(loose, free);
}

/**
 * Turning the camera from one heading to the next: its turn alone eases round about the player - pitch, stretch and
 * zoom stay as they are - as a critically damped spring, so a press mid-turn retargets it without a jolt (it keeps
 * its speed). It glides unsnapped while it turns and snaps to whole pixels once it has settled.
 */
let turning = false;
let turnSpeed = 0;
/** How stiff the turn is: it settles in about 0.45 s. */
const TURN_RATE = 11;

function stepCameraTurn(dt: number): void {
  if (!turning || transition) return;
  const target = viewFor(current).yaw;
  let yaw = renderer.view.yaw;
  for (let i = 0; i < 4; i++) {
    const h = dt / 4;
    turnSpeed += (TURN_RATE * TURN_RATE * (target - yaw) - 2 * TURN_RATE * turnSpeed) * h;
    yaw += turnSpeed * h;
  }
  if (Math.abs(target - yaw) < 2e-4 && Math.abs(turnSpeed) < 3e-3) {
    yaw = target;
    turnSpeed = 0;
    turning = false;
  }
  renderer.setView({ ...renderer.view, yaw });
  renderer.snap = !turning;
}

/**
 * Zooming from one step to another: the scale eases over ZOOM_EASE seconds about the camera's focus (the player, as it
 * follows him), gliding unsnapped, then settles snapped on the step's whole-pixel scale.
 */
let zoomEase: { from: number; t: number } | null = null;
const ZOOM_EASE = 0.35;

function stepZoom(dt: number): void {
  if (!zoomEase || transition) return;
  zoomEase.t += dt;
  const k = Math.min(1, zoomEase.t / ZOOM_EASE);
  const e = k * k * (3 - 2 * k);
  const target = outdoorScale();
  renderer.setView({ ...renderer.view, scale: zoomEase.from + (target - zoomEase.from) * e });
  if (k >= 1) {
    renderer.setView({ ...renderer.view, scale: target });
    zoomEase = null;
  }
}

/** Steps the outdoor zoom out (+1) or in (-1); in a room, or past the last step, it does nothing. */
function zoomBy(step: -1 | 1): void {
  const next = zoom + step;
  if (current.inside || transition || next < 0 || next > maxZoom()) return;
  zoom = next as Zoom;
  try {
    localStorage.setItem(ZOOM_KEY, String(zoom));
  } catch {
    // Storage refused: the step lasts this visit only.
  }
  zoomEase = { from: renderer.view.scale, t: 0 };
  renderer.snap = false;
  const url = new URL(location.href);
  url.searchParams.set("zoom", String(zoom));
  history.replaceState(null, "", url);
  updateHud();
}

/** Steps the camera one heading left or right; a step past 45 degrees, or in a room that does not turn, does nothing. */
function turn(step: -1 | 1): void {
  const next = heading + step;
  if (!current.turns || next < -1 || next > 1 || transition) return;
  heading = next as Heading;
  try {
    localStorage.setItem(HEADING_KEY, NAME_OF[heading]);
  } catch {
    // Storage refused (a private window, blocked site data): the heading lasts this visit only.
  }
  turning = true;
  renderer.snap = false;
  const url = new URL(location.href);
  url.searchParams.set("heading", NAME_OF[heading]);
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
// HOLD_AFTER seconds; from then the player is re-aimed at the tile under the cursor every RETARGET_EVERY seconds, and at
// once whenever the cursor crosses into another tile - so the walk always heads where the cursor is now, at every
// heading and while the camera turns or follows. Re-aiming keeps the step being walked (Actor.retarget): no snap, no
// restarted stride. A cursor over something blocked walks to the open tile nearest it. A held walk goes up to a door but
// never through it - only a click goes in (a press on the door, or holding still on it) - so sweeping past the shop
// never pulls you inside. Letting go of a drag (or the cursor leaving the window, or the window losing focus) finishes
// the step under way and stops there.

const HOLD_AFTER = 0.3;
const RETARGET_EVERY = 0.1;
let hold: { x: number; y: number; tile: string; since: number; last: number; dragging: boolean } | null = null;
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
  if (to) player.retarget(to);
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
  const key = tileKey(floorTileAt(e.clientX, e.clientY));
  if (key !== hold.tile) {
    hold.tile = key;
    hold.dragging = true;
    holdStep();
  }
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
  hold = { x: e.clientX, y: e.clientY, tile: tileKey(floor), since: time, last: time, dragging: false };
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
window.addEventListener("resize", () => renderer.setView(transition || turning ? { ...renderer.view, scale: viewFor(current).scale } : viewFor(current)));

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
  stepCameraTurn(dt);
  stepZoom(dt);
  if (!transition) renderer.snap = !turning && !zoomEase;
  current.update(dt, time, renderer.view.yaw, viewFor(current).yaw);
  current.follow?.(player.position);
  if (!transition) {
    const target = clampFocus(player.position);
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
      return NAME_OF[heading];
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
      return !turning && !zoomEase && transition === null;
    },
    /** The outdoor zoom step, and the screen pixels to each scene pixel now. */
    get zoom() {
      return { step: zoom, scale: renderer.view.scale, steps: maxZoom() + 1 };
    },
    zoomBy,
    get transitioning() {
      return transition !== null;
    },
    get player() {
      const s = screen(player.position.clone().setY(0.4));
      return { tile: player.tile, moving: player.moving, x: s.x, y: s.y, at: { x: player.position.x, z: player.position.z } };
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
