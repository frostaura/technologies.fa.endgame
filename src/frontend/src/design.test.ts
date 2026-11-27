import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, roles } from "./lib/tokens";

/**
 * The design system's guards (ARCH-011): cheap checks over the source that stop the regressions three
 * visual reviews found, so a feature lane cannot bring them back without this file saying so.
 */

const root = join(import.meta.dirname, "..");

function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push({ file: relative(root, full), text: readFileSync(full, "utf8") });
    }
  };
  walk(join(root, "src"));
  return out;
}

/** An element other than a heading whose class names set a figure size: a big number drawn by hand. */
const HAND_DRAWN_FIGURE = /<(span|p|div|strong|dd|td)[^>]*className=(?:"|\{cn\(")[^"]*\btext-(2xl|3xl|4xl|5xl|hero|balance)\b/g;

/** Where a dashed outline is allowed: a genuine drop zone. The hosted copy of the app kit's pages is the apps lane's (ARCH-011). */
const DASHED_ALLOWED = new Set(["src/demo/hosted/kit.tsx"]);

/**
 * The two retired hues, counted per file. The org chart and the organisation graph no longer use them; they stay only for
 * the chart series; the counts may fall, never rise, and a new file may not use them at all.
 */
const RETIRED_HUES = /\b(?:bg|text|border|ring|fill|stroke)-(?:violet|teal)\b[\w/-]*/g;
const RETIRED_HUE_ALLOWANCE: Record<string, number> = {
  "src/features/home/ConversationDock.tsx": 3,
  "src/features/apps/AskChart.tsx": 6,
  "src/features/runs/RunView.tsx": 8,
  "src/features/autonomy/AutonomyView.tsx": 1,
};

describe("the figure tile is the only big number", () => {
  it("draws no figure-sized text outside Stat", () => {
    const offenders = sources()
      .filter((s) => s.file !== "src/components/ui/stat.tsx")
      .flatMap((s) => [...s.text.matchAll(HAND_DRAWN_FIGURE)].map((m) => `${s.file}: ${m[0].slice(0, 80)}`))
      // The wordmark beside the mark is a name, not a figure.
      .filter((o) => !o.startsWith("src/features/auth/SignInView.tsx: <span className=\"font-display text-2xl"));
    expect(offenders).toEqual([]);
  });

  it("would catch one", () => {
    expect('<span className="font-display text-3xl font-semibold">{n}</span>'.match(HAND_DRAWN_FIGURE)).not.toBeNull();
    expect('<h1 className="text-3xl font-semibold">Title</h1>'.match(HAND_DRAWN_FIGURE)).toBeNull();
  });
});

describe("dashed outlines are for drop zones only", () => {
  it("uses none on real content or an empty state", () => {
    const offenders = sources()
      .filter((s) => !DASHED_ALLOWED.has(s.file) && /\bborder-dashed\b|\bborder-[\w-]+-dash\b/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe("chips and tags are one line", () => {
  it("never let a chip or a tag wrap", () => {
    const chip = readFileSync(join(root, "src/components/ui/chip.tsx"), "utf8");
    const badge = readFileSync(join(root, "src/components/ui/badge.tsx"), "utf8");
    for (const text of [chip, badge]) {
      expect(text).toContain("whitespace-nowrap");
      expect(text).toContain("truncate");
      expect(text).not.toMatch(/whitespace-normal|break-words/);
    }
  });

  it("offers the closed status set and nothing else", () => {
    const badge = readFileSync(join(root, "src/components/ui/badge.tsx"), "utf8");
    const tones = [...(badge.match(/tone: \{([\s\S]*?)\n {4}\}/)?.[1] ?? "").matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    expect(tones).toEqual(["neutral", "info", "good", "warn", "bad"]);
  });
});

describe("one accent", () => {
  it("lets the retired hues fall, never rise", () => {
    const over = sources().flatMap((s) => {
      const n = s.text.match(RETIRED_HUES)?.length ?? 0;
      const allowed = RETIRED_HUE_ALLOWANCE[s.file] ?? 0;
      return n > allowed ? [`${s.file}: ${n} uses of violet/teal, ${allowed} allowed`] : [];
    });
    expect(over).toEqual([]);
  });

  it("draws no gradient band or drifting aura", () => {
    const offenders = sources().filter((s) => /\bblur-aura\b|\bbg-night\b|bg-gradient-|\bfrom-\w/.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe("contrast", () => {
  it("gives a field's edge 3:1 against both surfaces (WCAG 1.4.11)", () => {
    expect(contrastRatio(roles.border.field, roles.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(roles.border.field, roles.ground)).toBeGreaterThanOrEqual(3);
  });

  it("keeps every status tag legible (4.5:1)", () => {
    const pairs: [string, string][] = [
      [roles.quiet.text, roles.quiet.DEFAULT],
      [roles.primary.hover, roles.primary.tint],
      [roles.success.text, roles.success.tint],
      [roles.warn.text, roles.warn.tint],
      [roles.attention.text, roles.attention.tint],
      [roles.primary.ink, roles.attention.text],
    ];
    for (const [text, bg] of pairs) expect(contrastRatio(text, bg), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});

/** The browser's own disclosure triangle: the shared fold (`Disclosure`) replaces it. These files may only lose theirs. */
const NATIVE_DISCLOSURE_ALLOWED = new Set(["src/features/apps/AskPanel.tsx", "src/components/ErrorBoundary.tsx", "src/features/runs/RunView.tsx", "src/features/operator/OperatorView.tsx"]);

describe("one disclosure", () => {
  it("adds no native <details> fold: a long list folds under the shared Disclosure", () => {
    const offenders = sources()
      .filter((s) => !NATIVE_DISCLOSURE_ALLOWED.has(s.file) && /<details\b/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
