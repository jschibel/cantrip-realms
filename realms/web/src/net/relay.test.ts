import { describe, expect, it } from "vitest";
import type { Tile } from "../world/grid";
import { CATCH_UP, MAX_SPEED, MOVE_GAP, type Move, WalkRelay } from "./relay";

const open = () => true;

/** The server's own check of a walk told (PresenceHub.Problem): where it has the player then, and the walk's steps. */
class Server {
  from: Tile = { x: 0, z: 0 };
  path: Tile[] = [];
  speed = 0;
  since = 0;
  readonly moves: number[] = [];
  readonly refused: string[] = [];

  where(now: number): Tile {
    if (this.path.length === 0 || this.speed <= 0) return this.path.at(-1) ?? this.from;
    let walked = (Math.max(0, now - this.since) / 1000) * this.speed;
    let at = this.from;
    for (const next of this.path) {
      walked -= at.x !== next.x && at.z !== next.z ? Math.SQRT2 : 1;
      if (walked < 0) break;
      at = next;
    }
    return at;
  }

  take(move: Move, now: number): void {
    while (this.moves.length > 0 && this.moves[0]! <= now - 1000) this.moves.shift();
    const here = this.where(now);
    const from = { x: move.From[0], z: move.From[1] };
    if (this.moves.length >= 10) return void this.refused.push("Too many walks at once.");
    if (Math.max(Math.abs(from.x - here.x), Math.abs(from.z - here.z)) > 1) return void this.refused.push(`A walk starts where you are: ${from.x},${from.z} from ${here.x},${here.z}`);
    if (move.Path.length > 0 && move.Speed > MAX_SPEED) return void this.refused.push("Too fast.");
    let before = from;
    for (const [x, z] of move.Path) {
      if (Math.max(Math.abs(x - before.x), Math.abs(z - before.z)) !== 1) return void this.refused.push("Not a step.");
      before = { x, z };
    }
    this.from = from;
    this.path = move.Path.map(([x, z]) => ({ x, z }));
    this.speed = move.Path.length === 0 ? 0 : move.Speed;
    this.since = now;
    this.moves.push(now);
  }
}

/** A relay and the server it tells, on a clock the test moves; walks reach the server `latency` ms after being told. */
function rig(latency = 40) {
  let now = 1000;
  const server = new Server();
  const inFlight: { move: Move; at: number }[] = [];
  const relay = new WalkRelay((move) => inFlight.push({ move, at: now + latency }), () => now);
  const tick = (ms: number) => {
    now += ms;
    while (inFlight.length > 0 && inFlight[0]!.at <= now) {
      const m = inFlight.shift()!;
      server.take(m.move, m.at);
    }
  };
  return { relay, server, tick, inFlight };
}

