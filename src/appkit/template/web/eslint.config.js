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
      // Read the address from the router (useParams, useSearchParams, useLocation), never window.location:
      // a page that reads location is not re-rendered when a link moves to it.
      "endgame/no-location-read": "error",
      // Dates and numbers through formatDate / formatDateTime / formatNumber from @endgame/appkit, never toLocale*String or
      // Intl's formatters: those throw on a value a browser lets through (a six-digit year), and a throw blanks the page.
      "endgame/no-unsafe-format": "error",
      // Fields from the kit (Input, Textarea, Select, Checkbox): a raw one has a faint edge a person cannot see (~1.2:1).
      "endgame/use-kit-fields": "error",
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
