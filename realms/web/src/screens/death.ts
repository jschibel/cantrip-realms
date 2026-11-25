import { gold } from "../hud";
import { heartRow } from "./defeat";

// The last heart lost (design.md A3b): the screen darkens and says so - who won, that the character wakes at home with
// their hearts full again, and what a dungeon run they fell in had won and is lost with it - until the player rises.

export interface DeathPanel {
  /** The mob that won, as a sentence names it mid-way ("the Llanowar Elves"). */
  readonly mob: string;
  /** The town of the inn they wake at. */
  readonly home: string;
  readonly hearts: number;
  /** The dungeon they fell in, and what its run had won, taken back; null outside one. */
  readonly run: { readonly dungeon: string; readonly gold: number; readonly cards: readonly string[]; readonly gear: readonly string[] } | null;
}

let open = false;

/** Whether the screen is showing. */
export const deathOpen = (): boolean => open;

export function showDeath(d: DeathPanel): Promise<void> {
  const layer = document.querySelector<HTMLElement>("#screens")!;
  const root = document.createElement("div");
  root.className = "dialog death";
  root.dataset.test = "death";
  const card = document.createElement("div");
  card.className = "panel-card";

  const heading = document.createElement("h2");
  heading.textContent = "You have fallen";
  card.appendChild(heading);
  const lines = [`Your last heart is spent: ${d.mob} has beaten you.`, `You wake at home, at the inn in ${d.home}, your hearts restored.`];
  if (d.run) {
    const lost = [d.run.gold > 0 ? `${gold(d.run.gold)} gold` : null, ...d.run.cards, ...d.run.gear].filter((x): x is string => !!x);
    lines.push(lost.length > 0 ? `Your run of ${d.run.dungeon} is over, and what it won is lost with it: ${lost.join(", ")}.` : `Your run of ${d.run.dungeon} is over.`);
  }
  for (const text of lines) {
    const p = document.createElement("p");
    p.textContent = text;
    card.appendChild(p);
  }
  const hearts = document.createElement("p");
  hearts.className = "hearts-left";
  hearts.appendChild(heartRow(d.hearts, d.hearts, "death:hearts"));
  card.appendChild(hearts);

  const row = document.createElement("div");
  row.className = "buttons";
  const rise = document.createElement("button");
  rise.className = "primary";
  rise.textContent = "Rise";
  rise.dataset.test = "death:rise";
  row.appendChild(rise);
  card.appendChild(row);
  root.appendChild(card);
  layer.appendChild(root);
  open = true;

  return new Promise<void>((resolve) => {
    const done = () => {
      window.removeEventListener("keydown", key);
      root.remove();
      open = false;
      resolve();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter") done();
    };
    window.addEventListener("keydown", key);
    rise.addEventListener("click", done);
    rise.focus();
  });
}
