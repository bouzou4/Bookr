import { mergeConfig } from "vitest/config";
import base from "../../vitest.base";

// The entry shell (`main.ts`, side-effectful `.listen`) and the composition placeholder
// (`bootstrap.ts`, wired at integration) carry no testable HTTP logic, so they are excluded
// from coverage; every request-handling module is exercised by the supertest suite.
export default mergeConfig(base, {
  test: {
    coverage: {
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/main.ts",
        "src/bootstrap.ts",
      ],
    },
  },
});
