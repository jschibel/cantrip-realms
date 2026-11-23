import { describe, expect, it } from "vitest";
import { PROPS } from "../../art/props";
import { SURFACES } from "../../art/surfaces";
import { THEMES, type Theme } from "../../world/format";
import { bossIndex, generateDungeonFloor, gridOfFloor, wardenIndex } from "./index";
import type { DungeonFloor, RunFloor } from "./types";

// Each theme's generator makes valid floors on squares: every tile of floor walked to from the arrival - eight ways,
// never cutting a corner - without stepping onto a stair or the way out; exactly the run's encounters placed, each on
// a tile of its own, the warden on the walk to the stairs and the boss on the last floor; the entrance's spell table;
// every id the floor names known to the art; and the same floor every time for the same run.

const runFloor = (floor: number, floors: number, count: number): RunFloor => ({
  Encounters: Array.from({ length: count }, (_, i) => ({ Index: i, Mob: `mob-${floor}-${i}` })),
  Warden: floor < floors - 1 ? `warden-${floor}` : null,
  Boss: floor === floors - 1 ? "the-boss" : null,
});

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
  const grid = gridOfFloor(floor);
  const walk = (x: number, z: number) => grid.walkable(x, z);
  const stops = new Set([floor.up, floor.down, floor.wayOut].filter((t): t is NonNullable<typeof t> => t !== null).map(([x, z]) => key(x, z)));
  const cross = (x: number, z: number) => walk(x, z) && !stops.has(key(x, z));
  const [ax, az] = floor.arrive;
  expect(walk(ax, az), "the arrival is walked on").toBe(true);
  expect(stops.has(key(ax, az))).toBe(false);
  // Every tile walked on is reached from the arrival without crossing a stair or the way out.
  const reached = reach(floor.arrive, walk, cross);
  const open: string[] = [];
  for (let z = 0; z < floor.d; z++) for (let x = 0; x < floor.w; x++) if (walk(x, z)) open.push(key(x, z));
  expect(open.filter((k) => !reached.has(k)), "every tile walked on is reached from the arrival, no stair crossed").toEqual([]);
  expect(walk(floor.up[0], floor.up[1]), "the way up is walked onto").toBe(true);
  expect(Math.max(Math.abs(floor.up[0] - ax), Math.abs(floor.up[1] - az)), "the arrival is a step from the way up").toBe(1);

  const want = [
    ...run.Encounters.map((e) => `${e.Index}:${e.Mob}:encounter`),
    ...(run.Warden ? [`${run.Encounters.length}:${run.Warden}:warden`] : []),
    ...(run.Boss ? [`${run.Encounters.length + 1}:${run.Boss}:boss`] : []),
  ];
  expect(floor.spots.map((s) => `${s.index}:${s.mob}:${s.role}`).sort()).toEqual(want.sort());
  const places = new Set<string>();
  for (const s of floor.spots) {
    expect(walk(s.x, s.z), `${s.role} ${s.index} stands on walked ground`).toBe(true);
    expect(places.has(key(s.x, s.z)), `${s.role} ${s.index} has a tile of its own`).toBe(false);
    expect(stops.has(key(s.x, s.z)) || key(s.x, s.z) === key(ax, az), `${s.role} ${s.index} is on no stair`).toBe(false);
    places.add(key(s.x, s.z));
  }
  if (floor.last) {
    expect(floor.down).toBeNull();
    if (run.Boss) expect(floor.wayOut && walk(floor.wayOut[0], floor.wayOut[1]), "the way out is walked onto").toBe(true);
  } else {
    expect(floor.down && walk(floor.down[0], floor.down[1]), "the stairs down are walked onto").toBe(true);
    const warden = floor.spots.find((s) => s.role === "warden");
    if (warden) expect(Math.max(Math.abs(warden.x - floor.down![0]), Math.abs(warden.z - floor.down![1])), "the warden stands before the stairs").toBeLessThanOrEqual(3);
  }
  const tables = floor.npcs.filter((n) => n.kind === "spell-table");
  if (floor.floor === 0) {
    expect(tables).toHaveLength(1);
    const t = tables[0]!;
    expect(walk(t.x, t.z), "the spell table stands on its tile").toBe(false);
    const beside = [-1, 0, 1].flatMap((dz) => [-1, 0, 1].map((dx) => [t.x + dx, t.z + dz] as const)).some(([x, z]) => reached.has(key(x, z)));
    expect(beside, "the spell table is reached").toBe(true);
    expect(floor.props.some((p) => p.id === "spell-table")).toBe(true);
  } else expect(tables).toHaveLength(0);
  for (const p of floor.props) expect(PROPS.has(p.id), `prop ${p.id}`).toBe(true);
  for (const t of floor.tiles) if (t[1] !== "") expect(SURFACES.has(t[1]), `surface ${t[1]}`).toBe(true);
}

describe("dungeon floors on squares", () => {
  for (const theme of THEMES) {
    it(`${theme}: valid, connected floors with exactly the run's encounters`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const floors = theme === "tower" && seed % 3 === 0 ? 1 : 2 + (seed % 4);
        for (let floor = 0; floor < floors; floor++) {
          const run = runFloor(floor, floors, 2 + ((seed + floor) % 4));
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
        const f = generateDungeonFloor({ theme, seed: 5, floor, floors: 3, run: runFloor(floor, 3, 3) });
        for (const p of f.props) expect(PROPS.build(p.id, p).model.parts.length, `${theme}: ${p.id}`).toBeGreaterThan(0);
      }
    });
  }

  it("places a floor with no encounters but its warden, and a last floor with no boss", () => {
    for (const theme of THEMES as readonly Theme[]) {
      const lone: RunFloor = { Encounters: [], Warden: "w", Boss: null };
      check(generateDungeonFloor({ theme, seed: 5, floor: 0, floors: 2, run: lone }), lone);
      const bare: RunFloor = { Encounters: [{ Index: 0, Mob: "m" }], Warden: null, Boss: null };
      check(generateDungeonFloor({ theme, seed: 6, floor: 1, floors: 2, run: bare }), bare);
    }
  });

  it("numbers the warden and the boss after the encounters", () => {
    const req = { theme: "crypt" as const, seed: 1, floor: 0, floors: 1, run: runFloor(0, 1, 3) };
    expect(wardenIndex(req)).toBe(3);
    expect(bossIndex(req)).toBe(4);
  });
});
