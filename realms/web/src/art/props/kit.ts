import * as THREE from "three";
import { TEXELS } from "../../render/lighting";
import { type Face, type Material, MeshBuilder, fitted } from "../paint/builder";
import * as C from "../paint/colors";
import { material, painted, stock } from "../paint/materials";
import { type Ramp, rampKey } from "../paint/palette";
import { Pixmap, type Rgb, hash2, seeded } from "../paint/pixmap";
import { crack, fbm, valueNoise } from "../paint/procedural";
import * as R from "../paint/ramps";
import * as G from "../paint/terrain";
import * as Pic from "../paint/pictures";
import type { Frames } from "../recipe";

// The drawing kit of the world's props beyond the slice's (draw.ts): shapes the slice did without - a tapered limb
// between two points (branches, roots, palm trunks, logs), a frustum (pine tiers, stumps, towers), a faceted lump of
// rock (crags, mountains, mounds) - and the materials painted from a ramp that they wear: bark of every tree, rock of
// every stone, snow, foliage, cloth. Every material painted from a ramp is named for it (`painted`).

export const PX = 1 / 16;
type V3 = readonly [number, number, number];

// --- Shapes ----------------------------------------------------------------------------------------------------------------

/**
 * A tapered limb from `a` to `c`, `r0` thick at `a` and `r1` at `c`, `segments` sides, smooth-shaded, its material tiled
 * round it and along it at the world's density: a branch, a root, a palm's trunk, a log.
 */
export function limb(b: MeshBuilder, a: V3, c: V3, r0: number, r1: number, mat: Material, segments = 6, caps = false): void {
  const A = new THREE.Vector3(...a);
  const Cv = new THREE.Vector3(...c);
  const axis = Cv.clone().sub(A);
  const length = axis.length();
  if (length < 1e-6) return;
  axis.normalize();
  const ref = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const image = mat.map?.image as { width: number; height: number } | undefined;
  const tw = (image?.width ?? TEXELS) / TEXELS;
  const th = (image?.height ?? TEXELS) / TEXELS;
  const around = Math.max(1, Math.round((2 * Math.PI * Math.max(r0, r1)) / tw));
  const ring = (center: THREE.Vector3, r: number, ang: number) => center.clone().addScaledVector(u, Math.cos(ang) * r).addScaledVector(v, Math.sin(ang) * r);
  const normal = (ang: number) => u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang));
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p = [ring(A, r0, a0), ring(A, r0, a1), ring(Cv, r1, a1), ring(Cv, r1, a0)];
    const n = [normal(a0), normal(a1), normal(a1), normal(a0)];
    const u0 = (around * i) / segments;
    const u1 = (around * (i + 1)) / segments;
    b.polygon(
      mat,
      p.map((q) => [q.x, q.y, q.z] as V3),
      [
        [u0, 0],
        [u1, 0],
        [u1, length / th],
        [u0, length / th],
      ],
      n.map((q) => [q.x, q.y, q.z] as V3),
    );
  }
  if (caps) {
    for (const [center, r, dir] of [
      [Cv, r1, 1],
      [A, r0, -1],
    ] as const) {
      const pts: V3[] = [];
      const uvs: [number, number][] = [];
      for (let i = 0; i < segments; i++) {
        const k = dir > 0 ? i : segments - i;
        const ang = (k / segments) * Math.PI * 2;
        const q = ring(center, r, ang);
        pts.push([q.x, q.y, q.z]);
        uvs.push([0.5 + Math.cos(ang) * 0.5, 0.5 + Math.sin(ang) * 0.5]);
      }
      b.polygon(mat, pts, uvs);
    }
  }
}

/** The end of a log or a stump: its rings fitted across a disc facing `normal` (polygon at `center`, radius r). */
export function disc(b: MeshBuilder, center: V3, normal: V3, r: number, face: Face, segments = 8): void {
  const n = new THREE.Vector3(...normal).normalize();
  const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
  const u = new THREE.Vector3().crossVectors(ref, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const [u0, v0, u1, v1] = face.fit ?? [0, 0, 1, 1];
  const pts: V3[] = [];
  const uvs: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const ang = (i / segments) * Math.PI * 2;
    const q = new THREE.Vector3(...center).addScaledVector(u, Math.cos(ang) * r).addScaledVector(v, Math.sin(ang) * r);
    pts.push([q.x, q.y, q.z]);
    uvs.push([u0 + (u1 - u0) * (0.5 + Math.cos(ang) * 0.5), v0 + (v1 - v0) * (0.5 + Math.sin(ang) * 0.5)]);
  }
  b.polygon(face.mat, pts, uvs);
}

