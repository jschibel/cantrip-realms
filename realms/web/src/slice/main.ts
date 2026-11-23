import * as THREE from "three";
import { Figure, figureSpec } from "../art/figures";
import { seeded } from "../art/paint/pixmap";
import { centre } from "../render/actor";
import { HEADING_NAMES, type Heading, NAME_OF, ZOOM_EASE, type Zoom } from "../render/camera";
import { type BenchLeg, runBench, yieldFrame } from "../render/bench";
import { WalkInput } from "../render/pointer";
import { StreamedWorld, WorldPlaces } from "../render/spots";
import { Stage } from "../render/stage";
import { globSource, loadWorld } from "../world/load";

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
//   ?world=large      the renderer's large synthetic world (fixtures/large-world) instead of the street
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

// The world is streamed round the player (render/chunks.ts), each room built the first time it is needed or ahead of
// time while the player is near its door (render/spots.ts).
// ?world=large is the renderer's large synthetic world instead (fixtures/large-world): 8 by 8 chunks of town, forest,
// hills and lake, for the streaming tests and the benchmark.
const large = query.get("world") === "large";
const source = large
  ? (await import("../../fixtures/large-world/source")).largeSource()
  : globSource(
      () => import("../../fixtures/slice-world/world.json"),
      import.meta.glob("../../fixtures/slice-world/chunks/*.json", { import: "default" }),
      import.meta.glob("../../fixtures/slice-world/interiors/*.json", { import: "default" }),
    );
const world = await loadWorld(source);
const town = world.towns.find((t) => t.start) ?? world.towns[0]!;
const street = new StreamedWorld(world, source, "street", town.name, { x: town.center[0], z: town.center[1] });
const places = new WorldPlaces(street, source);

const asked = query.get("scene") ?? "";
const roomFirst = asked && asked !== "street" ? await places.read(asked).catch(() => null) : null;
const first = roomFirst ? places.room(roomFirst.id, roomFirst) : street;
const startAt = query.get("at")?.split(",").map(Number);
const startTile = startAt && startAt.length === 2 ? { x: startAt[0]!, z: startAt[1]! } : first.start;
const manual = query.has("manual");
const stage = new Stage(canvas, {
  heading: HEADING_NAMES[query.get("heading") ?? ""] ?? storedHeading() ?? 0,
  zoom: askedZoom === 0 || askedZoom === 1 || askedZoom === 2 ? askedZoom : (storedZoom() ?? 0),
  spot: first,
  start: startTile,
  player: figureSpec("hero"),
  random: seeded(7),
  manual,
  spots: places,
});
stage.still = still;
await stage.settle();
await places.ready();
const rig = stage.rig;
const renderer = rig.renderer;
if (query.get("edges") === "0") renderer.setEdges(0, 0);
const input = new WalkInput(stage, canvas);
stage.onArrive = () => {
  input.cancel();
  updateHud();
};

