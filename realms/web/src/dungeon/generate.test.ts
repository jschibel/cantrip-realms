import { describe, expect, it } from "vitest";
import { PROPS } from "../art/props";
import { SURFACES } from "../art/surfaces";
import { THEMES } from "../world/format";
import { floorBounds } from "./assemble";
import { bossIndex, generateDungeonFloor, gridOfFloor, winsToOpen } from "./index";
import type { DungeonFloor, RunFloor } from "./types";

// Each theme's generator makes one arena room a floor, on squares (design.md A6, "Dungeon runs": a dungeon is a
// tournament): level throughout, seen whole on a 16:9 window at the closest zoom, entered at the south - the arrival a step
// from the way back out - with a round's gate at the north and the boss's hall's way out at its head beside the boss;
// every tile of floor walked to from the arrival - eight ways, never cutting a corner - without stepping onto a way;
// exactly the run's challengers placed, each on a tile of its own, apart, walked to; the boss alone in its hall; the
// entrance's spell table; the run's shrine at one side of the floor that holds it, prayed at from before it; every id the
// floor names known to the art; and the same floor every time for the same run.

const runFloor = (floor: number, floors: number, count: number, shrine = false): RunFloor => {
  const hall = floor === floors - 1;
  return {
    Encounters: hall ? [] : Array.from({ length: count }, (_, i) => ({ Index: i, Mob: `mob-${floor}-${i}` })),
    Boss: hall ? "the-boss" : null,
    Shrine: shrine,
  };
};

const key = (x: number, z: number) => `${x},${z}`;

/** Tiles reached from a tile walking eight ways, crossing only `cross` tiles, never cutting a corner past one that is not. */
function reach(from: readonly [number, number], walk: (x: number, z: number) => boolean, cross: (x: number, z: number) => boolean): Set<string> {
  const seen = new Set([key(from[0], from[1])]);
  const queue: [number, number][] = [[from[0], from[1]]];
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i]!;
    if (i > 0 && !cross(x, z)) continue;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (!walk(nx, nz) || seen.has(key(nx, nz))) continue;
        if (dx && dz && !(cross(nx, z) && cross(x, nz))) continue;
        seen.add(key(nx, nz));
        queue.push([nx, nz]);
      }
    }
  }
  return seen;
}

