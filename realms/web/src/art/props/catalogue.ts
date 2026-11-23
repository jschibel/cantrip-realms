import type { LightData, PropData, Rect, XZ } from "../../world/format";
import type { MeshBuilder } from "../paint/builder";
import type { Palette } from "../paint/palette";
import type { Built } from "../recipe";
import "../paint/regions";
import { drawn, turnOf } from "./registry";

// What the world needs to know of a prop besides how it looks: the ground it stands on and whether that ground can
// still be walked (its footprint), where it belongs (its category and biomes), an example of its data (for the gallery
// and the tests), and the light it gives, if any (the chunk's `lights` carry it: a prop's recipe makes no lights).
//
// The World agent reads this: `PROP_CATALOGUE` for every outdoor prop, and `tilesOf(prop)` for the tiles a placed prop
// covers - to mark them blocked (`blocks`) and bare (nothing grows up through it). Footprints are given unturned about
// the prop's anchor; `tilesOf` turns and scales them as the prop is placed.

/**
 * A way through a prop (a gatehouse's gap, a town wall's gate): what of it stands solid, and the passage, both placed
 * (world units). `tilesOf` covers the solid rectangles and leaves out every tile the passage crosses, so it stays
 * walkable whatever the shape round it. None (null: its args do not say where the way is), the shape as it stands.
 */
export interface Gateway {
  readonly solid: readonly Rect[];
  readonly open: Rect;
}

/**
 * Where a prop stands: a rectangle about its anchor, or a line from its anchor to `args.to` - and, for a prop with a way
 * through it, `gateway`: the tiles are then its solid parts', its passage left out.
 */
export type Footprint = (
  | {
      /** The rectangle it covers about its anchor before turning, world units: [x0, z0, x1, z1]. */
      readonly rect: Rect;
      /** Whether its tiles refuse walking: mark them blocked (flag 1). */
      readonly blocks: boolean;
      /** Scaled by `args.size` over the rectangle's width too (a statue filling its square). */
      readonly sizeArg?: boolean;
    }
  | {
      /** A line from (x, z) to `args.to`, `width` wide (a fence, a wall). */
      readonly line: number;
      readonly blocks: boolean;
    }
  | {
      /** A rectangle from (x, z) to `args.to` (a dock, a terrace). */
      readonly area: true;
      readonly blocks: boolean;
    }
  | {
      /**
       * A rectangle `args.w` by `args.d` from (x, z), its corner (a dungeon entrance's footprint); these across its front
       * and deep when its args do not say (turned with `rot`).
       */
      readonly sized: readonly [number, number];
      readonly blocks: boolean;
    }
) & { readonly gateway?: (p: PropData) => Gateway | null };

export interface PropInfo {
  readonly id: string;
  /** What kind of thing: tree, plant, rock, mountain, fence, ruin, light, sign, goods, travel, water, phyrexian, entrance, street. */
  readonly category: string;
  /** Where it belongs: biome or region names (plains, farmland, forest, llanowar, verdura, swamp, morass, tundra, keld, mountain, coast, volcanic, waste, phyrexian, town, road), or "any". */
  readonly biomes: readonly string[];
  readonly footprint: Footprint;
  /** An example of its data (its args): what the gallery shows and the tests build. */
  readonly sample: Omit<PropData, "id" | "x" | "z">;
  /** The light it gives, relative to its anchor (unturned): the World agent adds it to the chunk's `lights`. */
  readonly light?: Omit<LightData, "at"> & { readonly at: readonly [number, number, number] };
}

const catalogue = new Map<string, PropInfo>();

/** Every outdoor prop's footprint, biomes and example, by id. */
export const PROP_CATALOGUE: ReadonlyMap<string, PropInfo> = catalogue;

/** Records what the world needs to know of a prop (defined elsewhere). */
export function describe(id: string, info: Omit<PropInfo, "id" | "sample"> & { readonly sample?: PropInfo["sample"] }): void {
  if (catalogue.has(id)) throw new Error(`prop "${id}" is catalogued twice`);
  catalogue.set(id, { id, sample: {}, ...info });
}

