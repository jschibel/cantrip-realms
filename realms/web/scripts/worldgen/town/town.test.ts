import { describe, expect, it } from "vitest";
import { TOWN_LIMITS, lintTown } from "../../../src/world/lint";
import { readLayout } from "../layout";
import { groundsSize } from "./index";
import { formOf } from "./forms";
import { INVENTED_SETTINGS, TOWN_SETTINGS, buildAll, buildOn, settingsMatrix } from "./preview";

// The town generator on the sixteen towns of layout.json, each on the setting the travel map gives it (town/settings.json):
// every one is made strictly - its own checks (check.ts: the camera, the square, the walks, the grounds, the places it
// must hold) throw on any rule broken - and is held here again to the street plan's lint and to what the world needs of
// it; and the same inputs make the same town, byte for byte.

const layout = readLayout();
const built = buildAll(undefined, undefined, false);

describe("the town generator", () => {
  it("makes all sixteen towns, each on a setting", () => {
    expect(built.towns.map((t) => t.data.id).sort()).toEqual(layout.towns.map((t) => t.id).sort());
    for (const id of layout.towns.map((t) => t.id)) expect(TOWN_SETTINGS[id], id).toBeDefined();
  });

  it("sizes the grounds in whole chunks, the town inside its walked country and its apron", () => {
    for (const t of built.towns) {
      const plan = layout.towns.find((p) => p.id === t.data.id)!;
      const [w, d] = groundsSize(plan);
      expect(w % 32, t.data.id).toBe(0);
      expect(d % 32, t.data.id).toBe(0);
      const [x0, z0, x1, z1] = t.data.grounds;
      expect([x1 - x0, z1 - z0], t.data.id).toEqual([w, d]);
      expect(x0 % 32 === 0 && z0 % 32 === 0, t.data.id).toBe(true);
    }
  });

  it("keeps every town to its street plan's lint", () => {
    const { land } = built;
    const open = (x: number, z: number) => land.inside(x, z) && land.open(land.idx(x, z));
    const buildings = built.towns.flatMap((t) => t.buildings);
    for (const t of built.towns) expect(lintTown({ ...t.data, ways: undefined }, open, buildings, TOWN_LIMITS), t.data.id).toEqual([]);
  });

  it("faces every place with a door or a sign south, and nothing north", () => {
    for (const t of built.towns) {
      for (const b of t.buildings) {
        expect(b.rot, b.id).not.toBe(2);
        if (b.interior || b.sign) expect(b.rot, b.id).toBe(0);
      }
    }
  });

  it("gives every way out an exit at the walked ground's edge and an inside on its road", () => {
    const { land } = built;
    for (const t of built.towns) {
      const setting = TOWN_SETTINGS[t.data.id]!;
      expect(t.data.ways.map((w) => w.side).sort(), t.data.id).toEqual(setting.ways.map((w) => w.side).sort());
      for (const w of t.data.ways) {
        expect(w.exit.length, `${t.data.id} ${w.side}`).toBeGreaterThanOrEqual(3);
        for (const [x, z] of [...w.exit, w.inside]) expect(land.open(land.idx(x, z)), `${t.data.id} ${w.side} ${x},${z}`).toBe(true);
        expect(w.to, `${t.data.id} ${w.side}`).toBe(setting.ways.find((s) => s.side === w.side)!.to);
      }
    }
  });

  it("holds the places the town had: its vendors' shops, its houses, its inn and the rest", () => {
    const houses = (id: string) => built.towns.find((t) => t.data.id === id)!.interiors.filter((r) => r.kind === "house").length;
    expect(houses("new-benalia")).toBe(10);
    for (const id of ["capashen-hold", "llanowar", "vess-estate", "keld", "tolarian-academy"]) expect(houses(id), id).toBe(6);
    for (const t of built.towns.filter((t) => t.data.kind === "village")) expect(houses(t.data.id), t.data.id).toBe(3);
    for (const t of built.towns) {
      expect(t.interiors.some((r) => r.id === `${t.data.id}-inn`), t.data.id).toBe(true);
      expect(t.inn.interior).toBe(`${t.data.id}-inn`);
      expect(t.npcs.some((n) => n.kind === "quest-board"), t.data.id).toBe(true);
    }
  });

  it("never lays two towns of one form to the same plan", () => {
    // Each town's buildings about its centre: no two of one form share half of them.
    const sig = (t: (typeof built.towns)[number]) => {
      const sq = t.data.plan!.squares[0]!;
      return new Set(t.buildings.map((b) => `${b.x - sq.x},${b.z - sq.z},${b.w},${b.d}`));
    };
    for (let a = 0; a < built.towns.length; a++) {
      for (let b = a + 1; b < built.towns.length; b++) {
        const p = layout.towns.find((t) => t.id === built.towns[a]!.data.id)!;
        const q = layout.towns.find((t) => t.id === built.towns[b]!.data.id)!;
        if (formOf(p) !== formOf(q)) continue;
        const sa = sig(built.towns[a]!);
        const sb = sig(built.towns[b]!);
        const shared = [...sa].filter((k) => sb.has(k)).length;
        expect(shared / Math.max(1, Math.min(sa.size, sb.size)), `${p.id} and ${q.id}`).toBeLessThan(0.5);
      }
    }
  });

  it("refuses, by name, a setting it cannot honour", () => {
    expect(() => buildOn("serras-rest", { biome: "plains", sea: ["south"], relief: 0, ways: [{ side: "south", to: "x" }] })).toThrow(/a way out on its south side, which is sea/);
    expect(() => buildOn("serras-rest", { biome: "plains", sea: ["east"], river: "east", relief: 0, ways: [{ side: "south", to: "x" }] })).toThrow(/a river past its east side, which is sea/);
    expect(() => buildOn("serras-rest", { biome: "plains", sea: [], relief: 0, ways: [] })).toThrow(/no way out/);
  });

  it("makes the same town from the same inputs", () => {
    const again = buildAll(["new-benalia", "keld", "serras-rest"], undefined, false);
    for (const t of again.towns) {
      const first = built.towns.find((b) => b.data.id === t.data.id)!;
      // The pockets differ in the two worlds; everything is laid out from the pocket's corner.
      const [ox, oz] = first.data.grounds;
      const [px, pz] = t.data.grounds;
      const shift = (s: string) => s;
      expect(JSON.stringify(t.buildings.map((b) => ({ ...b, x: b.x - px, z: b.z - pz, ...(b.door ? { door: [b.door[0] - px, b.door[1] - pz] } : {}) })))).toBe(
        shift(JSON.stringify(first.buildings.map((b) => ({ ...b, x: b.x - ox, z: b.z - oz, ...(b.door ? { door: [b.door[0] - ox, b.door[1] - oz] } : {}) })))),
      );
      const tiles = (land: typeof built.land, x0: number, z0: number) => {
        const out: number[] = [];
        for (let z = 0; z < t.data.grounds[3] - t.data.grounds[1]; z++) for (let x = 0; x < t.data.grounds[2] - t.data.grounds[0]; x++) {
          const i = land.idx(x0 + x, z0 + z);
          out.push(land.height[i]!, land.surface[i]!, land.flags[i]!);
        }
        return out.join(",");
      };
      expect(tiles(again.land, px, pz)).toBe(tiles(built.land, ox, oz));
      expect(t.report).toEqual(first.report);
    }
  });
});

