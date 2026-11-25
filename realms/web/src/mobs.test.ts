import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mobInfo, theMob } from "./mobs";

// A mob's `named` (a proper name, said with no article) is what its card says: a legendary creature or planeswalker the
// mob is named for, by its whole name or the start of it ("Teferi" for Teferi, Hero of Dominaria). "The Phyrexian
// Praetor" is Sheoldred, but not by name.
const root = join(__dirname, "..", "..", "..");
const mobs = join(root, "realms", "content", "dominaria", "mobs");
const cards = join(root, "content", "mtg", "cards");
const slug = (name: string) =>
  name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

describe("a mob's name in a sentence", () => {
  it("is bare for a legend named for itself, and takes 'the' otherwise, as its card says", () => {
    const wrong: string[] = [];
    for (const file of readdirSync(mobs).filter((f) => f.endsWith(".json"))) {
      const mob = JSON.parse(readFileSync(join(mobs, file), "utf8")) as { id: string; name: string; creature?: string; named?: boolean };
      const creature = mob.creature ?? mob.name;
      const card = JSON.parse(readFileSync(join(cards, `${slug(creature)}.json`), "utf8")) as { type: string };
      const named = card.type.startsWith("Legendary") && creature.startsWith(mob.name);
      if ((mob.named ?? false) !== named) wrong.push(`${mob.id}: named should be ${named}`);
    }
    expect(wrong).toEqual([]);
  });

  it("says a legend bare and anything else with its article", () => {
    expect(`You defeated ${theMob(mobInfo("rofellos"), false)}: 1,500 gold.`).toBe("You defeated Rofellos, Llanowar Emissary: 1,500 gold.");
    expect(`${theMob(mobInfo("rorix-bladewing"))} attacks!`).toBe("Rorix Bladewing attacks!");
    expect(`${theMob(mobInfo("llanowar-elves"))} attacks!`).toBe("The Llanowar Elves attacks!");
    expect(`You defeated ${theMob(mobInfo("phyrexian-praetor"), false)}.`).toBe("You defeated the Phyrexian Praetor.");
  });
});

// What a mob says when it beats the player (interfaces.md, "Mobs"): a line for each way it won - without losing a point
// of life, having taken some damage, or with a quarter of its life or less - the same line wherever the duel was, so no
// line speaks of an offer the world may not make there.
describe("a mob's lines when it wins", () => {
  it("has two or three short lines of each kind, none of them about gold or another fight", () => {
    const wrong: string[] = [];
    const files = readdirSync(mobs).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const mob = JSON.parse(readFileSync(join(mobs, file), "utf8")) as { id: string; lines?: Record<string, unknown> };
      for (const kind of ["flawless", "solid", "close"]) {
        const lines = mob.lines?.[kind];
        if (!Array.isArray(lines) || lines.length < 2 || lines.length > 3) {
          wrong.push(`${mob.id}: lines.${kind} should be two or three lines`);
          continue;
        }
        for (const line of lines as unknown[]) {
          if (typeof line !== "string" || line.trim() === "" || line.length > 160) wrong.push(`${mob.id}: lines.${kind} has ${JSON.stringify(line)}, not a line of 1-160 characters`);
          else if (/gold|pay|coin|again|rematch/i.test(line)) wrong.push(`${mob.id}: lines.${kind} speaks of an offer: ${line}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
