import * as THREE from "three";
import { type Appearance, type GearLook, figureSpec, lookFigure, playerFigure } from "./art/figures";
import { meshesOf } from "./art/paint/builder";
import { assembleFloor, generateDungeonFloor, gridOfFloor } from "./dungeon";
import { besideEntrance } from "./world/realm";
import { standingOf } from "./world/standing";
import { PROPS } from "./art/props";
import type { CardScreens, Closed } from "./cardLayer";
import { Mob, PLAYER_SPEED, type Visitor, chebyshev } from "./entities";
import { type MinimapDot, Hud, gold } from "./hud";
import { surfaceColor } from "./surfaceColors";
import { renderMob, renderPortrait } from "./portrait";
import { defeatLine, marginOf } from "./hearts";
import { type MobInfo, mobInfo, theMob } from "./mobs";
import { ApiError, type CardCount, type Character as CharacterData, type Find, type Defeat, type EncounterResult, type EncounterStart, type Place as ApiPlace, type RealmApi, type Resting, type Run, type RunFloor, type Traveler, identityOf, travelerIn } from "./net/api";
import { MockApi } from "./net/mockApi";
import type { Presence, ServerMessage } from "./net/presence";
import { WalkRelay } from "./net/relay";
import { Actor } from "./render/actor";
import { HOP_STEEP, type Point, middle } from "./render/motion";
import { HEADING_NAMES, type Heading, NAME_OF, type Zoom } from "./render/camera";
import { LEAN, Stage, type Arrival, type Spot, type StageDoor } from "./render/stage";
import { StreamedWorld, WorldPlaces } from "./render/spots";
import { spawnEpoch, spawnMob } from "./spawn";
import { CHUNK, type DungeonData, type FerryData, type NpcData, OBJECT_KINDS, type SpawnData, type TownData, type TownWay, type WorldData, chunkKey, groundsAt, inTravel, isBlocked, sideStep, siteRect, townAt } from "./world/format";
import { type Grid, type Tile, flatGround } from "./world/grid";
import type { WorldSource } from "./world/load";

// The overworld (tech.md, B5) on the renderer's stage (render/stage.ts): one connected world of version-2 chunks
// streamed round the player, the rooms behind its doors entered seamlessly, everyone on the ground you stand on as
// Actors on square tiles - the townsfolk, the mobs of the spawn points, the other players the relay tells of - what a
// click means, chests, heartblooms and a run's shrine, waystones, and what happens when a mob reaches you. The server
// owns everything of value; this asks it (RealmApi) and shows the answers, and opens card screens over the world
// (CardScreens) for duels, the spell table, vendors, loot and gear.
//
// Positions are tiles `{Space, X, Z}` (realms/docs/interfaces.md). A walk sent to the relay is the path the grid found:
// eight ways, never a cut corner, from the open tile the player stands on. Nearness - beside a door, a chest, a vendor -
// is Chebyshev: a diagonal neighbour is beside.

export interface Options {
  /** Whether mobs wander (tests turn it off; they still chase). */
  readonly wander: boolean;
  /** Whether there are mobs at all (tests of other things turn them off). */
  readonly mobs: boolean;
  /** The clock spawns are computed on, unix seconds. */
  readonly now: () => number;
  /** The game's clock moves only when a test advances it (`advance`), and streaming builds in steps, not milliseconds. */
  readonly manual?: boolean;
  /** The camera's heading and outdoor zoom to start at (else what was last used). */
  readonly heading?: Heading;
  readonly zoom?: Zoom;
  /** The townsfolk stand still (tests, screenshots). */
  readonly still?: boolean;
}

/** What a click on a tile would do, for the cursor. */
export type Intent = "walk" | "attack" | "talk" | "open" | "exit" | "none";

/** Where the overworld starts: the world (at a tile) or a room (a test's or a developer's choice, else the character's). */
export interface Start {
  readonly space: string;
  readonly tile?: Tile;
}

/**
 * A dungeon run's floor as the stage walks it: its place, where one arrives, its ways (up and out, down), and its
 * encounters. The floors are drawn by the dungeon generator on squares (`dungeon/`, the Interiors & dungeons work);
 * the game asks `Overworld.floors` for them.
 */
export interface FloorPlan {
  readonly spot: Spot;
  readonly arrive: Tile;
  readonly encounters: readonly { readonly x: number; readonly z: number; readonly mob: string; readonly index: number; readonly role: string }[];
  /** The floor's ways: back up (out of the run, on the first floor), down the stair, out after the boss. */
  readonly up?: Tile | null;
  readonly down?: Tile | null;
  readonly wayOut?: Tile | null;
  /** The run's shrine, on the floor that holds it (design.md A6): its tile, prayed at from beside it. */
  readonly shrine?: Tile | null;
}

interface ActiveRun {
  readonly id: string;
  readonly dungeon: DungeonData;
  readonly seed: number;
  readonly floors: readonly RunFloor[];
  /** The run's tier: the dungeon's, or the one the character's standing to its color deals it at (design.md A6). */
  readonly tier: number;
  floor: number;
  readonly beaten: Set<string>;
  plan: FloorPlan | null;
  /** The boss that rests this run (design.md A6: refought weekly), and when it is back; its hall stands empty. */
  readonly resting: Resting | null;
  /** Whether the run's shrine has given its heart (one run in eight has one, on one floor). */
  shrineUsed: boolean;
  /** The heart over the shrine of the floor shown, drawn lit or spent. */
  shrineHeart: THREE.Group | null;
}

/** Where the heading and the zoom are kept between visits (shared with nothing else). Storage may be refused. */
const HEADING_KEY = "cantrip-realms.heading";
const ZOOM_KEY = "cantrip-realms.zoom";
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage refused: it lasts this visit.
  }
};

/** A character's tile. */
export const tileOfCharacter = (c: CharacterData): Tile => ({ x: c.X, z: c.Z });

/** A position for the API: `{Space, X, Z}`. */
const placeOf = (space: string, t: Tile): ApiPlace => ({ Space: space, X: t.x, Z: t.z });

/** A move of the figure in one frame further than this (world units, a tile being one) is a jump: a walk covers about 0.07. */
const JUMP = 0.6;
/**
 * A change of the figure's height in one frame larger than this is a jump: a step eases in. A hop's arc rises and falls
 * with the ground the figure covers, so while hopping it may change by HOP_STEEP more for every tile it moved.
 */
const DROP = 0.3;
/** How often the finds standing in the world are asked of the server while in it, seconds (`askFinds`). */
const FIND_POLL = 10;
/** How far from where another player is seen their walk may begin and be walked on to, tiles; further, they are put there. */
const VISITOR_NEAR = 2;

/** A point for the trace and the debug overlay: "x,z" to a hundredth. */
export const pointText = (p: Point): string => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
/** How many of what passed between the page and the server the page keeps (`trace`): a few seconds of walking. */
const TRACE = 60;
/** The least time between two refusals the page answers by telling the server again where the player stands, ms. */
const RESYNC = 5000;

/** A jump of the player's figure seen (Overworld `watchJumps`): when, where, and from and to (x, y, z). */
export interface Jump {
  readonly at: string;
  readonly place: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
}

const f2 = (n: number) => n.toFixed(2);

export const describeJump = (j: Jump): string =>
  `${f2(j.from[0])},${f2(j.from[2])} (tile ${Math.floor(j.from[0])},${Math.floor(j.from[2])}) -> ${f2(j.to[0])},${f2(j.to[2])} (tile ${Math.floor(j.to[0])},${Math.floor(j.to[2])}), ` +
  `moved ${f2(Math.hypot(j.to[0] - j.from[0], j.to[2] - j.from[2]))}, height ${f2(j.from[1])} -> ${f2(j.to[1])}`;

/** How a character looks (art/figures/player.ts): body, palette, identity and the looks of what they wear. */
export function appearanceOf(c: CharacterData): Appearance {
  const slots: Record<string, GearLook> = {};
  for (const [slot, worn] of Object.entries(c.Loadout)) if (worn) slots[slot] = { mesh: worn.Gear.Look.Mesh, palette: worn.Gear.Look.Palette };
  return { body: c.Body, palette: c.Palette, identity: c.Identity, slots };
}

export class Overworld {
  readonly hud: Hud;
  stage!: Stage;
  world!: StreamedWorld;
  places!: WorldPlaces;
  data!: CharacterData;
  readonly mobs: Mob[] = [];
  readonly visitors = new Map<number, Visitor>();
  run: ActiveRun | null = null;
  /** Draws a dungeon run's floor: the dungeon generator on squares (`dungeon/`), unless a test gives its own. */
  floors: (run: { readonly id: string; readonly dungeon: DungeonData; readonly seed: number; readonly floor: number; readonly floors: number; readonly run: RunFloor }) => FloorPlan = (r) => this.floorPlan(r);
  /** What is going on: walking ("world"), a dialog, a card screen, loading. */
  screen = "loading";
  hoverIntent: Intent = "none";
  /** The zone area (or town, or room) the player stands in. */
  area: { readonly name: string; readonly tier: number; readonly region: string | null } | null = null;
  /** The traveling traders and their schedule, as `GET /api/travelers` last said. */
  travelers: readonly Traveler[] = [];
  /** Spawn epochs whose mob was beaten: `spawn|epoch`. */
  private readonly beaten = new Set<string>();
  /**
   * The finds of the wilds standing (design.md A5, A3b), as the server last said (`askFinds`), by id: each drawn while
   * its chunk is built.
   */
  private readonly finds = new Map<string, { readonly find: Find; group: THREE.Group | null }>();
  /** A find being taken now: one ask of the server at a time. */
  private taking = false;
  /** Seconds until the finds are asked again. */
  private findsTimer = 0;
  /** Something to do on reaching a tile (talk to someone, open a chest, engage a mob). */
  private pending: { readonly at: Tile; readonly then: () => void } | null = null;
  /** What the relay has refused of this page, its reasons (for tests: a walk told right is never refused). */
  readonly refusals: string[] = [];
  /**
   * The server's refusals of a walk, newest first (the last few): why, where it had the player and where the figure
   * stood, and what the page did about it - the debug overlay's (debug.ts), so a correction seen in play says its cause.
   */
  readonly refusedWalks: { readonly at: string; readonly reason: string; readonly server: Point | null; readonly here: Point; readonly did: string }[] = [];

  private refusedLog(reason: string, server: Point | null, did: string): void {
    const entry = { at: new Date().toLocaleTimeString(), reason, server, here: { x: this.player.position.x, z: this.player.position.z }, did };
    this.refusedWalks.unshift(entry);
    this.refusedWalks.length = Math.min(this.refusedWalks.length, 6);
    const text = `walk refused in ${this.spot.id}: ${reason} - the server has the player at ${server ? pointText(server) : "-"}, the figure at ${pointText(entry.here)}; ${did}`;
    this.note(text);
    console.warn(`[realm] ${text}`);
  }

  /**
   * What passed between the page and the server lately, oldest first (the last TRACE): the walks told, refusals,
   * entries, the connection dropping and coming back, position reports refused, the figure stood somewhere. A jump of the
   * figure (`watchJumps`) is logged with it.
   */
  readonly trace: string[] = [];

  private note(text: string): void {
    this.trace.push(`${new Date().toLocaleTimeString()} ${text}`);
    if (this.trace.length > TRACE) this.trace.shift();
  }

  /** The figure's jumps seen, newest first (the last few): the debug overlay's (debug.ts). */
  readonly jumps: Jump[] = [];
  private watched: { readonly figure: object; readonly place: string; readonly x: number; readonly y: number; readonly z: number; readonly hopping: boolean } | null = null;

