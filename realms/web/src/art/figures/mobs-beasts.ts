import * as C from "../paint/colors";
import type { Ramp } from "../paint/palette";
import { type WingSpec, chain, horn, legs4, wings } from "./anatomy";
import { cloth, layer, rows } from "./faces";
import { defineMob } from "./mobs";
import { type V3, allSides, cutTo, eyes, feathers, flipX, fur, part, plates, pointUp, scales, solid, speckle } from "./paints";
import { type Person, person, scaled } from "./person";
import { at, full, rampOf } from "./ramps";
import { EMBER_EYE, type FigureSpec, GHOUL_EYE, HEAD, OIL_EYE, type Paint, type PartFaces, type PartSpec } from "./rig";

// The roster's beasts and everything that is not built like a person (mobs.ts): four-legged beasts (a baloth, a boar, a
// rat, a cat, a lhurgoyf, a pegasus, an elk with its elf rider), dragons and drakes, birds, serpents and wurms, insects.
// A four-legged beast is a body on four legs (anatomy.ts `legs4`), a head on the front of it (on a neck for the tall
// ones), a tail of segments behind; sizes are whole texels, grown by the mob's size.

const BONE = full(C.BONE);
const GOLD = full(C.GOLD);
const k = (v: number, s: number) => Math.max(1, Math.round(v * s));
const v3 = (v: V3, s: number): V3 => [k(v[0], s), k(v[1], s), k(v[2], s)];

interface Quad {
  readonly name: string;
  readonly s: number;
  readonly body: V3;
  readonly leg: V3;
  readonly head: V3;
  /** A neck between body and head: its size, and how far it leans forward (radians). */
  readonly neck?: { readonly size: V3; readonly lean: number };
  readonly coat: Paint;
  readonly belly?: Paint;
  readonly legPaint: Paint;
  readonly fill: number;
  readonly face: Paint;
  readonly headSides: Paint;
  readonly muzzle?: { readonly size: V3; readonly faces: PartFaces };
  readonly paws?: Ramp;
  readonly tail?: { readonly count: number; readonly first: V3; readonly last: V3; readonly faces: (i: number) => PartFaces; readonly droop?: number; readonly curl?: number };
  /** Aloft: hovering this many texels, its wings beating standing too. */
  readonly hover?: number;
  readonly headParts?: (w: number, h: number, d: number) => PartSpec[];
  readonly bodyParts?: (w: number, h: number, d: number) => PartSpec[];
  readonly wings?: Omit<WingSpec, "parent" | "at">;
  readonly stride?: number;
}

/** A four-legged beast. */
function quad(o: Quad): FigureSpec {
  const body = v3(o.body, o.s);
  const leg = v3(o.leg, o.s);
  const head = v3(o.head, Math.sqrt(o.s));
  const [bw, bh, bd] = body;
  const [hw, hh, hd] = head;
  const lh = leg[1];
  const parts: PartSpec[] = [];
  parts.push(part("torso", body, [0, lh, 0], [-bw / 2, 0, -bd / 2], { front: o.coat, back: o.coat, left: o.coat, right: flipX(o.coat), top: o.coat, bottom: o.belly ?? o.coat }, o.fill));
  parts.push(...legs4({ body, leg, faces: allSides(o.legPaint), fill: o.fill, paws: o.paws ? { ramp: o.paws } : undefined }));
  let headParent = "torso";
  let headAt: V3 = [0, bh * 0.42, bd / 2 - 1];
  let headTilt = 0;
  if (o.neck) {
    const neck = v3(o.neck.size, o.s);
    parts.push(part("neck", neck, [0, bh * 0.45, bd / 2 - neck[2] / 2], [-neck[0] / 2, 0, -neck[2] / 2], allSides(o.coat), o.fill, { parent: "torso", tilt: [o.neck.lean, 0] }));
    headParent = "neck";
    headAt = [0, neck[1] - 1, 0];
    headTilt = -o.neck.lean;
  }
  parts.push(part("head", head, headAt, [-hw / 2, -hh / 2, -hd / 3], { front: o.face, back: o.headSides, left: flipX(o.headSides), right: o.headSides, top: o.headSides, bottom: o.headSides }, o.fill, { parent: headParent, tilt: [headTilt, 0], round: Math.min(2, Math.floor(Math.min(hw, hh, hd) / 3)), shape: { ...HEAD, jaw: 0.05, dome: 0.05 } }));
  if (o.muzzle) {
    const m = v3(o.muzzle.size, Math.sqrt(o.s));
    parts.push(part("muzzle", m, [0, -hh / 2 + m[1] / 2, hd * (2 / 3) - 1], [-m[0] / 2, -m[1] / 2, 0], o.muzzle.faces, o.fill, { parent: "head", round: Math.min(1.5, Math.floor(Math.min(...m) / 3)) }));
  }
  if (o.headParts) parts.push(...o.headParts(hw, hh, hd));
  if (o.tail) parts.push(...chain({ name: "tail", parent: "torso", at: [0, bh * 0.7, -bd / 2 + 0.5], count: o.tail.count, first: v3(o.tail.first, o.s), last: v3(o.tail.last, o.s), faces: o.tail.faces, fill: o.fill, droop: o.tail.droop ?? 0.35, curl: o.tail.curl, sway: 0.25 }));
  if (o.bodyParts) parts.push(...o.bodyParts(bw, bh, bd));
  if (o.wings) parts.push(...wings({ ...o.wings, span: k(o.wings.span, o.s), height: k(o.wings.height, o.s), parent: "torso", at: [bw / 2 - 1, bh, bd / 4] }));
  return { name: o.name, parts, stride: o.stride ?? 0.6, armSwing: 0, lean: 0.03, footprint: Math.max(0.45, Math.max(bw, bd) / 26), hover: o.hover, flies: o.hover !== undefined, leans: 0.35 };
}

