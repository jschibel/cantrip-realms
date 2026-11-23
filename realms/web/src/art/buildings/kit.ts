import "../paint/regions";
import type { BuildingData, Rect, XYZ } from "../../world/format";
import { type Face, type Material, MeshBuilder, type Model, type ModelPart, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material } from "../paint/materials";
import { type Palette, type Ramp, rampKey } from "../paint/palette";
import { Pixmap, type Rgb, hash2 } from "../paint/pixmap";
import { sprite } from "../paint/sprite";
import { iron, ironLight } from "../props/draw";
import type { Built, Cutaway } from "../recipe";
import { placeBuilding } from "./registry";

// The building styles' shared kit: how a building is laid on its footprint and cut away when the player walks behind
// it, its doors and windows painted in a style's colors, its hanging sign showing its trade, and the params every style
// reads alike. Each style (benalish.ts, llanowar.ts, ...) draws its kinds facing south between x0..x1 and z0..z1 and
// returns its door's point; `styled` does the rest.
//
// Every style reads these `params` (besides its own):
//   trade      what a shop's sign shows: weapons, armor, potions, magic, books, food, bread, drink, inn, smith, cards,
//              general, jewels, herbs, fish, tailor, temple, guild, arena, goblin (default by kind)
//   doorAt     the door's middle along the front, tiles from the west end (default the middle)
//   cutaway    false: never cut away (default true: above the ground floor's door it drops away while the player stands
//              behind it, its walls' tops capped)
//   floors     storeys, where a kind has a choice

export const PX = 1 / 16;

/** The height a building is cut down to while the player is behind it: the ground floor's walls up to the lintels. */
export const CUT = 1.25;

// --- Cutting a building away --------------------------------------------------------------------------------------------

interface Vert {
  readonly p: readonly [number, number, number];
  readonly n: readonly [number, number, number];
  readonly uv: readonly [number, number];
}

function lerpVert(a: Vert, b: Vert, t: number): Vert {
  const l = (x: number, y: number) => x + (y - x) * t;
  return { p: [l(a.p[0], b.p[0]), l(a.p[1], b.p[1]), l(a.p[2], b.p[2])], n: [l(a.n[0], b.n[0]), l(a.n[1], b.n[1]), l(a.n[2], b.n[2])], uv: [l(a.uv[0], b.uv[0]), l(a.uv[1], b.uv[1])] };
}

/** A polygon clipped to one side of the plane y = cut (Sutherland-Hodgman on one plane). */
function clip(poly: readonly Vert[], cut: number, keepBelow: boolean): Vert[] {
  const inside = (v: Vert) => (keepBelow ? v.p[1] <= cut + 1e-6 : v.p[1] >= cut - 1e-6);
  const out: Vert[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (cut - a.p[1]) / (b.p[1] - a.p[1]);
      out.push(lerpVert(a, b, t));
    }
  }
  return out;
}

/** A model split at the height `cut`: what lies below it and what above, faces crossing it clipped in two. */
export function splitAt(model: Model, cut: number): { readonly below: Model; readonly above: Model } {
  const below: ModelPart[] = [];
  const above: ModelPart[] = [];
  for (const part of model.parts) {
    const halves = [
      { positions: [] as number[], normals: [] as number[], uvs: [] as number[], indices: [] as number[] },
      { positions: [] as number[], normals: [] as number[], uvs: [] as number[], indices: [] as number[] },
    ];
    const vert = (i: number): Vert => ({
      p: [part.positions[i * 3]!, part.positions[i * 3 + 1]!, part.positions[i * 3 + 2]!],
      n: [part.normals[i * 3]!, part.normals[i * 3 + 1]!, part.normals[i * 3 + 2]!],
      uv: [part.uvs[i * 2]!, part.uvs[i * 2 + 1]!],
    });
    const emit = (h: (typeof halves)[number], poly: readonly Vert[]) => {
      if (poly.length < 3) return;
      const base = h.positions.length / 3;
      for (const v of poly) {
        h.positions.push(...v.p);
        h.normals.push(...v.n);
        h.uvs.push(...v.uv);
      }
      for (let k = 1; k + 1 < poly.length; k++) h.indices.push(base, base + k, base + k + 1);
    };
    for (let t = 0; t < part.indices.length; t += 3) {
      const tri = [vert(part.indices[t]!), vert(part.indices[t + 1]!), vert(part.indices[t + 2]!)];
      const ys = tri.map((v) => v.p[1]);
      if (Math.max(...ys) <= cut + 1e-6) emit(halves[0]!, tri);
      else if (Math.min(...ys) >= cut - 1e-6) emit(halves[1]!, tri);
      else {
        emit(halves[0]!, clip(tri, cut, true));
        emit(halves[1]!, clip(tri, cut, false));
      }
    }
    if (halves[0]!.indices.length) below.push({ material: part.material, ...halves[0]! });
    if (halves[1]!.indices.length) above.push({ material: part.material, ...halves[1]! });
  }
  return { below: { parts: below }, above: { parts: above } };
}

