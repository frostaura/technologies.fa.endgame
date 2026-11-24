import { useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Bar, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatCredits, formatDate, formatNumber, percent } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { navigate, paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { api, useDecideIdeaMutation, useGetIdeaQuery, useGetMeQuery, useGetTreeQuery } from "@/store/api";
import type { DecisionChoice, Idea, Verdict, VerdictOutcome } from "@/store/types";
import { AppShell, type Crumb } from "../shell/AppShell";
import { namesFor } from "../home/treeModel";
import { decisionOptions } from "./verdictModel";

const OUTCOME: Record<VerdictOutcome, string> = { build: "Build", change: "Change", "do-not-build": "Do not build" };

/** While research is still running the verdict page waits on it, so it is polled. */
const RESEARCH_POLL_MS = 5_000;

export function VerdictView({ ideaId }: { ideaId: string }) {
  // Poll only while research is still running; the cached answer says whether it is.
  const cached = api.endpoints.getIdea.useQueryState(ideaId);
  const researching = !cached.data || cached.data.status === "researching";
  const query = useGetIdeaQuery(ideaId, { pollingInterval: researching ? RESEARCH_POLL_MS : 0 });
  const view = viewOf(query);
  const tree = useGetTreeQuery(undefined);
  const me = useGetMeQuery(undefined);
  const idea = view.kind === "loaded" ? view.data : null;

  const crumbs: Crumb[] = [];
  const org = me.data?.organisation;
  if (org) crumbs.push({ label: org.name, href: paths.home() });
  if (idea?.scope) for (const name of namesFor(tree.data, idea.scope).slice(1)) crumbs.push({ label: name });
  crumbs.push({ label: idea?.title ?? "Idea" });

  return (
    <AppShell crumbs={crumbs} aside={idea ? <RecordAside idea={idea} /> : undefined}>
      {view.kind === "loading" && (
        <Loading label="Loading the verdict" className="flex flex-col gap-6">
          <Skeleton className="h-48 rounded-lg" />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Skeleton className="h-48 rounded-md" />
            <Skeleton className="h-48 rounded-md" />
            <Skeleton className="h-48 rounded-md" />
          </div>
        </Loading>
      )}
      {view.kind === "failed" && <Failed title={view.status === 404 ? "This idea could not be found" : "The verdict could not be loaded"} reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <p className="text-ink-muted">
            Research{view.data.research.by ? ` by ${view.data.research.by}` : ""} · {formatNumber(view.data.research.spentCredits)} credits, estimated {formatNumber(view.data.research.estimatedCredits)}
          </p>
          {view.data.verdict ? <VerdictBody idea={view.data} verdict={view.data.verdict} /> : <NoVerdictYet idea={view.data} />}
        </>
      )}
    </AppShell>
  );
}

function NoVerdictYet({ idea }: { idea: Idea }) {
  const failed = idea.status === "failed";
  return (
    <section className={cn("flex flex-col items-start gap-4 rounded-lg px-6 py-8 sm:px-8", failed ? "border border-attention-line bg-attention-tint" : "bg-night text-primary-ink", RISE)} role={failed ? "alert" : "status"}>
      <Badge tone={failed ? "attention-strong" : "teal"}>{failed ? "Research did not finish" : "Research in progress"}</Badge>
      <h1 className="text-3xl font-semibold sm:text-4xl">{failed ? "No verdict could be reached." : "The verdict is being worked out."}</h1>
      <p className={failed ? "text-ink" : "text-primary-tint"}>
        {failed ? "Research stopped before it reached a verdict. The trace shows where." : "The case against the idea is argued first. You can watch every step as it happens."}
      </p>
      <Link href={paths.run(idea.runId)} className={buttonVariants({ variant: failed ? "primary" : "white" })}>
        {failed ? "See what happened" : "Watch the research"}
      </Link>
    </section>
  );
}

