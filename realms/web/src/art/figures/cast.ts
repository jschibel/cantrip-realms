import * as C from "../paint/colors";
import type { Palette, Ramp } from "../paint/palette";
import type { Rgb } from "../paint/pixmap";
import { sprite } from "../paint/sprite";
import { cloth, hairAll, hairCrown, hairRows, layer, rows, spikes, stamp } from "./faces";
import { BONE_EYE, type FigureSpec, GHOUL_EYE, type Paint, type PartFaces, type PartSpec, shapeHead } from "./rig";

// The cast: each figure's rig of parts and the paint on every face, from its palette's ramps (FIGURES in index.ts
// names each slot a figure reads and its default). A palette recolors a figure - a darker-haired hero, a goblin in a
// red vest - and leaves its shape and drawing alone.

const pick = (pal: Palette, slot: string, fallback: Ramp): Ramp => pal[slot] ?? fallback;

const K = C.INK;
const WHITE = 0xffffff;

/** A humanoid's skeleton of parts: legs, torso, arms and head of the given sizes, standing on y = 0. */
function humanoid(o: {
  head: readonly [number, number, number];
  torso: readonly [number, number, number];
  arm: readonly [number, number, number];
  leg: readonly [number, number, number];
  faces: Record<string, PartFaces>;
  fills: Record<string, Rgb>;
  headLift?: number;
}): PartSpec[] {
  const [tw, th, td] = o.torso;
  const [lw, lh, ld] = o.leg;
  const [aw, ah, ad] = o.arm;
  const [hw, hh, hd] = o.head;
  const gap = tw / 2 - lw;
  return [
    { name: "leg.l", size: o.leg, at: [gap / 2 + lw / 2, lh, 0], box: [-lw / 2, -lh, -ld / 2], faces: o.faces.leg ?? {}, fill: o.fills.leg! },
    { name: "leg.r", size: o.leg, at: [-gap / 2 - lw / 2, lh, 0], box: [-lw / 2, -lh, -ld / 2], faces: o.faces.leg ?? {}, fill: o.fills.leg! },
    { name: "torso", size: o.torso, at: [0, lh, 0], box: [-tw / 2, 0, -td / 2], faces: o.faces.torso ?? {}, fill: o.fills.torso! },
    { name: "arm.l", parent: "torso", size: o.arm, at: [tw / 2 + aw / 2, th - 1, 0], box: [-aw / 2, -ah + 1, -ad / 2], faces: o.faces.arm ?? {}, fill: o.fills.arm! },
    { name: "arm.r", parent: "torso", size: o.arm, at: [-tw / 2 - aw / 2, th - 1, 0], box: [-aw / 2, -ah + 1, -ad / 2], faces: o.faces.armR ?? o.faces.arm ?? {}, fill: o.fills.arm! },
    { name: "head", parent: "torso", size: o.head, at: [0, th + (o.headLift ?? 0), 0], box: [-hw / 2, 0, -hd / 2], faces: o.faces.head ?? {}, fill: o.fills.head! },
  ];
}

/** A boot: leg cloth above, a boot below with a lit toe. */
function legFaces(trousers: readonly Rgb[], boot: readonly Rgb[], bootFrom: number): PartFaces {
  const paint = (front: boolean): Paint =>
    layer(cloth(trousers, 2), (p) => {
      for (let y = bootFrom; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          let c = boot[2]!;
          if (y === bootFrom) c = boot[3]!;
          if (y === p.height - 1) c = boot[0]!;
          if (front && y === p.height - 2 && x > 0 && x < p.width - 1) c = boot[4] ?? boot[3]!;
          p.set(x, y, c);
        }
      }
    });
  return { front: paint(true), back: paint(false), left: paint(false), top: cloth(trousers, 2, false), bottom: cloth(boot, 0, false) };
}

