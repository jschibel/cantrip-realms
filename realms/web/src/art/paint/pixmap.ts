// A small RGBA pixel buffer that the slice's pixel art is painted into by code (textures.ts, characters.ts), and a
// seeded random source so every texture comes out the same on every load. Painting wraps at the edges, so a tileable
// texture's strokes carry over its seams.

/** A color as 0xRRGGBB. */
export type Rgb = number;

export function rgb(hex: string): Rgb {
  return parseInt(hex.slice(1), 16);
}

/** Mulberry32: a fast seeded generator, plenty for scattering stones and tufts. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of integer coordinates to [0, 1), for per-texel variation that does not depend on painting order. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Pixmap {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill?: Rgb,
  ) {
    this.data = new Uint8Array(width * height * 4);
    if (fill !== undefined) this.fill(fill);
  }

  private index(x: number, y: number): number {
    const wx = ((Math.floor(x) % this.width) + this.width) % this.width;
    const wy = ((Math.floor(y) % this.height) + this.height) % this.height;
    return (wy * this.width + wx) * 4;
  }

  fill(color: Rgb, alpha = 255): this {
    for (let i = 0; i < this.width * this.height; i++) {
      this.data[i * 4] = (color >> 16) & 0xff;
      this.data[i * 4 + 1] = (color >> 8) & 0xff;
      this.data[i * 4 + 2] = color & 0xff;
      this.data[i * 4 + 3] = alpha;
    }
    return this;
  }

  /** Sets one texel, wrapping round the edges. */
  set(x: number, y: number, color: Rgb, alpha = 255): void {
    const i = this.index(x, y);
    this.data[i] = (color >> 16) & 0xff;
    this.data[i + 1] = (color >> 8) & 0xff;
    this.data[i + 2] = color & 0xff;
    this.data[i + 3] = alpha;
  }

  /** Sets one texel only inside the buffer (no wrapping): for painting faces of a model, which do not tile. */
  put(x: number, y: number, color: Rgb, alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.set(x, y, color, alpha);
  }

  get(x: number, y: number): Rgb {
    const i = this.index(x, y);
    return (this.data[i]! << 16) | (this.data[i + 1]! << 8) | this.data[i + 2]!;
  }

  alpha(x: number, y: number): number {
    return this.data[this.index(x, y) + 3]!;
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb, alpha = 255): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color, alpha);
  }

  /** A rectangle clipped to the buffer. */
  box(x: number, y: number, w: number, h: number, color: Rgb, alpha = 255): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, color, alpha);
  }

  hline(x: number, y: number, w: number, color: Rgb): void {
    for (let i = 0; i < w; i++) this.set(x + i, y, color);
  }

  vline(x: number, y: number, h: number, color: Rgb): void {
    for (let j = 0; j < h; j++) this.set(x, y + j, color);
  }

  /** Copies another buffer in at a place (clipped), skipping its transparent texels. */
  blit(src: Pixmap, x: number, y: number): void {
    for (let j = 0; j < src.height; j++) {
      for (let i = 0; i < src.width; i++) {
        const a = src.alpha(i, j);
        if (a > 0) this.put(x + i, y + j, src.get(i, j), a);
      }
    }
  }

  /** Copies a region of another buffer in (clipped), opaque. */
  copy(src: Pixmap, sx: number, sy: number, w: number, h: number, x: number, y: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, src.get(sx + i, sy + j), src.alpha(sx + i, sy + j));
  }
}
