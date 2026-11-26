import { searchFlows } from "../lib/data.ts";
import { href } from "../lib/router.ts";
import { LevelBadge, ProgressDot, ReachChip } from "../components/Chips.tsx";
import { stateOf, useProgress } from "../lib/progress.ts";
import { Search } from "../components/Search.tsx";
import { snippet } from "../lib/snippet.ts";
import { Eyebrow, Page } from "../components/Shell.tsx";

export function SearchPage({ q, operator }: { q: string; operator: boolean }) {
  const hits = q ? searchFlows(q, operator ? "operator" : "client", 60) : [];
  const progress = useProgress();
  return (
    <Page className="max-w-prose">
      <Eyebrow>{operator ? "Search the operator handbook" : "Search"}</Eyebrow>
      <h1 className="mt-3 font-display text-title-sm font-bold text-ink">{q ? <>Results for “{q}”</> : "Search the academy"}</h1>
      <p className="mt-3 text-ink-muted">Type a flow id, a word from a screen, or a message you saw. Every result is a flow that explains it.</p>
      <div className="mt-6"><Search scope={operator ? "operator" : "client"} wide autoFocus={!q} /></div>
      {q && (
        <p className="mt-8 text-sm text-ink-muted" role="status">{hits.length ? `${hits.length} flow${hits.length === 1 ? "" : "s"}` : `No flow mentions “${q}”.`}</p>
      )}
      <ol className="mt-4 divide-y rounded-lg border bg-surface empty:hidden">
        {hits.map((h) => (
          <li key={h.flow.id}>
            <a href={href(`/flow/${h.flow.id}`)} className="group block px-4 py-4 hover:bg-ground sm:px-5">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <ProgressDot state={stateOf(progress, h.flow.id)} />
                <span className="font-mono text-xs font-semibold text-primary-link">{h.flow.id}</span>
                <span className="font-medium text-ink group-hover:text-primary-link">{h.flow.title}</span>
                <LevelBadge level={h.flow.level} />
                <ReachChip reach={h.flow.reach} />
              </span>
              <span className="mt-1 block text-sm text-ink-muted">{snippet(h.flow, h.terms)}</span>
            </a>
          </li>
        ))}
      </ol>
    </Page>
  );
}
