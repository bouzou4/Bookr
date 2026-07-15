import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite build/dev configuration for the Bookr dashboard SPA. In development, API calls under
 * `/api` are proxied to a locally running `@bookr/server` instance so the dashboard can be
 * developed against a real backend without CORS configuration.
 */
export default defineConfig({
  plugins: [react()],
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