/** A face for a beast: eyes up top, a nose below. */
function beastFace(r: Ramp, w: number, h: number, eye: number = C.INK, nose = true): Paint {
  // A brow over the eyes, the eyes each with a glint of light, and a nose below.
  return layer(fur(r, 3), rows(0, 0, at(r, 5)), (p) => p.hline(1, Math.max(2, Math.floor(h / 2)) - 2, w - 2, at(r, 2)), eyes(w, Math.max(2, Math.floor(h / 2)), { color: eye, glint: true }), nose ? (p) => { const m = Math.floor(w / 2) - 1; p.put(m, h - 2, C.INK); p.put(m + 1, h - 2, C.INK); } : undefined);
}

function ears(kind: "pointed" | "round" | "long", r: Ramp, w: number, h: number, size = 1): PartSpec[] {
  const e: V3 = kind === "long" ? [2, k(5, size), 1] : kind === "round" ? [3, 3, 1] : [3, k(4, size), 1];
  const shape = kind === "round" ? cutTo((x, y, ww) => !(y === 0 && (x === 0 || x === ww - 1))) : pointUp;
  const paint: Paint = layer(cloth(r, 4), (p) => p.vline(Math.floor(p.width / 2), 1, p.height - 1, at(C.PINK, 3)), shape);
  return [
    part("ear.l", e, [w / 2 - 1.5, h / 2 - 1, -1], [-e[0] / 2, 0, -0.5], { front: paint, back: layer(cloth(r, 3), shape), left: cloth(r, 3) }, at(r, 4), { parent: "head", tilt: [0, -0.35] }),
    part("ear.r", e, [-w / 2 + 1.5, h / 2 - 1, -1], [-e[0] / 2, 0, -0.5], { front: flipX(paint), back: layer(cloth(r, 3), shape), left: cloth(r, 3) }, at(r, 4), { parent: "head", tilt: [0, 0.35] }),
  ];
}

/** Spikes down a back. */
function ridge(r: Ramp, count: number, d: number, h: number, size: number): PartSpec[] {
  const out: PartSpec[] = [];
  for (let i = 0; i < count; i++) out.push(horn(`ridge.${i}`, "torso", [0, h - 1, d / 2 - 2 - (i * (d - 3)) / Math.max(1, count - 1)], [3, k(4 + 2 * ((i + 1) % 2) + (i < count / 2 ? 2 : 0), size), 3], r, [-0.4, 0]));
  return out;
}

// --- Beasts ------------------------------------------------------------------------------------------------------

defineMob({
  id: "beast",
  scale: 1.2,
  about: "a great beast (a baloth): a bulky body on thick legs, a horned head with a jaw of tusks, spikes down its back",
  slots: ["hide", "belly", "horn"],
  palette: ["#6b963e", "#8f6340", "#f1b44c"],
  build: ([hide, belly, hornR], s) =>
    quad({
      name: "beast",
      s,
      body: [16, 11, 18],
      leg: [5, 6, 5],
      head: [11, 9, 9],
      coat: layer(scales(hide!, 3), speckle(hide!, [2, 5], 0.08)),
      belly: cloth(belly!, 3),
      legPaint: layer(scales(hide!, 2), rows(0, 0, at(hide!, 4))),
      fill: at(hide!, 3),
      face: layer(scales(hide!, 3), eyes(11, 3, { color: EMBER_EYE, size: 1 }), rows(6, 8, at(belly!, 2)), (p) => { for (let x = 1; x < 10; x += 3) p.put(x, 6, 0xf4ecd4); }),
      headSides: scales(hide!, 3),
      paws: BONE,
      headParts: (w, h) => [horn("horn.l", "head", [w / 2 - 2, h / 2 - 1, 1], [3, 8, 3], hornR!, [-0.2, -0.75]), horn("horn.r", "head", [-w / 2 + 2, h / 2 - 1, 1], [3, 8, 3], hornR!, [-0.2, 0.75]), horn("tusk.l", "head", [w / 2 - 2, -h / 2 + 1, 3], [2, 4, 2], BONE, [0.3, -0.3]), horn("tusk.r", "head", [-w / 2 + 2, -h / 2 + 1, 3], [2, 4, 2], BONE, [0.3, 0.3])],
      bodyParts: (w, h, d) => ridge(hornR!, 5, d, h, s),
      tail: { count: 3, first: [4, 4, 5], last: [2, 2, 4], faces: () => allSides(scales(hide!, 3)) },
      stride: 0.5,
    }),
});

