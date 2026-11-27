import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ConfirmCard } from "@/components/ui/confirm";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Fold } from "@/components/Fold";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Bar, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Alert, StatusTag } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/field";
import { LINK } from "@/components/ui/layout";
import { ContentGrid, SECTION, SideCard, TITLE, useShowAll } from "@/components/ui/page";
import { Stat, StatRow } from "@/components/ui/stat";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatCredits, formatDate, formatNumber, percent, plural } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { navigate, paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useMinWidth, useViewport } from "@/lib/useViewport";
import { breakpoints } from "@/lib/tokens";
import { useAppSelector } from "@/store";
import { api, useDecideIdeaMutation, useGetIdeaQuery, useGetMeQuery } from "@/store/api";
import type { DecisionChoice, ExistingProduct, Idea, Verdict, VerdictOutcome } from "@/store/types";
import { AppShell, type Crumb } from "../shell/AppShell";
import { usePageConversation } from "../conversation/pageConversation";
import { useDockState } from "../conversation/dockLayout";
import { TryAgain } from "../runs/TryAgain";
import { ResearchTrace } from "./ResearchTrace";
import { namesFor } from "../home/treeModel";
import { decisionOptions, heroFacts, notResearched, nothingSearched, paragraphs, plainProductName, redLineBreached, sameText, shortSummary, sourceCount, sourceLabel, sourceSites, titleCase, wordClamp } from "./verdictModel";

const OUTCOME: Record<VerdictOutcome, string> = { build: "Build", change: "Change", "do-not-build": "Do not build" };

/** While research is still running the verdict page waits on it, so it is polled. */
const RESEARCH_POLL_MS = 5_000;

/** How many existing products, signals and overrules show before "Show all". Research can name dozens. */
const PRODUCTS_SHOWN = 5;
const SIGNALS_SHOWN = 5;
const OVERRULES_SHOWN = 3;
const SOURCES_SHOWN = 6;

/**
 * The verdict page: a document with a decision. A calm white hero (the verdict's kind as one tag, the
 * headline, a few lines of the reasoning that open in place), then the decision — beside the page in a
 * card that stays in view on a desktop, straight under the hero everywhere else — then the evidence as
 * sections that size to their content (two columns from 1600), then research's track record.
 */
