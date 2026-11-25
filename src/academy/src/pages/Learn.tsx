import type { Level } from "../content/types.ts";
import { flow, track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { useProgress } from "../lib/progress.ts";
import { FlowList } from "../components/FlowList.tsx";
import { Eyebrow, Page } from "../components/Shell.tsx";
import { PathCards, Resume } from "./Cover.tsx";

export function Learn() {
  return (
    <>
      <Resume />
      <Page>
        <Eyebrow>Learn</Eyebrow>
        <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">Choose a path</h1>
        <p className="mt-4 max-w-read text-lead text-ink-body">Foundation is day one. Core is running an organisation. Advanced is owning the setup. Developer is the API, assistants and the app kit.</p>
        <PathCards />
      </Page>
    </>
  );
}

export function PathPage({ level, operator = false }: { level: Level; operator?: boolean }) {
  const t = track(level);
  const progress = useProgress();
  const flows = (t?.flows ?? []).flatMap((id) => flow(id) ?? []);
  const next = flows.find((f) => progress.flows[f.id] !== "done");
  const done = flows.filter((f) => progress.flows[f.id] === "done").length;
  return (
    <Page>
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="lg:sticky lg:top-header lg:self-start">
          <Eyebrow>{operator ? "Operator handbook" : "Path"}</Eyebrow>
          <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">{t?.title ?? level}</h1>
          <p className="mt-4 text-lead text-ink-body">{LEVEL_BLURB[level]}</p>
          <p className="mt-6 font-mono text-xs text-ink-muted">{done} of {flows.length} done</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-quiet" aria-hidden="true">
            <div className="h-full rounded-full bg-success" style={{ width: `${flows.length ? (100 * done) / flows.length : 0}%` }} />
          </div>
          {next ? (
            <a href={href(`/flow/${next.id}`)} className="mt-8 inline-flex min-h-touch items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-ink shadow-press hover:bg-primary-hover">
              {done ? "Continue" : "Begin"} with {next.id}
            </a>
          ) : (
            flows.length > 0 && (
              <a href={href("/finish")} className="mt-8 inline-flex min-h-touch items-center rounded-full bg-success px-6 text-sm font-semibold text-primary-ink">
                Path complete: share the academy
              </a>
            )
          )}
          {t?.summary && <p className="mt-8 text-sm text-ink-muted">{t.summary}</p>}
        </div>
        <div className="lg:col-span-2">
          <FlowList flows={flows} numbered />
        </div>
      </div>
    </Page>
  );
}