defineMob({
  id: "boar",
  about: "a boar: a stocky bristled body, a ridge of mane, a snout and curling tusks",
  slots: ["hide", "mane", "tusk"],
  palette: ["#6e4436", "#2a1a18", "#e8e4d8"],
  build: ([hide, mane, tusk], s) =>
    quad({
      name: "boar",
      s,
      body: [12, 9, 14],
      leg: [3, 5, 3],
      head: [10, 8, 8],
      coat: fur(hide!, 3),
      legPaint: fur(hide!, 2),
      fill: at(hide!, 3),
      face: beastFace(hide!, 9, 8, C.INK, false),
      headSides: fur(hide!, 3),
      muzzle: { size: [6, 5, 4], faces: { front: layer(cloth(rampOf("#d88a8a"), 3), rows(0, 0, at(rampOf("#d88a8a"), 4)), (p) => { p.box(1, 2, 1, 2, C.INK); p.box(4, 2, 1, 2, C.INK); }), left: fur(hide!, 3), top: fur(hide!, 4) } },
      paws: rampOf("#2a2024"),
      headParts: (w, h, d) => [...ears("pointed", hide!, w, h), horn("tusk.l", "muzzle", [2, 0, 2], [2, 5, 2], tusk!, [0.35, -0.45]), horn("tusk.r", "muzzle", [-2, 0, 2], [2, 5, 2], tusk!, [0.35, 0.45]), horn("bristle.0", "head", [0, h / 2 - 1, 0], [2, 4, 2], mane!, [-0.5, 0])],
      bodyParts: (w, h, d) => [part("mane", [3, 3, d - 2], [0, h - 1, 0], [-1.5, 0, -(d - 2) / 2], { left: layer(fur(mane!, 3), (p) => { for (let x = 0; x < p.width; x += 2) p.put(x, 0, 0, 0); }), right: layer(fur(mane!, 3), (p) => { for (let x = 0; x < p.width; x += 2) p.put(x, 0, 0, 0); }), front: fur(mane!, 3), top: fur(mane!, 4) }, at(mane!, 3), { parent: "torso" })],
      tail: { count: 3, first: [1, 1, 2], last: [1, 1, 2], faces: () => solid(hide!, 3), droop: -0.4, curl: 0.9 },
      stride: 0.75,
    }),
});

defineMob({
  id: "rat",
  about: "a giant rat: hunched grey fur, round ears, a pointed pink snout, a long bare tail",
  slots: ["fur", "skin", "eyes"],
  palette: ["#5a5468", "#e8789a", "#c8343a"],
  build: ([furR, skin, eye], s) =>
    quad({
      name: "rat",
      s,
      body: [8, 7, 13],
      leg: [2, 3, 3],
      head: [7, 6, 7],
      coat: fur(furR!, 3),
      legPaint: cloth(skin!, 3),
      fill: at(furR!, 3),
      face: beastFace(furR!, 7, 6, at(eye!, 5), false),
      headSides: fur(furR!, 3),
      muzzle: { size: [4, 3, 5], faces: { front: layer(cloth(furR!, 4), (p) => { p.put(1, 0, at(skin!, 4)); p.put(2, 0, at(skin!, 4)); p.put(0, 2, 0xf4ecd4); p.put(3, 2, 0xf4ecd4); p.put(1, 2, 0xf4ecd4); p.put(2, 2, 0xf4ecd4); }), left: layer(fur(furR!, 3), (p) => { p.put(4, 0, at(skin!, 4)); p.put(3, 2, 0xf4ecd4); }), top: fur(furR!, 4) } },
      headParts: (w, h) => [...ears("round", skin!, w + 2, h + 2), part("tooth", [2, 2, 1], [0, -2, 6], [-1, -1, 0], { front: cloth(rampOf("#f4ecd4"), 4) }, 0xf4ecd4, { parent: "muzzle", round: 0 })],
      tail: { count: 7, first: [1, 1, 3], last: [1, 1, 3], faces: () => solid(skin!, 3), droop: -0.06, curl: 0.32 },
      stride: 0.8,
    }),
});

defineMob({
  id: "cat",
  about: "a great cat: a lithe body, pointed ears, a striped coat, a long curling tail",
  slots: ["coat", "stripes", "eyes"],
  palette: ["#e0a02c", "#3a2018", "#6cb84a"],
  build: ([coat, stripes, eye], s) => {
    const striped: Paint = layer(fur(coat!, 3), (p) => { for (let x = 1; x < p.width; x += 3) for (let y = 0; y < p.height - 1; y++) if ((y + x) % 5 < 2) p.put(x, y, at(stripes!, 3)); });
    return quad({
      name: "cat",
      s,
      body: [8, 7, 15],
      leg: [3, 6, 3],
      head: [9, 8, 7],
      coat: striped,
      belly: cloth(rampOf("#f4ecd4"), 3),
      legPaint: striped,
      fill: at(coat!, 3),
      face: layer(beastFace(coat!, 9, 8, at(eye!, 5)), (p) => { p.put(3, 6, 0xf4ecd4); p.put(5, 6, 0xf4ecd4); p.vline(4, 0, 2, at(stripes!, 3)); }),
      headSides: striped,
      muzzle: { size: [5, 3, 2], faces: { front: layer(cloth(rampOf("#f4ecd4"), 3), (p) => p.put(2, 0, at(C.PINK, 3))), top: fur(coat!, 4), left: fur(coat!, 3) } },
      headParts: (w, h) => ears("pointed", coat!, w, h),
      tail: { count: 5, first: [2, 2, 3], last: [2, 2, 3], faces: (i) => solid(i % 2 ? stripes! : coat!, 3), droop: -0.25 },
      stride: 0.8,
    });
  },
});

