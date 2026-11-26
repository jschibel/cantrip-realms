import type { CardScreens } from "./cardLayer";
import type { ManaColor } from "./art/figures";
import { type Character as CharacterData, identityOf } from "./net/api";
import { type Colors, tierFor } from "./world/standing";
import { surfaceColor } from "./surfaceColors";
import { type BuildingData, type ChunkData, type DungeonData, type PlaceKind, type TownData, type WorldData, areaAt, groundsAt, travelRect } from "./world/format";
import { mobInfo } from "./mobs";
import { PLACE_LOOK, TownPicture, drawPlace, gatesOf } from "./townMap";

/** Each color's well on the maps: its boss's dungeon ringed in it (black's a violet, to show on the dark). */
const WELL_COLORS: Record<ManaColor, string> = { W: "#f4ecc2", U: "#5b8fd6", B: "#a06ad8", R: "#e0503a", G: "#4cc25a" };

// The HUD (tech.md, B5): who you are and the stats a duel starts from (design.md, A1), your identity's pips, your gold
// and your hearts (A3b), filled for those you have and empty for the rest you hold; the area you stand in and its tier; the regional map - the land round you with the
// tier zones tinted and bordered, the roads, the towns, the dungeons and mage towers with their tiers, attuned waystones
// lit and dormant ones grey - with its legend, opening to the whole world's map; in a town, the town's map instead
// (townMap.ts: its streets, buildings, wall and gates, and its places marked), opening to the whole town named place by
// place and gate by gate; a room's or a dungeon floor's own plan; the message line; what the pointer is over; and the
// card layer's state. DOM in the card client's colors and faces (theme.css), over the world canvas. Maps are drawn on
// the world's square tiles, north up.

const COLOR_NAMES: Record<ManaColor, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

/** The tiers' colors, 0 (none) to 4: the zones on the maps, the badges, the waymarkers' banners. */
export const TIER_COLORS: readonly string[] = ["#979cab", "#1fbf62", "#ffc94a", "#f58a3a", "#e02a3a"];

export const gold = (n: number): string => n.toLocaleString("en-US");

/** A heart, drawn: filled for one the character has, an outline for one they hold but have lost. */
export const heartSvg = (full: boolean): string =>
  `<svg class="heart ${full ? "full" : "empty"}" viewBox="0 0 16 15" aria-hidden="true"><path d="M8 14 1.6 7.6A3.9 3.9 0 0 1 8 2.9a3.9 3.9 0 0 1 6.4 4.7Z"/></svg>`;

/** A row of hearts as the HUD shows it: `have` filled, the rest of `hold` empty. */
export const heartsHtml = (have: number, hold: number, test = "hud:hearts"): string =>
  `<span class="hearts" title="${have} of ${hold} hearts: a lost duel costs one, a town fills them" data-test="${test}" data-hearts="${have}" data-max="${hold}">${Array.from({ length: hold }, (_, i) => heartSvg(i < have)).join("")}</span>`;

