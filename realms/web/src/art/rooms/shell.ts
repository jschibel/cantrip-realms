import { type Face, MeshBuilder } from "../paint/builder";
import type { Cutaway } from "../recipe";

// The shell of a room seen as a 16-bit RPG shows one, from the south looking north: the back wall standing full height
// facing you, the side walls as thick blocks whose tops you look down on, and the front wall cut down low so nothing in
// the room is hidden - with a gap in it for the way out. Around it is the dark. The side walls are built twice, full
// and cut down to the front wall's height: the one on the camera's side is cut down while the camera is swung round to
// look across the room from a corner, the way a building between the camera and the player is cut away.

export interface ShellSpec {
  /** Floor size in tiles: x 0..width, z 0..depth. */
  readonly width: number;
  readonly depth: number;
  /** The back wall's height, the side walls' thickness, and the front wall's height. */
  readonly height: number;
  readonly thickness: number;
  readonly front: number;
  /** The back wall's face (in bands from the floor up), its side faces, and the tops of every wall. */
  readonly back: readonly { readonly to: number; readonly face: Face; readonly proud?: number }[];
  readonly side: Face;
  readonly top: Face;
  /** The gap in the front wall: its x from and to. */
  readonly exit: readonly [number, number];
}

/** Draws the back and front walls onto `b`, and returns the side walls as cut-aways (west, then east). */
export function roomShell(b: MeshBuilder, r: ShellSpec): Cutaway[] {
  const t = r.thickness;
  const { width: w, depth: d, height: h } = r;
  // The back wall in bands (wainscot, plaster, a beam), each a texel or two proud of the one above if asked.
  let y = 0;
  for (const band of r.back) {
    const proud = band.proud ?? 0;
    b.box(-t, y, -t, w + t, band.to, proud, { south: band.face, top: proud > 0 ? band.face : undefined });
    y = band.to;
  }
  b.box(-t, 0, -t, w + t, h, 0, { top: r.top });
  // The side walls: blocks the full depth of the room, and their cut-down stand-ins.
  const wall = (x0: number, x1: number, height: number, inner: "east" | "west", z0: number) => {
    const wb = new MeshBuilder();
    wb.box(x0, 0, z0, x1, height, d + t, { [inner]: r.side, top: r.top, south: r.top, north: r.top });
    return wb.model();
  };
  const sides: Cutaway[] = [
    { full: wall(-t, 0, h, "east", -t), low: wall(-t, 0, r.front, "east", 0), when: { camera: "west" } },
    { full: wall(w, w + t, h, "west", -t), low: wall(w, w + t, r.front, "west", 0), when: { camera: "east" } },
  ];
  // The front wall, low, with its gap.
  const [g0, g1] = r.exit;
  b.box(0, 0, d, g0, r.front, d + t, { north: r.side, top: r.top, south: r.top, east: r.side });
  b.box(g1, 0, d, w, r.front, d + t, { north: r.side, top: r.top, south: r.top, west: r.side });
  return sides;
}

/** The exit's gap in the front wall for an interior's entry tile: two tiles wide, the entry its east one. */
export const exitGap = (entryX: number): [number, number] => [entryX - 1, entryX + 1];
