// How a map is written out: readable JSON, one tile, prop or entity to a line, so a map's file diffs well and can be
// tuned by hand. The generator (scripts/maps.ts) and the map editor's save both write this.

import type { MapData } from "./schema";

const line = (value: unknown) => JSON.stringify(value);

export function formatMap(map: MapData): string {
  const ordered: Record<string, unknown> = {
    id: map.id,
    name: map.name,
    kind: map.kind,
    ...(map.region !== undefined ? { region: map.region } : {}),
    ...(map.floor !== undefined ? { floor: map.floor } : {}),
    ...(map.requires !== undefined ? { requires: map.requires } : {}),
    radius: map.radius,
    ...(map.inn !== undefined ? { inn: map.inn } : {}),
  };
  const head = Object.entries(ordered).map(([k, v]) => `  ${line(k)}: ${line(v)}`);
  const list = (name: string, items: readonly unknown[]) =>
    items.length === 0 ? `  ${line(name)}: []` : `  ${line(name)}: [\n${items.map((i) => `    ${line(i)}`).join(",\n")}\n  ]`;
  const lists = [
    list("exits", map.exits),
    list("npcs", map.npcs),
    list("spawns", map.spawns),
    list("chests", map.chests),
    ...(map.encounters !== undefined ? [list("encounters", map.encounters)] : []),
    list("props", map.props),
    list("tiles", map.tiles),
  ];
  return `{\n${[...head, ...lists].join(",\n")}\n}\n`;
}
