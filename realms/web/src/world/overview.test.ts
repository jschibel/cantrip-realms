import { describe, expect, it } from "vitest";
import { checkOverview, decodeOverview, decodeRow, encodeOverview, encodeRow, overviewSize } from "./overview";

describe("the overview's rows, run-length coded", () => {
  it("writes each run as its count and letter, a single letter alone, and reads it back", () => {
    expect(encodeRow("aaabccccd")).toBe("3ab4cd");
    expect(encodeRow("")).toBe("");
    expect(decodeRow("3ab4cd")).toBe("aaabccccd");
    expect(decodeRow("512a")).toBe("a".repeat(512));
    for (const row of ["abcabc", "zzzzzzzzzzzzA", "a"]) expect(decodeRow(encodeRow(row))).toBe(row);
  });

  it("refuses a coding with a count and no letter after it, or a count of nothing", () => {
    expect(decodeRow("3a4")).toBeNull();
    expect(decodeRow("0a")).toBeNull();
  });
});

describe("the overview, encoded and decoded", () => {
  // A small travel map: sea round an island of grass with a wood and a peak, rising two levels in the middle.
  const W = 12;
  const H = 8;
  const ground = (x: number, z: number) => (x < 2 || z < 2 || x >= W - 2 || z >= H - 2 ? "sea" : x === 5 && z === 4 ? "woods:pine" : "grass");
  const height = (x: number, z: number) => (x >= 4 && x <= 7 && z >= 3 && z <= 4 ? 24 : x >= 3 && z >= 3 ? 11 : 0);
  const source = { width: W, depth: H, ground, height, peaks: [[6, 3, 3, "snow"], [3, 3, 1, "rock"]] as const };

  it("keeps a tile a square: every tile's ground and level as it was, the peaks sorted north to south", () => {
    const ov = encodeOverview(source);
    expect(ov.cell).toBe(1);
    expect(ov.rle).toBe(true);
    expect(checkOverview(ov)).toEqual([]);
    expect(overviewSize(ov)).toEqual({ cols: W, rows: H });
    const read = decodeOverview(ov);
    expect([read.cols, read.rows]).toEqual([W, H]);
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        expect(read.values[read.ground[z * W + x]!], `${x},${z}`).toBe(ground(x, z));
        expect(read.levels![z * W + x], `level at ${x},${z}`).toBe(Math.round(height(x, z) / 12));
      }
    expect(read.peaks).toEqual([[3, 3, 1, "rock"], [6, 3, 3, "snow"]]);
  });

  it("gives the same overview for the same source, and never a digit for a letter", () => {
    const a = encodeOverview(source);
    expect(JSON.stringify(encodeOverview(source))).toBe(JSON.stringify(a));
    expect(Object.keys(a.legend).some((l) => /\d/.test(l))).toBe(false);
  });

  it("still reads the first version: a letter for each square of `cell` tiles, no levels", () => {
    const old = { cell: 8, legend: { a: "grass", F: "woods", T: "town" }, rows: ["aF", "Ta"] };
    expect(checkOverview(old)).toEqual([]);
    const read = decodeOverview(old);
    expect(read.cell).toBe(8);
    expect(read.levels).toBeNull();
    expect(read.values[read.ground[1]!]).toBe("woods");
    expect(read.values[read.ground[2]!]).toBe("town");
  });

  it("names what is wrong with a malformed one", () => {
    const ov = encodeOverview(source);
    expect(checkOverview({ ...ov, rows: [...ov.rows.slice(1), "3"] }).join("\n")).toMatch(/not a run-length coding/);
    expect(checkOverview({ ...ov, rows: ["12q", ...ov.rows.slice(1)] }).join("\n")).toMatch(/letter the legend does not name/);
    expect(checkOverview({ ...ov, levels: ov.levels!.slice(1) }).join("\n")).toMatch(/as many as the rows/);
    expect(checkOverview({ ...ov, peaks: [[1, 2, "x", "rock"]] }).join("\n")).toMatch(/peaks/);
    expect(checkOverview({ ...ov, rows: [...ov.rows.slice(0, -1), "a"] }).join("\n")).toMatch(/as long as each other/);
  });
});
