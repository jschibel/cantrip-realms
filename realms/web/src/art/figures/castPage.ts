import * as THREE from "three";
import type { ChunkData, TileData, WorldData } from "../../world/format";
import { CameraRig, type Framing, HEADING_NAMES, NAME_OF } from "../../render/camera";
import { assembleWorld } from "../../render/assemble";
import { seeded } from "../paint/pixmap";
import { CAST_SETS, type CastEntry } from "./catalogue";
import { Figure } from "./rig";

// The cast (cast.html, dev only): every body, palette, gear part, creature, boss and townsperson the figures registry
// makes, stood in rows on the world's grounds and seen through the game's own camera, to judge them at every heading
// and zoom step, standing, walking, casting or reaching out.
//
//   ?set=bodies|palettes|identities|gear|parts|creatures|roster|bosses|mages|npcs   what to show (bodies by default)
//   ?page=n           a set's figures a page at a time (`perPage` of them; ?per=n to change it)
//   ?heading=left|front|right   ?zoom=0|1|2   the camera, as the game's
//   ?walk             walking on the spot      ?act=cast|interact   acting, again and again
//   ?ground=grass|cobbles|dirt|...   one ground for every row (otherwise each row its own)
//   ?manual           the clock moves only when a test advances it (castTest.advance)
//   ?test             publishes globalThis.castTest; ?nolabels hides the names

THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const setName = query.get("set") ?? "bodies";
const set = CAST_SETS[setName] ?? CAST_SETS.bodies!;
const per = Number(query.get("per") ?? set.perPage);
const page = Number(query.get("page") ?? 0);
const entries: readonly CastEntry[] = set.entries().slice(page * per, page * per + per);
const cols = Math.min(set.columns, Math.max(1, entries.length));
const rowsOf = Math.max(1, Math.ceil(entries.length / cols));
const gapX = set.spacing;
const gapZ = set.spacing + 1;
const GROUNDS = ["grass", "cobbles", "dirt", "flagstones", "straw", "furrows"];

// A small world: a ground of rows, each row of figures on its own surface, a margin of grass round it.
const width = cols * gapX + 8;
const depth = rowsOf * gapZ + 8;
const chunk = 32;
const cw = Math.ceil(width / chunk);
const cd = Math.ceil(depth / chunk);
const world = { size: [cw * chunk, cd * chunk], chunk, tile: 1, bounds: [0, 0, width, depth], regions: [], towns: [], inns: [], dungeons: [], roads: [], ferries: [], pitches: [], zones: { cell: 8, tiers: [] }, overview: {} } as unknown as WorldData;
const ground = query.get("ground");
const chunks: ChunkData[] = [];
for (let cz = 0; cz < cd; cz++) {
  for (let cx = 0; cx < cw; cx++) {
    const tiles: TileData[] = [];
    for (let z = 0; z < chunk; z++) {
      for (let x = 0; x < chunk; x++) {
        const wz = cz * chunk + z;
        const row = Math.floor((wz - 4) / gapZ);
        const inside = row >= 0 && row < rowsOf && cx * chunk + x >= 2 && cx * chunk + x < width - 2;
        const surface = ground ?? (inside ? GROUNDS[row % GROUNDS.length]! : "grass");
        tiles.push([0, surface, 0] as unknown as TileData);
      }
    }
    chunks.push({ cx, cz, tiles, props: [], buildings: [], npcs: [], spawns: [], chests: [], entrances: [], waymarkers: [] });
  }
}
const built = assembleWorld(world, chunks);
const place = built.place;
const framing: Framing = { inside: false, turns: true, bounds: [0, 0, width, depth] };
const rig = new CameraRig(canvas, HEADING_NAMES[query.get("heading") ?? ""] ?? 0, Number(query.get("zoom") ?? 0), framing);
const renderer = rig.renderer;
renderer.setView(rig.viewFor(framing));
renderer.focus.set(width / 2, 0, depth / 2);
window.addEventListener("resize", () => renderer.setView(rig.viewFor(framing)));

