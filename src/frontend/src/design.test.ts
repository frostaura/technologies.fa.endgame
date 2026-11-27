import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { breakpoints, contrastRatio, layout, railQuery, roles, viewportQueries } from "./lib/tokens";
import { STATES } from "./components/ui/alert";

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
const DASHED_ALLOWED = new Set(["src/demo/hosted/kit.tsx", "src/features/home/ConversationDock.tsx"]);

/**
 * The two retired hues, counted per file. The org chart and the organisation graph no longer use them; they stay only for
 * the chart series; the counts may fall, never rise, and a new file may not use them at all.
 */
const RETIRED_HUES = /\b(?:bg|text|border|ring|fill|stroke)-(?:violet|teal)\b[\w/-]*/g;
const RETIRED_HUE_ALLOWANCE: Record<string, number> = {
  "src/features/apps/AskChart.tsx": 4,
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

// ---------------------------------------------------------------------------------------------
// Round two (ARCH-011): one button, one confirmation, one figure, one table, one select, the shell.
// ---------------------------------------------------------------------------------------------

/** Every JSX element named `tag` in the console's own source (not the demo), with its className's source text. */
function elements(tag: string): { file: string; line: number; className: string }[] {
  const out: { file: string; line: number; className: string }[] = [];
  for (const s of sources()) {
    if (!s.file.endsWith(".tsx") || s.file.startsWith("src/demo/")) continue;
    const sf = ts.createSourceFile(s.file, s.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node) => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === tag) {
        const attr = n.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "className");
        const className = attr && ts.isJsxAttribute(attr) ? (attr.initializer?.getText(sf) ?? "") : "";
        out.push({ file: s.file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, className });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** State classes are not shape: what a control does on hover, focus or when disabled. */
const withoutStates = (c: string) => c.replace(/\b(?:hover|focus|focus-visible|aria-[\w-]+|disabled|group-hover|after|before|data-\[[^\]]*\]):[\w-/[\]]+/g, "");

/**
 * Raw `<button>`s that draw a button's shape of their own (a radius AND a fill, edge or shadow), per file. Each is
 * a thing that is not a button visually — a pressable card or row, a segmented control's tab, a switch, a sheet's
 * close — or the conversation lane's, still to adopt. The counts may fall, never rise; a new file may have none.
 */
const BUTTON_SHAPED_ALLOWED: Record<string, number> = {
  "src/components/Sheet.tsx": 1,
  "src/features/autonomy/AutonomyView.tsx": 2,
  "src/features/conversation/AttachmentChips.tsx": 1,
  "src/features/conversation/Composer.tsx": 3,
  "src/features/home/ConversationDock.tsx": 1,
  "src/features/home/HomeView.tsx": 2,
  "src/features/shell/shellControls.tsx": 2,
  "src/features/start/StartView.tsx": 1,
};

describe("one button (ARCH-011)", () => {
  it("draws no button by hand: a raw <button> with a radius and a fill or edge is the Button component", () => {
    const counts: Record<string, number> = {};
    for (const b of elements("button")) {
      const c = withoutStates(b.className);
      if (/\brounded-(?!none)[\w-]+/.test(c) && /\b(?:bg-(?!transparent)[\w-]+|border(?:-[\w-]+)?|shadow-[\w-]+)\b/.test(c)) counts[b.file] = (counts[b.file] ?? 0) + 1;
    }
    const over = Object.entries(counts).filter(([f, n]) => n > (BUTTON_SHAPED_ALLOWED[f] ?? 0)).map(([f, n]) => `${f}: ${n} hand-drawn, ${BUTTON_SHAPED_ALLOWED[f] ?? 0} allowed`);
    expect(over).toEqual([]);
  });

  it("never reshapes a Button: only layout classes are passed to it", () => {
    const SHAPE = /(?:^|[\s"'`])(?:rounded-[\w-]+|h-\d+|min-h-[\w-]+|py-[\w.]+|text-(?:xs|sm|base|lg|xl)|font-(?:bold|semibold|medium|normal)|bg-[\w-]+|border(?:-[\w-]+)?)(?=$|[\s"'`])/;
    const offenders = elements("Button")
      // The conversation lane's files adopt the scale in their own round.
      .filter((b) => !b.file.startsWith("src/features/conversation/") && !b.file.startsWith("src/features/home/ConversationDock"))
      .filter((b) => SHAPE.test(withoutStates(b.className).replace(/\b(?:max-|min-)?(?:sm|md|lg|xl|phone|touch|rail):[\w-/[\]]+/g, "")))
      .map((b) => `${b.file}:${b.line} ${b.className.slice(0, 90)}`);
    expect(offenders).toEqual([]);
  });

  it("offers the five variants and the three heights, with one radius and one disabled look", () => {
    const button = readFileSync(join(root, "src/components/ui/button.tsx"), "utf8");
    for (const v of ["primary:", "secondary:", "quiet:", "danger:", '"danger-outline":']) expect(button).toContain(v);
    expect(button).toContain('sm: "h-8');
    expect(button).toContain('md: "h-10');
    expect(button).toContain('lg: "h-12');
    expect(new Set(button.match(/\brounded-(?:xs|sm|md|lg|full)\b/g))).toEqual(new Set(["rounded-xs"]));
    expect(button).toContain("disabled:bg-quiet");
    expect(button).not.toMatch(/disabled:opacity/);
  });

  it("keeps the retired variant names to the conversation lane's files", () => {
    const offenders = sources()
      .filter((s) => !s.file.startsWith("src/features/conversation/") && !s.file.startsWith("src/features/home/ConversationDock") && !s.file.startsWith("src/demo/hosted/"))
      .filter((s) => /variant(?:=|: )"(?:outline|soft|ghost|white)"/.test(s.text) && /components\/ui\/button/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe("one confirmation (ARCH-011)", () => {
  it("draws a destructive confirm only inside ConfirmCard", () => {
    const offenders = sources()
      .filter((s) => s.file !== "src/components/ui/confirm.tsx" && /variant(?:=|: )"danger"/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("anchors the card to its trigger and lays its two choices out as equals", () => {
    const confirm = readFileSync(join(root, "src/components/ui/confirm.tsx"), "utf8");
    expect(confirm).toContain("anchorToTrigger");
    expect(confirm).toContain('variant="secondary"');
    expect(confirm).toContain("data-confirm");
  });
});

describe("one figure and one number format (ARCH-011)", () => {
  it("never ellipsises a figure's value", () => {
    const stat = readFileSync(join(root, "src/components/ui/stat.tsx"), "utf8");
    const value = stat.slice(stat.indexOf("<Value"), stat.indexOf("</Value>"));
    expect(value).not.toMatch(/\btruncate\b|text-ellipsis/);
    expect(stat).toContain("useFitValue");
  });

  it("formats numbers only through lib/format: no toFixed or toLocaleString on a figure elsewhere", () => {
    const offenders = sources()
      .filter((s) => !["src/lib/format.ts", "src/features/conversation/attachments.ts"].includes(s.file) && !s.file.startsWith("src/demo/"))
      .flatMap((s) => [...s.text.matchAll(/\.(toFixed)\(|\b(\w+)\.toLocaleString\((?!"en-GB", \{ day)/g)].map(() => s.file));
    expect(offenders).toEqual([]);
  });
});

describe("one table, one select, one tag case (ARCH-011)", () => {
  it("builds no table by hand: a list of three or more columns is the Table", () => {
    const offenders = sources()
      .filter((s) => !s.file.startsWith("src/demo/") && /\b(?:sm|md|lg|xl|3xl):grid-cols-\[[^\]\s]*_[^\]\s]*_[^\]\s]*\]/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("switches a table to cards on its own width, never the window's", () => {
    const config = readFileSync(join(root, "tailwind.config.ts"), "utf8");
    expect(config).toContain("@container table");
    expect(config).toContain("containerType");
  });

  it("uses the house select: no raw <select> outside it", () => {
    expect(elements("select").map((e) => e.file).filter((f) => f !== "src/components/ui/field.tsx")).toEqual([]);
  });

  it("sets every tag in sentence case", () => {
    const offenders = elements("Badge").filter((b) => /\buppercase\b|\btracking-wide/.test(b.className)).map((b) => `${b.file}:${b.line}`);
    expect(offenders).toEqual([]);
  });
});

describe("the shell at every size (ARCH-011)", () => {
  it("takes the rail only for a window wider than it is tall and at least railMin wide", () => {
    expect(railQuery).toContain("orientation: landscape");
    expect(railQuery).toContain(`min-width: ${breakpoints.railMin}px`);
    expect(viewportQueries.phone).toContain(railQuery);
  });

  it("keeps the mode switch the same width in both modes: System is never inside it", () => {
    const controls = readFileSync(join(root, "src/features/shell/shellControls.tsx"), "utf8");
    const toggle = controls.slice(controls.indexOf("export function ModeToggle"), controls.indexOf("export function SystemLink"));
    expect(toggle).not.toContain("paths.system");
  });

  it("draws the balance as a neutral chip, never a coloured pill", () => {
    const controls = readFileSync(join(root, "src/features/shell/shellControls.tsx"), "utf8");
    const chip = controls.slice(controls.indexOf("export function CreditsPill"), controls.indexOf("/**\n * Signing out"));
    expect(chip).not.toMatch(/bg-(?:success|attention)-tint/);
  });

  it("caps a bottom sheet at 85% of what is visible", () => {
    expect(layout.height.sheet).toContain("0.85");
  });
});

describe("the states (ARCH-011)", () => {
  it("never shows a budget pause, an approval or a cancellation in the bad tone", () => {
    for (const s of ["paused-by-budget", "approval-asked", "approval-answered", "cancelled", "withdrawn", "declined"] as const) expect(STATES[s].tone).not.toBe("bad");
    expect(STATES["paused-by-budget"].tone).toBe("warn");
  });

  it("never draws a shield for a state", () => {
    const offenders = sources().filter((s) => !s.file.startsWith("src/demo/") && /\bShield\w*\b/.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