export interface StyledOptions {
  /** The material the cut-down walls' tops are capped with. */
  readonly cap: Material;
  /** The building's full height (roof ridge, tower top): how far behind it the player is hidden. */
  readonly height: number;
  /** A gatehouse: cut away also while the player walks through it. */
  readonly through?: boolean;
  /** The rectangle (unturned, as drawn facing south) the cap covers; the whole footprint by default. */
  readonly capRect?: Rect;
}

/**
 * Lays a style's drawing on a building's footprint, turned to its `rot` (registry.ts, `placeBuilding`), and cuts it
 * away: above `CUT` it drops while the player stands where it would hide them (north of its footprint, within its
 * height; or in a gatehouse's passage), and its walls are capped at that height.
 */
export function styled(building: BuildingData, options: StyledOptions, draw: (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number) => XYZ | undefined): Built {
  const placed = placeBuilding(building, draw);
  const params = building.params ?? {};
  if (params.cutaway === false || options.height <= CUT + 0.2) return placed;
  const { below, above } = splitAt(placed.model, CUT);
  if (above.parts.length === 0) return placed;
  const { x, z, w, d } = building;
  const low = new MeshBuilder();
  const [cx0, cz0, cx1, cz1] = options.capRect ?? [x + 0.05, z + 0.05, x + w - 0.05, z + d - 0.05];
  low.decal(tiled(options.cap), cx0, cz0, cx1, cz1, CUT);
  const m = Math.min(2, options.height * 0.5);
  const rect: Rect = [x - m, z - options.height * 1.1, x + w + m, options.through ? z + d + 0.5 : z + 0.4];
  const cut: Cutaway = { full: above, low: low.model(), when: { player: rect } };
  return { ...placed, model: below, cutaways: [cut] };
}

// --- Params ---------------------------------------------------------------------------------------------------------------

/** A building's params, read with defaults. */
export function params(building: BuildingData): {
  num(key: string, fallback: number): number;
  str<T extends string>(key: string, fallback: T): T;
  bool(key: string, fallback: boolean): boolean;
} {
  const p = building.params ?? {};
  return {
    num: (k, f) => (typeof p[k] === "number" ? (p[k] as number) : f),
    str: <T extends string>(k: string, f: T) => (typeof p[k] === "string" ? (p[k] as T) : f),
    bool: (k, f) => (typeof p[k] === "boolean" ? (p[k] as boolean) : f),
  };
}

/** The trade a kind shows on its sign when its params name none. */
export function tradeOf(building: BuildingData): Trade | undefined {
  const t = building.params?.trade;
  if (typeof t === "string" && (TRADES as readonly string[]).includes(t)) return t as Trade;
  switch (building.kind) {
    case "shop":
      return "general";
    case "inn":
      return "inn";
    case "smithy":
      return "smith";
    case "library":
      return "books";
    case "temple":
      return "temple";
    case "guildhall":
      return "guild";
    case "tower":
      return "magic";
    default:
      return undefined;
  }
}

