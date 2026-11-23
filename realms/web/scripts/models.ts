// Writes realms/content/models/*.vox.json (realms/docs/interfaces.md, "Models"): the four player bodies, the gear
// pieces each slot shows, and the mobs' base models. Each is painted into voxel grids with a few shape helpers - boxes,
// ellipsoids, recolouring by position - at one voxel to a scene pixel, so they read as pixel art in the overworld.
// The output is deterministic; a model may be tuned by hand after, and src/voxel/models.test.ts checks every file.
//
//   npm run models
//
// Axes: x is the model's left (+x) and right (-x), y is up, z is forward (+z): a model faces +z.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AttachPoint, Motion, Vec3, VoxModel, VoxPart } from "../src/voxel/format";

const VOXEL = 1 / 16;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "models");

// ---------------------------------------------------------------------------------------------------------------------
// Painting.

class Grid {
  readonly cells: Int8Array;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly d: number,
  ) {
    this.cells = new Int8Array(w * h * d).fill(-1);
  }

  has(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.h && z < this.d;
  }

  get(x: number, y: number, z: number): number {
    return this.has(x, y, z) ? this.cells[x + this.w * (y + this.h * z)]! : -1;
  }

  set(x: number, y: number, z: number, c: number): this {
    if (this.has(x, y, z)) this.cells[x + this.w * (y + this.h * z)] = c;
    return this;
  }

  /** Fills the box between two corners, both included. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, c);
      }
    }
    return this;
  }

  /** Fills the voxels whose centres lie in an ellipsoid (centre and radii in voxels). */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: number): this {
    return this.each((x, y, z) => {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const dz = (z + 0.5 - cz) / rz;
      return dx * dx + dy * dy + dz * dz <= 1 ? c : undefined;
    });
  }

  /** Calls `fn` on every cell; a number it returns is that cell's new color. */
  each(fn: (x: number, y: number, z: number, now: number) => number | undefined): this {
    for (let z = 0; z < this.d; z++) {
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          const next = fn(x, y, z, this.get(x, y, z));
          if (next !== undefined) this.set(x, y, z, next);
        }
      }
    }
    return this;
  }

  /** Recolors the solid cells `where` picks. */
  paint(c: number, where: (x: number, y: number, z: number, now: number) => boolean): this {
    return this.each((x, y, z, now) => (now >= 0 && where(x, y, z, now) ? c : undefined));
  }

  /** Empties the inside, keeping only cells with an empty or outside neighbour. */
  hollow(): this {
    const keep = this.cells.slice();
    for (let z = 0; z < this.d; z++) {
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (this.get(x, y, z) < 0) continue;
          const inner = [
            [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
          ].every(([a, b, c]) => this.get(x + a!, y + b!, z + c!) >= 0);
          if (inner) keep[x + this.w * (y + this.h * z)] = -1;
        }
      }
    }
    this.cells.set(keep);
    return this;
  }

  /** A copy turned left to right. */
  mirrored(): Grid {
    const g = new Grid(this.w, this.h, this.d);
    this.each((x, y, z, now) => {
      g.set(this.w - 1 - x, y, z, now);
      return undefined;
    });
    return g;
  }

  layers(): string[][] {
    const out: string[][] = [];
    for (let y = 0; y < this.h; y++) {
      const layer: string[] = [];
      for (let z = 0; z < this.d; z++) {
        let row = "";
        for (let x = 0; x < this.w; x++) {
          const c = this.get(x, y, z);
          row += c < 0 ? "." : c.toString(36);
        }
        layer.push(row);
      }
      out.push(layer);
    }
    return out;
  }
}

interface PartSpec {
  readonly parent?: string;
  readonly mount?: AttachPoint;
  readonly pivot: Vec3;
  readonly origin: Vec3;
  readonly motion?: Motion;
  readonly glow?: boolean;
  readonly fit?: Vec3;
}

const part = (name: string, grid: Grid, spec: PartSpec): VoxPart => ({
  name,
  ...(spec.parent !== undefined ? { parent: spec.parent } : {}),
  ...(spec.mount !== undefined ? { mount: spec.mount } : {}),
  pivot: spec.pivot,
  origin: spec.origin,
  ...(spec.motion !== undefined ? { motion: spec.motion } : {}),
  ...(spec.glow ? { glow: true } : {}),
  ...(spec.fit !== undefined ? { fit: spec.fit } : {}),
  size: [grid.w, grid.h, grid.d],
  layers: grid.layers(),
});

// ---------------------------------------------------------------------------------------------------------------------
// Humanoids: the player's bodies and the mobs built like people.

interface Humanoid {
  /** The skull's edge; the head grid adds margins round it for hair, ears, helmets. */
  readonly skull: number;
  readonly headMargin?: { readonly x: number; readonly top: number; readonly z: number };
  readonly torso: Vec3;
  readonly arm: readonly [number, number];
  readonly leg: readonly [number, number];
  /** Palette indexes. */
  readonly colors: {
    readonly skin: number;
    readonly hair?: number;
    readonly cloth: number;
    readonly trim: number;
    readonly leather: number;
    readonly eyes: number;
    readonly trousers: number;
  };
  readonly hair?: "long" | "cropped" | "tail" | "short" | "none";
  /** Shifts the head forward (+z) and down, for a hunch. */
  readonly headShift?: { readonly y: number; readonly z: number };
  readonly paintHead?: (g: Grid, skull: { x: number; z: number; s: number }) => void;
  readonly paintTorso?: (g: Grid) => void;
  readonly paintArm?: (g: Grid, side: "left" | "right") => void;
  readonly paintLeg?: (g: Grid, side: "left" | "right") => void;
}

interface Built {
  readonly parts: VoxPart[];
  readonly attach: NonNullable<VoxModel["attach"]>;
  readonly height: number;
}

