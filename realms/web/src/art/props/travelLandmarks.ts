import { coneRoof } from "../buildings/kit";
import { copper, dome } from "../buildings/tolarian";
import { type Material, type MeshBuilder, fitted, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material, stock } from "../paint/materials";
import { type Ramp, rampKey } from "../paint/palette";
import { Pixmap, type Rgb, hash2, seeded } from "../paint/pixmap";
import * as R from "../paint/ramps";
import * as G from "../paint/terrain";
import type { LightData } from "../../world/format";
import { bark, cutout, foliage, frustum, glowing, limb, lump, rock } from "./kit";
import { type V3, TAU, facet, spike } from "./travelKit";

// The travel map's wonders (travel.ts registers `landmark`): each a miniature on a 3x3 square, drawn about the origin
// facing south (travel.ts turns it by its rot and places it).
//
//   cathedral        the Cathedral of Serra: white stone, gold roofs, twin spired towers, a rose window, a crossing spire
//   great-oak        the Oak of the Oath: an oak whose crown fills the square, roots over the ground, a ring of stones
//   floating-towers  three islands of rock hanging over the ground, towers on them; their shadows lie below
//   ruin             the walls of a broken keep, columns standing and fallen, rubble, ivy
//   obelisk          a dark obelisk on a stepped plinth, runes glowing down its faces
//   arena            a round arena of stone in tiers round a floor of sand, its gates north and south, pennants
//   lighthouse       a striped tower on a rock, its lantern lit (LANDMARK_LIGHTS: its light, for the chunk's lights)

export const LANDMARK_KINDS = ["cathedral", "great-oak", "floating-towers", "ruin", "obelisk", "arena", "lighthouse"] as const;

/**
 * The light a landmark gives, by kind, about its anchor (unturned) - as a lit prop's catalogue `light` is: the world
 * generator adds it to the chunk's `lights` (the catalogue's one `light` a prop id would apply to every kind).
 */
export const LANDMARK_LIGHTS: Readonly<Partial<Record<(typeof LANDMARK_KINDS)[number], Omit<LightData, "at"> & { readonly at: readonly [number, number, number] }>>> = {
  lighthouse: { kind: "point", color: [1.0, 0.82, 0.5], intensity: 1.6, reach: 7, at: [0, 2.85, 0] },
};

const solid = (name: string, c: Rgb) => material(`mini-${name}`, () => new Pixmap(2, 2, c));

/** Ashlar in small courses (16 texels a tile), a ramp's stone. */
function ashlar(ramp: Ramp): Material {
  return material(`mini-ashlar@${rampKey(ramp)}`, () => {
    const p = new Pixmap(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const course = Math.floor(y / 3);
        const off = course % 2 ? 3 : 0;
        p.set(x, y, y % 3 === 2 ? ramp[2]! : (x + off) % 6 === 5 ? ramp[3]! : hash2(Math.floor((x + off) / 6), course, 4) < 0.5 ? ramp[4]! : ramp[5]!);
      }
    }
    return p;
  });
}

/** Roof tiles of gold in rows (Serra's). */
const goldTiles = () =>
  material("mini-gold-tiles", () => {
    const p = new Pixmap(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, y % 3 === 2 ? C.GOLD[1]! : (x + (Math.floor(y / 3) % 2) * 2) % 4 === 0 ? C.GOLD[2]! : hash2(x, y, 3) < 0.2 ? C.GOLD[4]! : C.GOLD[3]!);
    return p;
  });

// --- The Cathedral of Serra ---------------------------------------------------------------------------------------------

