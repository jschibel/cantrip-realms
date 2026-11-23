// A dungeon floor's walls, drawn from its plan: each wall tile beside open ground is a block of the theme's stone, its
// top flagged, as the slice's rooms draw their walls - with the dark round them. A wall between the camera and the
// floor (open ground north of it) is drawn low, as a room's front wall is; a wall on the east or west side of a space
// is drawn twice, full and low, the low one shown while the camera is swung round toward its side (a room's side
// walls). Where the floor meets the void (a chasm, the portal's islands) its edge drops away in a skirt.

import { type Face, MeshBuilder, tiled } from "../../art/paint/builder";
import * as C from "../../art/paint/colors";
import { material, stock } from "../../art/paint/materials";
import * as Pic from "../../art/paint/pictures";
import { hash2 } from "../../art/paint/pixmap";
import * as T from "../../art/paint/textures";
import type { Built, Cutaway, LightSpec } from "../../art/recipe";
import type { Theme } from "../../world/format";
import { type Cell, VOID, WALL, type WallKind, wallKind } from "./plan";
import * as P from "./paint";

export interface WallLook {
  /** A full wall's height, how much it varies tile to tile (a cave's crags), and a cut-down wall's. */
  readonly height: number;
  readonly jitter: number;
  readonly low: number;
  /** The wall's face: a plinth at its foot to `plinth` high, the body, a cornice `cornice` deep under its top. */
  readonly plinth?: { readonly to: number; readonly face: Face; readonly proud: number };
  readonly body: Face;
  readonly cornice?: { readonly depth: number; readonly face: Face; readonly proud: number };
  /** Faces of a wall's ends and of what a lower wall leaves of a higher one, and the tops. */
  readonly side: Face;
  readonly top: Face;
  /** The face of the ground's edge where it drops into the void. */
  readonly skirt: Face;
  /** The light that fills the dark: a hemisphere in the theme's colour. */
  readonly fill: LightSpec;
}

const flagsOf = (r: readonly number[], name: string, seed: number) => tiled(material(name, () => T.flagstones([r[0]!, ...r.slice(0, 6)], seed)));

