// @ts-check
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";
import tsdoc from "eslint-plugin-tsdoc";

/** AST selectors for exported declarations that must carry a documented description. */
const exportContexts = [
  "ExportNamedDeclaration > FunctionDeclaration",
  "ExportNamedDeclaration > ClassDeclaration",
  "ExportNamedDeclaration > TSInterfaceDeclaration",
  "ExportNamedDeclaration > TSTypeAliasDeclaration",
  "ExportNamedDeclaration > TSEnumDeclaration",
  "ExportNamedDeclaration > VariableDeclaration",
];

/**
 * Flat ESLint config for the whole workspace.
 *
 * The load-bearing rule is the TSDoc-on-exports gate: every exported symbol must carry a
 * documentation comment, and comments must be valid TSDoc. Packages run `eslint . --max-warnings 0`
 * so these warnings fail CI. `apps/web` brings its own React config (different parser globals).
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.config.*",
      "**/vitest.base.ts",
      "apps/web/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["packages/**/*.ts", "apps/**/*.ts", "tools/**/*.ts"],
    plugins: { jsdoc, tsdoc },
    // Type-aware linting is enabled so `no-floating-promises` can run — an unhandled promise in
    // the scheduler/scan paths is exactly the crash-safety class this guards against.
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "tsdoc/syntax": "warn",
      "jsdoc/require-jsdoc": ["warn", { publicOnly: true, enableFixer: false, contexts: exportContexts }],
      "jsdoc/require-description": ["warn", { contexts: exportContexts }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // Test files carry no export-doc burden. Fakes and fixtures are NOT exempted: they are the
    // public API of `@bookr/testkit` and `@bookr/fixtures`, so their exports must be documented.
    files: ["**/*.{test,spec}.ts"],
    rules: { "jsdoc/require-jsdoc": "off" },
  },
);
