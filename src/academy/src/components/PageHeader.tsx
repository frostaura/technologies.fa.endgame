import type { ReactNode } from "react";
import { href } from "../lib/router.ts";

/** One step of a trail: a place above this page (linked), or this page itself (the last, unlinked). */
export interface Crumb {
  label: string;
  to?: string;
}

/** Where this page sits: `Browse › By area`, the places above linked, one separator, the current place in ink. */
export function Crumbs({ items, className = "" }: { items: Crumb[]; className?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="text-ink-muted">›</span>}
            {c.to && i < items.length - 1 ? (
              <a href={href(c.to)} className="-mx-1 inline-flex min-h-touch items-center rounded-full px-1 font-medium text-ink-muted hover:text-primary-link sm:min-h-0">{c.label}</a>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined} className="font-medium text-ink">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A small neutral tag beside a title: "FrostAura only". Never a second accent. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-border-strong bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink-body">{children}</span>;
}

/**
 * The one header of every list and reference page — a path, an area, who you are, how a flow is
 * reached, Browse, the operator handbook, search, progress, About, Share and Not found: the trail
 * (or an eyebrow), the title at one size, the lede at one size, and whatever the page adds under it.
 */
export function PageHeader({ crumbs, eyebrow, tag, title, lede, meta, children, className = "" }: { crumbs?: Crumb[]; eyebrow?: string; tag?: string; title: ReactNode; lede?: ReactNode; meta?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      {crumbs?.length ? <Crumbs items={crumbs} /> : eyebrow ? <p className="text-eyebrow font-semibold uppercase text-ink-muted">{eyebrow}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 text-balance font-display text-title-sm font-bold text-ink sm:text-title">{title}</h1>
        {tag && <Tag>{tag}</Tag>}
      </div>
      {lede && <p className="mt-4 max-w-read text-pretty text-lead-sm text-ink-body sm:text-lead">{lede}</p>}
      {meta && <p className="mt-3 text-sm font-medium tabular-nums text-ink-muted">{meta}</p>}
      {children}
    </div>
  );
}