function humanoid(spec: Humanoid): Built {
  const s = spec.skull;
  const m = spec.headMargin ?? { x: 0, top: 0, z: 0 };
  const [tw, th, td] = spec.torso;
  const [aw, ah] = spec.arm;
  const [lw, lh] = spec.leg;
  const c = spec.colors;

  // Legs: trousers, boots in the two bottom rows with a toe forward. They hang from the hips and fill the torso's width.
  const leg = (side: "left" | "right") => {
    const g = new Grid(lw, lh, lw + 1);
    g.box(0, 2, 0, lw - 1, lh - 1, lw - 1, c.trousers);
    g.box(0, 0, 0, lw - 1, 1, lw, c.leather);
    spec.paintLeg?.(g, side);
    return g;
  };
  const gap = tw - 2 * lw;
  const legX = gap / 2 + lw / 2;

  // The torso: cloth, a belt with a buckle, a stripe of trim down the front, a neckline.
  const torso = new Grid(tw, th, td);
  torso.box(0, 0, 0, tw - 1, th - 1, td - 1, c.cloth);
  const mid0 = Math.floor((tw - 1) / 2);
  const mid1 = Math.ceil((tw - 1) / 2);
  torso.box(0, 0, 0, tw - 1, 0, td - 1, c.leather);
  torso.box(mid0, 1, td - 1, mid1, th - 2, td - 1, c.trim);
  torso.box(mid0, 0, td - 1, mid1, 0, td - 1, c.trim);
  torso.box(0, th - 1, 0, tw - 1, th - 1, td - 1, c.trim);
  torso.box(mid0, th - 1, td - 1, mid1, th - 1, td - 1, c.skin);
  spec.paintTorso?.(torso);

  // Arms: sleeves with a cuff, hands below.
  const arm = (side: "left" | "right") => {
    const g = new Grid(aw, ah, aw);
    g.box(0, 2, 0, aw - 1, ah - 1, aw - 1, c.cloth);
    g.box(0, 2, 0, aw - 1, 2, aw - 1, c.trim);
    g.box(0, 0, 0, aw - 1, 1, aw - 1, c.skin);
    spec.paintArm?.(g, side);
    return g;
  };

  // The head: a skull with eyes and hair, in a grid with room around it.
  const hw = s + 2 * m.x;
  const hh = s + m.top;
  const hd = s + 2 * m.z;
  const head = new Grid(hw, hh, hd);
  const sx = m.x;
  const sz = m.z;
  head.box(sx, 0, sz, sx + s - 1, s - 1, sz + s - 1, c.skin);
  const front = sz + s - 1;
  const back = sz;
  const eyeY = Math.round(s / 2);
  head.set(sx + 1, eyeY, front, c.eyes).set(sx + s - 2, eyeY, front, c.eyes);
  if (c.hair !== undefined && spec.hair !== "none") {
    const hair = c.hair;
    const style = spec.hair ?? "short";
    head.box(sx, s - 1, sz, sx + s - 1, s - 1, front, hair);
    const backFrom = style === "long" ? 0 : style === "cropped" ? s - 2 : 2;
    head.box(sx, backFrom, back, sx + s - 1, s - 1, back, hair);
    const sideFrom = style === "long" ? 1 : style === "cropped" ? s - 2 : eyeY + 1;
    head.box(sx, sideFrom, back, sx, s - 1, front - 2, hair);
    head.box(sx + s - 1, sideFrom, back, sx + s - 1, s - 1, front - 2, hair);
    if (style !== "cropped") head.box(sx, s - 1, front, sx + s - 1, s - 1, front, hair);
    if (style === "long") head.box(sx + 1, 0, back, sx + s - 2, 1, back, hair);
    if (style === "tail" && m.z > 0) head.box(sx + s / 2 - 1, 1, back - 1, sx + s / 2, s - 2, back - 1, hair);
  }
  spec.paintHead?.(head, { x: sx, z: sz, s });

  const shift = spec.headShift ?? { y: 0, z: 0 };
  const parts: VoxPart[] = [
    part("leg-left", leg("left"), { pivot: [legX, lh, 0], origin: [lw / 2, lh, lw / 2], motion: "leg-left" }),
    part("leg-right", leg("right"), { pivot: [-legX, lh, 0], origin: [lw / 2, lh, lw / 2], motion: "leg-right" }),
    part("torso", torso, { pivot: [0, lh, 0], origin: [tw / 2, 0, td / 2], motion: "bob" }),
    part("head", head, { parent: "torso", pivot: [tw / 2, th + shift.y, td / 2 + shift.z], origin: [hw / 2, 0, hd / 2] }),
    part("arm-left", arm("left"), { parent: "torso", pivot: [tw + aw / 2, th, td / 2], origin: [aw / 2, ah, aw / 2], motion: "arm-left" }),
    part("arm-right", arm("right"), { parent: "torso", pivot: [-aw / 2, th, td / 2], origin: [aw / 2, ah, aw / 2], motion: "arm-right" }),
  ];

  const attach: NonNullable<VoxModel["attach"]> = {
    "head-top": { part: "head", at: [hw / 2, s, hd / 2], size: [s, s, s] },
    brow: { part: "head", at: [hw / 2, s - 2, sz + s], size: [s, 1, 1] },
    neck: { part: "torso", at: [tw / 2, th - 1, td], size: [tw, th, td] },
    torso: { part: "torso", at: [tw / 2, 0, td / 2], size: [tw, th, td] },
    back: { part: "torso", at: [tw / 2, th / 2, 0], size: [tw, th, td] },
    "arm-left": { part: "arm-left", at: [aw / 2, ah, aw / 2], size: [aw, ah, aw] },
    "arm-right": { part: "arm-right", at: [aw / 2, ah, aw / 2], size: [aw, ah, aw] },
    "hand-left": { part: "arm-left", at: [aw / 2, 0, aw / 2], size: [aw, 2, aw] },
    "hand-right": { part: "arm-right", at: [aw / 2, 0, aw / 2], size: [aw, 2, aw] },
    "leg-left": { part: "leg-left", at: [lw / 2, lh, lw / 2], size: [lw, lh, lw] },
    "leg-right": { part: "leg-right", at: [lw / 2, lh, lw / 2], size: [lw, lh, lw] },
    "foot-left": { part: "leg-left", at: [lw / 2, 0, lw / 2], size: [lw, 2, lw] },
    "foot-right": { part: "leg-right", at: [lw / 2, 0, lw / 2], size: [lw, 2, lw] },
    orbit: { part: "torso", at: [tw + 4, th + 3, td / 2], size: [1, 1, 1] },
  };
  return { parts, attach, height: lh + th + s + shift.y };
}

// ---------------------------------------------------------------------------------------------------------------------
// The player's bodies (design.md, A1): "$0" skin, "$1" hair, "$2" cloth, "$3" trim, "$4" leather.

const BODY_PALETTE = ["$0", "$1", "$2", "$3", "$4", "#1a1c24", "#3b3c4a"];
const BODY_COLORS = { skin: 0, hair: 1, cloth: 2, trim: 3, leather: 4, eyes: 5, trousers: 6 };

function body(id: string, shape: Pick<Humanoid, "torso" | "arm" | "leg" | "hair">): VoxModel {
  const built = humanoid({ skull: 6, headMargin: { x: 0, top: 0, z: shape.hair === "tail" ? 1 : 0 }, colors: BODY_COLORS, ...shape });
  return { id, kind: "body", voxel: VOXEL, palette: BODY_PALETTE, parts: built.parts, attach: built.attach };
}