/** The hero: red spiky hair, a blue tunic with a belt, a red cape, brown boots. */
export function hero(pal: Palette = {}): FigureSpec {
  const S = pick(pal, "skin", C.SKIN);
  const hair = pick(pal, "hair", C.HAIR_RED);
  const tunic = pick(pal, "tunic", C.BLUE);
  const cape = pick(pal, "cape", C.RED);
  const trousers = pick(pal, "trousers", C.SLATE);
  const boots = pick(pal, "boots", C.WOOD);
  const face: Paint = layer(
    cloth(S, 4, false),
    stamp(
      [
        "............",
        "............",
        "............",
        "...........",
        "..hh....hh..",
        "..wK....Kw..",
        "..KK....KK..",
        ".r........r.",
        ".....mm.....",
        "ssssssssssss",
      ],
      { h: hair[2]!, w: WHITE, K, r: C.PINK[3]!, m: S[2]!, s: S[3]! },
      0,
      0,
    ),
    hairRows(hair, (x) => (x === 0 || x === 11 ? 7 : x % 3 === 0 ? 4 : 3)),
  );
  const side: Paint = layer(cloth(S, 4, false), hairRows(hair, (x) => (x < 4 ? 10 : x < 6 ? 5 : 4)), stamp(["ee", "Ee"], { e: S[3]!, E: S[2]! }, 5, 5));
  const back: Paint = layer(hairAll(hair), rows(9, 9, hair[1]!));
  const capFront: Paint = layer(hairAll(hair), spikes(4, 3), (p) => {
    for (let x = 0; x < p.width; x++) p.put(x, p.height - 1, x % 3 === 1 ? 0 : hair[2]!, x % 3 === 1 ? 0 : 255);
  });
  const capSide: Paint = layer(hairAll(hair), spikes(3, 3));
  const torso: PartFaces = {
    front: layer(
      cloth(tunic, 3),
      stamp([".wWWWWw.", "..wWWw..", "...ww..."], { w: C.CLOTH_WHITE[3]!, W: C.CLOTH_WHITE[4]! }, 1, 0),
      rows(5, 5, C.WOOD[2]!),
      stamp(["gG"], { g: C.GOLD[3]!, G: C.GOLD[4]! }, 4, 5),
      (p) => p.put(0, 1, tunic[4]!),
    ),
    back: layer(cloth(tunic, 3), rows(5, 5, C.WOOD[2]!)),
    left: layer(cloth(tunic, 3), rows(5, 5, C.WOOD[2]!)),
    top: cloth(tunic, 4, false),
  };
  const arm: PartFaces = {
    front: layer(cloth(tunic, 3), rows(0, 0, tunic[4]!), rows(4, 4, C.CLOTH_WHITE[3]!), rows(5, 7, S[4]!), rows(7, 7, S[3]!)),
    left: layer(cloth(tunic, 3), rows(4, 4, C.CLOTH_WHITE[3]!), rows(5, 7, S[4]!), rows(7, 7, S[3]!)),
    top: cloth(tunic, 4, false),
    bottom: cloth(S, 3, false),
  };
  const parts = humanoid({
    head: [12, 10, 10],
    torso: [10, 7, 6],
    arm: [3, 8, 3],
    leg: [4, 5, 4],
    headLift: 0,
    faces: { head: { front: face, left: side, right: side, back, top: hairCrown(hair) }, torso, arm, leg: legFaces(trousers, boots, 2) },
    fills: { head: S[4]!, torso: tunic[3]!, arm: tunic[3]!, leg: trousers[2]! },
  });
  parts.push({ name: "hair", parent: "head", size: [13, 5, 11], at: [0, 7, 0], box: [-6.5, 0, -6.75], faces: { front: capFront, left: capSide, back: capSide, top: hairCrown(hair) }, fill: hair[3]!, round: 2.4, shape: { steps: 3, jaw: 0, dome: 0.55, back: 0.1 } });
  parts.push({
    name: "cape",
    parent: "torso",
    size: [10, 11, 1],
    at: [0, 7, -3.5],
    box: [-5, -11, -1],
    faces: { front: cloth(cape, 2), back: layer(cloth(cape, 3), (p) => p.vline(3, 0, 11, cape[2]!), (p) => p.vline(7, 0, 11, cape[2]!), rows(0, 0, C.GOLD[3]!)) },
    fill: cape[3]!,
  });
  return { name: "hero", parts: shapeHead(parts) };
}

