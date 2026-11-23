// The card layer as a CDN serves it, for the e2e suite against the real realm server: the web client's built page
// (dotnet/src/Cantrip.Client.Web's Debug wwwroot, the rules engine beside it in engine/) as static files on a port of its
// own, another origin than the overworld's and the server's. `node cards.mjs <port>`.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..", "dotnet", "src", "Cantrip.Client.Web", "bin", "Debug", "net10.0-browserwasm", "wwwroot");
const port = Number(process.argv[2] ?? 5197);
if (!existsSync(join(root, "index.html"))) {
  console.error(`The web client is not built at ${root}: dotnet build dotnet\src\Cantrip.Client.Web first.`);
  process.exit(1);
}

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
};

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) {
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
}).listen(port, () => console.log(`The card layer is at http://localhost:${port}/`));