const bodies: VoxModel[] = [
  body("body-lithe", { torso: [6, 8, 3], arm: [2, 8], leg: [2, 10], hair: "long" }),
  body("body-broad", { torso: [8, 8, 4], arm: [3, 8], leg: [3, 9], hair: "cropped" }),
  body("body-tall", { torso: [7, 9, 4], arm: [2, 9], leg: [2, 12], hair: "tail" }),
  body("body-stocky", { torso: [8, 7, 5], arm: [3, 7], leg: [3, 7], hair: "short" }),
];

// ---------------------------------------------------------------------------------------------------------------------
// Gear (design.md, A4): "$0" and "$1" are the item's look.palette. Each piece is made for a body region of the size its
// `fit` gives and stretched to the body it is worn on.

const GEAR_PALETTE = ["$0", "$1", "#0d0f14"];

function gear(id: string, parts: VoxPart[]): VoxModel {
  return { id, kind: "gear", voxel: VOXEL, palette: GEAR_PALETTE, parts };
}

/** A ring of voxels round a w x d footprint, `inset` in from its edge. */
const rim = (g: Grid, y: number, inset: number, c: number) =>
  g.each((x, yy, z) => (yy === y && (x === inset || z === inset || x === g.w - 1 - inset || z === g.d - 1 - inset) && x >= inset && z >= inset && x <= g.w - 1 - inset && z <= g.d - 1 - inset ? c : undefined));

const circlet = (() => {
  const g = new Grid(8, 2, 8);
  rim(g, 0, 0, 0);
  // Corners cut, so the band rounds the head.
  g.set(0, 0, 0, -1).set(7, 0, 0, -1).set(0, 0, 7, -1).set(7, 0, 7, -1);
  g.box(3, 0, 7, 4, 1, 7, 1);
  g.set(3, 1, 7, 1).set(4, 1, 7, 1);
  return gear("circlet", [part("band", g, { mount: "head-top", pivot: [0, 0, 0], origin: [4, 3, 4] })]);
})();

const helm = (() => {
  const g = new Grid(8, 7, 8);
  g.box(0, 0, 0, 7, 4, 7, 0);
  g.box(1, 5, 1, 6, 5, 6, 0);
  g.each((x, y, z) => (y <= 5 && x > 0 && x < 7 && z > 0 && z < 7 && y < 5 ? -1 : undefined));
  g.set(0, 0, 0, -1).set(7, 0, 0, -1).set(0, 0, 7, -1).set(7, 0, 7, -1);
  // An open face: the eyes show through a T of visor.
  g.box(1, 0, 7, 6, 2, 7, -1);
  g.box(3, 0, 7, 4, 1, 7, 0);
  // A crest along the top, front to back.
  g.box(3, 6, 1, 4, 6, 6, 1);
  g.box(0, 4, 0, 7, 4, 7, 0);
  g.box(1, 4, 7, 6, 4, 7, 1);
  return gear("helm", [part("helm", g, { mount: "head-top", pivot: [0, 0, 0], origin: [4, 4, 4] })]);
})();

const amulet = (() => {
  const g = new Grid(6, 5, 1);
  g.set(0, 4, 0, 0).set(5, 4, 0, 0).set(1, 3, 0, 0).set(4, 3, 0, 0).set(2, 2, 0, 0).set(3, 2, 0, 0);
  g.box(2, 0, 0, 3, 1, 0, 1);
  return gear("amulet", [part("pendant", g, { mount: "neck", pivot: [0, 0, 0], origin: [3, 4, 0] })]);
})();

const armor = (() => {
  // A breastplate over a torso of 8 x 8 x 4 (stretched to the one it is worn on), and pauldrons on the shoulders.
  const plate = new Grid(10, 8, 6);
  plate.box(0, 0, 0, 9, 7, 5, 0).hollow();
  plate.box(1, 0, 1, 8, 7, 4, -1);
  plate.box(0, 7, 0, 9, 7, 5, 0);
  plate.box(2, 7, 1, 7, 7, 4, -1);
  plate.box(4, 1, 5, 5, 6, 5, 1);
  plate.box(0, 0, 0, 9, 0, 5, 1);
  plate.box(1, 0, 1, 8, 0, 4, -1);
  plate.set(2, 5, 5, 2).set(7, 5, 5, 2);
  const pauldron = (side: "left" | "right") => {
    const g = new Grid(4, 3, 4);
    g.box(0, 0, 0, 3, 1, 3, 0).box(1, 2, 0, 3, 2, 3, 0);
    g.box(0, 0, 0, 3, 0, 3, 1);
    return side === "left" ? g : g.mirrored();
  };
  return gear("armor", [
    part("plate", plate, { mount: "torso", pivot: [0, 0, 0], origin: [5, -1, 3], fit: [8, 8, 4] }),
    part("pauldron-left", pauldron("left"), { mount: "arm-left", pivot: [0, 0, 0], origin: [1.5, 1, 2], fit: [2, 0, 2] }),
    part("pauldron-right", pauldron("right"), { mount: "arm-right", pivot: [0, 0, 0], origin: [2.5, 1, 2], fit: [2, 0, 2] }),
  ]);
})();

const robe = (() => {
  const top = new Grid(10, 9, 6);
  top.box(0, 0, 0, 9, 8, 5, 0).hollow();
  top.box(1, 0, 1, 8, 8, 4, -1);
  top.box(4, 0, 5, 5, 8, 5, 1);
  top.box(0, 8, 0, 9, 8, 5, 1);
  top.box(2, 8, 1, 7, 8, 4, -1);
  const skirt = new Grid(12, 7, 8);
  skirt.each((x, y, z) => {
    const spread = (6 - y) / 6;
    const halfW = 4.5 + spread * 1.5;
    const halfD = 2.5 + spread * 1.5;
    const dx = Math.abs(x + 0.5 - 6);
    const dz = Math.abs(z + 0.5 - 4);
    return dx <= halfW && dz <= halfD && (dx > halfW - 1 || dz > halfD - 1) ? 0 : undefined;
  });
  skirt.paint(1, (_x, y) => y === 0);
  skirt.paint(1, (x, _y, z) => z >= 6 && (x === 5 || x === 6));
  const sleeve = (side: "left" | "right") => {
    const g = new Grid(4, 6, 4);
    g.box(0, 0, 0, 3, 5, 3, 0).box(1, 0, 1, 2, 5, 2, -1);
    g.box(0, 0, 0, 3, 0, 3, 1).box(1, 0, 1, 2, 0, 2, -1);
    return side === "left" ? g : g.mirrored();
  };
  return gear("robe", [
    part("robe", top, { mount: "torso", pivot: [0, 0, 0], origin: [5, 0, 3], fit: [8, 8, 4] }),
    part("skirt", skirt, { mount: "torso", pivot: [0, 0, 0], origin: [6, 6, 4], fit: [8, 0, 4] }),
    part("sleeve-left", sleeve("left"), { mount: "arm-left", pivot: [0, 0, 0], origin: [2, 6, 2], fit: [2, 0, 2] }),
    part("sleeve-right", sleeve("right"), { mount: "arm-right", pivot: [0, 0, 0], origin: [2, 6, 2], fit: [2, 0, 2] }),
  ]);
})();

