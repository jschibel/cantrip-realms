import * as THREE from "three";
import { goblin } from "../../art/figures/rig";
import * as C from "../../art/paint/colors";
import { MeshBuilder, fitted, sides, tiled } from "../../art/paint/builder";
import { buildGround } from "../../render/ground";
import { flat, material, surfaces } from "../../art/paint/materials";
import * as Pic from "../../art/paint/pictures";
import { Pixmap } from "../../art/paint/pixmap";
import * as P from "../../art/props/props";
import { PX } from "../../art/props/props";
import * as T from "../../art/paint/textures";
import { Actor, type Door, type SliceScene, blockArea } from "../actor";
import { cutFor, pointLight, roomGrid, roomShell, windowLight } from "./room";

// Inside Grizzlegom's Goblins: a goblin's trading post in a Benalish house. Floorboards and a red rug; along the back
// wall a hearth with its fire, shelves of books and of bottled wares, a rack of blades, posters and a shield; the
// counter across the room with Grizzlegom behind it among his scales, coin and ledger; a table for a game of cards;
// barrels, crates and sacks in the corners. Daylight falls in through the back windows, the fire glows orange.

const W = 12;
const D = 8;

export function buildShop(): SliceScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#000000");
  const grid = roomGrid(W, D);

  // The floor: boards, and hearthstones before the fire.
  const tiles: number[][] = [];
  for (let z = 0; z < D; z++) tiles.push(Array.from({ length: W }, (_, x) => (z === 0 && x >= 1 && x <= 3 ? 1 : 0)));
  tiles.push(Array.from({ length: W }, (_, x) => (x >= 5 && x <= 6 ? 0 : -1)));
  scene.add(buildGround(tiles, [{ picture: T.floorboards(5), priority: 1 }, { picture: T.flagstones(C.COBBLE, 33), priority: 2 }]));

  const b = new MeshBuilder();
  const wainscot = tiled(material("wainscot", () => Pic.wainscot()));
  const plaster = tiled(surfaces.plaster());
  const beam = tiled(surfaces.darkTimber());
  const wallTop = tiled(material("wall-top", () => wallTopPicture()));
  const walls = roomShell(b, {
    width: W,
    depth: D,
    height: 3.0,
    thickness: 0.75,
    front: 0.6,
    back: [
      { to: 1.0, face: wainscot, proud: PX },
      { to: 2.75, face: plaster },
      { to: 3.0, face: beam, proud: 2 * PX },
    ],
    side: plaster,
    top: wallTop,
    exit: [5, 7],
  }, scene);
  // Posts in the back wall, framing it in bays.
  for (const x of [0, 4.0, 8.0, W]) b.box(x - 0.125, 0, 0, x + 0.125, 3.0, 0.1, sides(beam));
  // The doorframe in the front wall.
  for (const x of [4.875, 7.0]) b.box(x, 0, D, x + 0.125, 0.8, D + 0.75, sides(beam));

  // The hearth in the back wall's first bay.
  const hearth = material("hearth", () => Pic.hearth(44, 36));
  const stone = tiled(surfaces.cobbleWall());
  b.box(0.625, 0, 0, 3.375, 2.25, 0.4, { south: fitted(hearth), top: stone, east: stone, west: stone });
  b.box(0.5, 1.75, 0, 3.5, 1.875, 0.55, sides(tiled(surfaces.timber())));
  b.box(0.875, 2.25, 0, 3.125, 3.0, 0.25, sides(stone));
  const flames = [0, 1, 2].map((f) => material(`flame-${f}-16`, () => Pic.flame(f, 16), { glowing: true, cutout: true }));
  const fire = flames.map((m) => {
    const fb = new MeshBuilder();
    fb.card(fitted(m), 1.5, 0.05, 2.5, 1.05, 0.42);
    const g = fb.build("fire", false);
    scene.add(g);
    return g;
  });
  // On the mantel: candles, a pot, and a goblin's prize - a skull.
  candle(b, 0.75, 1.875, 0.3);
  candle(b, 3.25, 1.875, 0.3);
  P.pot(b, 2.75, 0.3, 1.875, 0.12);
  b.card(fitted(material("mantel-skull", () => Pic.skull(), { cutout: true })), 1.6, 1.875, 1.6 + 5 / 16, 1.875 + 5 / 16, 0.32);

  // The back wall's middle bay: the window between the bookcases, a poster.
  shelf(b, 4.25, false);
  shelf(b, 6.75, true, 7);
  b.card(fitted(material("window-in", () => Pic.windowPicture(true), { glow: 0.6 })), 5.5, 1.125, 6.5, 2.25, 0.02);
  b.card(fitted(material("poster-a", () => Pic.poster(2))), 5.6875, 2.3125, 6.3125, 2.6875 + 0.0625, 0.02);
  // The last bay, behind the counter: wares, a rack of blades, a shield.
  shelf(b, 8.25, true, 3);
  shelf(b, 10.75, true, 9);
  bladeRack(b, 9.75, 1.25);
  b.box(9.4375, 2.0, 0, 10.0625, 2.75, 0.06, { south: fitted(material("shield", () => shieldPicture())) });

  // The counter, an L round Grizzlegom: boards on top, panels in front.
  const front = tiled(material("counter", () => Pic.counterFront()));
  const top = tiled(material("counter-top", () => T.floorboards(19)));
  b.box(6.25, 0, 2.25, 11.25, 1.0, 3.0, { south: front, north: front, west: front, east: front, top });
  b.box(6.25, 0, 1.0, 7.0, 1.0, 2.25, { west: front, east: front, top, north: front });
  b.box(6.125, 1.0, 2.125, 11.375, 1.0625, 3.125, sides(tiled(surfaces.darkTimber())));
  blockArea(grid, 6.25, 2.25, 11.25, 3.0);
  blockArea(grid, 6.25, 1.0, 7.0, 2.25);
  // On it: scales, a pile of coin, a ledger, a candle, a pot.
  scales(b, 7.5, 1.0625, 2.6);
  coins(b, 8.5, 1.0625, 2.55);
  b.box(9.25, 1.0625, 2.35, 9.875, 1.125, 2.85, { top: fitted(material("ledger", () => ledger())), south: tiled(surfaces.darkTimber()), east: tiled(surfaces.darkTimber()) });
  candle(b, 10.75, 1.0625, 2.6);
  P.pot(b, 6.6, 1.6, 1.0625, 0.13);
  // Behind the counter, a barrel and a crate of stock.
  P.barrel(b, 11.45, 1.05, 0.875);
  P.crate(b, 11.4, 1.95, 0.625, "fish");

  // A table for cards, two stools.
  b.box(1.5, 0.6875, 3.5, 3.5, 0.8125, 4.5, sides(tiled(surfaces.timber()), tiled(surfaces.boards())));
  for (const [x, z] of [[1.625, 3.625], [3.25, 3.625], [1.625, 4.25], [3.25, 4.25]] as const) b.box(x, 0, z, x + 0.125, 0.6875, z + 0.125, sides(tiled(surfaces.darkTimber())));
  b.decal(fitted(material("cards", () => cardsPicture(), { cutout: true })), 1.875, 3.6875, 2.875, 4.3125, 0.82);
  candle(b, 3.1, 0.8125, 3.8);
  for (const [x, z] of [[2.5, 3.0], [2.5, 5.0]] as const) stool(b, x, z);
  blockArea(grid, 1.5, 3.5, 3.5, 4.5);

  // The rug before the counter.
  b.box(3.75, 0, 4.25, 7.75, PX, 6.75, { top: fitted(material("rug", () => Pic.rug(64, 40))) });

  // Corners: barrels and sacks by the door, crates, pots along the wall.
  P.barrel(b, 0.55, 6.4);
  P.barrel(b, 1.3, 7.2, 0.75);
  P.sack(b, 0.6, 7.35);
  P.crate(b, 10.6, 6.5, 0.75, "apples");
  P.crate(b, 11.45, 6.6, 0.625, undefined, 0, 0.2);
  P.crate(b, 11.45, 6.6, 0.5, "carrots", 0.625, -0.1);
  P.sack(b, 11.4, 7.5);
  P.pot(b, 3.85, 0.45, 0, 0.18);
  P.pot(b, 0.4, 1.0, 0, 0.16);
  for (const [x, z] of [[0, 6], [1, 7], [0, 7], [10, 6], [11, 6], [11, 7], [11, 1], [11, 0]] as const) grid.setWalkable(x, z, false);
  for (let x = 0; x < W; x++) grid.setWalkable(x, 0, false);
  grid.block(0, 1, 0, 1);

  scene.add(b.build("shop"));

  // Light: a dim warm room, daylight from the back window, the hearth's fire and the candles.
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.58, 0.5, 0.72), new THREE.Color(0.32, 0.22, 0.26), 0.62 * Math.PI));
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.9, 0.75), 0.25 * Math.PI);
  sun.position.set(-4, 10, 8);
  scene.add(sun);
  windowLight(scene, 6.0, 4.0, -1.6, 6.0, 3.6, 40).castShadow = false;
  const fireLight = pointLight(scene, 2, 1.0, 1.2, new THREE.Color(1.0, 0.55, 0.25), 9, 7.5);
  pointLight(scene, 10.75, 1.6, 2.7, new THREE.Color(1.0, 0.75, 0.4), 2.2, 3.2);
  pointLight(scene, 3.1, 1.4, 3.9, new THREE.Color(1.0, 0.75, 0.4), 2.2, 3.2);

  // Goblins are short: Grizzlegom stands on a crate to see over his counter.
  const vendor = new Actor(goblin(true), { x: 8, z: 1 }, grid, { rest: [0, 1], watch: 5 }, "Grizzlegom");
  vendor.position.set(8.5, 0.5, 1.75);
  scene.add(vendor.figure.root);
  const stand = new MeshBuilder();
  P.crate(stand, 8.5, 1.75, 0.5);
  scene.add(stand.build("stand"));

  const doors: Door[] = [
    { name: "door:street", tile: { x: 6, z: 7 }, step: [0, 1], to: "street", arrive: { x: 13, z: 10 }, arriveFacing: [0, 1], at: new THREE.Vector3(6, 0.8, 8) },
  ];
  return {
    id: "shop",
    title: "Grizzlegom's Goblins",
    inside: true,
    turns: true,
    scene,
    grid,
    doors,
    actors: [vendor],
    start: { x: 6, z: 6 },
    // The view's reach, as the camera sees it: from the back wall's top to the front wall's foot.
    bounds: [-0.75, -0.75 - 3.0, W + 0.75, D + 0.75],
    update(_dt, time, yaw, toward) {
      cutFor(walls, yaw, toward);
      const f = Math.floor(time * 8) % 3;
      fire.forEach((g, i) => (g.visible = i === f));
      // The fire's light flickers in steps, not smoothly.
      fireLight.intensity = 8 + [0, 1.6, 0.7][f]!;
    },
  };
}

