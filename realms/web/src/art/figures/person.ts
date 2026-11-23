import * as C from "../paint/colors";
import type { Ramp } from "../paint/palette";
import type { Rgb } from "../paint/pixmap";
import { cloth, hairAll, hairCrown, hairRows, layer, rows, spikes } from "./faces";
import { type Held, heldParts, sparkPart } from "./held";
import { type V3, allSides, cutTo, eyes, flipX, fur, glowing, mail, part, plates, pointUp, ragged, solid } from "./paints";
import { at, full } from "./ramps";
import { type FigureSpec, HEAD, type HeadShape, type Paint, type PartFaces, type PartSpec, shapeHead } from "./rig";

// People, and everything built like one: the slice's rig (legs, torso, arms, a big round head) dressed from a
// description - a build, skin, hair and beard, what is on the head, the top and its sleeves, legs and boots, a robe's
// skirt, a cape, pauldrons, gloves, an amulet, rings, a floating relic, and what each hand holds. The player's bodies,
// the townsfolk, the guards, the mages and every humanoid creature (soldiers, knights, elves, orcs, minotaurs, giants,
// merfolk, angels, vampires) are people with different descriptions; gear (gear.ts) changes a description.

/** A body's proportions in texels: head, torso, arm and leg boxes [width, height, depth]. */
export interface Build {
  readonly head: V3;
  readonly torso: V3;
  readonly arm: V3;
  readonly leg: V3;
}

export type BodyName = "lithe" | "broad" | "tall" | "stocky";
export const BODY_NAMES: readonly BodyName[] = ["lithe", "broad", "tall", "stocky"];

/**
 * The four player bodies, on the slice's hero (head 12 by 10, torso 10 by 7, legs 5): lithe narrower and longer-legged,
 * broad wide in the shoulders, tall a texel more of torso and two of leg, stocky short and wide with a bigger head.
 */
export const BUILDS: Readonly<Record<BodyName, Build>> = {
  lithe: { head: [12, 10, 10], torso: [9, 7, 5], arm: [3, 8, 3], leg: [4, 6, 4] },
  broad: { head: [12, 10, 10], torso: [12, 7, 7], arm: [4, 8, 4], leg: [5, 5, 5] },
  tall: { head: [12, 10, 10], torso: [10, 8, 6], arm: [3, 9, 3], leg: [4, 7, 4] },
  stocky: { head: [13, 10, 11], torso: [12, 6, 7], arm: [4, 7, 4], leg: [5, 4, 5] },
};

/**
 * A build at a size: the body grows by `s`, the head by less (`headGrowth` of it), so a big figure has an adult's
 * proportions rather than a child's at a bigger scale - a boss reads as imposing. Sizes stay whole texels.
 */
export function scaled(b: Build, s: number, headGrowth = 0.45): Build {
  const r = (v: number, k: number) => Math.max(2, Math.round(v * k));
  const hs = 1 + (s - 1) * headGrowth;
  const v = (x: V3, k: number): V3 => [r(x[0], k), r(x[1], k), r(x[2], k)];
  return { head: v(b.head, hs), torso: v(b.torso, s), arm: v(b.arm, s), leg: v(b.leg, s) };
}

export type HairStyle = "spiky" | "crop" | "swept" | "long" | "ponytail" | "bun" | "bald" | "mohawk" | "topknot" | "wild";
export type BeardStyle = "full" | "short" | "goatee" | "long" | "moustache";

export type Headgear =
  | { readonly kind: "hood"; readonly ramp: Ramp; readonly trim?: Ramp }
  | { readonly kind: "scarf"; readonly ramp: Ramp }
  | { readonly kind: "wizard"; readonly ramp: Ramp; readonly band?: Ramp; readonly tall?: number }
  | { readonly kind: "mitre"; readonly ramp: Ramp; readonly trim?: Ramp }
  | { readonly kind: "cap"; readonly ramp: Ramp; readonly brim?: boolean }
  | { readonly kind: "helm"; readonly ramp: Ramp; readonly trim?: Ramp; readonly plume?: Ramp; readonly crest?: Ramp }
  | { readonly kind: "open-helm"; readonly ramp: Ramp; readonly trim?: Ramp; readonly plume?: Ramp }
  | { readonly kind: "horned"; readonly ramp: Ramp; readonly horn?: Ramp }
  | { readonly kind: "circlet"; readonly ramp: Ramp; readonly gem: Ramp; readonly crown?: boolean }
  | { readonly kind: "wide"; readonly ramp: Ramp; readonly band?: Ramp }
  | { readonly kind: "turban"; readonly ramp: Ramp; readonly gem?: Ramp }
  | { readonly kind: "leaves"; readonly ramp: Ramp; readonly berry?: Rgb }
  | { readonly kind: "antlers"; readonly ramp: Ramp }
  | { readonly kind: "feathers"; readonly ramp: Ramp; readonly band?: Ramp }
  | { readonly kind: "goggles"; readonly ramp: Ramp; readonly lens: Ramp }
  | { readonly kind: "veil"; readonly ramp: Ramp; readonly trim: Ramp };

export type TopStyle = "tunic" | "vest" | "robe" | "dress" | "plate" | "mail" | "tabard" | "fur" | "bare" | "leather" | "coat" | "rags" | "shirt";

export interface Top {
  readonly style: TopStyle;
  readonly ramp: Ramp;
  /** A second color: the trim, the collar, a tabard's stripe. */
  readonly trim?: Ramp;
  /** What shows under it: a shirt under a vest or a coat, mail under a tabard. */
  readonly under?: Ramp;
  /** A mark on the chest (a tabard's emblem, a sun). */
  readonly emblem?: Ramp;
}

export interface Face {
  /** The eyes' color (dark by default); `glow` when they light themselves (a glow color, rig.ts). */
  readonly eyes?: Rgb;
  readonly narrow?: boolean;
  readonly mouth?: "smile" | "fangs" | "tusks" | "grim" | "none" | "beak";
  readonly blush?: boolean;
  /** Stripes of war paint across the eyes. */
  readonly paint?: Rgb;
  /** A heavy brow over the eyes. */
  readonly brow?: boolean;
  /** Spectacles. */
  readonly spectacles?: boolean;
}

export interface Person {
  readonly name: string;
  readonly build: Build;
  readonly skin: Ramp;
  readonly face?: Face;
  readonly hair?: { readonly ramp: Ramp; readonly style: HairStyle };
  readonly beard?: { readonly ramp?: Ramp; readonly style: BeardStyle };
  readonly ears?: "pointed" | "long" | { readonly fin: Ramp };
  readonly horns?: { readonly ramp: Ramp; readonly size?: number; readonly curl?: "up" | "out" };
  readonly headgear?: Headgear;
  readonly halo?: Ramp;
  readonly top: Top;
  readonly sleeves?: "long" | "short" | "none";
  readonly sleeve?: Ramp;
  /** Trousers (or the skin, bare). */
  readonly legs?: Ramp;
  readonly boots?: { readonly ramp: Ramp; readonly height?: number; readonly trim?: Ramp; readonly big?: boolean };
  readonly belt?: Ramp | null;
  readonly skirt?: { readonly ramp: Ramp; readonly trim?: Ramp; readonly length?: number; readonly open?: Ramp; readonly ragged?: boolean };
  readonly cape?: { readonly ramp: Ramp; readonly trim?: Ramp; readonly length?: number; readonly collar?: boolean; readonly ragged?: boolean; readonly wide?: boolean };
  readonly pauldrons?: { readonly ramp: Ramp; readonly trim?: Ramp; readonly fur?: boolean };
  readonly gloves?: { readonly ramp: Ramp; readonly trim?: Ramp };
  readonly amulet?: { readonly chain: Ramp; readonly gem: Ramp };
  readonly rings?: { readonly r?: { readonly band: Ramp; readonly gem: Ramp }; readonly l?: { readonly band: Ramp; readonly gem: Ramp } };
  readonly relic?: { readonly body: Ramp; readonly gem: Ramp };
  readonly right?: Held;
  readonly left?: Held;
  /** The light of its spells (default the arcane blue). */
  readonly spark?: Ramp;
  /** More parts: wings, a tail, a second head. */
  readonly extras?: readonly PartSpec[];
  readonly stride?: number;
  readonly armSwing?: number;
  readonly hunch?: number;
  readonly hover?: number;
  readonly footprint?: number;
  /** The head's tilt and how far forward it sits (a ghoul's hunch, a minotaur's thrust neck). */
  readonly headTilt?: number;
  readonly headShape?: HeadShape;
  /** A head drawn in full by the caller (a minotaur's bull head, a bird's): its faces and any parts on it. */
  readonly ownHead?: { readonly faces: PartFaces; readonly parts?: readonly PartSpec[] };
  /** No legs: a spirit's or a djinn's body ends in the given parts. */
  readonly noLegs?: boolean;
  /** With no legs, how high the torso sits (on a praetor's spider body); 0 by default. */
  readonly perch?: number;
}

