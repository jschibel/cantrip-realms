import * as THREE from "three";
import { BODIES, type Body, CLOTH, Character, type ManaColor, SKIN_PALETTES } from "../character";
import { HEX_SIZE, spiral, toWorld } from "../hex";
import { type Character as CharacterData, ApiError, type RealmApi } from "../net/api";
import { celMaterial, lightOutdoors } from "../look";
import { DOMINARIA } from "../palette";
import { PixelRenderer } from "../render";

// Character creation (design.md, A1): a name, one of four bodies in one of six skin and hair palettes, and the one
// color you start in - which picks your home region and town. The mage you are making turns on a hex of grass beside
// the choices, drawn by the same pixel renderer as the world.

const COLORS: readonly { color: ManaColor; name: string; home: string }[] = [
  { color: "W", name: "White", home: "Capashen Hold, in Benalia" },
  { color: "U", name: "Blue", home: "the Tolarian Academy, on Walassa in Orvada" },
  { color: "B", name: "Black", home: "the Vess estate, in the Caligo Morass" },
  { color: "R", name: "Red", home: "Keld, on Icehaven" },
  { color: "G", name: "Green", home: "the elfhames of Llanowar" },
];

const BODY_NAMES: Record<Body, string> = { lithe: "Lithe", broad: "Broad", tall: "Tall", stocky: "Stocky" };

export function createCharacter(api: RealmApi): Promise<CharacterData> {
  const root = document.createElement("div");
  root.className = "create";
  root.dataset.test = "create";
  root.innerHTML = `
    <div class="create-card panel-card">
      <h1>A new mage</h1>
      <p class="lede">Dominaria's five color-wells are held by guardians. Earn each well's attunement.</p>
      <div class="create-body">
        <div class="create-preview"><canvas></canvas></div>
        <div class="create-choices">
          <label class="field">Name <input data-test="create:name" maxlength="20" autocomplete="off" spellcheck="false" /></label>
          <div class="field">Body <div class="choices" data-group="body"></div></div>
          <div class="field">Skin and hair <div class="choices swatches" data-group="palette"></div></div>
          <div class="field">Starting color <div class="choices" data-group="color"></div><div class="hint" data-hint="color"></div></div>
          <div class="problem" data-problem></div>
          <div class="buttons"><button class="primary" data-test="create:create">Begin</button></div>
        </div>
      </div>
    </div>`;
  document.querySelector("#screens")!.appendChild(root);

  let body: Body = "lithe";
  let palette = 0;
  let color: ManaColor = "W";
  const name = root.querySelector<HTMLInputElement>("input")!;
  const problem = root.querySelector<HTMLElement>("[data-problem]")!;

  // The preview: hexes of grass and the mage on them, turning.
  const canvas = root.querySelector<HTMLCanvasElement>(".create-preview canvas")!;
  const box = root.querySelector<HTMLElement>(".create-preview")!;
  const pixels = new PixelRenderer(canvas, DOMINARIA, () => ({ width: box.clientWidth || 220, height: box.clientHeight || 280 }));
  pixels.camera.zoom = 2;
  pixels.camera.updateProjectionMatrix();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1d2127");
  const prism = new THREE.CylinderGeometry(HEX_SIZE * 1.004, HEX_SIZE * 1.004, 0.5, 6, 1, false, Math.PI / 2);
  const grass = celMaterial({ color: "#43722c", outlined: false, ground: true });
  for (const h of spiral({ q: 0, r: 0 }, 1)) {
    const tile = new THREE.Mesh(prism, grass);
    const { x, z } = toWorld(h);
    tile.position.set(x, -0.25, z);
    tile.receiveShadow = true;
    scene.add(tile);
  }
  lightOutdoors(scene, 4);
  let mage = Character.player("You", { body, palette, identity: [color], slots: {} });
  scene.add(mage.root);
  const restyle = () => {
    scene.remove(mage.root);
    mage.dispose();
    mage = Character.player("You", { body, palette, identity: [color], slots: {} });
    scene.add(mage.root);
    root.querySelector<HTMLElement>("[data-hint=color]")!.textContent = `Your home is ${COLORS.find((c) => c.color === color)!.home}; every mage begins in New Benalia.`;
  };
  let running = true;
  const clock = new THREE.Clock();
  const spin = () => {
    if (!running) return;
    const seconds = Math.min(clock.getDelta(), 0.1);
    mage.root.rotation.y += seconds * 0.8;
    mage.animate(seconds, false);
    pixels.lookAt(new THREE.Vector3(0, 1.1, 0));
    pixels.render(scene);
    requestAnimationFrame(spin);
  };

  const group = <T,>(name: string, items: readonly T[], label: (t: T, el: HTMLButtonElement) => void, choose: (t: T) => void, test: (t: T) => string) => {
    const host = root.querySelector<HTMLElement>(`[data-group=${name}]`)!;
    items.forEach((item, i) => {
      const button = document.createElement("button");
      button.dataset.test = `create:${name}:${test(item)}`;
      label(item, button);
      if (i === 0) button.classList.add("chosen");
      button.addEventListener("click", () => {
        host.querySelectorAll("button").forEach((b) => b.classList.remove("chosen"));
        button.classList.add("chosen");
        choose(item);
        restyle();
      });
      host.appendChild(button);
    });
  };
  group("body", BODIES, (b, el) => (el.textContent = BODY_NAMES[b]), (b) => (body = b), (b) => b);
  group(
    "palette",
    SKIN_PALETTES.map((_, i) => i),
    (i, el) => {
      const p = SKIN_PALETTES[i]!;
      el.title = p.name;
      el.className = "swatch";
      el.style.background = `linear-gradient(135deg, ${p.skin} 55%, ${p.hair} 55%)`;
    },
    (i) => (palette = i),
    (i) => String(i),
  );
  group(
    "color",
    COLORS,
    (c, el) => {
      el.className = "color";
      el.innerHTML = `<span class="pip pip-${c.color.toLowerCase()}"></span>`;
      el.append(c.name);
      el.style.setProperty("--cloth", CLOTH[c.color].cloth);
    },
    (c) => (color = c.color),
    (c) => c.color,
  );
  // The first swatch of each group starts chosen; swatches lost their "chosen" class to className above.
  root.querySelector<HTMLElement>("[data-group=palette] button")!.classList.add("chosen");
  root.querySelector<HTMLElement>("[data-group=color] button")!.classList.add("chosen");
  restyle();
  spin();
  name.focus();

  return new Promise<CharacterData>((resolve) => {
    const begin = async () => {
      const chosen = name.value.trim();
      if (chosen.length < 2) {
        problem.textContent = "Your name needs at least two letters.";
        return;
      }
      problem.textContent = "";
      try {
        const made = await api.createCharacter({ Name: chosen, Body: body, Palette: palette, Color: color });
        running = false;
        root.remove();
        pixels.renderer.dispose();
        resolve(made);
      } catch (e) {
        problem.textContent = e instanceof ApiError ? e.detail : String(e);
      }
    };
    root.querySelector<HTMLButtonElement>("[data-test='create:create']")!.addEventListener("click", () => void begin());
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void begin();
    });
  });
}