/** The tops of the walls: a dark beam, as a 16-bit room's border is drawn. */
function wallTopPicture(): Pixmap {
  const p = T.timber(17, C.DARKWOOD);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if ((x + y * 3) % 11 === 0) p.set(x, y, C.DARKWOOD[1]!);
  return p;
}

// --- The shop's own furniture -----------------------------------------------------------------------------------------

function shelf(b: MeshBuilder, x: number, goods: boolean, seed = 5): void {
  const front = fitted(material(`shelf-${goods ? "goods" : "books"}-${seed}`, () => Pic.bookshelf(seed, goods)));
  b.box(x, 0, 0, x + 1.0, 2.0, 0.45, { south: front, top: tiled(surfaces.darkTimber()), east: tiled(surfaces.timber()), west: tiled(surfaces.timber()) });
}

function candle(b: MeshBuilder, x: number, y: number, z: number): void {
  b.box(x - 0.08, y, z - 0.08, x + 0.08, y + 0.04, z + 0.08, sides(flat(C.GOLD[2]!)));
  b.box(x - 0.04, y + 0.04, z - 0.04, x + 0.04, y + 0.26, z + 0.04, sides(flat(0xf4ecd4)));
  b.box(x - 0.03, y + 0.26, z - 0.03, x + 0.03, y + 0.36, z + 0.03, sides(material("candle-flame", () => new Pixmap(2, 2, C.FIRE[4]!), { glowing: true })));
}

