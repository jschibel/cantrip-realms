import type { CardScreens } from "./cardLayer";
import type { ManaColor } from "./art/figures";
import { type Character as CharacterData, identityOf } from "./net/api";
import { type Colors, tierFor } from "./world/standing";
import { surfaceColor } from "./surfaceColors";
import { type DungeonData, type WorldData, areaAt } from "./world/format";
import { mobInfo } from "./mobs";

/** Each color's well on the maps: its boss's dungeon ringed in it (black's a violet, to show on the dark). */
const WELL_COLORS: Record<ManaColor, string> = { W: "#f4ecc2", U: "#5b8fd6", B: "#a06ad8", R: "#e0503a", G: "#4cc25a" };

// The HUD (tech.md, B5): who you are and the stats a duel starts from (design.md, A1), your identity's pips, your gold
// and the value of your ante (A2); the area you stand in and its tier; the regional map - the land round you with the
// tier zones tinted and bordered, the towns, the dungeons and mage towers with their tiers, attuned waystones lit and
// dormant ones grey - with its legend, opening to the whole world's map; a room's or a dungeon floor's own plan; the
// message line; what the pointer is over; and the card layer's state. DOM in the card client's colors and faces
// (theme.css), over the world canvas. Maps are drawn on the world's square tiles, north up.

const COLOR_NAMES: Record<ManaColor, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

/** The tiers' colors, 0 (none) to 4: the zones on the maps, the badges, the waymarkers' banners. */
export const TIER_COLORS: readonly string[] = ["#979cab", "#1fbf62", "#ffc94a", "#f58a3a", "#e02a3a"];

export const gold = (n: number): string => n.toLocaleString("en-US");

/** Someone or something on a map, at a tile. */
export interface MinimapDot {
  readonly x: number;
  readonly z: number;
  readonly kind: "player" | "mob" | "npc" | "chest" | "exit" | "other";
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

interface Marker {
  readonly id: string;
  readonly kind: "dungeon" | "tower" | "town";
  readonly tier: number;
  readonly lit?: boolean;
  /** A color's boss's dungeon (design.md A6): the color its boss unlocks, and whether the character holds it. */
  readonly well?: ManaColor;
  readonly won?: boolean;
  readonly x: number;
  readonly y: number;
  readonly name: string;
}

/**
 * The whole world drawn once, small, north up: the land from the world's overview, each tier's zone tinted in its color
 * with its border drawn solid, and the roads. `tiers` is the zone layer alone.
 */
class WorldPicture {
  /** Pixels a tile. */
  static readonly SCALE = 0.5;
  readonly base: HTMLCanvasElement;
  readonly tiers: HTMLCanvasElement;
  /** Pixels of each tier's zone drawn. */
  readonly drawn = [0, 0, 0, 0, 0];
  /** The land's bounds on the picture, with a margin of sea. */
  readonly land = { x: Infinity, y: Infinity, w: 0, h: 0 };
  private readonly origin: readonly [number, number];

