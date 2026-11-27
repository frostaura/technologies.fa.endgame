import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ConfirmCard } from "@/components/ui/confirm";
import { Disclosure, Fold } from "@/components/Fold";
import { useViewport } from "@/lib/useViewport";
import { useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Markdown } from "@/components/Markdown";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Alert, STATES, StatusTag } from "@/components/ui/alert";
import { NO_VALUE, Stat, StatRow } from "@/components/ui/stat";
import { SECTION, SideCard, TITLE, useShowAll } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { capitalise, formatCredits, formatDate, headlineCredits, formatNumber, formatTime, plural, share } from "@/lib/format";
import { ESTIMATE_FLOOR, spentAgainst } from "@/lib/estimates";
import { RISE } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { plainOrNull } from "@/lib/plain";
import { breakpoints } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useControlRunMutation, useGetAppQuery, useGetRunQuery } from "@/store/api";
import type { Run, RunEvent, RunStatus } from "@/store/types";
import type { StreamStatus } from "@/store/runsSlice";
import { AppShell } from "../shell/AppShell";
import { usePageConversation } from "../conversation/pageConversation";
import { accuracy, deriveRun, estimateName, EXPIRED, isStartDeclined, isTerminal, lastSeq, planItemLabel, type DerivedApproval, type DerivedPlan, type DerivedRun, type DerivedTask, type Mode, type PlanItem, type StepTone } from "./runModel";
import { distinctReplies } from "../home/conversationModel";
import { actionCount, buildTimeline, groupCredits, PART_FINISH, PART_START, type TimelineGroup, type TimelineItem, type TimelineStep } from "./timeline";
import { useRunStream } from "./useRunStream";
import { ApprovalCard } from "./ApprovalCard";
import { ANSWER_CUT_OFF } from "./retryModel";
import { TryAgain } from "./TryAgain";
import { curlyQuotes, fullRequest, shortRunName } from "./runHeading";

const STATUS: Record<RunStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Waiting to start", tone: "neutral" },
  running: { label: "Working", tone: "info" },
  waiting: { label: "Waiting for you", tone: "warn" },
  paused: { label: "Paused", tone: "warn" },
  finished: { label: "Finished", tone: "good" },
  failed: { label: "Did not succeed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Work the owner declined at its start: not a failure, and said in the same neutral voice as a pause (D19). */
const DECLINED = { label: "You declined to start this", tone: "neutral" as BadgeTone };
/** A plan the owner declined: their own decision, never a red "did not succeed". */
const PLAN_DECLINED = { label: "Declined by you", tone: "neutral" as BadgeTone };

/** What the work is, said before its name. */
const KIND: Record<Run["kind"], string> = {
  research: "Research",
  build: "Build",
  factory: "Build",
  task: "Work on an app",
  conversation: "Conversation",
  review: "Review",
  suggest: "Suggestions",
};

/** The events that change a run's state: once one arrives after a control, the log is the status again. */
const STATE_EVENTS = new Set(["run.paused", "run.resumed", "run.finished"]);

/** How many of a section's latest steps are drawn at first; earlier ones on request, this many at a time. */
const STEPS_AT_ONCE = 200;
/** On a phone: a screenful or two, so a long run's page opens short. */
const PHONE_STEPS_AT_ONCE = 12;

/** One quiet ink for every step's mark; only a refusal or a failure is marked in red. */
const TONE_CLASS: Record<StepTone, string> = {
  structure: "bg-ground text-ink-body",
  people: "bg-ground text-ink-body",
  factory: "bg-ground text-ink-body",
  money: "bg-ground text-ink-body",
  attention: "bg-attention-tint text-attention-text",
  // A question put to the owner: the waiting tone of an approval (STATES["approval-asked"]), never the alarm.
  approval: "bg-primary-tint text-primary-hover",
  quiet: "bg-ground text-ink-muted",
};

/**
 * Every row of the timeline is one grid — mark | who and what | cost | time — so cost and time sit in the same two columns
 * on every row, and a column can be read straight down. On a phone the time and the cost share one right-hand column.
 */
const ROW = "grid grid-cols-step items-start gap-x-3 sm:grid-cols-step-wide";

/** A media query as state: the side panel is beside the page only where the page keeps room for itself. */
function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (listener) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const q = window.matchMedia(query);
      q.addEventListener("change", listener);
      return () => q.removeEventListener("change", listener);
    },
    () => (typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia(query).matches),
    () => true,
  );
}

export function RunView({ runId }: { runId: string }) {
  const query = useGetRunQuery(runId);
  const view = viewOf(query);
  // The active organisation: the entered one in God mode, the person's own otherwise.
  const org = useActiveOrganisation().organisation;
  // Beside the page from 1280: below it the page needs the whole width (a 1024 laptop, a phone on its side), and the
  // tasks are drawn in the page instead.
  const beside = useMinWidth(breakpoints.xl);
  const name = view.kind === "loaded" ? shortRunName(view.data.title) : "Work";
  // The conversation at the level the work belongs to (its app, project or division), docked beside it (ARCH-012).
  const talk = usePageConversation(view.kind === "loaded" && view.data.scope ? { scope: view.data.scope } : null);
  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), { label: name }]} aside={view.kind === "loaded" && beside ? <RunAside runId={runId} /> : undefined} talk={talk}>
      {view.kind === "loading" && <RunSkeleton />}
      {view.kind === "failed" && (
        <Failed title={view.status === 404 ? "This work could not be found" : "This work could not be loaded"} reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />
      )}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <RunBody run={view.data} refetch={() => void query.refetch()} inline={!beside} />
        </>
      )}
    </AppShell>
  );
}

function RunSkeleton() {
  return (
    <Loading label="Loading the work" className="flex flex-col gap-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-24 rounded-md" />
      <Skeleton className="h-64 rounded-md" />
    </Loading>
  );
}

