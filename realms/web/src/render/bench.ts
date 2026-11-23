import type { Tile } from "../world/grid";
import type { Heading } from "./camera";
import type { Stage } from "./stage";

// The renderer's benchmark: a scripted walk through the world on the manual clock - the same steps every run - each
// frame timed from the game's tick to the GPU having finished drawing it (`gl.finish`), so the time is the whole frame's
// work, CPU and GPU, one frame at a time. Streaming builds on its real budget (milliseconds a frame) while it runs, so
// chunks coming in show in the frame times as they would in play. A leg is a walk through waypoints at a heading and a
// zoom step; the report gives each leg's frame times (mean, percentiles, worst), its draw calls and triangles, and the
// streaming's worst frame.

export interface BenchLeg {
  readonly name: string;
  /** Walked in turn, each by the shortest way from where the last ended. */
  readonly waypoints: readonly Tile[];
  readonly heading: Heading;
  readonly zoom: number;
  /** Turn the camera one way and back while walking (a heading's swing is a turn's worst frames). */
  readonly turning?: boolean;
}

export interface LegReport {
  readonly name: string;
  readonly frames: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly worstMs: number;
  /** Frames over 16.7 ms: a dropped frame at 60 Hz. */
  readonly over16: number;
  readonly calls: { readonly mean: number; readonly max: number };
  readonly triangles: { readonly mean: number; readonly max: number };
  /** The most a frame spent building chunks, ms. */
  readonly worstBuildMs: number;
  /** The longest single step of building so far, and what it was. */
  readonly worstStep: string;
  readonly chunksBuilt: number;
  readonly scenePixels: string;
  /** Waypoints it found no way to (none, in a good run). */
  readonly missed: readonly string[];
}

const pct = (sorted: readonly number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

/**
 * Lets the page's own work run between frames - a chunk's file read, a room's - as it would between animation frames:
 * a turn of the event loop, never a wait on the clock.
 */
export function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => resolve();
    c.port2.postMessage(0);
  });
}

/** Runs the legs one after another and reports each. `maxFrames` bounds a leg (a waypoint not reached in time is left). */
export async function runBench(stage: Stage, legs: readonly BenchLeg[], maxFrames = 4000): Promise<LegReport[]> {
  const gl = stage.renderer.renderer.getContext();
  const reports: LegReport[] = [];
  const wasManual = stage.manual;
  stage.manual = false;
  for (const leg of legs) {
    while (stage.rig.heading !== leg.heading) stage.turn(stage.rig.heading < leg.heading ? 1 : -1);
    while (stage.rig.zoom !== leg.zoom && stage.zoomBy(stage.rig.zoom < leg.zoom ? 1 : -1));
    // Let the camera settle and the world fill in before timing.
    for (let i = 0; i < 120; i++) {
      stage.tick(1 / 60);
      await yieldFrame();
    }
    const times: number[] = [];
    const calls: number[] = [];
    const tris: number[] = [];
    let worstBuild = 0;
    let frames = 0;
    let turned = 0;
    const missed: string[] = [];
    for (const w of leg.waypoints) {
      // The way there may need the chunks ahead read first: give them a few frames.
      let to = null;
      for (let tries = 0; tries < 30 && !(to = stage.reachableNear(w, 3)); tries++) await yieldFrame();
      if (!to || !stage.player.goTo(to)) {
        missed.push(`${leg.name}: ${w.x},${w.z}`);
        continue;
      }
      while (stage.player.moving && frames < maxFrames) {
        if (leg.turning && frames % 90 === 45) {
          const step = turned % 2 === 0 ? 1 : -1;
          if (!stage.turn(step)) stage.turn(-step as -1 | 1);
          turned++;
        }
        const t0 = performance.now();
        stage.tick(1 / 60);
        stage.render();
        gl.finish();
        times.push(performance.now() - t0);
        await yieldFrame();
        calls.push(stage.renderer.stats.calls);
        tris.push(stage.renderer.stats.triangles);
        worstBuild = Math.max(worstBuild, stage.current.streamer?.lastBuildMs ?? 0);
        frames++;
      }
    }
    const sorted = [...times].sort((a, b) => a - b);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    reports.push({
      name: leg.name,
      frames,
      meanMs: mean(times),
      p50Ms: pct(sorted, 0.5),
      p95Ms: pct(sorted, 0.95),
      p99Ms: pct(sorted, 0.99),
      worstMs: sorted.at(-1) ?? 0,
      over16: times.filter((t) => t > 1000 / 60).length,
      calls: { mean: mean(calls), max: Math.max(0, ...calls) },
      triangles: { mean: mean(tris), max: Math.max(0, ...tris) },
      worstBuildMs: worstBuild,
      worstStep: stage.current.streamer ? `${stage.current.streamer.worstStep.what} ${stage.current.streamer.worstStep.ms.toFixed(1)} ms` : "",
      chunksBuilt: stage.current.streamer?.builtKeys.length ?? 0,
      scenePixels: `${stage.renderer.width}x${stage.renderer.height} at ${stage.renderer.view.scale}x`,
      missed,
    });
  }
  stage.manual = wasManual;
  return reports;
}
