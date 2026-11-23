import * as THREE from "three";
import { ghoul, skeleton } from "../characters";
import * as C from "../colors";
import { MeshBuilder, fitted, sides, tiled } from "../geometry";
import { buildGround } from "../ground";
import { flat, material, surfaces } from "../kit";
import * as Pic from "../pictures";
import { Pixmap, seeded } from "../pixmap";
import * as P from "../props";
import * as T from "../textures";
import { Actor, type Door, type SliceScene, blockArea } from "../world";
import { pointLight, roomGrid, roomShell } from "./room";

// The crypt under New Benalia's churchyard: a vaulted hall of cold violet stone where a dead order's knight lies on a
// dais in his sarcophagus, braziers burning at its corners. Pillars, an ossuary wall of skulls in niches, torches in
// sconces, tattered banners, cobwebs, bones and grime on the flags, two coffins left open. A skeleton walks its rounds and
// a ghoul hunches about the pillars. The stair at the front climbs back up to the churchyard.

const W = 14;
const D = 11;

export function buildCrypt(): SliceScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#000000");
  const grid = roomGrid(W, D);

  const tiles: number[][] = [];
  for (let z = 0; z < D; z++) tiles.push(Array.from({ length: W }, () => 0));
  tiles.push(Array.from({ length: W }, (_, x) => (x >= 6 && x <= 7 ? 0 : -1)));
  scene.add(buildGround(tiles, [{ picture: T.cryptFloor(14), priority: 1 }]));

  const b = new MeshBuilder();
  const brick = tiled(surfaces.cryptBrick());
  const dark = tiled(material("crypt-dark", () => T.ashlar([C.DUNGEON[0]!, ...C.DUNGEON.slice(0, 6)], 29, 8, 12, 20)));
  const top = tiled(material("crypt-top", () => T.flagstones(C.DUNGEON.slice(0, 5).concat([C.DUNGEON[4]!, C.DUNGEON[5]!]), 31)));
  roomShell(b, {
    width: W,
    depth: D,
    height: 3.6,
    thickness: 0.9,
    front: 0.8,
    back: [
      { to: 0.45, face: dark, proud: 2 / 16 },
      { to: 3.25, face: brick },
      { to: 3.6, face: dark, proud: 3 / 16 },
    ],
    side: brick,
    top,
    exit: [6, 8],
  });

  // The ossuary wall: niches of skulls between buttresses, banners, torches in sconces.
  const ossuary = material("ossuary", () => ossuaryPicture());
  for (const x of [1.2, 4.6, 8.4, 11.8]) {
    b.box(x - 0.55, 0.9, -0.05, x + 0.55, 2.4, 0.01, { south: fitted(ossuary) });
  }
  for (const x of [0, 2.9, 6.5, 7.5, 10.1, 14]) b.box(x - 0.2, 0, 0, x + 0.2, 3.6, 0.25, sides(dark));
  const banner = material("tattered", () => Pic.tatteredBanner(), { cutout: true, twoSided: true });
  for (const x of [6.0, 8.0]) {
    b.box(x - 0.45, 3.0, 0.2, x + 0.45, 3.06, 0.32, sides(flat(C.IRON[2]!)));
    b.card(fitted(banner), x - 0.4, 1.0, x + 0.4, 3.0, 0.3);
  }
  const flames = [0, 1, 2].map((f) => material(`flame-${f}`, () => Pic.flame(f), { glowing: true, cutout: true }));
  const fires: THREE.Group[][] = [[], [], []];
  const fireAt = (x: number, y: number, z: number, size: number) => {
    flames.forEach((m, i) => {
      const fb = new MeshBuilder();
      fb.card(fitted(m), x - size / 2, y, x + size / 2, y + size, z);
      const g = fb.build("flame", false);
      scene.add(g);
      fires[i]!.push(g);
    });
  };
  for (const x of [2.9, 10.1]) {
    b.box(x - 0.08, 1.9, 0.25, x + 0.08, 2.0, 0.6, sides(flat(C.IRON[2]!)));
    b.cylinder(x, 0.6, 2.0, 2.15, 0.12, 6, { mat: flat(C.IRON[3]!) }, { mat: flat(C.FIRE[0]!) });
    fireAt(x, 2.1, 0.62, 0.45);
  }

  // Cobwebs in the corners.
  const web = material("cobweb", () => Pic.cobweb(), { cutout: true, twoSided: true });
  b.card(fitted(web), 0.0, 2.5, 1.1, 3.6, 0.27);
  b.at(W, 2.5, 0.27, 0, () => b.quad(fitted(web), [[0, 0, 0], [-1.1, 0, 0], [-1.1, 1.1, 0], [0, 1.1, 0]], (c) => c[0], (c) => c[1]));

  // Pillars.
  for (const [x, z] of [[2.5, 3.5], [11.5, 3.5], [2.5, 7.5], [11.5, 7.5]] as const) {
    b.roundedBox(x - 0.42, 0, z - 0.42, x + 0.42, 0.3, z + 0.42, 1.5 / 16, sides(fitted(surfaces.cryptStone())));
    b.box(x - 0.3, 0.3, z - 0.3, x + 0.3, 2.5, z + 0.3, sides(brick));
    b.roundedBox(x - 0.42, 2.5, z - 0.42, x + 0.42, 2.8, z + 0.42, 1.5 / 16, sides(fitted(surfaces.cryptStone())));
    grid.setWalkable(Math.floor(x), Math.floor(z), false);
  }
  b.card(fitted(web), 11.2, 1.9, 11.9, 2.6, 7.93);
  // A broken pillar's drum, fallen.
  b.at(4.2, 0, 9.3, 0.6, () => b.cylinder(0, 0, 0, 0.35, 0.32, 8, { mat: surfaces.cryptBrick() }, fitted(surfaces.cryptStone())));
  grid.setWalkable(4, 9, false);

  // The dais and its sarcophagus, braziers at its corners.
  const stone = tiled(surfaces.cryptStone());
  b.box(4.6, 0, 1.6, 9.4, 0.22, 6.4, sides(stone));
  b.box(5.0, 0.22, 2.0, 9.0, 0.42, 6.0, sides(stone));
  const lid = material("sarcophagus-lid", () => Pic.sarcophagusLid());
  const side = material("sarcophagus-side", () => Pic.sarcophagusSide());
  b.box(6.2, 0.42, 2.6, 7.8, 1.15, 5.4, { south: fitted(side, [0, 0, 22, 12]), north: fitted(side, [0, 0, 22, 12]), east: fitted(side), west: fitted(side) });
  b.roundedBox(6.1, 1.15, 2.5, 7.9, 1.32, 5.5, 1 / 16, { top: fitted(lid), south: tiled(surfaces.cryptStone()), east: tiled(surfaces.cryptStone()), west: tiled(surfaces.cryptStone()), north: tiled(surfaces.cryptStone()) });
  blockArea(grid, 6.2, 2.6, 7.8, 5.4);
  const braziers = [
    [5.25, 6.6],
    [8.75, 6.6],
  ] as const;
  for (const [x, z] of braziers) {
    b.cylinder(x, z, 0, 0.1, 0.22, 8, { mat: flat(C.IRON[2]!) });
    b.cylinder(x, z, 0.1, 0.75, 0.05, 6, { mat: flat(C.IRON[3]!) });
    b.cylinder(x, z, 0.75, 1.0, 0.3, 8, { mat: flat(C.IRON[2]!) }, { mat: material("embers", () => embers(), { glowing: true }) }, 0.15);
    fireAt(x, 0.95, z + 0.01, 0.7);
    grid.setWalkable(Math.floor(x), Math.floor(z), false);
  }
  for (const [x, z] of [[5.3, 2.3], [8.7, 2.3], [5.3, 5.7], [8.7, 5.7]] as const) candles(b, x, 0.42, z);

  // Coffins left open against the west wall; bones and grime about the floor.
  coffin(b, 0.2, 5.0, true);
  coffin(b, 0.2, 7.2, false);
  grid.block(0, 5, 0, 8);
  const bones = [1, 2, 3, 5].map((s) => material(`bones-${s}`, () => Pic.bones(s), { cutout: true }));
  const grime = material("grime", () => Pic.grime(4), { cutout: true, flat: true });
  const random = seeded(17);
  for (let k = 0; k < 9; k++) {
    const x = 1 + random() * (W - 2);
    const z = 1 + random() * (D - 2);
    b.decal(fitted(bones[k % bones.length]!), x - 0.5, z - 0.5, x + 0.5, z + 0.5, 0.004 + k * 0.0004);
  }
  for (let k = 0; k < 7; k++) {
    const x = random() * W;
    const z = random() * D;
    const s = 1 + random() * 1.5;
    b.decal(fitted(grime), x - s, z - s, x + s, z + s, 0.002);
  }
  // Rubble and pots by the east wall.
  P.pot(b, 13.4, 9.3, 0, 0.2);
  P.pot(b, 12.9, 9.6, 0, 0.15);
  for (const [x, z, s] of [[13.2, 1.1, 0.35], [12.6, 0.8, 0.25], [13.5, 1.6, 0.22]] as const) b.at(x, 0, z, s * 3, () => b.roundedBox(-s / 2, 0, -s / 2, s / 2, s * 0.8, s / 2, 1 / 16, sides(fitted(surfaces.cryptStone()))));
  grid.block(12, 0, 13, 1);
  grid.block(12, 9, 13, 9);

  // The stair up, climbing south out of the front wall's gap.
  for (let i = 0; i < 4; i++) {
    const z = D + 0.2 + i * 0.35;
    b.box(6, 0, z, 8, 0.18 * (i + 1), z + 0.35, { top: fitted(material("tread", () => Pic.stepTread())), south: tiled(surfaces.cryptBrick()) });
  }
  for (let x = 0; x < W; x++) grid.setWalkable(x, 0, false);

  scene.add(b.build("crypt"));

  // Light: almost none but the fires; a cold glow down the stair.
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.34, 0.36, 0.7), new THREE.Color(0.16, 0.12, 0.22), 0.6 * Math.PI));
  const fireLights = [
    pointLight(scene, 5.25, 1.6, 6.9, new THREE.Color(1.0, 0.55, 0.22), 9, 7),
    pointLight(scene, 8.75, 1.6, 6.9, new THREE.Color(1.0, 0.55, 0.22), 9, 7),
    pointLight(scene, 2.9, 2.4, 1.0, new THREE.Color(1.0, 0.6, 0.3), 6, 5.5),
    pointLight(scene, 10.1, 2.4, 1.0, new THREE.Color(1.0, 0.6, 0.3), 6, 5.5),
  ];
  pointLight(scene, 7, 1.5, D + 1.2, new THREE.Color(0.45, 0.6, 1.0), 6, 5);

  const actors = [
    new Actor(skeleton(), { x: 3, z: 9 }, grid, { beat: { stops: [{ x: 3, z: 9 }, { x: 11, z: 9 }, { x: 12, z: 5 }, { x: 10, z: 2 }], pause: 2 } }, "skeleton", seeded(3)),
    new Actor(ghoul(), { x: 1, z: 2 }, grid, { wander: { home: { x: 3, z: 2 }, reach: 2, pause: [1, 3] } }, "ghoul", seeded(5)),
  ];
  actors[0]!.speed = 1.9;
  actors[1]!.speed = 1.6;
  for (const a of actors) scene.add(a.figure.root);

  const doors: Door[] = [
    { name: "door:street", tile: { x: 7, z: 10 }, step: [0, 1], to: "street", arrive: { x: 35, z: 9 }, arriveFacing: [0, 1], at: new THREE.Vector3(7, 0.6, D + 0.6) },
  ];
  return {
    id: "crypt",
    title: "The Crypt of the Order",
    inside: true,
    scene,
    grid,
    doors,
    actors,
    start: { x: 7, z: 9 },
    bounds: [-0.9, -0.9, W + 0.9, D + 1.6],
    update(_dt, time) {
      const f = Math.floor(time * 8) % 3;
      fires.forEach((list, i) => list.forEach((g) => (g.visible = i === f)));
      fireLights.forEach((l, i) => (l.intensity = (i < 2 ? 8.5 : 5.5) + [0, 1.4, 0.6][(f + i) % 3]!));
    },
  };
}