const gloves = (() => {
  const glove = () => {
    const g = new Grid(4, 4, 4);
    g.box(0, 0, 0, 3, 3, 3, 0);
    g.set(0, 0, 0, -1).set(3, 0, 0, -1).set(0, 0, 3, -1).set(3, 0, 3, -1);
    g.box(0, 3, 0, 3, 3, 3, 1);
    return g;
  };
  return gear("gloves", [
    part("glove-left", glove(), { mount: "hand-left", pivot: [0, 0, 0], origin: [2, 1, 2], fit: [2, 0, 2] }),
    part("glove-right", glove(), { mount: "hand-right", pivot: [0, 0, 0], origin: [2, 1, 2], fit: [2, 0, 2] }),
  ]);
})();

const boots = (() => {
  const boot = () => {
    const g = new Grid(4, 5, 6);
    g.box(0, 0, 0, 3, 4, 3, 0);
    g.box(0, 0, 4, 3, 1, 5, 0);
    g.box(0, 4, 0, 3, 4, 3, 1);
    g.box(0, 0, 0, 3, 0, 5, 2);
    return g;
  };
  return gear("boots", [
    part("boot-left", boot(), { mount: "foot-left", pivot: [0, 0, 0], origin: [2, 0, 2], fit: [2, 0, 2] }),
    part("boot-right", boot(), { mount: "foot-right", pivot: [0, 0, 0], origin: [2, 0, 2], fit: [2, 0, 2] }),
  ]);
})();

const ring = (() => {
  const g = new Grid(4, 2, 4);
  rim(g, 0, 0, 0);
  g.set(0, 0, 0, -1).set(3, 0, 0, -1).set(0, 0, 3, -1).set(3, 0, 3, -1);
  g.box(1, 1, 3, 2, 1, 3, 1);
  return gear("ring", [part("ring", g, { mount: "hand-right", pivot: [0, 0, 0], origin: [2, -1, 2], glow: true, fit: [2, 0, 2] })]);
})();

const relic = (() => {
  const g = new Grid(5, 7, 5);
  g.each((x, y, z) => {
    const r = 2.6 - Math.abs(y + 0.5 - 3.5) * 0.75;
    return Math.abs(x + 0.5 - 2.5) + Math.abs(z + 0.5 - 2.5) <= r ? 0 : undefined;
  });
  g.paint(1, (x, y, z) => Math.abs(x - 2) + Math.abs(z - 2) <= 1 && y >= 2 && y <= 4);
  g.paint(1, (x, y, z) => x === 2 && z === 2);
  return gear("relic", [part("relic", g, { mount: "orbit", pivot: [0, 0, 0], origin: [2.5, 3.5, 2.5], glow: true, motion: "float" })]);
})();

const gears: VoxModel[] = [circlet, helm, amulet, armor, robe, gloves, boots, ring, relic];

// ---------------------------------------------------------------------------------------------------------------------
// Mobs: "$0", "$1", "$2" are the mob's model.palette (design.md A6; interfaces.md "Mobs").

function mob(id: string, palette: string[], parts: VoxPart[]): VoxModel {
  return { id, kind: "mob", voxel: VOXEL, palette, parts };
}

// A soldier: helmet and mail in "$0", tabard "$1", the shield's device "$2"; a spear and a kite shield.
const soldier = (() => {
  const P = ["$0", "$1", "$2", "#c08a62", "#1a1c24", "#3b3c4a", "#6b4630", "#4a3122", "#d8d6d0"];
  const [metal, tabard, device, skin, eyes, dark, wood, leather, steel] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const built = humanoid({
    skull: 6,
    headMargin: { x: 1, top: 2, z: 1 },
    torso: [8, 8, 4],
    arm: [3, 8],
    leg: [3, 9],
    colors: { skin, cloth: metal, trim: tabard, leather, eyes, trousers: dark },
    hair: "none",
    paintHead: (g, k) => {
      // A kettle helm with a nasal and a plume.
      g.box(k.x - 1, 3, k.z - 1, k.x + k.s, k.s, k.z + k.s, metal);
      g.box(k.x, k.s + 1, k.z + 1, k.x + k.s - 1, k.s + 1, k.z + k.s - 2, metal);
      g.box(k.x, 3, k.z + k.s, k.x + k.s - 1, 3, k.z + k.s, -1);
      g.box(k.x - 1, 4, k.z + k.s, k.x + k.s, k.s, k.z + k.s, metal);
      g.box(k.x + 1, 3, k.z + k.s, k.x + 1, 3, k.z + k.s, -1);
      g.set(k.x + 1, 3, k.z + k.s - 1, eyes).set(k.x + k.s - 2, 3, k.z + k.s - 1, eyes);
      g.box(k.x + 2, 2, k.z + k.s, k.x + 3, 4, k.z + k.s, metal);
      g.box(k.x + 2, k.s + 1, k.z, k.x + 3, k.s + 1, k.z + k.s - 1, tabard);
      g.box(k.x + 2, k.s + 1, k.z - 1, k.x + 3, k.s - 1, k.z - 1, tabard);
    },
    paintTorso: (g) => {
      // A tabard over mail.
      g.paint(tabard, (x, y, z) => (z === g.d - 1 || z === 0) && x >= 1 && x <= g.w - 2 && y >= 0);
      g.paint(steel, (x, y, z) => z === g.d - 1 && (x === 3 || x === 4) && y === 5);
      g.paint(leather, (_x, y) => y === 1);
    },
    paintArm: (g) => g.paint(metal, (_x, y) => y >= 2),
  });
  // A spear in the right hand and a shield on the left arm.
  const spear = new Grid(1, 30, 1);
  spear.box(0, 0, 0, 0, 25, 0, wood);
  spear.box(0, 26, 0, 0, 29, 0, steel);
  const spearHead = new Grid(3, 3, 1);
  spearHead.set(0, 0, 0, steel).set(2, 0, 0, steel).set(1, 0, 0, steel).set(1, 1, 0, steel).set(1, 2, 0, steel);
  const shield = new Grid(2, 11, 8);
  shield.each((x, y, z) => {
    const half = y > 6 ? 4 : 4 - (6 - y) * 0.55;
    return Math.abs(z + 0.5 - 4) <= half ? (x === 0 ? metal : device) : undefined;
  });
  shield.paint(metal, (x, y, z) => x === 1 && (z === 0 || z === 7 || y === 10));
  shield.paint(tabard, (x, y, z) => x === 1 && z >= 3 && z <= 4 && y >= 2 && y <= 8);
  shield.paint(tabard, (x, y, z) => x === 1 && y >= 6 && y <= 7 && z >= 1 && z <= 6);
  return mob("humanoid", P, [
    ...built.parts,
    part("spear", spear, { parent: "arm-right", pivot: [1.5, 1, 3.5], origin: [0.5, 9, 0.5] }),
    part("spear-head", spearHead, { parent: "spear", pivot: [0.5, 29, 0.5], origin: [1.5, 0, 0.5] }),
    part("shield", shield, { parent: "arm-left", pivot: [3, 3, 1.5], origin: [0, 3, 4] }),
  ]);
})();

