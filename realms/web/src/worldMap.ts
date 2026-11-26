import type { ManaColor } from "./art/figures";
import type { MapArt, ZoneBadge } from "./mapArt";
import { type Box, type Wanted, placeLabels } from "./mapLabels";
import type { MapLabel } from "./world/format";

// The whole map of the world (tech.md B5, "The tier zones are shown"; design.md A6): the travel map as an atlas
// (mapArt.ts) filling its dialog at the 2:3 of the Domains, zoomed with the wheel, + and - or its buttons and dragged
// about, its names placed afresh at each zoom so that more appear as it closes in (mapLabels.ts); the towns by kind with
// their names, the dungeons, the mage towers, the wonders, the Phyrexian Portal and the ferries' docks marked, each
// named on hover with its tier and its boss or its waystone; the player ringed with their heading; the tiers bordered
// and numbered, or tinted strongly with the Tiers toggle; and a legend drawn with the marks themselves. The marks are
// drawn here for the minimap too (hud.ts).

/** Each color's well on the maps: its boss's dungeon ringed in it (black's a violet, to show on the dark). */
export const WELL_COLORS: Record<ManaColor, string> = { W: "#f4ecc2", U: "#5b8fd6", B: "#a06ad8", R: "#e0503a", G: "#4cc25a" };
/** The tiers' colors, 0 (none) to 4: the zones on the maps, the badges, the waymarkers' banners. */
export const TIER_COLORS: readonly string[] = ["#979cab", "#1fbf62", "#ffc94a", "#f58a3a", "#e02a3a"];

/** Something marked on the world's map, at a world tile. */
export interface MapMark {
  readonly id: string;
  readonly kind: "town" | "dungeon" | "tower" | "landmark" | "portal" | "dock";
  readonly x: number;
  readonly z: number;
  readonly name: string;
  readonly tier: number;
  /** A town's size; a landmark's kind. */
  readonly size?: "capital" | "town" | "village";
  readonly landmark?: string;
  /** The player's home inn's town. */
  readonly home?: boolean;
  /** A color's home town: its color. */
  readonly color?: ManaColor;
  /** A mage tower's waystone attuned. */
  readonly lit?: boolean;
  /** A color's boss's dungeon: the color, and whether the character holds it. */
  readonly well?: ManaColor;
  readonly won?: boolean;
  /** What the tooltip says of it. */
  readonly about: string;
}

/** How far round a mark reaches at a scale, pixels: what no name may cover. */
export function markRadius(m: Pick<MapMark, "kind" | "size">, s: number): number {
  if (m.kind === "town") return (m.size === "capital" ? 7 : m.size === "town" ? 5 : 3.5) * s;
  if (m.kind === "portal") return 6 * s;
  if (m.kind === "dock") return 2.5 * s;
  return 5 * s;
}

const INK = "#0b0c10";

/** Draws a mark at (x, y), `s` times its minimap size. */
export function drawMark(g: CanvasRenderingContext2D, m: Omit<MapMark, "id" | "x" | "z" | "name" | "about">, x: number, y: number, s: number): void {
  x = Math.round(x);
  y = Math.round(y);
  g.save();
  g.lineJoin = "round";
  if (m.kind === "town") drawTown(g, m, x, y, s);
  else if (m.kind === "dungeon" || m.kind === "tower") drawDungeon(g, m, x, y, s);
  else if (m.kind === "portal") drawPortal(g, x, y, s);
  else if (m.kind === "landmark") drawLandmark(g, m.landmark ?? "ruin", x, y, s);
  else if (m.kind === "dock") {
    g.fillStyle = INK;
    g.fillRect(x - 2 * s, y - 2 * s, 4 * s, 4 * s);
    g.fillStyle = "#d8eef8";
    g.fillRect(x - 1.2 * s, y - 1.2 * s, 2.4 * s, 2.4 * s);
  }
  g.restore();
}

