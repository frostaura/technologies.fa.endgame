import type { Employee } from "@/store/types";
import { storyFor, type PlanItemStory, type Story } from "../world/story";
import { append, defineScript, settle, Script } from "./engine";
import { contractor, ensureNode, hireEmployee, newApp, notify, setStage, startRun } from "./mutations";
import { titleOf } from "./http";
import { appAt, chain, newId, node, orgOf, organisation, setting, spentBelow, uuidFor, type DemoRun, type World } from "./world";

/**
 * The scripts runs play, modelled on real run logs captured from a development stack (a research
 * run of 40 events and a build run of 1,457): the same event types, payload fields, milestones
 * and sentences, with invented names and a few hundred mechanics instead of a thousand.
 *
 * What a step decides from the world as it is when the step is reached — a budget, a checkpoint,
 * a stage's rules — is an `effect` or an `ask`, never baked into the script, so a setting changed
 * while a run plays changes what the run does next, as on the live stack.
 *
 * Named moments (`clock { seek }`): research:started, research:strand-*, research:judging,
 * research:verdict, research:decided, research:finished, research:failed, research:budget-stopped;
 * build:placed, build:hired, build:plan, build:waiting-on-plan, build:waiting-for-budget,
 * build:carried, build:part-1…n, build:sent-back, build:repaired, build:budget-stopped,
 * build:security-review, build:security-finding, build:security-passed, build:published,
 * build:finished, build:failed; change:screened, change:red-line, change:plan,
 * change:waiting-on-plan, change:carried, change:part-1…n, change:sent-back, change:repaired,
 * change:security-review, change:security-passed, change:published, change:finished;
 * conversation:approval, conversation:replied, conversation:budget-stopped.
 */

const CHEAP = "deepseek/deepseek-v4.1-flash";
const STRONG = "qwen/qwen3.7-plus";

function callId(run: DemoRun, n: number) {
  return uuidFor(`call:${run.run.id}:${n}`);
}

// ---------------------------------------------------------------------------------------------
// Rules, budgets and checkpoints, read when the step is reached
// ---------------------------------------------------------------------------------------------

interface Decision {
  verdict: "allow" | "deny" | "ask";
  rule: string;
  reason: string;
  checkpoint?: string;
}

