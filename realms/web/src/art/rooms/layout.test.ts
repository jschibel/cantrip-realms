import { describe, expect, it } from "vitest";
import { type InteriorData, isBlocked } from "../../world/format";
import { gridOfInterior } from "../../world/load";
import { checkInterior } from "../../world/lint";
import { PROPS } from "../props";
import { SURFACES } from "../surfaces";
import { ROOM_KINDS, ROOM_SIZES, ROOM_STYLES, type RoomKind, SPECIALTIES, layoutRoom } from "./layout";
import { ROOMS } from "./registry";
import "./index";

// Every room kind lays out in every style: a valid interior the lint accepts, its art all known and built, walked
// whole from its door (only its keepers' own tiles stand apart), the same room from the same spec and another from
// another seed, its size its building's within the kind's, and the people the game needs in it.

const triangles = (m: { parts: readonly { indices: readonly number[] }[] }) => m.parts.reduce((n, p) => n + p.indices.length / 3, 0);

const room = (kind: RoomKind, style: string, seed: number, extra: Partial<Parameters<typeof layoutRoom>[0]> = {}): InteriorData =>
  layoutRoom({ id: `${kind}-${style}-${seed}`, kind, style, seed, exit: [10, 20], ...extra });

/** The open tiles walked from the arrival, eight ways, never cutting a blocked corner (world/grid.ts). */
function walked(r: InteriorData): { open: string[]; reached: Set<string> } {
  const grid = gridOfInterior(r);
  const open: string[] = [];
  for (let z = 0; z < r.d; z++) for (let x = 0; x < r.w; x++) if (grid.walkable(x, z)) open.push(`${x},${z}`);
  const start = [r.entry[0], r.entry[1] - 1] as const;
  const reached = new Set<string>([`${start[0]},${start[1]}`]);
  const queue: (readonly [number, number])[] = [start];
  for (let k = 0; k < queue.length; k++) {
    const [x, z] = queue[k]!;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (!grid.walkable(nx, nz) || reached.has(`${nx},${nz}`)) continue;
        if (dx && dz && (!grid.walkable(x + dx, z) || !grid.walkable(x, z + dz))) continue;
        reached.add(`${nx},${nz}`);
        queue.push([nx, nz]);
      }
    }
  }
  return { open, reached };
}

