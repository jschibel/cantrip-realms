import * as THREE from "three";
import { figureSpec } from "../art/figures";
import { namedPalette } from "../art/paint/palette";
import { seeded } from "../art/paint/pixmap";
import type { ChunkData, InteriorData, NpcData, Rect, WorldData, XZ } from "../world/format";
import { CHUNK, OBJECT_KINDS, TEXELS_PER_TILE, framingAt, frontStep } from "../world/format";
import type { Grid, Tile } from "../world/grid";
import { type WorldSource, gridOfInterior, loadInterior } from "../world/load";
import { Actor, behaviourOf } from "./actor";
import { assembleInterior, openAir } from "./assemble";
import { ChunkStreamer } from "./chunks";
import type { Place } from "./place";
import type { Arrival, Spot, Spots, StageDoor } from "./stage";

// The places of a version-2 world as the stage walks them: the world itself, streamed round the player
// (`StreamedWorld`), and the rooms behind its doors (`roomSpot`), built the first time they are needed - or ahead of
// time, while the player is near their doors (`WorldPlaces.ahead`) - and kept, the last few, for coming back.

/** The figure an NPC is drawn as: its look, its manner and its pace, as the data says. */
export function npcActor(n: NpcData, grid: Grid, floor: ((x: number, z: number) => number) | null = null): Actor {
  const spec = figureSpec(n.figure ?? "townswoman", n.palette ? namedPalette(n.palette) : undefined, n.seed ?? 0);
  const a = new Actor(spec, { x: n.x, z: n.z }, grid, behaviourOf(n.behaviour), n.name ?? n.id, n.seed !== undefined ? seeded(n.seed) : Math.random);
  a.floor = floor;
  if (floor) a.place({ x: n.x, z: n.z });
  if (n.stand) a.position.set(...n.stand);
  a.figure.root.position.copy(a.position);
  if (n.speed !== undefined) a.speed = n.speed;
  return a;
}

/** A chunk's highest floor, world units (each chunk's reckoned once). */
const highestOf = new WeakMap<ChunkData, number>();
function highest(c: ChunkData): number {
  let top = highestOf.get(c);
  if (top === undefined) {
    top = 0;
    for (const t of c.tiles) if (t[1] !== "" && t[0] > top) top = t[0];
    top /= TEXELS_PER_TILE;
    highestOf.set(c, top);
  }
  return top;
}

/**
 * The world out of doors, its chunks streamed round the player and its people standing in them as they are built. In a
 * world of two scales the camera keeps to the ground the player is on - a town's grounds, or the travel map - and never
 * shows past it (`contained`); `here` says which, as the player arrives (`arriving`).
 */
export class StreamedWorld implements Spot {
  readonly inside = false;
  readonly turns = true;
  readonly place: Place;
  readonly streamer: ChunkStreamer;
  /** Where the player stands, as far as the framing goes: the tile they last arrived on. */
  here: Tile;
  private readonly people = new Map<string, Actor[]>();

  constructor(
    readonly world: WorldData,
    source: WorldSource,
    readonly id: string,
    readonly title: string,
    readonly start: Tile,
    /** Makes the figures of a chunk's NPCs (none: the page stands its own). */
    private readonly peopleOf: ((chunk: ChunkData, grid: Grid, floor: (x: number, z: number) => number) => Actor[]) | null = (c, g, f) => c.npcs.filter((n) => !OBJECT_KINDS.has(n.kind)).map((n) => npcActor(n, g, f)),
  ) {
    this.here = start;
    this.place = openAir(world, start.x, start.z, 40);
    this.streamer = new ChunkStreamer(world, source, this.place);
    this.streamer.onBuilt = (key, chunk) => {
      if (!this.peopleOf) return;
      const actors = this.peopleOf(chunk, this.streamer.grid, this.floorAt);
      for (const a of actors) this.place.addFigure(a.figure.root);
      this.people.set(key, actors);
    };
    this.streamer.onDropped = (key) => {
      for (const a of this.people.get(key) ?? []) this.place.removeFigure(a.figure.root);
      this.people.delete(key);
    };
  }

  get grid(): Grid {
    return this.streamer.grid;
  }

  /** The ground the camera keeps to: the world's `bounds`, or in a world of two scales the grounds or the travel map the player is on. */
  get bounds(): Rect {
    return framingAt(this.world, this.here.x, this.here.z);
  }

  /** A world of two scales keeps the whole view within its ground at every heading. */
  get contained(): boolean {
    return !!this.world.travel;
  }

  /** The highest floor of the chunks read within the bounds, world units (`Framing.rise`). */
  get rise(): number {
    const [x0, z0, x1, z1] = this.bounds;
    let top = 0;
    for (const c of this.streamer.data.values()) {
      if (!c || (c.cx + 1) * CHUNK <= x0 || c.cx * CHUNK >= x1 || (c.cz + 1) * CHUNK <= z0 || c.cz * CHUNK >= z1) continue;
      top = Math.max(top, highest(c));
    }
    return top;
  }

  arriving(tile: Tile): void {
    this.here = tile;
  }

  get actors(): Actor[] {
    return [...this.people.values()].flat();
  }

  readonly floorAt = (x: number, z: number): number => this.streamer.floorAt(x, z);

  /** Other ways out the page adds (a dungeon's entrance), beside the buildings' doors. */
  more: () => readonly StageDoor[] = () => [];