defineMob({
  id: "lhurgoyf",
  scale: 1.15,
  about: "a lhurgoyf: a hunched reptile beast, a heavy head of jaws, a spiky mane down its back, a thick tail",
  slots: ["hide", "mane", "belly"],
  palette: ["#5d6646", "#8f6340", "#d6ae7e"],
  build: ([hide, mane, belly], s) =>
    quad({
      name: "lhurgoyf",
      s,
      body: [13, 11, 15],
      leg: [4, 5, 4],
      head: [10, 8, 10],
      coat: scales(hide!, 3),
      belly: cloth(belly!, 3),
      legPaint: scales(hide!, 2),
      fill: at(hide!, 3),
      face: layer(scales(hide!, 3), eyes(10, 3, { color: GHOUL_EYE, size: 1 }), (p) => { p.box(1, 5, 8, 3, at(hide!, 0)); for (let x = 1; x < 9; x += 2) { p.put(x, 5, 0xf4ecd4); p.put(x + 1, 7, 0xf4ecd4); } }),
      headSides: scales(hide!, 3),
      paws: BONE,
      headParts: (w, h) => [horn("crest.0", "head", [0, h / 2 - 1, 0], [3, 6, 3], mane!, [-0.6, 0]), horn("crest.1", "head", [2.5, h / 2 - 1, -1], [2, 5, 2], mane!, [-0.6, -0.4]), horn("crest.2", "head", [-2.5, h / 2 - 1, -1], [2, 5, 2], mane!, [-0.6, 0.4])],
      bodyParts: (w, h, d) => ridge(mane!, 7, d, h, s),
      tail: { count: 4, first: [5, 5, 4], last: [2, 2, 4], faces: () => allSides(scales(hide!, 3)), droop: 0.3, curl: 0.2 },
      stride: 0.55,
    }),
});

defineMob({
  id: "pegasus",
  scale: 1.1,
  about: "a pegasus: a white horse with feathered wings, a mane and a flowing tail",
  slots: ["coat", "mane", "wings"],
  palette: ["#f2efe6", "#93c8dc", "#e8e4d8"],
  build: ([coat, mane, wingR], s) => horse("pegasus", coat!, mane!, s, { kind: "feather", ramp: wingR!, trim: rampOf(at(mane!, 4)), span: 18, height: 16, raise: 0.75, jointed: true }),
});

defineMob({
  id: "horse",
  scale: 1.1,
  about: "a horse: a long body on long legs, a maned neck and head, a flowing tail",
  slots: ["coat", "mane", "tack"],
  palette: ["#7c4630", "#24141c", "#c8343a"],
  build: ([coat, mane], s) => horse("horse", coat!, mane!, s),
});

function horse(name: string, coat: Ramp, mane: Ramp, s: number, wing?: Omit<WingSpec, "parent" | "at">, antlers?: Ramp): FigureSpec {
  const maneParts = (w: number, h: number, d: number): PartSpec[] => [part("forelock", [w - 2, 2, 2], [0, h / 2, d / 3], [-(w - 2) / 2, -1, -1], solid(mane, 3), at(mane, 3), { parent: "head" })];
  return quad({
    name,
    s,
    body: [9, 9, 17],
    leg: [3, 9, 3],
    head: [7, 8, 9],
    neck: { size: [5, 9, 6], lean: -0.55 },
    coat: fur(coat, 3),
    legPaint: layer(fur(coat, 3), rows(6, 8, at(coat, 2))),
    fill: at(coat, 3),
    face: layer(fur(coat, 3), eyes(7, 3, { size: 1 }), rows(6, 7, at(coat, 2)), (p) => { p.put(2, 6, C.INK); p.put(4, 6, C.INK); }),
    headSides: layer(fur(coat, 3), (p) => p.put(2, 2, C.INK)),
    paws: rampOf("#3a2a28"),
    headParts: (w, h, d) => [...ears("pointed", coat, w, h, 0.8), ...maneParts(w, h, d), ...(antlers ? [horn("antler.l", "head", [w / 2 - 1, h / 2, 0], [1, 7, 1], antlers, [-0.3, -0.7]), horn("antler.r", "head", [-w / 2 + 1, h / 2, 0], [1, 7, 1], antlers, [-0.3, 0.7]), horn("antler.l2", "antler.l", [0, 4, 0], [1, 4, 1], antlers, [0.4, 0.8]), horn("antler.r2", "antler.r", [0, 4, 0], [1, 4, 1], antlers, [0.4, -0.8])] : [])],
    bodyParts: () => [part("mane", [2, 9, 3], [0, 8, -1.5], [-1, 0, -1.5], { left: fur(mane, 3), right: fur(mane, 3), front: fur(mane, 3), back: fur(mane, 3), top: fur(mane, 4) }, at(mane, 3), { parent: "neck", round: 0.5 })],
    tail: { count: 3, first: [3, 3, 4], last: [2, 2, 4], faces: () => allSides(fur(mane, 3)), droop: 0.9 },
    wings: wing,
    stride: 0.6,
  });
}

defineMob({
  id: "elk-rider",
  scale: 1.1,
  about: "elven riders: an elf with a spear astride an antlered elk",
  slots: ["coat", "cloak", "elk"],
  palette: ["#4f7a34", "#2a4524", "#8f6340"],
  build: ([coatR, cloak, elk], s) => {
    const mount = horse("elk", elk!, rampOf(at(elk!, 1)), s, undefined, full(C.BONE));
    const rider: Person = {
      name: "rider",
      build: scaled({ head: [11, 10, 10], torso: [9, 8, 5], arm: [3, 8, 3], leg: [3, 6, 3] }, Math.sqrt(s)),
      skin: rampOf("#e0aa7a", 4),
      ears: "long",
      hair: { ramp: rampOf("#4a2e1a"), style: "long" },
      top: { style: "leather", ramp: coatR!, trim: cloak! },
      cape: { ramp: cloak!, ragged: true, length: 10 },
      right: { kind: "spear", length: 26 },
      noLegs: true,
    };
    const riderParts = person(rider).parts.filter((p) => p.name !== "spark");
    const rename = (n: string) => `rider.${n}`;
    const [bw, bh] = v3([9, 9, 17], s);
    const lh = k(9, s);
    const moved = riderParts.map((p) => ({
      ...p,
      name: rename(p.name),
      parent: p.parent ? rename(p.parent) : "torso",
      at: p.parent ? p.at : ([p.at[0], bh - 1, p.at[2] + 1] as const),
      ...(p.name === "head" ? { round: 3, shape: HEAD } : {}),
      motion: p.motion,
    }));
    void lh;
    const legsOf = (side: 1 | -1) => part(side > 0 ? "rider.leg.l" : "rider.leg.r", [3, 7, 4], [side * (bw / 2 + 1), bh - 1, 1], [-1.5, -7, -2], solid(rampOf(at(coatR!, 1)), 3, rows(4, 6, at(C.WOOD, 2))), at(coatR!, 2), { parent: "torso", tilt: [-0.3, 0] });
    return { ...mount, name: "elk-rider", parts: [...mount.parts, ...moved, legsOf(1), legsOf(-1)] };
  },
});

