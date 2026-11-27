// A town and its grounds at walking scale (design.md A6 "Towns"; tech.md B5 "Dominaria as generated": Towns): one call
// lays a town's whole pocket into the Land - the town within its wall, laid out from the one template every town shares
// (hub.ts), and the scenery round it - and says what it built. The integrator places the pocket (`origin`) and fills what
// lies on the travel map (the town's `site`, each way's `outside`).

import type { Land } from "../land";
import type { TownLayout } from "../layout";
import { buildHub, hubGrounds } from "./hub";
import type { BuiltTown, TownSpec } from "./types";

export type { BuiltTown, InteriorSpec, TownSetting, TownSpec, TownWay, Side } from "./types";
export { formOf } from "./forms";

/** The size of the grounds a town needs, whole chunks (multiples of 32) each way. */
export function groundsSize(plan: TownLayout): readonly [number, number] {
  return hubGrounds(plan);
}

/** Lays the whole grounds into the Land at the spec's `origin`. */
export function buildTown(target: Land, spec: TownSpec, seed: number, _options: { readonly lenient?: boolean } = {}): BuiltTown {
  if (spec.setting.ways.length === 0) throw new Error(`${spec.plan.id}: a setting with no way out (TownSetting.ways is empty)`);
  return buildHub(target, spec, seed);
}
