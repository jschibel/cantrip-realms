import * as THREE from "three";
import { Figure, type FigureSpec } from "../art/figures/rig";
import type { Behaviour as BehaviourData } from "../world/format";
import type { Grid, Tile } from "../world/grid";
import { type Ground, type Point, slide, smooth, tilesAlong } from "./motion";
import { blobShadow } from "./shadow";

// A figure walking a place's grid: along a path of tiles at a steady pace, turning to face where it goes, stepping up
// and down as the floor rises and falls, its walk cycle running while it moves, its round shadow under it; and (for
// those that live there) idling and wandering about a home tile, pacing a beat, or turning to watch the player. The
// game moves the player's (`goTo`, `steer`, `walkTo`) and lets the others think for themselves (`update`).
//
// The player walks between tile middles (render/motion.ts): a click's walk is the grid's path pulled into straight legs
// (`smooth`), and a held button steers it straight at a point (`steer`), sliding along what is in the way - a closed tile,
// or the brink of a ledge (world/grid.ts). Either way it goes on from where it stands, so it never jumps; `remaining` is
// still the tiles ahead as eight-way steps, which is what the relay sends.

export const centre = (t: Tile, y = 0) => new THREE.Vector3(t.x + 0.5, y, t.z + 0.5);

/** How near its point a steered walk begins to slow, tiles: about the lag of the camera following it at full pace. */
export const ARRIVE = 1;

export interface Behaviour {
  /** Wander about a home tile: stand a while, then walk to an open tile within reach. */
  readonly wander?: { readonly home: Tile; readonly reach: number; readonly pause: readonly [number, number] };
  /** Pace a beat between tiles, standing a while at each. */
  readonly beat?: { readonly stops: readonly Tile[]; readonly pause: number };
  /** Turn to look at the player when they come within this many tiles. */
  readonly watch?: number;
  /** Which way to face when standing. */
  readonly rest?: readonly [number, number];
}

/** An NPC's behaviour as the world data gives it (tiles as `[x, z]`), for an Actor. */
export function behaviourOf(b: BehaviourData | undefined): Behaviour {
  if (!b) return {};
  const tile = ([x, z]: readonly [number, number]): Tile => ({ x, z });
  return {
    ...(b.wander ? { wander: { home: tile(b.wander.home), reach: b.wander.reach, pause: b.wander.pause } } : {}),
    ...(b.beat ? { beat: { stops: b.beat.stops.map(tile), pause: b.beat.pause } } : {}),
    ...(b.watch !== undefined ? { watch: b.watch } : {}),
    ...(b.rest ? { rest: b.rest } : {}),
  };
}

export class Actor {
  readonly figure: Figure;
  readonly position = new THREE.Vector3();
  readonly name: string;
  speed = 3.4;
  private path: THREE.Vector3[] = [];
  private waiting = 0;
  private stop = 0;
  private readonly shadow: THREE.Mesh;
  private moved = 0;
  /** Whether `goTo` pulls the grid's path straight (the player's walks); the others walk tile to tile. */
  smooth = false;
  /** The point a held button steers toward, or null. */
  private steerTo: Point | null = null;
  /** How fast the steered body went last frame, tiles a second. */
  private steered = 0;
  /** The tiles a pulled-straight walk passes, eight-way steps from where it began, and how far along them it is. */
  private trail: Tile[] = [];
  private trailAt = 0;

  /**
   * The floor's height under a point, when it is more than the grid's tile heights (a ramp's slope at world scale:
   * render/terrain.ts `floorAt`).
   */
  floor: ((x: number, z: number) => number) | null = null;

  constructor(
    spec: FigureSpec,
    tile: Tile,
    /** The tiles it walks: a place's grid, or the window of the world read round the player (the streamer remakes it). */
    public grid: Grid,
    readonly behaviour: Behaviour = {},
    name = spec.name,
    private readonly random: () => number = Math.random,
  ) {
    this.name = name;
    this.figure = new Figure(spec);
    this.figure.root.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.position.copy(centre(tile, grid.heightAt(tile.x, tile.z)));
    this.figure.root.position.copy(this.position);
    this.shadow = blobShadow(spec.footprint ?? 0.42);
    this.figure.root.add(this.shadow);
    if (behaviour.rest) this.figure.face(behaviour.rest[0], behaviour.rest[1]);
    this.figure.update(0, 0);
    this.waiting = 0.5 + random() * 2;
  }

