// Presence (realms/docs/interfaces.md, "Presence"): the WebSocket at /realm/ws that shows the other players on your
// map instance walking, in their gear. Each frame is one MessagePack union, `[key, {Field: value, ...}]`, as
// Cantrip.Protocol's messages are: the key names the message (the tables below), the map holds its fields by name,
// PascalCase. A time is Unix milliseconds on the server's clock. Paths are sent, not frames - every client walks the
// others itself. Offline (?offline) the same messages go between the tabs of one browser over a BroadcastChannel,
// which stands in for the server's relay so two tabs see each other.

import { decode, encode } from "@msgpack/msgpack";

export type At = readonly [number, number];

/** A worn item's look in one slot: its gear mesh and its colors. */
export interface SlotLook {
  readonly Mesh: string;
  readonly Palette: readonly string[];
}

export interface Look {
  /** A body: lithe, broad, tall or stocky. */
  readonly Body: string;
  readonly Palette: number;
  /** Each worn slot's look. */
  readonly Slots: Readonly<Record<string, SlotLook>>;
}

export interface Other {
  /** A number for the connection, never the player's account. */
  readonly Player: number;
  readonly Name: string;
  /** The player's colors, as letters in WUBRG order. */
  readonly Identity: string;
  readonly Look: Look;
  /** Where the player's current walk began. */
  readonly At: At;
  /** The hexes of that walk, after `At`; empty when standing. */
  readonly Path: readonly At[];
  /** When the walk began, Unix milliseconds on the server's clock. */
  readonly Since: number;
  /** The walk's speed, hexes a second. */
  readonly Speed: number;
}

export type ClientMessage =
  | { readonly Type: "Enter"; readonly Space: string }
  | { readonly Type: "Move"; readonly From: At; readonly Path: readonly At[]; readonly Speed: number }
  | ({ readonly Type: "Look" } & Look)
  | { readonly Type: "Emote"; readonly Emote: string };

export type ServerMessage =
  | { readonly Type: "Welcome"; readonly Instance: number; readonly Player: number; readonly Others: readonly Other[] }
  | ({ readonly Type: "Other" } & Other)
  | { readonly Type: "Moved"; readonly Player: number; readonly From: At; readonly Path: readonly At[]; readonly Speed: number; readonly Since: number }
  | { readonly Type: "Looked"; readonly Player: number; readonly Look: Look }
  | { readonly Type: "Emoted"; readonly Player: number; readonly Emote: string }
  | { readonly Type: "Left"; readonly Player: number }
  | { readonly Type: "Refused"; readonly Reason: string; readonly At: At };

/** The union keys of each side's messages (interfaces.md, "Presence"). */
export const CLIENT_KEYS: Readonly<Record<ClientMessage["Type"], number>> = { Enter: 0, Move: 1, Look: 2, Emote: 3 };
export const SERVER_KEYS: Readonly<Record<ServerMessage["Type"], number>> = { Welcome: 0, Other: 1, Moved: 2, Looked: 3, Emoted: 4, Left: 5, Refused: 6 };
const CLIENT_TYPES = new Map(Object.entries(CLIENT_KEYS).map(([type, k]) => [k, type]));
const SERVER_TYPES = new Map(Object.entries(SERVER_KEYS).map(([type, k]) => [k, type]));

const frame = (key: number, message: { readonly Type: string }): Uint8Array => {
  const { Type: _, ...fields } = message;
  return encode([key, fields]);
};

/** A client message as a frame: `[key, {fields}]`. */
export const encodeClient = (message: ClientMessage): Uint8Array => frame(CLIENT_KEYS[message.Type], message);

/** A server message as a frame (what the offline relay and the tests make). */
export const encodeServer = (message: ServerMessage): Uint8Array => frame(SERVER_KEYS[message.Type], message);

function decodeUnion<T>(bytes: ArrayBuffer | Uint8Array, types: ReadonlyMap<number, string>): T | null {
  let value: unknown;
  try {
    value = decode(bytes);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number") return null;
  const type = types.get(value[0]);
  const fields: unknown = value[1];
  if (!type || typeof fields !== "object" || fields === null || Array.isArray(fields)) return null;
  return { ...(fields as Record<string, unknown>), Type: type } as T;
}

/** A server frame, or null for one that is not a message this client knows (a newer server's, say). */
export const decodeServer = (bytes: ArrayBuffer | Uint8Array): ServerMessage | null => decodeUnion<ServerMessage>(bytes, SERVER_TYPES);

/** A client frame, or null for one that is none. */
export const decodeClient = (bytes: ArrayBuffer | Uint8Array): ClientMessage | null => decodeUnion<ClientMessage>(bytes, CLIENT_TYPES);

export interface Presence {
  /** Called with every message from the relay. */
  onMessage: (message: ServerMessage) => void;
  /** Whether the relay is connected. */
  readonly connected: boolean;
  /** Called when the connection opens (again) or drops: for the page's trace of what passed (game.ts `note`). */
  onConnection?: (open: boolean) => void;
  send(message: ClientMessage): void;
  close(): void;
}

/** The realm server's relay over a WebSocket, reconnecting when it drops; Enter and Look are sent again on reconnect. */
export class SocketPresence implements Presence {
  onMessage: (message: ServerMessage) => void = () => {};
  onConnection: (open: boolean) => void = () => {};
  private socket: WebSocket | null = null;
  private readonly queue: Uint8Array[] = [];
  private entered: ClientMessage | null = null;
  private looked: ClientMessage | null = null;
  private closed = false;
  private retry = 500;

  constructor(
    private readonly url: string,
    private readonly makeSocket: (url: string) => WebSocket = (u) => new WebSocket(u),
  ) {
    this.open();
  }

  get connected(): boolean {
    return this.socket?.readyState === 1;
  }

  private open(): void {
    const socket = this.makeSocket(this.url);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      this.retry = 500;
      this.onConnection(true);
      for (const again of [this.entered, this.looked]) if (again) socket.send(encodeClient(again));
      for (const queued of this.queue.splice(0)) socket.send(queued);
    };
    socket.onmessage = (e: MessageEvent) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const message = decodeServer(e.data);
      if (message) this.onMessage(message);
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.closed) return;
      this.onConnection(false);
      setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(this.retry * 2, 15000);
    };
    this.socket = socket;
  }

  send(message: ClientMessage): void {
    if (message.Type === "Enter") {
      this.entered = message;
      // Walks queued on the map before are no walks on this one.
      this.queue.length = 0;
    }
    if (message.Type === "Look") this.looked = message;
    const encoded = encodeClient(message);
    if (this.connected) this.socket!.send(encoded);
    else if (message.Type !== "Enter" && message.Type !== "Look") this.queue.push(encoded);
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }
}

