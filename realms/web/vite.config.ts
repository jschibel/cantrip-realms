import { execSync } from "node:child_process";
import { type Plugin, defineConfig } from "vite";
import { cardLayerBuilt, serveCardLayer } from "./scripts/cardLayer.mjs";
import { reportMiddleware } from "./scripts/reports.mjs";

// The overworld is a static bundle (realms/docs/tech.md, B8). In development the card layer - Cantrip's web client in
// its ?realm mode - is served on its own port and framed from there (src/cardLayer.ts). The realm's content (maps,
// models, mobs) is read from realms/content, outside this package, and the mobs' decks from the repository's decks/, so
// the dev server serves from there too.
export default defineConfig({
  server: { port: 5173, strictPort: true, fs: { allow: ["../.."] } },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: { input: { main: "index.html" } },
  },
  // The build a playtest report names (src/reports): the commit, and whether the tree had changes beside it.
  define: { "import.meta.env.VITE_REALM_BUILD": JSON.stringify(build()) },
  plugins: [cardLayer(), reports()],
});

function build(): string {
  try {
    const commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const changed = execSync("git status --porcelain --untracked-files=no", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
    return changed ? `${commit}+changes` : commit;
  } catch {
    return "unknown";
  }
}

/**
 * Playtest reports filed in offline play, which has no realm server to take them: the dev server writes them with the
 * server's own writer (scripts/reports.mjs, `/__realm/report`).
 */
function reports(): Plugin {
  return {
    name: "realm-reports",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(reportMiddleware());
    },
  };
}

/**
 * The real card layer for the dev server, whenever there is one: when the web client is built, its page is served on a
 * port of its own (REALM_CARD_LAYER_PORT, else the dev server's port + 100) and the page is told where, in a
 * `<meta name="card-layer">` (src/main.ts), so even offline play deals its duels on the rules engine. REALM_CARD_LAYER
 * names a card layer served elsewhere instead (the launcher's), or `stub` for the stand-in panels, which the offline
 * suites ask for (e2e/playwright.config.ts).
 */
function cardLayer(): Plugin {
  let url: string | null = null;
  return {
    name: "realm-card-layer",
    apply: "serve",
    async configureServer(server) {
      const named = process.env.REALM_CARD_LAYER;
      if (named) {
        url = named;
        return;
      }
      if (!cardLayerBuilt()) {
        server.config.logger.info("  The web client is not built, so the card layer is the stand-in (dotnet build dotnet/src/Cantrip.Client.Web).");
        url = "stub";
        return;
      }
      const port = Number(process.env.REALM_CARD_LAYER_PORT ?? (server.config.server.port ?? 5173) + 100);
      try {
        const listening = await serveCardLayer(port, { quiet: true });
        server.httpServer?.once("close", () => listening.close());
        url = `http://localhost:${port}/`;
        server.config.logger.info(`  The card layer is at ${url}`);
      } catch (e) {
        server.config.logger.warn(`  The card layer could not be served on port ${port} (${(e as Error).message}), so it is the stand-in.`);
        url = "stub";
      }
    },
    transformIndexHtml(html) {
      return url ? html.replace("<head>", `<head>\n    <meta name="card-layer" content="${url}" />`) : html;
    },
  };
}