// --- Dragons and drakes ---------------------------------------------------------------------------------------------

function dragonOf(name: string, [hide, wingR, belly]: readonly Ramp[], s: number, engine: boolean): FigureSpec {
  const H = hide!;
  const skin: Paint = engine ? plates(H, 3, 4) : scales(H, 3);
  const eye = engine ? OIL_EYE : EMBER_EYE;
  const spec = quad({
    name,
    s,
    body: [12, 10, 18],
    leg: [4, 7, 5],
    head: [9, 8, 11],
    neck: { size: [6, 16, 6], lean: -0.4 },
    coat: layer(skin, engine ? (p) => { for (let x = 1; x < p.width; x += 4) p.put(x, 1, at(GOLD, 4)); } : undefined),
    belly: layer(cloth(belly!, 3), (p) => { for (let y = 0; y < p.height; y += 2) p.hline(0, y, p.width, at(belly!, 2)); }),
    legPaint: skin,
    fill: at(H, 3),
    face: layer(skin, eyes(9, 2, { color: eye, size: 1 }), (p) => { p.box(1, 5, 7, 2, at(H, 0)); for (let x = 1; x < 8; x += 2) p.put(x, 5, 0xf4ecd4); p.put(2, 7, C.INK); p.put(6, 7, C.INK); }),
    headSides: layer(skin, (p) => { p.put(p.width - 3, 2, eye); }),
    paws: BONE,
    headParts: (w, h, d) => [
      horn("horn.l", "head", [w / 2 - 1.5, h / 2 - 1, -2], [2, 6, 2], belly!, [-1.0, -0.35]),
      horn("horn.r", "head", [-w / 2 + 1.5, h / 2 - 1, -2], [2, 6, 2], belly!, [-1.0, 0.35]),
      part("jaw", [w - 2, 2, d - 3], [0, -h / 2, 0], [-(w - 2) / 2, -2, -d / 3 + 1], { front: layer(cloth(H, 2), (p) => { for (let x = 0; x < p.width; x += 2) p.put(x, 0, 0xf4ecd4); }), left: cloth(H, 2), bottom: cloth(belly!, 3, false) }, at(H, 2), { parent: "head", round: 0.5 }),
    ],
    bodyParts: (w, h, d) => ridge(belly!, 5, d, h, s),
    tail: { count: 7, first: [6, 6, 5], last: [2, 2, 4], faces: (i) => (i === 6 ? { ...allSides(skin), front: layer(cloth(belly!, 4), pointUp) } : allSides(skin)), droop: 0.1, curl: 0.22 },
    wings: { kind: "bat", ramp: wingR!, trim: rampOf(at(H, 2)), span: 20, height: 18, raise: 0.75, jointed: true },
    hover: 6,
    stride: 0.5,
  });
  return { ...spec, footprint: (spec.footprint ?? 0.5) * 1.1 };
}

defineMob({ id: "dragon", scale: 1.15, about: "a dragon: a great scaled body on four legs, a long neck, a horned head with a jaw of teeth, vast jointed bat wings, a long spined tail", slots: ["hide", "wings", "belly"], palette: ["#c8432c", "#8f2f2f", "#f1b44c"], build: (r, s) => dragonOf("dragon", r, s, false) });
defineMob({ id: "dragon-engine", scale: 1.15, about: "a Phyrexian dragon engine: a dragon of riveted plate, its eyes glowing oil-green, wings of metal sheets", slots: ["plate", "wings", "trim"], palette: ["#8c909c", "#4a4f58", "#c8432c"], build: (r, s) => dragonOf("dragon-engine", r, s, true) });

