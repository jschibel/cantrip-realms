import * as THREE from "three";
import type { Character } from "./character";
import { type Hex, distance, equals, findPath, neighbors, spiral } from "./hex";
import type { SpawnData } from "./maps/schema";
import type { MobInfo } from "./mobs";

// What walks a map hex by hex: the player, the mobs, and the other players on the same map instance, each a Walker
// that steps along a path at a speed. Mobs think for themselves (wander near their spawn, chase the player within
// six hexes, a little slower than the player walks); other players walk the paths the relay sends.

/** World units of the hex under a walker, for standing on it. */
export type Surface = (h: Hex) => THREE.Vector3;

export class Walker {
  path: Hex[] = [];
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private t = 1;
  /** Called on reaching the end of a path. */
  private arrived: () => void = () => {};
  /** Called on stepping onto each hex. */
  onStep: (h: Hex) => void = () => {};

  constructor(
    readonly character: Character,
    public hex: Hex,
    /** Hexes a second. */
    public speed: number,
    private readonly surface: Surface,
  ) {
    this.place(hex);
  }

  place(h: Hex): void {
    this.hex = h;
    this.path = [];
    this.t = 1;
    this.arrived = () => {};
    this.character.root.position.copy(this.surface(h));
  }

  walk(path: Hex[], arrived: () => void = () => {}): void {
    this.path = [...path];
    this.arrived = arrived;
    if (this.t >= 1) this.next();
  }

  stop(): void {
    this.path = [];
    this.arrived = () => {};
  }

  get moving(): boolean {
    return this.t < 1;
  }

  /** Where the walk is headed: the last hex of the path, or the hex it is stepping onto, or where it stands. */
  get goal(): Hex {
    return this.path.at(-1) ?? this.hex;
  }

  update(seconds: number): void {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + seconds * this.speed);
      this.character.root.position.lerpVectors(this.from, this.to, this.t);
      if (this.t >= 1) this.next();
    }
    this.character.animate(seconds, this.t < 1);
  }

  /** Jumps partway along: a walk the relay says began some time ago. */
  skip(seconds: number): void {
    let left = seconds;
    while (left > 0 && (this.t < 1 || this.path.length > 0)) {
      if (this.t >= 1) this.next();
      const need = (1 - this.t) / this.speed;
      if (need > left) {
        this.update(left);
        return;
      }
      this.update(need);
      left -= need;
    }
  }

  private next(): void {
    const step = this.path.shift();
    if (!step) {
      const arrived = this.arrived;
      this.arrived = () => {};
      arrived();
      return;
    }
    this.from.copy(this.surface(this.hex));
    this.to.copy(this.surface(step));
    this.hex = step;
    this.t = 0;
    this.character.face(this.to.x, this.to.z);
    this.onStep(step);
  }
}

export const PLAYER_SPEED = 3.4;
export const CHASE_RANGE = 6;
const WANDER_SPEED = 1.4;
const CHASE_SPEED = 2.6;

/** A spawn point's mob, walking the map. */
export class Mob {
  /** Seconds until it next picks somewhere to wander, or may engage again. */
  rest = 3 + Math.random() * 2;
  engaged = false;

  constructor(
    readonly walker: Walker,
    readonly info: MobInfo,
    readonly spawn: SpawnData,
    readonly epoch: number,
  ) {}

  get home(): Hex {
    return { q: this.spawn.q, r: this.spawn.r };
  }

  /**
   * One frame of thought. `free` is whether a hex can be walked onto (nobody else on it); returns true when the mob
   * reaches the player and a duel should start.
   */
  think(seconds: number, player: Walker, free: (h: Hex) => boolean, wander: boolean): boolean {
    if (this.engaged) return false;
    this.rest -= seconds;
    const near = distance(this.walker.hex, player.hex);

    if (near <= 1 && this.rest <= 0 && !player.moving && !this.walker.moving) return true;

    if (near <= CHASE_RANGE && this.rest <= 0) {
      // Chasing: a step toward beside the player at a time, re-planned every step.
      this.walker.speed = CHASE_SPEED;
      if (!this.walker.moving && this.walker.path.length === 0 && near > 1) {
        const stand = besides(this.walker.hex, player.hex, free);
        const path = stand && findPath(this.walker.hex, stand, free);
        if (path && path.length > 0) this.walker.walk(path.slice(0, 1));
      }
      return false;
    }

    // Wandering within its spawn's radius.
    this.walker.speed = WANDER_SPEED;
    if (wander && !this.walker.moving && this.walker.path.length === 0 && this.rest <= 0) {
      const choices = spiral(this.home, this.spawn.radius).filter(free);
      const goal = choices[Math.floor(Math.random() * choices.length)];
      const path = goal && findPath(this.walker.hex, goal, free);
      if (path) this.walker.walk(path);
      this.rest = 2 + Math.random() * 3;
    }
    return false;
  }
}

/** The free hex next to `target` nearest `from`, or null when it is walled in. */
export function besides(from: Hex, target: Hex, free: (h: Hex) => boolean): Hex | null {
  const open = neighbors(target).filter((h) => free(h) || equals(h, from));
  open.sort((a, b) => distance(a, from) - distance(b, from) || a.q - b.q || a.r - b.r);
  return open[0] ?? null;
}

/** Another player on this map instance, as the relay tells it. */
export interface Visitor {
  readonly player: string;
  name: string;
  identity: readonly string[];
  readonly walker: Walker;
}
