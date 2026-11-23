import { defineConfig } from "vite";

// The overworld is a static bundle (realms/docs/tech.md, B8). In development the card layer - Cantrip's web client in
// its ?realm mode - is served on its own port and framed from there (src/cardLayer.ts). The realm's content (maps,
// models, mobs) is read from realms/content, outside this package, so the dev server serves from there too.
export default defineConfig({
  server: { port: 5173, strictPort: true, fs: { allow: [".."] } },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: { input: { main: "index.html" } },
  },
});
