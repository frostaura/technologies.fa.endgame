import type { Level } from "../content/types.ts";
import { flow, track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { catalogue, useProgress } from "../lib/progress.ts";
import { nextUp, trackStats } from "../progress/derive.ts";
import { FlowList } from "../components/FlowList.tsx";
import { Medal, ProgressRing } from "../components/ProgressMarks.tsx";
import { ResumeCard } from "../components/ResumeCard.tsx";
import { Eyebrow, Page } from "../components/Shell.tsx";
import { ui } from "../components/ui.ts";
import { shortDate } from "../lib/format.ts";
import { PathCards } from "./Cover.tsx";

export function Learn() {
  return (
    <Page>
      <Eyebrow>Learn</Eyebrow>
      <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">Choose a path</h1>
      <p className="mt-4 max-w-read text-lead-sm text-ink-body sm:text-lead">Foundation is day one. Core is running an organisation. Advanced is owning the setup. Developer is the API, assistants and the app kit.</p>
      <ResumeCard className="mt-8 max-w-read" />
      <PathCards />
    </Page>
  );
}

export function PathPage({ level, operator = false }: { level: Level; operator?: boolean }) {
  const t = track(level);
  const progress = useProgress();
  const flows = (t?.flows ?? []).flatMap((id) => flow(id) ?? []);
  const s = t ? trackStats(progress, t) : undefined;
  const next = nextUp(progress, t, catalogue);
  return (
    <Page>
      <div className="grid gap-8 lg:grid-cols-3 lg:gap-10">
        <div className="lg:sticky lg:top-header lg:self-start">
          <Eyebrow>{operator ? "Operator handbook" : "Path"}</Eyebrow>
          <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">{t?.title ?? level}</h1>
          <p className="mt-4 text-lead-sm text-ink-body sm:text-lead">{LEVEL_BLURB[level]}</p>
          {s && (
            <div className="mt-6 flex items-center gap-4" data-testid="path-progress">
              <ProgressRing done={s.done} total={s.total} size="lg" label={`${s.done} of ${s.total} flows done`} />
              <div className="min-w-0">
                <p className="font-display text-2xl font-semibold text-ink">{s.done} of {s.total}</p>
                <p className="text-sm text-ink-muted">{s.complete ? "flows done: path complete" : `flows done${s.started ? ` · ${s.started} started` : ""}`}</p>
              </div>
              {s.complete && <Medal earned mark={level.slice(0, 1)} label={`${level} badge, earned ${s.completedAt ? shortDate(s.completedAt) : ""}`.trim()} />}
            </div>
          )}
          {next ? (
            <div className="mt-6">
              <a href={href(`/flow/${next.flow.id}`)} className={`${ui.primary} px-6`}>
                {s?.done ? "Continue" : "Begin"} with {next.flow.id}
              </a>
              <p className="mt-2 text-sm text-ink-muted">
                Next up: {next.flow.title}
                {next.before ? <> — learn it first, for {next.before.id}</> : null}
              </p>
            </div>
          ) : (
            flows.length > 0 && (
              <a href={href("/progress")} className={`${ui.success} mt-6 px-6`}>
                Path complete: see your progress
              </a>
            )
          )}
          {t?.summary && <p className="mt-8 text-sm text-ink-muted">{t.summary}</p>}
        </div>
        <div className="min-w-0 lg:col-span-2">
          <FlowList flows={flows} numbered next={next?.flow.id} />
        </div>
      </div>
    </Page>
  );
}