/** A knight of Benalia: a closed helm with a blue plume, white and gold tabard over mail, a kite shield, a spear. */
export function knight(pal: Palette = {}): FigureSpec {
  const iron = pick(pal, "iron", C.IRON);
  const helmFront: Paint = layer(
    cloth(iron, 4),
    rows(0, 0, iron[5]!),
    rows(4, 4, K),
    rows(5, 5, iron[2]!),
    (p) => {
      p.vline(5, 1, 3, iron[6]!);
      p.vline(6, 1, 3, iron[3]!);
      for (const x of [3, 8]) p.put(x, 7, K);
      for (const x of [2, 9]) p.put(x, 7, iron[2]!);
      p.hline(0, p.height - 1, p.width, iron[2]!);
    },
  );
  const helmSide: Paint = layer(cloth(iron, 3), rows(0, 0, iron[5]!), (p) => p.put(1, 4, K), (p) => p.put(2, 4, K), rows(9, 9, iron[2]!));
  const tabard: Paint = layer(
    cloth(iron, 3),
    (p) => {
      for (let y = 0; y < p.height; y++) for (let x = 2; x < p.width - 2; x++) p.set(x, y, C.CLOTH_WHITE[x === 2 ? 4 : 3]!);
      p.vline(4, 0, p.height, C.BLUE[3]!);
      p.vline(5, 0, p.height, C.BLUE[2]!);
      p.hline(2, 2, p.width - 4, C.BLUE[3]!);
      p.put(4, 2, C.GOLD[4]!);
      p.put(5, 2, C.GOLD[3]!);
    },
    rows(5, 5, C.WOOD[2]!),
    stamp(["G"], { G: C.GOLD[4]! }, 7, 5),
  );
  const mail: Paint = layer(cloth(iron, 3), (p) => {
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y) % 2 === 0) p.set(x, y, iron[2]!);
  }, rows(0, 1, iron[5]!));
  const parts = humanoid({
    head: [12, 10, 11],
    torso: [10, 7, 6],
    arm: [3, 8, 3],
    leg: [4, 5, 4],
    faces: {
      head: { front: helmFront, left: helmSide, back: layer(cloth(iron, 3), rows(0, 0, iron[5]!)), top: layer(cloth(iron, 4, false), (p) => p.vline(5, 0, p.height, iron[6]!)) },
      torso: { front: tabard, back: layer(cloth(C.CLOTH_WHITE, 3), (p) => p.vline(4, 0, p.height, C.BLUE[3]!)), left: mail, top: cloth(iron, 4, false) },
      arm: { front: layer(mail, rows(6, 7, iron[4]!)), left: mail, top: cloth(iron, 5, false) },
      leg: legFaces(iron, C.IRON, 2),
    },
    fills: { head: iron[4]!, torso: iron[3]!, arm: iron[3]!, leg: iron[3]! },
  });
  parts.push({ name: "plume", parent: "head", size: [2, 5, 9], at: [0, 10, 0], box: [-1, -1, -5], faces: { left: layer(cloth(C.BLUE, 3), rows(0, 0, C.BLUE[5]!), spikes(3, 2)), top: cloth(C.BLUE, 4, false), front: cloth(C.BLUE, 4) }, fill: C.BLUE[3]!, tilt: [-0.15, 0] });
  parts.push({
    name: "shield",
    parent: "arm.l",
    size: [1, 10, 8],
    at: [2, -3, 0],
    box: [0, -5, -4],
    faces: {
      left: layer(cloth(C.BLUE, 3), (p) => {
        for (let y = 0; y < p.height; y++) {
          for (let x = 0; x < p.width; x++) {
            const kite = Math.abs(x - 3.5) <= Math.min(4, (p.height - y) * 0.75);
            if (!kite) p.put(x, y, 0, 0);
            else if (x === 0 || y === 0 || Math.abs(x - 3.5) > Math.min(4, (p.height - y) * 0.75) - 1) p.put(x, y, C.GOLD[3]!);
          }
        }
        p.blit(sprite(["..g..", ".gGg.", "gGWGg", ".gGg.", "..g.."], { g: C.GOLD[2]!, G: C.GOLD[3]!, W: C.GOLD[5]! }), 1, 2);
      }),
      right: cloth(C.WOOD, 3),
      front: cloth(C.GOLD, 3),
      top: cloth(C.GOLD, 4, false),
    },
    fill: C.GOLD[3]!,
  });
  parts.push({
    name: "spear",
    parent: "arm.r",
    size: [1, 30, 1],
    at: [0, -6, 1.5],
    box: [-0.5, -6, -0.5],
    faces: { front: layer(cloth(C.WOOD, 4), rows(0, 3, iron[5]!), rows(0, 0, iron[6]!)), left: layer(cloth(C.WOOD, 3), rows(0, 3, iron[4]!)), top: cloth(iron, 6, false) },
    fill: C.WOOD[4]!,
  });
  return { name: "knight", parts: shapeHead(parts, { steps: 3, jaw: 0.1, dome: 0.1, back: 0.08 }), stride: 0.6, armSwing: 0.35 };
}

