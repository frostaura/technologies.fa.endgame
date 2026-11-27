import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUpRight, Check, ChevronDown, Clock, Eye, History, RotateCcw, ShieldCheck, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Chip, PersonChip } from "@/components/ui/chip";
import { useActiveTree } from "@/lib/useActiveOrganisation";
import { curlyQuotes, fullRequest, shortRunName } from "../runs/runHeading";
import { employeeIds } from "./scopeModel";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCredits, formatNumber, plural } from "@/lib/format";
import { paths } from "@/lib/router";
import { TAP } from "@/lib/touch";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useGetAppQuery, useGetRunQuery } from "@/store/api";
import type { RunStatus } from "@/store/types";
import { ApprovalCard } from "../runs/ApprovalCard";
import { TryAgain } from "../runs/TryAgain";
import { isTerminal } from "../runs/runModel";
import { useRunStream } from "../runs/useRunStream";
import { deriveWork, partStateLabel, tallySentence, TASK_ROLE_LABEL, type PartState, type Researcher, type WorkPart, type WorkTask, type WorkView } from "./workModel";

/**
 * Work a message started, live in the conversation (ARCH-012): what it is and who is doing it, how
 * long it has worked and how long it waited for you, the credits it has used against its estimate
 * (and the estimate made again from the plan, said so), the plan as parts with a state each — the
 * part being worked on open, its tasks and what its tools did beneath it — the researchers for
 * research, approvals inside it, and one outcome row. Driven by the run's own event stream; once
 * finished it folds to its outcome, the plan a press away. Never wider than reading width.
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
  const research = what === "research" || work.researchers.length > 0 || (what === "retry" && run?.kind === "research");
  const title = run?.title ? shortRunName(run.title).replace(/^(Build|Research|Change|Conversation|Task): /, "") : research ? "Research" : "The work";
  const asked = run?.title ? fullRequest(run.title, log.events) : null;
  const estimate = work.run.plannedEstimateCredits ?? work.run.firstEstimateCredits ?? run?.estimateCredits ?? null;
  const spent = done && run ? run.spentCredits : work.run.settledCredits;
  const card = useRef<HTMLElement>(null);
  const width = useWidth(card);
  const [planShown, setPlanShown] = useState(false);
  const folded = done && !planShown;

  return (
    <article
      ref={card}
      aria-label={`${heading(what, research)}: ${title}`}
      data-work-card=""
      data-status={status ?? "queued"}
      className="flex w-full min-w-0 max-w-prose flex-col overflow-hidden rounded-md border bg-surface shadow-card"
    >
      <header className="flex flex-col gap-2 border-b px-4 pb-3 pt-3.5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xs bg-ground text-ink-muted">
            <Icon name={research ? "research" : "build"} className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-eyebrow font-semibold uppercase text-ink-muted">{heading(what, research)}</span>
            <Title title={title} asked={asked} />
          </div>
          <StatusChip status={status} waiting={work.pending.length > 0} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
          <Workers work={work} />
          <Timing from={work.firstAt ?? run?.startedAt ?? null} to={done ? (work.lastAt ?? run?.finishedAt ?? null) : null} waitedMs={work.waitedMs} waitingSince={done ? null : work.waitingSince} />
        </div>
        <CreditMeter spent={spent} estimate={estimate} done={done} reestimate={work.reestimate} />
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        {/* What is happening, in a sentence, only where there is no plan or researchers to show it. */}
        {work.now && !done && work.parts.length === 0 && work.researchers.length === 0 && <p className="text-sm text-ink-body">{work.now}</p>}
        {research && work.researchers.length > 0 && !folded && <Researchers researchers={work.researchers} stacked={width > 0 && width < 400} />}
        {work.parts.length > 0 && !folded && <Plan work={work} technical={mode === "technical"} />}
        {work.parts.length === 0 && !research && work.tools.total > 0 && !done && <p className="text-sm text-ink-muted">{tallySentence(work.tools)}</p>}
        {work.pending.map((a) => (
          <ApprovalCard key={a.id} runId={runId} approval={a} compact />
        ))}
        {log.stream === "failed" && (
          <p role="alert" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
            {log.streamError} The work goes on; its page has everything.
          </p>
        )}
        {done && (work.parts.length > 0 || work.researchers.length > 0) && (
          <button type="button" onClick={() => setPlanShown((s) => !s)} aria-expanded={planShown} className={cn("flex items-center gap-1.5 self-start rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover", TAP)}>
            <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", planShown && "rotate-180")} />
            {planShown ? "Hide the plan" : work.parts.length > 0 ? `Show the plan · ${work.done} of ${plural(work.parts.length, "part")} done` : "Show the researchers"}
          </button>
        )}
        {done && <Outcome work={work} runId={runId} status={status} research={research} spent={spent} estimate={estimate} />}
      </div>

      {!done && (
        <footer className="flex items-center justify-between gap-2 border-t bg-ground px-4 py-1">
          <Link href={paths.run(runId)} className={cn("flex items-center gap-0.5 rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover", TAP)}>
            See the whole run
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        </footer>
      )}
    </article>
  );
}