function RunBody({ run, refetch, inline }: { run: Run; refetch: () => void; inline: boolean }) {
  const [retry, setRetry] = useState(0);
  const log = useRunStream(run.id, retry);
  const mode = useAppSelector((s) => s.ui.mode);
  // Derived once per batch of events, not once per render: a long build carries thousands of them.
  const derived = useMemo(() => deriveRun(log.events), [log.events]);
  const [control, controlState] = useControlRunMutation();
  const [controlError, setControlError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // What a pause, resume or cancel just did, and how far the log had got then: until the log itself records a change
  // of state after it, the screen keeps the answer, so a button never flips back to what it was before it was pressed.
  const [settled, setSettled] = useState<{ status: RunStatus; seq: number } | null>(null);
  const logMoved = settled !== null && log.events.some((e) => e.seq > settled.seq && STATE_EVENTS.has(e.type));

  // The log speaks for the run only once it has caught up with what the run's own read saw: while an old run's log is
  // still arriving, its first events ("started") would say "Working" about work that ended long ago.
  const caughtUp = lastSeq(log.events) >= run.lastSeq || log.stream === "failed";
  const fromLog = caughtUp ? derived.status : null;
  // While a control request is in flight the optimistic status wins; then what it did; afterwards the log.
  const status: RunStatus = controlState.isLoading ? run.status : settled && !logMoved ? settled.status : (fromLog ?? run.status);
  const terminal = isTerminal(status);
  // What the page knows of the run beyond its log (whether it can be tried again) was read while it ran: once the log
  // says it ended, read it again, so "Try again" is offered here as it is on the idea's page (D20).
  const logEnded = isTerminal(derived.status);
  useEffect(() => {
    if (logEnded && !isTerminal(run.status)) refetch();
  }, [logEnded, run.status, refetch]);
  // A declined start finishes cancelled with reason declined_at_start (older runs: failed, known by the summary).
  const declined = (status === "failed" || status === "cancelled") && (isStartDeclined(derived.finishedSummary, derived.finishedReason) || isStartDeclined(run.summary, run.reason));
  const planDeclined = status === "failed" && !declined && [run.summary, derived.finishedSummary].some((s) => s?.startsWith("The owner rejected the plan"));
  // run.finished's summary may be technical (ARCH-004); normal mode says the closing message instead. A conversation's
  // outcome is its reply, as written (D13).
  const reply = run.kind === "conversation" ? (distinctReplies(derived.messages).at(-1)?.text ?? null) : null;
  const lastPlain = [...derived.messages].reverse().find((m) => m.from !== "owner" && plainOrNull(m.text))?.text ?? null;
  const said = reply ?? plainOrNull(derived.finishedSummary) ?? (derived.finishedSummary ? lastPlain : null);
  const outcome = mode === "technical" ? [derived.finishedSummary, derived.finishedDetail ?? run.detail].filter(Boolean).join("\n\n") || null : said && curlyQuotes(said);
  const badge = declined ? DECLINED : planDeclined ? PLAN_DECLINED : STATUS[status];
  // The figure shown before the work began, and the plan's re-estimate beside it (R2-8); a log with no estimate yet
  // leaves the run's own single figure standing in.
  // The server gives both (firstEstimateCredits, planEstimateCredits); an older one only the latest, so the log is read.
  const estimate = run.firstEstimateCredits ?? derived.firstEstimateCredits ?? run.estimateCredits;
  const planned = run.planEstimateCredits !== undefined ? run.planEstimateCredits : derived.plannedEstimateCredits;
  // One figure, from one source: the log's billable settlements, as the ledger counts them, so it is the run's own
  // cost (spentCredits); the run's figure stands in until the log has caught up.
  const spent = log.events.length > 0 && caughtUp ? derived.settledCredits : run.spentCredits;
  const request = useMemo(() => fullRequest(run.title, log.events), [run.title, log.events]);

  const act = async (action: "pause" | "resume" | "cancel") => {
    setControlError(null);
    setConfirmCancel(false);
    try {
      const answered = await control({ id: run.id, action }).unwrap();
      setSettled({ status: answered.status, seq: lastSeq(log.events) });
    } catch (e) {
      setControlError(`Could not ${action}: ${describeError(e as never)}`);
    }
  };

  const actions =
    status === "finished" && derived.app && (run.kind === "build" || run.kind === "task") ? (
      // A build or change that finished leads to what it built: the app itself, and its page here (R7-2).
      <BuiltAppActions appId={derived.app.id} />
    ) : !terminal ? (
      <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "paused" ? (
          <Button onClick={() => void act("resume")} disabled={controlState.isLoading}>
            Resume
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => void act("pause")} disabled={controlState.isLoading}>
            Pause
          </Button>
        )}
        <Button variant="danger-outline" aria-expanded={confirmCancel} onClick={() => setConfirmCancel(true)} disabled={controlState.isLoading}>
          Cancel
        </Button>
      </div>
      </div>
    ) : null;
  // The confirmation opens straight under the header's last row, which holds "Cancel", anchored to its right
  // edge: the actions stay where they were, rather than wrapping to make room for the card.
  const cancelCard =
    !terminal && confirmCancel ? (
      <ConfirmCard
        label="Confirm cancelling"
        question="Stop this work for good?"
        confirm="Yes, cancel it"
        cancel="Keep going"
        busy={controlState.isLoading}
        onConfirm={() => void act("cancel")}
        onCancel={() => setConfirmCancel(false)}
        className="-mt-2 max-sm:-order-1"
      />
    ) : null;

  const stopped = terminal && status !== "finished" && (run.budgetExhausted || run.canTryAgain);
  // A cancel or a decline is said once, by the offer to start again: its closing line ("Cancelled.") adds nothing.
  const shownOutcome = stopped && (declined || planDeclined || status === "cancelled") ? null : outcome;
  const tasks = hasTasks(run, derived) ? <TasksCard derived={derived} runStatus={run.status} /> : null;

  return (
    <>
      {/* A phone puts the heading first, what waits for an answer straight under it, then the controls (the order
          classes: the header lets go of its box there, so its parts take their own places in the page). */}
      <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4 max-sm:contents", RISE)}>
        <div className="flex min-w-0 max-w-prose flex-col gap-2 max-sm:-order-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <span className="text-sm text-ink-muted">{KIND[run.kind]}</span>
            <StreamBadge stream={log.stream} status={status} />
          </div>
          <h1 className={cn(TITLE, "break-words")} title={run.title}>
            {shortRunName(run.title)}
          </h1>
          {request && <Request text={request} />}
          <p className="text-sm text-ink-muted">
            Started {formatDate(run.startedAt)}, {formatTime(run.startedAt)}
            {terminal && run.finishedAt && ` · ended ${sameDay(run.startedAt, run.finishedAt) ? "" : `${formatDate(run.finishedAt)}, `}${formatTime(run.finishedAt)}`}
          </p>
          {mode === "technical" && (
            <code className="break-all font-mono text-xs text-ink-muted">
              {run.kind} run {run.id} · scope {run.scope}
              {run.employeeId ? ` · employee ${run.employeeId}` : ""} · last event #{run.lastSeq}
            </code>
          )}
        </div>
        {actions && <div className="max-sm:-order-1">{actions}</div>}
      </header>
      {cancelCard}

      {controlError && (
        <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
          {controlError} The work carries on as it was.
        </p>
      )}

      {log.stream === "failed" && (
        <div role="alert" data-state="failed" className="flex flex-wrap items-center gap-3 rounded-md border border-attention-line bg-surface px-5 py-4 text-attention-text">
          {log.streamError} What is shown is everything received so far.
          <Button size="sm" onClick={() => setRetry((n) => n + 1)}>
            Reconnect
          </Button>
        </div>
      )}

      <Approvals runId={run.id} approvals={derived.approvals} />

      {/* Only research ends in a verdict: a build run started from an idea carries its ideaId too, and offers none.
          Research that stopped has no verdict to read, so the link says what is there: the idea (D59). */}
      {terminal && run.kind === "research" && run.ideaId && (
        <Link
          href={paths.idea(run.ideaId)}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-surface px-5 py-4 font-semibold text-ink shadow-card transition hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <span className="flex items-center gap-2">
            <Icon name="research" className="text-ink" />
            {status === "finished" ? "The verdict is ready" : "See the idea"}
          </span>
          <span className="text-primary-link">{status === "finished" ? "Read it" : "Open it"}</span>
        </Link>
      )}

      {(shownOutcome || stopped) && (
        <EndCard tone={status === "failed" && !declined && !planDeclined && !run.budgetExhausted ? "bad" : "plain"} outcome={shownOutcome} technical={mode === "technical"}>
          {stopped && <StoppedPanel run={run} derived={derived} declined={declined} />}
        </EndCard>
      )}

      <CostPanel estimate={estimate} planned={planned} spent={spent} reserved={terminal ? 0 : derived.reservedCredits} scored={derived.scored} notCharged={derived.notCharged} declined={declined} finished={terminal} />

      {/* From 1600 the plan stands beside the steps; narrower, it comes first. */}
      <div className="flex flex-col gap-6 3xl:grid 3xl:grid-cols-run-wide 3xl:items-start">
        {(derived.plan || inline) && (
          <div className="flex min-w-0 flex-col gap-6 3xl:col-start-2 3xl:row-start-1">
            {derived.plan && (
              <Fold title="The plan" summary={planSummary(derived.plan)} icon={<Icon name="plan" />}>
                <PlanPanel plan={derived.plan} mode={mode} publicOnlyNote={derived.publicOnlyNote} terminal={terminal} />
              </Fold>
            )}
            {inline && tasks}
          </div>
        )}
        <div className="flex min-w-0 flex-col 3xl:col-start-1 3xl:row-start-1">
          <Trace events={log.events} mode={mode} derived={derived} stream={log.stream} status={status} replaying={!caughtUp} declined={declined || planDeclined} />
        </div>
      </div>
      {inline && <CreditsNote />}
    </>
  );
}

