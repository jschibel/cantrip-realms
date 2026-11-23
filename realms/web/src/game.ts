import * as THREE from "three";
import type { CardScreens, Closed } from "./cardLayer";
import { type Appearance, Character, type GearLook, RING_COLORS, SLOTS, type Slot } from "./character";
import { type Floor, generateFloor } from "./dungeon/generate";
import { Mob, PLAYER_SPEED, type Visitor, Walker, besides } from "./entities";
import { DIRECTIONS, type Hex, distance, equals, findPath, hex, key } from "./hex";
import { type MinimapDot, Hud, gold } from "./hud";
import { mobInfo } from "./mobs";
import { ApiError, type Character as CharacterData, type Place, type RealmApi, type RunFloor, identityOf } from "./net/api";
import { MockApi } from "./net/mockApi";
import type { Look, Presence, ServerMessage } from "./net/presence";
import { DOMINARIA } from "./palette";
import { PixelRenderer } from "./render";
import { World, skyOf } from "./scene/world";
import { showDialog } from "./screens/dialog";
import { Iris } from "./screens/iris";
import { spawnEpoch, spawnMob } from "./spawn";
import { DUNGEONS, WORLD, hasInterior, loadChunk, loadInterior } from "./world/content";
import { CHUNK, type DungeonData, type InteriorData, type NpcData, type SpawnData, type Terrain, type ZoneArea, areaAt, chunkKey, chunkOf, townAt } from "./world/schema";
import { RoomSpace, STOPS, type Space, type Thing, WorldSpace } from "./world/space";

// The overworld (tech.md, B5): one connected world streamed in chunks round the player, the interiors behind its doors
// and the dungeon runs behind its entrances, everyone on the ground you stand on, what a click means, the people of a
// town, chests, waystones, and what happens when a mob reaches you. The server owns everything of value; this asks it
// (RealmApi) and shows the answers, and opens card screens over the world (CardScreens) for duels, the spell table,
// vendors, loot and gear.

export interface Options {
  /** Whether mobs wander (tests turn it off; they still chase). */
  readonly wander: boolean;
  /** Whether there are mobs at all (tests of other things turn them off). */
  readonly mobs: boolean;
  /** The clock spawns are computed on, unix seconds. */
  readonly now: () => number;
}

/** What a click on a hex would do, for the marker's color and the cursor. */
export type Intent = "walk" | "attack" | "talk" | "open" | "exit" | "none";

const INTENT_COLORS: Record<Intent, string> = { walk: "#ffc94a", attack: "#e02a3a", talk: "#5296b5", open: "#ffc94a", exit: "#8e82c8", none: "#575c6e" };

/** Hexes from the player within which chunks are loaded, and past which they are dropped. */
const LOAD_REACH = 36;
const DROP_REACH = 64;

/** Where the overworld starts: a space and a hex of it (a test's or a developer's choice, else the character's). */
export interface Start {
  readonly space: string;
  readonly hex?: Hex;
}

interface ActiveRun {
  readonly id: string;
  readonly dungeon: DungeonData;
  readonly seed: number;
  readonly floors: readonly RunFloor[];
  floor: number;
  readonly beaten: Set<string>;
  plan: Floor;
}

interface Built {
  readonly data: InteriorData;
  readonly space: RoomSpace;
  readonly scene: World;
}

