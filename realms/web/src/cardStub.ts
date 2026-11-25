import type { CardScreens, Closed, Screen } from "./cardLayer";
import { mobInfo, theMob } from "./mobs";

// The card layer's stand-in, for when it is absent (?cards=stub, and ?offline with no ?cards): each screen is a
// small themed panel over the world that says what it was opened on and closes with the outcomes the overworld must
// handle - a duel won or lost (and the mob's life at its end), a deck sideboarded and play or draw chosen - so the whole
// overworld can be played and tested without the Uno client. Every request is kept (realmTest.layer.requests), as the test double the e2e suite asserts on.

const TITLES: Record<Screen, string> = { duel: "Duel", sideboard: "Sideboard", "spell-table": "Spell table", vendor: "Vendor", loot: "Gear found", gear: "Gear", inventory: "Inventory" };

/**
 * How the stand-in's duel ends when lost: the mob's life at its end, as the real card layer reads it from the game; null
 * for the life it began with (a flawless win). Tests set it (realmTest.duelEnd), as a scenario forces a position.
 */
export const stubDuel: { mobLife: number | null } = { mobLife: null };

export class StubCardLayer implements CardScreens {
  readonly isReady = true;
  readonly requests: { screen: Screen; args: Record<string, unknown> }[] = [];
  onChange: () => void = () => {};
  private open_: Screen | null = null;
  private readonly panel: HTMLElement;

  constructor() {
    this.panel = document.createElement("div");
    this.panel.className = "stub-layer";
    this.panel.hidden = true;
    document.body.appendChild(this.panel);
  }

  get openScreen(): Screen | null {
    return this.open_;
  }

  open(screen: Screen, args: Record<string, unknown> = {}): Promise<Closed> {
    this.requests.push({ screen, args });
    this.open_ = screen;
    this.onChange();
    return new Promise<Closed>((resolve) => {
      const close = (outcome: string, result?: Record<string, unknown>) => {
        this.panel.hidden = true;
        this.panel.replaceChildren();
        this.open_ = null;
        this.onChange();
        resolve({ screen, outcome, result });
      };
      const card = document.createElement("div");
      card.className = "stub-card panel-card";
      const title = document.createElement("h2");
      title.textContent = TITLES[screen];
      const body = document.createElement("p");
      body.textContent = describe(screen, args);
      const buttons = document.createElement("div");
      buttons.className = "buttons";
      const button = (caption: string, primary: boolean, onClick: () => void) => {
        const b = document.createElement("button");
        b.textContent = caption;
        b.className = primary ? "primary" : "";
        b.dataset.test = `layer:${caption.toLowerCase()}`;
        b.addEventListener("click", onClick);
        buttons.appendChild(b);
      };
      switch (screen) {
        case "duel": {
          const seats = (args.duel as { Seats?: { StartingLife?: number }[] } | undefined)?.Seats ?? [];
          const began = { player: seats[0]?.StartingLife ?? 20, mob: seats[1]?.StartingLife ?? 20 };
          button("Win", true, () => close("won", { log: [], life: { player: began.player, mob: 0 } }));
          button("Lose", false, () => close("lost", { log: [], life: { player: 0, mob: stubDuel.mobLife ?? began.mob } }));
          break;
        }
        case "sideboard": {
          // The deck as it was, swapped nothing; play or draw, the loser's choice.
          const deck = { main: args.main ?? [], sideboard: args.sideboard ?? [] };
          button("Play first", true, () => close("closed", { ...deck, playFirst: true }));
          button("Draw first", false, () => close("closed", { ...deck, playFirst: false }));
          break;
        }
        default:
          button("Close", true, () => close("closed"));
      }
      card.append(title, body, buttons);
      this.panel.replaceChildren(card);
      this.panel.hidden = false;
    });
  }
}

function describe(screen: Screen, args: Record<string, unknown>): string {
  switch (screen) {
    case "duel": {
      const mob = args.mob as { id?: string; name?: string; tier?: number } | undefined;
      const duel = args.duel as { Game?: number; Seats?: { StartingLife?: number }[] } | undefined;
      const hearts = args.hearts as { have?: number; hold?: number } | undefined;
      const who = mob?.id ? theMob(mobInfo(mob.id), false) : `the ${mob?.name ?? "mob"}`;
      return `A duel against ${who} (tier ${mob?.tier ?? "?"}), game ${duel?.Game ?? 1}: it begins at ${duel?.Seats?.[1]?.StartingLife ?? "?"} life. Hearts ${hearts?.have ?? "?"} of ${hearts?.hold ?? "?"}.`;
    }
    case "sideboard": {
      const count = (cards: unknown) => ((cards as { Count: number }[] | undefined) ?? []).reduce((n, c) => n + c.Count, 0);
      return `Game ${String(args.game ?? 2)} against ${String(args.mob ?? "the mob")}: a deck of ${count(args.main)}, a sideboard of ${count(args.sideboard)}.`;
    }
    case "loot": {
      const gear = args.gear as { Gear?: { Name?: string } } | null | undefined;
      return `${String(args.mob ?? "It")} left ${gear?.Gear?.Name ?? "nothing"}.`;
    }
    default:
      return String(args.name ?? args.id ?? "Opened from the overworld.");
  }
}
