import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Bar, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatCredits, formatNumber, formatTime, percent, plural } from "@/lib/format";
import { RISE } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { plainOrNull } from "@/lib/plain";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useAnswerApprovalMutation, useControlRunMutation, useGetMeQuery, useGetRunQuery } from "@/store/api";
import type { Run, RunEvent, RunStatus } from "@/store/types";
import type { StreamStatus } from "@/store/runsSlice";
import { AppShell } from "../shell/AppShell";
import { accuracy, deriveRun, isTerminal, planItemLabel, type DerivedApproval, type DerivedPlan, type DerivedRun, type DerivedTask, type Mode, type StepTone } from "./runModel";
import { buildTimeline, groupCredits, type TimelineGroup, type TimelineItem } from "./timeline";
import { useRunStream } from "./useRunStream";

const STATUS: Record<RunStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Waiting to start", tone: "quiet" },
  running: { label: "Working", tone: "solid" },
  waiting: { label: "Waiting for you", tone: "attention-strong" },
  paused: { label: "Paused", tone: "quiet" },
  finished: { label: "Finished", tone: "success" },
  failed: { label: "Did not succeed", tone: "attention-strong" },
  cancelled: { label: "Cancelled", tone: "quiet" },
};

const TONE_CLASS: Record<StepTone, string> = {
  structure: "bg-primary-tint text-primary",
  people: "bg-violet-tint text-violet",
  factory: "bg-teal-tint text-teal-text",
  money: "bg-success-tint text-success-text",
  attention: "bg-attention-tint text-attention-text",
  quiet: "bg-quiet text-quiet-text",
};

export function RunView({ runId }: { runId: string }) {
  const query = useGetRunQuery(runId);
  const view = viewOf(query);
  const me = useGetMeQuery(undefined);
  const org = me.data?.organisation;
  const title = view.kind === "loaded" ? view.data.title : "Work";
  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), { label: title }]} aside={view.kind === "loaded" ? <RunAside runId={runId} /> : undefined}>
      {view.kind === "loading" && <RunSkeleton />}
      {view.kind === "failed" && (
        <Failed title={view.status === 404 ? "This work could not be found" : "This work could not be loaded"} reason={view.reason} onRetry={() => void query.refetch()} />
      )}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <RunBody run={view.data} />
        </>
      )}
    </AppShell>
  );
}

function RunSkeleton() {
  return (
    <Loading label="Loading the work" className="flex flex-col gap-6">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-24 rounded-md" />
      <Skeleton className="h-64 rounded-md" />
    </Loading>
  );
}