/**
 * A solid of revolution through `rings` ([radius, height] from the bottom up; a radius of 0 closes it to a point),
 * each vertex pushed in or out by up to `jitter` of its radius (seeded) and flat-shaded: a faceted lump of rock, a crag,
 * a mountain, a mound. Its material is laid on as the three-quarter camera sees it (as `blob` does), so texels keep
 * their size on every facet. `smooth` shades it round instead (a pine's tier).
 */
export function lump(
  b: MeshBuilder,
  cx: number,
  cz: number,
  y0: number,
  rings: readonly (readonly [number, number])[],
  segments: number,
  mat: Material,
  seed = 0,
  jitter = 0.18,
  options: { readonly smooth?: boolean; readonly squash?: number; readonly twist?: number } = {},
): void {
  const random = seeded(seed * 7919 + 17);
  const squash = options.squash ?? 1;
  const twist = options.twist ?? random() * Math.PI;
  const image = mat.map?.image as { width: number; height: number } | undefined;
  const w = (image?.width ?? TEXELS) / TEXELS;
  const h = (image?.height ?? TEXELS) / TEXELS;
  const pts: V3[][] = rings.map(([r, y], j) =>
    Array.from({ length: segments }, (_, i) => {
      const ang = (i / segments) * Math.PI * 2 + twist;
      const k = r === 0 ? 0 : r * (1 + (random() * 2 - 1) * jitter * (j === 0 || j === rings.length - 1 ? 0.5 : 1));
      return [cx + Math.sin(ang) * k, y0 + y, cz + Math.cos(ang) * k * squash] as V3;
    }),
  );
  const matrix = (b as unknown as { matrix: THREE.Matrix4 }).matrix;
  const uv = (c: V3): [number, number] => {
    const p = new THREE.Vector3(...c).applyMatrix4(matrix);
    return [p.x / w, (p.y - p.z) / h];
  };
  for (let j = 0; j + 1 < pts.length; j++) {
    for (let i = 0; i < segments; i++) {
      const i1 = (i + 1) % segments;
      const quad: V3[] = [pts[j]![i]!, pts[j]![i1]!, pts[j + 1]![i1]!, pts[j + 1]![i]!];
      const top = rings[j + 1]![0] === 0;
      const bottom = rings[j]![0] === 0;
      const poly = top ? [quad[0]!, quad[1]!, quad[2]!] : bottom ? [quad[0]!, quad[2]!, quad[3]!] : quad;
      if (options.smooth) {
        const nrm = poly.map((q) => {
          const v = new THREE.Vector3(q[0] - cx, 0.35 * (q[1] - y0) / Math.max(0.01, rings[rings.length - 1]![1]), q[2] - cz).normalize();
          return [v.x, v.y + 0.3, v.z] as V3;
        });
        b.polygon(mat, poly, poly.map(uv), nrm);
      } else {
        b.polygon(mat, poly, poly.map(uv));
      }
    }
  }
  // A flat top where the last ring is open.
  const last = pts[pts.length - 1]!;
  if (rings[rings.length - 1]![0] > 0) b.polygon(mat, last, last.map(uv));
}

/** An upright cone or frustum, `segments` sides, smooth-shaded, its material laid on as the camera sees it. */
export function frustum(b: MeshBuilder, cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, segments: number, mat: Material, offset: readonly [number, number] = [0, 0]): void {
  const image = mat.map?.image as { width: number; height: number } | undefined;
  const w = (image?.width ?? TEXELS) / TEXELS;
  const h = (image?.height ?? TEXELS) / TEXELS;
  const matrix = (b as unknown as { matrix: THREE.Matrix4 }).matrix;
  const uv = (c: V3): [number, number] => {
    const p = new THREE.Vector3(...c).applyMatrix4(matrix);
    return [(p.x + offset[0] / TEXELS) / w, (p.y - p.z + offset[1] / TEXELS) / h];
  };
  const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p = (a: number, r: number, y: number): V3 => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
    const n = (a: number): V3 => {
      const v = new THREE.Vector3(Math.sin(a), slope, Math.cos(a)).normalize();
      return [v.x, v.y, v.z];
    };
    const poly: V3[] = r1 > 0 ? [p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), p(a0, r1, y1)] : [p(a0, r0, y0), p(a1, r0, y0), p((a0 + a1) / 2, 0, y1)];
    const nrm: V3[] = r1 > 0 ? [n(a0), n(a1), n(a1), n(a0)] : [n(a0), n(a1), n((a0 + a1) / 2)];
    b.polygon(mat, poly, poly.map(uv), nrm);
  }
  // The underside, so a tier seen from below is closed.
  if (r0 > 0) {
    const ring: V3[] = [];
    for (let i = segments - 1; i >= 0; i--) {
      const a = (i / segments) * Math.PI * 2;
      ring.push([cx + Math.sin(a) * r0, y0, cz + Math.cos(a) * r0]);
    }
    b.polygon(mat, ring, ring.map(uv));
  }
}

