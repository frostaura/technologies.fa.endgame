import { Fragment, type ReactNode } from "react";
import { flow } from "../lib/data.ts";
import { href } from "../lib/router.ts";
import { curly } from "../content/text.ts";
import { placeholderWords } from "../content/placeholders.ts";
import { INLINE_STYLE as STYLE, type Tone } from "./inlineStyle.ts";

/**
 * Renders the inline markdown the flow documents use — **bold**, `code`, *emphasis*, links — turns
 * every flow id it meets (ID-07, OPS-12) into a link to that flow, and sets each `{placeholder}`
 * outside code as a small token of what it stands for. `tone="dark"` is for text on a dark panel:
 * every inline style keeps its contrast there.
 */

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|(?<![*\w])\*[^*\s][^*]*\*(?!\*)|\b[A-Z]{2,5}-\d{2}\b|\{[A-Za-z][A-Za-z0-9 ._-]*\}|<[A-Za-z][A-Za-z ._-]{0,15}>)/g;



function link(target: string): string | null {
  const area = /(0\d)-[a-z-]+\.md/.exec(target);
  if (area) return href(`/area/${area[1]}`);
  if (/README\.md/.test(target)) return href("/about");
  return null;
}

export function Inline({ text: raw, self, plainIds = false, tone = "light" }: { text: string; self?: string; plainIds?: boolean; tone?: Tone }) {
  const style = STYLE[tone];
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
    if (t.startsWith("**")) out.push(<strong key={k++} className={style.strong}><Inline text={t.slice(2, -2)} self={self} plainIds={plainIds} tone={tone} /></strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className={style.code}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      const to = lm ? link(lm[2] ?? "") : null;
      out.push(to ? <a key={k++} href={to} className={style.link}>{lm?.[1]}</a> : <Fragment key={k++}>{lm?.[1] ?? t}</Fragment>);
    } else if (t.startsWith("*")) out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else if (t.startsWith("{") || t.startsWith("<")) {
      out.push(
        <var key={k++} className={style.variable} title={`Stands for the ${placeholderWords(t)}, which the console fills in`} data-placeholder={t}>
          {placeholderWords(t)}
        </var>,
      );
    }
    else {
      const f = flow(t);
      out.push(f && t !== self && !plainIds ? (
        <a key={k++} href={href(`/flow/${f.id}`)} title={f.title} className={style.id}>{t}</a>
      ) : (
        <Fragment key={k++}>{t}</Fragment>
      ));
    }
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
