import * as THREE from "three";
import { XRAY, XRAY_NORMAL } from "./xray";

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
    // A cuttable material's stand-in cuts the same hole (render/xray.ts).
    const xray = !!material.userData.xray;
    n = new THREE.ShaderMaterial({
      vertexShader: xray
        ? NORMAL_VERTEX.replace("varying vec3 vNormal;", `varying vec3 vNormal;${XRAY_NORMAL.vertexDeclare}`).replace(
            "gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
            `vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vXrayDepth = -mvPosition.z;
  vXrayY = (modelMatrix * vec4(position, 1.0)).y;`,
          )
        : NORMAL_VERTEX,
      fragmentShader: xray ? NORMAL_FRAGMENT.replace("varying vec3 vNormal;", `varying vec3 vNormal;${XRAY_NORMAL.fragmentDeclare}`).replace("void main() {", `void main() {${XRAY_NORMAL.test}`) : NORMAL_FRAGMENT,
      uniforms: {
        ...(xray ? XRAY : {}),
        map: { value: cutout ? source.map : null },
        cutout: { value: cutout ? 1 : 0 },
        kind: { value: material.userData.terrain ? 0.875 : material.userData.flat ? 0.5 : material.userData.glow ? 0.75 : 1 },
      },
      side: material.side,
    });
    normals.set(material, n);
  }
  return n;
}
