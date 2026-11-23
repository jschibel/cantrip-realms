// A themed panel over the world for the people of a map who need no card screen: the innkeeper, the quest board,
// the closed arena. It resolves with the button chosen (or null when dismissed with Escape).

export interface DialogButton<T> {
  readonly caption: string;
  readonly value: T;
  readonly primary?: boolean;
}

let open: { close: () => void } | null = null;

/** Whether a dialog is showing. */
export const dialogOpen = (): boolean => open !== null;

export function showDialog<T>(title: string, lines: readonly string[], buttons: readonly DialogButton<T>[]): Promise<T | null> {
  open?.close();
  const layer = document.querySelector<HTMLElement>("#screens")!;
  const root = document.createElement("div");
  root.className = "dialog";
  root.dataset.test = "dialog";
  const card = document.createElement("div");
  card.className = "panel-card";
  const heading = document.createElement("h2");
  heading.textContent = title;
  card.appendChild(heading);
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    card.appendChild(p);
  }
  const row = document.createElement("div");
  row.className = "buttons";
  card.appendChild(row);
  root.appendChild(card);
  layer.appendChild(root);

  return new Promise<T | null>((resolve) => {
    const done = (value: T | null) => {
      window.removeEventListener("keydown", key);
      root.remove();
      open = null;
      resolve(value);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(null);
    };
    window.addEventListener("keydown", key);
    for (const b of buttons) {
      const button = document.createElement("button");
      button.textContent = b.caption;
      if (b.primary) button.className = "primary";
      button.dataset.test = `dialog:${b.caption.toLowerCase()}`;
      button.addEventListener("click", () => done(b.value));
      row.appendChild(button);
    }
    open = { close: () => done(null) };
    row.querySelector<HTMLButtonElement>("button")?.focus();
  });
}
