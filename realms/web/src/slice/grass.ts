import * as THREE from "three";
import * as C from "./colors";
import { bandShader, textureOf } from "./material";
import { Pixmap, seeded } from "./pixmap";
import { sprite } from "./sprite";

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

/** The tuft cards' picture: the variants side by side. */
function tuftAtlas(): Pixmap {
  const g = C.GRASS;
  const p = new Pixmap(8 * TUFTS.length, 6);
  p.fill(0, 0);
  TUFTS.forEach((rows, i) => {
    p.blit(sprite(rows, { a: g[5]!, b: g[4]!, c: g[3]!, f: C.PINK[3]!, y: C.GOLD[4]!, w: 0xfff8e8, g: g[2]! }), i * 8, 0);
  });
  return p;
}

export interface GrassField {
  readonly mesh: THREE.InstancedMesh;
  /** The wind's clock. */
  readonly time: { value: number };
}

/**
 * Tufts over the tiles `where` says are grass, `perTile` of them on average, each card half a tile wide and lit as the
 * ground is. One instanced mesh draws them all.
 */
export function grassField(width: number, height: number, origin: { x: number; z: number }, where: (x: number, z: number) => boolean, perTile = 3, seed = 9): GrassField {
  const random = seeded(seed);
  const spots: { x: number; z: number; variant: number; scale: number }[] = [];
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (!where(x, z)) continue;
      const n = Math.floor(perTile * (0.5 + random()));
      for (let k = 0; k < n; k++) {
        spots.push({ x: origin.x + x + random(), z: origin.z + z + random(), variant: random() < 0.85 ? Math.floor(random() * 2) : 2 + Math.floor(random() * 2), scale: 0.85 + random() * 0.3 });
      }
    }
  }

  // One card: 8 by 6 texels, standing on its foot, facing the three-quarter camera; normals straight up, like the turf.
  const geometry = new THREE.PlaneGeometry(0.5, 0.375);
  geometry.translate(0, 0.1875, 0);
  const normals = geometry.getAttribute("normal");
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  // Which variant each card shows: an offset into the picture.
  const variants = new Float32Array(spots.length);
  spots.forEach((s, i) => (variants[i] = s.variant));
  geometry.setAttribute("variant", new THREE.InstancedBufferAttribute(variants, 1));

  const texture = textureOf(tuftAtlas(), false);
  const material = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
  material.userData.skipNormal = true;
  const time = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.grassTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float variant;\nuniform float grassTime;`)
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>\nvMapUv = vec2((uv.x + variant) / ${TUFTS.length.toFixed(1)}, uv.y);`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        // The wind: the card's top sways, in gusts that roll across the field.
        vec3 grassAt = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float gust = sin(grassTime * 1.7 + grassAt.x * 0.55 + grassAt.z * 0.35) * 0.5 + 0.5;
        transformed.x += uv.y * (0.025 + 0.06 * gust) * sin(grassTime * 3.1 + grassAt.x * 2.3 + grassAt.z * 1.7);`,
      );
    bandShader(shader);
  };

  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (random() - 0.5) * 0.5);
    m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale));
    mesh.setMatrixAt(i, m);
  });
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "grass";
  return { mesh, time };
}