function drawTown(g: CanvasRenderingContext2D, m: Pick<MapMark, "size" | "home" | "color">, x: number, y: number, s: number): void {
  g.lineWidth = Math.max(1, s * 0.8);
  g.strokeStyle = INK;
  if (m.home) {
    // The player's home: a ring of gold round it.
    g.beginPath();
    g.arc(x, y, (m.size === "capital" ? 10 : m.size === "town" ? 8 : 6.5) * s, 0, Math.PI * 2);
    g.lineWidth = 3 * s;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 1.6 * s;
    g.strokeStyle = "#f1b44c";
    g.stroke();
    g.lineWidth = Math.max(1, s * 0.8);
    g.strokeStyle = INK;
  }
  if (m.size === "capital") {
    // A keep: a block with three merlons, gold.
    const w = 6 * s;
    const h = 5 * s;
    const t = 2 * s;
    g.beginPath();
    g.moveTo(x - w, y + h);
    g.lineTo(x - w, y - h + t);
    for (let i = 0; i < 3; i++) {
      const x0 = x - w + (i * 2 * w) / 2.5;
      g.lineTo(x0, y - h - t * 0.6);
      g.lineTo(x0 + (2 * w) / 5, y - h - t * 0.6);
      g.lineTo(x0 + (2 * w) / 5, y - h + t);
      if (i < 2) g.lineTo(x0 + (2 * w) / 2.5, y - h + t);
    }
    g.lineTo(x + w, y - h + t);
    g.lineTo(x + w, y + h);
    g.closePath();
    g.fillStyle = "#f2d48a";
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.fillRect(x - 1.2 * s, y + h - 3.4 * s, 2.4 * s, 3.4 * s);
    return;
  }
  if (m.size === "town") {
    // A house: walls and a gable.
    const w = 4.4 * s;
    g.beginPath();
    g.moveTo(x - w, y + w * 0.9);
    g.lineTo(x - w, y - w * 0.1);
    g.lineTo(x, y - w * 1.05);
    g.lineTo(x + w, y - w * 0.1);
    g.lineTo(x + w, y + w * 0.9);
    g.closePath();
    g.fillStyle = "#eadfc4";
    g.fill();
    g.stroke();
    if (m.color) {
      g.fillStyle = WELL_COLORS[m.color];
      g.fillRect(x - 1.6 * s, y + w * 0.9 - 3.6 * s, 3.2 * s, 3.6 * s);
    } else {
      g.fillStyle = INK;
      g.fillRect(x - 1.1 * s, y + w * 0.9 - 3 * s, 2.2 * s, 3 * s);
    }
    return;
  }
  // A village: a dot.
  g.beginPath();
  g.arc(x, y, 3 * s, 0, Math.PI * 2);
  g.fillStyle = "#e6dcc2";
  g.fill();
  g.stroke();
}