const K = C.INK;
const WHITE_CLOTH = full(C.CLOTH_WHITE);
const GOLD = full(C.GOLD);
const LEATHER = full(C.WOOD);
const ARCANE = full(C.WATER);

// --- The head -------------------------------------------------------------------------------------------------------

/** How deep the hair comes down the front of the head, by style, at column x of a face w wide and h high. */
function fringe(style: HairStyle, w: number, h: number): ((x: number) => number) | null {
  const edge = (x: number) => x === 0 || x === w - 1;
  switch (style) {
    case "spiky":
      return (x) => (edge(x) ? 7 : x % 3 === 0 ? 4 : 3);
    case "crop":
      return (x) => (edge(x) ? 5 : 2);
    case "swept":
      return (x) => (edge(x) ? 7 : x < w * 0.55 ? 4 + (x % 2) : 2);
    case "long":
    case "wild":
      return (x) => (x <= 1 || x >= w - 2 ? h - 1 : x % 4 === 2 ? 4 : 3);
    case "ponytail":
    case "bun":
      return (x) => (edge(x) ? 5 : 2 + (x % 4 === 1 ? 1 : 0));
    case "topknot":
    case "mohawk":
      return (x) => (edge(x) ? 3 : 0);
    case "bald":
      return null;
  }
}

/** How far back along a side the hair covers (x = 0 at the back), by style. */
function sideHair(style: HairStyle, d: number, h: number): ((x: number) => number) | null {
  switch (style) {
    case "long":
    case "wild":
      return (x) => (x < d * 0.65 ? h : 4);
    case "crop":
    case "topknot":
    case "mohawk":
      return (x) => (x < d * 0.35 ? h - 3 : 2);
    case "bald":
      return null;
    default:
      return (x) => (x < d * 0.4 ? h : x < d * 0.6 ? Math.ceil(h / 2) : 4);
  }
}