  get tile(): Tile {
    return { x: Math.floor(this.position.x), z: Math.floor(this.position.z) };
  }

  get moving(): boolean {
    return this.path.length > 0 || (this.steerTo !== null && this.steered > 0.1);
  }

  /** Whether a held button is steering it (`steer`). */
  get steering(): boolean {
    return this.steerTo !== null;
  }

  /** The grid walked now (the streamer remakes it): its open tiles and its ledges. */
  private readonly ground: Ground = { open: (x, z) => this.grid.walkable(x, z), pass: (ax, az, bx, bz) => this.grid.passes(ax, az, bx, bz) };

  /** Sets the walk to points, dropping any steering and trail. */
  private follow(points: THREE.Vector3[]): void {
    this.path = points;
    this.steerTo = null;
    this.steered = 0;
    this.trail = [];
    this.trailAt = 0;
  }

  /**
   * Walks to a tile by the shortest way; false if there is none. A smooth walker goes from where it stands along the path
   * pulled straight; the others step from tile middle to tile middle.
   */
  goTo(to: Tile): boolean {
    const route = this.grid.path(this.tile, to);
    if (!route) return false;
    if (!this.smooth) {
      this.follow(route.slice(1).map((t) => centre(t)));
      return true;
    }
    const here = { x: this.position.x, z: this.position.z };
    const points = smooth(this.ground, here, route);
    this.follow(points.map((p) => new THREE.Vector3(p.x, 0, p.z)));
    this.trail = tilesAlong(this.ground, here, points);
    return true;
  }

  /**
   * Steers it straight toward a point, or with null stands it where it is. Each frame it walks at the point, slowing
   * within ARRIVE of it, and slides along whatever is in the way (render/motion.ts `slide`). No path is found.
   */
  steer(point: Point | null): void {
    if (!point) {
      if (this.steerTo) this.follow([]);
      return;
    }
    if (!this.steerTo) this.follow([]);
    this.steerTo = { x: point.x, z: point.z };
  }

  /** Walks straight to a point (through a doorway), ignoring the grid. */
  walkTo(point: THREE.Vector3): void {
    this.follow([point.clone()]);
  }

  /**
   * Re-aims a walk under way at another tile without breaking its stride: the step being walked is kept, and the way on
   * is found afresh from where that step ends - never from the tile centre behind it, so nothing snaps back and the walk
   * cycle runs on. False (and the walk unchanged) if there is no way there.
   */
  retarget(to: Tile): boolean {
    const next = this.path[0];
    if (!next || this.smooth) return this.goTo(to);
    const route = this.grid.path({ x: Math.floor(next.x), z: Math.floor(next.z) }, to);
    if (!route) return false;
    this.path = [next, ...route.slice(1).map((t) => centre(t))];
    return true;
  }

  /** The tile the walk under way ends on, or null standing (or steered). */
  get goal(): Tile | null {
    const last = this.path.at(-1);
    return last ? { x: Math.floor(last.x), z: Math.floor(last.z) } : null;
  }

  stopWalking(): void {
    this.follow([]);
  }

  /** Stands it on a tile at once (a relayed position, a correction): no walk, on the floor there. */
  place(tile: Tile): void {
    this.follow([]);
    this.position.copy(centre(tile, this.floor ? this.floor(tile.x + 0.5, tile.z + 0.5) : this.grid.heightAt(tile.x, tile.z)));
    this.figure.root.position.copy(this.position);
  }

  /** Walks a given path of tiles (another player's, as the relay sends it), whatever the grid says. */
  walkPath(tiles: readonly Tile[]): void {
    this.follow(tiles.map((t) => centre(t, this.position.y)));
  }

  /**
   * The tiles left to walk, each a step of the grid's from the one before; for a walk pulled straight, the tiles its line
   * passes after the one stood on.
   */
  get remaining(): Tile[] {
    if (this.trail.length > 0 && this.path.length > 0) {
      const here = this.tile;
      for (let i = this.trailAt; i < this.trail.length; i++) {
        if (this.trail[i]!.x === here.x && this.trail[i]!.z === here.z) {
          this.trailAt = i;
          break;
        }
      }
      return this.trail.slice(this.trailAt + 1);
    }
    return this.path.map((p) => ({ x: Math.floor(p.x), z: Math.floor(p.z) }));
  }

