// The card layer (tech.md, B6): Cantrip's web client in its ?realm mode, framed over the overworld. It boots once, in
// the background, hidden; a card screen - a duel, the spell table, a vendor - is asked for with postMessage and the
// frame shown over the world until the client says the screen has closed. Only the frame's own origin is spoken to
// or listened to. Realm.js and RealmBridge.cs are the other side.

export type Screen = "duel" | "spell-table" | "vendor" | "loot" | "gear";

export interface Closed {
  readonly screen: Screen;
  /** How it closed: for a duel `won` or `lost`; otherwise `closed`, or `dismissed` / `replaced` when cut short. */
  readonly outcome: string;
  /** What the screen hands back, if anything: a duel's `log`, a loot pick's `picks`. */
  readonly result?: Readonly<Record<string, unknown>>;
}

/** The card screens, wherever they come from: the framed card layer, or the stand-in for when it is absent. */
export interface CardScreens {
  readonly isReady: boolean;
  /** The screen open now, or null. */
  readonly openScreen: Screen | null;
  /** Every screen asked for, in order, with what it was opened on (for tests: realmTest.layer). */
  readonly requests: readonly { readonly screen: Screen; readonly args: Readonly<Record<string, unknown>> }[];
  /** Called whenever the layer's state changes, for the HUD. */
  onChange: () => void;
  open(screen: Screen, args?: Record<string, unknown>): Promise<Closed>;
}

interface Waiting {
  readonly screen: Screen;
  readonly done: (closed: Closed) => void;
}

export class CardLayer implements CardScreens {
  readonly frame: HTMLIFrameElement;
  private readonly origin: string;
  private ready = false;
  private readonly readyWaiters: (() => void)[] = [];
  private readonly waiting = new Map<number, Waiting>();
  private nextId = 1;
  readonly requests: { screen: Screen; args: Record<string, unknown> }[] = [];

  /** Called whenever the layer's state changes, for the HUD. */
  onChange: () => void = () => {};

  constructor(url: string) {
    const address = new URL(url, window.location.href);
    address.searchParams.set("realm", "");
    this.origin = address.origin;

    this.frame = document.createElement("iframe");
    this.frame.className = "card-layer";
    this.frame.title = "Cards";
    this.frame.src = address.toString();
    this.frame.dataset.open = "false";
    document.body.appendChild(this.frame);

    window.addEventListener("message", (e) => this.hear(e));
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** The screen open now, or null. */
  get openScreen(): Screen | null {
    const first = this.waiting.values().next();
    return first.done ? null : first.value.screen;
  }

  /** Opens a card screen over the world, and resolves when it closes, with how. */
  async open(screen: Screen, args: Record<string, unknown> = {}): Promise<Closed> {
    this.requests.push({ screen, args });
    await this.whenReady();
    const id = this.nextId++;
    return new Promise<Closed>((resolve) => {
      this.waiting.set(id, { screen, done: resolve });
      this.frame.dataset.open = "true";
      this.frame.focus();
      this.post({ op: "open", id, screen, args });
      this.onChange();
    });
  }

  private whenReady(): Promise<void> {
    return this.ready ? Promise.resolve() : new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  private post(message: Record<string, unknown>): void {
    this.frame.contentWindow?.postMessage({ realm: 1, ...message }, this.origin);
  }

  private hear(e: MessageEvent): void {
    if (e.origin !== this.origin || e.source !== this.frame.contentWindow) {
      return;
    }
    const message = e.data as { realm?: number; op?: string; id?: number; screen?: Screen; outcome?: string; result?: Record<string, unknown> };
    if (message?.realm !== 1) {
      return;
    }

    switch (message.op) {
      case "ready":
        this.ready = true;
        this.readyWaiters.splice(0).forEach((resolve) => resolve());
        break;
      case "closed": {
        const waiting = message.id === undefined ? undefined : this.waiting.get(message.id);
        if (waiting) {
          this.waiting.delete(message.id!);
          waiting.done({ screen: waiting.screen, outcome: message.outcome ?? "closed", result: message.result });
        }
        if (this.waiting.size === 0) {
          this.frame.dataset.open = "false";
          window.focus();
        }
        break;
      }
    }
    this.onChange();
  }
}
