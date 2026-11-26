// Writes realms/content/walk-vectors.json: golden vectors of walking on squares (realms/docs/interfaces.md, "Places"),
// which the overworld's tests (realms/web/src/world/walk-vectors.test.ts) and the realm server's
// (realms/dotnet/Cantrip.Realms.Server.Tests/WalkTests.cs) both check.
//
//     cd realms/web && npx vite-node ../../tools/realms/walk-vectors.ts
//
// Each grid is rows of tiles, `.` open and `#` blocked, its first tile at (x0, z0); a grid with `heights` gives each
// tile's floor in texels (row by row) and with `ramps` marks its ramp tiles `r`. Its `paths` are what the overworld's
// A* (realms/web/src/world/grid.ts) finds from one tile to another (null: no way), tile by tile with both ends; its
// `walks` are tile lists, the first the tile walked from, and whether each is a walk: every tile open, every step to one
// of the eight tiles round and over no ledge (floors at most LEDGE texels apart, unless both are ramps) or, straight
// across, a hop (floors more than LEDGE and at most HOP apart, not both ramps), and a diagonal step only where both
// tiles it passes between are open and no ledge runs round the corner (never cutting a corner, nor hopping on a
// diagonal). Paths and walks are a player's, who hops; those marked `"hops": false` are of one who does not hop (a
// zombie), for whom a hop is no step. The server takes every path the overworld finds, and refuses every walk that is
// none.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOP, LEDGE } from "../../realms/web/src/world/format.ts";
import { Grid } from "../../realms/web/src/world/grid.ts";

type XZ = [number, number];

interface Spec {
  name: string;
  x0: number;
  z0: number;
  rows: string[];
  heights?: number[][];
  ramps?: string[];
  paths: [XZ, XZ][];
  walks: XZ[][];
  /** Paths and walks of one who does not hop. */
  still?: { paths: [XZ, XZ][]; walks: XZ[][] };
}