/** A card standing upright through (x, z), turned by `turn` about the vertical, `w` wide and `h` high from `y`. */
export function standingCard(b: MeshBuilder, face: Face, x: number, y: number, z: number, w: number, h: number, turn = 0): void {
  b.at(x, 0, z, turn, () => b.card(face, -w / 2, y, w / 2, y + h, 0));
}

// --- Materials painted from ramps -----------------------------------------------------------------------------------------

/** Bark from a ramp: furrows running up (oak, elm), banded white (birch), or smooth and mossy (Llanowar, cypress). */
export function bark(ramp: Ramp, kind: "furrowed" | "birch" | "smooth" | "palm" = "furrowed"): Material {
  return material(`bark-${kind}@${rampKey(ramp)}`, () => barkPicture(ramp, kind), { smooth: true });
}

function barkPicture(r: Ramp, kind: "furrowed" | "birch" | "smooth" | "palm"): Pixmap {
  const p = new Pixmap(16, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const n = valueNoise(x * 3, y, 5, 32, 12 + r.length);
      let c: Rgb;
      if (kind === "birch") {
        c = n < 0.5 ? r[5]! : r[4]!;
        const band = valueNoise(x, y * 4, 4, 32, 31) > 0.72;
        if (band) c = x % 5 < 3 ? r[1]! : r[2]!;
        if (hash2(x, y, 4) < 0.04) c = r[3]!;
      } else if (kind === "palm") {
        const ringY = y % 4;
        c = ringY === 0 ? r[1]! : ringY === 1 ? r[4]! : n < 0.5 ? r[3]! : r[2]!;
      } else if (kind === "smooth") {
        c = n < 0.3 ? r[2]! : n < 0.72 ? r[3]! : r[4]!;
        if (valueNoise(x * 2, y, 8, 32, 77) > 0.7) c = R.MOSS[3]!;
      } else {
        c = n < 0.22 ? r[1]! : n < 0.4 ? r[2]! : n > 0.72 ? r[4]! : r[3]!;
      }
      p.set(x, y, c);
    }
  }
  return p;
}

/** Foliage from a ramp: the slice's leaves (stock.leaves) for any tree, one material per ramp. */
export const foliage = (ramp: Ramp): Material => stock.leaves(ramp);

/** Needles: short dark strokes, a lit edge on each tuft, for pines and firs. */
export function needleMaterial(ramp: Ramp): Material {
  return material(`needles@${rampKey(ramp)}`, () => {
    const p = new Pixmap(32, 32, ramp[2]!);
    const random = seeded(51);
    for (let k = 0; k < 200; k++) {
      const x = Math.floor(random() * 32);
      const y = Math.floor(random() * 32);
      const t = 1 + Math.floor(random() * 4);
      p.set(x, y, ramp[t + 1]!);
      p.set(x - 1, y + 1, ramp[t]!);
      p.set(x + 1, y + 1, ramp[t]!);
      p.set(x, y + 1, ramp[t - 1]!);
    }
    return p;
  }, { smooth: true });
}

/** Rock from a ramp: weathered bands, cracks, lichen (as textures.ts's rock), for boulders, crags and cliffs. */
export function rock(ramp: Ramp = C.COBBLE, lichen: Ramp | null = C.MEADOW): Material {
  const name = `rock@${rampKey(ramp)}${lichen ? `+${rampKey(lichen)}` : ""}`;
  return material(name, () => {
    const p = new Pixmap(32, 32);
    const random = seeded(18);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const n = fbm(x, y * 1.5, 8, 32, 18);
        let c = n < 0.35 ? ramp[3]! : n < 0.62 ? ramp[4]! : ramp[5]!;
        if (hash2(x, y, 18) < 0.04) c = ramp[2]!;
        if (lichen && fbm(x, y, 8, 32, 21) > 0.74) c = lichen[Math.min(lichen.length - 1, 2)]!;
        p.set(x, y, c);
      }
    }
    for (let n = 0; n < 5; n++) crack(p, Math.floor(random() * 32), Math.floor(random() * 32), 4 + Math.floor(random() * 4), ramp[1]!, random);
    return p;
  }, { smooth: true });
}

