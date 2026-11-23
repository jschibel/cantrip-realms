import * as THREE from "three";
import type { CardScreens, Closed } from "./cardLayer";
import { type Appearance, Character, type GearLook, type ManaColor, SLOTS, type Slot } from "./character";
import { Mob, PLAYER_SPEED, type Visitor, Walker, besides } from "./entities";
import { type Hex, distance, equals, findPath, hex, key } from "./hex";
import { type MinimapDot, Hud, gold } from "./hud";
import type { GameMap } from "./maps/gameMap";
import { nearestInn, worldLocation } from "./maps/graph";
import { loadMap } from "./maps/load";
import type { NpcData } from "./maps/schema";
import { mobInfo } from "./mobs";
import { ApiError, type Character as CharacterData, type RealmApi } from "./net/api";
import { MockApi } from "./net/mockApi";
import type { Look, Presence, ServerMessage } from "./net/presence";
import { DOMINARIA } from "./palette";
import { PixelRenderer } from "./render";
import { World } from "./scene/world";
import { showDialog } from "./screens/dialog";
import { type EncounterMode, type PlaceInfo, TravelScreen } from "./screens/travel";
import { spawnEpoch, spawnMob } from "./spawn";

// The overworld (tech.md, B5): the map you are on and everyone on it, what a click means, what happens at exits, at
// the people of a town, at chests and when a mob reaches you, and the travel screen between maps. The server owns
// everything of value; this asks it (RealmApi) and shows the answers, and opens card screens over the world
// (CardScreens) for duels, the spell table, vendors, loot and gear.

export interface Options {
  /** Whether mobs wander (tests turn it off; they still chase). */
  readonly wander: boolean;
  readonly encounters: EncounterMode;
  /** The clock spawns are computed on, unix seconds. */
  readonly now: () => number;
}

/** What a click on a hex would do, for the marker's color and the cursor. */
export type Intent = "walk" | "attack" | "talk" | "open" | "exit" | "none";

const INTENT_COLORS: Record<Intent, string> = { walk: "#f1b44c", attack: "#c8432c", talk: "#62a4c2", open: "#f1b44c", exit: "#a97fd0", none: "#4f5363" };

