import * as THREE from "three";
import type { Rect } from "../world/format";
import { PixelRenderer } from "./renderer";
import { THREE_QUARTER, type View } from "./view";

// The camera's three headings and its stepped zoom, and how it eases between them: what the player turns and zooms,
// and where the view is held over a place. The renderer (renderer.ts) draws whatever view it is given; this decides
// the view. The page owns when it moves (input, the door's transition) and keeps the heading and the zoom between
// visits; this owns how.

/**
 * The camera's three headings: -1 swung 45 degrees round to the left (looking north-east from the south-west), 0 looking
 * north as a 16-bit RPG does, 1 swung to the right (looking north-west from the south-east). Never further: past 45
 * degrees walls and signs would be seen from the side and then from behind, and nothing is made to be seen so.
 */
export type Heading = -1 | 0 | 1;
export const HEADING_NAMES: Readonly<Record<string, Heading>> = { left: -1, front: 0, right: 1 };
export const NAME_OF: Readonly<Record<Heading, string>> = { [-1]: "left", 0: "front", 1: "right" };

/**
 * The outdoor zoom: how many steps out from the closest view. A step changes only the screen's whole-pixel scale - one
 * screen pixel fewer to each of the scene's - never the art: a texel is still one scene pixel, crisp, with no shimmer.
 * Two steps out at most, and never below one screen pixel to a scene pixel.
 */
export type Zoom = 0 | 1 | 2;

/** What a place says about how it is seen. */
export interface Framing {
  /** Rooms and dungeons are seen closer than the open air, and never zoomed. */
  readonly inside: boolean;
  /** Whether the camera may swing to its 45-degree headings here. */
  readonly turns: boolean;
  /** The camera keeps its focus inside this rectangle of the ground (x0, z0, x1, z1). */
  readonly bounds: Rect;
}

/** How stiff a turn is: it settles in about 0.45 s. */
const TURN_RATE = 11;
/** How long a zoom step eases, seconds. */
export const ZOOM_EASE = 0.35;

/**
 * The view of the world: the pixel renderer on a canvas and the camera that decides what it sees. Made for the place
 * shown first (its framing), at a heading and a zoom step (held to the steps the window has).
 */
export class CameraRig {
  readonly renderer: PixelRenderer;
  heading: Heading;
  zoom: Zoom;
  /** Whether a turn is under way (it glides unsnapped until it settles). */
  turning = false;
  private turnSpeed = 0;
  /** A zoom step under way: the scale it started from and how long it has eased. */
  private zoomEase: { from: number; t: number } | null = null;

  constructor(canvas: HTMLCanvasElement, heading: Heading, zoom: number, first: Framing) {
    this.heading = heading;
    this.zoom = Math.min(this.maxZoom(), zoom === 0 || zoom === 1 || zoom === 2 ? zoom : 0) as Zoom;
    this.renderer = new PixelRenderer(canvas, this.viewFor(first));
  }

  /** The closest outdoor scale for the window: about 270 scene pixels high, at least 2 screen pixels to one. */
  outsideScale(): number {
    return Math.max(2, Math.round(window.innerHeight / 270));
  }

  /** The furthest step out this window has. */
  maxZoom(): Zoom {
    return Math.max(0, Math.min(2, this.outsideScale() - 1)) as Zoom;
  }

  /** The outdoor scale at the zoom step. */
  outdoorScale(): number {
    return Math.max(1, this.outsideScale() - this.zoom);
  }

  /** A place's view: the three-quarter camera at the heading (where the place turns); rooms closest, outdoors at the zoom. */
  viewFor(f: Framing): View {
    return { ...THREE_QUARTER, yaw: (f.turns ? this.heading : 0) * (Math.PI / 4), scale: f.inside ? this.insideScale(f) : this.outdoorScale() };
  }

  /**
   * A room's scale: a step closer than the open air's closest - unless the room would then not be seen whole from every
   * heading it is seen from while one step further out it would, when it is seen from that step (never further), so a
   * room's far corners are never off the screen when they need not be. The same at every heading: turning never zooms.
   */
  insideScale(f: Framing): number {
    const close = this.outsideScale() + 1;
    const fits = (scale: number) =>
      (f.turns ? [-1, 0, 1] : [0]).every((h) => {
        const { across, along } = extentAt(f.bounds, (h * Math.PI) / 4, THREE_QUARTER.pitch);
        return across <= (window.innerWidth / scale) * THREE_QUARTER.wppX && along <= (window.innerHeight / scale) * THREE_QUARTER.wppY;
      });
    return !fits(close) && fits(close - 1) ? close - 1 : close;
  }

  /** Whether the camera is at rest: not turning, not zooming. (A door's transition is the page's to know.) */
  get settled(): boolean {
    return !this.turning && !this.zoomEase;
  }

  get zooming(): boolean {
    return this.zoomEase !== null;
  }

  /** Steps the heading one left or right; false (and nothing done) past 45 degrees or where the place does not turn. */
  turn(step: -1 | 1, f: Framing): boolean {
    const next = this.heading + step;
    if (!f.turns || next < -1 || next > 1) return false;
    this.heading = next as Heading;
    this.turning = true;
    this.renderer.snap = false;
    return true;
  }

  /** Steps the zoom out (+1) or in (-1); false (and nothing done) inside, or past the last step. */
  zoomBy(step: -1 | 1, f: Framing): boolean {
    const next = this.zoom + step;
    if (f.inside || next < 0 || next > this.maxZoom()) return false;
    this.zoom = next as Zoom;
    this.zoomEase = { from: this.renderer.view.scale, t: 0 };
    this.renderer.snap = false;
    return true;
  }

