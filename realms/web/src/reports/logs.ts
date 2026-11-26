// What a playtest report (reports/index.ts) carries of the page's past: its console - every log, warning and error, and
// the errors nobody caught - and its calls to the realm server, the last few hundred of each, kept from the moment the
// page loads (main.ts installs it first). The console is still the console: each call is passed on as it was.

/** The last `size` lines of something, oldest first. */
export class Ring {
  private readonly lines: string[] = [];

  constructor(private readonly size: number) {}

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.size) this.lines.splice(0, this.lines.length - this.size);
  }

  /** The lines kept, one a line. */
  text(): string {
    return this.lines.join("\n");
  }

  get length(): number {
    return this.lines.length;
  }
}

/** The page's console lately. */
export const consoleLog = new Ring(600);

/** The page's calls to the realm server lately: method, path, status, time taken, a refusal's code. */
export const networkLog = new Ring(200);

const stamp = (): string => new Date().toISOString().slice(11, 23);

/** One value as a console line shows it: strings as they are, errors with their stacks, the rest as JSON where it can be. */
export function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (value === undefined) return "undefined";
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json.length > 600 ? `${json.slice(0, 600)}...` : json;
  } catch {
    return String(value);
  }
}

let installed = false;

/** Starts keeping the console and the uncaught errors; once, however often it is called. */
export function captureConsole(): void {
  if (installed) return;
  installed = true;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      consoleLog.push(`${stamp()} ${level} ${args.map(show).join(" ")}`);
      original(...args);
    };
  }
  window.addEventListener("error", (e) => consoleLog.push(`${stamp()} uncaught ${e.error ? show(e.error) : `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`}`));
  window.addEventListener("unhandledrejection", (e) => consoleLog.push(`${stamp()} unhandled rejection ${show(e.reason)}`));
}

/** Notes a call to the server: `GET me 200 12ms`, or with the refusal's code. */
export function noteCall(method: string, path: string, status: number | "failed", ms: number, code?: string): void {
  networkLog.push(`${stamp()} ${method} ${path} ${status} ${Math.round(ms)}ms${code ? ` ${code}` : ""}`);
}