export function check(floor: DungeonFloor, run: RunFloor): void {
  expect(floor.tiles).toHaveLength(floor.w * floor.d);
  expect(floor.cells).toHaveLength(floor.d);
  for (const row of floor.cells) expect(row).toHaveLength(floor.w);
  expect(floor.tiles.every((t) => t[0] === 0), "every tile level: no ledge, no hop").toBe(true);
  const grid = gridOfFloor(floor);
  const walk = (x: number, z: number) => grid.walkable(x, z);
  const stops = new Set([floor.up, floor.down, floor.wayOut].filter((t): t is NonNullable<typeof t> => t !== null).map(([x, z]) => key(x, z)));
  const cross = (x: number, z: number) => walk(x, z) && !stops.has(key(x, z));
  const [ax, az] = floor.arrive;
  expect(walk(ax, az), "the arrival is walked on").toBe(true);
  expect(stops.has(key(ax, az))).toBe(false);

  // One room: every tile walked on is reached from the arrival without crossing a way, and the room fills most of what
  // bounds it - an arena, no maze of passages.
  const reached = reach(floor.arrive, walk, cross);
  const open: string[] = [];
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  let ground = 0;
  for (let z = 0; z < floor.d; z++) {
    for (let x = 0; x < floor.w; x++) {
      if (walk(x, z)) open.push(key(x, z));
      if (floor.cells[z]![x] === "." && !(x === floor.up[0] && z === floor.up[1])) {
        ground++;
        [minX, minZ, maxX, maxZ] = [Math.min(minX, x), Math.min(minZ, z), Math.max(maxX, x), Math.max(maxZ, z)];
      }
    }
  }
  expect(open.filter((k) => !reached.has(k)), "every tile walked on is reached from the arrival, no way crossed").toEqual([]);
  const [w, d] = [maxX - minX + 1, maxZ - minZ + 1];
  expect(w, "the arena's width").toBeGreaterThanOrEqual(22);
  expect(w, "the arena's width").toBeLessThanOrEqual(28);
  expect(d, "the arena's depth").toBeGreaterThanOrEqual(13);
  expect(d, "the arena's depth").toBeLessThanOrEqual(18);
  // Seen whole on a 16:9 window at the closest zoom: the camera's 30 tiles by 16.875 (render/camera.ts, `insideScale`).
  const [bx0, bz0, bx1, bz1] = floorBounds(floor);
  expect(bx1 - bx0, "the view's width").toBeLessThanOrEqual(30);
  expect(bz1 - bz0, "the view's depth").toBeLessThanOrEqual(16.875);
  expect(ground / (w * d), "the room fills its bounds").toBeGreaterThan(0.6);

  // The way back out at the south, the arrival a step north of it; a round's gate at the north, reached; the hall's way
  // out at its head.
  expect(walk(floor.up[0], floor.up[1]), "the way back is walked onto").toBe(true);
  expect([floor.up[0] - ax, floor.up[1] - az], "the way back is just south of the arrival").toEqual([0, 1]);
  expect(az, "the arrival at the south of the arena").toBe(maxZ);
  if (floor.last) {
    expect(floor.down).toBeNull();
    // The way out, beside the boss - or where it would stand, when it rests this run (design.md A6).
    expect(floor.wayOut && walk(floor.wayOut[0], floor.wayOut[1]), "the way out is walked onto").toBe(true);
    expect(reached.has(key(floor.wayOut![0], floor.wayOut![1])), "the way out is reached").toBe(true);
    expect(floor.wayOut![1] - minZ, "the way out at the hall's head").toBeLessThanOrEqual(2);
  } else {
    expect(floor.wayOut).toBeNull();
    expect(floor.down && walk(floor.down[0], floor.down[1]), "the gate is walked onto").toBe(true);
    expect(reached.has(key(floor.down![0], floor.down![1])), "the gate is reached").toBe(true);
    expect(floor.down![1], "the gate at the north of the arena").toBe(minZ);
    expect(floor.down![0], "the gate straight ahead of the way in").toBe(ax);
  }

  // Exactly the run's fights: a round's challengers, the hall's boss alone.
  const want = [...run.Encounters.map((e) => `${e.Index}:${e.Mob}:encounter`), ...(run.Boss ? [`${run.Encounters.length}:${run.Boss}:boss`] : [])];
  expect(floor.spots.map((s) => `${s.index}:${s.mob}:${s.role}`).sort()).toEqual(want.sort());
  if (floor.last) expect(floor.spots.every((s) => s.role === "boss")).toBe(true);
  const places = new Set<string>();
  for (const s of floor.spots) {
    expect(walk(s.x, s.z), `${s.role} ${s.index} stands on walked ground`).toBe(true);
    expect(reached.has(key(s.x, s.z)), `${s.role} ${s.index} is walked to from the arrival`).toBe(true);
    expect(places.has(key(s.x, s.z)), `${s.role} ${s.index} has a tile of its own`).toBe(false);
    expect(stops.has(key(s.x, s.z)) || key(s.x, s.z) === key(ax, az), `${s.role} ${s.index} is on no way`).toBe(false);
    for (const o of floor.spots) if (o !== s) expect(Math.max(Math.abs(o.x - s.x), Math.abs(o.z - s.z)), "challengers stand apart").toBeGreaterThanOrEqual(3);
    // Its circle under it: something reads as "a challenger waits here".
    expect(floor.props.some((p) => p.id === "dungeon-ring" && Math.floor(p.x) === s.x && Math.floor(p.z) === s.z), `${s.role} ${s.index}'s circle`).toBe(true);
    places.add(key(s.x, s.z));
  }
  const boss = floor.spots.find((s) => s.role === "boss");
  if (boss) {
    expect(boss.z - minZ, "the boss at the head of its hall").toBeLessThanOrEqual(3);
    expect(Math.max(Math.abs(boss.x - floor.wayOut![0]), Math.abs(boss.z - floor.wayOut![1])), "the way out beside the boss").toBeLessThanOrEqual(5);
  }

  const tables = floor.npcs.filter((n) => n.kind === "spell-table");
  if (floor.floor === 0) {
    expect(tables).toHaveLength(1);
    const t = tables[0]!;
    expect(walk(t.x, t.z), "the spell table stands on its tile").toBe(false);
    const beside = [-1, 0, 1].flatMap((dz) => [-1, 0, 1].map((dx) => [t.x + dx, t.z + dz] as const)).some(([x, z]) => reached.has(key(x, z)));
    expect(beside, "the spell table is reached").toBe(true);
    expect(Math.max(Math.abs(t.x - ax), Math.abs(t.z - az)), "the spell table by the way in").toBeLessThanOrEqual(6);
    expect(floor.props.some((p) => p.id === "spell-desk")).toBe(true);
  } else expect(tables).toHaveLength(0);
  // The run's shrine (design.md A6): on its floor alone, on a blocked tile of its own at one side, prayed at from before it.
  const shrines = floor.npcs.filter((n) => n.kind === "heart-shrine");
  if (run.Shrine) {
    expect(shrines).toHaveLength(1);
    const s = shrines[0]!;
    expect(floor.shrine).toEqual([s.x, s.z]);
    expect(walk(s.x, s.z), "the shrine stands on its tile").toBe(false);
    expect(places.has(key(s.x, s.z)) || stops.has(key(s.x, s.z))).toBe(false);
    expect(reached.has(key(s.x, s.z + 1)), "the shrine is prayed at from the tile before it").toBe(true);
    expect(Math.min(s.x - minX, maxX - s.x), "the shrine at one side").toBeLessThanOrEqual(4);
    expect(floor.props.filter((p) => p.id === "dungeon-shrine" && Math.floor(p.x) === s.x && Math.floor(p.z) === s.z)).toHaveLength(1);
  } else {
    expect(shrines).toHaveLength(0);
    expect(floor.shrine).toBeNull();
  }
  for (const p of floor.props) expect(PROPS.has(p.id), `prop ${p.id}`).toBe(true);
  for (const t of floor.tiles) if (t[1] !== "") expect(SURFACES.has(t[1]), `surface ${t[1]}`).toBe(true);
  expect(floor.lights.length).toBeLessThanOrEqual(16);
}

