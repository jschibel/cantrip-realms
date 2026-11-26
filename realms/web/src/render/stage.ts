import * as THREE from "three";
import type { Figure, FigureSpec } from "../art/figures/rig";
import { type Rect, inRect } from "../world/format";
import type { Grid, Tile } from "../world/grid";
import { Actor, centre } from "./actor";
import { CameraRig, type Framing, type Heading } from "./camera";
import type { ChunkStreamer, StreamReach } from "./chunks";
import type { Place } from "./place";
import { THREE_QUARTER, type View, blendViews } from "./view";
import { aimOccluders } from "./occlude";

// The stage: what every page that shows the world runs each frame - the camera rig and its three headings and stepped
// zoom, the place the player is in and the figures in it, walking and the doors between places with the doorway's iris
// and the camera's easing, the world's chunks streamed round the view, the sun's shadows kept round it, the x-ray
// through whatever stands in front of the player, and the furthest zoom's level of detail. The game (game.ts) is the page
// over it: it says what the places are (`Spots`), what a click on something means, and what the HUD shows.

/** A way from one place to another: stand on `tile` and step `step` to go through to `to`; `at` is the doorway. */
export interface StageDoor {
  readonly name: string;
  readonly tile: Tile;
  readonly step: readonly [number, number];
  readonly to: string;
  readonly at: THREE.Vector3;
  /** What kind of way it is (a door, a dungeon's entrance, a stair): the page's to say. */
  readonly kind?: string;
  /**
   * Tiles that are its doorway beside the one past `tile` (a town's icon on the travel map: the whole footprint, which
   * several ways share): pointed at, the nearest such door to the player is the one meant.
   */
  readonly area?: Rect;
}

/** A place as the stage holds it: what is drawn, where one walks, its ways out and the figures living there. */
export interface Spot extends Framing {
  readonly id: string;
  readonly title: string;
  readonly place: Place;
  /** The tiles walked (the world's is a window round the player, remade as chunks come and go). */
  readonly grid: Grid;
  readonly doors: readonly StageDoor[];
  readonly actors: readonly Actor[];
  readonly start: Tile;
  readonly bounds: Rect;
  /** The floor's height anywhere (a ramp's slope), where it is more than the grid's tiles. */
  readonly floorAt?: (x: number, z: number) => number;
  /** The world streams its chunks round the view. */
  readonly streamer?: ChunkStreamer;
  /** Told where the player is about to stand, before the camera is placed there (a world of two scales frames by it). */
  arriving?(tile: Tile): void;
}

/** Where a door leads: the place, the tile one comes out on, and the way one faces there. */
export interface Arrival {
  readonly spot: Spot;
  readonly tile: Tile;
  readonly facing: readonly [number, number];
}

/** The places a page has, as the stage asks for them. */
export interface Spots {
  /** Where a door leads, the place built now if it is not already (the iris is shut while it is). */
  through(door: StageDoor, from: Spot): Arrival | Promise<Arrival>;
  /** Builds ahead what the player may soon go into (now and then, with the ways out near the player). */
  ahead?(doors: readonly StageDoor[], from: Spot): void;
}

export interface StageOptions {
  readonly heading: Heading;
  readonly zoom: number;
  readonly spot: Spot;
  readonly start?: Tile;
  readonly player: FigureSpec;
  readonly playerSpeed?: number;
  readonly spots: Spots;
  /** The player's figure's clock (a seeded one, for pictures that are the same every time). */
  readonly random?: () => number;
  /** On a manual clock the streaming builds a fixed number of steps a frame, not milliseconds' worth. */
  readonly manual?: boolean;
}

interface Transition {
  readonly door: StageDoor;
  readonly from: View;
  t: number;
  phase: "in" | "wait" | "out";
  readonly focusFrom: THREE.Vector3;
  /** Where it leads, once known (building may take the closed iris's while). */
  arrival: Arrival | null;
}

/** The doorway's easing in and out, seconds. */
const IN = 0.55;
const OUT = 0.45;
/** How far figures lean back from the camera (art/figures/rig.ts, setLean), at every heading. */
export const LEAN = (25 * Math.PI) / 180;
/** Milliseconds of building a frame may spend streaming chunks (on a manual clock: steps). */
const BUILD_MS = 4;
const BUILD_STEPS = 3;