/** Windows spaced along a front of `width` tiles, clear of a door at `door` (tiles from the west end, or none). */
export function windowSpots(width: number, door: number | undefined, spacing = 1.75, margin = 0.9): number[] {
  const out: number[] = [];
  const n = Math.max(0, Math.floor((width - 2 * margin) / spacing) + 1);
  const span = (n - 1) * spacing;
  for (let i = 0; i < n; i++) {
    const at = width / 2 - span / 2 + i * spacing;
    if (door !== undefined && Math.abs(at - door) < 1.2) continue;
    out.push(at);
  }
  return out;
}

// --- Doors and windows in a style's colors --------------------------------------------------------------------------------

/**
 * A door, 20 by 32 (16 texels a tile: 1.25 by 2): planked in `leaf`, its surround of `frame` - arched, square or round
 * (a hobbit's), with iron straps or none.
 */
export function doorPicture(leaf: Ramp, frame: Ramp, shape: "arch" | "square" | "round" | "pointed", straps = true, seed = 1): Pixmap {
  const p = new Pixmap(20, 32);
  p.fill(0, 0);
  const inside = (x: number, y: number) => {
    if (x < 2 || x > 17) return false;
    if (shape === "square") return y >= 3;
    if (shape === "pointed") return y >= 9 || Math.abs(x - 9.5) <= (y - 1) * 0.95;
    const dx = x - 9.5;
    const dy = y - 9;
    return y >= 9 || dx * dx + dy * dy * (shape === "round" ? 1 : 1.3) <= 64;
  };
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 20; x++) {
      const near = inside(x, y) || inside(x - 2, y) || inside(x + 2, y) || inside(x, y + 2);
      if (!near) continue;
      // The surround: blocks in courses, lit on the left.
      let c = y % 5 === 0 ? frame[2]! : x < 10 ? frame[4]! : frame[3]!;
      if (x === 0 || x === 1) c = frame[5]!;
      p.set(x, y, c);
    }
  }
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 20; x++) {
      if (!inside(x, y)) continue;
      const plank = Math.floor((x - 2) / 4);
      const px = (x - 2) % 4;
      let c = [leaf[4]!, leaf[3]!, leaf[4]!, leaf[5]!][plank] ?? leaf[4]!;
      if (px === 0) c = leaf[2]!;
      if (px === 1) c = plank === 3 ? leaf[Math.min(leaf.length - 1, 6)]! : leaf[5]!;
      if (hash2(x, y, seed) < 0.08) c = leaf[3]!;
      if (!inside(x, y - 1)) c = leaf[1]!;
      p.set(x, y, c);
    }
  }
  if (straps) {
    for (const sy of [13, 25]) {
      for (let x = 2; x < 18; x++) {
        p.set(x, sy, C.IRON[3]!);
        p.set(x, sy + 1, C.IRON[2]!);
        if (x % 4 === 3) p.set(x, sy, C.IRON[5]!);
      }
    }
  }
  p.set(14, 19, C.GOLD[4]!);
  p.set(14, 20, C.GOLD[2]!);
  for (let x = 2; x < 18; x++) p.set(x, 31, leaf[0]!);
  return p;
}

