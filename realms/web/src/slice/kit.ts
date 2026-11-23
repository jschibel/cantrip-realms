import * as THREE from "three";
import { type Material, type Face, fitted, tiled } from "./geometry";
import { type LitOptions, glow, lit, textureOf } from "./material";
import type { Pixmap } from "./pixmap";
import * as T from "./textures";
import * as C from "./colors";

// The materials every scene draws with, each made once from its painted picture: the tiling surfaces (textures.ts) and
// the painted pictures of single things (pictures.ts) fitted onto their faces.

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

export const surfaces = {
  limestone: () => material("limestone", () => T.ashlar(C.LIMESTONE, 7)),
  plaster: () => material("plaster", () => T.plaster(6)),
  roof: () => material("roof", () => T.roofTiles(C.ROOF, 8)),
  slate: () => material("slate", () => T.slates(9)),
  timber: () => material("timber", () => T.timber(10, C.WOOD)),
  darkTimber: () => material("dark-timber", () => T.timber(16, C.DARKWOOD)),
  leaves: () => material("leaves", () => T.leaves(11), { smooth: true }),
  bark: () => material("bark", () => T.bark(12), { smooth: true }),
  boards: () => material("boards", () => T.floorboards(5)),
  cryptBrick: () => material("crypt-brick", () => T.ashlar(C.DUNGEON, 21, 5, 6, 10)),
  cobbleWall: () => material("cobble-wall", () => T.cobbles(2)),
  flagstone: () => material("flagstone", () => T.flagstones(C.LIMESTONE, 3)),
  cryptStone: () => material("crypt-stone", () => T.flagstones(C.DUNGEON, 23)),
};

export { fitted, tiled, type Face };
