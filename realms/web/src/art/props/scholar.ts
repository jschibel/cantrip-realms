import { fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { flat, material, stock } from "../paint/materials";
import type { Ramp } from "../paint/palette";
import * as Pic from "../paint/pictures";
import { Pixmap, hash2 } from "../paint/pixmap";
import * as RP from "../rooms/paint";
import { WOOD_PALETTE, smallCandle, standing, wallPiece, woodTop, woods } from "./furnish";
import { bool, drawn, num, str } from "./registry";

// A library's and a mage's furniture: stacks of books standing free, reading desks and lecterns, a globe, ladders, and
// a mage tower's spiral stair, rune circle, orrery, telescope and crystals. Glows are glowing materials; the light they
// give is the room's data (layout.ts).

const brass = () => flat(C.GOLD[3]!);
const brassLight = () => flat(C.GOLD[5]!);

drawn("bookcase", "a bookcase standing free, its middle at x, z, args.len long (2) along x, books on both faces, args.h high (2.25); its seed", (b, p, pal) => {
  const len = num(p, "len", 2);
  const h = num(p, "h", 2.25);
  const seed = p.seed ?? 11;
  const { timber, dark } = woods(pal);
  const front = fitted(material(`shelf-books-${seed}`, () => Pic.bookshelf(seed, false)));
  const back = fitted(material(`shelf-books-${seed + 1}`, () => Pic.bookshelf(seed + 1, false)));
  standing(b, p, () => {
    for (let k = 0; k < Math.round(len); k++) {
      const x = -len / 2 + k;
      b.box(x, 0, -0.3, x + 1, h, 0.3, { south: front, north: back, top: dark, east: timber, west: timber });
    }
    b.box(-len / 2 - 0.05, h, -0.34, len / 2 + 0.05, h + 0.1, 0.34, sides(dark));
  });
}, WOOD_PALETTE);

drawn("reading-desk", "a desk with an open book, papers and a candle, its middle at x, z (1.25 by 0.75), its seat to the south unless rot turns it", (b, p, pal) => {
  const { timber, dark, boards } = woods(pal);
  standing(b, p, () => {
    b.box(-0.625, 0, -0.375, -0.45, 0.75, 0.375, sides(dark));
    b.box(0.45, 0, -0.375, 0.625, 0.75, 0.375, sides(dark));
    b.box(-0.625, 0.75, -0.375, 0.625, 0.85, 0.375, sides(timber, boards));
    b.box(-0.3, 0.85, -0.1, 0.2, 0.88, 0.25, { top: fitted(material("open-book", () => openBook())), south: tiled(flat(0xe8dcc0)) });
    b.box(0.25, 0.85, -0.3, 0.55, 0.86, -0.05, { top: tiled(flat(0xf0e4c4)) });
    smallCandle(b, -0.45, 0.85, -0.2, 0.18);
    b.box(0.35, 0.85, 0.05, 0.45, 0.97, 0.15, sides(flat(C.INK), flat(C.BLUE[3]!)));
  });
}, WOOD_PALETTE);

drawn("lectern", "a lectern with a great book open on it, its middle at x, z, facing south unless rot turns it", (b, p, pal) => {
  const { dark } = woods(pal);
  standing(b, p, () => {
    b.box(-0.25, 0, -0.25, 0.25, 0.08, 0.25, sides(dark));
    b.box(-0.07, 0.08, -0.07, 0.07, 1.0, 0.07, sides(dark));
    b.quad(tiled(stock.darkTimber()), [[-0.35, 0.95, 0.2], [0.35, 0.95, 0.2], [0.35, 1.2, -0.2], [-0.35, 1.2, -0.2]], (c) => c[0], (c) => -c[2]);
    b.quad(fitted(material("great-book", () => openBook(true))), [[-0.3, 0.98, 0.17], [0.3, 0.98, 0.17], [0.3, 1.22, -0.17], [-0.3, 1.22, -0.17]], (c) => c[0], (c) => -c[2]);
  });
}, WOOD_PALETTE);

drawn("globe", "a globe of the Domains on a stand, its middle at x, z", (b, p, pal) => {
  const { dark } = woods(pal);
  const { x, z } = p;
  b.cylinder(x, z, 0, 0.06, 0.25, 8, { mat: stock.darkTimber() }, tiled(stock.darkTimber()));
  b.cylinder(x, z, 0.06, 0.6, 0.05, 6, { mat: stock.darkTimber() });
  b.blob(x, 0.9, z, 0.3, 0.3, 0.3, material("globe", () => RP.domainsMap(17)), [0, 0]);
  b.box(x - 0.36, 0.86, z - 0.03, x + 0.36, 0.92, z + 0.03, sides(brass()));
  void dark;
}, WOOD_PALETTE);

drawn("book-pile", "a pile of books, its middle at x, z (at y); its seed", (b, p) => {
  const colors = [C.RED[2]!, C.BLUE[2]!, C.GREEN[2]!, C.PURPLE[2]!, C.WOOD[3]!, C.GOLD[2]!];
  const seed = p.seed ?? 1;
  const n = 3 + Math.floor(hash2(seed, 1, 2) * 3);
  standing(b, p, () => {
    let y = 0;
    for (let k = 0; k < n; k++) {
      const w = 0.22 + hash2(k, seed, 3) * 0.12;
      const d = 0.16 + hash2(k, seed, 4) * 0.06;
      const h = 0.05 + hash2(k, seed, 5) * 0.04;
      const dx = (hash2(k, seed, 6) - 0.5) * 0.08;
      b.box(dx - w, y, -d, dx + w, y + h, d, { top: tiled(flat(colors[(k + seed) % colors.length]!)), south: tiled(flat(0xe8dcc0)), north: tiled(flat(colors[(k + seed) % colors.length]!)), east: tiled(flat(colors[(k + seed) % colors.length]!)), west: tiled(flat(0xe8dcc0)) });
      y += h;
    }
  });
});

drawn("ladder", "a library ladder leaning on a wall (its face at z) at x (its middle), args.h high (2.5)", (b, p, pal) => {
  const h = num(p, "h", 2.5);
  const { timber } = woods(pal);
  wallPiece(b, p, () => {
    for (let k = 0; k * 0.3 < h; k++) {
      const y = 0.25 + k * 0.3;
      const z = 0.55 - (y / h) * 0.45;
      b.box(-0.22, y, z, 0.22, y + 0.05, z + 0.05, sides(timber));
    }
    for (const x of [-0.26, 0.2]) for (let k = 0; k < 8; k++) {
      const y0 = (k / 8) * h;
      const z0 = 0.6 - (y0 / h) * 0.45;
      b.box(x, y0, z0 - 0.06, x + 0.06, y0 + h / 8, z0, sides(timber));
    }
  });
}, WOOD_PALETTE);

drawn("rune-circle", "a rune circle glowing on the floor, its middle at x, z, args.r across its radius (1.5); args.color violet|teal", (b, p) => {
  const r = num(p, "r", 1.5);
  const teal = str<string>(p, "color", "violet") === "teal";
  const pic = material(teal ? "rune-circle-teal" : "rune-circle", () => RP.runeCircle(teal ? RP.ARCANE_TEAL : RP.ARCANE), { glowing: true, cutout: true });
  b.decal(fitted(pic), p.x - r, p.z - r, p.x + r, p.z + r, 0.008);
});

drawn("orrery", "an orrery of brass rings and spheres on a stand, its middle at x, z", (b, p, pal) => {
  const { dark } = woods(pal);
  const { x, z } = p;
  b.box(x - 0.3, 0, z - 0.3, x + 0.3, 0.7, z + 0.3, sides(dark));
  b.cylinder(x, z, 0.7, 1.15, 0.03, 6, { mat: brass() });
  b.blob(x, 1.2, z, 0.12, 0.12, 0.12, material("sun-glow", () => new Pixmap(4, 4, C.GOLD[5]!), { glowing: true }), [0, 0]);
  for (const [r, a, c] of [[0.3, 0.4, C.BLUE[4]!], [0.45, 2.1, C.RED[4]!], [0.6, 4.2, C.GREEN[3]!]] as const) {
    b.ring(x, z, 1.2, r - 0.015, r + 0.015, 16, brass());
    b.blob(x + Math.cos(a) * r, 1.2, z + Math.sin(a) * r, 0.06, 0.06, 0.06, flat(c), [0, 0]);
  }
}, WOOD_PALETTE);

drawn("telescope", "a brass telescope on a tripod, its middle at x, z, looking north-east up at the sky", (b, p, pal) => {
  const { dark } = woods(pal);
  standing(b, p, () => {
    for (const [dx, dz] of [[-0.25, 0.2], [0.25, 0.2], [0, -0.28]] as const) {
      for (let k = 0; k < 4; k++) {
        const t = k / 4;
        b.box(dx * (1 - t) - 0.03, t * 1.1, dz * (1 - t) - 0.03, dx * (1 - t) + 0.03, (k + 1) * 0.275, dz * (1 - t) + 0.03, sides(dark));
      }
    }
    // The tube, climbing in steps toward its eyepiece's opposite end.
    for (let k = 0; k < 6; k++) {
      const r = 0.07 + k * 0.006;
      b.box(-0.35 + k * 0.14 - 0.08, 1.05 + k * 0.08 - r, -r, -0.35 + k * 0.14 + 0.08, 1.05 + k * 0.08 + r, r, sides(k % 2 ? brass() : brassLight()));
    }
  });
}, WOOD_PALETTE);

drawn("crystal-pedestal", "a crystal floating over a stone pedestal, its middle at x, z; args.color violet|teal|gold (its light is the room's data)", (b, p) => {
  const ramp = crystalRamp(str(p, "color", "violet"));
  const { x, z } = p;
  const stone = stock.limestone();
  b.box(x - 0.3, 0, z - 0.3, x + 0.3, 0.12, z + 0.3, sides(tiled(stone)));
  b.cylinder(x, z, 0.12, 0.85, 0.16, 8, { mat: stone });
  b.box(x - 0.26, 0.85, z - 0.26, x + 0.26, 0.95, z + 0.26, sides(tiled(stone)));
  crystal(b, x, 1.35, z, 0.22, ramp);
});

drawn("floating-crystal", "a crystal hanging in the air at x, z, its middle at y (1.6); args.color violet|teal|gold, args.size (0.25)", (b, p) => {
  crystal(b, p.x, p.y ?? 1.6, p.z, num(p, "size", 0.25), crystalRamp(str(p, "color", "teal")));
});

drawn("spiral-stair", "a spiral stair climbing once round a post, its middle at x, z, args.r its reach (1.25), args.h to its top (3.5); args.flip winds it the other way", (b, p, pal) => {
  const r = num(p, "r", 1.25);
  const h = num(p, "h", 3.5);
  const top = woodTop(pal.timber);
  const side = stock.timber(pal.timber);
  const { x, z } = p;
  b.cylinder(x, z, 0, h + 0.5, 0.14, 8, { mat: stock.darkTimber(pal.darkTimber) }, tiled(stock.darkTimber(pal.darkTimber)));
  const steps = Math.round(h / 0.1875);
  const turn = bool(p, "flip") ? -1 : 1;
  const da = (turn * Math.PI * 2 * 0.92) / steps;
  const at = (a: number, rr: number, y: number): [number, number, number] => [x + Math.cos(a) * rr, y, z + Math.sin(a) * rr];
  /** A polygon facing the way its normal should (up, or out): its corners reversed if they wind the other way. */
  const face = (mat: Parameters<typeof b.polygon>[0], corners: [number, number, number][], want: [number, number, number]) => {
    const [c0, c1, c2] = corners as [[number, number, number], [number, number, number], [number, number, number]];
    const u = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
    const v = [c2[0] - c0[0], c2[1] - c0[1], c2[2] - c0[2]];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const ordered = n[0]! * want[0] + n[1]! * want[1] + n[2]! * want[2] < 0 ? [...corners].reverse() : corners;
    b.polygon(mat, ordered, ordered.map((c) => [c[0] + c[2], c[1] - c[2]] as const));
  };
  const start = -Math.PI / 2 + Math.PI * 0.75 * turn;
  for (let k = 0; k < steps; k++) {
    const a0 = start + k * da;
    const a1 = a0 + da;
    const y = (k + 1) * 0.1875;
    face(top, [at(a0, 0.14, y), at(a0, r, y), at(a1, r, y), at(a1, 0.14, y)], [0, 1, 0]);
    const mid = (a0 + a1) / 2;
    face(side, [at(a0, r, y - 0.1875), at(a1, r, y - 0.1875), at(a1, r, y), at(a0, r, y)], [Math.cos(mid), 0, Math.sin(mid)]);
    // The riser on the step's leading edge.
    const lead = turn > 0 ? a0 : a0;
    face(side, [at(lead, 0.14, y - 0.1875), at(lead, r, y - 0.1875), at(lead, r, y), at(lead, 0.14, y)], [-Math.sin(lead) * turn, 0, Math.cos(lead) * turn].map((v) => -v) as [number, number, number]);
  }
}, WOOD_PALETTE);

/** A crystal: an eight-faced gem standing on its point, glowing. */
function crystal(b: Parameters<typeof standing>[0], x: number, y: number, z: number, s: number, ramp: Ramp): void {
  const mat = material(`crystal-${ramp[4]!.toString(16)}`, () => {
    const pic = new Pixmap(4, 4, ramp[4]!);
    pic.set(0, 0, ramp[6]!);
    pic.set(1, 0, ramp[5]!);
    pic.set(3, 3, ramp[3]!);
    return pic;
  }, { glowing: true });
  const top: [number, number, number] = [x, y + s * 1.6, z];
  const bottom: [number, number, number] = [x, y - s * 1.6, z];
  const ring = [0, 1, 2, 3].map((k) => [x + Math.cos((k * Math.PI) / 2 + 0.4) * s, y, z + Math.sin((k * Math.PI) / 2 + 0.4) * s] as [number, number, number]);
  for (let k = 0; k < 4; k++) {
    const a = ring[k]!;
    const c = ring[(k + 1) % 4]!;
    b.polygon(mat, [a, top, c], [[0, 0], [0.5, 1], [1, 0]]);
    b.polygon(mat, [c, bottom, a], [[0, 0], [0.5, 1], [1, 0]]);
  }
}

function crystalRamp(color: string): Ramp {
  return color === "teal" ? RP.ARCANE_TEAL : color === "gold" ? C.GOLD.concat([0xfffce0]) : RP.ARCANE;
}

/** An open book, 12 by 8 (or a great one, 16 by 10): two pages of writing and a ribbon. */
function openBook(great = false): Pixmap {
  const w = great ? 16 : 12;
  const h = great ? 10 : 8;
  const p = new Pixmap(w, h, 0xf0e2c0);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (x !== w / 2 - 1 && x !== w / 2 && (x * 3 + y * 7) % 5 < 2) p.set(x, y, 0x6a5040);
  p.vline(w / 2 - 1, 0, h, 0xc0a878);
  p.vline(w / 2, 0, h, 0xd8c498);
  p.vline(w / 2 + 2, 0, h, C.RED[3]!);
  for (let x = 0; x < w; x++) p.set(x, h - 1, great ? C.RED[1]! : C.WOOD[2]!);
  return p;
}
