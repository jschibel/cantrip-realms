import * as THREE from "three";
import { Pixmap } from "../art/paint/pixmap";

/** A soft, round shadow on the ground under a figure: drawn darker, never outlined. */
export function blobShadow(radius: number): THREE.Mesh {
  // Multiplied over the ground: white leaves it be, the violet-grey darkens it.
  const p = new Pixmap(16, 16, 0xffffff);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.hypot((x - 7.5) / 7.5, (y - 7.5) / 7.5) <= 1) p.set(x, y, 0x8a84a8);
  const tex = new THREE.DataTexture(p.data, 16, 16);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, depthWrite: false });
  mat.userData.skipNormal = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), mat);
  mesh.position.y = 0.01;
  mesh.renderOrder = 1;
  return mesh;
}