  /** How far the walk under way has left to go, tiles (0 standing or steered). */
  get distanceLeft(): number {
    let d = 0;
    let at = this.position;
    for (const p of this.path) {
      d += Math.hypot(p.x - at.x, p.z - at.z);
      at = p;
    }
    return d;
  }

  update(dt: number, player?: Actor): void {
    let speed = 0;
    if (this.steerTo) {
      speed = this.steerStep(dt);
    } else if (this.path.length > 0) {
      const next = this.path[0]!;
      const to = next.clone().sub(this.position);
      to.y = 0;
      const d = to.length();
      const step = this.speed * dt;
      if (d <= step) {
        this.position.set(next.x, this.position.y, next.z);
        this.path.shift();
      } else {
        this.position.addScaledVector(to, step / d);
      }
      if (d > 1e-4) this.figure.face(to.x, to.z);
      speed = this.speed;
      this.moved += step;
      this.stepFloor(dt);
    } else {
      // The player standing keeps to the floor too: one read in after it was stood there rises under it.
      if (this.smooth) this.stepFloor(dt);
      this.think(dt, player);
    }
    this.figure.root.position.copy(this.position);
    this.figure.update(dt, speed);
  }

  /** The floor's height under it. */
  private floorHere(): number {
    return this.floor ? this.floor(this.position.x, this.position.z) : this.grid.heightAt(Math.floor(this.position.x), Math.floor(this.position.z));
  }

  /** Up and down steps as the floor under it rises and falls. */
  private stepFloor(dt: number): void {
    this.position.y += (this.floorHere() - this.position.y) * Math.min(1, dt * 14);
  }

  /** Stands it on the floor where it is at once (the floor read in after it was put there). */
  standOnFloor(): void {
    this.position.y = this.floorHere();
    this.figure.root.position.copy(this.position);
  }

  /**
   * A frame of a steered walk: at the point at full pace, slowing within ARRIVE of it so a point that moves on with the
   * camera is followed without stopping and starting, and along what is in the way where something is. It faces where
   * it goes, or, held against something, where it is steered. Returns its speed, tiles a second.
   */
  private steerStep(dt: number): number {
    const to = this.steerTo!;
    const p = this.position;
    const dx = to.x - p.x;
    const dz = to.z - p.z;
    const d = Math.hypot(dx, dz);
    const want = d < 0.02 || dt <= 0 ? 0 : Math.min(this.speed, (d * this.speed) / ARRIVE) * dt;
    if (want > 0) {
      const at = slide(this.ground, p.x, p.z, (dx / d) * want, (dz / d) * want);
      const mx = at.x - p.x;
      const mz = at.z - p.z;
      const moved = Math.hypot(mx, mz);
      p.x = at.x;
      p.z = at.z;
      this.steered = moved / dt;
      this.moved += moved;
      if (this.steered > 0.5) this.figure.face(mx, mz);
      else if (d > 0.3) this.figure.face(dx, dz);
    } else this.steered = 0;
    this.stepFloor(dt);
    return this.steered;
  }

  private think(dt: number, player?: Actor): void {
    const b = this.behaviour;
    if (b.watch && player && player.position.distanceTo(this.position) < b.watch) {
      const to = player.position.clone().sub(this.position);
      this.figure.face(to.x, to.z);
      this.waiting = Math.max(this.waiting, 1);
      return;
    }
    if (b.rest && this.waiting > 0.3) this.figure.face(b.rest[0], b.rest[1]);
    this.waiting -= dt;
    if (this.waiting > 0) return;
    if (b.wander) {
      const { home, reach, pause } = b.wander;
      for (let tries = 0; tries < 12; tries++) {
        const x = home.x + Math.round((this.random() * 2 - 1) * reach);
        const z = home.z + Math.round((this.random() * 2 - 1) * reach);
        if (this.grid.walkable(x, z) && this.goTo({ x, z })) break;
      }
      this.waiting = pause[0] + this.random() * (pause[1] - pause[0]);
    } else if (b.beat) {
      this.stop = (this.stop + 1) % b.beat.stops.length;
      this.goTo(b.beat.stops[this.stop]!);
      this.waiting = b.beat.pause;
    } else {
      this.waiting = 1e9;
    }
  }
}