  constructor(readonly world: WorldData) {
    this.origin = world.origin ?? [0, 0];
    const width = Math.ceil(world.size[0] * WorldPicture.SCALE);
    const height = Math.ceil(world.size[1] * WorldPicture.SCALE);
    this.base = document.createElement("canvas");
    this.tiers = document.createElement("canvas");
    for (const c of [this.base, this.tiers]) {
      c.width = width;
      c.height = height;
    }
    const view = world.overview;
    const colors = new Map<string, [number, number, number]>();
    for (const [letter, surface] of Object.entries(view.legend)) {
      colors.set(letter, rgb(surface === "town" ? "#bcbfc9" : surface === "woods" ? "#285a3a" : surfaceColor(surface)));
    }
    const sea = new Set(Object.entries(view.legend).filter(([, s]) => s === "sea").map(([l]) => l));
    const base = this.base.getContext("2d")!;
    const tiers = this.tiers.getContext("2d")!;
    const image = base.createImageData(width, height);
    const layer = tiers.createImageData(width, height);
    const tierOf = new Int8Array(width * height).fill(-1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tx = x / WorldPicture.SCALE;
        const tz = y / WorldPicture.SCALE;
        const letter = view.rows[Math.floor(tz / view.cell)]?.[Math.floor(tx / view.cell)];
        if (!letter) continue;
        const [r, g, b] = colors.get(letter) ?? [11, 12, 16];
        const o = (y * width + x) * 4;
        image.data[o] = r;
        image.data[o + 1] = g;
        image.data[o + 2] = b;
        image.data[o + 3] = 255;
        tierOf[y * width + x] = areaAt(world, tx + this.origin[0], tz + this.origin[1])?.tier ?? 0;
        if (!sea.has(letter)) {
          this.land.x = Math.min(this.land.x, x);
          this.land.y = Math.min(this.land.y, y);
          this.land.w = Math.max(this.land.w, x);
          this.land.h = Math.max(this.land.h, y);
        }
      }
    }
    const margin = 24;
    this.land.x = Math.max(0, this.land.x - margin);
    this.land.y = Math.max(0, this.land.y - margin);
    this.land.w = Math.min(width, this.land.w + margin) - this.land.x;
    this.land.h = Math.min(height, this.land.h + margin) - this.land.y;
    // The tier zones: a wash of each tier's color, and its border drawn solid.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tier = tierOf[y * width + x]!;
        if (tier <= 0) continue;
        const edge = [tierOf[y * width + x + 1], tierOf[(y + 1) * width + x], tierOf[y * width + x - 1], tierOf[(y - 1) * width + x]].some((t) => t !== undefined && t > 0 && t !== tier);
        const [r, g, b] = rgb(TIER_COLORS[tier]!);
        const o = (y * width + x) * 4;
        layer.data[o] = r;
        layer.data[o + 1] = g;
        layer.data[o + 2] = b;
        layer.data[o + 3] = edge ? 255 : 80;
        this.drawn[tier]!++;
      }
    }
    base.putImageData(image, 0, 0);
    tiers.putImageData(layer, 0, 0);
    base.drawImage(this.tiers, 0, 0);
    base.fillStyle = "#c08b55";
    for (const road of world.roads) {
      for (const [x, z] of road.tiles) {
        const p = this.at(x, z);
        base.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
      }
    }
  }

  /** Where a tile is on the picture. */
  at(x: number, z: number): { x: number; y: number } {
    return { x: (x - this.origin[0]) * WorldPicture.SCALE, y: (z - this.origin[1]) * WorldPicture.SCALE };
  }
}

export class Hud {
  private readonly character = document.querySelector<HTMLElement>("#hud-character")!;
  private readonly message = document.querySelector<HTMLElement>("#hud-message")!;
  private readonly layerPill = document.querySelector<HTMLElement>("#hud-layer")!;
  private readonly place = document.querySelector<HTMLElement>("#hud-place-name")!;
  private readonly minimap = document.querySelector<HTMLCanvasElement>("#hud-minimap")!;
  private readonly area: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly fullMap: HTMLElement;
  private picture: WorldPicture | null = null;
  private attuned: readonly string[] = [];
  /** The character's identity, for the boss dungeons' rings on the maps. */
  private held: readonly ManaColor[] = [];
  /** The character's colors as a dungeon's standing reads them (world/standing.ts), for the tiers the map marks. */
  private colors: Colors = { Identity: "", Unlocked: [] };
  readonly log: string[] = [];
  /** What the map shows now, for tests: the space, the tile it is centred on, the markers on it. */
  mapState: { space: string; centre: { x: number; z: number } | null; markers: Marker[] } = { space: "", centre: null, markers: [] };

