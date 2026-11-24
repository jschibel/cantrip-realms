import type { ManaColor } from "../art/figures";

// A boss beaten (design.md A6): the moment over the world - the boss's name, the color it unlocks with the identity's five
// pips (the new one lit and pulsing, the others as they are), the rare it gave outright and its unique item - until the
// player goes on. The capstone, and a boss beaten again, unlock nothing: the panel says what the win did give.

const NAMES: Record<ManaColor, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

export interface BossBeaten {
  readonly boss: string;
  /** The color the win unlocked just now, if it did. */
  readonly unlocked: ManaColor | null;
  /** The character's identity after the win, in WUBRG order. */
  readonly identity: readonly ManaColor[];
  /** The rare or mythic the boss gave outright. */
  readonly gift: string | null;
  /** The gear item that dropped (the boss's unique, the first time). */
  readonly gear: string | null;
}

let open: { close: () => void } | null = null;

/** Whether the panel is showing. */
export const bossBeatenOpen = (): boolean => open !== null;

export function showBossBeaten(b: BossBeaten): Promise<void> {
  open?.close();
  const layer = document.querySelector<HTMLElement>("#screens")!;
  const root = document.createElement("div");
  root.className = "dialog boss-beaten";
  root.dataset.test = "boss-beaten";
  if (b.unlocked) root.dataset.unlocked = b.unlocked;
  const card = document.createElement("div");
  card.className = "panel-card";
  if (b.unlocked) card.style.setProperty("--well", `var(--well-${b.unlocked.toLowerCase()})`);

  const kicker = document.createElement("div");
  kicker.className = "kicker";
  kicker.textContent = `${b.boss} is beaten`;
  card.appendChild(kicker);

  const heading = document.createElement("h2");
  heading.textContent = b.unlocked ? `${NAMES[b.unlocked]} is yours` : "Victory";
  card.appendChild(heading);

  const pips = document.createElement("div");
  pips.className = "well-pips";
  for (const color of ["W", "U", "B", "R", "G"] as const) {
    const pip = document.createElement("span");
    const held = b.identity.includes(color);
    pip.className = `pip pip-${color.toLowerCase()}${held ? "" : " locked"}${color === b.unlocked ? " new" : ""}`;
    pip.title = `${NAMES[color]}${held ? "" : " (locked)"}`;
    pip.dataset.test = `boss-beaten:pip-${color.toLowerCase()}`;
    pip.dataset.state = color === b.unlocked ? "new" : held ? "held" : "locked";
    pips.appendChild(pip);
  }
  card.appendChild(pips);

  const lines: string[] = [];
  if (b.unlocked) {
    lines.push(`The ${NAMES[b.unlocked].toLowerCase()} well answers to you now. ${NAMES[b.unlocked]} cards may join your deck at any spell table, and its basic lands are yours to play.`);
    if (b.identity.length === 5) lines.push("All five colors are yours: the Phyrexian Portal in the waste will open to you.");
  } else {
    lines.push("Its hall falls quiet. It will be back in a week, for anyone who would face it again.");
  }
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    card.appendChild(p);
  }

  const spoils = document.createElement("ul");
  spoils.className = "spoils";
  const spoil = (label: string, value: string, test: string) => {
    const li = document.createElement("li");
    li.dataset.test = test;
    const k = document.createElement("span");
    k.textContent = label;
    const v = document.createElement("b");
    v.textContent = value;
    li.append(k, v);
    spoils.appendChild(li);
  };
  if (b.gift) spoil("Its gift", b.gift, "boss-beaten:gift");
  if (b.gear) spoil("It dropped", b.gear, "boss-beaten:gear");
  if (spoils.childElementCount > 0) card.appendChild(spoils);

  const row = document.createElement("div");
  row.className = "buttons";
  const go = document.createElement("button");
  go.className = "primary";
  go.textContent = "Onward";
  go.dataset.test = "boss-beaten:onward";
  row.appendChild(go);
  card.appendChild(row);
  root.appendChild(card);
  layer.appendChild(root);

  return new Promise<void>((resolve) => {
    const done = () => {
      window.removeEventListener("keydown", key);
      root.remove();
      open = null;
      resolve();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") done();
    };
    window.addEventListener("keydown", key);
    go.addEventListener("click", done);
    open = { close: done };
    go.focus();
  });
}
