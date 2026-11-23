import * as THREE from "three";
import "./style.css";
import "./theme.css";
import { type Appearance, BODIES, Character, type GearLook, type ManaColor, SKIN_PALETTES, type Slot } from "./character";
import { DOMINARIA } from "./palette";
import { PixelRenderer } from "./render";

// A dev page (/models.html) that draws every voxel model through the overworld's own pixel pipeline, to tune them by
// eye: the four bodies in each of the six skin palettes, bodies wearing a piece of gear in every slot, and the mobs
// walking. ?only=bodies|gear|mobs shows one row, centred; ?still stops them walking.

THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(window.location.search);
const only = query.get("only");
const walking = !query.has("still");

const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const pixels = new PixelRenderer(canvas, DOMINARIA);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#93c8dc");

const ground = new THREE.Mesh(new THREE.BoxGeometry(80, 1, 80), new THREE.MeshToonMaterial({ color: "#5a8538" }));
ground.position.y = -0.5;
ground.receiveShadow = true;
scene.add(ground);
const sun = new THREE.DirectionalLight("#fff2d6", 2.2);
sun.position.set(-18, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 90 });
scene.add(sun, sun.target, new THREE.HemisphereLight("#c6e5ee", "#434c36", 1.1));

// Rows run across the screen: the camera looks along (1, 0, 1) turned, so "right" on screen is (1, 0, -1) on the ground.
const right = new THREE.Vector3(1, 0, -1).normalize();
const down = new THREE.Vector3(1, 0, 1).normalize();
const characters: { c: Character; walks: boolean }[] = [];

function row(index: number, list: Character[], spacing: number, walks: boolean): void {
  list.forEach((c, i) => {
    const across = (i - (list.length - 1) / 2) * spacing;
    c.root.position.copy(right.clone().multiplyScalar(across)).addScaledVector(down, index * 7);
    c.root.rotation.y = Math.PI / 4 - 0.5;
    scene.add(c.root);
    characters.push({ c, walks });
  });
}

const colors: ManaColor[][] = [["W"], ["U"], ["B"], ["R"], ["G"], ["W", "U"]];
const bodies = BODIES.flatMap((body, b) =>
  SKIN_PALETTES.map((_, p) => Character.player(`${body} ${p}`, { body, palette: p, identity: colors[(p + b) % colors.length]!, slots: {} })),
);

const gold = ["#f1b44c", "#5b8fd6"];
const kits: Partial<Record<Slot, GearLook>>[] = [
  { head: { mesh: "helm", palette: ["#8c909c", "#c8432c"] }, body: { mesh: "armor", palette: ["#b3b5bc", "#f1b44c"] }, hands: { mesh: "gloves", palette: ["#6b4630", "#f1b44c"] }, feet: { mesh: "boots", palette: ["#4a3122", "#8f6340"] }, ring1: { mesh: "ring", palette: ["#f1b44c", "#c8432c"] } },
  { head: { mesh: "circlet", palette: gold }, neck: { mesh: "amulet", palette: ["#f1b44c", "#3e9a4a"] }, body: { mesh: "robe", palette: ["#4b2f5e", "#f1b44c"] }, relic: { mesh: "relic", palette: ["#a97fd0", "#f4ecc2"] }, ring2: { mesh: "ring", palette: ["#62a4c2", "#f4ecc2"] } },
];
const geared = BODIES.flatMap((body, b) =>
  kits.map((slots, k) => {
    const a: Appearance = { body, palette: (b + k * 2) % 6, identity: colors[b]!, slots };
    return Character.player(`${body} kit ${k}`, a);
  }),
);

const mobs = [
  Character.mob("humanoid", { mesh: "humanoid", palette: ["#8c909c", "#7a1f24"] }),
  Character.mob("ghoul", { mesh: "ghoul", palette: ["#8c909c", "#434c36"] }),
  Character.mob("angel", { mesh: "angel", palette: ["#f2efe6", "#f1b44c", "#d8d6d0"] }),
  Character.mob("drake", { mesh: "drake", palette: ["#c8432c", "#f1b44c", "#7a1f24"], size: 1.3 }),
  Character.mob("elf", { mesh: "elf", palette: ["#3a5f2c", "#6b4630", "#d6ae7e"] }),
  Character.mob("goblin", { mesh: "goblin", palette: ["#6b963e", "#8f6340"] }),
  Character.mob("wurm", { mesh: "wurm", palette: ["#5d6646", "#b8cf6a", "#7a1f24"] }),
  Character.mob("construct", { mesh: "construct", palette: ["#8c909c", "#9c6a1e", "#62a4c2"] }),
  Character.mob("spirit", { mesh: "spirit", palette: ["#c6e5ee", "#62a4c2", "#f4ecc2"] }),
  Character.mob("phyrexian", { mesh: "phyrexian", palette: ["#b3b5bc", "#7a1f24", "#3e9a4a"] }),
];

const one = query.get("mob");
if (one) {
  // One model from the front, three quarters, the side and behind.
  const palette = (query.get("palette") ?? "#8c909c,#7a1f24,#f1b44c").split(",");
  const views = [0, Math.PI / 4, Math.PI / 2, Math.PI].map((turn) => {
    const c = Character.mob(one, { mesh: one, palette });
    return { c, turn };
  });
  row(0, views.map((v) => v.c), 3.2, walking);
  views.forEach((v) => (v.c.root.rotation.y = Math.PI / 4 + v.turn));
} else if (only === "bodies") {
  row(-0.5, bodies.slice(0, 12), 1.3, false);
  row(0.5, bodies.slice(12), 1.3, false);
} else if (only === "gear") {
  row(0, geared, 1.6, false);
} else if (only === "mobs") {
  row(-0.5, mobs.slice(0, 5), 3, walking);
  row(0.5, mobs.slice(5), 3, walking);
} else {
  row(-1.5, bodies.slice(0, 12), 1.3, false);
  row(-0.5, bodies.slice(12), 1.3, false);
  row(0.5, geared, 1.6, false);
  row(1.6, mobs, 2.6, walking);
}

window.addEventListener("resize", () => pixels.resize());
const clock = new THREE.Clock();
const focus = new THREE.Vector3(0, 0.6, 0);
function frame(): void {
  const seconds = Math.min(clock.getDelta(), 0.1);
  for (const { c, walks } of characters) c.animate(seconds, walks);
  pixels.lookAt(focus);
  pixels.render(scene);
  requestAnimationFrame(frame);
}
frame();
(globalThis as Record<string, unknown>).galleryReady = true;