  /** Stops a turn or a zoom where it is (a doorway's easing takes over from wherever the camera is). */
  halt(): void {
    this.turning = false;
    this.turnSpeed = 0;
    this.zoomEase = null;
    this.renderer.snap = true;
  }

  /**
   * Turning from one heading to the next: the turn alone eases round about the focus - pitch, stretch and zoom stay as
   * they are - as a critically damped spring, so a press mid-turn retargets it without a jolt (it keeps its speed). It
   * glides unsnapped while it turns and snaps to whole pixels once it has settled.
   */
  stepTurn(dt: number, f: Framing): void {
    if (!this.turning) return;
    const target = this.viewFor(f).yaw;
    let yaw = this.renderer.view.yaw;
    for (let i = 0; i < 4; i++) {
      const h = dt / 4;
      this.turnSpeed += (TURN_RATE * TURN_RATE * (target - yaw) - 2 * TURN_RATE * this.turnSpeed) * h;
      yaw += this.turnSpeed * h;
    }
    if (Math.abs(target - yaw) < 2e-4 && Math.abs(this.turnSpeed) < 3e-3) {
      yaw = target;
      this.turnSpeed = 0;
      this.turning = false;
    }
    this.renderer.setView({ ...this.renderer.view, yaw });
    this.renderer.snap = !this.turning;
  }

  /** Zooming from one step to another: the scale eases about the focus, gliding unsnapped, then settles snapped. */
  stepZoom(dt: number): void {
    const z = this.zoomEase;
    if (!z) return;
    z.t += dt;
    const k = Math.min(1, z.t / ZOOM_EASE);
    const e = k * k * (3 - 2 * k);
    const target = this.outdoorScale();
    this.renderer.setView({ ...this.renderer.view, scale: z.from + (target - z.from) * e });
    if (k >= 1) {
      this.renderer.setView({ ...this.renderer.view, scale: target });
      this.zoomEase = null;
    }
  }

  /**
   * Where the focus may be for a point it follows, so the view stays on the place's ground: a room smaller than the view
   * is centred. Looking north the view is held to the place's edges; swung round to a corner it looks across them at a
   * slant and follows freely; between the two, while the camera turns, the focus slides from one to the other.
   */
  clampFocus(p: THREE.Vector3, f: Framing): THREE.Vector3 {
    const [x0, z0, x1, z1] = f.bounds;
    const r = this.renderer;
    const v = r.view;
    const halfX = (r.width * THREE_QUARTER.wppX) / 2;
    const halfZ = (r.height * THREE_QUARTER.wppY) / Math.sin(THREE_QUARTER.pitch) / 2;
    const clamp = (value: number, lo: number, hi: number) => (hi - lo < 0 ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, value)));
    const held = new THREE.Vector3(clamp(p.x, x0 + halfX, x1 - halfX), 0, clamp(p.z, z0 + halfZ, z1 - halfZ));
    const free = Math.min(1, Math.abs(v.yaw) / (Math.PI / 4));
    // A room seen from a corner, or turning toward one, is held as the camera sees it at this turn.
    if (f.inside && free > 0) return this.heldAcross(p, f.bounds);
    const loose = new THREE.Vector3(p.x, 0, p.z);
    return held.lerp(loose, free);
  }

  /**
   * A room's focus at a turn: held so the view stays on the room as the camera sees it - the room's rectangle measured
   * across and up the screen at this turn - so a room that fits is seen whole and centred, its far corners and all, and
   * a bigger one is followed only as far as its edges. (Looking north this is the held focus, worked out the same way.)
   */
  private heldAcross(p: THREE.Vector3, bounds: Rect): THREE.Vector3 {
    const r = this.renderer;
    const v = r.view;
    const { right, up } = screenAxes(v.yaw, v.pitch);
    const [x0, z0, x1, z1] = bounds;
    const across = [x0, x1].flatMap((x) => [z0, z1].map((z) => x * right.x + z * right.z));
    const along = [x0, x1].flatMap((x) => [z0, z1].map((z) => x * up.x + z * up.z));
    const halfA = (r.width * v.wppX) / 2;
    const halfB = (r.height * v.wppY) / 2;
    const clamp = (value: number, lo: number, hi: number) => (hi - lo < 0 ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, value)));
    const a = clamp(p.x * right.x + p.z * right.z, Math.min(...across) + halfA, Math.max(...across) - halfA);
    const b = clamp(p.x * up.x + p.z * up.z, Math.min(...along) + halfB, Math.max(...along) - halfB);
    // The point of the floor that is `a` across and `b` up the screen.
    const det = right.x * up.z - right.z * up.x;
    return new THREE.Vector3((a * up.z - b * right.z) / det, 0, (right.x * b - up.x * a) / det);
  }
}

/** The screen's axes across and up, in the world, for a camera at a turn and pitch. */
function screenAxes(yaw: number, pitch: number): { right: THREE.Vector3; up: THREE.Vector3 } {
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0));
  return { right: new THREE.Vector3(1, 0, 0).applyQuaternion(turn), up: new THREE.Vector3(0, 1, 0).applyQuaternion(turn) };
}

/** How far a rectangle of the ground reaches across and up the screen, world units, seen at a turn and pitch. */
function extentAt(bounds: Rect, yaw: number, pitch: number): { across: number; along: number } {
  const { right, up } = screenAxes(yaw, pitch);
  const [x0, z0, x1, z1] = bounds;
  const corners = [x0, x1].flatMap((x) => [z0, z1].map((z) => [x, z] as const));
  const span = (axis: THREE.Vector3) => {
    const values = corners.map(([x, z]) => x * axis.x + z * axis.z);
    return Math.max(...values) - Math.min(...values);
  };
  return { across: span(right), along: span(up) };
}