/** Snow lying on things: white with blue shadows. */
export const snowCover = (): Material => material("snow-cover", () => G.snow(R.SNOW, 191), { smooth: true });

/** Wood of a ramp, grain running up (posts, planks, carts): the slice's timber for any wood. */
export function wood(ramp: Ramp = C.WOOD): Material {
  return painted("timber", ramp, C.WOOD, (r) => {
    const p = new Pixmap(16, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 16; x++) {
        const n = valueNoise(x * 4, y, 6, 32, 10);
        let c = r[3]!;
        if (n < 0.35) c = r[2]!;
        if (n > 0.7) c = r[4]!;
        if (hash2(x, y, 10) < 0.06) c = r[2]!;
        p.set(x, y, c);
      }
    }
    return p;
  });
}

/** Planks of a ramp laid side by side, a dark gap between (a cart's bed, a door, a dock's deck). */
export function planks(ramp: Ramp = C.WOOD, across = false): Material {
  return material(`planks${across ? "-across" : ""}@${rampKey(ramp)}`, () => G.boardwalk(across ? "z" : "x", ramp, 141));
}

/** A cross-section of a log: rings round a dark heart, bark round the edge. */
export function ringsMaterial(ramp: Ramp = C.WOOD): Material {
  return material(`rings@${rampKey(ramp)}`, () => {
    const p = new Pixmap(12, 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const d = Math.hypot(x - 5.5, y - 5.5);
        let c = Math.floor(d) % 2 ? ramp[4]! : ramp[5]!;
        if (d < 1.2) c = ramp[3]!;
        if (d > 5) c = ramp[1]!;
        p.set(x, y, c);
      }
    }
    return p;
  });
}

/** A cloth of a ramp: a banner's field, a tent's canvas, a wagon's cover - plain, folds as light and dark bands. */
export function cloth(ramp: Ramp, kind: "plain" | "striped" = "plain", stripe: Ramp = C.CLOTH_WHITE): Material {
  return material(`cloth-${kind}@${rampKey(ramp)}${kind === "striped" ? `+${rampKey(stripe)}` : ""}`, () => {
    const p = new Pixmap(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const r = kind === "striped" && Math.floor(x / 4) % 2 ? stripe : ramp;
        let c = r[3]!;
        if (x % 4 === 0) c = r[4]!;
        if (x % 4 === 3) c = r[2]!;
        if (hash2(x, y, 5) < 0.04) c = r[2]!;
        p.set(x, y, c);
      }
    }
    return p;
  }, { twoSided: true });
}

/** A banner of a ramp: the slice's Benalish banner (pictures.ts) recolored. */
export function bannerMaterial(field: Ramp, trim: Ramp = C.GOLD): Material {
  // The banner's painter reads six steps of its trim (and five of its field): shorter ramps repeat their lightest.
  const pad = (r: Ramp, n: number): Ramp => (r.length >= n ? r : [...r, ...new Array<number>(n - r.length).fill(r[r.length - 1]!)]);
  return material(`banner@${rampKey(field)}+${rampKey(trim)}`, () => Pic.banner(pad(field, 6), pad(trim, 6)), { cutout: true, twoSided: true });
}

/** Three frames of a flame `n` texels high, as cards facing south and east-west, burning at (x, y, z). */
export function flames(x: number, y: number, z: number, n = 12): Frames {
  return {
    rate: 8,
    models: [0, 1, 2].map((f) => {
      const m = material(`flame-${f}-${n}`, () => Pic.flame(f, n), { glowing: true, cutout: true });
      const fb = new MeshBuilder();
      fb.card(fitted(m), x - n / 32, y, x + n / 32, y + n / 16, z);
      return fb.model();
    }),
  };
}

/** A glowing material of one color (embers, a lantern's glass, an eye, a rune). */
export function glowing(color: Rgb): Material {
  return material(`glow:${color.toString(16)}`, () => new Pixmap(4, 4, color), { glowing: true });
}

/** A picture painted once by name and fitted, cut out. */
export function cutout(name: string, paint: () => Pixmap, twoSided = true): Material {
  return material(name, paint, { cutout: true, twoSided });
}

/** Runs `draw` moved to (x, y, z), turned about the vertical and scaled evenly by `scale` (a statue filling its plinth). */
export function atScaled(b: MeshBuilder, x: number, y: number, z: number, turn: number, scale: number, draw: () => void): void {
  const saved = b.matrix;
  b.matrix = saved.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(turn)).multiply(new THREE.Matrix4().makeScale(scale, scale, scale)));
  try {
    draw();
  } finally {
    b.matrix = saved;
  }
}
