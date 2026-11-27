import { formatNumber } from "@/lib/format";
import { isPlain, plainOrNull, withoutPaths } from "@/lib/plain";

const withoutPathsOrNull = (text: string | null) => (text === null ? null : withoutPaths(text));
import type { RunEvent, RunStatus } from "@/store/types";

/**
 * The run log, folded. Events arrive over a resumable stream, possibly twice and possibly out of
 * order across a reconnect; {@link mergeEvents} makes the log exact, and {@link deriveRun} reads
 * everything the run view shows from that log alone.
 */

export function mergeEvents(current: readonly RunEvent[], incoming: readonly RunEvent[]): RunEvent[] {
  if (incoming.length === 0) return current as RunEvent[];
  // The usual case, a live stream: every new event follows the last one held, in order.
  let last = lastSeq(current);
  let inOrder = true;
  for (const e of incoming) {
    if (!Number.isInteger(e.seq) || e.seq <= last) {
      inOrder = false;
      break;
    }
    last = e.seq;
  }
  if (inOrder) return [...current, ...incoming];
  const bySeq = new Map<number, RunEvent>();
  for (const e of current) bySeq.set(e.seq, e);
  let changed = false;
  for (const e of incoming) {
    if (!Number.isInteger(e.seq) || bySeq.has(e.seq)) continue;
    bySeq.set(e.seq, e);
    changed = true;
  }
  if (!changed) return current as RunEvent[];
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function lastSeq(events: readonly RunEvent[]): number {
  return events.length === 0 ? 0 : (events[events.length - 1]?.seq ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Payload readers — the payload is the control plane's JSON; nothing in it is trusted to be typed.
// ---------------------------------------------------------------------------------------------

export function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function num(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function obj(payload: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = payload[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function list(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = payload[key];
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

// ---------------------------------------------------------------------------------------------
// The derived run
// ---------------------------------------------------------------------------------------------

export type TaskStatus = "open" | "working" | "done" | "failed";

export interface DerivedTask {
  id: string;
  summary: string;
  status: TaskStatus;
  holder: string | null;
  note: string | null;
}

export interface DerivedApproval {
  id: string;
  question: string;
  /** The plain sentence of what approving does; the owner reads it. */
  detail: string | null;
  /** The tool line behind it (`change_app: …`), for technical mode only. Older runs wrote it as `detail`. */
  technical: string | null;
  /**
   * `approved`, `rejected`, or `expired` — closed by the platform because the run ended before anyone answered it (R3-2);
   * null while it waits.
   */
  answer: string | null;
  /** The note given with the answer, if any; an expired approval's is {@link EXPIRED_NOTE}. */
  note: string | null;
  seq: number;
  /** What declining does: the step is skipped and the work goes on, or the work stops. */
  onDecline: "continues" | "stops";
}

/** An approval the platform closed because its run ended first (`ApprovalStatuses.Expired`). */
export const EXPIRED = "expired";

/** What an expired approval says, in the words people read (`ApprovalStatuses.ExpiredNote`). */
export const EXPIRED_NOTE = "The work ended before this was answered.";

/**
 * One item of a plan. The planner writes `text` for the owner and `detail` for technical mode
 * (ARCH-004, the run log); older plans wrote one technical `text` only, so `plain` is that text
 * when it reads as plain language and null when it names files or commands.
 */
export interface PlanItem {
  id: string;
  text: string;
  /** The technical detail: files, endpoints, tests. Technical mode only. */
  detail: string | null;
  /** What normal mode may print for this item, or null when the item has no plain wording. */
  plain: string | null;
  check: string | null;
  /** The requirement ids this item delivers (technical mode). */
  covers: string[];
  result: "passed" | "failed" | null;
  evidence: string | null;
  /** The evaluator's plain sentence about the check, when it wrote one. */
  outcome: string | null;
}

export interface DerivedPlan {
  summary: string | null;
  items: PlanItem[];
  accepted: boolean;
  /** What the idea asks for, in its own words. */
  requirements: { id: string; text: string }[];
  /** A requirement deliberately not built, with the reason the owner reads. */
  leftOut: { requirement: string; text: string; reason: string }[];
}

export function planItemOf(item: Record<string, unknown>, index: number): PlanItem {
  const text = str(item, "text") ?? "";
  const detail = str(item, "detail");
  // The newer shape carries `detail` beside a plain `text`; the older one put the detail in `text`.
  const newer = "detail" in item;
  return {
    id: str(item, "id") ?? String(index + 1),
    text,
    detail: newer ? detail : null,
    plain: newer ? text || null : isPlain(text) ? text : null,
    check: str(item, "check"),
    covers: Array.isArray(item.covers) ? item.covers.filter((x): x is string => typeof x === "string") : [],
    result: null,
    evidence: null,
    outcome: null,
  };
}

/** How normal mode names a plan item: its plain words, or its place in the plan. */
export function planItemLabel(plan: DerivedPlan | null, id: string, mode: Mode): string | null {
  const items = plan?.items ?? [];
  const index = items.findIndex((i) => i.id === id || i.text === id);
  const item = items[index];
  if (!item) return null;
  if (mode === "technical") return item.text;
  return item.plain ?? `Part ${index + 1} of ${items.length} of the plan`;
}

export interface DerivedRun {
  /** The status the log implies, or null if the log says nothing about it yet. */
  status: RunStatus | null;
  outcome: string | null;
  plan: DerivedPlan | null;
  tasks: DerivedTask[];
  approvals: DerivedApproval[];
  messages: { seq: number; text: string; from: string | null; at: string; code: string | null; title: string | null }[];
  /** The latest estimate in the log. */
  estimateCredits: number | null;
  /** The estimate shown before the work began: the log's first (R2-8). */
  firstEstimateCredits: number | null;
  /** The re-estimate from the plan (`estimate.made` with stage "plan"), when one followed the first. */
  plannedEstimateCredits: number | null;
  scored: { estimated: number; actual: number } | null;
  /** Credits the work used that were not charged: an agent repairing its own failed work. */
  notCharged: number;
  /** Parts an earlier attempt built and checked, kept by this one (a try again). */
  carried: string[];
  /**
   * The plan's word that something is for people who do not sign in, so it works for them once the owner makes the app
   * public (R2-11): the sentence from the builder's "The plan" message, or null.
   */
  publicOnlyNote: string | null;
  /**
   * Credits charged for finished model calls: the billable settlements, counted as the ledger counts
   * them, so it is the same figure as the run's own cost (`spentCredits`). A repair of the work's own
   * mistake settles too, but is never billed, so it is not in it.
   */
  settledCredits: number;
  /** Credits held for model calls still in flight. */
  reservedCredits: number;
  modelCalls: number;
  toolCalls: number;
  toolDenials: number;
  finishedSummary: string | null;
  /** Why it finished, when the runner says (`declined_at_start`). */
  finishedReason: string | null;
  /** `run.finished`'s technical detail (what the gateway said, a fault): technical mode only. */
  finishedDetail: string | null;
}

export function deriveRun(events: readonly RunEvent[]): DerivedRun {
  const run: DerivedRun = {
    status: null,
    outcome: null,
    plan: null,
    tasks: [],
    approvals: [],
    messages: [],
    estimateCredits: null,
    firstEstimateCredits: null,
    plannedEstimateCredits: null,
    scored: null,
    notCharged: 0,
    carried: [],
    publicOnlyNote: null,
    settledCredits: 0,
    reservedCredits: 0,
    modelCalls: 0,
    toolCalls: 0,
    toolDenials: 0,
    finishedSummary: null,
    finishedReason: null,
    finishedDetail: null,
  };
  const tasks = new Map<string, DerivedTask>();
  const approvals = new Map<string, DerivedApproval>();
  const openReservations = new Map<string, number>();
  let anonymousReservation = 0;

  for (const e of events) {
    const p = e.payload ?? {};
    switch (e.type) {
      case "run.started":
      case "run.resumed":
        run.status = "running";
        break;
      case "run.paused":
        run.status = "paused";
        break;
      case "run.finished": {
        const outcome = str(p, "outcome");
        run.outcome = outcome;
        // The run's end closes every approval it still waits on, in the same step (`RunService.ExpireOpenApprovalsAsync`).
        for (const a of approvals.values()) {
          if (a.answer !== null) continue;
          a.answer = EXPIRED;
          a.note = EXPIRED_NOTE;
        }
        run.status = outcome === "failed" ? "failed" : outcome === "cancelled" ? "cancelled" : "finished";
        run.finishedSummary = str(p, "summary");
        run.finishedReason = str(p, "reason");
        run.finishedDetail = str(p, "detail");
        openReservations.clear();
        anonymousReservation = 0;
        break;
      }
      case "plan.proposed":
      case "plan.accepted": {
        const items = list(p, "items").map(planItemOf);
        const previous = run.plan;
        const requirements = list(p, "requirements").map((r, i) => ({ id: str(r, "id") ?? String(i + 1), text: str(r, "text") ?? "" })).filter((r) => r.text);
        const leftOut = list(p, "leftOut").map((r) => ({ requirement: str(r, "requirement") ?? "", text: str(r, "text") ?? "", reason: str(r, "reason") ?? "" })).filter((r) => r.text || r.reason);
        run.plan = {
          summary: str(p, "summary") ?? previous?.summary ?? null,
          items: items.length > 0 ? items : (previous?.items ?? []),
          accepted: e.type === "plan.accepted" || (previous?.accepted ?? false),
          requirements: requirements.length > 0 ? requirements : (previous?.requirements ?? []),
          leftOut: leftOut.length > 0 ? leftOut : (previous?.leftOut ?? []),
        };
        break;
      }
      case "task.created": {
        const id = str(p, "taskId") ?? `task-${e.seq}`;
        tasks.set(id, { id, summary: str(p, "title") ?? str(p, "summary") ?? "A task", status: "open", holder: null, note: null });
        break;
      }
      case "task.claimed":
      case "task.done":
      case "task.failed": {
        const id = str(p, "taskId") ?? "";
        const task = tasks.get(id) ?? { id, summary: str(p, "title") ?? str(p, "summary") ?? "A task", status: "open" as TaskStatus, holder: null, note: null };
        if (e.type === "task.claimed") {
          task.status = "working";
          task.holder = str(p, "holder");
        } else if (e.type === "task.done") {
          task.status = "done";
          task.note = str(p, "summary");
        } else {
          task.status = "failed";
          task.note = str(p, "reason");
        }
        tasks.set(id, task);
        break;
      }
      case "model.requested": {
        const reserved = num(p, "reservedCredits") ?? 0;
        const callId = str(p, "callId");
        if (callId) openReservations.set(callId, reserved);
        else anonymousReservation += reserved;
        break;
      }
      case "model.replied": {
        run.modelCalls += 1;
        if (p.billable !== false) run.settledCredits += num(p, "settledCredits") ?? 0;
        const callId = str(p, "callId");
        if (callId) openReservations.delete(callId);
        else anonymousReservation = Math.max(0, anonymousReservation - (num(p, "reservedCredits") ?? anonymousReservation));
        break;
      }
      case "tool.requested":
        run.toolCalls += 1;
        break;
      case "tool.denied":
        run.toolDenials += 1;
        break;
      case "approval.requested": {
        const id = str(p, "approvalId") ?? `approval-${e.seq}`;
        const detail = str(p, "detail");
        const technicalLine = str(p, "technical");
        // An older run kept the tool line ("change_app: …") in `detail`: then it is technical, never the owner's sentence.
        const legacy = technicalLine === null && detail !== null && (TOOL_LINE.test(detail) || !isPlain(detail));
        approvals.set(id, {
          id,
          question: str(p, "title") ?? str(p, "question") ?? "Your approval is needed.",
          detail: legacy ? null : detail,
          technical: technicalLine ?? (legacy ? detail : null),
          answer: null,
          note: null,
          seq: e.seq,
          onDecline: str(p, "onDecline") === "stops" ? "stops" : "continues",
        });
        run.status = "waiting";
        break;
      }
      case "approval.answered": {
        const id = str(p, "approvalId") ?? "";
        const existing = approvals.get(id);
        if (existing) {
          existing.answer = str(p, "answer") ?? "answered";
          existing.note = str(p, "comment") ?? str(p, "note");
        }
        if ([...approvals.values()].every((a) => a.answer !== null) && run.status === "waiting") run.status = "running";
        break;
      }
      case "evaluation.passed":
      case "evaluation.failed": {
        const item = str(p, "item");
        const target = run.plan?.items.find((i) => i.id === item || i.text === item);
        if (target) {
          target.result = e.type === "evaluation.passed" ? "passed" : "failed";
          target.evidence = str(p, "evidence");
          target.outcome = str(p, "summary");
        }
        break;
      }
      case "estimate.made": {
        const credits = num(p, "credits");
        run.estimateCredits = credits;
        if (credits === null) break;
        if (run.firstEstimateCredits === null) run.firstEstimateCredits = credits;
        else if (str(p, "stage") === "plan") run.plannedEstimateCredits = credits;
        break;
      }
      case "estimate.scored": {
        const scored = readScored(p);
        if (scored) run.scored = scored;
        run.notCharged = num(p, "nonBillableCredits") ?? run.notCharged;
        break;
      }
      case "message": {
        if (str(p, "kind") === "plan.carried") {
          const kept = Array.isArray(p.items) ? p.items.filter((x): x is string => typeof x === "string") : [];
          run.carried = kept;
          for (const item of run.plan?.items ?? []) {
            if (kept.includes(item.id)) {
              item.result = "passed";
              item.outcome = "Built and checked in the earlier attempt; kept, not built or charged again.";
            }
          }
        }
        // A message as written, for a person: harness bookkeeping (`kind`: agent.start, nudge…) is not one.
        const text = str(p, "text");
        if (text && str(p, "milestone") === "planned") run.publicOnlyNote = PUBLIC_ONLY.exec(text)?.[0].trim() ?? run.publicOnlyNote;
        if (text && !str(p, "kind")) run.messages.push({ seq: e.seq, text, from: str(p, "from"), at: e.at, code: str(p, "code"), title: str(p, "title") });
        break;
      }
      default:
        break;
    }
  }

  run.tasks = [...tasks.values()];
  run.approvals = [...approvals.values()];
  run.reservedCredits = [...openReservations.values()].reduce((a, b) => a + b, 0) + anonymousReservation;
  return run;
}

export function isTerminal(status: RunStatus | null | undefined): boolean {
  return status === "finished" || status === "failed" || status === "cancelled";
}

// ---------------------------------------------------------------------------------------------
// The trace — each event as a readable step
// ---------------------------------------------------------------------------------------------

export type Mode = "normal" | "technical";

export type StepTone = "structure" | "people" | "factory" | "money" | "attention" | "quiet";

export interface TraceStep {
  seq: number;
  at: string;
  tone: StepTone;
  icon: "plan" | "build" | "evaluate" | "research" | "contractors" | "credits" | "verdict" | "assistants" | "secrets" | "publish" | "health" | "employee";
  title: string;
  detail: string | null;
  credits: string | null;
  /** Raw payload, shown in technical mode only. */
  raw: string | null;
}

function credits(n: number | null): string | null {
  if (n === null) return null;
  return `${formatCredits(n)} credits`;
}

export function formatCredits(n: number): string {
  const rounded = Math.abs(n) < 10 && !Number.isInteger(n) ? Math.round(n * 100) / 100 : Math.round(n);
  return rounded.toLocaleString("en-GB");
}


/**
 * Whether a refusal was the owner's own answer at an approval — `by: "owner"`, or, in an older run's log, a
 * `checkpoint:…:rejected` rule — rather than a rule that refused without asking (R6-1).
 */
export function declinedByOwner(p: Record<string, unknown>): boolean {
  const by = str(p, "by");
  if (by) return by === "owner";
  const rule = str(p, "rule") ?? "";
  return rule.startsWith("checkpoint:") && rule.endsWith(":rejected");
}

/**
 * A refusal in normal mode, said truthfully: "You declined: search the web for …" when the owner answered no, and
 * "An action was refused by your rules" only when a rule refused it without asking (R6-1).
 */
export function refusalStep(p: Record<string, unknown>): Pick<TraceStep, "tone" | "icon" | "title" | "detail"> {
  if (!declinedByOwner(p)) {
    return { tone: "attention", icon: "secrets", title: "An action was refused by your rules", detail: "It was not carried out. The work continues without it." };
  }
  const said = str(p, "declined") ?? (str(p, "name") === "web_search" ? "search the web" : "a step the work asked you about");
  const title = `You declined: ${said}`;
  return { tone: "attention", icon: "verdict", title: isPlain(title) ? title : "You declined a step the work asked you about", detail: "It was not done. The work continues without it." };
}

/**
 * One event as a step. Normal mode speaks plainly and never names infrastructure — no tool names,
 * models, containers or repositories — and leaves the mechanics (single model and tool calls) to
 * the summary counts. Technical mode shows every event with its raw detail.
 */
export function describeEvent(e: RunEvent, mode: Mode, planItem: (id: string) => string | null = () => null): TraceStep | null {
  const p = e.payload ?? {};
  const technical = mode === "technical";
  const base = { seq: e.seq, at: e.at, raw: technical ? JSON.stringify(p, null, 2) : null, credits: null as string | null, detail: null as string | null };

  switch (e.type) {
    case "run.started":
      return { ...base, tone: "structure", icon: "plan", title: "Work started", detail: str(p, "reason") };
    case "run.paused":
      return { ...base, tone: "quiet", icon: "plan", title: "Paused", detail: technical ? str(p, "reason") : pauseReason(p) };
    case "run.resumed":
      return { ...base, tone: "structure", icon: "plan", title: "Resumed" };
    case "run.finished": {
      const outcome = str(p, "outcome");
      const totals = obj(p, "totals");
      const declined = isStartDeclined(str(p, "summary"), str(p, "reason"));
      const title = declined ? "Not started: you declined it" : outcome === "failed" ? "Stopped: it did not succeed" : outcome === "cancelled" ? "Cancelled" : "Finished";
      const detail = technical ? [str(p, "summary"), str(p, "detail")].filter(Boolean).join("\n\n") || null : str(p, "summary");
      return { ...base, tone: declined ? "quiet" : outcome === "failed" ? "attention" : "money", icon: "health", title, detail, credits: totals ? credits(num(totals, "credits")) : null };
    }
    case "plan.proposed":
      return { ...base, tone: "factory", icon: "plan", title: "Proposed the plan", detail: str(p, "summary") };
    case "plan.accepted":
      return { ...base, tone: "factory", icon: "plan", title: "The plan was agreed", detail: str(p, "summary") };
    case "task.created":
      return { ...base, tone: "structure", icon: "plan", title: `New task: ${str(p, "title") ?? str(p, "summary") ?? "untitled"}` };
    case "task.claimed": {
      // Who took it on and what it is, both named (`TaskService.ClaimAsync`): never "Someone took on a task".
      const holder = str(p, "holder");
      const summary = str(p, "summary");
      const title = holder ? (summary ? `${holder} took on: ${summary}` : `${holder} took on a task`) : summary ? `Taken on: ${summary}` : "A task was taken on";
      return { ...base, tone: "people", icon: "employee", title, detail: null };
    }
    case "task.done":
      return { ...base, tone: "money", icon: "health", title: "Task done", detail: str(p, "summary") };
    case "task.failed":
      return { ...base, tone: "attention", icon: "verdict", title: "A task did not succeed", detail: str(p, "reason") };
    case "model.requested":
      if (!technical) return null;
      return {
        ...base,
        tone: "money",
        icon: "assistants",
        title: `Model call: ${str(p, "model") ?? "model"} for ${str(p, "taskType") ?? "a task"}`,
        credits: num(p, "reservedCredits") !== null ? `${formatCredits(num(p, "reservedCredits") ?? 0)} reserved` : null,
      };
    case "model.replied": {
      if (!technical) return null;
      const tokens = obj(p, "tokens");
      const detail = tokens ? `${num(tokens, "input") ?? 0} tokens in, ${num(tokens, "output") ?? 0} out` : null;
      return { ...base, tone: "money", icon: "assistants", title: `Model replied: ${str(p, "model") ?? "model"}`, detail, credits: credits(num(p, "settledCredits")) };
    }
    case "tool.requested":
      if (!technical) return null;
      return { ...base, tone: "structure", icon: "build", title: `Tool: ${str(p, "name") ?? str(p, "tool") ?? "tool"}`, detail: p.arguments === undefined ? null : JSON.stringify(p.arguments) };
    case "tool.permitted":
      if (!technical) return null;
      return { ...base, tone: "money", icon: "secrets", title: `Allowed: ${str(p, "name") ?? str(p, "tool") ?? "tool"}`, detail: str(p, "rule") ? `Rule: ${str(p, "rule")}` : null };
    case "tool.denied":
      if (!technical) return { ...base, ...refusalStep(p) };
      return {
        ...base,
        tone: "attention",
        icon: "secrets",
        title: `${declinedByOwner(p) ? "Declined by you" : "Denied"}: ${str(p, "name") ?? str(p, "tool") ?? "tool"}`,
        detail: [str(p, "rule") && `Rule: ${str(p, "rule")}`, str(p, "reason")].filter(Boolean).join(" · ") || null,
      };
    case "tool.result":
      if (!technical) return null;
      return { ...base, tone: "quiet", icon: "build", title: `Result: ${str(p, "name") ?? str(p, "tool") ?? "tool"}`, detail: str(p, "content") ?? str(p, "result") };
    case "subagent.started":
      return { ...base, tone: "people", icon: "contractors", title: str(p, "title") ? `Briefed: ${str(p, "title")}` : "A contractor was briefed", detail: str(p, "brief") };
    case "subagent.finished":
      return { ...base, tone: "people", icon: "contractors", title: str(p, "title") ? `Reported back: ${str(p, "title")}` : "A contractor reported back", detail: str(p, "summary") };
    case "approval.requested":
      return { ...base, tone: "attention", icon: "verdict", title: "Asked for your approval", detail: [str(p, "title") ?? str(p, "question"), technical ? (str(p, "technical") ?? null) : null].filter(Boolean).join("\n") || null };
    case "approval.answered":
      return { ...base, tone: "attention", icon: "verdict", title: `You answered: ${answerWord(str(p, "answer"))}`, detail: str(p, "comment") ?? str(p, "note") };
    case "evaluation.passed":
      return { ...base, tone: "money", icon: "evaluate", title: `Checked and passed: ${itemName(p, planItem, mode)}`, detail: evaluationDetail(p, mode) };
    case "evaluation.failed":
      return { ...base, tone: "attention", icon: "evaluate", title: `Checked and failed: ${itemName(p, planItem, mode)}`, detail: evaluationDetail(p, mode) };
    case "estimate.made":
      return { ...base, tone: "money", icon: "credits", title: str(p, "stage") === "plan" ? "Estimated the cost again, from the plan" : "Estimated the cost", credits: credits(num(p, "credits")) };
    case "estimate.scored": {
      const scored = readScored(p);
      return {
        ...base,
        tone: "money",
        icon: "credits",
        title: "Scored the estimate",
        detail: scored ? `Estimated ${formatCredits(scored.estimated)}, cost ${formatCredits(scored.actual)} (${accuracy(scored.estimated, scored.actual)})` : null,
      };
    }
    case "message":
      return { ...base, tone: "structure", icon: "employee", title: str(p, "from") ?? "Update", detail: technical ? str(p, "text") : withoutPathsOrNull(str(p, "text")) };
    default:
      if (!technical) return null;
      return { ...base, tone: "quiet", icon: "plan", title: e.type };
  }
}

/** The plain lines a check's judgement adds beneath its sentence (R3-1): a second look, a screen's own test, an early stop. */
export const CHECK_LINES = {
  rechecked: "Checked again by a second checker, at no charge.",
  stoppedEarly: "Stopped early: the same requirement failed the same way three times.",
  shownByTest: (title: string | null) => (title ? `Shown by the screen's own test: “${title}”.` : "Shown by the screen's own test."),
} as const;

/** How a requirement failed (`EvaluationGate`'s `failing`: `r4:unshown`), in the owner's words. */
const FAILED_HOW: Record<string, string> = {
  "not-met": "it does not work yet.",
  unshown: "the checker said it works, but nothing it gave shows it in the running app.",
  unchecked: "it was not checked in the running app.",
};

function strings(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** The sentences of a text that read as plain language, kept whole: a technical sentence is left out, never cut. */
export function plainSentences(text: string | null): string | null {
  if (!text) return null;
  const kept = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && isPlain(sentence));
  return kept.length > 0 ? kept.join(" ") : null;
}

/** A screen test as the gate names it, `file > title`: its title, which is what a person reads. */
function testTitle(test: string): string {
  const at = test.lastIndexOf(" > ");
  return at >= 0 ? test.slice(at + 3) : test;
}

/**
 * What a check's judgement says beneath its title. Normal mode: the owner's sentence (left out with `withSummary: false`,
 * when the plan card already says it), then each requirement that was not shown working, quoted with how it failed and
 * what the checker saw, in its plain sentences; a screen requirement shown by the screen's own test; a second look; an
 * early stop. Technical mode: the evidence, the tests by name, the failing list.
 */
export function evaluationDetail(p: Record<string, unknown>, mode: Mode, withSummary = true): string | null {
  const requirements = list(p, "requirements");
  const failing = strings(p, "failing");
  if (mode === "technical") {
    const tests = requirements.flatMap((r) => strings(r, "tests").map((t) => `Test (${str(r, "id") ?? "?"}): ${t}`));
    const lines = [
      str(p, "evidence"),
      ...tests,
      failing.length > 0 ? `Failing: ${failing.join(", ")}` : null,
      p.rechecked === true ? "Rechecked: a second evaluator looked at the same build, not billed." : null,
      p.stoppedEarly === true ? "Stopped early: the same failure three checks running, so no further repair round." : null,
    ];
    return lines.filter(Boolean).join("\n") || null;
  }
  const lines: string[] = [];
  const summary = plainOrNull(str(p, "summary"));
  if (withSummary && summary) lines.push(summary);
  if (p.rechecked === true) lines.push(CHECK_LINES.rechecked);
  const unmet = requirements.filter((r) => r.met !== true);
  for (const r of unmet) {
    const id = str(r, "id") ?? "";
    const how = failing.find((f) => f.startsWith(`${id}:`))?.split(":")[1] ?? (r.met === false && str(r, "evidence") ? "not-met" : "unchecked");
    const text = (str(r, "text") ?? "").replace(/[.!?]+$/, "");
    const saw = plainSentences(str(r, "evidence"));
    const quoted = text && isPlain(text) ? `“${text}”: ` : "A requirement: ";
    lines.push(`${quoted}${FAILED_HOW[how] ?? FAILED_HOW.unchecked}${saw ? ` What the checker saw: “${saw}”` : ""}`);
  }
  // An older judgement, or one with no requirements, carries only its faults: the plain ones are what the checker saw.
  if (unmet.length === 0 && requirements.length === 0) {
    for (const fault of strings(p, "faults")) {
      const saw = plainSentences(fault);
      if (saw) lines.push(`What the checker saw: “${saw}”`);
    }
  }
  for (const r of requirements) if (r.met === true) for (const t of strings(r, "tests")) lines.push(CHECK_LINES.shownByTest(plainOrNull(testTitle(t))));
  if (p.stoppedEarly === true) lines.push(CHECK_LINES.stoppedEarly);
  return lines.join("\n") || null;
}

/** The owner's answer as they would say it: a rejection is a decline (D19). */
export function answerWord(answer: string | null): string {
  if (answer === "rejected" || answer === "reject" || answer === "declined") return "declined";
  if (answer === "approved" || answer === "approve") return "approved";
  return answer ?? "answered";
}

/** A tool's line as the harness writes it for technical mode: `change_app: …`, `adjust_setting: …`. */
const TOOL_LINE = /^[a-z]+(_[a-z]+)*(:\s|\.\s)/;

/** `run.finished`'s reason for work the owner declined at its start (`WorkflowOutcome.DeclinedReason`). */
export const DECLINED_AT_START = "declined_at_start";

/**
 * Work the owner declined at its start checkpoint: it never began, so it neither failed nor has an estimate to score.
 * Keyed on `run.finished`'s reason; older runs (which finished `failed`) are known by their summary.
 */
export function isStartDeclined(summary: string | null | undefined, reason?: string | null): boolean {
  if (reason === DECLINED_AT_START) return true;
  return !!summary && /^(The owner declined to start|You declined to start)/.test(summary);
}

/** Why a run paused, in plain words; a reason code the owner has no words for is left to technical mode. */
const PAUSE_REASONS: Record<string, string> = {
  estimate_over_budget: "Its estimate is more than the budget has left, so it waits for more credits.",
  budget_exhausted: "The credit budget ran out, so it waits for more credits.",
  owner: "You paused it.",
};

function pauseReason(p: Record<string, unknown>): string | null {
  const reason = str(p, "reason");
  if (reason && PAUSE_REASONS[reason]) return PAUSE_REASONS[reason];
  if (str(p, "by") === "owner" || str(p, "by") === "person") return PAUSE_REASONS.owner ?? null;
  return reason && !/^[a-z0-9]+(_[a-z0-9]+)+$/.test(reason) ? reason : null;
}

/** `estimate.scored` is `{ expectedCredits, actualCredits, nonBillableCredits, modelCalls }`; older runs wrote `{ estimated, actual }`. */
export function readScored(p: Record<string, unknown>): { estimated: number; actual: number } | null {
  const estimated = num(p, "expectedCredits") ?? num(p, "estimated");
  const actual = num(p, "actualCredits") ?? num(p, "actual");
  return estimated !== null && actual !== null ? { estimated, actual } : null;
}

function itemName(p: Record<string, unknown>, planItem: (id: string) => string | null, mode: Mode): string {
  const item = str(p, "item");
  const text = mode === "technical" ? str(p, "text") : plainOrNull(str(p, "text"));
  if (!item) return text ?? "a part of the plan";
  return planItem(item) ?? text ?? (mode === "technical" ? item : "a part of the plan");
}

/**
 * Which estimate a figure is compared with, said with it (R2-8): the first, shown before the work began, or the
 * re-estimate once the plan was made.
 */
export function estimateName(figure: number, first: number | null, planned: number | null): string {
  const near = (a: number | null) => a !== null && Math.abs(a - figure) < 0.005;
  if (planned !== null && near(planned)) return `the ${formatNumber(figure)} estimated once planned`;
  if (near(first)) return planned !== null ? `the ${formatNumber(figure)} shown before the work began` : "the estimate shown before the work began";
  return `an estimate of ${formatNumber(figure)}`;
}

/** `PlanRequirement.PublicOnlyNote`'s sentence inside the plan message. */
const PUBLIC_ONLY = /[^.!?]*\bonce you make the app public\b[^.!?]*[.!?]/i;

export function accuracy(estimated: number, actual: number): string {
  if (estimated <= 0) return "no estimate";
  const diff = Math.round(((actual - estimated) / estimated) * 100);
  if (diff === 0) return "on the estimate";
  return diff > 0 ? `${diff}% over` : `${-diff}% under`;
}

/** What the person reads once they have answered: the truth about what happens next, never a promise the work does not keep. */
export function answeredText(decision: "approve" | "reject", onDecline: DerivedApproval["onDecline"]): string {
  if (decision === "approve") return "Approved. The work carries on from here.";
  return onDecline === "stops" ? "Declined. It was not done, so the work has stopped." : "Declined. It was not done; the work continues without it.";
}
