import { describe, expect, it } from "vitest";
import { type Open, type Point, legClear, slide } from "../render/motion";
import type { Tile } from "../world/grid";
import { CATCH_UP, DRIFT, MAX_SPEED, MOVE_GAP, type Move, WalkRelay } from "./relay";

const everywhere: Open = () => true;
const apart = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** The server's own check of a walk told (PresenceHub.Problem): where it has the player then, and the walk's lines. */
class Server {
  from: Point = { x: 0.5, z: 0.5 };
  path: Point[] = [];
  speed = 0;
  since = 0;
  readonly moves: number[] = [];
  readonly refused: { reason: string; at: Point }[] = [];

  constructor(private readonly open: Open = everywhere) {}

  where(now: number): Point {
    if (this.path.length === 0 || this.speed <= 0) return this.path.at(-1) ?? this.from;
    let walked = (Math.max(0, now - this.since) / 1000) * this.speed;
    let at = this.from;
    for (const next of this.path) {
      const leg = apart(at, next);
      if (walked < leg) return { x: at.x + ((next.x - at.x) * walked) / leg, z: at.z + ((next.z - at.z) * walked) / leg };
      walked -= leg;
      at = next;
    }
    return at;
  }

  take(move: Move, now: number): void {
    while (this.moves.length > 0 && this.moves[0]! <= now - 1000) this.moves.shift();
    const here = this.where(now);
    const refuse = (reason: string) => void this.refused.push({ reason, at: here });
    const from = { x: move.From[0], z: move.From[1] };
    if (this.moves.length >= 10) return refuse("Too many walks at once.");
    if (!this.open(Math.floor(from.x), Math.floor(from.z))) return refuse("Nobody can stand there.");
    if (apart(from, here) > 1.5) return refuse(`A walk starts where you are: ${from.x},${from.z} from ${here.x},${here.z}`);
    if (move.Path.length > 0 && (move.Speed <= 0 || move.Speed > MAX_SPEED)) return refuse("Too fast.");
    let before = from;
    for (const [x, z] of move.Path) {
      if (!legClear(this.open, before, { x, z })) return refuse(`Crosses something: ${before.x},${before.z} to ${x},${z}`);
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
function rig(latency = 40, open: Open = everywhere) {
  let now = 1000;
  const server = new Server(open);
  const inFlight: { move: Move; at: number }[] = [];
  const relay = new WalkRelay((move) => inFlight.push({ move, at: now + latency }), () => now);
  const tick = (ms: number) => {
    now += ms;
    while (inFlight.length > 0 && inFlight[0]!.at <= now) {
      const m = inFlight.shift()!;
      server.take(m.move, m.at);
    }
  };
  return { relay, server, tick, inFlight, clock: () => now };
}

const FRAME = 1000 / 60;
const PACE = 4.2;

/** The grid's eight-way path between two tiles of open ground. */
function straightWay(a: Tile, b: Tile): Tile[] {
  const out = [a];
  let { x, z } = a;
  while (x !== b.x || z !== b.z) {
    x += Math.sign(b.x - x);
    z += Math.sign(b.z - z);
    out.push({ x, z });
  }
  return out;
}

describe("the walks told to the relay", () => {
  it("are never told more often than the server takes them", () => {
    const { relay, server, tick } = rig();
    relay.stand({ x: 0.5, z: 0.5 });
    tick(50);
    let told = 0;
    // A held walk east, every frame for three seconds.
    for (let f = 0; f < 180; f++) {
      if (relay.frame({ x: 0.5 + (f * PACE) / 60, z: 0.5 }, null, PACE, everywhere)) told++;
      tick(FRAME);
    }
    expect(told).toBeGreaterThan(10);
    expect(told).toBeLessThanOrEqual(Math.ceil(3000 / MOVE_GAP) + 1);
    expect(server.refused).toEqual([]);
  });

  it("keep the server close behind a long held walk, at every heading, never refused", () => {
    // Told as it is walked, from where the last ended: the server has the player as far behind the figure as a walk
    // takes to be told and to reach it, and never further, however long the walk.
    for (const [degrees, latency] of [0, 20, 27, 45, 63, 90, 135, 200].flatMap((d) => [[d, 40], [d, 150]] as const)) {
      const { relay, server, tick, clock } = rig(latency);
      const a = (degrees * Math.PI) / 180;
      relay.stand({ x: 0.5, z: 0.5 });
      tick(200);
      let worst = 0;
      for (let f = 0; f < 60 * 30; f++) {
        const t = (f / 60) * PACE;
        const here = { x: 0.5 + Math.cos(a) * t, z: 0.5 + Math.sin(a) * t };
        relay.frame(here, null, PACE, everywhere);
        tick(FRAME);
        if (f > 60) worst = Math.max(worst, apart(server.where(clock()), here));
      }
      expect(server.refused, `${degrees} degrees, ${latency} ms`).toEqual([]);
      expect(worst, `${degrees} degrees, ${latency} ms`).toBeLessThanOrEqual((PACE * (MOVE_GAP + latency + 2 * FRAME)) / 1000);
      // Stopped: the server ends where the figure does.
      const end = { x: 0.5 + Math.cos(a) * ((1799 / 60) * PACE), z: 0.5 + Math.sin(a) * ((1799 / 60) * PACE) };
      for (let f = 0; f < 60; f++) {
        relay.frame(end, null, PACE, everywhere);
        tick(FRAME);
      }
      expect(apart(server.where(clock() + 5000), end)).toBeLessThan(1e-9);
    }
  });

  it("tell a held walk sliding round a block as lines the server takes, its bends kept", () => {
    const blocked = new Set(["3,2", "4,2", "5,2", "6,2", "3,3", "4,3", "5,3", "6,3", "3,4", "4,4", "5,4", "6,4"]);
    const open: Open = (x, z) => x >= 0 && z >= 0 && x < 10 && z < 7 && !blocked.has(`${x},${z}`);
    const { relay, server, tick, clock } = rig(60, open);
    let p = { x: 1.5, z: 5.5 };
    server.from = p;
    relay.stand(p);
    tick(200);
    // Steered at one point after another round the block, a frame at a time, sliding along it where it is in the way.
    for (const to of [{ x: 8.5, z: 1 }, { x: 8, z: 5.5 }, { x: 1, z: 1.4 }, { x: 5, z: 6 }, { x: 2.7, z: 0.5 }]) {
      for (let f = 0; f < 150; f++) {
        const d = apart(to, p);
        if (d > 0.02) {
          const step = Math.min(d, PACE / 60);
          p = slide(open, p.x, p.z, ((to.x - p.x) / d) * step, ((to.z - p.z) / d) * step);
        }
        relay.frame(p, null, PACE, open);
        tick(FRAME);
        expect(apart(server.where(clock()), p)).toBeLessThan(1.5);
      }
    }
    expect(server.refused).toEqual([]);
  });

  it("tell a click's walk once, from the figure, and again only when the figure is DRIFT from where the server has it", () => {
    const sent: Move[] = [];
    let now = 0;
    const relay = new WalkRelay((m) => sent.push(m), () => now);
    relay.stand({ x: 0.5, z: 0.5 });
    now += 1000;
    const ahead = [{ x: 4.5, z: 0.5 }, { x: 9.5, z: 3.5 }];
    expect(relay.frame({ x: 0.5, z: 0.5 }, ahead, PACE, everywhere)).toBe(true);
    expect(sent.at(-1)).toEqual({ From: [0.5, 0.5], Path: [[4.5, 0.5], [9.5, 3.5]], Speed: PACE });
    // Walked in time with the clock: nothing more is told.
    for (let f = 1; f <= 60; f++) {
      now += FRAME;
      expect(relay.frame({ x: 0.5 + (f * PACE) / 60, z: 0.5 }, ahead, PACE, everywhere)).toBe(false);
    }
    // Frames at half the clock: the figure falls behind, and once it is DRIFT behind it is told again from where it is.
    let x = 0.5 + PACE;
    let told = 0;
    for (let f = 0; f < 30; f++) {
      now += FRAME;
      x += PACE / 120;
      if (relay.frame({ x, z: 0.5 }, ahead, PACE, everywhere)) {
        told++;
        expect(sent.at(-1)!.From).toEqual([x, 0.5]);
        expect(apart(relay.where!, { x, z: 0.5 })).toBeLessThan(1e-9);
      }
    }
    expect(told).toBeGreaterThan(0);
    expect(told).toBeLessThan(4);
    // A new goal: told at once (once the gap is up).
    now += MOVE_GAP;
    expect(relay.frame({ x, z: 0.5 }, [{ x: 2.5, z: 5.5 }], PACE, everywhere)).toBe(true);
    expect(sent.at(-1)!.Path).toEqual([[2.5, 5.5]]);
  });

  it("tell the figure standing where a click's walk was given up", () => {
    const { relay, server, tick, clock } = rig(40);
    relay.stand({ x: 0.5, z: 0.5 });
    tick(200);
    relay.frame({ x: 0.5, z: 0.5 }, [{ x: 9.5, z: 0.5 }], PACE, everywhere);
    for (let f = 1; f <= 30; f++) {
      tick(FRAME);
      relay.frame({ x: 0.5 + (f * PACE) / 60, z: 0.5 }, [{ x: 9.5, z: 0.5 }], PACE, everywhere);
    }
    const stop = { x: 0.5 + (30 * PACE) / 60, z: 0.5 };
    for (let f = 0; f < 30; f++) {
      tick(FRAME);
      relay.frame(stop, null, PACE, everywhere);
    }
    expect(server.refused).toEqual([]);
    expect(apart(server.where(clock() + 10_000), stop)).toBeLessThan(1e-9);
  });

  it("after a refusal, tell the server the way to where the figure stands, and the walks after join on to it", () => {
    const { relay, server, tick, clock } = rig(40);
    relay.stand({ x: 0.5, z: 0.5 });
    tick(200);
    // The server put the player back on (0.5, 0.5) (a reconnection, say) while they walked on east: a walk is refused.
    let x = 6.5;
    relay.placed({ x: 3.5, z: 0.5 });
    tick(MOVE_GAP);
    for (let f = 0; f < 10 && server.refused.length === 0; f++) {
      relay.frame({ x, z: 0.5 }, null, PACE, everywhere);
      x += PACE / 60;
      tick(FRAME);
    }
    // (The relay had them on (3.5, 0.5); the server, on (0.5, 0.5).)
    server.from = { x: 0.5, z: 0.5 };
    server.path = [];
    tick(MOVE_GAP);
    relay.frame({ x, z: 0.5 }, null, PACE, everywhere);
    tick(100);
    const refusal = server.refused.at(-1)!;
    expect(refusal.at).toEqual({ x: 0.5, z: 0.5 });
    const here = { x, z: 0.5 };
    expect(relay.catchUp(refusal.at, straightWay({ x: 0, z: 0 }, { x: Math.floor(x), z: 0 }), here)).toBe(true);
    // Refused again straight away: no second way told; the page stands the figure where the server says.
    expect(relay.catchUp(refusal.at, straightWay({ x: 0, z: 0 }, { x: Math.floor(x), z: 0 }), here)).toBe(false);
    const before = server.refused.length;
    // On east as before, held: joined on to the way told until the server has caught up.
    for (let f = 0; f < 240; f++) {
      x += PACE / 60;
      tick(FRAME);
      relay.frame({ x, z: 0.5 }, null, PACE, everywhere);
    }
    tick(500);
    expect(server.refused.length).toBe(before);
    expect(apart(server.where(clock()), { x, z: 0.5 })).toBeLessThan(1.5);
  });

  it("after a refusal it could not catch up on, go on from where the server put the player", () => {
    const sent: Move[] = [];
    let now = 0;
    const relay = new WalkRelay((m) => sent.push(m), () => now);
    relay.stand({ x: 0.5, z: 0.5 });
    now += 1000;
    relay.placed({ x: 5.25, z: 5.75 });
    now += 1000;
    relay.frame({ x: 5.25, z: 5.75 }, [{ x: 6.5, z: 5.5 }], PACE, everywhere);
    expect(sent.at(-1)!.From).toEqual([5.25, 5.75]);
  });

  it("never tells a way to catch up along longer than CATCH_UP", () => {
    const relay = new WalkRelay(() => {}, () => 5000);
    relay.stand({ x: 0.5, z: 0.5 });
    const way = straightWay({ x: 0, z: 0 }, { x: CATCH_UP + 1, z: 0 });
    expect(relay.catchUp({ x: 0.5, z: 0.5 }, way, { x: CATCH_UP + 1.5, z: 0.5 })).toBe(false);
  });

  it("make DRIFT well inside what the server allows", () => {
    expect(DRIFT).toBeLessThan(1.5 / 2);
  });
});
