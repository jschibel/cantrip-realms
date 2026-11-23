import { describe, expect, it } from "vitest";
import { BODIES, Character, SLOTS } from "../character";
import type { VoxModel } from "./format";
import { allModels, getModel, mountsOf, validateModel } from "./models";

const GEAR_MESHES = ["circlet", "helm", "amulet", "armor", "robe", "gloves", "boots", "ring", "relic"];
const MOB_MESHES = ["humanoid", "ghoul", "angel", "drake", "elf", "goblin", "wurm", "construct", "spirit", "phyrexian"];

describe("voxel models", () => {
  const models = allModels();

  it("has every body, gear mesh and mob model", () => {
    for (const body of BODIES) expect(getModel(`body-${body}`)?.kind).toBe("body");
    for (const mesh of GEAR_MESHES) expect(getModel(mesh)?.kind).toBe("gear");
    for (const mesh of MOB_MESHES) expect(getModel(mesh)?.kind).toBe("mob");
  });

  it("names each file for its model and finds nothing wrong in any", () => {
    expect(models.length).toBeGreaterThan(0);
    for (const { file, model } of models) {
      expect(file).toBe(`${model.id}.vox.json`);
      expect(validateModel(model)).toEqual([]);
    }
  });

  it("gives every body every attachment point a gear mesh hangs on, sized where a piece is fitted", () => {
    const gear = models.map((m) => m.model).filter((m) => m.kind === "gear");
    for (const body of BODIES) {
      const model = getModel(`body-${body}`)!;
      for (const piece of gear) {
        for (const p of piece.parts) {
          const point = model.attach?.[p.mount!];
          expect(point, `${model.id} lacks ${p.mount} for ${piece.id}`).toBeDefined();
          if (p.fit) expect(point!.size, `${model.id}'s ${p.mount} has no size for ${piece.id}`).toBeDefined();
        }
      }
    }
  });

  it("finds a model's problems", () => {
    const bad: VoxModel = {
      id: "Bad Model",
      kind: "gear",
      voxel: 1 / 16,
      palette: ["red"],
      parts: [
        { name: "a", pivot: [0, 0, 0], origin: [0, 0, 0], size: [2, 1, 1], layers: [["0"]] },
        { name: "b", parent: "c", mount: "elbow" as never, pivot: [0, 0, 0], origin: [0, 0, 0], size: [1, 1, 1], layers: [["5"]] },
      ],
    };
    const problems = validateModel(bad).join("\n");
    expect(problems).toMatch(/kebab-case/);
    expect(problems).toMatch(/palette 0/);
    expect(problems).toMatch(/row 0 is 1 long/);
    expect(problems).toMatch(/"5" is not a palette index/);
    expect(problems).toMatch(/parent "c"/);
    expect(problems).toMatch(/unknown mount/);
    expect(problems).toMatch(/needs a mount/);
    expect(mountsOf(bad)).toEqual(["elbow"]);
  });
});

describe("characters", () => {
  it("stands a player about a person's height, wearing a piece of gear in every slot", () => {
    for (const body of BODIES) {
      const c = Character.player("Test", { body, palette: 2, identity: ["U", "R"], slots: {} });
      expect(c.height).toBeGreaterThan(1.1);
      expect(c.height).toBeLessThan(1.8);
      const before = countMeshes(c);
      for (const slot of SLOTS) {
        const mesh = { head: "helm", neck: "amulet", body: "armor", hands: "gloves", feet: "boots", ring1: "ring", ring2: "ring", relic: "relic" }[slot];
        c.wear(slot, { mesh, palette: ["#f1b44c", "#5b8fd6"] });
      }
      expect(countMeshes(c)).toBe(before + 1 + 1 + 3 + 2 + 2 + 1 + 1 + 1);
      c.wear("body", null);
      expect(countMeshes(c)).toBe(before + 1 + 1 + 2 + 2 + 1 + 1 + 1);
    }
  });

  it("draws every mob model, and an unknown one as the humanoid", () => {
    for (const mesh of MOB_MESHES) {
      const c = Character.mob(mesh, { mesh, palette: ["#8c909c", "#7a1f24", "#f1b44c"] });
      expect(countMeshes(c)).toBe(getModel(mesh)!.parts.length);
      expect(c.height).toBeGreaterThan(0.5);
    }
    const unknown = Character.mob("?", { mesh: "no-such-mesh", palette: ["#8c909c"] });
    expect(countMeshes(unknown)).toBe(getModel("humanoid")!.parts.length);
    const big = Character.mob("big", { mesh: "drake", palette: ["#c8432c"], size: 2 });
    const small = Character.mob("small", { mesh: "drake", palette: ["#c8432c"] });
    expect(big.height).toBeCloseTo(small.height * 2, 5);
  });

  it("animates without leaving its parts' rest when standing", () => {
    const c = Character.mob("w", { mesh: "wurm", palette: ["#6b963e"] });
    for (let i = 0; i < 30; i++) c.animate(1 / 30, i < 15);
    c.play("cast");
    c.animate(0.1, false);
    expect(countMeshes(c)).toBeGreaterThan(5);
  });
});

function countMeshes(c: Character): number {
  let n = 0;
  c.root.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh) n++;
  });
  return n;
}
