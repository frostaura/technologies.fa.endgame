import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { Link } from "./Link";

/**
 * A model-written reply or summary, drawn from its markdown as React elements (never as HTML):
 * bold, italics, lists, inline code and links read as they were meant to, not as asterisks.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div data-markdown className={cn("flex min-w-0 flex-col gap-2 break-words", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "paragraph":
            return <p key={i}>{inline(b.children)}</p>;
          case "heading":
            return (
              <p key={i} className="font-semibold text-ink">
                {inline(b.children)}
              </p>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-xs border bg-surface p-3 font-mono text-sm">
                {b.text}
              </pre>
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
          <code key={i} className="break-all rounded-xs border bg-surface px-1 py-0.5 font-mono text-sm">
            {n.text}
          </code>
        );
      case "link":
        return n.href.startsWith("/") ? (
          <Link key={i} href={n.href} className="rounded-xs font-semibold text-primary-link underline hover:text-primary-hover">
            {inline(n.children)}
          </Link>
        ) : (
          <a key={i} href={n.href} target="_blank" rel="noreferrer noopener" className="rounded-xs font-semibold text-primary-link underline hover:text-primary-hover">
            {inline(n.children)}
          </a>
        );
    }
  });
}