function matches(rule: string, tool: string, target: string): boolean {
  const m = /^(\*|[a-z][a-z0-9_]*)(\((.+)\))?$/.exec(rule);
  if (!m) return false;
  if (m[1] !== "*" && m[1] !== tool) return false;
  if (!m[3]) return true;
  const glob = new RegExp(`^${m[3].replace(/[.+?^$()|[\]\\{}]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return glob.test(target);
}

/** `PermissionPolicy.Decide` for the cascade's rule sets at a stage: deny, then "asks you first", then allow, nearest level first. */
function decide(world: World, scope: string, stage: string, tool: string, target: string, reading: boolean): Decision {
  const sets = chain(scope)
    .reverse()
    .flatMap((p) => world.ruleSets.filter((r) => r.path === p && (r.stage === stage || r.stage === "all")));
  for (const set of sets) {
    const deny = set.deny.find((r) => matches(r, tool, target));
    if (deny) return { verdict: "deny", rule: `cascade:${set.path}:${set.stage}:deny:${deny}`, reason: `Denied by the ${set.stage} rule set set at ${set.path} ('${deny}').` };
  }
  for (const set of sets) {
    const ask = set.ask.find((r) => matches(r, tool, target));
    if (ask) return { verdict: "ask", rule: `cascade:${set.path}:${set.stage}:ask:${ask}`, reason: `The ${set.stage} rule set set at ${set.path} asks for sign-off on '${ask}'.`, checkpoint: `${set.path}:${ask}` };
  }
  for (const set of sets) {
    const allow = set.allow.find((r) => matches(r, tool, target));
    if (allow) return { verdict: "allow", rule: `cascade:${set.path}:${set.stage}:allow:${allow}`, reason: `Allowed by the ${set.stage} rule set set at ${set.path}.` };
  }
  return reading ? { verdict: "allow", rule: "default:read-only", reason: "Reading is allowed." } : { verdict: "allow", rule: "default:workspace-write", reason: "Writing inside the workspace is allowed." };
}

/** What approving a tool call does, in words (`AgentLoop.AskAsync`); the tool and its files are the detail. */
function askTitle(tool: string): string {
  if (tool === "edit_file" || tool === "write_file") return "Let the agent change part of the app?";
  if (tool === "run") return "Let the agent run a check on the app?";
  if (tool === "git_commit") return "Let the agent save a new version?";
  return "Let the agent take this step?";
}

/** The credits left for work at a scope: the tightest monthly budget on its chain, or the balance down to the overdraft limit. */
export function headroomAt(world: World, scope: string): number {
  const o = organisation(world, orgOf(scope));
  let room = o ? o.balance + (o.ownLimit !== null ? Math.min(o.ownLimit, o.frostauraLimit) : o.frostauraLimit) : 0;
  for (const p of chain(scope)) {
    const cap = world.budgets.find((b) => b.path === p)?.cap;
    if (cap === undefined) continue;
    const spent = spentBelow(world, p);
    room = Math.min(room, cap - spent.ai - spent.hosting);
  }
  return Math.max(0, Math.round(room * 100) / 100);
}

const READING = /^(read_file|list_files|search|git_diff|web_search|read_page|notes|load_skill|read_organisation|check_preview|read_memory)$/;

/** One model call and, when a tool is named, the tool call it asked for, checked against the stage's rules when it is made. */
function cycle(
  s: Script,
  run: DemoRun,
  o: { agent: string; employeeId: string | null; taskType: string; credits: number; tool?: { name: string; args: Record<string, unknown>; result: string; paths?: string[]; command?: string }; model?: string; billable?: boolean; scope?: string; stage?: string },
) {
  const call = s.steps.length;
  const id = callId(run, call);
  const model = o.model ?? CHEAP;
  const billable = o.billable ?? true;
  const reserved = Math.round((o.credits * 12 + 1.5) * 100000) / 100000;
  s.event("model.requested", { model, callId: id, models: [model], billable, taskType: o.taskType, maxTokens: 16000, employeeId: o.employeeId, reservedCredits: reserved, estimatedPromptTokens: 7000 + (call % 9) * 900, ...(o.scope ? { scope: o.scope } : {}) });
  s.wait(700 + (call % 5) * 150);
  s.event("model.replied", {
    error: null,
    model,
    callId: id,
    tokens: { input: 3600 + (call % 7) * 700, output: 40 + (call % 11) * 30 },
    billable,
    searches: o.tool?.name === "web_search" ? 1 : 0,
    taskType: o.taskType,
    employeeId: o.employeeId,
    finishReason: o.tool ? "tool_calls" : "stop",
    settledCredits: o.credits,
    reservedCredits: reserved,
    costFromProvider: true,
    ...(o.scope ? { scope: o.scope } : {}),
  });
  const tool = o.tool;
  if (!tool) return;
  const toolCall = `call_${id.slice(0, 8)}`;
  s.wait(60);
  s.event("tool.requested", { name: tool.name, step: s.steps.length, agent: o.agent, callId: toolCall, arguments: JSON.stringify(tool.args) });
  s.wait(30);
  const reading = READING.test(tool.name);
  const target = tool.command ?? tool.paths?.[0] ?? "";
  const permitted = (w: World, r: DemoRun, d: Decision) => {
    append(w, r, "tool.permitted", { name: tool.name, rule: d.rule, agent: o.agent, paths: tool.paths ?? [], callId: toolCall, reason: d.reason, command: tool.command ?? null });
  };
  const result = (w: World, r: DemoRun) =>
    append(w, r, "tool.result", { name: tool.name, agent: o.agent, callId: toolCall, edited: !reading, content: tool.result, credits: 0, isError: false, verified: tool.name === "run", errorKind: null, failureKey: null });
  if (!o.stage || reading) {
    s.event("tool.permitted", { name: tool.name, rule: reading ? "default:read-only" : tool.name === "run" ? "stage:build:allow run(make *)" : "default:workspace-write", agent: o.agent, paths: tool.paths ?? [], callId: toolCall, reason: reading ? "Reading is allowed." : "Writing inside the workspace is allowed.", command: tool.command ?? null });
    s.wait(250 + (call % 4) * 120);
    s.event("tool.result", { name: tool.name, agent: o.agent, callId: toolCall, edited: !reading, content: tool.result, credits: 0, isError: false, verified: tool.name === "run", errorKind: null, failureKey: null });
    return;
  }
  const stage = o.stage;
  const key = `tool:${toolCall}`;
  // An "asks you first" rule raises an approval and the work waits for the answer, even unattended (AUTO-05).
  s.ask((w, r) => {
    const d = decide(w, r.run.scope, stage, tool.name, target, false);
    if (d.verdict !== "ask") return null;
    return { title: askTitle(tool.name), detail: `${tool.name}: ${target}. ${d.reason} Checkpoint: ${d.checkpoint ?? d.rule}.`, onApprove: { kind: "continue" }, onDecline: "continues", key };
  });
  s.wait(250 + (call % 4) * 120);
  s.effect((w, r) => {
    const d = decide(w, r.run.scope, stage, tool.name, target, false);
    if (d.verdict === "deny") {
      append(w, r, "tool.denied", { name: tool.name, agent: o.agent, callId: toolCall, rule: d.rule, reason: d.reason, paths: tool.paths ?? [], command: tool.command ?? null });
      return ["Run"];
    }
    const asked = w.approvals.filter((a) => a.runId === r.run.id && a.key === key).pop();
    if (asked?.answer === "rejected") {
      append(w, r, "tool.denied", { name: tool.name, agent: o.agent, callId: toolCall, rule: `checkpoint:${d.checkpoint ?? d.rule}:rejected`, reason: "The owner declined this call, so it was not done. Carry on without it, or finish and say plainly that it was not done.", paths: tool.paths ?? [], command: tool.command ?? null });
      return ["Run"];
    }
    permitted(w, r, asked ? { ...d, rule: `checkpoint:${d.checkpoint ?? d.rule}:approved`, reason: "The owner approved this call." } : d);
    result(w, r);
    return ["Run"];
  });
}

/**
 * `RunExecutor.GateAsync`, before any work: in auto-mode an estimate larger than the headroom
 * pauses the run, saying why; with the start checkpoint on in checkpoints mode the owner approves
 * the estimate first, and a decline ends the run having charged nothing.
 */
function gate(s: Script, run: DemoRun, expected: number, prefix: string) {
  const key = `gate:${run.run.id}`;
  s.effect((w, r) => {
    const room = headroomAt(w, r.run.scope);
    const auto = (setting(w, r.run.scope, "autonomy")?.value ?? "auto") === "auto";
    if (!auto || expected <= room) return;
    append(w, r, "message", { from: "runner", title: "Waiting for budget", code: "estimate_over_budget", text: `This work is estimated at ${expected} credits, more than the ${room} left in its budget, so it has not started. Raise the budget or top up, then resume it.`, estimate: expected, headroom: room });
    append(w, r, "run.paused", { by: "runner", reason: "estimate_over_budget" });
    return ["Run", "Tree"];
  }, `${prefix}:waiting-for-budget`);
  s.ask((w, r) => {
    const checkpoints = setting(w, r.run.scope, "autonomy")?.value === "checkpoints" && setting(w, r.run.scope, "checkpoint.start")?.value === "true";
    if (!checkpoints) return null;
    return { title: `Start this work? Estimated ${expected} credits.`, detail: `${headroomAt(w, r.run.scope)} credits are left in the budget.`, onApprove: { kind: "continue" }, onDecline: "stops", key };
  }, `${prefix}:waiting-to-start`);
  s.effect((w, r) => {
    const asked = w.approvals.filter((a) => a.runId === r.run.id && a.key === key).pop();
    if (asked?.answer !== "rejected") return;
    stop(w, r, "You declined to start this work at its estimate, so nothing was done and nothing was charged.", "The owner declined to start this work at its estimate.");
    return ["Run", "Tree"];
  });
}

/** The run ends without finishing: Endgame says why in plain words (`RunExecutor.FinishAsync`). */
function stop(w: World, r: DemoRun, forOwner: string, summary: string) {
  append(w, r, "estimate.scored", { ratio: 0, modelCalls: 0, actualCredits: Math.round(r.run.spentCredits * 1e6) / 1e6, expectedCredits: r.run.estimateCredits ?? 0, nonBillableCredits: 0 });
  append(w, r, "message", { from: "runner", title: "Stopped", text: forOwner, milestone: "finished" });
  append(w, r, "run.finished", { outcome: "failed", summary, totals: { credits: Math.round(r.run.spentCredits * 1e6) / 1e6 } });
}

/** The gateway refuses to hold credits for the next call: the run is marked budget-exhausted and stops, keeping what was finished (RUN-10). */
function budgetStop(s: Script, prefix: string, onStop?: (w: World, r: DemoRun) => void) {
  s.effect((w, r) => {
    if (headroomAt(w, r.run.scope) >= 1) return;
    r.run.budgetExhausted = true;
    append(w, r, "message", { code: "budget_exhausted", text: "The credit budget is exhausted, so this run cannot call a model again. Top up or raise the budget; what was finished is kept, and the work can then be tried again." });
    onStop?.(w, r);
    stop(w, r, "The credit budget ran out, so the work stopped. Top up or raise the budget, then try it again; what was finished is kept.", "The credit budget ran out, so the work stopped. Top up or raise the budget, then try it again; what was finished is kept.");
    return ["Run", "Tree", "Credits", "Idea"];
  }, `${prefix}:budget-stopped`);
}

function working(world: World, employeeId: string | null, run: DemoRun) {
  const e = employeeId ? world.employees.find((x) => x.id === employeeId) : undefined;
  if (!e || e.status === "paused") return;
  e.status = "working";
  e.currentRun = { id: run.run.id, title: run.run.title };
  e.lastActiveAt = new Date().toISOString();
  world.changed.push("Tree", "Employee");
}

/** Whether this run hired the employee (its steps are rebuilt from the world before it, not after). */
function hiredBy(world: World, employeeId: string, runId: string): boolean {
  return world.hires.some((h) => h.employeeId === employeeId && h.raisedByRunId === runId);
}

function employeeAt(world: World, scope: string, role: string): Employee | undefined {
  const onChain = chain(scope).reverse();
  for (const p of onChain) {
    const e = world.employees.find((x) => x.scope === p && x.role === role && x.kind === "employee" && x.status !== "released");
    if (e) return e;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Research: three contractors, a judge, a verdict, and auto-mode's decision
// ---------------------------------------------------------------------------------------------

defineScript("research", (world, run) => {
  const p = run.playback?.params ?? {};
  const idea = world.ideas.find((i) => i.id === p.ideaId);
  const story = storyFor(idea?.text ?? "", typeof p.story === "string" ? p.story : null);
  const org = orgOf(run.run.scope);
  const s = new Script();
  const researcherKey = `${org}:researcher`;
  // Who was there before this run: one this run hired is still hired by it when its steps are rebuilt.
  let researcher = employeeAt(world, run.run.scope, "Market researcher");
  if (researcher?.id === uuidFor(`employee:${researcherKey}`) && hiredBy(world, researcher.id, run.run.id)) researcher = undefined;
  s.event("run.started", { holder: "runner-demo-1" });
  gate(s, run, run.run.estimateCredits ?? 12, "research");
  s.wait(400).event("message", { data: { autonomy: setting(world, run.run.scope, "autonomy")?.value ?? "auto", estimate: run.run.estimateCredits, headroom: headroomAt(world, run.run.scope) }, kind: "workflow.step", step: "estimate.gate", agent: "workflow" });
  if (!researcher) {
    const name = "Wren";
    s.wait(300).event("message", { data: { name, role: "Market researcher", status: "accepted", employeeId: uuidFor(`employee:${researcherKey}`) }, kind: "workflow.step", step: `hire:stage:research:${org}`, agent: "workflow" });
    s.effect((w) => {
      researcher = hireEmployee(w, { key: researcherKey, name, role: "Market researcher", scope: org, limit: 400, mandate: "Research every idea before anything is built: who already does it, what they leave undone, and whether people would pay.", reason: "Research has reached this part of the organisation, and every idea is researched before anything is built.", trigger: "stage", runId: run.run.id });
    });
    s.event("message", { from: "runner", text: `${name} joins as a market researcher, at up to 400 credits a month: Research has reached this part of the organisation, and every idea is researched before anything is built.`, title: `Hired ${name}`, milestone: `hired:stage:research:${org}` });
  }
  const researcherId = researcher?.id ?? uuidFor(`employee:${researcherKey}`);
  s.effect((w) => working(w, researcherId, run));
  s.wait(400).event("message", { from: "researcher", text: "3 researchers are looking, at the same time, at who already does this, what they leave undone, and whether people would pay for it, with up to 7 web searches each.", title: "Research started", milestone: "research.started" }, "research:started");
  const budget = Math.round(((run.run.estimateCredits ?? 12) / 4) * 10000) / 10000;
  for (const strand of story.strands) {
    s.wait(80).event("subagent.started", { role: "research contractor", agent: "workflow", brief: strand.brief, title: strand.title, subagent: `contractor-${strand.id}`, briefedBy: researcherId, maxSearches: 7, contractorId: uuidFor(`contractor:${run.run.id}:${strand.id}`), creditBudget: budget });
    s.effect((w) => {
      contractor(w, `${run.run.id}:${strand.id}`, run.run.scope, w.employees.find((e) => e.id === researcherId), "Research contractor", strand.brief, run.run.id);
    });
  }
  for (const strand of story.strands) s.event("message", { kind: "agent.start", task: "Research your strand now, then reply with the JSON object.", agent: `contractor-${strand.id}`, taskType: "research" });
  // The three strands search side by side; their calls interleave as on the live stack.
  for (let round = 0; round < 3; round += 1) {
    for (const strand of story.strands) {
      s.wait(900);
      cycle(s, run, { agent: `contractor-${strand.id}`, employeeId: null, taskType: "research", credits: 0.41 + round * 0.07, tool: { name: "web_search", args: { query: `${story.name} ${strand.id === "existing" ? "alternatives" : strand.id === "gap" ? "complaints reviews" : "people pay for"} ${round + 1}` }, result: `${3 + round} results: ${strand.sources.map((u) => u.replace(/^https?:\/\//, "")).join(", ")}` } });
    }
    if (round === 0) budgetStop(s, "research", releaseContractors(story, run));
  }
  story.strands.forEach((strand, i) => {
    s.wait(1800 + i * 1400);
    cycle(s, run, { agent: `contractor-${strand.id}`, employeeId: null, taskType: "research", credits: 2.2 + i * 0.3 });
    s.event("message", { kind: "agent.reply", agent: `contractor-${strand.id}`, final: true, reply: JSON.stringify({ findings: strand.findings, sources: strand.sources }) });
    s.event("subagent.finished", { agent: "workflow", title: strand.title, report: { sources: strand.sources, findings: strand.findings }, summary: strand.findings[0] ?? null });
    s.effect((w) => {
      const c = w.employees.find((e) => e.id === uuidFor(`contractor:${run.run.id}:${strand.id}`));
      if (c) {
        c.status = "released";
        c.currentRun = null;
        c.releasedAt = new Date().toISOString();
      }
      return ["Tree", "Employee"];
    }, `research:strand-${strand.id}`);
  });
  s.wait(600).event("message", { kind: "agent.start", task: "Weigh the research and reply with the verdict as the JSON object.", agent: "judge", taskType: "research" }, "research:judging");
  s.wait(500);
  if (p.fail === true) {
    // The judge's document is refused once and sent back; refused again, no verdict is recorded (VERD-12).
    cycle(s, run, { agent: "judge", employeeId: researcherId, taskType: "research", credits: 0.09 });
    s.event("message", { kind: "agent.reply", agent: "judge", final: true, reply: "{\"outcome\": \"build\"}" });
    s.event("message", { kind: "nudge", agent: "judge", text: "The verdict document was refused: it names no headline, no case against and no evidence of demand. Fix it and reply with the whole JSON object." });
    s.wait(1800);
    cycle(s, run, { agent: "judge", employeeId: researcherId, taskType: "research", credits: 0.09 });
    s.event("message", { kind: "agent.reply", agent: "judge", final: true, reply: "{\"outcome\": \"build\", \"headline\": \"\"}" });
    s.effect((w, r) => {
      const summary = "The research could not reach a verdict in the agreed form, so none was recorded and nothing will be built. What was wrong: the headline is empty; the case against is missing; the evidence of demand is missing.";
      stop(w, r, summary, summary);
      const project = w.nodes.find((n) => n.ideaId === p.ideaId);
      if (project) setStage(w, project.path, "researching", "Research stopped before it reached a verdict.");
      if (researcherId) settle(w, researcherId, run.run.id);
      return ["Idea", "Tree", "Run"];
    }, "research:failed");
    return patchTotals(s, run);
  }
  cycle(s, run, { agent: "judge", employeeId: researcherId, taskType: "research", credits: 0.07, tool: { name: "notes", args: { action: "append", text: `Verdict on "${story.name}": ${String(story.verdict.outcome)}.` }, result: "Noted (1 note)." } });
  s.event("message", { kind: "notes", note: `Verdict on "${story.name}": ${String(story.verdict.outcome)}. ${String(story.verdict.summary)}`, agent: "judge" });
  s.wait(2200);
  cycle(s, run, { agent: "judge", employeeId: researcherId, taskType: "research", credits: 0.09 });
  s.event("message", { kind: "agent.reply", agent: "judge", final: true, reply: JSON.stringify({ outcome: story.verdict.outcome, headline: story.headline }) });
  s.event("message", { data: {}, kind: "workflow.step", step: "verdict.recorded", agent: "workflow" });
  s.effect((w) => {
    const i = w.ideas.find((x) => x.id === p.ideaId);
    if (!i) return;
    const method = (story.verdict.method ?? {}) as Record<string, unknown>;
    i.verdict = { ...story.verdict, method: { ...method, strands: story.strands.map((st) => ({ id: st.id, title: st.title, sources: st.sources.length + 4, searches: 7, confidence: "medium" })), sources: story.strands.flatMap((st) => st.sources) } } as never;
    const rl = story.verdict.redLines as { breached?: boolean; line?: string } | undefined;
    i.redLine = rl?.breached ? (rl.line ?? "a red line") : null;
    i.status = "verdict";
    i.research.spentCredits = run.run.spentCredits;
    const project = w.nodes.find((n) => n.ideaId === i.id);
    if (project) setStage(w, project.path, "verdict", "Research finished. Waiting for your call.");
    notify(w, { key: `verdict:${i.id}`, kind: "verdict", severity: "info", title: `A verdict is waiting: ${i.title}`, detail: String(story.verdict.summary), scope: run.run.scope, subject: { kind: "idea", id: i.id } });
    if (researcherId) settle(w, researcherId, run.run.id);
    return ["Idea", "Tree", "Notifications"];
  }, "research:verdict");
  const outcome = String(story.verdict.outcome);
  const suggested = typeof story.verdict.suggestedChange === "string" ? story.verdict.suggestedChange : null;
  const title = outcome === "build" ? "Verdict: build" : outcome === "change" ? "Verdict: build it, changed" : "Verdict: do not build";
  const said = outcome === "do-not-build" ? `${story.headline}. Nothing will be built unless you overrule it.` : outcome === "change" ? `${story.headline}. The change: ${suggested ?? ""}` : `${story.headline}.`;
  s.event("message", { from: "researcher", text: said, title, milestone: "verdict" });
  // Auto-mode decides after a build or change verdict; a do-not-build, a red line or checkpoints mode waits for the owner (VERD-11).
  if (outcome === "build" || outcome === "change") {
    s.wait(300).effect((w, r) => autoDecide(w, r, String(p.ideaId ?? ""), outcome, suggested), "research:decided");
  }
  s.wait(200).event("estimate.scored", { ratio: 0.42, modelCalls: 14, actualCredits: 0, expectedCredits: run.run.estimateCredits ?? 12, nonBillableCredits: 0 });
  s.event("run.finished", { totals: { credits: 0, modelCalls: 14, nonBillableCredits: 0 }, outcome: "succeeded", summary: outcome === "do-not-build" ? "Research finished; the verdict waits for your decision." : "Research finished." }, "research:finished");
  return patchTotals(s, run);
});

/** Contractors still briefed when research stops are released with it. */
function releaseContractors(story: Story, run: DemoRun) {
  return (w: World) => {
    for (const strand of story.strands) {
      const c = w.employees.find((e) => e.id === uuidFor(`contractor:${run.run.id}:${strand.id}`));
      if (c && c.status !== "released") Object.assign(c, { status: "released", currentRun: null, releasedAt: new Date().toISOString() });
    }
  };
}

/** `IdeaService.DecideAutomaticallyAsync`: in auto-mode a build or change verdict is built on its own, research's change applied. */
function autoDecide(w: World, r: DemoRun, ideaId: string, outcome: string, suggested: string | null) {
  const i = w.ideas.find((x) => x.id === ideaId);
  if (!i || i.status !== "verdict") return;
  const project = w.nodes.find((n) => n.ideaId === i.id && n.level === "project");
  const scope = i.scope ?? project?.path ?? r.run.scope;
  if (i.redLine) {
    append(w, r, "message", { from: "runner", title: "It will not be built", text: `The idea crosses a red line (${i.redLine}), and FrostAura never builds it.`, milestone: "decided" });
    return;
  }
  if ((setting(w, scope, "autonomy")?.value ?? "auto") === "checkpoints") {
    append(w, r, "message", { from: "runner", title: "Waiting for your decision", text: `The verdict waits for you: build it, change it or drop it. Autonomy at ${scope} is 'checkpoints', so the owner decides on the verdict.`, milestone: "decided" });
    return;
  }
  const at = new Date().toISOString();
  const changes = [...new Set([...(i.history ?? []).filter((h) => h.choice === "change" && h.note).map((h) => String(h.note)), ...(outcome === "change" && suggested ? [suggested] : [])])];
  const runId = newId(w, "run");
  const build = startRun(w, { id: runId, kind: "build", title: `Build: ${titleOf(i.text)}`, scope: project?.path ?? r.run.scope, ideaId: i.id, estimateCredits: 120, employeeId: null, conversationId: null }, "build", { ideaId: i.id, ...(typeof r.playback?.params.story === "string" ? { story: r.playback.params.story } : {}) });
  append(w, build, "message", { from: "owner", text: i.text, constraints: i.constraints.join("\n"), verdict: outcome, overruled: false, note: null, decidedBy: "auto-mode", changes, appliedChange: outcome === "change" ? suggested : null });
  i.status = "decided";
  i.decision = { choice: "build", at, by: "auto-mode", overruled: false, runId, via: "auto-mode" };
  if (project) setStage(w, project.path, "planning", null);
  w.notifications = w.notifications.map((n) => (n.subject?.id === i.id ? { ...n, read: true } : n));
  append(w, r, "message", {
    from: "runner",
    title: "Building has started",
    text: outcome === "change" ? `Auto-mode is building it now, with research's change applied: ${suggested ?? ""}. You can follow the build, pause it or stop it at any time.` : "Auto-mode is building it now, on that verdict. You can follow the build, pause it or stop it at any time.",
    milestone: "decided",
  });
  return ["Idea", "Tree", "Run", "Notifications", "Credits"];
}

/** `estimate.scored` and `run.finished` carry the run's real totals: fill them in from the calls. */
function patchTotals(s: Script, run: DemoRun) {
  let credits = 0;
  let calls = 0;
  let free = 0;
  for (const st of s.steps) {
    if (st.event?.type === "model.replied") {
      calls += 1;
      const c = Number(st.event.payload.settledCredits ?? 0);
      if (st.event.payload.billable === false) free += c;
      else credits += c;
    }
    if (st.event?.type === "estimate.scored") Object.assign(st.event.payload, { actualCredits: round(credits), modelCalls: calls, nonBillableCredits: round(free), ratio: round(credits / Math.max(1, Number(st.event.payload.expectedCredits))) });
    if (st.event?.type === "run.finished" && st.event.payload.totals) st.event.payload.totals = { credits: round(credits), modelCalls: calls, nonBillableCredits: round(free) };
  }
  void run;
  return s.steps;
}

function round(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------------------------------------
// Build and change: the plan, each part built and checked, review, publish
// ---------------------------------------------------------------------------------------------

interface Part extends PlanItemStory {
  /** A change's last part: nothing is built; what the app did before is checked again. */
  keep?: boolean;
}

interface Pipeline {
  prefix: "build" | "change";
  name: string;
  projectPath: string;
  appPath: string;
  summary: string;
  requirements: { id: string; text: string }[];
  items: Part[];
  leftOut: { requirement: string; text: string; reason: string }[];
  sentBack: Story["sentBack"];
  finding: Story["finding"];
  fail: boolean;
  /** Parts an earlier attempt built and checked: kept, not built or charged again. */
  carried: string[];
  /** The plan an earlier attempt agreed, kept as it was. */
  planCarried: boolean;
  eng: { id: string; name: string };
  qa: { id: string; name: string };
  reviewerId: string | null;
  plannerTask: string;
  /** The new version's commit message, for a change. */
  versionMessage: string | null;
}

/** "The builder · The plan", in the Runner's words (`BuildWorkflow.PlanAnnouncement`). */
function planAnnouncement(o: Pick<Pipeline, "summary" | "items" | "requirements" | "leftOut">) {
  const count = o.items.length;
  const built = `${count} part${count === 1 ? "" : "s"}, each built, then checked in the running app against what you asked for.`;
  const left = o.leftOut.length === 0 ? `All ${o.requirements.length} things the idea asks for are covered.` : `Left out: ${o.leftOut.map((l) => `${l.text.replace(/\.$/, "")}, because ${l.reason.replace(/\.$/, "")}.`).join(" ")}`;
  return `${o.summary.replace(/\.$/, "")}. ${built} ${left}`;
}

function pipeline(s: Script, world: World, run: DemoRun, o: Pipeline) {
  const { prefix, projectPath, appPath, eng, qa } = o;
  const org = orgOf(projectPath);
  const items = o.items.map((i) => ({ id: i.id, text: i.text, detail: i.detail, check: i.check, covers: i.covers }));
  const planEvent = { summary: o.summary, items, requirements: o.requirements, leftOut: o.leftOut };
  const planKey = `plan:${run.run.id}`;

  // The plan --------------------------------------------------------------------------------
  if (o.planCarried) {
    s.wait(400).event("plan.accepted", { by: "earlier-attempt", ...planEvent });
    s.event("message", { kind: "plan.carried", from: "runner", items: o.carried, retryOf: String(run.playback?.params.retryOf ?? "") });
    s.event(
      "message",
      {
        from: "runner",
        title: "Carrying on",
        text: o.carried.length === 0 ? "This picks up where the earlier attempt stopped: the plan agreed then is kept, and building starts again from its first part." : `This picks up where the earlier attempt stopped: ${o.carried.length} of ${items.length} parts were already built and checked, so they are kept, not rebuilt or charged again.`,
        milestone: "carried",
      },
      `${prefix}:carried`,
    );
  } else {
    s.wait(500).event("message", { kind: "agent.start", task: o.plannerTask, agent: "planner" });
    s.effect((w) => working(w, eng.id, run));
    for (const [file, result] of [
      ["AGENTS.md", "# AGENTS.md — how this app is built\n\nOne Endgame app: a .NET API that serves its own React front end, as one container."],
      [prefix === "change" ? "PROGRESS.md" : "docs/app.md", prefix === "change" ? "# Progress\n\n- [x] each part the app has, built and checked" : "# The app\n\nThe template's Notes example: a signed-in person keeps notes."],
      ["api/Program.cs", "var builder = WebApplication.CreateBuilder(args); …"],
    ] as const) {
      s.wait(400);
      cycle(s, run, { agent: "planner", employeeId: eng.id, taskType: "plan", credits: 0.031, tool: { name: "read_file", args: { path: file }, result, paths: [file] }, scope: projectPath });
    }
    s.wait(1200).event("plan.proposed", { agent: "planner", ...planEvent }, `${prefix}:plan`);
    s.effect((w) => setStage(w, projectPath, "planning", null));
    s.event("message", { kind: "agent.reply", agent: "planner", final: true, reply: `${items.length}-item plan: ${o.summary}` });
    // With the plan checkpoint on in checkpoints mode, nothing is built until the owner agrees it (BLD-04).
    s.ask((w, r) => {
      const on = setting(w, r.run.scope, "autonomy")?.value === "checkpoints" && setting(w, r.run.scope, "checkpoint.plan")?.value === "true";
      if (!on) return null;
      return { title: prefix === "change" ? "Accept this plan for the change?" : "Accept this plan?", detail: planAnnouncement(o), onApprove: { kind: "continue" }, onDecline: "stops", key: planKey };
    }, `${prefix}:waiting-on-plan`);
    s.wait(300).effect((w, r) => {
      const asked = w.approvals.filter((a) => a.runId === r.run.id && a.key === planKey).pop();
      if (asked?.answer === "rejected") {
        const answered = [...r.events].reverse().find((e) => e.type === "approval.answered" && e.payload.approvalId === asked.id);
        const note = typeof answered?.payload.comment === "string" && answered.payload.comment.trim() ? ` Your note: "${answered.payload.comment.trim().slice(0, 300)}"` : "";
        stop(w, r, `You declined the plan, so nothing was ${prefix === "change" ? "changed" : "built"}.${note} “Try again” plans it afresh.`, `The owner rejected the plan.${note}`);
        return ["Run", "Tree", "Idea"];
      }
      append(w, r, "plan.accepted", { by: asked ? "owner" : "auto-mode", ...planEvent });
      append(w, r, "message", { from: "builder", title: "The plan", text: planAnnouncement(o), milestone: "planned" });
      return ["Run"];
    });
  }
  s.event("message", { data: { items: items.map((i) => ({ id: i.id, check: i.check, deliverable: i.detail })) }, kind: "workflow.step", step: "plan", agent: "workflow" });
  for (const id of o.carried) s.event("message", { data: { passed: true, carried: true }, kind: "workflow.step", step: `item:${id}`, agent: "workflow" });

  // The estimate, refined by the plan: in auto-mode a plan that would break the budget does not begin (RUN-09).
  const planCredits = prefix === "change" ? 9 : 90;
  if (!o.planCarried) {
    s.wait(200).event("estimate.made", { basis: `the starting figure for ${prefix} runs (fewer than 3 finished runs to learn from), scaled to a plan of ${items.length} items`, stage: "plan", source: "runner", credits: planCredits, samples: 0 });
    s.effect((w, r) => {
      r.run.estimateCredits = planCredits;
      const room = headroomAt(w, r.run.scope);
      if ((setting(w, r.run.scope, "autonomy")?.value ?? "auto") !== "auto" || planCredits <= room) return ["Run"];
      append(w, r, "message", { from: "runner", title: "Waiting for budget", code: "estimate_over_budget", text: `The plan is estimated at ${planCredits} credits, more than the ${room} left, so building has not started. Raise the budget, then resume.`, estimate: planCredits, headroom: room });
      append(w, r, "run.paused", { by: "runner", reason: "estimate_over_budget" });
      return ["Run", "Tree"];
    }, `${prefix}:waiting-for-budget`);
    s.event("message", { data: { credits: planCredits }, kind: "workflow.step", step: "estimate.plan", agent: "workflow" });
  }
  s.effect((w) => {
    setStage(w, projectPath, "building", null);
    for (const i of items) {
      const id = uuidFor(`task:${run.run.id}:${i.id}`);
      if (!w.tasks.some((t) => t.id === id)) {
        const at = new Date().toISOString();
        const kept = o.carried.includes(i.id);
        w.tasks.unshift({ id, scope: projectPath, runId: run.run.id, parentTaskId: null, title: i.text, description: i.detail, status: kept ? "done" : "todo", holderRunId: null, holderEmployeeId: null, employeeId: kept ? eng.id : null, claimedAt: null, estimateCredits: 30, actualCredits: kept ? 0 : null, dependsOn: [], createdAt: at, updatedAt: at });
      }
    }
    return ["Tasks", "Tree"];
  });
  for (const i of items) s.event("task.created", { taskId: uuidFor(`task:${run.run.id}:${i.id}`), title: i.text });

  // Each part ---------------------------------------------------------------------------------
  let failed = false;
  o.items.forEach((item, index) => {
    if (failed || o.carried.includes(item.id)) return;
    const taskId = uuidFor(`task:${run.run.id}:${item.id}`);
    budgetStop(s, prefix, (w) => {
      const t = w.tasks.find((x) => x.id === taskId);
      if (t) t.status = "failed";
    });
    const files = item.keep ? [] : (item.detail.match(/[\w./-]+\.(cs|tsx?|md)/g)?.slice(0, 4) ?? ["web/src/App.tsx"]);
    if (!item.keep) {
      const builder = `builder-${item.id}-0`;
      s.wait(600).event("message", { kind: "agent.start", task: `Build this one feature of the plan, completely, then commit it.\n\nThe feature: [${item.id}] ${item.detail}\nIt will be checked by: ${item.check}`, agent: builder, taskType: "build" }, `${prefix}:part-${index + 1}`);
      s.event("task.claimed", { taskId, holder: eng.name, summary: item.text });
      s.effect((w) => {
        const t = w.tasks.find((x) => x.id === taskId);
        if (t) Object.assign(t, { status: "in_progress", holderRunId: run.run.id, holderEmployeeId: eng.id, employeeId: eng.id, claimedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        working(w, eng.id, run);
        return ["Tasks"];
      });
      for (const f of files) {
        s.wait(500);
        cycle(s, run, { agent: builder, employeeId: eng.id, taskType: "build", credits: 0.024, tool: { name: "read_file", args: { path: f }, result: `    1\t// ${f}`, paths: [f] }, scope: projectPath });
        s.wait(400);
        cycle(s, run, { agent: builder, employeeId: eng.id, taskType: "build", credits: 0.041, tool: { name: "edit_file", args: { path: f }, result: `Edited ${f}.`, paths: [f] }, scope: projectPath, stage: "build" });
      }
      s.wait(500);
      cycle(s, run, { agent: builder, employeeId: eng.id, taskType: "build", credits: 0.036, tool: { name: "run", args: { command: "make test" }, result: "Vitest 17 passed · xUnit 14 passed\nexit code 0", command: "make test" }, scope: projectPath, stage: "build" });
      cycle(s, run, { agent: builder, employeeId: eng.id, taskType: "build", credits: 0.028, tool: { name: "git_commit", args: { message: `${item.id}: ${item.text.slice(0, 50)}` }, result: `Committed ${uuidFor(`${run.run.id}:${item.id}`).slice(0, 7)}.` }, scope: projectPath, stage: "build" });
      s.event("message", { kind: "agent.reply", agent: builder, final: true, reply: `Done — the ${item.id} item is built, verified and committed.` });
    } else {
      s.wait(600).event("task.claimed", { taskId, holder: qa.name, summary: item.text }, `${prefix}:part-${index + 1}`);
      s.effect((w) => {
        const t = w.tasks.find((x) => x.id === taskId);
        if (t) Object.assign(t, { status: "in_progress", holderRunId: run.run.id, holderEmployeeId: qa.id, employeeId: qa.id, claimedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        return ["Tasks"];
      });
    }

    const evaluator = `evaluator-${item.id}-0`;
    s.wait(600).event("message", { kind: "agent.start", task: item.keep ? "Evaluate the item now (round 0, built on build): nothing new was built for it; check again, in the running app, each part the app had before." : "Evaluate the item now (round 0, built on build).", agent: evaluator, taskType: "evaluate" });
    s.effect((w) => working(w, qa.id, run));
    s.wait(400);
    cycle(s, run, { agent: evaluator, employeeId: qa.id, taskType: "evaluate", credits: 0.05, tool: { name: "git_diff", args: {}, result: `${Math.max(1, files.length)} files changed` }, scope: projectPath });
    cycle(s, run, { agent: evaluator, employeeId: qa.id, taskType: "evaluate", credits: 0.06, tool: { name: "run", args: { command: "make test", timeout_seconds: 600 }, result: "exit code 0", command: "make test" }, scope: projectPath });
    const covered = item.covers.length;
    const failsHere = (o.sentBack && o.sentBack.item === item.id) || (o.fail && index === o.items.length - 1);
    if (failsHere) {
      const fault = o.sentBack?.item === item.id ? o.sentBack : { item: item.id, fault: "The check named in the plan does not pass.", evidence: "make test fails: 2 of 17 Vitest tests fail on the empty state." };
      cycle(s, run, { agent: evaluator, employeeId: qa.id, taskType: "evaluate", credits: 0.07, tool: { name: "check_preview", args: { path: "" }, result: fault.evidence }, scope: projectPath });
      s.event("evaluation.failed", { item: item.id, text: item.text, tier: "build", round: 0, faults: [fault.fault], evidence: fault.evidence, summary: `Sent back for repair, at no charge: ${item.text.replace(/\.$/, "")} (${Math.max(0, covered - 1)} of ${covered} of your requirements shown working in the running app).` }, `${prefix}:sent-back`);
      s.event("message", { data: { faults: [fault.fault], passed: false, evidence: fault.evidence }, kind: "workflow.step", step: `item:${item.id}:round:0`, agent: "workflow" });
      s.event("message", { from: "evaluator", text: `${qa.name} sent part ${index + 1} back: ${fault.fault} It is being repaired on a stronger model, at no charge.`, title: "Sent back" });
      const repair = `builder-${item.id}-1`;
      s.wait(700).event("message", { kind: "agent.start", task: `Repair this item (round 1). The evaluator found: ${fault.fault}`, agent: repair, taskType: "build-t1" });
      const fixFile = files[0] ?? "api/Bookings/BookingsEndpoints.cs";
      for (let k = 0; k < 3; k += 1) {
        s.wait(500);
        cycle(s, run, { agent: repair, employeeId: eng.id, taskType: "build-t1", credits: 0.11, model: STRONG, billable: false, tool: { name: k === 2 ? "run" : "edit_file", args: k === 2 ? { command: "make test" } : { path: fixFile }, result: k === 2 ? "exit code 0" : "Edited.", paths: [fixFile], ...(k === 2 ? { command: "make test" } : {}) }, scope: projectPath });
      }
      s.effect((w) => {
        const nc = (w.notCharged[org] ??= { credits: 0, repairs: 0 });
        nc.repairs += 1;
        const tr = w.trackRecords.find((t) => t.employeeId === eng.id);
        if (tr) {
          tr.work.sentBack += 1;
          tr.repairsNotCharged.calls += 3;
          tr.repairsNotCharged.credits += 0.33;
        }
        return ["Credits", "Employee"];
      });
      if (o.fail) {
        s.wait(800);
        cycle(s, run, { agent: `evaluator-${item.id}-1`, employeeId: qa.id, taskType: "evaluate", credits: 0.06, tool: { name: "run", args: { command: "make test" }, result: "exit code 1" }, scope: projectPath });
        s.event("evaluation.failed", { item: item.id, text: item.text, tier: "build-t1", round: 1, faults: [fault.fault], evidence: "The repair did not pass either: the same 2 tests fail.", summary: `Sent back for repair again, at no charge: ${item.text.replace(/\.$/, "")}.` });
        s.event("task.failed", { taskId, reason: "Still did not work after 3 rounds of repair, each on a stronger model; the repairs were not charged." });
        s.effect((w, r) => {
          const t = w.tasks.find((x) => x.id === taskId);
          if (t) t.status = "failed";
          setStage(w, projectPath, prefix === "change" ? "live" : "paused", prefix === "change" ? null : "The build stopped: one part did not pass its check after a repair.");
          const a = appAt(w, appPath);
          if (a && prefix === "build") Object.assign(a, { status: "draft", running: "paused", health: "unknown", healthSummary: "Never published: the build did not succeed." });
          const what = item.text.replace(/\.$/, "");
          stop(w, r, `"${what}" still did not work after 3 rounds of repair, each on a stronger model, so the app was not ${prefix === "change" ? "changed" : "published"}. Its work so far is saved and the repairs were not charged; “Try again” carries on from it.`, `'${item.detail.slice(0, 80)}' still failed its check after 3 repair rounds: ${fault.fault}`);
          return ["Tasks", "Tree", "App", "Run", "Idea"];
        }, `${prefix}:failed`);
        failed = true;
        return;
      }
      s.wait(600);
      cycle(s, run, { agent: `evaluator-${item.id}-1`, employeeId: qa.id, taskType: "evaluate", credits: 0.06, tool: { name: "run", args: { command: "make test" }, result: "exit code 0" }, scope: projectPath });
      s.event("evaluation.passed", { item: item.id, text: item.text, tier: "build-t1", round: 1, faults: [], evidence: `Re-checked after the repair: ${fault.fault.replace(/\.$/, "")} no longer happens; make test and make lint pass.`, summary: `Checked and working: ${item.text.replace(/\.$/, "")} (${covered} of ${covered} of your requirements shown working in the running app).` }, `${prefix}:repaired`);
    } else {
      s.wait(500);
      s.event("evaluation.passed", { item: item.id, text: item.text, tier: "build", round: 0, faults: [], evidence: `${item.check} — confirmed: make test and make lint exit 0.`, summary: `Checked and working: ${item.text.replace(/\.$/, "")} (${covered} of ${covered} of your requirements shown working in the running app).` });
    }
    s.event("message", { data: { passed: true }, kind: "workflow.step", step: `item:${item.id}`, agent: "workflow" });
    s.event("task.done", { taskId, summary: "Built, checked and committed." });
    s.effect((w) => {
      const t = w.tasks.find((x) => x.id === taskId);
      if (t) Object.assign(t, { status: "done", holderRunId: null, holderEmployeeId: null, actualCredits: 4.2, updatedAt: new Date().toISOString() });
      const tr = w.trackRecords.find((x) => x.employeeId === eng.id);
      if (tr && !item.keep) tr.work.accepted += 1;
      const q = w.trackRecords.find((x) => x.employeeId === qa.id);
      if (q) q.work.judged += 1;
      setStage(w, projectPath, index === o.items.length - 1 ? "evaluating" : "building", null);
      return ["Tasks", "Employee"];
    });
  });
  if (failed) return;

  // Security review ---------------------------------------------------------------------------
  s.wait(700).event("message", { kind: "agent.start", task: "Review the app now against your checklist, then reply with the JSON object.", agent: "security-reviewer-0", taskType: "evaluate" }, `${prefix}:security-review`);
  s.effect((w) => {
    setStage(w, projectPath, "reviewing", null);
    working(w, o.reviewerId, run);
  });
  for (const f of ["api/Program.cs", "api/Bookings/BookingsEndpoints.cs", "web/src/App.tsx"]) {
    s.wait(400);
    cycle(s, run, { agent: "security-reviewer-0", employeeId: o.reviewerId, taskType: "evaluate", credits: 0.045, tool: { name: "read_file", args: { path: f }, result: `    1\t// ${f}`, paths: [f] }, scope: projectPath });
  }
  const finding = o.finding;
  if (finding) {
    s.event("message", { from: "security-reviewer", kind: "security.review", passed: false, findings: [finding] });
    s.event("message", { from: "security-reviewer", text: "The security review found 1 problem that would block publishing; they are being fixed now, at no charge.", title: "Security review found problems", milestone: "security:0" }, `${prefix}:security-finding`);
    s.effect((w) => {
      notify(w, { key: `security:${run.run.id}`, kind: "security.finding", severity: "urgent", title: "The security review found 1 problem", detail: `In "${run.run.title}". Publishing waits until they are fixed.`, scope: projectPath, subject: { kind: "run", id: run.run.id } });
    });
    s.wait(600).event("message", { kind: "agent.start", task: `The security review found problems that block publishing. Fix each one, verify with make lint and make test, and commit.\n\n${JSON.stringify([finding])}`, agent: "builder-security-repair" });
    for (let k = 0; k < 3; k += 1) {
      s.wait(500);
      cycle(s, run, { agent: "builder-security-repair", employeeId: eng.id, taskType: "build", credits: 0.09, billable: false, tool: { name: k === 2 ? "run" : "edit_file", args: k === 2 ? { command: "make test" } : { path: finding.file }, result: k === 2 ? "exit code 0" : `Edited ${finding.file}.`, paths: [finding.file] }, scope: projectPath });
    }
    s.wait(700).event("message", { kind: "agent.start", task: "Review the app now against your checklist, then reply with the JSON object.", agent: "security-reviewer-1", taskType: "evaluate" });
    cycle(s, run, { agent: "security-reviewer-1", employeeId: o.reviewerId, taskType: "evaluate", credits: 0.05, tool: { name: "read_file", args: { path: finding.file }, result: "    94\t… b.Id == id && b.AddedById == user.Id …", paths: [finding.file] }, scope: projectPath });
  }
  s.event("message", { from: "security-reviewer", kind: "security.review", passed: true, findings: [] });
  s.event("message", { from: "security-reviewer", text: "The security review checked secrets, sign-in, data, model calls and outbound calls, and found nothing that blocks publishing.", title: "Security review passed", milestone: finding ? "security:1" : "security:0" }, `${prefix}:security-passed`);

  // Publish -----------------------------------------------------------------------------------
  const commit = uuidFor(`commit:${run.run.id}:${appPath}`).replace(/-/g, "").slice(0, 40).padEnd(40, "0");
  const appId = appAt(world, appPath)?.id ?? uuidFor(`app:${appPath}`);
  s.wait(1500).event("message", { data: { image: `app-${appId}:${commit}`, state: "running", commit, started: true, visibility: prefix === "change" ? "unchanged" : "private" }, kind: "workflow.step", step: "publish", agent: "workflow" });
  s.effect((w) => {
    setStage(w, projectPath, "publishing", null);
    const a = appAt(w, appPath);
    if (a) Object.assign(a, { status: "running", running: a.runningSetting === "always-on" ? "always-on" : "awake", health: "healthy", healthSummary: prefix === "change" ? a.healthSummary : "Running; nothing measured yet.", version: commit, publishedAt: new Date().toISOString() });
    const versions = (w.versions[a?.id ?? appId] ??= []);
    for (const v of versions) v.live = false;
    const at = new Date().toISOString();
    const author = { kind: "employee" as const, id: eng.id, name: eng.name };
    if (prefix === "change") {
      const repaired = o.sentBack ? o.items.find((i) => i.id === o.sentBack?.item) : undefined;
      if (repaired) versions.unshift({ commit: uuidFor(`commit:${run.run.id}:repair`).replace(/-/g, "").slice(0, 40), message: `Repair: ${repaired.text.replace(/\.$/, "")}`, at, author, live: false });
      versions.unshift({ commit, message: o.versionMessage ?? o.summary, at, author, live: true });
    } else {
      versions.unshift({ commit, message: "Security fix: a member changes only their own books", at, author, live: true });
      for (const i of o.items.slice().reverse()) versions.push({ commit: uuidFor(`commit:${i.id}`).replace(/-/g, "").slice(0, 40), message: i.text, at, author, live: false });
    }
    return ["App", "Versions", "Tree"];
  });
  if (prefix === "change") {
    s.event("message", { from: "builder", text: `The new version of ${o.name} is running, with the change and everything it did before checked in the running app. Who may open it has not changed. Its history shows the change.`, title: "New version running", milestone: "published" }, "change:published");
  } else {
    s.event("message", { from: "builder", text: `${o.name} is built and running privately. Only you and the people you choose can open it until you make it public.`, title: "Running privately", milestone: "published" }, "build:published");
  }
  s.effect((w) => {
    setStage(w, projectPath, "live", null);
    for (const id of [eng.id, qa.id, o.reviewerId]) if (id) settle(w, id, run.run.id);
    return ["Tree", "App"];
  });
  s.wait(300).event("estimate.scored", { ratio: 0, modelCalls: 0, actualCredits: 0, expectedCredits: planCredits, nonBillableCredits: 0 });
  s.event("run.finished", { totals: {}, outcome: "succeeded", summary: prefix === "change" ? `${o.name} is changed and its new version is running.` : `${o.name} is built and running privately.` }, `${prefix}:finished`);
}

/** The parts an earlier attempt finished, read from its own journal (`BuildWorkflow.CarryOverAsync`). */
function carriedFrom(world: World, retryOf: unknown): { planCarried: boolean; carried: string[] } {
  const earlier = typeof retryOf === "string" ? world.runs.find((r) => r.run.id === retryOf) : undefined;
  if (!earlier) return { planCarried: false, carried: [] };
  const agreed = earlier.events.some((e) => e.type === "plan.accepted");
  if (!agreed) return { planCarried: false, carried: [] };
  const passed = earlier.events.filter((e) => e.type === "message" && e.payload.kind === "workflow.step" && /^item:[^:]+$/.test(String(e.payload.step ?? "")) && (e.payload.data as { passed?: unknown } | undefined)?.passed === true).map((e) => String(e.payload.step).slice(5));
  return { planCarried: true, carried: [...new Set(passed)] };
}

defineScript("build", (world, run) => {
  const p = run.playback?.params ?? {};
  const idea = world.ideas.find((i) => i.id === p.ideaId);
  const existingProject = world.nodes.find((n) => n.ideaId === idea?.id && n.level === "project");
  const base: Story = storyFor(idea?.text ?? "", typeof p.story === "string" ? p.story : null);
  const story: Story = existingProject ? { ...base, name: existingProject.name } : base;
  const org = orgOf(run.run.scope);
  const divisionPath = existingProject ? existingProject.path.split("/").slice(0, 2).join("/") : `${org}/${story.division.slug}`;
  const projectPath = existingProject?.path ?? `${divisionPath}/${story.project}`;
  const appPath = `${projectPath}/web`;
  // Placement is said once, from the world before it: a division this run created is still new when its steps are rebuilt.
  const placed = run.events.find((e) => e.type === "message" && e.payload.kind === "workflow.step" && e.payload.step === "placement")?.payload.data as { divisionCreated?: boolean } | undefined;
  const divisionExists = placed ? placed.divisionCreated !== true : !!node(world, divisionPath);
  const owner = run.events.find((e) => e.type === "message" && e.payload.from === "owner")?.payload ?? {};
  const changes = Array.isArray(owner.changes) ? owner.changes.filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [];
  const { planCarried, carried } = carriedFrom(world, p.retryOf);
  const s = new Script();
  const eng = { key: `${projectPath}:engineer`, name: pick(["Arlo", "Juniper", "Felix", "Rosa"], projectPath), role: "Software engineer" };
  const qa = { key: `${projectPath}:qa`, name: pick(["Bea", "Otto", "Nell", "Ivo"], projectPath), role: "QA engineer" };
  const lead = { key: `${divisionPath}:lead`, name: pick(["Sol", "Maren", "Ezra"], divisionPath), role: "Division lead" };
  const before = (role: string, key: string) => {
    const e = employeeAt(world, projectPath, role);
    return e && e.scope === projectPath && !(e.id === uuidFor(`employee:${key}`) && hiredBy(world, e.id, run.run.id)) ? e : undefined;
  };
  const hadEngineer = before("Software engineer", eng.key);
  const hadQa = before("QA engineer", qa.key);
  const engId = hadEngineer?.id ?? uuidFor(`employee:${eng.key}`);
  const qaId = hadQa?.id ?? uuidFor(`employee:${qa.key}`);
  const engName = world.employees.find((e) => e.id === engId)?.name ?? eng.name;
  const qaName = world.employees.find((e) => e.id === qaId)?.name ?? qa.name;

  s.event("run.started", { holder: "runner-demo-1" });
  if (!p.retryOf) {
    s.wait(300).event("estimate.made", { basis: "the starting figure for build runs (fewer than 3 finished runs to learn from)", stage: "start", source: "runner", credits: 120, samples: 0 });
    gate(s, run, 120, "build");
  } else {
    gate(s, run, run.run.estimateCredits ?? 20, "build");
  }
  s.wait(200).event("message", { data: { autonomy: setting(world, projectPath, "autonomy")?.value ?? "auto", estimate: run.run.estimateCredits ?? 120, headroom: headroomAt(world, run.run.scope) }, kind: "workflow.step", step: "estimate.gate", agent: "workflow" });
  if (!p.retryOf) {
    s.wait(500).event("message", {
      from: "builder",
      text: divisionExists || existingProject ? `${story.name} will live in ${node(world, divisionPath)?.name ?? story.division.name}, as the project ${story.name}.` : `${story.name} will live in a new division, ${story.division.name}, as the project ${story.name}.`,
      title: "Placed",
      milestone: "placed",
    });
  }
  s.effect((w) => {
    ensureNode(w, divisionPath, story.division.name);
    ensureNode(w, projectPath, story.name, { stage: "planning", ideaId: idea?.id ?? null });
    ensureNode(w, appPath, story.name);
    setStage(w, projectPath, "planning", null);
    if (!appAt(w, appPath)) newApp(w, appPath, story.name);
    const r = w.runs.find((x) => x.run.id === run.run.id);
    if (r) r.run.scope = projectPath;
    if (idea) {
      const i = w.ideas.find((x) => x.id === idea.id);
      if (i) i.scope = projectPath;
    }
    return ["Tree", "App", "Ontology"];
  }, "build:placed");
  if (!p.retryOf) {
    s.event("message", { data: { name: story.name, appId: uuidFor(`app:${appPath}`), appPath, division: divisionPath, projectPath, divisionCreated: !divisionExists }, kind: "workflow.step", step: "placement", agent: "workflow" });
    const hires: { who: { key: string; name: string; role: string }; scope: string; limit: number; reason: string; step: string }[] = [];
    if (!divisionExists) hires.push({ who: lead, scope: divisionPath, limit: 100, reason: "A new division was created for this work, and every division has someone answerable for it.", step: `hire:division:${divisionPath}` });
    if (!hadEngineer) hires.push({ who: eng, scope: projectPath, limit: 1500, reason: `${story.name} is entering its build, and somebody must build and maintain it.`, step: `hire:stage:build:${projectPath}` });
    if (!hadQa) hires.push({ who: qa, scope: projectPath, limit: 600, reason: `${story.name} is entering evaluation, and the person who checks the work must not be the one who did it.`, step: `hire:stage:evaluate:${projectPath}` });
    for (const h of hires) {
      s.wait(400).event("message", { data: { name: h.who.name, role: h.who.role, status: "accepted", employeeId: uuidFor(`employee:${h.who.key}`) }, kind: "workflow.step", step: h.step, agent: "workflow" });
      s.effect((w) => {
        hireEmployee(w, { key: h.who.key, name: h.who.name, role: h.who.role, scope: h.scope, limit: h.limit, mandate: h.who.role === "Software engineer" ? `Build and maintain ${story.name}.` : h.who.role === "QA engineer" ? `Check ${story.name}'s work against its plan, sceptically, before it ships.` : `Answer for ${story.division.name}: its people, its budget and its work.`, reason: h.reason, trigger: h.step.startsWith("hire:division") ? "division" : "stage", runId: run.run.id });
      });
      s.event("message", { from: "runner", text: `${h.who.name} joins as a ${h.who.role.toLowerCase()}, at up to ${h.limit} credits a month: ${h.reason}`, title: `Hired ${h.who.name}`, milestone: h.step.replace(/^hire:/, "hired:") });
    }
  }
  s.mark("build:hired");
  const agreed = changes.length ? `\n\nAgreed after research, and part of what is built:\n${changes.map((c) => `- ${c}`).join("\n")}` : "";
  const requirements = [...story.plan.requirements, ...changes.map((c, i) => ({ id: `C${i + 1}`, text: c }))];
  const items: Part[] = story.plan.items.map((i, k) => (k === 0 && changes.length ? { ...i, covers: [...i.covers, ...changes.map((_c, n) => `C${n + 1}`)] } : i));
  pipeline(s, world, run, {
    prefix: "build",
    name: story.name,
    projectPath,
    appPath,
    summary: story.plan.summary,
    requirements,
    items,
    leftOut: story.plan.leftOut,
    sentBack: story.sentBack,
    finding: story.finding,
    fail: p.fail === true,
    carried,
    planCarried,
    eng: { id: engId, name: engName },
    qa: { id: qaId, name: qaName },
    reviewerId: world.employees.find((e) => orgOf(e.scope) === org && e.standing === "security-reviewer")?.id ?? null,
    plannerTask: `Plan the app described below. It starts from the app kit's template (the Notes example), which it replaces.\n\nThe idea, word for word:\n${idea?.text ?? story.name}${agreed}`,
    versionMessage: null,
  });
  return patchTotals(s, run);
});

/** The parts a built app already has, in plain words: what the factory recorded in its history. */
function earlierParts(world: World, appId: string): string[] {
  const parts = (world.versions[appId] ?? [])
    .filter((v) => v.author.kind !== "factory" && !/^(Repair|Restore|Security fix)/.test(v.message))
    .map((v) => v.message.replace(/\.$/, ""));
  return [...new Set(parts)].reverse().slice(0, 8);
}

/** The change, as a plan item: the request in the owner's words, built where the app keeps it. */
function changeItem(request: string): Part {
  const first = (request.split("\n")[0] ?? request).trim().replace(/\.$/, "");
  return {
    id: "c1",
    text: `${first}.`,
    detail: "api/Bookings/BookingsEndpoints.cs and api.tests/BookingsApiTests.cs for the rule; web/src/bookings/BookingPage.tsx and its Vitest tests for the screen; PROGRESS.md records it.",
    check: "make lint and make test pass; signed in, the change works in the running app as asked.",
    covers: ["C1"],
  };
}

// ---------------------------------------------------------------------------------------------
// A change to a built app: screened, planned from the request, built and checked, what worked
// before checked again, reviewed, and the new version published (`BuildWorkflow.ChangeAsync`)
// ---------------------------------------------------------------------------------------------

defineScript("change", (world, run) => {
  const p = run.playback?.params ?? {};
  const app = world.apps.find((a) => a.id === p.appId) ?? appAt(world, run.run.scope);
  const appPath = app?.path ?? run.run.scope;
  const projectPath = appPath.split("/").slice(0, 3).join("/");
  const name = node(world, projectPath)?.name ?? app?.name ?? "The app";
  const owner = run.events.find((e) => e.type === "message" && e.payload.from === "owner")?.payload ?? {};
  const request = String(owner.text ?? run.run.title.replace(/^Change: /, ""));
  const { planCarried, carried } = carriedFrom(world, p.retryOf);
  const eng = employeeAt(world, projectPath, "Software engineer");
  const qa = employeeAt(world, projectPath, "QA engineer");
  const s = new Script();
  s.event("run.started", { holder: "runner-demo-1" });
  gate(s, run, run.run.estimateCredits ?? 10, "change");
  s.wait(200).event("message", { data: { autonomy: setting(world, appPath, "autonomy")?.value ?? "auto", estimate: run.run.estimateCredits, headroom: headroomAt(world, appPath) }, kind: "workflow.step", step: "estimate.gate", agent: "workflow" });
  if (!p.retryOf) {
    // The red-line screen: the same product, so research is not repeated, but a change is never built over a red line.
    s.wait(500).event("message", { kind: "agent.start", task: "Screen the change now and reply with the JSON object.", agent: "red-line-screen", taskType: "summary" });
    s.wait(300);
    cycle(s, run, { agent: "red-line-screen", employeeId: null, taskType: "summary", credits: 0.004 });
    const red = redLine(request);
    s.event("message", { kind: "agent.reply", agent: "red-line-screen", final: true, reply: JSON.stringify({ breached: !!red, line: red?.line ?? null, reasoning: red?.reasoning ?? "The change keeps the app doing what it is for, for the people it is for." }) });
    s.event("message", { data: { breached: !!red, line: red?.line ?? null, reasoning: red?.reasoning ?? "The change keeps the app doing what it is for, for the people it is for." }, kind: "workflow.step", step: "screen", agent: "workflow" }, "change:screened");
    if (red) {
      s.wait(300).effect((w, r) => {
        stop(w, r, `This change crosses a red line (${red.line}). FrostAura never builds it, and no one can overrule that, so nothing was changed.`, `The change crosses a red line (${red.line}); nothing was changed.`);
        return ["Run", "App", "Tree"];
      }, "change:red-line");
      return patchTotals(s, run);
    }
    s.event("message", { data: { name, division: projectPath.split("/").slice(0, 2).join("/"), divisionCreated: false, projectPath, appPath, appId: app?.id ?? null, existing: true }, kind: "workflow.step", step: "placement", agent: "workflow" });
  }
  const before = app ? earlierParts(world, app.id) : [];
  const kept = before.map((text, i) => ({ id: `k${i + 1}`, text: `${text}.` }));
  const items: Part[] = [changeItem(request)];
  if (kept.length) {
    items.push({ id: "keep", text: "Everything the app did before still works", detail: "No new work: the app as changed is checked again against each part it already had.", check: "Each part the app had before is shown working in the running app, signed in, with the app's own tests passing.", covers: kept.map((k) => k.id), keep: true });
  }
  pipeline(s, world, run, {
    prefix: "change",
    name,
    projectPath,
    appPath,
    summary: `A change to ${name}: ${request.split("\n")[0]?.replace(/\.$/, "")}, built and checked in the running app, then everything ${name} did before checked again`,
    requirements: [{ id: "C1", text: request }, ...kept],
    items,
    leftOut: [],
    sentBack: p.clean === true || !kept.length ? null : { item: "keep", fault: "League block bookings no longer hold their four courts: the change frees a league's courts as if they were single bookings.", evidence: "Signed in as a league captain in the preview, a two-hour block on four courts was booked; after the change one of its courts showed as free to members." },
    finding: null,
    fail: p.fail === true,
    carried,
    planCarried,
    eng: { id: eng?.id ?? uuidFor(`employee:${projectPath}:engineer`), name: eng?.name ?? "The engineer" },
    qa: { id: qa?.id ?? uuidFor(`employee:${projectPath}:qa`), name: qa?.name ?? "The checker" },
    reviewerId: world.employees.find((e) => orgOf(e.scope) === orgOf(appPath) && e.standing === "security-reviewer")?.id ?? null,
    plannerTask: `Plan a change to ${name}, an app that is already built and running. PROGRESS.md lists what it does now, part by part. Change only what the request asks for, and keep everything it does now working; a change is usually one to three items.\n\nThe change, word for word:\n${request}`,
    versionMessage: request.split("\n")[0]?.replace(/\.$/, "") ?? null,
  });
  return patchTotals(s, run);
});

/** The change-screen's answer: the same red lines research screens every idea against. */
function redLine(text: string) {
  const t = text.toLowerCase();
  if (/(track|follow|monitor|watch|locat|record).{0,40}(staff|employee|worker|member|people|phone|where)|surveil|spy on/.test(t)) return { line: "surveillance", reasoning: "It would follow people without their meaningful consent, which is surveillance tooling." };
  if (/gambl|betting|casino|wager/.test(t)) return { line: "tobacco-gambling-finance", reasoning: "It would turn the app into exploitative gambling." };
  if (/payday|loan shark/.test(t)) return { line: "tobacco-gambling-finance", reasoning: "It is predatory finance." };
  if (/weapon|munition/.test(t)) return { line: "weapons", reasoning: "It would serve a weapon against civilians." };
  return null;
}

function pick(names: string[], seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return names[h % names.length] ?? names[0] ?? "Ada";
}

// ---------------------------------------------------------------------------------------------
// A conversation turn: a streamed reply, and proposals that raise an approval in the dock
// ---------------------------------------------------------------------------------------------

/** What approving a setting does, in the screens' own words (`AdjustSettingTool.ApprovalTitle`). */
function settingTitle(key: string, value: string): string {
  const on = value === "true";
  switch (key) {
    case "autonomy":
      return value === "checkpoints" ? "Stop for your sign-off at checkpoints here?" : "Switch here to auto-mode?";
    case "checkpoint.start":
      return `Turn ${on ? "on" : "off"} the “Before work starts” checkpoint here?`;
    case "checkpoint.plan":
      return `Turn ${on ? "on" : "off"} the “Before the plan is carried out” checkpoint here?`;
    case "checkpoint.hire":
      return `Turn ${on ? "on" : "off"} the “Before anyone is hired” checkpoint here?`;
    case "sleep.mode":
      return value === "always_on" ? "Keep the apps here always on?" : "Let the apps here sleep when nobody is using them?";
    case "sleep.idle_minutes":
      return `Let the apps here sleep after ${value} minutes without a visitor?`;
    case "workforce.idle_days":
      return `Flag employees here who have had no work for ${value} days?`;
    default:
      return "Change a setting here?";
  }
}

/** The setting a request names, and the value it asks for; null when it names none an agent may change. */
function settingAsked(lower: string): { key: string; value: string } | null {
  if (/always[- ]on|keep (the )?apps? awake/.test(lower)) return { key: "sleep.mode", value: "always_on" };
  const minutes = /sleep after (\d+)/.exec(lower);
  if (minutes) return { key: "sleep.idle_minutes", value: minutes[1] ?? "30" };
  const days = /idle .*?(\d+) days|(\d+) days/.exec(lower);
  if (/idle|no work/.test(lower) && days) return { key: "workforce.idle_days", value: days[1] ?? days[2] ?? "14" };
  const off = /\b(off|stop asking|no longer)\b/.test(lower);
  if (/plan checkpoint|checkpoint .*plan|agree the plan/.test(lower)) return { key: "checkpoint.plan", value: off ? "false" : "true" };
  if (/start checkpoint|before work starts/.test(lower)) return { key: "checkpoint.start", value: off ? "false" : "true" };
  if (/hire checkpoint|before anyone is hired/.test(lower)) return { key: "checkpoint.hire", value: off ? "false" : "true" };
  if (/auto[- ]?mode/.test(lower)) return { key: "autonomy", value: "auto" };
  if (/checkpoint/.test(lower)) return { key: "autonomy", value: "checkpoints" };
  return null;
}

defineScript("conversation", (world, run) => {
  const p = run.playback?.params ?? {};
  const text = String(p.text ?? "");
  const scope = run.run.scope;
  const s = new Script();
  const who = typeof p.employeeId === "string" ? world.employees.find((e) => e.id === p.employeeId) : undefined;
  // An employee answers as itself; otherwise Endgame's own assistant does (TALK-05).
  const said = (paragraphs: string[]) => say(s, who ? { from: "assistant", by: who.name, employeeId: who.id } : { from: "assistant" }, paragraphs);
  s.event("run.started", { holder: "runner-demo-1" });
  s.wait(500);
  // The model call is refused for budget: the conversation says so itself, with the way to more credits (TALK-15).
  s.effect((w, r) => {
    if (headroomAt(w, r.run.scope) >= 0.5) return;
    r.run.budgetExhausted = true;
    append(w, r, "message", { from: "runner", code: "budget_exhausted", title: "No reply: the budget ran out", text: "The credit budget ran out before a reply could be written, so nothing was answered and nothing more was charged. Top up or raise the budget, then ask again." });
    append(w, r, "run.finished", { outcome: "failed", summary: "The credit budget ran out, so the work stopped. Top up or raise the budget, then try it again; what was finished is kept.", totals: { credits: 0, modelCalls: 0, nonBillableCredits: 0 } });
    return ["Run", "Conversation"];
  }, "conversation:budget-stopped");
  cycle(s, run, { agent: "conversation", employeeId: who?.id ?? null, taskType: who?.jobDescription.modelTier ?? "chat", credits: 0.012, tool: { name: "read_organisation", args: { scope, what: "overview" }, result: `${node(world, scope)?.name ?? scope}: read.` } });
  s.wait(400);
  cycle(s, run, { agent: "conversation", employeeId: who?.id ?? null, taskType: who?.jobDescription.modelTier ?? "chat", credits: 0.018 });
  const lower = text.toLowerCase();
  const asked = settingAsked(lower);
  const atApp = !!appAt(world, scope);
  const retryAsk = /\b(try (it |that |this )?again|try the .* again|retry|start .* again)\b/.test(lower);
  const changeAsk = !retryAsk && !asked && (atApp || /\b(change|update)\b.*\bapp\b/.test(lower)) && /(let |add |change |make |should |show |allow |remove |cancel|rename|update )/.test(lower);
  const ideaAsk = !retryAsk && !asked && !changeAsk && /(idea|build|make (us |me )?an? |could we|new app|we need an? |start researching)/.test(lower);
  if (retryAsk) {
    const stopped = world.runs
      .filter((r) => (r.run.scope === scope || r.run.scope.startsWith(`${scope}/`)) && (r.run.status === "failed" || r.run.status === "cancelled") && (r.run.kind === "research" || r.run.kind === "build" || r.run.kind === "task"))
      .pop();
    if (!stopped) said([`Nothing in ${node(world, scope)?.name ?? scope} has stopped that can be tried again: every piece of work here finished or is still under way.`]);
    else {
      said([`"${stopped.run.title}" stopped before it finished. Trying it again carries on from where it stopped, with its estimate shown first; it needs your yes.`]);
      s.approval({ title: `Try again: ${stopped.run.title}?`, detail: `try_again: ${stopped.run.id}. No rule allows try_again here. Checkpoint: try_again.`, onApprove: { kind: "try-again", runId: stopped.run.id, scope }, onDecline: "continues" }, "conversation:approval");
      s.wait(400).effect(() => undefined);
      if (p.answer === "rejected") said(["Understood — I have not started it again. Say the word if you change your mind."]);
      else if (p.answer === "approved") said(["It has started again, carrying on from where it stopped; its estimate is the first thing in its own work."]);
    }
  } else if (changeAsk) {
    const request = text.replace(/^(please|can you|could you|could we)\s+/i, "").trim();
    const target = atApp ? scope : (world.apps.find((a) => a.path.startsWith(`${scope}/`) && lower.includes(a.name.toLowerCase()))?.path ?? scope);
    said([`I can ask the factory to change ${appAt(world, target)?.name ?? "the app"}: a plan for it first, then each part built and checked in the running app, and everything it does now checked again before the new version goes out. It needs your yes.`]);
    s.approval({ title: `Change the app: ${clip(request)}?`, detail: `change_app: ${target}: ${request}. No rule allows change_app here. Checkpoint: change_app.`, onApprove: { kind: "change-app", scope: target, request }, onDecline: "continues" }, "conversation:approval");
    s.wait(400).effect(() => undefined);
    if (p.answer === "rejected") said(["Understood — I have not asked for the change. Nothing about the app has changed."]);
    else if (p.answer === "approved") said(["The change has started. Its estimate is shown first in its own work, then the plan, each part as it is built and checked, and the new version."]);
  } else if (ideaAsk) {
    const ideaText = text.replace(/^(please|can you|could you|could we|let'?s)\s+/i, "").replace(/^(start researching|build|make|start)\s+(us\s+|me\s+)?/i, "");
    said(["That sounds worth looking into. Before anything is built, research checks who already does it, what they leave undone and whether people would pay.", "I have asked to start researching it; it needs your yes first."]);
    s.approval(
      {
        title: `Start researching an idea: ${clip(ideaText)}?`,
        detail: `start_idea: ${ideaText}. No rule allows start_idea here. Checkpoint: start_idea.`,
        onApprove: { kind: "start-idea", text: ideaText.charAt(0).toUpperCase() + ideaText.slice(1), scope: scope.split("/").slice(0, 2).join("/") },
        onDecline: "continues",
      },
      "conversation:approval",
    );
    s.wait(400).effect(() => undefined);
    if (p.answer === "rejected") said(["Understood — I have not started it. Say the word if you change your mind."]);
    else if (p.answer === "approved") said(["Research has started. You will see it on the org chart, and the verdict will wait for you there."]);
  } else if (asked) {
    said([`I can change that for ${node(world, scope)?.name ?? scope}. A setting changes only with your yes, and applies here and to everything beneath it that does not set its own.`]);
    s.approval({ title: settingTitle(asked.key, asked.value), detail: `adjust_setting: ${asked.key}=${asked.value}. No rule allows adjust_setting here. Checkpoint: adjust_setting.`, onApprove: { kind: "setting", key: asked.key, value: asked.value, scope }, onDecline: "continues" }, "conversation:approval");
    s.wait(400).effect(() => undefined);
    if (p.answer === "rejected") said(["Left as it was."]);
    else if (p.answer === "approved") said(["Done. The change applies here and to everything beneath it that does not set its own."]);
  } else {
    said(answer(world, scope, lower, who));
  }
  s.wait(300).event("run.finished", { totals: {}, outcome: "succeeded", summary: "Replied." }, "conversation:replied");
  return patchTotals(s, run);
});

function clip(t: string) {
  return t.length > 300 ? `${t.slice(0, 148)} … ${t.slice(-148)}` : t;
}

/** A reply, streamed sentence by sentence as separate messages. */
function say(s: Script, from: Record<string, string>, paragraphs: string[]) {
  for (const para of paragraphs) {
    s.wait(900 + Math.min(1800, para.length * 12));
    s.event("message", { ...from, text: para });
  }
}

function answer(world: World, scope: string, q: string, who: Employee | undefined): string[] {
  const n = node(world, scope);
  const name = n?.name ?? scope;
  if (/(make .* public|go public|rename|create a (division|project)|set a budget|budget to|secret|hire )/.test(q)) {
    return ["I cannot do that from here: I can read what is going on, start researching an idea, ask for a change to an app, try stopped work again and change a few settings, each with your yes.", "Making an app public, budgets, secrets, hiring and the shape of the tree are done by a person on their own screens."];
  }
  if (who && /(who are you|what do you do|your job|remember|what do you know)/.test(q)) {
    const memory = world.memory.filter((m) => m.employeeId === who.id && !m.archived).slice(0, 2);
    return [`I'm ${who.name}, the ${who.role.toLowerCase()} for ${name}. ${who.jobDescription.mandate}`, memory.length ? `What I keep in mind: ${memory.map((m) => m.body).join(" ")}` : "Ask me about my work, or tell me what to change."];
  }
  if (/spen|cost|credit|money|budget/.test(q)) {
    const sp = spentBelow(world, scope);
    return [`${name} has spent ${Math.round(sp.ai + sp.hosting)} credits this month: ${Math.round(sp.ai)} on work by the workforce and ${Math.round(sp.hosting)} on keeping apps running.`, "The credits page breaks it down by division, project and app, with the caps set on each."];
  }
  if (/who|working|doing|busy/.test(q)) {
    const busy = world.employees.filter((e) => e.status === "working" && e.scope.startsWith(scope.split("/")[0] ?? scope));
    if (busy.length === 0) return ["Nobody is working right now; everyone is between pieces of work."];
    return [busy.map((e) => `${e.name === "Contractor" ? "A research contractor" : e.name} (${e.role.toLowerCase()}) is working on "${e.currentRun?.title ?? "a piece of work"}".`).join(" ")];
  }
  if (/app|health|running|down|crash/.test(q)) {
    const apps = world.apps.filter((a) => a.path.startsWith(scope));
    const bad = apps.filter((a) => a.health === "down" || a.running === "paused");
    return [`${apps.length} ${apps.length === 1 ? "app is" : "apps are"} under ${name}.`, bad.length ? `${bad.map((a) => `${a.name} is ${a.health === "down" ? "down" : "paused"}`).join("; ")}. Each app's page says why and what restores it.` : "All of them are healthy."];
  }
  if (who) return [`I'm ${who.name}, the ${who.role.toLowerCase()} for ${name}. ${who.jobDescription.mandate}`, "Ask me about my work, or tell me what to change."];
  return [`Here is ${name} at a glance: ${world.nodes.filter((x) => x.path.startsWith(`${scope}/`) && x.level === "project").length} projects and ${world.apps.filter((a) => a.path.startsWith(scope)).length} apps.`, "Ask me what anyone is working on, what it has cost, or describe an idea and I'll ask to start researching it."];
}

// ---------------------------------------------------------------------------------------------
// A memory review and a request for ideas
// ---------------------------------------------------------------------------------------------


defineScript("review", (world, run) => {
  const p = run.playback?.params ?? {};
  const e = world.employees.find((x) => x.id === p.employeeId);
  const s = new Script();
  s.event("run.started", { holder: "runner-demo-1" });
  s.wait(600);
  cycle(s, run, { agent: "memory-review", employeeId: e?.id ?? null, taskType: "review", credits: 0.03, tool: { name: "read_memory", args: {}, result: "Read the memory." } });
  s.wait(900);
  cycle(s, run, { agent: "memory-review", employeeId: e?.id ?? null, taskType: "review", credits: 0.04 });
  s.effect((w) => {
    const entries = w.memory.filter((m) => m.employeeId === e?.id && !m.archived);
    const at = new Date().toISOString();
    for (const m of entries) m.lastReviewedAt = at;
    w.memoryChanges.unshift({ id: uuidFor(`change:${run.run.id}`), memoryId: entries[0]?.id ?? null, action: "reviewed", by: "review", userId: null, runId: run.run.id, detail: { reviewed: entries.length, merged: 0, removed: 0 }, at });
    return ["Memory", "Employee"];
  });
  s.event("message", { from: e?.name ?? "review", text: `Reviewed ${world.memory.filter((m) => m.employeeId === e?.id && !m.archived).length} entries: nothing repeats, nothing is stale, and nothing needed correcting.` });
  s.wait(200).event("run.finished", { totals: {}, outcome: "succeeded", summary: "The memory was reviewed." });
  return patchTotals(s, run);
});

defineScript("suggest", (_world, run) => {
  const scope = run.run.scope;
  const s = new Script();
  s.event("run.started", { holder: "runner-demo-1" });
  for (let k = 0; k < 3; k += 1) {
    s.wait(900);
    cycle(s, run, { agent: "suggest", employeeId: null, taskType: "research", credits: 0.05, tool: { name: "read_organisation", args: { scope }, result: "Read what the organisation holds." } });
  }
  s.effect((w) => {
    const at = new Date().toISOString();
    const ideas = [
      { title: "Allergen notes on every booking", idea: "Let guests note allergies when they book, and print them on the kitchen ticket.", gap: "Allergies are taken by phone and lost between the booking and the kitchen.", whyUs: "Court booking already holds every booking, and the allergen labels idea already knows the dishes.", reuses: ["Court booking' guest records", "the kitchen ticket printer"] },
      { title: "A course waiting list", idea: "When a course is full, take names and offer the next place automatically.", gap: "Full courses turn people away with no way back in.", whyUs: "Course Notes already knows every course and who is on it.", reuses: ["Course Notes' enrolments", "the organisation's sign-in"] },
      { title: "Weekly stock reorder email", idea: "Every Friday, email the supplier the items below their usual level.", gap: "Reorders are written by hand from the count sheet.", whyUs: "Stock Counter already counts every item weekly.", reuses: ["Stock Counter's counts", "the platform's email service"] },
    ];
    for (const i of ideas) {
      const id = uuidFor(`suggestion:${run.run.id}:${i.title}`);
      if (!w.suggestions.some((x) => x.id === id)) w.suggestions.unshift({ id, scope, runId: run.run.id, status: "open", ideaId: null, createdAt: at, ...i });
    }
    return ["Suggestions"];
  });
  s.event("message", { from: "assistant", text: "Three ideas, each from something the organisation already holds." });
  s.wait(200).event("run.finished", { totals: {}, outcome: "succeeded", summary: "3 ideas suggested." });
  return patchTotals(s, run);
});

/** Start research on an idea (used by the ideas endpoint and by an approved conversation proposal). */
export function startResearch(world: World, ideaId: string, scope: string, text: string, constraints: string[], via: "console" | "conversation" | "suggestion", story: string | null, change: string | null = null) {
  const id = uuidFor(`run:research:${ideaId}:${world.counter++}`);
  const r = startRun(world, { id, kind: "research", title: `Research: ${titleOf(text)}`, scope, ideaId, estimateCredits: 12, employeeId: null, conversationId: null }, "research", { ideaId, story });
  append(world, r, "message", { via, from: "owner", text, change, constraints: constraints.join("\n") });
  append(world, r, "estimate.made", { credits: 12, basis: "research", reason: "The measured starting figure for research runs, used until 3 have finished here to learn from. It can never cost more than 111.09 credits, the most its steps could cost; it is charged at what it actually costs.", ceiling: 111.09 });
  return r;
}