export function wallLook(theme: Theme): WallLook {
  switch (theme) {
    case "caves": {
      const rock = tiled(material("dungeon-cave-rock", () => P.caveRock(51)));
      return {
        height: 2.6,
        jitter: 0.75,
        low: 0.55,
        body: rock,
        side: rock,
        top: tiled(material("dungeon-cave-top", () => P.caveTop(57))),
        skirt: rock,
        fill: { kind: "hemisphere", sky: [0.36, 0.4, 0.6], ground: [0.18, 0.14, 0.14], intensity: 0.6 * Math.PI },
      };
    }
    case "castle": {
      const stone = tiled(stock.limestone(P.KEEP));
      const dark = tiled(material("dungeon-keep-dark", () => T.ashlar([P.KEEP[0]!, ...P.KEEP.slice(0, 6)], 58, 8, 12, 20)));
      return {
        height: 3.0,
        jitter: 0,
        low: 0.6,
        plinth: { to: 0.5, face: dark, proud: 2 / 16 },
        body: stone,
        cornice: { depth: 0.25, face: dark, proud: 2 / 16 },
        side: stone,
        top: flagsOf(P.KEEP, "dungeon-keep-top", 59),
        skirt: stone,
        fill: { kind: "hemisphere", sky: [0.46, 0.44, 0.62], ground: [0.2, 0.15, 0.16], intensity: 0.55 * Math.PI },
      };
    }
    case "tower": {
      const stone = tiled(material("dungeon-tower-stone", () => T.ashlar(P.TOWER, 60, 6, 8, 14)));
      const wood = tiled(material("wainscot", () => Pic.wainscot()));
      return {
        height: 3.0,
        jitter: 0,
        low: 0.6,
        plinth: { to: 0.9, face: wood, proud: 1 / 16 },
        body: stone,
        cornice: { depth: 0.25, face: tiled(stock.darkTimber()), proud: 2 / 16 },
        side: stone,
        top: flagsOf(P.TOWER, "dungeon-tower-top", 61),
        skirt: stone,
        fill: { kind: "hemisphere", sky: [0.44, 0.48, 0.74], ground: [0.2, 0.16, 0.22], intensity: 0.6 * Math.PI },
      };
    }
    case "crypt": {
      const brick = tiled(stock.cryptBrick());
      const dark = tiled(material("crypt-dark", () => T.ashlar([C.DUNGEON[0]!, ...C.DUNGEON.slice(0, 6)], 29, 8, 12, 20)));
      return {
        height: 3.2,
        jitter: 0,
        low: 0.75,
        plinth: { to: 0.4375, face: dark, proud: 2 / 16 },
        body: brick,
        cornice: { depth: 0.3125, face: dark, proud: 3 / 16 },
        side: brick,
        top: tiled(material("crypt-top", () => T.flagstones([C.DUNGEON[0]!, ...C.DUNGEON.slice(0, 6)], 31))),
        skirt: brick,
        fill: { kind: "hemisphere", sky: [0.36, 0.38, 0.74], ground: [0.16, 0.12, 0.22], intensity: 0.52 * Math.PI },
      };
    }
    case "hollow": {
      const roots = tiled(material("dungeon-root-wall", () => P.rootWall(52)));
      return {
        height: 2.8,
        jitter: 0.6,
        low: 0.55,
        body: roots,
        side: roots,
        top: tiled(stock.leaves(P.MOSS)),
        skirt: roots,
        fill: { kind: "hemisphere", sky: [0.3, 0.5, 0.36], ground: [0.12, 0.14, 0.08], intensity: 0.5 * Math.PI },
      };
    }
    case "foundry": {
      const stone = tiled(material("dungeon-soot-stone", () => T.ashlar(P.SOOT, 62, 6, 8, 14)));
      const iron = tiled(material("dungeon-iron-band", () => P.ironBand()));
      return {
        height: 3.0,
        jitter: 0,
        low: 0.6,
        plinth: { to: 0.625, face: iron, proud: 1 / 16 },
        body: stone,
        cornice: { depth: 0.25, face: iron, proud: 2 / 16 },
        side: stone,
        top: flagsOf(P.SOOT, "dungeon-soot-top", 63),
        skirt: stone,
        fill: { kind: "hemisphere", sky: [0.44, 0.32, 0.3], ground: [0.2, 0.1, 0.08], intensity: 0.56 * Math.PI },
      };
    }
    case "portal": {
      const ribs = tiled(material("dungeon-ribs", () => P.ribs(53)));
      return {
        height: 3.0,
        jitter: 0,
        low: 0.6,
        body: ribs,
        cornice: { depth: 0.25, face: tiled(material("dungeon-sinew", () => T.flagstones(P.SINEW, 64))), proud: 2 / 16 },
        side: ribs,
        top: tiled(material("dungeon-plates-top", () => P.plates(65))),
        skirt: ribs,
        fill: { kind: "hemisphere", sky: [0.36, 0.44, 0.42], ground: [0.24, 0.1, 0.18], intensity: 0.6 * Math.PI },
      };
    }
  }
}

/** How deep the ground's edge drops into the void. */
const SKIRT = 2.5;

