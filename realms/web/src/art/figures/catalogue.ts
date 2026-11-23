import { GEAR_PARTS, type GearLook, SLOTS } from "./gear";
import { FIGURES, figureSpec } from "./index";
import { MOB_MESHES, mobFigure } from "./mobs";
import { BODY_NAMES } from "./person";
import { playerFigure } from "./player";
import { MANA, SKINS } from "./ramps";
import type { FigureSpec } from "./rig";

// What the cast page (cast.html) shows, set by set: every body in every palette and color, every gear item of the
// content on a character, every gear part, every mob mesh, every mob of the roster as it is drawn, the bosses, the
// mages and the townsfolk. The tests build every entry too.

export interface CastEntry {
  readonly id: string;
  readonly label: string;
  readonly spec: () => FigureSpec;
  /**
   * How far it is turned from facing the camera, radians: a four-legged beast stands three-quarters on, since facing the
   * camera its body is hidden behind its head (and the figures' lean stacks the two into a column).
   */
  readonly turn?: number;
}

/** The meshes on four (or six) legs, shown three-quarters on. */
const ON_ALL_FOURS = new Set(["beast", "boar", "rat", "cat", "lhurgoyf", "horse", "pegasus", "elk-rider", "insect"]);
const turnOf = (mesh: string) => (ON_ALL_FOURS.has(mesh) ? 0.65 : 0);

export interface CastSet {
  readonly title: string;
  readonly entries: () => readonly CastEntry[];
  readonly perPage: number;
  readonly columns: number;
  /** Tiles between figures. */
  readonly spacing: number;
}

interface GearFile {
  readonly id: string;
  readonly name: string;
  readonly slot: string;
  readonly look: GearLook;
}

interface MobFile {
  readonly id: string;
  readonly name: string;
  readonly creature: string;
  readonly boss?: boolean;
  readonly model: { readonly mesh: string; readonly palette: readonly string[]; readonly size?: number };
}

const gearFiles = Object.values(import.meta.glob<GearFile>("../../../../content/gear/*.json", { eager: true, import: "default" })).sort((a, b) => a.slot.localeCompare(b.slot) || a.id.localeCompare(b.id));
const mobFiles = Object.values(import.meta.glob<MobFile>("../../../../content/*/mobs/*.json", { eager: true, import: "default" })).sort((a, b) => a.id.localeCompare(b.id));

export const CONTENT_GEAR: readonly GearFile[] = gearFiles;
export const CONTENT_MOBS: readonly MobFile[] = mobFiles;

const BODY_IDENTITY = ["W", "U", "R", "G"];

const once = <T>(make: () => T): (() => T) => {
  let v: T | undefined;
  return () => (v ??= make());
};

/** Which slot a content item goes in on a character: a ring in the right hand. */
const slotOf = (slot: string) => (slot === "ring" ? "ring1" : slot);

const BOSS_IDS = ["lyra", "teferi", "liliana", "garna", "rofellos", "praetor"];

