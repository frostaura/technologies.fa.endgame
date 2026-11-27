/**
 * A small, safe reading of the markdown a model writes in a reply: paragraphs, line breaks, bullet
 * and numbered lists, headings, fenced code, tables, quotes, and inline bold, italics, code and
 * links. It parses to
 * a plain tree that a component draws as React elements, so no text is ever handed to the browser
 * as HTML: a `<script>` in a reply is printed as the characters it is.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "break" };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "heading"; level?: number; children: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: Inline[][] }
  | { kind: "code"; text: string; lang?: string }
  | { kind: "quote"; children: Inline[] }
  | { kind: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] };

const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** The cells of one table row: `| a | b |` or `a | b`, with `\|` kept as a bar. */
export function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", children: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ordered: list.ordered, start: list.start, items: list.items.map((i) => parseInline(i)) });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(FENCE);
    if (fence) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      i++;
      const lang = line.trim().slice(3).trim().split(/\s+/)[0] ?? "";
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(fence[1] ?? "```")) code.push(lines[i++] ?? "");
      blocks.push(lang && /^[\w+#.-]{1,20}$/.test(lang) ? { kind: "code", text: code.join("\n"), lang } : { kind: "code", text: code.join("\n") });
      continue;
    }
    // A table: a row of cells, a rule of dashes under it, then rows until a line without a bar.
    const next = lines[i + 1] ?? "";
    if (line.includes("|") && TABLE_RULE.test(next) && next.includes("-")) {
      const head = tableCells(line);
      const rule = tableCells(next);
      if (head.length >= 1 && rule.length === head.length) {
        flushParagraph();
        flushList();
        const rows: Inline[][][] = [];
        i += 2;
        while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
          const cells = tableCells(lines[i] ?? "");
          rows.push(head.map((_, c) => parseInline(cells[c] ?? "")));
          i++;
        }
        i--;
        blocks.push({ kind: "table", align: rule.map(alignOf), head: head.map((c) => parseInline(c)), rows });
        continue;
      }
    }
    const quote = line.match(QUOTE);
    if (quote) {
      flushParagraph();
      flushList();
      const said: string[] = [quote[1] ?? ""];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1] ?? "")) said.push((lines[++i] ?? "").match(QUOTE)?.[1] ?? "");
      blocks.push({ kind: "quote", children: parseInline(said.join("\n")) });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: (heading[1] ?? "#").length, children: parseInline(heading[2] ?? "") });
      continue;
    }
    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? (bullet[1] ?? "") : (numbered?.[2] ?? ""));
      continue;
    }
    if (list) {
      // An indented line under a list item continues that item; anything else ends the list.
      if (/^\s+/.test(line) && list.items.length > 0) {
        list.items[list.items.length - 1] += ` ${line.trim()}`;
        continue;
      }
      flushList();
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Only addresses a person can safely follow: the web, mail, or a page of the console itself. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  if (h.startsWith("/") && !h.startsWith("//")) return h;
  return null;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    const rest = text.slice(i);

    if (ch === "\\" && i + 1 < text.length && /[\\`*_[\]()#+\-.!>]/.test(text[i + 1] ?? "")) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ kind: "break" });
      i++;
      continue;
    }
    if (ch === "`") {
      const ticks = rest.match(/^`+/)?.[0] ?? "`";
      const end = text.indexOf(ticks, i + ticks.length);
      if (end > i) {
        flush();
        out.push({ kind: "code", text: text.slice(i + ticks.length, end).trim() || text.slice(i + ticks.length, end) });
        i = end + ticks.length;
        continue;
      }
    }
    if (ch === "[") {
      const link = rest.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
      if (link) {
        const href = safeHref(link[2] ?? "");
        flush();
        const children = parseInline(link[1] ?? "");
        // A link to anywhere else (javascript:, data:) keeps its words and loses its address.
        if (href) out.push({ kind: "link", href, children });
        else out.push(...children);
        i += link[0].length;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && rest.startsWith(ch + ch)) {
      const marker = ch + ch;
      const end = text.indexOf(marker, i + 2);
      if (end > i + 2 && !/\s/.test(text[i + 2] ?? "") && !/\s/.test(text[end - 1] ?? "") && (ch === "*" || wordEdge(text, i, end + 2))) {
        flush();
        out.push({ kind: "strong", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const end = findSingle(text, ch, i + 1);
      if (end > i + 1 && !/\s/.test(text[i + 1] ?? "") && !/\s/.test(text[end - 1] ?? "") && (ch === "*" || wordEdge(text, i, end + 1))) {
        flush();
        out.push({ kind: "em", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

/** The next lone marker (not half of a double one) on the same line. */
function findSingle(text: string, marker: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    const c = text[j];
    if (c === "\n") return -1;
    if (c === marker) {
      if (text[j + 1] === marker) {
        j++;
        continue;
      }
      return j;
    }
  }
  return -1;
}

/** Underscores emphasise only at word edges, so `snake_case_names` stay as written. */
function wordEdge(text: string, start: number, after: number): boolean {
  return !/\w/.test(text[start - 1] ?? "") && !/\w/.test(text[after] ?? "");
}

/** The words a reply says, with its marks taken out: for a one-line summary or a comparison. */
export function markdownToPlain(source: string): string {
  const inline = (nodes: Inline[]): string =>
    nodes.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : n.kind === "break" ? " " : "children" in n ? inline(n.children) : "")).join("");
  return parseMarkdown(source)
    .map((b) =>
      b.kind === "code" ? b.text : b.kind === "list" ? b.items.map(inline).join("; ") : b.kind === "table" ? [b.head, ...b.rows].map((r) => r.map(inline).join(", ")).join("; ") : inline(b.children),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
