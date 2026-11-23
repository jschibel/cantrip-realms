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
/** Pictures a row of the atlas: it is a grid, so any number of surfaces stays within a texture's size. */
const ATLAS_COLUMNS = 8;
/** The tile map's mark for "no surface here". */
const NONE = 255;
/** The most surfaces one block can use: every id but `NONE` (the registry holds far fewer). */
export const MAX_GROUND_SURFACES = NONE;

/**
 * The tile map a block's shader reads, one texel per tile: red its surface (255: none), green where that surface's
 * priority stands among the block's (its rank, ties equal, "none" ranked as priority -1), blue 255 for a hole. Each
 * tile carries its own priority and hole flag, so a block holds as many surfaces as it uses (up to
 * `MAX_GROUND_SURFACES`) and every hole among them is a gap showing its own liquid under it.
 */
export function groundMap(
  tiles: readonly (readonly number[])[],
  surfaces: readonly Pick<GroundSurface, "priority" | "hole">[],
): { readonly data: Uint8Array; readonly width: number; readonly height: number; readonly noneRank: number } {
  if (surfaces.length > MAX_GROUND_SURFACES) throw new Error(`a block of ground has ${surfaces.length} surfaces; at most ${MAX_GROUND_SURFACES}`);
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  // Priorities as ranks: only their order matters to the shader, and a byte holds a rank exactly.
  const levels = [...new Set([-1, ...surfaces.map((s) => s.priority)])].sort((a, b) => a - b);
  const noneRank = levels.indexOf(-1);
  const ranks = surfaces.map((s) => levels.indexOf(s.priority));
  const data = new Uint8Array(width * height * 4);
  tiles.forEach((row, j) =>
    row.forEach((id, i) => {
      const s = id < 0 ? undefined : surfaces[id];
      data.set(s ? [id, ranks[id]!, s.hole ? 255 : 0, 255] : [NONE, noneRank, 0, 255], (j * width + i) * 4);
    }),
  );
  return { data, width, height, noneRank };
}

/** The surfaces' pictures in a grid, `ATLAS_COLUMNS` a row: surface `i` at column `i % columns`, row `i / columns`. */
export function groundAtlas(surfaces: readonly Pick<GroundSurface, "picture">[]): { readonly atlas: Pixmap; readonly columns: number; readonly rows: number } {
  const columns = Math.max(1, Math.min(ATLAS_COLUMNS, surfaces.length));
  const rows = Math.max(1, Math.ceil(surfaces.length / columns));
  const atlas = new Pixmap(ATLAS_TILE * columns, ATLAS_TILE * rows);
  surfaces.forEach((s, i) => atlas.copy(s.picture, 0, 0, ATLAS_TILE, ATLAS_TILE, (i % columns) * ATLAS_TILE, Math.floor(i / columns) * ATLAS_TILE));
  return { atlas, columns, rows };
}

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
  /**
   * The mesh's own shape (render/terrain.ts: floors at their heights), where the map is wider than what is drawn - a
   * chunk's map holds a border of its neighbours' tiles, so its edges grow over theirs as they would in one piece.
   */
  shape?: THREE.BufferGeometry,
): THREE.Mesh {
  const { data, width, height, noneRank } = groundMap(tiles, surfaces);
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.needsUpdate = true;

  const { atlas, columns, rows } = groundAtlas(surfaces);
  const atlasTexture = textureOf(atlas, false);

  const material = lit(null, { flat: true });
  material.userData.flat = true;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundMap = { value: map };
    shader.uniforms.groundAtlas = { value: atlasTexture };
    shader.uniforms.mapSize = { value: new THREE.Vector2(width, height) };
    shader.uniforms.mapOrigin = { value: new THREE.Vector2(anchor.x, anchor.z) };
    shader.uniforms.mapShift = { value: new THREE.Vector2(anchor.x - origin.x, anchor.z - origin.z) };
    shader.uniforms.atlasGrid = { value: new THREE.Vector2(columns, rows) };
    shader.uniforms.noneRank = { value: noneRank };
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
uniform vec2 atlasGrid;
uniform float noneRank;

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
// A tile counted from the anchor, looked up in the block's map: its surface (255: none), its priority's rank, and 1
// for a hole.
vec3 tileOf(vec2 anchored) {
  vec2 tile = anchored + mapShift;
  if (tile.x < 0.0 || tile.y < 0.0 || tile.x >= mapSize.x || tile.y >= mapSize.y) return vec3(255.0, noneRank, 0.0);
  vec4 t = texture2D(groundMap, (tile + 0.5) / mapSize);
  return vec3(floor(t.r * 255.0 + 0.5), floor(t.g * 255.0 + 0.5), step(0.5, t.b));
}
// The surface a texel shows (as tileOf gives it): its own tile's, unless a neighbour that grows over it reaches this far.
vec3 groundId(vec2 texel) {
  vec2 tile = floor(texel / 16.0);
  vec2 f = texel - tile * 16.0;
  vec3 best = tileOf(tile);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      vec3 n = tileOf(tile + vec2(float(dx), float(dy)));
      if (n.y <= best.y) continue;
      float ddx = dx < 0 ? f.x : dx > 0 ? 15.0 - f.x : 99.0;
      float ddy = dy < 0 ? f.y : dy > 0 ? 15.0 - f.y : 99.0;
      float dist = (dx != 0 && dy != 0) ? (ddx + ddy) * 0.62 : min(ddx, ddy);
      float along = dy == 0 ? texel.y : texel.x;
      float reach = 0.6 + 2.6 * gNoise(along / 3.0 + float(dx * 5 + dy * 11)) + gHash(texel) * 1.3;
      if (dist < reach) best = n;
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
  vec3 slice = groundId(sliceTexel);
  // Nothing, or a hole (each hole's own liquid lies under it): a gap.
  if (slice.x > 254.5 || slice.z > 0.5) discard;
  vec2 sliceLocal = mod(sliceTexel, 64.0);
  vec2 sliceCell = vec2(mod(slice.x, atlasGrid.x), floor(slice.x / atlasGrid.x + 0.001));
  vec4 sliceColor = texture2D(groundAtlas, vec2((sliceCell.x * 64.0 + sliceLocal.x + 0.5) / (64.0 * atlasGrid.x), 1.0 - (sliceCell.y * 64.0 + sliceLocal.y + 0.5) / (64.0 * atlasGrid.y)));
  // A one-texel shadow under the edge of whatever grows over this surface from the north.
  vec3 sliceNorth = groundId(sliceTexel - vec2(0.0, 1.0));
  if (sliceNorth.y > slice.y) sliceColor.rgb *= vec3(0.62, 0.6, 0.72);
  diffuseColor *= sliceColor;
`,
      );
    bandShader(shader);
  };

  if (shape) {
    const mesh = new THREE.Mesh(shape, material);
    mesh.receiveShadow = true;
    mesh.name = "ground";
    mesh.userData.groundTextures = [map, atlasTexture];
    return mesh;
  }
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
  mesh.userData.groundTextures = [map, atlasTexture];
  return mesh;
}