export const CAST_SETS: Readonly<Record<string, CastSet>> = {
  bodies: {
    title: "Bodies",
    perPage: 24,
    columns: 8,
    spacing: 3,
    entries: once(() =>
      BODY_NAMES.flatMap((body, b) =>
        SKINS.map((skin, p) => ({ id: `${body}-${p}`, label: `${body} ${p}`, spec: () => playerFigure({ body, palette: p, identity: BODY_IDENTITY[(b + p) % 4]!, slots: {} }) })),
      ),
    ),
  },
  identities: {
    title: "Identities",
    perPage: 24,
    columns: 8,
    spacing: 3,
    entries: once(() =>
      ["W", "U", "B", "R", "G", "", "WU", "UB", "BR", "RG", "GW", "WB", "UR", "BG", "RW", "GU"].map((identity, i) => ({
        id: `identity-${identity || "C"}`,
        label: identity || "colorless",
        spec: () => playerFigure({ body: BODY_NAMES[i % 4]!, palette: i % 6, identity, slots: {} }),
      })),
    ),
  },
  gear: {
    title: "Gear (the content's items)",
    perPage: 16,
    columns: 8,
    spacing: 3,
    entries: once(() =>
      gearFiles.map((g, i) => ({
        id: `gear-${g.id}`,
        label: g.name,
        spec: () => playerFigure({ body: BODY_NAMES[i % 4]!, palette: i % 6, identity: MANA[i % 5]!, slots: { [slotOf(g.slot)]: g.look } }),
      })),
    ),
  },
  parts: {
    title: "Gear parts",
    perPage: 24,
    columns: 8,
    spacing: 3,
    entries: once(() => [
      ...GEAR_PARTS.ids().map((id, i) => {
        const part = GEAR_PARTS.get(id);
        const slot = part.slot === "ring" ? "ring1" : part.slot;
        return { id: `part-${id}`, label: id, spec: () => playerFigure({ body: BODY_NAMES[i % 4]!, palette: (i + 2) % 6, identity: MANA[(i + 1) % 5]!, slots: { [slot]: { mesh: id, palette: [...part.palette] } } }) };
      }),
      // Fully dressed: a slot of every kind at once, on each body.
      ...BODY_NAMES.map((body, i) => ({
        id: `dressed-${body}`,
        label: `${body}, dressed`,
        spec: () => {
          const pick = (slot: string) => gearFiles.filter((g) => g.slot === slot)[i % gearFiles.filter((g) => g.slot === slot).length]!.look;
          const slots: Record<string, GearLook> = {};
          for (const s of SLOTS) slots[s] = pick(s.startsWith("ring") ? "ring" : s);
          return playerFigure({ body, palette: i, identity: MANA[i]!, slots });
        },
      })),
    ]),
  },
  creatures: {
    title: "Mob meshes",
    perPage: 10,
    columns: 6,
    spacing: 4,
    entries: once(() => MOB_MESHES.ids().map((mesh) => ({ id: `mesh-${mesh}`, label: mesh, spec: () => mobFigure({ mesh, palette: [] }, mesh), turn: turnOf(mesh) }))),
  },
  roster: {
    title: "The roster",
    perPage: 10,
    columns: 6,
    spacing: 4,
    entries: once(() => mobFiles.map((m) => ({ id: `mob-${m.id}`, label: m.creature, spec: () => mobFigure(m.model, m.id, m.creature), turn: turnOf(m.model.mesh) }))),
  },
  bosses: {
    title: "Bosses",
    perPage: 6,
    columns: 3,
    spacing: 6,
    entries: once(() => mobFiles.filter((m) => m.boss || BOSS_IDS.includes(m.model.mesh)).map((m) => ({ id: `boss-${m.id}`, label: m.creature, spec: () => mobFigure(m.model, m.id, m.creature), turn: turnOf(m.model.mesh) }))),
  },
  mages: {
    title: "The tower mages",
    perPage: 20,
    columns: 5,
    spacing: 4,
    entries: once(() => mobFiles.filter((m) => m.id.startsWith("mage-")).map((m) => ({ id: `mage-${m.id}`, label: m.creature, spec: () => mobFigure(m.model, m.id, m.creature), turn: turnOf(m.model.mesh) }))),
  },
  npcs: {
    title: "Townsfolk",
    perPage: 24,
    columns: 8,
    spacing: 3,
    entries: once(() =>
      FIGURES.ids()
        .filter((id) => FIGURES.get(id).seeded)
        .flatMap((id) => [0, 1, 2].map((seed) => ({ id: `npc-${id}-${seed}`, label: `${id} ${seed}`, spec: () => figureSpec(id, undefined, seed) }))),
    ),
  },
  slice: {
    title: "The slice's cast",
    perPage: 12,
    columns: 7,
    spacing: 3,
    entries: once(() => ["hero", "knight", "grizzlegom", "goblin", "townswoman", "skeleton", "ghoul"].map((id) => ({ id, label: id, spec: () => figureSpec(id) }))),
  },
};