function cathedral(b: MeshBuilder): void {
  const white = tiled(ashlar(R.MARBLE));
  const gold = goldTiles();
  // Its steps: a broad platform of marble.
  b.box(-1.3, 0, -1.4, 1.3, 0.08, 1.3, { top: tiled(material("mini-marble-paving", () => G.marblePaving())), north: white, south: white, east: white, west: white });
  const y0 = 0.08;
  // The nave (north-south) under a gold roof, buttresses along it.
  b.box(-0.5, y0, -1.05, 0.5, y0 + 1.05, 0.45, sides(white));
  b.at(0, 0, -0.3, Math.PI / 2, () => b.gableRoof(-0.78, -0.58, 0.78, 0.58, y0 + 1.05, 0.55, gold, white));
  for (const z of [-0.88, 0.05, 0.32]) {
    for (const s of [-1, 1]) {
      b.box(s > 0 ? 0.5 : -0.66, y0, z - 0.06, s > 0 ? 0.66 : -0.5, y0 + 0.7, z + 0.06, sides(white));
      limb(b, [s * 0.66, y0 + 0.66, z], [s * 0.5, y0 + 0.98, z], 0.035, 0.035, ashlar(R.MARBLE), 3);
    }
  }
  // The transept (east-west), gabled.
  b.box(-1.02, y0, -0.58, 1.02, y0 + 0.95, -0.1, sides(white));
  b.gableRoof(-1.06, -0.63, 1.06, -0.05, y0 + 0.95, 0.45, gold, white);
  // The apse, round, at the north end.
  b.cylinder(0, -1.05, y0, y0 + 0.95, 0.45, 10, white);
  coneRoof(b, 0, -1.05, y0 + 0.95, 0.5, 0.42, gold, 10);
  // Twin towers on the south front, spired; a spire over the crossing, the tallest thing for leagues.
  for (const x of [-0.58, 0.58]) {
    b.box(x - 0.21, y0, 0.35, x + 0.21, y0 + 1.85, 0.79, sides(white));
    b.card(fitted(solid("ink", C.INK)), x - 0.05, y0 + 1.35, x + 0.05, y0 + 1.6, 0.795);
    spike(b, x, 0.57, y0 + 1.85, y0 + 2.85, 0.3, 4, gold, Math.PI / 4);
    b.box(x - 0.025, y0 + 2.85, 0.545, x + 0.025, y0 + 3.0, 0.595, sides(fitted(solid("gold", C.GOLD[5]!))));
  }
  b.cylinder(0, -0.34, y0 + 1.05, y0 + 1.7, 0.26, 8, white, white);
  spike(b, 0, -0.34, y0 + 1.7, y0 + 3.2, 0.28, 8, gold);
  // The front between the towers, its gable, a rose window over the door.
  b.box(-0.37, y0, 0.45, 0.37, y0 + 1.35, 0.64, sides(white));
  facet(b, ashlar(R.MARBLE), [-0.37, y0 + 1.35, 0.64], [0.37, y0 + 1.35, 0.64], [0, y0 + 1.72, 0.64]);
  const rose = material(
    "mini-rose-window",
    () => {
      const p = new Pixmap(7, 7);
      p.fill(0, 0);
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const d = Math.hypot(x - 3, y - 3);
          if (d > 3.4) continue;
          p.put(x, y, d > 2.6 ? C.GOLD[3]! : d < 0.8 ? C.GOLD[5]! : (x + y) % 2 ? C.BLUE[4]! : C.RED[4]!);
        }
      }
      return p;
    },
    { glow: 0.5, cutout: true },
  );
  b.card(fitted(rose), -0.22, y0 + 0.78, 0.22, y0 + 1.22, 0.645);
  b.card(fitted(solid("ink", C.INK)), -0.12, y0, 0.12, y0 + 0.52, 0.645);
}
// --- The Oak of the Oath ------------------------------------------------------------------------------------------------