// The figures, in rows from the back, each facing the camera (?face=front|angle|side|back; a set's own by default).
const facing = query.get("face") ?? set.facing ?? "front";
const random = seeded(17);
const realRandom = Math.random;
Math.random = random;
const figures: { entry: CastEntry; figure: Figure; at: THREE.Vector3 }[] = entries.map((entry, i) => {
  const figure = new Figure(entry.spec());
  const at = new THREE.Vector3(4 + (i % cols) * gapX + gapX / 2, 0, 4 + Math.floor(i / cols) * gapZ + gapZ / 2);
  figure.root.position.copy(at);
  // People face the camera; beasts are turned a little, so their length shows.
  const turn = facing === "front" ? 0 : facing === "side" ? Math.PI / 2 : facing === "back" ? Math.PI : 0.75;
  figure.face(Math.sin(turn), Math.cos(turn));
  figure.update(1, 0);
  figure.root.traverse((o) => (o.castShadow = o.receiveShadow = true));
  place.addFigure(figure.root);
  return { entry, figure, at };
});
Math.random = realRandom;

// Names under the figures.
const labels = !query.has("nolabels");
const style = document.createElement("style");
style.textContent = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
  #world { position: fixed; image-rendering: pixelated; }
  .cast-label { position: fixed; transform: translate(-50%, 0); font: 600 11px/1.1 Georgia, serif; color: #f4ecd4; background: #1b1830d0;
    padding: 1px 5px; border-radius: 2px; white-space: nowrap; pointer-events: none; }
  #cast-title { position: fixed; left: 12px; top: 10px; font: 600 15px/1.2 Georgia, serif; color: #f4ecd4; background: #1b1830e8; border: 2px solid #c6b496; padding: 4px 10px; }
`;
document.head.append(style);
const title = document.createElement("div");
title.id = "cast-title";
title.textContent = `${set.title}${set.entries().length > per ? ` (${page + 1}/${Math.ceil(set.entries().length / per)})` : ""} - ${NAME_OF[rig.heading]}`;
if (labels) document.body.append(title);
const labelEls = figures.map(({ entry }) => {
  const el = document.createElement("div");
  el.className = "cast-label";
  el.textContent = entry.label;
  if (labels) document.body.append(el);
  return el;
});

const LEAN = (25 * Math.PI) / 180;
const walking = query.has("walk");
const action = query.get("act");
let time = 0;
function tick(dt: number): void {
  time += dt;
  for (const { figure } of figures) {
    if (action === "cast" || action === "interact") {
      if (!figure.acting) figure.act(action, action === "cast" ? 1.6 : 1.0);
    }
    figure.update(dt, walking ? 3 : 0);
  }
  rig.stepTurn(dt, framing);
  rig.stepZoom(dt);
  renderer.snap = rig.settled;
  place.update(time, renderer.view.yaw, rig.viewFor(framing).yaw);
  const { pitch, yaw } = renderer.view;
  for (const { figure } of figures) figure.setLean(LEAN, pitch, yaw);
}

function placeLabels(): void {
  figures.forEach(({ at }, i) => {
    const s = renderer.toScreen(at.clone().setZ(at.z + 0.6));
    const el = labelEls[i]!;
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y + 4}px`;
  });
}

const manual = query.has("manual");
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!manual) tick(dt);
  renderer.render(place.scene);
  placeLabels();
  requestAnimationFrame(frame);
}
tick(0);
requestAnimationFrame(frame);

window.addEventListener("keydown", (e) => {
  if (e.key === "q" || e.key === "Q") rig.turn(-1, framing);
  if (e.key === "e" || e.key === "E") rig.turn(1, framing);
  if (e.key === "+" || e.key === "=") rig.zoomBy(-1, framing);
  if (e.key === "-") rig.zoomBy(1, framing);
});

(globalThis as Record<string, unknown>).castTest = query.has("test")
  ? {
      ready: true,
      set: setName,
      count: set.entries().length,
      pages: Math.ceil(set.entries().length / per),
      get heading() {
        return NAME_OF[rig.heading];
      },
      get figures() {
        return figures.map(({ entry, figure, at }) => ({ id: entry.id, label: entry.label, parts: figure.spec.parts.length, height: figure.height, ...renderer.toScreen(at.clone().setY(0.6)) }));
      },
      act(kind: "cast" | "interact") {
        for (const { figure } of figures) figure.act(kind);
      },
      advance(seconds: number) {
        for (let t = 0; t < seconds - 1e-6; t += 1 / 60) tick(1 / 60);
      },
      frame() {
        const { width: w, height: h, rgba } = renderer.readFrame(place.scene);
        let s = "";
        for (let i = 0; i < rgba.length; i += 8192) s += String.fromCharCode(...rgba.subarray(i, i + 8192));
        return { width: w, height: h, rgba: btoa(s) };
      },
    }
  : { ready: true };
