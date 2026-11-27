import { useId, useState } from "react";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale, Spinner } from "@/components/states";
import { Disclosure } from "@/components/Fold";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { ConfirmCard } from "@/components/ui/confirm";
import { LINK } from "@/components/ui/layout";
import { formatCredits, timeAgo } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { effectiveRole, roleRank } from "@/lib/roles";
import { navigate, paths, useLocation } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useDismissSuggestionMutation, useEstimateIdeaMutation, useEstimateSuggestionsMutation, useGetMeQuery, useGetRunQuery, useGetSuggestionsQuery, useStartSuggestionsMutation, useTakeSuggestionMutation } from "@/store/api";
import type { AskEstimate, Run, Suggestion } from "@/store/types";
import { AppShell } from "../shell/AppShell";
import { placements, scopeName } from "../workforce/workforceModel";
import { reuseLabel } from "../apps/appModel";
import { suggestingState } from "./suggestionsModel";

const POLL_WHILE_SUGGESTING_MS = 10_000;

/**
 * The cards: one under another, each the page's width and ending with its content — so cards of different heights
 * leave no holes and a lone card is never half a page. From 1280 each card is two columns inside: the idea and
 * its choices beside why it is suggested.
 */
const CARDS = "grid grid-cols-1 items-start gap-5";

/**
 * Ideas from your portfolio (UC-120): ask for suggestions — the most it can cost first — read each
 * with the gap it fills, why this organisation is placed to build it and what it would reuse, and
 * take one (it becomes an idea and is researched, its own estimate first) or set it aside.
 */