describe("the walks told to the relay", () => {
  it("are never told more often than the server takes them", () => {
    const { relay, server, tick } = rig();
    relay.stand({ x: 0, z: 0 }, 4.2);
    tick(50);
    let told = 0;
    // A held walk east, onto another tile every few frames, asked every frame for three seconds.
    for (let f = 0, x = 0; f < 180; f++) {
      if (f % 4 === 0) x++;
      relay.on({ x, z: 0 });
      if (relay.walk([], 4.62, open)) told++;
      tick(1000 / 60);
    }
    expect(told).toBeGreaterThan(10);
    expect(told).toBeLessThanOrEqual(Math.ceil(3000 / MOVE_GAP) + 1);
    expect(server.refused).toEqual([]);
  });

  it("join on to where the server has the player when it runs behind, so none starts anywhere else", () => {
    const { relay, server, tick } = rig(120);
    relay.stand({ x: 0, z: 0 }, 4.2);
    tick(130);
    // Faster across the tiles than the walks told are walked (a corner brushed: two tiles in a sixth of a second).
    for (let f = 0, x = 0; f < 120; f++) {
      if (f % 3 === 0) x++;
      relay.on({ x, z: x % 2 });
      relay.walk([], 4.62, open);
      tick(1000 / 60);
    }
    // The last step, told once the gap is up.
    tick(MOVE_GAP);
    expect(relay.walk([], 4.62, open)).toBe(true);
    tick(2000);
    expect(server.refused).toEqual([]);
    expect(server.where(1e12)).toEqual({ x: 40, z: 0 });
  });

  it("join back along the old walk when the player is behind where the server has them", () => {
    const { relay, server, tick } = rig(40);
    relay.stand({ x: 0, z: 0 }, 4.2);
    tick(200);
    // A click's walk ten tiles east, told; the frames then run at half the clock, so the player falls behind the server.
    relay.on({ x: 0, z: 0 });
    expect(relay.walk(Array.from({ length: 10 }, (_, x) => ({ x: x + 1, z: 0 })), 4.2, open, 10)).toBe(true);
    let x = 0;
    for (let f = 0; f < 120; f++) {
      tick(1000 / 60);
      if (f % 40 === 39) x++;
      relay.on({ x, z: 0 });
    }
    // The server has them eight tiles on; they are on the third.
    expect(relay.where!.x - x).toBeGreaterThan(1);
    // Turned back west by a click: told from where the server has them, back to the player, then on.
    expect(relay.walk([{ x: x - 1, z: 0 }, { x: x - 2, z: 0 }], 4.2, open, 2)).toBe(true);
    tick(100);
    expect(server.refused).toEqual([]);
  });

  it("tell a click's walk from where the server has the player, as fast as keeps time with the walk", () => {
    const sent: Move[] = [];
    let now = 0;
    const relay = new WalkRelay((m) => sent.push(m), () => now);
    relay.stand({ x: 0, z: 0 }, 4.2);
    now += 1000;
    // Ten tiles east drawn as the line walked, 9.2 tiles of it truly left from where the player stands.
    const tiles = Array.from({ length: 10 }, (_, x) => ({ x: x + 1, z: 0 }));
    relay.on({ x: 0, z: 0 });
    expect(relay.walk(tiles, 4.2, open, 9.2)).toBe(true);
    expect(sent.at(-1)!.From).toEqual([0, 0]);
    expect(sent.at(-1)!.Path).toHaveLength(10);
    expect(sent.at(-1)!.Speed).toBeCloseTo((4.2 * 10) / 9.2, 9);
    // Started again at once: too soon, nothing told.
    expect(relay.walk(tiles, 4.2, open, 9.2)).toBe(false);
  });

  it("after a refusal, go on from where the server put the player", () => {
    const sent: Move[] = [];
    let now = 0;
    const relay = new WalkRelay((m) => sent.push(m), () => now);
    relay.stand({ x: 0, z: 0 }, 4.2);
    now += 1000;
    relay.placed({ x: 5, z: 5 });
    now += 1000;
    relay.on({ x: 5, z: 5 });
    relay.walk([{ x: 6, z: 5 }], 4.2, open, 1);
    expect(sent.at(-1)!.From).toEqual([5, 5]);
    expect(relay.where).toEqual({ x: 5, z: 5 });
  });

  it("after a refusal, tell the server the way to where the player stands, and the walks go on from it", () => {
    const { relay, server, tick } = rig(40);
    relay.stand({ x: 0, z: 0 }, 4.2);
    tick(200);
    // The server put the player back on (0, 0) (a reconnection, say) while they walked on to (4, 0).
    for (let x = 0; x <= 4; x++) relay.on({ x, z: 0 });
    const way = Array.from({ length: 5 }, (_, x) => ({ x, z: 0 }));
    expect(relay.catchUp(way, { x: 4, z: 0 })).toBe(true);
    // Refused again straight away: no second way told; the page stands the figure where the server says.
    expect(relay.catchUp(way, { x: 4, z: 0 })).toBe(false);
    tick(MOVE_GAP);
    // On east as before, joined on to the way told.
    for (let x = 5; x <= 8; x++) {
      relay.on({ x, z: 0 });
      relay.walk([], 4.62, open);
      tick(MOVE_GAP);
    }
    tick(3000);
    expect(server.refused).toEqual([]);
    expect(server.where(1e12)).toEqual({ x: 8, z: 0 });
  });

  it("never tells a way to catch up along longer than CATCH_UP", () => {
    const relay = new WalkRelay(() => {}, () => 5000);
    relay.stand({ x: 0, z: 0 }, 4.2);
    const way = Array.from({ length: CATCH_UP + 2 }, (_, x) => ({ x, z: 0 }));
    expect(relay.catchUp(way, way.at(-1)!)).toBe(false);
  });
});
