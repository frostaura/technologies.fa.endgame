import { useState, type FormEvent, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Bar, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatCredits, formatDate, formatNumber, percent, plural } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { navigate, paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { api, useDecideIdeaMutation, useGetIdeaQuery, useGetMeQuery, useGetTreeQuery } from "@/store/api";
import type { DecisionChoice, ExistingProduct, Idea, Verdict, VerdictOutcome } from "@/store/types";
import { AppShell, type Crumb } from "../shell/AppShell";
import { namesFor } from "../home/treeModel";
import { decisionOptions, plainProductName, redLineBreached, sourceLabel } from "./verdictModel";

const OUTCOME: Record<VerdictOutcome, string> = { build: "Build", change: "Change", "do-not-build": "Do not build" };

/** While research is still running the verdict page waits on it, so it is polled. */
const RESEARCH_POLL_MS = 5_000;

/** How many existing products show before "show all". Research can name dozens. */
const PRODUCTS_SHOWN = 6;

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
    <AppShell
      crumbs={crumbs}
      aside={
        idea ? (
          <ErrorBoundary name="The research record">
            <RecordAside idea={idea} />
          </ErrorBoundary>
        ) : undefined
      }
    >
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
          {view.data.verdict ? (
            <ErrorBoundary name="The verdict">
              <VerdictBody idea={view.data} verdict={view.data.verdict} />
            </ErrorBoundary>
          ) : (
            <NoVerdictYet idea={view.data} />
          )}
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
  const redLine = redLineBreached(verdict, idea.redLine);
  return (
    <>
      <section className={cn("relative flex flex-col gap-3.5 overflow-hidden rounded-lg bg-night px-6 py-7 text-primary-ink sm:px-8", RISE)}>
        <div aria-hidden className="absolute -right-10 -top-32 size-aura animate-drift rounded-full bg-attention opacity-60 blur-aura motion-reduce:animate-none" />
        <div aria-hidden className="absolute -bottom-44 right-56 size-aura animate-drift rounded-full bg-violet opacity-60 blur-aura animate-delay-5 motion-reduce:animate-none" />
        <span className={cn("relative self-start rounded-full px-3.5 py-1.5 text-sm font-bold uppercase tracking-wide", stamp, "animate-stamp motion-reduce:animate-none")}>
          Verdict · {OUTCOME[verdict.outcome].toLowerCase()}
        </span>
        <h1 className="relative text-3xl font-semibold leading-tight sm:text-4xl">{verdict.headline}</h1>
        {verdict.summary && <p className="relative max-w-prose text-base text-primary-tint">{verdict.summary}</p>}
      </section>

      {redLine && (
        <section role="alert" aria-label="Red line" className="flex flex-col gap-2 rounded-md border-2 border-attention-text bg-attention-tint px-6 py-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-attention-text">
            <Icon name="verdict" />
            This idea crosses a red line: {redLine}
          </h2>
          <p className="text-ink">FrostAura never builds it, and no one can overrule that — not research, not auto-mode, not you. You can change the idea and have it researched again, or drop it.</p>
          {verdict.redLines?.reasoning && <p className="text-attention-deep">{verdict.redLines.reasoning}</p>}
        </section>
      )}

      {verdict.against.length > 0 && (
        <section aria-labelledby="against-title" className={cn("flex flex-col gap-3 rounded-md border bg-surface p-5 shadow-card", RISE)}>
          <h2 id="against-title" className="text-lg font-semibold">
            The case against, argued first
          </h2>
          <ol className="flex flex-col gap-2.5">
            {verdict.against.map((point, i) => (
              <li key={i} className="text-ink-body">
                {point}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-3">
        <Evidence title="Who already does this" index={1}>
          <ExistingProducts products={verdict.existing.products} evidence={verdict.existing.evidence} />
        </Evidence>
        <Evidence title="What gap is left" index={2}>
          {verdict.gap.paragraphs.length === 0 ? (
            <p data-state="empty" className="text-ink-muted">
              Research named no gap.
            </p>
          ) : (
            verdict.gap.paragraphs.map((g, i) => (
              <p key={i} className="text-ink-body">
                {g}
              </p>
            ))
          )}
        </Evidence>
        <Evidence title="Who would want it" index={3}>
          {verdict.demand.paragraphs.map((d, i) => (
            <p key={i} className="text-ink-body">
              {d}
            </p>
          ))}
          {verdict.demand.signals.length > 0 && (
            <ul aria-label="Signals of demand" className="flex flex-col gap-2">
              {verdict.demand.signals.map((signal, i) => (
                <li key={i} className="flex flex-col gap-0.5 rounded-xs bg-ground px-3 py-2">
                  <span>{signal.text}</span>
                  {signal.source && <SourceLink url={signal.source} />}
                </li>
              ))}
            </ul>
          )}
          {!verdict.demand.evidenceFound && <p className="rounded-sm bg-attention-tint px-3 py-2.5 font-medium text-attention-strong">No evidence of demand was found. That counts against building.</p>}
        </Evidence>
      </div>

      {verdict.suggestedChange && (
        <section aria-labelledby="suggested-title" className="flex flex-col gap-2.5 rounded-md border-2 border-primary bg-surface px-6 py-5">
          <h2 id="suggested-title" className="text-lg font-semibold">
            What to change
          </h2>
          <p className="text-ink-body">{verdict.suggestedChange}</p>
        </section>
      )}

      {verdict.wouldChange && (
        <section className="flex flex-col gap-2.5 rounded-md border border-primary bg-primary-tint px-6 py-5">
          <h2 className="text-lg font-semibold">What would change the verdict</h2>
          {verdict.wouldChange.text.split(/\n\s*\n/).map((p, i) => (
            <p key={i} className="text-ink-body">
              {p}
            </p>
          ))}
          {verdict.wouldChange.estimateCredits !== null && <p className="font-medium">Estimated {formatCredits(verdict.wouldChange.estimateCredits)}</p>}
        </section>
      )}

      {!redLine && verdict.redLines && (
        <section aria-label="Red-line screen" className="flex flex-col gap-1.5 rounded-md border bg-surface px-6 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Icon name="health" tinted />
            No red line is crossed
          </h2>
          {verdict.redLines.reasoning && <p className="text-ink-body">{verdict.redLines.reasoning}</p>}
        </section>
      )}

      <ErrorBoundary name="Your decision">
        <Decisions idea={idea} verdict={verdict} redLine={redLine} />
      </ErrorBoundary>
    </>
  );
}

function ExistingProducts({ products, evidence }: { products: ExistingProduct[]; evidence: string[] }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [all, setAll] = useState(false);
  if (products.length === 0) {
    return (
      <>
        {evidence.map((e, i) => (
          <p key={i} className="text-ink-body">
            {e}
          </p>
        ))}
        <p data-state="empty" className="text-ink-muted">
          Research found nothing already sold that does this.
        </p>
      </>
    );
  }
  const shown = all ? products : products.slice(0, PRODUCTS_SHOWN);
  return (
    <>
      {evidence[0] && <p className="text-ink-body">{evidence[0]}</p>}
      <ul aria-label="Existing products" className="flex flex-col gap-3">
        {shown.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex min-w-0 flex-col gap-0.5">
            <span className="break-words font-semibold">{technical ? p.name : plainProductName(p.name)}</span>
            {p.does && <span className="break-words text-ink-body">{p.does}</span>}
            {p.sources.length > 0 && (
              <span className="flex flex-wrap gap-x-3">
                {p.sources.map((u) => (
                  <SourceLink key={u} url={u} />
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
      {products.length > PRODUCTS_SHOWN && (
        <Button size="sm" variant="ghost" className="self-start" aria-expanded={all} onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${formatNumber(products.length)}`}
        </Button>
      )}
    </>
  );
}

function SourceLink({ url }: { url: string }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-touch max-w-full items-center break-all rounded-xs text-sm text-primary-link hover:text-primary-hover sm:min-h-0">
      {technical ? url : sourceLabel(url)}
    </a>
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

const DECIDED: Record<DecisionChoice, string> = {
  build: "You chose to build it",
  change: "You asked for the idea to be changed and researched again",
  overrule: "You overruled the verdict and chose to build it",
  drop: "You dropped the idea",
};

function Decisions({ idea, verdict, redLine }: { idea: Idea; verdict: Verdict; redLine: string | null }) {
  const [decide, state] = useDecideIdeaMutation();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DecisionChoice | null>(null);
  const [changeNote, setChangeNote] = useState(verdict.suggestedChange ?? verdict.wouldChange?.text ?? "");

  if (idea.decision) {
    const d = idea.decision;
    return (
      <section role="status" data-decision={d.choice} className={cn("flex flex-col gap-2 rounded-md border px-6 py-5", d.overruled ? "border-attention-line bg-attention-tint" : "bg-surface")}>
        <p className="text-base font-semibold">
          {d.via === "auto-mode" ? DECIDED[d.choice].replace(/^You (chose|asked)/, "Auto-mode $1") : DECIDED[d.choice]} on {formatDate(d.at)}.
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

  const submit = async (choice: DecisionChoice, note?: string) => {
    setError(null);
    setConfirming(null);
    try {
      const result = await decide({ id: idea.id, choice, ...(note ? { note } : {}) }).unwrap();
      if (result.decision?.runId) navigate(paths.run(result.decision.runId));
    } catch (e) {
      setError(describeError(e as never));
    }
  };

  const changeSubmit = (event: FormEvent) => {
    event.preventDefault();
    const note = changeNote.trim();
    if (note) void submit("change", note);
  };

  const options = decisionOptions(verdict, redLine);
  return (
    <section aria-label="Your decision" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {options.map((o) =>
          confirming === o.choice && o.choice !== "change" ? (
            <span key={o.choice} role="group" aria-label="Confirm" className="flex flex-wrap items-center gap-2 rounded-sm bg-attention-tint px-3 py-1.5">
              <span className="text-sm text-attention-text">{o.choice === "drop" ? "Drop this idea?" : "Build it against the verdict? This is recorded as an overrule."}</span>
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
              aria-expanded={o.choice === "change" ? confirming === "change" : undefined}
              onClick={() => (o.choice === "build" ? void submit("build") : setConfirming(confirming === o.choice ? null : o.choice))}
            >
              {o.label}
            </Button>
          ),
        )}
      </div>
      {confirming === "change" && (
        <form onSubmit={changeSubmit} aria-label="Change the idea" className="flex max-w-prose flex-col gap-2 rounded-md border bg-surface p-4">
          <label htmlFor="change-note" className="font-medium">
            What should change?
          </label>
          <textarea id="change-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} rows={4} className="rounded-xs border border-border-strong bg-surface px-3 py-2" />
          <span className="text-sm text-ink-muted">Research runs again with your change, and you see a new verdict before anything is built.</span>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!changeNote.trim() || state.isLoading}>
              Research it again with this change
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Not now
            </Button>
          </div>
        </form>
      )}
      {redLine ? (
        <p className="text-ink-muted">Overruling is not offered: no one may build over a red line.</p>
      ) : (
        verdict.outcome === "do-not-build" && <p className="text-ink-muted">Overruling is your call. The project will carry a note that research advised against it.</p>
      )}
      {error && (
        <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
          Your decision was not recorded: {error}
        </p>
      )}
    </section>
  );
}

function RecordAside({ idea }: { idea: Idea }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const r = idea.record;
  const rows: { label: string; n: number; tone: "soft" | "primary" | "ink" }[] = [
    { label: "Build", n: r.build, tone: "soft" },
    { label: "Change", n: r.change, tone: "primary" },
    { label: "Do not build", n: r.doNotBuild, tone: "ink" },
  ];
  const method = idea.verdict?.method;
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
      {method && (
        <section aria-labelledby="method-title" className="flex flex-col gap-2.5">
          <h2 id="method-title" className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="research" tinted />
            How this was researched
          </h2>
          {method.summary && <p className="text-ink-body">{method.summary}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {method.argued && <MethodRow label="Argued">The case {method.argued}</MethodRow>}
            {method.contractors !== null && <MethodRow label="Briefed">{plural(method.contractors, "contractor")}</MethodRow>}
            {method.strands.length > 0 && <MethodRow label="Strands">{method.strands.map((x) => strandLabel(x.title)).join(", ")}</MethodRow>}
            {method.searchCount !== null && <MethodRow label="Searches">{formatNumber(method.searchCount)}</MethodRow>}
            <MethodRow label="Sources">{method.sources.length === 0 ? "None recorded" : formatNumber(method.sources.length)}</MethodRow>
            <MethodRow label="Confidence">{method.confidence ?? "Not stated"}</MethodRow>
          </dl>
          {method.strands.some((x) => x.searches !== null || x.confidence) && (
            <ul aria-label="Strands" className="flex flex-col gap-1.5">
              {method.strands.map((x) => (
                <li key={x.id} className="flex flex-col rounded-xs bg-ground px-3 py-2">
                  <span className="font-medium">{strandLabel(x.title)}</span>
                  <span className="text-sm text-ink-body">
                    {[x.searches !== null ? plural(x.searches, "search", "searches") : null, x.sources !== null ? plural(x.sources, "source") : null, x.confidence ? `${x.confidence} confidence` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {idea.verdict?.placement && (
            <p className="text-ink-body">
              Suggested home: {idea.verdict.placement.name ?? idea.verdict.placement.project}
            </p>
          )}
          {technical && method.searches.length > 0 && (
            <ul aria-label="Searches" className="flex flex-col gap-1 font-mono text-xs text-ink-body">
              {method.searches.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
          {method.sources.length > 0 && (
            <details>
              <summary className="min-h-touch cursor-pointer py-2 text-primary-link">Every source ({formatNumber(method.sources.length)})</summary>
              <ul className="flex flex-col gap-1">
                {method.sources.map((u) => (
                  <li key={u} className="min-w-0">
                    <SourceLink url={u} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          {idea.verdict && idea.verdict.rulesApplied.length > 0 && (
            <div className="flex flex-col gap-1 rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
              {idea.verdict.rulesApplied.map((rule, i) => (
                <p key={i}>{rule}</p>
              ))}
            </div>
          )}
          <Link href={paths.run(idea.runId)} className="flex min-h-touch items-center self-start rounded-xs text-primary-link hover:text-primary-hover">
            See every step
          </Link>
        </section>
      )}
    </>
  );
}

function MethodRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0">{children}</dd>
    </>
  );
}

const STRANDS: Record<string, string> = { existing: "existing products", gap: "the gap", demand: "demand" };

function strandLabel(strand: string): string {
  return STRANDS[strand] ?? strand;
}
