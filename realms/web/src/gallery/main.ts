import * as THREE from "three";
import { BUILDINGS } from "../art/buildings";
import { MeshBuilder, type Model, tiled } from "../art/paint/builder";
import { namedPalette } from "../art/paint/palette";
import { PROPS } from "../art/props";
import type { Built } from "../art/recipe";
import { SURFACES, type SurfaceLook } from "../art/surfaces";
import { CameraRig, type Framing, HEADING_NAMES, NAME_OF, type Zoom } from "../render/camera";
import { grassField } from "../render/grass";
import { buildGround } from "../render/ground";
import { Place } from "../render/place";
import { type Board, boardById, boards } from "./boards";

// The art gallery (gallery.html, dev only): every surface, prop and building style of the art library on small boards,
// drawn as the game draws them - the ground shader with its ragged edges, the standing grass, the sun's bands and
// shadows, the outlines - at the camera's three headings and its zoom steps, for review.
//
//   ?board=<id>                 which board (the menu lists them; [ and ] step through them)
//   ?heading=left|front|right   Q and E turn; ?zoom=0|1|2, the mouse wheel, + and - zoom
//   arrow keys or WASD          move the view; ?focus=x,z looks at a place (tiles)
//   ?test                       publishes globalThis.galleryTest (the boards, the clock, a frame reader)
//   ?far                        props draw their far stand-ins (Built.far), as at the far zoom step (?zoom=2)
//   ?manual                     the clock moves only when a test advances it; ?nolabels hides the names

THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const board = boardById(query.get("board"));
const all = boards();

/** The surfaces a block of tiles uses (at most 16), numbered as met, row by row, with their looks. */
function groundOf(b: Board, x0: number, z0: number, x1: number, z1: number): { ids: number[][]; looks: SurfaceLook[] } {
  const index = new Map<string, number>();
  const looks: SurfaceLook[] = [];
  const ids: number[][] = [];
  for (let z = z0; z < z1; z++) {
    const row: number[] = [];
    for (let x = x0; x < x1; x++) {
      const s = b.ground(x, z);
      let k = index.get(s);
      if (k === undefined) {
        k = looks.length;
        index.set(s, k);
        looks.push(SURFACES.look(s));
      }
      row.push(k);
    }
    ids.push(row);
  }
  return { ids, looks };
}

/** A board's banks: each a surface's `cliff` as a step half a tile high, facing south, as the renderer draws a bank. */
function banksOf(b: Board): Model {
  const m = new MeshBuilder();
  for (const k of b.banks ?? []) {
    const cliff = SURFACES.look(k.surface).cliff;
    if (!cliff) continue;
    m.box(k.x0, 0, k.z - 0.5, k.x1, 0.75, k.z, { south: tiled(cliff), east: tiled(cliff), west: tiled(cliff) });
  }
  return m.model();
}

function buildPlace(b: Board): Place {
  const place = new Place("#1a2a22");
  const blocks = b.blocks ?? [[0, 0, b.w, b.d] as const];
  const under = new MeshBuilder();
  const tuftsOf = new Map<string, number>();
  for (const [x0, z0, x1, z1] of blocks) {
    const { ids, looks } = groundOf(b, x0, z0, x1, z1);
    place.addGround(buildGround(ids, looks.map((l) => ({ picture: l.picture, priority: l.priority, hole: l.hole })), { x: x0, z: z0 }, 0, { x: 0, z: 0 }));
    ids.forEach((row, j) =>
      row.forEach((k, i) => {
        const u = looks[k]!.under;
        if (!u) return;
        const [xa, xb, za, zb] = [x0 + i - u.spread, x0 + i + 1 + u.spread, z0 + j - u.spread, z0 + j + 1 + u.spread];
        under.quad({ mat: u.material }, [[xa, u.y, zb], [xb, u.y, zb], [xb, u.y, za], [xa, u.y, za]], (c) => c[0], (c) => -c[2]);
      }),
    );
  }
  // At the far zoom step (or with ?far) props draw their far stand-ins, as the renderer does there.
  const farAway = query.has("far") || query.get("zoom") === "2";
  const pieces: Built[] = [
    ...b.buildings.map((bd) => BUILDINGS.build(bd.style, bd, namedPalette(bd.palette))),
    ...b.props.map((p) => {
      const built = PROPS.build(p.id, p, namedPalette(p.tint));
      return farAway && built.far ? { ...built, model: built.far } : built;
    }),
    { model: under.model() },
    { model: banksOf(b) },
  ];
  place.addPieces(pieces, "gallery");
  for (const l of b.lights ?? []) place.addLight(l);
  place.addSun(b.w / 2, b.d / 2, Math.ceil(Math.max(b.w, b.d) / 2) + 8);
  place.addGrass(
    grassField(b.w, b.d, { x: 0, z: 0 }, (x, z) => {
      if (b.bare?.(x, z)) return 0;
      const s = b.ground(x, z);
      if (!tuftsOf.has(s)) tuftsOf.set(s, SURFACES.look(s).tufts ?? 0);
      return tuftsOf.get(s)!;
    }),
  );
  return place;
}

