// The one camera: three-quarter, as A Link to the Past, Chrono Trigger and Final Fantasy VI draw a town or a room -
// pitched 45 degrees and stretched by 1/sin 45 degrees vertically, so a floor's texel is one pixel. A view is that
// camera at a turn (one of three headings, camera.ts) and a zoom (screen pixels to each scene pixel).

export interface View {
  /** Turn about the vertical, radians: 0 looks north (towards -z). */
  readonly yaw: number;
  /** Down from the horizon, radians. */
  readonly pitch: number;
  /** World units across one pixel, horizontally and vertically in the camera's frame. */
  readonly wppX: number;
  readonly wppY: number;
  /** Screen pixels to each of the scene's: the zoom. A whole number at rest. */
  readonly scale: number;
}

export const THREE_QUARTER: Omit<View, "scale"> = { yaw: 0, pitch: Math.PI / 4, wppX: 1 / 16, wppY: Math.SQRT1_2 / 16 };

export function blendViews(a: View, b: View, t: number): View {
  const k = t * t * (3 - 2 * t);
  const mix = (x: number, y: number) => x + (y - x) * k;
  return { yaw: mix(a.yaw, b.yaw), pitch: mix(a.pitch, b.pitch), wppX: mix(a.wppX, b.wppX), wppY: mix(a.wppY, b.wppY), scale: mix(a.scale, b.scale) };
}