function VerdictBody({ idea, verdict }: { idea: Idea; verdict: Verdict }) {
  const stamp = verdict.outcome === "build" ? "bg-success-tint text-success-text" : verdict.outcome === "change" ? "bg-primary-tint text-primary-hover" : "bg-attention-chip text-attention-text";
  return (
    <>
      <section className={cn("relative flex flex-col gap-3.5 overflow-hidden rounded-lg bg-night px-6 py-7 text-primary-ink sm:px-8", RISE)}>
        <div aria-hidden className="absolute -right-10 -top-32 size-aura animate-drift rounded-full bg-attention opacity-60 blur-aura motion-reduce:animate-none" />
        <div aria-hidden className="absolute -bottom-44 right-56 size-aura animate-drift rounded-full bg-violet opacity-60 blur-aura animate-delay-5 motion-reduce:animate-none" />
        <span className={cn("relative self-start rounded-full px-3.5 py-1.5 text-sm font-bold uppercase tracking-wide", stamp, "animate-stamp motion-reduce:animate-none")}>
          Verdict · {OUTCOME[verdict.outcome].toLowerCase()}
        </span>
        <h1 className="relative text-3xl font-semibold leading-tight sm:text-4xl">{verdict.headline}</h1>
        <p className="relative max-w-prose text-base text-primary-tint">{verdict.summary}</p>
      </section>

      <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-3">
        <Evidence title="Who already does this" index={1}>
          {verdict.existing.length === 0 ? (
            <p className="text-ink-body">Nothing already sold was found that does this.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {verdict.existing.map((e) => (
                <li key={e.name} className="flex flex-col gap-0.5">
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer noopener" className="rounded-xs font-semibold text-primary-link hover:text-primary-hover">
                      {e.name}
                    </a>
                  ) : (
                    <span className="font-semibold">{e.name}</span>
                  )}
                  <span className="text-ink-body">{e.description}</span>
                </li>
              ))}
            </ul>
          )}
        </Evidence>
        <Evidence title="What gap is left" index={2}>
          {verdict.gap.map((g, i) => (
            <p key={i} className="text-ink-body">
              {g}
            </p>
          ))}
        </Evidence>
        <Evidence title="Who would want it" index={3}>
          {verdict.demand.paragraphs.map((d, i) => (
            <p key={i} className="text-ink-body">
              {d}
            </p>
          ))}
          {!verdict.demand.evidenceFound && <p className="rounded-sm bg-attention-tint px-3 py-2.5 font-medium text-attention-strong">No evidence of demand was found. That counts against building.</p>}
        </Evidence>
      </div>

      {verdict.wouldChange && (
        <section className="flex flex-col gap-2.5 rounded-md border border-primary bg-primary-tint px-6 py-5">
          <h2 className="text-lg font-semibold">What would change the verdict</h2>
          <p className="text-ink-body">{verdict.wouldChange.text}</p>
          {verdict.wouldChange.estimateCredits !== null && <p className="font-medium">Estimated {formatCredits(verdict.wouldChange.estimateCredits)}</p>}
        </section>
      )}

      <Decisions idea={idea} verdict={verdict} />
    </>
  );
}