  /**
   * Each frame, the player's figure watched for a jump: a move in one frame further than a walk could take it (JUMP), or
   * a sudden rise or drop (DROP; a hop's arc no steeper than it goes, HOP_STEEP). A deliberate one - through a door, a waystone, back to the inn - stands a new figure in
   * the place (Stage.arrive) and is none. Each is logged with the trace before it, to the console and (a development
   * server's) the server's log, so a teleport seen in play says its cause.
   */
  private watchJumps(): void {
    const stage = this.stage;
    const p = stage.player.figure.root.position;
    const place = stage.current.id;
    const last = this.watched;
    const hopping = stage.player.hopping;
    if (last && last.figure === stage.player && last.place === place && !stage.transition) {
      const flat = Math.hypot(p.x - last.x, p.z - last.z);
      if (flat > JUMP || Math.abs(p.y - last.y) > DROP + (hopping || last.hopping ? HOP_STEEP * flat : 0)) {
        const jump: Jump = { at: new Date().toLocaleTimeString(), place, from: [last.x, last.y, last.z], to: [p.x, p.y, p.z] };
        this.jumps.unshift(jump);
        this.jumps.length = Math.min(this.jumps.length, 6);
        const text = `jump in ${place}: ${describeJump(jump)}; relay connected: ${this.presence?.connected ?? "none"}; what passed before it:\n  ${this.trace.join("\n  ")}`;
        console.warn(`[realm] ${text}`);
        void this.api.report?.(text);
      }
    }
    this.watched = { figure: stage.player, place, x: p.x, y: p.y, z: p.z, hopping };
  }