export class Stage {
  readonly rig: CameraRig;
  current: Spot;
  player: Actor;
  /** The point the camera follows (the player, eased; held to the place's bounds). */
  readonly focus = new THREE.Vector3();
  /** The game clock, seconds. */
  time = 0;
  transition: Transition | null = null;
  /** A door clicked: walking to it, going through on arrival. */
  pendingDoor: StageDoor | null = null;
  /** Figures that lean with the camera besides the player and the place's own (the slice's cast line). */
  readonly extras: Figure[] = [];
  /** Whether the place's own figures move (the slice's ?still holds them). */
  still = false;
  /** Called on arriving in a place (the HUD's name), and when the player's tile changes. */
  onArrive: (spot: Spot) => void = () => {};
  onTile: (tile: Tile) => void = () => {};
  /** A click on a tile, before the stage walks there: true if the page dealt with it (a person, a chest, a mob). */
  intercept: (tile: Tile) => boolean = () => false;
  /** Called each frame before the player moves (the page's input: a held button). */
  beforeTick: (dt: number) => void = () => {};
  /** Called at the end of each frame, once everything has moved (the debug overlay's jump watch). */
  afterTick: (dt: number) => void = () => {};
  /** Whether what stands in front of the player fades (render/occlude.ts; tests compare with it off). */
  occlude = true;
  /** Whether the walk may go through doors on its own (a game paused by a dialog stops everything). */
  paused = false;
  private lastTile = "";
  private wanted: { x: number; z: number; reach: number } | null = null;
  private aheadTimer = 0;
  private readonly spots: Spots;
  /** On a manual clock streaming builds a fixed number of steps a frame (tests); else milliseconds' worth. */
  manual: boolean;
  private playerSpec: FigureSpec;
  private readonly playerRandom: () => number;

  constructor(canvas: HTMLCanvasElement, o: StageOptions) {
    this.current = o.spot;
    this.spots = o.spots;
    this.manual = !!o.manual;
    this.playerSpec = o.player;
    this.playerRandom = o.random ?? Math.random;
    o.spot.arriving?.(o.start ?? o.spot.start);
    this.rig = new CameraRig(canvas, o.heading, o.zoom, o.spot);
    if (o.spot.contained) {
      this.rig.fit(o.spot);
      this.renderer.setView(this.viewFor(o.spot));
    }
    this.player = this.makePlayer(o.start ?? o.spot.start, o.spot);
    this.player.speed = o.playerSpeed ?? 4.2;
    o.spot.place.addFigure(this.player.figure.root);
    this.focus.copy(this.player.position);
    this.renderer.focus.copy(this.focus);
  }

  get renderer() {
    return this.rig.renderer;
  }

  private makePlayer(tile: Tile, spot: Spot): Actor {
    const a = new Actor(this.playerSpec, tile, spot.grid, {}, "player", this.playerRandom);
    a.smooth = true;
    a.floor = spot.floorAt ?? null;
    if (spot.floorAt) a.place(tile);
    return a;
  }

  /** Dresses the player anew (gear put on or taken off): the same place, tile, spot and facing, a new figure. */
  dress(spec: FigureSpec): void {
    this.playerSpec = spec;
    const was = this.player;
    const next = this.makePlayer(was.tile, this.current);
    next.speed = was.speed;
    next.position.copy(was.position);
    next.figure.root.position.copy(was.position);
    next.figure.face(Math.sin(was.figure.facing), Math.cos(was.figure.facing));
    this.current.place.removeFigure(was.figure.root);
    this.current.place.addFigure(next.figure.root);
    this.player = next;
  }

  /** A place's view: the rig's, for the place. */
  viewFor(f: Framing): View {
    return this.rig.viewFor(f);
  }

