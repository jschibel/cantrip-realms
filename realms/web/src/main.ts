import * as THREE from "three";
import "./style.css";
import "./theme.css";
import { CardLayer } from "./cardLayer";
import { Character } from "./character";
import { type Hex, distance, equals, findPath, key, neighbors, spiral } from "./hex";
import { meadow } from "./map";
import { DOMINARIA } from "./palette";
import { PixelRenderer } from "./render";
import { World } from "./world";

// The overworld page (tech.md, B5-B6), at its first milestone: one local map to walk by clicking, a mob that wanders
// and gives chase, a spell table, and the card layer that opens over the world for a duel or the table. Everything of
// value here is a stand-in until the realm server (milestone 5) owns it.

// Colors are given as the palette's own sRGB values and lit as they are; the post pass snaps the result to the
// palette, so no color management is wanted between them.
THREE.ColorManagement.enabled = false;

const query = new URLSearchParams(window.location.search);
const cardLayerUrl = query.get("cards") ?? import.meta.env.VITE_CARD_LAYER_URL ?? "http://localhost:5100/";

const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const pixels = new PixelRenderer(canvas, DOMINARIA);
const map = meadow();
const world = new World(map);
const layer = new CardLayer(cardLayerUrl);

/** Something that walks the map hex by hex: the player, a mob, later other players. */
class Walker {
  path: Hex[] = [];
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private t = 1;
  /** Called on reaching the end of a path. */
  arrived: () => void = () => {};

  constructor(
    readonly character: Character,
    public hex: Hex,
    public speed: number,
  ) {
    world.scene.add(character.root);
    this.place(hex);
  }

  place(h: Hex): void {
    this.hex = h;
    this.path = [];
    this.t = 1;
    this.character.root.position.copy(world.surface(h));
  }

  walk(path: Hex[], arrived: () => void = () => {}): void {
    this.path = path;
    this.arrived = arrived;
    if (this.t >= 1) {
      this.next();
    }
  }

  get moving(): boolean {
    return this.t < 1;
  }

  update(seconds: number): void {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + seconds * this.speed);
      this.character.root.position.lerpVectors(this.from, this.to, this.t);
      if (this.t >= 1) {
        this.next();
      }
    }
    this.character.animate(seconds, this.t < 1);
  }

  private next(): void {
    const step = this.path.shift();
    if (!step) {
      this.arrived();
      this.arrived = () => {};
      return;
    }
    this.from.copy(world.surface(this.hex));
    this.to.copy(world.surface(step));
    this.hex = step;
    this.t = 0;
    this.character.face(this.to.x, this.to.z);
  }
}

const player = new Walker(
  new Character("You", { skin: "#c08a62", hair: "#2e1f17", shirt: "#5b8fd6", trousers: "#4a3122", boots: "#2e1f17" }),
  map.start,
  3.4,
);

interface Mob {
  readonly walker: Walker;
  readonly name: string;
  readonly home: Hex;
  /** Seconds until it next picks somewhere to wander, or may engage again. */
  rest: number;
  defeated: boolean;
}

const mobHome: Hex = { q: 7, r: 3 };
const mobs: Mob[] = [
  {
    walker: new Walker(
      new Character("Phyrexian Scout", { skin: "#8c909c", hair: "#7a1f24", shirt: "#3b3c4a", trousers: "#2a2b36", boots: "#0d0f14", size: 1.15 }),
      mobHome,
      1.4,
    ),
    name: "Phyrexian Scout",
    home: mobHome,
    rest: 1,
    defeated: false,
  },
];

const CHASE_RANGE = 6;
let paused = false;
const log: string[] = [];

function say(text: string): void {
  log.push(text);
  if (log.length > 20) log.shift();
  hud();
}

/** The free hex next to `target` nearest the walker, or null when it is walled in. */
function besides(from: Hex, target: Hex): Hex | null {
  const free = neighbors(target).filter((h) => map.passable(h) || equals(h, from));
  free.sort((a, b) => distance(a, from) - distance(b, from));
  return free[0] ?? null;
}

const occupied = (except: Walker) => (h: Hex) =>
  map.passable(h) && ![player, ...mobs.filter((m) => !m.defeated).map((m) => m.walker)].some((w) => w !== except && equals(w.hex, h));

function goTo(target: Hex, prop: boolean): void {
  if (paused) return;
  const tile = map.tile(target);
  if (prop && tile?.prop === "spell-table") {
    const stand = besides(player.hex, target);
    const path = stand && findPath(player.hex, stand, occupied(player));
    if (path) {
      player.walk(path, () => void openSpellTable());
    }
    return;
  }
  const path = findPath(player.hex, target, occupied(player));
  if (path) {
    player.walk(path);
  } else {
    say("You can't get there.");
  }
}

async function openSpellTable(): Promise<void> {
  paused = true;
  say("You open your spellbook at the table.");
  const closed = await layer.open("spell-table", { name: "the spell table at the Benalish Meadow" });
  paused = false;
  say(closed.outcome === "closed" ? "You close your spellbook." : `The spell table closed (${closed.outcome}).`);
}

