import { Fragment, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { parseMarkdown, type Align, type Inline } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import type { IconName } from "./iconNames";
import { Link } from "./Link";

/**
 * A model-written reply or summary, drawn from its markdown as React elements (never as HTML):
 * headings, lists, tables, quotes, code with a copy button, and links — a link to something in the
 * organisation (an app, an employee, a piece of work, an idea) drawn as a chip with its kind.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div data-markdown className={cn("flex min-w-0 flex-col gap-2.5 break-words", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "paragraph":
            return <p key={i}>{inline(b.children)}</p>;
          case "heading":
            return (b.level ?? 3) <= 2 ? (
              <h3 key={i} className="pt-1 font-display text-base font-semibold text-ink">
                {inline(b.children)}
              </h3>
            ) : (
              <h4 key={i} className="pt-0.5 font-semibold text-ink">
                {inline(b.children)}
              </h4>
            );
          case "code":
            return <CodeBlock key={i} text={b.text} lang={b.lang ?? null} />;
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-border-strong pl-3 text-ink-muted">
                {inline(b.children)}
              </blockquote>
            );
          case "table":
            return (
              <div key={i} data-table="" className="max-w-full overflow-x-auto rounded-xs border">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-ground">
                    <tr>
                      {b.head.map((cell, c) => (
                        <th key={c} scope="col" className={cn("border-b px-3 py-2 text-left font-semibold text-ink", alignClass(b.align[c] ?? null))}>
                          {inline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b last:border-b-0">
                        {row.map((cell, c) => (
                          <td key={c} className={cn("px-3 py-2 align-top", alignClass(b.align[c] ?? null))}>
                            {inline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "list": {
            const items = b.items.map((item, j) => <li key={j}>{inline(item)}</li>);
            return b.ordered ? (
              <ol key={i} start={b.start} className="flex list-decimal flex-col gap-1 pl-5">
                {items}
              </ol>
            ) : (
              <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
                {items}
              </ul>
            );
          }
        }
      })}
    </div>
  );
}

function alignClass(a: Align): string {
  return a === "right" ? "text-right tabular-nums" : a === "center" ? "text-center" : "";
}

/** A fenced block, scrolled sideways rather than wrapped, with a button that copies it. */
function CodeBlock({ text, lang }: { text: string; lang: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // The clipboard can be refused (an insecure page, a denied permission): the text is still there to select.
    }
  };
  return (
    <div data-code="" className="min-w-0 overflow-hidden rounded-xs border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b bg-ground py-0.5 pl-3 pr-1 text-xs text-ink-muted">
        <span className="font-mono">{lang ?? "text"}</span>
        <button type="button" onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy the code"} className="flex min-h-touch min-w-touch items-center justify-center gap-1 rounded-xs px-2 hover:bg-surface hover:text-ink">
          {copied ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-sm leading-relaxed">{text}</pre>
    </div>
  );
}

/** A console page a link may name, as a chip: what kind of thing it is, and its icon. */
const CHIPS: { pattern: RegExp; icon: IconName; kind: string }[] = [
  { pattern: /^\/apps\/[^/?#]+$/, icon: "app", kind: "App" },
  { pattern: /^\/employees\/[^/?#]+$/, icon: "employee", kind: "Employee" },
  { pattern: /^\/runs\/[^/?#]+$/, icon: "plan", kind: "Work" },
  { pattern: /^\/ideas\/[^/?#]+$/, icon: "research", kind: "Idea" },
];

function chipFor(href: string): { icon: IconName; kind: string } | null {
  return CHIPS.find((c) => c.pattern.test(href)) ?? null;
}

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return <Fragment key={i}>{n.text}</Fragment>;
      case "break":
        return <br key={i} />;
      case "strong":
        return (
          <strong key={i} className="font-semibold text-ink">
            {inline(n.children)}
          </strong>
        );
      case "em":
        return <em key={i}>{inline(n.children)}</em>;
      case "code":
        return (
          // A path breaks only after a "/", never mid-word, with no space inside the box (real-stack 11).
          <code key={i} className="whitespace-normal break-normal rounded-xs border bg-surface px-1 py-0.5 font-mono text-sm box-decoration-clone">
            {n.text.split("/").map((part, j, all) => (
              <Fragment key={j}>
                {part}
                {j < all.length - 1 && (
                  <>
                    /<wbr />
                  </>
                )}
              </Fragment>
            ))}
          </code>
        );
      case "link": {
        if (!n.href.startsWith("/")) {
          return (
            <a key={i} href={n.href} target="_blank" rel="noreferrer noopener" className="rounded-xs font-semibold text-primary-link underline hover:text-primary-hover">
              {inline(n.children)}
            </a>
          );
        }
        const chip = chipFor(n.href);
        if (!chip) {
          return (
            <Link key={i} href={n.href} className="rounded-xs font-semibold text-primary-link underline hover:text-primary-hover">
              {inline(n.children)}
            </Link>
          );
        }
        return (
          <Link
            key={i}
            href={n.href}
            data-chip={chip.kind.toLowerCase()}
            title={chip.kind}
            className="mx-0.5 inline rounded-full border border-primary-line bg-primary-tint py-0.5 pl-1.5 pr-2.5 text-sm font-semibold text-primary-hover box-decoration-clone hover:bg-surface"
          >
            <Icon name={chip.icon} className="mr-1 inline size-3.5 align-text-bottom" />
            {inline(n.children)}
          </Link>
        );
      }
    }
  });
}