/** Grizzlegom: a goblin shopkeeper, green and grinning, with ears out to here, a purple vest and gold buttons. */
export function goblin(vendor = true, pal: Palette = {}): FigureSpec {
  const g = pick(pal, "skin", C.GOBLIN);
  const vest = pick(pal, "vest", vendor ? C.PURPLE : C.WOOD);
  const face: Paint = layer(
    cloth(g, 4, false),
    stamp(
      [
        "..............",
        ".hh........hh.",
        "..bb......bb..",
        "..YYK....KYY..",
        "..YKK....KKY..",
        "..............",
        ".mWmWmWmWmWm..",
        "..mmmmmmmmm...",
        "..............",
        "gggggggggggggg",
      ],
      { h: g[1]!, b: g[2]!, Y: C.GOLD[4]!, K, m: C.RED[1]!, W: 0xfff8e0, g: g[3]! },
      0,
      1,
    ),
    rows(0, 0, g[5]!),
  );
  const side: Paint = layer(cloth(g, 3, false), rows(0, 0, g[5]!));
  const ear: Paint = layer(cloth(g, 4), (p) => {
    p.hline(0, 0, p.width, g[5]!);
    p.put(p.width - 1, 0, 0, 0);
    p.put(p.width - 1, p.height - 1, 0, 0);
    p.hline(1, 1, p.width - 2, C.PINK[2]!);
  });
  const torso: PartFaces = {
    front: layer(cloth(vendor ? C.CLOTH_WHITE : C.WOOD, 3), (p) => {
      for (let y = 0; y < p.height; y++) {
        for (const x of [0, 1, 2, p.width - 3, p.width - 2, p.width - 1]) p.set(x, y, vest[x < 2 || x > p.width - 3 ? 3 : 2]!);
      }
      for (const y of [1, 3, 5]) p.put(3, y, C.GOLD[4]!);
    }, rows(6, 6, vest[1]!)),
    back: cloth(vest, 3),
    left: cloth(vest, 3),
    top: cloth(vest, 4, false),
  };
  const arm: PartFaces = { front: layer(cloth(g, 3), rows(0, 2, vendor ? C.CLOTH_WHITE[3]! : C.WOOD[3]!), rows(5, 6, g[4]!)), top: cloth(C.CLOTH_WHITE, 3, false) };
  const parts = humanoid({
    head: [14, 10, 10],
    torso: [9, 7, 6],
    arm: [3, 7, 3],
    leg: [3, 4, 3],
    faces: {
      head: { front: face, left: side, back: layer(cloth(g, 3), stamp(["h h", " h "], { h: g[1]! }, 5, 1)), top: layer(cloth(g, 4, false), stamp(["hh.h", ".hh."], { h: g[1]! }, 5, 3)) },
      torso,
      arm,
      leg: legFaces(C.WOOD, C.DARKWOOD, 2),
    },
    fills: { head: g[4]!, torso: vest[3]!, arm: g[3]!, leg: C.WOOD[3]! },
  });
  parts.push({ name: "ear.l", parent: "head", size: [7, 3, 2], at: [7, 6, 0], box: [0, -1, -1], faces: { front: ear, back: ear, top: cloth(g, 5, false) }, fill: g[4]!, tilt: [0, 0.35] });
  parts.push({ name: "ear.r", parent: "head", size: [7, 3, 2], at: [-7, 6, 0], box: [-7, -1, -1], faces: { front: ear, back: ear, top: cloth(g, 5, false) }, fill: g[4]!, tilt: [0, -0.35] });
  parts.push({ name: "nose", parent: "head", size: [3, 3, 3], at: [0, 4, 5], box: [-1.5, -1, 0], faces: { front: layer(cloth(g, 4), rows(0, 0, g[5]!)), top: cloth(g, 5, false) }, fill: g[4]!, tilt: [0.3, 0] });
  if (vendor) {
    parts.push({ name: "hat", parent: "head", size: [8, 4, 6], at: [0, 9.5, -0.5], box: [-4, 0, -3], faces: { front: layer(cloth(C.RED, 3), rows(3, 3, C.GOLD[3]!), rows(0, 0, C.RED[4]!)), left: layer(cloth(C.RED, 2), rows(3, 3, C.GOLD[2]!)), top: layer(cloth(C.RED, 4, false), stamp(["G"], { G: C.GOLD[4]! }, 3, 2)) }, fill: C.RED[3]!, round: 1.5 });
  }
  return { name: vendor ? "grizzlegom" : "goblin", parts: shapeHead(parts, { steps: 3, jaw: 0.08, dome: 0.06, back: 0.1 }), stride: 0.9, armSwing: 0.9 };
}