/** Someone or something on a map, at a tile. */
export interface MinimapDot {
  readonly x: number;
  readonly z: number;
  /** `heart`: a heartbloom in bloom, or a run's shrine not yet prayed at (design.md A3b, A6). */
  readonly kind: "player" | "mob" | "npc" | "chest" | "heart" | "exit" | "other";
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
 * with its border drawn solid, and the roads. `tiers` is the zone layer alone. In a world of two scales it is the travel
 * map alone (the towns' grounds are their own maps).
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
    const shown = travelRect(world);
    this.origin = [shown[0], shown[1]];
    const [wx, wz] = world.origin ?? [0, 0];
    const width = Math.ceil((shown[2] - shown[0]) * WorldPicture.SCALE);
    const height = Math.ceil((shown[3] - shown[1]) * WorldPicture.SCALE);
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
        // The tile, from the world's origin, where the overview starts.
        const tx = x / WorldPicture.SCALE + this.origin[0] - wx;
        const tz = y / WorldPicture.SCALE + this.origin[1] - wz;
        const letter = view.rows[Math.floor(tz / view.cell)]?.[Math.floor(tx / view.cell)];
        if (!letter) continue;
        const [r, g, b] = colors.get(letter) ?? [11, 12, 16];
        const o = (y * width + x) * 4;
        image.data[o] = r;
        image.data[o + 1] = g;
        image.data[o + 2] = b;
        image.data[o + 3] = 255;
        tierOf[y * width + x] = areaAt(world, tx + wx, tz + wz)?.tier ?? 0;
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
    // The roads between the places: a light line with dark edges, so it reads over any ground.
    for (const [color, grow] of [
      ["#3b2f22", 1],
      ["#ecd29a", 0],
    ] as const) {
      base.fillStyle = color;
      for (const road of world.roads) {
        for (const [x, z] of road.tiles) {
          const p = this.at(x, z);
          base.fillRect(Math.floor(p.x) - grow, Math.floor(p.y) - grow, 1 + grow * 2, 1 + grow * 2);
        }
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
  /** The world's chunks as loaded, for the buildings a town's map draws (the game sets it). */
  chunks: (() => Iterable<ChunkData | null>) | null = null;
  /** Each town's map as drawn, by town and scale, and how many of its buildings it drew. */
  private readonly townPictures = new Map<string, { picture: TownPicture; count: number }>();
  /** What the whole map shows: the world, or the town the player is in. */
  private view: "world" | "town" = "world";
  private readonly legend: HTMLElement;
  private attuned: readonly string[] = [];
  /** The character's identity, for the boss dungeons' rings on the maps. */
  private held: readonly ManaColor[] = [];
  /** The character's colors as a dungeon's standing reads them (world/standing.ts), for the tiers the map marks. */
  private colors: Colors = { Identity: "", Unlocked: [] };
  readonly log: string[] = [];
  /**
   * What the map shows now, for tests: the space, the tile it is centred on, the markers on it, and in a town the town
   * and its places in view.
   */
  mapState: { space: string; centre: { x: number; z: number } | null; markers: Marker[]; town: string | null; places: { kind: PlaceKind; name: string }[] } = {
    space: "",
    centre: null,
    markers: [],
    town: null,
    places: [],
  };

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
    this.legend = document.createElement("div");
    this.legend.className = "legend";
    this.legend.dataset.test = "hud:legend";
    document.querySelector("#hud-place")!.appendChild(this.legend);
    this.showLegend("world");
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
      <div class="money"><span class="gold" title="Gold"><b data-test="hud:gold">${gold(c.Gold)}</b> gold</span>${heartsHtml(c.Hearts, c.MaxHearts)}</div>`;
    this.character.querySelector<HTMLElement>("[data-test='hud:name']")!.textContent = c.Name;
  }

  /** Calls the eye to the hearts: filled again in a town, or one bought. */
  flashHearts(): void {
    const row = this.character.querySelector<HTMLElement>("[data-test='hud:hearts']");
    if (!row) return;
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
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
    this.mapState = { space, centre: { x: Math.floor(centre.x), z: Math.floor(centre.z) }, markers: [], town: null, places: [] };
  }

  /** The legend under the minimap: the tiers and the marks of the regional map, or the places of a town's. */
  private showLegend(which: "world" | "town", town?: TownData): void {
    const key = which === "town" ? `town:${town!.id}` : "world";
    if (this.legend.dataset.for === key) return;
    this.legend.dataset.for = key;
    if (which === "world") {
      this.legend.innerHTML =
        [1, 2, 3, 4].map((t) => `<span class="tier" data-tier="${t}"><i style="background:${TIER_COLORS[t]}"></i>${t}</span>`).join("") +
        `<span class="mark"><b class="diamond"></b>dungeon</span><span class="mark"><b class="ring"></b>boss</span><span class="mark"><b class="tri lit"></b>attuned</span><span class="mark"><b class="tri"></b>dormant</span>`;
      return;
    }
    this.legend.innerHTML = placeLegend(town!);
  }

  /**
   * The town a tile is in or at the gates of, if it has a plan to draw: in a world of two scales, the town whose grounds
   * hold it (on the travel map a town is an icon, and the map the regional one).
   */
  private townAt(x: number, z: number): TownData | null {
    const world = this.worldData;
    if (!world) return null;
    if (world.travel) {
      const town = groundsAt(world, x, z);
      return town?.plan ? town : null;
    }
    return world.towns.find((t) => t.plan && Math.max(Math.abs(x - t.center[0]), Math.abs(z - t.center[1])) <= t.radius + 6) ?? null;
  }

  /** Where the player is on the world's map: their tile, or in a town's grounds the town's icon. */
  private onWorldMap(at: { readonly x: number; readonly z: number }): { x: number; z: number } {
    const town = this.worldData ? groundsAt(this.worldData, at.x, at.z) : null;
    return town?.site ? { x: town.site[0], z: town.site[1] } : at;
  }

  /** A town's map at a scale, drawn again when more of its buildings have loaded since. */
  private townPicture(town: TownData, scale: number): TownPicture {
    const r = town.radius + 10;
    const buildings: BuildingData[] = [];
    for (const c of this.chunks?.() ?? []) for (const b of c?.buildings ?? []) if (Math.abs(b.x - town.center[0]) <= r && Math.abs(b.z - town.center[1]) <= r) buildings.push(b);
    const key = `${town.id}:${scale}`;
    const known = this.townPictures.get(key);
    if (known && known.count >= buildings.length) return known.picture;
    const picture = new TownPicture(town, scale, buildings, this.worldData!.roads);
    this.townPictures.set(key, { picture, count: buildings.length });
    return picture;
  }

  /** The dungeons and towers within a town's map, where they are on it. */
  private markersOn(picture: TownPicture): Marker[] {
    return this.markers(this.attuned)
      .filter((m) => m.kind !== "town")
      .flatMap((m) => {
        const d = this.dungeons.get(m.id);
        if (!d) return [];
        const [x, z] = d.entrance;
        if (x < picture.x0 || z < picture.z0 || x >= picture.x0 + picture.span || z >= picture.z0 + picture.span) return [];
        const p = picture.at(x, z);
        return [{ ...m, x: p.x, y: p.y }];
      });
  }

  /** The minimap in a town: its map round the player, two pixels a tile, its places marked, the people near. */
  private drawTownMap(g: CanvasRenderingContext2D, town: TownData, player: MinimapDot, dots: readonly MinimapDot[]): void {
    const size = this.minimap.width;
    const picture = this.townPicture(town, 2);
    const centre = picture.at(player.x - 0.5, player.z - 0.5);
    const left = Math.round(centre.x - size / 2);
    const top = Math.round(centre.y - size / 2);
    g.fillStyle = "#1d241b";
    g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = false;
    g.drawImage(picture.canvas, left, top, size, size, 0, 0, size, size);
    const shown: Marker[] = [];
    for (const m of this.markersOn(picture)) {
      this.drawMarker(g, m, m.x - left, m.y - top, 1);
      shown.push({ ...m, x: m.x - left, y: m.y - top });
    }
    const places: { kind: PlaceKind; name: string }[] = [];
    for (const p of town.plan!.places) {
      const at = picture.at(p.x, p.z);
      if (at.x - left < -4 || at.y - top < -4 || at.x - left > size + 4 || at.y - top > size + 4) continue;
      drawPlace(g, p.kind, at.x - left, at.y - top, 4);
      places.push({ kind: p.kind, name: p.name });
    }
    for (const d of this.ordered(dots)) {
      const at = picture.at(d.x - 0.5, d.z - 0.5);
      this.dot(g, at.x - left, at.y - top, d.kind);
    }
    this.mapState = { space: "world", centre: { x: Math.floor(player.x), z: Math.floor(player.z) }, markers: shown, town: town.id, places };
  }

  private ordered(dots: readonly MinimapDot[]): MinimapDot[] {
    return [...dots].sort((a, b) => (a.kind === "player" ? 1 : 0) - (b.kind === "player" ? 1 : 0));
  }

  private dot(g: CanvasRenderingContext2D, x: number, y: number, kind: MinimapDot["kind"]): void {
    const colors: Record<MinimapDot["kind"], string> = { player: "#f2f7f8", mob: "#e02a3a", npc: "#5296b5", chest: "#ffc94a", heart: "#ff8fc4", exit: "#ffc94a", other: "#8e82c8" };
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
  drawMap(seen: readonly MinimapDot[], attuned: readonly string[]): void {
    let dots = seen;
    this.attuned = attuned;
    const g = this.minimap.getContext("2d")!;
    const size = this.minimap.width;
    const player = dots.find((d) => d.kind === "player") ?? null;
    if (!player) return;
    const town = this.townAt(player.x, player.z);
    if (town) {
      this.showLegend("town", town);
      this.drawTownMap(g, town, player, dots);
      if (!this.fullMap.hidden) this.drawFullMap();
      return;
    }
    this.showLegend("world");
    const pic = this.world;
    // In a town's grounds with no plan to draw, the regional map round its icon, the player on it.
    const onMap = this.onWorldMap(player);
    if (onMap.x !== player.x || onMap.z !== player.z) dots = [{ ...player, x: onMap.x + 0.5, z: onMap.z + 0.5 }];
    const centre = pic.at(onMap.x, onMap.z);
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
    this.mapState = { space: "world", centre: { x: Math.floor(player.x), z: Math.floor(player.z) }, markers: shown, town: null, places: [] };
    if (!this.fullMap.hidden) this.drawFullMap();
  }

  private markers(attuned: readonly string[]): Marker[] {
    const pic = this.world;
    const found: Marker[] = [];
    for (const town of this.worldData!.towns) {
      const [tx, tz] = town.site ?? town.center;
      const p = pic.at(tx, tz);
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

  /**
   * The whole map, over everything: in a town the town's (its streets, buildings and wall, its places and gates named),
   * else the world's (its zones, roads, towns, dungeons and towers); a button turns from one to the other.
   */
  openMap(view?: "world" | "town"): void {
    if (!this.hasWorldMap) return;
    const at = this.mapState.space === "world" ? this.mapState.centre : null;
    const town = at ? this.townAt(at.x, at.z) : null;
    this.view = view ?? (town ? "town" : "world");
    if (!town) this.view = "world";
    this.fullMap.hidden = false;
    const inTown = this.view === "town" && town;
    const title = inTown ? town.name : "Dominaria";
    const hint = inTown ? "Its streets, gates and places: where each road leads, where to trade, rest and build your deck" : "The tier zones, the roads, the towns, the dungeons and the mage towers (lit: attuned)";
    const other = town ? `<button data-test="map:switch">${inTown ? "World map" : "Town map"}</button>` : "";
    this.fullMap.innerHTML = `<div class="panel-card"><div class="bar"><h2></h2><span class="hint">${hint}</span>${other}<button data-test="map:close">Close</button></div><div class="frame"><canvas data-test="map:canvas"></canvas><div class="labels"></div></div>${inTown ? `<div class="legend town" data-test="map:legend">${placeLegend(town)}</div>` : ""}</div>`;
    this.fullMap.querySelector("h2")!.textContent = title;
    this.fullMap.querySelector("[data-test='map:close']")!.addEventListener("click", () => {
      this.fullMap.hidden = true;
    });
    this.fullMap.querySelector("[data-test='map:switch']")?.addEventListener("click", () => this.openMap(inTown ? "world" : "town"));
    this.drawFullMap();
  }

  get mapOpen(): boolean {
    return !this.fullMap.hidden;
  }

  /** Which map the whole map shows. */
  get mapView(): "world" | "town" {
    return this.view;
  }

  /** The whole map of the town the player is in: as big as the window lets it, every place and gate named. */
  private drawTownFull(canvas: HTMLCanvasElement, town: TownData): void {
    const span = (town.radius + 10) * 2 + 1;
    const k = Math.max(3, Math.min(8, Math.floor(Math.min((window.innerWidth - 120) / span, (window.innerHeight - 200) / span))));
    const picture = this.townPicture(town, k);
    canvas.width = picture.canvas.width;
    canvas.height = picture.canvas.height;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(picture.canvas, 0, 0);
    const plan = town.plan!;
    const wanted: { text: string; x: number; y: number; r: number; className: string; test: string }[] = [];
    for (const m of this.markersOn(picture)) {
      this.drawMarker(g, m, m.x, m.y, 1.5);
      wanted.push({ text: m.name, x: m.x, y: m.y, r: 7, className: "map-label", test: `map:place:${m.id}` });
    }
    // Where each gate's road leads.
    const names = new Map<string, string>([...this.worldData!.towns.map((t) => [t.id, t.name] as const), ...[...this.dungeons.values()].map((d) => [d.id, d.name] as const)]);
    for (const f of this.worldData!.ferries) for (const end of ["from", "to"]) names.set(`ferry:${f.id}:${end}`, f.name);
    // In a town's grounds (a world of two scales), each way's gate - the gate of the plan nearest where it arrives - named
    // for where its road leads.
    const gates = gatesOf(plan);
    for (const way of town.ways ?? []) {
      if (!way.to) continue;
      const gate = gates.reduce<(typeof gates)[number] | null>((best, g) => (!best || Math.hypot(g.node[0] - way.inside[0], g.node[1] - way.inside[1]) < Math.hypot(best.node[0] - way.inside[0], best.node[1] - way.inside[1]) ? g : best), null);
      const [x, z] = gate?.node ?? way.inside;
      const p = picture.at(x, z);
      wanted.unshift({ text: `To ${names.get(way.to) ?? way.to}`, x: p.x, y: p.y, r: 4, className: "map-label gate", test: "map:gate" });
    }
    for (const gate of town.ways ? [] : gates) {
      const leads = this.worldData!.roads.flatMap((r) => {
        const first = r.tiles[0];
        const last = r.tiles[r.tiles.length - 1];
        if (first && first[0] === gate.node[0] && first[1] === gate.node[1]) return [r.to];
        if (last && last[0] === gate.node[0] && last[1] === gate.node[1]) return [r.from];
        return [];
      });
      if (leads.length === 0) continue;
      const p = picture.at(gate.node[0], gate.node[1]);
      wanted.unshift({ text: `To ${[...new Set(leads.map((id) => names.get(id) ?? id))].join(", ")}`, x: p.x, y: p.y, r: 4, className: "map-label gate", test: "map:gate" });
    }
    for (const p of plan.places) {
      const at = picture.at(p.x, p.z);
      drawPlace(g, p.kind, at.x, at.y, 7);
      wanted.push({ text: p.name, x: at.x, y: at.y, r: 8, className: "map-label place", test: `map:place:${p.kind}` });
    }
    // The names, each beside its mark where it covers no other name nor mark: below, above, right or left of it.
    const labels = this.fullMap.querySelector<HTMLElement>(".labels")!;
    const key = `${town.id}:${k}`;
    if (labels.dataset.for !== key) {
      labels.dataset.for = key;
      labels.innerHTML = "";
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = wanted.map((w) => ({ x0: w.x - w.r, y0: w.y - w.r, x1: w.x + w.r, y1: w.y + w.r }));
      const overlap = (a: (typeof placed)[number]) => placed.reduce((n, b) => n + Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)), 0);
      for (const w of wanted) {
        const el = document.createElement("span");
        el.className = `${w.className} placed`;
        el.textContent = w.text;
        el.dataset.test = w.test;
        labels.appendChild(el);
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const spots = [
          [w.x - width / 2, w.y + w.r + 1],
          [w.x - width / 2, w.y - w.r - 1 - height],
          [w.x + w.r + 2, w.y - height / 2],
          [w.x - w.r - 2 - width, w.y - height / 2],
        ].map(([x, y]) => ({ x0: x!, y0: y!, x1: x! + width, y1: y! + height }));
        const best = spots.reduce((p, q) => (overlap(q) < overlap(p) ? q : p));
        placed.push(best);
        el.style.left = `${Math.round(best.x0)}px`;
        el.style.top = `${Math.round(best.y0)}px`;
      }
    }
    const player = this.mapState.space === "world" ? this.mapState.centre : null;
    if (player) {
      const p = picture.at(player.x, player.z);
      g.fillStyle = "#0b0c10";
      g.fillRect(Math.round(p.x) - 6, Math.round(p.y) - 6, 12, 12);
      g.fillStyle = "#f2f7f8";
      g.fillRect(Math.round(p.x) - 5, Math.round(p.y) - 5, 10, 10);
    }
  }

  private drawFullMap(): void {
    const canvas = this.fullMap.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) return;
    if (this.view === "town") {
      const at = this.mapState.space === "world" ? this.mapState.centre : null;
      const town = at ? this.townAt(at.x, at.z) : null;
      if (town) return this.drawTownFull(canvas, town);
    }
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
    // The names over the land and the sea (a world's `labels`): the land's biggest, a region's, a feature's, a sea's in italics.
    for (const l of this.worldData!.labels ?? []) {
      const p = pic.at(l.x, l.z);
      const label = document.createElement("span");
      label.className = `map-label name ${l.kind}`;
      label.textContent = l.name;
      label.dataset.test = "map:label";
      label.style.left = `${Math.round((p.x - crop.x) * k)}px`;
      label.style.top = `${Math.round((p.y - crop.y) * k)}px`;
      labels.appendChild(label);
    }
    const seen = this.mapState.space === "world" ? this.mapState.centre : null;
    const player = seen ? this.onWorldMap(seen) : null;
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

/** The places a town has, as the legend lists them: each kind once, with its icon. */
function placeLegend(town: TownData): string {
  const kinds = [...new Set((town.plan?.places ?? []).map((p) => p.kind))];
  return kinds.map((k) => `<span class="mark"><b class="place" style="background:${PLACE_LOOK[k].color}">${PLACE_LOOK[k].glyph}</b>${PLACE_LOOK[k].label}</span>`).join("") + `<span class="mark"><b class="gate"></b>gate</span>`;
}
