// The overview (world.json's `overview`; interfaces.md, "The world, interiors and dungeons"): the travel map from above,
// for the regional map (worldMap.ts). A grid of `cell`-by-`cell` squares from the world's origin, row by row, each a
// letter its `legend` names - a surface's id, `woods:<kind>` where a grove of that kind stands, and in the first
// version's coarse grids `town`, `woods` and `peaks`. The generator writes a cell of one tile, its rows run-length coded
// (`rle`: each run its count, left out for one, then its letter), with the ground's level a letter a cell in `levels`
// coded the same way (`a` level 0, `b` level 1, ...: a floor's height over a terrace's 12 texels, rounded) and the
// ranges' peaks as a list. Three-free and DOM-free: the generator, the lint and the maps share it.

import type { Overview } from "./format";

/** The letters a grid's legend gives out, in order: never a digit, which a run's count is made of. */
export const GROUND_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** A level's letter: `a` level 0 to `Z` level 51. */
const LEVEL_LETTERS = GROUND_LETTERS;
/** The highest level the overview writes; a higher floor is written as it. */
export const MAX_LEVEL = LEVEL_LETTERS.length - 1;
/** A terrace's level, in texels (render's and the generator's: a floor's height is whole texels). */
export const LEVEL_TEXELS = 12;

/** A row of letters, run-length coded: each run its count (left out for one) and its letter. */
export function encodeRow(letters: string): string {
  let out = "";
  for (let i = 0; i < letters.length; ) {
    let j = i + 1;
    while (j < letters.length && letters[j] === letters[i]) j++;
    out += (j - i > 1 ? String(j - i) : "") + letters[i]!;
    i = j;
  }
  return out;
}

/** A coded row's letters; null when it is not a well-formed coding (a count with no letter after it, a count of 0). */
export function decodeRow(row: string): string | null {
  let out = "";
  let count = "";
  for (const ch of row) {
    if (ch >= "0" && ch <= "9") {
      count += ch;
      continue;
    }
    const n = count === "" ? 1 : Number(count);
    if (!(n >= 1)) return null;
    out += ch.repeat(n);
    count = "";
  }
  return count === "" ? out : null;
}

/** A peak of a range: the middle tile of its footprint, its width in tiles (1, 3 or 5) and its kind (`rock`, `snow`...). */
export type OverviewPeak = readonly [x: number, z: number, w: number, kind: string];

/** What the generator knows of each tile of the travel map, for `encodeOverview`. */
export interface OverviewSource {
  readonly width: number;
  readonly depth: number;
  /** What a tile is from above: a surface's id, or `woods:<kind>` where a grove stands. */
  ground(x: number, z: number): string;
  /** Its floor's height, texels. */
  height(x: number, z: number): number;
  readonly peaks: readonly OverviewPeak[];
}

/** The overview at a tile a cell, its rows and levels run-length coded. The same source gives the same overview. */
export function encodeOverview(source: OverviewSource): Overview {
  const values = new Set<string>();
  for (let z = 0; z < source.depth; z++) for (let x = 0; x < source.width; x++) values.add(source.ground(x, z));
  const sorted = [...values].sort();
  if (sorted.length > GROUND_LETTERS.length) throw new Error(`the overview has ${sorted.length} kinds of ground, more than its ${GROUND_LETTERS.length} letters`);
  const letterOf = new Map(sorted.map((v, k) => [v, GROUND_LETTERS[k]!]));
  const legend: Record<string, string> = {};
  for (const [v, l] of letterOf) legend[l] = v;
  const rows: string[] = [];
  const levels: string[] = [];
  for (let z = 0; z < source.depth; z++) {
    let row = "";
    let level = "";
    for (let x = 0; x < source.width; x++) {
      row += letterOf.get(source.ground(x, z))!;
      level += LEVEL_LETTERS[Math.max(0, Math.min(MAX_LEVEL, Math.round(source.height(x, z) / LEVEL_TEXELS)))]!;
    }
    rows.push(encodeRow(row));
    levels.push(encodeRow(level));
  }
  const peaks = [...source.peaks].sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2] || a[3].localeCompare(b[3]));
  return { cell: 1, legend, rows, rle: true, levels, peaks };
}

/** An overview read: each square's ground as an index into `values`, and its level where the overview has them. */
export interface DecodedOverview {
  readonly cell: number;
  /** Squares across and down. */
  readonly cols: number;
  readonly rows: number;
  /** What each code means: a surface's id, `woods:<kind>`, or the first version's `town`, `woods` or `peaks`. */
  readonly values: readonly string[];
  /** `cols * rows` codes, row by row (255: no letter there, past a short row's end). */
  readonly ground: Uint8Array;
  /** `cols * rows` levels, or null for an overview without them. */
  readonly levels: Uint8Array | null;
  readonly peaks: readonly OverviewPeak[];
}

