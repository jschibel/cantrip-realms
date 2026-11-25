import { describe, expect, it } from "vitest";
import type { Model } from "../art/paint/builder";
import type { BuildingData, PropData, TileData } from "../world/format";
import { worldBuildingOf, worldPropOf } from "./chunks";
import type { TileAt } from "./terrain";

// What stands in the world stands on the floor under it (chunks.ts `worldPropOf`, `worldBuildingOf`): a recipe draws from
// the ground's zero, so on a terrace three quarters of a tile up a bush, a boulder or a house would be drawn sunk into
// the ground - a bush wholly under it, its tile closed with nothing to be seen there.

/** Ground `level` texels up everywhere. */
const terrace = (level: number): TileAt => () => [level, "grass", 0] as TileData;

const lowest = (m: Model): number => {
  let y = Infinity;
  for (const p of m.parts) for (let i = 1; i < p.positions.length; i += 3) y = Math.min(y, p.positions[i]!);
  return y;
};

describe("the world's props and buildings", () => {
  it("stand on a terrace's floor, not under it", () => {
    for (const p of [
      { id: "bush", x: 4.4, z: 5.6 },
      { id: "boulder", x: 2.5, z: 2.5 },
      { id: "hedgerow", x: 1.5, z: 8.5, args: { to: [4.5, 8.5] } },
    ] as PropData[]) {
      const flat = lowest(worldPropOf(p, terrace(0)).model);
      const raised = lowest(worldPropOf(p, terrace(12)).model);
      expect(raised - flat, p.id).toBeCloseTo(0.75, 6);
    }
    const house: BuildingData = { id: "house", style: "benalish", kind: "house", x: 2, z: 2, w: 6, d: 5, rot: 0, door: [4, 7] };
    const flat = worldBuildingOf(house, terrace(0));
    const raised = worldBuildingOf(house, terrace(12));
    expect(lowest(raised.model) - lowest(flat.model)).toBeCloseTo(0.75, 6);
    expect(raised.doorway![1] - flat.doorway![1]).toBeCloseTo(0.75, 6);
  });

  it("leave a bridge at the deck height its args give", () => {
    const bridge: PropData = { id: "bridge", x: 1, z: 1, args: { to: [4, 3], y: 1 } };
    expect(lowest(worldPropOf(bridge, terrace(12)).model)).toBeCloseTo(lowest(worldPropOf(bridge, terrace(0)).model), 6);
  });
});