/** A window, 16 by 18: `frame` round it, panes of glass (clear, lit, stained) or a round porthole. */
export function windowPicture(frame: Ramp, glass: "clear" | "lit" | "stained" | "dark", shape: "square" | "arch" | "round" = "square", bars: Ramp = C.WOOD): Pixmap {
  const p = new Pixmap(16, 18);
  p.fill(0, 0);
  const pane = (x: number, y: number) => {
    if (x < 2 || x > 13 || y < 3 || y > 14) return false;
    if (shape === "square") return true;
    const dx = x - 7.5;
    const dy = y - (shape === "round" ? 8.5 : 8);
    return shape === "round" ? dx * dx + dy * dy <= 36 : y >= 8 || dx * dx + dy * dy * 1.4 <= 36;
  };
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 16; x++) {
      const near = pane(x, y) || pane(x - 2, y) || pane(x + 2, y) || pane(x, y - 2) || pane(x, y + 2);
      if (!near) continue;
      let c = y > 14 ? frame[5]! : x < 8 ? frame[4]! : frame[3]!;
      if (y === 17) c = frame[2]!;
      p.set(x, y, c);
    }
  }
  const stain = [C.RED[3]!, C.BLUE[3]!, C.GOLD[4]!, C.GREEN[3]!, C.PURPLE[3]!];
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 16; x++) {
      if (!pane(x, y)) continue;
      const bar = x === 7 || x === 8 || y === 8;
      let c: Rgb;
      if (bar) c = glass === "stained" ? C.INK : x === 8 || y === 8 ? bars[2]! : bars[4]!;
      else if (glass === "lit") c = y < 8 ? C.GOLD[4]! : C.GOLD[3]!;
      else if (glass === "dark") c = y < 8 ? C.DUNGEON[2]! : C.DUNGEON[1]!;
      else if (glass === "stained") c = stain[(Math.floor(x / 3) + Math.floor(y / 3) * 2) % stain.length]!;
      else c = y < 6 ? C.WATER[3]! : y < 11 ? C.WATER[2]! : C.WATER[1]!;
      p.set(x, y, c);
    }
  }
  if (glass === "clear" || glass === "lit") {
    const glint = glass === "lit" ? C.GOLD[5]! : C.WATER[5]!;
    for (const [gx, gy] of [
      [3, 6],
      [10, 6],
    ] as const) {
      if (!pane(gx, gy)) continue;
      p.set(gx, gy, glint);
      p.set(gx + 1, gy - 1, glint);
    }
  }
  return p;
}

/** A door's material in a style's ramps. */
export const doorMaterial = (leaf: Ramp, frame: Ramp, shape: "arch" | "square" | "round" | "pointed", straps = true) =>
  material(`door-${shape}${straps ? "" : "-plain"}@${rampKey(leaf)}+${rampKey(frame)}`, () => doorPicture(leaf, frame, shape, straps), { cutout: true });

/** A window's material in a style's ramps. */
export const windowMaterial = (frame: Ramp, glass: "clear" | "lit" | "stained" | "dark", shape: "square" | "arch" | "round" = "square") =>
  material(`window-${glass}-${shape}@${rampKey(frame)}`, () => windowPicture(frame, glass, shape), glass === "lit" ? { cutout: true, glow: 0.55 } : { cutout: true });

/** A door on a front facing south at z: its picture (1.25 by 2 from y), a step before it. */
export function door(b: MeshBuilder, x: number, y: number, z: number, mat: Material, step?: Face): void {
  b.card(fitted(mat), x - 0.625, y, x + 0.625, y + 2, z + 0.01);
  if (step) b.box(x - 0.7, y - 0.12, z, x + 0.7, y, z + 0.3, sides(step));
}

/** A window on a front facing south at z, its sill at y (1 by 1.125). */
export function window(b: MeshBuilder, x: number, y: number, z: number, mat: Material): void {
  b.card(fitted(mat), x - 0.5, y, x + 0.5, y + 1.125, z + 0.01);
}

/** A window on a side wall facing east (+1) or west (-1) at x: so the sides read when the camera swings round. */
export function sideWindow(b: MeshBuilder, x: number, y: number, z: number, facing: 1 | -1, mat: Material): void {
  b.at(x + facing * 0.01, 0, z, (facing * Math.PI) / 2, () => b.card(fitted(mat), -0.5, y, 0.5, y + 1.125, 0));
}

/** A door on a side wall facing east (+1) or west (-1) at x. */
export function sideDoor(b: MeshBuilder, x: number, y: number, z: number, facing: 1 | -1, mat: Material): void {
  b.at(x + facing * 0.01, 0, z, (facing * Math.PI) / 2, () => b.card(fitted(mat), -0.625, y, 0.625, y + 2, 0));
}

// --- Signs ---------------------------------------------------------------------------------------------------------------

export const TRADES = ["weapons", "armor", "potions", "magic", "books", "food", "bread", "drink", "inn", "smith", "cards", "general", "jewels", "herbs", "fish", "tailor", "temple", "guild", "arena", "goblin"] as const;
export type Trade = (typeof TRADES)[number];

