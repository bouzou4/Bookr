// @ts-check
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
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
 * Flat ESLint config for the dashboard. Kept separate from the root workspace config because
 * this package needs React/JSX parsing and React Hooks rules the rest of the workspace doesn't.
 * It still applies the same TSDoc-on-exports documentation gate as every other package.
 */
export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks, jsdoc, tsdoc },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        URLSearchParams: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "tsdoc/syntax": "warn",
      "jsdoc/require-jsdoc": ["warn", { publicOnly: true, enableFixer: false, contexts: exportContexts }],
      "jsdoc/require-description": ["warn", { contexts: exportContexts }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Vendored shadcn/ui primitives (`src/components/ui`) are documented upstream and follow
    // their own conventions; they are exempt from the workspace TSDoc-on-exports gate.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
    },
  },
  {
    // Test and test-support files carry no export-doc burden.
    files: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    rules: { "jsdoc/require-jsdoc": "off" },
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        console: "readonly",
      },
    },
  },
);
