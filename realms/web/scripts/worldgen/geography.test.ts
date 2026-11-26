import { describe, expect, it } from "vitest";
import { type GeoDungeon, type GeoTown, type Geography, type XZ, checkGeography, inPolygon, reachable, readGeography, regionAt, selfCrossing, signedArea2 } from "./geography";
import { readLayout } from "./layout";

// The travel map's geography (realms/content/dominaria/geography.json) holds everything the world generator relies on,
// and the check catches each kind of fault in it.

type Mutable = { -readonly [K in keyof Geography]: Geography[K] };

function town(geo: Geography, id: string): GeoTown {
  const t = geo.towns[id];
  if (t === undefined) throw new Error(`no town ${id}`);
  return t;
}

function dungeon(geo: Geography, id: string): GeoDungeon {
  const d = geo.dungeons[id];
  if (d === undefined) throw new Error(`no dungeon ${id}`);
  return d;
}

describe("Dominaria's geography", () => {
  const geo = readGeography();
  const layout = readLayout();

  it("passes the check", () => {
    expect(checkGeography(geo, layout)).toEqual([]);
  });

  it("is the Domains: Aerona one landmass from Benalia to the tail, Icehaven apart across the Rip", () => {
    const on = ([x, z]: XZ) => geo.landmasses.find((l) => inPolygon(l.points, x + 0.5, z + 0.5))?.id;
    expect(on(town(geo, "new-benalia").at)).toBe("aerona");
    expect(on(town(geo, "serras-rest").at)).toBe("aerona");
    expect(on(dungeon(geo, "phyrexian-portal").at)).toBe("aerona");
    expect(on(town(geo, "keld").at)).toBe("icehaven");
    expect(on(town(geo, "tolarian-academy").at)).toBe("walassa");
    const [x, z] = town(geo, "llanowar").at;
    expect(regionAt(geo, x + 0.5, z + 0.5)?.id).toBe("llanowar");
  });

  it("walls North Aerona from South Aerona with the Hurloons, crossed only at their passes", () => {
    const W = geo.size[0];
    const north = [dungeon(geo, "hurloon-caves").at, dungeon(geo, "phyrexian-portal").at];
    const from = town(geo, "new-benalia").at;
    const at = (grid: Uint8Array, [x, z]: XZ) => grid[z * W + x] === 1;
    const shut = reachable(geo, from, false);
    expect(at(shut, town(geo, "llanowar").at)).toBe(true); // South Aerona is one country
    for (const place of north) expect(at(shut, place)).toBe(false);
    const open = reachable(geo, from, true);
    for (const place of north) expect(at(open, place)).toBe(true);
    // and each Hurloon pass alone is a way through
    for (const pass of geo.passes.filter((p) => p.range === "hurloon")) {
      expect(at(reachable({ ...geo, passes: [pass] }, from, true), north[0] ?? from)).toBe(true);
    }
  });
});

describe("the geography check", () => {
  const geo = readGeography();
  const layout = readLayout();
  const changed = (change: (g: Mutable) => void): string[] => {
    const g = structuredClone(geo) as Mutable;
    change(g);
    return checkGeography(g, layout);
  };

  it("finds a coast that crosses itself", () => {
    const bow: XZ[] = [[100, 100], [120, 100], [100, 120], [120, 120]];
    expect(selfCrossing(bow)).not.toBeNull();
    expect(changed((g) => { g.landmasses = [...g.landmasses, { id: "bow", name: "", points: bow }]; }).some((p) => p.includes("cross"))).toBe(true);
  });

  it("finds a polygon run the wrong way round", () => {
    const square: XZ[] = [[20, 20], [20, 24], [24, 24], [24, 20]];
    expect(signedArea2(square)).toBeLessThan(0);
    expect(changed((g) => { g.lakes = [...g.lakes, { id: "backwards", name: "", kind: "water", points: square }]; }).some((p) => p.includes("not clockwise"))).toBe(true);
  });

  it("finds a town at sea, and one in the wrong region", () => {
    const keld = town(geo, "keld");
    expect(changed((g) => { g.towns = { ...g.towns, keld: { ...keld, at: [5, 5] } }; }).some((p) => p.startsWith("town keld"))).toBe(true);
    expect(changed((g) => { g.towns = { ...g.towns, keld: { ...keld, region: "parma" } }; })).toContain("town keld is in keld, not parma");
  });

  it("finds a town or dungeon missing or extra", () => {
    expect(changed((g) => { const { denawa: _, ...rest } = g.towns; g.towns = rest; })).toContain("town denawa of layout.json has no place");
    expect(changed((g) => { g.dungeons = { ...g.dungeons, "nowhere-keep": dungeon(geo, "benalish-keep") }; })).toContain("dungeon nowhere-keep is not layout.json's");
  });

  it("finds a river that ends on land, and a pass off its range", () => {
    expect(changed((g) => { g.rivers = [...g.rivers, { id: "dry", name: "", width: 1, points: [[100, 350], [104, 356]] }]; }).some((p) => p.startsWith("river dry ends on land"))).toBe(true);
    expect(changed((g) => { g.passes = g.passes.map((p, i) => (i === 0 ? { ...p, at: [70, 330] } : p)); }).some((p) => p.includes("is not on the crest"))).toBe(true);
  });

  it("finds a town no road reaches, and a ferry over land", () => {
    expect(changed((g) => { g.roads = g.roads.filter((r) => r.to !== "denawa" && r.from !== "denawa"); })).toContain("no road or ferry reaches town denawa from new-benalia");
    expect(changed((g) => { g.ferries = g.ferries.map((f) => (f.id === "keldon-ferry" ? { ...f, to: town(geo, "keld").at } : f)); }).some((p) => p.includes("keldon-ferry: its lane crosses land"))).toBe(true);
  });
});
