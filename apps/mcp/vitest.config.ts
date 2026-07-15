import { mergeConfig } from "vitest/config";
import base from "../../vitest.base";

// The composition root (`bootstrap.ts`) and the stdio entry shell (`stdio.ts`) construct live
// adapters / attach to process streams and carry no unit-testable logic, so they are excluded
// from coverage; the server and HTTP request-handling modules are exercised by the suite.
export default mergeConfig(base, {
  test: {
    coverage: {
      exclude: ["src/**/*.{test,spec}.ts", "src/**/*.d.ts", "src/**/index.ts", "src/bootstrap.ts", "src/stdio.ts"],
    },
  },
});