/** The card's width as drawn, so its insides can stack in a narrow pane. Zero until measured. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return width;
}

function heading(what: string, research: boolean): string {
  if (what === "retry") return research ? "Trying again · Research" : "Trying again · Build";
  if (research) return "Research";
  if (what === "change") return "A change";
  if (what === "conversation") return "Answering";
  return "Building";
}

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  queued: { label: "Starting", tone: "neutral" },
  running: { label: "Working", tone: "info" },
  waiting: { label: "Waiting for you", tone: "warn" },
  paused: { label: "Paused", tone: "warn" },
  finished: { label: "Finished", tone: "good" },
  failed: { label: "Stopped", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function StatusChip({ status, waiting }: { status: RunStatus | null; waiting: boolean }) {
  const s = STATUS[waiting && !isTerminal(status) ? "waiting" : (status ?? "queued")] ?? STATUS.queued;
  return (
    <Badge tone={s?.tone ?? "neutral"} data-status-chip="" className="shrink-0">
      {status === "running" && !waiting && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />}
      {s?.label}
    </Badge>
  );
}

function Workers({ work }: { work: WorkView }) {
  const idOf = useEmployeeIds();
  const employees = work.workers.filter((w) => w.kind === "employee");
  const contractors = work.workers.filter((w) => w.kind === "contractor");
  if (employees.length === 0 && contractors.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5" data-workers="">
      {employees.slice(0, 3).map((w) => (
        <PersonChip key={w.name} name={w.name} id={idOf(w.name)} />
      ))}
      {employees.length > 3 && <Chip>{`${employees.length - 3} more`}</Chip>}
      {contractors.length > 0 && <Chip>{plural(contractors.length, contractorRole(contractors[0]?.role ?? null))}</Chip>}
    </span>
  );
}

function contractorRole(role: string | null): string {
  return role && /research/i.test(role) ? "research contractor" : "contractor";
}

function span(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

/**
 * How long the work has taken, in one treatment whether it runs or has finished — working time only — and, apart,
 * how long it waited for a person's answer: the clock never counts a wait for you as work.
 */
function Timing({ from, to, waitedMs, waitingSince }: { from: string | null; to: string | null; waitedMs: number; waitingSince: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (to || !from) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [from, to]);
  if (!from) return null;
  const end = to ? Date.parse(to) : now;
  const waitingNow = waitingSince ? Math.max(0, end - Date.parse(waitingSince)) : 0;
  const waited = waitedMs + (Number.isFinite(waitingNow) ? waitingNow : 0);
  const worked = Math.max(0, end - Date.parse(from) - waited);
  if (!Number.isFinite(worked)) return null;
  return (
    <span className="flex items-center gap-1 tabular-nums" data-timing="">
      <Clock aria-hidden className="size-3.5 shrink-0" />
      {to ? `Worked ${span(worked)}` : `Working ${span(worked)}`}
      {waited >= 1000 && <span className="text-ink-muted"> · {waitingSince && !to ? "waiting for you" : "waited for you"} {span(waited)}</span>}
    </span>
  );
}

