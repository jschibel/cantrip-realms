import { describe, expect, it } from "vitest";
import { MeshBuilder, sides } from "../art/paint/builder";
import { flat } from "../art/paint/materials";
import { occluderOfModel, twoRects } from "./occlude";

// The occluder fade's shapes (occlude.ts): what an occluder stands on, and its box.

describe("an occluder", () => {
  it("stands where its lowest parts are, unless it says otherwise", () => {
    const b = new MeshBuilder();
    // A trunk on the ground and a crown spreading wide above it.
    b.box(4.4, 0, 6.4, 4.6, 2, 6.6, sides(flat(0x6a4a30)));
    b.box(3, 2, 5, 6, 4, 8, sides(flat(0x2a6a30)));
    const model = b.model();
    const tree = occluderOfModel(model)!;
    expect(tree.feet).toEqual([[4.4, 6.4, 4.6, 6.6], null]);
    expect([tree.box.min.toArray(), tree.box.max.toArray()]).toEqual([[3, 0, 5], [6, 4, 8]]);
    expect(occluderOfModel(model, [[4, 6, 5, 7]])!.feet).toEqual([[4, 6, 5, 7], null]);
  });

  it("keeps two footprints, merging the nearest", () => {
    expect(twoRects([[0, 0, 1, 1]])).toEqual([[0, 0, 1, 1], null]);
    // A wall and a tower each side of a gate: each side's two become one, the gate's gap between them kept.
    expect(twoRects([[0, 0, 1, 4], [0, 4, 2, 6], [0, 8, 2, 10], [0, 10, 1, 14]])).toEqual([[0, 0, 2, 6], [0, 8, 2, 14]]);
  });
});
