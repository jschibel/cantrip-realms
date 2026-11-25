import * as THREE from "three";
import { type Appearance, Figure, type FigureSpec, type GearLook, type MobModel, mobFigure, playerFigure } from "./art/figures";

// The character's portrait for the card layer's gear screen (interfaces.md, "The card layer": `portrait`): the player's
// figure as the world draws it - the same rig, texels and gear meshes (art/figures) - standing in three-quarter view
// under a sun and a sky like the open air's, rendered on a small canvas of its own and handed over as a PNG. The card
// layer magnifies it by whole pixels, so it stays pixel art. It asks again whenever what is worn changes. A mob's
// portrait is drawn the same way, for the dialog of a duel it won (screens/defeat.ts).

/** Pixels to a world unit: three to a texel (a texel is a sixteenth of a unit), so the card layer magnifies whole pixels. */
const PIXELS_PER_UNIT = 48;

let renderer: THREE.WebGLRenderer | null = null;

/** The figure of `appearance` wearing `slots` instead of what it wears, as a PNG data URL; null where WebGL is not to be had. */
export function renderPortrait(appearance: Appearance, slots: Readonly<Record<string, GearLook>>): string | null {
  return renderFigure(playerFigure({ ...appearance, slots }));
}

/** A mob's figure (`mobFigure`) as a PNG data URL, as the player's is drawn; null where WebGL is not to be had. */
export function renderMob(model: MobModel, id: string, creature: string): string | null {
  return renderFigure(mobFigure(model, id, creature));
}

function renderFigure(spec: FigureSpec): string | null {
  try {
    renderer ??= new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), alpha: true, antialias: false, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.92, 0.78), 0.86 * Math.PI);
  sun.position.set(-4, 6, 7);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.6, 0.68, 1.0), new THREE.Color(0.52, 0.42, 0.5), 0.6 * Math.PI));

  const figure = new Figure(spec);
  figure.face(0.5, 1);
  // Settled: turned to the three-quarter view, standing at rest.
  for (let i = 0; i < 12; i++) figure.update(0.1, 0);
  scene.add(figure.root);
  scene.updateMatrixWorld(true);

  // A camera a little above, looking down the figure's front; framed on everything it draws, a floating relic too.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  const box = new THREE.Box3().setFromObject(figure.root);
  const centre = box.getCenter(new THREE.Vector3());
  camera.position.set(centre.x, centre.y + 2.2, centre.z + 10);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  const view = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    view.expandByPoint(corner.applyMatrix4(camera.matrixWorldInverse));
  }
  const margin = 0.08;
  camera.left = view.min.x - margin;
  camera.right = view.max.x + margin;
  camera.bottom = view.min.y - margin;
  camera.top = view.max.y + margin;
  camera.updateProjectionMatrix();

  const width = Math.max(8, Math.round((camera.right - camera.left) * PIXELS_PER_UNIT));
  const height = Math.max(8, Math.round((camera.top - camera.bottom) * PIXELS_PER_UNIT));
  renderer.setSize(width, height, false);
  renderer.render(scene, camera);
  const image = renderer.domElement.toDataURL("image/png");

  // The figure's own geometry goes; its materials are shared with the world's figures and stay.
  figure.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  scene.clear();
  return image;
}