function greatOak(b: MeshBuilder, seed: number): void {
  const random = seeded(seed + 77);
  const bk = bark(C.WOOD);
  const leaf = foliage(C.LEAF);
  limb(b, [0, -0.05, 0], [0.06, 1.75, -0.04], 0.4, 0.27, bk, 8);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    limb(b, [Math.sin(a) * 0.2, 0.5, Math.cos(a) * 0.2], [Math.sin(a) * 0.85, 0, Math.cos(a) * 0.8], 0.16, 0.05, bk, 5);
  }
  for (const [dx, dz] of [
    [-0.75, 0.15],
    [0.8, 0.0],
    [0.1, -0.7],
    [0.05, 0.6],
  ] as const)
    limb(b, [0.04, 1.45, -0.03], [dx * 1.2, 2.25, dz * 1.2], 0.17, 0.08, bk, 5);
  // The crown: broad, a little lop-sided, filling the square and more.
  b.blob(0, 2.85, -0.05, 1.4, 0.8, 1.3, leaf, [3, 1], 1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + random() * 0.5;
    b.blob(Math.sin(a) * 0.98, 2.4 + random() * 0.3, Math.cos(a) * 0.9 - 0.05, 0.68, 0.52, 0.64, leaf, [i * 7, i * 3], 1);
  }
  // The ring of stones the oath was sworn in, open to the south.
  const stone = rock(R.GRANITE, R.LICHEN);
  for (let i = 0; i < 8; i++) {
    const a = (i / 9) * TAU + Math.PI / 9 + Math.PI / 9;
    lump(b, Math.sin(a) * 1.28, Math.cos(a) * 1.28, 0, [[0.11, 0], [0.12, 0.25], [0.09, 0.42], [0.05, 0.5]], 5, stone, i + seed, 0.12, { squash: 0.6 });
  }
}

// --- The Floating Towers ------------------------------------------------------------------------------------------------

/** An island of rock hanging at `y` (its top), its grass on top, its rock tapering down to a point `depth` below. */
function island(b: MeshBuilder, x: number, z: number, y: number, r: number, depth: number, seed: number): void {
  const random = seeded(seed * 13 + 3);
  const n = 8;
  const stone = rock(R.GRANITE, null);
  const grass = material("mini-island-grass", () => G.meadow(C.GRASS, 102));
  const top: V3[] = [];
  const mid: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = r * (0.9 + random() * 0.2);
    top.push([x + Math.sin(a) * k, y, z + Math.cos(a) * k]);
    const m = k * (0.62 + random() * 0.12);
    mid.push([x + Math.sin(a + 0.2) * m, y - depth * (0.38 + random() * 0.1), z + Math.cos(a + 0.2) * m]);
  }
  const apex: V3 = [x + (random() - 0.5) * 0.1, y - depth, z + (random() - 0.5) * 0.1];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    facet(b, stone, mid[i]!, mid[j]!, top[j]!);
    facet(b, stone, mid[i]!, top[j]!, top[i]!);
    facet(b, stone, apex, mid[j]!, mid[i]!);
  }
  // Its lip of turf, a little proud of the rock.
  facet(b, grass, ...top.map((q) => [q[0], q[1] + 0.02, q[2]] as V3));
  // A shard of crystal glowing at its point: what holds it up.
  spike(b, apex[0], apex[2], apex[1] - 0.18, apex[1] + 0.02, 0.05, 4, glowing(0x9ac8ff), 0);
}

function floatingTowers(b: MeshBuilder, seed: number): void {
  const wall = tiled(ashlar(R.MARBLE));
  const slate = stock.slate(C.SLATE);
  const towerOn = (x: number, z: number, y: number, r: number, h: number) => {
    b.cylinder(x, z, y, y + h, r, 8, wall, wall);
    coneRoof(b, x, z, y + h, r * 1.3, r * 2.0, slate, 8);
    b.box(x - 0.03, y + h * 0.6, z + r - 0.01, x + 0.03, y + h * 0.6 + 0.08, z + r + 0.01, sides(fitted(glowing(C.GOLD[4]!))));
  };
  // The furthest highest, the nearest lowest, so none hides the others from the camera.
  island(b, -0.55, -0.55, 1.75, 0.72, 1.1, seed + 1);
  towerOn(-0.6, -0.62, 1.75, 0.26, 1.2);
  island(b, 0.68, -0.12, 1.3, 0.6, 0.9, seed + 2);
  towerOn(0.78, -0.18, 1.3, 0.2, 0.8);
  dome(b, 0.5, 0.12, 1.3, 0.22, 0.2, copper(R.VERDIGRIS), 8, 3);
  island(b, -0.12, 0.72, 0.85, 0.5, 0.65, seed + 3);
  towerOn(-0.16, 0.7, 0.85, 0.17, 0.55);
  // Rubble fallen from them on the ground below.
  const stone = rock(R.GRANITE, R.LICHEN);
  const random = seeded(seed + 9);
  for (let i = 0; i < 6; i++) {
    const r = 0.06 + random() * 0.08;
    lump(b, (random() - 0.5) * 2.2, (random() - 0.5) * 2.2, 0, [[r, 0], [r, r * 0.5], [0, r]], 5, stone, i, 0.3);
  }
}

