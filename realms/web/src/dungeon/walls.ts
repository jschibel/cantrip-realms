// A dungeon floor's walls, drawn from its plan: each wall tile beside open ground is a block of the theme's stone, its
// top flagged, as the slice's rooms draw their walls - with the dark round them. A wall between the camera and the
// floor (open ground north of it) is drawn low, as a room's front wall is; a wall on the east or west side of a space
// is drawn twice, full and low, the low one shown while the camera is swung round toward its side (a room's side
// walls). Where the floor meets the void (a chasm, the portal's islands) its edge drops away in a skirt. A cave's walls
// are crags of living rock instead of blocks, and its chasms' edges lips of rock (rock.ts).

import { type Face, MeshBuilder, tiled } from "../art/paint/builder";
import * as C from "../art/paint/colors";
import { flat, material, stock } from "../art/paint/materials";
import * as Pic from "../art/paint/pictures";
import { hash2 } from "../art/paint/pixmap";
import * as T from "../art/paint/textures";
import type { Built, Cutaway, LightSpec } from "../art/recipe";
import type { Theme } from "../world/format";
import { type Cell, VOID, WALL, type WallKind, wallKind } from "./plan";
import * as P from "./paint";
import { type Crag, Rock } from "./rock";

export interface WallLook {
  /** A full wall's height, how much it varies tile to tile (a cave's crags), and a cut-down wall's. */
  readonly height: number;
  readonly jitter: number;
  readonly low: number;
  /** The wall's face: a plinth at its foot to `plinth` high, the body, a cornice `cornice` deep under its top. */
  readonly plinth?: { readonly to: number; readonly face: Face; readonly proud: number };
  readonly body: Face;
  readonly cornice?: { readonly depth: number; readonly face: Face; readonly proud: number };
  /** Faces of a wall's ends and of what a lower wall leaves of a higher one, and the tops (darker than any floor). */
  readonly side: Face;
  readonly top: Face;
  /** The texel of lit edge round a top where it meets open ground. */
  readonly rim: number;
  /** How far, at most, a rough wall (the hollow's) stands back from the open ground, world units; its heights vary too. */
  readonly rough?: number;
  /** Walls of living rock (a cave's), drawn as crags rather than blocks (rock.ts). */
  readonly crag?: Crag;
  /** The face of the ground's edge where it drops into the void. */
  readonly skirt: Face;
  /** The light that fills the dark: a hemisphere in the theme's colour. */
  readonly fill: LightSpec;
}

/** A wall's top: flags in the darkest of a ramp, clearly darker than any floor beside it. */
const topOf = (r: readonly number[], name: string, seed: number) => tiled(material(name, () => T.flagstones([r[0]!, r[0]!, r[0]!, r[1]!, r[1]!, r[2]!, r[3]!], seed)));
const PX = 1 / 16;

export function wallLook(theme: Theme): WallLook {
  switch (theme) {
    case "caves": {
      const rock = tiled(material("dungeon-cave-rock", () => P.caveRock(51)));
      return {
        height: 2.6,
        jitter: 0.35,
        low: 0.55,
        body: rock,
        side: rock,
        top: tiled(material("dungeon-cave-top", () => P.caveTop(57))),
        rim: P.CAVE[4]!,
        crag: {
          recess: 0.3,
          corner: 0.42,
          relief: 0.6,
          shoulder: tiled(material("dungeon-cave-shoulder", () => P.caveShoulder(58))),
          deep: tiled(material("dungeon-cave-deep", () => P.caveShoulder(59, true))),
        },
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
        top: topOf(P.KEEP, "dungeon-keep-top", 59),
        rim: P.KEEP[4]!,
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
        top: topOf(P.TOWER, "dungeon-tower-top", 61),
        rim: P.TOWER[5]!,
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
        top: topOf(C.DUNGEON, "dungeon-crypt-top", 31),
        rim: C.DUNGEON[5]!,
        skirt: brick,
        fill: { kind: "hemisphere", sky: [0.46, 0.47, 0.5], ground: [0.16, 0.15, 0.15], intensity: 0.52 * Math.PI },
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
        top: tiled(stock.leaves([P.MOSS[0]!, P.MOSS[0]!, P.MOSS[1]!, P.MOSS[1]!, P.MOSS[2]!, P.MOSS[3]!, P.MOSS[4]!])),
        rim: P.ROOT[5]!,
        rough: 1 / 16,
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
        top: topOf(P.SOOT, "dungeon-soot-top", 63),
        rim: P.SOOT[5]!,
        skirt: stone,
        fill: { kind: "hemisphere", sky: [0.5, 0.38, 0.34], ground: [0.24, 0.12, 0.1], intensity: 0.66 * Math.PI },
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
        top: topOf(P.PLATE, "dungeon-plates-top", 65),
        rim: P.SINEW[4]!,
        skirt: ribs,
        fill: { kind: "hemisphere", sky: [0.42, 0.5, 0.5], ground: [0.28, 0.14, 0.24], intensity: 0.72 * Math.PI },
      };
    }
  }
}

