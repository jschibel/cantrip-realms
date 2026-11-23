import * as THREE from "three";
import type { LightSpec } from "../art/recipe";
import type { LightData } from "../world/format";

// The lights of a place, made from their specs: the open air's sun and sky, a room's ambient light, and the fires,
// candles and windows the world data or a recipe names. Every lit material bands what reaches it (lighting.ts), so a
// fire's pool steps down across the floor in a few flat tones.

/** Sunlight for the open air: a warm sun from the south-west, high, casting shadows; a cool sky over everything. */
export function sunlight(scene: THREE.Scene, centreX: number, centreZ: number, reach: number): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.92, 0.78), 0.86 * Math.PI);
  sun.position.set(-15, 17, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.01;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 90 });
  const holder = new THREE.Group();
  holder.position.set(centreX, 0, centreZ);
  holder.add(sun, sun.target);
  scene.add(holder);
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.6, 0.68, 1.0), new THREE.Color(0.52, 0.42, 0.5), 0.46 * Math.PI));
  return sun;
}

const color = (c: readonly [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);

/** A light flickering in steps (LightData's `flicker`), set for the time. */
export interface Flicker {
  readonly light: THREE.Light;
  readonly base: number;
  readonly steps: readonly number[];
  readonly rate: number;
  readonly phase: number;
}

export function stepFlicker(f: Flicker, time: number): void {
  f.light.intensity = f.base + f.steps[(Math.floor(time * f.rate) + f.phase) % f.steps.length]!;
}

/**
 * Adds a light to a scene. A point light's pool falls off to nothing at its reach (decay 1.4 unless it says); a spot
 * (daylight through a window) lays a bright patch where it points.
 */
export function addLight(scene: THREE.Scene, spec: LightSpec): { light: THREE.Light; flicker: Flicker | null } {
  switch (spec.kind) {
    case "hemisphere": {
      const light = new THREE.HemisphereLight(color(spec.sky), color(spec.ground), spec.intensity);
      scene.add(light);
      return { light, flicker: null };
    }
    case "directional": {
      const light = new THREE.DirectionalLight(color(spec.color), spec.intensity);
      light.position.set(...spec.from);
      scene.add(light);
      return { light, flicker: null };
    }
    case "point":
    case "spot":
      return addDataLight(scene, spec);
  }
}

function addDataLight(scene: THREE.Scene, spec: LightData): { light: THREE.Light; flicker: Flicker | null } {
  let light: THREE.PointLight | THREE.SpotLight;
  if (spec.kind === "spot") {
    const spot = new THREE.SpotLight(color(spec.color), spec.intensity, spec.reach, spec.angle ?? 0.36, spec.penumbra ?? 0.05, spec.decay ?? 1.2);
    spot.position.set(...spec.at);
    const to = spec.to ?? [spec.at[0], 0, spec.at[2]];
    spot.target.position.set(...to);
    spot.castShadow = spec.shadow ?? false;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.001;
    scene.add(spot, spot.target);
    light = spot;
  } else {
    light = new THREE.PointLight(color(spec.color), spec.intensity, spec.reach, spec.decay ?? 1.4);
    light.position.set(...spec.at);
    if (spec.shadow) light.castShadow = true;
    scene.add(light);
  }
  const f = spec.flicker;
  return { light, flicker: f ? { light, base: f.base, steps: f.steps, rate: f.rate, phase: f.phase ?? 0 } : null };
}
