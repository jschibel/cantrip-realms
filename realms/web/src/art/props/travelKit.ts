import * as THREE from "three";
import { TEXELS } from "../../render/lighting";
import type { Material, MeshBuilder } from "../paint/builder";
import { seeded } from "../paint/pixmap";

// The shapes the travel map's miniatures are made of (travel.ts, travelTowns.ts, travelLandmarks.ts): faceted cones
// with a material per facet (a mountain's rock, its snow above a line), plain cones without an underside (a pine's
// tier, a tower's roof), and the camera-laid texturing that keeps a facet's texels the world's size.

export type V3 = [number, number, number];
export const TAU = Math.PI * 2;

/** UVs laid on as the three-quarter camera sees a point (as kit's `lump` does), so a facet's texels keep their size. */
export function camUv(b: MeshBuilder, mat: Material): (c: V3) => [number, number] {
  const image = mat.map?.image as { width: number; height: number } | undefined;
  const w = (image?.width ?? TEXELS) / TEXELS;
  const h = (image?.height ?? TEXELS) / TEXELS;
  const v = new THREE.Vector3();
  return (c) => {
    v.set(c[0], c[1], c[2]).applyMatrix4(b.matrix);
    return [v.x / w, (v.y - v.z) / h];
  };
}

/** One flat-shaded polygon, counter-clockwise seen from its front, its texture laid on as the camera sees it. */
export function facet(b: MeshBuilder, mat: Material, ...corners: V3[]): void {
  const uv = camUv(b, mat);
  b.polygon(mat, corners, corners.map(uv));
}

/**
 * An upright cone of `segments` sides from y0 to its point at y1, smooth-shaded, with no underside (the camera looks down
 * on everything): a pine's tier, a tower's roof, a spire.
 */
export function spike(b: MeshBuilder, x: number, z: number, y0: number, y1: number, r: number, segments: number, mat: Material, twist = 0): void {
  const uv = camUv(b, mat);
  const slope = r / Math.max(1e-6, y1 - y0);
  const n = (a: number): V3 => {
    const v = new THREE.Vector3(Math.sin(a), slope, Math.cos(a)).normalize();
    return [v.x, v.y, v.z];
  };
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * TAU + twist;
    const a1 = ((i + 1) / segments) * TAU + twist;
    const p: V3[] = [
      [x + Math.sin(a0) * r, y0, z + Math.cos(a0) * r],
      [x + Math.sin(a1) * r, y0, z + Math.cos(a1) * r],
      [x, y1, z],
    ];
    b.polygon(mat, p, p.map(uv), [n(a0), n(a1), n((a0 + a1) / 2)]);
  }
}

/** A massif or a summit: a faceted cone through `profile` ([u, f]: at u of its height, f of its foot's radius). */
export interface Cone {
  readonly x: number;
  readonly z: number;
  /** Its radius at the ground. */
  readonly r: number;
  /** Its summit's height. */
  readonly top: number;
  /** Where its foot starts: below the ground, so it meets lower ground beside it without a gap. */
  readonly bottom: number;
  readonly profile: readonly (readonly [number, number])[];
  readonly segments: number;
  readonly seed: number;
  /** How far each vertex is pushed in or out, a share of its ring's radius. */
  readonly jitter: number;
  /** Stretched along `dir` (radians) by `by` of its radius, squeezed across it: a ridge's line. */
  readonly stretch?: { readonly dir: number; readonly by: number };
  /** Its summit pushed off its axis by this much (world units), less so lower down. */
  readonly lean?: readonly [number, number];
  /** Rings' heights jittered by this share of its height (0.08). */
  readonly wobble?: number;
}

/**
 * Draws a cone's facets, each in the material `paint` picks for its middle's height, how much it faces up and its
 * index; returns its top ring (a crater's rim, when the profile ends open).
 */
export function cone(b: MeshBuilder, c: Cone, paint: (y: number, rise: number, k: number) => Material): V3[] {
  const random = seeded(c.seed * 7919 + 13);
  const twist = random() * TAU;
  const f0 = c.profile[0]![1];
  const rings: [number, number][] = [[c.bottom / c.top, f0 * (1 - (c.bottom / c.top) * 0.25)], ...c.profile.map(([u, f]) => [u, f] as [number, number])];
  const wobble = c.wobble ?? 0.08;
  const pts: V3[][] = rings.map(([u, f], j) => {
    const middle = j > 1 && j < rings.length - 1;
    const y = u * c.top + (middle ? (random() - 0.5) * wobble * c.top : 0);
    const tw = twist + (random() - 0.5) * (Math.PI / c.segments) * 0.8;
    const rise = Math.max(0, u) ** 1.5;
    const lx = (c.lean?.[0] ?? 0) * rise;
    const lz = (c.lean?.[1] ?? 0) * rise;
    if (f === 0) return Array.from({ length: c.segments }, () => [c.x + lx, y, c.z + lz] as V3);
    return Array.from({ length: c.segments }, (_, i) => {
      const a = (i / c.segments) * TAU + tw;
      const s = c.stretch ? 1 + c.stretch.by * Math.cos(2 * (a - c.stretch.dir)) : 1;
      const k = f * c.r * s * (1 + (random() * 2 - 1) * c.jitter * (j === 0 ? 0.4 : 1));
      return [c.x + lx + Math.sin(a) * k, y, c.z + lz + Math.cos(a) * k] as V3;
    });
  });
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const tri = (a: V3, d: V3, e: V3, k: number) => {
    e1.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    e2.set(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
    const n = e1.cross(e2).normalize();
    facet(b, paint((a[1] + d[1] + e[1]) / 3, n.y, k), a, d, e);
  };
  for (let j = 0; j + 1 < pts.length; j++) {
    const apex = rings[j + 1]![1] === 0;
    for (let i = 0; i < c.segments; i++) {
      const i1 = (i + 1) % c.segments;
      const k = j * c.segments + i;
      tri(pts[j]![i]!, pts[j]![i1]!, pts[j + 1]![i1]!, k);
      if (!apex) tri(pts[j]![i]!, pts[j + 1]![i1]!, pts[j + 1]![i]!, k + 1000);
    }
  }
  return pts[pts.length - 1]!;
}
