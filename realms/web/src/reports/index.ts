// Playtest reports (realms/reports/README.md): F8 anywhere in the game - the world, a dialog, the character screen, a
// card screen (whose page passes its F8 up: Realm.js) - takes the screenshot and the state at once, before anything
// moves, then opens the report box (screens/report.ts) over everything; the world stands still while it is open. Sent,
// the report goes to the realm server (`POST /api/reports`, or offline the dev server: RealmApi.fileReport), which writes
// it as a folder of realms/reports for a later agent's session to read, triage and investigate.

import type { CardScreens } from "../cardLayer";
import type { Overworld } from "../game";
import type { RealmApi, ReportFiling } from "../net/api";
import { type ReportChoice, reportOpen, showReport } from "../screens/report";
import { compose, worldPicture } from "./capture";
import { BUILD, gather } from "./context";
import { consoleLog, networkLog } from "./logs";

/** The key that files a report. */
export const REPORT_KEY = "F8";

/** The area a report starts on, by what is showing. */
function areaFor(game: Overworld | null, card: string | null): string {
  if (card === "duel" || card === "sideboard") return "duels";
  if (card === "spell-table") return "decks";
  if (card === "vendor") return "shops";
  if (card === "loot" || card === "gear" || card === "inventory") return "gear";
  if (game?.run) return "dungeons";
  return "other";
}

/** Binds F8 (and the card layer's F8) to the report box. `game` is the overworld once it stands, null before. */
export function bindReports(api: RealmApi, layer: CardScreens, game: () => Overworld | null): void {
  let pointer: { x: number; y: number } | null = null;
  window.addEventListener("pointermove", (e) => (pointer = { x: e.clientX, y: e.clientY }), { passive: true });
  let busy = false;

  const report = async () => {
    if (busy || reportOpen()) return;
    busy = true;
    const g = game();
    try {
      // What is on screen now, before the box covers it or anything moves.
      const gathered = gather(g, layer, pointer, api.offline);
      const canvas = g?.canvas ?? document.querySelector<HTMLCanvasElement>("#world");
      const world = canvas && g?.stage ? worldPicture(canvas, () => g.stage.render()) : null;
      const snapshot = (await layer.snapshot?.()) ?? null;
      // Whether the card screen open is in the picture (a layer whose canvas could not be read is not).
      (gathered.context.cards as Record<string, unknown>).pictured = snapshot?.image != null;
      const frame = layer.frame;
      const picture = canvas
        ? await compose({ canvas, image: world }, snapshot?.image && frame ? { frame, image: snapshot.image } : null)
        : null;

      // The world stands still while the box is open, and its keys are the box's.
      const walking = g !== null && g.screen === "world" && !g.paused;
      if (walking) {
        g.paused = true;
        g.screen = "report";
      }
      const filed = await showReport({
        picture,
        area: areaFor(g, layer.openScreen),
        send: async (choice: ReportChoice) => (await api.fileReport(filing(choice, gathered, picture, snapshot?.log ?? ""))).Id,
      }).finally(() => {
        if (walking && g.screen === "report") {
          g.screen = "world";
          g.paused = false;
        }
      });
      if (filed) {
        console.info(`[report] filed as ${filed}`);
        g?.say("Thank you - your report was sent.");
      }
      // A card screen open behind the box takes the keys back.
      if (layer.openScreen) frame?.focus();
    } catch (e) {
      console.error("[report] the report box failed", e);
    } finally {
      busy = false;
    }
  };

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== REPORT_KEY || e.repeat) return;
      e.preventDefault();
      void report();
    },
    true,
  );
  const before = layer.onReport;
  layer.onReport = () => {
    before?.();
    window.focus();
    void report();
  };
}

/** The report as the server takes it, with what the player chose to send. */
export function filing(choice: ReportChoice, gathered: ReturnType<typeof gather>, picture: string | null, cards: string): ReportFiling {
  return {
    Kind: choice.kind,
    Severity: choice.severity,
    Area: choice.area,
    Title: choice.title,
    Description: choice.description,
    Screenshot: choice.screenshot ? picture : null,
    Place: gathered.place,
    Screen: gathered.screen,
    Build: BUILD,
    Summary: gathered.summary,
    Context: choice.logs ? gathered.context : { page: gathered.context.page },
    Console: choice.logs ? consoleLog.text() : "",
    Network: choice.logs ? networkLog.text() : "",
    Cards: choice.logs ? cards : "",
    Trace: choice.logs ? gathered.trace : "",
  };
}
