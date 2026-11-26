// The playtest report box (F8 anywhere in the game; reports/index.ts): what kind of report it is, how bad, what part of
// the game, a title and the player's words, and whether the screenshot and the logs go with it - the screenshot shown
// small, as it was taken when F8 was pressed. Sending keeps the box open until the server has it; a refusal is shown in
// the box, the words kept. Escape (or Cancel) closes it, Ctrl+Enter sends.

export type ReportKind = "bug" | "feedback" | "idea";
export type ReportSeverity = "blocker" | "major" | "minor" | "trivial";

export interface ReportChoice {
  readonly kind: ReportKind;
  readonly severity: ReportSeverity;
  readonly area: string;
  readonly title: string;
  readonly description: string;
  readonly screenshot: boolean;
  readonly logs: boolean;
}

const KINDS: readonly { readonly value: ReportKind; readonly caption: string; readonly about: string; readonly prompt: string }[] = [
  { value: "bug", caption: "Bug", about: "Something is broken or wrong", prompt: "What happened, what you expected instead, and how to make it happen again." },
  { value: "feedback", caption: "Feedback", about: "How something feels to play", prompt: "What felt good, bad, confusing, too easy or too hard - and where." },
  { value: "idea", caption: "Idea", about: "Something the game could have", prompt: "What you'd like, and why it would make the game better." },
];

const SEVERITIES: readonly { readonly value: ReportSeverity; readonly caption: string; readonly about: string }[] = [
  { value: "blocker", caption: "Blocker", about: "The game can't go on: a crash, stuck, progress lost" },
  { value: "major", caption: "Major", about: "Something important is wrong or missing" },
  { value: "minor", caption: "Minor", about: "Wrong, but you can play on" },
  { value: "trivial", caption: "Trivial", about: "Cosmetic, or a small nit" },
];

/** The parts of the game a report can be about, slug and caption. */
export const AREAS: readonly (readonly [string, string])[] = [
  ["walking", "Walking and movement"],
  ["duels", "Duels and cards"],
  ["decks", "Decks and the spell table"],
  ["gear", "Gear, loot and inventory"],
  ["shops", "Shops, vendors and gold"],
  ["towns", "Towns, people and quests"],
  ["dungeons", "Dungeons and bosses"],
  ["map", "The map and travel"],
  ["visuals", "Art and visuals"],
  ["interface", "Menus and the HUD"],
  ["performance", "Performance"],
  ["balance", "Balance and difficulty"],
  ["other", "Something else"],
];

let open = false;

/** Whether the report box is showing. */
export const reportOpen = (): boolean => open;

export interface ReportBox {
  /** The screenshot taken, a PNG data URL, or null with none. */
  readonly picture: string | null;
  /** The area to start on. */
  readonly area: string;
  /** Sends the report: the id it was filed under, or throws with why not. */
  readonly send: (choice: ReportChoice) => Promise<string>;
}