const SPECS: Spec[] = [
  {
    name: "open ground",
    x0: 0,
    z0: 0,
    rows: [".....", ".....", ".....", ".....", "....."],
    paths: [
      [[0, 0], [4, 4]],
      [[0, 0], [4, 1]],
      [[4, 0], [0, 3]],
      [[2, 2], [2, 2]],
    ],
    walks: [
      [[0, 0], [1, 1], [2, 2]],
      [[0, 0], [1, 0], [2, 1], [2, 2], [1, 3]],
      [[0, 0], [2, 0]],
      [[0, 0], [0, 0]],
      [[0, 0], [1, 2]],
      [[4, 4], [5, 5]],
      [[0, 0], [-1, 0]],
    ],
  },
  {
    name: "round a wall",
    x0: 0,
    z0: 0,
    rows: ["......", ".##...", "..#...", "..#.#.", "....#.", "......"],
    paths: [
      [[0, 0], [3, 3]],
      [[1, 2], [3, 1]],
      [[0, 5], [5, 0]],
      [[3, 2], [5, 4]],
      [[0, 2], [3, 0]],
    ],
    walks: [
      [[0, 0], [1, 0], [2, 0], [3, 1]],
      [[3, 0], [2, 1]],
      [[1, 2], [2, 1]],
      [[0, 2], [1, 3]],
      [[1, 3], [2, 4]],
      [[3, 2], [4, 1], [5, 2]],
      [[3, 3], [4, 4]],
      [[5, 3], [4, 4]],
      [[5, 5], [4, 4]],
      [[3, 4], [2, 3]],
      [[3, 4], [3, 3], [3, 2], [3, 1], [2, 0]],
    ],
  },
  {
    name: "two blocks corner to corner",
    x0: 0,
    z0: 0,
    rows: ["....", ".#..", "..#.", "...."],
    paths: [
      [[1, 2], [2, 1]],
      [[0, 0], [3, 3]],
      [[3, 0], [0, 3]],
    ],
    walks: [
      [[1, 2], [2, 1]],
      [[2, 1], [1, 2]],
      [[0, 0], [1, 0], [2, 0], [3, 1], [3, 2], [3, 3]],
      [[0, 3], [1, 3], [2, 3], [3, 2]],
      [[0, 2], [1, 1]],
    ],
  },
  {
    name: "west and north of the origin",
    x0: -3,
    z0: -2,
    rows: ["...#..", "...#..", "...#..", "......"],
    paths: [
      [[-2, -1], [2, -1]],
      [[-3, -2], [2, -2]],
      [[2, 1], [-3, -2]],
    ],
    walks: [
      [[-1, 0], [0, 1], [1, 0]],
      [[-1, 0], [0, 0]],
      [[-1, 1], [0, 0]],
      [[-1, 1], [0, 1], [1, 0], [2, -1]],
      [[-1, -1], [-2, -2], [-3, -3]],
      [[-1, 1], [0, 1], [1, 1], [2, 0], [2, -1]],
      [[-3, -2], [-2, -1], [-1, -2]],
    ],
  },
  {
    name: "a sealed room",
    x0: 0,
    z0: 0,
    rows: [".#...", "##...", ".....", "..###", "..#.#", "..###"],
    paths: [
      [[0, 0], [4, 2]],
      [[4, 2], [0, 0]],
      [[0, 5], [3, 4]],
      [[0, 5], [4, 0]],
      [[2, 1], [4, 0]],
    ],
    walks: [
      [[0, 0], [1, 1]],
      [[0, 2], [1, 1]],
      [[3, 4], [3, 4]],
      [[1, 4], [2, 3]],
      [[4, 2], [3, 1], [2, 0]],
    ],
  },
  {
    name: "a maze",
    x0: 10,
    z0: 20,
    rows: [
      "..........",
      ".####.###.",
      ".#......#.",
      ".#.####.#.",
      "...#..#...",
      "####.##.##",
      "..........",
      ".#.#.#.#.#",
    ],
    paths: [
      [[10, 20], [14, 24]],
      [[10, 27], [19, 20]],
      [[12, 22], [17, 22]],
      [[14, 24], [15, 24]],
      [[18, 27], [10, 24]],
    ],
    walks: [
      [[10, 20], [11, 20], [12, 20], [13, 20], [14, 20], [15, 21]],
      [[16, 22], [17, 23]],
      [[17, 23], [18, 24]],
      [[13, 24], [14, 25]],
      [[14, 26], [15, 25]],
      [[10, 20], [11, 20], [12, 20], [13, 20], [14, 20], [15, 20], [15, 21]],
      [[16, 22], [17, 22], [17, 23]],
      [[17, 26], [18, 25]],
    ],
  },
  {
    name: "a ledge and its ramp",
    x0: 0,
    z0: 0,
    rows: ["......", "......", "......", "......", "......"],
    heights: [
      [0, 0, 0, 12, 12, 12],
      [0, 0, 0, 12, 12, 12],
      [0, 0, 3, 9, 12, 12],
      [0, 0, 0, 12, 12, 12],
      [0, 0, 4, 12, 12, 12],
    ],
    ramps: ["......", "......", "..rr..", "......", "......"],
    paths: [
      [[0, 0], [5, 0]],
      [[5, 4], [0, 4]],
      [[2, 0], [3, 0]],
      [[2, 4], [2, 0]],
    ],
    walks: [
      [[2, 0], [3, 0]],
      [[3, 1], [2, 1]],
      [[1, 2], [2, 2], [3, 2], [4, 2]],
      [[4, 3], [3, 2], [2, 2], [1, 1]],
      [[2, 1], [3, 2]],
      [[2, 3], [3, 2]],
      [[2, 2], [2, 1], [2, 0]],
      [[3, 2], [3, 1]],
      [[2, 2], [3, 1]],
      [[1, 4], [2, 4]],
      [[2, 4], [3, 4]],
      [[1, 3], [2, 4]],
    ],
    still: {
      paths: [
        [[0, 0], [5, 0]],
        [[2, 0], [3, 0]],
      ],
      walks: [
        [[2, 0], [3, 0]],
        [[3, 1], [2, 1]],
        [[1, 2], [2, 2], [3, 2], [4, 2]],
        [[2, 4], [3, 4]],
      ],
    },
  },
  {
    name: "hops and a cliff",
    x0: -2,
    z0: 3,
    rows: ["......", "......", "......", "......"],
    heights: [
      [0, 0, 12, 12, 36, 36],
      [0, 0, 12, 12, 36, 36],
      [0, 0, 12, 12, 24, 36],
      [0, 0, 0, 12, 24, 24],
    ],
    paths: [
      [[-2, 3], [3, 3]],
      [[3, 3], [-2, 6]],
      [[-1, 3], [1, 3]],
      [[-2, 6], [2, 6]],
    ],
    walks: [
      [[-1, 3], [0, 3]],
      [[0, 4], [-1, 4]],
      [[-1, 3], [0, 4]],
      [[0, 4], [-1, 3]],
      [[0, 5], [-1, 6]],
      [[1, 3], [2, 3]],
      [[2, 3], [1, 3]],
      [[1, 5], [2, 5]],
      [[2, 5], [3, 5], [3, 4]],
      [[-1, 4], [0, 4], [1, 4], [1, 5], [2, 5], [3, 5], [3, 4], [3, 3]],
      [[2, 6], [3, 6], [3, 5]],
      [[1, 6], [2, 5]],
    ],
    still: {
      paths: [
        [[-2, 3], [3, 3]],
        [[-2, 3], [-1, 6]],
      ],
      walks: [
        [[-1, 3], [0, 3]],
        [[0, 4], [-1, 4]],
        [[-2, 3], [-1, 4], [-1, 5]],
        [[0, 6], [1, 6]],
      ],
    },
  },
];

