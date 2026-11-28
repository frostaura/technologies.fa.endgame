// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contrastRatio, flatRoles } from "../../../frontend/src/lib/tokens.ts";
import { INLINE_STYLE } from "./inlineStyle.ts";

/** The ground inline text is drawn on: the page's surface (every card is light). */
const GROUND = "surface";
const roles = flatRoles();

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** A role at an opacity, laid over the ground. */
function over(role: string, alpha: number, ground: string): string {
  const [a, b] = [rgb(roles[role] ?? ""), rgb(ground)];
  return hex([0, 1, 2].map((i) => (a[i] ?? 0) * alpha + (b[i] ?? 0) * (1 - alpha)) as [number, number, number]);
}

/** The colour a class list paints with `kind` (`text` or `bg`), or null. */
function paint(classes: string, kind: "text" | "bg", ground: string): string | null {
  for (const c of classes.split(/\s+/)) {
    const m = new RegExp(`^${kind}-([a-z-]+?)(?:/(\\d+))?$`).exec(c);
    if (m && roles[m[1] ?? ""]) return over(m[1] ?? "", m[2] ? Number(m[2]) / 100 : 1, ground);
  }
  return null;
}

describe("every inline style is legible on the ground it is drawn on (WCAG AA)", () => {
  for (const [name, classes] of Object.entries(INLINE_STYLE)) {
    it(name, () => {
      const ground = roles[GROUND] ?? "";
      const bg = paint(classes, "bg", ground) ?? ground;
      const text = paint(classes, "text", bg);
      expect(text, `${name} names its text colour`).not.toBeNull();
      expect(contrastRatio(text ?? "", bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
