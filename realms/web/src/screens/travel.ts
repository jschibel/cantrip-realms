import { type Hex, distance, equals, findPath, hex, key, toWorld } from "../hex";
import type { GameMap } from "../maps/gameMap";
import type { MapKind, Terrain } from "../maps/schema";
import { terrainColor } from "../scene/world";

// The world map's travel screen, in the style of Fallout's (design.md, A6): Dominaria from above, drawn small and
// scaled up as pixel art, its places marked and named. Click a place and your marker crawls there along the roads or
// across country; every hex travelled off the hub may be interrupted by an encounter, more likely off the roads, which
// drops you onto a small map with the mob. A place that requires colors the character lacks (the Phyrexian Portal, until
// all five are unlocked) is drawn sealed and can't be entered; the server refuses it too.

export type EncounterMode = "roll" | "always" | "never";

export type TravelEnd =
  | { readonly kind: "arrive"; readonly map: string; readonly at: Hex }
  | { readonly kind: "encounter"; readonly map: string; readonly at: Hex };

export interface PlaceInfo {
  readonly id: string;
  readonly name: string;
  readonly kind: MapKind | null;
  /** The colors its map requires (schema.ts's `requires`), if any. */
  readonly requires?: string;
}

/** What a step costs, by terrain: roads are quick, swamps and hills slow. */
const COST: Partial<Record<Terrain, number>> = { road: 1, grass: 2, meadow: 2, sand: 2, ash: 2, dirt: 2, forest: 3, hills: 3, swamp: 3, mud: 3, rock: 3, moss: 2 };

/** Low-resolution pixels from a hex's centre to a corner. */
const HEX = 7;
const STEP_SECONDS = 0.14;

export class TravelScreen {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly labels: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly banner: HTMLElement;
  private readonly lowres = document.createElement("canvas");
  private scale = 1;
  private origin = { x: 0, y: 0 };
  private marker: Hex = hex(0, 0);
  private path: Hex[] = [];
  private hover: string | null = null;
  private done: ((end: TravelEnd) => void) | null = null;
  private timer = 0;
  private raf = 0;
  private last = 0;
  readonly places: { readonly id: string; readonly hex: Hex }[];

  constructor(
    private readonly world: GameMap,
    private readonly info: (id: string) => PlaceInfo,
    private readonly mode: EncounterMode,
    private readonly random: () => number = Math.random,
    /** The character's identity, as letters, for the places sealed to them. */
    private readonly identity: () => string = () => "WUBRG",
  ) {
    this.places = world.data.exits.map((e) => ({ id: e.to, hex: hex(e.q, e.r) }));
    this.root = document.createElement("div");
    this.root.className = "travel";
    this.root.dataset.test = "travel";
    this.root.hidden = true;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "travel-map";
    this.labels = document.createElement("div");
    this.labels.className = "travel-labels";
    const bar = document.createElement("div");
    bar.className = "travel-bar panel";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = "Dominaria";
    this.button = document.createElement("button");
    this.button.className = "primary";
    this.button.dataset.test = "travel:enter";
    this.button.addEventListener("click", () => this.enterHere());
    bar.append(title, this.button);
    this.banner = document.createElement("div");
    this.banner.className = "travel-banner panel";
    this.banner.hidden = true;
    this.root.append(this.canvas, this.labels, bar, this.banner);
    document.querySelector("#screens")!.appendChild(this.root);

    this.canvas.addEventListener("pointermove", (e) => {
      const place = this.placeAt(e.clientX, e.clientY);
      this.hover = place?.id ?? null;
      this.canvas.style.cursor = place ? "pointer" : "default";
      this.draw();
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const place = this.placeAt(e.clientX, e.clientY);
      if (place) this.travelTo(place.hex);
    });
    window.addEventListener("resize", () => this.layout());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get moving(): boolean {
    return this.path.length > 0;
  }

  get at(): Hex {
    return this.marker;
  }

  /** Shows the world map with the marker at `at`, and resolves when travel ends at a place or in an encounter. */
  open(at: Hex): Promise<TravelEnd> {
    this.marker = at;
    this.path = [];
    this.root.hidden = false;
    this.banner.hidden = true;
    this.layout();
    return new Promise((resolve) => (this.done = resolve));
  }

  close(): void {
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.done = null;
  }

  /** Where a hex is on the page, in CSS pixels. */
  screenOf(h: Hex): { x: number; y: number } {
    const [x, y] = this.project(h);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + x * this.scale, y: rect.top + y * this.scale };
  }

  /** Whether a place is sealed to the character: its map requires a color their identity lacks. */
  locked(id: string): boolean {
    const requires = this.info(id).requires ?? "";
    const identity = this.identity();
    return [...requires].some((color) => !identity.includes(color));
  }

  /** The place the marker stands on, if any. */
  get here(): { id: string; hex: Hex } | undefined {
    return this.places.find((p) => equals(p.hex, this.marker));
  }

  private project(h: Hex): [number, number] {
    const { x, z } = toWorld(h);
    return [this.origin.x + x * HEX, this.origin.y + z * HEX];
  }

