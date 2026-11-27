import { describe, expect, it } from "vitest";
import { TOWN_LIMITS, lintTown } from "../../../src/world/lint";
import { readLayout } from "../layout";
import { groundsSize } from "./index";
import { INVENTED_SETTINGS, TOWN_SETTINGS, buildAll, buildOn, settingsMatrix } from "./preview";

// The town template (hub.ts) on the sixteen towns of layout.json, each on the setting the travel map gives it
// (town/settings.json): held to the street plan's lint and to what the world needs of a town - one gate in the south
// wall where every way of its icon comes in, everything with a door facing south, the market holding every card vendor
// at a stall, the inn by the way in - and the same inputs make the same town, byte for byte.

const layout = readLayout();
const built = buildAll(undefined, undefined, false);
const town = (id: string) => built.towns.find((t) => t.data.id === id)!;

describe("the town template", () => {
  it("makes all sixteen towns, each on a setting", () => {
    expect(built.towns.map((t) => t.data.id).sort()).toEqual(layout.towns.map((t) => t.id).sort());
    for (const id of layout.towns.map((t) => t.id)) expect(TOWN_SETTINGS[id], id).toBeDefined();
  });

  it("sizes the grounds in whole chunks", () => {
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

  it("faces every building south", () => {
    for (const t of built.towns) for (const b of t.buildings) expect(b.rot, b.id).toBe(0);
  });

  it("lets every way of the icon in and out through the one gate: the same inside, the same exit, open, south of the market", () => {
    const { land } = built;
    for (const t of built.towns) {
      const setting = TOWN_SETTINGS[t.data.id]!;
      expect(t.data.ways.map((w) => w.side).sort(), t.data.id).toEqual(setting.ways.map((w) => w.side).sort());
      const [first] = t.data.ways;
      const market = t.data.plan!.squares.find((s) => s.name === "The market")!;
      for (const w of t.data.ways) {
        expect(w.inside, `${t.data.id} ${w.side}`).toEqual(first!.inside);
        expect(w.exit, `${t.data.id} ${w.side}`).toEqual(first!.exit);
        expect(w.exit.length, `${t.data.id} ${w.side}`).toBe(3);
        for (const [x, z] of [...w.exit, w.inside]) expect(land.open(land.idx(x, z)), `${t.data.id} ${w.side} ${x},${z}`).toBe(true);
        expect(w.to, `${t.data.id} ${w.side}`).toBe(setting.ways.find((s) => s.side === w.side)!.to);
        // Arriving, one stands in the market, its whole width before them.
        expect(w.inside[1] >= market.z && w.inside[1] < market.z + market.d, `${t.data.id} arrives in its market`).toBe(true);
        for (const [, z] of w.exit) expect(z, `${t.data.id}'s exit lies past the market`).toBeGreaterThan(market.z + market.d);
      }
    }
  });

  it("holds every place a town needs: its inn by the way in, its temple or shrine, a guild, an armorer and the rest", () => {
    for (const t of built.towns) {
      const kinds = t.interiors.map((r) => r.kind);
      expect(kinds, t.data.id).toContain("inn");
      expect(kinds, t.data.id).toContain("temple");
      expect(t.inn.interior).toBe(`${t.data.id}-inn`);
      expect(t.npcs.some((n) => n.kind === "quest-board"), t.data.id).toBe(true);
      if (t.data.kind !== "village") {
        for (const k of ["guildhall", "smithy"] as const) expect(kinds, `${t.data.id} ${k}`).toContain(k);
        expect(kinds.includes("library") || kinds.includes("tower"), `${t.data.id}'s library or tower`).toBe(true);
        expect(t.npcs.some((n) => n.kind === "arena"), t.data.id).toBe(true);
      }
      // The inn's door is within a few steps of the avenue the gate opens onto.
      const gate = t.data.ways[0]!.inside;
      expect(Math.abs(t.inn.x - gate[0]), `${t.data.id}'s inn by the way in`).toBeLessThanOrEqual(10);
    }
  });

  it("stands every card vendor at a stall in the market, each before its own stall, and the exotic wares indoors", () => {
    for (const t of built.towns) {
      const market = t.data.plan!.squares.find((s) => s.name === "The market")!;
      const sold = t.npcs.filter((n) => n.kind === "vendor");
      const shops = t.data.plan!.places.filter((p) => p.kind === "shop");
      expect(shops.length, t.data.id).toBe(sold.length);
      for (const v of sold) {
        expect(v.x >= market.x && v.x < market.x + market.w && v.z >= market.z && v.z < market.z + market.d, `${v.id} in ${t.data.id}'s market`).toBe(true);
        expect(t.interiors.some((r) => r.vendor?.id === v.vendor), `${v.id} keeps no shop indoors`).toBe(false);
      }
    }
    expect(town("new-benalia").npcs.filter((n) => n.kind === "vendor").length).toBe(8);
    expect(town("new-benalia").interiors.some((r) => r.kind === "exotic-wares")).toBe(true);
  });

  it("refuses, by name, a setting it cannot honour", () => {
    expect(() => buildOn("serras-rest", { biome: "plains", sea: [], relief: 0, ways: [] })).toThrow(/no way out/);
  });

  it("makes the same town from the same inputs", () => {
    const again = buildAll(["new-benalia", "keld", "serras-rest"], undefined, false);
    for (const t of again.towns) {
      const first = town(t.data.id);
      // The pockets differ in the two worlds; everything is laid out from the pocket's corner.
      const [ox, oz] = first.data.grounds;
      const [px, pz] = t.data.grounds;
      const local = (list: typeof t.buildings, x0: number, z0: number) => JSON.stringify(list.map((b) => ({ ...b, x: b.x - x0, z: b.z - z0, ...(b.door ? { door: [b.door[0] - x0, b.door[1] - z0] } : {}) })));
      expect(local(t.buildings, px, pz)).toBe(local(first.buildings, ox, oz));
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

// Every town on any setting the travel map may give it (preview.ts `settingsMatrix`: each way alone, the pairs, three
// and four; the sea on sides that hold no way; a river on each side, through or none; relief 0, 0.5 and 1; the biomes in
// turn), and on the setting it stood on before the travel map: the template lays out every one of them.
describe("the town template on any setting", () => {
  it("lays out every town on every setting of the matrix", () => {
    const broken: string[] = [];
    for (const t of layout.towns) {
      for (const c of [...settingsMatrix(), { name: "invented", setting: INVENTED_SETTINGS[t.id]! }]) {
        try {
          const { town: built } = buildOn(t.id, c.setting);
          if (!built.interiors.some((r) => r.kind === "inn")) broken.push(`${t.id} [${c.name}]: no inn`);
        } catch (e) {
          broken.push(`${t.id} [${c.name}]: ${(e as Error).message.split("\n")[0]}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
