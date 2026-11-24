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

  it("passes the same call written the kit's way", async () => {
    const [result] = await eslint.lintText('import { api } from "@endgame/appkit";\nexport const go = () => api("notes");\n', {
      filePath: "src/example.ts",
    });
    expect(result?.messages).toEqual([]);
  });
});