export function SuggestionsView() {
  const { search } = useLocation();
  const me = useGetMeQuery(undefined);
  // The active organisation and its tree: the entered one in God mode, the person's own otherwise.
  const tree = useActiveTree();
  const org = useActiveOrganisation().organisation;
  const scope = search.get("scope") || org?.slug || "";
  const [started, setStarted] = useState<Run | null>(null);
  // A refusal to set one aside is said here: the card itself has gone and come back by then.
  const [pageProblem, setPageProblem] = useState<string | null>(null);
  const query = useGetSuggestionsQuery(scope, { skip: !scope, pollingInterval: started ? POLL_WHILE_SUGGESTING_MS : 0 });
  const startedRun = useGetRunQuery(started?.id ?? "", { skip: !started, pollingInterval: started ? POLL_WHILE_SUGGESTING_MS : 0 });
  const suggesting = started ? suggestingState(startedRun.data?.status ?? started.status) : null;
  const view = viewOf(query);
  const builder = roleRank(effectiveRole(tree.data, me.data, scope)) >= roleRank("builder");
  const here = scopeName(tree.data, scope);
  const open = view.kind === "loaded" ? view.data.filter((x) => x.status === "open") : [];
  const closed = view.kind === "loaded" ? view.data.filter((x) => x.status !== "open") : [];

  return (
    <AppShell
      crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), ...(scope.includes("/") ? [{ label: here }] : []), { label: "Ideas from your portfolio" }]}
      aside={scope ? <AskForIdeas scope={scope} here={here} canAsk={builder} started={started} suggesting={suggesting} onStarted={setStarted} /> : undefined}
    >
      <PageHeader
        className={RISE}
        title="Ideas from your portfolio"
        lead={`Products ${here} is well placed to build, from what it already runs and has researched. Taking one starts its research, like any idea.`}
        actions={<DivisionPicker scope={scope} />}
      />

      {me.data && !scope ? (
        <Empty icon="organisation" title="There is nothing to suggest from until your organisation is named" />
      ) : (
        <>
          {view.kind === "loading" && (
            <Loading label="Loading the suggested ideas" className={CARDS}>
              <Skeleton className="h-64 rounded-md" />
              <Skeleton className="h-64 rounded-md" />
            </Loading>
          )}
          {view.kind === "failed" && <Failed title="The suggested ideas could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
          {pageProblem && <Alert tone="bad" title={pageProblem} />}
          {view.kind === "loaded" && (
            <>
              {view.stale && <Stale reason={view.stale.reason} />}
              {open.length === 0 ? (
                <Empty
                  icon="research"
                  title={suggesting?.title ?? "No suggestions waiting"}
                  action={
                    suggesting && started ? (
                      <Link href={paths.run(started.id)} className={LINK}>
                        {suggesting.link}
                      </Link>
                    ) : undefined
                  }
                >
                  {suggesting?.text ?? "Ask for ideas and Endgame looks at what you already hold for gaps worth filling."}
                </Empty>
              ) : (
                <ul aria-label="Suggested ideas" className={CARDS}>
                  {open.map((x, i) => (
                    <ErrorBoundary key={x.id} name={`The suggestion “${x.title}”`}>
                      <SuggestionCard suggestion={x} scope={scope} index={i} canAct={builder} onRefused={setPageProblem} />
                    </ErrorBoundary>
                  ))}
                </ul>
              )}
              {closed.length > 0 && (
                <Disclosure title={`Taken or set aside (${closed.length})`}>
                  <ul aria-label="Taken or set aside" className="flex flex-col divide-y">
                    {closed.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                        <span className="min-w-0 break-words">{x.title}</span>
                        {x.status === "taken" && x.ideaId ? (
                          <Link href={paths.idea(x.ideaId)} className={cn(LINK, "flex items-center touch:min-h-touch")}>
                            Taken — see its research
                          </Link>
                        ) : (
                          <Badge tone="neutral">{x.status === "taken" ? "Taken" : "Set aside"}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              )}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

function DivisionPicker({ scope }: { scope: string }) {
  const tree = useActiveTree();
  const id = useId();
  const options = placements(tree.data).filter((o) => o.depth <= 1);
  if (options.length <= 1) return null;
  return (
    <Field id={id} label="Suggest for" className="w-full sm:w-80">
      <Select id={id} value={scope} onChange={(e) => navigate(paths.suggestions(e.target.value))}>
        {options.map((o) => (
          <option key={o.scope} value={o.scope}>
            {o.depth === 0 ? `The whole of ${o.label}` : o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function AskForIdeas({ scope, here, canAsk, started, suggesting, onStarted }: { scope: string; here: string; canAsk: boolean; started: Run | null; suggesting: ReturnType<typeof suggestingState>; onStarted: (r: Run) => void }) {
  const [estimate, estimating] = useEstimateSuggestionsMutation();
  const [start, starting] = useStartSuggestionsMutation();
  const [cost, setCost] = useState<AskEstimate | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const see = async () => {
    setProblem(null);
    try {
      setCost(await estimate(scope).unwrap());
    } catch (e) {
      setProblem(`No estimate could be made: ${describeError(e as never)} Nothing was started.`);
    }
  };
  const go = async () => {
    setProblem(null);
    try {
      const r = await start(scope).unwrap();
      onStarted(r.run);
      setCost(null);
    } catch (e) {
      setProblem(`The suggestions were not started: ${describeError(e as never)}`);
    }
  };

  return (
    <section aria-labelledby="ask-ideas-title" className={cn("flex flex-col gap-3", RISE)}>
      <h2 id="ask-ideas-title" className="text-base font-semibold">
        Ask for ideas
      </h2>
      <p className="text-ink-body">Endgame reads what {here} holds — its apps, projects and the ideas it has researched — and suggests up to five products that fill a gap.</p>
      {started && suggesting ? (
        <div role="status" className="flex flex-col gap-2 rounded-sm border bg-ground px-4 py-3">
          <span className="font-semibold">{suggesting.title}.</span>
          <span className="text-ink-body">{suggesting.text}</span>
          <Link href={paths.run(started.id)} className={cn(LINK, "self-start")}>
            {suggesting.link}
          </Link>
        </div>
      ) : cost ? (
        <ConfirmCard
          label="What asking for ideas costs"
          question={`About ${formatCredits(cost.credits)}.`}
          detail={cost.basis || undefined}
          confirm={starting.isLoading ? "Starting…" : "Suggest ideas"}
          cancel="Not now"
          destructive={false}
          busy={starting.isLoading}
          onConfirm={() => void go()}
          onCancel={() => setCost(null)}
        />
      ) : canAsk ? (
        <Button variant="secondary" className="self-start phone:self-stretch" onClick={() => void see()} disabled={estimating.isLoading}>
          {estimating.isLoading ? (
              <>
                <Spinner inherit />
                Working it out…
              </>
            ) : "See what it costs"}
        </Button>
      ) : (
        <p className="text-sm text-ink-muted">Asking for ideas spends credits, so it needs the Builder role here.</p>
      )}
      {problem && <Alert tone="bad" title={problem} />}
    </section>
  );
}

function SuggestionCard({ suggestion, scope, index, canAct, onRefused }: { suggestion: Suggestion; scope: string; index: number; canAct: boolean; onRefused: (text: string | null) => void }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [estimateIdea, estimating] = useEstimateIdeaMutation();
  const [take, taking] = useTakeSuggestionMutation();
  const [dismiss] = useDismissSuggestionMutation();
  const [cost, setCost] = useState<AskEstimate | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const price = async () => {
    setProblem(null);
    try {
      setCost(await estimateIdea({ text: suggestion.idea, constraints: [] }).unwrap());
    } catch (e) {
      setProblem(`No estimate could be made for its research: ${describeError(e as never)}`);
    }
  };
  const confirm = async () => {
    setProblem(null);
    try {
      const idea = await take({ scope, id: suggestion.id, constraints: [] }).unwrap();
      navigate(paths.idea(idea.id));
    } catch (e) {
      setProblem(`It was not taken: ${describeError(e as never)} It is still here.`);
    }
  };
  const setAside = async () => {
    setProblem(null);
    onRefused(null);
    try {
      await dismiss({ scope, id: suggestion.id }).unwrap();
    } catch (e) {
      onRefused(`“${suggestion.title}” was not set aside: ${describeError(e as never)} It is back in the list.`);
    }
  };

  // A product reused twice is one chip.
  const reuses = [...new Set(suggestion.reuses.map((r) => (technical ? r : reuseLabel(r))))];
  return (
    <li data-suggestion={suggestion.id} className={cn("flex min-w-0 flex-col gap-4 rounded-md border bg-surface p-5 shadow-card sm:p-6 xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start xl:gap-x-10", RISE, stagger(index))}>
      {/* Below 1280 one column, the choices last; from 1280 the idea and its choices beside why it is suggested. */}
      <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="line-clamp-2 break-words font-display text-lg font-semibold" title={suggestion.title}>
            {suggestion.title}
          </h2>
          <span className="text-sm text-ink-muted">Suggested {timeAgo(suggestion.createdAt)}</span>
        </div>
        <p className="text-ink-body">{suggestion.idea}</p>
        {technical && (
          <code className="break-all font-mono text-xs text-ink-muted">
            {suggestion.id} · run {suggestion.runId}
          </code>
        )}
        <div className="order-last flex flex-col gap-3 xl:order-none">
          {canAct &&
            (cost ? (
              <ConfirmCard
                label="What researching it costs"
                question={`Researching it costs about ${formatCredits(cost.credits)}.`}
                detail={cost.basis || undefined}
                confirm={taking.isLoading ? "Starting…" : "Research this idea"}
                cancel="Not now"
                destructive={false}
                busy={taking.isLoading}
                onConfirm={() => void confirm()}
                onCancel={() => setCost(null)}
              />
            ) : (
              <div className="flex flex-wrap gap-2 phone:flex-col phone:items-stretch">
                <Button onClick={() => void price()} disabled={estimating.isLoading}>
                  {estimating.isLoading ? (
                    <>
                      <Spinner inherit />
                      Working it out…
                    </>
                  ) : (
                    "Take this idea"
                  )}
                </Button>
                <Button variant="secondary" onClick={() => void setAside()}>
                  Set it aside
                </Button>
              </div>
            ))}
          {problem && <Alert tone="bad" title={problem} />}
          {!canAct && <p className="text-sm text-ink-muted">Taking an idea starts research, which spends credits, so it needs the Builder role here.</p>}
        </div>
      </div>
      <dl className="flex min-w-0 flex-col divide-y border-y xl:border-y-0">
        <div className="flex flex-col gap-0.5 py-3 xl:pt-0">
          <dt className="text-sm font-semibold">The gap it fills</dt>
          <dd className="m-0 text-ink-body">{suggestion.gap}</dd>
        </div>
        <div className="flex flex-col gap-0.5 py-3">
          <dt className="text-sm font-semibold">Why you are placed to build it</dt>
          <dd className="m-0 text-ink-body">{suggestion.whyUs}</dd>
        </div>
        {reuses.length > 0 && (
          <div className="flex flex-col gap-1.5 py-3">
            <dt className="text-sm font-semibold">What it would reuse</dt>
            <dd className="m-0 flex min-w-0 flex-wrap gap-1.5">
              {reuses.map((r) => (
                <Chip key={r}>{r}</Chip>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}