export class Overworld {
  readonly pixels: PixelRenderer;
  readonly hud: Hud;
  map!: GameMap;
  world!: World;
  player!: Walker;
  character!: Character;
  data!: CharacterData;
  readonly mobs: Mob[] = [];
  readonly visitors = new Map<string, Visitor>();
  private travel: TravelScreen | null = null;
  private readonly placeInfo = new Map<string, PlaceInfo>();
  /** Spawn epochs whose mob was beaten here: `map|spawn|epoch`. */
  private readonly beaten = new Set<string>();
  private readonly opened = new Set<string>();
  /** Where the world map's marker is when travel resumes from an encounter map. */
  private travelAt: Hex | null = null;
  /** What is going on: walking the map, travelling, a dialog, a card screen, loading. */
  screen: string = "loading";
  paused = true;
  hoverIntent: Intent = "none";
  private readonly clock = new THREE.Clock();
  private lastTravelReport = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly api: RealmApi,
    readonly layer: CardScreens,
    readonly presence: Presence | null,
    readonly options: Options,
  ) {
    this.pixels = new PixelRenderer(canvas, DOMINARIA);
    this.hud = new Hud(layer);
    layer.onChange = () => this.hud.showLayer();
    this.hud.showLayer();
    if (presence) presence.onMessage = (m) => this.hear(m);
    window.addEventListener("resize", () => this.pixels.resize());
    document.querySelector<HTMLButtonElement>("[data-test='hud:gear']")?.addEventListener("click", () => void this.openGear());
  }

  say(text: string): void {
    this.hud.say(text);
  }

  /** The world map's travel screen, once it has been opened. */
  get travelScreen(): TravelScreen | null {
    return this.travel;
  }

  get appearance(): Appearance {
    const slots: Partial<Record<Slot, GearLook>> = {};
    for (const slot of SLOTS) {
      const gear = this.data.Loadout[slot];
      if (gear) slots[slot] = { mesh: gear.look.mesh, palette: gear.look.palette };
    }
    return { body: this.data.Body, palette: this.data.Palette, identity: this.data.Identity, slots };
  }

  /** Starts the overworld for a character, on the map it is on (or `at`, a test's or a developer's choice). */
  async start(data: CharacterData, at?: { map: string; hex?: Hex }): Promise<void> {
    this.data = data;
    this.hud.showCharacter(data);
    this.character = Character.player(data.Name, this.appearance);
    this.sendLook();
    const map = at?.map ?? data.Map;
    await this.enter(map, { at: at?.hex ?? (data.Map === map && (data.Q !== 0 || data.R !== 0) ? hex(data.Q, data.R) : undefined) });
    this.loop();
  }

  /** Asks the server for the character again (gold, ante, gear may have changed) and shows it. */
  async refresh(): Promise<void> {
    const data = await this.api.me();
    if (!data) return;
    const looks = JSON.stringify(this.data.Loadout) !== JSON.stringify(data.Loadout);
    this.data = data;
    this.hud.showCharacter(data);
    if (looks) {
      this.character.setAppearance(this.appearance);
      this.sendLook();
    }
  }

  private sendLook(): void {
    const slots: Record<string, { Mesh: string; Palette: readonly string[] }> = {};
    for (const [slot, look] of Object.entries(this.appearance.slots)) slots[slot] = { Mesh: look.mesh, Palette: look.palette };
    this.presence?.send({ Type: "Look", Body: this.data.Body, Palette: this.data.Palette, Slots: slots });
  }

  /** Goes to a map: arriving from `from` (a map id or "world"), or standing at `at`. */
  async enter(id: string, where: { from?: string; at?: Hex } = {}): Promise<void> {
    this.screen = "loading";
    this.paused = true;
    const map = await loadMap(id);
    if (this.world) {
      this.world.scene.remove(this.character.root);
      this.world.dispose();
    }
    for (const mob of this.mobs) mob.walker.character.dispose();
    this.mobs.length = 0;
    for (const v of this.visitors.values()) v.walker.character.dispose();
    this.visitors.clear();

    this.map = map;
    this.world = new World(map);
    this.world.scene.add(this.character.root);
    const at = where.at && map.passable(where.at) ? where.at : where.from ? map.arrival(where.from) : map.respawn();
    this.player = new Walker(this.character, at, PLAYER_SPEED, (h) => this.world.surface(h));
    this.player.onStep = () => this.reportTravel();

    const now = this.options.now();
    for (const spawn of map.spawns) {
      const epoch = spawnEpoch(spawn, now);
      if (this.beaten.has(`${map.id}|${spawn.id}|${epoch}`)) continue;
      const info = mobInfo(spawnMob(this.data.Id, map.id, spawn, epoch));
      const character = Character.mob(info.name, info.model);
      this.world.scene.add(character.root);
      const walker = new Walker(character, hex(spawn.q, spawn.r), 1.4, (h) => this.world.surface(h));
      this.mobs.push(new Mob(walker, info, spawn, epoch));
    }
    for (const chest of map.data.chests) {
      if (this.opened.has(`${map.id}|${chest.id}|${spawnEpoch(chest, now)}`)) this.world.setChest(chest.id, true);
    }

    this.hud.showMap(map);
    this.presence?.send({ Type: "Enter", Map: map.id });
    this.presence?.send({ Type: "Move", From: [at.q, at.r], Path: [], Speed: PLAYER_SPEED });
    void this.api.travel({ Map: map.id, Q: at.q, R: at.r }).catch(() => {});
    this.screen = "world";
    this.paused = false;
    this.say(`${map.name}.`);
  }

  private reportTravel(): void {
    const now = performance.now();
    if (now - this.lastTravelReport < 2000 && this.player.path.length > 0) return;
    this.lastTravelReport = now;
    void this.api.travel({ Map: this.map.id, Q: this.player.hex.q, R: this.player.hex.r }).catch(() => {});
  }

  // --- What is where -------------------------------------------------------------------------------------------------

  private walkers(): Walker[] {
    return [this.player, ...this.mobs.map((m) => m.walker)];
  }

  /** Whether `who` may step onto a hex: open ground nobody else stands on. */
  free = (who: Walker) => (h: Hex): boolean => this.map.passable(h) && !this.walkers().some((w) => w !== who && equals(w.hex, h));

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
    const thing = this.map.thing(h);
    if (thing?.kind === "exit") return "exit";
    if (thing?.kind === "chest") return "open";
    if (thing?.kind === "npc") return "talk";
    return this.map.passable(h) ? "walk" : "none";
  }

  /** Shows what the pointer is over: the marker, colored for what a click would do, and the cursor. */
  hoverAt(h: Hex | null, mob?: Mob): void {
    if (this.paused) {
      this.world?.mark(null);
      this.hoverIntent = "none";
      return;
    }
    const intent = this.intentAt(h, mob);
    this.hoverIntent = intent;
    this.world.mark(intent === "none" ? null : mob ? mob.walker.hex : h, INTENT_COLORS[intent]);
  }

  // --- Clicks ----------------------------------------------------------------------------------------------------------

  /** A click on the world: walk, or walk to what was clicked and use it. */
  click(h: Hex | null, mob?: Mob): void {
    if (this.paused) return;
    if (mob) {
      this.approach(mob);
      return;
    }
    if (!h) return;
    const thing = this.map.thing(h);
    if (thing?.kind === "npc") return this.walkBeside(h, () => void this.talk(thing.npc));
    if (thing?.kind === "chest") return this.walkBeside(h, () => void this.openChest(thing.chest.id, h));
    if (thing?.kind === "exit") {
      const path = equals(this.player.hex, h) ? [] : findPath(this.player.hex, h, this.free(this.player));
      if (path) this.walkThen(path, () => void this.takeExit(thing.exit.to));
      else this.say("You can't get there.");
      return;
    }
    const path = findPath(this.player.hex, h, this.free(this.player));
    if (path) this.walkThen(path);
    else this.say("You can't get there.");
  }

  private walkThen(path: Hex[], then?: () => void): void {
    this.player.walk(path, () => {
      this.reportTravel();
      then?.();
    });
    const to = path.at(-1) ?? this.player.hex;
    this.presence?.send({ Type: "Move", From: [this.player.hex.q, this.player.hex.r], Path: path.map((s) => [s.q, s.r] as const), Speed: PLAYER_SPEED });
    void to;
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
    const at = this.world.surface(h);
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

  // --- People, chests, exits ---------------------------------------------------------------------------------------------

  /** Opens a card screen over the world, which stands still meanwhile (and after, unless `resume`). */
  private async openCards(screen: Parameters<CardScreens["open"]>[0], args: Record<string, unknown>, resume = true): Promise<Closed> {
    this.paused = true;
    this.screen = screen;
    this.world.mark(null);
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
    this.world.mark(null);
    try {
      return await showDialog(title, lines, buttons);
    } finally {
      this.screen = "world";
      this.paused = false;
    }
  }

  async talk(npc: NpcData): Promise<void> {
    this.character.play("interact");
    const resident = this.world.residents.find((r) => r.npc.id === npc.id);
    if (resident) {
      const at = this.player.character.root.position;
      resident.character.face(at.x, at.z);
    }
    switch (npc.kind) {
      case "spell-table": {
        this.say("You open your spellbook at the table.");
        await this.openCards("spell-table", { map: this.map.id, name: `the spell table at ${this.map.name}` });
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
        await this.openCards("gear", { armorer: this.map.id, name: `the armorer of ${this.map.name}` });
        await this.refresh();
        break;
      }
      case "inn": {
        const choice = await this.dialog(npc.name ?? "The inn", npc.text ?? ["Rest here, and here you wake."], [
          { caption: "Rest", value: "rest", primary: true },
          { caption: "Leave", value: "leave" },
        ]);
        if (choice === "rest") {
          await this.api.travel({ Map: this.map.id, Q: this.player.hex.q, R: this.player.hex.r }).catch(() => {});
          this.say(`You rest at ${npc.name ?? "the inn"}.`);
        }
        break;
      }
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

  private async openChest(id: string, h: Hex): Promise<void> {
    this.character.play("interact");
    try {
      const { Gold } = await this.api.openChest({ Map: this.map.id, Chest: id });
      const chest = this.map.data.chests.find((c) => c.id === id)!;
      this.opened.add(`${this.map.id}|${id}|${spawnEpoch(chest, this.options.now())}`);
      this.world.setChest(id, true);
      this.say(`You open the chest: ${gold(Gold)} gold.`);
      await this.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "Empty") {
        this.world.setChest(id, true);
        this.say("The chest is empty.");
      } else this.say(refusal(e));
    }
    void h;
  }

  private async takeExit(to: string): Promise<void> {
    if (to !== "world") {
      const from = this.map.id;
      await this.enter(to, { from });
      return;
    }
    const at = (await worldLocation(this.map.id, (id) => loadMap(id).then((m) => m.data))) ?? this.travelAt ?? hex(0, 0);
    await this.openTravel(at);
  }

  /** The world map: travel from `at` until arriving somewhere, or being stopped by an encounter. */
  async openTravel(at: Hex): Promise<void> {
    this.paused = true;
    this.screen = "travel";
    const worldMap = await loadMap("world");
    if (!this.travel) {
      this.travel = new TravelScreen(worldMap, (id) => this.placeInfo.get(id) ?? { id, name: id, kind: null }, this.options.encounters);
      // Names and kinds of places, as their maps load.
      void Promise.all(worldMap.data.exits.map(async (e) => {
        const map = await loadMap(e.to);
        this.placeInfo.set(e.to, { id: e.to, name: map.name, kind: map.kind });
      }));
    }
    const end = await this.travel.open(at);
    this.travelAt = end.at;
    if (end.kind === "encounter") this.say("Something blocks the way!");
    await this.enter(end.map, { from: "world" });
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

    let start;
    try {
      start = await this.api.startEncounter({ Map: this.map.id, Spawn: mob.spawn.id, Mob: mob.info.id });
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
      mob: { id: mob.info.id, name: mob.info.name, tier: mob.info.tier, map: this.map.id, spawn: mob.spawn.id },
    }, false);
    const outcome = closed.outcome === "won" ? "won" : "lost";
    if (this.api instanceof MockApi) this.api.settle(start.Token, outcome);
    const log = Array.isArray(closed.result?.log) ? (closed.result.log as string[]) : [];
    const result = await this.api.finishEncounter({ Token: start.Token, Log: log });

    if (result.Outcome === "won") {
      this.beaten.add(`${this.map.id}|${mob.spawn.id}|${mob.epoch}`);
      this.world.scene.remove(mob.walker.character.root);
      mob.walker.character.dispose();
      this.mobs.splice(this.mobs.indexOf(mob), 1);
      this.say(`You defeated the ${mob.info.name}: ${gold(result.Gold)} gold.`);
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
      this.paused = false;
    } else {
      await this.refresh();
      const inn = (await nearestInn(this.map.id, (id) => loadMap(id).then((map) => map.data))) ?? "new-argive";
      await this.enter(inn);
      this.say(`You lost the duel, and wake at the inn in ${this.map.name}.`);
    }
  }

  async openGear(): Promise<void> {
    if (this.paused) return;
    await this.openCards("gear", { name: this.data.Name });
    await this.refresh();
  }

  // --- Other players -----------------------------------------------------------------------------------------------------

  private hear(message: ServerMessage): void {
    if (!this.map) return;
    switch (message.Type) {
      case "Welcome":
        for (const other of message.Others) this.hear({ Type: "Other", ...other });
        break;
      case "Other": {
        this.visitors.get(message.Player)?.walker.character.dispose();
        const character = Character.player(message.Name, lookToAppearance(message.Look, message.Identity));
        this.world.scene.add(character.root);
        const from = hex(message.At[0], message.At[1]);
        const walker = new Walker(character, this.map.passable(from) ? from : this.map.respawn(), message.Speed || PLAYER_SPEED, (h) => this.world.surface(h));
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
          this.world.scene.remove(visitor.walker.character.root);
          visitor.walker.character.dispose();
          this.visitors.delete(message.Player);
        }
        break;
      }
      case "Refused": {
        const at = hex(message.At[0], message.At[1]);
        if (this.map.passable(at)) this.player.place(at);
        break;
      }
    }
  }

  private walkVisitor(visitor: Visitor, from: readonly [number, number], path: readonly (readonly [number, number])[], speed: number, since: string): void {
    const start = hex(from[0], from[1]);
    if (this.map.passable(start) && !equals(visitor.walker.hex, start)) visitor.walker.place(start);
    visitor.walker.speed = speed || PLAYER_SPEED;
    visitor.walker.walk(path.map(([q, r]) => hex(q, r)).filter((h) => this.map.tile(h) !== undefined));
    const late = (Date.now() - Date.parse(since)) / 1000;
    if (Number.isFinite(late) && late > 0.05) visitor.walker.skip(Math.min(late, 60));
  }

  // --- The loop ----------------------------------------------------------------------------------------------------------

  dots(): MinimapDot[] {
    const dots: MinimapDot[] = [];
    for (const e of this.map.data.exits) dots.push({ hex: hex(e.q, e.r), kind: "exit" });
    for (const n of this.map.data.npcs) dots.push({ hex: hex(n.q, n.r), kind: "npc" });
    for (const c of this.map.data.chests) dots.push({ hex: hex(c.q, c.r), kind: "chest" });
    for (const m of this.mobs) dots.push({ hex: m.walker.hex, kind: "mob" });
    for (const v of this.visitors.values()) dots.push({ hex: v.walker.hex, kind: "other" });
    dots.push({ hex: this.player.hex, kind: "player" });
    return dots;
  }

  private loop(): void {
    let minimap = 0;
    const frame = () => {
      const seconds = Math.min(this.clock.getDelta(), 0.1);
      if (this.world && this.screen !== "loading") {
        if (!this.paused) {
          this.player.update(seconds);
          for (const mob of [...this.mobs]) {
            if (mob.think(seconds, this.player, this.free(mob.walker), this.options.wander)) void this.engage(mob);
            mob.walker.update(seconds);
          }
          for (const v of this.visitors.values()) v.walker.update(seconds);
          this.world.update(seconds);
        }
        minimap -= seconds;
        if (minimap <= 0) {
          this.hud.drawDots(this.dots());
          minimap = 0.2;
        }
        this.pixels.lookAt(this.character.root.position);
        this.pixels.render(this.world.scene);
      }
      requestAnimationFrame(frame);
    };
    frame();
  }
}

function lookToAppearance(look: Look, identity: readonly string[]): Appearance {
  const slots: Partial<Record<Slot, GearLook>> = {};
  for (const [slot, s] of Object.entries(look.Slots)) {
    if ((SLOTS as readonly string[]).includes(slot)) slots[slot as Slot] = { mesh: s.Mesh, palette: s.Palette };
  }
  const body = (["lithe", "broad", "tall", "stocky"] as const).find((b) => b === look.Body) ?? "lithe";
  return { body, palette: look.Palette, identity: identity.filter((c): c is ManaColor => "WUBRG".includes(c)), slots };
}

function refusal(e: unknown): string {
  if (e instanceof ApiError) return e.detail || e.code;
  return e instanceof Error ? e.message : String(e);
}

export { key };