function gridOf(spec: Spec): Grid {
  const grid = new Grid(spec.rows[0]!.length, spec.rows.length, spec.x0, spec.z0);
  spec.rows.forEach((row, z) => [...row].forEach((c, x) => grid.setWalkable(spec.x0 + x, spec.z0 + z, c === ".")));
  spec.heights?.forEach((row, z) => row.forEach((h, x) => grid.setHeight(spec.x0 + x, spec.z0 + z, h / 16)));
  spec.ramps?.forEach((row, z) => [...row].forEach((c, x) => grid.setRamp(spec.x0 + x, spec.z0 + z, c === "r")));
  return grid;
}

/** A tile's floor (texels) and whether it is a ramp, as the spec gives them. */
const floorOf = (spec: Spec, x: number, z: number) => spec.heights?.[z - spec.z0]?.[x - spec.x0] ?? 0;
const rampOf = (spec: Spec, x: number, z: number) => spec.ramps?.[z - spec.z0]?.[x - spec.x0] === "r";

/** The rule as the vectors state it, written out once more: a third reading, beside the overworld's and the server's. */
function isWalk(spec: Spec, grid: Grid, walk: XZ[], hops: boolean): boolean {
  const level = (ax: number, az: number, bx: number, bz: number) =>
    (rampOf(spec, ax, az) && rampOf(spec, bx, bz)) || Math.abs(floorOf(spec, ax, az) - floorOf(spec, bx, bz)) <= LEDGE;
  const hop = (ax: number, az: number, bx: number, bz: number) => !level(ax, az, bx, bz) && Math.abs(floorOf(spec, ax, az) - floorOf(spec, bx, bz)) <= HOP;
  if (!grid.walkable(walk[0]![0], walk[0]![1])) return false;
  for (let i = 1; i < walk.length; i++) {
    const [ax, az] = walk[i - 1]!;
    const [bx, bz] = walk[i]!;
    if (Math.max(Math.abs(bx - ax), Math.abs(bz - az)) !== 1 || !grid.walkable(bx, bz)) return false;
    if (ax === bx || az === bz) {
      if (!level(ax, az, bx, bz) && !(hops && hop(ax, az, bx, bz))) return false;
      continue;
    }
    if (!grid.walkable(bx, az) || !grid.walkable(ax, bz)) return false;
    if (!level(ax, az, bx, az) || !level(bx, az, bx, bz) || !level(ax, az, ax, bz) || !level(ax, bz, bx, bz)) return false;
  }
  return true;
}

