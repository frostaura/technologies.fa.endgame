import { plural } from "@/lib/format";
import type { RunEvent } from "@/store/types";
import { describeEvent, formatCredits, num, str, type Mode, type StepTone, type TraceStep } from "./runModel";

/**
 * The run log as a person reads it. Normal mode speaks plainly: messages as written, each sub-agent
 * as one titled line with its outcome (its own steps folded beneath it), and the mechanics — model
 * calls, file reads, commands — summarised ("Read 4 files", "Ran the tests — 12 passed"). It never
 * shows a payload, a model, a tool's arguments or the rule that decided. Technical mode shows every
 * event with its raw detail, still grouped under the sub-agent that wrote it.
 */

export interface TimelineStep extends TraceStep {
  kind: "step";
  key: string;
}

export interface TimelineGroup {
  kind: "group";
  key: string;
  agent: string;
  seq: number;
  at: string;
  title: string;
  /** One line: what it came back with. */
  outcome: string | null;
  status: "working" | "done" | "stopped";
  credits: number;
  /** Web searches it made. */
  searches: number;
  items: TimelineItem[];
}

export type TimelineItem = TimelineStep | TimelineGroup;

export interface Timeline {
  items: TimelineItem[];
  /** Every action the work took, as ARCH-004 counts them: tool calls plus contractors briefed. */
  actions: number;
  modelCalls: number;
  toolCalls: number;
  denials: number;
}

const TOP = "\u0000top";

/** The agents that are the run itself rather than a sub-agent. */
function ownerOf(p: Record<string, unknown>): string {
  const agent = str(p, "agent");
  return !agent || agent === "main" || agent === "workflow" ? TOP : agent;
}

const STRAND_TITLES: Record<string, string> = {
  existing: "Looked for products that already do this",
  gap: "Looked for the gap that is left",
  demand: "Looked for people who want it",
};

const AGENT_TITLES: Record<string, string> = {
  judge: "Weighed the evidence and wrote the verdict",
  reviewer: "Reviewed the work",
  "security-reviewer": "Checked the work for misuse",
  planner: "Drew up the plan",
  evaluator: "Checked the work against the plan",
};

function firstSentence(text: string, max = 110): string {
  const clean = text.replace(/```[a-z]*\n?/gi, "").replace(/\s+/g, " ").trim();
  const sentence = clean.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** A sub-agent's human title: what it was given, never its id. */
export function groupTitle(agent: string, p: Record<string, unknown>): string {
  const given = str(p, "title");
  if (given) return given;
  const brief = p.brief;
  const objective = brief && typeof brief === "object" ? str(brief as Record<string, unknown>, "objective") : typeof brief === "string" ? brief : null;
  if (objective) return firstSentence(objective, 90);
  const strand = agent.match(/^contractor-(.+)$/)?.[1];
  if (strand && STRAND_TITLES[strand]) return STRAND_TITLES[strand];
  if (AGENT_TITLES[agent]) return AGENT_TITLES[agent];
  const sub = agent.match(/sub-(\d+)$/)?.[1];
  if (sub) return `A contractor's piece of the work (${sub})`;
  const words = agent.replace(/^contractor-/, "").replace(/[-_.]+/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "A contractor's piece of the work";
}

/** What a reply came back with, in one line — the headline of a JSON report, or its first sentence. */
export function outcomeOf(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const report = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const headline = str(report, "headline") ?? str(report, "title");
      if (headline) return firstSentence(headline, 140);
      if (Array.isArray(report.findings)) return `Reported ${plural(report.findings.length, "finding")}`;
      const summary = str(report, "summary");
      if (summary) return firstSentence(summary);
    } catch {
      // Not JSON after all: read it as prose.
    }
    const before = text.slice(0, start).trim();
    if (before) return firstSentence(before);
  }
  return firstSentence(text);
}

const SPEAKERS: Record<string, string> = { owner: "You", researcher: "Research", runner: "Endgame", workflow: "Endgame" };

function speaker(from: string | null): string {
  if (!from) return "Update";
  return SPEAKERS[from] ?? from;
}

const MILESTONES: Record<string, string> = {
  "estimate.gate": "Checked the estimate against your budget",
  "verdict.recorded": "Recorded the verdict",
  "placement.made": "Found a home for it",
  "plan.made": "Drew up the plan",
  "build.started": "Started building",
  "evaluate.started": "Started checking the work",
  "review.started": "Started the security review",
  "publish.started": "Started publishing",
};

