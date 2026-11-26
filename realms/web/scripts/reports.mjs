// Playtest reports in offline play (src/reports; realms/reports/README.md): the dev server takes what the page would send
// the realm server's POST /api/reports at /__realm/report and has the realm server's own writer file it - the server's
// `report` command (Program.cs) - so a report filed offline is the same folder as one filed on a server. It needs the
// realm server built (tools\realms\play.cmd builds it; or `dotnet build realms\dotnet\Cantrip.Realms.Server`), and writes
// where REALMS_REPORTS says, else realms/reports.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The realm server's build: the Debug one play.cmd makes, else a Release one, else none. */
export function serverDll() {
  const named = process.env.REALMS_SERVER_DLL;
  if (named) return existsSync(named) ? named : null;
  for (const flavor of ["Debug", "Release"]) {
    const dll = join(repo, "realms", "dotnet", "Cantrip.Realms.Server", "bin", flavor, "net10.0", "cantrip-realms-server.dll");
    if (existsSync(dll)) return dll;
  }
  return null;
}

/** Files a report's body (JSON text) with the server's writer, as `player`; resolves with what it printed: `{Id, Folder}`. */
export function fileReport(body, player) {
  const dll = serverDll();
  if (!dll) return Promise.reject(new Error("The realm server is not built, and its writer files the report: run tools\\realms\\play.cmd or dotnet build realms\\dotnet\\Cantrip.Realms.Server."));
  const folder = mkdtempSync(join(tmpdir(), "realm-report-"));
  const file = join(folder, "report.json");
  writeFileSync(file, body);
  return new Promise((done, fail) => {
    const child = spawn("dotnet", [dll, "report", file, player], { env: { ...process.env, REALMS_ROOT: process.env.REALMS_ROOT ?? repo }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", fail);
    child.on("close", (code) => {
      rmSync(folder, { recursive: true, force: true });
      const printed = out.trim().split("\n").at(-1) ?? "";
      if (code === 0 && printed.startsWith("{")) done(printed);
      else fail(new Error(err.trim() || out.trim() || `The report writer stopped with ${code}.`));
    });
  });
}

/** The dev server's middleware: POST /__realm/report?player=... with the report's JSON. */
export function reportMiddleware() {
  return (req, res, next) => {
    if (req.method !== "POST" || !req.url?.startsWith("/__realm/report")) return next();
    const player = new URL(req.url, "http://x").searchParams.get("player") || "offline";
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      fileReport(Buffer.concat(chunks).toString("utf8"), player).then(
        (printed) => {
          res.setHeader("Content-Type", "application/json");
          res.end(printed);
        },
        (e) => {
          res.statusCode = 500;
          res.end(e.message);
        },
      );
    });
  };
}
