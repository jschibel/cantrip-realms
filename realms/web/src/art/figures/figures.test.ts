import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CAST_SETS, CONTENT_GEAR, CONTENT_MOBS } from "./catalogue";
import { BODY_NAMES, FIGURES, Figure, GEAR_PARTS, MOB_MESHES, SKINS, figureSpec, lookFigure, mobFigure, playerFigure } from "./index";
import { rampOf } from "./ramps";
import type { FigureSpec } from "./rig";

// The figures (realms/docs/tech.md B5, "Characters"): every mesh the content names builds, every gear look maps to a part and
// shows, every body in every palette and color builds, the townsfolk vary by seed, and the rig acts.

const here = dirname(fileURLToPath(import.meta.url));

/** Builds a spec into a figure and checks it is whole: every part's parent exists, it stands up, it animates. */
function builds(spec: FigureSpec): Figure {
  const names = new Set(spec.parts.map((p) => p.name));
  expect(names.size, `${spec.name}: part names are unique`).toBe(spec.parts.length);
  for (const p of spec.parts) {
    if (p.parent) expect(names.has(p.parent), `${spec.name}: ${p.name}'s parent ${p.parent}`).toBe(true);
    for (const n of [...p.size, ...p.at, ...p.box]) expect(Number.isFinite(n), `${spec.name}: ${p.name} is finite`).toBe(true);
    expect(Math.min(...p.size), `${spec.name}: ${p.name} has a size`).toBeGreaterThan(0);
  }
  const f = new Figure(spec);
  expect(f.height, `${spec.name} stands up`).toBeGreaterThan(0.5);
  f.update(0.1, 3);
  f.update(0.1, 0);
  return f;
}

describe("mob meshes", () => {
  it("every mesh the content's mobs name is a mesh, and builds in each mob's colors and size", () => {
    expect(CONTENT_MOBS.length).toBeGreaterThan(50);
    for (const mob of CONTENT_MOBS) {
      expect(MOB_MESHES.has(mob.model.mesh), `${mob.id}'s mesh ${mob.model.mesh}`).toBe(true);
      builds(mobFigure(mob.model, mob.id, mob.creature));
    }
  });

  it("every mesh builds at its own colors, at small and large sizes", () => {
    for (const mesh of MOB_MESHES.ids()) {
      for (const size of [0.9, 1, 1.5, 1.9]) builds(mobFigure({ mesh, palette: [], size }, `${mesh}-${size}`));
    }
  });

  it("names every color a mesh reads, and its own default for each", () => {
    for (const mesh of MOB_MESHES.ids()) {
      const m = MOB_MESHES.get(mesh);
      expect(m.slots.length, mesh).toBeGreaterThan(0);
      expect(m.palette.length, mesh).toBe(m.slots.length);
      expect(m.about.length, mesh).toBeGreaterThan(10);
    }
  });

  it("covers every mob mesh the server accepts (RealmContent.MobMeshes)", () => {
    const cs = readFileSync(join(here, "../../../../dotnet/Cantrip.Realms.Server/Content/RealmContent.cs"), "utf8");
    const set = /MobMeshes \{ get; \} = new HashSet<string>\(StringComparer\.Ordinal\)\s*\{([^}]*)\}/.exec(cs);
    expect(set, "the server's list of mob meshes").not.toBeNull();
    const server = [...set![1]!.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]!);
    expect(server.length).toBeGreaterThan(10);
    for (const mesh of server) expect(MOB_MESHES.has(mesh), `the server's mesh ${mesh}`).toBe(true);
  });

  it("draws an unknown mesh as the humanoid", () => {
    const spec = mobFigure({ mesh: "no-such-thing", palette: ["#ff0000"] }, "x");
    expect(spec.name.startsWith("mob:humanoid:")).toBe(true);
    builds(spec);
  });

  it("gives each look its own name, and the same look the same name", () => {
    const a = mobFigure({ mesh: "dragon", palette: ["#c8432c"], size: 1.5 }, "shivan-dragon");
    const b = mobFigure({ mesh: "dragon", palette: ["#2f5fa8"], size: 1.5 }, "shivan-dragon");
    const c = mobFigure({ mesh: "dragon", palette: ["#c8432c"], size: 1.5 }, "shivan-dragon");
    expect(a.name).not.toBe(b.name);
    expect(a.name).toBe(c.name);
    expect(JSON.stringify(a.parts.map((p) => [p.name, p.size]))).toBe(JSON.stringify(c.parts.map((p) => [p.name, p.size])));
  });

  it("builds bigger figures for bigger mobs, in whole texels", () => {
    const small = mobFigure({ mesh: "giant", palette: [], size: 1 }, "g");
    const large = mobFigure({ mesh: "giant", palette: [], size: 1.6 }, "g");
    expect(new Figure(large).height).toBeGreaterThan(new Figure(small).height * 1.3);
    for (const p of large.parts) for (const n of p.size) expect(Number.isInteger(n), `${p.name}: ${p.size}`).toBe(true);
  });

  it("gives the bosses their own figures, bigger than the roster's people", () => {
    const bosses = CONTENT_MOBS.filter((m) => m.boss);
    expect(bosses.map((m) => m.model.mesh).sort()).toEqual(["garna", "liliana", "lyra", "praetor", "rofellos", "teferi"]);
    const soldier = new Figure(mobFigure({ mesh: "humanoid", palette: [] }, "s")).height;
    for (const b of bosses) expect(new Figure(mobFigure(b.model, b.id, b.creature)).height, b.id).toBeGreaterThan(soldier * 1.2);
  });

  it("makes the twenty tower mages twenty different figures", () => {
    const mages = CONTENT_MOBS.filter((m) => m.id.startsWith("mage-"));
    expect(mages.length).toBe(20);
    const looks = new Set(mages.map((m) => JSON.stringify(mobFigure(m.model, m.id, m.creature).parts.map((p) => [p.name, p.size]))));
    expect(looks.size).toBeGreaterThanOrEqual(18);
  });
});