/** How deep the ground's edge drops into the void. */
const SKIRT = 2.5;

/** What drawing a plan's walls reads: its cells, each wall tile's kind and its heights. */
export interface WallContext {
  readonly look: WallLook;
  readonly w: number;
  readonly d: number;
  /** The plan's cell at a tile (beyond its edges, wall). */
  readonly at: (x: number, z: number) => Cell;
  readonly kindAt: (x: number, z: number) => WallKind;
  /** A wall's full height, and its cut-down one. */
  readonly full: (x: number, z: number) => number;
  readonly lowAt: (x: number, z: number) => number;
  /** The lowest a drawn wall ever stands (0 for a wall not drawn, -1 for open ground). */
  readonly lowest: (x: number, z: number) => number;
}

export function wallContext(cells: readonly string[], theme: Theme): WallContext {
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
  /** A cut-down wall's height: a rough one's varies by a few texels, tile by tile. */
  const lowAt = (x: number, z: number) => look.low + (look.rough || look.crag ? Math.round((hash2(x, z, 78) - 0.5) * 6) / 16 : 0);
  const lowest = (x: number, z: number): number => {
    const k = kindAt(x, z);
    if (k === "none") return at(x, z) === WALL ? 0 : -1;
    return k === "back" ? full(x, z) : lowAt(x, z);
  };
  return { look, w, d, at, kindAt, full, lowAt, lowest };
}

/** Where a theme's rock stands back from its tile's edge (a crag look's), the wall tiles the floor's ground runs under. */
export function groundUnderWalls(cells: readonly string[], theme: Theme): ((x: number, z: number) => boolean) | null {
  const ctx = wallContext(cells, theme);
  if (!ctx.look.crag) return null;
  const rock = new Rock(ctx, ctx.look.crag);
  return (x, z) => rock.groundUnder(x, z);
}