const W = 0xfff8e8;
const ICONS: Record<Exclude<Trade, "goblin">, { rows: string[]; legend: Record<string, Rgb> }> = {
  weapons: {
    rows: ["s........s", ".s......s.", "..s....s..", "...s..s...", "....ss....", "....ss....", "...g..g...", "..g....g..", ".h......h.", "h........h"],
    legend: { s: C.IRON[5]!, g: C.GOLD[3]!, h: C.WOOD[3]! },
  },
  armor: {
    rows: [".kkkkkkkk.", "kbbbbbbbbk", "kbyybbyybk", "kbyybbyybk", "kbbbbbbbbk", "kbyybbyybk", ".kbyyyybk.", ".kbbyybbk.", "..kbbbbk..", "...kkkk..."],
    legend: { k: C.IRON[2]!, b: C.BLUE[3]!, y: C.GOLD[4]! },
  },
  potions: {
    rows: ["....kk....", "....ww....", "....gg....", "...gggg...", "..grrrrg..", ".grrwrrrg.", ".grrrrrrg.", ".grrrrrrg.", "..grrrrg..", "...gggg..."],
    legend: { k: C.WOOD[3]!, w: W, g: C.IRON[5]!, r: C.RED[3]! },
  },
  magic: {
    rows: ["....y.....", "...yyy....", "..yyWyy...", ".yyWWWyy..", "yyWWWWWyy.", ".yyWWWyy..", "..yyWyy...", "...yyy....", "....y.....", ".........."],
    legend: { y: C.BLUE[4]!, W: C.BLUE[5]! },
  },
  books: {
    rows: ["..........", "rrrrrbbbbb", "rWWWrbWWWb", "rWWWrbWWWb", "rWWWrbWWWb", "rWWWrbWWWb", "rWWWrbWWWb", "rrrrrbbbbb", "....kk....", ".........."],
    legend: { r: C.RED[3]!, b: C.BLUE[3]!, W: W, k: C.GOLD[3]! },
  },
  food: {
    rows: ["...gg.....", "..g.......", ".rrrr.rrr.", "rrrWrrrWrr", "rrrrrrrrrr", "rrrrrrrrrr", ".rrrrrrrr.", "..rrrrrr..", "...rr.rr..", ".........."],
    legend: { g: C.GREEN[3]!, r: C.RED[3]!, W: C.RED[5]! },
  },
  bread: {
    rows: ["..........", "...yyyyy..", "..yYyYyYy.", ".yYyYyYyYy", "yyyyyyyyyy", "ybbbbbbbby", "bbbbbbbbbb", ".bbbbbbbb.", "..........", ".........."],
    legend: { y: C.GOLD[4]!, Y: C.GOLD[5]!, b: C.WOOD[4]! },
  },
  drink: {
    rows: ["..WWWWW...", ".WWWWWWW..", ".kyyyyyk..", ".kyyyyykkk", ".kyyyyyk.k", ".kyyyyyk.k", ".kyyyyykkk", ".kyyyyyk..", ".kkkkkkk..", ".........."],
    legend: { W: W, k: C.WOOD[3]!, y: C.GOLD[4]! },
  },
  inn: {
    rows: ["....kk....", "...kyyk...", "..kyyyyk..", ".kyyyyyyk.", "kkkkkkkkkk", ".kWWkkWWk.", ".kWWkkWWk.", ".kkkkkkkk.", ".kkkddkkk.", ".kkkddkkk."],
    legend: { k: C.WOOD[3]!, y: C.ROOF[3]!, W: C.GOLD[4]!, d: C.DARKWOOD[1]! },
  },
  smith: {
    rows: ["...hhhh...", "...hhhh...", "....kk....", "....kk....", "..........", "kkkkkkkkk.", ".kkkkkkkkk", "...kkkk...", "...kkkk...", "..kkkkkk.."],
    legend: { h: C.IRON[4]!, k: C.IRON[2]! },
  },
  cards: {
    rows: [".WWWWW....", ".WrrrW....", ".WrWrW....", ".WrrrW.WWW", ".WWWWW.WbW", "......WbbW", ".......WbW", ".......WWW", "..........", ".........."],
    legend: { W: W, r: C.RED[3]!, b: C.BLUE[3]! },
  },
  general: {
    rows: ["....kk....", "....kk....", "kkkkkkkkkk", "k...kk...k", "k...kk...k", "yy..kk..yy", "yyy.kk.yyy", "....kk....", "..kkkkkk..", ".........."],
    legend: { k: C.IRON[3]!, y: C.GOLD[4]! },
  },
  jewels: {
    rows: ["..........", "..bbbbbb..", ".bWbbbbWb.", "bbbbbbbbbb", ".bbbbbbbb.", "..bbbbbb..", "...bbbb...", "....bb....", "..........", ".........."],
    legend: { b: C.TEAL[4]!, W: W },
  },
  herbs: {
    rows: ["....g.....", "...gGg....", "..gGGGg...", ".gGgGgGg..", "..gGGGg...", "...gGg.g..", "....g.gG..", "....g.g...", "....gg....", "....g....."],
    legend: { g: C.GREEN[2]!, G: C.GREEN[3]! },
  },
  fish: {
    rows: ["..........", "..........", "..bbbbb..b", ".bWbbbbbbb", "bbbbbbbbb.", ".bbbbbbbbb", "..bbbbb..b", "..........", "..........", ".........."],
    legend: { b: C.TEAL[3]!, W: W },
  },
  tailor: {
    rows: ["..........", ".rr....rr.", "rrrrrrrrrr", "rrrrrrrrrr", ".rrrrrrrr.", "..rrrrrr..", "..rrrrrr..", "..rrrrrr..", "..rrrrrr..", ".........."],
    legend: { r: C.PURPLE[3]! },
  },
  temple: {
    rows: ["....y.....", ".y..y..y..", "..yyyyy...", "..yWWWy...", "yyyWWWyyy.", "..yWWWy...", "..yyyyy...", ".y..y..y..", "....y.....", ".........."],
    legend: { y: C.GOLD[3]!, W: C.GOLD[5]! },
  },
  guild: {
    rows: ["..yyy.....", ".y...y....", ".y...y....", "..yyy.....", "...y......", "...y......", "...yyy....", "...y......", "...yy.....", ".........."],
    legend: { y: C.GOLD[4]! },
  },
  arena: {
    rows: ["kk......kk", "kkk....kkk", ".kkk..kkk.", "..kk..kk..", "...kkkk...", "...hhhh...", "..hh..hh..", ".hh....hh.", "hh......hh", ".........."],
    legend: { k: C.IRON[5]!, h: C.WOOD[3]! },
  },
};