function ossuaryPicture(): Pixmap {
  const p = new Pixmap(18, 24, C.INK);
  const d = C.DUNGEON;
  // The niche's arch, dark within.
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 18; x++) {
      const dx = x - 8.5;
      const inArch = y > 4 ? Math.abs(dx) < 7.5 : dx * dx + (y - 5) * (y - 5) * 2 < 56;
      if (!inArch) p.set(x, y, (x + y) % 5 === 0 ? d[3]! : d[4]!);
      else p.set(x, y, y < 8 ? C.INK : d[0]!);
    }
  }
  const skull = Pic.skull();
  const random = seeded(4);
  for (const [sx, sy] of [[2, 8], [7, 8], [12, 8], [4, 13], [9, 13], [2, 18], [7, 18], [12, 18]] as const) {
    p.blit(skull, sx + Math.floor(random() * 2), sy);
  }
  for (let x = 1; x < 17; x++) {
    p.set(x, 12, d[5]!);
    p.set(x, 17, d[5]!);
    p.set(x, 23, d[5]!);
  }
  return p;
}

function embers(): Pixmap {
  const p = new Pixmap(8, 8, C.FIRE[1]!);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x * 3 + y * 5) % 7 < 2) p.set(x, y, C.FIRE[3]!);
  return p;
}

