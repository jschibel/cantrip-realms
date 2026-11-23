import type { InteriorData } from "../../world/format";
import { type Face, MeshBuilder, sides } from "../paint/builder";
import { flat } from "../paint/materials";
import * as C from "../paint/colors";
import type { Palette } from "../paint/palette";
import type { Built, Cutaway } from "../recipe";
import { ROOMS } from "./registry";
import { exitGap } from "./shell";
import { finishOf } from "./styles";

// A floor of a mage tower: a round room, its wall a ring `w` across (the floor `w` by `w` tiles, the ring inside it)
// in its style's finish. Seen as a square room is: the far half of the ring stands full height, the near half is cut
// down low with the way out in it, and the two flanks are cut-aways that drop while the camera looks across from their
// side. Its props (a spiral stair, a rune circle, the mage's instruments) are laid out by layout.ts.

const HEIGHT = 3.5;
const THICKNESS = 0.75;
const FRONT = 0.6;
const SEGMENTS = 40;

type V3 = readonly [number, number, number];

/** Where a tile's middle is from the tower's middle, in tiles: the floor is the tiles inside the ring. */
export const towerRadius = (room: { readonly w: number }): number => room.w / 2;

function tower(room: InteriorData, pal: Palette): Built {
  const f = finishOf(room.style, pal);
  const W = room.w;
  const D = room.d;
  const cx = W / 2;
  const cz = D / 2;
  const R = Math.min(W, D) / 2;
  const bands = f.bands(HEIGHT);
  const gap = exitGap(room.entry[0]);
  const back = new MeshBuilder();
  const front = new MeshBuilder();
  const flank = { west: { full: new MeshBuilder(), low: new MeshBuilder() }, east: { full: new MeshBuilder(), low: new MeshBuilder() } };
  const point = (a: number, r: number, y: number): V3 => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  /** A piece of the ring from angle a0 to a1, `h` high: its inner face in bands, its top. */
  const piece = (b: MeshBuilder, a0: number, a1: number, h: number) => {
    let y = 0;
    const mid = (a0 + a1) / 2;
    // Tiled along the arc: u is the distance round the ring, unwrapped about the piece's middle.
    const u = (c: V3) => {
      let a = Math.atan2(c[2] - cz, c[0] - cx);
      while (a - mid > Math.PI) a -= 2 * Math.PI;
      while (mid - a > Math.PI) a += 2 * Math.PI;
      return a * R;
    };
    for (const band of bands) {
      const top = Math.min(band.to, h);
      if (top <= y) break;
      b.quad(band.face, [point(a0, R, y), point(a1, R, y), point(a1, R, top), point(a0, R, top)], u, (c) => c[1]);
      y = top;
    }
    if (y < h) b.quad(bands[bands.length - 1]!.face, [point(a0, R, y), point(a1, R, y), point(a1, R, h), point(a0, R, h)], u, (c) => c[1]);
    b.quad(f.top, [point(a1, R + THICKNESS, h), point(a0, R + THICKNESS, h), point(a0, R, h), point(a1, R, h)], (c) => c[0], (c) => -c[2]);
  };
  /** An end of the ring where a piece stops (by the way out): a face across the wall's thickness. */
  const end = (b: MeshBuilder, a: number, h: number, face: Face) => {
    b.quad(face, [point(a, R + THICKNESS, 0), point(a, R, 0), point(a, R, h), point(a, R + THICKNESS, h)], (c) => c[0] + c[2], (c) => c[1]);
    b.quad(face, [point(a, R, 0), point(a, R + THICKNESS, 0), point(a, R + THICKNESS, h), point(a, R, h)], (c) => c[0] + c[2], (c) => c[1]);
  };
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const s = Math.sin(mid);
    const c = Math.cos(mid);
    if (s < -0.35) piece(back, a0, a1, HEIGHT);
    else if (s > 0.35) {
      // The near side, low - but for the way out.
      const x = cx + c * R;
      if (x > gap[0] - 0.05 && x < gap[1] + 0.05) continue;
      piece(front, a0, a1, FRONT);
      const xa = cx + Math.cos(a0) * R;
      const xb = cx + Math.cos(a1) * R;
      if (xa >= gap[0] - 0.05 && xa <= gap[1] + 0.05) end(front, a0, FRONT, f.side);
      if (xb >= gap[0] - 0.05 && xb <= gap[1] + 0.05) end(front, a1, FRONT, f.side);
    } else {
      const side = c < 0 ? flank.west : flank.east;
      piece(side.full, a0, a1, HEIGHT);
      piece(side.low, a0, a1, FRONT);
    }
  }
  // A skirt of the dark round the ring, over the floor's square tiles where they reach past it.
  const dark = flat(0x000000);
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const x = cx + Math.cos((a0 + a1) / 2) * R;
    if (Math.sin((a0 + a1) / 2) > 0 && x > gap[0] - 0.3 && x < gap[1] + 0.3) continue;
    back.polygon(dark, [point(a1, R + THICKNESS + 1.5, 0.01), point(a0, R + THICKNESS + 1.5, 0.01), point(a0, R + THICKNESS - 0.05, 0.01), point(a1, R + THICKNESS - 0.05, 0.01)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // The doorframe at the way out.
  for (const x of [gap[0] - 0.125, gap[1]]) back.box(x, 0, D - 0.25, x + 0.125, 0.8, D + THICKNESS - 0.25, sides(f.frame));
  front.add(back.model());
  const cutaways: Cutaway[] = [
    { full: flank.west.full.model(), low: flank.west.low.model(), when: { camera: "west" } },
    { full: flank.east.full.model(), low: flank.east.low.model(), when: { camera: "east" } },
  ];
  return {
    model: front.model(),
    cutaways,
    lights: [
      { kind: "hemisphere", sky: f.sky, ground: f.ground, intensity: f.fill * Math.PI },
      { kind: "directional", color: f.daylight.color, intensity: f.daylight.intensity * Math.PI, from: f.daylight.from },
    ],
    doorway: [(gap[0] + gap[1]) / 2, 0.8, D],
    bounds: [-THICKNESS, -THICKNESS - HEIGHT, W + THICKNESS, D + THICKNESS],
  };
}

ROOMS.define("tower", "a round floor of a mage tower, `w` across, in its style's finish", tower, { plaster: C.PLASTER, darkTimber: C.DARKWOOD });
