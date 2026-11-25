import type { Block, ListItem } from "../src/content/types.ts";

/**
 * Just enough markdown for the flow documents: nested ordered and bulleted lists, paragraphs and
 * pipe tables, read by indentation. Inline markup is left as written for the renderer.
 */

const LIST_ITEM = /^(\d+)\.\s+(.*)$|^[-*]\s+(.*)$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim() !== "").map(indentOf);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => (l.trim() === "" ? "" : l.slice(min)));
}

function isTableLine(line: string): boolean {
  return line.trimStart().startsWith("|");
}

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "\\" && inner[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

export function parseBlocks(input: string[]): Block[] {
  const lines = dedent(input);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    const indent = indentOf(line);
    const marker = LIST_ITEM.exec(line.trim());
    if (marker && indent === 0) {
      const ordered = marker[1] !== undefined;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        const m = LIST_ITEM.exec(current.trim());
        if (!m || indentOf(current) !== 0 || (m[1] !== undefined) !== ordered) break;
        let text = (ordered ? m[2] : m[3]) ?? "";
        i++;
        // Lazy continuation: unindented-or-indented prose straight after the marker line.
        while (i < lines.length) {
          const next = lines[i] ?? "";
          if (next.trim() === "" || LIST_ITEM.test(next.trim()) || isTableLine(next) || indentOf(next) === 0) break;
          if (indentOf(next) > 0 && children(lines, i)) break;
          text += " " + next.trim();
          i++;
        }
        const body: string[] = [];
        while (i < lines.length) {
          const next = lines[i] ?? "";
          if (next.trim() !== "" && indentOf(next) === 0) break;
          body.push(next);
          i++;
        }
        while (body.length && (body[body.length - 1] ?? "").trim() === "") body.pop();
        items.push({ text: text.trim(), children: parseBlocks(body) });
        // A blank line between items of the same list does not end the list.
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (isTableLine(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableLine(lines[i] ?? "")) {
        rows.push(splitRow(lines[i] ?? ""));
        i++;
      }
      const [header = [], , ...body] = rows;
      blocks.push({ kind: "table", header, rows: body });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "" || LIST_ITEM.test(next.trim()) || isTableLine(next)) break;
      para.push(next.trim());
      i++;
    }
    blocks.push({ kind: "para", text: para.join(" ") });
  }
  return blocks;
}

/** A line indented under a list item that starts a nested structure rather than continuing prose. */
function children(lines: string[], i: number): boolean {
  const t = (lines[i] ?? "").trim();
  return LIST_ITEM.test(t) || t.startsWith("|");
}

/** Every piece of text in a block tree, flattened, for search and label harvesting. */
export function blockText(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "para") out.push(b.text);
    else if (b.kind === "table") out.push(...b.header, ...b.rows.flat());
    else for (const item of b.items) out.push(item.text, ...blockText(item.children));
  }
  return out;
}

export { plain } from "../src/content/text.ts";
