import * as THREE from "three";
import { Figure, type FigureSpec } from "../art/figures/rig";
import type { Behaviour as BehaviourData } from "../world/format";
import type { Grid, Tile } from "../world/grid";
import { blobShadow } from "./shadow";

// A figure walking a place's grid: along a path of tiles at a steady pace, turning to face where it goes, stepping up
// and down as the floor rises and falls, its walk cycle running while it moves, its round shadow under it; and (for
// those that live there) idling and wandering about a home tile, pacing a beat, or turning to watch the player. The
// game moves the player's (`goTo`, `retarget`, `walkTo`) and lets the others think for themselves (`update`).

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

  /**
   * Re-aims a walk under way at another tile without breaking its stride: the step being walked is kept, and the way on
   * is found afresh from where that step ends - never from the tile centre behind it, so nothing snaps back and the walk
   * cycle runs on. False (and the walk unchanged) if there is no way there.
   */
  retarget(to: Tile): boolean {
    const next = this.path[0];
    if (!next) return this.goTo(to);
    const route = this.grid.path({ x: Math.floor(next.x), z: Math.floor(next.z) }, to);
    if (!route) return false;
    this.path = [next, ...route.slice(1).map((t) => centre(t))];
    return true;
  }

  /** The tile the walk under way ends on, or null standing. */
  get goal(): Tile | null {
    const last = this.path.at(-1);
    return last ? { x: Math.floor(last.x), z: Math.floor(last.z) } : null;
  }

  /** Finishes the step under way, then stands. */
  stopAfterStep(): void {
    this.path = this.path.slice(0, 1);
  }

  stopWalking(): void {
    this.path = [];
  }

  /** Stands it on a tile at once (a relayed position, a correction): no walk, on the floor there. */
  place(tile: Tile): void {
    this.path = [];
    this.position.copy(centre(tile, this.floor ? this.floor(tile.x + 0.5, tile.z + 0.5) : this.grid.heightAt(tile.x, tile.z)));
    this.figure.root.position.copy(this.position);
  }

  /** Walks a given path of tiles (another player's, as the relay sends it), whatever the grid says. */
  walkPath(tiles: readonly Tile[]): void {
    this.path = tiles.map((t) => centre(t, this.position.y));
  }

  /** The tiles left to walk. */
  get remaining(): Tile[] {
    return this.path.map((p) => ({ x: Math.floor(p.x), z: Math.floor(p.z) }));
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
      const floor = this.floor ? this.floor(this.position.x, this.position.z) : this.grid.heightAt(Math.floor(this.position.x), Math.floor(this.position.z));
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