const out = {
  comment:
    "Golden vectors of walking on squares (realms/docs/interfaces.md, 'Places'), written by tools/realms/walk-vectors.ts. Each grid's rows are tiles, '.' open and '#' blocked, its first tile at (x0, z0); 'heights', where given, are the tiles' floors in texels row by row (0 elsewhere), and 'ramps' marks ramp tiles 'r'. 'paths' are what the overworld's A* (realms/web/src/world/grid.ts) finds from one tile to another, both ends included (null: no way); 'walks' are tiles, the first the one walked from, and whether each is a walk: every tile open, every step to one of the eight tiles round and over no ledge (floors more than 4 texels apart, unless both are ramps) or, straight across, a hop (floors more than 4 and at most 12 texels apart, not both ramps), a diagonal step only where both tiles it passes between are open and no ledge runs round the corner. A case marked 'hops': false is of one who does not hop, for whom a hop is no step; the rest are a player's, who hops. The TypeScript (realms/web) and C# (realms/dotnet) tests both check every case.",
  grids: SPECS.map((spec) => {
    const grid = gridOf(spec);
    return {
      name: spec.name,
      x0: spec.x0,
      z0: spec.z0,
      rows: spec.rows,
      paths: [...spec.paths.map((p) => [p, true] as const), ...(spec.still?.paths ?? []).map((p) => [p, false] as const)].map(([[from, to], hops]) => {
        const path = grid.path({ x: from[0], z: from[1] }, { x: to[0], z: to[1] }, hops);
        return { from, to, ...(hops ? {} : { hops: false }), path: path ? path.map((t) => [t.x, t.z]) : null };
      }),
      ...(spec.heights ? { heights: spec.heights } : {}),
      ...(spec.ramps ? { ramps: spec.ramps } : {}),
      walks: [...spec.walks.map((w) => [w, true] as const), ...(spec.still?.walks ?? []).map((w) => [w, false] as const)].map(([walk, hops]) => ({
        walk,
        ...(hops ? {} : { hops: false }),
        ok: isWalk(spec, grid, walk, hops),
      })),
    };
  }),
};

// One case a line, so a change reads as the cases it changes.
const lines = out.grids.map((g) => {
  const cases = g.paths.map((p) => `        ${JSON.stringify(p)}`);
  const walks = g.walks.map((w) => `        ${JSON.stringify(w)}`);
  return [
    "    {",
    `      "name": ${JSON.stringify(g.name)}, "x0": ${g.x0}, "z0": ${g.z0},`,
    `      "rows": ${JSON.stringify(g.rows)},`,
    ...(g.heights ? [`      "heights": [${g.heights.map((r) => JSON.stringify(r)).join(", ")}],`] : []),
    ...(g.ramps ? [`      "ramps": ${JSON.stringify(g.ramps)},`] : []),
    `      "paths": [\n${cases.join(",\n")}\n      ],`,
    `      "walks": [\n${walks.join(",\n")}\n      ]`,
    "    }",
  ].join("\n");
});
const text = `{\n  "comment": ${JSON.stringify(out.comment)},\n  "grids": [\n${lines.join(",\n")}\n  ]\n}\n`;
JSON.parse(text);
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "realms", "content", "walk-vectors.json");
writeFileSync(target, text);
console.log(`walk-vectors: ${out.grids.length} grids, ${out.grids.reduce((n, g) => n + g.paths.length, 0)} paths, ${out.grids.reduce((n, g) => n + g.walks.length, 0)} walks`);