// --- A ruin -------------------------------------------------------------------------------------------------------------

function ruin(b: MeshBuilder, seed: number): void {
  const random = seeded(seed + 31);
  const wall = tiled(ashlar(R.GRANITE));
  const ivy = foliage(R.MOSS);
  b.decal(tiled(material("mini-ruin-flags", () => G.bedrock(R.GRANITE, 116), { flat: true })), -1.1, -1.1, 1.1, 1.1, 0.008);
  // The walls of a square keep, broken down to stumps, gaps where they fell.
  const s = 1.05;
  const t = 0.12;
  const runs: [number, number, number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = -s + (i * 2 * s) / 5;
    const c = a + (2 * s) / 5;
    runs.push([a, -s - t, c, -s + t]);
    runs.push([-s - t, a, -s + t, c]);
    runs.push([s - t, a, s + t, c]);
    if (i !== 2) runs.push([a, s - t, c, s + t]);
  }
  runs.forEach(([x0, z0, x1, z1], i) => {
    if (random() < 0.2) return;
    const front = z0 > 0.5;
    const h = front ? 0.15 + random() * 0.3 : 0.35 + random() * 0.85;
    b.box(x0, 0, z0, x1, h, z1, sides(wall));
    if (random() < 0.4) b.blob((x0 + x1) / 2, h, (z0 + z1) / 2, 0.22, 0.12, 0.2, ivy, [i * 3, 2], 0);
  });
  // A tower's stump at the back corner.
  b.cylinder(-s, -s, 0, 1.35, 0.28, 8, wall, wall);
  // Columns standing before the gap of its gate, one fallen.
  const col = ashlar(R.MARBLE);
  for (const [x, h] of [
    [-0.55, 0.95],
    [0.55, 0.6],
  ] as const) {
    b.cylinder(x, 1.35, 0, h, 0.08, 6, tiled(col), tiled(col));
  }
  limb(b, [0.1, 0.08, 1.38], [0.85, 0.08, 1.2], 0.08, 0.08, col, 6, true);
  // Rubble heaps.
  const stone = rock(R.GRANITE, R.LICHEN);
  for (let i = 0; i < 7; i++) {
    const r = 0.08 + random() * 0.1;
    lump(b, (random() - 0.5) * 2.4, (random() - 0.5) * 2.4, 0, [[r, 0], [r * 1.05, r * 0.4], [r * 0.5, r * 0.85], [0, r]], 5, stone, i + seed, 0.3);
  }
}

// --- The obelisk --------------------------------------------------------------------------------------------------------

