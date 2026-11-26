import { buildOn, settingsMatrix, TOWN_SETTINGS } from "./preview";
const id = process.argv[2]!;
for (const name of process.argv.slice(3)) {
  const c = name === "real" ? { setting: TOWN_SETTINGS[id]! } : settingsMatrix().find((m) => m.name.includes(name))!;
  try { buildOn(id, c.setting); console.log(`${name}: ok`); } catch (e) { console.log(`${name}: ${(e as Error).message.split("\n").slice(1).join("\n").slice(0, 2500)}`); }
}
