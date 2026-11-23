import type { CardScreens, Closed, Screen } from "./cardLayer";

// The card layer's stand-in, for when it is absent (?cards=stub, and ?offline with no ?cards): each screen is a
// small themed panel over the world that says what it was opened on and closes with the outcomes the overworld must
// handle - a duel won or lost, a loot pick taken or left - so the whole overworld can be played and tested without
// the Uno client. Every request is kept (realmTest.layer.requests), as the test double the e2e suite asserts on.

const TITLES: Record<Screen, string> = { duel: "Duel", "spell-table": "Spell table", vendor: "Vendor", loot: "Loot", gear: "Gear" };

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
        case "duel":
          button("Win", true, () => close("won", { log: [] }));
          button("Lose", false, () => close("lost", { log: [] }));
          break;
        case "loot": {
          // Takes what fits under the cap, cheapest first, as a player might.
          const offer = (args.offer as { Name: string; Gold: number }[] | undefined) ?? [];
          const cap = Number(args.cap ?? 0);
          let room = cap;
          const picks = [...offer].sort((a, b) => a.Gold - b.Gold).filter((card) => (card.Gold <= room ? ((room -= card.Gold), true) : false)).map((c) => c.Name);
          body.textContent += picks.length > 0 ? ` You can take: ${picks.join(", ")}.` : "";
          button("Take", true, () => close("closed", { picks }));
          button("Leave", false, () => close("closed", { picks: [] }));
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
      const mob = args.mob as { name?: string; tier?: number } | undefined;
      const duel = args.duel as { Cap?: number; AnteValue?: number } | undefined;
      return `A duel against the ${mob?.name ?? "mob"} (tier ${mob?.tier ?? "?"}). Ante ${duel?.AnteValue ?? 0} gold, prize cap ${duel?.Cap ?? 0}.`;
    }
    case "loot": {
      const offer = (args.offer as { Name: string; Gold: number }[] | undefined) ?? [];
      return `Offered: ${offer.map((c) => `${c.Name} (${c.Gold})`).join(", ") || "nothing"}. Cap ${String(args.cap ?? 0)}.`;
    }
    default:
      return String(args.name ?? args.id ?? "Opened from the overworld.");
  }
}