function obelisk(b: MeshBuilder): void {
  const plinth = tiled(ashlar(R.GRANITE));
  const dark = R.BASALT;
  for (const [s, y] of [
    [0.85, 0],
    [0.62, 0.14],
    [0.42, 0.28],
  ] as const)
    b.box(-s, y, -s, s, y + 0.14, s, sides(plinth));
  // A tapering shaft of dark stone, four faces from y0 to y1, its runes glowing down the faces the camera sees.
  const y0 = 0.42;
  const y1 = 2.75;
  const r0 = 0.22;
  const r1 = 0.14;
  const stone = rock(dark, null);
  const corner = (sx: number, sz: number, y: number, r: number): V3 => [sx * r, y, sz * r];
  const faces: [number, number, number, number][] = [
    [-1, 1, 1, 1],
    [1, 1, 1, -1],
    [1, -1, -1, -1],
    [-1, -1, -1, 1],
  ];
  for (const [ax, az, cx, cz] of faces) facet(b, stone, corner(ax, az, y0, r0), corner(cx, cz, y0, r0), corner(cx, cz, y1, r1), corner(ax, az, y1, r1));
  spike(b, 0, 0, y1, y1 + 0.3, r1 * Math.SQRT2, 4, solid("gold", C.GOLD[5]!), Math.PI / 4);
  const rune = material(
    "mini-runes",
    () => {
      const p = new Pixmap(3, 32);
      p.fill(0, 0);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 3; x++) if (y % 4 !== 3 && hash2(x, y, 61) < 0.55) p.put(x, y, 0x7ae8d0);
      return p;
    },
    { glowing: true, cutout: true },
  );
  // On the south face and the east, a strip of runes a little proud of the stone.
  const strip = (nx: number, nz: number) => {
    const w0 = 0.06;
    const w1 = 0.04;
    const ya = y0 + 0.2;
    const yb = y1 - 0.25;
    const ra = r0 + (r1 - r0) * ((ya - y0) / (y1 - y0)) + 0.008;
    const rb = r0 + (r1 - r0) * ((yb - y0) / (y1 - y0)) + 0.008;
    const tx = -nz;
    const tz = nx;
    b.polygon(rune, [
      [nx * ra - tx * w0, ya, nz * ra - tz * w0],
      [nx * ra + tx * w0, ya, nz * ra + tz * w0],
      [nx * rb + tx * w1, yb, nz * rb + tz * w1],
      [nx * rb - tx * w1, yb, nz * rb - tz * w1],
    ], [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
  };
  strip(0, 1);
  strip(1, 0);
  strip(-1, 0);
}

// --- The arena -----------------------------------------------------------------------------------------------------------

function arena(b: MeshBuilder): void {
  const n = 18;
  const ro = 1.32;
  const rm = 1.02;
  const ri = 0.72;
  const h = 0.72;
  const step = 0.38;
  const sx = 1.12;
  const outer = material("mini-arcade", () => {
    const p = new Pixmap(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let c = y % 4 === 3 ? R.SANDSTONE[3]! : hash2(x, y, 5) < 0.15 ? R.SANDSTONE[4]! : R.SANDSTONE[5]!;
        // Two rows of arches: dark openings with a lit keystone.
        const ax = x % 4;
        if ((ax === 1 || ax === 2) && ((y >= 9 && y <= 12) || (y >= 3 && y <= 5))) c = R.SANDSTONE[0]!;
        if ((ax === 1 || ax === 2) && (y === 8 || y === 2)) c = R.SANDSTONE[2]!;
        p.set(x, y, c);
      }
    }
    return p;
  });
  const seat = ashlar(R.SANDSTONE);
  const pt = (a: number, r: number, y: number): V3 => [Math.sin(a) * r * sx, y, Math.cos(a) * r];
  const gate = (i: number) => i === 0 || i === n / 2;
  for (let i = 0; i < n; i++) {
    if (gate(i)) continue;
    const a0 = ((i - 0.5) / n) * TAU;
    const a1 = ((i + 0.5) / n) * TAU;
    // The outer wall, its top, its inner face; the tier of seats inside, its top and its face to the floor.
    facet(b, outer, pt(a0, ro, 0), pt(a1, ro, 0), pt(a1, ro, h), pt(a0, ro, h));
    facet(b, seat, pt(a0, ro, h), pt(a1, ro, h), pt(a1, rm, h), pt(a0, rm, h));
    facet(b, seat, pt(a1, rm, step), pt(a0, rm, step), pt(a0, rm, h), pt(a1, rm, h));
    facet(b, seat, pt(a0, rm, step), pt(a1, rm, step), pt(a1, ri, step), pt(a0, ri, step));
    facet(b, seat, pt(a1, ri, 0), pt(a0, ri, 0), pt(a0, ri, step), pt(a1, ri, step));
    // The ends either side of a gate, closed.
    if (gate(i - 1)) facet(b, seat, pt(a0, ri, 0), pt(a0, ro, 0), pt(a0, ro, h), pt(a0, rm, h), pt(a0, rm, step), pt(a0, ri, step));
    if (gate(i + 1)) facet(b, seat, pt(a1, ri, step), pt(a1, rm, step), pt(a1, rm, h), pt(a1, ro, h), pt(a1, ro, 0), pt(a1, ri, 0));
  }
  // The floor of sand, and the gates' arches over their ways.
  const sand = material("mini-arena-sand", () => G.sand(R.SAND, 119), { flat: true });
  const floor: V3[] = [];
  for (let i = 0; i < n; i++) floor.push(pt((i / n) * TAU, ri, 0.012));
  facet(b, sand, ...floor);
  for (const a of [0, Math.PI]) {
    const [x, , z] = pt(a, (ro + ri) / 2, 0);
    b.at(x, 0, z, a, () => {
      b.box(-0.22, h * 0.7, -(ro - ri) / 2, 0.22, h + 0.05, (ro - ri) / 2, sides(tiled(seat)));
    });
  }
  // Pennants round its rim.
  const cloth = cutout("mini-arena-pennant", () => {
    const p = new Pixmap(3, 5);
    p.fill(0, 0);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (y < 4 || x === 1) p.put(x, y, x === 0 ? C.RED[4]! : C.RED[3]!);
    return p;
  });
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * TAU;
    const [x, , z] = pt(a, ro - 0.05, 0);
    limb(b, [x, h, z], [x, h + 0.38, z], 0.012, 0.012, bark(C.DARKWOOD), 3);
    b.card(fitted(cloth), x, h + 0.2, x + 0.16, h + 0.38, z);
  }
}

