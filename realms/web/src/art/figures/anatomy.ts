import type { Ramp } from "../paint/palette";
import { Pixmap, type Rgb } from "../paint/pixmap";
import { cloth, layer, rows } from "./faces";
import { type V3, feathers, flipX, part, pointUp, solid } from "./paints";
import { at, full } from "./ramps";
import type { Motion, Paint, PartFaces, PartSpec } from "./rig";

// Parts creatures share: wings (feathered, bat-skinned, an insect's), a tail or a body of segments, and a quadruped's
// four legs - each sized by the caller in whole texels and painted from its ramps.

export type WingKind = "feather" | "bat" | "insect";

export interface WingSpec {
  readonly kind: WingKind;
  readonly ramp: Ramp;
  /** A second color: a feather's tips, a bat wing's bones. */
  readonly trim?: Ramp;
  /** Out from the body and top to bottom, texels. */
  readonly span: number;
  readonly height: number;
  readonly parent: string;
  /** Where the wings join, on the parent: x is half the gap between them. */
  readonly at: V3;
  /** How high they are held (radians up from level). */
  readonly raise?: number;
  /** Two segments, the outer one beating after the inner (a dragon's). */
  readonly jointed?: boolean;
}

/** The shape of a wing seen flat, its root at x = 0: rising to its tip, its lower edge in feathers or webs. */
function wingShape(kind: WingKind, x: number, y: number, w: number, h: number): boolean {
  const t = x / Math.max(1, w - 1);
  const top = Math.round(h * 0.3 * (1 - t) * (kind === "insect" ? 0.2 : 1));
  if (y < top) return false;
  if (kind === "insect") {
    const mid = h / 2;
    return Math.abs(y - mid) <= (h / 2) * Math.sqrt(Math.max(0, 1 - (t - 0.45) * (t - 0.45) * 3.2));
  }
  let bottom = h - 1 - Math.round(t * t * h * 0.55);
  if (kind === "feather") bottom -= x % 3 === 2 ? 1 : 0;
  else {
    // A bat's web: scalloped up between the fingers.
    const finger = w / 4;
    const k = (x % finger) / finger;
    bottom -= Math.round(Math.sin(k * Math.PI) * Math.min(4, h * 0.18));
  }
  return y <= bottom;
}

function wingPaint(spec: WingSpec, w: number, h: number): Paint {
  const r = full(spec.ramp);
  const trim = full(spec.trim ?? spec.ramp);
  const shape = (p: Parameters<Paint>[0]) => {
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (!wingShape(spec.kind, x, y, w, h)) p.put(x, y, 0, 0);
  };
  switch (spec.kind) {
    case "feather":
      return layer(feathers(r, 3, false), (p) => {
        // The coverts along the top, light; the long flight feathers below tipped in the trim.
        for (let x = 0; x < p.width; x++) {
          const t = x / Math.max(1, w - 1);
          const top = Math.round(h * 0.3 * (1 - t));
          p.put(x, top, at(r, 5));
          p.put(x, top + 1, at(r, 4));
          for (let y = top + Math.round(h * 0.5); y < p.height; y++) if (x % 3 !== 0) p.put(x, y, at(trim, y > p.height - 4 ? 2 : 3));
        }
      }, shape);
    case "bat":
      return layer(cloth(r, 3), (p) => {
        const finger = w / 4;
        for (let x = 0; x < p.width; x++) {
          const t = x / Math.max(1, w - 1);
          const top = Math.round(h * 0.3 * (1 - t));
          p.put(x, top, at(trim, 4));
          if (Math.floor(x % finger) === 0) for (let y = top; y < p.height; y++) p.put(x, y, at(trim, 2));
          for (let y = top + 1; y < p.height; y++) if ((x + y) % 7 === 0) p.put(x, y, at(r, 2));
        }
      }, shape);
    case "insect":
      return layer(cloth(r, 5), (p) => {
        for (let x = 0; x < p.width; x++) for (let y = 0; y < p.height; y++) if (x % 4 === 0 || y % 4 === 0) p.put(x, y, at(trim, 3));
      }, shape);
  }
}

/** A pair of wings, `wing.l` and `wing.r` (and their outer halves when jointed), beating as the figure moves. */
export function wings(spec: WingSpec): PartSpec[] {
  const out: PartSpec[] = [];
  const raise = spec.raise ?? 0.3;
  const split = spec.jointed ? Math.round(spec.span * 0.45) : spec.span;
  const [ax, ay, az] = spec.at;
  for (const side of [1, -1] as const) {
    const name = side > 0 ? "wing.l" : "wing.r";
    const w = split;
    const h = spec.height;
    const fullPaint = wingPaint(spec, spec.span, h);
    // The inner part shows the root of the whole wing's picture; the outer the rest.
    const inner: Paint = (p) => {
      const big = new Pixmap(spec.span, h);
      big.fill(0, 0);
      fullPaint(big);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.set(x, y, big.get(x, y), big.alpha(x, y));
    };
    const outer: Paint = (p) => {
      const big = new Pixmap(spec.span, h);
      big.fill(0, 0);
      fullPaint(big);
      for (let y = 0; y < h; y++) for (let x = 0; x < spec.span - w; x++) p.set(x, y, big.get(x + w, y), big.alpha(x + w, y));
    };
    const faces = (paint: Paint): PartFaces => (side > 0 ? { front: paint, back: flipX(paint), top: cloth(full(spec.ramp), 4, false) } : { front: flipX(paint), back: paint, top: cloth(full(spec.ramp), 4, false) });
    const motion: Motion = { kind: "wing", side, amount: 1 };
    const top = Math.round(h * 0.35);
    out.push(part(name, [w, h, 1], [side * ax, ay, az], side > 0 ? [0, -h + top, -0.5] : [-w, -h + top, -0.5], faces(inner), at(full(spec.ramp), 3), { parent: spec.parent, tilt: [0, side * raise], motion, round: 0 }));
    if (spec.jointed) {
      const ow = spec.span - w;
      out.push(part(`${name}.tip`, [ow, h, 1], [side * w, 0, 0], side > 0 ? [0, -h + top, -0.5] : [-ow, -h + top, -0.5], faces(outer), at(full(spec.ramp), 3), { parent: name, tilt: [0, side * 0.25], motion: { kind: "wing", side, amount: 0.7 }, round: 0 }));
    }
  }
  return out;
}