  /** The walks the relay is told (net/relay.ts). */
  private readonly relay = new WalkRelay((move) => {
    const to = move.Path.at(-1) ?? move.From;
    this.note(`told a walk from ${move.From.map((v) => v.toFixed(2)).join(",")}: ${move.Path.length} points to ${to.map((v) => v.toFixed(2)).join(",")} at ${move.Speed.toFixed(2)}`);
    this.presence?.send({ Type: "Move", ...move });
  });
  /** When the server was last told again where the player stands after a refusal (`enter`), ms; at most once in RESYNC. */
  private resynced = -Infinity;
  private lastReport = 0;
  private travelersTimer = 0;
  private minimapTimer = 0;
  private readonly clock = new THREE.Clock();
  /** The ferry the player rides now: its boat under them, the lane's end. */
  private riding: { readonly ferry: FerryData; readonly boat: THREE.Group; readonly end: Tile } | null = null;
  /** The traveling traders standing at their pitches now, by pitch: the trader, their caravan, what a click on them is. */
  private readonly traders = new Map<string, { readonly actor: Actor; readonly caravan: THREE.Group; readonly npc: NpcData }>();

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly api: RealmApi,
    readonly layer: CardScreens,
    readonly presence: Presence | null,
    readonly options: Options,
    readonly source: WorldSource,
    readonly worldData: WorldData,
    /** The world's dungeons (`dungeons/<id>.json`), by id. */
    dungeons: ReadonlyMap<string, DungeonData> = new Map(),
  ) {
    this.hud = new Hud(layer, worldData, dungeons);
    this.dungeons = dungeons;
    layer.onChange = () => this.hud.showLayer();
    this.hud.showLayer();
    if (presence) {
      presence.onMessage = (m) => this.hear(m);
      presence.onConnection = (open) => this.note(open ? "connected to the relay (again): the place is entered anew" : "the relay's connection dropped");
    }
    window.addEventListener("resize", () => this.stage?.resize());
    document.querySelector<HTMLButtonElement>("[data-test='hud:gear']")?.addEventListener("click", () => void this.openGear());
    document.querySelector<HTMLButtonElement>("[data-test='hud:inventory']")?.addEventListener("click", () => void this.openInventory());
    // The gear screen's paper doll shows the character as the world draws them, wearing what it shows worn.
    layer.portrait = (slots) => (this.data ? renderPortrait(appearanceOf(this.data), slots) : null);
    // The camera's buttons: a heading either way, a zoom step in or out (refused where the place does not allow it).
    const button = (name: string, act: () => void) => document.querySelector<HTMLButtonElement>(`[data-test='hud:${name}']`)?.addEventListener("click", act);
    button("turn-left", () => this.turn(-1));
    button("turn-right", () => this.turn(1));
    button("zoom-in", () => this.zoomBy(-1));
    button("zoom-out", () => this.zoomBy(1));
  }

  say(text: string): void {
    this.hud.say(text);
  }

  get attuned(): readonly string[] {
    return this.data?.Attuned ?? [];
  }

  get paused(): boolean {
    return this.stage?.paused ?? true;
  }

  set paused(p: boolean) {
    if (this.stage) this.stage.paused = p;
  }

  get player(): Actor {
    return this.stage.player;
  }

  /** The place the player is in. */
  get spot(): Spot {
    return this.stage.current;
  }

  get inWorld(): boolean {
    return this.stage.current === this.world;
  }

  /** The place's id for the server: "world", a room's id, or the run's. */
  get spaceId(): string {
    return this.inWorld ? "world" : this.run && this.spot.id.startsWith("run:") ? this.spot.id : this.spot.id;
  }

  // --- Starting --------------------------------------------------------------------------------------------------------

  /** Starts the overworld for a character, where it is (or at `start`). */
  async start(data: CharacterData, start?: Start): Promise<void> {
    this.data = data;
    this.hud.showCharacter(data);
    this.sendLook();
    const town = this.worldData.towns.find((t) => t.start) ?? this.worldData.towns[0];
    const home = town ? { x: town.center[0], z: town.center[1] } : { x: 0, z: 0 };
    this.world = new StreamedWorld(this.worldData, this.source, "world", town?.name ?? "The world", home);
    this.places = new WorldPlaces(this.world, this.source);
    this.places.extra = (door, from) => this.otherWay(door, from);
    this.world.more = () => this.entrances();
    this.hud.chunks = () => this.world.streamer.data.values();
    const built = this.world.streamer.onBuilt;
    this.world.streamer.onBuilt = (key, chunk) => {
      built(key, chunk);
      this.spawnChunk(key);
      this.drawFinds();
    };
    const onGrid = this.world.streamer.onGrid;
    this.world.streamer.onGrid = (grid) => {
      this.closeLanes(grid);
      onGrid(grid);
    };
    this.closeLanes(this.world.grid);
    const dropped = this.world.streamer.onDropped;
    this.world.streamer.onDropped = (key, chunk) => {
      dropped(key, chunk);
      this.dropMobsOf(key);
      this.dropFindsOf(key);
    };

    // A live run is resumed where it was left (a reload, a return): its floor, its beaten mobs; else the world.
    const resumed = !start && data.Space.startsWith("run:") ? await this.resumeRun() : null;
    const where = start ?? (data.Space.startsWith("run:") ? { space: "world" } : { space: data.Space, tile: tileOfCharacter(data) });
    let spot: Spot = this.world;
    let tile = where.tile ?? tileOfCharacter(data);
    if (resumed) {
      spot = resumed.spot;
      tile = resumed.tile;
    } else if (where.space !== "world") {
      const room = await this.places.read(where.space).catch(() => null);
      if (room) {
        spot = this.places.room(room.id, room);
        tile = where.tile && spot.grid.walkable(where.tile.x, where.tile.z) ? where.tile : spot.start;
      }
    }
    const heading = this.options.heading ?? HEADING_NAMES[stored(HEADING_KEY) ?? ""] ?? 0;
    const zoomed = Number(stored(ZOOM_KEY) ?? "x");
    const zoom = this.options.zoom ?? (zoomed === 0 || zoomed === 1 || zoomed === 2 ? zoomed : 0);
    this.stage = new Stage(this.canvas, { heading, zoom, spot, start: tile, player: playerFigure(appearanceOf(data)), playerSpeed: PLAYER_SPEED, spots: this.places, manual: this.options.manual });
    this.stage.still = !!this.options.still;
    this.stage.onArrive = (s) => this.arrived(s);
    this.stage.onTile = (t) => this.stepped(t);
    this.stage.intercept = (t) => this.clickThing(t);
    this.stage.pickFigure = (x, y) => this.figureAt(x, y);
    await this.stage.settle();
    // A start on a closed tile (a door's, a wall's) moves to the nearest open one.
    if (!this.spot.grid.walkable(this.player.tile.x, this.player.tile.z)) {
      const open = this.stage.reachableNear(this.player.tile, 6);
      if (open) this.player.place(open);
    }
    await this.places.ready();
    this.arrived(this.spot, true);
    this.screen = "world";
    this.loop();
    // A defeat left unanswered when the page closed is answered first.
    if (data.Defeat) void this.answerPending();
  }

  /** Asks the server for the character again (gold, hearts, gear, attunement may have changed) and shows it. */
  async refresh(): Promise<void> {
    const data = await this.api.me();
    if (!data) return;
    const looks = JSON.stringify(this.data.Loadout) !== JSON.stringify(data.Loadout);
    this.data = data;
    this.hud.showCharacter(data);
    if (looks) {
      this.sendLook();
      this.stage.dress(playerFigure(appearanceOf(data)));
    }
  }

  private sendLook(): void {
    const slots: Record<string, { Mesh: string; Palette: readonly string[] }> = {};
    for (const [slot, worn] of Object.entries(this.data.Loadout)) if (worn) slots[slot] = { Mesh: worn.Gear.Look.Mesh, Palette: worn.Gear.Look.Palette };
    this.presence?.send({ Type: "Look", Body: this.data.Body, Palette: this.data.Palette, Slots: slots });
  }

  // --- Places --------------------------------------------------------------------------------------------------------

  /** On arriving in a place: its name, the server and the relay told, the people there. */
  private arrived(spot: Spot, first = false): void {
    this.pending = null;
    // Back in the world: which finds stand there is asked at once.
    this.findsTimer = 0;
    this.relay.leave();
    this.showCamera();
    this.area = null;
    for (const v of this.visitors.values()) v.actor.figure.root.removeFromParent();
    this.visitors.clear();
    if (spot !== this.world) this.hud.showPlace(spot.title);
    if (spot.inside && !this.roomNpcs.has(spot.id)) void this.places.read(spot.id).then((d) => this.roomNpcs.set(spot.id, d.npcs), () => {});
    this.stepped(this.player.tile, true);
    if (spot.id.startsWith("run:")) return;
    this.note(`arrived in ${this.spaceId} at ${this.player.tile.x},${this.player.tile.z}`);
    void this.enter();
    if (!first && spot.inside) this.say(`${spot.title}.`);
  }

  /**
   * Lets the relay into the place the player is in, on the tile they stand on: the place is told first (the server
   * checks it is no further than a walk could have come), then the relay - which enters them where the server last had
   * them reported - and that they stand there. Whether the server took the report.
   */
  private async enter(): Promise<boolean> {
    const space = this.spaceId;
    const at = this.player.tile;
    this.lastReported = `${space}:${at.x},${at.z}`;
    const took = await this.api.position(placeOf(space, at)).then(
      (r) => {
        this.heartsAre(r.Hearts);
        return true;
      },
      (e: unknown) => {
        this.note(`position ${space} ${at.x},${at.z} refused: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      },
    );
    if (this.spaceId !== space) return took;
    this.note(`entering ${space} at ${at.x},${at.z}`);
    this.presence?.send({ Type: "Enter", Space: space });
    this.relay.stand(middle(at));
    return took;
  }

  /** The world's dungeon entrances near the chunks built, and (a world of two scales) the towns' ways, as ways out of where one is. */
  private entrances(): StageDoor[] {
    const out: StageDoor[] = [];
    const built = new Set(this.world.streamer.builtKeys);
    for (const key of built) {
      for (const e of this.world.streamer.data.get(key)?.entrances ?? []) {
        out.push({ name: `entrance:${e.dungeon}`, tile: { x: e.x, z: e.z }, step: [0, -1], to: `dungeon:${e.dungeon}`, at: new THREE.Vector3(e.x + 0.5, this.world.floorAt(e.x + 0.5, e.z + 0.5), e.z), kind: "entrance" });
      }
    }
    out.push(...this.townWays(built));
    return out;
  }

  /**
   * The towns' ways (a world of two scales, interfaces.md "Two scales") as doors of the world: on the travel map, each way
   * into a town whose icon is built - stood on its `outside` and stepped into the icon, its doorway the whole icon, so a
   * click anywhere on it walks to the nearest way's outside and in; in a town's grounds, each tile of its ways' `exit`s,
   * stepped out past the edge of the walked ground.
   */
  private townWays(built: ReadonlySet<string>): StageDoor[] {
    const out: StageDoor[] = [];
    const here = this.world.here;
    const grounds = groundsAt(this.worldData, here.x, here.z);
    const builtAt = (x: number, z: number) => built.has(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    for (const town of this.worldData.towns) {
      if (grounds) {
        if (town !== grounds) continue;
        for (const way of town.ways ?? []) {
          const [sx, sz] = sideStep(way.side);
          for (const [x, z] of way.exit) {
            if (!builtAt(x, z)) continue;
            out.push({ name: `exit:${town.id}:${way.side}`, tile: { x, z }, step: [sx, sz], to: `way:${town.id}:${way.side}:out`, at: new THREE.Vector3(x + 0.5 + sx, this.world.floorAt(x + 0.5, z + 0.5) + 0.6, z + 0.5 + sz), kind: "town-out" });
          }
        }
        continue;
      }
      const site = siteRect(town);
      if (!site || !town.site || !builtAt(town.site[0], town.site[1])) continue;
      for (const way of town.ways ?? []) {
        const [sx, sz] = sideStep(way.side);
        const [x, z] = way.outside;
        out.push({ name: `way:${town.id}:${way.side}`, tile: { x, z }, step: [-sx, -sz], to: `way:${town.id}:${way.side}:in`, at: new THREE.Vector3(town.site[0] + 0.5, this.world.floorAt(x + 0.5, z + 0.5) + 0.8, town.site[1] + 0.5), kind: "town", area: site });
      }
    }
    return out;
  }

  /** A town and its way, from a way's door (`way:<town>:<side>:in|out`). */
  private wayOf(door: StageDoor): { town: TownData; way: TownWay } | null {
    const [, id, side] = door.to.split(":");
    const town = this.worldData.towns.find((t) => t.id === id);
    const way = town?.ways?.find((w) => w.side === side);
    return town && way ? { town, way } : null;
  }

  /**
   * Through a town's way (interfaces.md, "Two scales"): where the player stands told to the server first - the way's
   * outside, or the exit tile - then the other side read and built round where they will stand while the iris closes
   * (the place left kept until they are there), then that they stand there, which the server takes only through a way.
   * Into the grounds one arrives on the way's `inside` facing into the town; out, on its `outside` facing away from the
   * icon. A refusal opens the iris back where they stood.
   */
  private async crossWay(town: TownData, way: TownWay, into: boolean): Promise<Arrival> {
    const from = this.player.tile;
    await this.api.position(placeOf("world", from)).then((r) => this.heartsAre(r.Hearts), () => {});
    const [x, z] = into ? way.inside : way.outside;
    const tile = { x, z };
    await this.world.streamer.settle(x, z, this.stage.streamReach(), false);
    try {
      const r = await this.api.position(placeOf("world", tile));
      // Filled on the way in, before the player stands there: the town's, not the travel map's area left.
      this.heartsAre(r.Hearts, into ? town.name : undefined);
    } catch (e) {
      this.note(`way ${town.id} ${way.side} refused: ${e instanceof Error ? e.message : String(e)}`);
      this.say(refusal(e));
      throw e;
    }
    this.lastReported = `world:${x},${z}`;
    this.note(`${into ? "into" : "out of"} ${town.id} by its ${way.side} way, at ${x},${z}`);
    const [sx, sz] = sideStep(way.side);
    return { spot: this.world, tile, facing: into ? [-sx, -sz] : [sx, sz] };
  }

  /** Ways the game resolves itself: a dungeon's entrance, a run's stairs and its way out. */
  private otherWay(door: StageDoor, from: Spot): Arrival | Promise<Arrival> | null {
    if (door.kind === "town" || door.kind === "town-out") {
      const found = this.wayOf(door);
      if (!found) throw new Error("no way");
      return this.crossWay(found.town, found.way, door.kind === "town");
    }
    if (door.kind === "entrance") return this.enterRun(door.to.slice("dungeon:".length));
    if (door.kind === "down" && this.run) return this.descend();
    if (from.id.startsWith("run:") && door.name === "way-out" && this.run && !this.bossBeaten(this.run)) {
      this.say("The way out opens once the boss is beaten.");
      throw new Error("boss");
    }
    if (from.id.startsWith("run:") && door.to === "world") return this.leaveRun(true);
    return null;
  }

  // --- Walking and what a click means ----------------------------------------------------------------------------------

  /** The townsfolk, the mobs and the other players standing in the place, with what each is. */
  private people(): { readonly actor: Actor; readonly npc?: NpcData; readonly mob?: Mob; readonly visitor?: Visitor }[] {
    const out: { actor: Actor; npc?: NpcData; mob?: Mob; visitor?: Visitor }[] = [];
    const npcs = this.npcsHere();
    for (const a of this.spot.actors) out.push({ actor: a, npc: npcs.get(a.name) });
    for (const m of this.mobsHere()) out.push({ actor: m.actor, mob: m });
    for (const v of this.visitors.values()) out.push({ actor: v.actor, visitor: v });
    if (this.inWorld) for (const t of this.traders.values()) out.push({ actor: t.actor, npc: t.npc });
    return out;
  }

  /** The NPCs of the place by the name their figure was given. */
  private npcsHere(): Map<string, NpcData> {
    const list = this.inWorld ? [...this.world.streamer.data.values()].flatMap((c) => c?.npcs ?? []) : (this.roomNpcs.get(this.spot.id) ?? []);
    return new Map(list.map((n) => [n.name ?? n.id, n]));
  }

  private readonly roomNpcs = new Map<string, readonly NpcData[]>();

  private mobsHere(): Mob[] {
    return this.mobs.filter((m) => (this.inWorld ? !m.run : !!m.run));
  }

  /** Who stands on a tile, or on the tile below it on the page (a figure's body covers the tile north of its feet). */
  private personAt(t: Tile): ReturnType<Overworld["people"]>[number] | undefined {
    const all = this.people();
    return all.find((p) => p.actor.tile.x === t.x && p.actor.tile.z === t.z) ?? all.find((p) => p.actor.tile.x === t.x && p.actor.tile.z === t.z + 1);
  }

  private readonly ray = new THREE.Raycaster();

  /** The person, mob or other player whose figure is under a point on the page: the tile they stand on. */
  private figureAt(x: number, y: number): Tile | null {
    const people = this.people();
    if (people.length === 0) return null;
    this.ray.ray.copy(this.stage.renderer.rayAt(x, y));
    const hit = this.ray.intersectObjects(people.map((p) => p.actor.figure.root), true)[0];
    if (!hit) return null;
    for (const p of people) {
      let found = false;
      p.actor.figure.root.traverse((o) => (found ||= o === hit.object));
      if (found) return p.actor.tile;
    }
    return null;
  }

  /** A thing used from beside it on a tile (a spell table, a quest board, the arena's gate, a waystone). */
  private objectAt(t: Tile): NpcData | undefined {
    const list = this.inWorld ? (this.world.streamer.data.get(chunkKey(Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK)))?.npcs ?? []) : (this.roomNpcs.get(this.spot.id) ?? []);
    // On the tile; else a thing standing over the tile north of it on the page, or whose face juts onto the one south.
    // (Not over a door or a way in: that is the door's.)
    for (const dz of this.stage.doorAt(t) ? [0] : [0, 1, -1]) {
      const found = list.find((n) => OBJECT_KINDS.has(n.kind) && n.x === t.x && n.z === t.z + dz);
      if (found) return found;
    }
    return undefined;
  }

  /** A find of the wilds standing on a tile: a treasure chest, or a heartbloom. */
  private findAt(t: Tile): Find | undefined {
    if (!this.inWorld) return undefined;
    for (const { find } of this.finds.values()) if (find.X === t.x && find.Z === t.z) return find;
    return undefined;
  }

  /** What a click on a tile would do. */
  intentAt(t: Tile | null): Intent {
    if (!t) return "none";
    const who = this.personAt(t);
    if (who?.mob) return "attack";
    if (who?.npc || this.objectAt(t)) return "talk";
    if (this.findAt(t)) return "open";
    if (this.stage.doorAt(t)) return "exit";
    return this.spot.grid.walkable(t.x, t.z) ? "walk" : "none";
  }

  /** What the pointer is over, in words, for the HUD's tooltip. */
  describe(t: Tile | null): string | null {
    if (!t) return null;
    const who = this.personAt(t);
    if (who?.mob) return `${who.mob.info.name} - ${who.mob.info.boss ? "boss" : `tier ${who.mob.spawn.tier || who.mob.info.tier}`}`;
    if (who?.npc) return who.npc.name ?? who.npc.kind;
    if (who?.visitor) return who.visitor.name;
    const thing = this.objectAt(t);
    if (thing?.kind === "waystone") return `${thing.name ?? "A waystone"} (${this.attuned.includes(thing.tower ?? "") ? "attuned" : "dormant"})`;
    if (thing) return thing.name ?? thing.kind;
    const find = this.findAt(t);
    if (find) return find.Kind === "heartbloom" ? "A heartbloom" : "A chest";
    const door = this.stage.doorAt(t);
    if (door?.kind === "town" || door?.kind === "town-out") {
      const found = this.wayOf(door);
      if (!found) return null;
      if (door.kind === "town") return found.town.name;
      const to = found.way.to ? (this.worldData.towns.find((t) => t.id === found.way.to)?.name ?? this.dungeons.get(found.way.to)?.name ?? found.way.to) : null;
      return to ? `To ${to}` : `Leave ${found.town.name}`;
    }
    if (door) return door.kind === "entrance" ? (this.dungeons.get(door.to.slice("dungeon:".length))?.name ?? "A way in") : door.kind === "leave" ? "Leave" : `Into ${door.to}`;
    return null;
  }

  /** The stage's click, before it walks: a person, a mob or a chest is walked up to and used. */
  private clickThing(t: Tile): boolean {
    if (this.screen !== "world" || this.riding) return true;
    const who = this.personAt(t);
    if (who?.mob) {
      this.approach(who.mob);
      return true;
    }
    if (who?.npc) {
      const npc = who.npc;
      this.walkBeside(who.actor, () => void this.talk(npc, who.actor));
      return true;
    }
    const thing = this.objectAt(t);
    if (thing) {
      this.walkBeside({ tile: t } as Actor, () => void this.talk(thing));
      return true;
    }
    // A find is walked onto, and taken on arriving (stepped); clicked where one stands, taken at once.
    const find = this.findAt(t);
    if (find) {
      const me = this.player.tile;
      if (me.x === t.x && me.z === t.z) void this.takeFind(find, true);
      else if (this.player.goTo(t)) this.pending = { at: t, then: () => void this.takeFind(find, true) };
      else this.walkBeside({ tile: t } as Actor, () => void this.takeFind(find, true));
      return true;
    }
    return false;
  }

  /** Walks to beside someone (or something) and then does a thing; at once if already beside. */
  private walkBeside(target: { readonly tile: Tile }, then: () => void): void {
    const me = this.player.tile;
    const at = target.tile;
    if (chebyshev(me, at) <= 1 && !this.player.moving) {
      this.player.figure.face(at.x - me.x, at.z - me.z);
      then();
      return;
    }
    const grid = this.spot.grid;
    // Beside it, or (a vendor behind a counter) one tile further off: the nearest of those one can walk to.
    const ring = (reach: number) => {
      const out: Tile[] = [];
      for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === reach && grid.walkable(at.x + dx, at.z + dz)) out.push({ x: at.x + dx, z: at.z + dz });
      return out.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    };
    const beside = [...ring(1), ...ring(2)];
    if (!this.player.moving && chebyshev(me, at) <= 2 && beside.some((b) => b.x === me.x && b.z === me.z)) {
      this.player.figure.face(at.x - me.x, at.z - me.z);
      then();
      return;
    }
    const stand = beside.find((b) => this.player.goTo(b));
    if (!stand) {
      this.say("You can't get there.");
      return;
    }
    this.pending = {
      at: stand,
      then: () => {
        this.player.figure.face(at.x - stand.x, at.z - stand.z);
        then();
      },
    };
  }

  /** Walks toward a mob; it engages when you are beside it (or it reaches you). */
  private approach(mob: Mob): void {
    if (chebyshev(this.player.tile, mob.actor.tile) <= 1) {
      mob.rest = 0;
      void this.engage(mob);
      return;
    }
    this.walkBeside(mob.actor, () => {
      if (this.mobs.includes(mob)) void this.engage(mob);
    });
  }

  /** Whether a tile can be stood on by `who`: open, and nobody else on it. */
  private free(who: Actor): (t: Tile) => boolean {
    const grid = this.spot.grid;
    return (t) => grid.walkable(t.x, t.z) && !this.people().some((p) => p.actor !== who && p.actor.tile.x === t.x && p.actor.tile.z === t.z) && !(this.player !== who && this.player.tile.x === t.x && this.player.tile.z === t.z);
  }

  /** On every step: the area and its tier, and now and then where the player is. */
  private stepped(t: Tile, arriving = false): void {
    if (this.inWorld && this.stage.transition && !arriving) {
      // Stepping into a doorway as the iris closes (a dungeon's entrance, whose doorway may lie past a tier's border): no
      // area is crossed into on the way out of the place.
    } else if (this.inWorld) {
      // Within a town's walls, or anywhere in its grounds (a world of two scales), the town's.
      const town = townAt(this.worldData.towns, t.x, t.z) ?? groundsAt(this.worldData, t.x, t.z);
      const z = this.worldData.zones;
      const [ox, oz] = this.worldData.origin ?? [0, 0];
      const zone = z.areas[z.grid[Math.floor((t.z - oz) / z.cell)]?.[Math.floor((t.x - ox) / z.cell)] ?? -1];
      const area = town ? { name: town.name, tier: 0, region: town.region ?? null } : zone ? { name: zone.name, tier: zone.tier, region: zone.region } : null;
      if (area && area.name !== this.area?.name) {
        const was = this.area;
        this.area = area;
        this.hud.showArea(area.name, area.tier);
        // Over the map, the region the area is of (the colored domains; the neutral lands by their own name).
        this.hud.showPlace(this.worldData.regions.find((r) => r.color === area.region)?.name ?? area.name);
        if (!arriving && area.tier > 0 && (!was || area.tier > was.tier)) {
          this.say(`You cross into ${area.name}: tier ${area.tier}.${was && was.tier > 0 ? " The wilds grow harder." : ""}`);
          this.hud.flashArea();
        } else if (!arriving) this.say(town ? `${town.name}.` : `${area.name}: tier ${area.tier}.`);
        if (town) this.announceTraveler(town.id);
      }
    } else if (this.area?.name !== this.spot.title) {
      this.area = { name: this.spot.title, tier: this.run?.tier ?? 0, region: null };
      this.hud.showArea(this.spot.title, this.area.tier);
    }
    // On a door's tile, at once: the server lets one into a room only from beside its door.
    if (!arriving) this.report(!!this.stage.doorAt(t));
    // Onto an exit of a town's grounds: out to the travel map, as through a door.
    if (!arriving && this.inWorld && !this.stage.transition && !this.paused) {
      const exit = this.spot.doors.find((d) => d.kind === "town-out" && d.tile.x === t.x && d.tile.z === t.z);
      if (exit) {
        this.stage.startDoor(exit);
        return;
      }
    }
    // Onto a find: taken (a click's walk to one takes it on arriving instead).
    const find = !arriving && !this.pending ? this.findAt(t) : undefined;
    if (find) void this.takeFind(find, false);
  }

  /** Where the player is, to the server: on standing, and every two seconds of walking. */
  private report(force = false): void {
    // Going through a door, the next place's own report is the one that counts.
    if (this.spot.id.startsWith("run:") || this.stage.transition) return;
    const now = performance.now();
    const where = `${this.spaceId}:${this.player.tile.x},${this.player.tile.z}`;
    // Once for each place stood on (never again every frame while standing), and every two seconds of a walk.
    if (where === this.lastReported) return;
    if (!force && now - this.lastReport < 2000 && this.player.moving) return;
    this.lastReport = now;
    this.lastReported = where;
    const place = placeOf(this.spaceId, this.player.tile);
    void this.api.position(place).then(
      (r) => this.heartsAre(r.Hearts),
      (e: unknown) => {
        const text = `position ${place.Space} ${place.X},${place.Z} refused: ${e instanceof Error ? e.message : String(e)}`;
        this.note(text);
        console.warn(`[realm] ${text}`);
      },
    );
  }

  private lastReported = "";

  /**
   * Tells the relay, every frame, where the figure is and the points of a click's walk still ahead of it (net/relay.ts),
   * which tells the server walks as it says. Not while going through a door (the doorway is walked as far as nobody
   * sees: the next place is entered afresh), nor off open ground (coming out of a doorway). A ferry's crossing is told
   * as its lane, closed to walking.
   */
  private relayWalk(): void {
    if (this.spot.id.startsWith("run:") || !this.presence || this.stage.transition) return;
    // A ferry's passenger crosses its lane, closed to walking: every tile is open to them, and no ledge.
    const ground = this.riding !== null ? flatGround(() => true) : this.spot.grid.ground;
    const here = this.player.tile;
    if (!ground.open(here.x, here.z)) return;
    const p = this.player.position;
    const ahead = this.player.steering ? [] : this.player.ahead;
    this.relay.frame({ x: p.x, z: p.z }, ahead.length > 0 ? ahead : null, this.player.speed, ground);
  }

  // --- Mobs --------------------------------------------------------------------------------------------------------------

  /** Puts the mob of every spawn point of a chunk just built, unless beaten this epoch. */
  private spawnChunk(key: string): void {
    if (!this.options.mobs || !this.data) return;
    const now = this.options.now();
    const have = new Set(this.mobs.map((m) => m.spawn.id));
    for (const spawn of this.world.streamer.data.get(key)?.spawns ?? []) {
      if (have.has(spawn.id)) continue;
      const epoch = spawnEpoch(spawn, now);
      if (this.beaten.has(`${spawn.id}|${epoch}`)) continue;
      this.addMob(spawnMob(this.data.Id, "world", spawn, epoch), spawn, epoch, this.world);
    }
  }

  private addMob(id: string, spawn: SpawnData, epoch: number, spot: Spot, run?: Mob["run"]): Mob {
    const mob = Mob.make(mobInfo(id), spawn, epoch, spot.grid, spot.floorAt ?? null, run);
    spot.place.addFigure(mob.actor.figure.root);
    this.mobs.push(mob);
    return mob;
  }

  private removeMob(mob: Mob): void {
    mob.actor.figure.root.removeFromParent();
    this.mobs.splice(this.mobs.indexOf(mob), 1);
  }

  // --- The finds of the wilds -------------------------------------------------------------------------------------------

  /** Asks the server which finds stand now, and draws them (every FIND_POLL seconds in the world). */
  private async askFinds(): Promise<void> {
    let standing: readonly Find[];
    try {
      standing = await this.api.finds();
    } catch {
      return;
    }
    if (!this.inWorld) return;
    const ids = new Set(standing.map((f) => f.Id));
    for (const id of [...this.finds.keys()]) if (!ids.has(id)) this.dropFind(id);
    for (const find of standing) if (!this.finds.has(find.Id)) this.finds.set(find.Id, { find, group: null });
    this.drawFinds();
  }

  /** Draws each find standing in a chunk built and not drawn yet: a chest, or a heartbloom in bloom. */
  private drawFinds(): void {
    if (!this.world) return;
    const built = new Set(this.world.streamer.builtKeys);
    for (const f of this.finds.values()) {
      if (f.group || !built.has(chunkKey(Math.floor(f.find.X / CHUNK), Math.floor(f.find.Z / CHUNK)))) continue;
      const { X: x, Z: z } = f.find;
      const prop = f.find.Kind === "heartbloom" ? PROPS.build("heartbloom", { id: "heartbloom", x: 0, z: 0, seed: x * 31 + z, args: { picked: false } }) : PROPS.build("chest", { id: "chest", x: 0, z: 0, rot: (x * 7 + z) % 4 });
      const group = meshesOf(prop.model, f.find.Kind);
      group.position.set(x + 0.5, this.world.floorAt(x + 0.5, z + 0.5), z + 0.5);
      this.world.place.addFigure(group);
      f.group = group;
    }
  }

  /** A find gone: taken, or crumbled. */
  private dropFind(id: string): void {
    this.finds.get(id)?.group?.removeFromParent();
    this.finds.delete(id);
  }

  /** The finds drawn in a chunk let go: undrawn, kept until the server says they are gone. */
  private dropFindsOf(key: string): void {
    for (const f of this.finds.values()) {
      if (!f.group || chunkKey(Math.floor(f.find.X / CHUNK), Math.floor(f.find.Z / CHUNK)) !== key) continue;
      f.group.removeFromParent();
      f.group = null;
    }
  }

  /**
   * Takes a find (design.md A5, A3b): where the character stands told the server first (it gives a find only to one on it
   * or beside it), then the taking - a chest's gold (and now and then gear), or a heartbloom's heart; gone for all. A
   * heartbloom is left standing for a character whose hearts are full; one someone else took first is gone.
   */
  private async takeFind(find: Find, clicked: boolean): Promise<void> {
    if (this.taking) return;
    this.taking = true;
    // Gear found is shown with the world kept still until the character is refreshed; the world goes on after, whatever happens.
    let shown = false;
    try {
      const at = this.player.tile;
      this.lastReported = `${this.spaceId}:${at.x},${at.z}`;
      await this.api.position(placeOf(this.spaceId, at)).then((r) => this.heartsAre(r.Hearts), () => {});
      const found = await this.api.openChest({ Space: this.spaceId, Chest: find.Id });
      this.dropFind(find.Id);
      this.player.figure.act("interact");
      if (found.Heart) {
        await this.refresh();
        this.hud.flashHearts();
        this.say(`You pick the heartbloom, and its warmth fills you: ${found.Hearts} of ${this.data.MaxHearts} hearts.`);
      } else {
        this.say(found.Gear ? `You open the chest: ${gold(found.Found)} gold, and ${found.Gear.Gear.Name}.` : `You open the chest: ${gold(found.Found)} gold.`);
        // Gear found is shown as the card it is, on the loot screen with nothing else to take.
        if (found.Gear) {
          shown = true;
          await this.openCards("loot", { offer: [], cap: 0, mob: "The chest", source: "chest", gear: found.Gear }, false);
        }
        await this.refresh();
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "FullHearts") {
        if (clicked || !this.fullNoted.has(find.Id)) this.say("Your hearts are full. The heartbloom will keep until you need it.");
        this.fullNoted.add(find.Id);
      } else if (e instanceof ApiError && e.code === "Empty") {
        this.dropFind(find.Id);
        this.say(find.Kind === "heartbloom" ? "Someone picked the heartbloom first." : "Someone got to the chest first.");
      } else this.say(refusal(e));
    } finally {
      if (shown) this.paused = false;
      this.taking = false;
    }
  }

  /** The heartblooms the character was told their full hearts leave standing: told once, unless they click it. */
  private readonly fullNoted = new Set<string>();

  private dropMobsOf(key: string): void {
    for (const mob of [...this.mobs]) if (!mob.run && !mob.engaged && mob.spawn.id.startsWith(`${key}:`)) this.removeMob(mob);
  }

  // --- Dungeon runs ------------------------------------------------------------------------------------------------------

  /** The dungeons of the world, by id. */
  readonly dungeons: ReadonlyMap<string, DungeonData>;

  private async enterRun(id: string): Promise<Arrival> {
    const dungeon = this.dungeons.get(id);
    if (!dungeon) {
      this.say("The way in is shut.");
      throw new Error("no floors");
    }
    if (dungeon.requires && ![...dungeon.requires].every((c) => this.data.Identity.includes(c))) {
      this.say(`The way in is sealed. It opens only to a mage whose identity holds all of ${dungeon.requires.split("").join(", ")}.`);
      throw new Error("sealed");
    }
    const started = await this.api.enterDungeon({ Dungeon: id }).catch((e: unknown) => {
      this.say(refusal(e));
      throw e;
    });
    const run = this.activeRun(started, dungeon);
    this.run = run;
    const standing = standingOf(dungeon.region, this.data);
    const stands = standing === "ally" ? ` An ally color's hold: tier ${run.tier}.` : standing === "enemy" ? ` An enemy color's hold: tier ${run.tier}, its boss stronger for it.` : "";
    this.say(`${dungeon.name}. The run begins.${stands}`);
    this.sayResting(run, true);
    return this.showFloor(run);
  }

  private showFloor(run: ActiveRun): Arrival {
    for (const m of [...this.mobs]) if (m.run) this.removeMob(m);
    const plan = this.floors({ id: run.id, dungeon: run.dungeon, seed: run.seed, floor: run.floor, floors: run.floors.length, run: run.floors[run.floor]! });
    run.plan = plan;
    run.shrineHeart = null;
    if (plan.shrine) this.showShrineHeart(run);
    for (const e of plan.encounters) {
      if (run.beaten.has(`${run.floor}:${e.index}`)) continue;
      const spawn: SpawnData = { id: `${run.floor}:${e.index}`, x: e.x, z: e.z, mobs: [e.mob], radius: e.role === "encounter" ? 1 : 0, respawnSeconds: 86400, tier: run.tier };
      this.addMob(e.mob, spawn, 0, plan.spot, { floor: run.floor, index: e.index, role: e.role });
    }
    return { spot: plan.spot, tile: plan.arrive, facing: [0, 1] };
  }

  /** Whether the way out stands open: the boss beaten, or resting this run (its hall empty). */
  private bossBeaten(run: ActiveRun): boolean {
    const last = run.floors.length - 1;
    return !run.floors[last]!.Boss || run.beaten.has(`${last}:${run.floors[last]!.Encounters.length + 1}`);
  }

  /** The run the server has the character in, resumed on its floor at the floor's arrival; null with none. */
  private async resumeRun(): Promise<Arrival | null> {
    const live = await this.api.currentRun().catch(() => null);
    const dungeon = live?.Dungeon ? this.dungeons.get(live.Dungeon) : undefined;
    if (!live || !dungeon) return null;
    const run = this.activeRun(live, dungeon);
    this.run = run;
    const arrival = this.showFloor(run);
    this.say(`You are back in ${dungeon.name}${run.floors.length > 1 ? `, on floor ${run.floor + 1} of ${run.floors.length}` : ""}.`);
    this.sayResting(run, true);
    return arrival;
  }

  private activeRun(r: Run, dungeon: DungeonData): ActiveRun {
    return { id: r.Run, dungeon, seed: r.Seed, floors: r.Floors, tier: r.Tier ?? dungeon.tier, floor: r.Floor ?? 0, beaten: new Set(r.Beaten ?? []), plan: null, resting: r.Resting ?? null, shrineUsed: r.ShrineUsed ?? false, shrineHeart: null };
  }

  /** The heart over the shrine of the floor shown: lit until it has given its blessing, then cold stone. */
  private showShrineHeart(run: ActiveRun): void {
    const at = run.plan?.shrine;
    if (!at) return;
    run.shrineHeart?.removeFromParent();
    const group = meshesOf(PROPS.build("dungeon-shrine-heart", { id: "dungeon-shrine-heart", x: 0, z: 0, args: { spent: run.shrineUsed } }).model, "shrine-heart");
    group.position.set(at.x + 0.5, run.plan!.spot.floorAt?.(at.x + 0.5, at.z + 0.5) ?? 0, at.z + 0.5);
    run.plan!.spot.place.addFigure(group);
    run.shrineHeart = group;
  }

  /**
   * A run's shrine (design.md A6): a prayer gives back a heart, once in the run - the server's to say, which holds the
   * character to the floor it stands on; with the hearts full the blessing keeps.
   */
  async shrine(npc: NpcData): Promise<void> {
    const run = this.run;
    if (!run) return;
    if (run.shrineUsed) {
      await this.dialog(npc.name ?? "A shrine", ["The heart over the stone has gone cold. Its blessing was given this run."], [{ caption: "Leave", value: null, primary: true }]);
      return;
    }
    const c = this.data;
    const lines = ["A forgotten shrine of Serra. A heart of rose-red light hangs over the stone, and the wings carved behind it are warm to the touch.", `You have ${c.Hearts} of ${c.MaxHearts} hearts.`];
    const choice = await this.dialog(npc.name ?? "A shrine", lines, [
      { caption: "Pray", value: "pray", primary: true },
      { caption: "Leave", value: null },
    ]);
    if (choice !== "pray") return;
    try {
      const { Hearts } = await this.api.prayAtShrine({ Run: run.id });
      this.player.figure.act("cast");
      run.shrineUsed = true;
      this.showShrineHeart(run);
      this.data = { ...this.data, Hearts };
      this.hud.showCharacter(this.data);
      this.hud.flashHearts();
      this.say(`Serra's blessing: a heart comes back to you, ${Hearts} of ${this.data.MaxHearts}. The heart over the shrine goes cold.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "FullHearts") this.say("Your hearts are full. The shrine's blessing will keep until you need it.");
      else if (e instanceof ApiError && e.code === "Empty") {
        run.shrineUsed = true;
        this.showShrineHeart(run);
        this.say("The shrine has given its blessing this run.");
      } else this.say(refusal(e));
    }
  }

  /** Says that the boss rests this run, on entering and again on the last floor. */
  private sayResting(run: ActiveRun, entering: boolean): void {
    const r = run.resting;
    if (!r || (!entering && run.floor !== run.floors.length - 1)) return;
    const when = new Date(r.Until).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const who = mobInfo(r.Boss).name;
    this.say(run.floor === run.floors.length - 1 ? `The hall is empty: ${who} rests until ${when}. The way out is open.` : `${who} was beaten here this week and rests until ${when}: the hall below stands empty.`);
  }

  private async descend(): Promise<Arrival> {
    const run = this.run!;
    if (run.floors[run.floor]!.Warden && !run.beaten.has(`${run.floor}:${run.floors[run.floor]!.Encounters.length}`)) {
      this.say("The warden of this floor bars the stair.");
      throw new Error("warden");
    }
    await this.api.dungeonFloor({ Run: run.id, Floor: run.floor + 1 });
    run.floor++;
    this.say(`Floor ${run.floor + 1} of ${run.dungeon.name}.`);
    this.sayResting(run, false);
    return this.showFloor(run);
  }

  private async leaveRun(told: boolean): Promise<Arrival> {
    const run = this.run!;
    if (told) await this.api.leaveDungeon({ Run: run.id }).catch(() => {});
    this.run = null;
    for (const m of [...this.mobs]) if (m.run) this.removeMob(m);
    // Out where the server puts one: the first open step from the entrance (realm.ts, besideEntrance).
    const [x, z] = await besideEntrance(run.dungeon.entrance, this.source);
    this.say(`You leave ${run.dungeon.name}.`);
    return this.toWorld({ x, z });
  }

  /** A run's floor as the stage walks it: generated, assembled, its ways up, down and out as doors. */
  private floorPlan(r: { readonly id: string; readonly dungeon: DungeonData; readonly seed: number; readonly floor: number; readonly floors: number; readonly run: RunFloor }): FloorPlan {
    const f = generateDungeonFloor({ theme: r.dungeon.theme, seed: r.seed, floor: r.floor, floors: r.floors, run: r.run });
    const built = assembleFloor(f);
    const grid = gridOfFloor(f);
    const id = `run:${r.id}`;
    const tile = (t: readonly [number, number]): Tile => ({ x: t[0], z: t[1] });
    const way = (t: readonly [number, number], name: string, kind: string, to: string, at?: THREE.Vector3): StageDoor => ({
      name,
      tile: tile(t),
      step: [0, -1],
      to,
      at: at ?? new THREE.Vector3(t[0] + 0.5, grid.heightAt(t[0], t[1]) + 0.6, t[1] + 0.2),
      kind,
    });
    const doors: StageDoor[] = [way(f.up, "way-up", "leave", "world", new THREE.Vector3(...built.doorway))];
    if (f.down) doors.push(way(f.down, "stairs-down", "down", "down"));
    if (f.wayOut) doors.push(way(f.wayOut, "way-out", "leave", "world"));
    this.roomNpcs.set(id, f.npcs);
    const title = r.floors > 1 ? `${r.dungeon.name}, floor ${r.floor + 1}` : r.dungeon.name;
    const spot: Spot = { id, title, inside: true, turns: true, place: built.place, grid, doors, actors: [], start: tile(f.arrive), bounds: built.bounds };
    return { spot, arrive: tile(f.arrive), encounters: f.spots, up: tile(f.up), down: f.down ? tile(f.down) : null, wayOut: f.wayOut ? tile(f.wayOut) : null, shrine: f.shrine ? tile(f.shrine) : null };
  }

  /** The world at a tile, its chunks there read and built first (the iris is shut meanwhile). */
  private async toWorld(at: Tile): Promise<Arrival> {
    await this.world.streamer.settle(at.x, at.z, this.stage.streamReach());
    const open = this.world.grid.walkable(at.x, at.z) ? at : this.nearestOpen(at);
    return { spot: this.world, tile: open, facing: [0, 1] };
  }

  private nearestOpen(at: Tile): Tile {
    const grid = this.world.grid;
    for (let r = 1; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r && grid.walkable(at.x + dx, at.z + dz)) return { x: at.x + dx, z: at.z + dz };
    return at;
  }

  /** Jumps the player to a place at once behind a closed iris (a waystone, a lost duel's inn). */
  private async jump(to: Promise<Arrival> | Arrival): Promise<void> {
    const r = this.stage.renderer;
    this.paused = true;
    r.fade = 1;
    try {
      this.stage.arrive(await to, false);
    } finally {
      r.fade = 0;
      this.paused = false;
    }
  }

  // --- People and chests -------------------------------------------------------------------------------------------------

  /** Opens a card screen over the world, which stands still meanwhile (and after, unless `resume`). */
  private async openCards(screen: Parameters<CardScreens["open"]>[0], args: Record<string, unknown>, resume = true): Promise<Closed> {
    this.paused = true;
    this.screen = screen;
    try {
      return await this.layer.open(screen, args);
    } finally {
      this.screen = "world";
      if (resume) this.paused = false;
    }
  }

  private async dialog<T>(title: string, lines: readonly string[], buttons: { caption: string; value: T; primary?: boolean }[]): Promise<T | null> {
    const { showDialog } = await import("./screens/dialog");
    this.paused = true;
    this.screen = "dialog";
    try {
      return await showDialog(title, lines, buttons);
    } finally {
      this.screen = "world";
      this.paused = false;
    }
  }

  /** The town of the place the player is in: a room's own, or the town round them in the world. */
  /** The town the player is in: the world's town round their tile, or the town an interior belongs to (its `town`). */
  private async townHere(): Promise<string> {
    if (!this.inWorld) return (await this.places.read(this.spaceId).catch(() => null))?.town ?? this.spot.id;
    const p = this.player.tile;
    return (townAt(this.worldData.towns, p.x, p.z) ?? groundsAt(this.worldData, p.x, p.z))?.id ?? this.spot.id;
  }

  async talk(npc: NpcData, actor?: Actor): Promise<void> {
    if (actor) actor.figure.face(this.player.position.x - actor.position.x, this.player.position.z - actor.position.z);
    const here = this.area?.name ?? this.spot.title;
    switch (npc.kind) {
      case "spell-table":
        this.say("You open your spellbook at the table.");
        await this.openCards("spell-table", { map: this.spaceId, name: `the spell table at ${here}` });
        await this.refresh();
        this.say("You close your spellbook.");
        break;
      case "vendor":
        this.player.figure.act("interact");
        this.say(`${npc.name ?? "The vendor"} shows you their wares.`);
        await this.openCards("vendor", { id: npc.vendor ?? npc.id, name: npc.name ?? npc.vendor ?? npc.id });
        await this.refresh();
        break;
      case "armorer": {
        this.player.figure.act("interact");
        this.say("The armorer lays out the day's gear.");
        const town = await this.townHere();
        await this.openCards("gear", { armorer: town, name: `the armorer of ${this.worldData.towns.find((t) => t.id === town)?.name ?? here}` });
        await this.refresh();
        break;
      }
      case "healer":
        await this.healer(npc);
        break;
      case "innkeeper": {
        const choice = await this.dialog(npc.name ?? "The inn", npc.text ?? ["Rest here, and here you wake."], [
          { caption: "Rest", value: "rest", primary: true },
          { caption: "Leave", value: "leave" },
        ]);
        if (choice === "rest") {
          try {
            await this.api.setInn();
            await this.refresh();
            this.say(`You rest at ${this.spot.title}. You will wake here.`);
          } catch (e) {
            this.say(refusal(e));
          }
        }
        break;
      }
      case "waystone":
        await this.waystone(npc);
        break;
      case "heart-shrine":
        await this.shrine(npc);
        break;
      case "ferryman":
        await this.ferryman(npc);
        break;
      case "quest-board":
      case "arena":
        await this.dialog(npc.name ?? (npc.kind === "arena" ? "The arena" : "Quest board"), npc.text && npc.text.length > 0 ? npc.text : ["Nothing is posted."], [{ caption: "Close", value: null, primary: true }]);
        break;
      case "ambient":
        break;
      default: {
        const lines = npc.text ?? ["..."];
        this.say(`${npc.name ?? "Someone"}: "${lines[Math.floor(Math.random() * lines.length)]}"`);
      }
    }
  }

  /** A mage tower's waystone: dormant until its mage is beaten; then a way to any other attuned tower. */
  async waystone(npc: NpcData): Promise<void> {
    const tower = this.dungeons.get(npc.tower ?? "");
    if (!tower) return;
    if (!this.attuned.includes(tower.id)) {
      await this.dialog(npc.name ?? "A waystone", ["The waystone is dormant. Beat the mage at the top of the tower to attune it to you."], [{ caption: "Close", value: null, primary: true }]);
      return;
    }
    const others = this.attuned.filter((t) => t !== tower.id).map((t) => this.dungeons.get(t)).filter((d): d is DungeonData => d !== undefined);
    if (others.length === 0) {
      await this.dialog(npc.name ?? "A waystone", ["The waystone hums, attuned to you. Attune another tower's, and you can travel between them at once."], [{ caption: "Close", value: null, primary: true }]);
      return;
    }
    const choice = await this.dialog(npc.name ?? "A waystone", ["The waystone hums. Where to?"], [...others.map((d) => ({ caption: d.name, value: d.id as string | null })), { caption: "Stay", value: null, primary: true }]);
    if (!choice) return;
    try {
      const place = (await this.api.waystone({ Tower: choice })).Place;
      await this.jump(this.toWorld({ x: place.X, z: place.Z }));
      this.say(`The waystone carries you to ${this.dungeons.get(choice)?.name ?? choice}.`);
    } catch (e) {
      this.say(refusal(e));
    }
  }

  /** The traveling traders in town now (design.md A5): who, for the HUD's word on coming into town. */
  private async askTravelers(): Promise<void> {
    try {
      this.travelers = (await this.api.travelers()).Travelers;
    } catch {
      this.travelers = [];
    }
  }

  private announceTraveler(town: string): void {
    const visit = travelerIn(this.travelers, town, this.options.now() * 1000);
    if (!visit) return;
    const until = new Date(visit.Visit!.Until);
    const clock = `${String(until.getUTCHours()).padStart(2, "0")}:${String(until.getUTCMinutes()).padStart(2, "0")}`;
    this.say(`A trader from ${visit.PlaneName} is in ${this.worldData.towns.find((t) => t.id === town)?.name ?? town} until ${clock}.`);
  }

  // --- Ferries and traders --------------------------------------------------------------------------------------------

  /** A ferry's lane is open water only to its passengers: closed to walking between its docks. */
  private closeLanes(grid: Grid): void {
    for (const f of this.worldData.ferries ?? []) for (const [x, z] of f.lane.slice(1, -1)) if (grid.inside(x, z)) grid.setWalkable(x, z, false);
  }

  /** The town nearest a tile, for naming a ferry's far shore. */
  private townNear(t: readonly [number, number]): string {
    let best: { name: string; d: number } | null = null;
    for (const town of this.worldData.towns) {
      const d = chebyshev({ x: town.center[0], z: town.center[1] }, { x: t[0], z: t[1] });
      if (!best || d < best.d) best = { name: town.name, d };
    }
    return best?.name ?? "the far shore";
  }

  /** The ferryman (design.md A6): board, the crossing eases by at a walk, step off at the other dock. */
  async ferryman(npc: NpcData): Promise<void> {
    const ferry = this.worldData.ferries?.find((f) => f.id === npc.ferry);
    if (!ferry) {
      await this.dialog(npc.name ?? "The ferryman", npc.text ?? ["The ferry is not running today."], [{ caption: "Close", value: null, primary: true }]);
      return;
    }
    const me = this.player.tile;
    const at = (xz: readonly [number, number]) => chebyshev(me, { x: xz[0], z: xz[1] });
    const lane = at(ferry.from) <= at(ferry.to) ? ferry.lane : [...ferry.lane].reverse();
    const far = lane.at(-1)!;
    const choice = await this.dialog(npc.name ?? "The ferryman", [`${ferry.name} crosses to ${this.townNear(far)}. Step aboard?`], [
      { caption: "Board", value: "cross" as string | null, primary: true },
      { caption: "Stay", value: null },
    ]);
    if (choice !== "cross") return;
    const dock = { x: lane[0]![0], z: lane[0]![1] };
    const board = () => this.board(ferry, lane);
    if (me.x === dock.x && me.z === dock.z && !this.player.moving) board();
    else if (this.player.goTo(dock)) this.pending = { at: dock, then: board };
    else this.say("You can't reach the dock.");
  }

  private board(ferry: FerryData, lane: readonly (readonly [number, number])[]): void {
    const boat = meshesOf(PROPS.build("ferry", { id: "ferry", x: 0, z: 0 }).model, "ferry");
    this.world.place.addFigure(boat);
    const end = { x: lane.at(-1)![0], z: lane.at(-1)![1] };
    this.riding = { ferry, boat, end };
    this.player.walkPoints(lane.slice(1).map(([x, z]) => middle({ x, z })));
    this.say(`You board ${ferry.name}.`);
    this.stepRide();
  }

  /** The traders standing at their pitches, for tests. */
  get traderActors(): { readonly actor: Actor; readonly npc: NpcData }[] {
    return [...this.traders.values()];
  }

  /** The NPCs of the room the player is in (none in the world, whose are its chunks'). */
  get roomNpcsHere(): readonly NpcData[] {
    return this.inWorld ? [] : (this.roomNpcs.get(this.spot.id) ?? []);
  }

  /** A run under way, for tests: its id, floor and the floor's ways. */
  get runState(): {
    readonly id: string;
    readonly floor: number;
    readonly floors: number;
    readonly up: Tile | null;
    readonly down: Tile | null;
    readonly wayOut: Tile | null;
    readonly shrine: Tile | null;
    readonly shrineFloor: number | null;
    readonly shrineUsed: boolean;
  } | null {
    const r = this.run;
    if (!r?.plan) return null;
    const shrineFloor = r.floors.findIndex((f) => f.Shrine === true);
    return { id: r.id, floor: r.floor, floors: r.floors.length, up: r.plan.up ?? null, down: r.plan.down ?? null, wayOut: r.plan.wayOut ?? null, shrine: r.plan.shrine ?? null, shrineFloor: shrineFloor < 0 ? null : shrineFloor, shrineUsed: r.shrineUsed };
  }

  /** The finds of the wilds standing, for tests: each id, kind, tile and whether it is drawn. */
  get findsHere(): { readonly id: string; readonly kind: Find["Kind"]; readonly tile: Tile; readonly drawn: boolean }[] {
    return [...this.finds.values()].map((f) => ({ id: f.find.Id, kind: f.find.Kind, tile: { x: f.find.X, z: f.find.Z }, drawn: f.group !== null }));
  }

  /** Asks the server which finds stand now at once, rather than at the next turn (tests). */
  refreshFinds(): Promise<void> {
    return this.askFinds();
  }

  /** Whether the player is crossing on a ferry now. */
  get ferrying(): boolean {
    return this.riding !== null;
  }

  /** The boat under the passenger; stepping off at the lane's end. */
  private stepRide(): void {
    const r = this.riding;
    if (!r) return;
    const p = this.player.position;
    r.boat.position.set(p.x, p.y - 0.2, p.z);
    r.boat.rotation.y = this.player.figure.facing;
    if (!this.player.moving && this.player.tile.x === r.end.x && this.player.tile.z === r.end.z) {
      r.boat.removeFromParent();
      this.riding = null;
      this.say(`You step off at ${this.townNear([r.end.x, r.end.z])}.`);
      this.report(true);
    }
  }

  /**
   * The traveling traders (design.md A5) at their towns' pitches while the schedule has them there: the trader on the
   * pitch, their caravan behind them, sold from as a vendor is.
   */
  private showTraders(): void {
    if (!this.inWorld) return;
    const now = this.options.now() * 1000;
    const built = new Set(this.world.streamer.builtKeys);
    for (const pitch of this.worldData.pitches ?? []) {
      const key = `${pitch.town}:${pitch.x},${pitch.z}`;
      const visit = travelerIn(this.travelers, pitch.town, now);
      const here = this.traders.get(key);
      const shown = !!visit && built.has(chunkKey(Math.floor(pitch.x / CHUNK), Math.floor(pitch.z / CHUNK)));
      if (here && (!shown || here.npc.vendor !== visit?.Id)) {
        here.actor.figure.root.removeFromParent();
        here.caravan.removeFromParent();
        this.traders.delete(key);
      }
      if (!shown || this.traders.has(key)) continue;
      const npc: NpcData = { id: `trader-${visit!.Id}`, x: pitch.x, z: pitch.z, kind: "vendor", vendor: visit!.Id, name: visit!.Name };
      const actor = new Actor(figureSpec("planar-trader", undefined, hash(visit!.Id)), { x: pitch.x, z: pitch.z }, this.world.grid, { watch: 4 }, visit!.Name);
      actor.floor = this.world.floorAt ?? null;
      actor.place({ x: pitch.x, z: pitch.z });
      actor.figure.face(0, 1);
      const caravan = meshesOf(PROPS.build("caravan-wagon", { id: "caravan-wagon", x: 0, z: 0, seed: hash(visit!.Id) % 7 }).model, "caravan");
      caravan.scale.setScalar(0.7);
      caravan.position.set(pitch.x + 0.5, actor.position.y, pitch.z - 0.45);
      this.world.place.addFigure(caravan);
      this.world.place.addFigure(actor.figure.root);
      this.traders.set(key, { actor, caravan, npc });
    }
  }

  // --- Duels -------------------------------------------------------------------------------------------------------------

  /** A mob reached you, or you it: the duel, then what it came to - a win's spoils, or a defeat to answer. */
  async engage(mob: Mob): Promise<void> {
    if (mob.engaged || this.paused) return;
    mob.engaged = true;
    this.paused = true;
    this.player.stopWalking();
    mob.actor.stopWalking();
    const p = this.player.position;
    const m = mob.actor.position;
    mob.actor.figure.face(p.x - m.x, p.z - m.z);
    this.player.figure.face(m.x - p.x, m.z - p.z);
    // Both raise their hands to cast as the duel begins.
    this.player.figure.act("cast");
    mob.actor.figure.act("cast");
    this.say(`${theMob(mob.info)} attacks!`);
    const run = this.run;
    let start: EncounterStart;
    try {
      start = await this.api.startEncounter(run && mob.run ? { Run: run.id, Floor: mob.run.floor, Index: mob.run.index, Mob: mob.info.id } : { Spawn: mob.spawn.id, Mob: mob.info.id });
    } catch (e) {
      this.say(refusal(e));
      mob.engaged = false;
      mob.rest = 5;
      this.paused = false;
      // A defeat still to answer comes before any other fight.
      if (e instanceof ApiError && e.code === "Defeated") await this.refresh().then(() => this.answerPending());
      return;
    }
    await this.encounter(mob.info, start, { actor: mob, spawn: mob.run ? `${mob.run.floor}:${mob.run.index}` : mob.spawn.id, epoch: mob.epoch, role: mob.run?.role ?? null });
  }

  /**
   * An encounter from a game dealt on: each game played in the card layer and finished with the server, until it is won,
   * paid off, or the last heart is lost (design.md A3, A3b). A lost game with hearts left is answered in the defeat
   * dialog: a world mob's buyout, or fighting on - the sideboard screen, then the next game, the mob at the life it kept.
   */
  private async encounter(info: MobInfo, first: EncounterStart, at: { readonly actor: Mob | null; readonly spawn: string; readonly epoch: number; readonly role: string | null }): Promise<void> {
    this.paused = true;
    let start = first;
    for (;;) {
      const closed = await this.openCards("duel", {
        token: start.Token,
        seed: start.Seed,
        duel: start.Duel,
        mob: { id: info.id, name: info.name, tier: info.tier, goldRange: info.goldRange, map: this.spaceId, spawn: at.spawn },
        hearts: { have: this.data.Hearts, hold: this.data.MaxHearts },
      }, false);
      const outcome = closed.outcome === "won" ? "won" : "lost";
      const life = closed.result?.life as { mob?: number } | undefined;
      if (this.api instanceof MockApi) this.api.settle(start.Token, outcome, typeof life?.mob === "number" ? life.mob : undefined);
      const log = Array.isArray(closed.result?.log) ? (closed.result.log as string[]) : [];
      const result = await this.api.finishEncounter({ Token: start.Token, Log: log });
      if (result.Outcome === "won") {
        await this.won(info, result, at);
        return;
      }

      await this.refresh();
      if (result.Died || !result.Defeat) {
        await this.died(info, result, at.actor);
        return;
      }

      const next = await this.answer(info, result.Defeat, at);
      if (!next) return;
      start = next;
    }
  }

  /** A game won: its gold, its gear shown as its card, a boss's moment; the mob gone. */
  private async won(info: MobInfo, result: EncounterResult, at: { readonly actor: Mob | null; readonly spawn: string; readonly epoch: number; readonly role: string | null }): Promise<void> {
    this.markBeaten(at.spawn, at.epoch);
    if (this.run && at.role === "boss" && this.run.dungeon.waystone) this.say(`${this.run.dungeon.name}'s waystone is attuned to you: travel between it and any other you attune.`);
    if (at.actor) this.removeMob(at.actor);
    this.say(`You defeated ${theMob(info, false)}: ${gold(result.Gold)} gold.`);
    for (const relic of result.Relics ?? []) this.say(`A relic falls from ${theMob(info, false)}: ${relic} is yours, and yours alone.`);
    if (result.Gear) {
      this.say(`${theMob(info)} dropped ${result.Gear.Gear.Name}: it is in your gear.`);
      await this.openCards("loot", { mob: info.name, gear: result.Gear }, false);
    }
    await this.refresh();
    if (info.boss) await this.bossCeremony(info.name, result);
    this.paused = false;
  }

  /** An encounter over in the world or a run: its spawn's mob this epoch, or the run's encounter, is not met again. */
  private markBeaten(spawn: string, epoch: number): void {
    if (this.run && /^\d+:\d+$/.test(spawn)) this.run.beaten.add(spawn);
    else this.beaten.add(`${spawn}|${epoch}`);
  }

  /**
   * A defeat to answer (design.md A3): the mob over the player, its line and its offer. Paid, the encounter is over and
   * the mob dealt with; fought again, the sideboard screen and then the next game, which this returns.
   */
  private async answer(info: MobInfo, defeat: Defeat, at: { readonly actor: Mob | null; readonly spawn: string; readonly epoch: number; readonly role: string | null }): Promise<EncounterStart | null> {
    const { showDefeat } = await import("./screens/defeat");
    this.paused = true;
    for (;;) {
      this.screen = "defeat";
      const choice = await showDefeat({
        mob: theMob(info),
        portrait: renderMob(info.model, info.id, info.creature),
        line: defeatLine(info.id, marginOf(defeat.MobLife, defeat.MobFullLife)),
        hearts: defeat.Hearts,
        maxHearts: defeat.MaxHearts,
        price: defeat.Price,
        gold: this.data.Gold,
      });
      this.screen = "world";
      if (choice === "pay") {
        try {
          await this.api.payEncounter({ Token: defeat.Token });
          await this.refresh();
          this.markBeaten(at.spawn, at.epoch);
          if (at.actor) this.removeMob(at.actor);
          this.say(`You pay ${theMob(info, false)} ${gold(defeat.Price ?? 0)} gold, and it lets you go.`);
          this.paused = false;
          return null;
        } catch (e) {
          this.say(refusal(e));
          await this.refresh();
          continue;
        }
      }

      // Fighting on: the deck swapped from the sideboard for this encounter alone, and play or draw - the loser's choice.
      const side = await this.openCards("sideboard", { mob: info.name, game: defeat.Game + 1, main: defeat.Main, sideboard: defeat.Sideboard, identity: this.data.Identity, mobLife: defeat.MobLife }, false);
      const r = side.result ?? {};
      const main = Array.isArray(r.main) ? (r.main as CardCount[]) : defeat.Main;
      const sideboard = Array.isArray(r.sideboard) ? (r.sideboard as CardCount[]) : defeat.Sideboard;
      try {
        const next = await this.api.rematch({ Token: defeat.Token, Main: main, Sideboard: sideboard, PlayFirst: r.playFirst !== false });
        this.say(`You face ${theMob(info, false)} again: it stands at ${next.Duel.Seats[1]?.["StartingLife"] ?? defeat.MobLife} life.`);
        return next;
      } catch (e) {
        this.say(refusal(e));
      }
    }
  }

  /** The last heart lost (design.md A3b): the death screen, and the character wakes at home, their hearts full. */
  private async died(info: MobInfo, result: EncounterResult, actor: Mob | null): Promise<void> {
    const run = this.run;
    if (actor) {
      actor.engaged = false;
      actor.rest = 10;
    }
    if (run) {
      this.run = null;
      for (const m2 of [...this.mobs]) if (m2.run) this.removeMob(m2);
    }
    const home = this.worldData.inns.find((i) => i.id === this.data.Inn) ?? this.worldData.inns.find((i) => i.x === this.data.X && i.z === this.data.Z);
    const town = this.worldData.towns.find((t) => t.id === home?.town)?.name ?? "your home town";
    const { showDeath } = await import("./screens/death");
    this.screen = "death";
    await showDeath({
      mob: theMob(info, false),
      home: town,
      hearts: this.data.Hearts,
      run: run ? { dungeon: run.dungeon.name, gold: result.Forfeit?.Gold ?? 0, cards: result.Forfeit?.Cards ?? [], gear: result.Forfeit?.Gear ?? [] } : null,
    });
    this.screen = "world";
    // The server moved the character to their inn.
    const at = tileOfCharacter(this.data);
    const inn = this.data.Space !== "world" ? await this.places.read(this.data.Space).catch(() => null) : null;
    await this.jump(inn ? { spot: this.places.room(inn.id, inn), tile: { x: inn.entry[0], z: inn.entry[1] - 1 }, facing: [0, -1] } : this.toWorld(at));
    this.hud.flashHearts();
    this.say(`You wake at the inn in ${town}, your hearts restored.${run ? ` Your run of ${run.dungeon.name} is over, and its winnings with it.` : ""}`);
    this.paused = false;
  }

  /**
   * A defeat left unanswered (a page closed on the dialog, design.md A3): it comes back with the character, and is
   * answered before anything else - the mob over the player as it was.
   */
  async answerPending(): Promise<void> {
    const defeat = this.data?.Defeat;
    if (!defeat || this.screen === "defeat") return;
    const info = mobInfo(defeat.Mob);
    const actor = this.mobs.find((m) => m.info.id === defeat.Mob && (m.run ? `${m.run.floor}:${m.run.index}` : m.spawn.id) === defeat.Spawn) ?? null;
    if (actor) actor.engaged = true;
    const next = await this.answer(info, defeat, { actor, spawn: defeat.Spawn, epoch: defeat.Epoch, role: actor?.run?.role ?? null });
    if (next) await this.encounter(info, next, { actor, spawn: defeat.Spawn, epoch: defeat.Epoch, role: actor?.run?.role ?? null });
  }

  /**
   * The hearts the server says the character has after a report of where they stand: a town fills them. `town` names the
   * town reported in when the player does not stand there yet (a way in, behind the iris).
   */
  private heartsAre(hearts: number, town?: string): void {
    if (!this.data || hearts === this.data.Hearts) return;
    const filled = hearts > this.data.Hearts;
    this.data = { ...this.data, Hearts: hearts };
    this.hud.showCharacter(this.data);
    if (filled) {
      this.hud.flashHearts();
      this.say(`Safe within ${town ?? this.area?.name ?? "the town"}, your hearts are restored: ${hearts} of ${this.data.MaxHearts}.`);
    }
  }

  /** A healer (a temple's priest, a shrine's keeper): a heart's blessing for gold, up to the most (design.md A3b). */
  private async healer(npc: NpcData): Promise<void> {
    const c = this.data;
    const price = c.HeartPrice;
    const lines = [...(npc.text ?? []), price === null ? `You hold ${c.MaxHearts} hearts, as many as anyone may.` : `You hold ${c.MaxHearts} hearts. A blessing for one more costs ${gold(price)} gold.`];
    const buttons: { caption: string; value: string | null; primary?: boolean }[] = price === null ? [] : [{ caption: `Buy a heart (${gold(price)} gold)`, value: "buy", primary: c.Gold >= price }];
    buttons.push({ caption: "Leave", value: null, primary: price === null || c.Gold < price });
    const choice = await this.dialog(npc.name ?? "The healer", lines, buttons);
    if (choice !== "buy") return;
    try {
      const bought = await this.api.buyHeart();
      await this.refresh();
      this.hud.flashHearts();
      this.say(`${npc.name ?? "The healer"} blesses you: you hold ${bought.MaxHearts} hearts now.`);
    } catch (e) {
      this.say(refusal(e));
    }
  }

  /**
   * A boss beaten (design.md A6): the moment it deserves - the color it unlocks, the identity's pips with the new one lit,
   * its gift and its unique item - over the world, until the player goes on.
   */
  private async bossCeremony(boss: string, result: EncounterResult): Promise<void> {
    const { showBossBeaten } = await import("./screens/bossBeaten");
    this.screen = "boss";
    try {
      await showBossBeaten({ boss, unlocked: result.Unlocked ?? null, identity: identityOf(this.data), gift: result.Gift ?? null, gear: result.Gear?.Gear.Name ?? null });
    } finally {
      this.screen = "world";
    }
    if (result.Unlocked) this.hud.flashPip(result.Unlocked);
  }

  async openGear(): Promise<void> {
    if (this.paused) return;
    await this.openCards("gear", { name: this.data.Name });
    await this.refresh();
  }

  /** Everything the character owns, cards and gear, on the card layer's inventory screen. */
  async openInventory(): Promise<void> {
    if (this.paused) return;
    await this.openCards("inventory", { name: this.data.Name });
    await this.refresh();
  }

  // --- Other players -----------------------------------------------------------------------------------------------------

  private hear(message: ServerMessage): void {
    if (!this.stage || this.spot.id.startsWith("run:")) return;
    switch (message.Type) {
      case "Welcome":
        this.note(`entered: instance ${message.Instance}, ${message.Others.length} others seen`);
        for (const other of message.Others) this.hear({ Type: "Other", ...other });
        break;
      case "Other": {
        this.visitors.get(message.Player)?.actor.figure.root.removeFromParent();
        const from = { x: message.At[0], z: message.At[1] };
        const tile = { x: Math.floor(from.x), z: Math.floor(from.z) };
        const open = this.spot.grid.walkable(tile.x, tile.z);
        const actor = new Actor(lookFigure(message.Look, message.Identity), open ? tile : this.player.tile, this.spot.grid, {}, message.Name);
        actor.floor = this.spot.floorAt ?? null;
        if (open) actor.placeAt(from);
        else actor.place(actor.tile);
        this.spot.place.addFigure(actor.figure.root);
        const visitor: Visitor = { player: message.Player, name: message.Name, identity: message.Identity, actor };
        this.visitors.set(message.Player, visitor);
        this.walkVisitor(visitor, message.At, message.Path, message.Speed, message.Since);
        break;
      }
      case "Moved": {
        const visitor = this.visitors.get(message.Player);
        if (visitor) this.walkVisitor(visitor, message.From, message.Path, message.Speed, message.Since);
        break;
      }
      case "Looked": {
        // Another player put on or took off gear: the same walk, dressed anew.
        const v = this.visitors.get(message.Player);
        if (!v) break;
        const old = v.actor;
        const actor = new Actor(lookFigure(message.Look, v.identity), old.tile, this.spot.grid, {}, v.name);
        actor.floor = old.floor;
        actor.place(old.tile);
        actor.position.copy(old.position);
        actor.figure.root.position.copy(old.position);
        actor.speed = old.speed;
        if (old.moving) actor.walkPoints(old.ahead);
        old.figure.root.removeFromParent();
        this.spot.place.addFigure(actor.figure.root);
        this.visitors.set(message.Player, { ...v, actor });
        break;
      }
      case "Emoted":
        this.say(`${this.visitors.get(message.Player)?.name ?? "Someone"} ${message.Emote}.`);
        break;
      case "Left": {
        const visitor = this.visitors.get(message.Player);
        if (visitor) {
          visitor.actor.figure.root.removeFromParent();
          this.visitors.delete(message.Player);
        }
        break;
      }
      case "Refused": {
        // A walk refused says where the server truly has the player. The figure is not snapped back there (a jump in
        // plain sight): the server is told the way from there to where the figure stands, and catches up (net/relay.ts
        // `catchUp`). Only where there is no such way, or catching up was refused too, is the figure stood there.
        this.refusals.push(message.Reason);
        if (message.At.length !== 2) {
          this.refusedLog(message.Reason, null, "no point");
          break;
        }
        const at = { x: message.At[0]!, z: message.At[1]! };
        const atTile = { x: Math.floor(at.x), z: Math.floor(at.z) };
        const grid = this.spot.grid;
        const here = this.player.tile;
        const way = grid.walkable(atTile.x, atTile.z) && grid.walkable(here.x, here.z) ? grid.path(atTile, here) : null;
        if (way && this.relay.catchUp(at, way, { x: this.player.position.x, z: this.player.position.z })) {
          this.refusedLog(message.Reason, at, `caught up, ${way.length - 1} steps`);
          break;
        }
        // Too far to catch up along (or refused again): the server is told again where the player stands - the place
        // reported, the relay entered anew there - rather than the figure jumped back to where the server had them. If
        // that was done a moment ago and it refuses still, the server's word goes.
        const now = performance.now();
        if (grid.walkable(here.x, here.z) && now - this.resynced > RESYNC) {
          this.resynced = now;
          this.refusedLog(message.Reason, at, "told the server again where the player stands");
          void this.enter().then((took) => {
            if (!took) this.note("the server would not take where the player stands");
          });
          break;
        }
        const placed = grid.walkable(atTile.x, atTile.z);
        if (placed) this.player.placeAt(at);
        this.refusedLog(message.Reason, at, placed ? "stood there" : "not stood there (not open here)");
        this.relay.placed(at);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Another player's walk: from where it began, along its points, caught up by however long ago it began. One from near
   * where they are seen is walked on from there (the way to where it begins as well, a little faster to keep its time);
   * one from further off is a jump to it.
   */
  private walkVisitor(visitor: Visitor, from: readonly [number, number], path: readonly (readonly [number, number])[], speed: number, since: number): void {
    const a = visitor.actor;
    const start = { x: from[0], z: from[1] };
    const points = path.map(([x, z]) => ({ x, z }));
    const off = Math.hypot(a.position.x - start.x, a.position.z - start.z);
    const near = off <= VISITOR_NEAR;
    if (!near) a.placeAt(start);
    const lead = near && off > 0.02 ? off : 0;
    let length = 0;
    for (let i = 0, at = start; i < points.length; at = points[i]!, i++) length += Math.hypot(points[i]!.x - at.x, points[i]!.z - at.z);
    const pace = speed || PLAYER_SPEED;
    a.speed = Math.min(5, length > 0 ? (pace * (length + lead)) / length : pace);
    a.walkPoints([...(lead > 0 ? [start] : []), ...points]);
    const late = (Date.now() - since) / 1000;
    if (Number.isFinite(late) && late > 0.05) for (let t = Math.min(late, 60); t > 0 && a.moving; t -= 1 / 30) a.update(Math.min(1 / 30, t));
  }

  // --- The loop ----------------------------------------------------------------------------------------------------------

  dots(): { x: number; z: number; kind: MinimapDot["kind"] }[] {
    const p = (a: Actor, kind: MinimapDot["kind"]) => ({ x: a.position.x, z: a.position.z, kind });
    const finds = this.inWorld ? [...this.finds.values()].map(({ find }) => ({ x: find.X + 0.5, z: find.Z + 0.5, kind: find.Kind === "heartbloom" ? ("heart" as const) : ("chest" as const) })) : [];
    const shrine = this.run?.plan?.shrine && this.spot === this.run.plan.spot && !this.run.shrineUsed ? [{ x: this.run.plan.shrine.x + 0.5, z: this.run.plan.shrine.z + 0.5, kind: "heart" as const }] : [];
    return [...finds, ...shrine, ...this.mobsHere().map((m) => p(m.actor, "mob")), ...[...this.visitors.values()].map((v) => p(v.actor, "other")), p(this.player, "player")];
  }

  /** Moves the game on by `dt` seconds: the stage (the player, the townsfolk, the camera, the world), then the rest. */
  tick(dt: number): void {
    const stage = this.stage;
    stage.tick(dt);
    this.watchJumps();
    if (!this.paused) {
      const free = (who: Actor) => this.free(who);
      // The wanderers live on the travel map (a world of two scales): in a town's grounds nothing chases.
      const here = this.player.tile;
      const wild = !this.inWorld || (inTravel(this.worldData, here.x, here.z) && !groundsAt(this.worldData, here.x, here.z));
      for (const mob of wild ? this.mobsHere() : []) {
        // The world's grid is a window remade as chunks come and go: walk the one there is now.
        if (mob.actor.grid !== this.spot.grid) mob.actor.grid = this.spot.grid;
        if (mob.think(dt, this.player, free(mob.actor), this.options.wander)) void this.engage(mob);
        mob.actor.update(dt);
      }
      for (const v of this.visitors.values()) {
        v.actor.grid = this.spot.grid;
        v.actor.update(dt);
      }
      // A held walk takes over from whatever a click was walking up to.
      if (this.player.steering) this.pending = null;
      const p = this.pending;
      if (p && !this.player.moving && this.player.tile.x === p.at.x && this.player.tile.z === p.at.z) {
        this.pending = null;
        p.then();
      }
      if (p && !this.player.moving && (this.player.tile.x !== p.at.x || this.player.tile.z !== p.at.z)) this.pending = null;
      this.stepRide();
      for (const t of this.traders.values()) {
        t.actor.grid = this.world.grid;
        t.actor.update(dt, this.player);
      }
      this.relayWalk();
      if (!this.player.moving) this.report(true);
    }
    // The game's own figures lean for the camera as the stage's do.
    const { pitch, yaw } = stage.renderer.view;
    for (const f of [...this.mobsHere().map((m) => m.actor.figure), ...[...this.visitors.values()].map((v) => v.actor.figure)]) f.setLean(LEAN, pitch, yaw);
    this.findsTimer -= dt;
    if (this.findsTimer <= 0 && this.inWorld && this.screen === "world") {
      this.findsTimer = FIND_POLL;
      void this.askFinds();
    }
    this.travelersTimer -= dt;
    if (this.travelersTimer <= 0) {
      this.travelersTimer = 60;
      void this.askTravelers();
    }
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.25;
      this.showTraders();
      const at = this.player.position;
      if (this.inWorld && this.hud.hasWorldMap) this.hud.drawMap(this.dots(), this.attuned);
      else {
        const tileAt = this.inWorld ? this.world.streamer.tileAt : null;
        this.hud.drawSquares(
          this.spaceId,
          (x, z) => {
            if (tileAt) {
              const t = tileAt(x, z);
              return t && t[1] ? (isBlocked(t) && !t[1].match(/^(stream|sea|shallows|bog|lava)$/) ? "#2e3140" : surfaceColor(t[1])) : null;
            }
            return this.spot.grid.walkable(x, z) ? "#7a5434" : null;
          },
          { x: at.x, z: at.z },
          this.dots(),
        );
      }
    }
  }

  private loop(): void {
    const frame = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (!this.options.manual) this.tick(dt);
      this.stage.render();
      requestAnimationFrame(frame);
    };
    frame();
  }

  /** Steps the camera's heading, kept for the next visit. */
  turn(step: -1 | 1): void {
    if (this.stage.turn(step)) store(HEADING_KEY, NAME_OF[this.stage.rig.heading]);
    this.showCamera();
  }

  /** Steps the outdoor zoom, kept for the next visit. */
  zoomBy(step: -1 | 1): void {
    if (this.stage.zoomBy(step)) store(ZOOM_KEY, String(this.stage.rig.zoom));
    this.showCamera();
  }

  /** The camera's buttons, each disabled where its step is refused (past 45 degrees, a room that does not turn, indoors' zoom). */
  private showCamera(): void {
    const set = (name: string, disabled: boolean) => {
      const b = document.querySelector<HTMLButtonElement>(`[data-test='hud:${name}']`);
      if (b) b.disabled = disabled;
    };
    const here = this.stage.current;
    const rig = this.stage.rig;
    set("turn-left", !here.turns || rig.heading === -1);
    set("turn-right", !here.turns || rig.heading === 1);
    set("zoom-in", here.inside || rig.zoom === 0);
    set("zoom-out", here.inside || rig.zoom === rig.maxZoom());
  }
}

function refusal(e: unknown): string {
  if (e instanceof ApiError) return e.detail || e.code;
  return e instanceof Error ? e.message : String(e);
}

/** A small seed from a name (a trader's look and caravan). */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 997;
}