function drawDungeon(g: CanvasRenderingContext2D, m: Pick<MapMark, "kind" | "tier" | "lit" | "well" | "won">, x: number, y: number, s: number): void {
  const k = s;
  const r = 3 * k;
  // A color's boss: its dungeon ringed in the well's color, the ring filled in once the color is held.
  if (m.well) {
    g.beginPath();
    g.arc(x, y, r + 3 * k, 0, Math.PI * 2);
    g.lineWidth = 2.5 * k;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = (m.won ? 2 : 1.2) * k;
    g.strokeStyle = WELL_COLORS[m.well];
    g.globalAlpha = m.won ? 1 : 0.8;
    g.stroke();
    if (m.won) {
      g.globalAlpha = 0.35;
      g.fillStyle = WELL_COLORS[m.well];
      g.fill();
    }
    g.globalAlpha = 1;
  }
  // An attuned waystone glows.
  if (m.kind === "tower" && m.lit) {
    g.fillStyle = "#7fe7ff55";
    g.beginPath();
    g.arc(x, y, r + 3.5 * k, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = Math.max(1, 0.8 * k);
  g.strokeStyle = INK;
  g.beginPath();
  if (m.kind === "dungeon") {
    g.moveTo(x, y - r - 1 * k);
    g.lineTo(x + r + 1 * k, y);
    g.lineTo(x, y + r + 1 * k);
    g.lineTo(x - r - 1 * k, y);
    g.fillStyle = TIER_COLORS[m.tier] ?? TIER_COLORS[0]!;
  } else {
    g.moveTo(x, y - r - 2 * k);
    g.lineTo(x + r + 1 * k, y + r);
    g.lineTo(x - r - 1 * k, y + r);
    g.fillStyle = m.lit ? "#7fe7ff" : "#626879";
  }
  g.closePath();
  g.fill();
  g.stroke();
  // Its tier, beside it.
  if (m.tier > 0) {
    g.font = `700 ${Math.round(8 * k)}px Beleren, sans-serif`;
    g.textBaseline = "alphabetic";
    g.fillStyle = INK;
    g.fillText(String(m.tier), x + r + 2 * k, y + r + 3 * k);
    g.fillStyle = TIER_COLORS[m.tier]!;
    g.fillText(String(m.tier), x + r + 1 * k, y + r + 2 * k);
  }
}

function drawPortal(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // The Phyrexian Portal: a black rift in a ring of oil-sheened violet.
  const r = 5 * s;
  g.beginPath();
  g.arc(x, y, r + 1.5 * s, 0, Math.PI * 2);
  g.fillStyle = INK;
  g.fill();
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, "#050307");
  grad.addColorStop(0.55, "#2a1235");
  grad.addColorStop(1, "#b06ae0");
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = "#e6b8ff";
  g.lineWidth = Math.max(1, 0.7 * s);
  g.beginPath();
  g.arc(x, y, r * 0.55, -0.4, Math.PI * 1.1);
  g.stroke();
}

function drawLandmark(g: CanvasRenderingContext2D, kind: string, x: number, y: number, s: number): void {
  // A wonder: a small cream glyph of what it is, outlined dark.
  const fill = "#f1e6c8";
  g.fillStyle = fill;
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1, 0.8 * s);
  const shape = (draw: () => void, color = fill) => {
    g.beginPath();
    draw();
    g.fillStyle = color;
    g.fill();
    g.stroke();
  };
  switch (kind) {
    case "cathedral":
      shape(() => {
        g.moveTo(x - 3 * s, y + 4 * s);
        g.lineTo(x - 3 * s, y - 1 * s);
        g.lineTo(x, y - 6 * s);
        g.lineTo(x + 3 * s, y - 1 * s);
        g.lineTo(x + 3 * s, y + 4 * s);
        g.closePath();
      });
      g.fillStyle = "#f1b44c";
      g.fillRect(x - 0.6 * s, y - 3 * s, 1.2 * s, 3 * s);
      break;
    case "great-oak":
      g.fillStyle = "#5a3e26";
      g.fillRect(x - 1 * s, y, 2 * s, 4 * s);
      shape(() => g.arc(x, y - 1.5 * s, 4 * s, 0, Math.PI * 2), "#6fb048");
      break;
    case "floating-towers":
      shape(() => g.rect(x - 4 * s, y - 5 * s, 3 * s, 6 * s));
      shape(() => g.rect(x + 1 * s, y - 3 * s, 3 * s, 6 * s));
      break;
    case "obelisk":
      shape(() => {
        g.moveTo(x - 2 * s, y + 4 * s);
        g.lineTo(x - 1.2 * s, y - 4 * s);
        g.lineTo(x, y - 6 * s);
        g.lineTo(x + 1.2 * s, y - 4 * s);
        g.lineTo(x + 2 * s, y + 4 * s);
        g.closePath();
      });
      break;
    case "arena":
      shape(() => g.ellipse(x, y, 5 * s, 3.5 * s, 0, 0, Math.PI * 2));
      g.beginPath();
      g.ellipse(x, y, 2.6 * s, 1.6 * s, 0, 0, Math.PI * 2);
      g.fillStyle = "#a88b5d";
      g.fill();
      break;
    case "lighthouse":
      shape(() => {
        g.moveTo(x - 2.4 * s, y + 4 * s);
        g.lineTo(x - 1.4 * s, y - 3 * s);
        g.lineTo(x + 1.4 * s, y - 3 * s);
        g.lineTo(x + 2.4 * s, y + 4 * s);
        g.closePath();
      });
      shape(() => g.arc(x, y - 4.4 * s, 1.8 * s, 0, Math.PI * 2), "#ffd45a");
      break;
    default:
      // A ruin: broken columns.
      shape(() => g.rect(x - 4 * s, y - 2 * s, 2 * s, 6 * s));
      shape(() => g.rect(x - 1 * s, y - 5 * s, 2 * s, 9 * s));
      shape(() => g.rect(x + 2 * s, y, 2 * s, 4 * s));
  }
}

/** The player: a ring that breathes (by `t`, seconds), round an arrow along their heading (radians, x east, z south). */
export function drawPlayer(g: CanvasRenderingContext2D, x: number, y: number, heading: number | null, t: number, s: number): void {
  x = Math.round(x);
  y = Math.round(y);
  const pulse = (t % 1.6) / 1.6;
  g.save();
  g.beginPath();
  g.arc(x, y, (6 + pulse * 7) * s, 0, Math.PI * 2);
  g.strokeStyle = `rgba(255,255,255,${(0.85 * (1 - pulse)).toFixed(3)})`;
  g.lineWidth = 2 * s;
  g.stroke();
  g.beginPath();
  g.arc(x, y, 6 * s, 0, Math.PI * 2);
  g.fillStyle = "#0b0c10cc";
  g.fill();
  g.lineWidth = 1.6 * s;
  g.strokeStyle = "#f2f7f8";
  g.stroke();
  g.fillStyle = "#f2f7f8";
  g.beginPath();
  if (heading === null) g.arc(x, y, 2.6 * s, 0, Math.PI * 2);
  else {
    const c = Math.cos(heading);
    const n = Math.sin(heading);
    const at = (f: number, side: number) => [x + (c * f - n * side) * s, y + (n * f + c * side) * s] as const;
    g.moveTo(...at(4.6, 0));
    g.lineTo(...at(-3, 3.2));
    g.lineTo(...at(-1.4, 0));
    g.lineTo(...at(-3, -3.2));
    g.closePath();
  }
  g.fill();
  g.restore();
}

