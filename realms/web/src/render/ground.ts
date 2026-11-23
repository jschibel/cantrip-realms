import * as THREE from "three";
import { bandShader, lit, textureOf } from "./lighting";
import { Pixmap } from "../art/paint/pixmap";

// The ground of a scene on square tiles: one mesh over every tile, and a shader that paints each texel from its tile's
// surface - grass, cobbles, flagstones, boards - read from a small map of the tiles. Where two surfaces meet, the one
// that grows over the other (grass over a path, a path over cobbles) reaches across the seam in a ragged, wavy edge a few
// texels deep, and drops a one-texel shadow onto the surface below it, as the transition tiles of a 16-bit tileset do
// - but without a tile for every pairing, and never in a straight line.

export interface GroundSurface {
  /** The tiling picture, 64 texels square. */
  readonly picture: Pixmap;
  /** Who grows over whom where they meet: the higher wins. */
  readonly priority: number;
  /** A hole: nothing is drawn there, so what lies below shows (a stream's water); its neighbours grow over its edge. */
  readonly hole?: boolean;
}

const ATLAS_TILE = 64;

/**
 * The ground over a block of tiles: `tiles[row][column]` an index into `surfaces` (-1: nothing there), the block's first
 * tile at `origin`. Every texture's texels are counted from `anchor` (default the block's origin), so blocks of one
 * world anchored alike join without a seam: the world's origin, whichever chunks are drawn.
 */
export function buildGround(
  tiles: readonly (readonly number[])[],
  surfaces: readonly GroundSurface[],
  origin: { x: number; z: number } = { x: 0, z: 0 },
  y = 0,
  anchor: { x: number; z: number } = origin,
): THREE.Mesh {
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;

  // The tile map: one texel per tile, its surface in red (255: none).
  const data = new Uint8Array(width * height * 4);
  tiles.forEach((row, j) =>
    row.forEach((id, i) => {
      data.set([id < 0 ? 255 : id, 0, 0, 255], (j * width + i) * 4);
    }),
  );
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.needsUpdate = true;

  const atlas = new Pixmap(ATLAS_TILE * surfaces.length, ATLAS_TILE);
  surfaces.forEach((s, i) => atlas.copy(s.picture, 0, 0, ATLAS_TILE, ATLAS_TILE, i * ATLAS_TILE, 0));
  const atlasTexture = textureOf(atlas, false);

  const material = lit(null, { flat: true });
  material.userData.flat = true;
  const priorities = new Array(16).fill(-1);
  surfaces.forEach((s, i) => (priorities[i] = s.priority));

  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundMap = { value: map };
    shader.uniforms.groundAtlas = { value: atlasTexture };
    shader.uniforms.mapSize = { value: new THREE.Vector2(width, height) };
    shader.uniforms.mapOrigin = { value: new THREE.Vector2(anchor.x, anchor.z) };
    shader.uniforms.mapShift = { value: new THREE.Vector2(anchor.x - origin.x, anchor.z - origin.z) };
    shader.uniforms.atlasCount = { value: surfaces.length };
    shader.uniforms.priority = { value: priorities };
    shader.uniforms.holeId = { value: surfaces.findIndex((s) => s.hole) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSliceWorld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSliceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
varying vec3 vSliceWorld;
uniform sampler2D groundMap;
uniform sampler2D groundAtlas;
uniform vec2 mapSize;
uniform vec2 mapOrigin;
uniform vec2 mapShift;
uniform float atlasCount;
uniform float priority[16];
uniform float holeId;

float gHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float gNoise(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(gHash(vec2(i, 7.0)), gHash(vec2(i + 1.0, 7.0)), f);
}
// A tile counted from the anchor, looked up in the block's map.
float tileId(vec2 anchored) {
  vec2 tile = anchored + mapShift;
  if (tile.x < 0.0 || tile.y < 0.0 || tile.x >= mapSize.x || tile.y >= mapSize.y) return 255.0;
  return floor(texture2D(groundMap, (tile + 0.5) / mapSize).r * 255.0 + 0.5);
}
float prio(float id) {
  if (id > 15.0) return -1.0;
  return priority[int(id)];
}
// The surface a texel shows: its own tile's, unless a neighbour that grows over it reaches this far.
float groundId(vec2 texel) {
  vec2 tile = floor(texel / 16.0);
  vec2 f = texel - tile * 16.0;
  float best = tileId(tile);
  float bestP = prio(best);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      float nid = tileId(tile + vec2(float(dx), float(dy)));
      float np = prio(nid);
      if (np <= bestP) continue;
      float ddx = dx < 0 ? f.x : dx > 0 ? 15.0 - f.x : 99.0;
      float ddy = dy < 0 ? f.y : dy > 0 ? 15.0 - f.y : 99.0;
      float dist = (dx != 0 && dy != 0) ? (ddx + ddy) * 0.62 : min(ddx, ddy);
      float along = dy == 0 ? texel.y : texel.x;
      float reach = 0.6 + 2.6 * gNoise(along / 3.0 + float(dx * 5 + dy * 11)) + gHash(texel) * 1.3;
      if (dist < reach) {
        best = nid;
        bestP = np;
      }
    }
  }
  return best;
}
`,
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
  vec2 sliceTexel = floor((vSliceWorld.xz - mapOrigin) * 16.0);
  float sliceId = groundId(sliceTexel);
  if (sliceId > 15.0 || sliceId == holeId) discard;
  vec2 sliceLocal = mod(sliceTexel, 64.0);
  vec4 sliceColor = texture2D(groundAtlas, vec2((sliceId * 64.0 + sliceLocal.x + 0.5) / (64.0 * atlasCount), 1.0 - (sliceLocal.y + 0.5) / 64.0));
  // A one-texel shadow under the edge of whatever grows over this surface from the north.
  float sliceNorth = groundId(sliceTexel - vec2(0.0, 1.0));
  if (prio(sliceNorth) > prio(sliceId)) sliceColor.rgb *= vec3(0.62, 0.6, 0.72);
  diffuseColor *= sliceColor;
`,
      );
    bandShader(shader);
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  tiles.forEach((row, j) =>
    row.forEach((id, i) => {
      if (id < 0) return;
      const x0 = origin.x + i;
      const z0 = origin.z + j;
      const base = positions.length / 3;
      positions.push(x0, y, z0 + 1, x0 + 1, y, z0 + 1, x0 + 1, y, z0, x0, y, z0);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = "ground";
  return mesh;
}
