import * as THREE from "three";
import { bandShader, lit, textureOf } from "./lighting";
import { Pixmap } from "../art/paint/pixmap";
import { NO_RELIEF } from "./terrain";

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
  /**
   * The stone that shows through the worn rim of its terraces' brinks (0xRRGGBB): its bank's own (art/surfaces
   * `brink`). Without one the rim is its own picture worn paler.
   */
  readonly brink?: number;
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

/**
 * The terraces' edges, painted on the ground's top (so they read whichever way an edge runs and whichever way the camera
 * looks, its face seen or hidden). Along each brink - where a tile's edge stands above its neighbour's, wherever along the
 * edge it does - a rim a few texels deep, ragged, worn paler with stones of its bank showing through, its outermost
 * texel a lit lip; along each foot - where the neighbour stands above - a shade of the cool shadow's color in two bands,
 * wider the higher the bank. An edge of two levels or more has a deeper rim, a thicker lip and a wider, darker shade
 * than a one-level bank. Inner and outer corners follow the corner tiles. Higher ground is a touch lighter and warmer,
 * so two levels never meet in one color. Every texel is counted from the world's anchor, so it all holds still as the
 * camera moves and joins across chunks.
 */
const EDGES_GLSL = /* glsl */ `
uniform sampler2D reliefMap;
uniform sampler2D brinkMap;
uniform float brinkCount;
uniform float hasRelief;

// A tile's corner heights in texels (north-west, north-east, south-east, south-west), counted from the anchor.
vec4 cornersAt(vec2 anchored) {
  vec2 tile = anchored + mapShift;
  if (tile.x < 0.0 || tile.y < 0.0 || tile.x >= mapSize.x || tile.y >= mapSize.y) return vec4(${NO_RELIEF.toFixed(1)});
  return texture2D(reliefMap, (tile + 0.5) / mapSize);
}
// How far my edge stands above a neighbour's facing edge at a point along it, texels (0 where it has no ground).
float dropTo(float mine, float theirs) { return theirs < ${(NO_RELIEF / 2).toFixed(1)} ? 0.0 : mine - theirs; }

vec3 terrainEdges(vec2 texel, vec3 color, float surface) {
  vec2 tile = floor(texel / 16.0);
  vec4 me = cornersAt(tile);
  if (me.x < ${(NO_RELIEF / 2).toFixed(1)}) return color;
  vec2 p = texel - tile * 16.0 + 0.5;
  vec2 t = p / 16.0;
  vec4 n = cornersAt(tile + vec2(0.0, -1.0));
  vec4 s = cornersAt(tile + vec2(0.0, 1.0));
  vec4 w = cornersAt(tile + vec2(-1.0, 0.0));
  vec4 e = cornersAt(tile + vec2(1.0, 0.0));
  vec4 nw = cornersAt(tile + vec2(-1.0, -1.0));
  vec4 ne = cornersAt(tile + vec2(1.0, -1.0));
  vec4 se = cornersAt(tile + vec2(1.0, 1.0));
  vec4 sw = cornersAt(tile + vec2(-1.0, 1.0));
  // Each edge and corner: the drop there, how far this texel is from it, and the world texel along it (for its ragged line).
  float drop[8];
  float dist[8];
  float along[8];
  drop[0] = dropTo(mix(me.x, me.y, t.x), mix(n.w, n.z, t.x)); dist[0] = p.y; along[0] = texel.x;
  drop[1] = dropTo(mix(me.w, me.z, t.x), mix(s.x, s.y, t.x)); dist[1] = 16.0 - p.y; along[1] = texel.x + 57.0;
  drop[2] = dropTo(mix(me.x, me.w, t.y), mix(w.y, w.z, t.y)); dist[2] = p.x; along[2] = texel.y + 131.0;
  drop[3] = dropTo(mix(me.y, me.z, t.y), mix(e.x, e.w, t.y)); dist[3] = 16.0 - p.x; along[3] = texel.y + 199.0;
  drop[4] = dropTo(me.x, nw.z); dist[4] = length(p); along[4] = texel.x + texel.y;
  drop[5] = dropTo(me.y, ne.w); dist[5] = length(p - vec2(16.0, 0.0)); along[5] = texel.x - texel.y;
  drop[6] = dropTo(me.z, se.x); dist[6] = length(p - vec2(16.0)); along[6] = texel.x + texel.y + 77.0;
  drop[7] = dropTo(me.w, sw.y); dist[7] = length(p - vec2(0.0, 16.0)); along[7] = texel.x - texel.y + 77.0;

  float rim = 0.0;
  float lip = 0.0;
  float lipWidth = 1.0;
  float brink = 99.0;
  float tallRim = 0.0;
  float shade = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = drop[i];
    float ragged = gNoise(along[i] / 5.0) * 2.2 + gNoise(along[i] / 1.7 + 31.0) * 0.8 + gHash(texel + float(i) * 17.0) * 0.6;
    if (d > 0.0) {
      // A brink: banks of a texel or two (a road's kerb) barely; a level's bank fully; two levels deeper.
      float at = smoothstep(1.5, 6.0, d);
      float tall = clamp((d - 12.0) / 12.0, 0.0, 1.0);
      if (dist[i] < at * (1.5 + 2.5 * tall + ragged)) {
        rim = max(rim, at);
        tallRim = max(tallRim, tall * at);
      }
      if (at > 0.3 && dist[i] < brink) {
        brink = dist[i];
        lip = at;
        lipWidth = 1.0 + tall;
      }
    } else if (d < 0.0) {
      // A foot: the shade reaches further the higher the bank (a level: about 5 texels; three: about 11).
      float at = smoothstep(1.5, 6.0, -d);
      float reach = at * (2.0 + min(-d, 48.0) / 4.0) + ragged * 0.6;
      if (dist[i] < reach) shade = max(shade, dist[i] < reach * 0.45 ? 2.0 : 1.0);
    }
  }

  // Higher ground a touch lighter and warmer: a level's step always shows, the steps easing off up a mountain.
  float h = mix(mix(me.x, me.y, t.x), mix(me.w, me.z, t.x), t.y);
  float level = max(h, 0.0) / 12.0;
  float k = level / (level + 4.0);
  color *= vec3(1.0 + 0.22 * k, 1.0 + 0.18 * k, 1.0 + 0.08 * k);

  if (rim > 0.0) {
    // Worn: toward the bank's stone and a little paler (a light surface, snow, a little darker: packed), with stones of
    // the bank through it.
    vec4 stone = texture2D(brinkMap, vec2((surface + 0.5) / brinkCount, 0.5));
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    vec3 toward = stone.a > 0.5 ? stone.rgb : vec3(luma);
    vec3 worn = mix(color, toward, 0.4) * (luma > 0.62 ? 0.92 : 1.12) + (luma > 0.62 ? 0.0 : 0.02);
    color = mix(color, worn, rim);
    vec2 cell = floor(texel / 2.0);
    if (gHash(cell * 1.7 + 3.1) < 0.1 + 0.12 * tallRim) {
      vec3 rock = stone.a > 0.5 ? mix(stone.rgb, worn, 0.35) : worn * 1.12;
      vec2 in2 = texel - cell * 2.0;
      color = mix(color, (in2.x > 0.5 && in2.y > 0.5) ? rock * 0.7 : rock, rim);
    }
  }
  // The lip: lit, the texels in from the nearest brink's own (which the outline pass darkens where lower ground shows
  // past it), two of them over a cliff.
  if (brink >= 1.0 && brink < 1.0 + lipWidth) color = mix(color, min(vec3(1.0), color * 1.28 + 0.05), lip * (gHash(texel * 0.37 + 9.0) < 0.2 ? 0.55 : 1.0));
  if (shade > 1.5) color *= vec3(0.66, 0.64, 0.78);
  else if (shade > 0.5) color *= vec3(0.82, 0.8, 0.9);
  return color;
}
`;