describe("dungeon floors on squares: a tournament's arenas", () => {
  for (const theme of THEMES) {
    it(`${theme}: each floor one arena, with exactly the run's challengers or its boss`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const floors = 2 + (seed % 4);
        for (let floor = 0; floor < floors; floor++) {
          const run = runFloor(floor, floors, seed % 5 === 0 ? 1 + (seed % 4) : 3, (seed + floor) % 3 === 0);
          const f = generateDungeonFloor({ theme, seed: seed * 7919, floor, floors, run });
          check(f, run);
        }
      }
    });

    it(`${theme}: the same run gives the same floor, another seed another`, () => {
      const run = runFloor(0, 3, 3);
      const a = generateDungeonFloor({ theme, seed: 42, floor: 0, floors: 3, run });
      const b = generateDungeonFloor({ theme, seed: 42, floor: 0, floors: 3, run });
      const c = generateDungeonFloor({ theme, seed: 43, floor: 0, floors: 3, run });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    });

    it(`${theme}: every prop it names builds`, () => {
      for (const floor of [0, 2]) {
        const f = generateDungeonFloor({ theme, seed: 5, floor, floors: 3, run: runFloor(floor, 3, 3, true) });
        for (const p of f.props) expect(PROPS.build(p.id, p).model.parts.length, `${theme}: ${p.id}`).toBeGreaterThan(0);
      }
      for (const open of [false, true]) expect(PROPS.build("dungeon-portcullis", { id: "dungeon-portcullis", x: 3, z: 1, args: { open } }).model.parts.length).toBeGreaterThan(0);
    });
  }

  it("places a round with no challengers, and a hall whose boss rests", () => {
    for (const theme of THEMES) {
      const bare: RunFloor = { Encounters: [], Boss: null };
      check(generateDungeonFloor({ theme, seed: 5, floor: 0, floors: 2, run: bare }), bare);
      check(generateDungeonFloor({ theme, seed: 6, floor: 1, floors: 2, run: bare }), bare);
    }
  });

  it("opens a round's gate at all its challengers but one, at least one; the boss is fought past the encounters", () => {
    expect([0, 1, 2, 3, 4].map(winsToOpen)).toEqual([0, 1, 1, 2, 3]);
    expect(bossIndex({ theme: "crypt", seed: 1, floor: 2, floors: 3, run: runFloor(2, 3, 0) })).toBe(0);
  });
});