function headParts(o: Person): { faces: PartFaces; parts: PartSpec[] } {
  const [w, h, d] = o.build.head;
  const S = full(o.skin);
  const f = o.face ?? {};
  const hair = o.hair && full(o.hair.ramp);
  const style = o.hair?.style ?? "bald";
  const gear = o.headgear;
  const hides = gear && (gear.kind === "helm" || gear.kind === "hood" || gear.kind === "scarf" || gear.kind === "veil");
  const parts: PartSpec[] = [];

  if (o.ownHead) return { faces: o.ownHead.faces, parts: [...(o.ownHead.parts ?? [])] };

  // A closed helm is the head: its faces, a slit for the eyes, its crest or plume.
  if (gear?.kind === "helm") {
    const iron = full(gear.ramp);
    const trim = gear.trim ? full(gear.trim) : iron;
    const slit = h - 6;
    const front: Paint = layer(cloth(iron, 4), rows(0, 0, at(iron, 5)), rows(slit, slit, K), rows(slit + 1, slit + 1, at(iron, 2)), (p) => {
      const mid = Math.floor(w / 2) - 1;
      p.vline(mid, 1, slit - 1, at(trim, 6));
      p.vline(mid + 1, 1, slit - 1, at(trim, 3));
      for (let x = 2; x < w - 2; x += 3) p.put(x, slit + 3, K);
      p.hline(0, h - 1, w, at(iron, 2));
    });
    const side: Paint = layer(cloth(iron, 3), rows(0, 0, at(iron, 5)), (p) => { p.put(d - 2, slit, K); p.put(d - 3, slit, K); }, rows(h - 1, h - 1, at(iron, 2)));
    const faces: PartFaces = { front, right: side, left: flipX(side), back: layer(cloth(iron, 3), rows(0, 0, at(iron, 5))), top: layer(cloth(iron, 4, false), (p) => p.vline(Math.floor(w / 2) - 1, 0, p.height, at(trim, 6))) };
    if (gear.plume) parts.push(part("plume", [2, 5, d - 1], [0, h, 0], [-1, -1, -d / 2], { left: layer(cloth(gear.plume, 3), rows(0, 0, at(gear.plume, 5)), spikes(3, 2)), right: layer(cloth(gear.plume, 3), rows(0, 0, at(gear.plume, 5)), spikes(3, 2)), top: cloth(gear.plume, 4, false), front: cloth(gear.plume, 4) }, at(gear.plume, 3), { parent: "head", tilt: [-0.15, 0] }));
    if (gear.crest) parts.push(part("crest", [1, 3, d - 2], [0, h, 0], [-0.5, -1, -d / 2 + 1], solid(full(gear.crest), 4), at(gear.crest, 4), { parent: "head" }));
    return { faces, parts };
  }

  // The face: skin, eyes, brows, cheeks and mouth, the fringe of hair (or a hood's edge) over it.
  const browRow = h - 6;
  const eyeRow = h - 4;
  const facePaints: (Paint | undefined)[] = [cloth(S, 4, false)];
  if (f.paint) facePaints.push(rows(eyeRow - 1, eyeRow, f.paint));
  facePaints.push(eyes(w, eyeRow, f.eyes !== undefined ? { color: f.eyes, size: f.narrow ? 1 : 2, glint: false } : { size: f.narrow ? 1 : 2 }));
  facePaints.push((p) => {
    const lx = Math.round(w / 2) - 4;
    const rx = w - lx - 2;
    const brow = f.brow ? at(S, 2) : hair ? at(hair, 2) : at(S, 3);
    for (const x of [lx, lx + 1, rx, rx + 1]) p.put(x, browRow, brow);
    if (f.brow) for (let x = lx - 1; x <= rx + 2; x++) p.put(x, browRow, at(S, 2));
    if (f.blush ?? !f.eyes) {
      p.put(lx - 1, eyeRow + 1, at(C.PINK, 3));
      p.put(rx + 2, eyeRow + 1, at(C.PINK, 3));
    }
    const m = Math.floor(w / 2) - 1;
    switch (f.mouth ?? "smile") {
      case "smile":
        p.put(m, h - 2, at(S, 2));
        p.put(m + 1, h - 2, at(S, 2));
        break;
      case "grim":
        p.hline(m - 1, h - 2, 4, at(S, 1));
        break;
      case "fangs":
        p.hline(m - 1, h - 2, 4, K);
        p.put(m - 1, h - 1, 0xfff8e8);
        p.put(m + 2, h - 1, 0xfff8e8);
        break;
      case "tusks":
        p.hline(m - 2, h - 2, 6, K);
        p.put(m - 2, h - 3, 0xfff4d8);
        p.put(m + 3, h - 3, 0xfff4d8);
        break;
      case "beak":
      case "none":
        break;
    }
    p.hline(0, h - 1, w, at(S, 3));
    if (f.spectacles) {
      for (const x of [lx - 1, rx - 1]) {
        p.put(x, eyeRow - 1, at(GOLD, 4));
        p.put(x + 3, eyeRow - 1, at(GOLD, 4));
        p.put(x, eyeRow, at(GOLD, 4));
        p.put(x + 3, eyeRow, at(GOLD, 4));
      }
      p.hline(lx + 2, eyeRow - 1, rx - lx - 2, at(GOLD, 3));
    }
  });
  let sideP: Paint = layer(cloth(S, 4, false), (p) => {
    const ex = Math.round(d * 0.5);
    p.put(ex, h - 5, at(S, 3));
    p.put(ex + 1, h - 5, at(S, 3));
    p.put(ex, h - 4, at(S, 2));
    p.put(ex + 1, h - 4, at(S, 3));
  });
  let back: Paint = cloth(S, 3);
  let top: Paint = layer(cloth(S, 4, false), (p) => p.put(Math.floor(w / 2), Math.floor(d / 2), at(S, 5)));

  if (hair && !hides) {
    const fr = fringe(style, w, h);
    if (fr) facePaints.push(hairRows(hair, fr));
    const sh = sideHair(style, d, h);
    if (sh) sideP = layer(sideP, hairRows(hair, sh));
    if (style === "crop" || style === "topknot" || style === "mohawk") back = layer(cloth(S, 3), hairRows(hair, () => (style === "crop" ? h - 2 : 2)));
    else if (style !== "bald") back = layer(hairAll(hair), rows(h - 1, h - 1, at(hair, 1)));
    if (style !== "bald" && style !== "mohawk" && style !== "topknot") top = hairCrown(hair);
  }
  if (o.beard) {
    const br = full(o.beard.ramp ?? hair ?? full(C.HAIR_BROWN));
    if (o.beard.style !== "moustache" && o.beard.style !== "goatee") {
      facePaints.push((p) => {
        for (let y = browRow + 1; y < h; y++) {
          p.put(0, y, at(br, 3));
          p.put(w - 1, y, at(br, 3));
        }
      });
    }
  }

  // What covers the head's paint: a hood, a scarf, a veil.
  if (gear && (gear.kind === "hood" || gear.kind === "scarf" || gear.kind === "veil")) {
    const r = full(gear.ramp);
    const depth = gear.kind === "scarf" ? 8 : h - 1;
    facePaints.push(hairRows(r, (x) => (x === 0 || x === w - 1 ? depth : gear.kind === "veil" ? 4 : 3)));
    if (gear.kind === "veil") facePaints.push(rows(3, 3, at(gear.trim, 4)), (p) => p.put(Math.floor(w / 2) - 1, 4, at(gear.trim, 6)));
    else if (gear.kind === "hood" && gear.trim) facePaints.push((p) => { for (let x = 1; x < w - 1; x++) p.put(x, 2, at(gear.trim!, 4)); });
    sideP = layer(cloth(S, 4, false), hairRows(r, (x) => (x < d - 3 ? h : 3)));
    back = layer(hairAll(r), rows(h - 1, h - 1, at(r, 1)));
    top = layer(cloth(r, 4, false), (p) => { for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y) % 5 === 0) p.put(x, y, at(r, 3)); });
  }

  const faces: PartFaces = { front: layer(...facePaints), right: sideP, left: flipX(sideP), back, top };

  // Volume: the hair's cap and its tail, bun or long fall behind.
  if (hair && !hides && style !== "bald") {
    const cap: V3 = [w + 1, style === "crop" ? 4 : 5, d + 1];
    const capBox: V3 = [-(w + 1) / 2, 0, -(d + 1) / 2 - 0.25];
    const capShape: HeadShape = { steps: 3, jaw: 0, dome: 0.55, back: 0.1 };
    const raggedEdge: Paint = (p) => {
      for (let x = 0; x < p.width; x++) p.put(x, p.height - 1, x % 3 === 1 ? 0 : at(hair, 2), x % 3 === 1 ? 0 : 255);
    };
    if (style === "spiky") parts.push(part("hair", cap, [0, h - 3, 0], capBox, { front: layer(hairAll(hair), spikes(4, 3), raggedEdge), left: layer(hairAll(hair), spikes(3, 3)), back: layer(hairAll(hair), spikes(3, 3)), top: hairCrown(hair) }, at(hair, 3), { parent: "head", round: 2.4, shape: capShape }));
    else if (style === "wild") parts.push(part("hair", [w + 2, 6, d + 2], [0, h - 4, 0], [-(w + 2) / 2, 0, -(d + 2) / 2 - 0.5], { front: layer(hairAll(hair), spikes(3, 2), raggedEdge), left: layer(hairAll(hair), spikes(2, 2)), back: layer(hairAll(hair), spikes(3, 2)), top: hairCrown(hair) }, at(hair, 3), { parent: "head", round: 2.6, shape: capShape }));
    else if (style === "mohawk") parts.push(part("hair", [3, 5, d], [0, h - 2, 0], [-1.5, 0, -d / 2 - 0.5], { front: layer(hairAll(hair), spikes(3, 2)), left: layer(hairAll(hair), spikes(3, 3)), top: hairCrown(hair) }, at(hair, 3), { parent: "head", round: 1 }));
    else if (style === "topknot") parts.push(part("hair", [4, 4, 4], [0, h + 1, -1], [-2, 0, -2], { front: hairAll(hair), top: hairCrown(hair) }, at(hair, 3), { parent: "head", round: 1.5 }));
    else parts.push(part("hair", [w + 1, 3, d + 1], [0, h - 2, 0], capBox, { front: layer(hairAll(hair), style === "swept" ? spikes(5, 2) : (p) => p, raggedEdge), left: hairAll(hair), back: hairAll(hair), top: hairCrown(hair) }, at(hair, 3), { parent: "head", round: 1.4, shape: { steps: 3, jaw: 0, dome: 0.35, back: 0.1 } }));
    if (style === "long" || style === "wild") parts.push(part("hair.back", [w + 1, h + 3, 2], [0, h - 1, -d / 2 + 0.5], [-(w + 1) / 2, -(h + 3), -2], allSides(layer(hairAll(hair), ragged(3, 1))), at(hair, 3), { parent: "head", round: 0.8 }));
    if (style === "ponytail") parts.push(part("hair.tail", [3, 8, 2], [0, h - 2, -d / 2 - 0.5], [-1.5, -8, -2], allSides(layer(hairAll(hair), ragged(2, 1))), at(hair, 3), { parent: "head", tilt: [0.25, 0], motion: { kind: "tail", delay: 0.4, amount: 0.12, axis: "z", rate: 3 } }));
    if (style === "bun") parts.push(part("hair.bun", [5, 4, 4], [0, h - 2, -d / 2], [-2.5, 0, -3], allSides(hairAll(hair), hairCrown(hair)), at(hair, 3), { parent: "head", round: 1.5 }));
  }

  // The beard, its own block on the chin.
  if (o.beard) {
    const br = full(o.beard.ramp ?? hair ?? full(C.HAIR_BROWN));
    const st = o.beard.style;
    if (st === "moustache") parts.push(part("beard", [6, 1, 1], [0, 2, d / 2], [-3, 0, -0.2], { front: cloth(br, 3) }, at(br, 3), { parent: "head", round: 0 }));
    else {
      const bw = st === "goatee" ? 4 : w - 2;
      const bh = st === "long" ? 8 : st === "full" ? 5 : st === "goatee" ? 4 : 3;
      parts.push(part("beard", [bw, bh, 2], [0, 3, d / 2 - 1.2], [-bw / 2, -bh + 1, 0], allSides(layer(hairAll(br), (p) => { p.put(Math.floor(bw / 2) - 1, 1, at(br, 1)); p.put(Math.floor(bw / 2), 1, at(br, 1)); }, st === "long" ? cutTo((x, y, ww, hh) => y < hh - 3 || Math.abs(x - (ww - 1) / 2) < (hh - y) * 1.2) : (p) => p)), at(br, 3), { parent: "head", round: 1 }));
    }
  }

  // Ears.
  if (o.ears === "pointed" || o.ears === "long") {
    const long = o.ears === "long";
    const ear: Paint = layer(cloth(S, 4), (p) => { p.hline(0, 0, p.width, at(S, 5)); p.put(p.width - 1, p.height - 1, 0, 0); p.hline(1, 1, p.width - 2, at(C.PINK, 2)); });
    const size: V3 = [long ? 6 : 4, 2, 2];
    parts.push(part("ear.l", size, [w / 2, h - 5, 0], [0, -1, -1], { front: ear, back: ear, top: cloth(S, 5, false) }, at(S, 4), { parent: "head", tilt: [0, long ? 0.35 : 0.55] }));
    parts.push(part("ear.r", size, [-w / 2, h - 5, 0], [-size[0], -1, -1], { front: flipX(ear), back: flipX(ear), top: cloth(S, 5, false) }, at(S, 4), { parent: "head", tilt: [0, long ? -0.35 : -0.55] }));
  } else if (o.ears && typeof o.ears === "object") {
    const fin = full(o.ears.fin);
    const finPaint: Paint = layer(cloth(fin, 4), (p) => { for (let x = 0; x < p.width; x += 2) p.vline(x, 0, p.height, at(fin, 2)); }, cutTo((x, y, ww, hh) => y >= (x * hh) / (ww * 2)));
    parts.push(part("ear.l", [4, 5, 1], [w / 2, h - 6, 0], [0, -2, -0.5], { front: finPaint, back: finPaint }, at(fin, 4), { parent: "head", tilt: [0, 0.3] }));
    parts.push(part("ear.r", [4, 5, 1], [-w / 2, h - 6, 0], [-4, -2, -0.5], { front: flipX(finPaint), back: flipX(finPaint) }, at(fin, 4), { parent: "head", tilt: [0, -0.3] }));
  }

  // Horns: a base out from the head and a tip up from it.
  if (o.horns) {
    const hr = full(o.horns.ramp);
    const k = o.horns.size ?? 1;
    const base: V3 = [Math.round(3 * k), 2, 2];
    const tip: V3 = [2, Math.round(4 * k), 2];
    for (const side of [1, -1] as const) {
      const n = side > 0 ? "horn.l" : "horn.r";
      parts.push(part(n, base, [(side * w) / 2 - side, h - 2, 0], side > 0 ? [0, 0, -1] : [-base[0], 0, -1], solid(hr, 4, rows(0, 0, at(hr, 5))), at(hr, 4), { parent: "head", tilt: [0, side * 0.2] }));
      if (o.horns.curl !== "out") parts.push(part(`${n}.tip`, tip, [side * (base[0] - 0.5), 1, 0], [-1, 0, -1], { front: layer(cloth(hr, 5), pointUp), left: layer(cloth(hr, 4), pointUp), right: layer(cloth(hr, 4), pointUp), back: layer(cloth(hr, 4), pointUp), top: cloth(hr, 6, false) }, at(hr, 5), { parent: n, tilt: [0, -side * 0.25], round: 0 }));
    }
  }

  // What is worn on the head.
  if (gear) parts.push(...headgearParts(gear, w, h, d));
  if (o.halo) {
    const hr = full(o.halo);
    const ring = cutTo((x, y, ww, hh) => x === 0 || y === 0 || x === ww - 1 || y === hh - 1);
    parts.push(part("halo", [w - 2, 1, d - 2], [0, h + 4, -1], [-(w - 2) / 2, 0, -(d - 2) / 2], { front: glowing(hr), back: glowing(hr), left: glowing(hr), top: layer(glowing(hr), ring), bottom: layer(glowing(hr), ring) }, at(hr, 6), { parent: "head", glow: true, round: 0, motion: { kind: "bob", amount: 0.6, rate: 2 } }));
  }
  return { faces, parts };
}