interface Peer {
  readonly Player: number;
  readonly Name: string;
  readonly Identity: string;
}

/** What a tab tells the others offline: who it is, its map, and the message it would have sent the server. */
interface Broadcast extends Peer {
  readonly Map: string | null;
  readonly Message: ClientMessage | { readonly Type: "Hello" } | { readonly Type: "Bye" };
  readonly Look: Look | null;
  readonly At: At;
  readonly Path: readonly At[];
  readonly Speed: number;
  readonly Since: number;
}

/**
 * The relay for ?offline: the tabs of one browser tell each other what they would tell the server, and each turns
 * what it hears into what the server would have sent it - an Other when a tab enters its map, Moved, Looked, Left.
 */
export class LocalPresence implements Presence {
  onMessage: (message: ServerMessage) => void = () => {};
  readonly connected = true;
  private readonly channel: BroadcastChannel;
  private map: string | null = null;
  private look: Look | null = null;
  private at: At = [0, 0];
  private path: readonly At[] = [];
  private speed = 0;
  private since = Date.now();
  /** Which map each other tab is on. */
  private readonly others = new Map<number, string | null>();

  constructor(
    private readonly me: Peer,
    name = "cantrip-realms-presence",
  ) {
    this.channel = new BroadcastChannel(name);
    this.channel.onmessage = (e: MessageEvent) => this.hear(e.data as Uint8Array);
    window.addEventListener("pagehide", () => this.close());
  }

  private tell(message: Broadcast["Message"]): void {
    const broadcast: Broadcast = { ...this.me, Map: this.map, Message: message, Look: this.look, At: this.at, Path: this.path, Speed: this.speed, Since: this.since };
    this.channel.postMessage(encode(broadcast));
  }

  private other(b: Broadcast): Other {
    return { Player: b.Player, Name: b.Name, Identity: b.Identity, Look: b.Look ?? { Body: "lithe", Palette: 0, Slots: {} }, At: b.At, Path: b.Path, Since: b.Since, Speed: b.Speed };
  }

  private hear(bytes: Uint8Array): void {
    const b = decode(bytes) as Broadcast;
    if (b.Player === this.me.Player) return;
    const was = this.others.get(b.Player) ?? null;
    this.others.set(b.Player, b.Map);
    const here = this.map !== null && b.Map === this.map;
    if (was === this.map && this.map !== null && !here) {
      this.onMessage({ Type: "Left", Player: b.Player });
      return;
    }
    if (!here) return;
    const m = b.Message;
    if (was !== this.map || m.Type === "Hello" || m.Type === "Enter") {
      this.onMessage({ Type: "Other", ...this.other(b) });
      // Whoever just came in needs to hear about us too.
      if (m.Type === "Hello" || m.Type === "Enter") this.tell({ Type: "Look", ...(this.look ?? { Body: "lithe", Palette: 0, Slots: {} }) });
      return;
    }
    switch (m.Type) {
      case "Move":
        this.onMessage({ Type: "Moved", Player: b.Player, From: m.From, Path: m.Path, Speed: m.Speed, Since: b.Since });
        break;
      case "Look":
        this.onMessage({ Type: "Looked", Player: b.Player, Look: { Body: m.Body, Palette: m.Palette, Slots: m.Slots } });
        break;
      case "Emote":
        this.onMessage({ Type: "Emoted", Player: b.Player, Emote: m.Emote });
        break;
      case "Bye":
        this.onMessage({ Type: "Left", Player: b.Player });
        break;
    }
  }

  send(message: ClientMessage): void {
    switch (message.Type) {
      case "Enter":
        this.map = message.Space;
        this.path = [];
        this.onMessage({ Type: "Welcome", Instance: 1, Player: this.me.Player, Others: [] });
        break;
      case "Move":
        this.at = message.From;
        this.path = message.Path;
        this.speed = message.Speed;
        this.since = Date.now();
        break;
      case "Look":
        this.look = { Body: message.Body, Palette: message.Palette, Slots: message.Slots };
        break;
      case "Emote":
        break;
    }
    this.tell(message);
  }

  close(): void {
    this.tell({ Type: "Bye" });
    this.map = null;
    this.channel.close();
  }
}
