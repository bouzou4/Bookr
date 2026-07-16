import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite build/dev configuration for the Bookr dashboard SPA. In development, API calls under
 * `/api` are proxied to a locally running `@bookr/server` instance so the dashboard can be
 * developed against a real backend without CORS configuration. Tailwind v4 runs as a Vite
 * plugin, and the `@/` alias resolves to `src` for the vendored UI primitives.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
