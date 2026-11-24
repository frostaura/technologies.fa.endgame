import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "node_modules"]),
  {
    files: ["**/*.{ts,tsx,js}"],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // One token layer: arbitrary Tailwind values bypass it the same way a hex literal does.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(^|\\s)[a-z-]+-\\[[^\\]]+\\]/]",
          message: "Arbitrary Tailwind values (e.g. p-[13px]) bypass the token layer. Add a token in src/tokens.ts.",
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
]);