/** What the whole map asks of the HUD each time it draws. */
export interface MapSource {
  marks(): readonly MapMark[];
  /** Where the player is on the travel map (a tile), and which way they go; null for nowhere on it. */
  player(): { x: number; z: number; heading: number | null } | null;
  /** Other players seen near, tiles. */
  others(): readonly { x: number; z: number }[];
  tooltip(text: string | null, x?: number, y?: number): void;
  labels(): readonly MapLabel[];
}

/** A label of the map: a land's, a sea's, a region's, a feature's, a town's or a wonder's, or a zone's tier. */
interface MapName {
  readonly id: string;
  readonly text: string;
  readonly kind: MapLabel["kind"] | "town" | "landmark" | "tier";
  readonly x: number;
  readonly z: number;
  readonly mark?: MapMark;
  readonly badge?: ZoneBadge;
}

/** Each kind of name's face: size, letters and spacing (CSS and the canvas that measures it). */
const FACES: Record<MapName["kind"], { size: number; family: string; style?: string; upper?: boolean; spacing: number; color: string }> = {
  land: { size: 24, family: "Beleren", upper: true, spacing: 0.34, color: "#f4ecc2" },
  sea: { size: 15, family: "MPlantin", style: "italic", spacing: 0.08, color: "#a9cdf0" },
  region: { size: 13, family: "Beleren", upper: true, spacing: 0.14, color: "#f6efd8" },
  feature: { size: 11, family: "Beleren", spacing: 0.03, color: "#e4dabd" },
  town: { size: 13, family: "Beleren", spacing: 0.01, color: "#ffffff" },
  landmark: { size: 11, family: "Beleren", spacing: 0.02, color: "#e9d7ff" },
  tier: { size: 11, family: "Beleren", spacing: 0, color: "#0b0c10" },
};

/** The zoom steps past the fitted one, pixels a tile. */
const STEPS = [1.5, 2, 3, 4, 6, 8];

export class WorldMapView {
  readonly frame: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly layer: HTMLElement;
  private readonly side: HTMLElement;
  private zooms: number[] = [1];
  private zoomIndex = 0;
  /** The map's pixel at the frame's top-left corner. */
  private left = 0;
  private top = 0;
  private width = 0;
  private height = 0;
  tiers = false;
  private placedFor = "";
  /** Whether every square of the land in view is drawn (not stood in for). */
  ready = false;
  private frameId = 0;
  private drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  private hover: { x: number; y: number } | null = null;
  /** Names placed at this zoom, for tests: each id, its text and kind. */
  names: { id: string; text: string; kind: string }[] = [];

