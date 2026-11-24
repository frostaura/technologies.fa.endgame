import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "node_modules", "playwright-report", "test-results"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      // One token layer: arbitrary Tailwind values bypass it the same way a hex literal does.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(^|\\s)[a-z-]+-\\[[^\\]]+\\]/]",
          message: "Arbitrary Tailwind values (e.g. p-[13px]) bypass the token layer. Add a token in src/lib/tokens.ts.",
        },
      ],
    },
  },
  {
    // Tests spell out forbidden values on purpose, to prove the guards catch them.
    files: ["**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["src/components/ui/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
]);
