import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest configuration for the dashboard. Runs component tests in a jsdom environment with
 * HTTP mocked by msw (`src/test/server.ts`), and enforces the 65% line-coverage floor via v8
 * with `all: true` so untested source files count against the threshold. The vendored shadcn
 * UI primitives (`src/components/ui`) are excluded from coverage — they carry their own upstream
 * guarantees and are exercised indirectly through the pages that compose them.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: true,
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/test/**",
        "src/components/ui/**",
        "src/lib/utils.ts",
      ],
      thresholds: { lines: 65 },
    },
  },
});