  /** How far the view reaches from its focus, tiles: the corner of the target, and the tall things past its edge. */
  viewReach(): number {
    const r = this.renderer;
    const halfX = (r.width * THREE_QUARTER.wppX) / 2;
    const halfZ = (r.height * THREE_QUARTER.wppY) / Math.sin(THREE_QUARTER.pitch) / 2;
    return Math.hypot(halfX, halfZ) + 6;
  }

  /** How much of the world is kept round the view: built a little past it, read further, dropped further still. */
  streamReach(): StreamReach {
    const v = this.viewReach();
    return { build: v + 6, load: v + 6 + 24, drop: v + 6 + 20 };
  }

  /** Reads and builds the world round the player before the first frame (or after a jump), however long it takes. */
  async settle(): Promise<void> {
    const s = this.current.streamer;
    if (!s) return;
    await s.settle(this.player.position.x, this.player.position.z, this.streamReach());
    this.player.grid = s.grid;
    for (const a of this.current.actors) a.grid = s.grid;
    // The player was stood there before the floor was read: on it now, before the first frame.
    this.player.standOnFloor();
  }

  // --- The camera ------------------------------------------------------------------------------------------------------

  /** Steps the heading one left or right; refused mid-door, past 45 degrees, or where the place does not turn. */
  turn(step: -1 | 1): boolean {
    return !this.transition && this.rig.turn(step, this.current);
  }

  /** Steps the outdoor zoom out (+1) or in (-1); refused mid-door, in a room, or past the last step. */
  zoomBy(step: -1 | 1): boolean {
    return !this.transition && this.rig.zoomBy(step, this.current);
  }

  /** After the window changes size: the view at its scale for the window (eased views keep their turn). */
  resize(): void {
    this.renderer.setView(this.transition || this.rig.turning ? { ...this.renderer.view, scale: this.viewFor(this.current).scale } : this.viewFor(this.current));
  }

  // --- Walking and doors ------------------------------------------------------------------------------------------------

  /**
   * The door whose tile, or the doorway past it, is this tile; else, of the doors whose `area` holds it, the nearest the
   * player.
   */
  doorAt(tile: Tile | null): StageDoor | undefined {
    if (!tile) return undefined;
    const doors = this.current.doors;
    const own = doors.find((d) => (d.tile.x === tile.x && d.tile.z === tile.z) || (d.tile.x + d.step[0] === tile.x && d.tile.z + d.step[1] === tile.z));
    if (own) return own;
    return this.doorsOver(tile)[0];
  }

  /** The doors whose `area` holds a tile, nearest the player first. */
  private doorsOver(tile: Tile): StageDoor[] {
    const me = this.player.position;
    const d = (door: StageDoor) => Math.hypot(door.tile.x + 0.5 - me.x, door.tile.z + 0.5 - me.z);
    return this.current.doors.filter((door) => door.area && inRect(door.area, tile.x, tile.z)).sort((a, b) => d(a) - d(b));
  }

  /**
   * Walks to a tile; a door's tile (or the doorway itself) walks there and goes through. The page may take it first.
   * True if the click was used on something (the page took it, or a door), not only walked.
   */
  clickTile(tile: Tile): boolean {
    if (this.transition || this.paused) return false;
    if (this.intercept(tile)) {
      this.pendingDoor = null;
      return true;
    }
    const door = this.doorAt(tile);
    if (door) {
      // A doorway several doors share (an icon's): the nearest the player can walk to.
      const choices = door.area && inRect(door.area, tile.x, tile.z) ? this.doorsOver(tile) : [door];
      for (const d of choices) {
        this.pendingDoor = d;
        if (this.player.tile.x === d.tile.x && this.player.tile.z === d.tile.z && !this.player.moving) {
          this.startDoor(d);
          return true;
        }
        if (this.player.goTo(d.tile)) return true;
      }
      this.pendingDoor = null;
      return true;
    }
    this.pendingDoor = null;
    const to = this.reachableNear(tile, 2);
    if (to) this.player.goTo(to);
    return false;
  }

