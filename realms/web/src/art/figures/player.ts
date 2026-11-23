import * as C from "../paint/colors";
import { type GearLook, wearAll } from "./gear";
import { BODY_NAMES, BUILDS, type BodyName, type HairStyle, type Person, person } from "./person";
import { SKINS, full, identityRamps, rampOf } from "./ramps";
import type { FigureSpec } from "./rig";

// The player's character (design.md A1, A4): one of four bodies, one of six skin-and-hair palettes, dressed in the
// colors of their identity - a tunic and a cape in their first color, trimmed in their second - with each worn item's
// look on top (gear.ts). Presence sends exactly this (`Look`: Body, Palette, Slots) with the player's Identity, so what
// others see is what the player sees.

export interface Appearance {
  readonly body: BodyName | string;
  /** An index into SKINS (0-5). */
  readonly palette: number;
  /** The color identity, letters in WUBRG order ("" for colorless). */
  readonly identity: string;
  readonly slots: Readonly<Partial<Record<string, GearLook>>>;
}

/** Each body's hair: long on the lithe, cropped and bearded on the broad, a tail on the tall, the hero's spikes on the stocky. */
const HAIR: Readonly<Record<BodyName, HairStyle>> = { lithe: "long", broad: "crop", tall: "ponytail", stocky: "spiky" };

const TROUSERS = full(C.SLATE);
const BOOTS = full(C.WOOD);

/** A body name, or the lithe body for one this client does not know. */
export function bodyOf(name: string): BodyName {
  return (BODY_NAMES as readonly string[]).includes(name) ? (name as BodyName) : "lithe";
}

/** The character's description before gear: body, skin and hair, the identity's clothes. */
export function playerPerson(a: Appearance): Person {
  const body = bodyOf(a.body);
  const skin = SKINS[Math.max(0, Math.min(SKINS.length - 1, Math.floor(a.palette) || 0))]!;
  const { cloth, trim } = identityRamps(a.identity);
  return {
    name: `player:${body}:${a.palette}:${a.identity}`,
    build: BUILDS[body],
    skin: skin.skin,
    hair: { ramp: skin.hair, style: HAIR[body] },
    beard: body === "broad" ? { style: "short" } : undefined,
    top: { style: "tunic", ramp: cloth, trim },
    legs: TROUSERS,
    boots: undefined,
    cape: { ramp: cloth, trim, length: BUILDS[body].torso[1] + BUILDS[body].leg[1] - 2 },
    spark: rampOf(at3(cloth)),
    stride: 0.75,
    armSwing: 0.7,
  };
}

const at3 = (r: readonly number[]): number => r[3]!;

/** A key for a set of worn looks, so each outfit has a material of its own. */
function lookKey(slots: Appearance["slots"]): string {
  return Object.keys(slots)
    .sort()
    .map((k) => `${k}=${slots[k]!.mesh}/${slots[k]!.palette.join("")}`)
    .join(",");
}

/** A player's figure: their body and colors, wearing their gear. */
export function playerFigure(a: Appearance): FigureSpec {
  const base = playerPerson(a);
  const dressed = wearAll(base, a.slots);
  const spec = person({ ...dressed, name: `${base.name}|${lookKey(a.slots)}` });
  return spec;
}

/** The presence `Look` (interfaces.md, Presence) as the server relays it, with the player's identity from `Other`. */
export interface PresenceLook {
  readonly Body: string;
  readonly Palette: number;
  readonly Slots: Readonly<Record<string, { readonly Mesh: string; readonly Palette: readonly string[] }>>;
}

/** Another player's figure from what presence says of them. */
export function lookFigure(look: PresenceLook, identity: string): FigureSpec {
  const slots: Record<string, GearLook> = {};
  for (const [slot, s] of Object.entries(look.Slots ?? {})) slots[slot] = { mesh: s.Mesh, palette: s.Palette };
  return playerFigure({ body: look.Body, palette: look.Palette, identity, slots });
}

export { BOOTS };
