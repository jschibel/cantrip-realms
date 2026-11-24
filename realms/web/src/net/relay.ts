import { type Ground, type Open, canStep, joinCorners } from "../render/motion";
import type { Tile } from "../world/grid";

// What the relay is told of the player's walks (interfaces.md, "Presence"). A `Move` is a walk of eight-way steps from
// a tile, at a speed. The server takes one only from within a tile of where it has the player (as far along the last
// walk told as its speed has taken them), and no more than ten a second. So the relay keeps the walk it last told,
// works out where the server has the player now the way the server does (`where`), and notes every tile the player
// comes onto since (`on`). Each new walk is told from the tile the server has the player on: through the tiles of the
// old walk still ahead of the server - or back along it, when the player is behind the server (slow frames run the game
// slower than the clock) - to the last tile the player passed that is on it, along the tiles passed since to where the
// player stands, then on ahead. However far the server runs behind, no walk starts anywhere but where it
// has the player. Walks are told at most one each MOVE_GAP; one wanted in between waits for the next.
//
// Should the server still refuse one (it had the player somewhere else: a reconnection entered them where they last
// reported standing, a report that never arrived), its refusal says where it has them, and the relay tells it the way
// from there to where the player stands (`catchUp`), at the fastest, so it catches up and the figure is never snapped
// back in plain sight. Only a way too long, or a second refusal straight after, leaves the page to stand the figure
// where the server says.

/** The fastest walk the server takes, tiles a second (REALMS_WALKING_SPEED). */
export const MAX_SPEED = 5;
/** The least time between two walks told, milliseconds: the server takes ten a second, this tells under seven. */
export const MOVE_GAP = 150;
/** How long a walk told takes to reach the server, milliseconds: where it has the player is worked out this far back. */
const LATENCY = 60;
/** The longest way the server is told to catch up along, steps. */
export const CATCH_UP = 24;
/** How long after catching up a refusal means the way was refused too, milliseconds. */
const CAUGHT_UP = 1000;

export interface Move {
  readonly From: readonly [number, number];
  readonly Path: readonly (readonly [number, number])[];
  readonly Speed: number;
}

interface Told {
  readonly tiles: readonly Tile[];
  readonly speed: number;
  readonly at: number;
}

const same = (a: Tile | undefined, b: Tile | undefined) => !!a && !!b && a.x === b.x && a.z === b.z;
const stepLength = (a: Tile, b: Tile) => (a.x !== b.x && a.z !== b.z ? Math.SQRT2 : 1);

export class WalkRelay {
  private told: Told | null = null;
  private last = -Infinity;
  private caughtUp = -Infinity;
  /** The tiles the player has come onto since the last walk told, each a step from the one before, the last stood on. */
  private passed: Tile[] = [];