function headgearParts(g: Headgear, w: number, h: number, d: number): PartSpec[] {
  const r = full(g.ramp);
  switch (g.kind) {
    case "hood":
      return [
        part("hood", [w + 2, 6, d + 2], [0, h - 4, -0.4], [-(w + 2) / 2, 0, -(d + 2) / 2], { front: layer(cloth(r, 3), rows(5, 5, g.trim ? at(g.trim, 4) : at(r, 2)), cutTo((x, y, ww, hh) => y < 2 || x < 2 || x > ww - 3)), left: cloth(r, 3), back: cloth(r, 2), top: cloth(r, 4, false), bottom: cloth(r, 1, false) }, at(r, 3), { parent: "head", round: 2.5, shape: { steps: 3, jaw: 0, dome: 0.35, back: 0.15 } }),
        part("hood.peak", [4, 3, 3], [0, h + 1, -d / 2], [-2, -1, -2], solid(r, 3), at(r, 3), { parent: "head", tilt: [0.5, 0], round: 1 }),
      ];
    case "scarf":
    case "veil": {
      if (g.kind === "veil") {
        return [part("hood", [w + 2, 6, d + 2], [0, h - 4, -0.4], [-(w + 2) / 2, 0, -(d + 2) / 2], { front: layer(cloth(r, 2), cutTo((x, y, ww) => y < 2 || x < 2 || x > ww - 3)), left: cloth(r, 2), back: cloth(r, 1), top: cloth(r, 3, false) }, at(r, 2), { parent: "head", round: 2.5, shape: { steps: 3, jaw: 0, dome: 0.4, back: 0.15 } })];
      }
      return [];
    }
    case "wizard": {
      const band = g.band ? full(g.band) : GOLD;
      const tall = g.tall ?? 1;
      return [
        part("hat", [w + 6, 1, d + 6], [0, h - 2, 0], [-(w + 6) / 2, 0, -(d + 6) / 2], { front: cloth(r, 2), left: cloth(r, 2), top: layer(cloth(r, 3, false), (p) => { for (let x = 2; x < p.width - 2; x += 4) p.put(x, 1, at(r, 4)); }), bottom: cloth(r, 1, false) }, at(r, 3), { parent: "head", round: 0.5 }),
        part("hat.1", [w - 1, Math.round(4 * tall), d - 1], [0, 1, 0], [-(w - 1) / 2, 0, -(d - 1) / 2], { front: layer(cloth(r, 3), rows(Math.round(4 * tall) - 2, Math.round(4 * tall) - 1, at(band, 3)), (p) => p.put(Math.floor(p.width / 2), p.height - 2, at(band, 5))), left: layer(cloth(r, 3), rows(Math.round(4 * tall) - 2, Math.round(4 * tall) - 1, at(band, 2))), top: cloth(r, 4, false) }, at(r, 3), { parent: "hat", round: 1 }),
        part("hat.2", [w - 5, Math.round(4 * tall), d - 5], [0, Math.round(4 * tall), -0.5], [-(w - 5) / 2, 0, -(d - 5) / 2], solid(r, 3, (p) => p.put(1, 1, at(band, 5))), at(r, 3), { parent: "hat.1", tilt: [-0.12, 0.05], round: 1 }),
        part("hat.3", [3, Math.round(4 * tall), 3], [0, Math.round(4 * tall) - 0.5, -0.5], [-1.5, 0, -1.5], { front: layer(cloth(r, 3), pointUp), left: layer(cloth(r, 3), pointUp), back: layer(cloth(r, 2), pointUp), top: cloth(r, 4, false) }, at(r, 3), { parent: "hat.2", tilt: [-0.4, 0.1], round: 0, motion: { kind: "tail", delay: 0.8, amount: 0.08, axis: "x", rate: 3 } }),
      ];
    }
    case "mitre": {
      const t = g.trim ? full(g.trim) : GOLD;
      const shape = cutTo((x, y, ww) => y >= 3 || Math.abs(x - (ww - 1) / 2) <= y + 1.5);
      return [part("mitre", [w - 4, 8, d - 4], [0, h - 2, 0], [-(w - 4) / 2, 0, -(d - 4) / 2], { front: layer(cloth(r, 4), (p) => { const m = Math.floor(p.width / 2); p.vline(m - 1, 2, p.height - 2, at(t, 4)); p.hline(m - 2, 4, 4, at(t, 4)); p.hline(0, p.height - 1, p.width, at(t, 3)); }, shape), back: layer(cloth(r, 3), rows(7, 7, at(t, 3)), shape), left: layer(cloth(r, 3), rows(7, 7, at(t, 3))), top: cloth(r, 4, false) }, at(r, 4), { parent: "head", round: 0.5 })];
    }
    case "cap":
      return [
        part("cap", [w + 1, 4, d + 1], [0, h - 3, 0], [-(w + 1) / 2, 0, -(d + 1) / 2 - 0.25], { front: layer(cloth(r, 4), rows(0, 0, at(r, 5)), rows(3, 3, at(r, 2))), left: cloth(r, 3), back: cloth(r, 3), top: layer(cloth(r, 4, false), (p) => p.vline(Math.floor(p.width / 2), 0, p.height, at(r, 6))) }, at(r, 4), { parent: "head", round: 2.2, shape: { steps: 3, jaw: 0, dome: 0.5, back: 0.1 } }),
        ...(g.brim !== false ? [part("cap.brim", [w + 3, 1, d + 3], [0, h - 3, 0], [-(w + 3) / 2, 0, -(d + 3) / 2 - 0.25], solid(r, 3), at(r, 3), { parent: "head", round: 0.5 })] : []),
      ];
    case "open-helm": {
      const t = g.trim ? full(g.trim) : r;
      const out: PartSpec[] = [
        part("helm", [w + 1, 5, d + 1], [0, h - 4, 0], [-(w + 1) / 2, 0, -(d + 1) / 2 - 0.25], { front: layer(cloth(r, 4), rows(0, 0, at(r, 5)), rows(4, 4, at(t, 3)), (p) => p.vline(Math.floor(p.width / 2), 0, p.height, at(r, 6))), left: layer(cloth(r, 3), rows(4, 4, at(t, 3))), back: cloth(r, 3), top: layer(cloth(r, 4, false), (p) => p.vline(Math.floor(p.width / 2), 0, p.height, at(r, 6))) }, at(r, 4), { parent: "head", round: 2.2, shape: { steps: 3, jaw: 0, dome: 0.5, back: 0.1 } }),
        part("helm.nasal", [1, 3, 1], [0, h - 4, d / 2 + 0.3], [-0.5, -3, -0.5], solid(r, 4), at(r, 4), { parent: "head", round: 0 }),
        part("helm.cheek.l", [1, 4, 4], [w / 2, h - 4, 1], [-0.2, -4, -2], solid(r, 3), at(r, 3), { parent: "head", round: 0 }),
        part("helm.cheek.r", [1, 4, 4], [-w / 2, h - 4, 1], [-0.8, -4, -2], solid(r, 3), at(r, 3), { parent: "head", round: 0 }),
      ];
      if (g.plume) out.push(part("plume", [2, 4, d - 2], [0, h + 1, -0.5], [-1, -1, -(d - 2) / 2], { left: layer(cloth(g.plume, 3), spikes(3, 2)), right: layer(cloth(g.plume, 3), spikes(3, 2)), top: cloth(g.plume, 4, false), front: cloth(g.plume, 4) }, at(g.plume, 3), { parent: "head", tilt: [-0.2, 0] }));
      return out;
    }
    case "horned": {
      const horn = full(g.horn ?? full(C.BONE));
      const out: PartSpec[] = [part("helm", [w + 1, 5, d + 1], [0, h - 4, 0], [-(w + 1) / 2, 0, -(d + 1) / 2 - 0.25], { front: layer(cloth(r, 4), rows(0, 0, at(r, 5)), rows(4, 4, at(r, 2)), (p) => { for (let x = 1; x < p.width; x += 3) p.put(x, 3, at(GOLD, 4)); }), left: cloth(r, 3), back: cloth(r, 3), top: cloth(r, 4, false) }, at(r, 4), { parent: "head", round: 2.2, shape: { steps: 3, jaw: 0, dome: 0.5, back: 0.1 } })];
      for (const side of [1, -1] as const) {
        const n = side > 0 ? "helm.horn.l" : "helm.horn.r";
        out.push(part(n, [3, 2, 2], [(side * (w + 1)) / 2 - side * 0.5, h - 1, 0], side > 0 ? [0, 0, -1] : [-3, 0, -1], solid(horn, 4), at(horn, 4), { parent: "head", round: 0.5 }));
        out.push(part(`${n}.tip`, [2, 5, 2], [side * 2.5, 1, 0], [-1, 0, -1], { front: layer(cloth(horn, 5), pointUp), left: layer(cloth(horn, 4), pointUp), right: layer(cloth(horn, 4), pointUp), back: layer(cloth(horn, 4), pointUp), top: cloth(horn, 6, false) }, at(horn, 5), { parent: n, tilt: [0, -side * 0.35], round: 0 }));
      }
      return out;
    }
    case "circlet": {
      const gem = full(g.gem);
      const ring = cutTo((x, y, ww, hh) => x === 0 || y === 0 || x === ww - 1 || y === hh - 1);
      const tall = g.crown ? 3 : 2;
      const band: Paint = g.crown ? layer(cloth(r, 4), rows(tall - 1, tall - 1, at(r, 2)), cutTo((x, y) => y > 0 || x % 3 === 1)) : layer(cloth(r, 4), rows(0, 0, at(r, 6)), rows(1, 1, at(r, 3)));
      return [
        part("circlet", [w + 1, tall, d + 1], [0, h - 3, 0], [-(w + 1) / 2, 0, -(d + 1) / 2 - 0.15], { front: band, back: band, left: band, right: band, top: ring, bottom: ring }, at(r, 4), { parent: "head", round: 0.4 }),
        part("circlet.gem", [2, 2, 1], [0, h - 3, d / 2 + 0.5], [-1, 0, -0.5], { front: layer(cloth(gem, 4), (p) => p.put(0, 0, at(gem, 6))) }, at(gem, 4), { parent: "head", round: 0 }),
      ];
    }
    case "wide": {
      const band = g.band ? full(g.band) : full(C.RED);
      return [
        part("hat", [w + 8, 1, d + 8], [0, h - 2, 0], [-(w + 8) / 2, 0, -(d + 8) / 2], { front: cloth(r, 3), left: cloth(r, 3), top: layer(cloth(r, 4, false), (p) => { for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y) % 3 === 0) p.put(x, y, at(r, 3)); }), bottom: cloth(r, 2, false) }, at(r, 4), { parent: "head", round: 0.5 }),
        part("hat.crown", [w - 2, 3, d - 2], [0, 1, 0], [-(w - 2) / 2, 0, -(d - 2) / 2], { front: layer(cloth(r, 4), rows(2, 2, at(band, 3))), left: layer(cloth(r, 3), rows(2, 2, at(band, 2))), top: cloth(r, 5, false) }, at(r, 4), { parent: "hat", round: 1 }),
      ];
    }
    case "turban": {
      const gem = g.gem ? full(g.gem) : full(C.RED);
      return [part("turban", [w + 2, 6, d + 2], [0, h - 4, 0], [-(w + 2) / 2, 0, -(d + 2) / 2 - 0.25], { front: layer(cloth(r, 4), (p) => { for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y * 2) % 5 === 0) p.put(x, y, at(r, 2)); }, (p) => { const m = Math.floor(p.width / 2) - 1; p.put(m, 2, at(gem, 4)); p.put(m + 1, 2, at(gem, 3)); p.put(m, 3, at(gem, 3)); p.put(m + 1, 3, at(gem, 2)); }), left: layer(cloth(r, 3), (p) => { for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y * 2) % 5 === 0) p.put(x, y, at(r, 2)); }), top: cloth(r, 5, false) }, at(r, 4), { parent: "head", round: 2.8, shape: { steps: 3, jaw: 0, dome: 0.6, back: 0.1 } })];
    }
    case "leaves": {
      const berry = g.berry ?? 0xd8324a;
      const leafy: Paint = layer(cloth(r, 4), (p) => { for (let x = 0; x < p.width; x++) { if (x % 2 === 0) p.put(x, 0, 0, 0); if (x % 4 === 1) p.put(x, 1, at(r, 6)); if (x % 5 === 2) p.put(x, 2, berry); } });
      const ring = cutTo((x, y, ww, hh) => x <= 1 || y <= 1 || x >= ww - 2 || y >= hh - 2);
      return [part("wreath", [w + 2, 3, d + 2], [0, h - 3, 0], [-(w + 2) / 2, 0, -(d + 2) / 2 - 0.25], { front: leafy, back: leafy, left: leafy, right: leafy, top: layer(cloth(r, 5, false), ring), bottom: cutTo(() => false) }, at(r, 4), { parent: "head", round: 0.6 })];
    }
    case "antlers": {
      const out: PartSpec[] = [];
      for (const side of [1, -1] as const) {
        const n = side > 0 ? "antler.l" : "antler.r";
        out.push(part(n, [1, 7, 1], [side * (w / 2 - 2), h - 1, -1], [-0.5, 0, -0.5], solid(r, 4), at(r, 4), { parent: "head", tilt: [-0.1, -side * 0.45], round: 0 }));
        out.push(part(`${n}.tine`, [1, 4, 1], [0, 3, 0], [-0.5, 0, -0.5], solid(r, 5), at(r, 5), { parent: n, tilt: [0, side * 0.9], round: 0 }));
        out.push(part(`${n}.tine2`, [1, 3, 1], [0, 6, 0], [-0.5, 0, -0.5], solid(r, 5), at(r, 5), { parent: n, tilt: [0.5, side * 0.5], round: 0 }));
      }
      return out;
    }
    case "feathers": {
      const band = g.band ? full(g.band) : LEATHER;
      const out: PartSpec[] = [part("headband", [w + 1, 2, d + 1], [0, h - 4, 0], [-(w + 1) / 2, 0, -(d + 1) / 2 - 0.25], { front: layer(cloth(band, 3), (p) => { for (let x = 1; x < p.width; x += 3) p.put(x, 0, at(C.TEAL, 4)); }), left: cloth(band, 3), back: cloth(band, 3), top: cutTo(() => false), bottom: cutTo(() => false) }, at(band, 3), { parent: "head", round: 0.4 })];
      [-1, 0, 1].forEach((k, i) => out.push(part(`feather.${i}`, [2, 7, 1], [k * 3, h - 3, -d / 2], [-1, 0, -0.5], { front: layer(cloth(r, 4), (p) => p.vline(1, 0, p.height, at(r, 6)), rows(0, 1, at(r, 2)), pointUp), back: layer(cloth(r, 3), pointUp) }, at(r, 4), { parent: "head", tilt: [-0.3, -k * 0.35], round: 0 })));
      return out;
    }
    case "goggles": {
      const lens = full(g.lens);
      return [
        part("goggles", [w + 1, 2, d + 1], [0, h - 4, 0], [-(w + 1) / 2, 0, -(d + 1) / 2 - 0.25], { front: layer(cloth(r, 3), (p) => { const lx = Math.round(w / 2) - 4; const rx = w - lx - 2; for (const x of [lx, rx]) { p.box(x, 0, 3, 2, at(lens, 5)); p.put(x, 0, at(lens, 6)); } }), left: cloth(r, 3), back: cloth(r, 2), top: cutTo(() => false), bottom: cutTo(() => false) }, at(r, 3), { parent: "head", round: 0.4 }),
      ];
    }
    case "helm":
      return [];
  }
}

