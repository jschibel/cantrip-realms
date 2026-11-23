import * as THREE from "three";
import * as C from "../colors";
import { goblin, knight, townswoman } from "../characters";
import { MeshBuilder } from "../geometry";
import { Grid } from "../grid";
import { buildGround } from "../ground";
import * as P from "../props";
import * as T from "../textures";
import { Actor, type Door, type SliceScene, blockArea, sunlight } from "../world";

// New Benalia, one street of it, on square tiles: Benalish houses of limestone and whitewash under red and slate roofs,
// blue-and-gold banners, Grizzlegom's Goblins with its green shop front and hanging sign, a cobbled street with lamps,
// a plaza round a tiered fountain, a market stall, an alley of barrels, gardens and trees, and to the east a churchyard
// whose mausoleum is the way down into the crypt.

// The ground, a character a tile: g grass, c cobbles, f flagstones, d dirt, s strawed earth.
const MAP = [
  "gggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggg",
  "gggggggggggggggggggggggggggggggggggggggg",
  "ggggggggggggggggggggggggggsssssggggggggg",
  "ggggggggggggggggggddgggggssssssggggggggg",
  "gggggggggggggggggdddggggsssssssgggdddggg",
  "ggggggggggggggggcccccggggsssscccggdddggg",
  "cccccccccccccccccccccccccccccccccddddggg",
  "cccccccccccccccccccccccccccccccccdddgggg",
  "cccccccccccccccccccccccccccccccccddggggg",
  "ccccccccccccccccccccccccccccccccdggggggg",
  "cccccccccccccccccccccccccccccccggggggggg",
  "ggggggggffffffffffffgggggggggggggggggggg",
  "gggggggffffffffffffffggggggggggggggggggg",
  "gggggggffffffffffffffggggggggggggggggggg",
  "gggggggffffffffffffffggggggggggggggggggg",
  "gggggggffffffffffffffggggggggggggggggggg",
  "gggggggffffffffffffffggggggggggggggggggg",
  "ggggggggffffffffffffgggggggggggggggggggg",
  "gggggggggggggdddgggggggggggggggggggggggg",
  "ggggggggggggggddgggggggggggggggggggggggg",
  "gggggggggggggggddggggggggggggggggggggggg",
  "gggggggggggggggddggggggggggggggggggggggg",
];

const W = 40;
const H = 26;
/** Grass all round the street, beyond where anyone walks, so no view runs off the edge of the world. */
const MARGIN_X = 10;
const MARGIN_Z = 8;

