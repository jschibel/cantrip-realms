import { decode, encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { type ClientMessage, SocketPresence, type ServerMessage, decodeClient, decodeServer, encodeClient, encodeServer } from "./presence";

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
  receive(message: ServerMessage): void {
    const bytes = encodeServer(message);
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
}

const sentTypes = (s: FakeSocket) => s.sent.map((f) => decodeClient(f)?.Type);
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("presence messages", () => {
  it("are MessagePack unions, [key, {Field: value}], as the server's are", () => {
    const move: ClientMessage = { Type: "Move", From: [1, 2], Path: [[2, 2], [3, 2]], Speed: 3.4 };
    expect(decode(encodeClient(move))).toEqual([1, { From: [1, 2], Path: [[2, 2], [3, 2]], Speed: 3.4 }]);
    expect(decodeClient(encodeClient(move))).toEqual(move);

    // Byte for byte what the server's MessagePack makes of the same messages (PresenceTests checks these too).
    expect(hex(encodeClient({ Type: "Enter", Map: "benalish-meadow" }))).toBe("920081a34d6170af62656e616c6973682d6d6561646f77");
    expect(hex(encodeClient({ Type: "Move", From: [0, 0], Path: [[1, 0]], Speed: 3.5 }))).toBe("920183a446726f6d920000a45061746891920100a55370656564cb400c000000000000");
  });

  it("decode the server's messages by their keys and ignore what they don't know", () => {
    const moved: ServerMessage = { Type: "Moved", Player: 2, From: [0, 0], Path: [[1, 0]], Speed: 3.4, Since: 1795000000000 };
    expect(decodeServer(encodeServer(moved))).toEqual(moved);
    expect(decodeServer(encode([6, { Reason: "Nobody can stand there.", At: [3, -1] }]))).toEqual({ Type: "Refused", Reason: "Nobody can stand there.", At: [3, -1] });
    expect(decodeServer(encode([9, { Rain: true }]))).toBeNull();
    expect(decodeServer(encode({ Type: "Moved" }))).toBeNull();
    expect(decodeServer(encode([1, 2]))).toBeNull();
    expect(decodeServer(new Uint8Array([0xc1]))).toBeNull();
  });
});

describe("SocketPresence", () => {
  const make = () => new SocketPresence("ws://realm/realm/ws", (url) => new FakeSocket(url) as unknown as WebSocket);

  it("sends Enter and Look once connected, and queues moves until then", () => {
    const presence = make();
    const socket = FakeSocket.last!;
    presence.send({ Type: "Enter", Map: "benalish-meadow" });
    presence.send({ Type: "Look", Body: "lithe", Palette: 2, Slots: { head: { Mesh: "helm", Palette: ["#9aa0aa"] } } });
    presence.send({ Type: "Move", From: [0, 0], Path: [[1, 0]], Speed: 3.4 });
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(sentTypes(socket)).toEqual(["Enter", "Look", "Move"]);
    expect(decode(socket.sent[1]!)).toEqual([2, { Body: "lithe", Palette: 2, Slots: { head: { Mesh: "helm", Palette: ["#9aa0aa"] } } }]);
    presence.close();
  });

  it("hands every server message to onMessage", () => {
    const presence = make();
    const socket = FakeSocket.last!;
    const heard: ServerMessage[] = [];
    presence.onMessage = (m) => heard.push(m);
    socket.open();
    socket.receive({ Type: "Welcome", Instance: 1, Player: 7, Others: [] });
    socket.receive({ Type: "Left", Player: 3 });
    expect(heard).toEqual([
      { Type: "Welcome", Instance: 1, Player: 7, Others: [] },
      { Type: "Left", Player: 3 },
    ]);
    presence.close();
  });
});