/** A trade's emblem, 10 by 10, cut out: the sword, the shield, the flask... (the goblin's face is the slice's). */
export function tradeIcon(trade: Trade): Pixmap {
  if (trade === "goblin") {
    const g = C.GOBLIN;
    return sprite(
      ["a........a", "ga.bbbbb.a", ".gabcccba.", "..bcwcwcb.", "..bcKcKcb.", "..bccdccb.", "...bWrWb..", "....bbb..."],
      { a: g[4]!, g: g[3]!, b: g[2]!, c: g[4]!, w: 0xfff8d0, K: C.INK, d: g[2]!, W: W, r: C.RED[2]! },
    );
  }
  const icon = ICONS[trade];
  return sprite(icon.rows, icon.legend);
}

/** A signboard, 16 by 14, of `board` with a `frame`, the trade's emblem on it: a style's colors, a style's shape. */
export function signPicture(trade: Trade, board: Ramp, frame: Ramp, shape: "board" | "shield" | "round" | "leaf" | "plate" = "board"): Pixmap {
  const p = new Pixmap(16, 14);
  p.fill(0, 0);
  const inside = (x: number, y: number) => {
    switch (shape) {
      case "shield":
        return y < 8 ? true : Math.abs(x - 7.5) < 8 - (y - 7) * 1.1;
      case "round":
        return (x - 7.5) ** 2 / 64 + (y - 6.5) ** 2 / 49 <= 1;
      case "leaf":
        return Math.abs(x - 7.5) < 8 * Math.sin((Math.PI * (y + 1)) / 15);
      default:
        return true;
    }
  };
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 16; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1) || x === 0 || x === 15 || y === 0 || y === 13;
      let c = y % 4 === 0 ? board[3]! : board[4]!;
      if (shape === "plate") c = (x + y) % 7 === 0 ? board[5]! : board[3]!;
      if (edge) c = x < 8 && y < 7 ? frame[4]! : frame[2]!;
      p.set(x, y, c);
    }
  }
  const icon = tradeIcon(trade);
  p.blit(icon, Math.floor((16 - icon.width) / 2), Math.floor((14 - icon.height) / 2));
  return p;
}

