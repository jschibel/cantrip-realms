// Which mob stands at a spawn point (realms/docs/interfaces.md, "Spawns"). The client shows and walks a spawn's mob;
// the realm server checks that the mob a duel is started against could be there, by the same algorithm, so the two
// sides agree byte for byte. The golden vectors in realms/content/spawn-vectors.json pin it on both sides.

import { fnv1a32 } from "./random";

export interface SpawnPoint {
  readonly id: string;
  readonly mobs: readonly string[];
  readonly respawnSeconds: number;
}

/** The spawn's epoch at a moment: a mob is beaten once per epoch, and a new one stands there in the next. */
export const spawnEpoch = (spawn: Pick<SpawnPoint, "respawnSeconds">, unixSeconds: number): number =>
  Math.floor(unixSeconds / spawn.respawnSeconds);

export const spawnKey = (player: string, map: string, spawn: string, epoch: number): string =>
  `${player}|${map}|${spawn}|${epoch}`;

/** The mob at a spawn point for a player in an epoch. */
export function spawnMob(player: string, map: string, spawn: SpawnPoint, epoch: number): string {
  const seed = fnv1a32(spawnKey(player, map, spawn.id, epoch));
  const mob = spawn.mobs[seed % spawn.mobs.length];
  if (mob === undefined) throw new Error(`spawn ${spawn.id} of ${map} has no mobs`);
  return mob;
}
