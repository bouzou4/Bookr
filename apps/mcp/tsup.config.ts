import { defineConfig } from "tsup";

// Bundle to runnable JS, inlining the workspace `.ts` source; third-party/native deps stay
// external. The banner re-creates the CommonJS globals (`require`, `__filename`, `__dirname`)
// that some bundled dependencies expect but which do not exist in ESM output.
export default defineConfig({
  entry: ["src/stdio.ts", "src/http.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  noExternal: [/^@bookr\//],
  banner: { js: "import { createRequire as _cr } from 'node:module'; import { fileURLToPath as _f } from 'node:url'; import { dirname as _d } from 'node:path'; const require = _cr(import.meta.url); const __filename = _f(import.meta.url); const __dirname = _d(__filename);" },
  clean: true,
  outDir: "dist",
});
