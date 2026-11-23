import { defineConfig } from "vite";

// The overworld is a static bundle (realms/docs/tech.md, B8). In development the card layer - Cantrip's web client in
// its ?realm mode - is served on its own port and framed from there (src/cardLayer.ts).
export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", assetsInlineLimit: 0 },
});