function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** The whole request, under the short name: two lines, and the rest on request. */
function Request({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [whole, setWhole] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div className="flex flex-col items-start gap-1">
      <p ref={ref} data-testid="run-request" className={cn("break-words text-ink-body", !whole && "line-clamp-2")}>
        {text}
      </p>
      {(cut || whole) && (
        <button type="button" aria-expanded={whole} onClick={() => setWhole((x) => !x)} className="rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover touch:min-h-touch">
          {whole ? "Show less" : "Show all of it"}
        </button>
      )}
    </div>
  );
}

/**
 * The way to the app a finished build or change made: "Open {app}" (the app itself, in a new tab, at the address its page
 * shows) and "Manage {app}" (its page in the console). Shown once the app is read; an app that cannot be read offers neither.
 */
export function BuiltAppActions({ appId }: { appId: string }) {
  const app = useGetAppQuery(appId);
  if (!app.data) return null;
  const { name, addresses } = app.data;
  return (
    <div role="group" aria-label="The app it built" className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
      <a href={addresses.subdomain ?? addresses.path} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants(), "max-sm:w-full")}>
        Open {name}
      </a>
      <Link href={paths.app(appId)} className={cn(buttonVariants({ variant: "secondary" }), "max-sm:w-full")}>
        Manage {name}
      </Link>
    </div>
  );
}

/** "Live" only while the stream is open on work that is under way: never on paused, ended or still-loading work. */
function StreamBadge({ stream, status }: { stream: StreamStatus; status: RunStatus }) {
  if (status !== "running" && status !== "waiting" && status !== "queued") return null;
  if (stream === "open")
    return (
      <span className="flex items-center gap-2 text-sm text-ink-body">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-success motion-reduce:animate-none" />
        Live
      </span>
    );
  if (stream === "reconnecting") return <span className="text-sm text-attention-text">Reconnecting…</span>;
  if (stream === "connecting") return <span className="text-sm text-ink-muted">Connecting…</span>;
  return null;
}

/**
 * How the work ended, in one card: what it says it did (the outcome), and, when it stopped, why and how to start it again.
 * Never a card inside a card. A failure is edged in red; a cancel, a decline or a finish is a plain card.
 */
function EndCard({ tone, outcome, technical, children }: { tone: "bad" | "plain"; outcome: string | null; technical: boolean; children?: ReactNode }) {
  return (
    <section aria-label="How it ended" data-tone={tone} className={cn("flex flex-col gap-4 rounded-md border bg-surface p-5 shadow-card max-sm:p-4", tone === "bad" && "border-attention-line")}>
      {outcome && (
        <div className="flex flex-col gap-2">
          <h2 className={SECTION}>Outcome</h2>
          {technical ? <p className="max-w-prose whitespace-pre-line break-words text-ink-body">{outcome}</p> : <Markdown text={outcome} className="max-w-prose text-ink-body" />}
        </div>
      )}
      {outcome && children && <hr className="border-border" />}
      {children}
    </section>
  );
}

/**
 * Why the work stopped and how to start it again (RUN-10, RUN-11): a budget stop is said plainly with the way to more
 * credits; stopped research, a build or a change offers "Try again", which carries on from where it stopped.
 */