// A ghoul: grey flesh "$0", rags "$1"; hunched, long-armed, with burning eyes and claws.
const ghoul = (() => {
  const P = ["$0", "$1", "#e86a3a", "#2a2b36", "#f2efe6", "#1a1c24"];
  const [flesh, rags, eye, dark, bone] = [0, 1, 2, 3, 4];
  const built = humanoid({
    skull: 6,
    headMargin: { x: 0, top: 0, z: 1 },
    torso: [7, 7, 5],
    arm: [2, 11],
    leg: [2, 8],
    colors: { skin: flesh, cloth: flesh, trim: rags, leather: flesh, eyes: eye, trousers: rags },
    hair: "none",
    headShift: { y: -2, z: 2 },
    paintHead: (g, k) => {
      const front = k.z + k.s - 1;
      // A jaw hanging open, teeth, a bald pate with a few strands.
      g.box(k.x + 1, 0, front, k.x + k.s - 2, 1, front, dark);
      g.set(k.x + 1, 1, front, bone).set(k.x + 3, 1, front, bone).set(k.x + 4, 0, front, bone);
      g.set(k.x + 1, 3, front, eye).set(k.x + k.s - 2, 3, front, eye);
      g.box(k.x, k.s - 1, k.z, k.x + 1, k.s - 1, k.z + 2, dark);
    },
    paintTorso: (g) => {
      // A hump of spine, ribs showing through torn rags.
      g.each((x, y, z, now) => (z === 0 && y >= 3 && x >= 1 && x <= g.w - 2 ? flesh : now >= 0 ? undefined : undefined));
      g.paint(rags, (_x, y) => y <= 2);
      g.paint(rags, (x, y, z) => z === 0 && y >= 3 && x % 3 === 0);
      g.paint(dark, (x, y, z) => z === g.d - 1 && y >= 3 && y <= 5 && y % 2 === 1 && x >= 1 && x <= g.w - 2);
      g.paint(flesh, (x, y, z) => z === g.d - 1 && (x === 3) && y >= 3);
    },
    paintArm: (g) => {
      g.paint(flesh, () => true);
      g.paint(rags, (_x, y) => y >= g.h - 3);
      g.paint(bone, (x, y, z) => y === 0 && (x + z) % 2 === 0);
    },
    paintLeg: (g) => {
      g.paint(flesh, (_x, y) => y <= 3);
      g.paint(dark, (_x, y) => y === 0);
    },
  });
  // The back is hunched: a hump on the torso.
  const hump = new Grid(5, 3, 3);
  hump.ellipsoid(2.5, 0.5, 1.5, 2.6, 2.6, 1.6, flesh);
  hump.paint(rags, (_x, y) => y === 0);
  return mob("ghoul", P, [...built.parts, part("hump", hump, { parent: "torso", pivot: [3.5, 6, 0.5], origin: [2.5, 0, 1.5] })]);
})();

// A wing: feathered (an angel's) or webbed (a drake's), reaching +x from where it joins the back.
function wing(length: number, height: number, c: { main: number; edge: number }, kind: "feather" | "web"): Grid {
  const g = new Grid(length, height, 2);
  g.each((x, y) => {
    const t = x / (length - 1);
    const top = height - 1 - Math.round(t * t * 2);
    const bottom = kind === "feather" ? Math.round((1 - t) * (height * 0.55)) : Math.round(height * 0.55 - Math.sin(t * Math.PI * 3) * 1.2 - t * 2);
    return y <= top && y >= Math.max(0, bottom) ? c.main : undefined;
  });
  if (kind === "feather") {
    g.paint(c.edge, (x, y) => (x + y) % 4 === 0 && y < height - 2);
    g.paint(c.edge, (_x, y, z) => z === 0 && y === height - 1);
  } else {
    g.paint(c.edge, (x, y) => y === height - 1 - Math.round((x / (length - 1)) ** 2 * 2) || x % 4 === 3);
  }
  return g;
}

// An angel: robes "$0", hair "$1", wings "$2"; a halo of light.
const angel = (() => {
  const P = ["$0", "$1", "$2", "#e8c39b", "#1d3f5c", "#b3b5bc", "#f1b44c", "#f1b44c"];
  const [robes, hair, feathers, skin, eyes, shade, gold] = [0, 1, 2, 3, 4, 5, 6];
  const built = humanoid({
    skull: 6,
    headMargin: { x: 0, top: 0, z: 0 },
    torso: [7, 9, 4],
    arm: [2, 9],
    leg: [3, 12],
    colors: { skin, hair, cloth: robes, trim: gold, leather: shade, eyes, trousers: robes },
    hair: "long",
    paintLeg: (g) => {
      g.paint(robes, (_x, y) => y >= 1);
      g.paint(gold, (_x, y) => y === 1);
    },
  });
  const halo = new Grid(6, 1, 6);
  rim(halo, 0, 0, gold);
  halo.set(0, 0, 0, -1).set(5, 0, 0, -1).set(0, 0, 5, -1).set(5, 0, 5, -1);
  const left = wing(12, 12, { main: feathers, edge: shade }, "feather");
  return mob("angel", P, [
    ...built.parts,
    part("halo", halo, { parent: "head", pivot: [3, 8, 3], origin: [3, 0, 3], glow: true, motion: "float" }),
    part("wing-left", left, { parent: "torso", pivot: [4.5, 4, 0], origin: [0, 2, 1], motion: "wing-left" }),
    part("wing-right", left.mirrored(), { parent: "torso", pivot: [2.5, 4, 0], origin: [12, 2, 1], motion: "wing-right" }),
  ]);
})();

