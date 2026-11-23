// Presence (realms/docs/interfaces.md, "Presence"): the WebSocket at /realm/ws that shows the other players on your
// map instance walking, in their gear. Each frame is one MessagePack map: its `Type` names the message, the rest of
// its keys are the message's fields, PascalCase. Paths are sent, not frames - every client walks the others itself.
// Offline (?offline) the same messages go between the tabs of one browser over a BroadcastChannel, which stands in
// for the server's relay so two tabs see each other.

import { decode, encode } from "@msgpack/msgpack";

export type At = readonly [number, number];

export interface Look {
  readonly Body: string;
  readonly Palette: number;
  /** Each worn slot's look: the gear mesh and its colors. */
  readonly Slots: Readonly<Record<string, { readonly Mesh: string; readonly Palette: readonly string[] }>>;
}

export interface Other {
  readonly Player: string;
  readonly Name: string;
  readonly Identity: readonly string[];
  readonly Look: Look;
  /** Where the player's current walk began. */
  readonly At: At;
  /** The hexes of that walk, after `At`; empty when standing. */
  readonly Path: readonly At[];
  /** When the walk began, UTC ISO-8601. */
  readonly Since: string;
  /** The walk's speed, hexes a second. */
  readonly Speed: number;
}

export type ClientMessage =
  | { readonly Type: "Enter"; readonly Map: string }
  | { readonly Type: "Move"; readonly From: At; readonly Path: readonly At[]; readonly Speed: number }
  | ({ readonly Type: "Look" } & Look)
  | { readonly Type: "Emote"; readonly Emote: string };

export type ServerMessage =
  | { readonly Type: "Welcome"; readonly Instance: string; readonly Others: readonly Other[] }
  | ({ readonly Type: "Other" } & Other)
  | { readonly Type: "Moved"; readonly Player: string; readonly From: At; readonly Path: readonly At[]; readonly Speed: number; readonly Since: string }
  | { readonly Type: "Looked"; readonly Player: string; readonly Look: Look }
  | { readonly Type: "Emoted"; readonly Player: string; readonly Emote: string }
  | { readonly Type: "Left"; readonly Player: string }
  | { readonly Type: "Refused"; readonly At: At };

const SERVER_TYPES = new Set(["Welcome", "Other", "Moved", "Looked", "Emoted", "Left", "Refused"]);

export const encodeMessage = (message: ClientMessage | ServerMessage): Uint8Array => encode(message);

/** A server frame, or null for one that is not a message this client knows (a newer server's, say). */
export function decodeServer(bytes: ArrayBuffer | Uint8Array): ServerMessage | null {
  const value = decode(bytes) as { Type?: unknown } | null;
  if (typeof value !== "object" || value === null || typeof value.Type !== "string" || !SERVER_TYPES.has(value.Type)) return null;
  return value as ServerMessage;
}

export interface Presence {
  /** Called with every message from the relay. */
  onMessage: (message: ServerMessage) => void;
  /** Whether the relay is connected. */
  readonly connected: boolean;
  send(message: ClientMessage): void;
  close(): void;
}

/** The realm server's relay over a WebSocket, reconnecting when it drops; Enter and Look are sent again on reconnect. */
export class SocketPresence implements Presence {
  onMessage: (message: ServerMessage) => void = () => {};
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
      for (const again of [this.entered, this.looked]) if (again) socket.send(encodeMessage(again));
      for (const frame of this.queue.splice(0)) socket.send(frame);
    };
    socket.onmessage = (e: MessageEvent) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const message = decodeServer(e.data);
      if (message) this.onMessage(message);
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.closed) return;
      setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(this.retry * 2, 15000);
    };
    this.socket = socket;
  }

  send(message: ClientMessage): void {
    if (message.Type === "Enter") this.entered = message;
    if (message.Type === "Look") this.looked = message;
    const frame = encodeMessage(message);
    if (this.connected) this.socket!.send(frame);
    else if (message.Type !== "Enter" && message.Type !== "Look") this.queue.push(frame);
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }
}

interface Peer {
  readonly Player: string;
  readonly Name: string;
  readonly Identity: readonly string[];
}

/** What a tab tells the others offline: who it is, its map, and the message it would have sent the server. */
interface Broadcast extends Peer {
  readonly Map: string | null;
  readonly Message: ClientMessage | { readonly Type: "Hello" } | { readonly Type: "Bye" };
  readonly Look: Look | null;
  readonly At: At;
  readonly Path: readonly At[];
  readonly Speed: number;
  readonly Since: string;
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
  private since = new Date().toISOString();
  /** Which map each other tab is on. */
  private readonly others = new Map<string, string | null>();

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
        this.map = message.Map;
        this.path = [];
        this.onMessage({ Type: "Welcome", Instance: `offline:${message.Map}`, Others: [] });
        break;
      case "Move":
        this.at = message.From;
        this.path = message.Path;
        this.speed = message.Speed;
        this.since = new Date().toISOString();
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
