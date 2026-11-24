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