// A drake: scales "$0", belly and horns "$1", wing membranes "$2"; four legs, a long neck and a spaded tail.
const drake = (() => {
  const P = ["$0", "$1", "$2", "#f1b44c", "#0d0f14", "#f2efe6"];
  const [scales, belly, membrane, eye, dark, tooth] = [0, 1, 2, 3, 4, 5];
  const body = new Grid(9, 8, 15);
  body.ellipsoid(4.5, 4, 7.5, 4.6, 4.1, 7.6, scales);
  body.paint(belly, (_x, y) => y <= 1);
  body.paint(dark, (x, y, z) => y >= 7 && x === 4 && z % 3 === 0);
  const neck = new Grid(5, 12, 11);
  neck.each((x, y, z) => {
    // The neck rises forward from the shoulders to the head.
    const cz = 2 + (y / 11) * 3;
    return y <= 7 && Math.abs(x + 0.5 - 2.5) <= 1.6 && Math.abs(z + 0.5 - cz) <= 1.7 ? scales : undefined;
  });
  neck.box(0, 7, 3, 4, 11, 7, scales);
  neck.box(1, 7, 8, 3, 9, 10, scales);
  neck.box(1, 7, 8, 3, 7, 10, belly);
  neck.box(1, 8, 10, 3, 8, 10, dark);
  neck.set(1, 8, 10, tooth).set(3, 8, 10, tooth);
  neck.set(0, 10, 6, eye).set(4, 10, 6, eye);
  neck.box(0, 11, 3, 0, 11, 4, belly).box(4, 11, 3, 4, 11, 4, belly);
  neck.set(0, 11, 2, belly).set(4, 11, 2, belly);
  neck.paint(dark, (x, y, z) => x === 2 && z <= 3 && y % 2 === 0 && y >= 2);
  const leg = () => {
    const g = new Grid(3, 8, 4);
    g.box(0, 2, 0, 2, 7, 2, scales);
    g.box(0, 0, 0, 2, 1, 3, scales);
    g.box(0, 0, 3, 2, 0, 3, tooth);
    return g;
  };
  const tail = new Grid(7, 5, 15);
  tail.each((x, y, z) => {
    const t = z / 14;
    const r = 1.8 * t + 0.6;
    return Math.abs(x + 0.5 - 3.5) <= r && Math.abs(y + 0.5 - (1.5 + t * 2)) <= r * 0.8 ? scales : undefined;
  });
  tail.box(1, 0, 0, 5, 1, 2, membrane).box(2, 0, 3, 4, 0, 3, membrane);
  const left = wing(16, 13, { main: membrane, edge: scales }, "web");
  return mob("drake", P, [
    part("body", body, { pivot: [0, 6, 0], origin: [4.5, 0, 7.5], motion: "bob" }),
    part("neck", neck, { parent: "body", pivot: [4.5, 5, 13], origin: [2.5, 0, 2] }),
    part("leg-front-left", leg(), { parent: "body", pivot: [8, 1, 11], origin: [1.5, 7, 1.5], motion: "leg-left" }),
    part("leg-front-right", leg(), { parent: "body", pivot: [1, 1, 11], origin: [1.5, 7, 1.5], motion: "leg-right" }),
    part("leg-back-left", leg(), { parent: "body", pivot: [8, 1, 3], origin: [1.5, 7, 1.5], motion: "leg-right" }),
    part("leg-back-right", leg(), { parent: "body", pivot: [1, 1, 3], origin: [1.5, 7, 1.5], motion: "leg-left" }),
    part("tail", tail, { parent: "body", pivot: [4.5, 2, 1], origin: [3.5, 1.5, 15], motion: "tail" }),
    part("wing-left", left, { parent: "body", pivot: [7, 7, 9], origin: [0, 3, 1], motion: "wing-left" }),
    part("wing-right", left.mirrored(), { parent: "body", pivot: [2, 7, 9], origin: [16, 3, 1], motion: "wing-right" }),
  ]);
})();

// An elf: cloak "$0", leather "$1", hair "$2"; pointed ears, a hood down, a longbow on the back.
const elf = (() => {
  const P = ["$0", "$1", "$2", "#e8c39b", "#1c2e1a", "#6b4630", "#f2efe6", "#3e9a4a"];
  const [cloak, leather, hair, skin, eyes, wood, string] = [0, 1, 2, 3, 4, 5, 6];
  const built = humanoid({
    skull: 6,
    headMargin: { x: 2, top: 0, z: 1 },
    torso: [6, 9, 3],
    arm: [2, 9],
    leg: [2, 12],
    colors: { skin, hair, cloth: leather, trim: cloak, leather, eyes, trousers: leather },
    hair: "long",
    paintHead: (g, k) => {
      // Long ears, swept back, and the hood down round the neck.
      for (const [x, dx] of [[k.x - 1, -1], [k.x + k.s, 1]] as const) {
        g.set(x, 3, k.z + 2, skin).set(x, 4, k.z + 2, skin).set(x + dx, 4, k.z + 1, skin);
      }
      g.box(k.x, 0, k.z - 1, k.x + k.s - 1, 1, k.z - 1, cloak);
    },
    paintTorso: (g) => {
      g.paint(cloak, (_x, _y, z) => z === 0);
      g.paint(cloak, (x, _y, z) => (x === 0 || x === g.w - 1) && z <= 1);
      g.paint(cloak, (_x, y) => y === g.h - 1);
    },
    paintArm: (g) => g.paint(cloak, (_x, y) => y >= g.h - 2),
  });
  // The cloak's tail hangs to the knees.
  const cape = new Grid(7, 9, 1);
  cape.box(0, 0, 0, 6, 8, 0, cloak);
  cape.set(0, 0, 0, -1).set(6, 0, 0, -1).set(3, 0, 0, -1);
  const bow = new Grid(1, 17, 4);
  bow.each((_x, y, z) => {
    const bend = Math.round(Math.sin((y / 16) * Math.PI) * 2.4);
    return z === bend ? wood : z === 0 ? string : undefined;
  });
  return mob("elf", P, [
    ...built.parts,
    part("cape", cape, { parent: "torso", pivot: [3, 0, -0.5], origin: [3.5, 0, 1] }),
    part("bow", bow, { parent: "torso", pivot: [3, 4, -1.5], origin: [0.5, 8, 3] }),
  ]);
})();

