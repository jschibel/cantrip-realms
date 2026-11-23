import * as THREE from "three";
import * as C from "../../art/paint/colors";
import { goblin, knight, townswoman } from "../../art/figures/rig";
import { MeshBuilder } from "../../art/paint/builder";
import { Grid } from "../../world/grid";
import { buildGround } from "../../render/ground";
import { grassField } from "../../render/grass";
import * as P from "../../art/props/props";
import * as T from "../../art/paint/textures";
import { Actor, type Door, type SliceScene, blockArea, sunlight } from "../actor";

// New Benalia, one street of it, on square tiles: Benalish houses of limestone and whitewash under red and slate roofs,
// blue-and-gold banners, Grizzlegom's Goblins with its green shop front and hanging sign, a cobbled street with lamps,
// a plaza round a tiered fountain, a market stall, an alley of barrels, gardens and trees, and to the east a churchyard
// whose mausoleum is the way down into the crypt. To the west the town wall and its gate, and through the gate open
// country, one outdoor space with the town: the road running on as a dirt track, fields of wheat and ploughland behind
// hedgerows, a stream with a stone bridge and a ford of stepping stones, boulders, a stand of trees, and far off on a
// rise the ruin of a round tower.

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

/** The town: its map's size, from (0, 0). */
const W = 40;
const H = 26;
/** Where one can walk: the town and the country west of its wall, x from -60 to 40 and z from -6 to 36. */
const X0 = -60;
const Z0 = -6;
const X1 = 40;
const Z1 = 36;
/** The wall's line, and its gate across the road. */
const WALL_X = 0;
const GATE: readonly [number, number] = [10, 15];
/** Grass all round the outdoors, beyond where anyone walks, so no view runs off the edge of the world. */
const MARGIN = 18;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
/** The track's middle line (z) as it runs west from the gate, bending south and back. */
const roadZ = (x: number) => 12.5 + 6 * smooth((-x - 8) / 18) - 3 * smooth((-x - 34) / 16);
/** The stream's middle line (x), wandering north to south across the country. */
const streamX = (z: number) => -25 + 1.8 * Math.sin(z * 0.35);
/** The rise the tower stands on: two tiers of turf. */
const TIER1 = [-59, 20, -45, 33] as const;
const TIER2 = [-57, 22, -47, 31] as const;
const inRect = (x: number, z: number, r: readonly [number, number, number, number]) => x >= r[0] && x < r[2] && z >= r[1] && z < r[3];

/** The ground of the country west of the wall, a tile at a time: track, stream, wheat, ploughland, or grass. */
function countryAt(x: number, z: number): string {
  if (Math.abs(x + 0.5 - streamX(z + 0.5)) <= 1.1) return "w";
  if (Math.abs(z + 0.5 - roadZ(x + 0.5)) <= 1.5) return "d";
  if (x >= -56 && x < -44 && z >= -4 && z < 6) return "h";
  if (x >= -42 && x < -31 && z >= -4 && z < 6) return "p";
  return "g";
}

/** The ground anywhere: the town's map, the wall's line, the country, or grass beyond. */
function groundAt(x: number, z: number): string {
  if (x >= 0 && x < W && z >= 0 && z < H) return MAP[z]![x]!;
  if (x === WALL_X - 1) return z >= GATE[0] && z < GATE[1] ? "c" : "g";
  if (x >= X0 && x < WALL_X - 1 && z >= Z0 && z < Z1) return countryAt(x, z);
  return "g";
}