  /** The doors of the chunks built, by what they lead into, and the page's other ways out. */
  get doors(): StageDoor[] {
    return [...this.streamer.doors.map((d) => ({ name: `door:${d.to}`, tile: { x: d.tile[0], z: d.tile[1] }, step: d.step, to: d.to, at: new THREE.Vector3(...d.at), kind: "door" })), ...this.more()];
  }
}

/** A room as the stage walks it: its place, floor and people, and its one way out onto `outTo`. */
export function roomSpot(room: InteriorData, outTo: string): Spot {
  const built = assembleInterior(room);
  const grid = gridOfInterior(room);
  const actors = room.npcs.filter((n) => !OBJECT_KINDS.has(n.kind)).map((n) => npcActor(n, grid));
  for (const a of actors) built.place.addFigure(a.figure.root);
  const doors: StageDoor[] = [{ name: `door:${outTo}`, tile: { x: room.entry[0], z: room.entry[1] }, step: [0, 1], to: outTo, at: new THREE.Vector3(...built.doorway), kind: "leave" }];
  return { id: room.id, title: room.name, inside: true, turns: true, place: built.place, grid, doors, actors, start: { x: room.entry[0], z: room.entry[1] - 1 }, bounds: built.bounds };
}

const tileOf = ([x, z]: XZ): Tile => ({ x, z });

/**
 * A world and its rooms, as the stage asks for them: through a door into its room (one arrives a step in from the
 * room's door, facing in) and back out (onto the building's door tile, facing out of it). Rooms are read and built the
 * first time, or ahead while the player is near their doors, and the last `keep` are kept.
 */
export class WorldPlaces implements Spots {
  private readonly rooms = new Map<string, Spot>();
  private readonly data = new Map<string, InteriorData>();
  private readonly reading = new Map<string, Promise<InteriorData>>();
  /** Which way one faces coming out of each room: out of its building's door. */
  private readonly outFacing = new Map<string, readonly [number, number]>();
  /** Ways the page resolves itself (a dungeon's entrance, a stair): tried first. */
  extra: ((door: StageDoor, from: Spot) => Arrival | Promise<Arrival> | null) | null = null;

  constructor(
    readonly world: StreamedWorld,
    private readonly source: WorldSource,
    private readonly keep = 10,
  ) {
    // A chunk's rooms are read as soon as it is built (a small file each), so a door is never waited on.
    const built = world.streamer.onBuilt;
    world.streamer.onBuilt = (key, chunk) => {
      built(key, chunk);
      for (const b of chunk.buildings) if (b.interior) void this.read(b.interior).catch(() => {});
    };
  }

  /** Once the rooms being read are read. */
  async ready(): Promise<void> {
    await Promise.all([...this.reading.values()].map((p) => p.catch(() => null)));
  }

  /** A room's data, read once. */
  read(id: string): Promise<InteriorData> {
    const ready = this.data.get(id);
    if (ready) return Promise.resolve(ready);
    let p = this.reading.get(id);
    if (!p) {
      p = loadInterior(this.source, id).then((d) => {
        this.data.set(id, d);
        this.reading.delete(id);
        return d;
      });
      this.reading.set(id, p);
    }
    return p;
  }

  /** A room as built (built now if it is not). */
  room(id: string, data: InteriorData): Spot {
    let s = this.rooms.get(id);
    if (!s) {
      s = roomSpot(data, this.world.id);
      this.rooms.set(id, s);
      // The oldest go (never the one being entered).
      for (const old of this.rooms.keys()) {
        if (this.rooms.size <= this.keep) break;
        if (old !== id) this.rooms.delete(old);
      }
    }
    return s;
  }

  /** Whether a room is built and waiting. */
  built(id: string): boolean {
    return this.rooms.has(id);
  }

  through(door: StageDoor, from: Spot): Arrival | Promise<Arrival> {
    const extra = this.extra?.(door, from);
    if (extra) return extra;
    if (door.to === this.world.id) {
      // Out of a room: onto its building's door tile, facing out.
      const room = this.data.get(from.id);
      const exit = room ? tileOf(room.exit) : this.world.start;
      return { spot: this.world, tile: exit, facing: this.outFacing.get(from.id) ?? this.facingOutOf(from.id) };
    }
    this.outFacing.set(door.to, [-door.step[0], -door.step[1]]);
    const into = (data: InteriorData): Arrival => ({ spot: this.room(door.to, data), tile: { x: data.entry[0], z: data.entry[1] - 1 }, facing: [0, -1] });
    const data = this.data.get(door.to);
    return data ? into(data) : this.read(door.to).then(into);
  }

  /** The way out of a room's building, from the world's data (a room started in, not walked into). */
  private facingOutOf(id: string): readonly [number, number] {
    for (const c of this.world.streamer.data.values()) for (const b of c?.buildings ?? []) if (b.interior === id) return frontStep(b.rot);
    return [0, 1];
  }

  /** Reads and builds the nearest room not yet built (one a call: building one is a frame's work). */
  ahead(doors: readonly StageDoor[]): void {
    for (const d of doors) {
      if (d.kind !== "door" || this.rooms.has(d.to)) continue;
      const data = this.data.get(d.to);
      if (data) {
        this.room(d.to, data);
        return;
      }
      void this.read(d.to).catch(() => {});
      return;
    }
  }
}