// A goblin: skin "$0", rags "$1"; small, with a big head, bigger ears and a club.
const goblin = (() => {
  const P = ["$0", "$1", "#f1b44c", "#1a1c24", "#6b4630", "#f2efe6", "#4a3122"];
  const [skin, rags, eye, dark, wood, tooth, leather] = [0, 1, 2, 3, 4, 5, 6];
  const built = humanoid({
    skull: 7,
    headMargin: { x: 3, top: 0, z: 0 },
    torso: [6, 5, 4],
    arm: [2, 6],
    leg: [2, 4],
    colors: { skin, cloth: rags, trim: leather, leather: skin, eyes: eye, trousers: rags },
    hair: "none",
    paintHead: (g, k) => {
      const front = k.z + k.s - 1;
      // Ears out to the sides, a wide grin with teeth, a long nose, pupils.
      for (const [x0, x1] of [[0, k.x - 1], [k.x + k.s, g.w - 1]] as const) {
        g.box(x0, 3, k.z + 2, x1, 4, k.z + 3, skin);
        g.box(x0, 5, k.z + 3, x1, 5, k.z + 3, skin);
      }
      g.set(0, 3, k.z + 2, -1).set(g.w - 1, 3, k.z + 2, -1);
      g.box(k.x + 1, 1, front, k.x + k.s - 2, 1, front, dark);
      g.set(k.x + 2, 1, front, tooth).set(k.x + 4, 1, front, tooth);
      g.set(k.x + 3, 3, front, skin);
      g.set(k.x + 1, 4, front, eye).set(k.x + k.s - 2, 4, front, eye);
      g.set(k.x + 1, 5, front, dark).set(k.x + k.s - 2, 5, front, dark);
      g.set(k.x + 3, 2, front, skin);
    },
  });
  const club = new Grid(3, 10, 3);
  club.box(1, 0, 1, 1, 6, 1, wood);
  club.box(0, 6, 0, 2, 9, 2, wood);
  club.set(0, 8, 0, tooth).set(2, 7, 2, tooth).set(0, 7, 2, tooth);
  return mob("goblin", P, [...built.parts, part("club", club, { parent: "arm-right", pivot: [1, 1, 2], origin: [1.5, 2, 1.5] })]);
})();

// A wurm: hide "$0", belly and ridges "$1", maw "$2"; a head reared up and a body of segments that undulate.
const wurm = (() => {
  const P = ["$0", "$1", "$2", "#f2efe6", "#f1b44c", "#0d0f14"];
  const [hide, ridge, maw, tooth, eye, dark] = [0, 1, 2, 3, 4, 5];
  const head = new Grid(11, 12, 11);
  head.ellipsoid(5.5, 6, 5.5, 5.4, 5.8, 5.4, hide);
  head.box(2, 2, 8, 8, 6, 10, maw);
  head.box(3, 3, 9, 7, 5, 10, dark);
  head.paint(tooth, (x, y, z) => z >= 8 && (y === 6 || y === 2) && x % 2 === 0 && x >= 2 && x <= 8);
  head.set(1, 8, 7, eye).set(9, 8, 7, eye);
  head.paint(ridge, (x, y) => y >= 10 && x >= 4 && x <= 6);
  head.paint(ridge, (_x, y) => y <= 1);
  const parts: VoxPart[] = [part("head", head, { pivot: [0, 6, 14], origin: [5.5, 0, 3], motion: "segment" })];
  const sizes = [10, 10, 9, 8, 7, 6, 5, 4];
  let parent = "head";
  let back = 0;
  sizes.forEach((size, i) => {
    const g = new Grid(size, size, 6);
    g.ellipsoid(size / 2, size / 2, 3, size / 2, size / 2, 3.3, hide);
    g.paint(ridge, (_x, y) => y <= 1);
    g.paint(ridge, (x, y) => y >= size - 2 && Math.abs(x + 0.5 - size / 2) <= 1);
    g.paint(dark, (_x, _y, z) => z === 0 && i % 2 === 0);
    const name = `segment-${i + 1}`;
    // Every segment lies on the ground: the first under the reared head, each next behind the one before.
    parts.push(
      part(name, g, {
        parent,
        pivot: i === 0 ? [5.5, -6, back] : [sizes[i - 1]! / 2, 0, 0.5],
        origin: [size / 2, 0, 5.5],
        motion: "segment",
      }),
    );
    parent = name;
    back = 0;
  });
  return mob("wurm", P, parts);
})();

// A construct: stone or metal "$0", bands "$1", a glowing core "$2"; a heavy golem with block fists.
const construct = (() => {
  const P = ["$0", "$1", "$2", "#2a2b36", "#0d0f14"];
  const [stone, band, core, shade, dark] = [0, 1, 2, 3, 4];
  const torso = new Grid(12, 10, 7);
  torso.box(0, 0, 0, 11, 9, 6, stone);
  torso.box(0, 0, 0, 0, 0, 6, -1).box(11, 0, 0, 11, 0, 6, -1);
  torso.paint(band, (_x, y) => y === 1 || y === 8);
  torso.paint(shade, (x, y, z) => z === 6 && (x === 0 || x === 11) && y > 1);
  torso.box(4, 3, 6, 7, 6, 6, dark);
  const glow = new Grid(2, 2, 1);
  glow.box(0, 0, 0, 1, 1, 0, core);
  const head = new Grid(6, 5, 6);
  head.box(0, 0, 0, 5, 4, 5, stone);
  head.box(0, 4, 0, 5, 4, 5, band);
  head.box(1, 2, 5, 4, 2, 5, dark);
  const eyes = new Grid(4, 1, 1);
  eyes.set(0, 0, 0, core).set(3, 0, 0, core);
  const arm = () => {
    const g = new Grid(4, 12, 4);
    g.box(0, 0, 0, 3, 11, 3, stone);
    g.box(0, 0, 0, 3, 3, 3, shade);
    g.paint(band, (_x, y) => y === 4 || y === 10);
    g.paint(stone, (_x, y) => y <= 3 && y >= 1);
    g.paint(dark, (x, y, z) => y === 0 && (x + z) % 2 === 1);
    return g;
  };
  const leg = () => {
    const g = new Grid(4, 8, 5);
    g.box(0, 1, 0, 3, 7, 3, stone);
    g.box(0, 0, 0, 3, 1, 4, shade);
    g.paint(band, (_x, y) => y === 5);
    return g;
  };
  return mob("construct", P, [
    part("leg-left", leg(), { pivot: [3, 8, 0], origin: [2, 8, 2], motion: "leg-left" }),
    part("leg-right", leg(), { pivot: [-3, 8, 0], origin: [2, 8, 2], motion: "leg-right" }),
    part("torso", torso, { pivot: [0, 8, 0], origin: [6, 0, 3.5], motion: "bob" }),
    part("core", glow, { parent: "torso", pivot: [6, 4, 7], origin: [1, 0, 0], glow: true }),
    part("head", head, { parent: "torso", pivot: [6, 10, 4], origin: [3, 0, 3] }),
    part("eyes", eyes, { parent: "head", pivot: [3, 2, 6], origin: [2, 0, 0], glow: true }),
    part("arm-left", arm(), { parent: "torso", pivot: [14, 10, 3.5], origin: [2, 12, 2], motion: "arm-left" }),
    part("arm-right", arm(), { parent: "torso", pivot: [-2, 10, 3.5], origin: [2, 12, 2], motion: "arm-right" }),
  ]);
})();

