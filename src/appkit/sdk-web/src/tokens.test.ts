import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { cssVariables, flatRoles, roles, contrastRatio } from "./tokens.js";

const root = join(import.meta.dirname, "..");
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(relative(root, full));
    }
  };
  walk(join(root, "src"));
  return out.filter((f) => f !== "src/tokens.ts");
}

describe("one token layer", () => {
  it("allows no raw hex colour outside src/tokens.ts", () => {
    expect(sources()).toContain("src/ui/button.tsx");
    const offenders = sources().flatMap((f) => (readFileSync(join(root, f), "utf8").match(HEX) ?? []).map((h) => `${f}: ${h}`));
    expect(offenders).toEqual([]);
  });

  it("matches the console's palette, so apps look like the family", () => {
    const console = readFileSync(join(root, "../../frontend/src/lib/tokens.ts"), "utf8");
    for (const hex of Object.values(flatRoles())) expect(console).toContain(hex);
  });

  it("emits channels and keeps text legible", () => {
    for (const [name, v] of Object.entries(cssVariables())) if (name.startsWith("--color-")) expect(v).toMatch(/^\d+ \d+ \d+$/);
    expect(contrastRatio(roles.ink.muted, roles.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(roles.attention.text, roles.attention.tint)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives every field an edge a person can see: 3:1 against both surfaces (WCAG 1.4.11)", () => {
    expect(contrastRatio(roles.border.field, roles.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(roles.border.field, roles.ground)).toBeGreaterThanOrEqual(3);
    // The divider is deliberately faint — which is why a field never uses it.
    expect(contrastRatio(roles.border.DEFAULT, roles.surface)).toBeLessThan(3);
    const field = readFileSync(join(root, "src/ui/field.tsx"), "utf8");
    expect(field).toContain("border-border-field");
  });

  it("keeps every status tag legible: 4.5:1", () => {
    for (const [text, tint] of [
      [roles.quiet.text, roles.quiet.DEFAULT],
      [roles.primary.hover, roles.primary.tint],
      [roles.success.text, roles.success.tint],
      [roles.warn.text, roles.warn.tint],
      [roles.attention.text, roles.attention.tint],
    ] as const) {
      expect(contrastRatio(text, tint)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
