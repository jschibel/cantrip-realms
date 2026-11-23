import * as THREE from "three";
import { hero } from "./characters";
import { seeded } from "./pixmap";
import { ISOMETRIC, SliceRenderer, THREE_QUARTER, type View, blendViews } from "./renderer";
import { buildCrypt } from "./scenes/crypt";
import { buildShop } from "./scenes/shop";
import { buildStreet } from "./scenes/street";
import { Actor, type Door, type SceneId, type SliceScene, centre } from "./world";

// The art slice (slice.html): New Benalia's street, Grizzlegom's Goblins inside, and a crypt below the churchyard, in
// the 3D pixel-art look - a real 3D scene drawn small and shown in big pixels, on square tiles, seen as a 16-bit RPG
// sees its towns and rooms. Click to walk; walk through a door to go in or out.
//
//   ?outside=iso|34   the street's camera: isometric or three-quarter (V switches it live)
//   ?scene=street|shop|crypt   where to start; ?at=x,z the tile
//   ?test             publishes globalThis.sliceTest (screen places of everything, the state, a frame reader)
//   ?still            the townsfolk stand still (for screenshots)
//   ?edges=0          no outlines or edge highlights, to compare

THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const still = query.has("still");

let outside: "iso" | "34" = query.get("outside") === "iso" ? "iso" : "34";
const outsideScale = () => Math.max(2, Math.round(window.innerHeight / 270));
const viewFor = (s: SliceScene): View =>
  s.inside ? { ...THREE_QUARTER, scale: outsideScale() + 1 } : { ...(outside === "iso" ? ISOMETRIC : THREE_QUARTER), scale: outsideScale() };

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
`;
document.head.append(style);
const placeLabel = document.createElement("div");
placeLabel.id = "slice-place";
placeLabel.className = "slice-panel";
const help = document.createElement("div");
help.id = "slice-help";
help.className = "slice-panel";
document.body.append(placeLabel, help);
const showHud = !query.has("nohud");
placeLabel.hidden = help.hidden = !showHud;
function updateHud(): void {
  placeLabel.textContent = current.title;
  help.innerHTML = current.inside
    ? "<b>Click</b> to walk &middot; walk out the door to leave"
    : `<b>Click</b> to walk &middot; <b>V</b> camera: ${outside === "iso" ? "isometric" : "three-quarter"} &middot; the green door and the crypt gate go in`;
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

/** Keeps the camera's focus where the view stays on the scene's ground: a room smaller than the view is centred. */
function clampFocus(p: THREE.Vector3): THREE.Vector3 {
  const [x0, z0, x1, z1] = current.bounds;
  const v = renderer.view;
  if (v.yaw !== 0) return p.clone();
  const halfX = (renderer.width * v.wppX) / 2;
  const halfZ = (renderer.height * v.wppY) / Math.sin(v.pitch) / 2;
  const clamp = (value: number, lo: number, hi: number) => (hi - lo < 0 ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, value)));
  // Tall things at the back of a room stand above its floor: let the view reach up over them.
  const lift = current.inside ? 1.6 : 0;
  return new THREE.Vector3(clamp(p.x, x0 + halfX, x1 - halfX), 0, clamp(p.z, z0 - lift + halfZ, z1 - halfZ));
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
  if (current.grid.walkable(tile.x, tile.z)) {
    player.goTo(tile);
    return;
  }
  // A blocked tile: the nearest open one round it.
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const t = { x: tile.x + dx, z: tile.z + dz };
      const d = Math.hypot(dx, dz);
      if (current.grid.walkable(t.x, t.z) && d < bestD) {
        best = t;
        bestD = d;
      }
    }
  }
  if (best) player.goTo(best);
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const tile = tileAt(e.clientX, e.clientY);
  if (tile) clickTile(tile);
});

function setOutside(mode: "iso" | "34"): void {
  outside = mode;
  if (!current.inside && !transition) renderer.setView(viewFor(current));
  const url = new URL(location.href);
  url.searchParams.set("outside", mode);
  history.replaceState(null, "", url);
  updateHud();
}

window.addEventListener("keydown", (e) => {
  if (e.key === "v" || e.key === "V") setOutside(outside === "iso" ? "34" : "iso");
});
window.addEventListener("resize", () => renderer.setView(transition ? renderer.view : viewFor(current)));

// --- The loop --------------------------------------------------------------------------------------------------------

let last = performance.now();
let time = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  renderer.render(current.scene);
  requestAnimationFrame(frame);
}

function tick(dt: number): void {
  time += dt;
  player.update(dt);
  if (pendingDoor && !player.moving && player.tile.x === pendingDoor.tile.x && player.tile.z === pendingDoor.tile.z) startDoor(pendingDoor);
  for (const a of current.actors) {
    if (still) a.figure.update(dt, 0);
    else a.update(dt, player);
  }
  current.update(dt, time);
  stepTransition(dt);
  if (!transition) {
    const target = clampFocus(player.position);
    focus.lerp(target, Math.min(1, dt * 8));
  }
  renderer.focus.copy(focus);
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
    get outside() {
      return outside;
    },
    get transitioning() {
      return transition !== null;
    },
    get player() {
      const s = screen(player.position.clone().setY(0.4));
      return { tile: player.tile, moving: player.moving, x: s.x, y: s.y };
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
    setOutside,
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