function stool(b: MeshBuilder, x: number, z: number): void {
  b.cylinder(x, z, 0.38, 0.48, 0.24, 8, { mat: surfaces.timber() }, fitted(surfaces.boards()));
  for (const [dx, dz] of [[-0.14, -0.14], [0.1, -0.14], [-0.14, 0.1], [0.1, 0.1]] as const) b.box(x + dx, 0, z + dz, x + dx + 0.05, 0.38, z + dz + 0.05, sides(tiled(surfaces.darkTimber())));
}

function scales(b: MeshBuilder, x: number, y: number, z: number): void {
  const brass = flat(C.GOLD[3]!);
  const dark = flat(C.GOLD[1]!);
  b.box(x - 0.12, y, z - 0.08, x + 0.12, y + 0.04, z + 0.08, sides(dark));
  b.box(x - 0.02, y + 0.04, z - 0.02, x + 0.02, y + 0.42, z + 0.02, sides(brass));
  b.box(x - 0.3, y + 0.4, z - 0.015, x + 0.3, y + 0.43, z + 0.015, sides(brass));
  for (const dx of [-0.28, 0.28]) b.cylinder(x + dx, z, y + 0.16, y + 0.2, 0.1, 8, { mat: brass }, { mat: brass });
}

function coins(b: MeshBuilder, x: number, y: number, z: number): void {
  const gold = flat(C.GOLD[4]!);
  for (const [dx, dz, h] of [[0, 0, 0.12], [0.14, 0.06, 0.08], [-0.1, 0.1, 0.05], [0.06, -0.12, 0.04]] as const) b.cylinder(x + dx, z + dz, y, y + h, 0.08, 8, { mat: flat(C.GOLD[3]!) }, { mat: gold });
}