/** The walls of a plan (its rows of characters), as a recipe's Built: still walls, and the side walls as cut-aways. */
export function drawWalls(cells: readonly string[], theme: Theme): Built {
  const look = wallLook(theme);
  const d = cells.length;
  const w = cells[0]?.length ?? 0;
  const at = (x: number, z: number): Cell => {
    if (x < 0 || z < 0 || x >= w || z >= d) return WALL;
    const ch = cells[z]![x]!;
    return (ch === "#" ? 0 : ch === "." ? 1 : ch === "~" ? 2 : ch === "=" ? 3 : 4) as Cell;
  };
  const kinds: WallKind[] = [];
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) kinds.push(wallKind(at, x, z));
  const kindAt = (x: number, z: number): WallKind => (x < 0 || z < 0 || x >= w || z >= d ? "none" : kinds[z * w + x]!);
  const full = (x: number, z: number) => look.height + (look.jitter ? (hash2(x, z, 77) - 0.5) * look.jitter : 0);
  /** The lowest a drawn wall ever stands (0 for a tile not drawn: its face toward it is the wall's end). */
  const lowest = (x: number, z: number): number => {
    const k = kindAt(x, z);
    if (k === "none") return at(x, z) === WALL ? 0 : -1;
    return k === "back" ? full(x, z) : look.low;
  };

  const still = new MeshBuilder();
  const east = { full: new MeshBuilder(), low: new MeshBuilder() };
  const west = { full: new MeshBuilder(), low: new MeshBuilder() };

  const block = (b: MeshBuilder, x: number, z: number, h: number, banded: boolean) => {
    b.box(x, 0, z, x + 1, h, z + 1, { top: look.top });
    const sides: [number, number, "south" | "north" | "east" | "west"][] = [
      [0, 1, "south"],
      [0, -1, "north"],
      [1, 0, "east"],
      [-1, 0, "west"],
    ];
    for (const [dx, dz, side] of sides) {
      const n = lowest(x + dx, z + dz);
      // Open ground: the whole face; a lower wall: what shows above it.
      const from = n < 0 ? 0 : n;
      if (from >= h - 1e-6) continue;
      if (n < 0 && banded) face(b, x, z, side, from, h);
      else b.box(x, from, z, x + 1, h, z + 1, { [side]: n < 0 ? look.body : look.side });
    }
  };

  /** A wall's face toward open ground, in bands: its plinth, body and cornice (each a little proud on the south). */
  const face = (b: MeshBuilder, x: number, z: number, side: "south" | "north" | "east" | "west", y0: number, h: number) => {
    const bands: { a: number; b: number; f: Face; proud: number }[] = [];
    const plinthTo = look.plinth ? Math.min(h, look.plinth.to) : 0;
    const corniceFrom = look.cornice ? Math.max(plinthTo, h - look.cornice.depth) : h;
    if (look.plinth && plinthTo > y0) bands.push({ a: y0, b: plinthTo, f: look.plinth.face, proud: look.plinth.proud });
    if (corniceFrom > Math.max(y0, plinthTo)) bands.push({ a: Math.max(y0, plinthTo), b: corniceFrom, f: look.body, proud: 0 });
    if (look.cornice && h > corniceFrom) bands.push({ a: corniceFrom, b: h, f: look.cornice.face, proud: look.cornice.proud });
    for (const band of bands) {
      b.box(x, band.a, z, x + 1, band.b, z + 1, { [side]: band.f });
      if (side === "south" && band.proud > 0) b.box(x, band.a, z + 1, x + 1, band.b, z + 1 + band.proud, { south: band.f, top: band.f, east: band.f, west: band.f });
    }
  };

  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const k = kindAt(x, z);
      if (k === "none") continue;
      if (k === "near") block(still, x, z, look.low, false);
      else if (k === "back") block(still, x, z, full(x, z), true);
      else {
        const pair = k === "east" ? east : west;
        block(pair.full, x, z, full(x, z), true);
        block(pair.low, x, z, look.low, false);
      }
    }
  }
  // The ground's edges over the void.
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const c = at(x, z);
      if (c === WALL || c === VOID) continue;
      const top = c === 1 ? 0 : -0.18;
      for (const [dx, dz, side] of [[0, 1, "south"], [1, 0, "east"], [-1, 0, "west"], [0, -1, "north"]] as const) {
        if (at(x + dx, z + dz) !== VOID) continue;
        still.box(x, top - SKIRT, z, x + 1, top, z + 1, { [side]: look.skirt });
      }
    }
  }
  const cutaways: Cutaway[] = [
    { full: west.full.model(), low: west.low.model(), when: { camera: "west" } },
    { full: east.full.model(), low: east.low.model(), when: { camera: "east" } },
  ];
  return { model: still.model(), cutaways, lights: [look.fill] };
}