  constructor(
    private readonly art: MapArt,
    private readonly source: MapSource,
    host: HTMLElement,
  ) {
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="wm-body"><div class="wm-frame" data-test="map:frame"><canvas data-test="map:canvas"></canvas><div class="labels"></div></div><div class="wm-side"></div></div>`,
    );
    this.frame = host.querySelector<HTMLElement>(".wm-frame")!;
    this.canvas = this.frame.querySelector("canvas")!;
    this.layer = this.frame.querySelector<HTMLElement>(".labels")!;
    this.side = host.querySelector<HTMLElement>(".wm-side")!;
    this.buildSide();
    this.layout();
    this.bind();
    // Drawn at once (the names placed with it), then each frame while it is open.
    this.draw();
    const tick = () => {
      if (!this.frame.isConnected) return;
      this.draw();
      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  }

  /** Stops drawing: the dialog closed or turned to the town's map. */
  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.source.tooltip(null);
  }

  get zoom(): number {
    return this.zooms[this.zoomIndex]!;
  }

  get fitted(): boolean {
    return this.zoomIndex === 0;
  }

  /** The frame's size: the travel map's shape, as big as the window lets it beside the legend. */
  private layout(): void {
    const W = this.art.width;
    const H = this.art.depth;
    const sideW = 196;
    const maxH = Math.max(200, window.innerHeight - 40 - 40 - 50);
    const maxW = Math.max(200, window.innerWidth - 40 - 48 - sideW - 16);
    const fit = Math.min(maxH / H, maxW / W);
    this.width = Math.floor(W * fit);
    this.height = Math.floor(H * fit);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.frame.style.width = `${this.width}px`;
    this.frame.style.height = `${this.height}px`;
    this.zooms = [fit, ...STEPS.filter((s) => s > fit * 1.3)];
    this.zoomIndex = 0;
    this.left = 0;
    this.top = 0;
  }

  private buildSide(): void {
    const row = (mark: string, text: string) => `<div class="wm-key"><canvas width="26" height="22" data-mark="${mark}"></canvas><span>${text}</span></div>`;
    this.side.innerHTML = `
      <div class="wm-tools">
        <button data-test="map:zoom-out" title="Zoom out (-)">&minus;</button>
        <button data-test="map:zoom-in" title="Zoom in (+)">+</button>
        <button data-test="map:fit" title="The whole map">Fit</button>
      </div>
      <button class="wm-tiers" data-test="map:tiers" aria-pressed="false" title="Tint each zone in its tier's color">Tiers</button>
      <h3>Tiers</h3>
      <div class="wm-tierkey">${[1, 2, 3, 4].map((t) => `<span data-tier="${t}"><i style="background:${TIER_COLORS[t]}"></i>${t}</span>`).join("")}</div>
      <p class="wm-note">Bordered where the tier changes; the harder, the further from the home towns.</p>
      <h3>Marks</h3>
      ${row("capital", "Capital")}${row("town", "Home town")}${row("village", "Village")}${row("home", "Your inn")}
      ${row("dungeon", "Dungeon, its tier")}${row("well", "A color's boss")}${row("lit", "Mage tower, attuned")}${row("tower", "Mage tower, dormant")}
      ${row("landmark", "Wonder")}${row("portal", "Phyrexian Portal")}${row("dock", "Ferry")}${row("you", "You")}
      <p class="wm-note">Drag to pan, the wheel or + and - to zoom; M or Esc closes.</p>`;
    for (const c of this.side.querySelectorAll<HTMLCanvasElement>("canvas[data-mark]")) {
      const g = c.getContext("2d")!;
      const x = 13;
      const y = 11;
      const k = c.dataset.mark!;
      if (k === "you") drawPlayer(g, x, y, -Math.PI / 4, 0.9, 1);
      else if (k === "capital" || k === "town" || k === "village") drawMark(g, { kind: "town", size: k, tier: 0, ...(k === "town" ? { color: "G" as const } : {}) }, x, y, 1);
      else if (k === "home") drawMark(g, { kind: "town", size: "village", tier: 0, home: true }, x, y, 1);
      else if (k === "dungeon") drawMark(g, { kind: "dungeon", tier: 2 }, x - 3, y, 1.2);
      else if (k === "well") drawMark(g, { kind: "dungeon", tier: 3, well: "R", won: false }, x - 3, y, 1.2);
      else if (k === "lit") drawMark(g, { kind: "tower", tier: 1, lit: true }, x - 3, y, 1.2);
      else if (k === "tower") drawMark(g, { kind: "tower", tier: 1, lit: false }, x - 3, y, 1.2);
      else if (k === "landmark") drawMark(g, { kind: "landmark", tier: 0, landmark: "cathedral" }, x, y + 1, 1.1);
      else if (k === "portal") drawMark(g, { kind: "portal", tier: 0 }, x, y, 1.2);
      else if (k === "dock") {
        g.strokeStyle = "#d8eef8";
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(2, y);
        g.lineTo(24, y);
        g.stroke();
        drawMark(g, { kind: "dock", tier: 0 }, x, y, 1.3);
      }
    }
    this.side.querySelector("[data-test='map:zoom-in']")!.addEventListener("click", () => this.zoomBy(1));
    this.side.querySelector("[data-test='map:zoom-out']")!.addEventListener("click", () => this.zoomBy(-1));
    this.side.querySelector("[data-test='map:fit']")!.addEventListener("click", () => this.zoomTo(0));
    const tiers = this.side.querySelector<HTMLButtonElement>("[data-test='map:tiers']")!;
    tiers.addEventListener("click", () => this.setTiers(!this.tiers));
  }

  setTiers(on: boolean): void {
    this.tiers = on;
    this.ready = false;
    const b = this.side.querySelector<HTMLButtonElement>("[data-test='map:tiers']")!;
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("on", on);
  }

  private bind(): void {
    this.frame.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (Math.abs(e.deltaY) < 1) return;
        const r = this.frame.getBoundingClientRect();
        this.zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    this.frame.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, left: this.left, top: this.top, moved: false };
      this.frame.setPointerCapture(e.pointerId);
    });
    this.frame.addEventListener("pointermove", (e) => {
      const r = this.frame.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
        if (this.drag.moved) {
          this.left = this.drag.left - dx;
          this.top = this.drag.top - dy;
          this.clamp();
          this.frame.classList.add("dragging");
        }
      }
      this.describe(e.clientX, e.clientY);
    });
    const end = () => {
      this.drag = null;
      this.frame.classList.remove("dragging");
    };
    this.frame.addEventListener("pointerup", end);
    this.frame.addEventListener("pointercancel", end);
    this.frame.addEventListener("pointerleave", () => {
      this.hover = null;
      this.source.tooltip(null);
    });
  }

  /** Steps the zoom in (+1) or out (-1), keeping the map's point under (`fx`, `fy`) - the frame's middle by default - where it is. */
  zoomBy(step: 1 | -1, fx = this.width / 2, fy = this.height / 2): void {
    this.zoomTo(Math.max(0, Math.min(this.zooms.length - 1, this.zoomIndex + step)), fx, fy);
  }

  zoomTo(index: number, fx = this.width / 2, fy = this.height / 2): void {
    const before = this.zoom;
    const tx = (this.left + fx) / before;
    const ty = (this.top + fy) / before;
    this.zoomIndex = index;
    this.left = Math.round(tx * this.zoom - fx);
    this.top = Math.round(ty * this.zoom - fy);
    this.clamp();
  }

  /** Centres the map on a world tile (as far as it can) at a zoom step. */
  centreOn(x: number, z: number, index = this.zoomIndex): void {
    this.zoomIndex = Math.max(0, Math.min(this.zooms.length - 1, index));
    this.left = Math.round((x - this.art.x0 + 0.5) * this.zoom - this.width / 2);
    this.top = Math.round((z - this.art.z0 + 0.5) * this.zoom - this.height / 2);
    this.clamp();
  }

  /** The zoom steps, pixels a tile, the fitted first. */
  get steps(): readonly number[] {
    return this.zooms;
  }

  /** Keeps the map over the frame (centred in it where it is smaller), the view to be drawn afresh. */
  private clamp(): void {
    this.ready = false;
    const mw = Math.round(this.art.width * this.zoom);
    const mh = Math.round(this.art.depth * this.zoom);
    this.left = mw <= this.width ? Math.round((mw - this.width) / 2) : Math.max(0, Math.min(mw - this.width, this.left));
    this.top = mh <= this.height ? Math.round((mh - this.height) / 2) : Math.max(0, Math.min(mh - this.height, this.top));
  }

  /** Where a world tile's middle is in the frame, pixels. */
  private at(x: number, z: number): { x: number; y: number } {
    return { x: (x - this.art.x0) * this.zoom - this.left, y: (z - this.art.z0) * this.zoom - this.top };
  }

  /** The mark scale at this zoom: a touch bigger as it closes in. */
  private get markScale(): number {
    return Math.max(1.05, Math.min(1.9, 0.85 + this.zoom * 0.25));
  }

  private draw(): void {
    const g = this.canvas.getContext("2d")!;
    const k = this.zoom;
    this.ready = this.art.draw(g, k, this.tiers, this.left, this.top, this.width, this.height, 0, 0, this.ready ? 30 : 60);
    if (this.placedFor !== String(k)) this.placeNames();
    this.layer.style.transform = `translate(${-this.left}px, ${-this.top}px)`;
    const s = this.markScale;
    const marks = this.source.marks();
    for (const l of this.leaders) {
      g.beginPath();
      g.moveTo(Math.round(l.x0 - this.left) + 0.5, Math.round(l.y0 - this.top) + 0.5);
      g.lineTo(Math.round(l.x1 - this.left) + 0.5, Math.round(l.y1 - this.top) + 0.5);
      g.strokeStyle = "#0b0c10aa";
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = "#f2f7f8";
      g.lineWidth = 1;
      g.stroke();
    }
    // The docks under the rest, then the wonders, towns, dungeons and towers, the portal on top.
    const order = ["dock", "landmark", "town", "dungeon", "tower", "portal"];
    for (const kind of order)
      for (const m of marks) {
        if (m.kind !== kind) continue;
        if (m.kind === "dock" && k < 1.4) continue;
        const p = this.at(m.x + 0.5, m.z + 0.5);
        if (p.x < -20 || p.y < -20 || p.x > this.width + 20 || p.y > this.height + 20) continue;
        drawMark(g, m, p.x, p.y, s * (m.kind === "landmark" ? 0.9 : 1));
      }
    // The tiers' numbers, where they were placed.
    for (const n of this.badges) {
      const p = { x: n.x - this.left, y: n.y - this.top };
      if (p.x < -10 || p.y < -10 || p.x > this.width + 10 || p.y > this.height + 10) continue;
      g.beginPath();
      g.arc(Math.round(p.x), Math.round(p.y), 7, 0, Math.PI * 2);
      g.fillStyle = "#0b0c10";
      g.fill();
      g.beginPath();
      g.arc(Math.round(p.x), Math.round(p.y), 6, 0, Math.PI * 2);
      g.fillStyle = TIER_COLORS[n.tier]!;
      g.fill();
      g.font = "700 10px Beleren, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#0b0c10";
      g.fillText(String(n.tier), Math.round(p.x), Math.round(p.y) + 1);
      g.textAlign = "start";
      g.textBaseline = "alphabetic";
    }
    for (const o of this.source.others()) {
      const p = this.at(o.x, o.z);
      g.fillStyle = "#0b0c10";
      g.fillRect(Math.round(p.x) - 3, Math.round(p.y) - 3, 6, 6);
      g.fillStyle = "#b9a8ff";
      g.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
    }
    const me = this.source.player();
    if (me) {
      const p = this.at(me.x, me.z);
      drawPlayer(g, p.x, p.y, me.heading, performance.now() / 1000, 1.15);
    }
  }

  /** Where the tiers' numbers went at this zoom (map pixels). */
  private badges: { x: number; y: number; tier: number }[] = [];
  /** The lines from towns' marks to their names set off from them (map pixels). */
  private leaders: { x0: number; y0: number; x1: number; y1: number }[] = [];

  /** The map's pixel at the frame's top-left corner, for tests. */
  get offset(): { left: number; top: number } {
    return { left: this.left, top: this.top };
  }

  /** Places the names for this zoom: the towns', the lands', seas', regions', features', the wonders' and the tiers' numbers. */
  private placeNames(): void {
    const k = this.zoom;
    this.placedFor = String(k);
    const s = this.markScale;
    const measure = document.createElement("canvas").getContext("2d")!;
    const names: MapName[] = [];
    const marks = this.source.marks();
    const towns = marks.filter((m) => m.kind === "town").sort((a, b) => rank(a) - rank(b));
    for (const m of towns) names.push({ id: `town:${m.id}`, text: m.name, kind: "town", x: m.x + 0.5, z: m.z + 0.5, mark: m });
    const labels = this.source.labels();
    for (const kind of ["land", "sea", "region", "feature"] as const) for (const l of labels) if (l.kind === kind) names.push({ id: `label:${l.name}`, text: l.name, kind, x: l.x, z: l.z });
    if (k >= 2) for (const m of marks) if (m.kind === "landmark") names.push({ id: `landmark:${m.id}`, text: m.name, kind: "landmark", x: m.x + 0.5, z: m.z + 0.5, mark: m });
    // The tiers' numbers: the wide zones from afar, every zone closer in.
    const least = k < 1.4 ? 10 : k < 2.5 ? 6 : k < 5 ? 3 : 1;
    for (const b of this.art.badges) if (b.cells >= least) names.push({ id: `tier:${b.x},${b.z}`, text: String(b.tier), kind: "tier", x: b.x, z: b.z, badge: b });
    const wanted: Wanted[] = [];
    const face = new Map<string, { size: number; spacing: number }>();
    for (const n of names) {
      const f = FACES[n.kind];
      // A land's name grows a little as the map closes in; the rest keep their size.
      const size = n.kind === "land" ? Math.round(f.size * Math.min(1.5, Math.max(0.85, 0.8 + k * 0.12))) : n.kind === "town" ? (n.mark?.size === "capital" ? 15 : n.mark?.size === "village" ? 12 : 13) : f.size;
      const spacing = f.spacing * size;
      face.set(n.id, { size, spacing });
      const p = { x: (n.x - this.art.x0) * k, y: (n.z - this.art.z0) * k };
      if (n.kind === "tier") {
        wanted.push({ id: n.id, x: p.x, y: p.y, width: 14, height: 14, mode: "over", reach: 18 });
        continue;
      }
      measure.font = `${f.style ?? ""} ${f.family === "Beleren" ? "700" : "400"} ${size}px ${f.family}`;
      measure.letterSpacing = `${spacing}px`;
      const text = f.upper ? n.text.toUpperCase() : n.text;
      const width = Math.ceil(measure.measureText(text).width) + 2;
      const height = Math.ceil(size * 1.15);
      if (n.mark) wanted.push({ id: n.id, x: p.x, y: p.y, width, height, mode: "beside", r: markRadius(n.mark, s) + (n.mark.home ? 4 * s : 0), must: n.kind === "town", scales: n.kind === "town" ? [1, 0.85] : [1] });
      else wanted.push({ id: n.id, x: p.x, y: p.y, width, height, mode: "over", reach: n.kind === "land" ? height * 2 : n.kind === "region" ? height * 3 : height * 1.6, scales: n.kind === "feature" ? [1] : [1, 0.85, 0.72] });
    }
    // No name over a mark: the towns', dungeons', towers', wonders' and the portal's boxes.
    const obstacles: Box[] = marks
      .filter((m) => m.kind !== "dock")
      .map((m) => {
        const p = { x: (m.x + 0.5 - this.art.x0) * k, y: (m.z + 0.5 - this.art.z0) * k };
        const r = markRadius(m, s) + (m.kind === "dungeon" || m.kind === "tower" ? 4 * s : 0) + (m.home ? 4 * s : 0);
        return { x0: p.x - r, y0: p.y - r, x1: p.x + r + (m.kind === "dungeon" || m.kind === "tower" ? 6 * s : 0), y1: p.y + r };
      });
    const bounds = { x0: 0, y0: 0, x1: this.art.width * k, y1: this.art.depth * k };
    const placed = placeLabels(wanted, obstacles, bounds);
    this.layer.innerHTML = "";
    this.badges = [];
    this.names = [];
    const byId = new Map(names.map((n) => [n.id, n]));
    this.leaders = [];
    for (const p of placed) {
      const n = byId.get(p.id)!;
      // A town's name set off from its mark (a crowded corner) is joined to it by a line.
      if (n.kind === "town" && n.mark) {
        const mx = (n.x - this.art.x0) * k;
        const my = (n.z - this.art.z0) * k;
        const cx = Math.max(p.box.x0, Math.min(p.box.x1, mx));
        const cy = Math.max(p.box.y0 + 2, Math.min(p.box.y1 - 2, my));
        const r = markRadius(n.mark, s) + (n.mark.home ? 4 * s : 0);
        const d = Math.hypot(cx - mx, cy - my);
        if (d > r + 5) this.leaders.push({ x0: mx + ((cx - mx) / d) * (r + 1), y0: my + ((cy - my) / d) * (r + 1), x1: cx, y1: cy });
      }
      if (n.kind === "tier") {
        this.badges.push({ x: (p.box.x0 + p.box.x1) / 2, y: (p.box.y0 + p.box.y1) / 2, tier: n.badge!.tier });
        continue;
      }
      const f = FACES[n.kind];
      const { size, spacing } = face.get(n.id)!;
      const el = document.createElement("span");
      el.className = `wm-name ${n.kind}${n.mark?.home ? " home" : ""}`;
      el.textContent = n.text;
      el.dataset.test = n.kind === "town" ? "map:town" : n.kind === "landmark" ? "map:landmark" : "map:label";
      el.style.left = `${Math.round(p.x0)}px`;
      el.style.top = `${Math.round(p.y0)}px`;
      el.style.fontSize = `${(size * p.scale).toFixed(1)}px`;
      el.style.letterSpacing = `${(spacing * p.scale).toFixed(2)}px`;
      el.style.color = n.mark?.size === "capital" ? "#ffe6a6" : f.color;
      this.layer.appendChild(el);
      this.names.push({ id: n.id, text: n.text, kind: n.kind });
    }
  }

  /** The tooltip over the map: a mark's name and what it holds, else the zone's name and tier. */
  private describe(cx: number, cy: number): void {
    if (!this.hover || this.drag?.moved) return this.source.tooltip(null);
    const s = this.markScale;
    let best: MapMark | null = null;
    let bestD = Infinity;
    for (const m of this.source.marks()) {
      const p = this.at(m.x + 0.5, m.z + 0.5);
      const d = Math.hypot(p.x - this.hover.x, p.y - this.hover.y);
      if (d <= markRadius(m, s) + 5 && d < bestD) {
        best = m;
        bestD = d;
      }
    }
    if (best) return this.source.tooltip(best.about, cx, cy);
    const x = this.art.x0 + (this.left + this.hover.x) / this.zoom;
    const z = this.art.z0 + (this.top + this.hover.y) / this.zoom;
    const badge = this.art.isLand(x, z) ? this.art.tierAt(x, z) : 0;
    if (badge > 0) {
      const area = this.areaName(x, z);
      return this.source.tooltip(`${area} - tier ${badge}`, cx, cy);
    }
    this.source.tooltip(null);
  }

  private areaName(x: number, z: number): string {
    const zones = this.art.world.zones;
    const [ox, oz] = this.art.world.origin ?? [0, 0];
    const a = zones.grid[Math.floor((z - oz) / zones.cell)]?.[Math.floor((x - ox) / zones.cell)];
    return (a !== undefined && zones.areas[a]?.name) || "The wilds";
  }
}

/** The order towns' names are placed in: the capital, the home towns, the villages. */
const rank = (m: MapMark) => (m.size === "capital" ? 0 : m.size === "town" ? 1 : 2) + (m.home ? -0.5 : 0);
