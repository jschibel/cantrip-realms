import { type Ground, type Open, type Point, legClear, middle } from "../render/motion";
import type { Tile } from "../world/grid";

// What the relay is told of the player's walks (interfaces.md, "Presence"). A `Move` is a walk of straight lines through
// points of the place - where the figure truly is and goes, at any angle, never snapped to tiles - at a speed. The server
// takes one only from within 1.5 tiles of where it has the player (as far along the last walk told as its speed has taken
// them), each line crossing tiles a step of the grid's apart (render/motion.ts `legClear`, which every line the body's
// middle walks keeps), and no more than ten a second. Every walk is told from a point the figure was truly at, so where the
// server has the player is never anywhere the figure was not, and nothing builds up between them.
//
// A click's walk is told when it begins or heads somewhere new: from where the figure stands, through the points ahead.
// The server walks it on its own clock; should the figure fall behind it or run ahead (frames slower than the clock), the
// walk is told again from where the figure is once the two are DRIFT apart. A held walk has no points ahead: it is told
// as it is walked, every MOVE_GAP, from where the last ended through where the figure has been since (its frames, the
// bends kept) at the pace it went - so the server has the player a sixth of a second or so behind the figure. Standing
// where the last walk told does not end (a click's walk given up), the figure is told standing.
//
// Should the server still refuse one (it had the player somewhere else: a reconnection entered them where they last
// reported standing), its refusal says where it has them, and the relay tells it the way from there to where the figure
// stands (`catchUp`), at the fastest, and joins the walks after on to it while the server is behind - so the figure is
// never snapped back in plain sight. Only a way too long, or a second refusal straight after, leaves the page to stand the
// figure where the server says.

/** The fastest walk the server takes, tiles a second (REALMS_WALKING_SPEED). */
export const MAX_SPEED = 5;
/** The least time between two walks told, milliseconds: the server takes ten a second, this tells under seven. */
export const MOVE_GAP = 150;
/** The longest way the server is told to catch up along, steps of the grid's. */
export const CATCH_UP = 24;
/** How long after catching up a refusal means the way was refused too, milliseconds. */
const CAUGHT_UP = 1000;
/** How far apart where the server has the player and the figure on a click's walk may be before it is told again, tiles. */
export const DRIFT = 0.5;
/**
 * How far from where a walk told starts the server may have the player before the walk is joined on to what the server
 * has still to walk (`tellFrom`), tiles: well within what the server allows (1.5).
 */
const JOIN = 1;
/** How far a held walk's way may bend from a line drawn through it before its bend is told as a point, tiles. */
const BEND = 0.05;
/** A move of the figure in one frame further than this is no walk (a correction): its way begins afresh, tiles. */
const LEAP = 1;

export interface Move {
  readonly From: readonly [number, number];
  readonly Path: readonly (readonly [number, number])[];
  readonly Speed: number;
}

interface Told {
  readonly points: readonly Point[];
  readonly speed: number;
  readonly at: number;
}

/** Where the figure was in a frame, and when (ms). */
interface Mark extends Point {
  readonly t: number;
}

