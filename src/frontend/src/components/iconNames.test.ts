import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_KIND, ICON_NAMES } from "./iconNames";

describe("the icon sprite", () => {
  it("has exactly the symbols the typed Icon names, so a missing icon is a type error, not a blank", () => {
    const sprite = readFileSync(join(import.meta.dirname, "../../public/brand/icons.svg"), "utf8");
    const ids = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
    expect([...ids].sort()).toEqual([...ICON_NAMES].sort());
  });

  it("colours every icon by its kind", () => {
    for (const name of ICON_NAMES) expect(ICON_KIND[name]).toMatch(/^text-/);
  });
});