/** A sign's material in a style's colors and shape. */
export const signMaterial = (trade: Trade, board: Ramp, frame: Ramp, shape: "board" | "shield" | "round" | "leaf" | "plate" = "board") =>
  material(`sign-${trade}-${shape}@${rampKey(board)}+${rampKey(frame)}`, () => signPicture(trade, board, frame, shape), { cutout: true, twoSided: true });

/**
 * A hanging sign on an iron bracket out from a front facing south at z: the board at its middle x, its top at y, the
 * emblem on both faces (seen from the street either way).
 */
export function hangingSign(b: MeshBuilder, x: number, y: number, z: number, mat: Material, edge: Face): void {
  b.box(x - 0.04, y + 0.1, z, x + 0.04, y + 0.18, z + 0.8, sides(iron()));
  b.box(x - 0.03, y - 0.2, z + 0.04, x + 0.03, y + 0.18, z + 0.1, sides(iron()));
  b.box(x - 0.5, y - 0.875, z + 0.6, x + 0.5, y, z + 0.66, { south: fitted(mat), north: fitted(mat), east: edge, west: edge, top: edge });
  for (const cx of [x - 0.35, x + 0.35]) b.box(cx - 0.02, y, z + 0.61, cx + 0.02, y + 0.1, z + 0.65, sides(ironLight()));
}

/** A sign fixed flat to a front facing south at z (a plaque over a door): 1 by 0.875, its middle at x, its foot at y. */
export function plaque(b: MeshBuilder, x: number, y: number, z: number, mat: Material): void {
  b.card(fitted(mat), x - 0.5, y, x + 0.5, y + 0.875, z + 0.015);
}

/** The materials a style paints with, from its palette: one place to read each slot with its default. */
export const slotOf = (pal: Palette, key: string, fallback: Ramp): Ramp => pal[key] ?? fallback;

// --- Roofs and battlements ------------------------------------------------------------------------------------------------

type P3 = readonly [number, number, number];

/**
 * A sloped face of a roof - corners counter-clockwise seen from outside, its eave the first two - its material tiled
 * along the eave and up the slope at the density the three-quarter camera shows a gable roof's rows (builder.ts).
 */
export function roofFace(b: MeshBuilder, mat: Material, corners: readonly P3[], run: number, rise: number): void {
  const slope = Math.hypot(run, rise);
  const density = (16 * (run + rise)) / Math.max(slope, 1e-6);
  const image = mat.map?.image as { width: number; height: number } | undefined;
  const w = (image?.width ?? 16) / density;
  const h = (image?.height ?? 16) / density;
  const [c0, c1] = corners as [P3, P3];
  const ex = c1[0] - c0[0];
  const ez = c1[2] - c0[2];
  const el = Math.hypot(ex, ez) || 1;
  const e = [ex / el, ez / el];
  const uv = corners.map((c) => {
    const dx = c[0] - c0[0];
    const dz = c[2] - c0[2];
    const along = dx * e[0]! + dz * e[1]!;
    const across = Math.hypot(dx - along * e[0]!, dz - along * e[1]!);
    const up = c[1] - c0[1];
    return [(along + c0[0] * e[0]! + c0[2] * e[1]!) / w, Math.hypot(across, up) / h] as [number, number];
  });
  b.polygon(mat, corners, uv);
}