describe("room layouts", () => {
  for (const kind of ROOM_KINDS) {
    it(`${kind}: every style and many seeds lay out valid rooms, walked whole from the door`, () => {
      for (const style of ROOM_STYLES) {
        for (let seed = 1; seed <= 12; seed++) {
          const r = room(kind, style, seed, seed % 3 === 0 ? { building: { w: 4 + (seed % 7), d: 3 + (seed % 5) } } : {});
          const name = `${kind} ${style} ${seed}`;
          expect(checkInterior(JSON.parse(JSON.stringify(r)), r.id), name).toEqual([]);
          expect(r.tiles).toHaveLength(r.w * (r.d + 1));
          const { open, reached } = walked(r);
          const keepers = new Set(r.npcs.filter((n) => n.kind !== "spell-table").map((n) => `${n.x},${n.z}`));
          expect(open.filter((t) => !reached.has(t) && !keepers.has(t)), `${name}: open tiles not reached from the door`).toEqual([]);
          for (const s of new Set(r.tiles.map((t) => t[1]).filter((s) => s !== ""))) expect(SURFACES.has(s), `${name}: surface ${s}`).toBe(true);
          for (const p of r.props) {
            expect(PROPS.has(p.id), `${name}: prop ${p.id}`).toBe(true);
            expect(PROPS.problems(p.id, p), `${name}: ${p.id}`).toEqual([]);
          }
          // Nobody stands on furniture: every NPC's tile is open, but a spell table's (it stands behind the table).
          const grid = gridOfInterior(r);
          for (const n of r.npcs) if (n.kind !== "spell-table") expect(grid.walkable(n.x, n.z), `${name}: ${n.id} at ${n.x},${n.z}`).toBe(true);
          const sill = r.tiles.slice(r.d * r.w);
          expect(sill.every(isBlocked), `${name}: the sill is not walked`).toBe(true);
        }
      }
    });

    it(`${kind}: its shell and every piece of its furniture build`, () => {
      for (const style of ROOM_STYLES) {
        const r = room(kind, style, 7);
        const shell = ROOMS.build(r.kind, r);
        expect(triangles(shell.model)).toBeGreaterThan(0);
        expect(shell.cutaways).toHaveLength(2);
        expect(shell.doorway).toBeDefined();
        expect(shell.bounds).toBeDefined();
        for (const p of r.props) expect(triangles(PROPS.build(p.id, p).model), `${kind} ${style}: ${p.id}`).toBeGreaterThan(0);
      }
    });

    it(`${kind}: the same spec gives the same room, another seed another`, () => {
      const a = JSON.stringify(room(kind, "benalish", 42));
      expect(JSON.stringify(room(kind, "benalish", 42))).toBe(a);
      const others = [43, 44, 45].map((s) => JSON.stringify(room(kind, "benalish", s)));
      expect(others.some((o) => o !== a)).toBe(true);
    });
  }

  it("sizes a room from its building, within its kind's sizes", () => {
    for (const kind of ROOM_KINDS) {
      for (const [bw, bd] of [[3, 3], [6, 5], [9, 7], [20, 14]] as const) {
        const r = room(kind, "keldon", 1, { building: { w: bw, d: bd } });
        const s = ROOM_SIZES[kind];
        expect(r.w).toBeGreaterThanOrEqual(s.w[0]);
        expect(r.w).toBeLessThanOrEqual(s.w[1]);
        expect(r.d).toBeGreaterThanOrEqual(s.d[0]);
        expect(r.d).toBeLessThanOrEqual(s.d[1]);
      }
    }
    expect(room("shop", "benalish", 1, { w: 12, d: 8 })).toMatchObject({ w: 12, d: 8 });
  });

  it("puts the people the game needs in the rooms that need them", () => {
    for (const style of ROOM_STYLES) {
      for (let seed = 1; seed <= 6; seed++) {
        const kinds = (kind: RoomKind) => room(kind, style, seed).npcs.map((n) => n.kind);
        expect(kinds("shop")).toContain("vendor");
        expect(kinds("exotic-wares")).toContain("vendor");
        expect(kinds("inn")).toEqual(expect.arrayContaining(["innkeeper", "spell-table"]));
        expect(room("inn", style, seed, { upstairs: false }).npcs.map((n) => n.kind)).toEqual(expect.arrayContaining(["innkeeper", "spell-table"]));
        expect(kinds("guildhall")).toContain("spell-table");
        expect(kinds("smithy")).toContain("armorer");
      }
    }
    const shop = room("shop", "benalish", 3, { keeper: { id: "grizzlegom", vendor: "grizzlegom", figure: "grizzlegom", name: "Grizzlegom" } });
    expect(shop.npcs[0]).toMatchObject({ id: "grizzlegom", kind: "vendor", vendor: "grizzlegom", figure: "grizzlegom" });
  });

  it("gives a shop the wares asked for, an inn its gallery, a tavern none", () => {
    for (const specialty of SPECIALTIES) expect(room("shop", "vess", 2, { specialty }).params).toMatchObject({ specialty });
    expect(room("inn", "benalish", 2).params?.gallery).toBeDefined();
    expect(room("inn", "benalish", 2, { upstairs: false }).params?.gallery).toBeUndefined();
    const wares = (specialty: string) => new Set(room("shop", "benalish", 5, { specialty }).props.map((p) => p.id));
    expect(wares("cards").has("card-case")).toBe(true);
    expect(wares("weapons").has("blade-rack")).toBe(true);
    expect(wares("curios").has("curio-case")).toBe(true);
    expect([...wares("books")].some((id) => id === "bookcase" || id === "bookshelf")).toBe(true);
  });

  it("lights every room by its own fires, candles, windows and glows", () => {
    for (const kind of ROOM_KINDS) {
      const r = room(kind, "benalish", 9);
      expect(r.lights!.length, kind).toBeGreaterThan(0);
      expect(r.lights!.length, kind).toBeLessThanOrEqual(12);
    }
  });
});