function Evidence({ title, index, children }: { title: string; index: number; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card", RISE, stagger(index))}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Decisions({ idea, verdict }: { idea: Idea; verdict: Verdict }) {
  const [decide, state] = useDecideIdeaMutation();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DecisionChoice | null>(null);

  if (idea.decision) {
    const d = idea.decision;
    const words: Record<DecisionChoice, string> = { build: "You chose to build it", change: "You chose to change it as suggested", overrule: "You overruled the verdict and chose to build it", drop: "You dropped the idea" };
    return (
      <section role="status" data-decision={d.choice} className={cn("flex flex-col gap-2 rounded-md border px-6 py-5", d.overruled ? "border-attention-line bg-attention-tint" : "bg-surface")}>
        <p className="text-base font-semibold">
          {words[d.choice]} on {formatDate(d.at)}.
        </p>
        {d.overruled && <p className="text-attention-deep">The project carries a note that research advised against it.</p>}
        {d.runId && (
          <Link href={paths.run(d.runId)} className="self-start rounded-xs font-semibold text-primary-link hover:text-primary-hover">
            Watch the work that followed
          </Link>
        )}
      </section>
    );
  }

  const submit = async (choice: DecisionChoice) => {
    setError(null);
    setConfirming(null);
    try {
      const result = await decide({ id: idea.id, choice }).unwrap();
      if (result.decision?.runId) navigate(paths.run(result.decision.runId));
    } catch (e) {
      setError(describeError(e as never));
    }
  };

  const options = decisionOptions(verdict);
  return (
    <section aria-label="Your decision" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {options.map((o) =>
          confirming === o.choice ? (
            <span key={o.choice} role="group" aria-label="Confirm" className="flex flex-wrap items-center gap-2 rounded-sm bg-attention-tint px-3 py-1.5">
              <span className="text-sm text-attention-text">{o.choice === "drop" ? "Drop this idea?" : "Build it against the verdict?"}</span>
              <Button size="sm" variant="outline" onClick={() => void submit(o.choice)}>
                Yes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                No
              </Button>
            </span>
          ) : (
            <Button
              key={o.choice}
              size="lg"
              variant={o.variant}
              disabled={state.isLoading}
              onClick={() => (o.choice === "overrule" || o.choice === "drop" ? setConfirming(o.choice) : void submit(o.choice))}
            >
              {o.label}
            </Button>
          ),
        )}
      </div>
      {verdict.outcome !== "build" && <p className="text-ink-muted">Overruling is your call. The project will carry a note that research advised against it.</p>}
      {error && (
        <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
          Your decision was not recorded: {error}
        </p>
      )}
    </section>
  );
}

function RecordAside({ idea }: { idea: Idea }) {
  const r = idea.record;
  const rows: { label: string; n: number; tone: "soft" | "primary" | "ink" }[] = [
    { label: "Build", n: r.build, tone: "soft" },
    { label: "Change", n: r.change, tone: "primary" },
    { label: "Do not build", n: r.doNotBuild, tone: "ink" },
  ];
  return (
    <>
      <section className={cn("flex flex-col gap-3.5", RISE)}>
        <h2 className="text-lg font-semibold">How often research says no</h2>
        <p className="text-ink-body">Research that never refuses is worthless, so Endgame shows you its record.</p>
        {r.total === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            This is the first verdict for your organisation.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col gap-1">
                <div className="flex justify-between">
                  <span>{row.label}</span>
                  <span className="font-semibold">
                    {formatNumber(row.n)} of {formatNumber(r.total)}
                  </span>
                </div>
                <Bar value={percent(row.n, r.total)} label={`${row.label}: ${row.n} of ${r.total}`} tone={row.tone} />
              </div>
            ))}
            {r.doNotBuild === 0 && r.total >= 5 && <p className="text-sm text-attention-text">Research has not said no once in {formatNumber(r.total)} verdicts. Treat that as a fault.</p>}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-2.5">
        <h2 className="text-lg font-semibold">When you overruled</h2>
        {r.overruled.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            You have not overruled research yet.
          </p>
        ) : (
          r.overruled.map((o) => (
            <Link key={o.ideaId} href={paths.idea(o.ideaId)} className="flex flex-col gap-1 rounded-xs border border-border-strong bg-surface px-4 py-3.5 text-ink hover:bg-ground">
              <span className="font-semibold">{o.title}</span>
              <span className="text-ink-body">
                Research said {OUTCOME[o.verdict].toLowerCase()}. {o.outcome}
              </span>
            </Link>
          ))
        )}
      </section>
      {idea.verdict?.method && (
        <section className="flex flex-col gap-2.5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="research" tinted />
            How this was researched
          </h2>
          <p className="text-ink-body">{idea.verdict.method}</p>
          <Link href={paths.run(idea.runId)} className="flex min-h-touch items-center self-start rounded-xs text-primary-link hover:text-primary-hover">
            See every step
          </Link>
        </section>
      )}
    </>
  );
}
