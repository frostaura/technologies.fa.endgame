import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import endgame from "@endgame/appkit/eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["node_modules", "test-results"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh, endgame },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      // The app runs under /<org>/<division>/<project>/ and at a subdomain root: no URL may start with "/".
      "endgame/no-root-relative-url": "error",
      // One token layer: arbitrary Tailwind values (p-[13px], text-[#fff]) bypass it.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(^|\\s)[a-z-]+-\\[[^\\]]+\\]/]",
          message: "Arbitrary Tailwind values bypass the token layer. Use the kit's token classes (bg-surface, text-ink-muted, …).",
        },
      ],
    },
  },
]);