describe("gear", () => {
  it("maps every gear item's look to a part made for its slot", () => {
    expect(CONTENT_GEAR.length).toBeGreaterThan(20);
    for (const g of CONTENT_GEAR) {
      expect(GEAR_PARTS.has(g.look.mesh), `${g.id}'s look ${g.look.mesh}`).toBe(true);
      expect(GEAR_PARTS.get(g.look.mesh).slot, g.id).toBe(g.slot);
    }
  });

  it("shows every item: a character wearing it is drawn differently from one who is not", () => {
    for (const g of CONTENT_GEAR) {
      const slot = g.slot === "ring" ? "ring1" : g.slot;
      for (const body of BODY_NAMES) {
        const bare = playerFigure({ body, palette: 0, identity: "W", slots: {} });
        const worn = playerFigure({ body, palette: 0, identity: "W", slots: { [slot]: g.look } });
        expect(worn.name, `${g.id} on ${body}`).not.toBe(bare.name);
        const shown = (s: FigureSpec) => JSON.stringify(s.parts.map((p) => [p.name, p.size, p.at]));
        const sameParts = shown(worn) === shown(bare);
        // Either it adds or reshapes parts, or it repaints them: a robe or armor replaces the clothes' faces.
        if (sameParts) expect(["body"].includes(g.slot), `${g.id} changes the figure`).toBe(true);
        builds(worn);
      }
    }
  });

  it("puts a ring on the right hand in ring1 and the left in ring2, glowing", () => {
    const ring = { mesh: "ring", palette: ["#c9ced8", "#62a4c2"] };
    const r = playerFigure({ body: "tall", palette: 1, identity: "U", slots: { ring1: ring } });
    const l = playerFigure({ body: "tall", palette: 1, identity: "U", slots: { ring2: ring } });
    expect(r.parts.find((p) => p.name === "ring.r.gem")?.parent).toBe("arm.r");
    expect(l.parts.find((p) => p.name === "ring.l.gem")?.parent).toBe("arm.l");
    expect(r.parts.find((p) => p.name === "ring.r.gem")?.glow).toBe(true);
  });

  it("floats the relic beside the character, circling", () => {
    const spec = playerFigure({ body: "lithe", palette: 2, identity: "B", slots: { relic: { mesh: "relic", palette: ["#c9a46a", "#4a7fbf"] } } });
    const relic = spec.parts.find((p) => p.name === "relic")!;
    expect(relic.parent).toBeUndefined();
    expect(relic.motion?.kind).toBe("orbit");
  });

  it("wears an unknown mesh as nothing rather than failing", () => {
    const spec = playerFigure({ body: "broad", palette: 0, identity: "R", slots: { head: { mesh: "no-such-part", palette: [] } } });
    builds(spec);
  });

  it("builds every gear part on every body", () => {
    for (const id of GEAR_PARTS.ids()) {
      const part = GEAR_PARTS.get(id);
      for (const body of BODY_NAMES) builds(playerFigure({ body, palette: 3, identity: "G", slots: { [part.slot === "ring" ? "ring2" : part.slot]: { mesh: id, palette: [...part.palette] } } }));
    }
  });
});