/** A skeleton warrior: a grinning skull with red pin-prick eyes, a ribcage, bare bones and a notched sword. */
export function skeleton(pal: Palette = {}): FigureSpec {
  const b = pick(pal, "bone", C.BONE);
  const skull: Paint = layer(
    cloth(b, 4, false),
    stamp(
      [
        "..........",
        "..........",
        ".KKK..KKK.",
        ".KRK..KRK.",
        ".KKK..KKK.",
        "....KK....",
        ".bWbWbWbW.",
        "..WbWbWb..",
        "...bbbb...",
      ],
      { K, R: BONE_EYE, W: b[5]!, b: b[2]! },
      0,
      0,
    ),
    rows(0, 0, b[5]!),
  );
  const ribs: Paint = (p) => {
    p.fill(0, 0);
    for (let y = 0; y < p.height; y++) {
      p.put(Math.floor(p.width / 2), y, b[3]!);
      if (y % 2 === 0 && y < p.height - 2) for (let x = 1; x < p.width - 1; x++) p.put(x, y, x === 1 ? b[5]! : b[4]!);
    }
    p.hline(1, p.height - 1, p.width - 2, b[3]!);
    p.hline(1, p.height - 2, p.width - 2, b[2]!);
  };
  const bone: Paint = layer(cloth(b, 4), (p) => p.vline(p.width - 1, 0, p.height, b[2]!), rows(0, 0, b[5]!));
  const parts = humanoid({
    head: [10, 9, 10],
    torso: [8, 7, 5],
    arm: [2, 8, 2],
    leg: [2, 6, 2],
    faces: {
      head: { front: skull, left: layer(cloth(b, 3, false), stamp(["KK"], { K }, 3, 4)), back: cloth(b, 3), top: layer(cloth(b, 4, false), (p) => p.vline(4, 0, p.height, b[2]!)) },
      torso: { front: ribs, back: ribs, left: ribs, top: cloth(b, 4, false) },
      arm: { front: bone, left: bone, top: cloth(b, 5, false) },
      leg: { front: bone, left: bone, top: cloth(b, 5, false), bottom: cloth(b, 2, false) },
    },
    fills: { head: b[4]!, torso: b[4]!, arm: b[4]!, leg: b[4]! },
  });
  parts.push({ name: "pelvis", size: [6, 2, 3], at: [0, 6, 0], box: [-3, -1, -1.5], faces: { front: layer(cloth(b, 4), rows(0, 0, b[5]!)) }, fill: b[4]! });
  parts.push({
    name: "sword",
    parent: "arm.r",
    size: [1, 3, 16],
    at: [0, -6, 0],
    box: [-0.5, -1, 0],
    faces: {
      left: layer(cloth(C.IRON, 4), (p) => {
        p.hline(0, 0, p.width, C.IRON[5]!);
        for (let x = 0; x < 4; x++) p.vline(x, 0, p.height, C.WOOD[3]!);
        p.vline(4, 0, p.height, C.GOLD[2]!);
        p.put(9, 2, C.FIRE[0]!);
        p.put(12, 0, C.IRON[1]!);
      }),
      top: layer(cloth(C.IRON, 5, false), (p) => p.box(0, 0, 1, 4, C.WOOD[3]!)),
    },
    fill: C.IRON[4]!,
  });
  return { name: "skeleton", parts: shapeHead(parts, { steps: 3, jaw: 0.22, dome: 0.1, back: 0.12 }), stride: 0.8, armSwing: 0.5 };
}

