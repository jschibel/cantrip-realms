import * as THREE from "three";
import { type LitOptions, glow, lit, textureOf } from "../../render/lighting";
import { type Face, type Material, fitted, tiled } from "./builder";
import * as C from "./colors";
import { type Ramp, rampKey } from "./palette";
import type { Pixmap } from "./pixmap";
import * as T from "./textures";

// The materials recipes draw with, each made once from its painted picture: the tiling surfaces (textures.ts) and the
// painted pictures of single things (pictures.ts), fitted onto their faces. A material is made the first time its name
// is asked for and the same object is handed back ever after, so everything painted alike shares one material - and
// the renderer merges by material. Name a material for everything that makes it different: a ramp from a palette goes
// into its name (`painted`, or `rampKey`).

const cache = new Map<string, Material>();

/** A material made once under a name: a picture, lit in bands (or glowing). */
export function material(name: string, paint: () => Pixmap, options: LitOptions & { glowing?: boolean } = {}): Material {
  let m = cache.get(name);
  if (!m) {
    const texture = textureOf(paint());
    m = options.glowing ? glow(texture, options.cutout) : lit(texture, options);
    m.name = name;
    cache.set(name, m);
  }
  return m;
}

/**
 * A material painted from a ramp: under `name` itself when the ramp is `usual` (the default a recipe's palette gives),
 * else under the name and the ramp's key - so a palette that recolors a recipe makes materials of its own, and one that
 * leaves it be shares the usual ones.
 */
export function painted(name: string, ramp: Ramp, usual: Ramp, paint: (ramp: Ramp) => Pixmap, options: LitOptions & { glowing?: boolean } = {}): Material {
  return material(ramp === usual ? name : `${name}@${rampKey(ramp)}`, () => paint(ramp), options);
}

/** A flat-colored lit material (an iron band, a candle), made once per color. */
export function flat(color: number, options: LitOptions = {}): Material {
  const name = `flat:${color.toString(16)}:${options.smooth ? "s" : ""}`;
  let m = cache.get(name);
  if (!m) {
    m = lit(null, options, new THREE.Color(color));
    cache.set(name, m);
  }
  return m;
}

/**
 * The stock materials of walls, roofs, timber and foliage, tiled on whatever is built of them. Those painted from a ramp
 * take one (a palette's slot), defaulting to the Benalish slice's.
 */
export const stock = {
  limestone: (ramp: Ramp = C.LIMESTONE) => painted("limestone", ramp, C.LIMESTONE, (r) => T.ashlar(r, 7)),
  plaster: (ramp: Ramp = C.PLASTER) => painted("plaster", ramp, C.PLASTER, (r) => T.plaster(6, r)),
  roof: (ramp: Ramp = C.ROOF) => painted("roof", ramp, C.ROOF, (r) => T.roofTiles(r, 8)),
  slate: (ramp: Ramp = C.SLATE) => painted("slate", ramp, C.SLATE, (r) => T.slates(9, r)),
  timber: (ramp: Ramp = C.WOOD) => painted("timber", ramp, C.WOOD, (r) => T.timber(10, r)),
  darkTimber: (ramp: Ramp = C.DARKWOOD) => painted("dark-timber", ramp, C.DARKWOOD, (r) => T.timber(16, r)),
  leaves: (ramp: Ramp = C.LEAF) => painted("leaves", ramp, C.LEAF, (r) => T.leaves(11, r), { smooth: true }),
  bark: () => material("bark", () => T.bark(12), { smooth: true }),
  boards: () => material("boards", () => T.floorboards(5)),
  cryptBrick: (ramp: Ramp = C.DUNGEON) => painted("crypt-brick", ramp, C.DUNGEON, (r) => T.ashlar(r, 21, 5, 6, 10)),
  cobbleWall: () => material("cobble-wall", () => T.cobbles(2)),
  flagstone: (ramp: Ramp = C.LIMESTONE) => painted("flagstone", ramp, C.LIMESTONE, (r) => T.flagstones(r, 3)),
  cryptStone: (ramp: Ramp = C.DUNGEON) => painted("crypt-stone", ramp, C.DUNGEON, (r) => T.flagstones(r, 23)),
};

export { fitted, tiled, type Face };
