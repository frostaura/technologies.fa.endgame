import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Circle, Eye, LoaderCircle, RotateCcw, Search, TriangleAlert, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCredits, formatNumber, plural } from "@/lib/format";
import { paths } from "@/lib/router";
import { TAP } from "@/lib/touch";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useGetRunQuery } from "@/store/api";
import type { RunStatus } from "@/store/types";
import { ApprovalCard } from "../runs/ApprovalCard";
import { BuiltAppActions } from "../runs/RunView";
import { TryAgain } from "../runs/TryAgain";
import { isTerminal } from "../runs/runModel";
import { useRunStream } from "../runs/useRunStream";
import { deriveWork, partStateLabel, tallySentence, TASK_ROLE_LABEL, type PartState, type Researcher, type WorkPart, type WorkView } from "./workModel";

/**
 * Work a message started, live in the conversation (ARCH-011): what it is and who is doing it, the
 * credits it has used against its estimate, the plan as parts with a state each — the part being
 * worked on open, its tasks and what its tools did beneath it — the researchers side by side for
 * research, approvals inside it, and the result with what to do next. Driven by the run's own
 * event stream; a finished card stays in its final state and still opens the run's page.
 */
export function WorkCard({ runId, kind }: { runId: string; kind?: string }) {
  const log = useRunStream(runId);
  const mode = useAppSelector((s) => s.ui.mode);
  const run = useGetRunQuery(runId).data;
  // One pass over the log per batch of events (the stream stores them every 50 ms), never per event.
  const work = useMemo(() => deriveWork(log.events, mode), [log.events, mode]);
  const status: RunStatus | null = work.run.status ?? run?.status ?? null;
  const done = isTerminal(status);
  const what = kind || (run?.kind === "research" ? "research" : run?.kind ?? "");
  const research = what === "research" || work.researchers.length > 0;
  const title = run?.title ?? (research ? "Research" : "The work");
  const estimate = work.run.plannedEstimateCredits ?? work.run.firstEstimateCredits ?? run?.estimateCredits ?? null;
  const spent = done && run ? run.spentCredits : work.run.settledCredits;

  return (
    <article
      aria-label={`${heading(what, research)}: ${title}`}
      data-work-card=""
      data-status={status ?? "queued"}
      className="flex min-w-0 flex-col overflow-hidden rounded-md border bg-surface shadow-card"
    >
      <header className="flex flex-col gap-2.5 border-b px-4 pb-3 pt-3.5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xs bg-teal-tint text-teal">
            <Icon name={research ? "research" : "build"} className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-eyebrow font-semibold uppercase text-ink-muted">{heading(what, research)}</span>
            <h3 className="line-clamp-2 font-sans text-sm font-semibold text-ink">{title}</h3>
          </div>
          <StatusChip status={status} waiting={work.pending.length > 0} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
          <Workers work={work} />
          <Elapsed from={work.firstAt ?? run?.startedAt ?? null} to={done ? (work.lastAt ?? run?.finishedAt ?? null) : null} />
        </div>
        <CreditMeter spent={spent} estimate={estimate} done={done} />
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        {work.now && !done && <p className="text-sm text-ink-body">{work.now}</p>}
        {research && work.researchers.length > 0 && <Researchers researchers={work.researchers} />}
        {work.parts.length > 0 && <Plan work={work} technical={mode === "technical"} />}
        {work.parts.length === 0 && !research && work.tools.total > 0 && <p className="text-sm text-ink-muted">{tallySentence(work.tools)}</p>}
        {work.pending.map((a) => (
          <ApprovalCard key={a.id} runId={runId} approval={a} compact />
        ))}
        {log.stream === "failed" && (
          <p role="alert" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
            {log.streamError} The work goes on; its page has everything.
          </p>
        )}
        {done && <Result work={work} runId={runId} status={status} research={research} />}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-ground px-4 py-1.5">
        <Link href={paths.run(runId)} className={cn("rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover", TAP)}>
          See the whole run
        </Link>
        {done && <span className="text-xs text-ink-muted">{spentLine(spent, estimate)}</span>}
      </footer>
    </article>
  );
}