  private placeAt(clientX: number, clientY: number): { id: string; hex: Hex } | undefined {
    let best: { id: string; hex: Hex } | undefined;
    let bestDistance = 14;
    for (const place of this.places) {
      const s = this.screenOf(place.hex);
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (d < bestDistance) {
        best = place;
        bestDistance = d;
      }
    }
    return best;
  }

  private layout(): void {
    const radius = this.world.data.radius;
    const width = Math.ceil((radius * 2 + 2) * 1.5 * HEX);
    const height = Math.ceil((radius * 2 + 2) * Math.sqrt(3) * HEX);
    this.lowres.width = width;
    this.lowres.height = height;
    this.origin = { x: width / 2, y: height / 2 };
    const available = { w: window.innerWidth - 32, h: window.innerHeight - 96 };
    this.scale = Math.max(1, Math.floor(Math.min(available.w / width, available.h / height) * 2) / 2);
    this.canvas.width = Math.round(width * this.scale);
    this.canvas.height = Math.round(height * this.scale);
    this.canvas.style.width = `${this.canvas.width}px`;
    this.canvas.style.height = `${this.canvas.height}px`;
    this.paintGround();
    this.draw();
  }

  /** The land, once: hexes by terrain, with forests, hills, mountains and waves drawn on, and the roads. */
  private paintGround(): void {
    const g = this.lowres.getContext("2d")!;
    g.fillStyle = "#12263a";
    g.fillRect(0, 0, this.lowres.width, this.lowres.height);
    const corner = (cx: number, cy: number, i: number, size: number) => [cx + size * Math.cos((Math.PI / 3) * i), cy + size * Math.sin((Math.PI / 3) * i)] as const;
    for (const tile of this.world.all) {
      const [cx, cy] = this.project(tile.hex);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const [x, y] = corner(cx, cy, i, HEX + 0.6);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillStyle = tile.terrain === "road" ? terrainColor("grass") : terrainColor(tile.terrain);
      g.fill();
    }
    // Glyphs: trees, hills, peaks, waves, reeds.
    for (const tile of this.world.all) {
      const [cx, cy] = this.project(tile.hex);
      const x = Math.round(cx);
      const y = Math.round(cy);
      switch (tile.terrain) {
        case "forest":
          g.fillStyle = "#1c2e1a";
          g.fillRect(x - 3, y - 1, 3, 3);
          g.fillRect(x + 1, y - 3, 3, 3);
          g.fillStyle = "#4f7a34";
          g.fillRect(x - 3, y - 2, 2, 1);
          g.fillRect(x + 1, y - 4, 2, 1);
          break;
        case "hills":
          g.fillStyle = "#8f6340";
          g.fillRect(x - 3, y, 6, 1);
          g.fillRect(x - 2, y - 1, 4, 1);
          break;
        case "mountain":
          g.fillStyle = "#4f5363";
          for (let i = 0; i < 4; i++) g.fillRect(x - 4 + i, y + 1 - i, 8 - i * 2, 1);
          g.fillStyle = "#f2efe6";
          g.fillRect(x - 1, y - 3, 2, 1);
          break;
        case "deep-water":
        case "water":
          if ((tile.hex.q + tile.hex.r * 3) % 4 === 0) {
            g.fillStyle = "#3f80a3";
            g.fillRect(x - 2, y, 2, 1);
            g.fillRect(x, y - 1, 2, 1);
          }
          break;
        case "swamp":
          g.fillStyle = "#2c3326";
          g.fillRect(x - 2, y, 4, 1);
          g.fillStyle = "#8fb350";
          g.fillRect(x + 1, y - 2, 1, 2);
          break;
        case "ash":
          g.fillStyle = "#c8432c";
          if ((tile.hex.q * 7 + tile.hex.r) % 5 === 0) g.fillRect(x, y, 1, 1);
          break;
        default:
          break;
      }
    }
    // Roads, joining neighbouring road hexes.
    g.strokeStyle = "#b5855a";
    g.lineWidth = 2;
    g.lineCap = "round";
    for (const tile of this.world.all) {
      if (tile.terrain !== "road") continue;
      const [ax, ay] = this.project(tile.hex);
      for (const d of [hex(1, 0), hex(0, 1), hex(1, -1)]) {
        const next = hex(tile.hex.q + d.q, tile.hex.r + d.r);
        const other = this.world.tile(next);
        if (other?.terrain !== "road" && !this.places.some((p) => equals(p.hex, next))) continue;
        const [bx, by] = this.project(next);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    }
  }

  private draw(): void {
    const g = this.canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.lowres, 0, 0, this.canvas.width, this.canvas.height);
    const s = this.scale;
    // The way ahead, dotted.
    g.fillStyle = "#f1b44c";
    for (const h of this.path) {
      const [x, y] = this.project(h);
      g.fillRect(Math.round(x * s) - 1, Math.round(y * s) - 1, 3, 3);
    }
    // Places.
    this.labels.replaceChildren();
    for (const place of this.places) {
      const [x, y] = this.project(place.hex);
      const info = this.info(place.id);
      const size = info.kind === "town" ? 6 : info.kind === "dungeon" ? 5 : 4;
      const hot = this.hover === place.id;
      const sealed = this.locked(place.id);
      g.fillStyle = "#0d0f14";
      g.fillRect(Math.round(x * s - size - 1), Math.round(y * s - size - 1), size * 2 + 2, size * 2 + 2);
      g.fillStyle = sealed ? (hot ? "#8c909c" : "#4f5363") : hot ? "#f1b44c" : info.kind === "dungeon" ? "#7a1f24" : info.kind === "town" ? "#f2efe6" : info.kind === "village" ? "#d6ae7e" : "#8fb350";
      g.fillRect(Math.round(x * s - size), Math.round(y * s - size), size * 2, size * 2);
      if (info.kind === "town" || info.kind === "village" || info.requires || hot) {
        const label = document.createElement("div");
        label.className = `travel-label${hot ? " hot" : ""}${info.kind === "town" ? " town" : ""}${sealed ? " sealed" : ""}`;
        label.textContent = sealed ? `${info.name} (sealed)` : info.name;
        label.style.left = `${Math.round(x * s)}px`;
        label.style.top = `${Math.round(y * s + size + 2)}px`;
        this.labels.appendChild(label);
      }
    }
    // The marker: you.
    const [mx, my] = this.project(this.marker);
    g.fillStyle = "#0d0f14";
    g.fillRect(Math.round(mx * s) - 5, Math.round(my * s) - 13, 10, 10);
    g.fillStyle = "#f1b44c";
    g.fillRect(Math.round(mx * s) - 4, Math.round(my * s) - 12, 8, 8);
    g.fillRect(Math.round(mx * s) - 1, Math.round(my * s) - 4, 2, 4);
    this.labels.style.width = `${this.canvas.width}px`;
    this.labels.style.height = `${this.canvas.height}px`;

    const here = this.here;
    this.button.hidden = !here || this.moving;
    if (here) this.button.textContent = this.locked(here.id) ? `${this.info(here.id).name} is sealed` : `Enter ${this.info(here.id).name}`;
  }

