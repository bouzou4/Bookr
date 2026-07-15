import { defineConfig } from "vitest/config";

/**
 * Shared Vitest configuration. Each package re-exports this so the quality bar — 65% line
 * coverage (v8), enforced per-package — is defined once. `all: true` counts untested source
 * files against the threshold so coverage can't be gamed by simply not importing a file.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.{test,spec}.ts", "src/**/*.d.ts", "src/**/index.ts"],
      thresholds: { lines: 65 },
    },
  },
});
