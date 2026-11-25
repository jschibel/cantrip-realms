import { gold } from "../hud";
import { isNarrated } from "../hearts";

// A duel lost with hearts left (design.md A3): the mob that won stands over the player - its portrait, its name, what it
// says (or, a beast, does) about the game, the hearts left - and the player answers. A world mob offers to be paid off,
// the offer greyed where the gold is not there; a dungeon's mob can't be, and is fought again. The panel can't be
// dismissed: the answer is the only way on. It resolves with the answer.

export interface DefeatPanel {
  /** The mob's name as a sentence opens with it ("The Llanowar Elves", "Rofellos, Llanowar Emissary"). */
  readonly mob: string;
  readonly portrait: string | null;
  readonly line: string;
  readonly hearts: number;
  readonly maxHearts: number;
  /** Its buyout; null for a dungeon's mob, which can't be paid off. */
  readonly price: number | null;
  /** The character's gold, which the buyout is measured against. */
  readonly gold: number;
}

export type DefeatAnswer = "pay" | "fight";

let open: { readonly answer: (a: DefeatAnswer) => void } | null = null;

/** Whether the panel is showing. */
export const defeatOpen = (): boolean => open !== null;

/** A row of hearts: `have` filled, the rest of `hold` empty. */
export function heartRow(have: number, hold: number, test: string): HTMLElement {
  const row = document.createElement("span");
  row.className = "hearts";
  row.dataset.test = test;
  row.dataset.hearts = String(have);
  row.dataset.max = String(hold);
  row.title = `${have} of ${hold} hearts`;
  for (let i = 0; i < hold; i++) {
    const heart = document.createElement("span");
    heart.className = i < have ? "heart full" : "heart empty";
    heart.textContent = i < have ? "♥" : "♡";
    row.appendChild(heart);
  }
  return row;
}

export function showDefeat(d: DefeatPanel): Promise<DefeatAnswer> {
  const layer = document.querySelector<HTMLElement>("#screens")!;
  const root = document.createElement("div");
  root.className = "dialog defeat";
  root.dataset.test = "defeat";
  root.dataset.dungeon = String(d.price === null);
  const card = document.createElement("div");
  card.className = "panel-card";

  const top = document.createElement("div");
  top.className = "defeat-top";
  if (d.portrait) {
    const img = document.createElement("img");
    img.className = "portrait";
    img.src = d.portrait;
    img.alt = d.mob;
    top.appendChild(img);
  }
  const who = document.createElement("div");
  const kicker = document.createElement("div");
  kicker.className = "kicker";
  kicker.textContent = "Defeated";
  const heading = document.createElement("h2");
  heading.textContent = `${d.mob} stands over you`;
  who.append(kicker, heading);
  top.appendChild(who);
  card.appendChild(top);

  const line = document.createElement("p");
  line.className = "line";
  line.dataset.test = "defeat:line";
  if (isNarrated(d.line)) {
    const em = document.createElement("em");
    em.textContent = d.line.trim().slice(1, -1);
    line.appendChild(em);
  } else line.textContent = `“${d.line}”`;
  card.appendChild(line);

  const hearts = document.createElement("p");
  hearts.className = "hearts-left";
  hearts.append(heartRow(d.hearts, d.maxHearts, "defeat:hearts"), ` ${d.hearts === 1 ? "One heart" : `${d.hearts} hearts`} left. Lose them all and you wake at home.`);
  card.appendChild(hearts);

  const offer = document.createElement("p");
  offer.className = "offer";
  offer.dataset.test = "defeat:offer";
  offer.textContent =
    d.price === null
      ? "There is no buying your way out down here: it will fight you again."
      : d.gold >= d.price
        ? `It will let you go for ${gold(d.price)} gold, or face you again.`
        : `It would let you go for ${gold(d.price)} gold, which you don't have. You must face it again.`;
  card.appendChild(offer);

  const row = document.createElement("div");
  row.className = "buttons";
  card.appendChild(row);
  root.appendChild(card);
  layer.appendChild(root);

  return new Promise<DefeatAnswer>((resolve) => {
    const done = (a: DefeatAnswer) => {
      root.remove();
      open = null;
      resolve(a);
    };
    if (d.price !== null) {
      const pay = document.createElement("button");
      pay.textContent = `Pay ${gold(d.price)} gold`;
      pay.dataset.test = "defeat:pay";
      pay.disabled = d.gold < d.price;
      pay.addEventListener("click", () => done("pay"));
      row.appendChild(pay);
    }
    const fight = document.createElement("button");
    fight.className = "primary";
    fight.textContent = "Fight again";
    fight.dataset.test = "defeat:fight";
    fight.addEventListener("click", () => done("fight"));
    row.appendChild(fight);
    open = { answer: done };
    fight.focus();
  });
}
