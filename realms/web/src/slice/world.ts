import * as THREE from "three";
import { Figure, type FigureSpec } from "./characters";
import { Grid, type Tile } from "./grid";
import { blobShadow } from "./props";

// What a scene of the slice is - a 3D scene on a square grid, its doors, the figures in it - and the figures' walking:
// along a path of tiles at a steady pace, turning to face where they go, and (for those that live there) idling and
// wandering about a home tile or pacing a beat.

export type SceneId = "street" | "shop" | "crypt";

export interface Door {
  /** The tile you stand on to go through, and the way you step to go in. */
  readonly tile: Tile;
  readonly step: readonly [number, number];
  readonly to: SceneId;
  /** Where you come out in the other scene, and which way you face. */
  readonly arrive: Tile;
  readonly arriveFacing: readonly [number, number];
  /** The doorway itself, for the iris to close on. */
  readonly at: THREE.Vector3;
  readonly name: string;
}

export interface SliceScene {
  readonly id: SceneId;
  readonly title: string;
  /** Rooms and dungeons are seen from the three-quarter view, closer; the street from the one chosen. */
  readonly inside: boolean;
  readonly scene: THREE.Scene;
  readonly grid: Grid;
  readonly doors: readonly Door[];
  readonly actors: readonly Actor[];
  readonly start: Tile;
  /** The camera keeps its focus inside this rectangle of the ground (x0, z0, x1, z1). */
  readonly bounds: readonly [number, number, number, number];
  update(dt: number, time: number): void;
}

export const centre = (t: Tile, y = 0) => new THREE.Vector3(t.x + 0.5, y, t.z + 0.5);

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

  constructor(
    spec: FigureSpec,
    tile: Tile,
    private readonly grid: Grid,
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
    this.shadow = blobShadow(0.42);
    this.figure.root.add(this.shadow);
    if (behaviour.rest) this.figure.face(behaviour.rest[0], behaviour.rest[1]);
    this.figure.update(0, 0);
    this.waiting = 0.5 + random() * 2;
  }

  get tile(): Tile {
    return { x: Math.floor(this.position.x), z: Math.floor(this.position.z) };
  }

  get moving(): boolean {
    return this.path.length > 0;
  }

  /** Walks to a tile by the shortest way; false if there is none. */
  goTo(to: Tile): boolean {
    const route = this.grid.path(this.tile, to);
    if (!route) return false;
    this.path = route.slice(1).map((t) => centre(t));
    return true;
  }

  /** Walks straight to a point (through a doorway), ignoring the grid. */
  walkTo(point: THREE.Vector3): void {
    this.path = [point.clone()];
  }

  stopWalking(): void {
    this.path = [];
  }

  update(dt: number, player?: Actor): void {
    let speed = 0;
    if (this.path.length > 0) {
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
      // Up and down steps as the floor under it rises and falls.
      const floor = this.grid.heightAt(Math.floor(this.position.x), Math.floor(this.position.z));
      this.position.y += (floor - this.position.y) * Math.min(1, dt * 14);
    } else {
      this.think(dt, player);
    }
    this.figure.root.position.copy(this.position);
    this.figure.update(dt, speed);
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

/** Sunlight for the open air: a warm sun from the south-west, high, casting shadows; a cool sky over everything. */
export function sunlight(scene: THREE.Scene, centreX: number, centreZ: number, reach: number): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.92, 0.78), 0.86 * Math.PI);
  sun.position.set(-15, 17, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.01;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 90 });
  const holder = new THREE.Group();
  holder.position.set(centreX, 0, centreZ);
  holder.add(sun, sun.target);
  scene.add(holder);
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.6, 0.68, 1.0), new THREE.Color(0.52, 0.42, 0.5), 0.46 * Math.PI));
  return sun;
}

/** Blocks a rectangle of tiles on a grid, given in world units (any tile it overlaps). */
export function blockArea(grid: Grid, x0: number, z0: number, x1: number, z1: number): void {
  grid.block(Math.floor(x0), Math.floor(z0), Math.ceil(x1) - 1, Math.ceil(z1) - 1);
}
