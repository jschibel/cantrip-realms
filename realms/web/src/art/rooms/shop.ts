import type { InteriorData } from "../../world/format";
import { MeshBuilder, sides, tiled } from "../paint/builder";
import * as C from "../paint/colors";
import { material, stock } from "../paint/materials";
import type { Palette } from "../paint/palette";
import * as Pic from "../paint/pictures";
import { Pixmap } from "../paint/pixmap";
import * as T from "../paint/textures";
import { PX } from "../props/draw";
import type { Built } from "../recipe";
import { ROOMS } from "./registry";
import { exitGap, roomShell } from "./shell";

// A shop in a Benalish house: boards underfoot; the back wall wainscoted below and plastered above under a dark beam,
// framed in bays by posts; the front wall cut down low with a doorframe at the gap. A dim, warm room: a violet-grey fill,
// and a little daylight from the south. (Grizzlegom's Goblins in the slice; its hearth, shelves and counter are its
// props.)

const HEIGHT = 3.0;
const THICKNESS = 0.75;
const FRONT = 0.6;
/** Posts frame the back wall in bays this wide. */
const BAY = 4;

function shop(room: InteriorData, pal: Palette): Built {
  const { w: W, d: D } = room;
  const b = new MeshBuilder();
  const wainscot = tiled(material("wainscot", () => Pic.wainscot()));
  const plaster = tiled(stock.plaster(pal.plaster));
  const beam = tiled(stock.darkTimber(pal.darkTimber));
  const wallTop = tiled(material("wall-top", () => wallTopPicture()));
  const gap = exitGap(room.entry[0]);
  const walls = roomShell(b, {
    width: W,
    depth: D,
    height: HEIGHT,
    thickness: THICKNESS,
    front: FRONT,
    back: [
      { to: 1.0, face: wainscot, proud: PX },
      { to: 2.75, face: plaster },
      { to: HEIGHT, face: beam, proud: 2 * PX },
    ],
    side: plaster,
    top: wallTop,
    exit: gap,
  });
  // Posts in the back wall, framing it in bays.
  const posts: number[] = [];
  for (let x = 0; x < W; x += BAY) posts.push(x);
  posts.push(W);
  for (const x of posts) b.box(x - 0.125, 0, 0, x + 0.125, HEIGHT, 0.1, sides(beam));
  // The doorframe in the front wall.
  for (const x of [gap[0] - 0.125, gap[1]]) b.box(x, 0, D, x + 0.125, 0.8, D + THICKNESS, sides(beam));
  return {
    model: b.model(),
    cutaways: walls,
    lights: [
      { kind: "hemisphere", sky: [0.58, 0.5, 0.72], ground: [0.32, 0.22, 0.26], intensity: 0.62 * Math.PI },
      { kind: "directional", color: [1.0, 0.9, 0.75], intensity: 0.25 * Math.PI, from: [-4, 10, 8] },
    ],
    doorway: [(gap[0] + gap[1]) / 2, 0.8, D],
    // The view's reach, as the camera sees it: from the back wall's top to the front wall's foot.
    bounds: [-THICKNESS, -THICKNESS - HEIGHT, W + THICKNESS, D + THICKNESS],
  };
}

/** The tops of the walls: a dark beam, as a 16-bit room's border is drawn. */
function wallTopPicture(): Pixmap {
  const p = T.timber(17, C.DARKWOOD);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y * 3) % 11 === 0) p.set(x, y, C.DARKWOOD[1]!);
  return p;
}

ROOMS.define("shop", "a shop in a timbered house: boards, wainscot and plaster in bays of posts, a doorframe", shop, { plaster: C.PLASTER, darkTimber: C.DARKWOOD });
