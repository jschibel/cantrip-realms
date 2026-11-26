import * as THREE from "three";
import * as C from "../art/paint/colors";
import { bandShader, textureOf } from "./lighting";
import { type Ramp, rampKey } from "../art/paint/palette";
import { Pixmap, seeded } from "../art/paint/pixmap";
import { sprite } from "../art/paint/sprite";

// Grass that stands up: small cards of painted tufts scattered over the grass tiles, swaying in the wind - the touch that
// makes a 3D pixel-art field read as more than a painted floor. Each card takes the ground's own facing (straight up)
// for its light, so it is lit, banded and shadowed exactly as the turf under it and only its silhouette stands out:
// blades over a figure's feet, round a lamp's foot, along a path's edge. It is never outlined.

const TUFTS = [
  [
    "..a.....",
    ".ab..a..",
    ".bb.ab.a",
    "abbcbbab",
    "bccbccbc",
    "cccccccc",
  ],
  [
    ".....a..",
    "..a..ba.",
    ".ab.abb.",
    "abbcbbca",
    "bcbccbcb",
    "cccccccc",
  ],
  [
    "...f....",
    "..fyf.a.",
    "...g.ab.",
    "a..gabb.",
    "bbcbcbcb",
    "cccccccc",
  ],
  [
    "........",
    "a....w..",
    "ba..wyw.",
    "bb.a.g.a",
    "cbcbcgbc",
    "cccccccc",
  ],
];

/** The variants with flowers in them (2 and 3): only the slice's green grass flowers; reeds, plains and frost do not. */
const FLOWERED = 2;

/** The tuft cards' picture: the variants side by side, a row of them in each ramp, top to bottom. */
export function tuftAtlas(ramps: readonly Ramp[] = [C.GRASS]): Pixmap {
  const p = new Pixmap(8 * TUFTS.length, 6 * ramps.length);
  p.fill(0, 0);
  ramps.forEach((g, row) =>
    TUFTS.forEach((rows, i) => {
      p.blit(sprite(rows, { a: g[5]!, b: g[4]!, c: g[3]!, f: C.PINK[3]!, y: C.GOLD[4]!, w: 0xfff8e8, g: g[2]! }), i * 8, row * 6);
    }),
  );
  return p;
}

/** The atlases made, by their ramps: every chunk of a biome shares one texture. */
const atlases = new Map<string, THREE.DataTexture>();
function tuftTexture(ramps: readonly Ramp[]): THREE.DataTexture {
  const key = ramps.map(rampKey).join(",");
  let t = atlases.get(key);
  if (!t) atlases.set(key, (t = textureOf(tuftAtlas(ramps), false)));
  return t;
}

export interface GrassField {
  readonly mesh: THREE.InstancedMesh;
  /** The wind's clock, and the camera's turn the cards face. */
  readonly time: { value: number };
  readonly yaw: { value: number };
}

/**
 * Tufts over a block of tiles `width` by `height` from `origin`, `tufts(x, z)` of them on average on each (0 for none:
 * x and z count from the block's corner), each card half a tile wide and lit as the ground is. One instanced mesh draws
 * them all. The tiles are visited row by row, so a block's tufts stand where they did whatever lies round it. Each
 * tile's tufts are painted in `rampAt(x, z)` (its surface's `tuftRamp`), the slice's green where it gives none; only
 * green tufts have flowers.
 */
export function grassField(
  width: number,
  height: number,
  origin: { x: number; z: number },
  tufts: (x: number, z: number) => number,
  seed = 9,
  /** The ground's height on a tile in the world (a terrace), for the tufts on it to stand on. */
  heightAt: (x: number, z: number) => number = () => 0,
  /** The ramp a tile's tufts are painted in (x and z as `tufts` has them); none, the slice's green. */
  rampAt: (x: number, z: number) => Ramp | undefined = () => undefined,
  /** Where no tuft stands, by its point in the world: a terrace's worn brink and the foot below it (render/terrain.ts). */
  bareAt: (x: number, z: number) => boolean = () => false,
): GrassField {
  const random = seeded(seed);
  const ramps: Ramp[] = [C.GRASS];
  const spots: { x: number; y: number; z: number; variant: number; tone: number; scale: number }[] = [];
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const perTile = tufts(x, z);
      if (perTile <= 0) continue;
      const ramp = rampAt(x, z) ?? C.GRASS;
      let tone = ramps.indexOf(ramp);
      if (tone < 0) tone = ramps.push(ramp) - 1;
      const n = Math.floor(perTile * (0.5 + random()));
      for (let k = 0; k < n; k++) {
        const variant = random() < 0.85 ? Math.floor(random() * 2) : 2 + Math.floor(random() * 2);
        const spot = { x: origin.x + x + random(), y: heightAt(origin.x + x, origin.z + z), z: origin.z + z + random(), variant: tone === 0 ? variant : variant % FLOWERED, tone, scale: 0.85 + random() * 0.3 };
        // Drawn from the generator either way, so the tufts that stand stand where they did.
        if (!bareAt(spot.x, spot.z)) spots.push(spot);
      }
    }
  }

  // One card: 8 by 6 texels, standing on its foot, facing the three-quarter camera; normals straight up, like the turf.
  const geometry = new THREE.PlaneGeometry(0.5, 0.375);
  geometry.translate(0, 0.1875, 0);
  const normals = geometry.getAttribute("normal");
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  // Which variant each card shows and in which ramp: a column and a row of the picture (the first row at the top).
  const variants = new Float32Array(spots.length * 2);
  spots.forEach((s, i) => variants.set([s.variant, ramps.length - 1 - s.tone], i * 2));
  geometry.setAttribute("variant", new THREE.InstancedBufferAttribute(variants, 2));

  const texture = tuftTexture(ramps);
  const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
  material.userData.skipNormal = true;
  const time = { value: 0 };
  const yaw = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.grassTime = time;
    shader.uniforms.grassYaw = yaw;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec2 variant;\nuniform float grassTime;\nuniform float grassYaw;`)
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>\nvMapUv = vec2((uv.x + variant.x) / ${TUFTS.length.toFixed(1)}, (uv.y + variant.y) / ${ramps.length.toFixed(1)});`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        // The wind: the card's top sways, in gusts that roll across the field.
        vec3 grassAt = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float gust = sin(grassTime * 1.7 + grassAt.x * 0.55 + grassAt.z * 0.35) * 0.5 + 0.5;
        transformed.x += uv.y * (0.025 + 0.06 * gust) * sin(grassTime * 3.1 + grassAt.x * 2.3 + grassAt.z * 1.7);
        // Each card faces the camera at whatever heading it has.
        float grassC = cos(grassYaw);
        float grassS = sin(grassYaw);
        transformed.xz = vec2(grassC * transformed.x + grassS * transformed.z, -grassS * transformed.x + grassC * transformed.z);`,
      );
    bandShader(shader);
  };

  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (random() - 0.5) * 0.5);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale));
    mesh.setMatrixAt(i, m);
  });
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "grass";
  return { mesh, time, yaw };
}