const place = buildPlace(board);
const framing: Framing = { inside: false, turns: true, bounds: [-40, -40, board.w + 40, board.d + 40] };
const askedZoom = Number(query.get("zoom") ?? "0");
const rig = new CameraRig(canvas, HEADING_NAMES[query.get("heading") ?? ""] ?? 0, askedZoom === 1 || askedZoom === 2 ? askedZoom : 0, framing);
const renderer = rig.renderer;
const asked = query.get("focus")?.split(",").map(Number);
const focus = new THREE.Vector3(...(asked?.length === 2 && asked.every(Number.isFinite) ? [asked[0]!, 0, asked[1]!] as const : [board.focus?.[0] ?? board.w / 2, 0, board.focus?.[1] ?? board.d / 2] as const));
renderer.focus.copy(focus);

// --- The page round it: the board menu, the labels, the keys -------------------------------------------------------------

const hud = document.createElement("div");
hud.id = "hud";
const menu = document.createElement("select");
for (const b of all) menu.add(new Option(`${b.id} - ${b.title}`, b.id, false, b.id === board.id));
menu.onchange = () => go(menu.value);
const caption = document.createElement("span");
hud.append(menu, caption);
document.body.append(hud);

function go(id: string, params: Record<string, string> = {}): void {
  const q = new URLSearchParams(location.search);
  q.set("board", id);
  q.set("heading", NAME_OF[rig.heading]);
  q.set("zoom", String(rig.zoom));
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  location.search = q.toString();
}

const labels = query.has("nolabels")
  ? []
  : board.labels.map((l) => {
      const el = document.createElement("div");
      el.className = "label";
      el.textContent = l.text;
      document.body.append(el);
      return { el, at: new THREE.Vector3(l.x, l.y ?? 0, l.z) };
    });

function placeLabels(): void {
  for (const l of labels) {
    const s = renderer.toScreen(l.at);
    l.el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, 0)`;
  }
  caption.textContent = `${NAME_OF[rig.heading]} · zoom ${rig.zoom} · Q/E turn · wheel +/- zoom · arrows move · [ ] board`;
}

const held = new Set<string>();
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "q") rig.turn(-1, framing);
  else if (k === "e") rig.turn(1, framing);
  else if (k === "+" || k === "=") rig.zoomBy(-1, framing);
  else if (k === "-") rig.zoomBy(1, framing);
  else if (k === "[" || k === "]") {
    const i = all.findIndex((b) => b.id === board.id);
    go(all[(i + (k === "]" ? 1 : all.length - 1)) % all.length]!.id);
  } else held.add(k);
});
addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
canvas.addEventListener("wheel", (e) => rig.zoomBy(e.deltaY > 0 ? 1 : -1, framing), { passive: true });

// --- The clock ----------------------------------------------------------------------------------------------------------

const manual = query.has("manual");
let time = 0;
let last = performance.now();

function tick(dt: number): void {
  time += dt;
  const speed = 10 * dt;
  const yaw = renderer.view.yaw;
  const move = (dx: number, dz: number) => {
    focus.x += (dx * Math.cos(yaw) + dz * Math.sin(yaw)) * speed;
    focus.z += (-dx * Math.sin(yaw) + dz * Math.cos(yaw)) * speed;
  };
  if (held.has("arrowleft") || held.has("a")) move(-1, 0);
  if (held.has("arrowright") || held.has("d")) move(1, 0);
  if (held.has("arrowup") || held.has("w")) move(0, -1);
  if (held.has("arrowdown") || held.has("s")) move(0, 1);
  rig.stepTurn(dt, framing);
  rig.stepZoom(dt);
  renderer.snap = rig.settled;
  place.update(time, renderer.view.yaw, rig.viewFor(framing).yaw);
  renderer.focus.copy(focus);
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!manual) tick(dt);
  renderer.render(place.scene);
  placeLabels();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Test hooks ---------------------------------------------------------------------------------------------------------

(globalThis as Record<string, unknown>).galleryTest = query.has("test")
  ? {
      ready: true,
      board: board.id,
      boards: all.map((b) => b.id),
      /** The places on this board worth a picture each ([x, z] tiles: ?focus=x,z looks there). */
      views: board.views ?? [[board.focus?.[0] ?? board.w / 2, board.focus?.[1] ?? board.d / 2]],
      get heading() {
        return NAME_OF[rig.heading];
      },
      get zoom(): { step: Zoom; steps: number } {
        return { step: rig.zoom, steps: rig.maxZoom() + 1 };
      },
      get settled() {
        return rig.settled;
      },
      /** Moves the clock on by some seconds, in sixtieths (with ?manual). */
      advance(seconds: number) {
        for (let t = 0; t < seconds - 1e-6; t += 1 / 60) tick(1 / 60);
        renderer.render(place.scene);
        placeLabels();
      },
      /** Renders now and returns the scene's pixels (base64 RGBA, top row first). */
      frame() {
        const { width, height, rgba } = renderer.readFrame(place.scene);
        let s = "";
        for (let i = 0; i < rgba.length; i += 8192) s += String.fromCharCode(...rgba.subarray(i, i + 8192));
        return { width, height, rgba: btoa(s) };
      },
    }
  : { ready: true };
