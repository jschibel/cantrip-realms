// The card layer (tech.md, B6): Cantrip's web client in its ?realm mode, framed over the overworld. It boots once, in
// the background, hidden; a card screen - a duel, the spell table, a vendor - is asked for with postMessage and the
// frame shown over the world until the client says the screen has closed. Only the frame's own origin is spoken to
// or listened to. Realm.js and RealmBridge.cs are the other side.

export type Screen = "duel" | "sideboard" | "spell-table" | "vendor" | "loot" | "gear" | "inventory";

/** A worn slot's look, as the card layer names it when it asks for a portrait. */
export type PortraitSlots = Readonly<Record<string, { readonly mesh: string; readonly palette: readonly string[] }>>;

export interface Closed {
  readonly screen: Screen;
  /** How it closed: for a duel `won` or `lost`; otherwise `closed`, or `dismissed` / `replaced` when cut short. */
  readonly outcome: string;
  /** What the screen hands back, if anything: a duel's `log` and its seats' `life` at the end, a sideboarding's deck. */
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
  /**
   * Draws the player wearing `slots`, as a PNG data URL, when the gear screen asks (`portrait`): the overworld's to set,
   * since only it draws figures. Unset, or null back, and the card layer shows the doll without its figure.
   */
  portrait?: (slots: PortraitSlots) => string | null;
  /** The frame the layer shows in, when it is a page of its own (the stand-in is the overworld's own elements). */
  readonly frame?: HTMLIFrameElement;
  /** Called when the player asks for a playtest report from inside the layer (F8 there: its keys are its own). */
  onReport?: () => void;
  /**
   * The layer's picture of itself as it shows now (a PNG data URL; null when it is not open or its canvas could not be
   * read) and its console lately, for a playtest report (reports/index.ts); null from a layer that cannot say.
   */
  snapshot?(): Promise<LayerSnapshot | null>;
  open(screen: Screen, args?: Record<string, unknown>): Promise<Closed>;
}

/** What the card layer says of itself for a playtest report. */
export interface LayerSnapshot {
  readonly image: string | null;
  readonly log: string;
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

  portrait?: (slots: PortraitSlots) => string | null;

  onReport?: () => void;

  /** The snapshots asked for and not yet answered, by id. */
  private readonly snapshots = new Map<number, (snapshot: LayerSnapshot | null) => void>();

  /**
   * `url` is the card layer's page; `server` the realm server, which the card layer calls for what happens inside a screen;
   * `art` where the card layer finds card art (the web client's ?art=: an address serving /art/{size}/{slug}.webp, or a
   * template), when not beside its own page.
   */
  constructor(url: string, server?: string, art?: string) {
    const address = new URL(url, window.location.href);
    address.searchParams.set("realm", "");
    if (server) address.searchParams.set("api", new URL(server, window.location.href).toString());
    if (art) address.searchParams.set("art", art.includes("{slug}") ? art : new URL(art, window.location.href).toString());
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

  /** Asks the layer for its picture and its console, giving up after `wait` ms (a layer still booting, or gone). */
  snapshot(wait = 2000): Promise<LayerSnapshot | null> {
    if (!this.ready) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.snapshots.delete(id);
        resolve(null);
      }, wait);
      this.snapshots.set(id, (snapshot) => {
        window.clearTimeout(timer);
        this.snapshots.delete(id);
        resolve(snapshot);
      });
      this.post({ op: "snapshot", id, args: { picture: this.frame.dataset.open === "true" } });
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
    const message = e.data as { realm?: number; op?: string; id?: number; screen?: Screen; outcome?: string; result?: Record<string, unknown>; slots?: PortraitSlots; image?: string | null; log?: string };
    if (message?.realm !== 1) {
      return;
    }

    switch (message.op) {
      case "ready":
        this.ready = true;
        this.readyWaiters.splice(0).forEach((resolve) => resolve());
        break;
      case "portrait": {
        // The gear screen asks for the figure wearing what it shows worn; the answer goes back under the same id.
        const image = this.portrait?.(message.slots ?? {}) ?? null;
        this.post({ op: "portrait", id: message.id, args: { image } });
        return;
      }
      case "report":
        // F8 pressed inside the layer, whose keys the world never hears.
        this.onReport?.();
        return;
      case "snapshot": {
        const answer = message.id === undefined ? undefined : this.snapshots.get(message.id);
        answer?.({ image: typeof message.image === "string" ? message.image : null, log: typeof message.log === "string" ? message.log : "" });
        return;
      }
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

/**
 * The card screens of offline play (the in-memory API, no realm server): a duel is played, its deck sideboarded and its
 * gear shown in the real card layer, which needs no server for any of them - the duel is dealt on the rules engine in its
 * page, and only checking it would need the server - while the screens that trade and save through the server's API (the
 * spell table, vendors, gear) are the stand-in's.
 */
export class OfflineCardLayer implements CardScreens {
  private static readonly REAL: ReadonlySet<Screen> = new Set<Screen>(["duel", "sideboard", "loot"]);
  readonly requests: { screen: Screen; args: Record<string, unknown> }[] = [];
  private changed: () => void = () => {};

  constructor(
    readonly real: CardLayer,
    private readonly stub: CardScreens,
  ) {
    real.onChange = () => this.changed();
    stub.onChange = () => this.changed();
  }

  get onChange(): () => void {
    return this.changed;
  }

  set onChange(listener: () => void) {
    this.changed = listener;
  }

  get isReady(): boolean {
    return this.real.isReady;
  }

  /** The overworld's portraits, for whichever card layer asks. */
  get portrait(): ((slots: PortraitSlots) => string | null) | undefined {
    return this.real.portrait;
  }

  set portrait(draw: ((slots: PortraitSlots) => string | null) | undefined) {
    this.real.portrait = draw;
    this.stub.portrait = draw;
  }

  get openScreen(): Screen | null {
    return this.real.openScreen ?? this.stub.openScreen;
  }

  get frame(): HTMLIFrameElement {
    return this.real.frame;
  }

  get onReport(): (() => void) | undefined {
    return this.real.onReport;
  }

  set onReport(listener: (() => void) | undefined) {
    this.real.onReport = listener;
  }

  snapshot(): Promise<LayerSnapshot | null> {
    return this.real.snapshot();
  }

  open(screen: Screen, args: Record<string, unknown> = {}): Promise<Closed> {
    this.requests.push({ screen, args });
    return (OfflineCardLayer.REAL.has(screen) ? this.real : this.stub).open(screen, args);
  }
}