// A spirit: pale "$0", its shade "$1", glowing eyes "$2"; it floats, trailing a wisp where legs would be.
const spirit = (() => {
  const P = ["$0", "$1", "$2", "#0d0f14"];
  const [pale, shade, eye, dark] = [0, 1, 2, 3];
  const body = new Grid(12, 24, 9);
  body.each((x, y, z) => {
    // A hooded head on top, shoulders, a body tapering to a wisp that curls back.
    const cx = 6;
    const back = y < 10 ? (10 - y) * 0.35 : 0;
    const cz = 4.5 - back;
    let r: number;
    if (y >= 16) r = 4;
    else if (y >= 12) r = 5.6;
    else r = 1 + (y / 12) * 4.4;
    const rz = y >= 16 ? 4 : Math.min(3.8, r * 0.8);
    const dx = (x + 0.5 - cx) / r;
    const dz = (z + 0.5 - cz) / rz;
    return dx * dx + dz * dz <= 1 ? pale : undefined;
  });
  body.paint(shade, (_x, y, z) => y < 12 && (y + z) % 3 === 0);
  body.paint(shade, (_x, y) => y === 23 || y === 15);
  body.box(4, 17, 8, 7, 21, 8, dark);
  const eyes = new Grid(4, 1, 1);
  eyes.set(0, 0, 0, eye).set(3, 0, 0, eye);
  const arm = () => {
    const g = new Grid(2, 8, 2);
    g.box(0, 0, 0, 1, 7, 1, pale);
    g.paint(shade, (_x, y) => y <= 1);
    return g;
  };
  return mob("spirit", P, [
    part("body", body, { pivot: [0, 3, 0], origin: [6, 0, 4.5], motion: "float" }),
    part("eyes", eyes, { parent: "body", pivot: [6, 19, 9], origin: [2, 0, 0], glow: true }),
    part("arm-left", arm(), { parent: "body", pivot: [12, 15, 4.5], origin: [1, 8, 1], motion: "arm-left" }),
    part("arm-right", arm(), { parent: "body", pivot: [0, 15, 4.5], origin: [1, 8, 1], motion: "arm-right" }),
  ]);
})();

// A Phyrexian: metal "$0", sinew "$1", a sickly accent "$2"; tall and sinewy, a skull of a face, spines and a blade arm.
const phyrexian = (() => {
  const P = ["$0", "$1", "$2", "#0d0f14", "#e86a3a", "#d8d6d0"];
  const [metal, sinew, accent, dark, eye, bone] = [0, 1, 2, 3, 4, 5];
  const built = humanoid({
    skull: 6,
    headMargin: { x: 0, top: 3, z: 1 },
    torso: [6, 10, 3],
    arm: [2, 11],
    leg: [2, 13],
    colors: { skin: bone, cloth: sinew, trim: metal, leather: metal, eyes: eye, trousers: sinew },
    hair: "none",
    paintHead: (g, k) => {
      const front = k.z + k.s - 1;
      // A metal skull: a crest of spines, a grille for a mouth, slit eyes.
      g.paint(metal, (_x, y) => y >= 3);
      g.box(k.x + 1, 0, front, k.x + k.s - 2, 1, front, dark);
      g.paint(bone, (x, y, z) => z === front && y <= 1 && x % 2 === 0);
      g.set(k.x + 1, 3, front, eye).set(k.x + 2, 3, front, eye).set(k.x + 3, 3, front, eye).set(k.x + 4, 3, front, eye);
      g.set(k.x + 2, 3, front, dark).set(k.x + 3, 3, front, dark);
      g.box(k.x + 2, k.s, k.z, k.x + 3, k.s, k.z + k.s - 1, accent);
      g.box(k.x + 2, k.s + 1, k.z, k.x + 3, k.s + 1, k.z + 3, metal);
      g.box(k.x + 2, k.s + 2, k.z - 1, k.x + 3, k.s + 2, k.z + 1, metal);
      g.box(k.x + 2, k.s - 2, k.z - 1, k.x + 3, k.s, k.z - 1, metal);
    },
    paintTorso: (g) => {
      // Ribs of metal over red sinew, a glowing seam.
      g.paint(metal, (_x, y) => y % 2 === 0);
      g.paint(sinew, (x, _y, z) => z === g.d - 1 && (x === 2 || x === 3));
      g.paint(accent, (x, y, z) => z === g.d - 1 && (x === 2 || x === 3) && y >= 3 && y <= 6);
      g.paint(metal, (_x, y) => y === g.h - 1);
    },
    paintArm: (g) => {
      g.paint(sinew, () => true);
      g.paint(metal, (_x, y) => y % 3 === 0);
      g.paint(dark, (_x, y) => y === 0);
    },
    paintLeg: (g) => {
      g.paint(metal, (_x, y) => y % 3 === 1 || y <= 1);
    },
  });
  const spines = new Grid(10, 5, 3);
  for (const x of [0, 1, 8, 9]) spines.box(x, 0, 0, x, x === 0 || x === 9 ? 4 : 2, 0, metal);
  spines.box(2, 0, 0, 7, 0, 2, metal);
  spines.box(0, 0, 0, 1, 0, 2, metal).box(8, 0, 0, 9, 0, 2, metal);
  const blade = new Grid(1, 12, 4);
  blade.each((_x, y, z) => (z <= Math.max(0, 3 - Math.floor(y / 3)) ? (z === 0 ? metal : bone) : undefined));
  return mob("phyrexian", P, [
    ...built.parts,
    part("spines", spines, { parent: "torso", pivot: [3, 10, 1.5], origin: [5, 0, 1.5] }),
    part("blade", blade, { parent: "arm-right", pivot: [1, 1, 1], origin: [0.5, 11, 0] }),
  ]);
})();

const mobs: VoxModel[] = [soldier, ghoul, angel, drake, elf, goblin, wurm, construct, spirit, phyrexian];

// ---------------------------------------------------------------------------------------------------------------------

/** A model as JSON with each voxel row on a line of its own and short number lists kept on one line. */
function format(model: VoxModel): string {
  return (
    JSON.stringify(model, null, 2)
      .replace(/\[\s+(-?[\d.e-]+),\s+(-?[\d.e-]+),\s+(-?[\d.e-]+)\s+\]/g, "[$1, $2, $3]")
      .replace(/"palette": \[\s+([^\]]*?)\s+\]/g, (_m, inner: string) => `"palette": [${inner.split(/,\s+/).join(", ")}]`) + "\n"
  );
}

mkdirSync(OUT, { recursive: true });
const all = [...bodies, ...gears, ...mobs];
for (const model of all) {
  writeFileSync(join(OUT, `${model.id}.vox.json`), format(model));
}
console.log(`models.ts: ${all.length} models (${bodies.length} bodies, ${gears.length} gear, ${mobs.length} mobs) in ${OUT}`);
