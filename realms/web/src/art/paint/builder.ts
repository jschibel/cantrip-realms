import * as THREE from "three";
import { TEXELS } from "../../render/lighting";

// Low-poly shapes authored by code - boxes, gable roofs, cylinders, blobs - textured at one texel density. A face is
// either tiled from a repeating texture anchored to the world grid (a wall's stones, a floor's planks: so they line up
// across pieces and every texel is the same size), or fitted with one painted picture (a door, a crate's side, a face).
// A builder gathers the faces of many shapes by material. What it gathered is a `Model`: plain geometry by material, in
// world coordinates, that a recipe returns (art/recipe.ts) and the renderer merges with the rest of a place's scenery,
// so a whole street is a handful of meshes (`meshesOf`).

export type Material = THREE.Material & { map?: THREE.Texture | null };

/** How a face is textured: tiled from the world grid (optionally offset, in texels), or fitted to a rectangle of a map. */
export type Face =
  | { readonly mat: Material; readonly fit?: undefined; readonly offset?: readonly [number, number]; readonly density?: number }
  | { readonly mat: Material; readonly fit: readonly [number, number, number, number] };

/** A face from a material: tiled. */
export const tiled = (mat: Material, offset?: readonly [number, number]): Face => ({ mat, offset });
/** A face from a material: the whole picture, or a rectangle of it in texels from its top left. */
export function fitted(mat: Material, rect?: readonly [number, number, number, number]): Face {
  const image = mat.map?.image as { width: number; height: number } | undefined;
  const w = image?.width ?? 1;
  const h = image?.height ?? 1;
  const [x, y, rw, rh] = rect ?? [0, 0, w, h];
  return { mat, fit: [x / w, 1 - (y + rh) / h, (x + rw) / w, 1 - y / h] };
}

export interface BoxFaces {
  readonly top?: Face;
  readonly bottom?: Face;
  readonly north?: Face;
  readonly south?: Face;
  readonly east?: Face;
  readonly west?: Face;
}

/** A face as given, or a material tiled. */
export const asFace = (f: Face | Material): Face => ("mat" in f ? (f as Face) : { mat: f as Material });

/** Every side face one face (or material, tiled), the top another. */
export function sides(side: Face | Material, top?: Face | Material, bottom?: Face | Material): BoxFaces {
  const s = asFace(side);
  return { top: top ? asFace(top) : s, bottom: bottom ? asFace(bottom) : undefined, north: s, south: s, east: s, west: s };
}

interface Buffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** One material's share of a model: triangles in world coordinates (three per index triple), smooth or flat normals. */
export interface ModelPart {
  readonly material: Material;
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly uvs: readonly number[];
  readonly indices: readonly number[];
}

/**
 * Geometry by material, in the order each material was first drawn with - what a recipe makes. Plain data (no meshes
 * yet), so models merge: the renderer appends every piece of a place's scenery into one model and makes it a handful of
 * meshes, one per material. Merging keeps each material's triangles in the order they were drawn.
 */
export interface Model {
  readonly parts: readonly ModelPart[];
}

/** A model with nothing in it. */
export const EMPTY_MODEL: Model = { parts: [] };

/** The models one after another, as if one builder had drawn them all in turn. */
export function mergeModels(models: readonly Model[]): Model {
  const b = new MeshBuilder();
  for (const m of models) b.add(m);
  return b.model();
}