/** The walls of a plan (its rows of characters), as a recipe's Built: still walls, and the side walls as cut-aways. */
export function drawWalls(cells: readonly string[], theme: Theme): Built {
  const ctx = wallContext(cells, theme);
  const { look, w, d, at, kindAt, full, lowAt, lowest } = ctx;

  const still = new MeshBuilder();
  const east = { full: new MeshBuilder(), low: new MeshBuilder() };
  const west = { full: new MeshBuilder(), low: new MeshBuilder() };
  const rim = flat(look.rim);

  type Side = "south" | "north" | "east" | "west";
  const STEP: Record<Side, readonly [number, number]> = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] };
  const block = (b: MeshBuilder, x: number, z: number, h: number, banded: boolean) => {
    const open = (side: Side) => lowest(x + STEP[side][0], z + STEP[side][1]) < 0;
    // A rough wall (a cave's) stands back from the open ground a texel or two, tile by tile.
    const back = (side: Side, salt: number) => (look.rough && open(side) ? Math.round(hash2(x, z, 90 + salt) * look.rough * 16) / 16 : 0);
    const x0 = x + back("west", 1);
    const x1 = x + 1 - back("east", 2);
    const z0 = z + back("north", 3);
    const z1 = z + 1 - back("south", 4);
    // The top: dark, a texel of lit edge along each side over open ground, so it reads as a wall's top.
    const e = (side: Side) => (open(side) ? PX : 0);
    b.box(x0 + e("west"), h, z0 + e("north"), x1 - e("east"), h, z1 - e("south"), { top: look.top });
    if (open("south")) b.box(x0, h, z1 - PX, x1, h, z1, { top: { mat: rim } });
    if (open("north")) b.box(x0, h, z0, x1, h, z0 + PX, { top: { mat: rim } });
    if (open("east")) b.box(x1 - PX, h, z0 + e("north"), x1, h, z1 - e("south"), { top: { mat: rim } });
    if (open("west")) b.box(x0, h, z0 + e("north"), x0 + PX, h, z1 - e("south"), { top: { mat: rim } });
    for (const side of ["south", "north", "east", "west"] as const) {
      const n = lowest(x + STEP[side][0], z + STEP[side][1]);
      // Open ground: the whole face; a lower wall: what shows above it.
      const from = n < 0 ? 0 : n;
      if (from >= h - 1e-6) continue;
      if (n < 0 && banded) face(b, x0, z0, x1, z1, side, from, h);
      else b.box(x0, from, z0, x1, h, z1, { [side]: n < 0 ? look.body : look.side });
    }
  };

  /** A wall's face toward open ground, in bands: its plinth, body and cornice (each a little proud on the south). */
  const face = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, side: Side, y0: number, h: number) => {
    const bands: { a: number; b: number; f: Face; proud: number }[] = [];
    const plinthTo = look.plinth ? Math.min(h, look.plinth.to) : 0;
    const corniceFrom = look.cornice ? Math.max(plinthTo, h - look.cornice.depth) : h;
    if (look.plinth && plinthTo > y0) bands.push({ a: y0, b: plinthTo, f: look.plinth.face, proud: look.plinth.proud });
    if (corniceFrom > Math.max(y0, plinthTo)) bands.push({ a: Math.max(y0, plinthTo), b: corniceFrom, f: look.body, proud: 0 });
    if (look.cornice && h > corniceFrom) bands.push({ a: corniceFrom, b: h, f: look.cornice.face, proud: look.cornice.proud });
    for (const band of bands) {
      b.box(x0, band.a, z0, x1, band.b, z1, { [side]: band.f });
      if (side === "south" && band.proud > 0) b.box(x0, band.a, z1, x1, band.b, z1 + band.proud, { south: band.f, top: band.f, east: band.f, west: band.f });
    }
  };

  const rock = look.crag ? new Rock(ctx, look.crag) : null;
  const draw = (b: MeshBuilder, x: number, z: number, h: number, banded: boolean) => (rock ? rock.block(b, x, z, h) : block(b, x, z, h, banded));
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const k = kindAt(x, z);
      if (k === "none") continue;
      if (k === "near") draw(still, x, z, lowAt(x, z), false);
      else if (k === "back") draw(still, x, z, full(x, z), true);
      else {
        const pair = k === "east" ? east : west;
        draw(pair.full, x, z, full(x, z), true);
        draw(pair.low, x, z, lowAt(x, z), false);
      }
    }
  }
  rock?.shoulders(still);
  // The ground's edges over the void: a crag's lips of rock, or plain skirts.
  if (rock) rock.chasm(still);
  else for (let z = 0; z < d; z++) {
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
  // A pool's lit rim: a kerb a texel wide round the water and the lava, its bank going down to the surface.
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      if (at(x, z) !== 1) continue;
      for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
        const n = at(x + dx, z + dz);
        if (n !== 2 && n !== 3) continue;
        const [x0, x1] = dx === 1 ? [x + 1 - PX, x + 1] : dx === -1 ? [x, x + PX] : [x, x + 1];
        const [z0, z1] = dz === 1 ? [z + 1 - PX, z + 1] : dz === -1 ? [z, z + PX] : [z, z + 1];
        const side = dz === 1 ? "south" : dz === -1 ? "north" : dx === 1 ? "east" : "west";
        still.box(x0, -0.22, z0, x1, PX / 2, z1, { top: { mat: rim }, [side]: look.side });
      }
    }
  }
  const cutaways: Cutaway[] = [
    { full: west.full.model(), low: west.low.model(), when: { camera: "west" } },
    { full: east.full.model(), low: east.low.model(), when: { camera: "east" } },
  ];
  return { model: still.model(), cutaways, lights: [look.fill] };
}