defineMob({
  id: "drake",
  about: "a drake: a winged lizard on two legs, wings for arms, a slender neck and head, a long tail",
  slots: ["hide", "wings", "belly"],
  palette: ["#2f5fa8", "#a97fd0", "#c8e0f0"],
  build: ([hide, wingR, belly], s) => {
    const H = hide!;
    const body = v3([9, 9, 12], s);
    const leg = v3([3, 6, 4], s);
    const [bw, bh, bd] = body;
    const parts: PartSpec[] = [
      part("leg.l", leg, [bw / 2 - 1.5, leg[1], -1], [-leg[0] / 2, -leg[1], -leg[2] / 2], allSides(scales(H, 2)), at(H, 2)),
      part("leg.r", leg, [-bw / 2 + 1.5, leg[1], -1], [-leg[0] / 2, -leg[1], -leg[2] / 2], allSides(scales(H, 2)), at(H, 2)),
      part("torso", body, [0, leg[1], 0], [-bw / 2, 0, -bd / 2], { ...allSides(scales(H, 3)), front: layer(cloth(belly!, 3), (p) => { for (let y = 0; y < p.height; y += 2) p.hline(0, y, p.width, at(belly!, 2)); }) }, at(H, 3), { tilt: [-0.25, 0] }),
      part("neck", v3([4, 8, 4], s), [0, bh - 2, bd / 2 - 2], [-2 * s, 0, -2 * s], allSides(scales(H, 3)), at(H, 3), { parent: "torso", tilt: [0.25, 0] }),
      part("head", [7, 6, 9], [0, k(8, s) - 1, 1], [-3.5, -2, -3], { front: layer(scales(H, 3), eyes(7, 1, { color: EMBER_EYE, size: 1 }), (p) => { p.hline(1, 4, 5, at(H, 0)); p.put(2, 5, 0xf4ecd4); p.put(4, 5, 0xf4ecd4); }), left: layer(scales(H, 3), (p) => p.put(6, 1, EMBER_EYE)), right: layer(scales(H, 3), (p) => p.put(2, 1, EMBER_EYE)), back: scales(H, 3), top: scales(H, 4) }, at(H, 3), { parent: "neck", round: 1.5, shape: { ...HEAD, jaw: 0.1 } }),
      horn("horn.l", "head", [2, 3, -2], [1, 4, 1], belly!, [-1.1, -0.2]),
      horn("horn.r", "head", [-2, 3, -2], [1, 4, 1], belly!, [-1.1, 0.2]),
      ...chain({ name: "tail", parent: "torso", at: [0, bh * 0.5, -bd / 2 + 0.5], count: 5, first: v3([5, 5, 4], s), last: [1, 1, 4], faces: () => allSides(scales(H, 3)), fill: at(H, 3), droop: 0.2, sway: 0.3 }),
      ...wings({ kind: "bat", ramp: wingR!, trim: rampOf(at(H, 2)), span: k(16, s), height: k(13, s), parent: "torso", at: [bw / 2 - 1, bh - 1, 2], raise: 0.8, jointed: true }),
    ];
    return { name: "drake", parts, stride: 0.7, armSwing: 0, lean: 0.05, hover: 5, flies: true, footprint: 0.5 * s };
  },
});

// --- Birds -------------------------------------------------------------------------------------------------------

defineMob({
  id: "bird",
  about: "a bird of paradise: a round little body, a hooked beak, fluttering wings and a long plume of tail feathers",
  slots: ["plumage", "wings", "tail"],
  palette: ["#3e9a4a", "#c8432c", "#f1b44c"],
  build: ([plum, wingR, tailR], s) => {
    const P = plum!;
    const body = v3([7, 7, 8], s);
    const [bw, bh, bd] = body;
    const legH = k(3, s);
    const legPaint = solid(rampOf("#d8a040"), 3);
    const parts: PartSpec[] = [
      part("leg.l", [1, legH, 1], [bw / 4, legH, 0], [-0.5, -legH, -0.5], legPaint, 0xd8a040),
      part("leg.r", [1, legH, 1], [-bw / 4, legH, 0], [-0.5, -legH, -0.5], legPaint, 0xd8a040),
      part("torso", body, [0, legH, 0], [-bw / 2, 0, -bd / 2], { ...allSides(feathers(P, 3, false)), front: layer(feathers(rampOf(at(tailR!, 4)), 3, false)) }, at(P, 3), { round: 2.5 }),
      part("head", v3([6, 6, 6], Math.sqrt(s)), [0, bh - 1, bd / 4], [-3 * Math.sqrt(s), 0, -3 * Math.sqrt(s)], { front: layer(feathers(P, 4, false), eyes(k(6, Math.sqrt(s)), 3, { size: 1 })), left: feathers(P, 4, false), right: feathers(P, 4, false), back: feathers(P, 3, false), top: cloth(P, 5, false) }, at(P, 4), { parent: "torso", round: 2 }),
      part("beak", [2, 2, 2], [0, 1.5, 2.5 * Math.sqrt(s)], [-1, -1, 0], solid(rampOf("#e8d080"), 4), 0xe8d080, { parent: "head", round: 0.5, tilt: [0.4, 0] }),
      ...chain({ name: "tail", parent: "torso", at: [0, bh * 0.4, -bd / 2 + 0.5], count: 3, first: v3([4, 1, 5], s), last: v3([3, 1, 6], s), faces: (i) => ({ top: feathers(i % 2 ? tailR! : wingR!, 4, false), bottom: feathers(tailR!, 3, false), front: cloth(tailR!, 4), left: cloth(tailR!, 3) }), fill: at(tailR!, 4), droop: 0.25, sway: 0.2, axis: "x" }),
      ...wings({ kind: "feather", ramp: wingR!, trim: tailR!, span: k(9, s), height: k(8, s), parent: "torso", at: [bw / 2 - 1, bh - 1, 0], raise: 0.4 }),
    ];
    return { name: "bird", parts, stride: 0.9, armSwing: 0, lean: 0.05, hover: 6, flies: true, footprint: 0.35 * s };
  },
});

// --- Serpents and wurms ------------------------------------------------------------------------------------------