  constructor(
    private readonly layer: CardScreens,
    /** The world the maps draw, and its dungeons; null draws the tiles round the player only. */
    private readonly worldData: WorldData | null = null,
    private readonly dungeons: ReadonlyMap<string, DungeonData> = new Map(),
  ) {
    document.querySelector("#hud")!.removeAttribute("hidden");
    this.area = document.createElement("div");
    this.area.id = "hud-area";
    this.area.className = "panel";
    this.area.dataset.test = "hud:area";
    document.querySelector("#hud")!.appendChild(this.area);
    const legend = document.createElement("div");
    legend.className = "legend";
    legend.dataset.test = "hud:legend";
    legend.innerHTML =
      [1, 2, 3, 4].map((t) => `<span class="tier" data-tier="${t}"><i style="background:${TIER_COLORS[t]}"></i>${t}</span>`).join("") +
      `<span class="mark"><b class="diamond"></b>dungeon</span><span class="mark"><b class="ring"></b>boss</span><span class="mark"><b class="tri lit"></b>attuned</span><span class="mark"><b class="tri"></b>dormant</span>`;
    document.querySelector("#hud-place")!.appendChild(legend);
    this.minimap.dataset.test = "hud:minimap";
    this.minimap.addEventListener("click", () => this.openMap());
    this.tooltip = document.createElement("div");
    this.tooltip.id = "hud-tooltip";
    this.tooltip.dataset.test = "hud:tooltip";
    this.tooltip.hidden = true;
    document.body.appendChild(this.tooltip);
    this.fullMap = document.createElement("div");
    this.fullMap.className = "world-map";
    this.fullMap.dataset.test = "map";
    this.fullMap.hidden = true;
    document.querySelector("#screens")!.appendChild(this.fullMap);
  }

  say(text: string): void {
    this.log.push(text);
    if (this.log.length > 30) this.log.shift();
    this.message.textContent = text;
  }

  get lastMessage(): string | null {
    return this.log.at(-1) ?? null;
  }

  showCharacter(c: CharacterData): void {
    // All five colors: the identity's filled, the rest a faint ring each until a boss unlocks it (design.md A1, A6).
    const held = identityOf(c);
    this.held = held;
    this.colors = { Identity: c.Identity, Unlocked: c.Unlocked ?? [] };
    const pips = (["W", "U", "B", "R", "G"] as const)
      .map((color) => held.includes(color)
        ? `<span class="pip pip-${color.toLowerCase()}" title="${COLOR_NAMES[color]}" data-test="hud:pip-${color.toLowerCase()}" data-state="held"></span>`
        : `<span class="pip pip-${color.toLowerCase()} locked" title="${COLOR_NAMES[color]} (locked: beat its boss)" data-test="hud:pip-${color.toLowerCase()}" data-state="locked"></span>`)
      .join("");
    this.character.innerHTML = `
      <div class="name"><span class="pips">${pips}</span><span data-test="hud:name"></span></div>
      <div class="stats"><span title="Starting life">Life <b>${c.Stats.Life}</b></span><span title="Starting hand size">Hand <b>${c.Stats.Hand}</b></span><span title="Maximum hand size">Max <b>${c.Stats.MaxHand}</b></span></div>
      <div class="money"><span class="gold" title="Gold"><b data-test="hud:gold">${gold(c.Gold)}</b> gold</span><span class="ante" title="The value of your ante">Ante <b data-test="hud:ante">${gold(c.AnteValue)}</b></span></div>`;
    this.character.querySelector<HTMLElement>("[data-test='hud:name']")!.textContent = c.Name;
  }

  /** Calls the eye to a pip: a color just unlocked. */
  flashPip(color: ManaColor): void {
    const pip = this.character.querySelector<HTMLElement>(`[data-test='hud:pip-${color.toLowerCase()}']`);
    if (!pip) return;
    pip.classList.remove("flash");
    void pip.offsetWidth;
    pip.classList.add("flash");
  }

  showLayer(): void {
    const open = this.layer.openScreen;
    this.layerPill.textContent = !this.layer.isReady ? "Cards: loading..." : open ? `Cards: ${open}` : "Cards: ready";
    this.layerPill.dataset.state = !this.layer.isReady ? "loading" : open ? "open" : "ready";
  }

