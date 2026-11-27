import { plural } from "@/lib/format";
import { firstSentence, plainOrNull } from "@/lib/plain";
import type { RunEvent } from "@/store/types";
import { deriveRun, num, planItemLabel, str, type DerivedApproval, type DerivedRun, type Mode, type TaskStatus } from "../runs/runModel";
import { outcomeOf } from "../runs/timeline";

/**
 * A run's log, read for the work card in the conversation (ARCH-011): the plan as parts with a
 * state each, the tasks under each part with who holds them, what the tools did summarised in
 * groups, the researchers side by side, and who is doing the work. One pass over the log on top of
 * {@link deriveRun}; the card memoises it by the log, which only ever grows.
 */

export type PartState = "waiting" | "working" | "checking" | "repair" | "passed" | "needs-look" | "failed";

export type TaskRole = "build" | "check" | "repair" | "review" | "other";

export interface WorkTask {
  id: string;
  summary: string;
  role: TaskRole;
  status: TaskStatus;
  holder: string | null;
  note: string | null;
}

/** What the tools did, by kind: the counts a sentence is made of, and each action for technical mode. */
export interface ToolTally {
  read: number;
  changed: number;
  ran: number;
  tests: number;
  searched: number;
  saved: number;
  other: number;
  /** The most recent actions, oldest first (at most {@link MAX_ACTIONS}). */
  actions: { seq: number; name: string; detail: string | null }[];
  total: number;
}

export interface WorkPart {
  id: string;
  label: string;
  state: PartState;
  /** How many times it was sent back for repair. */
  repairs: number;
  /** The checker's last sentence about it. */
  outcome: string | null;
  tasks: WorkTask[];
  tools: ToolTally;
}

export interface Researcher {
  id: string;
  title: string;
  state: "working" | "done" | "stopped";
  searches: number;
  maxSearches: number | null;
  outcome: string | null;
}

export interface Worker {
  name: string;
  kind: "employee" | "contractor";
  role: string | null;
}

export type ReviewState = "working" | "repair" | "passed" | null;

export interface WorkView {
  run: DerivedRun;
  /** The plan's parts in order, each with its state; empty until a plan exists. */
  parts: WorkPart[];
  done: number;
  /** The part being worked on now, if any. */
  active: string | null;
  /** The security review after the parts, when the work has one. */
  review: ReviewState;
  researchers: Researcher[];
  workers: Worker[];
  tools: ToolTally;
  /** A simple answer's steps, one plain phrase each, in order and without repeats. */
  steps: string[];
  /** Work this run started (`message` `kind: "work.started"`). */
  started: { runId: string; kind: string; title: string }[];
  pending: DerivedApproval[];
  firstAt: string | null;
  lastAt: string | null;
  /** The latest milestone message: what is happening now, in a sentence. */
  now: string | null;
}

export const MAX_ACTIONS = 200;

const READING = new Set(["read_file", "list_files", "search", "git_diff", "read_page", "read_memory", "sent_emails", "check_preview", "read_organisation", "ask_app", "notes", "load_skill"]);
const CHANGING = new Set(["edit_file", "write_file"]);
const SAVING = new Set(["commit", "git_commit"]);

function emptyTally(): ToolTally {
  return { read: 0, changed: 0, ran: 0, tests: 0, searched: 0, saved: 0, other: 0, actions: [], total: 0 };
}