  /**
   * The tile to walk to for a tile pointed at: itself if one can stand there, else the open tile nearest it within
   * `reach`, leaning toward the player so a walk heads for the near side of what is in the way, never round it; and
   * where nothing is open within reach (the middle of a big roof), the first open tile on the line from it to the player.
   */
  reachableNear(tile: Tile, reach: number): Tile | null {
    const grid = this.current.grid;
    if (grid.walkable(tile.x, tile.z)) return tile;
    let best: Tile | null = null;
    let bestD = Infinity;
    const me = this.player.tile;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const t = { x: tile.x + dx, z: tile.z + dz };
        const d = Math.hypot(dx, dz) + 0.3 * Math.hypot(t.x - me.x, t.z - me.z);
        if (grid.walkable(t.x, t.z) && d < bestD) {
          best = t;
          bestD = d;
        }
      }
    }
    if (best) return best;
    const n = Math.max(Math.abs(me.x - tile.x), Math.abs(me.z - tile.z));
    for (let i = 1; i <= n; i++) {
      const t = { x: Math.round(tile.x + ((me.x - tile.x) * i) / n), z: Math.round(tile.z + ((me.z - tile.z) * i) / n) };
      if (grid.walkable(t.x, t.z)) return t;
    }
    return null;
  }

  /** Goes through a door: the player walks into the doorway, the camera eases and the iris closes on it. */
  startDoor(door: StageDoor): void {
    this.pendingDoor = null;
    this.rig.halt();
    this.player.figure.act("interact");
    this.player.walkTo(centre(door.tile).add(new THREE.Vector3(door.step[0] * 0.9, 0, door.step[1] * 0.9)));
    this.transition = { door, from: this.renderer.view, t: 0, phase: "in", focusFrom: this.focus.clone(), arrival: null };
    const from = this.current;
    // Back out where one stood, if the other side cannot be had (a refused run): the iris opens on this place again.
    const stay = (): Arrival => ({ spot: from, tile: door.tile, facing: [-door.step[0], -door.step[1]] });
    let a: Arrival | Promise<Arrival>;
    try {
      a = this.spots.through(door, from);
    } catch {
      a = stay();
    }
    if (a instanceof Promise) {
      void a.then(
        (arrival) => this.transition && (this.transition.arrival = arrival),
        () => this.transition && (this.transition.arrival = stay()),
      );
    } else this.transition.arrival = a;
  }

  /** Stands the player in another place at a tile, facing a way (a door's other side, a waystone's, a lost duel's inn). */
  arrive(arrival: Arrival, fromDoor = true): void {
    this.current.place.removeFigure(this.player.figure.root);
    this.current = arrival.spot;
    arrival.spot.arriving?.(arrival.tile);
    // A place the view keeps within: the zoom held to what it holds.
    this.rig.fit(arrival.spot);
    const next = this.makePlayer(arrival.tile, arrival.spot);
    next.speed = this.player.speed;
    this.player = next;
    if (fromDoor) {
      // Out of the doorway a step, then onto the tile.
      const back = centre(arrival.tile, next.position.y).add(new THREE.Vector3(-arrival.facing[0] * 0.8, 0, -arrival.facing[1] * 0.8));
      next.position.copy(back);
      next.walkTo(centre(arrival.tile, next.position.y));
    }
    next.figure.face(arrival.facing[0], arrival.facing[1]);
    arrival.spot.place.addFigure(next.figure.root);
    this.focus.copy(this.rig.clampFocus(next.position, arrival.spot));
    if (!fromDoor) this.renderer.setView(this.viewFor(arrival.spot));
    this.wanted = null;
    this.lastTile = "";
    this.onArrive(arrival.spot);
  }

  private stepTransition(dt: number): void {
    const tr = this.transition;
    if (!tr) return;
    tr.t += dt;
    if (tr.phase === "in" || tr.phase === "wait") {
      const k = Math.min(1, tr.t / IN);
      // The camera eases towards where it will be on the other side (into the room's view going in), closing on the door.
      const goingOut = this.current.inside && tr.arrival && !tr.arrival.spot.inside;
      const target = tr.arrival && !goingOut ? this.viewFor(tr.arrival.spot) : tr.from;
      this.renderer.setView(blendViews(tr.from, target, k));
      this.focus.lerpVectors(tr.focusFrom, tr.door.at.clone().setY(0), k * k);
      this.renderer.iris = { at: tr.door.at, radius: Math.max(0, (1 - k) * 260) };
      if (k >= 1) {
        tr.phase = "wait";
        // Shut until the other side is ready.
        if (!tr.arrival) return;
        this.arrive(tr.arrival);
        this.transition = { door: tr.door, from: this.renderer.view, t: 0, phase: "out", focusFrom: this.focus.clone(), arrival: tr.arrival };
      }
    } else {
      const k = Math.min(1, tr.t / OUT);
      this.renderer.setView(blendViews(tr.from, this.viewFor(this.current), k));
      this.renderer.iris = { at: this.player.position.clone().setY(this.player.position.y + 0.7), radius: k * 280 };
      if (k >= 1) {
        this.renderer.iris = null;
        this.renderer.setView(this.viewFor(this.current));
        this.transition = null;
      }
    }
  }

  // --- Pointing ----------------------------------------------------------------------------------------------------------

  private readonly raycaster = new THREE.Raycaster();

  /** What a ray from the page may hit: the place's ground and scenery near the floor under the pointer, not figures or grass. */
  private targets(near: THREE.Vector3 | null): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const figures = new Set<THREE.Object3D>([this.player.figure.root, ...this.current.actors.map((a) => a.figure.root), ...this.extras.map((f) => f.root)]);
    const visit = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (figures.has(c) || !c.visible || c.name === "grass" || c.type.endsWith("Light")) continue;
        if (c.name.startsWith("section:")) {
          // Only the chunks round where the pointer meets the floor: a ray need not test the whole world.
          const box = new THREE.Box3().setFromObject(c.children.find((m) => m.name === "ground") ?? c);
          if (near && !box.isEmpty() && box.distanceToPoint(near.clone().setY((box.min.y + box.max.y) / 2)) > 12) continue;
          visit(c);
          continue;
        }
        if ((c as THREE.Mesh).isMesh) out.push(c);
        else visit(c);
      }
    };
    visit(this.current.place.scene);
    return out;
  }

  /** A figure under a point on the page, as the tile it stands on (the page's: a person, a mob); null where none is. */
  pickFigure: (x: number, y: number) => Tile | null = () => null;

  /**
   * The tile under a point on the page: a figure's own tile if one is there, else the first thing the ray meets (lower
   * than a roof), read a hair towards the camera.
   */
  pick(x: number, y: number): Tile | null {
    const figure = this.pickFigure(x, y);
    if (figure) return figure;
    const ray = this.renderer.rayAt(x, y);
    const floor = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    this.raycaster.ray.copy(ray);
    const hits = this.raycaster.intersectObjects(this.targets(floor), false);
    const hit = hits.find((h) => h.point.y < 3.2 + this.player.position.y);
    const point = hit ? hit.point.clone().addScaledVector(ray.direction, -0.02) : floor;
    return point ? { x: Math.floor(point.x), z: Math.floor(point.z) } : null;
  }

  /** The point on the floor under a point on the page, whatever stands in front of it (at the player's own level). */
  floorPointAt(x: number, y: number): THREE.Vector3 | null {
    return this.renderer.rayAt(x, y).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.player.position.y), new THREE.Vector3());
  }

  /** The tile on the floor under a point on the page, whatever stands in front of it (at the player's own level). */
  floorTileAt(x: number, y: number): Tile | null {
    const point = this.floorPointAt(x, y);
    return point ? { x: Math.floor(point.x), z: Math.floor(point.z) } : null;
  }

  // --- The frame -------------------------------------------------------------------------------------------------------

  /** Moves the game on by `dt` seconds. */
  tick(dt: number): void {
    this.time += dt;
    const spot = this.current;
    this.beforeTick(dt);
    if (!this.paused) {
      this.player.update(dt);
      const p = this.pendingDoor;
      if (p && !this.player.moving && this.player.tile.x === p.tile.x && this.player.tile.z === p.tile.z) this.startDoor(p);
    }
    for (const a of spot.actors) {
      if (this.still || this.paused) a.figure.update(dt, 0);
      else a.update(dt, this.player);
    }
    for (const f of this.extras) f.update(dt, 0);
    this.stepTransition(dt);
    const rig = this.rig;
    if (!this.transition) {
      rig.stepTurn(dt, spot);
      rig.stepZoom(dt);
      this.renderer.snap = rig.settled;
    }
    const here = this.current;
    here.place.update(this.time, this.renderer.view.yaw, this.viewFor(here).yaw, this.focus);
    if (!this.transition) {
      const toward = rig.clampFocus(this.player.position, here).clone();
      // A hop's arc is the figure's, not the view's: the focus keeps its height while the figure is in the air and eases
      // to the new level once it lands, so the hop is seen against a view that holds still.
      if (this.player.hopping) toward.y = this.focus.y;
      this.focus.lerp(toward, Math.min(1, dt * 8));
      // A place the view keeps within holds the focus there at once (a zoom out, a turn): it never eases past the edge.
      if (here.contained) this.focus.copy(rig.clampFocus(this.focus, here));
    }
    this.renderer.focus.copy(this.focus);
    // Every figure leans for the camera as it is this frame, so the lean turns with the camera and never lags it.
    const { pitch, yaw } = this.renderer.view;
    for (const f of [this.player.figure, ...here.actors.map((a) => a.figure), ...this.extras]) f.setLean(LEAN, pitch, yaw);
    this.stream(dt);
    const t = this.player.tile;
    const key = `${here.id}:${t.x},${t.z}`;
    if (key !== this.lastTile) {
      this.lastTile = key;
      this.onTile(t);
    }
    this.afterTick(dt);
  }

  /** The world round the view: chunks read and built (a few steps a frame), the sun's shadows, the level of detail. */
  private stream(dt: number): void {
    const here = this.current;
    const reach = this.viewReach();
    here.place.setDetail(here.inside || this.rig.zoom < 2);
    const r = this.renderer;
    // The view's half-size on the ground, rounded up a little so the fit changes only now and then as the window does.
    const halfX = Math.ceil(((r.width * THREE_QUARTER.wppX) / 2) * 2) / 2;
    const halfZ = Math.ceil(((r.height * THREE_QUARTER.wppY) / Math.sin(THREE_QUARTER.pitch) / 2) * 2) / 2;
    here.place.followSun(this.focus, halfX, halfZ, this.viewFor(here).yaw);
    const s = here.streamer;
    if (!s) return;
    const w = this.wanted;
    // Going through a door, what is kept is left as it is: the other side (a far place of the same world, a town's grounds)
    // is read and built behind the closing iris by the door's own ask (`Spots.through`), never dropped for the place left.
    const going = this.transition && this.transition.phase !== "out";
    if (!going && (!w || Math.hypot(w.x - this.focus.x, w.z - this.focus.z) > 2 || Math.abs(w.reach - reach) > 1)) {
      this.wanted = { x: this.focus.x, z: this.focus.z, reach };
      s.want(this.focus.x, this.focus.z, this.streamReach());
    }
    const before = s.grid;
    s.pump(this.manual ? { steps: BUILD_STEPS } : { ms: BUILD_MS });
    if (s.grid !== before) {
      this.player.grid = s.grid;
      for (const a of here.actors) a.grid = s.grid;
    }
    this.aheadTimer -= dt;
    if (this.aheadTimer <= 0 && this.spots.ahead && s.idle) {
      this.aheadTimer = 0.5;
      const me = this.player.position;
      this.spots.ahead(
        here.doors.filter((d) => Math.hypot(d.tile.x + 0.5 - me.x, d.tile.z + 0.5 - me.z) < 14),
        here,
      );
    }
  }

  /** Draws the frame: the occluder fade aimed at the player as the camera stands now. */
  render(): void {
    const r = this.renderer;
    const p = this.player.position;
    r.placeCamera();
    aimOccluders(this.occlude && !this.current.inside && !this.transition, new THREE.Vector3(p.x, p.y, p.z), r.camera, r.view.wppX, r.view.wppY, this.current.place.scene);
    r.render(this.current.place.scene);
  }

  /** Where a point in the world is on the page. */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    return this.renderer.toScreen(p);
  }
}
