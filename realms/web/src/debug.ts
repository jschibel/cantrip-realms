import type { Overworld } from "./game";
import { CHUNK } from "./world/format";

// The debug overlay (F3, or `?debug`; remembered in the browser): where the player is - the place, the chunk, their exact
// position and tile and the floor's height there - and the tile under the pointer, whether it is open or closed and
// how high its floor stands. Each frame it also watches the player's figure for a jump: a move in one frame further
// than a walk could take it (`JUMP`), or a sudden rise or drop (`DROP`). Each jump is listed (the last few, newest
// first, with the place and both positions) and logged to the console, so a teleport seen in play can be reported by
// its coordinates. A click on the overlay copies what it shows.

/** A move in one frame further than this (world units, a tile being one) is a jump: a walk covers about 0.06. */
const JUMP = 0.6;
/** A change of height in one frame larger than this is a jump: a step eases in. */
const DROP = 0.3;
const KEEP = 6;
const STORE = "realms.debug";

interface Jump {
  readonly at: string;
  readonly place: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
}

const f2 = (n: number) => n.toFixed(2);

export function bindDebug(game: Overworld): void {
  const stage = game.stage;
  const panel = document.createElement("pre");
  panel.id = "debug-overlay";
  panel.dataset.test = "debug";
  panel.title = "Click to copy";
  document.body.appendChild(panel);

  let shown = new URLSearchParams(window.location.search).has("debug") || localStorage.getItem(STORE) === "1";
  const show = (on: boolean) => {
    shown = on;
    panel.hidden = !on;
    localStorage.setItem(STORE, on ? "1" : "0");
  };
  show(shown);
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F3" || e.repeat) return;
    e.preventDefault();
    show(!shown);
  });
  panel.addEventListener("click", () => void navigator.clipboard?.writeText(panel.textContent ?? ""));

  let pointer: { x: number; y: number } | null = null;
  game.canvas.addEventListener("pointermove", (e) => (pointer = { x: e.clientX, y: e.clientY }));
  game.canvas.addEventListener("pointerleave", () => (pointer = null));

  const jumps: Jump[] = [];
  let last: { place: string; x: number; y: number; z: number } | null = null;
  const after = stage.afterTick;
  stage.afterTick = (dt) => {
    after(dt);
    const p = stage.player.figure.root.position;
    const place = stage.current.id;
    if (last && last.place === place && !stage.transition) {
      const flat = Math.hypot(p.x - last.x, p.z - last.z);
      const rise = Math.abs(p.y - last.y);
      if (flat > JUMP || rise > DROP) {
        const jump: Jump = { at: new Date().toLocaleTimeString(), place, from: [last.x, last.y, last.z], to: [p.x, p.y, p.z] };
        jumps.unshift(jump);
        jumps.length = Math.min(jumps.length, KEEP);
        console.warn(`[realm debug] jump in ${place}: ${describe(jump)}`);
      }
    }
    last = { place, x: p.x, y: p.y, z: p.z };
  };

  const describe = (j: Jump) =>
    `${f2(j.from[0])},${f2(j.from[2])} (tile ${Math.floor(j.from[0])},${Math.floor(j.from[2])}) -> ${f2(j.to[0])},${f2(j.to[2])} (tile ${Math.floor(j.to[0])},${Math.floor(j.to[2])}), ` +
    `moved ${f2(Math.hypot(j.to[0] - j.from[0], j.to[2] - j.from[2]))}, height ${f2(j.from[1])} -> ${f2(j.to[1])}`;

  const draw = () => {
    requestAnimationFrame(draw);
    if (!shown) return;
    const spot = stage.current;
    const grid = spot.grid;
    const player = stage.player;
    const p = player.position;
    const t = player.tile;
    const floor = (x: number, z: number) => (spot.floorAt ? spot.floorAt(x, z) : grid.heightAt(Math.floor(x), Math.floor(z)));
    const lines = [
      `place   ${spot.id}${spot.streamer ? `   chunk ${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}` : ""}`,
      `player  ${f2(p.x)}, ${f2(p.z)}   tile ${t.x},${t.z}   ${grid.walkable(t.x, t.z) ? "open" : "CLOSED"}`,
      `        height ${f2(player.figure.root.position.y)}   floor ${f2(floor(p.x, p.z))}`,
    ];
    const under = pointer ? stage.floorTileAt(pointer.x, pointer.y) : null;
    lines.push(
      under
        ? `cursor  tile ${under.x},${under.z}   ${grid.walkable(under.x, under.z) ? "open" : "CLOSED"}   floor ${f2(floor(under.x + 0.5, under.z + 0.5))}`
        : "cursor  -",
    );
    lines.push(jumps.length ? "jumps (newest first):" : "jumps   none seen");
    for (const j of jumps) lines.push(`  ${j.at} ${j.place}: ${describe(j)}`);
    lines.push("F3 hides this; click to copy");
    const text = lines.join("\n");
    if (panel.textContent !== text) panel.textContent = text;
  };
  requestAnimationFrame(draw);
}
