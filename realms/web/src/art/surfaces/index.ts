import type { Material } from "../paint/builder";
import * as C from "../paint/colors";
import { material } from "../paint/materials";
import { type Palette, type Ramp, withDefaults } from "../paint/palette";
import type { Pixmap } from "../paint/pixmap";
import * as T from "../paint/textures";
import { bankOf, brinkOf, defineBiomes } from "./biomes";

// The ground, by surface id: what a tile's `surface` names (world/format.ts, TileData). Each is a tiling picture 64
// texels square (four tiles), painted from its palette, and how it meets its neighbours: where two surfaces meet, the
// one of higher `priority` grows over the other in a ragged edge and drops a texel of shadow onto it (render/ground.ts).
// A `hole` is not drawn - what lies `under` it shows (a stream's water) - and its neighbours grow over its edge. Grass
// with `tufts` has that many cards of standing grass a tile on average (render/grass.ts), on tiles not marked `BARE`.
//
// To add a surface: paint its picture in art/paint/textures.ts (64 by 64, seamless, seeded), `defineSurface` it here
// with the ramps it paints from as its palette, and give it a priority among its likely neighbours (paths under grass,
// cobbles under paths, flagstones under cobbles; floors of a room alike).

export interface SurfaceLook {
  /** The tiling picture, 64 texels square. */
  readonly picture: Pixmap;
  /** Who grows over whom where they meet: the higher wins; equals meet in a straight seam. */
  readonly priority: number;
  /** Nothing drawn: what is under shows, and the neighbours grow over its edges. */
  readonly hole?: boolean;
  /** Under a hole: a surface lying `y` below the ground, `spread` past each tile's edges (a stream's water). */
  readonly under?: { readonly material: Material; readonly y: number; readonly spread: number };
  /** Cards of standing grass a tile, on average. */
  readonly tufts?: number;
  /**
   * The ramp standing tufts are painted in, when not the slice's green (dry plains, tundra, reeds): render/grass.ts
   * paints each tile's tufts in its surface's ramp (flowers only in the green).
   */
  readonly tuftRamp?: Ramp;
  /**
   * The face of its banks where the ground steps down from it (render/terrain.ts draws banks on height steps): earth under
   * grass, dark rock in the mountains, peat in the Morass, ice under snow. Tiled, its top row the ground's edge.
   */
  readonly cliff?: Material;
  /** The stone that shows through the worn rim of its terraces' brinks (render/ground.ts): its bank's (biomes.ts). */
  readonly brink?: number;
}

export interface SurfaceEntry {
  readonly id: string;
  readonly about: string;
  readonly palette: Palette;
  readonly look: (palette: Palette) => SurfaceLook;
}

const entries = new Map<string, SurfaceEntry>();
/** Each look made, by its id and palette. */
const looks = new Map<string, SurfaceLook>();

export function defineSurface(id: string, about: string, palette: Palette, look: (palette: Palette) => SurfaceLook): void {
  if (entries.has(id)) throw new Error(`surface "${id}" is defined twice`);
  entries.set(id, { id, about, palette, look });
}

export const SURFACES = {
  has: (id: string): boolean => entries.has(id),
  ids: (): string[] => [...entries.keys()],
  get(id: string): SurfaceEntry {
    const e = entries.get(id);
    if (!e) throw new Error(`no surface "${id}"`);
    return e;
  },
  /**
   * A surface's look under a palette (over its own). Painting one takes milliseconds, so each is made once, by id and
   * palette, and kept: the same look object every time.
   */
  look(id: string, palette?: Palette): SurfaceLook {
    const key = palette === undefined ? id : `${id}@${JSON.stringify(palette)}`;
    const known = looks.get(key);
    if (known) return known;
    const e = SURFACES.get(id);
    const look = e.look(withDefaults(e.palette, palette));
    // Every surface's bank, as biomes.ts gives it, where the surface does not name its own.
    const cliff = look.cliff ?? bankOf(id);
    const brink = look.brink ?? brinkOf(id);
    const made: SurfaceLook = { ...look, ...(cliff ? { cliff } : {}), ...(brink !== undefined ? { brink } : {}) };
    looks.set(key, made);
    return made;
  },
};

const ramp = (p: Palette, k: string): Ramp => p[k]!;

/** Water lying a little below the ground, seen through a stream's holes; it scrolls a texel at a time. */
export const streamMaterial = (): Material => {
  const m = material("stream", () => T.water(13), { flat: true });
  m.userData.scroll = { rate: [2, 6], step: [1 / 32, -1 / 32] };
  return m;
};

// --- Out of doors ---------------------------------------------------------------------------------------------------------

defineSurface("grass", "turf, tufts standing up off it", { grass: C.GRASS }, () => ({ picture: T.grass(1), priority: 5, tufts: 3 }));
defineSurface("cobbles", "a cobbled street", {}, () => ({ picture: T.cobbles(2), priority: 1 }));
defineSurface("flagstones", "a square's flagstones", { stone: C.LIMESTONE }, (p) => ({ picture: T.flagstones(ramp(p, "stone"), 3), priority: 0 }));
defineSurface("dirt", "a dirt track", { earth: C.DIRT }, () => ({ picture: T.dirt(4), priority: 3 }));
defineSurface("straw", "strawed earth", { straw: C.STRAW }, () => ({ picture: T.straw(15), priority: 2 }));
defineSurface("furrows", "ploughland", { earth: C.DIRT }, () => ({ picture: T.furrows(16), priority: 2 }));
defineSurface("wheat", "a field of wheat", { straw: C.STRAW }, () => ({ picture: T.wheat(17), priority: 2 }));
defineSurface("stream", "running water under the banks: a hole, water below", {}, () => ({
  picture: T.dirt(4),
  priority: -1,
  hole: true,
  under: { material: streamMaterial(), y: -0.12, spread: 0.75 },
}));

// --- Indoors ----------------------------------------------------------------------------------------------------------------

defineSurface("floorboards", "a room's boards", {}, () => ({ picture: T.floorboards(5), priority: 1 }));
defineSurface("hearthstone", "the flags before a hearth", { stone: C.COBBLE }, (p) => ({ picture: T.flagstones(ramp(p, "stone"), 33), priority: 2 }));
defineSurface("crypt-floor", "a crypt's cold flags, bones and grime", {}, () => ({ picture: T.cryptFloor(14), priority: 1 }));

// --- The world's biomes, roads and waters (biomes.ts) ----------------------------------------------------------------------

defineBiomes(defineSurface);
export { BANKS, PRIORITY, SURFACE_GROUPS, bankOf, brinkOf } from "./biomes";