// --- The body -------------------------------------------------------------------------------------------------------

function topFaces(o: Person): PartFaces {
  const [tw, th] = o.build.torso;
  const t = o.top;
  const r = full(t.ramp);
  const trim = t.trim ? full(t.trim) : r;
  const S = full(o.skin);
  const belt = o.belt === null ? null : full(o.belt ?? LEATHER);
  const beltRow = th - 2;
  const withBelt = (p: Paint): Paint => (belt ? layer(p, rows(beltRow, beltRow, at(belt, 2)), (q) => { const m = Math.floor(tw / 2) - 1; q.put(m, beltRow, at(GOLD, 3)); q.put(m + 1, beltRow, at(GOLD, 4)); }) : p);
  let front: Paint;
  let back: Paint;
  let side: Paint;
  switch (t.style) {
    case "tunic":
    case "shirt": {
      const collar = t.style === "shirt" ? at(trim, 4) : at(WHITE_CLOTH, 3);
      front = withBelt(layer(cloth(r, 3), (p) => { const m = Math.floor(tw / 2); p.hline(m - 3, 0, 6, collar); p.hline(m - 2, 1, 4, collar); p.hline(m - 1, 2, 2, at(S, 3)); p.put(0, 1, at(r, 4)); if (t.trim) p.hline(0, th - 1, tw, at(trim, 3)); }));
      back = withBelt(cloth(r, 3));
      side = withBelt(cloth(r, 3));
      break;
    }
    case "vest": {
      const under = full(t.under ?? WHITE_CLOTH);
      front = withBelt(layer(cloth(under, 3), (p) => { for (let y = 0; y < p.height; y++) for (const x of [0, 1, 2, tw - 3, tw - 2, tw - 1]) p.set(x, y, at(r, x < 2 || x > tw - 3 ? 3 : 2)); for (const y of [1, 3]) p.put(3, y, at(GOLD, 4)); }));
      back = cloth(r, 3);
      side = cloth(r, 3);
      break;
    }
    case "robe":
    case "dress": {
      front = layer(cloth(r, 3), (p) => {
        const m = Math.floor(tw / 2);
        if (t.style === "robe") {
          p.vline(m - 1, 0, th, at(trim, 4));
          p.vline(m, 0, th, at(trim, 3));
          p.hline(m - 3, 0, 6, at(trim, 4));
        } else {
          p.box(2, 1, tw - 4, th - 3, at(t.under ? full(t.under) : WHITE_CLOTH, 4));
          p.hline(1, 0, tw - 2, at(trim, 3));
        }
        if (t.emblem) { p.put(m - 1, 2, at(t.emblem, 5)); p.put(m, 2, at(t.emblem, 4)); }
      }, belt ? rows(beltRow, beltRow, at(trim, 2)) : undefined);
      back = layer(cloth(r, 3), belt ? rows(beltRow, beltRow, at(trim, 2)) : undefined);
      side = back;
      break;
    }
    case "plate": {
      front = layer(plates(r, th > 6 ? 3 : 2, 4), (p) => { const m = Math.floor(tw / 2); p.vline(m - 1, 0, th, at(r, 6)); p.vline(m, 0, th, at(r, 3)); p.hline(0, 0, tw, at(trim, 4)); p.hline(0, th - 1, tw, at(trim, 3)); if (t.emblem) { p.put(m - 1, 2, at(t.emblem, 5)); p.put(m, 2, at(t.emblem, 4)); p.put(m - 1, 3, at(t.emblem, 3)); p.put(m, 3, at(t.emblem, 3)); } });
      back = layer(plates(r, 3, 3), rows(th - 1, th - 1, at(trim, 3)));
      side = layer(plates(r, 3, 3));
      break;
    }
    case "mail":
    case "tabard": {
      const metal = full(t.style === "tabard" ? (t.under ?? full(C.IRON)) : r);
      const tab = t.style === "tabard" ? r : null;
      front = withBelt(layer(mail(metal), rows(0, 0, at(metal, 5)), tab ? (p) => { for (let y = 0; y < p.height; y++) for (let x = 2; x < tw - 2; x++) p.set(x, y, at(tab, x === 2 ? 4 : 3)); const m = Math.floor(tw / 2); p.vline(m - 1, 0, th, at(trim, 3)); p.vline(m, 0, th, at(trim, 2)); p.hline(2, 2, tw - 4, at(trim, 3)); const e = t.emblem ?? GOLD; p.put(m - 1, 2, at(e, 4)); p.put(m, 2, at(e, 3)); } : undefined));
      back = tab ? withBelt(layer(cloth(tab, 3), (p) => p.vline(Math.floor(tw / 2) - 1, 0, th, at(trim, 3)))) : withBelt(mail(metal));
      side = withBelt(mail(metal));
      break;
    }
    case "fur": {
      front = withBelt(layer(cloth(S, 4), (p) => { const m = Math.floor(tw / 2); p.put(m - 2, 2, at(S, 3)); p.put(m + 1, 2, at(S, 3)); p.vline(m, 3, 2, at(S, 3)); }, (p) => { for (let y = 0; y < p.height; y++) for (const x of [0, 1, 2, tw - 3, tw - 2, tw - 1]) p.set(x, y, (x + y) % 3 === 0 ? at(r, 2) : at(r, x === 1 || x === tw - 2 ? 4 : 3)); }, rows(0, 0, at(r, 4))));
      back = withBelt(fur(r, 3));
      side = withBelt(fur(r, 3));
      break;
    }
    case "bare": {
      front = withBelt(layer(cloth(S, 3), (p) => { const m = Math.floor(tw / 2); p.hline(m - 3, 2, 2, at(S, 2)); p.hline(m + 1, 2, 2, at(S, 2)); p.vline(m - 1, 3, th - 4, at(S, 2)); p.put(m - 2, 4, at(S, 2)); p.put(m + 1, 4, at(S, 2)); p.hline(0, 0, tw, at(S, 4)); p.hline(m - 3, 1, 6, at(S, 4)); }));
      back = withBelt(layer(cloth(S, 3), (p) => p.vline(Math.floor(tw / 2) - 1, 1, th - 2, at(S, 2))));
      side = withBelt(cloth(S, 3));
      break;
    }
    case "leather": {
      front = withBelt(layer(cloth(r, 3), (p) => { const m = Math.floor(tw / 2) - 1; for (let y = 0; y < th - 2; y++) p.put(m + (y % 2), y, at(trim, 5)); p.hline(0, 0, tw, at(r, 4)); }));
      back = withBelt(cloth(r, 3));
      side = withBelt(cloth(r, 3));
      break;
    }
    case "coat": {
      const under = full(t.under ?? WHITE_CLOTH);
      front = withBelt(layer(cloth(r, 3), (p) => { const m = Math.floor(tw / 2); p.box(m - 1, 0, 2, th, at(under, 4)); p.vline(m - 2, 0, th, at(trim, 3)); p.vline(m + 1, 0, th, at(trim, 3)); for (let y = 1; y < th; y += 2) p.put(m + 2, y, at(GOLD, 4)); }));
      back = withBelt(cloth(r, 3));
      side = withBelt(cloth(r, 3));
      break;
    }
    case "rags": {
      const rag = layer(cloth(r, 3), (p) => { for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x * 7 + y * 3) % 11 === 0) p.put(x, y, at(S, 3)); });
      front = withBelt(rag);
      back = rag;
      side = rag;
      break;
    }
  }
  // An amulet's chain round the neck to its stone on the chest.
  if (o.amulet) {
    const ch = full(o.amulet.chain);
    const chain: Paint = (p) => { const m = Math.floor(tw / 2); for (let i = 0; i < 3; i++) { p.put(m - 3 + i, i, at(ch, 5)); p.put(m + 2 - i, i, at(ch, 5)); } };
    front = layer(front, chain);
    back = layer(back, rows(0, 0, at(ch, 4)));
  }
  return { front, back, right: side, left: flipX(side), top: cloth(t.style === "bare" || t.style === "fur" ? S : r, 4, false) };
}