/** A model as meshes, one per material, casting and taking shadows (glowing materials do neither; flat ones take only). */
export function meshesOf(model: Model, name = "built", shadows = true): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  for (const part of model.parts) {
    if (part.indices.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(part.positions as number[], 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(part.normals as number[], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(part.uvs as number[], 2));
    geometry.setIndex(part.indices as number[]);
    geometry.computeBoundingSphere();
    const mat = part.material;
    const mesh = new THREE.Mesh(geometry, mat);
    const glowing = !!mat.userData.glow;
    mesh.castShadow = shadows && !glowing && !mat.userData.flat;
    mesh.receiveShadow = shadows && !glowing;
    group.add(mesh);
  }
  return group;
}

type V3 = readonly [number, number, number];

const spheres = new Map<number, { pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: THREE.BufferAttribute | null }>();

/** The low sphere blobs are squashed from, made once a detail (blobs are many: a crown is several). */
function unitSphere(detail: number): { pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: THREE.BufferAttribute | null } {
  let s = spheres.get(detail);
  if (!s) {
    const geometry = new THREE.IcosahedronGeometry(1, detail);
    s = { pos: geometry.getAttribute("position"), index: geometry.getIndex() };
    spheres.set(detail, s);
  }
  return s;
}

export class MeshBuilder {
  private readonly byMaterial = new Map<Material, Buffers>();
  /** A transform applied to everything added (a prop placed and turned). */
  matrix = new THREE.Matrix4();
  private readonly normalMatrix = new THREE.Matrix3();
  /** The transform `normalMatrix` was last worked out for, so it is inverted once a transform, not once a polygon. */
  private normalFor: THREE.Matrix4 | null = null;
  private normalElements: number[] = [];

  private buffers(mat: Material): Buffers {
    let b = this.byMaterial.get(mat);
    if (!b) {
      b = { positions: [], normals: [], uvs: [], indices: [] };
      this.byMaterial.set(mat, b);
    }
    return b;
  }

  /** Runs `draw` with everything it adds moved and turned (about the vertical) to a place. */
  at(x: number, y: number, z: number, turn: number, draw: () => void): void {
    const saved = this.matrix.clone();
    this.matrix = saved.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(turn)));
    draw();
    this.matrix = saved;
  }

  /** A polygon of corners (counter-clockwise seen from its front), with its uvs and normals. */
  polygon(mat: Material, corners: readonly V3[], uvs: readonly (readonly [number, number])[], normals?: readonly V3[]): void {
    const b = this.buffers(mat);
    const base = b.positions.length / 3;
    if (this.normalFor !== this.matrix || this.matrix.elements.some((e, i) => e !== this.normalElements[i])) {
      this.normalMatrix.getNormalMatrix(this.matrix);
      this.normalFor = this.matrix;
      this.normalElements = [...this.matrix.elements];
    }
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const flat = new THREE.Vector3()
      .subVectors(new THREE.Vector3(...corners[1]!), new THREE.Vector3(...corners[0]!))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...corners[2]!), new THREE.Vector3(...corners[0]!)))
      .normalize();
    corners.forEach((c, i) => {
      p.set(...c).applyMatrix4(this.matrix);
      b.positions.push(p.x, p.y, p.z);
      n.copy(normals ? new THREE.Vector3(...normals[i]!) : flat).applyMatrix3(this.normalMatrix).normalize();
      b.normals.push(n.x, n.y, n.z);
      b.uvs.push(uvs[i]![0], uvs[i]![1]);
    });
    for (let i = 1; i + 1 < corners.length; i++) b.indices.push(base, base + i, base + i + 1);
  }

  /**
   * A quad from its four corners counter-clockwise from its bottom left as seen from the front, textured by a face:
   * fitted, or tiled by world coordinates along `u` and `v` (the world axes across and up the face).
   */
  quad(face: Face, corners: readonly [V3, V3, V3, V3], u: (c: V3) => number, v: (c: V3) => number): void {
    if (face.fit) {
      const [u0, v0, u1, v1] = face.fit;
      this.polygon(face.mat, corners, [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ]);
      return;
    }
    const image = face.mat.map?.image as { width: number; height: number } | undefined;
    const density = face.density ?? TEXELS;
    const w = (image?.width ?? TEXELS) / density;
    const h = (image?.height ?? TEXELS) / density;
    const [ox, oy] = face.offset ?? [0, 0];
    // Positions are taken through the builder's transform first, so tiling follows the world grid.
    const world = corners.map((c) => {
      const p = new THREE.Vector3(...c).applyMatrix4(this.matrix);
      return [p.x, p.y, p.z] as V3;
    });
    this.polygon(
      face.mat,
      corners,
      world.map((c) => [(u(c) + ox / TEXELS) / w, (v(c) + oy / TEXELS) / h] as [number, number]),
    );
  }

  /** An axis-aligned box from one corner to the other; faces not given are left open. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: BoxFaces): void {
    const { top, bottom, north, south, east, west } = faces;
    // World-anchored tiling picks its axes from where the face points after the transform.
    const dir = (local: V3) => new THREE.Vector3(...local).transformDirection(this.matrix);
    const tile = (normal: V3) => {
      const d = dir(normal);
      if (d.y > 0.5) return { u: (c: V3) => c[0], v: (c: V3) => -c[2] };
      if (d.y < -0.5) return { u: (c: V3) => c[0], v: (c: V3) => c[2] };
      if (Math.abs(d.z) >= Math.abs(d.x)) return d.z > 0 ? { u: (c: V3) => c[0], v: (c: V3) => c[1] } : { u: (c: V3) => -c[0], v: (c: V3) => c[1] };
      return d.x > 0 ? { u: (c: V3) => -c[2], v: (c: V3) => c[1] } : { u: (c: V3) => c[2], v: (c: V3) => c[1] };
    };
    const add = (face: Face | undefined, normal: V3, corners: [V3, V3, V3, V3]) => {
      if (!face) return;
      const t = tile(normal);
      this.quad(face, corners, t.u, t.v);
    };
    add(south, [0, 0, 1], [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ]);
    add(north, [0, 0, -1], [
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
    ]);
    add(east, [1, 0, 0], [
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
    ]);
    add(west, [-1, 0, 0], [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ]);
    add(top, [0, 1, 0], [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x0, y1, z0],
    ]);
    add(bottom, [0, -1, 0], [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ]);
  }

  /**
   * A box with its edges and corners rounded off by `r`: each face is cut at `r` from its edges and its border strips
   * are bent in towards the box's middle, so every edge is two narrow facets and every corner a few - a chunky,
   * rounded block (a head, a crate) whose faces keep their pictures texel for texel, the border texels on the bends.
   */
  roundedBox(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    r: number,
    faces: BoxFaces,
    /**
     * `steps` cuts each border strip into more facets, so an edge curves round rather than being chamfered; `warp`
     * reshapes the rounded block afterwards (a head's jaw drawn in, its crown domed), its pictures riding along.
     */
    options: { readonly steps?: number; readonly warp?: (c: V3) => V3 } = {},
  ): void {
    const steps = options.steps ?? 1;
    const warp = options.warp ?? ((c: V3) => c);
    const lo = new THREE.Vector3(x0 + r, y0 + r, z0 + r);
    const hi = new THREE.Vector3(x1 - r, y1 - r, z1 - r);
    const round = (c: V3): V3 => {
      const p = new THREE.Vector3(...c);
      const inner = p.clone().clamp(lo, hi);
      const d = p.clone().sub(inner);
      if (d.lengthSq() < 1e-12) return warp(c);
      inner.addScaledVector(d.normalize(), r);
      return warp([inner.x, inner.y, inner.z]);
    };
    // Each face as a grid of cells: its middle, and its border strips (r wide) cut into `steps` facets each; corners
    // counter-clockwise from the bottom left.
    const cuts = (size: number) => {
      const out = [0];
      for (let k = 1; k <= steps; k++) out.push((r * k) / steps / size);
      for (let k = steps; k >= 0; k--) out.push(1 - (r * k) / steps / size);
      return out;
    };
    const grid = (face: Face | undefined, corner: (s: number, t: number) => V3, width: number, height: number) => {
      if (!face) return;
      const ss = cuts(width);
      const ts = cuts(height);
      const [u0, v0, u1, v1] = face.fit ?? [0, 0, 1, 1];
      for (let j = 0; j < ts.length - 1; j++) {
        for (let i = 0; i < ss.length - 1; i++) {
          const quad: [number, number][] = [
            [ss[i]!, ts[j]!],
            [ss[i + 1]!, ts[j]!],
            [ss[i + 1]!, ts[j + 1]!],
            [ss[i]!, ts[j + 1]!],
          ];
          this.polygon(
            face.mat,
            quad.map(([s, t]) => round(corner(s, t))),
            quad.map(([s, t]) => [u0 + (u1 - u0) * s, v0 + (v1 - v0) * t] as [number, number]),
          );
        }
      }
    };
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    grid(faces.south, (s, t) => [lerp(x0, x1, s), lerp(y0, y1, t), z1], w, h);
    grid(faces.north, (s, t) => [lerp(x1, x0, s), lerp(y0, y1, t), z0], w, h);
    grid(faces.east, (s, t) => [x1, lerp(y0, y1, t), lerp(z1, z0, s)], d, h);
    grid(faces.west, (s, t) => [x0, lerp(y0, y1, t), lerp(z0, z1, s)], d, h);
    grid(faces.top, (s, t) => [lerp(x0, x1, s), y1, lerp(z1, z0, t)], w, d);
    grid(faces.bottom, (s, t) => [lerp(x0, x1, s), y0, lerp(z0, z1, t)], w, d);
  }

  /**
   * A gable roof over x0..x1 and z0..z1, ridge running east-west at height `rise` above `y`; the slopes take `roof`
   * tiled at a density that keeps its rows one pixel each in the three-quarter view, the gable ends `gable`.
   */
  gableRoof(x0: number, z0: number, x1: number, z1: number, y: number, rise: number, roof: Material, gable: Face, eaveDrop = 0): void {
    const zm = (z0 + z1) / 2;
    const run = (z1 - z0) / 2;
    const slope = Math.hypot(run, rise);
    // Rows along the slope at the density they are shown with from the three-quarter camera.
    const density = (TEXELS * (run + rise)) / slope;
    const along = (c: V3) => {
      const fromEave = c[2] >= zm ? (z1 - c[2]) / run : (c[2] - z0) / run;
      return fromEave * slope;
    };
    const face: Face = { mat: roof, density };
    const yl = y - eaveDrop;
    this.quad(
      face,
      [
        [x0, yl, z1],
        [x1, yl, z1],
        [x1, y + rise, zm],
        [x0, y + rise, zm],
      ],
      (c) => c[0],
      along,
    );
    this.quad(
      face,
      [
        [x1, yl, z0],
        [x0, yl, z0],
        [x0, y + rise, zm],
        [x1, y + rise, zm],
      ],
      (c) => -c[0],
      along,
    );
    // The gable ends, inset a little under the eaves.
    const inset = 0.0;
    for (const [x, sign] of [
      [x1 - inset, 1],
      [x0 + inset, -1],
    ] as const) {
      const tri: V3[] = sign > 0 ? [[x, y, z1 - 0.12], [x, y, z0 + 0.12], [x, y + rise - 0.1, zm]] : [[x, y, z0 + 0.12], [x, y, z1 - 0.12], [x, y + rise - 0.1, zm]];
      if (gable.fit) {
        const [u0, v0, u1, v1] = gable.fit;
        this.polygon(gable.mat, tri, [
          [u0, v0],
          [u1, v0],
          [(u0 + u1) / 2, v1],
        ]);
      } else {
        const image = gable.mat.map?.image as { width: number; height: number } | undefined;
        const w = (image?.width ?? TEXELS) / TEXELS;
        const h = (image?.height ?? TEXELS) / TEXELS;
        this.polygon(
          gable.mat,
          tri,
          tri.map((c) => [(sign > 0 ? -c[2] : c[2]) / w, c[1] / h] as [number, number]),
        );
      }
    }
  }

  /**
   * An upright cylinder of `segments` sides from y0 to y1 (a barrel's bulge with `bulge`), its side fitted with a map
   * once round (or `wraps` times), smooth-shaded; with a top face fitted (a lid).
   */
  cylinder(cx: number, cz: number, y0: number, y1: number, r: number, segments: number, side: Face, top?: Face, bulge = 0, rings = 1, wraps = 1): void {
    // A tiled side is laid on at the world's density: round the circumference and up the height.
    let [u0, v0, u1, v1] = side.fit ?? [0, 0, 1, 1];
    if (!side.fit) {
      const image = side.mat.map?.image as { width: number; height: number } | undefined;
      const tw = (image?.width ?? TEXELS) / TEXELS;
      const th = (image?.height ?? TEXELS) / TEXELS;
      const around = Math.round((2 * Math.PI * r) / tw) || 1;
      [u0, v0, u1, v1] = [0, y0 / th, around / wraps, y1 / th];
    }
    const radius = (t: number) => r * (1 + bulge * Math.sin(Math.PI * t));
    const ring = (t: number) => y0 + (y1 - y0) * t;
    for (let k = 0; k < rings; k++) {
      const ta = k / rings;
      const tb = (k + 1) / rings;
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const pt = (a: number, t: number): V3 => [cx + Math.sin(a) * radius(t), ring(t), cz + Math.cos(a) * radius(t)];
        const nm = (a: number, t: number): V3 => {
          const slope = bulge * r * Math.PI * Math.cos(Math.PI * t) / (y1 - y0);
          const n = new THREE.Vector3(Math.sin(a), -slope, Math.cos(a)).normalize();
          return [n.x, n.y, n.z];
        };
        const uA = u0 + ((u1 - u0) * wraps * i) / segments;
        const uB = u0 + ((u1 - u0) * wraps * (i + 1)) / segments;
        const vA = v0 + (v1 - v0) * ta;
        const vB = v0 + (v1 - v0) * tb;
        this.polygon(
          side.mat,
          [pt(a0, ta), pt(a1, ta), pt(a1, tb), pt(a0, tb)],
          [
            [uA, vA],
            [uB, vA],
            [uB, vB],
            [uA, vB],
          ],
          [nm(a0, ta), nm(a1, ta), nm(a1, tb), nm(a0, tb)],
        );
      }
    }
    if (top) {
      const [tu0, tv0, tu1, tv1] = top.fit ?? [0, 0, 1, 1];
      const rt = radius(1);
      const corners: V3[] = [];
      const uvs: [number, number][] = [];
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        corners.push([cx + Math.sin(a) * rt, y1, cz + Math.cos(a) * rt]);
        uvs.push([tu0 + ((Math.sin(a) + 1) / 2) * (tu1 - tu0), tv0 + ((1 - Math.cos(a)) / 2) * (tv1 - tv0)]);
      }
      this.polygon(top.mat, corners, uvs, corners.map(() => [0, 1, 0] as V3));
    }
  }

  /** A flat ring facing up at height y, between radii r0 and r1, tiled by its material from the world grid. */
  ring(cx: number, cz: number, y: number, r0: number, r1: number, segments: number, mat: Material): void {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p = (a: number, r: number): V3 => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
      this.quad({ mat }, [p(a0, r1), p(a1, r1), p(a1, r0), p(a0, r0)], (c) => c[0], (c) => -c[2]);
    }
  }

  /**
   * A rounded blob - a tree's crown, a bush, a pot's belly - as a low sphere squashed to (rx, ry, rz), smooth-shaded,
   * its tiled texture laid on as the three-quarter camera sees it so its texels are not stretched.
   */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, mat: Material, offset: readonly [number, number] = [0, 0], detail = 2): void {
    const { pos, index } = unitSphere(detail);
    const image = mat.map?.image as { width: number; height: number } | undefined;
    const w = (image?.width ?? TEXELS) / TEXELS;
    const h = (image?.height ?? TEXELS) / TEXELS;
    const tris = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < tris; t++) {
      const corners: V3[] = [];
      const normals: V3[] = [];
      const uvs: [number, number][] = [];
      for (let k = 0; k < 3; k++) {
        const i = index ? index.getX(t * 3 + k) : t * 3 + k;
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const c: V3 = [cx + x * rx, cy + y * ry, cz + z * rz];
        corners.push(c);
        const n = new THREE.Vector3(x / rx, y / ry, z / rz).normalize();
        normals.push([n.x, n.y, n.z]);
        const p = new THREE.Vector3(...c).applyMatrix4(this.matrix);
        uvs.push([(p.x + offset[0] / TEXELS) / w, (p.y - p.z + offset[1] / TEXELS) / h]);
      }
      this.polygon(mat, corners, uvs, normals);
    }
  }

  /** A flat quad lying on the ground (a rug, a shadow, a decal), fitted with its picture, north up. */
  decal(face: Face, x0: number, z0: number, x1: number, z1: number, y = 0.003): void {
    this.quad(
      face,
      [
        [x0, y, z1],
        [x1, y, z1],
        [x1, y, z0],
        [x0, y, z0],
      ],
      (c) => c[0],
      (c) => -c[2],
    );
  }

  /** An upright card facing south (+z) in the builder's frame: a banner, a sign, a window's glass. */
  card(face: Face, x0: number, y0: number, x1: number, y1: number, z: number): void {
    this.quad(
      face,
      [
        [x0, y0, z],
        [x1, y0, z],
        [x1, y1, z],
        [x0, y1, z],
      ],
      (c) => c[0],
      (c) => c[1],
    );
  }

  /** Appends a model's geometry, as though it had been drawn here (the builder's transform does not apply). */
  add(model: Model): void {
    for (const part of model.parts) {
      const b = this.buffers(part.material);
      const base = b.positions.length / 3;
      for (const v of part.positions) b.positions.push(v);
      for (const v of part.normals) b.normals.push(v);
      for (const v of part.uvs) b.uvs.push(v);
      for (const i of part.indices) b.indices.push(base + i);
    }
  }

  /** The gathered faces as a model, and the builder emptied for the next. */
  model(): Model {
    const parts: ModelPart[] = [];
    for (const [material, b] of this.byMaterial) parts.push({ material, ...b });
    this.byMaterial.clear();
    return { parts };
  }

  /** The gathered faces as meshes, one per material, casting and taking shadows. */
  build(name = "built", shadows = true): THREE.Group {
    return meshesOf(this.model(), name, shadows);
  }
}
