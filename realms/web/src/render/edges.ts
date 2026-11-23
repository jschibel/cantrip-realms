import * as THREE from "three";

// The normal pass: each surface's facing, in view space, for the post pass to find convex edges and outline what
// stands in front. Cut-out materials keep their cut-outs; a flat material writes a zero kind so it is never outlined.
const NORMAL_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NORMAL_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float cutout;
uniform float kind;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  if (cutout > 0.5 && texture2D(map, vUv).a < 0.5) discard;
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = vec4(n * 0.5 + 0.5, kind);
}`;

const normals = new WeakMap<THREE.Material, THREE.ShaderMaterial>();

/** The normal-pass stand-in for a material, made once for each. */
export function normalMaterialFor(material: THREE.Material): THREE.ShaderMaterial {
  let n = normals.get(material);
  if (!n) {
    const source = material as THREE.MeshLambertMaterial;
    const cutout = (source.alphaTest ?? 0) > 0 && !!source.map;
    n = new THREE.ShaderMaterial({
      vertexShader: NORMAL_VERTEX,
      fragmentShader: NORMAL_FRAGMENT,
      uniforms: {
        map: { value: cutout ? source.map : null },
        cutout: { value: cutout ? 1 : 0 },
        kind: { value: material.userData.flat ? 0.5 : material.userData.glow ? 0.75 : 1 },
      },
      side: material.side,
    });
    normals.set(material, n);
  }
  return n;
}
