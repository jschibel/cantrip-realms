// What a playtest report says of the game when F8 was pressed (reports/index.ts): everything the page knows that an
// agent reading the report later would want - where the player stood and what they saw, the character, the card screen
// open and what it was opened on, the mobs and players near, the HUD's words, the debug overlay's lines, the presence
// trace - as `context` (written out as context.json), a few lines of it as `summary` (the report's page), and the place
// and screen in a word each (its front matter).

import type { CardScreens } from "../cardLayer";
import { debugLines } from "../debug";
import type { Overworld } from "../game";
import { consoleLog } from "./logs";

export interface Gathered {
  readonly place: string;
  readonly screen: string;
  readonly summary: string[];
  readonly context: Record<string, unknown>;
  /** What passed between the page and the presence relay lately (Overworld.trace). */
  readonly trace: string;
}

/** The overworld's build: its commit (vite.config.ts). */
export const BUILD = (import.meta.env.VITE_REALM_BUILD as string | undefined) ?? "dev";

/** How many of the card layer's last requests go in, with what each was opened on (a duel's seats and seed). */
const REQUESTS = 3;

/** How near a mob or another player stands to be named, in tiles. */
const NEAR = 24;

const text = (selector: string): string | null => {
  const el = document.querySelector<HTMLElement>(selector);
  const words = el && !el.hidden ? el.innerText.trim() : "";
  return words.length > 0 ? words : null;
};

const rounded = (n: number): number => Math.round(n * 100) / 100;

/** Gathers the state now; `pointer` is where the mouse was on the page, for the debug overlay's tile under it. */
export function gather(game: Overworld | null, layer: CardScreens, pointer: { readonly x: number; readonly y: number } | null, offline: boolean): Gathered {
  const page = {
    url: window.location.href,
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight, ratio: window.devicePixelRatio },
    build: BUILD,
    offline,
    time: new Date().toISOString(),
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const cards = {
    open: layer.openScreen,
    ready: layer.isReady,
    requests: layer.requests.slice(-REQUESTS),
  };
  const hud = {
    character: text("#hud-character"),
    place: text("#hud-place-name"),
    area: text("#hud-area"),
    layer: text("#hud-layer"),
    message: text("#hud-message"),
    screens: text("#screens"),
  };
  const errors = consoleLog.text().split("\n").filter((l) => / (error|uncaught|unhandled rejection) /.test(l)).length;
  const warnings = consoleLog.text().split("\n").filter((l) => / warn /.test(l)).length;

  const screen = game?.screen ?? "loading";
  const summary = [`Screen: ${screen}${cards.open ? ` (card screen: ${cards.open})` : ""}`];
  const context: Record<string, unknown> = { page, cards, hud };
  let place = "-";

  if (game?.stage) {
    const stage = game.stage;
    const p = stage.player.position;
    const tile = stage.player.tile;
    place = `${game.spaceId} ${tile.x},${tile.z}`;
    const c = game.data;
    const run = game.run;
    const near = (t: { readonly x: number; readonly z: number }) => Math.max(Math.abs(t.x - tile.x), Math.abs(t.z - tile.z)) <= NEAR;
    context.game = {
      screen,
      paused: game.paused,
      space: game.spaceId,
      spot: stage.current.id,
      inWorld: game.inWorld,
      position: { x: rounded(p.x), y: rounded(stage.player.figure.root.position.y), z: rounded(p.z) },
      tile,
      area: game.area,
      camera: { heading: stage.rig.heading, zoom: stage.rig.zoom },
      run: run ? { id: run.id, dungeon: run.dungeon.id, floor: run.floor, floors: run.floors.length, tier: run.tier, seed: run.seed, beaten: [...run.beaten] } : null,
      relay: game.presence ? { connected: game.presence.connected } : null,
      mobs: game.mobs
        .filter((m) => near(m.actor.tile))
        .map((m) => ({ id: m.info.id, name: m.info.name, tier: m.info.tier, spawn: m.spawn.id, tile: m.actor.tile, home: m.home, engaged: m.engaged, run: m.run ?? null })),
      players: [...game.visitors.values()].filter((v) => near(v.actor.tile)).map((v) => ({ player: v.player, name: v.name, identity: v.identity, tile: v.actor.tile })),
      debug: debugLines(game, pointer),
      jumps: game.jumps,
      refusedWalks: game.refusedWalks,
    };
    context.character = c ?? null;
    summary.push(`Place: ${game.spaceId}, tile ${tile.x},${tile.z} (at ${rounded(p.x)},${rounded(p.z)})${game.area ? ` - ${game.area.name}, tier ${game.area.tier}` : ""}`);
    if (run) summary.push(`Dungeon run: ${run.dungeon.name}, floor ${run.floor + 1} of ${run.floors.length} (tier ${run.tier})`);
    if (c) summary.push(`Character: ${c.Name} (${c.Identity}), ${c.Hearts} of ${c.MaxHearts} hearts, ${c.Gold} gold`);
    summary.push(`Camera: heading ${stage.rig.heading}, zoom ${stage.rig.zoom}`);
    const nearMobs = (context.game as { mobs: unknown[] }).mobs.length;
    if (nearMobs > 0) summary.push(`Mobs within ${NEAR} tiles: ${nearMobs}`);
  }
  if (hud.message) summary.push(`HUD message: ${hud.message.replace(/\s+/g, " ")}`);
  if (hud.screens) summary.push(`On screen: ${hud.screens.replace(/\s+/g, " ").slice(0, 300)}`);
  summary.push(`Page: ${page.url} at ${page.viewport.width}x${page.viewport.height} @${page.viewport.ratio}x${offline ? ", offline" : ""}`);
  summary.push(`Build: ${BUILD}; ${page.userAgent}`);
  if (errors + warnings > 0) summary.push(`Console lately: ${errors} errors, ${warnings} warnings (console.log)`);

  return { place, screen, summary, context, trace: game ? game.trace.join("\n") : "" };
}