export function buildStreet(seed = 1): SliceScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1a2a22");
  const grid = new Grid(X1 - X0, Z1 - Z0, X0, Z0);
  for (let z = Z0; z < Z1; z++) {
    for (let x = X0; x < X1; x++) {
      // In the town, nobody walks behind the houses or beyond its south hedge.
      const town = x >= 0;
      grid.setWalkable(x, z, town ? z >= 5 && z < H : groundAt(x, z) !== "w");
    }
  }
  // The wall, open only at the gate.
  for (let z = Z0; z < Z1; z++) if (z < GATE[0] || z >= GATE[1]) grid.setWalkable(WALL_X - 1, z, false);

  const ids: Record<string, number> = { g: 0, c: 1, f: 2, d: 3, s: 4, p: 5, h: 6, w: 7 };
  const tiles: number[][] = [];
  for (let z = Z0 - MARGIN; z < Z1 + MARGIN; z++) {
    const row: number[] = [];
    for (let x = X0 - MARGIN; x < X1 + MARGIN; x++) row.push(ids[groundAt(x, z)]!);
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
        { picture: T.furrows(16), priority: 2 },
        { picture: T.wheat(17), priority: 2 },
        { picture: T.dirt(4), priority: -1, hole: true },
      ],
      { x: X0 - MARGIN, z: Z0 - MARGIN },
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
  P.hedgeWall(b, 0.1, 12.6, 25.2);
  P.hedgeWall(b, 17.4, 33, 25.2);
  grid.block(0, 25, 12, 25);
  grid.block(17, 25, 32, 25);

  // The town wall and its gate, west of the houses.
  const towerFull = new MeshBuilder();
  const towerLow = new MeshBuilder();
  P.townWall(b, WALL_X, Z0 - 4, Z1 + 4, GATE[0], GATE[1], towerFull, towerLow);
  const southTower = towerFull.build("gate-tower");
  const southTowerLow = towerLow.build("gate-tower-low");
  scene.add(southTower, southTowerLow);
  southTowerLow.visible = false;
  grid.block(WALL_X - 2, GATE[0] - 2, WALL_X, GATE[0] - 1);
  grid.block(WALL_X - 2, GATE[1], WALL_X, GATE[1] + 1);

  // The country: the stream, its bridge and ford, under its banks.
  const bridgeTiles: { x: number; z: number }[] = [];
  for (let z = Z0; z < Z1; z++) {
    for (let x = X0; x < WALL_X - 1; x++) {
      if (countryAt(x, z) !== "w") continue;
      P.waterSurface(b, x - 0.75, z - 0.75, x + 1.75, z + 1.75);
      if (Math.abs(z + 0.5 - roadZ(x + 0.5)) <= 1.5) bridgeTiles.push({ x, z });
    }
  }
  const bx0 = Math.min(...bridgeTiles.map((t) => t.x)) - 1;
  const bx1 = Math.max(...bridgeTiles.map((t) => t.x)) + 2;
  const bz0 = Math.min(...bridgeTiles.map((t) => t.z));
  const bz1 = Math.max(...bridgeTiles.map((t) => t.z)) + 1;
  P.bridge(b, bx0, bx1, bz0 - 0.25, bz1 + 0.25, 0.25);
  for (let z = bz0; z < bz1; z++) {
    for (let x = bx0; x < bx1; x++) {
      grid.setWalkable(x, z, true);
      grid.raise(x, z, x, z, 0.25);
    }
  }
  // The ford: stepping stones across, well south of the bridge.
  for (const fz of [29, 30]) {
    for (let x = X0; x < WALL_X - 1; x++) {
      if (countryAt(x, fz) !== "w") continue;
      grid.setWalkable(x, fz, true);
      P.steppingStone(b, x + 0.5, fz + 0.5);
    }
  }

  // Fields behind hedgerows, a gap into each from the lane.
  P.hedgeRow(b, -57, -5, -30, -5, 1);
  P.hedgeRow(b, -57.5, -5, -57.5, 7, 2);
  P.hedgeRow(b, -30, -5, -30, 7, 3);
  P.hedgeRow(b, -43, -5, -43, 7, 4);
  P.hedgeRow(b, -57, 7, -51, 7, 5);
  P.hedgeRow(b, -48, 7, -39, 7, 6);
  P.hedgeRow(b, -35, 7, -30, 7, 7);
  for (let x = -57; x <= -30; x++) {
    grid.setWalkable(x, -6, false);
    if (!(x >= -51 && x < -48) && !(x >= -39 && x < -35)) grid.setWalkable(x, 6, false);
  }
  for (let z = -6; z <= 6; z++) for (const x of [-58, -31, -44]) grid.setWalkable(x, z, false);
  P.barrel(b, -45.5, 8.2);
  P.sack(b, -44.7, 8.5);

  // A stand of trees south of the track, between the stream and the town.
  for (let z = 22.5; z < 34; z += 1.7) {
    for (let x = -21; x < -7; x += 1.8) {
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      if (r < 0.18) continue;
      const tx = x + r * 0.8;
      const tz = z + ((r * 7) % 1) * 0.8;
      P.tree(b, tx, tz, 0.85 + r * 0.45, Math.floor(r * 50));
      grid.setWalkable(Math.floor(tx), Math.floor(tz), false);
    }
  }
  // Odd trees about the country.
  for (const [x, z, sz, k2] of [[-12, 2, 1.1, 31], [-6, 6, 0.9, 32], [-34, 12, 1.0, 33], [-49, 13, 1.2, 34], [-38, 26, 1.05, 35], [-29, 3, 0.95, 36], [-20, 8, 0.9, 37]] as const) {
    P.tree(b, x + 0.5, z + 0.5, sz, k2);
    grid.setWalkable(x, z, false);
  }
  // Boulders along the stream and about the rise.
  for (const [x, z, r, k3] of [[-28, 6, 0.55, 1], [-22, 9, 0.4, 2], [-27, 24, 0.6, 3], [-23, 33, 0.45, 4], [-43, 21, 0.7, 5], [-44, 30, 0.5, 6], [-33, 20, 0.45, 7], [-15, 18, 0.5, 8], [-52, 16, 0.55, 9], [-9, 30, 0.45, 10]] as const) {
    P.boulder(b, x + 0.5, z + 0.5, r, k3);
    grid.setWalkable(x, z, false);
  }

  // The rise and the ruined tower on it.
  P.terrace(b, TIER1[0], TIER1[1], TIER1[2], TIER1[3], 0.75);
  P.terrace(b, TIER2[0], TIER2[1], TIER2[2], TIER2[3], 1.5);
  grid.raise(TIER1[0], TIER1[1], TIER1[2] - 1, TIER1[3] - 1, 0.75);
  grid.raise(TIER2[0], TIER2[1], TIER2[2] - 1, TIER2[3] - 1, 1.5);
  const towerAt = { x: -52, z: 26.5 };
  P.ruinedTower(b, towerAt.x, towerAt.z, 1.5, 2.4, 1.6, 5.5);
  for (let z = 24; z <= 29; z++) for (let x = -55; x <= -50; x++) if (Math.hypot(x + 0.5 - towerAt.x, z + 0.5 - towerAt.z) < 2.9) grid.setWalkable(x, z, false);

  // Beyond the outdoors: a wood all round, so the view never runs off the world.
  let k = 11;
  for (let z = Z0 - MARGIN + 1; z < Z1 + MARGIN; z += 2.3) {
    for (let x = X0 - MARGIN + 1; x < X1 + MARGIN; x += 2.3) {
      const xi = Math.floor(x);
      const zi = Math.floor(z);
      const playable = xi >= X0 && xi < X1 && zi >= Z0 && zi < Z1;
      // Inside: only the town's backs and its south, where nobody walks; a band of trees past the edges.
      const townBack = xi >= 0 && (zi < 4 || zi >= H);
      const nearEdge = xi > X0 - 9 && xi < X1 + 9 && zi > Z0 - 9 && zi < Z1 + 9;
      if (playable && !townBack) continue;
      if (!playable && !nearEdge) continue;
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      if (townBack && zi < 4 && r < 0.55) continue;
      P.tree(b, x + r, z + ((r * 7) % 1), 0.85 + r * 0.4, k++);
    }
  }

  scene.add(b.build("street"));
  sunlight(scene, -10, 15, 72);
  // Grass standing up off the lawns, verges and meadows, wherever one can walk on grass, and in a band of the wood.
  const field = grassField(
    X1 - X0 + 16,
    Z1 - Z0 + 16,
    { x: X0 - 8, z: Z0 - 8 },
    (x, z) => {
      const wx = x + X0 - 8;
      const wz = z + Z0 - 8;
      if (!grid.inside(wx, wz)) return true;
      return groundAt(wx, wz) === "g" && grid.walkable(wx, wz);
    },
    3,
    9,
    (x, z) => grid.heightAt(x, z),
  );
  scene.add(field.mesh);

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
  const stream = P.streamMaterial().map!;
  return {
    id: "street",
    title: "New Benalia",
    inside: false,
    turns: true,
    scene,
    grid,
    doors,
    actors,
    start: { x: 13, z: 12 },
    bounds: [X0, Z0, X1, Z1],
    follow(player) {
      // In or about the gateway the tower south of it would stand in front of the player: it is cut down.
      const inGate = player.x > WALL_X - 4 && player.x < WALL_X + 2.5 && player.z > GATE[0] - 2 && player.z < GATE[1] + 0.5;
      southTower.visible = !inGate;
      southTowerLow.visible = inGate;
    },
    update(_dt, time, yaw) {
      field.time.value = time;
      field.yaw.value = yaw;
      // Water moves a whole texel at a time.
      waterMap.offset.set(Math.floor(time * 3) / 32, Math.floor(time * 5) / 32);
      fall.offset.set(0, -Math.floor(time * 14) / 16);
      stream.offset.set(Math.floor(time * 2) / 32, -Math.floor(time * 6) / 32);
    },
  };
}

