// Cantrip Realms on this machine, in one command (tools/realms/play.cmd builds what is stale, then runs this): the realm
// server with the development sign-in on a SQLite file of its own, the card layer (the web client's ?realm page) on a port
// of its own, the overworld's dev server, and the browser opened on a signed-in game whose duels are real games of
// Magic on the rules engine in the page. Ctrl+C stops it all. The server's log is also kept in realms/web/.play/server.log
// (appended to): its warnings, and who connects to the presence relay and where it enters them, with the page's report of
// any jump of the player's figure (game.ts `watchJumps`).
//
//   node realms/web/scripts/play.mjs [--offline] [--fresh] [--player N] [--name NAME] [--port P] [--no-open]
//
// --offline    no server: the in-memory API, the real card layer for duels and loot (nothing is kept)
// --fresh      a new store: every character made before is gone
// --player N   who to sign in as (the development sign-in: each number its own player; 1 by default)
// --name NAME  that player's name as signed in
// --port P     the overworld's port (5300 by default); the server is on P+1, the card layer on P+2
// --no-open    leave the browser alone
//
// Card art is served when a content folder with illustrations is found (CANTRIP_ART, else this repository's content/
// when content/mtg/images is there: the fetch-card-art skill fills it), always as Cantrip.Art's sized renditions
// (/art/{size}/{slug}.webp, made once and kept in .play/art) - never the full-size illustrations, which the page would
// decode whole for every face: by the realm server, and offline by the same server serving art alone (`art`). Without,
// the cards are drawn with no picture.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cardLayerBuilt, cardLayerRoot, serveCardLayer } from "./cardLayer.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const repo = resolve(web, "..", "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const offline = flag("offline");
const port = Number(option("port", process.env.REALMS_PLAY_PORT ?? "5300"));
const ports = { world: port, server: port + 1, cards: port + 2 };
const player = Number(option("player", "1"));
const name = option("name", "Wanderer");
const urls = {
  world: `http://localhost:${ports.world}/`,
  server: `http://localhost:${ports.server}/`,
  cards: `http://localhost:${ports.cards}/`,
};

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) {
      // The server and the dev server are whole process trees on Windows: taskkill takes them down together.
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

/** Starts a process whose output is shown under a label (and, given `log`, kept in that file), and stops everything if it dies. */
function run(label, command, commandArgs, options, log) {
  const child = spawn(command, commandArgs, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const kept = log ? createWriteStream(log, { flags: "a" }) : null;
  kept?.write(`--- ${new Date().toISOString()} ${label} started\n`);
  const show = (stream) => (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim().length === 0) continue;
      stream.write(`[${label}] ${line}\n`);
      kept?.write(`${new Date().toISOString()} ${line}\n`);
    }
  };
  child.stdout.on("data", show(process.stdout));
  child.stderr.on("data", show(process.stderr));
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`[${label}] stopped (${code}): stopping the rest.`);
      stop(1);
    }
  });
  children.push(child);
  return child;
}

async function waitFor(url, what, seconds = 120) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${what} did not come up at ${url}`);
}

function artFolder() {
  const named = process.env.CANTRIP_ART;
  if (named && existsSync(named)) return named;
  const own = join(repo, "content");
  const images = join(own, "mtg", "images");
  return existsSync(images) && readdirSync(images).length > 0 ? own : null;
}

function openBrowser(url) {
  if (flag("no-open")) return;
  const [command, commandArgs] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(command, commandArgs, { stdio: "ignore", detached: true }).unref();
}

if (!cardLayerBuilt()) {
  console.error(`The card layer is not built at ${cardLayerRoot}: run tools\\realms\\play.cmd, which builds it.`);
  process.exit(1);
}

const art = artFolder();
const env = { ...process.env };

const data = join(web, ".play");
const serverDll = join(repo, "realms", "dotnet", "Cantrip.Realms.Server", "bin", "Debug", "net10.0", "cantrip-realms-server.dll");
const artEnv = art ? { REALMS_ART: art, REALMS_ART_CACHE: join(data, "art") } : {};
if (!offline || art) {
  if (flag("fresh") && !offline) rmSync(data, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  if (!existsSync(serverDll)) {
    console.error(`The realm server is not built at ${serverDll}: run tools\\realms\\play.cmd, which builds it.`);
    process.exit(1);
  }
}

if (offline && art) {
  // No realm server offline, but the card layer's art is still the sized renditions: the server serving art alone.
  run("art", "dotnet", [serverDll, "art", "--urls", urls.server], {
    cwd: dirname(serverDll),
    env: { ...env, Logging__LogLevel__Default: "Warning", "Logging__LogLevel__Microsoft.Hosting.Lifetime": "Information", REALMS_ROOT: repo, ...artEnv },
  });
}

if (!offline) {
  run("server", "dotnet", [serverDll, "--urls", urls.server], {
    cwd: dirname(serverDll),
    env: {
      ...env,
      ASPNETCORE_ENVIRONMENT: "Development",
      // What goes wrong, and where it listens; not every request.
      Logging__LogLevel__Default: "Warning",
      "Logging__LogLevel__Microsoft.Hosting.Lifetime": "Information",
      // Who connects to the presence relay, enters where and leaves: what a jump of the player's figure is read against.
      "Logging__LogLevel__Cantrip.Realms.Server.Presence": "Information",
      REALMS_ROOT: repo,
      REALMS_DEV_SIGNIN: "1",
      REALMS_DATABASE: `sqlite:${join(data, "realms.db")}`,
      REALMS_CLIENT: urls.world,
      REALMS_CARDS: urls.cards,
      ...artEnv,
      CANTRIP_NATIVE_HOST: env.CANTRIP_NATIVE_HOST ?? join(repo, "target", "cards", process.platform === "win32" ? "cantrip-native-host.exe" : "cantrip-native-host"),
    },
  }, join(data, "server.log"));
}

await serveCardLayer(ports.cards, { quiet: true });

run("world", process.execPath, [join(web, "node_modules", "vite", "bin", "vite.js"), "--port", String(ports.world), "--strictPort"], {
  cwd: web,
  env: {
    ...env,
    REALM_CARD_LAYER: urls.cards,
    ...(offline ? {} : { VITE_REALM_SERVER: urls.server }),
    ...(art ? { VITE_CARD_ART: urls.server } : {}),
  },
});

try {
  await waitFor(urls.world, "The overworld");
  if (!offline || art) await waitFor(`${urls.server}healthz`, offline ? "The art server" : "The realm server", 300);
} catch (e) {
  console.error(e.message);
  stop(1);
}

const start = offline ? `${urls.world}?offline` : `${urls.server}dev/signin?id=${player}&name=${encodeURIComponent(name)}`;
console.log("");
console.log(`  Cantrip Realms is up${offline ? " (offline: nothing is kept)" : ""}.`);
console.log(`  The world:      ${urls.world}`);
if (!offline) console.log(`  The server:     ${urls.server} (signed in as player ${player}; another number is another player: ${urls.server}dev/signin)`);
console.log(`  The card layer: ${urls.cards}`);
console.log(`  Card art:       ${art ? `${art}, sized, at ${urls.server}art/{size}/{slug}.webp` : "none found (set CANTRIP_ART to a content folder with <dataset>/images)"}`);
console.log(`  Opening ${start}  -  Ctrl+C stops it all.`);
console.log("");
openBrowser(start);