const apart = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function lengthOf(points: readonly Point[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += apart(points[i - 1]!, points[i]!);
  return d;
}

/** How far a point is from the line between two others. */
function offLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/**
 * A held walk's frames as the points to tell after its first: each the furthest mark on that the line to it from the one
 * before passes within BEND of the marks between and is a walk the server takes.
 */
function bends(ground: Ground | Open, marks: readonly Point[]): Point[] {
  const out: Point[] = [];
  let i = 0;
  while (i < marks.length - 1) {
    let j = marks.length - 1;
    const fits = (k: number) => {
      for (let m = i + 1; m < k; m++) if (offLine(marks[m]!, marks[i]!, marks[k]!) > BEND) return false;
      return legClear(ground, marks[i]!, marks[k]!);
    };
    while (j > i + 1 && !fits(j)) j--;
    out.push({ x: marks[j]!.x, z: marks[j]!.z });
    i = j;
  }
  return out;
}

export class WalkRelay {
  private told: Told | null = null;
  private last = -Infinity;
  private caughtUp = -Infinity;
  /** A held walk's way since the last walk told: where the figure was each frame it moved, the first where it last stood. */
  private trail: Mark[] = [];
  /** Whether the walk last told is a click's, its points ahead known. */
  private clicked = false;

  constructor(
    private readonly send: (move: Move) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Whether a walk may be told now (MOVE_GAP since the last). */
  get ready(): boolean {
    return this.now() - this.last >= MOVE_GAP;
  }

  /** The point the last walk told ends on, or null before any (before the place is entered). */
  get end(): Point | null {
    return this.told?.points.at(-1) ?? null;
  }

  /**
   * Where the server has the player at a moment, reckoned as the server does from the walk last told (its clock starting
   * when the walk reaches it, as this one's when it was sent): the point, and the leg of the walk it is on.
   */
  private along(at: number): { readonly point: Point; readonly leg: number } {
    const told = this.told!;
    const points = told.points;
    if (told.speed <= 0 || points.length < 2) return { point: points.at(-1)!, leg: points.length - 1 };
    let walked = (Math.max(0, at - told.at) / 1000) * told.speed;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const leg = apart(a, b);
      if (walked < leg) return { point: { x: a.x + ((b.x - a.x) * walked) / leg, z: a.z + ((b.z - a.z) * walked) / leg }, leg: i };
      walked -= leg;
    }
    return { point: points.at(-1)!, leg: points.length - 1 };
  }

  /** Where the server has the player now, or null before any walk is told. */
  get where(): Point | null {
    return this.told ? this.along(this.now()).point : null;
  }

  /** Leaving a place: nothing is told until the next is entered (`stand`). */
  leave(): void {
    this.told = null;
    this.trail = [];
    this.clicked = false;
  }

  /** Tells the server the player stands at a point (on entering a place), as a walk of no steps, at once. */
  stand(at: Point): void {
    this.trail = [{ x: at.x, z: at.z, t: this.now() }];
    this.clicked = false;
    this.tell([at], 0);
  }

  /** The server put the player at a point (a walk refused): nothing is told, but that is where it has them now. */
  placed(at: Point): void {
    const now = this.now();
    this.trail = [{ x: at.x, z: at.z, t: now }];
    this.clicked = false;
    this.told = { points: [at], speed: 0, at: now };
  }

  /**
   * The server refused a walk and has the player at `at`; `way` is the grid's path from the tile that is on to the tile
   * the figure stands on, at `here`: tells it that way at the fastest (`at`, the middles of the tiles, `here`), so it
   * catches up. False (nothing told) when the way is longer than CATCH_UP steps, or a catch-up was told within CAUGHT_UP
   * (the server refused that too).
   */
  catchUp(at: Point, way: readonly Tile[], here: Point): boolean {
    const now = this.now();
    if (way.length < 1 || way.length - 1 > CATCH_UP || now - this.caughtUp < CAUGHT_UP) return false;
    this.caughtUp = now;
    this.trail = [{ x: here.x, z: here.z, t: now }];
    this.clicked = false;
    const points = [at, ...way.map(middle), here].filter((p, i, all) => i === 0 || apart(p, all[i - 1]!) > 1e-9);
    this.tell(points, MAX_SPEED);
    return true;
  }

  /**
   * Every frame once the place is entered: where the figure is, and the points of a click's walk still ahead of it (null
   * for a held walk, or standing), walked at `speed`. Tells a walk as the header says; whether one was told.
   */
  frame(at: Point, ahead: readonly Point[] | null, speed: number, ground: Ground | Open): boolean {
    if (!this.told) return false;
    const now = this.now();
    if (ahead && ahead.length > 0) {
      this.trail = [{ x: at.x, z: at.z, t: now }];
      const fresh = !this.clicked || apart(ahead.at(-1)!, this.end!) > 1e-6;
      if (!this.ready || (!fresh && apart(this.along(now).point, at) <= DRIFT)) return false;
      this.clicked = true;
      return this.tellFrom(at, ahead, Math.min(MAX_SPEED, speed), ground);
    }
    if (this.clicked) {
      // A click's walk over, or given up for a held one: the held walk's way begins where the figure is.
      this.clicked = false;
      this.trail = [{ x: at.x, z: at.z, t: now }];
    }
    const last = this.trail.at(-1);
    const moved = last ? apart(last, at) : Infinity;
    if (moved > LEAP) this.trail = [{ x: at.x, z: at.z, t: now }];
    else if (moved > 1e-4) this.trail.push({ x: at.x, z: at.z, t: now });
    else if (this.trail.length === 1) this.trail[0] = { x: at.x, z: at.z, t: now };
    if (!this.ready) return false;
    const trail = this.trail;
    if (trail.length > 1) {
      const from = trail[0]!;
      const points = bends(ground, trail);
      const took = (now - from.t) / 1000;
      const walked = lengthOf([from, ...points]);
      this.trail = [{ x: at.x, z: at.z, t: now }];
      return this.tellFrom(from, points, took > 0 ? Math.min(MAX_SPEED, walked / took) : MAX_SPEED, ground);
    }
    // Standing short of where the last walk told ends: told standing.
    if (apart(this.end!, at) > 0.01) return this.tellFrom(at, [], 0, ground);
    return false;
  }

  /**
   * Tells a walk from a point the figure was at. Where the server has the player more than JOIN from there and the walk
   * it has still to walk ends at it (a way to catch up along, frames slower than the clock), it is joined on to that, at
   * the fastest, so the server is never told a walk from somewhere it does not have them.
   */
  private tellFrom(from: Point, path: readonly Point[], speed: number, ground: Ground | Open): boolean {
    const told = this.told!;
    const { point: est, leg } = this.along(this.now());
    const end = told.points.at(-1)!;
    if (apart(est, from) > JOIN && apart(end, from) <= JOIN && legClear(ground, end, from)) {
      const rest = [est, ...told.points.slice(leg + 1), ...(apart(end, from) > 1e-9 ? [from] : []), ...path];
      this.tell(rest, MAX_SPEED);
      return true;
    }
    this.tell([from, ...path], path.length > 0 ? speed : 0);
    return true;
  }

  private tell(points: readonly Point[], speed: number): void {
    const at = this.now();
    this.told = { points, speed: points.length > 1 ? speed : 0, at };
    this.last = at;
    this.send({ From: [points[0]!.x, points[0]!.z], Path: points.slice(1).map((p) => [p.x, p.z] as const), Speed: points.length > 1 ? speed : 0 });
  }
}