function StoppedPanel({ run, derived, declined }: { run: Run; derived: DerivedRun; declined: boolean }) {
  const cutOff = (derived.finishedReason ?? run.reason) === ANSWER_CUT_OFF;
  const why = run.budgetExhausted ? "budget" : declined ? "start-declined" : cutOff ? "cut-off" : derived.status === "cancelled" || run.status === "cancelled" ? "cancelled" : run.summary?.startsWith("The owner rejected the plan") ? "plan-declined" : "failed";
  if (run.canTryAgain) return <TryAgain runId={run.id} ideaId={run.ideaId} why={why} showCredits={run.budgetExhausted} />;
  // Held by its budget: the amber pause with the way to more credits, never the red crashed panel (ARCH-011).
  return (
    <Alert
      state="paused-by-budget"
      testId="stopped-for-budget"
      title="The credit budget ran out, so this work stopped."
      action={
        <Link href={paths.credits()} className={buttonVariants({ variant: "secondary" })}>
          See credits
        </Link>
      }
    >
      What was finished is kept, and nothing more was charged.
    </Alert>
  );
}

function CostPanel({ estimate, planned, spent, reserved, scored, notCharged, declined, finished }: { estimate: number | null; planned: number | null; spent: number; reserved: number; scored: { estimated: number; actual: number } | null; notCharged: number; declined: boolean; finished: boolean }) {
  const replanned = planned !== null && estimate !== null && Math.abs(planned - estimate) >= 0.005 ? planned : null;
  // Spending is held against the latest figure: the plan's, once there is one.
  const against = replanned ?? estimate;
  const estimateTile = (
    <Stat
      label="Estimate"
      value={estimate !== null ? headlineCredits(estimate) : NO_VALUE}
      caption={estimate === null ? "Not yet made" : replanned !== null ? `Shown before the work began; ${formatNumber(replanned)} once planned` : "Shown before the work began"}
    />
  );
  // Work declined at its start never began: there is nothing to score its estimate against (D19).
  if (declined)
    return (
      <StatRow cols={2} label="Cost">
        {estimateTile}
        <Stat label="Charged" value={formatCredits(spent)} caption="You declined to start it, so nothing was done." />
      </StatRow>
    );
  // The one rule for a spent figure (spentAgainst): finished work says "Spent" with no bar; under a 1-credit estimate,
  // no percentage and no alarm. Above it, the percentage names which estimate it is held against (R2-8).
  const spentFigure = spentAgainst(spent, against, finished);
  const spentCaption = against === null ? "Settled from each call’s own cost" : against >= ESTIMATE_FLOOR ? `${share(spent, against)}% of ${estimateName(against, estimate, replanned)}` : spentFigure.caption;
  const tiny = scored !== null && scored.estimated < ESTIMATE_FLOOR;
  const scoredWord = scored ? accuracy(scored.estimated, scored.actual) : null;
  // Four slots, always, in the same order: what was estimated, what is spent, the third figure (held now; scored once done), and what was not charged.
  return (
    <StatRow cols={4} meters={spentFigure.meter !== null} label="Cost" className="lg:grid-cols-4">
      {estimateTile}
      <Stat label={spentFigure.label} value={formatCredits(spent)} caption={spentCaption} meter={spentFigure.meter} />
      {scored && scoredWord ? (
        // The figure slot holds a figure ("79% under"); a cost exactly on the estimate says so in a word; an estimate too small
        // to measure against holds none.
        <Stat
          label="Estimate against actual"
          value={tiny ? NO_VALUE : scoredWord === "on the estimate" ? "Exact" : scoredWord}
          caption={tiny ? `${capitalise(scoredWord)}: cost ${formatNumber(scored.actual)}` : `${scoredWord === "on the estimate" ? "On the estimate. " : ""}Against ${estimateName(scored.estimated, estimate, replanned)}: cost ${formatNumber(scored.actual)}`}
        />
      ) : (
        <Stat label="Held for calls in flight" value={formatCredits(reserved)} caption="Reserved before each call, released when it settles" />
      )}
      <Stat label="Not charged" value={formatCredits(notCharged)} caption="Repairs of the work’s own mistakes, never billed" />
    </StatRow>
  );
}

/**
 * The approvals the work waits on, each answerable; and those its end closed before anyone answered (R3-2), shown closed
 * with that said, so a question nobody answered is never left looking like one still waiting.
 */