describe("player bodies", () => {
  it("builds four bodies in six palettes and every identity", () => {
    expect(BODY_NAMES).toEqual(["lithe", "broad", "tall", "stocky"]);
    expect(SKINS.length).toBe(6);
    const names = new Set<string>();
    for (const body of BODY_NAMES) {
      for (let palette = 0; palette < SKINS.length; palette++) {
        for (const identity of ["W", "U", "B", "R", "G", "", "WU", "BG"]) {
          const spec = playerFigure({ body, palette, identity, slots: {} });
          names.add(spec.name);
          builds(spec);
        }
      }
    }
    expect(names.size).toBe(4 * 6 * 8);
  });

  it("gives the four bodies different proportions", () => {
    const heights = BODY_NAMES.map((body) => new Figure(playerFigure({ body, palette: 0, identity: "W", slots: {} })).height);
    expect(new Set(heights.map((h) => h.toFixed(3))).size).toBeGreaterThanOrEqual(3);
  });

  it("draws presence's Look as the player's own figure", () => {
    const look = { Body: "stocky", Palette: 4, Slots: { head: { Mesh: "circlet", Palette: ["#f1b44c", "#5b8fd6"] }, feet: { Mesh: "boots", Palette: ["#3d5a3a", "#b39a5f"] } } };
    const other = lookFigure(look, "UR");
    const own = playerFigure({ body: "stocky", palette: 4, identity: "UR", slots: { head: { mesh: "circlet", palette: ["#f1b44c", "#5b8fd6"] }, feet: { mesh: "boots", palette: ["#3d5a3a", "#b39a5f"] } } });
    expect(other.name).toBe(own.name);
    expect(other.parts.length).toBe(own.parts.length);
    builds(lookFigure({ Body: "no-such-body", Palette: 99, Slots: {} }, ""));
  });
});

describe("the figures registry", () => {
  it("builds every figure, and varies the seeded ones by seed", () => {
    for (const id of FIGURES.ids()) {
      builds(figureSpec(id));
      if (FIGURES.get(id).seeded) {
        const looks = new Set([0, 1, 2, 3, 4, 5].map((seed) => JSON.stringify(figureSpec(id, undefined, seed).parts.map((p) => [p.name, p.size]))));
        expect(looks.size, `${id} varies`).toBeGreaterThan(1);
        expect(figureSpec(id, undefined, 3).name).toBe(figureSpec(id, undefined, 3).name);
        expect(figureSpec(id, undefined, 3).name).not.toBe(figureSpec(id, undefined, 4).name);
      }
    }
  });

  it("has townsfolk and guards for every region, shopkeepers, innkeepers, the ferryman and planar traders", () => {
    for (const r of ["benalia", "orvada", "caligo", "keld", "llanowar"]) {
      expect(FIGURES.has(`townsfolk-${r}`)).toBe(true);
      expect(FIGURES.has(`guard-${r}`)).toBe(true);
    }
    for (const id of ["shopkeeper", "innkeeper", "ferryman", "planar-trader"]) expect(FIGURES.has(id)).toBe(true);
  });

  it("builds every entry of the cast page", () => {
    for (const set of Object.values(CAST_SETS)) for (const e of set.entries()) builds(e.spec());
  });
});