async function engage(mob: Mob): Promise<void> {
  paused = true;
  player.path = [];
  mob.walker.path = [];
  mob.walker.character.face(player.character.root.position.x, player.character.root.position.z);
  player.character.face(mob.walker.character.root.position.x, mob.walker.character.root.position.z);
  say(`The ${mob.name} attacks!`);

  const closed = await layer.open("duel", { name: `the ${mob.name}`, tier: 1 });
  if (closed.outcome === "won") {
    mob.defeated = true;
    world.scene.remove(mob.walker.character.root);
    say(`You defeated the ${mob.name}.`);
  } else {
    // A lost duel sends you back to the nearest inn (design.md, A3); here, where you started.
    player.place(map.start);
    mob.walker.place(mob.home);
    mob.rest = 5;
    say("You lost the duel, and wake at the inn.");
  }
  paused = false;
}

function thinkFor(mob: Mob, seconds: number): void {
  if (mob.defeated) return;
  mob.rest -= seconds;
  const near = distance(mob.walker.hex, player.hex);

  if (near <= 1 && mob.rest <= 0 && !player.moving) {
    void engage(mob);
    return;
  }

  if (near <= CHASE_RANGE && mob.rest <= 0) {
    // Chasing: a fresh path to beside the player twice a second, a little slower than the player walks.
    mob.walker.speed = 2.6;
    if (!mob.walker.moving || mob.walker.path.length === 0) {
      const stand = besides(mob.walker.hex, player.hex);
      const path = stand && findPath(mob.walker.hex, stand, occupied(mob.walker));
      if (path && path.length > 0) mob.walker.walk(path.slice(0, 1));
    }
    return;
  }

  // Wandering within a few hexes of home.
  mob.walker.speed = 1.4;
  if (!mob.walker.moving && mob.walker.path.length === 0 && mob.rest <= 0) {
    const choices = spiral(mob.home, 4).filter(occupied(mob.walker));
    const goal = choices[Math.floor(Math.random() * choices.length)];
    const path = goal && findPath(mob.walker.hex, goal, occupied(mob.walker));
    if (path) mob.walker.walk(path);
    mob.rest = 2 + Math.random() * 3;
  }
}

// Input: the hex under the pointer is marked; a click walks there, or to what was clicked.
canvas.addEventListener("pointermove", (e) => {
  const hit = paused ? null : world.pick(pixels.rayAt(e.clientX, e.clientY));
  world.mark(hit && (map.passable(hit.hex) || hit.prop) ? hit.hex : null);
});
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const hit = world.pick(pixels.rayAt(e.clientX, e.clientY));
  if (hit) goTo(hit.hex, hit.prop);
});
window.addEventListener("resize", () => pixels.resize());

// The HUD: who you are and the stats a duel starts from (design.md, A1), what just happened, and the card layer.
const hudCharacter = document.querySelector<HTMLElement>("#hud-character")!;
const hudMessage = document.querySelector<HTMLElement>("#hud-message")!;
const hudLayer = document.querySelector<HTMLElement>("#hud-layer")!;
function hud(): void {
  hudCharacter.innerHTML = `
    <div class="name"><span class="pip pip-w" title="White"></span>Wanderer</div>
    <div class="stats"><span title="Starting life">Life <b>20</b></span><span title="Starting hand size">Hand <b>7</b></span><span title="Maximum hand size">Max <b>7</b></span></div>
    <div class="gold"><b>2,000</b> gold</div>`;
  hudMessage.textContent = log.at(-1) ?? `${map.name}. Click to walk.`;
  const open = layer.openScreen;
  hudLayer.textContent = !layer.isReady ? "Cards: loading..." : open ? `Cards: ${open}` : "Cards: ready";
  hudLayer.dataset.state = !layer.isReady ? "loading" : open ? "open" : "ready";
}
layer.onChange = hud;
hud();

// Playwright's view of the page (?test): where everything is, by name, as the card table publishes cantripTest.
if (query.has("test")) {
  const screenOf = (h: Hex) => pixels.toScreen(world.surface(h));
  (globalThis as Record<string, unknown>).realmScreenOfHex = (q: number, r: number) => screenOf({ q, r });
  setInterval(() => {
    const entity = (name: string, kind: string, h: Hex, object: THREE.Object3D) => ({
      name,
      kind,
      hex: key(h),
      ...pixels.toScreen(object.position.clone().add(new THREE.Vector3(0, 0.7, 0))),
    });
    const table = [...map.all].find((t) => t.prop === "spell-table")!;
    (globalThis as Record<string, unknown>).realmTest = {
      map: map.name,
      paused,
      layer: { ready: layer.isReady, open: layer.openScreen },
      message: log.at(-1) ?? null,
      entities: [
        entity("You", "player", player.hex, player.character.root),
        ...mobs.filter((m) => !m.defeated).map((m) => entity(m.name, "mob", m.walker.hex, m.walker.character.root)),
        { name: "Spell table", kind: "spell-table", hex: key(table.hex), ...screenOf(table.hex) },
      ],
    };
  }, 100);
}

// The loop: the world stands still while a card screen is open over it.
const clock = new THREE.Clock();
function frame(): void {
  const seconds = Math.min(clock.getDelta(), 0.1);
  if (!paused) {
    player.update(seconds);
    for (const mob of mobs) {
      thinkFor(mob, seconds);
      mob.walker.update(seconds);
    }
  }
  pixels.lookAt(player.character.root.position);
  pixels.render(world.scene);
  requestAnimationFrame(frame);
}
frame();
