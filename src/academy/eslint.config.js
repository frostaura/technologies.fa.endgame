import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "site", "node_modules", "playwright-report", "test-results", "src/generated", "public", ".tmp"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      // One token layer, shared with the console: arbitrary Tailwind values bypass it.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(^|\\s)[a-z-]+-\\[[^\\]]+\\]/]",
          message: "Arbitrary Tailwind values (e.g. p-[13px]) bypass the token layer. Add a token in src/theme/tokens.ts.",
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off", "react-refresh/only-export-components": "off" },
  },
]);