defineMob({
  id: "serpent",
  scale: 1.3,
  about: "a sea serpent: thick coils looped on the ground, a neck reared up in an S, a finned head with fangs",
  slots: ["scales", "fins", "belly"],
  palette: ["#2f5fa8", "#93c8dc", "#f4ecc2"],
  build: ([sc, fin, belly], s) => {
    const S = sc!;
    const r = (v: number) => k(v, s);
    const bellied: Paint = layer(cloth(belly!, 3), (p) => { for (let y = 0; y < p.height; y += 2) p.hline(0, y, p.width, at(belly!, 2)); });
    const finPaint: Paint = layer(cloth(fin!, 4), (p) => { for (let x = 0; x < p.width; x += 2) p.vline(x, 0, p.height, at(fin!, 2)); }, cutTo((x, y, w, h) => y >= h - 1 - Math.round((x / w) * (h - 1))));
    // The coils loop round behind and beside the reared neck, thick at the front and tapering to the tail.
    const coils = chain({ name: "coil", parent: "torso", at: [r(3), r(1), -r(2)], count: 8, first: [r(8), r(7), r(6)], last: [r(2), r(2), r(4)], faces: () => ({ ...allSides(scales(S, 3)), bottom: cloth(belly!, 3, false), top: scales(S, 4) }), fill: at(S, 3), sway: 0.12, rate: 2.4, curl: 0.72, round: 2 });
    const crest = (n: string, parent: string, len: number): PartSpec => part(n, [1, r(4), len], [0, r(4), -r(2)], [-0.5, 0, -len / 2], { left: finPaint, right: flipX(finPaint), top: cloth(fin!, 4, false) }, at(fin!, 4), { parent });
    const parts: PartSpec[] = [
      part("torso", [r(9), r(8), r(8)], [0, 0, 0], [-r(4.5), 0, -r(4)], { ...allSides(scales(S, 3)), front: bellied }, at(S, 3), { round: 2.5 }),
      part("neck", [r(7), r(10), r(7)], [0, r(6), r(1)], [-r(3.5), 0, -r(3.5)], { ...allSides(scales(S, 3)), front: bellied }, at(S, 3), { parent: "torso", tilt: [-0.3, 0], motion: { kind: "tail", delay: 0, amount: 0.1, axis: "z", rate: 2 }, round: 2.5 }),
      part("neck.2", [r(6), r(9), r(6)], [0, r(9), 0], [-r(3), 0, -r(3)], { ...allSides(scales(S, 3)), front: bellied }, at(S, 3), { parent: "neck", tilt: [0.55, 0], motion: { kind: "tail", delay: 0.8, amount: 0.12, axis: "z", rate: 2 }, round: 2 }),
      part("head", [r(8), r(7), r(11)], [0, r(9), r(1)], [-r(4), -r(1), -r(3)], { front: layer(scales(S, 4), eyes(r(8), 2, { color: GHOUL_EYE, size: 1 }), (p) => { p.box(0, p.height - 3, p.width, 3, at(S, 0)); for (let x = 1; x < p.width - 1; x += 2) p.put(x, p.height - 3, 0xf4ecd4); p.put(1, p.height - 2, 0xf4ecd4); p.put(p.width - 2, p.height - 2, 0xf4ecd4); }), back: scales(S, 3), left: layer(scales(S, 3), (p) => p.put(p.width - 3, 2, GHOUL_EYE)), right: layer(scales(S, 3), (p) => p.put(2, 2, GHOUL_EYE)), top: scales(S, 4) }, at(S, 3), { parent: "neck.2", tilt: [0.35, 0], round: 2, shape: { ...HEAD, jaw: 0.25 } }),
      part("fin.l", [r(6), r(7), 1], [r(4), r(4), -r(2)], [0, -r(2), -0.5], { front: finPaint, back: finPaint }, at(fin!, 4), { parent: "head", tilt: [0, 0.35] }),
      part("fin.r", [r(6), r(7), 1], [-r(4), r(4), -r(2)], [-r(6), -r(2), -0.5], { front: flipX(finPaint), back: flipX(finPaint) }, at(fin!, 4), { parent: "head", tilt: [0, -0.35] }),
      crest("crest", "neck", r(7)),
      crest("crest.2", "neck.2", r(6)),
      ...coils,
    ];
    return { name: "serpent", parts, stride: 0, armSwing: 0, lean: 0, footprint: 0.6 * s };
  },
});