function candles(b: MeshBuilder, x: number, y: number, z: number): void {
  const wax = flat(0xe8e0d0);
  const flame = material("candle-flame", () => new Pixmap(2, 2, C.FIRE[4]!), { glowing: true });
  for (const [dx, dz, h] of [[0, 0, 0.3], [0.12, 0.08, 0.2], [-0.1, 0.1, 0.16]] as const) {
    b.box(x + dx - 0.04, y, z + dz - 0.04, x + dx + 0.04, y + h, z + dz + 0.04, sides(wax));
    b.box(x + dx - 0.025, y + h, z + dz - 0.025, x + dx + 0.025, y + h + 0.08, z + dz + 0.025, sides(flame));
  }
}

function coffin(b: MeshBuilder, x: number, z: number, open: boolean): void {
  const wood = tiled(surfaces.darkTimber());
  b.box(x, 0, z, x + 0.9, 0.5, z + 1.9, sides(wood));
  if (open) {
    b.box(x + 0.1, 0.38, z + 0.1, x + 0.8, 0.5, z + 1.8, { top: fitted(material("coffin-in", () => new Pixmap(4, 4, C.DARKWOOD[0]!))) });
    b.at(x + 1.2, 0, z + 0.95, 0.15, () => b.box(-0.06, 0, -0.95, 0.06, 0.9, 0.95, sides(wood)));
  } else {
    b.box(x - 0.04, 0.5, z - 0.04, x + 0.94, 0.58, z + 1.94, sides(wood));
    b.box(x + 0.4, 0.58, z + 0.35, x + 0.5, 0.6, z + 1.0, sides(flat(C.GOLD[2]!)));
    b.box(x + 0.2, 0.58, z + 0.55, x + 0.7, 0.6, z + 0.65, sides(flat(C.GOLD[2]!)));
  }
}
