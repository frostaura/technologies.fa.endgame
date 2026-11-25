// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { academy } from "./tokens.ts";

const src = path.resolve(import.meta.dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === "generated") return [];
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts") ? [p] : [];
  });
}

describe("one token layer", () => {
  it("no colour literal appears in the academy's source: every colour is the console's token", () => {
    const offenders = files(src).filter((f) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(src, f))).toEqual([]);
  });

  it("the academy's own tokens add sizes only", () => {
    expect(JSON.stringify(academy)).not.toMatch(/#|rgb|hsl/);
  });
});