// Every form on any setting the travel map may give it (preview.ts `settingsMatrix`: each way alone, the pairs, three
// and four; the sea on sides that hold no way; a river on each side, through or none; relief 0, 0.5 and 1; the biomes in
// turn), and each town on the setting it stood on before the travel map: all strict, every place held. A build of the
// capital takes seconds, so a run takes three settings of the matrix (a way alone, a pair, all four); TOWN_MATRIX=full
// takes them all (a quarter of an hour), as a change to the town generator should.
const FULL_MATRIX = process.env.TOWN_MATRIX === "full";
describe("the town generator on any setting", () => {
  const byForm = new Map<string, string[]>();
  for (const t of layout.towns) byForm.set(formOf(t), [...(byForm.get(formOf(t)) ?? []), t.id]);
  for (const [form, ids] of byForm) {
    it(`lays out every ${form} (${ids.join(", ")}) on every setting of the matrix`, { timeout: 2_400_000 }, () => {
      const broken: string[] = [];
      // A home town and a village of the form, where it has both.
      const kinds = [...new Map(ids.map((id) => [layout.towns.find((t) => t.id === id)!.kind, id])).values()];
      for (const id of kinds) {
        const cases = FULL_MATRIX ? [...settingsMatrix(), { name: "invented", setting: INVENTED_SETTINGS[id]! }] : settingsMatrix().filter((_, k) => k === 2 || k === 7 || k === 12);
        for (const c of cases) {
          try {
            const { town } = buildOn(id, c.setting);
            expect(town.interiors.some((r) => r.kind === "inn"), `${id} ${c.name}`).toBe(true);
          } catch (e) {
            broken.push(`${id} [${c.name}]: ${(e as Error).message.split("\n").slice(0, 4).join(" | ")}`);
          }
        }
      }
      expect(broken).toEqual([]);
    });
  }
});
