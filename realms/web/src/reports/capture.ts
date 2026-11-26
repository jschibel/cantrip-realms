// The picture a playtest report carries: the screen as the player saw it when they pressed F8 - the world's frame, drawn
// afresh and read before the browser shows it (the world's canvas keeps no frame once shown), and over it the card
// layer's own picture of itself where its frame stands, when a card screen is open (its page is another origin's, so
// only it can read its pixels: Realm.js). The HUD is the page's own elements, not pixels; its words go in the report's
// context instead (context.ts).

/** The longest side of the picture: a large screen's is scaled down to it. */
const LONGEST = 2560;

export interface Layered {
  /** The card layer's frame, and its picture of itself (a PNG data URL), when a card screen is open. */
  readonly frame: HTMLIFrameElement;
  readonly image: string;
}

/** Draws the world's frame now and reads it, as a PNG data URL; null if it cannot be read. */
export function worldPicture(canvas: HTMLCanvasElement, draw: () => void): string | null {
  try {
    draw();
    return canvas.toDataURL("image/png");
  } catch (e) {
    console.warn("[report] the world's frame could not be read", e);
    return null;
  }
}

const load = (src: string): Promise<HTMLImageElement> =>
  new Promise((done, fail) => {
    const image = new Image();
    image.onload = () => done(image);
    image.onerror = () => fail(new Error("unreadable image"));
    image.src = src;
  });

/**
 * The world's picture with the card layer's over it, each where it stands on the page, as one PNG data URL the size of
 * the window in device pixels (no longer than LONGEST); null with neither.
 */
export async function compose(world: { readonly canvas: HTMLCanvasElement; readonly image: string | null }, layered: Layered | null): Promise<string | null> {
  if (!world.image && !layered) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, LONGEST / Math.max(window.innerWidth, window.innerHeight));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(window.innerWidth * ratio));
  out.height = Math.max(1, Math.round(window.innerHeight * ratio));
  const g = out.getContext("2d");
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#111318";
  g.fillRect(0, 0, out.width, out.height);
  const place = async (src: string, rect: DOMRect) => {
    try {
      g.drawImage(await load(src), rect.left * ratio, rect.top * ratio, rect.width * ratio, rect.height * ratio);
    } catch (e) {
      console.warn("[report] a picture could not be drawn", e);
    }
  };
  if (world.image) await place(world.image, world.canvas.getBoundingClientRect());
  if (layered) await place(layered.image, layered.frame.getBoundingClientRect());
  return out.toDataURL("image/png");
}
