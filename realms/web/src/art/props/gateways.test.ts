import { describe, expect, it } from "vitest";
import { tilesOf } from "./index";

// The ways through props (catalogue.ts `gateway`): a gatehouse's gap and a town wall's gate are left out of the tiles
// they block, front to back, so the world can walk through them; their towers block.

const has = (tiles: readonly (readonly [number, number])[], x: number, z: number) => tiles.some(([a, b]) => a === x && b === z);

describe("ways through props", () => {
  it("a gatehouse blocks its towers and leaves its gap, args.width tiles, walkable front to back", () => {
    for (const width of [3, 5]) {
      for (const rot of [0, 1, 2, 3]) {
        const { tiles, blocks } = tilesOf({ id: "gatehouse", x: 10.5, z: 20.5, rot, args: { width, style: "benalish" } });
        expect(blocks).toBe(true);
        const h = (width - 1) / 2;
        const across = rot % 2 === 0;
        const at = (a: number, d: number) => (across ? [10 + a, 20 + d] : [10 + d, 20 + a]) as const;
        // The gap, and a row in front of and behind it: open.
        for (let a = -h; a <= h; a++) for (const d of [-1, 0, 1]) expect(has(tiles, ...at(a, d)), `w${width} r${rot} gap ${a},${d}`).toBe(false);
        // Each tower: two tiles across, two units deep about the anchor's row (so over three rows), blocked.
        for (const a of [-h - 2, -h - 1, h + 1, h + 2]) for (const d of [-1, 0, 1]) expect(has(tiles, ...at(a, d)), `w${width} r${rot} tower ${a},${d}`).toBe(true);
        expect(tiles).toHaveLength(12);
      }
    }
  });

  it("a town wall blocks its run and its gate's towers, its gateway left walkable", () => {
    const { tiles } = tilesOf({ id: "town-wall", x: 5, z: 0, args: { to: [5, 14], gate: [6, 8] } });
    for (const z of [6, 7]) for (const x of [3, 4, 5]) expect(has(tiles, x, z), `gate ${x},${z}`).toBe(false);
    for (const z of [0, 3, 4, 5, 8, 9, 13]) expect(has(tiles, 4, z), `wall ${z}`).toBe(true);
    // Without its args it still covers its anchor (the catalogue's own listings).
    expect(tilesOf({ id: "town-wall", x: 0, z: 0 }).tiles.length).toBeGreaterThan(0);
  });
});