function RunBody({ run }: { run: Run }) {
  const [retry, setRetry] = useState(0);
  const log = useRunStream(run.id, retry);
  const mode = useAppSelector((s) => s.ui.mode);
  const derived = deriveRun(log.events);
  const [control, controlState] = useControlRunMutation();
  const [controlError, setControlError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // While a control request is in flight the optimistic status wins; afterwards the log does.
  const status: RunStatus = controlState.isLoading ? run.status : (derived.status ?? run.status);
  const terminal = isTerminal(status);
  const estimate = derived.estimateCredits ?? run.estimateCredits;
  const spent = Math.max(derived.settledCredits, run.spentCredits);

  const act = async (action: "pause" | "resume" | "cancel") => {
    setControlError(null);
    setConfirmCancel(false);
    try {
      await control({ id: run.id, action }).unwrap();
    } catch (e) {
      setControlError(`Could not ${action}: ${describeError(e as never)}`);
    }
  };

  return (
    <>
      <div className={cn("flex flex-wrap items-start justify-between gap-5", RISE)}>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
            <StreamBadge stream={log.stream} terminal={terminal} />
          </div>
          <h1 className="text-3xl font-semibold">{run.title}</h1>
          <span className="text-ink-body">Started {formatTime(run.startedAt)}</span>
        </div>
        {!terminal && (
          <div className="flex flex-wrap items-center gap-2">
            {status === "paused" ? (
              <Button onClick={() => void act("resume")} disabled={controlState.isLoading}>
                Resume
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void act("pause")} disabled={controlState.isLoading}>
                Pause
              </Button>
            )}
            {confirmCancel ? (
              <span role="group" aria-label="Confirm cancelling" className="flex flex-wrap items-center gap-2 rounded-sm bg-attention-tint px-3 py-1">
                <span className="text-sm text-attention-text">Stop this work for good?</span>
                <Button size="sm" variant="outline" onClick={() => void act("cancel")}>
                  Yes, cancel it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                  Keep going
                </Button>
              </span>
            ) : (
              <Button variant="soft" onClick={() => setConfirmCancel(true)} disabled={controlState.isLoading}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>

      {controlError && (
        <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
          {controlError} The work carries on as it was.
        </p>
      )}

      {log.stream === "failed" && (
        <div role="alert" data-state="failed" className="flex flex-wrap items-center gap-3 rounded-md border border-attention-line bg-attention-tint px-5 py-4 text-attention-text">
          {log.streamError} What is shown is everything received so far.
          <Button size="sm" onClick={() => setRetry((n) => n + 1)}>
            Reconnect
          </Button>
        </div>
      )}

      {terminal && run.ideaId && (
        <Link
          href={paths.idea(run.ideaId)}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary bg-primary-tint px-5 py-4 font-semibold text-ink transition hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <span className="flex items-center gap-2">
            <Icon name="verdict" tinted />
            {status === "finished" ? "The verdict is ready" : "See what research found"}
          </span>
          <span className="text-primary-link">Read it</span>
        </Link>
      )}

      <CostPanel estimate={estimate} spent={spent} reserved={terminal ? 0 : derived.reservedCredits} scored={derived.scored} />

      <Approvals runId={run.id} approvals={derived.approvals} />

      {derived.plan && <PlanPanel plan={derived.plan} mode={mode} />}

      {derived.finishedSummary && (
        <section className="rounded-md border bg-surface p-5 shadow-card">
          <h2 className="mb-2 text-lg font-semibold">Outcome</h2>
          <p className="whitespace-pre-line text-ink-body">{derived.finishedSummary}</p>
        </section>
      )}

      <Trace events={log.events} mode={mode} derived={derived} stream={log.stream} terminal={terminal} />
    </>
  );
}

function StreamBadge({ stream, terminal }: { stream: StreamStatus; terminal: boolean }) {
  if (terminal || stream === "ended") return null;
  if (stream === "open")
    return (
      <span className="flex items-center gap-2 text-sm text-success-text">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-success motion-reduce:animate-none" />
        Live
      </span>
    );
  if (stream === "reconnecting") return <span className="text-sm text-attention-text">Reconnecting…</span>;
  if (stream === "connecting") return <span className="text-sm text-ink-muted">Connecting…</span>;
  return null;
}

function CostPanel({ estimate, spent, reserved, scored }: { estimate: number | null; spent: number; reserved: number; scored: { estimated: number; actual: number } | null }) {
  return (
    <section aria-label="Cost" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Stat label="Estimate" value={estimate !== null ? formatCredits(estimate) : "Not yet made"} note="Shown before the work began" />
      <Stat label="Spent so far" value={formatCredits(spent)} note={estimate ? `${percent(spent, estimate)}% of the estimate` : "Settled from each call’s own cost"} bar={estimate ? percent(spent, estimate) : null} />
      {scored ? (
        <Stat label="Estimate against actual" value={accuracy(scored.estimated, scored.actual)} note={`Estimated ${formatNumber(scored.estimated)}, cost ${formatNumber(scored.actual)}`} />
      ) : (
        <Stat label="Held for calls in flight" value={formatCredits(reserved)} note="Reserved before each call, released when it settles" />
      )}
    </section>
  );
}

function Stat({ label, value, note, bar = null }: { label: string; value: string; note: string; bar?: number | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-surface px-5 py-4 shadow-card">
      <span className="text-ink-muted">{label}</span>
      <span className="font-display text-2xl font-semibold">{value}</span>
      {bar !== null && <Bar value={bar} label={`${bar}% of the estimate spent`} tone={bar > 100 ? "attention" : "primary"} className="my-1" />}
      <span className="text-sm text-ink-body">{note}</span>
    </div>
  );
}

function Approvals({ runId, approvals }: { runId: string; approvals: DerivedApproval[] }) {
  const pending = approvals.filter((a) => a.answer === null);
  if (pending.length === 0) return null;
  return (
    <section aria-label="Waiting for your approval" className="flex flex-col gap-3">
      {pending.map((a) => (
        <ApprovalCard key={a.id} runId={runId} approval={a} />
      ))}
    </section>
  );
}

function ApprovalCard({ runId, approval }: { runId: string; approval: DerivedApproval }) {
  const [answer, state] = useAnswerApprovalMutation();
  const [optimistic, setOptimistic] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "approve" | "reject") => {
    setOptimistic(decision);
    setError(null);
    try {
      await answer({ runId, approvalId: approval.id, decision }).unwrap();
    } catch (e) {
      setOptimistic(null);
      setError(describeError(e as never));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-attention-line bg-attention-tint px-5 py-4">
      <Badge tone="white" className="self-start">
        Needs you
      </Badge>
      <p className="text-base font-semibold">{approval.question}</p>
      {approval.detail && <p className="text-attention-deep">{approval.detail}</p>}
      {optimistic ? (
        <p role="status" className="font-medium text-ink">
          {optimistic === "approve" ? "Approved." : "Declined."} {state.isLoading ? "Sending…" : "The work carries on from here."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void decide("approve")}>Approve</Button>
          <Button variant="outline" onClick={() => void decide("reject")}>
            Decline
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-attention-text">
          Your answer was not recorded: {error}
        </p>
      )}
    </div>
  );
}

/**
 * The plan as a contract: each item in the owner's words, with whether it passed its check. The
 * files, endpoints and test commands behind each item are technical detail, shown in technical mode.
 */
function PlanPanel({ plan, mode }: { plan: DerivedPlan; mode: Mode }) {
  const technical = mode === "technical";
  const passed = plan.items.filter((i) => i.result === "passed").length;
  return (
    <section aria-labelledby="plan-title" className="flex flex-col gap-3 rounded-md border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="plan-title" className="flex items-center gap-2 text-lg font-semibold">
          <Icon name="plan" tinted />
          The plan
        </h2>
        <span className="flex flex-wrap items-center gap-2">
          {plan.items.length > 0 && <span className="text-sm text-ink-muted">{`${formatNumber(passed)} of ${plural(plan.items.length, "part")} done`}</span>}
          <Badge tone={plan.accepted ? "success" : "teal"}>{plan.accepted ? "Agreed" : "Proposed"}</Badge>
        </span>
      </div>
      {(technical ? plan.summary : plainOrNull(plan.summary)) && <p className="text-ink-body">{plan.summary}</p>}
      {plan.items.length > 0 && (
        <ol aria-label="Parts of the plan" className="flex flex-col divide-y">
          {plan.items.map((item) => {
            const label = planItemLabel(plan, item.id, mode) ?? item.id;
            const check = technical ? item.check : plainOrNull(item.check);
            const evidence = technical ? item.evidence : plainOrNull(item.evidence);
            return (
              <li key={item.id} data-item={item.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{technical ? `${item.id} · ${label}` : label}</span>
                  {item.result ? (
                    <Badge tone={item.result === "passed" ? "success" : "attention-strong"}>{item.result === "passed" ? "Passed its check" : "Sent back"}</Badge>
                  ) : (
                    <Badge tone="quiet">To do</Badge>
                  )}
                </div>
                {technical && item.detail && <p className="whitespace-pre-line break-words text-sm text-ink-body">{item.detail}</p>}
                {check && <span className="break-words text-sm text-ink-muted">{technical ? `Check: ${check}` : `How it is checked: ${check}`}</span>}
                {evidence && <span className="break-words text-sm text-ink-body">{evidence}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {!technical && plan.items.some((i) => i.plain === null) && (
        <p className="text-sm text-ink-muted">The files and tests behind each part are in technical mode.</p>
      )}
    </section>
  );
}

function Trace({ events, mode, derived, stream, terminal }: { events: RunEvent[]; mode: Mode; derived: DerivedRun; stream: StreamStatus; terminal: boolean }) {
  const planItem = (id: string) => planItemLabel(derived.plan, id, mode);
  const timeline = buildTimeline(events, mode, planItem);
  return (
    <section aria-labelledby="trace-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="trace-title" className="text-lg font-semibold">
          {mode === "technical" ? "Trace" : "Step by step"}
        </h2>
        <span className="text-sm text-ink-muted" data-testid="action-count">
          {mode === "technical"
            ? `${plural(timeline.modelCalls, "model call")} · ${plural(timeline.toolCalls, "tool call")} · ${plural(timeline.denials, "denial")}`
            : `${plural(timeline.actions, "action")} taken${timeline.denials > 0 ? `, ${formatNumber(timeline.denials)} refused by your rules` : ""}`}
        </span>
      </div>
      {timeline.items.length === 0 ? (
        stream === "failed" ? null : terminal ? (
          <p data-state="empty" className="rounded-md border border-dashed border-border-strong bg-surface p-5 text-ink-muted">
            This work recorded no steps.
          </p>
        ) : (
          <Loading label="Waiting for the first step" className="flex flex-col gap-2">
            <Skeleton className="h-14 rounded-sm" />
            <Skeleton className="h-14 rounded-sm" />
          </Loading>
        )
      ) : (
        <ol aria-label="Steps" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
          {timeline.items.map((item) => (
            <TimelineRow key={item.key} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "group") return <GroupRow group={item} />;
  return (
    <li data-seq={item.seq} className={cn("flex gap-3 border-b px-4 py-3 last:border-b-0 sm:px-5", RISE)}>
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xs", TONE_CLASS[item.tone])}>
        <Icon name={item.icon} className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="break-words font-medium">{item.title}</span>
          <span className="flex items-baseline gap-3 text-sm text-ink-muted">
            {item.credits && <span className="font-medium text-success-text">{item.credits}</span>}
            {item.at && <time dateTime={item.at}>{formatTime(item.at)}</time>}
          </span>
        </div>
        {item.detail && <p className="whitespace-pre-line break-words text-ink-body">{item.detail}</p>}
        {item.raw && item.raw !== "{}" && (
          <details className="mt-1 min-w-0">
            <summary className="min-h-touch cursor-pointer py-2 text-sm text-ink-muted">Raw event #{item.seq}</summary>
            <pre className="max-h-96 overflow-auto rounded-xs bg-ground p-3 font-mono text-xs">{item.raw}</pre>
          </details>
        )}
      </div>
    </li>
  );
}

const GROUP_STATUS: Record<TimelineGroup["status"], { label: string; tone: BadgeTone }> = {
  working: { label: "Working", tone: "solid" },
  done: { label: "Done", tone: "success" },
  stopped: { label: "Stopped", tone: "attention-strong" },
};

/** A sub-agent's piece of the work: one line with its outcome, its own steps folded beneath. */
function GroupRow({ group }: { group: TimelineGroup }) {
  const credits = groupCredits(group);
  const status = GROUP_STATUS[group.status];
  return (
    <li data-group={group.agent} className={cn("border-b last:border-b-0", RISE)}>
      <details open={group.status === "working"} className="group/sub">
        <summary className="flex min-h-touch cursor-pointer list-none gap-3 px-4 py-3 hover:bg-ground sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xs bg-violet-tint text-violet">
            <Icon name="contractors" className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="break-words font-medium">{group.title}</span>
              <span className="flex items-center gap-2 text-sm text-ink-muted">
                {group.searches > 0 && <span>{plural(group.searches, "search", "searches")}</span>}
                {credits && <span className="font-medium text-success-text">{credits}</span>}
                <Badge tone={status.tone}>{status.label}</Badge>
              </span>
            </span>
            {group.outcome && <span className="break-words text-ink-body">{group.outcome}</span>}
            <span className="text-sm text-primary-link">
              <span className="group-open/sub:hidden">Show its {plural(group.items.length, "step")}</span>
              <span className="hidden group-open/sub:inline">Hide its steps</span>
            </span>
          </span>
        </summary>
        {group.items.length > 0 && (
          <ol aria-label={`Steps: ${group.title}`} className="ml-6 flex flex-col border-l-2 border-violet-line sm:ml-9">
            {group.items.map((item) => (
              <TimelineRow key={item.key} item={item} />
            ))}
          </ol>
        )}
      </details>
    </li>
  );
}

function RunAside({ runId }: { runId: string }) {
  const log = useAppSelector((s) => s.runs[runId]);
  const derived = deriveRun(log?.events ?? []);
  const me = useGetMeQuery(undefined);
  return (
    <>
      <section aria-labelledby="tasks-title" className="flex flex-col gap-3">
        <h2 id="tasks-title" className="text-lg font-semibold">
          Tasks
        </h2>
        {derived.tasks.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            No tasks yet. They appear here as the work is broken down.
          </p>
        ) : (
          <ul aria-label="Tasks" className="flex flex-col gap-2">
            {derived.tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Where the credits go</h2>
        <p className="text-ink-body">Credits are held before each step and settled from what it really cost. Repairing a mistake of its own is never billed.</p>
        {me.data?.organisation && (
          <Link href={paths.credits()} className={cn(buttonVariants({ variant: "outline" }), "self-start")}>
            See credits
          </Link>
        )}
      </section>
    </>
  );
}

const TASK_STATUS: Record<DerivedTask["status"], { label: string; tone: BadgeTone }> = {
  open: { label: "To do", tone: "quiet" },
  working: { label: "In progress", tone: "solid" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Did not succeed", tone: "attention-strong" },
};

function TaskRow({ task }: { task: DerivedTask }) {
  const s = TASK_STATUS[task.status];
  return (
    <li data-task={task.id} data-status={task.status} className="flex flex-col gap-1 rounded-sm border px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{task.summary}</span>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      {task.holder && <span className="text-sm text-violet-text">{task.holder}</span>}
      {task.note && <span className="text-sm text-ink-body">{task.note}</span>}
    </li>
  );
}
