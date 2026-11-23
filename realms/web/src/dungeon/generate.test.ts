import { describe, expect, it } from "vitest";
import { DIRECTIONS, distance, hex, key } from "../hex";
import { THEMES, reach } from "../world/schema";
import { BOSS_INDEX, type Floor, type RunFloor, WARDEN_INDEX, generateFloor } from "./generate";

// Each theme's generator makes valid floors: every open hex reached from the arrival, exactly the run's encounters
// placed (with the warden before the stairs and the boss on the last floor), the entrance's spell table, and the same
// floor every time for the same run.

const runFloor = (floor: number, floors: number, count: number): RunFloor => ({
  Encounters: Array.from({ length: count }, (_, i) => ({ Index: i, Mob: `mob-${floor}-${i}` })),
  Warden: floor < floors - 1 ? `warden-${floor}` : null,
  Boss: floor === floors - 1 ? "the-boss" : null,
});

function check(floor: Floor, run: RunFloor): void {
  const open = new Set(floor.tiles.filter((t) => t[4] === 0).map((t) => `${t[0]},${t[1]}`));
  const isOpen = (h: { q: number; r: number }) => open.has(key(h));
  expect(isOpen(floor.arrive), "the arrival is open").toBe(true);
  const reached = reach(floor.arrive, isOpen);
  expect([...open].filter((k) => !reached.has(k)), "every open hex is reached from the arrival").toEqual([]);
  expect(isOpen(floor.up), "the way up is open").toBe(true);
  expect(distance(floor.up, floor.arrive)).toBe(1);

  const want = [...run.Encounters.map((e) => `${e.Index}:${e.Mob}:encounter`), ...(run.Warden ? [`${WARDEN_INDEX}:${run.Warden}:warden`] : []), ...(run.Boss ? [`${BOSS_INDEX}:${run.Boss}:boss`] : [])];
  expect(floor.spots.map((s) => `${s.index}:${s.mob}:${s.role}`).sort()).toEqual(want.sort());
  const places = new Set<string>();
  for (const s of floor.spots) {
    expect(isOpen(s), `${s.role} ${s.index} stands on open ground`).toBe(true);
    expect(places.has(key(s)), `${s.role} ${s.index} has a hex of its own`).toBe(false);
    places.add(key(s));
    expect(key(s) === key(floor.arrive) || key(s) === key(floor.up)).toBe(false);
  }
  if (floor.last) {
    expect(floor.down).toBeNull();
    expect(floor.wayOut && isOpen(floor.wayOut)).toBe(true);
  } else {
    expect(floor.down && isOpen(floor.down), "the stairs down are open").toBe(true);
    const warden = floor.spots.find((s) => s.role === "warden");
    if (warden) expect(distance(warden, floor.down!), "the warden stands before the stairs").toBeLessThanOrEqual(3);
  }
  const tables = floor.npcs.filter((n) => n.kind === "spell-table");
  if (floor.floor === 0) {
    expect(tables).toHaveLength(1);
    expect(DIRECTIONS.some((d) => reached.has(`${tables[0]!.q + d.q},${tables[0]!.r + d.r}`)), "the spell table is reached").toBe(true);
  } else expect(tables).toHaveLength(0);
}

describe("dungeon floors", () => {
  for (const theme of THEMES) {
    it(`${theme}: valid, connected floors with exactly the run's encounters`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const floors = theme === "tower" && seed % 3 === 0 ? 1 : 2 + (seed % 3);
        for (let floor = 0; floor < floors; floor++) {
          const run = runFloor(floor, floors, 2 + ((seed + floor) % 3));
          check(generateFloor({ theme, seed: seed * 7919, floor, floors, run }), run);
        }
      }
    });

    it(`${theme}: the same run gives the same floor, another seed another`, () => {
      const run = runFloor(0, 3, 3);
      const a = generateFloor({ theme, seed: 42, floor: 0, floors: 3, run });
      const b = generateFloor({ theme, seed: 42, floor: 0, floors: 3, run });
      const c = generateFloor({ theme, seed: 43, floor: 0, floors: 3, run });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    });
  }

  it("places a floor with no encounters but its warden", () => {
    const run: RunFloor = { Encounters: [], Warden: "w", Boss: null };
    check(generateFloor({ theme: "caves", seed: 5, floor: 0, floors: 2, run }), run);
    void hex;
  });
});