/** Reads an overview of either version; throws on one the lint would refuse (`checkOverview`). */
export function decodeOverview(ov: Overview): DecodedOverview {
  const problems = checkOverview(ov);
  if (problems.length > 0) throw new Error(problems[0]);
  const lines = ov.rows.map((r) => (ov.rle ? decodeRow(r)! : r));
  const cols = Math.max(0, ...lines.map((l) => l.length));
  const rows = lines.length;
  const letters = Object.keys(ov.legend).sort();
  const values = letters.map((l) => ov.legend[l]!);
  const code = new Map(letters.map((l, k) => [l, k]));
  const ground = new Uint8Array(cols * rows).fill(255);
  lines.forEach((line, z) => {
    for (let x = 0; x < line.length; x++) ground[z * cols + x] = code.get(line[x]!) ?? 255;
  });
  let levels: Uint8Array | null = null;
  if (ov.levels) {
    levels = new Uint8Array(cols * rows);
    ov.levels.forEach((r, z) => {
      const line = ov.rle ? decodeRow(r)! : r;
      for (let x = 0; x < line.length && x < cols; x++) levels![z * cols + x] = Math.max(0, LEVEL_LETTERS.indexOf(line[x]!));
    });
  }
  return { cell: ov.cell, cols, rows, values, ground, levels, peaks: ov.peaks ?? [] };
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** What is wrong with an overview as a file: its fields' shapes, its rows' codings and letters, its levels and peaks. */
export function checkOverview(data: unknown): string[] {
  const out: string[] = [];
  const w = "world.json: overview";
  if (typeof data !== "object" || data === null) return [`${w} should be an object`];
  const ov = data as Record<string, unknown>;
  if (!isInt(ov.cell) || ov.cell < 1) out.push(`${w}.cell should be a whole number of tiles`);
  if (typeof ov.legend !== "object" || ov.legend === null || !Object.entries(ov.legend).every(([k, v]) => k.length === 1 && typeof v === "string")) out.push(`${w}.legend should map letters to what they are`);
  if (!Array.isArray(ov.rows) || !ov.rows.every((r) => typeof r === "string")) out.push(`${w}.rows should be a list of strings`);
  if (ov.rle !== undefined && typeof ov.rle !== "boolean") out.push(`${w}.rle should be true or false`);
  if (out.length > 0) return out;
  const legend = ov.legend as Record<string, string>;
  const rle = ov.rle === true;
  if (rle && Object.keys(legend).some((l) => l >= "0" && l <= "9")) out.push(`${w}: a run-length coded overview's letters are never digits`);
  const lines = (ov.rows as string[]).map((r) => (rle ? decodeRow(r) : r));
  lines.forEach((line, z) => {
    if (line === null) out.push(`${w}.rows[${z}] is not a run-length coding`);
    else if ([...line].some((ch) => legend[ch] === undefined)) out.push(`${w}.rows[${z}] has a letter the legend does not name`);
  });
  if (rle && lines.some((l) => l !== null && l.length !== lines[0]!.length)) out.push(`${w}: its rows should be as long as each other`);
  if (ov.levels !== undefined) {
    if (!Array.isArray(ov.levels) || ov.levels.length !== lines.length || !ov.levels.every((r) => typeof r === "string")) out.push(`${w}.levels should be a string a row, as many as the rows`);
    else
      (ov.levels as string[]).forEach((r, z) => {
        const line = rle ? decodeRow(r) : r;
        if (line === null || [...line].some((ch) => !LEVEL_LETTERS.includes(ch))) out.push(`${w}.levels[${z}] should be a level's letter a square`);
        else if (line.length !== lines[z]?.length) out.push(`${w}.levels[${z}] should be as long as its row`);
      });
  }
  if (ov.peaks !== undefined && !(Array.isArray(ov.peaks) && ov.peaks.every((p) => Array.isArray(p) && p.length === 4 && isInt(p[0]) && isInt(p[1]) && isInt(p[2]) && p[2] > 0 && typeof p[3] === "string"))) {
    out.push(`${w}.peaks should be a list of [x, z, width, kind]`);
  }
  return out;
}

/** The overview's size in squares, for the lint's check that it lies on the travel map. */
export function overviewSize(ov: Overview): { cols: number; rows: number } {
  const lines = ov.rows.map((r) => (ov.rle ? (decodeRow(r) ?? "") : r));
  return { cols: Math.max(0, ...lines.map((l) => l.length)), rows: lines.length };
}