export function VerdictView({ ideaId }: { ideaId: string }) {
  // Poll only while research is still running; the cached answer says whether it is.
  const cached = api.endpoints.getIdea.useQueryState(ideaId);
  const researching = !cached.data || cached.data.status === "researching";
  const query = useGetIdeaQuery(ideaId, { pollingInterval: researching ? RESEARCH_POLL_MS : 0 });
  const view = viewOf(query);
  const tree = useActiveTree();
  const active = useActiveOrganisation();
  const idea = view.kind === "loaded" ? view.data : null;
  // The conversation at the level the idea belongs to, docked beside its verdict (ARCH-012).
  const talk = usePageConversation(idea?.scope ? { scope: idea.scope } : null);
  // The side panel is beside the page only on a desktop, and beside the docked conversation only from 1600 (or
  // with the pane collapsed); anywhere else it falls under the page, so the decision is drawn under the verdict.
  const desktop = useSideBeside(!!talk);

  const crumbs: Crumb[] = [];
  const org = active.organisation;
  if (org) crumbs.push({ label: org.name, href: paths.home() });
  if (idea?.scope) {
    const parts = idea.scope.split("/");
    namesFor(tree.data, idea.scope).slice(1).forEach((name, i) => crumbs.push({ label: name, href: paths.manage(parts.slice(0, i + 2).join("/")) }));
  }
  crumbs.push({ label: idea?.title ?? "Idea" });

  // Beside a verdict: the decision, in view all the way down, and how research reached it. Before there is
  // a verdict there is nothing to decide: research's record sits beside the page instead.
  const aside = !idea || !desktop
    ? undefined
    : idea.verdict
      ? [
          <DecisionCard key="decision" idea={idea} verdict={idea.verdict} />,
          <SideCard key="method" label="How this was researched">
            <ErrorBoundary name="The research record">
              <Method idea={idea} />
            </ErrorBoundary>
          </SideCard>,
        ]
      : [
          <SideCard key="refusals" label="How often research says no">
            <Refusals idea={idea} />
          </SideCard>,
          <SideCard key="overrules" label="When you overruled">
            <Overrules idea={idea} />
          </SideCard>,
        ];

  return (
    <AppShell crumbs={crumbs} aside={aside} talk={talk}>
      {view.kind === "loading" && (
        <Loading label="Loading the verdict" className="flex flex-col gap-6">
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-40 rounded-md" />
          <Skeleton className="h-40 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title={view.status === 404 ? "This idea could not be found" : "The verdict could not be loaded"} reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          {view.data.verdict ? (
            <ErrorBoundary name="The verdict">
              <VerdictBody idea={view.data} verdict={view.data.verdict} desktop={desktop} />
            </ErrorBoundary>
          ) : (
            <>
              <NoVerdictYet idea={view.data} />
              <ErrorBoundary name="Research's steps">
                <ResearchTrace runId={view.data.runId} stopped={view.data.status === "failed"} />
              </ErrorBoundary>
              {!desktop && <TrackRecord idea={view.data} />}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

/** True where the page's side panel sits beside the page rather than under it (AppShell's own rule). */
function useSideBeside(talk: boolean): boolean {
  const desktop = useViewport() === "desktop";
  const me = useGetMeQuery(undefined);
  const dock = useDockState(me.data?.user.id ?? null);
  const wide = useMinWidth(breakpoints["3xl"]);
  return desktop && (!talk || dock.collapsed || wide);
}

/** Who researched it and what it cost against its estimate: one quiet line. */
function ResearchLine({ idea }: { idea: Idea }) {
  return (
    <span className="text-sm text-ink-muted">
      Research{idea.research.by ? ` by ${idea.research.by}` : ""} · {formatCredits(idea.research.spentCredits)}, estimated {formatNumber(idea.research.estimatedCredits)}
    </span>
  );
}

function TechnicalLine({ idea }: { idea: Idea }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  if (!technical) return null;
  return (
    <code className="break-all font-mono text-xs text-ink-muted">
      idea {idea.id} · research run {idea.runId} · status {idea.status}
      {idea.scope ? ` · scope ${idea.scope}` : ""}
      {idea.redLine ? ` · red line ${idea.redLine}` : ""}
    </code>
  );
}

function NoVerdictYet({ idea }: { idea: Idea }) {
  const failed = idea.status === "failed";
  // Stopped by a person or held by its budget is not a fault: neither is drawn in the failure's red.
  const cancelled = failed && idea.tryAgain?.why === "cancelled";
  const budget = failed && idea.tryAgain?.why === "budget";
  return (
    <section className={cn("flex flex-col items-start gap-4 rounded-lg border bg-surface px-6 py-7 shadow-card sm:px-8", RISE)} role={failed && !cancelled && !budget ? "alert" : "status"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {cancelled ? (
          <StatusTag state="cancelled">Research cancelled</StatusTag>
        ) : budget ? (
          <StatusTag state="paused-by-budget">Research did not finish</StatusTag>
        ) : (
          <Badge tone={failed ? "bad" : "info"}>{failed ? "Research did not finish" : "Research in progress"}</Badge>
        )}
        <ResearchLine idea={idea} />
      </div>
      <h1 className={cn(TITLE, "max-w-prose")}>{failed ? "No verdict could be reached." : "The verdict is being worked out."}</h1>
      <p className="max-w-prose text-ink-body">
        {failed ? "Research stopped before it reached a verdict. Where it got to is below." : "The case against the idea is argued first. Each step shows below as it happens."}
      </p>
      <p className="max-w-prose text-ink-muted">“{idea.text}”</p>
      <div className="flex flex-wrap items-start gap-3 phone:w-full phone:flex-col phone:items-stretch">
        <Link href={paths.run(idea.runId)} className={buttonVariants({ variant: failed && idea.tryAgain ? "secondary" : "primary" })}>
          {failed ? "See what happened" : "Watch the research"}
        </Link>
      </div>
      {failed && idea.tryAgain && <TryAgain runId={idea.tryAgain.runId} ideaId={idea.id} why={idea.tryAgain.why} showCredits={idea.tryAgain.why === "budget"} />}
      <TechnicalLine idea={idea} />
      <DecisionHistory idea={idea} />
    </section>
  );
}

/** Decisions taken on earlier verdicts, kept after a new verdict cleared them (VERD-07). */
function DecisionHistory({ idea }: { idea: Idea }) {
  if (idea.history.length === 0) return null;
  return (
    <section aria-label="Earlier decisions" className="flex w-full flex-col gap-2 border-t pt-4 text-ink">
      <h2 className="text-base font-semibold">Earlier decisions</h2>
      <ol className="flex flex-col gap-3">
        {idea.history.map((h) => (
          <li key={h.runId} className="flex flex-col gap-0.5">
            <span>
              {h.choice === "change"
                ? `${h.by || "Someone"} asked for the idea to be changed${h.verdict ? ` after a “${OUTCOME[h.verdict].toLowerCase()}” verdict` : ""} on ${formatDate(h.at)}.`
                : `Research that did not finish was started again on ${formatDate(h.at)}.`}
            </span>
            {h.note && <span className="text-ink-body">“{h.note}”</span>}
            <Link href={paths.run(h.runId)} className={cn(LINK, "inline-flex min-h-touch items-center self-start text-sm")}>
              See the research that followed
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function VerdictBody({ idea, verdict, desktop }: { idea: Idea; verdict: Verdict; desktop: boolean }) {
  const phone = useViewport() === "phone";
  const redLine = redLineBreached(verdict, idea.redLine);
  const short = verdict.summary ? shortSummary(verdict.summary) : null;
  // Each thing is said once: the case against is not repeated when it is the summary the hero already
  // shows whole, and a red line's reasoning is not repeated when it is that summary or that case.
  const against = verdict.against.filter((p) => !(short?.full && sameText(p, verdict.summary)));
  const redLineReason = verdict.redLines?.reasoning && ![verdict.summary, verdict.headline, ...verdict.against].some((t) => sameText(t, verdict.redLines?.reasoning ?? "")) ? verdict.redLines.reasoning : null;
  // Over a red line research stops: the market sections hold only "not researched", said once.
  const marketSkipped = !!redLine && notResearched(verdict);
  const unsearched = nothingSearched(verdict);

  return (
    <>
      <Hero idea={idea} verdict={verdict} />

      {/* A red line is a banner of its own, the width of the page: never a card inside the verdict's card. */}
      {redLine && (
        <section role="alert" aria-label="Red line" className={cn("flex flex-col gap-1.5 rounded-md border border-attention-line bg-surface px-5 py-4 shadow-card sm:px-6", RISE)}>
          <h2 className="flex items-start gap-2 text-base font-semibold text-attention-text">
            <Icon name="verdict" className="mt-0.5 size-5 shrink-0" />
            <span className="min-w-0">This idea crosses a red line: {redLine}</span>
          </h2>
          <p className="max-w-prose text-ink max-sm:text-sm">FrostAura never builds it, and no one can overrule that — not research, not auto-mode, not you. You can change the idea and have it researched again, or drop it.</p>
          {redLineReason && <p className="max-w-prose text-ink-body">{redLineReason}</p>}
        </section>
      )}

      {/* The decision: under the verdict on a tablet or a phone; beside the page on a desktop. */}
      {!desktop && (
        <section aria-label="Your decision" className={cn("flex flex-col gap-3", !phone && "rounded-md border bg-surface p-5 shadow-card")}>
          {!phone && <h2 className={SECTION}>Your decision</h2>}
          <ErrorBoundary name="Your decision">
            <Decisions idea={idea} verdict={verdict} redLine={redLine} />
          </ErrorBoundary>
        </section>
      )}

      <FoldGroup
        label="The evidence"
        summary={marketSkipped ? "Research stopped at the red line" : unsearched ? "No web search was run" : evidenceLine(verdict)}
      >
        {against.length > 0 && (
          <Fold title="The case against, argued first" summary={plural(against.length, "point")} defaultOpen>
            <Evidence title="The case against, argued first" id="against-title" index={0}>
              {against.length === 1 ? (
                <p className="text-ink-body">{against[0]}</p>
              ) : (
                <ol className="flex flex-col gap-2.5">
                  {against.map((point, i) => (
                    <li key={i} className="text-ink-body">
                      {point}
                    </li>
                  ))}
                </ol>
              )}
            </Evidence>
          </Fold>
        )}

        {marketSkipped ? (
          <Fold title="The market was not researched">
            <Evidence title="The market was not researched" index={1}>
              <p className="text-ink-body">Research stops at a red line, so who already does this, what gap is left and who would want it were not looked into.</p>
            </Evidence>
          </Fold>
        ) : (
          <>
            <Fold title="Who already does this" summary={verdict.existing.products.length ? plural(verdict.existing.products.length, "product") : "Nothing found already sold"}>
              <Evidence title="Who already does this" index={1}>
                <ExistingProducts products={verdict.existing.products} evidence={verdict.existing.evidence} />
              </Evidence>
            </Fold>
            <Fold title="What gap is left" summary={verdict.gap.paragraphs.length === 0 ? "Research named no gap" : undefined}>
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
            </Fold>
            <Fold title="Who would want it" summary={verdict.demand.evidenceFound ? (verdict.demand.signals.length > 0 ? plural(verdict.demand.signals.length, "signal") : undefined) : "No evidence of demand was found"}>
              <Evidence title="Who would want it" index={3}>
                <Demand verdict={verdict} />
              </Evidence>
            </Fold>
          </>
        )}

        {verdict.suggestedChange && (
          <Fold title="What to change">
            <Evidence title="What to change" id="suggested-title" index={4}>
              <p className="text-ink-body">{verdict.suggestedChange}</p>
            </Evidence>
          </Fold>
        )}

        {verdict.wouldChange && (
          <Fold title="What would change the verdict">
            <Evidence title="What would change the verdict" index={5}>
              {verdict.wouldChange.text.split(/\n\s*\n/).map((p, i) => (
                <p key={i} className="text-ink-body">
                  {p}
                </p>
              ))}
              {verdict.wouldChange.estimateCredits !== null && <p className="font-medium">Estimated {formatCredits(verdict.wouldChange.estimateCredits)}</p>}
            </Evidence>
          </Fold>
        )}

        {!redLine && verdict.redLines && (
          <Fold title="No red line is crossed">
            <section aria-label="Red-line screen" className={cn("flex min-w-0 flex-col gap-2 rounded-md border bg-surface p-5 shadow-card", RISE, stagger(6))}>
              <h2 className={cn(SECTION, "flex items-center gap-2")}>
                <Icon name="health" className="size-5 text-ink" />
                No red line is crossed
              </h2>
              {verdict.redLines.reasoning && <p className="text-ink-body">{verdict.redLines.reasoning}</p>}
            </section>
          </Fold>
        )}

        {!desktop && verdict.method && (
          <Fold title="How this was researched" summary={unsearched ? undefined : methodFacts(idea)}>
            <section aria-label="How this was researched" className="flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card">
              <Method idea={idea} />
            </section>
          </Fold>
        )}
      </FoldGroup>

      <TrackRecord idea={idea} />
    </>
  );
}

/**
 * Sections of a page, grouped. On a phone each is a fold, and the folds sit together in one card under a heading
 * and a line that sums them up — never a wall of separate fold cards. Elsewhere they are the evidence's columns:
 * one column, then two from 1280, each section the height of what it holds (masonry), every column starting at
 * the same top.
 */
function FoldGroup({ label, summary, children }: { label: string; summary?: string; children: ReactNode }) {
  const phone = useViewport() === "phone";
  if (!phone)
    return (
      <ContentGrid masonry label={label} className="xl:block xl:columns-2 xl:gap-6 xl:[&>*:last-child]:mb-0 xl:[&>*]:mb-6 xl:[&>*]:break-inside-avoid">
        {children}
      </ContentGrid>
    );
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 className={SECTION}>{label}</h2>
        {summary && <p className="text-sm text-ink-muted">{summary}</p>}
      </div>
      <div className={GROUPED}>{children}</div>
    </section>
  );
}

/** Folds held together in one card: each loses its own edge and lift, and a rule parts it from the one above. */
const GROUPED =
  "flex flex-col overflow-hidden rounded-md border bg-surface shadow-card [&>[data-fold]]:!rounded-none [&>[data-fold]]:!border-x-0 [&>[data-fold]]:!border-b-0 [&>[data-fold]]:!shadow-none [&>[data-fold]:first-child]:!border-t-0";

/** The evidence in one line, for a phone's heading over its folds: what is sold, the demand, how sure. */
function evidenceLine(verdict: Verdict): string | undefined {
  if (heroFacts(verdict).length === 0) return undefined;
  const products = verdict.existing.products.length;
  const signals = verdict.demand.signals.length;
  const demand = !verdict.demand.evidenceFound ? "no demand found" : signals > 0 ? plural(signals, "sign") + " of demand" : "some demand";
  return [`${formatNumber(products)} already sold`, demand, verdict.method.confidence ? `${verdict.method.confidence} confidence` : null].filter(Boolean).join(" · ");
}

/** The method in one line: searches, sources and confidence, each said once. */
function methodFacts(idea: Idea): string | undefined {
  const verdict = idea.verdict;
  if (!verdict?.method) return undefined;
  const m = verdict.method;
  const sources = sourceCount(verdict);
  return [m.searchCount !== null ? plural(m.searchCount, "search", "searches") : null, sources > 0 ? plural(sources, "source") : "no sources recorded", m.confidence ? `${m.confidence} confidence` : null].filter(Boolean).join(" · ") || undefined;
}

/**
 * The verdict, at the top: its kind as one tag, who researched it and for what, the headline, and a few
 * lines of the reasoning — "Read the full reasoning" opens the rest in place of those lines, never under
 * them. Beside it from 1280 (under it below that): three figures from the research — or, when research ran no
 * web search at all, that said once and plainly, so what it already knew is never shown as counted evidence.
 */
function Hero({ idea, verdict }: { idea: Idea; verdict: Verdict }) {
  const stamp: BadgeTone = verdict.outcome === "build" ? "good" : verdict.outcome === "change" ? "info" : "bad";
  const short = verdict.summary ? shortSummary(verdict.summary) : null;
  const [open, setOpen] = useState(false);
  // A phone keeps the lines to three, so the decision is on the first screen; cut, they open in place too.
  const lines = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = lines.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [short?.text]);
  const more = !!short && (!short.full || cut);
  const facts = heroFacts(verdict);
  const unsearched = nothingSearched(verdict) && !notResearched(verdict);

  return (
    <section aria-label="The verdict" className={cn("flex flex-col gap-6 rounded-lg border bg-surface px-6 py-6 shadow-card max-sm:gap-4 max-sm:px-5 max-sm:py-5 sm:px-8 sm:py-7 xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start xl:gap-10", RISE)}>
      <div className="flex min-w-0 max-w-prose flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Badge tone={stamp}>
            Verdict · {OUTCOME[verdict.outcome].toLowerCase()}
          </Badge>
          <ResearchLine idea={idea} />
        </div>
        <h1 className={TITLE}>{verdict.headline}</h1>
        {short &&
          (open ? (
            <div id="full-reasoning" aria-label="The full reasoning" role="region" className="flex flex-col gap-3">
              {paragraphs(verdict.summary).map((p, i) => (
                <p key={i} className="text-base text-ink-body">
                  {p}
                </p>
              ))}
            </div>
          ) : (
            <p ref={lines} className="text-base text-ink-body max-sm:line-clamp-3 rail:line-clamp-2">
              {short.text}
            </p>
          ))}
        {more && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls="full-reasoning"
            onClick={() => setOpen((x) => !x)}
            className="flex items-center self-start rounded-xs font-semibold text-primary-link hover:text-primary-hover touch:min-h-touch"
          >
            {open ? "Hide the full reasoning" : "Read the full reasoning"}
          </button>
        )}
        <TechnicalLine idea={idea} />
      </div>
      {unsearched ? (
        <div role="note" aria-label="How much was looked at" className="flex flex-col gap-1 border-t pt-4 xl:w-72 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
          <span className="font-semibold text-ink">No web search was run</span>
          <span className="text-ink-body">This verdict rests on what research already knew, not on sources it read. Treat it as a first opinion{verdict.method.confidence ? `, held with ${verdict.method.confidence} confidence` : ""}.</span>
        </div>
      ) : (
        facts.length > 0 && (
          <div role="group" aria-label="What research found" className="hidden shrink-0 border-t pt-5 lg:block xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
            <StatRow cols={3} className="gap-x-8 xl:w-44 xl:grid-cols-1 xl:gap-y-5 3xl:w-auto 3xl:grid-cols-3">
              {facts.map((f) => (
                <Stat key={f.label} plain label={f.label} value={f.value} caption={f.caption} />
              ))}
            </StatRow>
          </div>
        )
      )}
    </section>
  );
}

function Demand({ verdict }: { verdict: Verdict }) {
  const { shown, control } = useShowAll(verdict.demand.signals, SIGNALS_SHOWN, "signals");
  return (
    <>
      {verdict.demand.paragraphs.map((d, i) => (
        <p key={i} className="text-ink-body">
          {d}
        </p>
      ))}
      {/* Said once: when research's own words already say none was found, only what that means is added. */}
      {!verdict.demand.evidenceFound && (
        <p className="font-medium text-ink">{verdict.demand.paragraphs.some((p) => /^no (evidence|demand|sign)/i.test(p.trim())) ? "That counts against building." : "No evidence of demand was found. That counts against building."}</p>
      )}
      {verdict.demand.signals.length > 0 && (
        <ul aria-label="Signals of demand" className="flex flex-col divide-y border-t">
          {shown.map((signal, i) => (
            <li key={i} className="flex min-w-0 flex-col gap-0.5 py-2.5">
              <span className="text-ink-body">{signal.text}</span>
              {signal.source && <SourceLink url={signal.source} />}
            </li>
          ))}
        </ul>
      )}
      {control}
    </>
  );
}

function ExistingProducts({ products, evidence }: { products: ExistingProduct[]; evidence: string[] }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const { shown, control } = useShowAll(products, PRODUCTS_SHOWN, "products");
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
  return (
    <>
      {evidence[0] && <p className="text-ink-body">{evidence[0]}</p>}
      <ul aria-label="Existing products" className="flex flex-col divide-y border-t">
        {shown.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex min-w-0 flex-col gap-0.5 py-2.5">
            <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 break-words font-semibold">{technical ? p.name : plainProductName(p.name)}</span>
              {[...new Set(p.sources)].slice(0, 1).map((u) => (
                <SourceLink key={u} url={u} />
              ))}
            </span>
            {p.does && <span className="break-words text-ink-body">{p.does}</span>}
          </li>
        ))}
      </ul>
      {control}
    </>
  );
}

/** A source: its site in normal mode, its whole address in technical mode — cut to its card, never past it. */
function SourceLink({ url }: { url: string }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" title={url} className={cn(LINK, "block min-w-0 max-w-full truncate text-sm touch:flex touch:min-h-touch touch:items-center")}>
      <span className="truncate">{technical ? url : sourceLabel(url)}</span>
    </a>
  );
}

function Evidence({ title, id, index, children }: { title: string; id?: string; index: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} aria-label={id ? undefined : title} className={cn("flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card", RISE, stagger(index))}>
      <h2 id={id} className={SECTION}>
        {title}
      </h2>
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

const DECIDED_TAG: Record<DecisionChoice, { label: string; tone: BadgeTone }> = {
  build: { label: "Built", tone: "good" },
  change: { label: "Researched again", tone: "info" },
  overrule: { label: "Overruled", tone: "warn" },
  drop: { label: "Dropped", tone: "neutral" },
};

/** The decision in the side panel: a card that stays in view while the evidence scrolls past. */
function DecisionCard({ idea, verdict }: { idea: Idea; verdict: Verdict }) {
  const redLine = redLineBreached(verdict, idea.redLine);
  return (
    <section aria-label="Your decision" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-base font-semibold">{idea.decision ? "Decided" : "Your decision"}</h2>
      <ErrorBoundary name="Your decision">
        <Decisions idea={idea} verdict={verdict} redLine={redLine} stacked />
      </ErrorBoundary>
    </section>
  );
}

function Decisions({ idea, verdict, redLine, stacked = false }: { idea: Idea; verdict: Verdict; redLine: string | null; stacked?: boolean }) {
  const [decide, state] = useDecideIdeaMutation();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DecisionChoice | null>(null);
  const [changeNote, setChangeNote] = useState(verdict.suggestedChange ?? verdict.wouldChange?.text ?? "");

  if (idea.decision) {
    const d = idea.decision;
    const tag = DECIDED_TAG[d.choice];
    return (
      <div role="status" data-decision={d.choice} className="flex flex-col items-start gap-2">
        <Badge tone={tag.tone}>{tag.label}</Badge>
        <p className="font-semibold">
          {d.via === "auto-mode" ? DECIDED[d.choice].replace(/^You (chose|asked)/, "Auto-mode $1") : DECIDED[d.choice]} on {formatDate(d.at)}.
        </p>
        {d.overruled && <p className="text-ink-body">The project carries a note that research advised against it.</p>}
        {d.runId && (
          <Link href={paths.run(d.runId)} className={cn(buttonVariants({ variant: "secondary" }), stacked && "w-full")}>
            Watch the work that followed
          </Link>
        )}
        {idea.tryAgain?.what === "build" && <TryAgain runId={idea.tryAgain.runId} ideaId={idea.id} why={idea.tryAgain.why} showCredits={idea.tryAgain.why === "budget"} />}
        <DecisionHistory idea={idea} />
      </div>
    );
  }

  const submit = async (choice: DecisionChoice, note?: string, applyChange = false) => {
    setError(null);
    setConfirming(null);
    try {
      const result = await decide({ id: idea.id, choice, ...(note ? { note } : {}), ...(applyChange ? { applyChange: true } : {}) }).unwrap();
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
  const withChange = verdict.outcome === "change" && !!verdict.suggestedChange && !redLine;
  return (
    <div className="flex flex-col gap-3">
      {/* One row of same-sized choices: the primary first, then the outlined ones; what a choice asks opens under the row. */}
      <div className={cn("flex flex-wrap items-center gap-3 phone:flex-col phone:items-stretch", stacked && "flex-col items-stretch")}>
        {options.flatMap((o) => [
          <Button
            key={o.choice}
            size="lg"
            variant={o.variant}
            disabled={state.isLoading}
            aria-expanded={o.choice === "build" ? undefined : confirming === o.choice}
            onClick={() => (o.choice === "build" ? void submit("build") : setConfirming(confirming === o.choice ? null : o.choice))}
          >
            {o.label}
          </Button>,
          // On a "change" verdict research's own change can be accepted and built in, without another round of research (VERD-06).
          o.choice === "build" && withChange ? (
            <Button key="with-change" size="lg" variant="secondary" disabled={state.isLoading} onClick={() => void submit("build", undefined, true)}>
              Build it with this change
            </Button>
          ) : null,
        ])}
      </div>
      {confirming === "drop" || confirming === "overrule" ? (
        <ConfirmCard
          key={confirming}
          label="Confirm"
          question={confirming === "drop" ? "Drop this idea?" : "Build it against the verdict?"}
          detail={confirming === "drop" ? undefined : "This is recorded as an overrule."}
          confirm="Yes"
          cancel="No"
          destructive={confirming === "drop"}
          busy={state.isLoading}
          onConfirm={() => void submit(confirming)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === "change" && (
        <ConfirmCard
          label="Change the idea"
          question={<label htmlFor={`change-note-${idea.id}`}>What should change?</label>}
          detail="Research runs again with your change, and you see a new verdict before anything is built."
          confirm="Research it again with this change"
          cancel="Not now"
          destructive={false}
          busy={!changeNote.trim() || state.isLoading}
          onSubmit={changeSubmit}
          onCancel={() => setConfirming(null)}
        >
          <Textarea id={`change-note-${idea.id}`} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} rows={4} />
        </ConfirmCard>
      )}
      {withChange && <p className="text-sm text-ink-muted">“Build it with this change” builds the idea with research’s change as part of what is asked for; “Build it as described” builds your own words.</p>}
      {redLine ? (
        <p className="text-sm text-ink-muted">Overruling is not offered: no one may build over a red line.</p>
      ) : (
        verdict.outcome === "do-not-build" && <p className="text-sm text-ink-muted">Overruling is your call. The project will carry a note that research advised against it.</p>
      )}
      {error && <Alert tone="bad" title={`Your decision was not recorded: ${error}`} />}
      <DecisionHistory idea={idea} />
    </div>
  );
}

/** How research reached this verdict: its strands, searches, sources and confidence, each said once. */
function Method({ idea }: { idea: Idea }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const verdict = idea.verdict;
  const method = verdict?.method;
  if (!verdict || !method) return null;
  // With no web search there is nothing to count: the hero says so, once; here only the confidence remains.
  const unsearched = nothingSearched(verdict);
  const line = unsearched ? (method.confidence ? `${titleCase(method.confidence)} confidence` : null) : methodFacts(idea);
  return (
    <>
      <h2 id="method-title" className="flex items-center gap-2 text-base font-semibold">
        <Icon name="research" className="size-5 text-ink" />
        How this was researched
      </h2>
      {line && <p className="text-ink-body">{line}</p>}
      {method.summary && <p className="text-ink-body">{method.summary}</p>}
      {(method.argued || method.contractors !== null) && (
        <p className="text-sm text-ink-muted">{[method.argued ? `The case ${method.argued}` : null, method.contractors !== null ? `${plural(method.contractors, "contractor")} briefed` : null].filter(Boolean).join(" · ")}</p>
      )}
      {method.strands.length > 0 && (
        <ul aria-label="Strands" className="flex flex-col divide-y border-y">
          {method.strands.map((x) => (
            <li key={x.id} className="flex min-w-0 flex-col py-2">
              <span className="font-medium">{strandLabel(x.title)}</span>
              {!unsearched && method.strands.length > 1 && (x.searches !== null || x.sources !== null || x.confidence) && (
                <span className="text-sm text-ink-muted">
                  {[x.searches !== null ? plural(x.searches, "search", "searches") : null, x.sources !== null ? plural(x.sources, "source") : null, x.confidence ? `${x.confidence} confidence` : null].filter(Boolean).join(" · ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {verdict.placement && <p className="text-ink-body">Suggested home: {verdict.placement.name ?? verdict.placement.project}</p>}
      {verdict.rulesApplied.length > 0 && (
        <ul aria-label="Rules applied" className="flex flex-col gap-1 text-sm text-ink-body">
          {verdict.rulesApplied.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      )}
      {technical && method.searches.length > 0 && (
        <ul aria-label="Searches" className="flex flex-col gap-1 font-mono text-xs text-ink-body">
          {method.searches.map((q, i) => (
            <li key={i} className="break-words">
              {q}
            </li>
          ))}
        </ul>
      )}
      {method.sources.length > 0 && <EverySource sources={method.sources} />}
      <Link href={paths.run(idea.runId)} className={cn(LINK, "inline-flex min-h-touch items-center self-start")}>
        See every step
      </Link>
    </>
  );
}

/**
 * Every source research read, listed plainly — the method is itself in a card or a fold, so never a fold inside
 * one (ARCH-011). In normal mode each site once, with how many pages were read there; in technical mode every
 * address. A long list shows its first few and "Show all".
 */
function EverySource({ sources }: { sources: string[] }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const all = [...new Set(sources)];
  const sites = technical ? all.map((url) => ({ site: url, url, pages: 1 })) : sourceSites(all);
  const { shown, control } = useShowAll(sites, SOURCES_SHOWN, technical ? "sources" : "sites");
  return (
    <section aria-label="Every source" className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-sm font-semibold text-ink">
        {technical || sites.length === all.length ? `Every source (${formatNumber(all.length)})` : `${plural(all.length, "source")}, from ${plural(sites.length, "site")}`}
      </h3>
      <ul className="flex flex-col">
        {shown.map((x) => (
          <li key={x.url} className="flex min-w-0 items-baseline justify-between gap-3">
            <SourceLink url={x.url} />
            {x.pages > 1 && <span className="shrink-0 text-sm tabular-nums text-ink-muted">{plural(x.pages, "page")}</span>}
          </li>
        ))}
      </ul>
      {control}
    </section>
  );
}

/**
 * Research's track record here: how often it says no, and how each overrule turned out. One card, the two halves
 * side by side from a tablet up, so neither is a short card stretched beside a long one; on a phone two folds,
 * held together under one heading.
 */
function TrackRecord({ idea }: { idea: Idea }) {
  const phone = useViewport() === "phone";
  const r = idea.record;
  if (phone)
    return (
      <FoldGroup label="Research's record" summary={r.total === 0 ? "The first verdict here" : `${formatNumber(r.doNotBuild)} of ${formatNumber(r.total)} verdicts here said do not build`}>
        <Fold title="How often research says no" summary={r.total === 0 ? "The first verdict here" : `${formatNumber(r.doNotBuild)} of ${formatNumber(r.total)} said do not build`}>
          <section aria-label="How often research says no" className="flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card">
            <Refusals idea={idea} />
          </section>
        </Fold>
        <Fold title="When you overruled" summary={r.overruled.length === 0 ? "Not yet" : plural(r.overruled.length, "idea")}>
          <section aria-label="When you overruled" className="flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card">
            <Overrules idea={idea} />
          </section>
        </Fold>
      </FoldGroup>
    );
  return (
    <section aria-label="Research's record" className={cn("grid grid-cols-1 gap-6 rounded-md border bg-surface p-5 shadow-card md:grid-cols-2 md:gap-0 md:divide-x sm:p-6", RISE)}>
      <section aria-label="How often research says no" className="flex min-w-0 flex-col gap-3 md:pr-6">
        <Refusals idea={idea} />
      </section>
      <section aria-label="When you overruled" className="flex min-w-0 flex-col gap-3 border-t pt-6 md:border-t-0 md:pl-6 md:pt-0">
        <Overrules idea={idea} />
      </section>
    </section>
  );
}

function Refusals({ idea }: { idea: Idea }) {
  const r = idea.record;
  // The verdict tags' own colours: build green, change the accent, do not build red — one outcome palette.
  const rows: { label: string; n: number; tone: "success" | "primary" | "attention" }[] = [
    { label: "Build", n: r.build, tone: "success" },
    { label: "Change", n: r.change, tone: "primary" },
    { label: "Do not build", n: r.doNotBuild, tone: "attention" },
  ];
  return (
    <>
      <h2 className={SECTION}>How often research says no</h2>
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
                <span className="font-semibold tabular-nums">
                  {formatNumber(row.n)} of {formatNumber(r.total)}
                </span>
              </div>
              <Bar value={percent(row.n, r.total)} label={`${row.label}: ${row.n} of ${r.total}`} tone={row.tone} />
            </div>
          ))}
          {r.doNotBuild === 0 && r.total >= 5 && <p className="text-sm text-attention-text">Research has not said no once in {formatNumber(r.total)} verdicts. Treat that as a fault.</p>}
        </div>
      )}
    </>
  );
}

function Overrules({ idea }: { idea: Idea }) {
  const { shown, control } = useShowAll(idea.record.overruled, OVERRULES_SHOWN, "overrules");
  return (
    <>
      <h2 className={SECTION}>When you overruled</h2>
      {idea.record.overruled.length === 0 ? (
        <p data-state="empty" className="text-ink-muted">
          You have not overruled research yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y border-t">
          {shown.map((o) => (
            <li key={o.ideaId}>
              <Link href={paths.idea(o.ideaId)} className="flex min-w-0 flex-col gap-0.5 rounded-xs py-2.5 text-ink hover:text-primary-link">
                <span className="font-semibold" title={titleCase(o.title)}>
                  {wordClamp(titleCase(o.title))}
                </span>
                <span className="text-sm text-ink-body">
                  Research said {OUTCOME[o.verdict].toLowerCase()}. {overruledOutcome(o.outcome)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {control}
    </>
  );
}

/** How an overruled idea turned out, as a sentence: the control plane sends a status word. */
function overruledOutcome(outcome: string): string {
  const words: Record<string, string> = { finished: "It was built.", building: "It is being built.", failed: "The build did not succeed.", dropped: "It was dropped later.", live: "It is live." };
  if (words[outcome]) return words[outcome];
  const t = outcome.trim();
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : "";
}

const STRANDS: Record<string, string> = { existing: "existing products", gap: "the gap", demand: "demand" };

function strandLabel(strand: string): string {
  return STRANDS[strand] ?? strand;
}
