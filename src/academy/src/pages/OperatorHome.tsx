import { operatorFlows, track } from "../lib/data.ts";
import { href } from "../lib/router.ts";
import { FlowList } from "../components/FlowList.tsx";
import { Eyebrow, Page } from "../components/Shell.tsx";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { flow } from "../lib/data.ts";
import { catalogue, useProgress } from "../lib/progress.ts";
import { nextUp } from "../progress/derive.ts";
import { REACHES } from "../content/types.ts";
import { REACH_LABEL } from "../lib/labels.ts";
import { ProgressRing } from "../components/ProgressMarks.tsx";
import { ui } from "../components/ui.ts";

/** FrostAura's own handbook: God mode and running the platform. Kept apart from client navigation. */
export function OperatorHome() {
  const ids = track("Operator")?.flows ?? [];
  const flows = ids.flatMap((id) => flow(id) ?? []);
  const reaches = REACHES.filter((r) => operatorFlows.some((f) => f.reach === r));
  const progress = useProgress();
  const next = nextUp(progress, track("Operator"), catalogue);
  const done = flows.filter((f) => progress.flows[f.id]?.done).length;
  return (
    <Page>
      <div className="grid gap-8 rounded-lg bg-night p-8 text-primary-ink sm:p-10 lg:grid-cols-3 lg:items-center">
        <div className="lg:col-span-2">
          <p className="text-eyebrow font-semibold uppercase text-live">FrostAura only</p>
          <h1 className="mt-3 font-display text-title-sm font-bold sm:text-title">The operator handbook</h1>
          <p className="mt-4 max-w-read text-lead-sm text-primary-ink-soft sm:text-lead">{LEVEL_BLURB.Operator} Every God-mode entry into an organisation is logged, and that organisation's Owner can read the log.</p>
          {next && <a href={href(`/flow/${next.flow.id}`)} className={`${ui.light} mt-8 px-6`}>{done ? "Continue" : "Begin"} with {next.flow.id}</a>}
        </div>
        <div className="flex items-center gap-5 lg:justify-self-end" data-testid="operator-progress">
          <ProgressRing done={done} total={flows.length} size="lg" tone="dark" label={`Operator handbook: ${done} of ${flows.length} flows done`} />
          <div>
            <p className="font-display text-3xl font-bold tabular-nums">{done} of {flows.length}</p>
            <p className="text-sm text-primary-ink-soft">flows done, counted apart from the client paths</p>
          </div>
        </div>
      </div>
      <div className="mt-10 flex flex-wrap items-baseline justify-between gap-4">
        <Eyebrow>In order</Eyebrow>
        <nav aria-label="Reached by" className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span>Only those reached by</span>
          {reaches.map((r) => (
            <a key={r} href={href(`/operator/reach/${r}`)} className={`${ui.chip} hover:border-primary-line hover:text-ink`}>{REACH_LABEL[r]}</a>
          ))}
        </nav>
      </div>
      <div className="mt-4"><FlowList flows={flows} numbered next={next?.flow.id} /></div>
    </Page>
  );
}
