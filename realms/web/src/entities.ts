import { mobFigure } from "./art/figures";
import type { MobInfo } from "./mobs";
import { Actor } from "./render/actor";
import type { SpawnData } from "./world/format";
import type { Grid, Tile } from "./world/grid";

// What walks the world besides the townsfolk (render/spots.ts stands those): the mobs of the spawn points and the
// other players in the same place, each an Actor on the place's grid (render/actor.ts: squares, eight ways, never a cut
// corner). Mobs think for themselves - wander near their spawn, chase the player within six tiles a little slower than
// they walk, and engage once beside them; other players walk the paths the relay sends.

/** Tiles a second: at most 5, the fastest walk the server takes. */
export const PLAYER_SPEED = 4.2;
export const CHASE_RANGE = 6;
const WANDER_SPEED = 1.4;
const CHASE_SPEED = 2.6;

/** Tiles apart, as the server measures nearness: the most of the two axes (a diagonal step is one). */
export const chebyshev = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** A spawn point's mob, walking the world. */
export class Mob {
  /** Seconds until it next picks somewhere to wander, or may engage again. */
  rest = 3 + Math.random() * 2;
  engaged = false;
  private retarget = 0;

  constructor(
    readonly actor: Actor,
    readonly info: MobInfo,
    readonly spawn: SpawnData,
    readonly epoch: number,
    /** A dungeon run's encounter: the floor and its index (the warden's and the boss's are past the encounters). */
    readonly run?: { readonly floor: number; readonly index: number; readonly role: string },
  ) {}

  static make(info: MobInfo, spawn: SpawnData, epoch: number, grid: Grid, floor: ((x: number, z: number) => number) | null, run?: Mob["run"]): Mob {
    const actor = new Actor(mobFigure(info.model, info.id, info.creature), { x: spawn.x, z: spawn.z }, grid, {}, info.name);
    actor.floor = floor;
    actor.place({ x: spawn.x, z: spawn.z });
    actor.speed = WANDER_SPEED;
    return new Mob(actor, info, spawn, epoch, run);
  }

  get home(): Tile {
    return { x: this.spawn.x, z: this.spawn.z };
  }

  /**
   * One frame of thought: true when the mob is beside the player, both standing, and a duel should start. `free(t)` is
   * whether a tile can be stood on (open, nobody else there).
   */
  think(seconds: number, player: Actor, free: (t: Tile) => boolean, wander: boolean): boolean {
    if (this.engaged) return false;
    this.rest -= seconds;
    const me = this.actor.tile;
    const near = chebyshev(me, player.tile);
    // Beside is a step away: never across a ledge (world/grid.ts canStep), the one above the other's bank.
    const grid = this.actor.grid;
    if (near <= 1 && (near === 0 || grid.canStep(me, player.tile)) && this.rest <= 0 && !player.moving && !this.actor.moving) return true;
    if (near <= CHASE_RANGE && this.rest <= 0) {
      // Chasing: toward the free tile beside the player nearest it, re-aimed a few times a second.
      this.actor.speed = CHASE_SPEED;
      this.retarget -= seconds;
      if (near > 1 && this.retarget <= 0) {
        this.retarget = 0.4;
        const p = player.tile;
        const beside: Tile[] = [];
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) beside.push({ x: p.x + dx, z: p.z + dz });
        const stand = beside.filter((t) => (free(t) || (t.x === me.x && t.z === me.z)) && grid.canStep(t, p)).sort((a, b) => chebyshev(a, me) - chebyshev(b, me) || a.x - b.x || a.z - b.z)[0];
        if (stand) this.actor.retarget(stand);
      }
      return false;
    }
    this.actor.speed = WANDER_SPEED;
    if (wander && !this.actor.moving && this.rest <= 0) {
      const r = this.spawn.radius;
      for (let tries = 0; tries < 8; tries++) {
        const t = { x: this.home.x + Math.round((Math.random() * 2 - 1) * r), z: this.home.z + Math.round((Math.random() * 2 - 1) * r) };
        if (free(t) && this.actor.goTo(t)) break;
      }
      this.rest = 2 + Math.random() * 3;
    }
    return false;
  }
}

/** Another player in this place, as the relay tells it. */
export interface Visitor {
  /** The connection's number on the relay. */
  readonly player: number;
  name: string;
  /** Their colors, as letters in WUBRG order. */
  identity: string;
  readonly actor: Actor;
}