// ?cast lines every figure up beside the start, facing the camera (?cast=walk: walking on the spot), to judge them.
if (query.has("cast")) {
  ["knight", "grizzlegom", "goblin", "townswoman", "skeleton", "ghoul"].map((id) => figureSpec(id)).forEach((spec, i) => {
    const f = new Figure(spec);
    // Two tiles apart, so that seen from a 45-degree heading too each stands clear of the next.
    f.root.position.set(startTile.x + 0.5 + (i < 3 ? -6 + 2 * i : 2 * (i - 2)), 0, startTile.z + 0.5);
    f.root.traverse((o) => (o.castShadow = o.receiveShadow = true));
    stage.current.place.addFigure(f.root);
    if (query.get("cast") === "walk") {
      const update = f.update.bind(f);
      f.update = (dt: number) => update(dt, 3);
    }
    stage.extras.push(f);
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
  const current = stage.current;
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

// --- The camera ------------------------------------------------------------------------------------------------------

/** Steps the outdoor zoom out (+1) or in (-1); in a room, or past the last step, it does nothing. */
function zoomBy(step: -1 | 1): void {
  if (!stage.zoomBy(step)) return;
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
  if (!stage.turn(step)) return;
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

// --- Keys and the wheel ------------------------------------------------------------------------------------------------

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
    if (Math.abs(e.deltaY) < 1 || stage.time - wheelAt < ZOOM_EASE * 0.6) return;
    wheelAt = stage.time;
    zoomBy(e.deltaY > 0 ? 1 : -1);
  },
  { passive: false },
);
window.addEventListener("resize", () => stage.resize());

// --- The loop --------------------------------------------------------------------------------------------------------

let last = performance.now();
/** With ?manual the clock stands still until a test advances it (sliceTest.advance), so clips are evenly timed. */
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!manual) stage.tick(dt);
  stage.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Test hooks ------------------------------------------------------------------------------------------------------

if (query.has("test")) {
  const screen = (p: THREE.Vector3) => renderer.toScreen(p);
  const floorOf = (x: number, z: number) => stage.current.floorAt?.(x + 0.5, z + 0.5) ?? 0;
  (globalThis as Record<string, unknown>).sliceStage = stage;
  (globalThis as Record<string, unknown>).sliceTest = {
    ready: true,
    get scene() {
      return stage.current.id;
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
      return input.dragging;
    },
    get cameraSettled() {
      return rig.settled && stage.transition === null;
    },
    /** The outdoor zoom step, and the screen pixels to each scene pixel now. */
    get zoom() {
      return { step: rig.zoom, scale: renderer.view.scale, steps: rig.maxZoom() + 1 };
    },
    zoomBy,
    get transitioning() {
      return stage.transition !== null;
    },
    get player() {
      const player = stage.player;
      const s = screen(player.position.clone().setY(player.position.y + 0.4));
      return { tile: player.tile, moving: player.moving, x: s.x, y: s.y, at: { x: player.position.x, z: player.position.z }, height: player.position.y, goal: player.goal };
    },
    /** Where a tile's middle is on the page. */
    tile(x: number, z: number) {
      return screen(centre({ x, z }, floorOf(x, z)));
    },
    walkable(x: number, z: number) {
      return stage.current.grid.walkable(x, z);
    },
    get entities() {
      return [
        ...stage.current.doors.map((d) => ({ name: d.name, kind: "door", to: d.to, tile: d.tile, ...screen(centre(d.tile, floorOf(d.tile.x, d.tile.z))) })),
        ...stage.current.actors.map((a) => ({ name: a.name, kind: "figure", tile: a.tile, moving: a.moving, ...screen(a.position.clone().setY(a.position.y + 0.4)) })),
      ];
    },
    turn,
    /** Moves the clock on by some seconds, in steps of a sixtieth (with ?manual). */
    advance(seconds: number) {
      // A turn of the event loop between frames, as between animation frames, so a chunk's or a room's file read
      // while walking is in by the next (never a wait on the clock).
      return (async () => {
        for (let t = 0; t < seconds - 1e-6; t += 1 / 60) {
          stage.tick(1 / 60);
          await yieldFrame();
        }
      })();
    },
    /**
     * Renders a frame now and returns the middle `w` by `h` of the window as it is shown - the scene's pixels at the
     * screen's scale - so a clip shows the zoom (base64 RGBA, top row first).
     */
    shown(w: number, h: number) {
      stage.render();
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
    /** The renderer's benchmark (render/bench.ts): walks the legs on the manual clock, timing every frame. */
    bench(legs: BenchLeg[], maxFrames?: number) {
      return runBench(stage, legs, maxFrames);
    },
    /** What the stage holds now: the chunks read and built, the draw calls of the last frame, the detail level, the lights. */
    get render() {
      const s = stage.current.streamer;
      return {
        loaded: s?.loadedKeys ?? [],
        built: s?.builtKeys ?? [],
        idle: s?.idle ?? true,
        window: s?.window ?? null,
        calls: renderer.stats.calls,
        detail: stage.current.place.detail,
        lights: stage.current.place.pooledNow.filter((l) => l !== null).length,
        xray: stage.current.inside ? null : true,
      };
    },
    /** Turns the x-ray off (or on again), to compare. */
    set xray(on: boolean) {
      stage.xray = on;
    },
    /** Where the floor is on a tile. */
    floor(x: number, z: number) {
      return stage.current.floorAt?.(x + 0.5, z + 0.5) ?? 0;
    },
    /** Walks the player to a tile by the shortest way (true if there is one). */
    walkTo(x: number, z: number) {
      const to = stage.reachableNear({ x, z }, 3);
      return !!to && stage.player.goTo(to);
    },
    /** Renders a frame now and returns its scene pixels (base64 RGBA, top row first). */
    frame() {
      stage.render();
      const { width, height, rgba } = renderer.readFrame(stage.current.place.scene);
      let s = "";
      for (let i = 0; i < rgba.length; i += 8192) s += String.fromCharCode(...rgba.subarray(i, i + 8192));
      return { width, height, rgba: btoa(s) };
    },
  };
} else {
  (globalThis as Record<string, unknown>).sliceTest = { ready: true };
}
