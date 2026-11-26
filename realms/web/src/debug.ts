import { type Overworld, describeJump, pointText } from "./game";
import { CHUNK } from "./world/format";

// The debug overlay (F3, or `?debug`; remembered in the browser): where the player is - the place, the chunk, their exact
// position and tile and the floor's height there - and the tile under the pointer, whether it is open or closed and
// how high its floor stands, and whether a step there from the player's tile would be a walk, a hop or none. While the
// player hops a ledge it says so (a hop is no jump). It lists the jumps of the player's figure the game has seen
// (game.ts `watchJumps`, which
// logs each with what passed between the page and the server before it, whether or not this is shown), the last few,
// newest first, with the place and both positions, so a teleport seen in play can be reported by its coordinates; and
// every walk the server refused (why, the tile it had the player on, and what the page did). A click on the overlay
// copies what it shows.

const STORE = "realms.debug";

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
      `        height ${f2(player.figure.root.position.y)}   floor ${f2(floor(p.x, p.z))}${player.hopping ? "   HOPPING" : ""}`,
    ];
    const under = pointer ? stage.floorTileAt(pointer.x, pointer.y) : null;
    const side = under && Math.max(Math.abs(under.x - t.x), Math.abs(under.z - t.z)) === 1;
    const step = !under || !side ? "" : !grid.canStep(t, under) ? "   no step" : grid.passes(t.x, t.z, under.x, under.z) ? "   a step" : "   a hop";
    lines.push(
      under
        ? `cursor  tile ${under.x},${under.z}   ${grid.walkable(under.x, under.z) ? "open" : "CLOSED"}   floor ${f2(floor(under.x + 0.5, under.z + 0.5))}${step}`
        : "cursor  -",
    );
    const jumps = game.jumps;
    lines.push(jumps.length ? "jumps (newest first):" : "jumps   none seen");
    for (const j of jumps) lines.push(`  ${j.at} ${j.place}: ${describeJump(j)}`);
    const refused = game.refusedWalks;
    lines.push(refused.length ? "walks refused (newest first):" : "refused none");
    for (const r of refused) lines.push(`  ${r.at} ${r.reason} server ${r.server ? pointText(r.server) : "-"}, figure ${pointText(r.here)}: ${r.did}`);
    lines.push("F3 hides this; click to copy");
    const text = lines.join("\n");
    if (panel.textContent !== text) panel.textContent = text;
  };
  requestAnimationFrame(draw);
}
