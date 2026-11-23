import type { ManaColor } from "./character";
import type { CardScreens } from "./cardLayer";
import { type Hex, toWorld } from "./hex";
import type { GameMap } from "./maps/gameMap";
import type { Character as CharacterData } from "./net/api";
import { terrainColor } from "./scene/world";

// The HUD (tech.md, B5): who you are and the stats a duel starts from (design.md, A1), your identity's pips, your gold
// and the value of your ante (A2); a minimap of the map you are on; the message line; and the card layer's state.
// DOM in the card client's colors and faces (theme.css), over the world canvas.

const COLOR_NAMES: Record<ManaColor, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

export const gold = (n: number): string => n.toLocaleString("en-US");

export interface MinimapDot {
  readonly hex: Hex;
  readonly kind: "player" | "mob" | "npc" | "chest" | "exit" | "other";
}

export class Hud {
  private readonly character = document.querySelector<HTMLElement>("#hud-character")!;
  private readonly message = document.querySelector<HTMLElement>("#hud-message")!;
  private readonly layerPill = document.querySelector<HTMLElement>("#hud-layer")!;
  private readonly place = document.querySelector<HTMLElement>("#hud-place-name")!;
  private readonly minimap = document.querySelector<HTMLCanvasElement>("#hud-minimap")!;
  private readonly base = document.createElement("canvas");
  private map: GameMap | null = null;
  private scale = 1;
  readonly log: string[] = [];

  constructor(private readonly layer: CardScreens) {
    document.querySelector("#hud")!.removeAttribute("hidden");
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
    const pips = c.Identity.map((color) => `<span class="pip pip-${color.toLowerCase()}" title="${COLOR_NAMES[color]}"></span>`).join("");
    this.character.innerHTML = `
      <div class="name"><span class="pips">${pips}</span><span data-test="hud:name"></span></div>
      <div class="stats"><span title="Starting life">Life <b>${c.Stats.Life}</b></span><span title="Starting hand size">Hand <b>${c.Stats.Hand}</b></span><span title="Maximum hand size">Max <b>${c.Stats.MaxHand}</b></span></div>
      <div class="money"><span class="gold" title="Gold"><b data-test="hud:gold">${gold(c.Gold)}</b> gold</span><span class="ante" title="The value of your ante">Ante <b data-test="hud:ante">${gold(c.AnteValue)}</b></span></div>`;
    this.character.querySelector<HTMLElement>("[data-test='hud:name']")!.textContent = c.Name;
  }

  showLayer(): void {
    const open = this.layer.openScreen;
    this.layerPill.textContent = !this.layer.isReady ? "Cards: loading..." : open ? `Cards: ${open}` : "Cards: ready";
    this.layerPill.dataset.state = !this.layer.isReady ? "loading" : open ? "open" : "ready";
  }

  /** Draws a map's ground once, small, for the minimap to put its dots on. */
  showMap(map: GameMap): void {
    this.map = map;
    this.place.textContent = map.name;
    const size = 144;
    this.base.width = size;
    this.base.height = size;
    const reach = map.data.radius * 1.5 + 2;
    this.scale = size / 2 / reach;
    const g = this.base.getContext("2d")!;
    g.fillStyle = "#0d0f14";
    g.fillRect(0, 0, size, size);
    for (const tile of map.all) {
      const [x, y] = this.project(tile.hex);
      g.fillStyle = tile.blocked ? shade(terrainColor(tile.terrain), tile.prop ? 0.45 : 0.75) : terrainColor(tile.terrain);
      g.fillRect(Math.round(x - this.scale), Math.round(y - this.scale), Math.ceil(this.scale * 2), Math.ceil(this.scale * 2));
    }
    this.minimap.width = size;
    this.minimap.height = size;
  }

  private project(h: Hex): [number, number] {
    const { x, z } = toWorld(h);
    // The minimap is turned as the camera is, so up on it is up on screen.
    const across = (x - z) / Math.SQRT2;
    const down = (x + z) / Math.SQRT2;
    return [this.base.width / 2 + across * this.scale, this.base.height / 2 + down * this.scale];
  }

  drawDots(dots: readonly MinimapDot[]): void {
    if (!this.map) return;
    const g = this.minimap.getContext("2d")!;
    g.drawImage(this.base, 0, 0);
    const colors: Record<MinimapDot["kind"], string> = { player: "#f2efe6", mob: "#c8432c", npc: "#62a4c2", chest: "#f1b44c", exit: "#f1b44c", other: "#a97fd0" };
    for (const dot of [...dots].sort((a, b) => (a.kind === "player" ? 1 : 0) - (b.kind === "player" ? 1 : 0))) {
      const [x, y] = this.project(dot.hex);
      const r = dot.kind === "player" ? 3 : 2;
      g.fillStyle = "#0d0f14";
      g.fillRect(Math.round(x) - r - 1, Math.round(y) - r - 1, r * 2 + 2, r * 2 + 2);
      g.fillStyle = colors[dot.kind];
      g.fillRect(Math.round(x) - r, Math.round(y) - r, r * 2, r * 2);
    }
  }
}

function shade(hex: string, by: number): string {
  const v = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.round(((v >> s) & 0xff) * by);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
