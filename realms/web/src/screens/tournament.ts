// A dungeon is a tournament (design.md A6, "Dungeon runs"): the board at its entrance before a run begins - the dungeon,
// its rounds, the rule of a round, its boss and its prizes, the player's hearts and what is at stake - and the panel at a
// round's open gate, where the player cashes out or pushes on.

/** What the entrance's board shows: only what the page knows of the dungeon before the server deals its run. */
export interface Board {
  readonly dungeon: string;
  readonly tier: number;
  /** How the character's standing to the dungeon's color deals it, in a sentence; null as written. */
  readonly standing: string | null;
  /** How many rounds before the boss's hall: the fewest and the most. */
  readonly rounds: readonly [number, number];
  /** How many challengers stand in a round, and how many of them open its gate. */
  readonly challengers: number;
  readonly toWin: number;
  /** What a challenger's win pays, the least and the most. */
  readonly gold: readonly [number, number] | null;
  readonly boss: {
    readonly name: string;
    readonly gold: readonly [number, number];
    /** A boss's gift, a rare or mythic card of its loot; a mage gives none. */
    readonly gift: boolean;
    /** Its own gear item, by name. */
    readonly unique: string | null;
    /** A mage tower's: its waystone attuned by the win. */
    readonly waystone: boolean;
    /** The color its win unlocks, by name. */
    readonly unlocks: string | null;
  };
  readonly hearts: number;
  readonly maxHearts: number;
}

/** What the open gate's panel shows. */
export interface Gate {
  /** The round won, from 1, and how many there are before the hall. */
  readonly round: number;
  readonly rounds: number;
  /** The round's challengers beaten, of how many. */
  readonly beaten: number;
  readonly of: number;
  /** The boss whose hall lies below, when the next floor is the hall. */
  readonly boss: string | null;
}

export type GateChoice = "descend" | "leave";

let open: { close: () => void } | null = null;

/** Whether a tournament panel is showing. */
export const tournamentOpen = (): boolean => open !== null;

const gold = (n: number) => n.toLocaleString("en-GB");
const range = ([a, b]: readonly [number, number]) => (a === b ? `${gold(a)}` : `${gold(a)}-${gold(b)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function panel(test: string, kicker: string, title: string): { root: HTMLElement; card: HTMLElement } {
  open?.close();
  const layer = document.querySelector<HTMLElement>("#screens")!;
  const root = document.createElement("div");
  root.className = "dialog tournament";
  root.dataset.test = test;
  const card = document.createElement("div");
  card.className = "panel-card";
  const k = document.createElement("div");
  k.className = "kicker";
  k.textContent = kicker;
  const h = document.createElement("h2");
  h.textContent = title;
  card.append(k, h);
  root.appendChild(card);
  layer.appendChild(root);
  return { root, card };
}

function para(card: HTMLElement, text: string, className?: string): void {
  const p = document.createElement("p");
  p.textContent = text;
  if (className) p.className = className;
  card.appendChild(p);
}

function facts(card: HTMLElement, rows: readonly (readonly [string, string, string])[]): void {
  const list = document.createElement("ul");
  list.className = "facts";
  for (const [label, value, test] of rows) {
    const li = document.createElement("li");
    li.dataset.test = test;
    const k = document.createElement("span");
    k.textContent = label;
    const v = document.createElement("b");
    v.textContent = value;
    li.append(k, v);
    list.appendChild(li);
  }
  card.appendChild(list);
}

/** Buttons in a row; resolves with the chosen one's value, or `escape`'s on Escape. */
function choose<T>(root: HTMLElement, card: HTMLElement, buttons: readonly { caption: string; value: T; test: string; primary?: boolean }[], escape: T): Promise<T> {
  const row = document.createElement("div");
  row.className = "buttons";
  card.appendChild(row);
  return new Promise<T>((resolve) => {
    const done = (value: T) => {
      window.removeEventListener("keydown", key);
      root.remove();
      open = null;
      resolve(value);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(escape);
    };
    window.addEventListener("keydown", key);
    for (const b of buttons) {
      const button = document.createElement("button");
      button.textContent = b.caption;
      if (b.primary) button.className = "primary";
      button.dataset.test = b.test;
      button.addEventListener("click", () => done(b.value));
      row.appendChild(button);
    }
    open = { close: () => done(escape) };
    row.querySelector<HTMLButtonElement>("button.primary")?.focus();
  });
}

/** The entrance's board: Enter (true) or Not now (false). */
export function showEntranceBoard(b: Board): Promise<boolean> {
  const { root, card } = panel("tournament-board", `A tier ${b.tier} tournament`, b.dungeon);
  const [few, most] = b.rounds;
  const rounds = few === most ? plural(few, "round") : `${few} or ${most} rounds`;
  para(card, `${rounds} of challengers, then ${b.boss.name}'s hall. Beat ${b.toWin} of the ${b.challengers} challengers in a round to open its gate; the rest are bonus fights that still pay.`);
  if (b.standing) para(card, b.standing);
  const prizes: [string, string, string][] = [];
  if (b.gold) prizes.push(["A challenger's purse", `${range(b.gold)} gold`, "board:gold"]);
  prizes.push([b.boss.waystone ? "The mage's purse" : "The boss's purse", `${range(b.boss.gold)} gold`, "board:boss-gold"]);
  if (b.boss.gift) prizes.push(["Its gift", "a rare or mythic card", "board:gift"]);
  if (b.boss.unique) prizes.push(["Its own gear", b.boss.unique, "board:unique"]);
  if (b.boss.unlocks) prizes.push(["Beaten, it unlocks", b.boss.unlocks, "board:unlocks"]);
  if (b.boss.waystone) prizes.push(["Beaten, it attunes", "the tower's waystone", "board:waystone"]);
  prizes.push(["Your hearts", `${b.hearts} of ${b.maxHearts}`, "board:hearts"]);
  facts(card, prizes);
  para(card, "Leave between rounds to keep your winnings. Lose your last heart and this run's winnings are lost.", "rule");
  return choose(root, card, [
    { caption: "Enter", value: true, test: "board:enter", primary: true },
    { caption: "Not now", value: false, test: "board:not-now" },
  ], false);
}

/** A round's open gate: descend, leave with the winnings, or stay in the round (null) for its bonus fights. */
export function showGate(g: Gate): Promise<GateChoice | null> {
  const last = g.round >= g.rounds;
  const { root, card } = panel("round-won", `Round ${g.round} of ${g.rounds} won`, "The gate stands open");
  para(card, `You have beaten ${g.beaten} of the round's ${g.of} challengers.${g.beaten < g.of ? " The rest still stand, and still pay." : ""}`);
  para(card, last && g.boss ? `Below waits ${g.boss}, alone in the hall.` : `Below waits round ${g.round + 1}.`);
  para(card, "Leave now and your winnings are yours. Go on, and losing your last heart loses them all.", "rule");
  return choose<GateChoice | null>(root, card, [
    { caption: last && g.boss ? `Descend to ${g.boss}'s hall` : `Descend to round ${g.round + 1}`, value: "descend", test: "gate:descend", primary: true },
    { caption: "Leave with your winnings", value: "leave", test: "gate:leave" },
    { caption: "Stay", value: null, test: "gate:stay" },
  ], null);
}
