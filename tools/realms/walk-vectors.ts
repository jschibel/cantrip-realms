// Writes realms/content/walk-vectors.json: golden vectors of walking on squares (realms/docs/interfaces.md, "Places"),
// which the overworld's tests (realms/web/src/world/walk-vectors.test.ts) and the realm server's
// (realms/dotnet/Cantrip.Realms.Server.Tests/WalkTests.cs) both check.
//
//     node --experimental-transform-types tools/realms/walk-vectors.ts
//
// Each grid is rows of tiles, `.` open and `#` blocked, its first tile at (x0, z0). Its `paths` are what the overworld's
// A* (realms/web/src/world/grid.ts) finds from one tile to another (null: no way), tile by tile with both ends; its
// `walks` are tile lists, the first the tile walked from, and whether each is a walk: every tile open, every step to one
// of the eight tiles round, and a diagonal step only where both tiles it passes between are open (never cutting a corner).
// The server takes every path the overworld finds, and refuses every walk that is none.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Grid } from "../../realms/web/src/world/grid.ts";

type XZ = [number, number];

interface Spec {
  name: string;
  x0: number;
  z0: number;
  rows: string[];
  paths: [XZ, XZ][];
  walks: XZ[][];
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
];

function gridOf(spec: Spec): Grid {
  const grid = new Grid(spec.rows[0]!.length, spec.rows.length, spec.x0, spec.z0);
  spec.rows.forEach((row, z) => [...row].forEach((c, x) => grid.setWalkable(spec.x0 + x, spec.z0 + z, c === ".")));
  return grid;
}

/** The rule as the vectors state it, written out once more: a third reading, beside the overworld's and the server's. */
function isWalk(grid: Grid, walk: XZ[]): boolean {
  if (!grid.walkable(walk[0]![0], walk[0]![1])) return false;
  for (let i = 1; i < walk.length; i++) {
    const [ax, az] = walk[i - 1]!;
    const [bx, bz] = walk[i]!;
    if (Math.max(Math.abs(bx - ax), Math.abs(bz - az)) !== 1 || !grid.walkable(bx, bz)) return false;
    if (ax !== bx && az !== bz && (!grid.walkable(bx, az) || !grid.walkable(ax, bz))) return false;
  }
  return true;
}

const out = {
  comment:
    "Golden vectors of walking on squares (realms/docs/interfaces.md, 'Places'), written by tools/realms/walk-vectors.ts. Each grid's rows are tiles, '.' open and '#' blocked, its first tile at (x0, z0). 'paths' are what the overworld's A* (realms/web/src/world/grid.ts) finds from one tile to another, both ends included (null: no way); 'walks' are tiles, the first the one walked from, and whether each is a walk: every tile open, every step to one of the eight tiles round, a diagonal step only where both tiles it passes between are open. The TypeScript (realms/web) and C# (realms/dotnet) tests both check every case.",
  grids: SPECS.map((spec) => {
    const grid = gridOf(spec);
    return {
      name: spec.name,
      x0: spec.x0,
      z0: spec.z0,
      rows: spec.rows,
      paths: spec.paths.map(([from, to]) => {
        const path = grid.path({ x: from[0], z: from[1] }, { x: to[0], z: to[1] });
        return { from, to, path: path ? path.map((t) => [t.x, t.z]) : null };
      }),
      walks: spec.walks.map((walk) => ({ walk, ok: isWalk(grid, walk) })),
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