/** Defines a prop drawn onto a builder (registry.ts, `drawn`) and catalogues it at once. */
export function prop(
  id: string,
  about: string,
  info: Omit<PropInfo, "id" | "sample"> & { readonly sample?: PropInfo["sample"] },
  draw: (b: MeshBuilder, p: PropData, palette: Palette) => Omit<Built, "model"> | void,
  palette: Palette = {},
  check?: (p: PropData) => readonly string[],
  far?: (b: MeshBuilder, p: PropData, palette: Palette) => void,
): void {
  drawn(id, about, draw, palette, check, far);
  describe(id, info);
}

/** A footprint of `w` by `d` world units centred on the anchor. */
export const centred = (w: number, d: number, blocks = true): Footprint => ({ rect: [-w / 2, -d / 2, w / 2, d / 2], blocks });
/** A footprint along a line to `args.to`, `width` wide. */
export const along = (width: number, blocks = true): Footprint => ({ line: width, blocks });
/** A footprint over the rectangle from the anchor to `args.to`. */
export const over = (blocks: boolean): Footprint => ({ area: true, blocks });

const key = (x: number, z: number) => `${x},${z}`;

/**
 * The tiles a placed prop covers, and whether they refuse walking: every tile its footprint overlaps by more than a
 * sliver (a sixteenth). A prop not in the catalogue covers its anchor's tile and blocks it.
 */
export function tilesOf(p: PropData): { readonly tiles: readonly XZ[]; readonly blocks: boolean } {
  const info = catalogue.get(p.id);
  const fp: Footprint = info?.footprint ?? centred(0.5, 0.5);
  const tiles = new Map<string, XZ>();
  const addRect = (x0: number, z0: number, x1: number, z1: number) => {
    const e = 1 / 16;
    for (let z = Math.floor(z0 + e); z <= Math.floor(z1 - e); z++) for (let x = Math.floor(x0 + e); x <= Math.floor(x1 - e); x++) tiles.set(key(x, z), [x, z]);
  };
  const to = p.args?.to;
  const gateway = fp.gateway?.(p);
  if (gateway) {
    const { solid, open } = gateway;
    // The passage's tiles first, set aside; then the solid parts' without them.
    addRect(...open);
    const passage = new Set(tiles.keys());
    tiles.clear();
    for (const r of solid) addRect(...r);
    for (const k of passage) tiles.delete(k);
  } else if ("sized" in fp) {
    const turnedRound = ((((p.rot ?? 0) % 4) + 4) % 4) % 2 === 1;
    const [dw, dd] = turnedRound ? [fp.sized[1], fp.sized[0]] : fp.sized;
    const w = typeof p.args?.w === "number" ? (p.args.w as number) : dw;
    const d = typeof p.args?.d === "number" ? (p.args.d as number) : dd;
    addRect(p.x, p.z, p.x + w, p.z + d);
  } else if ("rect" in fp) {
    const [a0, , a1] = fp.rect;
    const size = fp.sizeArg && typeof p.args?.size === "number" ? (p.args.size as number) / (a1 - a0) : 1;
    const s = (p.scale ?? 1) * size;
    const t = turnOf(p);
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const [a, b, cc, d] = fp.rect;
    // The turned rectangle's bounds (a turn about the vertical: x' = x cos + z sin, z' = -x sin + z cos).
    const corners = [
      [a, b],
      [cc, b],
      [cc, d],
      [a, d],
    ].map(([x, z]) => [p.x + s * (x! * c + z! * sn), p.z + s * (-x! * sn + z! * c)] as const);
    addRect(Math.min(...corners.map((q) => q[0])), Math.min(...corners.map((q) => q[1])), Math.max(...corners.map((q) => q[0])), Math.max(...corners.map((q) => q[1])));
  } else if (Array.isArray(to) && typeof to[0] === "number" && typeof to[1] === "number") {
    const [x1, z1] = to as [number, number];
    if ("line" in fp) {
      const h = fp.line / 2;
      const length = Math.hypot(x1 - p.x, z1 - p.z);
      const n = Math.max(1, Math.ceil(length / 0.25));
      for (let i = 0; i <= n; i++) {
        const x = p.x + ((x1 - p.x) * i) / n;
        const z = p.z + ((z1 - p.z) * i) / n;
        addRect(x - h, z - h, x + h, z + h);
      }
    } else {
      addRect(Math.min(p.x, x1), Math.min(p.z, z1), Math.max(p.x, x1), Math.max(p.z, z1));
    }
  } else {
    addRect(p.x - 0.25, p.z - 0.25, p.x + 0.25, p.z + 0.25);
  }
  return { tiles: [...tiles.values()], blocks: fp.blocks };
}