/** Shows the report box; resolves with the id the report was filed under, or null when it was closed unsent. */
export function showReport(box: ReportBox): Promise<string | null> {
  open = true;
  const layer = document.querySelector<HTMLElement>("#screens")!;
  const root = document.createElement("div");
  root.className = "dialog report";
  root.dataset.test = "report";
  const card = document.createElement("form");
  card.className = "panel-card report-card";
  card.noValidate = true;
  root.appendChild(card);

  const heading = document.createElement("h2");
  heading.textContent = "Report a bug or send feedback";
  card.appendChild(heading);

  const body = document.createElement("div");
  body.className = "report-body";
  card.appendChild(body);
  const fields = document.createElement("div");
  fields.className = "report-fields";
  body.appendChild(fields);

  const row = (caption: string, control: HTMLElement): HTMLElement => {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = caption;
    label.append(span, control);
    fields.appendChild(label);
    return label;
  };

  /** A row of buttons, one chosen. */
  const choices = <T extends string>(name: string, options: readonly { readonly value: T; readonly caption: string; readonly about: string }[], first: T, changed?: (v: T) => void) => {
    let value = first;
    const group = document.createElement("div");
    group.className = "choices";
    group.setAttribute("role", "radiogroup");
    const buttons = options.map((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.caption;
      b.title = o.about;
      b.dataset.test = `report:${name}:${o.value}`;
      b.setAttribute("role", "radio");
      b.addEventListener("click", () => {
        value = o.value;
        for (const other of buttons) {
          other.classList.toggle("chosen", other === b);
          other.setAttribute("aria-checked", String(other === b));
        }
        changed?.(o.value);
      });
      b.classList.toggle("chosen", o.value === first);
      b.setAttribute("aria-checked", String(o.value === first));
      group.appendChild(b);
      return b;
    });
    return { group, get value() { return value; } };
  };

  const description = document.createElement("textarea");
  const kind = choices("kind", KINDS, "bug", (k) => (description.placeholder = KINDS.find((x) => x.value === k)!.prompt));
  row("Type", kind.group);
  const severity = choices("severity", SEVERITIES, "minor");
  row("Severity", severity.group);

  const area = document.createElement("select");
  area.dataset.test = "report:area";
  for (const [value, caption] of AREAS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    area.appendChild(option);
  }
  area.value = AREAS.some(([v]) => v === box.area) ? box.area : "other";
  row("Area", area);

  const title = document.createElement("input");
  title.type = "text";
  title.maxLength = 200;
  title.placeholder = "In a few words";
  title.dataset.test = "report:title";
  row("Title", title);

  description.rows = 6;
  description.maxLength = 20_000;
  description.placeholder = KINDS[0]!.prompt;
  description.dataset.test = "report:description";
  row("Details", description);

  const side = document.createElement("div");
  side.className = "report-side";
  body.appendChild(side);
  const check = (caption: string, test: string, on: boolean, enabled = true): HTMLInputElement => {
    const label = document.createElement("label");
    label.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = on && enabled;
    input.disabled = !enabled;
    input.dataset.test = test;
    label.append(input, document.createTextNode(caption));
    side.appendChild(label);
    return input;
  };
  if (box.picture) {
    const shot = document.createElement("img");
    shot.className = "report-shot";
    shot.src = box.picture;
    shot.alt = "The screen when you pressed F8";
    side.appendChild(shot);
  } else {
    const none = document.createElement("div");
    none.className = "report-shot none";
    none.textContent = "No screenshot";
    side.appendChild(none);
  }
  const attachShot = check("Attach the screenshot", "report:screenshot", true, box.picture !== null);
  const attachLogs = check("Attach logs and game state", "report:logs", true);

  const problem = document.createElement("p");
  problem.className = "problem";
  problem.dataset.test = "report:problem";
  card.appendChild(problem);

  const buttons = document.createElement("div");
  buttons.className = "buttons";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.dataset.test = "report:cancel";
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "primary";
  send.textContent = "Send report";
  send.dataset.test = "report:send";
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "Ctrl+Enter sends, Escape cancels";
  buttons.append(cancel, send, hint);
  card.appendChild(buttons);
  layer.appendChild(root);

  return new Promise<string | null>((resolve) => {
    let sending = false;
    const done = (id: string | null) => {
      window.removeEventListener("keydown", key, true);
      root.remove();
      open = false;
      resolve(id);
    };
    const submit = async () => {
      if (sending) return;
      if (title.value.trim().length === 0) {
        problem.textContent = "Give it a title.";
        title.focus();
        return;
      }
      sending = true;
      send.disabled = true;
      problem.textContent = "Sending...";
      problem.classList.add("busy");
      try {
        const id = await box.send({
          kind: kind.value,
          severity: severity.value,
          area: area.value,
          title: title.value.trim(),
          description: description.value,
          screenshot: attachShot.checked,
          logs: attachLogs.checked,
        });
        done(id);
      } catch (e) {
        problem.textContent = `Not sent: ${e instanceof Error ? e.message : String(e)}`;
        problem.classList.remove("busy");
        sending = false;
        send.disabled = false;
      }
    };
    // The box's keys are its own while it is open: nothing behind it hears them (the map, the camera, the debug overlay).
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void submit();
      } else if (e.key === "F8") {
        e.preventDefault();
      } else {
        return;
      }
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", key, true);
    root.addEventListener("keydown", (e) => e.stopPropagation());
    title.addEventListener("input", () => {
      if (!sending) problem.textContent = "";
    });
    cancel.addEventListener("click", () => done(null));
    card.addEventListener("submit", (e) => {
      e.preventDefault();
      void submit();
    });
    title.focus();
  });
}
