import { mergeConfig } from "vitest/config";
import base from "../../vitest.base";

// The entry shell (`main.ts`) and the composition root (`bootstrap.ts`, which constructs live
// adapters) carry no unit-testable logic, so they are excluded from coverage; every command
// module is exercised against the fake app.
export default mergeConfig(base, {
  test: {
    coverage: {
      exclude: ["src/**/*.{test,spec}.ts", "src/**/*.d.ts", "src/**/index.ts", "src/main.ts", "src/bootstrap.ts"],
    },
  },
});
