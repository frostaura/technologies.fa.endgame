import type { Block } from "../content/types.ts";
import { Inline } from "./Inline.tsx";

/** A flow's nested content: lists, paragraphs and tables, in the site's type. */
export function Blocks({ blocks, self, tone = "body" }: { blocks: Block[]; self?: string; tone?: "body" | "muted" }) {
  const text = tone === "muted" ? "text-ink-muted" : "text-ink-body";
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "para") return <p key={i} className={`mt-2 ${text}`}><Inline text={b.text} self={self} /></p>;
        if (b.kind === "table")
          return (
            <div key={i} className="mt-3 overflow-x-auto rounded-xs border">
              <table className="w-full text-left text-xs">
                <thead className="bg-ground">
                  <tr>{b.header.map((h, j) => <th key={j} scope="col" className="px-3 py-2 font-semibold text-ink"><Inline text={h} self={self} /></th>)}</tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-t align-top">
                      {r.map((c, n) => <td key={n} className={`px-3 py-2 ${text}`}><Inline text={c} self={self} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        const List = b.ordered ? "ol" : "ul";
        return (
          <List key={i} className={`mt-2 space-y-1.5 pl-5 ${b.ordered ? "list-decimal" : "list-disc"} marker:text-primary-soft ${text}`}>
            {b.items.map((item, j) => (
              <li key={j} className="pl-1">
                <Inline text={item.text} self={self} />
                {item.children.length > 0 && <Blocks blocks={item.children} self={self} tone={tone} />}
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}
