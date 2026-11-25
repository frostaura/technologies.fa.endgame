import { Fragment, type ReactNode } from "react";
import { flow } from "../lib/data.ts";
import { href } from "../lib/router.ts";
import { curly } from "../content/text.ts";

/**
 * Renders the inline markdown the flow documents use — **bold**, `code`, *emphasis*, links — and
 * turns every flow id it meets (ID-07, OPS-12) into a link to that flow.
 */

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|(?<![*\w])\*[^*\s][^*]*\*(?!\*)|\b[A-Z]{2,5}-\d{2}\b)/g;

function link(target: string): string | null {
  const area = /(0\d)-[a-z-]+\.md/.exec(target);
  if (area) return href(`/area/${area[1]}`);
  if (/README\.md/.test(target)) return href("/about");
  return null;
}

export function Inline({ text: raw, self, plainIds = false }: { text: string; self?: string; plainIds?: boolean }) {
  const text = raw
    .split(/(`[^`]+`)/)
    .map((part) => (part.startsWith("`") ? part : curly(part)))
    .join("");
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-ink"><Inline text={t.slice(2, -2)} self={self} plainIds={plainIds} /></strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="rounded-xxs bg-quiet px-1 py-px font-mono text-xs text-ink">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      const to = lm ? link(lm[2] ?? "") : null;
      out.push(to ? <a key={k++} href={to} className="font-medium text-primary-link underline decoration-primary-line underline-offset-2 hover:decoration-primary">{lm?.[1]}</a> : <Fragment key={k++}>{lm?.[1] ?? t}</Fragment>);
    } else if (t.startsWith("*")) out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else {
      const f = flow(t);
      out.push(f && t !== self && !plainIds ? (
        <a key={k++} href={href(`/flow/${f.id}`)} title={f.title} className="font-mono text-xs font-semibold text-primary-link underline decoration-primary-line underline-offset-2 hover:decoration-primary">{t}</a>
      ) : (
        <Fragment key={k++}>{t}</Fragment>
      ));
    }
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