  /** The area the player stands in and its tier (0: a town or a room, no tier). */
  showArea(name: string, tier: number): void {
    this.area.innerHTML = `<span class="name"></span><span class="tier" data-tier="${tier}">${tier > 0 ? `Tier ${tier}` : "Safe"}</span>`;
    this.area.querySelector<HTMLElement>(".name")!.textContent = name;
    const badge = this.area.querySelector<HTMLElement>(".tier")!;
    if (tier > 0) badge.style.background = TIER_COLORS[tier]!;
    this.area.dataset.tier = String(tier);
    this.area.dataset.name = name;
  }

  /** Calls the eye to the area panel: crossing into harder wilds. */
  flashArea(): void {
    this.area.classList.remove("flash");
    void this.area.offsetWidth;
    this.area.classList.add("flash");
  }

  /** What the pointer is over, beside it; null hides it. */
  showTooltip(text: string | null, x = 0, y = 0): void {
    this.tooltip.hidden = text === null;
    if (text === null) return;
    this.tooltip.textContent = text;
    this.tooltip.style.left = `${Math.round(x + 16)}px`;
    this.tooltip.style.top = `${Math.round(y + 12)}px`;
  }

  get tooltipText(): string | null {
    return this.tooltip.hidden ? null : this.tooltip.textContent;
  }

  /** The name over the minimap: the world's, or the room's. */
  showPlace(name: string): void {
    this.place.textContent = name;
  }

  /**
   * The minimap of a room or a dungeon's floor (or a world with no overview): the tiles round `centre`, a few pixels
   * each, in `colorAt`'s colors (null: nothing there), and the people near as dots.
   */
  drawSquares(space: string, colorAt: (x: number, z: number) => string | null, centre: { readonly x: number; readonly z: number }, dots: readonly MinimapDot[]): void {
    const g = this.minimap.getContext("2d");
    if (!g) return;
    const size = this.minimap.width;
    const px = 4;
    const half = Math.floor(size / px / 2);
    g.fillStyle = "#0b0c10";
    g.fillRect(0, 0, size, size);
    for (let j = -half; j < half; j++) {
      for (let i = -half; i < half; i++) {
        const c = colorAt(Math.floor(centre.x) + i, Math.floor(centre.z) + j);
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect((i + half) * px, (j + half) * px, px, px);
      }
    }
    for (const d of this.ordered(dots)) this.dot(g, (Math.floor(d.x) - Math.floor(centre.x) + half) * px + px / 2, (Math.floor(d.z) - Math.floor(centre.z) + half) * px + px / 2, d.kind);
    this.mapState = { space, centre: { x: Math.floor(centre.x), z: Math.floor(centre.z) }, markers: [] };
  }

  private ordered(dots: readonly MinimapDot[]): MinimapDot[] {
    return [...dots].sort((a, b) => (a.kind === "player" ? 1 : 0) - (b.kind === "player" ? 1 : 0));
  }

  private dot(g: CanvasRenderingContext2D, x: number, y: number, kind: MinimapDot["kind"]): void {
    const colors: Record<MinimapDot["kind"], string> = { player: "#f2f7f8", mob: "#e02a3a", npc: "#5296b5", chest: "#ffc94a", exit: "#ffc94a", other: "#8e82c8" };
    const r = kind === "player" ? 3 : 2;
    g.fillStyle = "#0b0c10";
    g.fillRect(Math.round(x) - r - 1, Math.round(y) - r - 1, r * 2 + 2, r * 2 + 2);
    g.fillStyle = colors[kind];
    g.fillRect(Math.round(x) - r, Math.round(y) - r, r * 2, r * 2);
  }

  /** Whether there is a world map to draw (a world with an overview). */
  get hasWorldMap(): boolean {
    return !!this.worldData?.overview?.rows?.length;
  }

  private get world(): WorldPicture {
    this.picture ??= new WorldPicture(this.worldData!);
    return this.picture;
  }