  constructor(
    private readonly send: (move: Move) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Whether a walk may be told now (MOVE_GAP since the last). */
  get ready(): boolean {
    return this.now() - this.last >= MOVE_GAP;
  }

  /** The tile the last walk told ends on, or null before any. */
  get end(): Tile | null {
    return this.told?.tiles.at(-1) ?? null;
  }

  /** Where the server has the player at a moment: the index of the last tile of the walk told its speed has reached. */
  private reached(at: number): number {
    const told = this.told;
    if (!told || told.speed <= 0) return told ? told.tiles.length - 1 : 0;
    let walked = (Math.max(0, at - told.at) / 1000) * told.speed;
    let i = 0;
    while (i + 1 < told.tiles.length) {
      walked -= stepLength(told.tiles[i]!, told.tiles[i + 1]!);
      if (walked < 0) break;
      i++;
    }
    return i;
  }

  /** Where the server has the player now, or null before any walk is told. */
  get where(): Tile | null {
    return this.told ? this.told.tiles[this.reached(this.now() - LATENCY)]! : null;
  }

  /**
   * The tile the player stands on this frame (every frame). One a step from the last is a tile passed; one further (a
   * door's other side, a correction) begins the tiles passed afresh.
   */
  on(tile: Tile): void {
    const last = this.passed.at(-1);
    if (same(last, tile)) return;
    if (last && Math.max(Math.abs(tile.x - last.x), Math.abs(tile.z - last.z)) === 1) this.passed.push(tile);
    else this.passed = [tile];
  }

  /** Leaving a place: nothing is told until the next is entered (`stand`). */
  leave(): void {
    this.told = null;
    this.passed = [];
  }

  /** Tells the server the player stands on a tile (on entering a place), as a walk of no steps, at once. */
  stand(at: Tile, speed: number): void {
    this.passed = [at];
    this.tell([at], speed);
  }

  /** The server put the player on a tile (a walk refused): nothing is told, but that is where it has them now. */
  placed(at: Tile): void {
    this.passed = [at];
    this.told = { tiles: [at], speed: 0, at: this.now() };
  }

  /**
   * The server refused a walk and has the player at the first tile of `way`, the grid's path from there to `here`, the
   * tile the player stands on: tells it that way at the fastest, so it catches up. False (nothing told) when the way is
   * longer than CATCH_UP, or a catch-up was told within CAUGHT_UP (the server refused that too).
   */
  catchUp(way: readonly Tile[], here: Tile): boolean {
    const now = this.now();
    if (way.length < 1 || way.length - 1 > CATCH_UP || now - this.caughtUp < CAUGHT_UP) return false;
    this.caughtUp = now;
    this.passed = [here];
    this.tell(way, MAX_SPEED);
    return true;
  }

  /**
   * Tells a walk on from the tile the player stands on (`on`'s last) along `ahead` (each tile an eight-way step from the
   * one before; none for a held walk, told a step at a time), joined on to where the server has the player now, as the
   * header says. Given the distance the player truly has left to walk (tiles), it is told as fast as the tiles need to
   * keep time with it; without, at `speed`, or at the fastest when the server is more than a step behind. Never slower
   * than `speed`, never faster than MAX_SPEED. False (nothing told) when it is too soon after the last, or before the
   * place is entered.
   */
  walk(ahead: readonly Tile[], speed: number, open: Ground | Open, distance?: number): boolean {
    if (!this.ready || !this.told || this.passed.length === 0) return false;
    const mine = [...joinCorners(open, this.passed), ...ahead];
    let walk = mine.slice(-1 - ahead.length);
    // What the server has the player still to walk, from where it has them now; the latest tile passed that is on it is
    // where the walk turns off it.
    const told = this.told.tiles;
    const i = this.reached(this.now() - LATENCY);
    const rest = told.slice(i);
    let joined = false;
    for (let p = mine.length - ahead.length - 1; p >= 0 && !joined; p--) {
      const on = rest.findIndex((t) => same(t, mine[p]));
      if (on >= 0) {
        walk = [...rest.slice(0, on), ...mine.slice(p)];
        joined = true;
        continue;
      }
      // Behind where the server has them (frames slower than the clock, the walk late): back along the old walk to it.
      let back = -1;
      for (let j = i - 1; j >= 0 && back < 0; j--) if (same(told[j], mine[p])) back = j;
      if (back >= 0) {
        walk = [...told.slice(back + 1, i + 1).reverse(), ...mine.slice(p)];
        joined = true;
      }
    }
    // Off it altogether: a step across from where the server has them, where there is one.
    if (!joined) {
      let off = rest.length - 1;
      while (off >= 0 && !canStep(open, rest[off]!, walk[0]!)) off--;
      if (off >= 0) walk = [...rest.slice(0, off + 1), ...walk];
    }
    let length = 0;
    for (let k = 1; k < walk.length; k++) length += stepLength(walk[k - 1]!, walk[k]!);
    // A walk with nowhere left to go (a held walk's step) catches up at the fastest pace when the server is behind.
    const pace = distance === undefined ? (walk.length > 2 ? MAX_SPEED : speed) : distance > 0.05 ? Math.max(speed, (speed * length) / distance) : speed;
    this.passed = [this.passed.at(-1)!];
    this.tell(walk, Math.min(MAX_SPEED, pace));
    return true;
  }

  private tell(tiles: readonly Tile[], speed: number): void {
    const at = this.now();
    this.told = { tiles, speed: tiles.length > 1 ? speed : 0, at };
    this.last = at;
    this.send({ From: [tiles[0]!.x, tiles[0]!.z], Path: tiles.slice(1).map((t) => [t.x, t.z] as const), Speed: speed });
  }
}