function armFaces(o: Person): PartFaces {
  const [, ah] = o.build.arm;
  const S = full(o.skin);
  const t = o.top;
  const sleeveRamp = full(o.sleeve ?? (t.style === "bare" || t.style === "fur" || t.style === "vest" ? o.skin : t.style === "tabard" || t.style === "mail" ? (t.style === "tabard" ? (t.under ?? full(C.IRON)) : t.ramp) : t.ramp));
  const sleeves = o.sleeves ?? (t.style === "bare" || t.style === "fur" || t.style === "vest" ? "none" : t.style === "rags" ? "short" : "long");
  const gl = o.gloves ? full(o.gloves.ramp) : null;
  const hand = 2;
  const metal = t.style === "plate" || t.style === "mail" || t.style === "tabard";
  const paint = (lit: boolean): Paint =>
    layer(
      sleeves === "none" ? cloth(S, 4) : metal && t.style !== "plate" ? mail(sleeveRamp) : cloth(sleeveRamp, 3),
      lit ? rows(0, 0, at(sleeves === "none" ? S : sleeveRamp, sleeves === "none" ? 5 : 4)) : undefined,
      t.style === "plate" ? (p) => { for (let y = 2; y < ah - hand; y += 3) p.hline(0, y, p.width, at(sleeveRamp, 2)); } : undefined,
      sleeves === "short" ? rows(3, ah - 1, at(S, 4)) : undefined,
      sleeves === "long" && !metal ? rows(ah - hand - 1, ah - hand - 1, at(t.trim ? full(t.trim) : WHITE_CLOTH, 3)) : undefined,
      rows(ah - hand, ah - 1, at(gl ?? S, 4)),
      rows(ah - 1, ah - 1, at(gl ?? S, 3)),
      sleeves === "none" && (t.style === "fur" || t.style === "bare") ? rows(0, 1, at(full(t.ramp), 3)) : undefined,
    );
  return { front: paint(true), back: paint(false), left: paint(false), top: cloth(sleeves === "none" ? S : sleeveRamp, 4, false), bottom: cloth(gl ?? S, 3, false) };
}

