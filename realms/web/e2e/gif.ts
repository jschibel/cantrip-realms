// A small GIF89a writer for the look's walking clip (look.spec.ts): frames of RGBA pixels in at most 256 colors - the
// overworld draws in its palette, so a frame of it never has more - looped, each with its own delay. LZW as the format
// has it, with no quantizing: a color past the 256th is drawn as the nearest one already seen.

export interface GifFrame {
  readonly rgba: Uint8Array;
  /** Hundredths of a second this frame is shown. */
  readonly delay: number;
}

export function encodeGif(width: number, height: number, frames: readonly GifFrame[]): Buffer {
  const colors: number[] = [];
  const index = new Map<number, number>();
  const indexed = frames.map((f) => {
    const out = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const c = (f.rgba[i * 4]! << 16) | (f.rgba[i * 4 + 1]! << 8) | f.rgba[i * 4 + 2]!;
      let k = index.get(c);
      if (k === undefined) {
        if (colors.length < 256) {
          k = colors.length;
          colors.push(c);
        } else {
          k = nearest(colors, c);
        }
        index.set(c, k);
      }
      out[i] = k;
    }
    return out;
  });
  let bits = 1;
  while (1 << bits < Math.max(2, colors.length)) bits++;
  const table = 1 << bits;

  const bytes: number[] = [];
  const word = (n: number) => bytes.push(n & 0xff, (n >> 8) & 0xff);
  for (const ch of "GIF89a") bytes.push(ch.charCodeAt(0));
  word(width);
  word(height);
  bytes.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < table; i++) {
    const c = colors[i] ?? 0;
    bytes.push((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  }
  // Loop forever.
  bytes.push(0x21, 0xff, 11, ..."NETSCAPE2.0".split("").map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  frames.forEach((f, n) => {
    bytes.push(0x21, 0xf9, 4, 0x04, f.delay & 0xff, (f.delay >> 8) & 0xff, 0, 0);
    bytes.push(0x2c);
    word(0);
    word(0);
    word(width);
    word(height);
    bytes.push(0);
    const min = Math.max(2, bits);
    bytes.push(min);
    const data = lzw(indexed[n]!, min);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, i + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0);
  });
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

function nearest(colors: readonly number[], c: number): number {
  let best = 0;
  let distance = Infinity;
  colors.forEach((o, i) => {
    const dr = ((o >> 16) & 0xff) - ((c >> 16) & 0xff);
    const dg = ((o >> 8) & 0xff) - ((c >> 8) & 0xff);
    const db = (o & 0xff) - (c & 0xff);
    const d = dr * dr + dg * dg + db * db;
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}

function lzw(pixels: Uint8Array, min: number): Uint8Array {
  const clear = 1 << min;
  const end = clear + 1;
  const out: number[] = [];
  let buffer = 0;
  let filled = 0;
  let size = min + 1;
  const emit = (code: number) => {
    buffer |= code << filled;
    filled += size;
    while (filled >= 8) {
      out.push(buffer & 0xff);
      buffer >>>= 8;
      filled -= 8;
    }
  };
  let dictionary = new Map<number, number>();
  let next = end + 1;
  emit(clear);
  let prefix = pixels[0]!;
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]!;
    const key = (prefix << 8) | k;
    const found = dictionary.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dictionary.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dictionary = new Map();
      next = end + 1;
      size = min + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (filled > 0) out.push(buffer & 0xff);
  return Uint8Array.from(out);
}
