import type { InteriorData } from "../../world/format";
import { MeshBuilder, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material, stock } from "../paint/materials";
import type { Palette } from "../paint/palette";
import * as Pic from "../paint/pictures";
import * as T from "../paint/textures";
import type { Built } from "../recipe";
import { ROOMS } from "./registry";
import { exitGap, roomShell } from "./shell";

// A crypt: a vaulted hall of cold violet stone - courses of crypt brick between dark plinths and cornices, the walls'
// tops flagged - and a stair climbing south out of the front wall's gap. Almost no light but a cold violet fill: its
// braziers, torches and the glow down the stair are the room's lights. (The crypt under New Benalia's churchyard in
// the slice; its ossuary, pillars, dais and coffins are its props.)

const WALL = 3.2;
const THICKNESS = 0.875;
const FRONT = 0.75;

function crypt(room: InteriorData, pal: Palette): Built {
  const { w: W, d: D } = room;
  const b = new MeshBuilder();
  const ramp = pal.stone ?? C.DUNGEON;
  const brick = tiled(stock.cryptBrick(ramp));
  const dark = tiled(material("crypt-dark", () => T.ashlar([C.DUNGEON[0]!, ...C.DUNGEON.slice(0, 6)], 29, 8, 12, 20)));
  const top = tiled(material("crypt-top", () => T.flagstones([C.DUNGEON[0]!, ...C.DUNGEON.slice(0, 6)], 31)));
  const gap = exitGap(room.entry[0]);
  const walls = roomShell(b, {
    width: W,
    depth: D,
    height: WALL,
    thickness: THICKNESS,
    front: FRONT,
    back: [
      { to: 0.4375, face: dark, proud: 2 / 16 },
      { to: WALL - 0.3125, face: brick },
      { to: WALL, face: dark, proud: 3 / 16 },
    ],
    side: brick,
    top,
    exit: gap,
  });
  // The stair up, climbing south out of the front wall's gap.
  const tread = material("tread", () => Pic.stepTread());
  for (let i = 0; i < 4; i++) {
    const z = D + 0.125 + i * 0.375;
    b.box(gap[0], 0, z, gap[1], 0.1875 * (i + 1), z + 0.375, { top: tiled(tread), south: tiled(stock.cryptBrick(ramp)) });
  }
  return {
    model: b.model(),
    cutaways: walls,
    lights: [{ kind: "hemisphere", sky: [0.36, 0.38, 0.74], ground: [0.16, 0.12, 0.22], intensity: 0.58 * Math.PI }],
    doorway: [(gap[0] + gap[1]) / 2, 0.6, D + 0.6],
    bounds: [-THICKNESS, -THICKNESS - WALL, W + THICKNESS, D + 1.6],
  };
}

ROOMS.define("crypt", "a crypt's vaulted hall of crypt brick, a stair climbing out of its front", crypt, { stone: C.DUNGEON });
