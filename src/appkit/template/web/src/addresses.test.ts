// @vitest-environment node
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/** The lint rule that keeps the app working under any address prefix is wired into this app's config. */
describe("addresses", () => {
  const eslint = new ESLint({ cwd: join(import.meta.dirname, "..") });

  it("fails a URL that starts with '/'", async () => {
    const [result] = await eslint.lintText('export const go = () => fetch("/api/notes");\n', { filePath: "src/example.ts" });
    expect(result?.messages.map((m) => m.ruleId)).toContain("endgame/no-root-relative-url");
  });

  it("fails a page that reads the address from window.location instead of the router", async () => {
    const [result] = await eslint.lintText("export const court = () => new URLSearchParams(window.location.search).get('court');\n", {
      filePath: "src/example.ts",
    });
    expect(result?.messages.map((m) => m.ruleId)).toContain("endgame/no-location-read");
  });

  it("fails the bare global location too", async () => {
    const [result] = await eslint.lintText("export const tab = () => location.hash.slice(1);\n", { filePath: "src/example.ts" });
    expect(result?.messages.map((m) => m.ruleId)).toContain("endgame/no-location-read");
  });

  it("passes the router's way, and leaving the app through location", async () => {
    const [result] = await eslint.lintText(
      'import { useSearchParams } from "react-router";\nimport { signInUrl } from "@endgame/appkit";\n' +
        'export function useCourt() {\n  const [params] = useSearchParams();\n  return params.get("court");\n}\n' +
        "export const leave = () => location.assign(signInUrl());\n",
      { filePath: "src/example.ts" },
    );
    expect(result?.messages).toEqual([]);
  });

  it("fails a date or number formatted by the browser's formatters, which throw on a bad value (R7-1)", async () => {
    for (const code of [
      'export const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));\n',
      "export const when = (iso: string) => new Date(iso).toLocaleString();\n",
    ]) {
      const [result] = await eslint.lintText(code, { filePath: "src/example.ts" });
      expect(result?.messages.map((m) => m.ruleId)).toContain("endgame/no-unsafe-format");
    }
    const [kit] = await eslint.lintText('import { formatDateTime } from "@endgame/appkit";\nexport const when = (iso: string) => formatDateTime(iso);\n', { filePath: "src/example.ts" });
    expect(kit?.messages).toEqual([]);
  });

  it("passes the same call written the kit's way", async () => {
    const [result] = await eslint.lintText('import { api } from "@endgame/appkit";\nexport const go = () => api("notes");\n', {
      filePath: "src/example.ts",
    });
    expect(result?.messages).toEqual([]);
  });
});