// --- The lighthouse ---------------------------------------------------------------------------------------------------------

function lighthouse(b: MeshBuilder, seed: number): void {
  lump(b, 0, 0, -0.2, [[1.05, 0], [0.92, 0.3], [0.62, 0.55], [0.4, 0.62]], 9, rock(R.GRANITE, R.LICHEN), seed + 2, 0.18);
  const red = solid("lighthouse-red", C.RED[3]!);
  const white = material("mini-lighthouse-white", () => {
    const p = new Pixmap(8, 8, C.CLOTH_WHITE[4]!);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (hash2(x, y, 4) < 0.15) p.set(x, y, C.CLOTH_WHITE[3]!);
    return p;
  });
  const y0 = 0.4;
  const y1 = 2.55;
  const r0 = 0.38;
  const r1 = 0.24;
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const a = y0 + ((y1 - y0) * i) / bands;
    const c = y0 + ((y1 - y0) * (i + 1)) / bands;
    const ra = r0 + ((r1 - r0) * i) / bands;
    const rc = r0 + ((r1 - r0) * (i + 1)) / bands;
    frustum(b, 0, 0, a, c, ra, rc, 10, i % 2 ? red : white);
  }
  // A window or two up it, the gallery, the lantern lit, its roof.
  b.box(-0.04, 1.2, r0 - 0.06, 0.04, 1.32, r0 - 0.04 + 0.03, sides(fitted(solid("ink", C.INK))));
  const iron = solid("lighthouse-iron", C.IRON[2]!);
  b.cylinder(0, 0, y1, y1 + 0.06, 0.34, 10, { mat: iron }, { mat: iron });
  b.cylinder(0, 0, y1 + 0.06, y1 + 0.36, 0.18, 8, fitted(glowing(C.GOLD[5]!)), { mat: iron });
  spike(b, 0, 0, y1 + 0.36, y1 + 0.62, 0.24, 8, red);
  // The keeper's cottage at its foot.
  const wall = tiled(ashlar(C.LIMESTONE));
  b.box(0.48, 0.25, 0.32, 0.92, 0.6, 0.66, sides(wall));
  b.gableRoof(0.44, 0.28, 0.96, 0.7, 0.6, 0.22, stock.roof(C.ROOF), wall);
}

/** Draws a landmark about the origin, its front to the south. */
export function landmark(b: MeshBuilder, kind: string, seed: number): void {
  switch (kind) {
    case "cathedral":
      return cathedral(b);
    case "great-oak":
      return greatOak(b, seed);
    case "floating-towers":
      return floatingTowers(b, seed);
    case "obelisk":
      return obelisk(b);
    case "arena":
      return arena(b);
    case "lighthouse":
      return lighthouse(b, seed);
    default:
      return ruin(b, seed);
  }
}