/** Each surface's brink stone, one texel a surface: its color, alpha 255 where it has one (else 0). */
export function brinkMap(surfaces: readonly Pick<GroundSurface, "brink">[]): Uint8Array {
  const data = new Uint8Array(Math.max(1, surfaces.length) * 4);
  surfaces.forEach((s, i) => {
    if (s.brink !== undefined) data.set([(s.brink >> 16) & 255, (s.brink >> 8) & 255, s.brink & 255, 255], i * 4);
  });
  return data;
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
  /**
   * The relief under the map (render/terrain.ts `reliefMap`, a tile of it for each of the map's): where it is given, the
   * terraces' edges are drawn on the ground - a worn rim along each brink, a shade along each foot, and higher ground a
   * touch lighter. Without it (rooms, dungeons: drawn level) the ground is flat.
   */
  relief?: Float32Array,
): THREE.Mesh {
  const { data, width, height, noneRank } = groundMap(tiles, surfaces);
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.needsUpdate = true;

  const { atlas, columns, rows } = groundAtlas(surfaces);
  const atlasTexture = textureOf(atlas, false);

  if (relief && relief.length !== width * height * 4) throw new Error(`a block's relief has ${relief.length / 4} tiles; its map ${width * height}`);
  const reliefTexture = relief ? new THREE.DataTexture(relief, width, height, THREE.RGBAFormat, THREE.FloatType) : new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  reliefTexture.magFilter = reliefTexture.minFilter = THREE.NearestFilter;
  reliefTexture.needsUpdate = true;
  const brinks = new THREE.DataTexture(brinkMap(surfaces), Math.max(1, surfaces.length), 1, THREE.RGBAFormat);
  brinks.magFilter = brinks.minFilter = THREE.NearestFilter;
  brinks.needsUpdate = true;

  const material = lit(null, { flat: true });
  material.userData.flat = true;
  /** Whether the terraces' edges are drawn (1 where there is relief): a test sets it to 0 to compare (e2e/edges.spec.ts). */
  material.userData.edges = { value: relief ? 1 : 0 };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundMap = { value: map };
    shader.uniforms.groundAtlas = { value: atlasTexture };
    shader.uniforms.reliefMap = { value: reliefTexture };
    shader.uniforms.brinkMap = { value: brinks };
    shader.uniforms.brinkCount = { value: Math.max(1, surfaces.length) };
    shader.uniforms.hasRelief = material.userData.edges;
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
${EDGES_GLSL}
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
  if (hasRelief > 0.5) sliceColor.rgb = terrainEdges(sliceTexel, sliceColor.rgb, slice.x);
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