export class Overworld {
  readonly pixels: PixelRenderer;
  readonly hud: Hud;
  readonly world = new WorldSpace();
  /** The world's scene, kept while the player is indoors or below, so coming out is instant. */
  readonly worldScene: World;
  space!: Space;
  scene!: World;
  player!: Walker;
  character!: Character;
  data!: CharacterData;
  readonly mobs: Mob[] = [];
  readonly visitors = new Map<number, Visitor>();
  run: ActiveRun | null = null;
  /** Spawn epochs whose mob was beaten: `spawn|epoch`. */
  private readonly beaten = new Set<string>();
  private readonly opened = new Set<string>();
  /** Interiors built ahead, near the player, by id. */
  readonly interiors = new Map<string, Built>();
  private readonly loading = new Set<string>();
  private readonly toBuild: string[] = [];
  private readonly iris = new Iris();
  /** What is going on: walking, a dialog, a card screen, a transition, loading. */
  screen: string = "loading";
  paused = true;
  hoverIntent: Intent = "none";
  /** The zone area (or town, or room) the player stands in. */
  area: { readonly name: string; readonly tier: number; readonly region: string | null } | null = null;
  private readonly clock = new THREE.Clock();
  private lastReport = 0;
  private readonly focus = new THREE.Vector3();
  private ease: { from: THREE.Vector3; to: THREE.Vector3; t: number; ms: number } | null = null;
  private prebuildTimer = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly api: RealmApi,
    readonly layer: CardScreens,
    readonly presence: Presence | null,
    readonly options: Options,
  ) {
    this.pixels = new PixelRenderer(canvas, DOMINARIA);
    this.hud = new Hud(layer);
    this.worldScene = new World(this.world, "outdoor", skyOf(null));
    this.worldScene.attuned = (tower) => this.attuned.includes(tower);
    layer.onChange = () => this.hud.showLayer();
    this.hud.showLayer();
    if (presence) presence.onMessage = (m) => this.hear(m);
    window.addEventListener("resize", () => this.pixels.resize());
    document.querySelector<HTMLButtonElement>("[data-test='hud:gear']")?.addEventListener("click", () => void this.openGear());
  }

  say(text: string): void {
    this.hud.say(text);
  }

  get attuned(): readonly string[] {
    return this.data?.Attuned ?? [];
  }

  get appearance(): Appearance {
    const slots: Partial<Record<Slot, GearLook>> = {};
    for (const slot of SLOTS) {
      const worn = this.data.Loadout[slot];
      if (worn) slots[slot] = { mesh: worn.Gear.Look.Mesh, palette: worn.Gear.Look.Palette };
    }
    return { body: this.data.Body, palette: this.data.Palette, identity: identityOf(this.data), slots };
  }

  /** Starts the overworld for a character, where it is (or at `start`). */
  async start(data: CharacterData, start?: Start): Promise<void> {
    this.data = data;
    this.hud.showCharacter(data);
    this.character = Character.player(data.Name, this.appearance);
    this.character.showRing(RING_COLORS[this.appearance.identity[0] ?? "W"]);
    this.sendLook();
    const where = start ?? (data.Map.startsWith("run:") ? { space: "world" } : { space: data.Map, hex: hex(data.Q, data.R) });
    if (where.space !== "world" && hasInterior(where.space)) await this.goInterior(where.space, where.hex);
    else await this.goWorld(where.hex ?? hex(data.Q, data.R));
    this.screen = "world";
    this.paused = false;
    this.loop();
  }

  /** Asks the server for the character again (gold, ante, gear, attunement may have changed) and shows it. */
  async refresh(): Promise<void> {
    const data = await this.api.me();
    if (!data) return;
    const looks = JSON.stringify(this.data.Loadout) !== JSON.stringify(data.Loadout);
    const attuned = JSON.stringify(this.data.Attuned ?? []) !== JSON.stringify(data.Attuned ?? []);
    this.data = data;
    this.hud.showCharacter(data);
    if (looks) {
      this.character.setAppearance(this.appearance);
      this.sendLook();
    }
    if (attuned) for (const tower of data.Attuned ?? []) this.worldScene.setWaystone(tower, true);
  }

  private sendLook(): void {
    const slots: Record<string, { Mesh: string; Palette: readonly string[] }> = {};
    for (const [slot, look] of Object.entries(this.appearance.slots)) slots[slot] = { Mesh: look.mesh, Palette: look.palette };
    this.presence?.send({ Type: "Look", Body: this.data.Body, Palette: this.data.Palette, Slots: slots });
  }

  // --- Spaces ----------------------------------------------------------------------------------------------------------

  /** Leaves whatever space the player is in: its mobs and other players go. */
  private leaveSpace(): void {
    if (this.scene) {
      this.scene.scene.remove(this.character.root);
      for (const mob of this.mobs) {
        this.scene.scene.remove(mob.walker.character.root);
        mob.walker.character.dispose();
      }
      for (const v of this.visitors.values()) {
        this.scene.scene.remove(v.walker.character.root);
        v.walker.character.dispose();
      }
    }
    this.mobs.length = 0;
    this.visitors.clear();
  }

  /** Stands the player in a space at a hex, reports it, and says so to the relay. */
  private async arrive(space: Space, scene: World, at: Hex, report: boolean): Promise<void> {
    this.space = space;
    this.scene = scene;
    this.area = null;
    scene.scene.add(this.character.root);
    this.player = new Walker(this.character, at, PLAYER_SPEED, (h) => this.scene.surface(h));
    this.player.onStep = (h) => this.stepped(h);
    this.focus.copy(this.scene.surface(at));
    this.hud.showSpace(space);
    this.stepped(at, true);
    if (report && space.kind !== "dungeon") {
      // The server enters a player in the area they last reported, so the report goes first.
      await this.api.position({ Space: space.id, Q: at.q, R: at.r }).catch(() => {});
    }
    if (space.kind !== "dungeon") {
      this.presence?.send({ Type: "Enter", Space: space.id });
      this.presence?.send({ Type: "Move", From: [at.q, at.r], Path: [], Speed: PLAYER_SPEED });
    }
  }

  /** Goes to the world at a hex: its chunks round it loaded and built first. */
  private async goWorld(at: Hex): Promise<void> {
    this.leaveSpace();
    await this.streamAround(at, true);
    const stand = this.world.passable(at) && !this.isStopIn(this.world, at) ? at : this.nearestOpen(this.world, at);
    await this.arrive(this.world, this.worldScene, stand, true);
    this.spawnWorldMobs();
  }

  private async goInterior(id: string, at?: Hex): Promise<void> {
    const built = await this.buildInterior(id);
    this.leaveSpace();
    const stand = at && built.space.passable(at) && !built.space.thing(at) ? at : this.inward(built.space, hex(built.data.entry.q, built.data.entry.r));
    await this.arrive(built.space, built.scene, stand, true);
  }

  private inward(space: Space, door: Hex): Hex {
    return DIRECTIONS.map((d) => hex(door.q + d.q, door.r + d.r)).filter((h) => space.passable(h) && !space.thing(h)).sort((a, b) => a.q + a.r - (b.q + b.r) || a.q - b.q)[0] ?? door;
  }

  private isStopIn(space: Space, h: Hex): boolean {
    const thing = space.thing(h);
    return thing !== undefined && STOPS.has(thing.kind);
  }

  private nearestOpen(space: Space, at: Hex): Hex {
    for (let ring = 1; ring < 12; ring++) {
      for (let dq = -ring; dq <= ring; dq++) {
        for (let dr = Math.max(-ring, -dq - ring); dr <= Math.min(ring, -dq + ring); dr++) {
          const h = hex(at.q + dq, at.r + dr);
          if (distance(h, at) === ring && space.passable(h) && !this.isStopIn(space, h)) return h;
        }
      }
    }
    return at;
  }

  private async buildInterior(id: string): Promise<Built> {
    const ready = this.interiors.get(id);
    if (ready) return ready;
    const data = await loadInterior(id);
    const already = this.interiors.get(id);
    if (already) return already;
    const entry = hex(data.entry.q, data.entry.r);
    const space = new RoomSpace(id, "interior", data.name, data.tiles, data.props, data.npcs, { leave: [entry] });
    const scene = new World(space, "indoor", "#0b0c10");
    scene.addPatch(id, { tiles: space.all, props: data.props, npcs: data.npcs, chests: [], doors: [], entrances: [], leaves: [entry], tint: "hub", seed: id });
    const built = { data, space, scene };
    this.interiors.set(id, built);
    // Keep a few built; the oldest go.
    for (const [old, gone] of this.interiors) {
      if (this.interiors.size <= 10) break;
      if (gone.scene === this.scene || old === id) continue;
      gone.scene.dispose();
      this.interiors.delete(old);
    }
    return built;
  }

  // --- Streaming -------------------------------------------------------------------------------------------------------

  private wanted(at: Hex, reach: number): string[] {
    const keys: string[] = [];
    const low = chunkOf(hex(at.q - reach, at.r - reach));
    const high = chunkOf(hex(at.q + reach, at.r + reach));
    for (let cq = Math.max(0, low.cq); cq <= high.cq; cq++) for (let cr = Math.max(0, low.cr); cr <= high.cr; cr++) keys.push(chunkKey(cq, cr));
    return keys;
  }

  /** Loads the chunks near a hex, and drops those far from it; with `now`, builds them at once. */
  private async streamAround(at: Hex, now: boolean): Promise<void> {
    const want = this.wanted(at, LOAD_REACH);
    const loads = want.filter((k) => !this.world.chunks.has(k) && !this.loading.has(k)).map(async (k) => {
      this.loading.add(k);
      const [cq, cr] = k.split("_").map(Number);
      const data = await loadChunk(cq!, cr!);
      this.loading.delete(k);
      if (!data || this.world.chunks.has(k)) return;
      this.world.add(data);
      if (!now) this.toBuild.push(k);
    });
    if (now) {
      await Promise.all(loads);
      // Chunks another walk is still loading: wait for them too.
      for (let tries = 0; tries < 200 && want.some((k) => this.loading.has(k)); tries++) await new Promise((r) => setTimeout(r, 10));
      for (const k of want) if (this.world.chunks.has(k) && !this.worldScene.hasPatch(k)) this.buildChunk(k);
    }
    const keep = new Set(this.wanted(at, DROP_REACH));
    for (const k of [...this.world.chunks.keys()]) {
      if (keep.has(k)) continue;
      this.world.drop(k);
      this.worldScene.removePatch(k);
      if (this.space === this.world) this.dropMobsOf(k);
    }
  }

  private buildChunk(k: string): void {
    const chunk = this.world.chunks.get(k);
    if (!chunk || this.worldScene.hasPatch(k)) return;
    const data = chunk.data;
    const centre = hex(chunk.q0 + CHUNK / 2, chunk.r0 + CHUNK / 2);
    const tiles = data.tiles.map(([q, r, height, terrain, blocked]) => ({ hex: hex(q, r), height, terrain: terrain as Terrain, blocked: blocked === 1 }));
    this.worldScene.addPatch(k, { tiles, props: data.props, npcs: data.npcs, chests: data.chests, doors: data.doors, entrances: data.entrances, leaves: [], tint: areaAt(WORLD.zones, centre)?.region ?? "hub", seed: k });
    for (const chest of data.chests) if (this.opened.has(`${chest.id}|${spawnEpoch(chest, this.options.now())}`)) this.worldScene.setChest(chest.id, true);
    if (this.space === this.world) this.spawnWorldMobs();
  }

  private dropMobsOf(k: string): void {
    for (const mob of [...this.mobs]) {
      if (mob.engaged || !mob.spawn.id.startsWith(`${k}:`)) continue;
      this.scene.scene.remove(mob.walker.character.root);
      mob.walker.character.dispose();
      this.mobs.splice(this.mobs.indexOf(mob), 1);
    }
  }

  /** Puts the mob of every spawn point of the built chunks that has none yet. */
  private spawnWorldMobs(): void {
    if (!this.options.mobs || this.space !== this.world) return;
    const now = this.options.now();
    const have = new Set(this.mobs.map((m) => m.spawn.id));
    for (const k of this.worldScene.patchKeys) {
      const chunk = this.world.chunks.get(k);
      for (const spawn of chunk?.data.spawns ?? []) {
        if (have.has(spawn.id)) continue;
        const epoch = spawnEpoch(spawn, now);
        if (this.beaten.has(`${spawn.id}|${epoch}`)) continue;
        this.addMob(spawnMob(this.data.Id, "world", spawn, epoch), spawn, epoch);
      }
    }
  }

  private addMob(id: string, spawn: SpawnData, epoch: number, run?: Mob["run"]): void {
    const info = mobInfo(id);
    const character = Character.mob(info.name, info.model);
    this.scene.scene.add(character.root);
    const walker = new Walker(character, hex(spawn.q, spawn.r), 1.4, (h) => this.scene.surface(h));
    this.mobs.push(new Mob(walker, info, spawn, epoch, run));
  }

  /** Builds one queued chunk a frame, and the interiors near the player ahead of time, one at a time. */
  private background(seconds: number): void {
    const k = this.toBuild.shift();
    if (k) this.buildChunk(k);
    this.prebuildTimer -= seconds;
    if (this.prebuildTimer > 0 || this.space !== this.world) return;
    this.prebuildTimer = 0.5;
    const at = this.player.hex;
    const doors = [...this.world.chunks.values()].flatMap((c) => c.data.doors).filter((d) => distance(d, at) <= 10 && !this.interiors.has(d.interior));
    doors.sort((a, b) => distance(a, at) - distance(b, at));
    const next = doors[0];
    if (next) void this.buildInterior(next.interior);
  }

  // --- Walking -----------------------------------------------------------------------------------------------------------

  /** On every step: the area and its tier, the chunks round the player, and now and then where they are. */
  private stepped(h: Hex, arriving = false): void {
    if (this.space === this.world) {
      if (!arriving) void this.streamAround(h, false);
      const town = townAt(WORLD.towns, h);
      const zone: ZoneArea | null = areaAt(WORLD.zones, h);
      const area = town ? { name: town.name, tier: 0, region: town.region ?? null } : zone ? { name: zone.name, tier: zone.tier, region: zone.region } : null;
      if (area && area.name !== this.area?.name) {
        const was = this.area;
        this.area = area;
        this.hud.showArea(area.name, area.tier);
        this.worldScene.setSky(skyOf(area.region));
        if (!arriving && area.tier > 0 && (!was || area.tier > was.tier)) {
          this.say(`You cross into ${area.name}: tier ${area.tier}.${was && was.tier > 0 ? " The wilds grow harder." : ""}`);
          this.hud.flashArea();
        } else if (!arriving) this.say(town ? `${town.name}.` : `${area.name}: tier ${area.tier}.`);
      }
    } else if (this.space.kind === "interior") {
      if (this.area?.name !== this.space.name) {
        this.area = { name: this.space.name, tier: 0, region: null };
        this.hud.showArea(this.space.name, 0);
      }
    } else if (this.run) {
      const name = `${this.run.dungeon.name}, floor ${this.run.floor + 1}`;
      if (this.area?.name !== name) {
        this.area = { name, tier: this.run.dungeon.tier, region: this.run.dungeon.region ?? null };
        this.hud.showArea(name, this.run.dungeon.tier);
      }
    }
    if (!arriving) this.report();
  }

  private report(force = false): void {
    if (this.space.kind === "dungeon") return;
    const now = performance.now();
    if (!force && now - this.lastReport < 2000 && this.player.path.length > 0) return;
    this.lastReport = now;
    void this.api.position({ Space: this.space.id, Q: this.player.hex.q, R: this.player.hex.r }).catch(() => {});
  }

  private walkers(): Walker[] {
    return [this.player, ...this.mobs.map((m) => m.walker)];
  }

  /** Whether `who` may step onto a hex: open ground nobody else stands on, and no door or stair on the way. */
  free = (who: Walker, goal?: Hex) => (h: Hex): boolean =>
    this.space.passable(h) && (!this.isStopIn(this.space, h) || (goal !== undefined && equals(h, goal))) && !this.walkers().some((w) => w !== who && equals(w.hex, h));

  mobAt(h: Hex): Mob | undefined {
    return this.mobs.find((m) => equals(m.walker.hex, h) || equals(m.walker.goal, h));
  }

  /** The mob under the pointer, if one is (they are picked by their bodies, not their hexes). */
  mobUnder(ray: THREE.Raycaster): Mob | undefined {
    const hits = ray.intersectObjects(this.mobs.map((m) => m.walker.character.root), true);
    const hit = hits[0];
    if (!hit) return undefined;
    return this.mobs.find((m) => {
      let found = false;
      m.walker.character.root.traverse((o) => (found ||= o === hit.object));
      return found;
    });
  }

  intentAt(h: Hex | null, mob?: Mob): Intent {
    if (mob) return "attack";
    if (!h) return "none";
    const thing = this.space.thing(h);
    if (thing && STOPS.has(thing.kind)) return "exit";
    if (thing?.kind === "chest") return "open";
    if (thing?.kind === "npc" || thing?.kind === "marker") return "talk";
    return this.space.passable(h) ? "walk" : "none";
  }

  /** What the pointer is over, in words, for the HUD's tooltip: a wanderer's name and tier, a door's building... */
  describe(h: Hex | null, mob?: Mob): string | null {
    if (mob) return `${mob.info.name} - ${mob.info.boss ? "boss" : `tier ${mob.spawn.tier || mob.info.tier}`}`;
    if (!h) return null;
    const thing = this.space.thing(h);
    switch (thing?.kind) {
      case "marker":
        return `Waymarker: tier ${thing.prop.tier} beyond`;
      case "door":
        return this.interiors.get(thing.door.interior)?.data.name ?? "A door";
      case "entrance": {
        const d = DUNGEONS.get(thing.entrance.dungeon);
        return d ? `${d.name} - tier ${d.tier}${d.requires ? " (sealed)" : ""}` : null;
      }
      case "npc":
        return thing.npc.kind === "waystone" ? `${thing.npc.name ?? "Waystone"} - ${this.attuned.includes(thing.npc.tower ?? "") ? "attuned" : "dormant"}` : (thing.npc.name ?? null);
      case "leave":
        return this.space.kind === "interior" ? "Leave" : "The way out";
      case "stairs-down":
        return "Stairs down";
      default:
        return null;
    }
  }

  /** Shows what the pointer is over: the marker, colored for what a click would do, and the cursor. */
  hoverAt(h: Hex | null, mob?: Mob): void {
    if (this.paused) {
      this.scene?.mark(null);
      this.hoverIntent = "none";
      return;
    }
    const intent = this.intentAt(h, mob);
    this.hoverIntent = intent;
    this.scene.mark(intent === "none" ? null : mob ? mob.walker.hex : h, INTENT_COLORS[intent]);
  }

  /** A click on the ground: walk, or walk to what was clicked and use it. */
  click(h: Hex | null, mob?: Mob): void {
    if (this.paused) return;
    if (mob) return this.approach(mob);
    if (!h) return;
    const thing = this.space.thing(h);
    if (thing?.kind === "npc") return this.walkBeside(h, () => void this.talk(thing.npc));
    if (thing?.kind === "chest") return this.walkBeside(h, () => void this.openChest(thing.chest.id));
    if (thing?.kind === "marker") return this.walkBeside(h, () => this.say(`A waymarker in the color of tier ${thing.prop.tier}: the wilds past it are tier ${thing.prop.tier}.`));
    if (thing && STOPS.has(thing.kind)) {
      const path = equals(this.player.hex, h) ? [] : findPath(this.player.hex, h, this.free(this.player, h));
      if (path) this.walkThen(path, () => void this.use(thing, h));
      else this.say("You can't get there.");
      return;
    }
    const path = findPath(this.player.hex, h, this.free(this.player));
    if (path) this.walkThen(path);
    else this.say("You can't get there.");
  }

  private walkThen(path: Hex[], then?: () => void): void {
    const from = this.player.hex;
    this.player.walk(path, () => {
      this.report(true);
      then?.();
    });
    if (this.space.kind !== "dungeon") this.presence?.send({ Type: "Move", From: [from.q, from.r], Path: path.map((s) => [s.q, s.r] as const), Speed: PLAYER_SPEED });
  }

  private walkBeside(h: Hex, then: () => void): void {
    if (distance(this.player.hex, h) === 1 && !this.player.moving) {
      this.face(h);
      then();
      return;
    }
    const stand = besides(this.player.hex, h, this.free(this.player));
    const path = stand && findPath(this.player.hex, stand, this.free(this.player));
    if (!path) {
      this.say("You can't get there.");
      return;
    }
    this.walkThen(path, () => {
      this.face(h);
      then();
    });
  }

  private face(h: Hex): void {
    const at = this.scene.surface(h);
    this.character.face(at.x, at.z);
  }

  /** Walks toward a mob; it engages when you reach it (or it reaches you). */
  private approach(mob: Mob): void {
    if (distance(this.player.hex, mob.walker.hex) <= 1) {
      mob.rest = 0;
      void this.engage(mob);
      return;
    }
    const stand = besides(this.player.hex, mob.walker.hex, this.free(this.player));
    const path = stand && findPath(this.player.hex, stand, this.free(this.player));
    if (path) {
      this.walkThen(path, () => {
        if (distance(this.player.hex, mob.walker.hex) <= 1 && this.mobs.includes(mob)) void this.engage(mob);
      });
    } else this.say("You can't get there.");
  }

  // --- Doors, entrances, stairs -----------------------------------------------------------------------------------------

  private async use(thing: Thing, h: Hex): Promise<void> {
    switch (thing.kind) {
      case "door":
        return this.enterDoor(thing.door.interior, h);
      case "entrance":
        return this.enterDungeon(thing.entrance.dungeon);
      case "leave":
        return this.space.kind === "interior" ? this.leaveInterior() : this.leaveDungeon();
      case "stairs-down":
        return this.descend();
      default:
        return;
    }
  }

  /**
   * Crosses into another space without a loading screen (tech.md B5): the camera eases toward where the player goes,
   * the iris closes round them, the other side - built ahead, or now while it is shut - takes the place of this one,
   * and the iris opens on it. About 400 ms.
   */
  private async cross(toward: Hex | null, prepare: () => Promise<() => Promise<void>>): Promise<void> {
    this.paused = true;
    this.screen = "transition";
    this.scene.mark(null);
    const ready = prepare();
    if (toward) this.easeTo(this.scene.surface(toward), 120);
    const playerOnScreen = () => this.pixels.toScreen(this.character.root.position.clone().add(new THREE.Vector3(0, this.character.height * 0.5, 0)));
    await new Promise((r) => setTimeout(r, 90));
    await this.iris.close(130, playerOnScreen);
    try {
      const swap = await ready;
      await swap();
    } finally {
      this.ease = null;
      this.focus.copy(this.character.root.position);
      this.screen = "world";
      this.paused = false;
    }
    await this.iris.open(170, playerOnScreen);
  }

  private easeTo(to: THREE.Vector3, ms: number): void {
    this.ease = { from: this.focus.clone(), to: to.clone(), t: 0, ms };
  }

  async enterDoor(id: string, door: Hex): Promise<void> {
    this.scene.openDoor(door);
    await this.cross(door, async () => {
      const built = await this.buildInterior(id);
      return async () => {
        this.leaveSpace();
        await this.arrive(built.space, built.scene, this.inward(built.space, hex(built.data.entry.q, built.data.entry.r)), true);
        this.say(`${built.data.name}.`);
      };
    });
  }

  async leaveInterior(): Promise<void> {
    const room = this.interiors.get(this.space.id);
    if (!room) return;
    const exit = hex(room.data.exit.q, room.data.exit.r);
    await this.cross(null, async () => {
      await this.streamAround(exit, true);
      return async () => {
        this.leaveSpace();
        await this.arrive(this.world, this.worldScene, this.world.passable(exit) ? exit : this.nearestOpen(this.world, exit), true);
        this.spawnWorldMobs();
      };
    });
  }

  async enterDungeon(id: string): Promise<void> {
    const dungeon = DUNGEONS.get(id);
    if (!dungeon) return;
    if (dungeon.requires && ![...dungeon.requires].every((c) => this.data.Identity.includes(c))) {
      await this.dialog(dungeon.name, [`The way in is sealed. It opens only to a mage whose identity holds all of ${dungeon.requires.split("").join(", ")}.`], [{ caption: "Close", value: "close", primary: true }]);
      return;
    }
    let started;
    try {
      started = await this.api.enterDungeon({ Dungeon: id });
    } catch (e) {
      this.say(refusal(e));
      return;
    }
    const run: ActiveRun = { id: started.Run, dungeon, seed: started.Seed, floors: started.Floors, floor: 0, beaten: new Set(), plan: null as unknown as Floor };
    await this.cross(null, async () => {
      const plan = this.planFloor(run, 0);
      return async () => {
        this.run = run;
        run.plan = plan;
        this.showFloor(run);
        this.say(`${dungeon.name}. The run begins.`);
      };
    });
  }

  private planFloor(run: ActiveRun, floor: number): Floor {
    return generateFloor({ theme: run.dungeon.theme, seed: run.seed, floor, floors: run.floors.length, run: run.floors[floor]! });
  }

  /** Stands the player on the run's current floor: its scene, and its encounters not yet beaten. */
  private showFloor(run: ActiveRun, at?: Hex): void {
    const plan = run.plan;
    const bossBeaten = run.beaten.has(`${run.floor}:-2`);
    const leaves = [plan.up, ...(bossBeaten && plan.wayOut ? [plan.wayOut] : [])];
    const space = new RoomSpace(`run:${run.id}`, "dungeon", run.dungeon.name, plan.tiles, plan.props, plan.npcs, { leave: leaves, down: plan.down });
    const scene = new World(space, "dungeon", "#0b0c10");
    scene.addPatch("floor", { tiles: space.all, props: plan.props, npcs: plan.npcs, chests: [], doors: [], entrances: [], leaves, down: plan.down, tint: run.dungeon.region ?? "hub", seed: `${run.id}:${run.floor}` });
    const old = this.space?.kind === "dungeon" ? this.scene : null;
    this.leaveSpace();
    old?.dispose();
    void this.arrive(space, scene, at ?? plan.arrive, false);
    for (const spot of plan.spots) {
      if (run.beaten.has(`${run.floor}:${spot.index}`)) continue;
      const spawn: SpawnData = { id: `${run.floor}:${spot.index}`, q: spot.q, r: spot.r, mobs: [spot.mob], radius: spot.role === "encounter" ? 1 : 0, respawnSeconds: 86400, tier: run.dungeon.tier };
      this.addMob(spot.mob, spawn, 0, { floor: run.floor, index: spot.index, role: spot.role });
    }
  }

  async descend(): Promise<void> {
    const run = this.run;
    if (!run || run.floor >= run.floors.length - 1) return;
    if (run.floors[run.floor]!.Warden && !run.beaten.has(`${run.floor}:-1`)) {
      this.say("The warden of this floor bars the stair.");
      return;
    }
    try {
      await this.api.dungeonFloor({ Run: run.id, Floor: run.floor + 1 });
    } catch (e) {
      this.say(refusal(e));
      return;
    }
    await this.cross(null, async () => {
      const plan = this.planFloor(run, run.floor + 1);
      return async () => {
        run.floor++;
        run.plan = plan;
        this.showFloor(run);
        this.say(`Floor ${run.floor + 1} of ${run.dungeon.name}.`);
      };
    });
  }

  async leaveDungeon(confirm = true): Promise<void> {
    const run = this.run;
    if (!run) return;
    if (confirm) {
      const sure = await this.dialog(run.dungeon.name, ["Leave the dungeon? The run ends, and the next one begins anew from the first floor."], [
        { caption: "Leave", value: true, primary: true },
        { caption: "Stay", value: false },
      ]);
      if (!sure) return;
    }
    await this.api.leaveDungeon({ Run: run.id }).catch(() => {});
    const entrance = hex(run.dungeon.entrance[0], run.dungeon.entrance[1]);
    await this.cross(null, async () => {
      await this.streamAround(entrance, true);
      return async () => {
        const old = this.scene;
        this.run = null;
        this.leaveSpace();
        old.dispose();
        await this.arrive(this.world, this.worldScene, this.nearestOpen(this.world, entrance), true);
        this.spawnWorldMobs();
        this.say(`You leave ${run.dungeon.name}.`);
      };
    });
  }

  // --- People and chests -------------------------------------------------------------------------------------------------

  /** Opens a card screen over the world, which stands still meanwhile (and after, unless `resume`). */
  private async openCards(screen: Parameters<CardScreens["open"]>[0], args: Record<string, unknown>, resume = true): Promise<Closed> {
    this.paused = true;
    this.screen = screen;
    this.scene.mark(null);
    try {
      return await this.layer.open(screen, args);
    } finally {
      this.screen = "world";
      if (resume) this.paused = false;
    }
  }

  private async dialog<T>(title: string, lines: readonly string[], buttons: { caption: string; value: T; primary?: boolean }[]): Promise<T | null> {
    this.paused = true;
    this.screen = "dialog";
    this.scene.mark(null);
    try {
      return await showDialog(title, lines, buttons);
    } finally {
      this.screen = "world";
      this.paused = false;
    }
  }

  /** The town of the space the player is in: an interior's own, or the town round them in the world. */
  private townHere(): string {
    const room = this.interiors.get(this.space.id);
    if (room) return room.data.town;
    return townAt(WORLD.towns, this.player.hex)?.id ?? this.space.id;
  }

  async talk(npc: NpcData): Promise<void> {
    this.character.play("interact");
    const resident = this.scene.residents.find((r) => r.npc.id === npc.id);
    if (resident) {
      const at = this.player.character.root.position;
      resident.character.face(at.x, at.z);
    }
    const here = this.area?.name ?? this.space.name;
    switch (npc.kind) {
      case "spell-table": {
        this.say("You open your spellbook at the table.");
        await this.openCards("spell-table", { map: this.space.id, name: `the spell table at ${here}` });
        await this.refresh();
        this.say("You close your spellbook.");
        break;
      }
      case "vendor": {
        this.say(`${npc.name ?? "The vendor"} shows you their wares.`);
        await this.openCards("vendor", { id: npc.vendor, name: npc.name ?? npc.vendor });
        await this.refresh();
        break;
      }
      case "armorer": {
        this.say("The armorer lays out the day's gear.");
        const town = this.townHere();
        await this.openCards("gear", { armorer: town, name: `the armorer of ${WORLD.towns.find((t) => t.id === town)?.name ?? here}` });
        await this.refresh();
        break;
      }
      case "inn": {
        const choice = await this.dialog(npc.name ?? "The inn", npc.text ?? ["Rest here, and here you wake."], [
          { caption: "Rest", value: "rest", primary: true },
          { caption: "Leave", value: "leave" },
        ]);
        if (choice === "rest") {
          this.report(true);
          this.say(`You rest at ${this.space.name}.`);
        }
        break;
      }
      case "waystone":
        await this.waystone(npc);
        break;
      case "quest-board":
        await this.dialog(npc.name ?? "Quest board", npc.text && npc.text.length > 0 ? npc.text : ["Nothing is posted."], [{ caption: "Close", value: "close", primary: true }]);
        break;
      case "arena":
        await this.dialog(npc.name ?? "The arena", npc.text ?? ["Coming soon."], [{ caption: "Close", value: "close", primary: true }]);
        break;
      default: {
        const lines = npc.text ?? ["..."];
        this.say(`${npc.name ?? "Someone"}: "${lines[Math.floor(Math.random() * lines.length)]}"`);
      }
    }
  }

  /** A mage tower's waystone: dormant until its mage is beaten; then a way to any other attuned tower. */
  async waystone(npc: NpcData): Promise<void> {
    const tower = DUNGEONS.get(npc.tower ?? "");
    if (!tower) return;
    if (!this.attuned.includes(tower.id)) {
      await this.dialog(npc.name ?? "A waystone", ["The waystone is dormant. Beat the mage at the top of the tower to attune it to you."], [{ caption: "Close", value: null, primary: true }]);
      return;
    }
    const others = this.attuned.filter((t) => t !== tower.id).map((t) => DUNGEONS.get(t)).filter((d): d is DungeonData => d !== undefined);
    if (others.length === 0) {
      await this.dialog(npc.name ?? "A waystone", ["The waystone hums, attuned to you. Attune another tower's, and you can travel between them at once."], [{ caption: "Close", value: null, primary: true }]);
      return;
    }
    const choice = await this.dialog(npc.name ?? "A waystone", ["The waystone hums. Where to?"], [
      ...others.map((d) => ({ caption: d.name, value: d.id as string | null })),
      { caption: "Stay", value: null, primary: true },
    ]);
    if (!choice) return;
    let place: Place;
    try {
      place = (await this.api.waystone({ Tower: choice })).Place;
    } catch (e) {
      this.say(refusal(e));
      return;
    }
    const to = hex(place.Q, place.R);
    await this.cross(null, async () => {
      await this.streamAround(to, true);
      return async () => {
        this.leaveSpace();
        await this.arrive(this.world, this.worldScene, this.world.passable(to) ? to : this.nearestOpen(this.world, to), false);
        this.spawnWorldMobs();
        this.say(`The waystone carries you to ${DUNGEONS.get(choice)?.name ?? choice}.`);
      };
    });
  }

  private async openChest(id: string): Promise<void> {
    this.character.play("interact");
    try {
      const { Found } = await this.api.openChest({ Map: this.space.id, Chest: id });
      const chest = [...this.world.chunks.values()].flatMap((c) => c.data.chests).find((c) => c.id === id);
      if (chest) this.opened.add(`${id}|${spawnEpoch(chest, this.options.now())}`);
      this.scene.setChest(id, true);
      this.say(`You open the chest: ${gold(Found)} gold.`);
      await this.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "Empty") {
        this.scene.setChest(id, true);
        this.say("The chest is empty.");
      } else this.say(refusal(e));
    }
  }

  // --- Duels -------------------------------------------------------------------------------------------------------------

  /** A mob reached you, or you it: the duel, then the loot or the walk back from the inn. */
  async engage(mob: Mob): Promise<void> {
    if (mob.engaged || this.paused) return;
    mob.engaged = true;
    this.paused = true;
    this.player.stop();
    mob.walker.stop();
    const p = this.character.root.position;
    const m = mob.walker.character.root.position;
    mob.walker.character.face(p.x, p.z);
    this.character.face(m.x, m.z);
    this.say(`The ${mob.info.name} attacks!`);

    const run = this.run;
    let start;
    try {
      start = await this.api.startEncounter(run && mob.run ? { Run: run.id, Floor: mob.run.floor, Index: mob.run.index, Mob: mob.info.id } : { Spawn: mob.spawn.id, Mob: mob.info.id });
    } catch (e) {
      this.say(refusal(e));
      mob.engaged = false;
      mob.rest = 5;
      this.paused = false;
      return;
    }

    const closed = await this.openCards("duel", {
      token: start.Token,
      seed: start.Seed,
      duel: start.Duel,
      mob: { id: mob.info.id, name: mob.info.name, tier: mob.info.tier, map: this.space.id, spawn: mob.spawn.id },
    }, false);
    const outcome = closed.outcome === "won" ? "won" : "lost";
    if (this.api instanceof MockApi) this.api.settle(start.Token, outcome);
    const log = Array.isArray(closed.result?.log) ? (closed.result.log as string[]) : [];
    const result = await this.api.finishEncounter({ Token: start.Token, Log: log });

    if (result.Outcome === "won") {
      if (run && mob.run) run.beaten.add(`${mob.run.floor}:${mob.run.index}`);
      else this.beaten.add(`${mob.spawn.id}|${mob.epoch}`);
      this.scene.scene.remove(mob.walker.character.root);
      mob.walker.character.dispose();
      this.mobs.splice(this.mobs.indexOf(mob), 1);
      this.say(`You defeated the ${mob.info.name}: ${gold(result.Gold)} gold.`);
      for (const relic of result.Relics ?? []) this.say(`A relic falls from the ${mob.info.name}: ${relic} is yours, and yours alone.`);
      if (result.Offer.length > 0) {
        const loot = await this.openCards("loot", { token: start.Token, offer: result.Offer, cap: result.Cap, mob: mob.info.name }, false);
        const picks = Array.isArray(loot.result?.picks) ? (loot.result.picks as string[]) : [];
        if (picks.length > 0) {
          try {
            await this.api.takeLoot({ Token: start.Token, Picks: picks });
            this.say(`You take ${picks.join(", ")}.`);
          } catch (e) {
            this.say(refusal(e));
          }
        }
      }
      await this.refresh();
      if (run && mob.run?.role === "boss") {
        // The boss beaten: the way out opens beside where it stood, and a tower's waystone attunes.
        this.showFloor(run, this.player.hex);
        if (run.dungeon.waystone && this.attuned.includes(run.dungeon.id)) this.say(`The waystone of ${run.dungeon.name} is attuned to you.`);
        this.say("A way out opens beside you.");
      }
      this.paused = false;
    } else {
      await this.refresh();
      const old = this.run ? this.scene : null;
      this.run = null;
      // The server moved the character to their inn.
      await this.cross(null, async () => {
        const at = hex(this.data.Q, this.data.R);
        if (this.data.Map === "world") await this.streamAround(at, true);
        return async () => {
          if (this.data.Map !== "world" && hasInterior(this.data.Map)) {
            const built = await this.buildInterior(this.data.Map);
            this.leaveSpace();
            await this.arrive(built.space, built.scene, this.inward(built.space, hex(built.data.entry.q, built.data.entry.r)), false);
          } else {
            this.leaveSpace();
            await this.arrive(this.world, this.worldScene, this.world.passable(at) ? at : this.nearestOpen(this.world, at), false);
            this.spawnWorldMobs();
          }
          old?.dispose();
        };
      });
      const town = townAt(WORLD.towns, this.player.hex);
      this.say(`You lost the duel, and wake at the inn in ${town?.name ?? this.space.name}.`);
    }
  }

  async openGear(): Promise<void> {
    if (this.paused) return;
    await this.openCards("gear", { name: this.data.Name });
    await this.refresh();
  }

  // --- Other players -----------------------------------------------------------------------------------------------------

  private hear(message: ServerMessage): void {
    if (!this.space || this.space.kind === "dungeon") return;
    switch (message.Type) {
      case "Welcome":
        for (const other of message.Others) this.hear({ Type: "Other", ...other });
        break;
      case "Other": {
        this.visitors.get(message.Player)?.walker.character.dispose();
        const character = Character.player(message.Name, lookToAppearance(message.Look, message.Identity));
        this.scene.scene.add(character.root);
        const from = hex(message.At[0], message.At[1]);
        const walker = new Walker(character, this.space.passable(from) ? from : this.player.hex, message.Speed || PLAYER_SPEED, (h) => this.scene.surface(h));
        const visitor: Visitor = { player: message.Player, name: message.Name, identity: message.Identity, walker };
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
        const visitor = this.visitors.get(message.Player);
        visitor?.walker.character.setAppearance(lookToAppearance(message.Look, visitor.identity));
        break;
      }
      case "Emoted":
        this.say(`${this.visitors.get(message.Player)?.name ?? "Someone"} ${message.Emote}.`);
        break;
      case "Left": {
        const visitor = this.visitors.get(message.Player);
        if (visitor) {
          this.scene.scene.remove(visitor.walker.character.root);
          visitor.walker.character.dispose();
          this.visitors.delete(message.Player);
        }
        break;
      }
      case "Refused": {
        // A walk refused leaves the player where the server says they truly are.
        if (message.At.length !== 2) break;
        const at = hex(message.At[0], message.At[1]);
        if (this.space.passable(at)) this.player.place(at);
        break;
      }
    }
  }

  private walkVisitor(visitor: Visitor, from: readonly [number, number], path: readonly (readonly [number, number])[], speed: number, since: number): void {
    const start = hex(from[0], from[1]);
    if (this.space.passable(start) && !equals(visitor.walker.hex, start)) visitor.walker.place(start);
    visitor.walker.speed = speed || PLAYER_SPEED;
    visitor.walker.walk(path.map(([q, r]) => hex(q, r)).filter((h) => this.space.tile(h) !== undefined));
    const late = (Date.now() - since) / 1000;
    if (Number.isFinite(late) && late > 0.05) visitor.walker.skip(Math.min(late, 60));
  }

  // --- The loop ----------------------------------------------------------------------------------------------------------

  dots(): MinimapDot[] {
    const dots: MinimapDot[] = [];
    for (const m of this.mobs) dots.push({ hex: m.walker.hex, kind: "mob" });
    for (const v of this.visitors.values()) dots.push({ hex: v.walker.hex, kind: "other" });
    dots.push({ hex: this.player.hex, kind: "player" });
    return dots;
  }

  private loop(): void {
    let minimap = 0;
    const frame = () => {
      const seconds = Math.min(this.clock.getDelta(), 0.1);
      if (this.scene && this.screen !== "loading") {
        if (!this.paused) {
          this.player.update(seconds);
          for (const mob of [...this.mobs]) {
            if (mob.think(seconds, this.player, this.free(mob.walker), this.options.wander)) void this.engage(mob);
            mob.walker.update(seconds);
          }
          for (const v of this.visitors.values()) v.walker.update(seconds);
        }
        if (this.space === this.world) this.background(seconds);
        if (this.ease) {
          this.ease.t = Math.min(1, this.ease.t + (seconds * 1000) / this.ease.ms);
          const t = this.ease.t * this.ease.t * (3 - 2 * this.ease.t);
          this.focus.lerpVectors(this.ease.from, this.ease.to, t);
        } else this.focus.copy(this.character.root.position);
        this.scene.update(seconds, this.focus);
        minimap -= seconds;
        if (minimap <= 0) {
          this.hud.drawMap(this.space, this.dots(), this.attuned);
          minimap = 0.2;
        }
        this.pixels.lookAt(this.focus);
        this.pixels.render(this.scene.scene);
      }
      requestAnimationFrame(frame);
    };
    frame();
  }
}

function lookToAppearance(look: Look, identity: string): Appearance {
  const slots: Partial<Record<Slot, GearLook>> = {};
  for (const [slot, s] of Object.entries(look.Slots)) {
    if ((SLOTS as readonly string[]).includes(slot)) slots[slot as Slot] = { mesh: s.Mesh, palette: s.Palette };
  }
  const body = (["lithe", "broad", "tall", "stocky"] as const).find((b) => b === look.Body) ?? "lithe";
  return { body, palette: look.Palette, identity: identityOf({ Identity: identity }), slots };
}

function refusal(e: unknown): string {
  if (e instanceof ApiError) return e.detail || e.code;
  return e instanceof Error ? e.message : String(e);
}

export { key };
