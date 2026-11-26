// Pictures of the world from straight above, for looking at while tuning the generator and for the overview maps under
// realms/web/e2e/screenshots/world2/: a tile a pixel (or several), each in its surface's color, scenery darker, buildings
// and walls, roads, doors, entrances, spawns by tier, and with `zones` each tier's zone tinted. Written as PNG with no
// dependency but node's zlib.

import { deflateSync } from "node:zlib";

/** A picture being drawn: RGB, row by row. */
export class Picture {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height * 3);
  }

  set(x: number, y: number, rgb: readonly [number, number, number], alpha = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (Math.floor(y) * this.width + Math.floor(x)) * 3;
    for (let c = 0; c < 3; c++) this.pixels[o + c] = Math.round(this.pixels[o + c]! * (1 - alpha) + rgb[c]! * alpha);
  }

  fill(x0: number, y0: number, w: number, h: number, rgb: readonly [number, number, number], alpha = 1): void {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.height, Math.ceil(y0 + h)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.width, Math.ceil(x0 + w)); x++) this.set(x, y, rgb, alpha);
  }

  /** A hollow square, its middle at (x, y). */
  ring(x: number, y: number, r: number, rgb: readonly [number, number, number]): void {
    for (let t = -r; t <= r; t++) {
      this.set(x + t, y - r, rgb);
      this.set(x + t, y + r, rgb);
      this.set(x - r, y + t, rgb);
      this.set(x + r, y + t, rgb);
    }
  }

  png(): Buffer {
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 3 + 1)] = 0;
      Buffer.from(this.pixels.buffer, this.pixels.byteOffset + y * this.width * 3, this.width * 3).copy(raw, y * (this.width * 3 + 1) + 1);
    }
    const chunk = (type: string, data: Buffer) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([length, body, crc]);
    };
    const head = Buffer.alloc(13);
    head.writeUInt32BE(this.width, 0);
    head.writeUInt32BE(this.height, 4);
    head[8] = 8;
    head[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
  }
}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const b of data) c = TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const hex = (s: string): [number, number, number] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** Each surface's color on the map. */
export const SURFACE_COLORS: Readonly<Record<string, [number, number, number]>> = Object.fromEntries(
  Object.entries({
    "": "#000000",
    grass: "#5a8538",
    meadow: "#86ab4a",
    cobbles: "#9a9eaa",
    flagstones: "#c4bfb2",
    dirt: "#9a6c45",
    straw: "#c8a850",
    furrows: "#7a5434",
    wheat: "#d6b860",
    stream: "#3f7ab0",
    floorboards: "#8f6340",
    hearthstone: "#7a6a60",
    "forest-floor": "#3e5a2a",
    moss: "#4c6a34",
    mud: "#4a3a2a",
    bog: "#2c3a2e",
    snow: "#eeeef2",
    ice: "#bcdcea",
    tundra: "#9aa488",
    rock: "#77777f",
    scree: "#9a948a",
    sand: "#d8c08a",
    sea: "#16304a",
    shallows: "#2f6488",
    lava: "#e86a3a",
    ash: "#4f5363",
    "cracked-earth": "#8a7660",
    road: "#c9a978",
    planks: "#a07850",
    "phyrexian-ground": "#2a2230",
    dunes: "#d8a860",
    badlands: "#a0503a",
    highland: "#7a7a48",
    "jungle-floor": "#2e4a2a",
  }).map(([k, v]) => [k, hex(v)]),
);

export const TIER_COLORS: readonly [number, number, number][] = [hex("#000000"), hex("#3e9a4a"), hex("#e0c040"), hex("#e07a30"), hex("#c8302c")];
export const rgb = hex;
