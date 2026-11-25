import type { Flow } from "../content/types.ts";
import { ROLE_LABEL } from "../lib/labels.ts";
import { Blocks } from "../components/Blocks.tsx";
import { Inline } from "../components/Inline.tsx";
import { ReachChip } from "../components/Chips.tsx";

/** What the flow document says about where this flow lives and how it is proved: shown where there is nothing to play. */
export function Facts({ flow }: { flow: Flow }) {
  // Who, where it starts and what it needs are already in the page's header.
  const rows: [string, string][] = [
    ["You know it worked when", flow.workedWhen],
    ["Where in the code", flow.where],
  ];
  return (
    <aside className="flex h-full flex-col gap-5 overflow-auto rounded-lg border bg-ground p-6" aria-label="About this flow" data-testid="facts">
      <div className="flex items-center gap-3">
        <ReachChip reach={flow.reach} />
        {flow.roles.length > 0 && <span className="text-xs text-ink-muted">{flow.roles.map((r) => ROLE_LABEL[r]).join(" · ")}</span>}
      </div>
      <dl className="space-y-4">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <dt className="text-eyebrow font-semibold uppercase text-ink-muted">{k}</dt>
            <dd className="mt-1 text-sm text-ink-body"><Inline text={v} self={flow.id} /></dd>
          </div>
        ))}
        {flow.reachText && (
          <div>
            <dt className="text-eyebrow font-semibold uppercase text-ink-muted">Reachable from</dt>
            <dd className="mt-1 text-sm text-ink-body"><Inline text={flow.reachText} self={flow.id} /></dd>
          </div>
        )}
        {flow.tests.length > 0 && (
          <div>
            <dt className="text-eyebrow font-semibold uppercase text-ink-muted">Proved by</dt>
            <dd className="text-sm"><Blocks blocks={flow.tests} self={flow.id} tone="muted" /></dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