export function buildStreet(seed = 1): SliceScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1a2a22");
  const grid = new Grid(W, H);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) grid.setWalkable(x, z, z >= 5);

  const ids: Record<string, number> = { g: 0, c: 1, f: 2, d: 3, s: 4 };
  const tiles: number[][] = [];
  for (let z = -MARGIN_Z; z < H + MARGIN_Z; z++) {
    const row: number[] = [];
    for (let x = -MARGIN_X; x < W + MARGIN_X; x++) {
      const ch = MAP[z]?.[x];
      row.push(ch ? ids[ch]! : 0);
    }
    tiles.push(row);
  }
  scene.add(
    buildGround(
      tiles,
      [
        { picture: T.grass(seed), priority: 5 },
        { picture: T.cobbles(2), priority: 1 },
        { picture: T.flagstones(C.LIMESTONE, 3), priority: 0 },
        { picture: T.dirt(4), priority: 3 },
        { picture: T.straw(15), priority: 2 },
      ],
      { x: -MARGIN_X, z: -MARGIN_Z },
    ),
  );

  const b = new MeshBuilder();
  // The north side of the street: three houses and the shop, fronts on z = 10.
  P.house(b, {
    x0: 1, x1: 7.5, z0: 5, z1: 10, ground: 2.5, upper: 1.7, roof: "tile", rise: 1.7, chimney: 5.2, wall: "limestone",
    openings: [
      { at: 1.3, kind: "window" }, { at: 3.4, kind: "door" }, { at: 5.4, kind: "window" },
      { at: 0.55, kind: "banner" }, { at: 6.0, kind: "banner" },
      { at: 1.3, kind: "windowUp" }, { at: 3.4, kind: "windowUp" }, { at: 5.4, kind: "windowUp" },
    ],
  });
  P.house(b, {
    x0: 10, x1: 17, z0: 5, z1: 10, ground: 2.7, upper: 1.6, roof: "tile", rise: 1.6, chimney: 1.2, wall: "limestone",
    openings: [
      { at: 1.5, kind: "display" }, { at: 3.5, kind: "shopDoor" }, { at: 5.5, kind: "display" },
      { at: 3.5, kind: "sign" },
      { at: 1.5, kind: "windowUp" }, { at: 5.5, kind: "windowUp" },
    ],
  });
  P.house(b, {
    x0: 20, x1: 25, z0: 5, z1: 10, ground: 2.4, upper: 1.8, roof: "slate", rise: 1.6, chimney: 3.8, wall: "plaster",
    openings: [
      { at: 1.3, kind: "door" }, { at: 3.6, kind: "window" }, { at: 2.5, kind: "lamp" },
      { at: 1.3, kind: "windowUp" }, { at: 3.6, kind: "windowUp" },
    ],
  });
  for (const [x0, x1] of [[1, 7.5], [10, 17], [20, 25]] as const) blockArea(grid, x0 - 0.3, 4, x1 + 0.3, 10);

  // The alley between the shop and the slate house: barrels, crates and a sack or two.
  P.barrel(b, 17.6, 7.6);
  P.barrel(b, 18.35, 7.45, 0.9);
  P.crate(b, 19.45, 7.5, 0.75, undefined, 0, 0.1);
  P.crate(b, 19.45, 7.5, 0.6, "apples", 0.75, -0.1);
  P.sack(b, 18.9, 8.4);
  P.crate(b, 17.55, 8.55, 0.6, "cabbages", 0, 0.3);
  grid.block(17, 7, 19, 7);
  grid.setWalkable(17, 8, false);
  grid.setWalkable(18, 8, false);

  // The market corner: a stall before a garden wall, the stallholder beside it.
  P.hedgeWall(b, 24.6, 32, 5.6);
  P.stall(b, 25.8, 8, 3.4);
  P.barrel(b, 29.8, 7.2);
  P.sack(b, 30.5, 8.3);
  P.crate(b, 25.2, 7.3, 0.6, "bread", 0, 0.2);
  blockArea(grid, 24.6, 5, 32, 6);
  blockArea(grid, 25.6, 7.4, 29.4, 8.4);
  grid.block(29, 7, 30, 8);
  grid.setWalkable(25, 7, false);

  // The churchyard to the east: the mausoleum, gravestones, railings.
  P.mausoleum(b, 33, 38, 4.5, 8);
  blockArea(grid, 32.6, 4, 38.6, 8.7);
  P.railings(b, 32, 9, 32, 10.5);
  P.railings(b, 32, 13.2, 32, 18);
  P.railings(b, 32, 18, 40, 18);
  grid.block(31, 9, 31, 10);
  grid.block(31, 13, 31, 17);
  grid.block(32, 17, 39, 17);
  for (const [x, z, turn] of [[33.6, 10.6, 0.05], [35.0, 13.6, -0.08], [37.7, 10.9, 0.12], [38.3, 14.4, 0], [33.8, 15.6, -0.1], [36.6, 15.9, 0.06]] as const) {
    P.gravestone(b, x, z, turn);
    grid.setWalkable(Math.floor(x), Math.floor(z), false);
  }
  P.tree(b, 38.4, 6.6, 0.95, 4);
  P.bush(b, 33.2, 8.9, 0.4, true);
  P.bush(b, 38.9, 8.8, 0.45);

  // The street's south side: lamps, the plaza and its fountain, gardens, trees and a hedge.
  for (const [x, z] of [[4.5, 15.4], [21.4, 15.4], [28.5, 15.4], [7.6, 21.6], [20.4, 21.6]] as const) {
    P.lampPost(b, x, z);
    grid.setWalkable(Math.floor(x), Math.floor(z), false);
  }
  const water = P.fountain(b, 14, 18.2);
  blockArea(grid, 12.2, 16.4, 15.8, 20);
  P.bench(b, 9.6, 16.5);
  P.bench(b, 18.4, 16.5);
  grid.block(9, 16, 10, 16);
  grid.block(17, 16, 19, 16);
  for (const [x, z, s, k] of [[2.4, 19.3, 1.15, 1], [5.6, 23.4, 0.95, 2], [24.6, 19.6, 1.1, 3], [28.4, 23.2, 1.0, 5], [31.0, 20.4, 0.9, 6], [37.4, 21.6, 1.1, 7], [0.6, 24.2, 0.9, 8]] as const) {
    P.tree(b, x, z, s, k);
    grid.setWalkable(Math.floor(x), Math.floor(z), false);
  }
  for (const [x, z, f] of [[6.8, 16.4, true], [20.9, 16.6, true], [23.0, 17.0, false], [1.4, 16.2, true], [34.5, 19.5, false], [26.5, 19.0, true]] as const) {
    P.bush(b, x, z, 0.42, f);
    grid.setWalkable(Math.floor(x), Math.floor(z), false);
  }
  P.hedgeWall(b, -2, 12.6, 25.2);
  P.hedgeWall(b, 17.4, 33, 25.2);
  grid.block(0, 25, 12, 25);
  grid.block(17, 25, 32, 25);

  // Beyond the street: a wood all round, so the view never runs off the world.
  let k = 11;
  for (let z = -MARGIN_Z + 1; z < H + MARGIN_Z; z += 2) {
    for (let x = -MARGIN_X + 1; x < W + MARGIN_X; x += 2) {
      const inside = x > -1 && x < W && z > 3 && z < H;
      if (inside) continue;
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      if (z < 4 && x > -1 && x < W && r < 0.55) continue;
      P.tree(b, x + r, z + ((r * 7) % 1), 0.85 + r * 0.4, k++);
    }
  }

  scene.add(b.build("street"));
  sunlight(scene, 20, 13, 34);

  const doors: Door[] = [
    { name: "door:shop", tile: { x: 13, z: 10 }, step: [0, -1], to: "shop", arrive: { x: 6, z: 6 }, arriveFacing: [0, -1], at: new THREE.Vector3(13.5, 1, 10) },
    { name: "door:crypt", tile: { x: 35, z: 9 }, step: [0, -1], to: "crypt", arrive: { x: 7, z: 6 }, arriveFacing: [0, -1], at: new THREE.Vector3(35.5, 1, 8.5) },
  ];

  const actors = [
    new Actor(knight(), { x: 3, z: 12 }, grid, { beat: { stops: [{ x: 3, z: 12 }, { x: 29, z: 12 }], pause: 3.5 } }, "Benalish knight"),
    new Actor(goblin(false), { x: 18, z: 9 }, grid, { wander: { home: { x: 18, z: 10 }, reach: 2, pause: [1.5, 4] } }, "goblin"),
    new Actor(townswoman(), { x: 30, z: 9 }, grid, { rest: [-1, 1], watch: 4 }, "stallholder"),
  ];
  for (const a of actors) scene.add(a.figure.root);
  actors[0]!.speed = 2.2;
  actors[1]!.speed = 2.8;

  const waterMap = water.map!;
  const fall = P.pics.waterfall().map!;
  return {
    id: "street",
    title: "New Benalia",
    inside: false,
    scene,
    grid,
    doors,
    actors,
    start: { x: 13, z: 12 },
    bounds: [0, 0, W, H],
    update(_dt, time) {
      // Water moves a whole texel at a time.
      waterMap.offset.set(Math.floor(time * 3) / 32, Math.floor(time * 5) / 32);
      fall.offset.set(0, -Math.floor(time * 14) / 16);
    },
  };
}