function argsOf(p: Record<string, unknown>): Record<string, unknown> {
  const raw = p.arguments;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function tally(t: ToolTally, seq: number, name: string, args: Record<string, unknown>) {
  t.total += 1;
  if (READING.has(name)) t.read += 1;
  else if (CHANGING.has(name)) t.changed += 1;
  else if (SAVING.has(name)) t.saved += 1;
  else if (name === "web_search") t.searched += 1;
  else if (name === "run") {
    t.ran += 1;
    if (/\btest/i.test(String(args.command ?? ""))) t.tests += 1;
  } else t.other += 1;
  const detail = typeof args.path === "string" ? args.path : typeof args.command === "string" ? args.command : typeof args.what === "string" ? args.what : null;
  t.actions.push({ seq, name, detail });
  if (t.actions.length > MAX_ACTIONS) t.actions.shift();
}

/** What the tools did, in one plain sentence: "read 12 files, changed 4, ran the tests 3 times". */
export function tallySentence(t: ToolTally): string | null {
  const parts: string[] = [];
  if (t.read) parts.push(`read ${plural(t.read, "file")}`);
  if (t.changed) parts.push(t.read ? `changed ${t.changed}` : `changed ${plural(t.changed, "file")}`);
  if (t.tests) parts.push(`ran the tests ${t.tests === 1 ? "once" : `${t.tests} times`}`);
  if (t.ran - t.tests > 0) parts.push(`ran ${plural(t.ran - t.tests, "check")}`);
  if (t.searched) parts.push(`searched the web ${t.searched === 1 ? "once" : `${t.searched} times`}`);
  if (t.saved) parts.push(`saved ${plural(t.saved, "version")}`);
  if (parts.length === 0) return t.other ? plural(t.other, "step") : null;
  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** What one of the conversation's own reads was, in the words the steps line uses. */
const READ_PHRASES: Record<string, string> = {
  contents: "Read the org chart",
  overview: "Read the org chart and what waits for you",
  workforce: "Read who works here",
  tasks: "Read the tasks",
  runs: "Read the recent work",
  credits: "Read the credits",
};

const TOOL_PHRASES: Record<string, string> = {
  read_organisation: "Read the organisation",
  start_idea: "Asked to start an idea",
  change_app: "Asked to change an app",
  try_again: "Asked to try stopped work again",
  adjust_setting: "Asked to change a setting",
  remember: "Kept a note for next time",
  web_search: "Searched the web",
  ask_app: "Asked an app's data",
};

function stepPhrase(name: string, args: Record<string, unknown>): string {
  if (name === "read_organisation") return READ_PHRASES[String(args.what ?? "")] ?? TOOL_PHRASES.read_organisation ?? "Read the organisation";
  return TOOL_PHRASES[name] ?? "Took a step";
}

/** `builder-<item>-<round>`, `evaluator-<item>-<round>`: which part an agent works on, and in which round. */
const PART_AGENT = /^(builder|evaluator)-(.+)-(\d+)$/;

export function deriveWork(events: readonly RunEvent[], mode: Mode = "normal"): WorkView {
  const run = deriveRun(events);
  const items = run.plan?.items ?? [];
  const parts = new Map<string, WorkPart>();
  items.forEach((item) => {
    parts.set(item.id, { id: item.id, label: planItemLabel(run.plan, item.id, mode) ?? item.text, state: "waiting", repairs: 0, outcome: null, tasks: [], tools: emptyTally() });
  });
  const byText = new Map<string, string>();
  for (const item of items) {
    byText.set(item.text.trim(), item.id);
    if (item.plain) byText.set(item.plain.trim(), item.id);
  }
  const taskPart = new Map<string, string>();
  /** Who held each task, in turn: the builder first, then whoever checked it. */
  const hands = new Map<string, string[]>();
  const taskRole = new Map<string, TaskRole>();
  const researchers = new Map<string, Researcher>();
  const workers = new Map<string, Worker>();
  const tools = emptyTally();
  const steps: string[] = [];
  const started: WorkView["started"] = [];
  let active: string | null = null;
  let review: ReviewState = null;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let now: string | null = null;

  const partOfAgent = (agent: string | null) => {
    const m = agent ? PART_AGENT.exec(agent) : null;
    return m && parts.has(m[2] ?? "") ? { part: parts.get(m[2] ?? "") as WorkPart, role: m[1] as "builder" | "evaluator", round: Number(m[3]) } : null;
  };

  for (const e of events) {
    const p = e.payload ?? {};
    firstAt ??= e.at;
    lastAt = e.at;
    switch (e.type) {
      case "task.created": {
        const id = str(p, "taskId");
        const title = (str(p, "title") ?? str(p, "summary") ?? "").trim();
        if (id && byText.has(title)) taskPart.set(id, byText.get(title) as string);
        if (id && /^(check|evaluate)/i.test(title)) taskRole.set(id, "check");
        if (id && /security/i.test(title)) taskRole.set(id, "review");
        break;
      }
      case "task.claimed": {
        const holder = str(p, "holder");
        if (holder && !workers.has(holder)) workers.set(holder, { name: holder, kind: "employee", role: null });
        const id = str(p, "taskId");
        if (id && holder) {
          const held = hands.get(id) ?? [];
          if (held[held.length - 1] !== holder) held.push(holder);
          hands.set(id, held);
        }
        const summary = (str(p, "summary") ?? "").trim();
        if (id && !taskPart.has(id) && byText.has(summary)) taskPart.set(id, byText.get(summary) as string);
        break;
      }
      case "subagent.started": {
        const id = str(p, "subagent") ?? str(p, "subagentId") ?? `contractor-${e.seq}`;
        researchers.set(id, { id, title: str(p, "title") ?? "A contractor", state: "working", searches: 0, maxSearches: num(p, "maxSearches"), outcome: null });
        const role = str(p, "role");
        workers.set(`contractor:${id}`, { name: str(p, "title") ?? "Contractor", kind: "contractor", role });
        break;
      }
      case "subagent.finished": {
        const id = str(p, "subagent") ?? str(p, "subagentId");
        const r = id ? researchers.get(id) : [...researchers.values()].find((x) => x.title === str(p, "title") && x.state === "working");
        if (r) {
          const stop = str(p, "stopReason");
          r.state = stop && !/^completed/.test(stop) ? "stopped" : "done";
          const summary = str(p, "summary");
          if (summary) r.outcome = outcomeOf(summary);
          const searches = num(p, "searches");
          if (searches !== null) r.searches = searches;
        }
        break;
      }
      case "tool.requested": {
        const name = str(p, "name") ?? str(p, "tool") ?? "tool";
        const args = argsOf(p);
        tally(tools, e.seq, name, args);
        const agent = str(p, "agent");
        const at = partOfAgent(agent);
        if (at) tally(at.part.tools, e.seq, name, args);
        if (name === "web_search" && agent && researchers.has(agent)) (researchers.get(agent) as Researcher).searches += 1;
        const phrase = stepPhrase(name, args);
        if (steps[steps.length - 1] !== phrase && !steps.includes(phrase)) steps.push(phrase);
        break;
      }
      case "model.replied": {
        const agent = str(p, "agent");
        const searches = num(p, "searches");
        if (agent && searches && researchers.has(agent)) (researchers.get(agent) as Researcher).searches += searches;
        break;
      }
      case "evaluation.passed":
      case "evaluation.failed": {
        const part = parts.get(str(p, "item") ?? "");
        if (!part) break;
        for (const key of ["taskId", "checkTaskId"]) {
          const id = str(p, key);
          if (id) {
            taskPart.set(id, part.id);
            if (key === "checkTaskId") taskRole.set(id, "check");
          }
        }
        part.outcome = plainOrNull(str(p, "summary")) ?? part.outcome;
        if (e.type === "evaluation.passed") part.state = p.needsLook === true ? "needs-look" : "passed";
        else if (p.needsLook === true) part.state = "needs-look";
        else if (p.final === true || p.stoppedEarly === true) part.state = "failed";
        else {
          part.state = "repair";
          part.repairs = Math.max(part.repairs, (num(p, "round") ?? part.repairs) + 1);
        }
        break;
      }
      case "message": {
        const kind = str(p, "kind");
        if (kind === "work.started") {
          const id = str(p, "runId");
          if (id && !started.some((s) => s.runId === id)) started.push({ runId: id, kind: str(p, "workKind") ?? "", title: str(p, "title") ?? "" });
          break;
        }
        if (kind === "agent.start") {
          const agent = str(p, "agent");
          const at = partOfAgent(agent);
          if (at) {
            active = at.part.id;
            if (at.part.state !== "passed" && at.part.state !== "failed" && at.part.state !== "needs-look") at.part.state = at.role === "evaluator" ? "checking" : at.part.state === "repair" || at.round > 0 ? "repair" : "working";
          } else if (agent?.startsWith("security-reviewer")) {
            review = review === "repair" ? "repair" : "working";
            active = null;
          } else if (agent?.startsWith("builder-security-repair")) review = "repair";
          break;
        }
        if (kind) break;
        const from = str(p, "from");
        const title = str(p, "title");
        if (from === "security-reviewer" && title) review = /passed/i.test(title) ? "passed" : "repair";
        if (from && from !== "owner" && str(p, "milestone")) now = plainOrNull(firstSentence(str(p, "text") ?? "", 150)) ?? now;
        const hired = title?.match(/^Hired (.+)$/)?.[1];
        if (hired && !workers.has(hired)) workers.set(hired, { name: hired, kind: "employee", role: null });
        break;
      }
      default:
        break;
    }
  }

  for (const t of run.tasks) {
    const partId = taskPart.get(t.id) ?? byText.get(t.summary.trim()) ?? null;
    const part = partId ? parts.get(partId) : undefined;
    if (!part) continue;
    const role = taskRole.get(t.id) ?? (part.tasks.some((x) => x.role === "build") ? "repair" : "build");
    // One task handed on (built, then checked by someone else) reads as each hand in turn; every hand but the last is done.
    const held = hands.get(t.id) ?? [];
    if (held.length > 1 && role === "build") {
      held.forEach((holder, i) => {
        const last = i === held.length - 1;
        part.tasks.push({ id: `${t.id}:${i}`, summary: t.summary, role: i === 0 ? "build" : "check", status: last ? t.status : "done", holder, note: last ? t.note : null });
      });
    } else part.tasks.push({ id: t.id, summary: t.summary, role, status: t.status, holder: t.holder, note: t.note });
    if (t.status === "failed" && part.state !== "passed") part.state = "failed";
  }
  // A part whose builder holds its task and nothing else has said where it is: being worked on.
  for (const part of parts.values()) {
    if (part.state === "waiting" && part.tasks.some((t) => t.status === "working")) part.state = "working";
    if (part.state === "waiting" && part.tasks.some((t) => t.status === "done")) part.state = "passed";
  }
  if (run.status === "finished" && review === "working") review = "passed";
  const ordered = [...parts.values()];
  const done = ordered.filter((x) => x.state === "passed" || x.state === "needs-look").length;
  // Once the work has ended, nothing is "working now".
  const ended = run.status === "finished" || run.status === "failed" || run.status === "cancelled";
  if (ended) {
    for (const part of ordered) if (part.state === "working" || part.state === "checking" || part.state === "repair") part.state = run.status === "finished" ? "passed" : "failed";
    active = null;
  }

  return {
    run,
    parts: ordered,
    done,
    active: active && parts.get(active)?.state !== "passed" ? active : ordered.find((x) => x.state === "working" || x.state === "checking" || x.state === "repair")?.id ?? null,
    review: ordered.length > 0 ? review : null,
    researchers: [...researchers.values()],
    workers: [...workers.values()],
    tools,
    steps,
    started,
    pending: run.approvals.filter((a) => a.answer === null),
    firstAt,
    lastAt,
    now,
  };
}

/** What a part's state is called, in normal mode's words. */
export function partStateLabel(state: PartState, repairs: number): string {
  switch (state) {
    case "waiting":
      return "Waiting";
    case "working":
      return "Working on it now";
    case "checking":
      return "Being checked";
    case "repair":
      return `Sent back for repair (round ${Math.max(1, repairs)})`;
    case "passed":
      return "Passed";
    case "needs-look":
      return "Needs a look";
    case "failed":
      return "Did not pass";
  }
}

export const TASK_ROLE_LABEL: Record<TaskRole, string> = { build: "Build", check: "Check", repair: "Repair", review: "Security review", other: "Task" };
