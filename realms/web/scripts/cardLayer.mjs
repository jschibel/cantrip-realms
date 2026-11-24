// The card layer as a CDN serves it: the web client's built page (dotnet/src/Cantrip.Client.Web's Debug wwwroot, the rules
// engine beside it in engine/) as static files on a port of its own, another origin than the overworld's and the
// server's. The overworld's dev server starts one when the page is built (vite.config.ts), the launcher
// (tools/realms/play.cmd) and the suite against the real server (e2e/server/cards.mjs) start their own.
//
// Beside the page it serves `/api/catalog` from `realms/web/.cards/catalog.msgpack` when that file is there: the faces
// of every card, which the card layer reads from the realm server it was framed with, and from its own origin when it
// was framed with none (offline play, the in-memory API). The launcher writes it (`Cantrip.Realms.Server catalog`).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Where the built card layer is. */
export const cardLayerRoot = resolve(here, "..", "..", "..", "dotnet", "src", "Cantrip.Client.Web", "bin", "Debug", "net10.0-browserwasm", "wwwroot");

/** Where the catalog of card faces for a card layer with no realm server is written. */
export const offlineCatalog = resolve(here, "..", ".cards", "catalog.msgpack");

/** Whether the card layer is built, and so can be served. */
export const cardLayerBuilt = () => existsSync(join(cardLayerRoot, "index.html"));

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".msgpack": "application/x-msgpack",
};

/**
 * Serves the card layer on `port`; resolves with the server once it listens, rejects if it cannot (the port taken).
 * `quiet` leaves out the line saying where it is.
 */
export function serveCardLayer(port, { quiet = false } = {}) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    if (path === "/api/catalog") {
      if (!existsSync(offlineCatalog)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": types[".msgpack"], "Cache-Control": "no-store" });
      createReadStream(offlineCatalog).pipe(response);
      return;
    }
    let file = normalize(join(cardLayerRoot, path));
    if (!file.startsWith(cardLayerRoot)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      if (!quiet) console.log(`The card layer is at http://localhost:${port}/`);
      resolvePromise(server);
    });
  });
}
