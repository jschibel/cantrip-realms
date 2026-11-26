import type { CardScreens } from "./cardLayer";
import type { ManaColor } from "./art/figures";
import { type Character as CharacterData, identityOf } from "./net/api";
import { type Colors, tierFor } from "./world/standing";
import { type BuildingData, type ChunkData, type DungeonData, type PlaceKind, type TownData, type WorldData, groundsAt } from "./world/format";
import { MapArt } from "./mapArt";
import { mobInfo } from "./mobs";
import { PLACE_LOOK, TownPicture, drawPlace, gatesOf } from "./townMap";
import { type MapMark, TIER_COLORS, WorldMapView, drawMark, drawPlayer } from "./worldMap";

// The HUD (tech.md, B5): who you are and the stats a duel starts from (design.md, A1), your identity's pips, your gold
// and your hearts (A3b), filled for those you have and empty for the rest you hold; the area you stand in and its tier; the regional map - the land round you as the
// world's map draws it (mapArt.ts: the land, its relief, woods and peaks, the roads, the tier zones bordered), the
// towns, the dungeons and mage towers with their tiers, attuned waystones lit and dormant ones grey, and you - with its
// legend, opening to the whole world's map (worldMap.ts); in a town, the town's map instead
// (townMap.ts: its streets, buildings, wall and gates, and its places marked), opening to the whole town named place by
// place and gate by gate; a room's or a dungeon floor's own plan; the message line; what the pointer is over; and the
// card layer's state. DOM in the card client's colors and faces (theme.css), over the world canvas. Maps are drawn on
// the world's square tiles, north up.

const COLOR_NAMES: Record<ManaColor, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

export { TIER_COLORS };

/** The regional map's scale on the travel map: pixels a tile. */
const MINIMAP_SCALE = 3;

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

export class Hud {
  private readonly character = document.querySelector<HTMLElement>("#hud-character")!;
  private readonly message = document.querySelector<HTMLElement>("#hud-message")!;
  private readonly layerPill = document.querySelector<HTMLElement>("#hud-layer")!;
  private readonly place = document.querySelector<HTMLElement>("#hud-place-name")!;
  private readonly minimap = document.querySelector<HTMLCanvasElement>("#hud-minimap")!;
  private readonly area: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly fullMap: HTMLElement;
  private mapArt: MapArt | null = null;
  /** The whole world's map, while it is open on the world. */
  private worldView: WorldMapView | null = null;
  /** The character's home inn, for its town's mark. */
  private inn: string | null = null;
  /** Where the player was last on the travel map, and the way they last went (radians, x east, z south). */
  private lastSeen: { x: number; z: number; heading: number | null } | null = null;
  /** Other players seen near on the travel map. */
  private othersSeen: { x: number; z: number }[] = [];
  /** The world map's marks as last worked out (attuned towers and held colors change them). */
  private markList: MapMark[] | null = null;
  private markKey = "";
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
    // A click on the dark round the map closes it.
    this.fullMap.addEventListener("click", (e) => {
      if (e.target === this.fullMap) this.closeMap();
    });
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
    this.inn = c.Inn ?? null;
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
      // The marks as the map draws them.
      const mark = (name: string, text: string) => `<span class="mark"><canvas width="16" height="16" data-mark="${name}"></canvas>${text}</span>`;
      this.legend.innerHTML =
        [1, 2, 3, 4].map((t) => `<span class="tier" data-tier="${t}"><i style="background:${TIER_COLORS[t]}"></i>${t}</span>`).join("") +
        mark("dungeon", "dungeon") + mark("well", "boss") + mark("lit", "attuned") + mark("tower", "dormant");
      for (const c of this.legend.querySelectorAll<HTMLCanvasElement>("canvas[data-mark]")) {
        const g = c.getContext("2d")!;
        const k = c.dataset.mark;
        if (k === "dungeon") drawMark(g, { kind: "dungeon", tier: 0 }, 8, 8, 1);
        else if (k === "well") drawMark(g, { kind: "dungeon", tier: 0, well: "G", won: false }, 8, 8, 0.9);
        else drawMark(g, { kind: "tower", tier: 0, lit: k === "lit" }, 8, 9, 1);
      }
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
  private markersOn(picture: TownPicture): (MapMark & { px: number; py: number })[] {
    return this.marks()
      .filter((m) => m.kind === "dungeon" || m.kind === "tower" || m.kind === "portal")
      .flatMap((m) => {
        if (m.x < picture.x0 || m.z < picture.z0 || m.x >= picture.x0 + picture.span || m.z >= picture.z0 + picture.span) return [];
        const p = picture.at(m.x, m.z);
        return [{ ...m, px: p.x, py: p.y }];
      });
  }

