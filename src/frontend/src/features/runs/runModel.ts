import { isPlain, plainOrNull } from "@/lib/plain";
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
  detail: string | null;
  answer: string | null;
  seq: number;
  /** What declining does: the step is skipped and the work goes on, or the work stops. */
  onDecline: "continues" | "stops";
}

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
  estimateCredits: number | null;
  scored: { estimated: number; actual: number } | null;
  /** Credits the work used that were not charged: an agent repairing its own failed work. */
  notCharged: number;
  /** Parts an earlier attempt built and checked, kept by this one (a try again). */
  carried: string[];
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
    scored: null,
    notCharged: 0,
    carried: [],
    settledCredits: 0,
    reservedCredits: 0,
    modelCalls: 0,
    toolCalls: 0,
    toolDenials: 0,
    finishedSummary: null,
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
        run.status = outcome === "failed" ? "failed" : outcome === "cancelled" ? "cancelled" : "finished";
        run.finishedSummary = str(p, "summary");
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
        approvals.set(id, { id, question: str(p, "title") ?? str(p, "question") ?? "Your approval is needed.", detail: str(p, "detail"), answer: null, seq: e.seq, onDecline: str(p, "onDecline") === "stops" ? "stops" : "continues" });
        run.status = "waiting";
        break;
      }
      case "approval.answered": {
        const id = str(p, "approvalId") ?? "";
        const existing = approvals.get(id);
        if (existing) existing.answer = str(p, "answer") ?? "answered";
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
      case "estimate.made":
        run.estimateCredits = num(p, "credits");
        break;
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
      const declined = outcome === "failed" && isStartDeclined(str(p, "summary"));
      const title = declined ? "Not started: you declined it" : outcome === "failed" ? "Stopped: it did not succeed" : outcome === "cancelled" ? "Cancelled" : "Finished";
      return { ...base, tone: declined ? "quiet" : outcome === "failed" ? "attention" : "money", icon: "health", title, detail: str(p, "summary"), credits: totals ? credits(num(totals, "credits")) : null };
    }
    case "plan.proposed":
      return { ...base, tone: "factory", icon: "plan", title: "Proposed the plan", detail: str(p, "summary") };
    case "plan.accepted":
      return { ...base, tone: "factory", icon: "plan", title: "The plan was agreed", detail: str(p, "summary") };
    case "task.created":
      return { ...base, tone: "structure", icon: "plan", title: `New task: ${str(p, "title") ?? str(p, "summary") ?? "untitled"}` };
    case "task.claimed":
      return { ...base, tone: "people", icon: "employee", title: `${str(p, "holder") ?? "Someone"} took on a task`, detail: str(p, "summary") };
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
      if (!technical) {
        return { ...base, tone: "attention", icon: "secrets", title: "An action was refused by your rules", detail: "It was not carried out. The work continues without it." };
      }
      return { ...base, tone: "attention", icon: "secrets", title: `Denied: ${str(p, "name") ?? str(p, "tool") ?? "tool"}`, detail: [str(p, "rule") && `Rule: ${str(p, "rule")}`, str(p, "reason")].filter(Boolean).join(" · ") || null };
    case "tool.result":
      if (!technical) return null;
      return { ...base, tone: "quiet", icon: "build", title: `Result: ${str(p, "name") ?? str(p, "tool") ?? "tool"}`, detail: str(p, "content") ?? str(p, "result") };
    case "subagent.started":
      return { ...base, tone: "people", icon: "contractors", title: str(p, "title") ? `Briefed: ${str(p, "title")}` : "A contractor was briefed", detail: str(p, "brief") };
    case "subagent.finished":
      return { ...base, tone: "people", icon: "contractors", title: str(p, "title") ? `Reported back: ${str(p, "title")}` : "A contractor reported back", detail: str(p, "summary") };
    case "approval.requested":
      return { ...base, tone: "attention", icon: "verdict", title: "Asked for your approval", detail: str(p, "title") ?? str(p, "question") };
    case "approval.answered":
      return { ...base, tone: "attention", icon: "verdict", title: `You answered: ${answerWord(str(p, "answer"))}`, detail: str(p, "comment") ?? str(p, "note") };
    case "evaluation.passed":
      return { ...base, tone: "money", icon: "evaluate", title: `Checked and passed: ${itemName(p, planItem, mode)}`, detail: technical ? str(p, "evidence") : plainOrNull(str(p, "summary")) };
    case "evaluation.failed":
      return { ...base, tone: "attention", icon: "evaluate", title: `Checked and failed: ${itemName(p, planItem, mode)}`, detail: technical ? str(p, "evidence") : plainOrNull(str(p, "summary")) };
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
      return { ...base, tone: "structure", icon: "employee", title: str(p, "from") ?? "Update", detail: str(p, "text") };
    default:
      if (!technical) return null;
      return { ...base, tone: "quiet", icon: "plan", title: e.type };
  }
}

/** The owner's answer as they would say it: a rejection is a decline (D19). */
export function answerWord(answer: string | null): string {
  if (answer === "rejected" || answer === "reject" || answer === "declined") return "declined";
  if (answer === "approved" || answer === "approve") return "approved";
  return answer ?? "answered";
}

/** Work the owner declined at its start checkpoint: it never began, so it neither failed nor has an estimate to score. */
export function isStartDeclined(summary: string | null | undefined): boolean {
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