function CreditMeter({ spent, estimate, done, reestimate }: { spent: number; estimate: number | null; done: boolean; reestimate: WorkView["reestimate"] }) {
  if (estimate === null || estimate <= 0) {
    return spent > 0 ? <span className="text-xs text-ink-muted">{formatCredits(spent)} so far</span> : null;
  }
  const over = spent > estimate;
  // Over the estimate the bar fills, and the part beyond it is said in words beside the figures.
  const share = over ? 1 : Math.min(1, spent / estimate);
  return (
    <div className="flex flex-col gap-1" data-credit-meter={over ? "over" : ""}>
      <div className="flex items-center gap-2.5">
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
        <span className={cn("shrink-0 text-xs tabular-nums", over ? "font-semibold text-attention-text" : "text-ink-muted")}>
          {formatNumber(spent)} of {done ? "" : "about "}
          {formatCredits(estimate)}
          {over && ` · ${formatNumber(spent - estimate)} over`}
        </span>
      </div>
      {reestimate && (
        <span className="text-xs text-ink-muted" data-reestimate="">
          Re-estimated after planning: about {formatCredits(reestimate.to)}
          {reestimate.from !== null && ` (was about ${formatNumber(reestimate.from)})`}
          {reestimate.reason && <span className="sr-only"> {reestimate.reason}</span>}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

/** Each part's state in the status vocabulary (ARCH-011): its tag's tone, its step's node, its share of the track. */
const STATE_STYLE: Record<PartState, { dot: string; bar: string; tone: BadgeTone }> = {
  waiting: { dot: "border-border-strong bg-surface text-ink-muted", bar: "bg-quiet", tone: "neutral" },
  working: { dot: "border-primary-line bg-surface text-primary", bar: "bg-primary bg-stripe animate-sheen motion-reduce:animate-none", tone: "info" },
  checking: { dot: "border-primary bg-surface text-primary", bar: "bg-primary-soft", tone: "info" },
  repair: { dot: "border-warn bg-warn-tint text-warn-text", bar: "bg-warn", tone: "warn" },
  passed: { dot: "border-success bg-success text-primary-ink", bar: "bg-success", tone: "good" },
  carried: { dot: "border-success bg-success-tint text-success-text", bar: "bg-success", tone: "good" },
  "needs-look": { dot: "border-warn bg-surface text-warn-text", bar: "bg-warn", tone: "warn" },
  failed: { dot: "border-attention bg-attention text-primary-ink", bar: "bg-attention", tone: "bad" },
};

/** A node's mark: an empty ring waits; a ring with a moving arc works; a tick passed; a clock-back was done before. */
function StateIcon({ state }: { state: PartState }) {
  const cls = "size-3.5";
  switch (state) {
    case "passed":
      return <Check aria-hidden className={cls} strokeWidth={3} />;
    case "carried":
      return <History aria-hidden className={cls} strokeWidth={2.5} />;
    case "working":
      return <span aria-hidden className="absolute -inset-0.5 animate-spin rounded-full border-2 border-transparent border-t-primary motion-reduce:animate-none" />;
    case "checking":
      return <Eye aria-hidden className={cls} strokeWidth={2.5} />;
    case "repair":
      return <RotateCcw aria-hidden className={cls} strokeWidth={2.5} />;
    case "needs-look":
      return <Eye aria-hidden className={cls} />;
    case "failed":
      return <X aria-hidden className={cls} strokeWidth={3} />;
    default:
      return null;
  }
}

/** The plan: a summary track — one equal segment per part, and one for the security review — then each part by name in a stepper. */
function Plan({ work, technical }: { work: WorkView; technical: boolean }) {
  const total = work.parts.length;
  const [chosen, setChosen] = useState<string | null>(null);
  const open = chosen ?? work.active ?? work.parts.find((p) => p.state !== "passed" && p.state !== "carried")?.id ?? null;
  const accepted = work.run.plan?.accepted ?? false;
  const carried = work.parts.filter((p) => p.state === "carried").length;
  const reviewState: PartState | null = work.review === null ? null : work.review === "passed" ? "passed" : work.review === "repair" ? "repair" : "checking";
  return (
    <section aria-label="The plan" className="flex flex-col gap-2.5" data-plan="stepper">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">{accepted ? "The plan" : "The plan, waiting for you"}</h4>
        <span className="text-xs tabular-nums text-ink-muted" data-parts-done="">
          {work.done} of {plural(total, "part")} done{carried > 0 && ` · ${carried} before`}
        </span>
      </div>
      {total + (reviewState ? 1 : 0) > 1 && (
        // A summary line: every part at a glance, in order, each the same width. The names are in the stepper beneath.
        <div aria-hidden className="flex gap-1" data-plan-track="">
          {work.parts.map((part) => (
            <span key={part.id} data-segment={part.state} className={cn("h-1.5 min-w-0 flex-1 overflow-hidden rounded-full", STATE_STYLE[part.state].bar)} />
          ))}
          {reviewState && <span data-segment="review" className={cn("h-1.5 min-w-0 flex-1 rounded-full", STATE_STYLE[reviewState].bar)} />}
        </div>
      )}
      <ol className="flex flex-col" aria-label="Parts">
        {work.parts.map((part, i) => (
          <StepperRow key={part.id} part={part} index={i} total={total} open={open === part.id} onOpen={() => setChosen(open === part.id ? "" : part.id)} technical={technical} last={i === total - 1 && !reviewState} />
        ))}
        {reviewState && <ReviewRow state={reviewState} label={work.review === "passed" ? "Passed" : work.review === "repair" ? "Fixing what it found" : "Being checked"} />}
      </ol>
    </section>
  );
}

/** The work's short name, on at most two lines; the whole of what was asked one tap away. */
function Title({ title, asked }: { title: string; asked: string | null }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <h3 className="line-clamp-2 font-sans text-sm font-semibold text-ink" title={title}>
        {title}
      </h3>
      {asked && (
        <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className={cn("self-start rounded-xs text-xs font-semibold text-primary-link hover:text-primary-hover", TAP)}>
          {all ? "Hide what was asked" : "Show what was asked"}
        </button>
      )}
      {asked && all && <p className="max-w-prose whitespace-pre-line text-sm text-ink-body">{asked}</p>}
    </>
  );
}

/** A step's node: centred on its row's first line; the line to the next node runs from this centre to that one's. */
function Node({ state, last, line }: { state: PartState; last: boolean; line: string }) {
  return (
    <>
      {!last && <span aria-hidden data-step-line="" className={cn("absolute -bottom-5 left-3 top-5 -ml-px w-0.5", line)} />}
      <span className={cn("relative z-10 mt-2 flex size-6 shrink-0 items-center justify-center rounded-full border-2", STATE_STYLE[state].dot)}>
        <StateIcon state={state} />
      </span>
    </>
  );
}

/** The security review: a step like the parts, with its own node, tag and the same column for the chevron. */
function ReviewRow({ state, label }: { state: PartState; label: string }) {
  return (
    <li className="relative flex gap-3" data-part-state={state} data-review="">
      <Node state={state} last line="" />
      <div className="flex min-h-touch min-w-0 flex-1 items-start gap-2 py-1.5">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <ShieldCheck aria-hidden className="size-4 text-ink-muted" />
            Security review
          </span>
          <Badge tone={STATE_STYLE[state].tone}>{label}</Badge>
        </div>
        <span aria-hidden className="size-4 shrink-0" />
      </div>
    </li>
  );
}

const StepperRow = memo(function StepperRow({ part, index, total, open, onOpen, technical, last }: { part: WorkPart; index: number; total: number; open: boolean; onOpen: () => void; technical: boolean; last: boolean }) {
  const settled = part.state === "passed" || part.state === "carried";
  return (
    <li className="relative flex gap-3" data-part-state={part.state} data-open-part={open ? "" : undefined}>
      <Node state={part.state} last={last} line={settled ? "bg-success" : "bg-border"} />
      <div className={cn("flex min-w-0 flex-1 flex-col pb-1.5", open && "pb-3")}>
        <button type="button" onClick={onOpen} aria-expanded={open} className="flex min-h-touch w-full items-start gap-2 py-1.5 text-left">
          <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <span className={cn("line-clamp-2 text-sm", open ? "font-semibold text-ink" : "text-ink-body")} title={part.label}>
              <span className="sr-only">
                Part {index + 1} of {total}:{" "}
              </span>
              {part.label}
            </span>
            <Badge tone={STATE_STYLE[part.state].tone}>{partStateLabel(part.state, part.repairs)}</Badge>
          </span>
          <ChevronDown aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        {open && (
          <div className="rounded-xs border bg-ground px-3 py-2.5">
            <PartBody part={part} technical={technical} />
          </div>
        )}
      </div>
    </li>
  );
});

const TASK_TONE: Record<WorkTask["status"], BadgeTone> = { open: "neutral", working: "info", done: "good", failed: "bad" };
const TASK_WORD: Record<WorkTask["status"], string> = { open: "Waiting", working: "Working", done: "Done", failed: "Did not succeed" };

/** Who holds a task, in words: a person by name, a role while nobody is hired for it, and "Unassigned" only when nobody has it and nothing is being done. */
function holderOf(t: WorkTask): string {
  if (t.holder) return t.holder;
  return t.status === "working" ? "Being worked on" : t.status === "done" || t.status === "failed" ? "—" : "Unassigned";
}

/** Under a part: its tasks with who holds each and how it went, what the checker said, and what the tools did. */
function PartBody({ part, technical }: { part: WorkPart; technical: boolean }) {
  const [actions, setActions] = useState(false);
  const idOf = useEmployeeIds();
  const sentence = tallySentence(part.tools);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {part.tasks.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Tasks">
          {part.tasks.map((t) => (
            <li key={t.id} className="flex min-w-0 items-center gap-2">
              <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">{TASK_ROLE_LABEL[t.role]}</span>
              {t.holder ? <Avatar name={t.holder} seed={t.holderKind === "role" ? undefined : idOf(t.holder)} size="xs" /> : null}
              <span className={cn("min-w-0 flex-1 truncate", t.holder ? "text-ink-body" : "text-ink-muted")}>{holderOf(t)}</span>
              <Badge tone={TASK_TONE[t.status]} className="shrink-0">
                {TASK_WORD[t.status]}
              </Badge>
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

/** What a researcher is doing, in the present tense while it works: "Looking for existing products". */
const PRESENT: [RegExp, string][] = [
  [/^looked\b/i, "Looking"],
  [/^checked\b/i, "Checking"],
  [/^searched\b/i, "Searching"],
  [/^found\b/i, "Finding"],
  [/^read\b/i, "Reading"],
  [/^compared\b/i, "Comparing"],
  [/^asked\b/i, "Asking"],
];

function lookingFor(title: string): string {
  const t = title.trim();
  for (const [past, now] of PRESENT) if (past.test(t)) return t.replace(past, now);
  if (/^[a-z]+ing\b/i.test(t)) return t;
  return `Looking for ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

function Researchers({ researchers, stacked }: { researchers: Researcher[]; stacked: boolean }) {
  const finished = researchers.filter((r) => r.state !== "working").length;
  // Side by side where there is room; below about 400 px each researcher is a row.
  const columns = stacked ? "grid-cols-1" : researchers.length >= 3 ? "grid-cols-3" : researchers.length === 2 ? "grid-cols-2" : "grid-cols-1";
  return (
    <section aria-label="The researchers" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">{researchers.length === 1 ? "The researcher" : `${researchers.length} researchers, at the same time`}</h4>
        <span className="text-xs tabular-nums text-ink-muted">
          {finished} of {researchers.length} reported
        </span>
      </div>
      <ul className={cn("grid gap-2", columns)} data-researchers={stacked ? "rows" : "tiles"}>
        {researchers.map((r) => (
          <li key={r.id} data-researcher={r.state} className={cn("flex min-w-0 gap-2 rounded-xs border bg-surface px-3 py-2", stacked ? "flex-row items-center" : "flex-col", r.state === "working" && "border-primary-line")}>
            <span aria-hidden className={cn("relative flex size-5 shrink-0 items-center justify-center rounded-full border-2", r.state === "working" ? "border-primary-line text-primary" : r.state === "done" ? "border-success bg-success text-primary-ink" : "border-attention bg-attention text-primary-ink")}>
              {r.state === "working" ? <StateIcon state="working" /> : r.state === "done" ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn("text-sm text-ink", stacked ? "truncate" : "line-clamp-3")} title={r.title}>
                {r.state === "working" ? lookingFor(r.title) : r.title}
              </span>
              <span className="text-xs tabular-nums text-ink-muted">
                {r.state === "working"
                  ? r.maxSearches
                    ? `${Math.min(r.searches, r.maxSearches)} of ${r.maxSearches} searches`
                    : plural(r.searches, "search", "searches")
                  : `${r.state === "done" ? "Reported" : "Stopped"} · ${plural(r.searches, "search", "searches")}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------------------------------

/**
 * One outcome row on every finished card: the sentence, then what to do next at natural width — open the app it
 * built or changed, read the verdict, or try it again — with the whole run beside it and what it cost.
 */
function Outcome({ work, runId, status, research, spent, estimate }: { work: WorkView; runId: string; status: RunStatus | null; research: boolean; spent: number; estimate: number | null }) {
  const run = useGetRunQuery(runId).data;
  const said = work.run.finishedSummary ?? run?.summary ?? null;
  const outcome = said ? curlyQuotes(said) : null;
  const failed = status === "failed" || status === "cancelled";
  const appId = status === "finished" ? (work.run.app?.id ?? null) : null;
  let primary: ReactNode = null;
  if (appId) primary = <OpenApp appId={appId} />;
  else if (research && run?.ideaId && status === "finished")
    primary = (
      <Link href={paths.idea(run.ideaId)} className={buttonVariants({ size: "sm" })}>
        Read the verdict
      </Link>
    );
  const retry = failed && run?.canTryAgain;
  return (
    <section aria-label="How it ended" data-result={status ?? ""} className="flex flex-col gap-2.5">
      {outcome && <p className={cn("text-sm", failed ? "text-attention-text" : "text-ink")}>{outcome}</p>}
      {retry && <TryAgain runId={runId} ideaId={run.ideaId} why={run.budgetExhausted ? "budget" : status === "cancelled" ? "cancelled" : "failed"} showCredits={run.budgetExhausted} />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {primary}
        <Link href={paths.run(runId)} className={cn(primary ? buttonVariants({ size: "sm", variant: "outline" }) : "flex items-center gap-0.5 rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover", !primary && TAP)}>
          See the whole run
          {!primary && <ArrowUpRight aria-hidden className="size-3.5" />}
        </Link>
        <span className="ml-auto text-xs tabular-nums text-ink-muted" data-cost="">
          {estimate !== null && estimate > 0 ? `Cost ${formatCredits(spent)} · estimated ${formatNumber(estimate)}` : `Cost ${formatCredits(spent)}`}
        </span>
      </div>
    </section>
  );
}

/** The app a build or a change made: open it, by its own name. */
function OpenApp({ appId }: { appId: string }) {
  const app = useGetAppQuery(appId).data;
  if (!app) return null;
  return (
    <a href={app.addresses.subdomain ?? app.addresses.path} target="_blank" rel="noreferrer noopener" className={buttonVariants({ size: "sm" })}>
      Open {app.name}
    </a>
  );
}

/** A person's stable id from their name, read from the organisation, so their avatar is their colour everywhere (ARCH-011). */
function useEmployeeIds(): (name: string) => string {
  const tree = useActiveTree().data;
  const ids = useMemo(() => (tree ? employeeIds(tree) : new Map<string, string>()), [tree]);
  return (name: string) => ids.get(name) ?? name;
}