/** A ghoul: hunched and grey-green, with sunken glowing eyes, ragged clothes and long clawed arms. */
export function ghoul(pal: Palette = {}): FigureSpec {
  const g = pick(pal, "skin", C.GHOUL);
  const rag = pick(pal, "rags", C.DARKWOOD);
  const face: Paint = layer(
    cloth(g, 4, false),
    stamp(
      [
        ".hh.h..h.hh",
        "...........",
        ".ddd...ddd.",
        ".dYd...dYd.",
        "...........",
        ".....d.....",
        ".KWKWKWKWK.",
        "..KKKKKKK..",
        "...........",
      ],
      { h: g[1]!, d: g[2]!, Y: GHOUL_EYE, K, W: C.BONE[4]! },
      0,
      0,
    ),
  );
  const ragged: Paint = layer(cloth(rag, 3), (p) => {
    for (let x = 0; x < p.width; x++) if (x % 3 === 1) p.put(x, p.height - 1, 0, 0);
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x * 7 + y * 3) % 11 === 0) p.put(x, y, g[3]!);
  });
  const arm: Paint = layer(cloth(g, 3), rows(0, 2, rag[3]!), (p) => {
    for (let x = 0; x < p.width; x++) p.put(x, p.height - 1, x % 2 ? C.BONE[4]! : K);
  });
  const parts = humanoid({
    head: [11, 9, 10],
    torso: [10, 7, 6],
    arm: [3, 11, 3],
    leg: [3, 5, 3],
    faces: {
      head: { front: face, left: layer(cloth(g, 3, false), rows(0, 1, g[1]!)), back: layer(cloth(g, 3), rows(0, 2, g[1]!)), top: layer(cloth(g, 4, false), stamp(["h.h", ".h."], { h: g[1]! }, 3, 2)) },
      torso: { front: ragged, back: ragged, left: ragged, top: cloth(rag, 4, false) },
      arm: { front: arm, left: arm, top: cloth(rag, 3, false) },
      leg: legFaces(rag, g, 3),
    },
    fills: { head: g[4]!, torso: rag[3]!, arm: g[3]!, leg: rag[3]! },
  });
  const head = parts.find((p) => p.name === "head")!;
  parts[parts.indexOf(head)] = { ...head, tilt: [-0.4, 0], at: [0, 6, 1] };
  return { name: "ghoul", parts: shapeHead(parts), stride: 0.55, armSwing: 0.25, hunch: 0.4 };
}

/** A headscarf from above: cloth with a knot of white dots. */
function scarfTop(ramp: readonly Rgb[]): Paint {
  return (p) => {
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) p.set(x, y, (x + y) % 4 === 0 ? 0xfff4dc : y === p.height - 1 ? ramp[2]! : ramp[3]!);
  };
}

/** A townswoman at the market stall: a headscarf, a green dress, a white apron. */
export function townswoman(pal: Palette = {}): FigureSpec {
  const S = pick(pal, "skin", C.SKIN);
  const hair = pick(pal, "hair", C.HAIR_BROWN);
  const dress = pick(pal, "dress", C.TEAL);
  const scarf = pick(pal, "scarf", C.RED);
  const face: Paint = layer(
    cloth(S, 4, false),
    stamp(
      [
        "............",
        "............",
        "............",
        "............",
        "..hh....hh..",
        "..KK....KK..",
        "..KK....KK..",
        ".r........r.",
        ".....mm.....",
        "ssssssssssss",
      ],
      { h: hair[2]!, K, r: C.PINK[3]!, m: C.RED[3]!, s: S[3]! },
      0,
      0,
    ),
    hairRows(scarf, (x) => (x === 0 || x === 11 ? 8 : 3)),
    (p) => {
      p.put(1, 3, hair[3]!);
      p.put(10, 3, hair[3]!);
    },
  );
  const parts = humanoid({
    head: [12, 10, 10],
    torso: [10, 7, 6],
    arm: [3, 7, 3],
    leg: [4, 5, 4],
    faces: {
      head: { front: face, left: layer(cloth(S, 4, false), hairRows(scarf, (x) => (x < 5 ? 10 : 4))), back: hairAll(scarf), top: scarfTop(scarf) },
      torso: { front: layer(cloth(dress, 3), (p) => p.box(2, 2, 6, 5, C.CLOTH_WHITE[4]!), rows(1, 1, C.CLOTH_WHITE[3]!)), back: layer(cloth(dress, 3), rows(2, 2, C.CLOTH_WHITE[3]!)), left: cloth(dress, 3), top: cloth(dress, 4, false) },
      arm: { front: layer(cloth(dress, 3), rows(5, 6, S[4]!)), top: cloth(dress, 4, false) },
      leg: { front: layer(cloth(dress, 2), (p) => p.box(1, 0, 3, 4, C.CLOTH_WHITE[3]!), rows(4, 4, C.WOOD[1]!)), left: layer(cloth(dress, 2), rows(4, 4, C.WOOD[1]!)) },
    },
    fills: { head: S[4]!, torso: dress[3]!, arm: dress[3]!, leg: dress[2]! },
  });
  return { name: "townswoman", parts: shapeHead(parts), stride: 0.35, armSwing: 0.4 };
}
