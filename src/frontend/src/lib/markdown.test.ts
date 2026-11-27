import { describe, expect, it } from "vitest";
import { markdownToPlain, parseInline, parseMarkdown, safeHref } from "./markdown";

describe("parseInline", () => {
  it("reads bold, italics and inline code (D9)", () => {
    expect(parseInline("You run **1 app**: the *Club* list (`book-club/web`)")).toEqual([
      { kind: "text", text: "You run " },
      { kind: "strong", children: [{ kind: "text", text: "1 app" }] },
      { kind: "text", text: ": the " },
      { kind: "em", children: [{ kind: "text", text: "Club" }] },
      { kind: "text", text: " list (" },
      { kind: "code", text: "book-club/web" },
      { kind: "text", text: ")" },
    ]);
  });

  it("leaves snake_case words and lone asterisks as written", () => {
    expect(parseInline("a snake_case_name costs 2 * 3")).toEqual([{ kind: "text", text: "a snake_case_name costs 2 * 3" }]);
  });

  it("keeps a safe link and drops an unsafe address but keeps its words", () => {
    expect(parseInline("[Credits](/credits)")).toEqual([{ kind: "link", href: "/credits", children: [{ kind: "text", text: "Credits" }] }]);
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ kind: "text", text: "click" }, { kind: "text", text: ")" }]);
  });
});

describe("safeHref", () => {
  it("allows the web, mail and the console's own pages only", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("/runs/1")).toBe("/runs/1");
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
  });
});

describe("parseMarkdown", () => {
  it("reads paragraphs, lists, headings and code fences", () => {
    const blocks = parseMarkdown("## Apps\n\nYou run two:\n- **Books**\n- Notes\n\n1. first\n2. second\n\n```\nraw *text*\n```");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "code"]);
    const bullets = blocks[2];
    expect(bullets?.kind === "list" && !bullets.ordered && bullets.items.length).toBe(2);
    const numbered = blocks[3];
    expect(numbered?.kind === "list" && numbered.ordered && numbered.start).toBe(1);
    expect(blocks[4]).toEqual({ kind: "code", text: "raw *text*" });
  });

  it("keeps a single line break inside a paragraph", () => {
    expect(parseMarkdown("one\ntwo")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "one" }, { kind: "break" }, { kind: "text", text: "two" }] }]);
  });
});

describe("markdownToPlain", () => {
  it("is the words without their marks", () => {
    expect(markdownToPlain("You run **1 app**:\n- the `web` one")).toBe("You run 1 app: the web one");
  });
});

describe("tables, quotes, headings and code (ARCH-011)", () => {
  it("reads a pipe table with its alignment, a quote, a heading's level and a fence's language", () => {
    const blocks = parseMarkdown("## Cost\n\n| App | Credits |\n|:---|---:|\n| Court booking | 296 |\n| Tutor \\| Match | 88 |\n\n> Said before\n> twice\n\n```ts\nconst a = 1;\n```");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "table", "quote", "code"]);
    expect(blocks[0]).toMatchObject({ level: 2 });
    const table = blocks[1];
    if (table?.kind !== "table") throw new Error("no table");
    expect(table.align).toEqual(["left", "right"]);
    expect(table.rows).toHaveLength(2);
    expect(markdownToPlain("| A | B |\n|---|---|\n| x | y |")).toBe("A, B; x, y");
    expect(blocks[3]).toEqual({ kind: "code", text: "const a = 1;", lang: "ts" });
  });

  it("leaves a line with a bar but no rule beneath it as a paragraph", () => {
    expect(parseMarkdown("a | b\nnot a rule").map((b) => b.kind)).toEqual(["paragraph"]);
  });
});