function bladeRack(b: MeshBuilder, x: number, y: number): void {
  b.box(x - 0.55, y + 1.0, 0, x + 0.55, y + 1.08, 0.15, sides(tiled(surfaces.darkTimber())));
  b.box(x - 0.55, y, 0, x + 0.55, y + 0.08, 0.15, sides(tiled(surfaces.darkTimber())));
  for (const [i, dx] of [-0.36, -0.12, 0.12, 0.36].entries()) {
    const steel = flat(C.IRON[5]!);
    b.box(x + dx - 0.03, y + 0.05, 0.08, x + dx + 0.03, y + (i % 2 ? 1.05 : 0.95), 0.12, sides(steel));
    b.box(x + dx - 0.1, y + 0.18, 0.06, x + dx + 0.1, y + 0.23, 0.14, sides(flat(C.GOLD[3]!)));
    b.box(x + dx - 0.03, y, 0.08, x + dx + 0.03, y + 0.18, 0.12, sides(flat(C.WOOD[2]!)));
  }
}

function shieldPicture(): Pixmap {
  const p = new Pixmap(10, 12);
  p.fill(0, 0);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 10; x++) {
      const w = y < 6 ? 5 : 5 - (y - 5) * 0.8;
      if (Math.abs(x - 4.5) > w) continue;
      let c = x < 5 ? C.RED[3]! : C.CLOTH_WHITE[3]!;
      if (Math.abs(x - 4.5) > w - 1 || y === 0) c = C.GOLD[3]!;
      p.set(x, y, c);
    }
  }
  return p;
}

function ledger(): Pixmap {
  const p = new Pixmap(10, 8, 0xf0dcaa);
  for (let y = 1; y < 7; y++) for (let x = 1; x < 9; x++) if (x !== 4 && x !== 5 && (x + y) % 3 !== 0) p.set(x, y, y % 2 ? 0x8a6a48 : 0xf0dcaa);
  p.vline(4, 0, 8, 0xb89868);
  p.vline(5, 0, 8, 0xd8c090);
  for (let x = 0; x < 10; x++) p.set(x, 7, C.RED[1]!);
  return p;
}

function cardsPicture(): Pixmap {
  const p = new Pixmap(16, 10);
  p.fill(0, 0);
  const card = (x: number, y: number, back: boolean) => {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) p.put(x + i, y + j, back ? (i + j) % 2 ? C.BLUE[3]! : C.BLUE[2]! : 0xfff8e8);
    if (!back) p.put(x + 1, y + 1, C.RED[3]!);
  };
  card(1, 1, true);
  card(5, 4, false);
  card(9, 2, false);
  card(12, 5, true);
  p.put(7, 1, C.GOLD[4]!);
  p.put(8, 1, C.GOLD[3]!);
  return p;
}