describe("the rig", () => {
  it("casts: the arms go up, the spark shows, then it all comes back", () => {
    const f = new Figure(playerFigure({ body: "tall", palette: 0, identity: "U", slots: {} }));
    f.update(0.1, 0);
    const arm = f.root.getObjectByName("arm.r")!;
    const spark = f.root.getObjectByName("spark")!;
    const rest = arm.rotation.x;
    expect(spark.visible).toBe(false);
    f.act("cast");
    for (let i = 0; i < 30; i++) f.update(1 / 60, 0);
    expect(f.acting).toBe("cast");
    expect(arm.rotation.x).toBeLessThan(rest - 1.5);
    expect(spark.visible).toBe(true);
    for (let i = 0; i < 120; i++) f.update(1 / 60, 0);
    expect(f.acting).toBeNull();
    expect(spark.visible).toBe(false);
    expect(Math.abs(arm.rotation.x - rest)).toBeLessThan(0.2);
  });

  it("interacts: the right arm reaches out", () => {
    const f = new Figure(playerFigure({ body: "lithe", palette: 0, identity: "G", slots: {} }));
    f.update(0.1, 0);
    const arm = f.root.getObjectByName("arm.r")!;
    const rest = arm.rotation.x;
    f.act("interact");
    for (let i = 0; i < 20; i++) f.update(1 / 60, 0);
    expect(arm.rotation.x).toBeLessThan(rest - 1);
  });

  it("walks a quadruped's legs in diagonal pairs, and beats wings", () => {
    const f = new Figure(mobFigure({ mesh: "pegasus", palette: [] }, "p"));
    for (let i = 0; i < 12; i++) f.update(1 / 60, 3);
    const fl = f.root.getObjectByName("leg.fl")!.rotation.x;
    const br = f.root.getObjectByName("leg.br")!.rotation.x;
    const fr = f.root.getObjectByName("leg.fr")!.rotation.x;
    expect(Math.abs(fl - br)).toBeLessThan(1e-6);
    expect(Math.sign(fl)).toBe(-Math.sign(fr));
    const wing = f.root.getObjectByName("wing.l")!;
    const z0 = wing.rotation.z;
    for (let i = 0; i < 5; i++) f.update(1 / 60, 3);
    expect(wing.rotation.z).not.toBe(z0);
  });

  it("keeps the slice's figures exactly as they were (no motions, no glow parts)", () => {
    for (const id of ["hero", "knight", "grizzlegom", "goblin", "skeleton", "ghoul", "townswoman"]) {
      const spec = figureSpec(id);
      expect(spec.parts.every((p) => !p.motion && !p.glow), id).toBe(true);
      expect(spec.hover).toBeUndefined();
    }
  });

  it("ramps a content color as the slice ramps: the color at step 3, darker and cooler below, lighter above", () => {
    const r = rampOf("#c8432c");
    expect(r.length).toBe(7);
    expect(r[3]).toBe(0xc8432c);
    const lum = (c: number) => 0.3 * ((c >> 16) & 255) + 0.59 * ((c >> 8) & 255) + 0.11 * (c & 255);
    for (let i = 1; i < 7; i++) expect(lum(r[i]!), `step ${i}`).toBeGreaterThan(lum(r[i - 1]!));
  });
});