defineMob({
  id: "wurm",
  scale: 1.4,
  about: "a wurm: a vast ringed body coiled along the ground, its front reared up and bent over into a round maw ringed with fangs",
  slots: ["hide", "plates", "maw"],
  palette: ["#3e9a4a", "#8f6340", "#d6ae7e"],
  build: ([hide, platesR, maw], s) => {
    const H = hide!;
    const r = (v: number) => k(v, s);
    const ringed = (i: number): Paint => layer(scales(H, 3), (p) => { for (let y = 0; y < p.height; y += 3) p.hline(0, y, p.width, at(platesR!, i % 2 ? 2 : 3)); });
    const ring = (i: number): PartFaces => ({ ...allSides(ringed(i)), top: plates(platesR!, 3, 4), bottom: cloth(maw!, 2, false) });
    const segs = chain({ name: "body", parent: "torso", at: [0, r(3), -r(4)], count: 7, first: [r(11), r(10), r(7)], last: [r(4), r(4), r(6)], faces: ring, fill: at(H, 3), sway: 0.14, rate: 2, round: 3, curl: 0.5 });
    const mawPaint: Paint = layer(cloth(maw!, 1), (p) => {
      const cx = (p.width - 1) / 2;
      const cy = (p.height - 1) / 2;
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          const d = Math.hypot(x - cx, y - cy) / (p.width / 2);
          if (d > 0.9) p.put(x, y, at(H, 3));
          else if (d > 0.7) p.put(x, y, at(maw!, 5));
          else if (d > 0.5) p.put(x, y, (Math.round(Math.atan2(y - cy, x - cx) * 3) % 2 === 0) ? 0xf4ecd4 : at(maw!, 2));
          else p.put(x, y, at(maw!, d < 0.25 ? 0 : 1));
        }
      }
    });
    const hw = r(13);
    const fangs: PartSpec[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      fangs.push(horn(`fang.${i}`, "head", [Math.cos(a) * hw * 0.32, hw / 2 + Math.sin(a) * hw * 0.32, r(9) - r(4) - 0.5], [2, r(4), 2], full(rampOf("#f4ecd4")), [1.3, -Math.cos(a) * 0.5]));
    }
    const parts: PartSpec[] = [
      part("torso", [r(12), r(10), r(9)], [0, 0, 0], [-r(6), 0, -r(4.5)], ring(0), at(H, 3), { round: 3 }),
      part("rise", [r(11), r(10), r(9)], [0, r(8), r(1)], [-r(5.5), 0, -r(4.5)], ring(1), at(H, 3), { parent: "torso", tilt: [-0.2, 0], round: 3, motion: { kind: "tail", delay: 0, amount: 0.08, axis: "z", rate: 1.6 } }),
      part("head", [hw, hw, r(9)], [0, r(9), r(1)], [-hw / 2, 0, -r(4)], { front: mawPaint, back: ringed(1), left: ringed(1), right: ringed(1), top: plates(platesR!, 3, 4), bottom: cloth(maw!, 2, false) }, at(H, 3), { parent: "rise", tilt: [0.75, 0], round: 3, shape: { steps: 3, jaw: 0.08, dome: 0.1, back: 0.15 }, motion: { kind: "tail", delay: 0.6, amount: 0.12, axis: "x", rate: 1.6 } }),
      ...fangs,
      ...segs,
    ];
    return { name: "wurm", parts, stride: 0, armSwing: 0, lean: 0, footprint: 0.8 * s };
  },
});

// --- Insects -----------------------------------------------------------------------------------------------------

defineMob({
  id: "insect",
  about: "a giant insect: a three-part shell, six legs, antennae and mandibles, glassy wings folded on its back",
  slots: ["shell", "legs", "wings"],
  palette: ["#2e8c80", "#1e2228", "#c8e0f0"],
  build: ([shell, legR, wingR], s) => {
    const Sh = shell!;
    const r = (v: number) => k(v, s);
    const shiny: Paint = layer(cloth(Sh, 3), rows(0, 0, at(Sh, 5)), (p) => p.vline(Math.floor(p.width / 2), 0, p.height, at(Sh, 2)));
    const parts: PartSpec[] = [
      part("torso", [r(7), r(5), r(6)], [0, r(5), 0], [-r(3.5), 0, -r(3)], allSides(shiny), at(Sh, 3), { round: 1.5 }),
      part("abdomen", [r(9), r(7), r(10)], [0, r(1), -r(3)], [-r(4.5), 0, -r(10)], allSides(layer(shiny, (p) => { for (let y = 1; y < p.height; y += 2) p.hline(0, y, p.width, at(Sh, 2)); })), at(Sh, 3), { parent: "torso", round: 2.5, tilt: [0.2, 0], motion: { kind: "tail", delay: 0.3, amount: 0.08, axis: "x", rate: 3 } }),
      part("head", [r(6), r(5), r(5)], [0, r(2), r(3)], [-r(3), -r(1), 0], { front: layer(cloth(Sh, 3), (p) => { p.box(0, 1, 2, 2, GHOUL_EYE); p.box(p.width - 2, 1, 2, 2, GHOUL_EYE); }), left: cloth(Sh, 3), right: cloth(Sh, 3), top: cloth(Sh, 4, false) }, at(Sh, 3), { parent: "torso", round: 1.5 }),
      horn("mandible.l", "head", [r(1.5), 0, r(5)], [1, r(3), 1], legR!, [1.4, -0.3]),
      horn("mandible.r", "head", [-r(1.5), 0, r(5)], [1, r(3), 1], legR!, [1.4, 0.3]),
      part("antenna.l", [1, r(6), 1], [r(1.5), r(4), r(3)], [-0.5, 0, -0.5], solid(legR!, 3), at(legR!, 3), { parent: "head", tilt: [0.6, -0.4], motion: { kind: "tail", delay: 0, amount: 0.15, axis: "z", rate: 5 } }),
      part("antenna.r", [1, r(6), 1], [-r(1.5), r(4), r(3)], [-0.5, 0, -0.5], solid(legR!, 3), at(legR!, 3), { parent: "head", tilt: [0.6, 0.4], motion: { kind: "tail", delay: 1, amount: 0.15, axis: "z", rate: 5 } }),
      ...wings({ kind: "insect", ramp: wingR!, trim: rampOf(at(wingR!, 1)), span: r(10), height: r(5), parent: "torso", at: [1, r(5), -r(1)], raise: 0.15 }),
    ];
    // Six legs, three a side, the middle pair out of step with the others.
    [-1, 0, 1].forEach((row, i) => {
      for (const side of [1, -1] as const) {
        parts.push(part(`leg.${i}${side > 0 ? "l" : "r"}`, [1, r(6), 1], [side * r(3), r(1), row * r(2)], [-0.5, -r(6), -0.5], solid(legR!, 3), at(legR!, 3), { parent: "torso", tilt: [0, side * 0.55], motion: { kind: "leg", phase: (i % 2 === 0) === side > 0 ? 0 : Math.PI, amount: 0.5 } }));
      }
    });
    return { name: "insect", parts, stride: 0, armSwing: 0, lean: 0, footprint: 0.5 * s };
  },
});

export { horse, quad };
