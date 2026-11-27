import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { channels, contrastRatio, cssVariables, flatRoles, roles, tailwindColors } from "./lib/tokens";

const frontendRoot = join(import.meta.dirname, "..");
const TOKEN_FILE = "src/lib/tokens.ts";
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/** Every source file a colour could be written into, outside the token file and the tests. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|css|html)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(relative(frontendRoot, full));
    }
  };
  walk(join(frontendRoot, "src"));
  return [...out, "index.html", "tailwind.config.ts"].filter((f) => f !== TOKEN_FILE);
}

describe("one token layer", () => {
  it("finds the source it guards", () => {
    expect(sourceFiles()).toContain("src/features/status/SystemStatusView.tsx");
    expect(sourceFiles()).toContain("tailwind.config.ts");
  });

  it("allows no raw hex colour outside src/lib/tokens.ts", () => {
    const offenders = sourceFiles().flatMap((file) =>
      (readFileSync(join(frontendRoot, file), "utf8").match(HEX) ?? []).map((hex) => `${file}: ${hex}`),
    );
    expect(offenders).toEqual([]);
  });

  it("would catch one", () => {
    // The guard is only worth having if its pattern matches what a person would type.
    expect("text-[#2F5BFF]".match(HEX)).toEqual(["#2F5BFF"]);
    expect("color: #fff;".match(HEX)).toEqual(["#fff"]);
  });
});

describe("the look", () => {
  it("carries the specified palette exactly", () => {
    expect(flatRoles()).toMatchObject({
      ground: "#F5F6FB",
      surface: "#FFFFFF",
      ink: "#0B1020",
      "ink-muted": "#535B70",
      border: "#E4E7F2",
      primary: "#2F5BFF",
      "primary-hover": "#1E3FCC",
      "primary-tint": "#EEF2FF",
      violet: "#6B4BF0",
      "violet-tint": "#F3EEFF",
      teal: "#0B8FA6",
      success: "#12A15E",
      "success-text": "#0E6B42",
      "success-tint": "#E9FBF1",
      "attention-text": "#B42318",
      "attention-tint": "#FFF1EC",
    });
  });

  it("emits every role as RGB channels, so opacity modifiers work", () => {
    expect(channels("#2F5BFF")).toBe("47 91 255");
    const vars = cssVariables();
    for (const name of Object.keys(flatRoles())) expect(vars[`--color-${name}`]).toMatch(/^\d+ \d+ \d+$/);
    expect(JSON.stringify(tailwindColors())).not.toMatch(HEX);
  });

  it("keeps text legible (WCAG AA 4.5:1) on every surface it is set on", () => {
    const pairs: [string, string][] = [
      [roles.ink.DEFAULT, roles.surface],
      [roles.ink.DEFAULT, roles.ground],
      [roles.ink.muted, roles.surface],
      [roles.ink.muted, roles.ground],
      [roles.success.text, roles.success.tint],
      [roles.attention.text, roles.attention.tint],
      [roles.attention.text, roles.surface],
      [roles.primary.ink, roles.primary.DEFAULT],
      [roles.primary.hover, roles.primary.tint],
      [roles.ink.muted, roles.success.tint],
      [roles.ink.muted, roles.attention.tint],
    ];
    for (const [text, bg] of pairs) expect(contrastRatio(text, bg), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