/**
 * A chain of segments, each hung on the one before and swaying after it: a tail, a serpent's or a wurm's body, a
 * djinn's smoke. Segments go back (−z) from `at` on `parent`, shrinking from `first` to `last` (sizes [w, h, d]).
 */
export function chain(o: {
  readonly name: string;
  readonly parent: string;
  readonly at: V3;
  readonly count: number;
  readonly first: V3;
  readonly last: V3;
  readonly faces: (i: number, size: V3) => PartFaces;
  readonly fill: Rgb;
  /** Radians each segment bends down from the one before (negative: up, a cat's tail, a scorpion's). */
  readonly droop?: number;
  readonly sway?: number;
  /** Down (y) instead of back (z): a hanging tail of smoke. */
  readonly down?: boolean;
  readonly axis?: "x" | "y" | "z";
  readonly rate?: number;
  readonly round?: number;
}): PartSpec[] {
  const out: PartSpec[] = [];
  let parent = o.parent;
  let pivot: V3 = o.at;
  for (let i = 0; i < o.count; i++) {
    const t = o.count === 1 ? 0 : i / (o.count - 1);
    const size: V3 = [Math.max(1, Math.round(o.first[0] + (o.last[0] - o.first[0]) * t)), Math.max(1, Math.round(o.first[1] + (o.last[1] - o.first[1]) * t)), Math.max(1, Math.round(o.first[2] + (o.last[2] - o.first[2]) * t))];
    const name = `${o.name}.${i}`;
    const box: V3 = o.down ? [-size[0] / 2, -size[1], -size[2] / 2] : [-size[0] / 2, -size[1] / 2, -size[2]];
    out.push(part(name, size, pivot, box, o.faces(i, size), o.fill, { parent, tilt: [-(o.droop ?? 0), 0], motion: { kind: "tail", delay: (i + 1) * 0.6, amount: o.sway ?? 0.22, axis: o.axis ?? "y", rate: o.rate }, round: o.round ?? Math.min(2, Math.floor(Math.min(size[0], size[1], size[2]) / 3)) }));
    parent = name;
    pivot = o.down ? [0, -size[1] + 0.5, 0] : [0, 0, -size[2] + 0.5];
  }
  return out;
}

/**
 * A quadruped's legs, `leg.fl`, `leg.fr`, `leg.bl`, `leg.br`, under a body `body` [w, h, d] standing `height` texels
 * up: diagonal pairs in step, the front ones lifting when it rears. `faces` paints a leg; `paws` a hoof or paw block.
 */
export function legs4(o: { readonly body: V3; readonly leg: V3; readonly faces: PartFaces; readonly fill: Rgb; readonly inset?: number; readonly paws?: { readonly ramp: Ramp; readonly height?: number } }): PartSpec[] {
  const [bw, , bd] = o.body;
  const [lw, lh, ld] = o.leg;
  const inset = o.inset ?? 1;
  const out: PartSpec[] = [];
  const spots: [string, number, number, number, boolean][] = [
    ["leg.fl", bw / 2 - lw / 2 - inset * 0.5, bd / 2 - ld / 2 - inset, 0, true],
    ["leg.fr", -bw / 2 + lw / 2 + inset * 0.5, bd / 2 - ld / 2 - inset, Math.PI, true],
    ["leg.bl", bw / 2 - lw / 2 - inset * 0.5, -bd / 2 + ld / 2 + inset, Math.PI, false],
    ["leg.br", -bw / 2 + lw / 2 + inset * 0.5, -bd / 2 + ld / 2 + inset, 0, false],
  ];
  for (const [name, x, z, phase, front] of spots) {
    out.push(part(name, o.leg, [x, lh, z], [-lw / 2, -lh, -ld / 2], o.faces, o.fill, { motion: { kind: "leg", phase, amount: 0.55, front } }));
    if (o.paws) {
      const ph = o.paws.height ?? 1;
      out.push(part(`${name}.paw`, [lw + 1, ph, ld + 1], [0, -lh, 0.5], [-(lw + 1) / 2, 0, -(ld + 1) / 2], solid(full(o.paws.ramp), 2, rows(0, 0, at(full(o.paws.ramp), 4))), at(full(o.paws.ramp), 2), { parent: name, round: 0 }));
    }
  }
  return out;
}

/** A horn: a tapering point. */
export function horn(name: string, parent: string, at3: V3, size: V3, ramp: Ramp, tilt: readonly [number, number]): PartSpec {
  const r = full(ramp);
  return part(name, size, at3, [-size[0] / 2, 0, -size[2] / 2], { front: layer(cloth(r, 5), pointUp), back: layer(cloth(r, 4), pointUp), left: layer(cloth(r, 4), pointUp), right: layer(cloth(r, 4), pointUp), top: cloth(r, 6, false) }, at(r, 5), { parent, tilt, round: 0 });
}
