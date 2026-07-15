import { mergeConfig, defineConfig } from "vitest/config";
import base from "../../vitest.base.ts";

/**
 * This package's Vitest configuration. It extends the workspace base config but additionally
 * excludes `run.ts` — the thin Playwright browser-driving wrapper — from the coverage count,
 * since it launches a real headed browser and is intentionally not unit-tested (see the package
 * README's testing notes). The pure extraction and HTTP-push logic it calls is fully covered.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      coverage: {
        exclude: ["src/**/*.{test,spec}.ts", "src/**/*.d.ts", "src/index.ts", "src/run.ts"],
      },
    },
  }),
);