/** A hipped roof over x0..x1, z0..z1 from y, `rise` high: four slopes, its ridge along the longer side (a point if square). */
export function hipRoof(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, mat: Material): void {
  const w = x1 - x0;
  const d = z1 - z0;
  const run = Math.min(w, d) / 2;
  const t = y + rise;
  if (w >= d) {
    const ra = x0 + run;
    const rb = x1 - run;
    const zm = (z0 + z1) / 2;
    roofFace(b, mat, [[x0, y, z1], [x1, y, z1], [rb, t, zm], [ra, t, zm]], run, rise);
    roofFace(b, mat, [[x1, y, z0], [x0, y, z0], [ra, t, zm], [rb, t, zm]], run, rise);
    roofFace(b, mat, [[x1, y, z1], [x1, y, z0], [rb, t, zm]], run, rise);
    roofFace(b, mat, [[x0, y, z0], [x0, y, z1], [ra, t, zm]], run, rise);
  } else {
    const ra = z0 + run;
    const rb = z1 - run;
    const xm = (x0 + x1) / 2;
    roofFace(b, mat, [[x0, y, z1], [x1, y, z1], [xm, t, rb]], run, rise);
    roofFace(b, mat, [[x1, y, z0], [x0, y, z0], [xm, t, ra]], run, rise);
    roofFace(b, mat, [[x1, y, z1], [x1, y, z0], [xm, t, ra], [xm, t, rb]], run, rise);
    roofFace(b, mat, [[x0, y, z0], [x0, y, z1], [xm, t, rb], [xm, t, ra]], run, rise);
  }
}

/** A lean-to roof over x0..x1, z0..z1, high at the back (z0, `high`) and low at the front (z1, `low`). */
export function shedRoof(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, low: number, high: number, mat: Material, edge?: Face): void {
  roofFace(b, mat, [[x0, low, z1], [x1, low, z1], [x1, high, z0], [x0, high, z0]], z1 - z0, high - low);
  if (edge) {
    for (const [x, s] of [
      [x0, -1],
      [x1, 1],
    ] as const) {
      const tri: P3[] = s > 0 ? [[x, low, z1], [x, low - 0.12, z1], [x, high - 0.12, z0], [x, high, z0]] : [[x, high, z0], [x, high - 0.12, z0], [x, low - 0.12, z1], [x, low, z1]];
      b.polygon(edge.mat, tri, tri.map((c) => [c[2], c[1]] as [number, number]));
    }
  }
}

/** A conical roof (a tower's) over a circle at (cx, cz), radius r from y, `rise` high, `segments` sides, with an overhang. */
export function coneRoof(b: MeshBuilder, cx: number, cz: number, y: number, r: number, rise: number, mat: Material, segments = 10): void {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    roofFace(b, mat, [[cx + Math.sin(a0) * r, y, cz + Math.cos(a0) * r], [cx + Math.sin(a1) * r, y, cz + Math.cos(a1) * r], [cx, y + rise, cz]], r, rise);
  }
}

/** Merlons along the top of a wall's edge from (x0, z0) to (x1, z1) at height y, `t` thick toward the inside. */
export function merlons(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, face: Face, size = 0.31, gap = 0.5): void {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.floor(length / gap));
  const dx = (x1 - x0) / length;
  const dz = (z1 - z0) / length;
  for (let i = 0; i < n; i++) {
    const a = i * gap + (length - n * gap) / 2 + 0.06;
    const xa = x0 + dx * a;
    const za = z0 + dz * a;
    const xb = xa + dx * gap * 0.5;
    const zb = za + dz * gap * 0.5;
    b.box(Math.min(xa, xb) - (dz ? 0.1 : 0), y, Math.min(za, zb) - (dx ? 0.1 : 0), Math.max(xa, xb) + (dz ? 0.1 : 0), y + size, Math.max(za, zb) + (dx ? 0.1 : 0), sides(face));
  }
}