function Approvals({ runId, approvals }: { runId: string; approvals: DerivedApproval[] }) {
  const pending = approvals.filter((a) => a.answer === null);
  const expired = approvals.filter((a) => a.answer === EXPIRED);
  const phone = useViewport() === "phone";
  const ref = useRef<HTMLElement>(null);
  const [outOfView, setOutOfView] = useState(false);
  // On a phone, an approval scrolled out of sight leaves a bar pinned at the top until it is answered.
  useEffect(() => {
    const el = ref.current;
    if (!phone || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setOutOfView(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [phone, pending.length]);
  return (
    <>
      {phone && pending.length > 0 && outOfView && (
        <button
          type="button"
          data-pinned-approval=""
          onClick={() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="fixed inset-x-0 top-0 z-30 flex min-h-touch items-center gap-3 border-b bg-surface px-4 pb-2 pt-safe-t text-left text-ink shadow-raised"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
            <StatusTag state="approval-asked" className="self-start">
              {pending.length === 1 ? "Waiting for your approval" : `${formatNumber(pending.length)} approvals wait for you`}
            </StatusTag>
            <span className="truncate text-sm text-ink-body">{pending[0]?.question ?? ""}</span>
          </span>
          <span className="shrink-0 pt-2 font-semibold text-primary-link">Answer</span>
        </button>
      )}
      {pending.length > 0 && (
        <section ref={ref} aria-label="Waiting for your approval" className="flex scroll-mt-4 flex-col gap-3 max-sm:-order-2">
          {pending.map((a) => (
            <ApprovalCard key={a.id} runId={runId} approval={a} />
          ))}
        </section>
      )}
      {expired.length > 0 && (
        <section aria-label="No longer waiting" className="flex flex-col gap-3">
          {expired.map((a) => (
            <ApprovalCard key={a.id} runId={runId} approval={a} />
          ))}
        </section>
      )}
    </>
  );
}

/** What the folded plan says on a phone: how far it has got. */
function planSummary(plan: DerivedPlan): string {
  const passed = plan.items.filter((i) => i.result === "passed").length;
  const state = plan.accepted ? "Agreed" : "Proposed";
  return plan.items.length > 0 ? `${state} · ${formatNumber(passed)} of ${plural(plan.items.length, "part")} done` : state;
}

/** A part of the plan's state, in the one vocabulary: passed, sent back, or still to do. */
function itemState(item: PlanItem, terminal: boolean): { label: string; tone: BadgeTone } {
  if (item.result === "passed") return { label: "Passed its check", tone: "good" };
  if (item.result === "failed") return terminal ? { label: "Did not pass", tone: "bad" } : { label: "Sent back", tone: "warn" };
  return { label: "To do", tone: "neutral" };
}

/**
 * The plan as a contract: each item in the owner's words, with whether it passed its check, the tag in one place on every
 * item. The files, endpoints and test commands behind each item are technical detail, shown in technical mode.
 */
function PlanPanel({ plan, mode, publicOnlyNote, terminal }: { plan: DerivedPlan; mode: Mode; publicOnlyNote: string | null; terminal: boolean }) {
  const technical = mode === "technical";
  const passed = plan.items.filter((i) => i.result === "passed").length;
  // A change's last part re-checks what the app already did: those are not things the owner just asked for.
  const earlier = new Set(plan.items.filter((i) => i.id === "keep").flatMap((i) => i.covers));
  const asked = plan.requirements.filter((r) => !earlier.has(r.id));
  const kept = plan.requirements.filter((r) => earlier.has(r.id));
  return (
    <section aria-labelledby="plan-title" className="flex min-w-0 flex-col gap-4 rounded-md border bg-surface p-5 shadow-card max-sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="plan-title" className={cn(SECTION, "flex items-center gap-2")}>
          <Icon name="plan" className="text-ink" />
          The plan
        </h2>
        <span className="flex flex-wrap items-center gap-2">
          {plan.items.length > 0 && <span className="text-sm text-ink-muted">{`${formatNumber(passed)} of ${plural(plan.items.length, "part")} done`}</span>}
          <Badge tone={plan.accepted ? "good" : "info"}>{plan.accepted ? "Agreed" : "Proposed"}</Badge>
        </span>
      </div>
      {(technical ? plan.summary : plainOrNull(plan.summary)) && <p className="max-w-prose text-ink-body">{plan.summary}</p>}
      {publicOnlyNote && (
        <p data-testid="plan-public-only" className="flex max-w-prose items-start gap-2 rounded-xs bg-primary-tint px-3 py-2 text-ink-body">
          <Icon name="employee" className="mt-0.5 shrink-0 text-primary-link" />
          {publicOnlyNote}
        </p>
      )}
      {asked.length > 0 && <Requirements title="What you asked for" items={asked} technical={technical} />}
      {kept.length > 0 && <Requirements title="What it already did, checked again" items={kept} technical={technical} />}
      {plan.items.length > 0 && (
        <ol aria-label="Parts of the plan" className="flex flex-col divide-y border-t">
          {plan.items.map((item, index) => {
            const label = planItemLabel(plan, item.id, mode) ?? item.id;
            const check = technical ? item.check : null;
            const evidence = technical ? item.evidence : null;
            const state = itemState(item, terminal);
            return (
              <li key={item.id} data-item={item.id} className="grid grid-cols-numbered items-start gap-x-3 gap-y-1.5 py-3 sm:grid-cols-numbered-tagged">
                <span aria-hidden className="pt-0.5 text-sm tabular-nums text-ink-muted">
                  {formatNumber(index + 1)}
                </span>
                <span className="min-w-0 break-words font-medium">{technical ? `${item.id} · ${label}` : label}</span>
                {/* The tag: always in the right-hand column on a wide card, always under the words on a narrow one. */}
                <span className="col-start-2 flex items-start sm:col-start-3 sm:row-start-1 sm:justify-end">
                  <Badge tone={state.tone}>{state.label}</Badge>
                </span>
                {technical && item.detail && <p className="col-start-2 whitespace-pre-line break-words text-sm text-ink-body">{item.detail}</p>}
                {technical && item.covers.length > 0 && <span className="col-start-2 text-sm text-ink-muted">Covers {item.covers.join(", ")}</span>}
                {!technical && plainOrNull(item.outcome) && <span className="col-start-2 break-words text-sm text-ink-body">{inPart(item.outcome ?? "", label)}</span>}
                {check && <span className="col-start-2 break-words text-sm text-ink-muted">{technical ? `Check: ${check}` : `How it is checked: ${check}`}</span>}
                {evidence && <span className="col-start-2 break-words text-sm text-ink-body">{evidence}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {plan.leftOut.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <h3 className="font-display text-base font-semibold">Left out, on purpose</h3>
          <ul aria-label="Left out" className="flex flex-col gap-1.5">
            {plan.leftOut.map((l, i) => (
              <li key={`${l.requirement}-${i}`} className="max-w-prose text-ink-body">
                <span className="font-medium text-ink">{l.text}</span> {l.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!technical && plan.items.some((i) => i.plain === null) && <p className="text-sm text-ink-muted">The files and tests behind each part are in technical mode.</p>}
    </section>
  );
}

function Requirements({ title, items, technical }: { title: string; items: { id: string; text: string }[]; technical: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      <ul aria-label={title} className="flex list-disc flex-col gap-1 pl-5 text-ink-body">
        {items.map((r) => (
          <li key={r.id}>{technical ? `${r.id} · ${r.text}` : capitalise(r.text)}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------------------------

interface Section {
  key: string;
  /** "Part 2 of 5", or the name of the work before or after the parts. */
  heading: string;
  /** The part's own words. */
  label: string | null;
  items: TimelineItem[];
  state: { label: string; tone: BadgeTone };
  credits: number;
  first: string;
  last: string;
}

/** Lines of the timeline, gathered by the part of the plan they belong to, in the order the work reached them. */
function sectionsOf(items: TimelineItem[], plan: DerivedPlan, mode: Mode, tasks: DerivedTask[], status: RunStatus, declined: boolean): Section[] {
  const byKey = new Map<string, Section>();
  const order: string[] = [];
  const terminal = isTerminal(status);
  for (const item of items) {
    const key = item.part ?? PART_START;
    let section = byKey.get(key);
    if (!section) {
      const index = plan.items.findIndex((i) => i.id === key);
      const heading = key === PART_START ? "Getting ready" : key === PART_FINISH ? "Review and finish" : `Part ${formatNumber(index + 1)} of ${formatNumber(plan.items.length)}`;
      section = { key, heading, label: index >= 0 ? (planItemLabel(plan, key, mode) ?? key) : null, items: [], state: { label: "Done", tone: "good" }, credits: 0, first: item.at, last: item.at };
      byKey.set(key, section);
      order.push(key);
    }
    section.items.push(item);
    if (item.kind === "group") section.credits += item.credits;
    if (item.at && (!section.last || item.at > section.last)) section.last = item.at;
    if (item.at && (!section.first || item.at < section.first)) section.first = item.at;
  }
  const sections = order.map((k) => byKey.get(k)).filter((s): s is Section => !!s);
  sections.forEach((s, i) => {
    const current = i === sections.length - 1;
    const item = plan.items.find((x) => x.id === s.key);
    const task = item ? tasks.find((t) => t.summary === item.text) : undefined;
    if (item) {
      if (item.result === "passed") s.state = { label: "Done", tone: "good" };
      else if (task?.status === "failed" || (item.result === "failed" && terminal)) s.state = { label: "Did not succeed", tone: "bad" };
      else if (current && !terminal) s.state = status === "paused" ? { label: "Paused", tone: "warn" } : { label: "Working", tone: "info" };
      else if (item.result === "failed") s.state = { label: "Sent back", tone: "warn" };
      else s.state = current && terminal ? (declined || status === "cancelled" ? { label: "Ended", tone: "neutral" } : { label: "Stopped", tone: "bad" }) : { label: "Done", tone: "good" };
    } else if (current && !terminal) s.state = status === "paused" ? { label: "Paused", tone: "warn" } : { label: "Working", tone: "info" };
    else if (current && status !== "finished") s.state = declined || status === "cancelled" ? { label: "Ended", tone: "neutral" } : { label: "Stopped", tone: "bad" };
  });
  return sections;
}

function Trace({ events, mode, derived, stream, status, replaying, declined }: { events: RunEvent[]; mode: Mode; derived: DerivedRun; stream: StreamStatus; status: RunStatus; replaying: boolean; declined: boolean }) {
  const plan = derived.plan;
  const parts = useMemo(() => (plan ? plan.items.map((i) => ({ id: i.id, text: i.text })) : []), [plan]);
  const timeline = useMemo(() => buildTimeline(events, mode, (id: string) => planItemLabel(plan, id, mode), parts), [events, mode, plan, parts]);
  const sections = useMemo(() => (plan && parts.length > 0 ? sectionsOf(timeline.items, plan, mode, derived.tasks, status, declined) : null), [plan, parts, timeline, mode, derived.tasks, status, declined]);
  const terminal = isTerminal(status);
  const count =
    mode === "technical"
      ? `${plural(timeline.modelCalls, "model call")} · ${plural(timeline.toolCalls, "tool call")} · ${plural(timeline.denials, "denial")}${timeline.declined > 0 ? ` · ${timeline.declined} declined by you` : ""}`
      : actionCount(timeline.actions, timeline.denials, timeline.declined);
  return (
    <section aria-labelledby="trace-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="trace-title" className={SECTION}>
          {mode === "technical" ? "Trace" : "Step by step"}
        </h2>
        <span className="text-sm text-ink-muted" data-testid="action-count">
          {replaying ? "" : count}
        </span>
      </div>
      {replaying ? (
        <Loading label="Reading what the work did" className="flex flex-col gap-2">
          <Skeleton className="h-14 rounded-sm" />
          <Skeleton className="h-14 rounded-sm" />
          <Skeleton className="h-14 rounded-sm" />
        </Loading>
      ) : timeline.items.length === 0 ? (
        stream === "failed" ? null : terminal ? (
          <p data-state="empty" className="py-1 text-ink-muted">
            This work recorded no steps.
          </p>
        ) : (
          <Loading label="Waiting for the first step" className="flex flex-col gap-2">
            <Skeleton className="h-14 rounded-sm" />
            <Skeleton className="h-14 rounded-sm" />
          </Loading>
        )
      ) : sections ? (
        <ol aria-label="Steps" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
          {sections.map((s, i) => (
            <PartSection key={s.key} section={s} last={i === sections.length - 1} technical={mode === "technical"} />
          ))}
        </ol>
      ) : (
        <Rows items={timeline.items} label="Steps" className="rounded-md border bg-surface shadow-card" />
      )}
    </section>
  );
}

/**
 * One part of the work: a summary line (its state, how much of the run it took, when), open while it is the part the work
 * is on and folded otherwise. A folded part keeps its lines in the page, hidden, so a lesson that points into it opens it
 * (`endgame:reveal`); in technical mode, where a part holds hundreds of events, a folded part draws none of them.
 */
function PartSection({ section, last, technical }: { section: Section; last: boolean; technical: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? last;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const reveal = () => setToggled(true);
    el.addEventListener("endgame:reveal", reveal);
    return () => el.removeEventListener("endgame:reveal", reveal);
  }, []);
  const lines = section.items.reduce((n, item) => n + (item.kind === "group" ? 1 : (item.repeat ?? 1)), 0);
  const credits = section.credits > 0 ? formatCredits(section.credits) : null;
  return (
    <li data-part={section.key} data-open={open || undefined} className="border-b last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setToggled(!open)} className={cn(ROW, "min-h-touch w-full bg-surface px-4 py-3 text-left hover:bg-ground sm:px-5", open && "border-b")}>
        <span aria-hidden className="flex size-8 items-center justify-center">
          <ChevronDown className={cn("size-5 text-ink-muted transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
            <span className="shrink-0 font-semibold text-ink">{section.heading}</span>
            {section.label && (
              <span title={section.label} className="min-w-0 truncate text-ink-body">
                {section.label}
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <Badge tone={section.state.tone}>{section.state.label}</Badge>
            <span>{plural(lines, "line")}</span>
          </span>
        </span>
        <Meta credits={credits} at={section.first} until={section.last} />
      </button>
      <div ref={body} data-fold-body="" hidden={!open}>
        <PartWords.Provider value={section.label}>{(open || !technical) && <Rows items={section.items} label={`Steps: ${section.heading}`} />}</PartWords.Provider>
      </div>
    </li>
  );
}

/** The two right-hand columns: what it cost, and when. */
function Meta({ credits, at, until }: { credits: string | null; at: string | null; until?: string }) {
  return (
    <span className="flex flex-col items-end gap-0.5 text-sm tabular-nums text-ink-muted sm:contents">
      <span className="whitespace-nowrap text-right text-ink-body sm:pt-0.5">{credits}</span>
      <span className="text-right max-sm:order-first sm:pt-0.5">
        {at && <time dateTime={at}>{formatTime(at)}</time>}
        {until && until !== at && formatTime(until) !== formatTime(at ?? "") && (
          <>
            <span className="sr-only"> to </span>
            <span aria-hidden className="block text-xs">
              to {formatTime(until)}
            </span>
          </>
        )}
      </span>
    </span>
  );
}

/** A list of lines: the latest few hundred, and the earlier ones on request, so a long part stays quick to draw. */
function Rows({ items, label, className }: { items: TimelineItem[]; label: string; className?: string }) {
  const phone = useViewport() === "phone";
  const batch = phone ? PHONE_STEPS_AT_ONCE : STEPS_AT_ONCE;
  const [shown, setShown] = useState(batch);
  const hidden = Math.max(0, items.length - shown);
  const latest = hidden > 0 ? items.slice(hidden) : items;
  return (
    <>
      {hidden > 0 && (
        <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b bg-surface px-4 py-3 sm:px-5", className && "mb-3 rounded-md border shadow-card")}>
          <span className="text-ink-body">{`${plural(hidden, "earlier step")} folded away; the latest ${formatNumber(latest.length)} are below.`}</span>
          <Button size="sm" variant="secondary" onClick={() => setShown((n) => n + batch)}>
            {`Show ${plural(Math.min(batch, hidden), "earlier step")}`}
          </Button>
        </div>
      )}
      <OnPhone.Provider value={phone}>
        <ol aria-label={label} className={cn("flex flex-col overflow-hidden", className)}>
          {latest.map((item) => (
            <TimelineRow key={item.key} item={item} />
          ))}
        </ol>
      </OnPhone.Provider>
    </>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "group") return <GroupRow group={item} />;
  return <StepRow item={item} />;
}

/** Long enough that three lines would cut it: offered whole on request. */
const LONG_DETAIL = 320;

/** The words of the part a line sits under: the part's heading says them once, so its lines say "this part". */
const PartWords = createContext<string | null>(null);
/** Whether the timeline is drawn on a phone, where a long line is cut sooner. */
const OnPhone = createContext(false);

/** A line under a part, with the part's own words (said in its heading) as "this part". */
function inPart(text: string, label: string | null): string {
  if (!label) return text;
  const bare = label.replace(/[.!?]+$/, "");
  if (bare.length < 12) return text;
  return text
    .split(`Check: ${bare}`)
    .join("the check of this part")
    .split(`“${bare}”`)
    .join("this part")
    .split(bare)
    .join("this part")
    .replace(/this part\.(\.|$)/g, "this part$1")
    .replace(/(^|[.!?]\s+|\n)this part/g, "$1This part");
}

function StepRow({ item }: { item: TimelineStep }) {
  const [whole, setWhole] = useState(false);
  const words = useContext(PartWords);
  const title = inPart(item.title, words);
  const detail = item.detail && inPart(item.detail, words);
  const phone = useContext(OnPhone);
  const long = !!detail && (detail.length > (phone ? LONG_DETAIL / 2 : LONG_DETAIL) || detail.split("\n").length > 3);
  return (
    <li data-seq={item.seq} className={cn(ROW, "border-b px-4 py-3 last:border-b-0 sm:px-5")}>
      <span className={cn("flex size-8 items-center justify-center rounded-xs", TONE_CLASS[item.tone])}>
        <StepIcon icon={item.icon} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 break-words font-medium">{title}</span>
          {item.repeat && item.repeat > 1 && (
            <span className="shrink-0 text-sm tabular-nums text-ink-muted" title={`Said ${item.repeat} times in a row`}>
              ×{formatNumber(item.repeat)}
            </span>
          )}
        </span>
        {detail && <p className={cn("max-w-prose whitespace-pre-line break-words text-ink-body", !whole && long && "line-clamp-3")}>{detail}</p>}
        {long && (
          <button type="button" aria-expanded={whole} onClick={() => setWhole((x) => !x)} className="self-start rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover touch:min-h-touch">
            {whole ? "Show less" : "Show all of it"}
          </button>
        )}
        {item.raw && item.raw !== "{}" && (
          <Disclosure title={`Raw event #${item.seq}`} className="mt-1">
            <pre className="max-h-96 overflow-auto rounded-xs bg-ground p-3 font-mono text-xs">{item.raw}</pre>
          </Disclosure>
        )}
      </div>
      <Meta credits={item.credits} at={item.at || null} />
    </li>
  );
}

/** A step's mark: an approval asked or answered is the hand (STATES), every other step its sprite icon. */
function StepIcon({ icon }: { icon: TimelineStep["icon"] }) {
  if (icon === "approval-asked" || icon === "approval-answered") {
    const Hand = STATES[icon].icon;
    return <Hand aria-hidden className="size-4" />;
  }
  return <Icon name={icon} className="size-4" />;
}

const GROUP_STATUS: Record<TimelineGroup["status"], { label: string; tone: BadgeTone }> = {
  working: { label: "Working", tone: "info" },
  done: { label: "Done", tone: "good" },
  stopped: { label: "Stopped", tone: "bad" },
};

/** A sub-agent's piece of the work: one line with its outcome, its own steps folded beneath. */
function GroupRow({ group }: { group: TimelineGroup }) {
  const credits = groupCredits(group);
  const words = useContext(PartWords);
  // A check that found the part not working did its job, but what it found is a send-back, never a green "Done".
  const status = group.status === "done" && group.outcome && /^Found (it does not work|\d+ problems?)/.test(group.outcome) ? { label: "Sent back", tone: "warn" as BadgeTone } : GROUP_STATUS[group.status];
  // Open while it works, folded once done, unless the person opened or folded it. A folded piece draws none of its steps.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? group.status === "working";
  return (
    <li data-group={group.agent} data-open={open || undefined} className="border-b last:border-b-0">
      {/* A disclosure row (the timeline's own fold, as a part's is): the whole line opens and folds its steps. */}
      <button type="button" aria-expanded={open} onClick={() => setToggled(!open)} className={cn(ROW, "min-h-touch w-full px-4 py-3 text-left hover:bg-ground sm:px-5")}>
        <span className="flex size-8 items-center justify-center rounded-xs bg-ground text-ink-body">
          <Icon name="contractors" className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="break-words font-medium">{inPart(group.title, words)}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Badge tone={status.tone}>{status.label}</Badge>
            {group.outcome && <span className="min-w-0 break-words text-ink-body">{inPart(group.outcome, words)}</span>}
            {group.searches > 0 && <span className="text-ink-muted">{plural(group.searches, "search", "searches")}</span>}
            <span className="text-primary-link">{open ? "Hide its steps" : `Show its ${plural(group.items.length, "step")}`}</span>
          </span>
        </span>
        <Meta credits={credits} at={group.at || null} />
      </button>
      {open && group.items.length > 0 && (
        <ol aria-label={`Steps: ${group.title}`} className="ml-8 flex flex-col border-l-2 border-border sm:ml-10">
          {group.items.map((item) => (
            <TimelineRow key={item.key} item={item} />
          ))}
        </ol>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Beside the page: the tasks, and where the credits go
// ---------------------------------------------------------------------------------------------

function RunAside({ runId }: { runId: string }) {
  const log = useAppSelector((s) => s.runs[runId]);
  const run = useGetRunQuery(runId).data;
  const events = log?.events;
  const derived = useMemo(() => deriveRun(events ?? []), [events]);
  return (
    <>
      {run && hasTasks(run, derived) && <TasksCard derived={derived} runStatus={run.status} />}
      <CreditsNote />
    </>
  );
}

/** Research and a conversation are never broken into tasks: their page has no empty "Tasks" card. */
function hasTasks(run: Run, derived: DerivedRun): boolean {
  return derived.tasks.length > 0 || (run.kind !== "research" && run.kind !== "conversation");
}

function CreditsNote() {
  const active = useActiveOrganisation();
  return (
    <SideCard title="Where the credits go">
      <p className="text-ink-body">Credits are held before each step and settled from what it really cost. Repairing a mistake of its own is never billed.</p>
      {active.organisation && (
        <Link href={paths.credits()} className={cn(buttonVariants({ variant: "secondary" }), "self-start")}>
          See credits
        </Link>
      )}
    </SideCard>
  );
}

const TASK_STATUS: Record<DerivedTask["status"], { label: string; tone: BadgeTone }> = {
  open: { label: "To do", tone: "neutral" },
  working: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "good" },
  failed: { label: "Did not succeed", tone: "bad" },
};

interface TaskGroup {
  key: string;
  /** The part of the plan the tasks are for, or null for tasks that are not one part's. */
  label: string | null;
  tasks: { task: DerivedTask; role: string }[];
}

/**
 * The tasks gathered under the part of the plan each is for: a part's tasks are its build and its checks, so each line
 * says which ("Build", "Check", "Check after repair 2") rather than repeating the part's words.
 */
function taskGroups(tasks: DerivedTask[], plan: DerivedPlan | null): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  const loose: TaskGroup = { key: "", label: null, tasks: [] };
  for (const task of tasks) {
    const check = task.summary.startsWith("Check: ");
    const words = check ? task.summary.slice("Check: ".length) : task.summary;
    const item = plan?.items.find((i) => i.text === words);
    if (!item || !plan) {
      loose.tasks.push({ task, role: task.summary });
      continue;
    }
    const index = plan.items.indexOf(item);
    let group = groups.get(item.id);
    if (!group) {
      group = { key: item.id, label: `${formatNumber(index + 1)}. ${planItemLabel(plan, item.id, "normal") ?? item.id}`, tasks: [] };
      groups.set(item.id, group);
    }
    const checks = group.tasks.filter((t) => t.role.startsWith("Check")).length;
    group.tasks.push({ task, role: check ? (checks === 0 ? "Check" : `Check ${formatNumber(checks + 1)}`) : item.id === "keep" ? "Check again" : "Build" });
  }
  const ordered = plan ? plan.items.map((i) => groups.get(i.id)).filter((g): g is TaskGroup => !!g) : [];
  return loose.tasks.length > 0 ? [...ordered, loose] : ordered;
}

function TasksCard({ derived, runStatus }: { derived: DerivedRun; runStatus: RunStatus | undefined }) {
  const done = derived.tasks.filter((t) => t.status === "done").length;
  const groups = useMemo(() => taskGroups(derived.tasks, derived.plan), [derived.tasks, derived.plan]);
  // A long plan shows its first parts and "Show all": the card never outgrows the page beside it.
  const shown = useShowAll(groups, 4, "parts");
  return (
    <Fold title="Tasks" summary={derived.tasks.length === 0 ? "None yet" : `${formatNumber(done)} of ${plural(derived.tasks.length, "task")} done`}>
      <SideCard>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="tasks-title" className="text-base font-semibold">
            Tasks
          </h2>
          {derived.tasks.length > 0 && <span className="text-sm text-ink-muted">{`${formatNumber(done)} of ${formatNumber(derived.tasks.length)} done`}</span>}
        </div>
        {derived.tasks.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            {isTerminal(derived.status ?? runStatus) ? "This work was not broken into tasks." : "No tasks yet. They appear here as the work is broken down."}
          </p>
        ) : (
          <ul aria-label="Tasks" className="flex flex-col gap-3">
            {shown.shown.map((g) => (
              <li key={g.key} className="flex min-w-0 flex-col gap-1">
                {g.label && (
                  <span title={g.label} className="truncate text-sm font-medium text-ink">
                    {g.label}
                  </span>
                )}
                <ul aria-label={g.label ?? "Other tasks"} className="flex flex-col">
                  {g.tasks.map(({ task, role }) => (
                    <TaskRow key={task.id} task={task} role={role} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {shown.control}
      </SideCard>
    </Fold>
  );
}

/** One task, one line: its state in a fixed column, what it is, who has it; what it came to on request. */
function TaskRow({ task, role }: { task: DerivedTask; role: string }) {
  const s = TASK_STATUS[task.status];
  const [open, setOpen] = useState(false);
  const more = !!task.note;
  const line = (
    <>
      <span className="flex min-w-0">
        <Badge tone={s.tone}>{s.label}</Badge>
      </span>
      <span title={role} className="min-w-0 truncate text-sm text-ink">
        {role}
      </span>
      <span title={task.holder ?? undefined} className="max-w-24 truncate text-right text-sm text-ink-muted">
        {task.holder}
      </span>
      <span aria-hidden className="flex justify-end">
        {more && <ChevronDown className={cn("size-4 text-ink-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} />}
      </span>
    </>
  );
  const ROWCLASS = "grid min-h-10 w-full grid-cols-task items-center gap-x-2 py-1.5 text-left touch:min-h-touch";
  return (
    <li data-task={task.id} data-status={task.status} className="flex flex-col border-t first:border-t-0">
      {more ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className={ROWCLASS}>
          {line}
        </button>
      ) : (
        <span className={ROWCLASS}>{line}</span>
      )}
      {open && task.note && <p className="grid grid-cols-task gap-x-2 pb-2 text-sm text-ink-body"><span aria-hidden /><span className="col-span-3">{task.note}</span></p>}
    </li>
  );
}