function milestone(step: string): string {
  if (MILESTONES[step]) return MILESTONES[step];
  const words = step.replace(/[._-]+/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "A step was taken";
}

// ---------------------------------------------------------------------------------------------
// Activity: the mechanics of the work, summarised
// ---------------------------------------------------------------------------------------------

interface Activity {
  step: TimelineStep;
  reads: Set<string>;
  readCalls: number;
  edits: Set<string>;
  editCalls: number;
  lists: number;
  searches: number;
  webSearches: number;
  commands: number;
  tests: { runs: number; passed: number; failed: number };
  reviews: number;
  notes: number;
  other: number;
  thinking: number;
  names: Map<string, string>;
}

function args(p: Record<string, unknown>): Record<string, unknown> {
  const a = p.arguments;
  if (a && typeof a === "object" && !Array.isArray(a)) return a as Record<string, unknown>;
  if (typeof a === "string") {
    try {
      const parsed = JSON.parse(a) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

const TEST_COMMAND = /\b(test|vitest|jest|playwright|pytest|xunit|nunit|spec)\b/i;

function testCounts(content: string): { passed: number; failed: number } | null {
  const passed = Number(content.match(/(\d+)\s+passed/i)?.[1] ?? content.match(/Passed:\s*(\d+)/i)?.[1] ?? Number.NaN);
  const failed = Number(content.match(/(\d+)\s+failed/i)?.[1] ?? content.match(/Failed:\s*(\d+)/i)?.[1] ?? 0);
  return Number.isNaN(passed) ? null : { passed, failed };
}

function activitySummary(a: Activity): string {
  const parts: string[] = [];
  if (a.reads.size > 0 || a.readCalls > 0) parts.push(`Read ${plural(Math.max(a.reads.size, a.reads.size === 0 ? a.readCalls : 0), "file")}`);
  if (a.lists > 0) parts.push("Looked through the files");
  if (a.searches > 0) parts.push(a.searches === 1 ? "Searched the work" : `Searched the work ${a.searches} times`);
  if (a.webSearches > 0) parts.push(a.webSearches === 1 ? "Searched the web" : `Searched the web ${a.webSearches} times`);
  if (a.edits.size > 0 || a.editCalls > 0) parts.push(`Changed ${plural(Math.max(a.edits.size, a.edits.size === 0 ? a.editCalls : 0), "file")}`);
  if (a.tests.runs > 0) {
    const total = a.tests.passed + a.tests.failed;
    parts.push(total === 0 ? "Ran the tests" : a.tests.failed > 0 ? `Ran the tests — ${a.tests.failed} of ${total} failed` : `Ran the tests — ${a.tests.passed} passed`);
  }
  if (a.commands > 0) parts.push(a.commands === 1 ? "Ran a command" : `Ran ${a.commands} commands`);
  if (a.reviews > 0) parts.push("Reviewed the changes");
  if (a.notes > 0) parts.push("Kept notes");
  if (a.other > 0) parts.push(a.other === 1 ? "Took one other action" : `Took ${a.other} other actions`);
  if (a.thinking > 0) parts.push(a.thinking === 1 ? "Thought it through" : `Thought it through ${a.thinking} times`);
  return parts.join(" · ") || "Worked on it";
}

function newActivity(e: RunEvent): Activity {
  return {
    step: { kind: "step", key: `activity-${e.seq}`, seq: e.seq, at: e.at, tone: "structure", icon: "build", title: "", detail: null, credits: null, raw: null },
    reads: new Set(),
    readCalls: 0,
    edits: new Set(),
    editCalls: 0,
    lists: 0,
    searches: 0,
    webSearches: 0,
    commands: 0,
    tests: { runs: 0, passed: 0, failed: 0 },
    reviews: 0,
    notes: 0,
    other: 0,
    thinking: 0,
    names: new Map(),
  };
}

function noteRequest(a: Activity, p: Record<string, unknown>) {
  const name = str(p, "name") ?? str(p, "tool") ?? "";
  const callId = str(p, "callId");
  if (callId) a.names.set(callId, name);
  const x = args(p);
  const path = str(x, "path") ?? str(x, "file") ?? "";
  switch (name) {
    case "read_file":
      a.readCalls += 1;
      if (path) a.reads.add(path);
      break;
    case "edit_file":
    case "write_file":
      a.editCalls += 1;
      if (path) a.edits.add(path);
      break;
    case "list_files":
      a.lists += 1;
      break;
    case "search":
    case "grep":
      a.searches += 1;
      break;
    case "web_search":
    case "web.search":
    case "search_web":
      a.webSearches += 1;
      break;
    case "git_diff":
      a.reviews += 1;
      break;
    case "notes":
    case "todo":
      a.notes += 1;
      break;
    case "run":
    case "shell.exec":
      if (TEST_COMMAND.test(str(x, "command") ?? "")) a.tests.runs += 1;
      else a.commands += 1;
      break;
    case "spawn":
      break;
    default:
      a.other += 1;
  }
  // The first tool request of a model turn carries that turn's accounting: one model call.
  if (p.accounting && typeof p.accounting === "object") a.thinking += 1;
}

function noteResult(a: Activity, p: Record<string, unknown>) {
  const name = str(p, "name") ?? str(p, "tool") ?? a.names.get(str(p, "callId") ?? "") ?? "";
  if (name !== "run" && name !== "shell.exec") return;
  const content = str(p, "content") ?? str(p, "result") ?? "";
  const counts = testCounts(content);
  if (counts || p.verified === true) {
    // A verifying command counted as a command at request time is moved to the tests.
    if (a.tests.runs === 0 && a.commands > 0) {
      a.commands -= 1;
      a.tests.runs += 1;
    }
    if (counts) {
      a.tests.passed += counts.passed;
      a.tests.failed += counts.failed;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------------------------

interface Container {
  items: TimelineItem[];
  activity: Activity | null;
}

export function buildTimeline(events: readonly RunEvent[], mode: Mode, planItem: (id: string) => string | null = () => null): Timeline {
  const technical = mode === "technical";
  const top: Container = { items: [], activity: null };
  const groups = new Map<string, { group: TimelineGroup; container: Container }>();
  const said = new Set<string>();
  const milestones = new Set<string>();
  let modelCalls = 0;
  let replies = 0;
  let toolCalls = 0;
  let denials = 0;
  let subagents = 0;

  const containerOf = (owner: string): Container => (owner === TOP ? top : (groups.get(owner)?.container ?? ensureGroup(owner, TOP, {}, null).container));

  function ensureGroup(agent: string, parent: string, p: Record<string, unknown>, e: RunEvent | null) {
    const existing = groups.get(agent);
    if (existing) return existing;
    const group: TimelineGroup = { kind: "group", key: `group-${agent}`, agent, seq: e?.seq ?? 0, at: e?.at ?? "", title: groupTitle(agent, p), outcome: null, status: "working", credits: 0, searches: 0, items: [] };
    const entry = { group, container: { items: group.items, activity: null } };
    groups.set(agent, entry);
    const host = parent === agent ? top : containerOf(parent);
    host.activity = null;
    host.items.push(group);
    return entry;
  }

  const push = (owner: string, step: TraceStep, key = `e-${step.seq}`) => {
    const c = containerOf(owner);
    c.activity = null;
    c.items.push({ ...step, kind: "step", key });
  };

  const opened: Activity[] = [];
  const activity = (owner: string, e: RunEvent): Activity => {
    const c = containerOf(owner);
    if (!c.activity) {
      c.activity = newActivity(e);
      opened.push(c.activity);
      c.items.push(c.activity.step);
    }
    return c.activity;
  };

  const addCredits = (owner: string, p: Record<string, unknown>) => {
    if (owner === TOP) return;
    const accounting = p.accounting && typeof p.accounting === "object" ? (p.accounting as Record<string, unknown>) : null;
    const credits = accounting ? num(accounting, "settledCredits") : null;
    const g = groups.get(owner)?.group;
    if (g && credits) g.credits += credits;
  };

  for (const e of events) {
    const p = e.payload ?? {};
    const owner = ownerOf(p);
    const kind = e.type === "message" ? str(p, "kind") : null;

    // Counts first: accurate whatever is drawn.
    if (e.type === "model.replied") modelCalls += 1;
    if (e.type === "tool.requested") toolCalls += 1;
    if (e.type === "tool.denied") denials += 1;
    if (e.type === "subagent.started") subagents += 1;
    if (kind === "agent.reply") replies += 1;

    // Groups open and close the same way in both modes.
    if (kind === "agent.start" && owner !== TOP) ensureGroup(owner, owner, p, e);
    if (e.type === "subagent.started") {
      const sub = str(p, "subagent") ?? str(p, "subagentId");
      if (sub) ensureGroup(sub, owner, p, e);
    }
    if (e.type === "subagent.finished") {
      const sub = str(p, "subagent") ?? str(p, "subagentId");
      const g = sub ? groups.get(sub)?.group : undefined;
      if (g) {
        const summary = str(p, "summary");
        if (summary) g.outcome = outcomeOf(summary);
        const stop = str(p, "stopReason");
        g.status = stop && !/^completed/.test(stop) ? "stopped" : "done";
        const credits = num(p, "credits");
        if (credits !== null) g.credits = credits;
        const searches = num(p, "searches");
        if (searches !== null) g.searches = searches;
      }
    }
    if (e.type === "model.replied" && owner !== TOP) {
      const g = groups.get(owner)?.group;
      const searches = num(p, "searches");
      if (g && searches) g.searches += searches;
    }
    if (kind === "agent.reply") {
      addCredits(owner, p);
      const g = groups.get(owner)?.group;
      const text = str(p, "text");
      if (g && p.final !== false) {
        g.status = "done";
        if (text && !g.outcome) g.outcome = outcomeOf(text);
      }
    }
    if (kind === "agent.stopped") {
      const g = groups.get(owner)?.group;
      if (g) {
        g.status = "stopped";
        g.outcome = str(p, "text") ? outcomeOf(str(p, "text") ?? "") : "Stopped before it finished";
      }
    }
    if (e.type === "tool.requested") addCredits(owner, p);

    if (technical) {
      const step = describeEvent(e, "technical", planItem);
      if (!step) continue;
      if (kind) step.title = `${kind}${str(p, "agent") ? ` · ${str(p, "agent")}` : ""}${str(p, "step") ? ` · ${str(p, "step")}` : ""}`;
      // A sub-agent's own start sits inside its group; the group is its heading.
      push(owner, step);
      continue;
    }

    // Normal mode -----------------------------------------------------------------------
    switch (e.type) {
      case "model.requested":
      case "model.replied":
      case "tool.permitted":
      case "subagent.started":
      case "subagent.finished":
        continue;
      case "tool.requested":
        noteRequest(activity(owner, e), p);
        continue;
      case "tool.result":
        if (containerOf(owner).activity) noteResult(activity(owner, e), p);
        continue;
      case "tool.denied": {
        // A refused action was never carried out: it is not counted as done.
        const open = containerOf(owner).activity;
        const name = str(p, "name") ?? str(p, "tool") ?? open?.names.get(str(p, "callId") ?? "") ?? "";
        if (open && (name === "run" || name === "shell.exec") && open.commands > 0) open.commands -= 1;
        push(owner, { seq: e.seq, at: e.at, tone: "attention", icon: "secrets", title: "An action was refused by your rules", detail: "It was not carried out. The work continues without it.", credits: null, raw: null });
        continue;
      }
      case "run.started":
        if (milestones.has("run.started")) continue;
        milestones.add("run.started");
        break;
      case "message": {
        if (kind === "agent.reply") {
          if (owner === TOP || p.final === false || groups.get(owner)) activity(owner, e).thinking += 1;
          continue;
        }
        if (kind === "workflow.step") {
          const name = str(p, "step") ?? "";
          if (milestones.has(name)) continue;
          milestones.add(name);
          push(owner, { seq: e.seq, at: e.at, tone: "factory", icon: "plan", title: milestone(name), detail: null, credits: null, raw: null });
          continue;
        }
        if (kind) continue; // agent.start, nudges, notes, compaction: bookkeeping, not news.
        const text = str(p, "text");
        if (!text || said.has(text)) continue;
        // A milestone (verdict, placed, published) is said once per run.
        const mark = str(p, "milestone");
        if (mark && milestones.has(`milestone:${mark}`)) continue;
        if (mark) milestones.add(`milestone:${mark}`);
        said.add(text);
        const from = str(p, "from");
        const title = str(p, "title");
        push(owner, { seq: e.seq, at: e.at, tone: from === "owner" ? "structure" : "people", icon: "employee", title: title ? `${speaker(from)} · ${title}` : speaker(from), detail: text, credits: null, raw: null });
        continue;
      }
      default:
        break;
    }
    const step = describeEvent(e, "normal", planItem);
    if (!step) continue;
    // The outcome is shown once, above the steps.
    if (e.type === "run.finished") step.detail = null;
    if (step.detail) said.add(step.detail);
    push(owner, step);
  }

  // Activities are summarised once the whole log is read, so a line reads "Read 4 files", not "Read 1 file" four times.
  for (const a of opened) a.step.title = activitySummary(a);

  // Older research runs wrote their strands as workflow agents, never as `subagent.started`: each counts as one.
  const briefed = subagents > 0 ? subagents : [...groups.values()].length;
  return { items: top.items, actions: toolCalls + briefed, modelCalls: modelCalls > 0 ? modelCalls : replies, toolCalls, denials };
}

/** Credits spent by a group, as a label. */
export function groupCredits(g: TimelineGroup): string | null {
  return g.credits > 0 ? formatCredits(g.credits) : null;
}

export type { StepTone };