  private cost = (_from: Hex, to: Hex): number => {
    const tile = this.world.tile(to);
    return tile ? COST[tile.terrain] ?? 2 : 99;
  };

  private travelTo(goal: Hex): void {
    if (this.moving || !this.done) return;
    const path = findPath(this.marker, goal, this.world.passable, this.cost, 20000);
    if (!path || path.length === 0) {
      if (path) this.enterHere();
      return;
    }
    this.path = path;
    this.last = performance.now();
    this.timer = 0;
    const tick = (now: number) => {
      this.timer += Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      while (this.timer >= STEP_SECONDS && this.path.length > 0) {
        this.timer -= STEP_SECONDS;
        this.marker = this.path.shift()!;
        if (this.path.length > 0 && this.encounter()) return;
      }
      this.draw();
      if (this.path.length > 0) this.raf = requestAnimationFrame(tick);
      else this.enterHere();
    };
    this.raf = requestAnimationFrame(tick);
    this.draw();
  }

  /** Rolls for an encounter on the hex just reached; on one, stops and says so, and ends the travel into it. */
  private encounter(): boolean {
    if (this.mode === "never") return false;
    const tile = this.world.tile(this.marker);
    const zones = (this.world.data.encounters ?? []).filter((z) => distance(hex(z.q, z.r), this.marker) <= z.radius);
    zones.sort((a, b) => distance(hex(a.q, a.r), this.marker) - distance(hex(b.q, b.r), this.marker));
    const zone = zones[0];
    if (!zone) return false;
    const chance = tile?.terrain === "road" ? zone.chance / 3 : zone.chance;
    if (this.mode === "roll" && this.random() >= chance) return false;
    this.path = [];
    this.draw();
    this.banner.textContent = "Something blocks the way!";
    this.banner.hidden = false;
    const at = this.marker;
    setTimeout(() => this.finish({ kind: "encounter", map: zone.map, at }), 900);
    return true;
  }

  private enterHere(): void {
    const here = this.here;
    if (!here) return;
    if (this.locked(here.id)) {
      // Sealed: say so, and stay on the world map.
      this.banner.textContent = `${this.info(here.id).name} is sealed. It opens to a mage who has unlocked all of ${this.info(here.id).requires}.`;
      this.banner.hidden = false;
      this.draw();
      return;
    }
    this.finish({ kind: "arrive", map: here.id, at: here.hex });
  }

  private finish(end: TravelEnd): void {
    const done = this.done;
    this.close();
    done?.(end);
  }

  /** Every place's screen position, for the test hooks. */
  describe(): { id: string; name: string; kind: string | null; hex: string; locked: boolean; x: number; y: number }[] {
    return this.places.map((p) => ({ ...this.info(p.id), id: p.id, hex: key(p.hex), locked: this.locked(p.id), ...this.screenOf(p.hex) }));
  }

  /** What the banner says, when it shows: an encounter, or a sealed place. */
  get notice(): string | null {
    return this.banner.hidden ? null : this.banner.textContent;
  }
}
