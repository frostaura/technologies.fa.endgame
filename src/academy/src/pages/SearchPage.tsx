import { searchFlows } from "../lib/data.ts";
import { href } from "../lib/router.ts";
import { LevelBadge, ProgressWord, ReachChip } from "../components/Chips.tsx";
import { highlight } from "../components/highlight.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { stateOf, useProgress } from "../lib/progress.ts";
import { Search } from "../components/Search.tsx";
import { Inline } from "../components/Inline.tsx";
import { snippet } from "../lib/snippet.ts";
import { Page } from "../components/Shell.tsx";

export function SearchPage({ q, operator }: { q: string; operator: boolean }) {
  const hits = q ? searchFlows(q, operator ? "operator" : "client", 60) : [];
  const progress = useProgress();
  return (
    <Page>
      <PageHeader eyebrow={operator ? "Search the operator handbook" : "Search"} title={q ? <>Results for “{q}”</> : "Search the academy"} lede="Type a flow id, a word from a screen, or a message you saw. Every result is a flow that explains it." />
      <div className="mt-6 max-w-read"><Search scope={operator ? "operator" : "client"} wide autoFocus={!q} /></div>
      {q && (
        <p className="mt-8 text-sm text-ink-muted" role="status">{hits.length ? `${hits.length} flow${hits.length === 1 ? "" : "s"}` : `No flow mentions “${q}”.`}</p>
      )}
      <ol className="mt-4 divide-y overflow-hidden rounded-lg border bg-surface shadow-card empty:hidden">
        {hits.map((h) => (
          <li key={h.flow.id}>
            <a href={href(`/flow/${h.flow.id}`)} className="group flex flex-col gap-1 px-4 py-4 hover:bg-ground sm:flex-row sm:gap-4 sm:px-6">
              <span className="whitespace-nowrap font-mono text-xs font-semibold leading-6 text-primary-link sm:w-16 sm:shrink-0">{h.flow.id}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium leading-6 text-ink group-hover:text-primary-link">{highlight(h.flow.title, h.terms)}</span>
                <span className="mt-1 block text-sm text-ink-muted"><Inline text={snippet(h.flow, h.terms)} plainIds mark={h.terms} /></span>
                <span className="mt-2 flex flex-wrap items-center gap-2"><LevelBadge level={h.flow.level} />{h.flow.reach !== "screen" && <ReachChip reach={h.flow.reach} />}<ProgressWord state={stateOf(progress, h.flow.id)} /></span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </Page>
  );
}
