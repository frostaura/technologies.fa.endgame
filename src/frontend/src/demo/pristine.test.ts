import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONSOLE_KEY_PREFIX, pristine } from "./pristine";

/** Every file under `dir`, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("a reset of the demo is a first visit", () => {
  it("clears every key the console keeps, and only those", () => {
    localStorage.setItem("endgame.mode", "technical");
    localStorage.setItem("endgame.organisation", "quayside");
    sessionStorage.setItem("endgame.entered", JSON.stringify({ id: "1", slug: "northwind", name: "Northwind" }));
    sessionStorage.setItem("endgame.return-to", "/credits");
    sessionStorage.setItem("endgame-demo:world", "{}");
    localStorage.setItem("endgame-academy:progress:v1", "{}");
    pristine();
    expect(localStorage.getItem("endgame.mode")).toBeNull();
    expect(localStorage.getItem("endgame.organisation")).toBeNull();
    expect(sessionStorage.getItem("endgame.entered")).toBeNull();
    expect(sessionStorage.getItem("endgame.return-to")).toBeNull();
    // The demo's own world and the academy's progress are not the console's to forget.
    expect(sessionStorage.getItem("endgame-demo:world")).toBe("{}");
    expect(localStorage.getItem("endgame-academy:progress:v1")).toBe("{}");
  });

  it("covers every storage key the console names: each is in its namespace", () => {
    const src = path.resolve(import.meta.dirname, "..");
    const keyed = files(src).filter((f) => /\.tsx?$/.test(f) && !f.includes(`${path.sep}demo${path.sep}`) && !/\.test\.tsx?$/.test(f));
    const keys: string[] = [];
    for (const f of keyed) {
      const text = readFileSync(f, "utf8");
      if (!/(local|session)Storage/.test(text)) continue;
      for (const m of text.matchAll(/const \w*KEY\w* = "([^"]+)"/g)) keys.push(m[1] ?? "");
      // A key written inline, not named, would escape this check.
      expect(text, f).not.toMatch(/(get|set|remove)Item\("/);
    }
    expect(keys.sort()).toEqual(["endgame.entered", "endgame.mode", "endgame.organisation", "endgame.return-to"]);
    for (const k of keys) expect(k.startsWith(CONSOLE_KEY_PREFIX)).toBe(true);
  });
});
