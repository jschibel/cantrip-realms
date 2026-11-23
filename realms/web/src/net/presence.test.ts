import { decode, encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { type ClientMessage, SocketPresence, type ServerMessage, decodeServer, encodeMessage } from "./presence";

class FakeSocket {
  static last: FakeSocket | null = null;
  binaryType = "blob";
  readyState = 0;
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(frame: Uint8Array): void {
    this.sent.push(frame);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: unknown): void {
    const bytes = encode(message);
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
}

const sentTypes = (s: FakeSocket) => s.sent.map((f) => (decode(f) as ClientMessage).Type);

describe("presence messages", () => {
  it("are MessagePack maps with a Type and PascalCase fields", () => {
    const move: ClientMessage = { Type: "Move", From: [1, 2], Path: [[2, 2], [3, 2]], Speed: 3.4 };
    expect(decode(encodeMessage(move))).toEqual(move);
  });

  it("decode the server's messages and ignore what they don't know", () => {
    const moved: ServerMessage = { Type: "Moved", Player: "discord-1", From: [0, 0], Path: [[1, 0]], Speed: 3.4, Since: "2026-11-23T00:00:00Z" };
    expect(decodeServer(encode(moved))).toEqual(moved);
    expect(decodeServer(encode({ Type: "Weather", Rain: true }))).toBeNull();
    expect(decodeServer(encode([1, 2]))).toBeNull();
  });
});

describe("SocketPresence", () => {
  const make = () => new SocketPresence("ws://realm/realm/ws", (url) => new FakeSocket(url) as unknown as WebSocket);

  it("sends Enter and Look once connected, and queues moves until then", () => {
    const presence = make();
    const socket = FakeSocket.last!;
    presence.send({ Type: "Enter", Map: "benalish-meadow" });
    presence.send({ Type: "Look", Body: "lithe", Palette: 2, Slots: {} });
    presence.send({ Type: "Move", From: [0, 0], Path: [[1, 0]], Speed: 3.4 });
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(sentTypes(socket)).toEqual(["Enter", "Look", "Move"]);
    presence.close();
  });

  it("hands every server message to onMessage", () => {
    const presence = make();
    const socket = FakeSocket.last!;
    const heard: ServerMessage[] = [];
    presence.onMessage = (m) => heard.push(m);
    socket.open();
    socket.receive({ Type: "Welcome", Instance: "benalish-meadow#1", Others: [] });
    socket.receive({ Type: "Left", Player: "discord-2" });
    expect(heard.map((m) => m.Type)).toEqual(["Welcome", "Left"]);
    presence.close();
  });
});
