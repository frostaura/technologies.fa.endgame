import { useState } from "react";
import { REACHES, type Reach } from "../content/types.ts";
import { flow, operatorFlows, track } from "../lib/data.ts";
import { LEVEL_BLURB, REACH_LABEL } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { catalogue, useProgress } from "../lib/progress.ts";
import { nextUp } from "../progress/derive.ts";
import { FlowList } from "../components/FlowList.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ProgressRing } from "../components/ProgressMarks.tsx";
import { Page } from "../components/Shell.tsx";
import { ui } from "../components/ui.ts";

/**
 * FrostAura's own handbook: God mode and running the platform, kept apart from client navigation.
 * The same light page as the academy; the tag and the header's name say whose it is. The list can be
 * narrowed in place to the flows reached one way.
 */
export function OperatorHome() {
  const ids = track("Operator")?.flows ?? [];
  const flows = ids.flatMap((id) => flow(id) ?? []);
  const reaches = REACHES.filter((r) => operatorFlows.some((f) => f.reach === r));
  const progress = useProgress();
  const next = nextUp(progress, track("Operator"), catalogue);
  const done = flows.filter((f) => progress.flows[f.id]?.done).length;
  const [only, setOnly] = useState<Reach | null>(null);
  const shown = only ? flows.filter((f) => f.reach === only) : flows;
  const choices: [Reach | null, string, number][] = [[null, "All", flows.length], ...reaches.map((r): [Reach, string, number] => [r, REACH_LABEL[r], flows.filter((f) => f.reach === r).length])];
  return (
    <Page>
      <PageHeader
        tag="FrostAura only"
        title="The operator handbook"
        lede={`${LEVEL_BLURB.Operator} Every God-mode entry into an organisation is logged, and that organisation's Owner can read the log.`}
      >
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="flex items-center gap-4" data-testid="operator-progress">
            <ProgressRing done={done} total={flows.length} label={`Operator handbook: ${done} of ${flows.length} flows done`} />
            <div>
              <p className="font-display text-2xl font-semibold tabular-nums text-ink">{done} of {flows.length}</p>
              <p className="text-sm text-ink-muted">flows done, counted apart from the client paths</p>
            </div>
          </div>
          {next && <a href={href(`/flow/${next.flow.id}`)} className={`${ui.primary} px-6`}>{done ? "Continue" : "Begin"} with {next.flow.id}</a>}
        </div>
      </PageHeader>

      <div className="mt-12 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="font-display text-2xl font-semibold text-ink">In order</h2>
        {/* Real filters: they narrow the list below, in place, and say which one is on. */}
        <div role="group" aria-label="Show only the flows reached by" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="inline-flex gap-1 rounded-full border bg-ground p-1">
            {choices.map(([r, label, n]) => (
              <button
                key={label}
                type="button"
                aria-pressed={only === r}
                onClick={() => setOnly(r)}
                className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors touch:min-h-11 ${only === r ? "bg-surface text-ink shadow-toggle" : "text-ink-body hover:text-ink"}`}
              >
                {label} <span className="tabular-nums text-ink-muted">{n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="sr-only" role="status">{only ? `${shown.length} flows reached by ${REACH_LABEL[only]}` : ""}</p>
      <div className="mt-4"><FlowList flows={shown} numbered={!only} next={next?.flow.id} hideReach={!!only} /></div>
    </Page>
  );
}