  /** The regional map round the player in the world, with the people near them. */
  drawMap(dots: readonly MinimapDot[], attuned: readonly string[]): void {
    this.attuned = attuned;
    const g = this.minimap.getContext("2d")!;
    const size = this.minimap.width;
    const player = dots.find((d) => d.kind === "player") ?? null;
    if (!player) return;
    const pic = this.world;
    const centre = pic.at(player.x, player.z);
    const left = Math.round(centre.x - size / 2);
    const top = Math.round(centre.y - size / 2);
    g.fillStyle = "#22557c";
    g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = false;
    g.drawImage(pic.base, left, top, size, size, 0, 0, size, size);
    const shown: Marker[] = [];
    for (const m of this.markers(attuned)) {
      const x = m.x - left;
      const y = m.y - top;
      if (x < -6 || y < -6 || x > size + 6 || y > size + 6) continue;
      this.drawMarker(g, m, x, y, 1);
      shown.push({ ...m, x, y });
    }
    for (const d of this.ordered(dots)) {
      const p = pic.at(d.x, d.z);
      this.dot(g, p.x - left, p.y - top, d.kind);
    }
    this.mapState = { space: "world", centre: { x: Math.floor(player.x), z: Math.floor(player.z) }, markers: shown };
    if (!this.fullMap.hidden) this.drawFullMap();
  }

  private markers(attuned: readonly string[]): Marker[] {
    const pic = this.world;
    const found: Marker[] = [];
    for (const town of this.worldData!.towns) {
      const p = pic.at(town.center[0], town.center[1]);
      found.push({ id: town.id, kind: "town", tier: 0, x: p.x, y: p.y, name: town.name });
    }
    for (const d of this.dungeons.values()) {
      const p = pic.at(d.entrance[0], d.entrance[1]);
      const well = mobInfo(d.boss).unlocks;
      found.push({ id: d.id, kind: d.waystone ? "tower" : "dungeon", tier: tierFor(d, this.colors), ...(d.waystone ? { lit: attuned.includes(d.id) } : {}), ...(well ? { well, won: this.held.includes(well) } : {}), x: p.x, y: p.y, name: d.name });
    }
    return found;
  }

  private drawMarker(g: CanvasRenderingContext2D, m: Pick<Marker, "kind" | "tier" | "lit" | "well" | "won">, x: number, y: number, k: number): void {
    const s = 3 * k;
    // A color's boss: its dungeon ringed in the well's color, the ring filled in once the color is held.
    if (m.well) {
      g.beginPath();
      g.arc(x, y, s + 3 * k, 0, Math.PI * 2);
      g.lineWidth = 2 * k;
      g.strokeStyle = "#0b0c10";
      g.stroke();
      g.lineWidth = (m.won ? 2 : 1) * k;
      g.strokeStyle = WELL_COLORS[m.well];
      g.globalAlpha = m.won ? 1 : 0.75;
      g.stroke();
      g.globalAlpha = 1;
    }
    // An attuned waystone glows.
    if (m.kind === "tower" && m.lit) {
      g.fillStyle = "#7fe7ff44";
      g.beginPath();
      g.arc(x, y + 1, s + 3 * k, 0, Math.PI * 2);
      g.fill();
    }
    g.lineWidth = 1;
    g.strokeStyle = "#0b0c10";
    if (m.kind === "town") {
      g.fillStyle = "#e0e0e3";
      g.fillRect(Math.round(x - s), Math.round(y - s), s * 2, s * 2);
      g.strokeRect(Math.round(x - s) + 0.5, Math.round(y - s) + 0.5, s * 2, s * 2);
      return;
    }
    g.beginPath();
    if (m.kind === "dungeon") {
      g.moveTo(x, y - s - 1);
      g.lineTo(x + s + 1, y);
      g.lineTo(x, y + s + 1);
      g.lineTo(x - s - 1, y);
      g.fillStyle = TIER_COLORS[m.tier]!;
    } else {
      g.moveTo(x, y - s - 2);
      g.lineTo(x + s + 1, y + s);
      g.lineTo(x - s - 1, y + s);
      g.fillStyle = m.lit ? "#7fe7ff" : "#575c6e";
    }
    g.closePath();
    g.fill();
    g.stroke();
    // Its tier, beside it.
    g.font = `bold ${Math.round(8 * k)}px sans-serif`;
    g.fillStyle = "#0b0c10";
    g.fillText(String(m.tier), x + s + 2, y + s + 3);
    g.fillStyle = TIER_COLORS[m.tier]!;
    g.fillText(String(m.tier), x + s + 1, y + s + 2);
  }