function heading(what: string, research: boolean): string {
  if (research) return "Research";
  if (what === "change") return "A change";
  if (what === "retry") return "Trying again";
  if (what === "conversation") return "Answering";
  return "Building";
}

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  queued: { label: "Starting", tone: "quiet" },
  running: { label: "Working", tone: "primary" },
  waiting: { label: "Waiting for you", tone: "attention-strong" },
  paused: { label: "Paused", tone: "quiet" },
  finished: { label: "Finished", tone: "success" },
  failed: { label: "Stopped", tone: "attention" },
  cancelled: { label: "Cancelled", tone: "quiet" },
};

function StatusChip({ status, waiting }: { status: RunStatus | null; waiting: boolean }) {
  const s = STATUS[waiting && !isTerminal(status) ? "waiting" : (status ?? "queued")] ?? STATUS.queued;
  return (
    <Badge tone={s?.tone ?? "quiet"} data-status-chip="" className="shrink-0">
      {status === "running" && !waiting && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />}
      {s?.label}
    </Badge>
  );
}

function Workers({ work }: { work: WorkView }) {
  const employees = work.workers.filter((w) => w.kind === "employee");
  const contractors = work.workers.filter((w) => w.kind === "contractor");
  if (employees.length === 0 && contractors.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-2" data-workers="">
      {employees.length > 0 && (
        <span className="flex -space-x-1.5">
          {employees.slice(0, 4).map((w) => (
            <Avatar key={w.name} name={w.name} size="xs" className="ring-2 ring-surface" />
          ))}
        </span>
      )}
      <span className="min-w-0 truncate">
        {[employees.length > 0 ? employees.map((w) => w.name).join(", ") : null, contractors.length > 0 ? plural(contractors.length, contractorRole(contractors[0]?.role ?? null)) : null].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

function contractorRole(role: string | null): string {
  return role && /research/i.test(role) ? "research contractor" : "contractor";
}

/** Minutes and seconds since the work started, ticking while it runs. */
function Elapsed({ from, to }: { from: string | null; to: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (to || !from) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [from, to]);
  if (!from) return null;
  const ms = Math.max(0, (to ? Date.parse(to) : now) - Date.parse(from));
  if (!Number.isFinite(ms)) return null;
  const s = Math.round(ms / 1000);
  const text = s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return <span className="tabular-nums">{to ? `Took ${text}` : text}</span>;
}

function CreditMeter({ spent, estimate, done }: { spent: number; estimate: number | null; done: boolean }) {
  if (estimate === null || estimate <= 0) {
    return spent > 0 ? <span className="text-xs text-ink-muted">{formatCredits(spent)} so far</span> : null;
  }
  const share = Math.min(1, spent / estimate);
  const over = spent > estimate;
  return (
    <div className="flex items-center gap-2.5" data-credit-meter="">
      <div
        role="meter"
        aria-label="Credits used against the estimate"
        aria-valuemin={0}
        aria-valuemax={estimate}
        aria-valuenow={Math.round(spent * 100) / 100}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-quiet"
      >
        <div className={cn("h-full rounded-full transition-all duration-500 motion-reduce:transition-none", over ? "bg-attention" : "bg-success")} style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-ink-muted">
        {formatNumber(spent)} of {done ? "" : "about "}
        {formatCredits(estimate)}
      </span>
    </div>
  );
}

function spentLine(spent: number, estimate: number | null): string {
  return estimate !== null && estimate > 0 ? `Cost ${formatCredits(spent)}, estimated ${formatNumber(estimate)}` : `Cost ${formatCredits(spent)}`;
}

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

const STATE_STYLE: Record<PartState, { dot: string; bar: string; text: string }> = {
  waiting: { dot: "border-border-strong bg-surface text-ink-muted", bar: "bg-quiet", text: "text-ink-muted" },
  working: { dot: "border-primary bg-primary text-primary-ink", bar: "bg-primary bg-stripe animate-sheen motion-reduce:animate-none", text: "text-primary-hover" },
  checking: { dot: "border-teal bg-teal text-primary-ink", bar: "bg-teal bg-stripe animate-sheen motion-reduce:animate-none", text: "text-teal-text" },
  repair: { dot: "border-attention bg-attention-tint text-attention-text", bar: "bg-attention-dash", text: "text-attention-text" },
  passed: { dot: "border-success bg-success text-primary-ink", bar: "bg-success", text: "text-success-text" },
  "needs-look": { dot: "border-violet bg-violet-tint text-violet-text", bar: "bg-violet", text: "text-violet-text" },
  failed: { dot: "border-attention-text bg-attention-text text-primary-ink", bar: "bg-attention-text", text: "text-attention-text" },
};

function StateIcon({ state }: { state: PartState }) {
  const cls = "size-3.5";
  switch (state) {
    case "passed":
      return <Check aria-hidden className={cls} strokeWidth={3} />;
    case "working":
      return <LoaderCircle aria-hidden className={cn(cls, "animate-spin motion-reduce:animate-none")} />;
    case "checking":
      return <Search aria-hidden className={cls} strokeWidth={2.5} />;
    case "repair":
      return <RotateCcw aria-hidden className={cls} strokeWidth={2.5} />;
    case "needs-look":
      return <Eye aria-hidden className={cls} />;
    case "failed":
      return <X aria-hidden className={cls} strokeWidth={3} />;
    default:
      return <Circle aria-hidden className="size-2 fill-current" />;
  }
}

/** The plan: a compact track for five parts or fewer, a stepper for more; the part being worked on open beneath. */
function Plan({ work, technical }: { work: WorkView; technical: boolean }) {
  const total = work.parts.length;
  const [chosen, setChosen] = useState<string | null>(null);
  const open = chosen ?? work.active ?? work.parts.find((p) => p.state !== "passed")?.id ?? work.parts[total - 1]?.id ?? null;
  const accepted = work.run.plan?.accepted ?? false;
  return (
    <section aria-label="The plan" className="flex flex-col gap-2.5" data-plan={total <= 5 ? "track" : "stepper"}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">{accepted ? "The plan" : "The plan, waiting for you"}</h4>
        <span className="text-xs tabular-nums text-ink-muted" data-parts-done="">
          {work.done} of {plural(total, "part")} done
        </span>
      </div>
      {total <= 5 ? (
        <>
          <ol className="flex gap-1.5" aria-label="Parts">
            {work.parts.map((part, i) => (
              <li key={part.id} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setChosen(part.id)}
                  aria-pressed={open === part.id}
                  aria-label={`Part ${i + 1}: ${part.label}. ${partStateLabel(part.state, part.repairs)}`}
                  className={cn("flex min-h-touch w-full flex-col justify-center gap-1.5 rounded-xs px-0.5 text-left", open === part.id && "bg-ground")}
                >
                  <span className={cn("block h-1.5 w-full overflow-hidden rounded-full", STATE_STYLE[part.state].bar)} />
                  <span className={cn("flex items-center gap-1 px-0.5 text-xs font-semibold", STATE_STYLE[part.state].text)}>
                    <StateIcon state={part.state} />
                    {i + 1}
                  </span>
                </button>
              </li>
            ))}
            {work.review && <ReviewSegment state={work.review} />}
          </ol>
          {open && <PartDetail part={work.parts.find((p) => p.id === open) as WorkPart} index={work.parts.findIndex((p) => p.id === open)} total={total} technical={technical} />}
        </>
      ) : (
        <ol className="flex flex-col" aria-label="Parts">
          {work.parts.map((part, i) => (
            <StepperRow key={part.id} part={part} index={i} total={total} open={open === part.id} onOpen={() => setChosen(open === part.id ? "" : part.id)} technical={technical} last={i === total - 1 && !work.review} />
          ))}
          {work.review && <ReviewRow state={work.review} />}
        </ol>
      )}
    </section>
  );
}

function ReviewSegment({ state }: { state: NonNullable<WorkView["review"]> }) {
  const s: PartState = state === "passed" ? "passed" : state === "repair" ? "repair" : "checking";
  return (
    <li className="w-12 shrink-0" title="Security review">
      <span className="flex min-h-touch flex-col justify-center gap-1.5 px-0.5">
        <span className={cn("block h-1.5 w-full rounded-full", STATE_STYLE[s].bar)} />
        <span className={cn("flex items-center gap-1 text-xs font-semibold", STATE_STYLE[s].text)}>
          <Icon name="secrets" className="size-3.5" />
          <span className="sr-only">Security review: {state === "passed" ? "passed" : state === "repair" ? "fixing what it found" : "checking"}</span>
        </span>
      </span>
    </li>
  );
}

function ReviewRow({ state }: { state: NonNullable<WorkView["review"]> }) {
  const s: PartState = state === "passed" ? "passed" : state === "repair" ? "repair" : "checking";
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border-2", STATE_STYLE[s].dot)}>
        <StateIcon state={s} />
      </span>
      <span className="flex-1 text-sm text-ink">Security review</span>
      <span className={cn("text-xs font-semibold", STATE_STYLE[s].text)}>{state === "passed" ? "Passed" : state === "repair" ? "Fixing what it found" : "Checking"}</span>
    </li>
  );
}

const StepperRow = memo(function StepperRow({ part, index, total, open, onOpen, technical, last }: { part: WorkPart; index: number; total: number; open: boolean; onOpen: () => void; technical: boolean; last: boolean }) {
  return (
    <li className="relative flex gap-3" data-part-state={part.state}>
      {!last && <span aria-hidden className={cn("absolute bottom-0 left-3 top-8 -ml-px w-0.5", part.state === "passed" ? "bg-success" : "bg-border")} />}
      <span className={cn("relative z-10 mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2", STATE_STYLE[part.state].dot)}>
        <StateIcon state={part.state} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col pb-2">
        <button type="button" onClick={onOpen} aria-expanded={open} className="flex min-h-touch w-full items-center gap-2 text-left">
          <span className="min-w-0 flex-1 text-sm text-ink">
            <span className="sr-only">Part {index + 1} of {total}: </span>
            {part.label}
          </span>
          <span className={cn("shrink-0 text-xs font-semibold", STATE_STYLE[part.state].text)}>{partStateLabel(part.state, part.repairs)}</span>
          <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        {open && <PartBody part={part} technical={technical} />}
      </div>
    </li>
  );
});

function PartDetail({ part, index, total, technical }: { part: WorkPart; index: number; total: number; technical: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-xs border bg-ground px-3 py-2.5" data-part-state={part.state} data-open-part="">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium text-ink">
          <span className="text-ink-muted">
            Part {index + 1} of {total}:{" "}
          </span>
          {part.label}
        </span>
        <span className={cn("shrink-0 text-xs font-semibold", STATE_STYLE[part.state].text)}>{partStateLabel(part.state, part.repairs)}</span>
      </div>
      <PartBody part={part} technical={technical} />
    </div>
  );
}

/** Under a part: its tasks with who holds each and how it went, what the checker said, and what the tools did. */
function PartBody({ part, technical }: { part: WorkPart; technical: boolean }) {
  const [actions, setActions] = useState(false);
  const sentence = tallySentence(part.tools);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {part.tasks.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Tasks">
          {part.tasks.map((t) => (
            <li key={t.id} className="flex min-w-0 items-center gap-2">
              <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">{TASK_ROLE_LABEL[t.role]}</span>
              {t.holder ? <Avatar name={t.holder} size="xs" /> : null}
              <span className="min-w-0 flex-1 truncate text-ink-body">{t.holder ?? "Not taken yet"}</span>
              <span className={cn("shrink-0 text-xs", t.status === "done" ? "text-success-text" : t.status === "failed" ? "text-attention-text" : t.status === "working" ? "text-primary-hover" : "text-ink-muted")}>
                {t.status === "done" ? "Done" : t.status === "failed" ? "Did not succeed" : t.status === "working" ? "Working" : "Waiting"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {part.outcome && <p className="text-ink-muted">{part.outcome}</p>}
      {sentence && <p className="text-xs text-ink-muted">{sentence}</p>}
      {technical && part.tools.actions.length > 0 && (
        <>
          <button type="button" onClick={() => setActions((a) => !a)} aria-expanded={actions} className="self-start rounded-xs text-xs font-semibold text-primary-link hover:text-primary-hover">
            {actions ? "Hide each action" : `Each action (${part.tools.total})`}
          </button>
          {actions && (
            <ol className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-xs border bg-surface p-2 font-mono text-xs">
              {part.tools.actions.map((a) => (
                <li key={a.seq} className="truncate">
                  {a.name}
                  {a.detail ? `: ${a.detail}` : ""}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------------------------

function Researchers({ researchers }: { researchers: Researcher[] }) {
  const finished = researchers.filter((r) => r.state !== "working").length;
  return (
    <section aria-label="The researchers" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">{researchers.length === 1 ? "The researcher" : `${researchers.length} researchers, at the same time`}</h4>
        <span className="text-xs tabular-nums text-ink-muted">{finished} of {researchers.length} reported</span>
      </div>
      <ul className={cn("grid gap-2", researchers.length >= 3 ? "grid-cols-3" : researchers.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {researchers.map((r) => (
          <li key={r.id} data-researcher={r.state} className={cn("flex min-w-0 flex-col gap-1.5 rounded-xs border px-2.5 py-2", r.state === "working" ? "border-teal bg-teal-tint" : r.state === "done" ? "bg-surface" : "border-attention-line bg-attention-tint")}>
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              {r.state === "working" ? <LoaderCircle aria-hidden className="size-3.5 animate-spin text-teal motion-reduce:animate-none" /> : r.state === "done" ? <Check aria-hidden className="size-3.5 text-success" strokeWidth={3} /> : <TriangleAlert aria-hidden className="size-3.5 text-attention-text" />}
              <span className={r.state === "working" ? "text-teal-text" : r.state === "done" ? "text-success-text" : "text-attention-text"}>{r.state === "working" ? "Looking" : r.state === "done" ? "Reported" : "Stopped"}</span>
            </span>
            <span className="line-clamp-3 text-xs text-ink">{r.title}</span>
            <span className="text-xs tabular-nums text-ink-muted">
              {r.maxSearches ? `${Math.min(r.searches, r.maxSearches)} of ${r.maxSearches} searches` : plural(r.searches, "search", "searches")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------------------------

function Result({ work, runId, status, research }: { work: WorkView; runId: string; status: RunStatus | null; research: boolean }) {
  const run = useGetRunQuery(runId).data;
  const outcome = work.run.finishedSummary ?? run?.summary ?? null;
  const failed = status === "failed" || status === "cancelled";
  let actions: ReactNode = null;
  if (status === "finished" && work.run.app) actions = <BuiltAppActions appId={work.run.app.id} />;
  else if (research && run?.ideaId)
    actions = (
      <Link href={paths.idea(run.ideaId)} className={buttonVariants({ size: "sm" })}>
        Read the verdict
      </Link>
    );
  else if (failed && run?.canTryAgain) actions = <TryAgain runId={runId} ideaId={run.ideaId} why={run.budgetExhausted ? "budget" : status === "cancelled" ? "cancelled" : "failed"} showCredits={run.budgetExhausted} />;
  return (
    <section aria-label="How it ended" data-result={status ?? ""} className="flex flex-col gap-2.5">
      {outcome && <p className={cn("text-sm", failed ? "text-attention-text" : "text-ink")}>{outcome}</p>}
      {actions}
    </section>
  );
}