function legFacesOf(o: Person): PartFaces {
  const [, lh] = o.build.leg;
  const trousers = full(o.legs ?? o.skin);
  const boot = full(o.boots?.ramp ?? full(C.WOOD));
  const from = o.boots ? Math.max(1, lh - (o.boots.height ?? 3)) : lh;
  const paint = (front: boolean): Paint =>
    layer(cloth(trousers, 2), (p) => {
      for (let y = from; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          let c = at(boot, 2);
          if (y === from) c = at(boot, 3);
          if (y === p.height - 1) c = at(boot, 0);
          if (front && y === p.height - 2 && x > 0 && x < p.width - 1) c = at(boot, 4);
          p.set(x, y, c);
        }
      }
    });
  return { front: paint(true), back: paint(false), left: paint(false), top: cloth(trousers, 2, false), bottom: cloth(boot, 0, false) };
}

/** A person as a figure. */
export function person(o: Person): FigureSpec {
  const [tw, th, td] = o.build.torso;
  const [lw, lh, ld] = o.build.leg;
  const [aw, ah, ad] = o.build.arm;
  const [hw, hh, hd] = o.build.head;
  const gap = tw / 2 - lw;
  const legY = o.noLegs ? (o.perch ?? 0) : lh;
  const S = full(o.skin);
  const head = headParts(o);
  const parts: PartSpec[] = [];
  if (!o.noLegs) {
    const lf = legFacesOf(o);
    parts.push(part("leg.l", o.build.leg, [gap / 2 + lw / 2, lh, 0], [-lw / 2, -lh, -ld / 2], lf, at(full(o.legs ?? o.skin), 2)));
    parts.push(part("leg.r", o.build.leg, [-gap / 2 - lw / 2, lh, 0], [-lw / 2, -lh, -ld / 2], lf, at(full(o.legs ?? o.skin), 2)));
  }
  parts.push(part("torso", o.build.torso, [0, legY, 0], [-tw / 2, 0, -td / 2], topFaces(o), at(full(o.top.ramp), 3)));
  const af = armFaces(o);
  parts.push(part("arm.l", o.build.arm, [tw / 2 + aw / 2, th - 1, 0], [-aw / 2, -ah + 1, -ad / 2], af, at(full(o.top.ramp), 3), { parent: "torso" }));
  parts.push(part("arm.r", o.build.arm, [-tw / 2 - aw / 2, th - 1, 0], [-aw / 2, -ah + 1, -ad / 2], af, at(full(o.top.ramp), 3), { parent: "torso" }));
  const tilt = o.headTilt ?? 0;
  parts.push(part("head", o.build.head, tilt ? [0, th - 1, 1] : [0, th, 0], [-hw / 2, 0, -hd / 2], head.faces, at(S, 4), { parent: "torso", ...(tilt ? { tilt: [tilt, 0] as const } : {}) }));
  parts.push(...head.parts);

  // A robe's or a dress's skirt over the legs, flaring at its hem.
  if (o.skirt) {
    const sr = full(o.skirt.ramp);
    const tr = o.skirt.trim ? full(o.skirt.trim) : sr;
    const len = o.skirt.length ?? Math.max(2, lh - 1);
    const open = o.skirt.open ? full(o.skirt.open) : null;
    const hem: Paint = layer(cloth(sr, 3), rows(len - 1, len - 1, at(tr, 3)), (p) => { for (let y = 0; y < p.height - 1; y++) if (y % 3 === 1) p.put(Math.floor(p.width / 2) - 2, y, at(sr, 2)); }, open ? (p) => { const m = Math.floor(p.width / 2); p.box(m - 1, 0, 2, p.height, at(open, 3)); } : undefined, o.skirt.ragged ? ragged(3, 1) : undefined);
    parts.push(part("skirt", [tw + 1, len, td + 1], [0, 0, 0], [-(tw + 1) / 2, -len, -(td + 1) / 2], { front: hem, back: layer(cloth(sr, 2), rows(len - 1, len - 1, at(tr, 2)), o.skirt.ragged ? ragged(3, 1) : undefined), left: hem, right: hem, top: cloth(sr, 3, false), bottom: cutTo(() => false) }, at(sr, 3), { parent: "torso", round: 0.6 }));
    if (len >= 3) parts.push(part("skirt.hem", [tw + 3, 2, td + 3], [0, -len, 0], [-(tw + 3) / 2, 0, -(td + 3) / 2], { front: layer(cloth(sr, 3), rows(0, 0, at(sr, 4)), rows(1, 1, at(tr, 3)), open ? (p) => { const m = Math.floor(p.width / 2); p.box(m - 1, 0, 2, 2, at(open, 3)); } : undefined, o.skirt.ragged ? ragged(2, 1) : undefined), left: layer(cloth(sr, 3), rows(1, 1, at(tr, 3))), back: layer(cloth(sr, 2), rows(1, 1, at(tr, 2))), top: cloth(sr, 4, false), bottom: cutTo(() => false) }, at(sr, 3), { parent: "torso", round: 0.6 }));
  }

  // A cape hung from the shoulders, swinging out as it walks.
  if (o.cape) {
    const cr = full(o.cape.ramp);
    const tr = o.cape.trim ? full(o.cape.trim) : cr;
    const len = o.cape.length ?? th + legY - 1;
    const cw = o.cape.wide ? tw + 2 : tw;
    parts.push(part("cape", [cw, len, 1], [0, th, -td / 2 - 0.5], [-cw / 2, -len, -1], { front: cloth(cr, 2), back: layer(cloth(cr, 3), (p) => { for (let x = 3; x < p.width - 1; x += 4) p.vline(x, 1, len, at(cr, 2)); }, rows(0, 0, at(tr, 3)), rows(len - 1, len - 1, at(tr, 2)), o.cape.ragged ? ragged(3, 2) : undefined), left: cloth(cr, 3) }, at(cr, 3), { parent: "torso" }));
    if (o.cape.collar) parts.push(part("cape.collar", [tw + 2, 3, td + 2], [0, th - 1, 0], [-(tw + 2) / 2, 0, -(td + 2) / 2], { front: layer(cloth(tr, 3), cutTo((x, y, w) => Math.abs(x - (w - 1) / 2) > 2 || y > 1)), left: cloth(tr, 3), back: cloth(tr, 3), top: cutTo((x, y, w, h) => x === 0 || y === 0 || x === w - 1 || y === h - 1), bottom: cutTo(() => false) }, at(tr, 3), { parent: "torso", round: 0.5 }));
  }

  // Pauldrons on the shoulders, gauntlets at the hands, boots over the feet.
  if (o.pauldrons) {
    const pr = full(o.pauldrons.ramp);
    const tr = o.pauldrons.trim ? full(o.pauldrons.trim) : pr;
    const paint: Paint = o.pauldrons.fur ? fur(pr, 3) : layer(plates(pr, 2, 4), rows(2, 2, at(tr, 3)));
    for (const arm of ["arm.l", "arm.r"]) parts.push(part(`${arm}.pauldron`, [aw + 2, 3, ad + 2], [0, 1, 0], [-(aw + 2) / 2, -1.5, -(ad + 2) / 2], { front: paint, back: paint, left: paint, right: paint, top: o.pauldrons.fur ? fur(pr, 4) : layer(cloth(pr, 5, false), rows(0, 0, at(tr, 4))) }, at(pr, 4), { parent: arm, round: 1 }));
  }
  if (o.gloves) {
    const gr = full(o.gloves.ramp);
    const tr = o.gloves.trim ? full(o.gloves.trim) : gr;
    const paint: Paint = layer(cloth(gr, 3), rows(0, 0, at(tr, 4)), rows(2, 2, at(gr, 2)));
    for (const arm of ["arm.l", "arm.r"]) parts.push(part(`${arm}.glove`, [aw + 1, 3, ad + 1], [0, -ah + 1, 0], [-(aw + 1) / 2, 0, -(ad + 1) / 2], { front: paint, back: paint, left: paint, right: paint, top: cloth(tr, 4, false), bottom: cloth(gr, 2, false) }, at(gr, 3), { parent: arm, round: 0.8 }));
  }
  if (o.boots && !o.noLegs) {
    const br = full(o.boots.ramp);
    const tr = o.boots.trim ? full(o.boots.trim) : br;
    const bh = Math.min(lh - 1, o.boots.height ?? 3);
    const paint = (front: boolean): Paint => layer(cloth(br, 3), rows(0, 0, at(tr, 4)), rows(bh - 1, bh - 1, at(br, 1)), front ? (p) => p.hline(1, bh - 2, p.width - 2, at(br, 5)) : undefined);
    const big = o.boots.big ? 1 : 0;
    for (const leg of ["leg.l", "leg.r"]) parts.push(part(`${leg}.boot`, [lw + 1 + big, bh, ld + 2 + big], [0, -lh, 0], [-(lw + 1 + big) / 2, 0, -(ld + 1) / 2], { front: paint(true), back: paint(false), left: paint(false), right: paint(false), top: cloth(tr, 4, false), bottom: cloth(br, 0, false) }, at(br, 3), { parent: leg, round: 0.8 }));
  }

  // The amulet's stone, the rings' stones (glowing), and the relic floating at the shoulder.
  if (o.amulet) {
    const gem = full(o.amulet.gem);
    const ch = full(o.amulet.chain);
    parts.push(part("amulet", [3, 3, 1], [0, th - 3, td / 2], [-1.5, -1.5, 0], { front: layer(cloth(ch, 4), (p) => { p.put(1, 1, at(gem, 5)); p.put(1, 0, at(gem, 6)); p.put(0, 1, at(gem, 4)); p.put(2, 1, at(gem, 3)); p.put(1, 2, at(gem, 3)); p.put(0, 0, 0, 0); p.put(2, 0, 0, 0); }) }, at(ch, 4), { parent: "torso", round: 0 }));
  }
  for (const [side, arm, ring] of [["r", "arm.r", o.rings?.r], ["l", "arm.l", o.rings?.l]] as const) {
    if (!ring) continue;
    const gem = full(ring.gem);
    const band = full(ring.band);
    parts.push(part(`ring.${side}`, [aw + 1, 1, ad + 1], [0, -ah + 2.5, 0], [-(aw + 1) / 2, 0, -(ad + 1) / 2], { front: layer(cloth(band, 5), (p) => p.put(Math.floor(p.width / 2), 0, at(gem, 6))), left: cloth(band, 4), right: cloth(band, 4), back: cloth(band, 3) }, at(band, 4), { parent: arm, round: 0 }));
    parts.push(part(`ring.${side}.gem`, [2, 2, 2], [0, -ah + 3, ad / 2 + 0.2], [-1, -1, -0.5], { front: glowing(gem), left: glowing(gem), right: glowing(gem), top: glowing(gem) }, at(gem, 6), { parent: arm, glow: true, round: 0 }));
  }
  if (o.relic) {
    const body = full(o.relic.body);
    const gem = full(o.relic.gem);
    const y = legY + th + hh * 0.6;
    parts.push(part("relic", [4, 5, 2], [tw / 2 + aw + 5, y, -2], [-2, -2.5, -1], { front: layer(cloth(body, 4), (p) => { p.put(0, 0, 0, 0); p.put(3, 0, 0, 0); p.put(0, 4, 0, 0); p.put(3, 4, 0, 0); p.hline(1, 0, 2, at(body, 6)); }), back: cloth(body, 3), left: cloth(body, 3), top: cloth(body, 5, false) }, at(body, 4), { round: 0.5, motion: { kind: "orbit", radius: 2.5, rate: 0.9 } }));
    parts.push(part("relic.gem", [2, 3, 3], [0, 0, 0], [-1, -1.5, -1.5], { front: glowing(gem), back: glowing(gem), left: glowing(gem), top: glowing(gem) }, at(gem, 6), { parent: "relic", glow: true, round: 0 }));
  }

  if (o.right) parts.push(...heldParts(o.right, "arm.r", o.build.arm, -1));
  if (o.left) parts.push(...heldParts(o.left, "arm.l", o.build.arm, 1));
  parts.push(sparkPart(full(o.spark ?? ARCANE), th, hh));
  if (o.extras) parts.push(...o.extras);

  return {
    name: o.name,
    parts: shapeHead(parts, o.headShape ?? HEAD),
    stride: o.stride ?? (o.skirt && (o.skirt.length ?? lh) >= lh - 1 ? 0.35 : 0.7),
    armSwing: o.armSwing ?? 0.6,
    hunch: o.hunch,
    hover: o.hover,
    footprint: o.footprint ?? Math.max(0.42, (tw + 2 * aw) / 40),
  };
}