  /** A mark as the tests read the map's markers: its id, kind, tier and state, where it is on the map. */
  private marker(m: MapMark, x: number, y: number): Marker {
    const kind = m.kind === "portal" ? "dungeon" : (m.kind as Marker["kind"]);
    return { id: m.id, kind, tier: m.tier, ...(m.lit !== undefined ? { lit: m.lit } : {}), ...(m.well ? { well: m.well, won: m.won ?? false } : {}), x, y, name: m.name };
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
      drawMark(g, m, m.px - left, m.py - top, 1);
      shown.push(this.marker(m, m.px - left, m.py - top));
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
    const colors: Record<MinimapDot["kind"], string> = { player: "#f2f7f8", mob: "#e02a3a", npc: "#5296b5", chest: "#ffc94a", heart: "#ff8fc4", exit: "#ffc94a", other: "#b9a8ff" };
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

  /** The travel map as an atlas, made the first time a map needs it. */
  private get art(): MapArt {
    this.mapArt ??= new MapArt(this.worldData!);
    return this.mapArt;
  }

  /** The regional map round the player in the world, with the people near them. */
  drawMap(seen: readonly MinimapDot[], attuned: readonly string[]): void {
    this.attuned = attuned;
    const g = this.minimap.getContext("2d")!;
    const size = this.minimap.width;
    const player = seen.find((d) => d.kind === "player") ?? null;
    if (!player) return;
    const town = this.townAt(player.x, player.z);
    // Where the player is on the travel map (in a town's grounds, at its icon), and the way they go.
    const onMap = this.onWorldMap(player);
    const inGrounds = onMap.x !== player.x || onMap.z !== player.z;
    const at = inGrounds ? { x: onMap.x + 0.5, z: onMap.z + 0.5 } : { x: player.x, z: player.z };
    const last = this.lastSeen;
    const moved = last ? Math.hypot(at.x - last.x, at.z - last.z) : 0;
    this.lastSeen = { ...at, heading: moved > 0.05 && moved < 8 ? Math.atan2(at.z - last!.z, at.x - last!.x) : moved >= 8 ? null : (last?.heading ?? null) };
    this.othersSeen = inGrounds ? [] : seen.filter((d) => d.kind === "other").map((d) => ({ x: d.x, z: d.z }));
    if (town) {
      this.showLegend("town", town);
      this.drawTownMap(g, town, player, seen);
      if (!this.fullMap.hidden && this.view === "town") this.drawFullMap();
      return;
    }
    this.showLegend("world");
    const art = this.art;
    const k = MINIMAP_SCALE;
    const left = Math.round((at.x - art.x0) * k - size / 2);
    const top = Math.round((at.z - art.z0) * k - size / 2);
    art.draw(g, k, false, left, top, size, size);
    const shown: Marker[] = [];
    for (const kind of ["dock", "landmark", "town", "dungeon", "tower", "portal"] as const)
      for (const m of this.marks()) {
        if (m.kind !== kind) continue;
        const x = (m.x + 0.5 - art.x0) * k - left;
        const y = (m.z + 0.5 - art.z0) * k - top;
        if (x < -8 || y < -8 || x > size + 8 || y > size + 8) continue;
        drawMark(g, m, x, y, 1);
        if (m.kind === "town" || m.kind === "dungeon" || m.kind === "tower" || m.kind === "portal") shown.push(this.marker(m, x, y));
      }
    for (const d of this.ordered(inGrounds ? [] : seen)) {
      if (d.kind === "player") continue;
      this.dot(g, (d.x - art.x0) * k - left, (d.z - art.z0) * k - top, d.kind);
    }
    drawPlayer(g, (at.x - art.x0) * k - left, (at.z - art.z0) * k - top, this.lastSeen.heading, 0.5, 0.8);
    this.mapState = { space: "world", centre: { x: Math.floor(player.x), z: Math.floor(player.z) }, markers: shown, town: null, places: [] };
  }

  /** Everything the world's map marks: the towns, the dungeons and towers, the Portal, the wonders and the ferries' docks. */
  private marks(): MapMark[] {
    const key = `${this.attuned.join(",")}|${this.held.join("")}|${this.colors.Identity}|${this.colors.Unlocked.join("")}|${this.inn}`;
    if (this.markList && this.markKey === key) return this.markList;
    const world = this.worldData!;
    const out: MapMark[] = [];
    const home = this.inn ? world.inns.find((i) => i.id === this.inn)?.town : undefined;
    for (const t of world.towns) {
      const [x, z] = t.site ?? t.center;
      const what = t.kind === "capital" ? "the capital" : t.home ? `the home town of ${COLOR_NAMES[t.home]}` : t.kind === "town" ? "a town" : "a village";
      out.push({ id: t.id, kind: "town", x, z, name: t.name, tier: 0, size: t.kind, ...(t.home ? { color: t.home } : {}), ...(t.id === home ? { home: true } : {}), about: `${t.name} - ${what}${t.id === home ? ", your inn" : ""}` });
    }
    for (const d of this.dungeons.values()) {
      const [x, z] = d.entrance;
      const tier = tierFor(d, this.colors);
      const boss = mobInfo(d.boss);
      const well = boss.unlocks;
      if (d.theme === "portal") {
        out.push({ id: d.id, kind: "portal", x, z, name: d.name, tier, about: `${d.name} - tier ${tier} - ${boss.name} waits beyond` });
        continue;
      }
      if (d.waystone) {
        const lit = this.attuned.includes(d.id);
        out.push({ id: d.id, kind: "tower", x, z, name: d.name, tier, lit, about: `${d.name} - tier ${tier} - ${lit ? "attuned: travel here from any attuned tower" : `dormant: beat ${boss.name} to attune its waystone`}` });
        continue;
      }
      const won = well ? this.held.includes(well) : false;
      out.push({ id: d.id, kind: "dungeon", x, z, name: d.name, tier, ...(well ? { well, won } : {}), about: `${d.name} - tier ${tier} - ${well ? `${boss.name}, who holds ${COLOR_NAMES[well]}${won ? " (yours)" : ""}` : `its boss: ${boss.name}`}` });
    }
    for (const l of world.landmarks ?? []) out.push({ id: l.id, kind: "landmark", x: l.x, z: l.z, name: l.name, tier: 0, landmark: l.kind, about: l.name });
    for (const f of world.ferries)
      for (const [end, [x, z]] of [["from", f.from], ["to", f.to]] as const) out.push({ id: `ferry:${f.id}:${end}`, kind: "dock", x, z, name: f.name, tier: 0, about: `${f.name}: a crossing` });
    this.markList = out;
    this.markKey = key;
    return out;
  }

  /**
   * The whole map, over everything: in a town the town's (its streets, buildings and wall, its places and gates named),
   * else the world's (worldMap.ts); a button turns from one to the other.
   */
  openMap(view?: "world" | "town"): void {
    if (!this.hasWorldMap) return;
    this.worldView?.dispose();
    this.worldView = null;
    const at = this.mapState.space === "world" ? this.mapState.centre : null;
    const town = at ? this.townAt(at.x, at.z) : null;
    this.view = view ?? (town ? "town" : "world");
    if (!town) this.view = "world";
    this.fullMap.hidden = false;
    const inTown = this.view === "town" && town;
    const title = inTown ? town.name : "The Domains of Dominaria";
    const hint = inTown ? "Its streets, gates and places: where each road leads, where to trade, rest and build your deck" : "The towns, the roads, the dungeons and the mage towers, each area's tier where it changes";
    const other = town ? `<button data-test="map:switch">${inTown ? "World map" : "Town map"}</button>` : "";
    this.fullMap.innerHTML = `<div class="panel-card${inTown ? "" : " wm"}"><div class="bar"><h2></h2><span class="hint">${hint}</span>${other}<button data-test="map:close">Close</button></div>${inTown ? `<div class="frame"><canvas data-test="map:canvas"></canvas><div class="labels"></div></div><div class="legend town" data-test="map:legend">${placeLegend(town)}</div>` : ""}</div>`;
    this.fullMap.querySelector("h2")!.textContent = title;
    this.fullMap.querySelector("[data-test='map:close']")!.addEventListener("click", () => this.closeMap());
    this.fullMap.querySelector("[data-test='map:switch']")?.addEventListener("click", () => this.openMap(inTown ? "world" : "town"));
    if (inTown) return this.drawFullMap();
    this.worldView = new WorldMapView(
      this.art,
      {
        marks: () => this.marks(),
        player: () => this.lastSeen,
        others: () => this.othersSeen,
        tooltip: (text, x, y) => this.showTooltip(text, x, y),
        labels: () => this.worldData!.labels ?? [],
      },
      this.fullMap.querySelector<HTMLElement>(".panel-card")!,
    );
  }

  closeMap(): void {
    this.worldView?.dispose();
    this.worldView = null;
    this.fullMap.hidden = true;
  }

  /** The map's key, while it is open: M or Escape closes it, + and - zoom the world's. True when it took the key. */
  mapKey(key: string): boolean {
    if (this.fullMap.hidden) return false;
    if (key === "Escape" || key === "m" || key === "M") this.closeMap();
    else if (key === "+" || key === "=") this.worldView?.zoomBy(1);
    else if (key === "-" || key === "_") this.worldView?.zoomBy(-1);
    return true;
  }

  get mapOpen(): boolean {
    return !this.fullMap.hidden;
  }

  /** Which map the whole map shows. */
  get mapView(): "world" | "town" {
    return this.view;
  }

  /** The world's whole map as shown, for tests: its zoom (pixels a tile) and steps, the tiers' tint, whether it is all drawn, the names placed. */
  get wholeMap(): { zoom: number; steps: readonly number[]; tiers: boolean; ready: boolean; left: number; top: number; names: { id: string; text: string; kind: string }[] } | null {
    const v = this.worldView;
    return v ? { zoom: v.zoom, steps: v.steps, tiers: v.tiers, ready: v.ready, ...v.offset, names: v.names } : null;
  }

  /** For tests and the tour: the world's whole map zoomed to a step and centred on a tile, its tiers tinted or not. */
  showWholeMap(step: number, at: { x: number; z: number } | null, tiers: boolean): void {
    const v = this.worldView;
    if (!v) return;
    v.setTiers(tiers);
    if (at) v.centreOn(at.x, at.z, step);
    else v.zoomTo(step);
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
      drawMark(g, m, m.px, m.py, 1.5);
      wanted.push({ text: m.name, x: m.px, y: m.py, r: 7, className: "map-label", test: `map:place:${m.id}` });
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
      drawPlayer(g, p.x, p.y, null, 0.5, 1.3);
    }
  }

  /** The town's whole map, drawn afresh (the world's draws itself while it is open). */
  private drawFullMap(): void {
    const canvas = this.fullMap.querySelector<HTMLCanvasElement>(".frame canvas");
    if (!canvas || this.view !== "town") return;
    const at = this.mapState.space === "world" ? this.mapState.centre : null;
    const town = at ? this.townAt(at.x, at.z) : null;
    if (town) this.drawTownFull(canvas, town);
  }

  /** For tests: how many tiles of land of each tier's zone the map draws, and which tier's zone the map shows at a tile. */
  zones(): { drawn: number[]; tierAt: (x: number, z: number) => number } {
    const art = this.art;
    return { drawn: [...art.drawn], tierAt: (x: number, z: number) => art.tierAt(x, z) };
  }
}

/** The places a town has, as the legend lists them: each kind once, with its icon. */
function placeLegend(town: TownData): string {
  const kinds = [...new Set((town.plan?.places ?? []).map((p) => p.kind))];
  return kinds.map((k) => `<span class="mark"><b class="place" style="background:${PLACE_LOOK[k].color}">${PLACE_LOOK[k].glyph}</b>${PLACE_LOOK[k].label}</span>`).join("") + `<span class="mark"><b class="gate"></b>gate</span>`;
}
