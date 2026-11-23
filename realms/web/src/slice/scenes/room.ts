import * as THREE from "three";
import { type Face, type Material, MeshBuilder, sides, tiled } from "../../art/paint/builder";
import { Grid } from "../../world/grid";
import { PX } from "../../art/props/props";

// The shell of a room seen as a 16-bit RPG shows one, from the south looking north: the back wall standing full height
// facing you, the side walls as thick blocks whose tops you look down on, and the front wall cut down low so nothing in
// the room is hidden - with a gap in it for the way out. Around it is the dark.

export interface RoomSpec {
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

/**
 * The side walls, built apart so the one on the camera's side can be cut down to the front wall's height when the camera
 * swings round to look across the room from a corner, the way a building between the camera and the player is cut away.
 */
export interface SideWalls {
  readonly east: { readonly full: THREE.Group; readonly low: THREE.Group };
  readonly west: { readonly full: THREE.Group; readonly low: THREE.Group };
  /** Cuts the east (camera from the south-east) and west (from the south-west) walls down, or stands them up. */
  cut(east: boolean, west: boolean): void;
}

export function roomShell(b: MeshBuilder, r: RoomSpec, scene: THREE.Scene): SideWalls {
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
    const g = wb.build(`wall:${inner === "east" ? "west" : "east"}:${height}`);
    scene.add(g);
    return g;
  };
  const sides: SideWalls = {
    west: { full: wall(-t, 0, h, "east", -t), low: wall(-t, 0, r.front, "east", 0) },
    east: { full: wall(w, w + t, h, "west", -t), low: wall(w, w + t, r.front, "west", 0) },
    cut(east, west) {
      sides.east.full.visible = !east;
      sides.east.low.visible = east;
      sides.west.full.visible = !west;
      sides.west.low.visible = west;
    },
  };
  sides.cut(false, false);
  // The front wall, low, with its gap.
  const [g0, g1] = r.exit;
  b.box(0, 0, d, g0, r.front, d + t, { north: r.side, top: r.top, south: r.top, east: r.side });
  b.box(g1, 0, d, w, r.front, d + t, { north: r.side, top: r.top, south: r.top, west: r.side });
  return sides;
}

/** Which side walls to cut for the camera's turn now and the heading it is turning to: the near side's, as it swings. */
export function cutFor(sides: SideWalls, yaw: number, toward: number): void {
  sides.cut(yaw > 0.01 || toward > 0.01, yaw < -0.01 || toward < -0.01);
}

/** A grid of the room's floor, every tile open. */
export function roomGrid(width: number, depth: number): Grid {
  const g = new Grid(width, depth);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) g.setWalkable(x, z, true);
  return g;
}

/** A lamp's light: warm, local, falling off to nothing - its pool steps down in bands across the floor. */
export function pointLight(scene: THREE.Scene, x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, reach: number): THREE.PointLight {
  const light = new THREE.PointLight(color, intensity, reach, 1.4);
  light.position.set(x, y, z);
  scene.add(light);
  return light;
}

/** Daylight through a window: a spot from outside and above, laying a bright patch on the floor beneath it. */
export function windowLight(scene: THREE.Scene, x: number, y: number, z: number, toX: number, toZ: number, intensity = 30): THREE.SpotLight {
  const light = new THREE.SpotLight(new THREE.Color(1.0, 0.94, 0.78), intensity, 14, 0.36, 0.05, 1.2);
  light.position.set(x, y, z);
  light.target.position.set(toX, 0, toZ);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.001;
  scene.add(light, light.target);
  return light;
}

export { PX, sides, tiled, type Material };
