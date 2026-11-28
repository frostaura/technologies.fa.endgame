import type { Level } from "../content/types.ts";
import { flow, track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { catalogue, useProgress } from "../lib/progress.ts";
import { nextUp, trackStats } from "../progress/derive.ts";
import { FlowList } from "../components/FlowList.tsx";
import { ListLayout } from "../components/ListLayout.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { Medal, ProgressRing } from "../components/ProgressMarks.tsx";
import { ResumeCard } from "../components/ResumeCard.tsx";
import { Page } from "../components/Shell.tsx";
import { ui } from "../components/ui.ts";
import { shortDate } from "../lib/format.ts";
import { PathCards } from "./Cover.tsx";

export function Learn() {
  return (
    <Page>
      <PageHeader
        eyebrow="Learn"
        title="Choose a path"
        lede="Foundation is day one. Core is running an organisation. Advanced is owning the setup. Developer is the API, assistants and the app kit."
      />
      <ResumeCard className="mt-8" />
      <PathCards />
      <p className="mt-4 max-w-read text-sm text-ink-muted">Not sure where you fit? <a className={ui.textLink} href={href("/browse")}>Browse every flow</a> by area, by who you are or by how it is reached.</p>
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
    <ListLayout
      crumbs={operator ? [{ label: "Operator handbook", to: "/operator" }, { label: t?.title ?? level }] : [{ label: "Learn", to: "/learn" }, { label: `${t?.title ?? level} path` }]}
      title={t?.title ?? level}
      lede={LEVEL_BLURB[level]}
      aside={
        <>
          {s && (
            <div className="mt-6 flex items-center gap-4" data-testid="path-progress">
              <ProgressRing done={s.done} total={s.total} label={`${s.done} of ${s.total} flows done`} />
              <div className="min-w-0">
                <p className="font-display text-2xl font-semibold tabular-nums text-ink">{s.done} of {s.total}</p>
                <p className="text-sm text-ink-muted">{s.complete ? "flows done: path complete" : `flows done${s.started ? ` · ${s.started} started` : ""}`}</p>
              </div>
              {s.complete && <Medal earned mark={level.slice(0, 1)} label={`${level} badge, earned ${s.completedAt ? shortDate(s.completedAt) : ""}`.trim()} />}
            </div>
          )}
          {next ? (
            <div className="mt-6">
              <a href={href(`/flow/${next.flow.id}`)} className={`${ui.primary} whitespace-nowrap px-6`}>
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
        </>
      }
    >
      <FlowList flows={flows} numbered next={next?.flow.id} first={next && !flows.some((f) => f.id === next.flow.id) ? next.flow : undefined} />
    </ListLayout>
  );
}