  /** The whole world's map, over everything: its zones, places and the player. */
  openMap(): void {
    if (!this.hasWorldMap) return;
    this.fullMap.hidden = false;
    this.fullMap.innerHTML = `<div class="panel-card"><div class="bar"><h2>Dominaria</h2><span class="hint">The tier zones, the towns, the dungeons and the mage towers (lit: attuned)</span><button data-test="map:close">Close</button></div><div class="frame"><canvas data-test="map:canvas"></canvas><div class="labels"></div></div></div>`;
    this.fullMap.querySelector("[data-test='map:close']")!.addEventListener("click", () => {
      this.fullMap.hidden = true;
    });
    this.drawFullMap();
  }

  get mapOpen(): boolean {
    return !this.fullMap.hidden;
  }

  private drawFullMap(): void {
    const canvas = this.fullMap.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) return;
    const pic = this.world;
    const crop = pic.land;
    const k = Math.min((window.innerWidth - 120) / crop.w, (window.innerHeight - 170) / crop.h);
    canvas.width = Math.round(crop.w * k);
    canvas.height = Math.round(crop.h * k);
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#22557c";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(pic.base, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    const labels = this.fullMap.querySelector<HTMLElement>(".labels")!;
    labels.innerHTML = "";
    for (const m of this.markers(this.attuned)) {
      const x = (m.x - crop.x) * k;
      const y = (m.y - crop.y) * k;
      this.drawMarker(g, m, x, y, 1.5);
      if (m.kind === "town" || m.well) {
        const label = document.createElement("span");
        label.className = m.well ? "map-label well" : "map-label";
        label.textContent = m.well ? mobInfo(this.dungeons.get(m.id)!.boss).name.split(",")[0]! : m.name;
        if (m.well) label.style.color = WELL_COLORS[m.well];
        label.style.left = `${Math.round(x)}px`;
        label.style.top = `${Math.round(y + 8)}px`;
        labels.appendChild(label);
      }
    }
    const player = this.mapState.space === "world" ? this.mapState.centre : null;
    if (player) {
      const p = pic.at(player.x, player.z);
      const x = Math.round((p.x - crop.x) * k);
      const y = Math.round((p.y - crop.y) * k);
      g.fillStyle = "#0b0c10";
      g.fillRect(x - 5, y - 5, 10, 10);
      g.fillStyle = "#f2f7f8";
      g.fillRect(x - 4, y - 4, 8, 8);
    }
  }

  /** For tests: how many pixels of each tier's zone the map draws, and which tier's zone the map shows at a tile. */
  zones(): { drawn: number[]; tierAt: (x: number, z: number) => number } {
    const pic = this.world;
    const g = pic.tiers.getContext("2d")!;
    return {
      drawn: [...pic.drawn],
      tierAt: (x: number, z: number) => {
        const p = pic.at(x, z);
        const [red, green, blue, alpha] = g.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
        if (!alpha) return 0;
        // A canvas keeps its colors premultiplied, so a translucent one reads back near itself, not exactly.
        let best = 0;
        let gap = 40;
        TIER_COLORS.forEach((c, t) => {
          const [cr, cg, cb] = rgb(c);
          const d = Math.abs(cr - red!) + Math.abs(cg - green!) + Math.abs(cb - blue!);
          if (t > 0 && d < gap) {
            gap = d;
            best = t;
          }
        });
        return best;
      },
    };
  }
}
