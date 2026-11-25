import type { Employee } from "@/store/types";
import { storyFor, type Story } from "../world/story";
import { append, defineScript, settle, Script } from "./engine";
import { contractor, ensureNode, hireEmployee, newApp, notify, setStage, startRun } from "./mutations";
import { titleOf } from "./http";
import { appAt, chain, node, orgOf, setting, spentBelow, uuidFor, type DemoRun, type World } from "./world";

/**
 * The scripts runs play, modelled on real run logs captured from a development stack (a research
 * run of 40 events and a build run of 1,457): the same event types, payload fields, milestones
 * and sentences, with invented names and a few hundred mechanics instead of a thousand.
 */

const CHEAP = "deepseek/deepseek-v4.1-flash";
const STRONG = "qwen/qwen3.7-plus";

function callId(run: DemoRun, n: number) {
  return uuidFor(`call:${run.run.id}:${n}`);
}

/** One model call and, when a tool is named, the tool call it asked for. */
function cycle(
  s: Script,
  run: DemoRun,
  o: { agent: string; employeeId: string | null; taskType: string; credits: number; tool?: { name: string; args: Record<string, unknown>; result: string; paths?: string[]; command?: string }; model?: string; billable?: boolean; scope?: string },
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
  if (!o.tool) return;
  const toolCall = `call_${id.slice(0, 8)}`;
  s.wait(60);
  s.event("tool.requested", { name: o.tool.name, step: s.steps.length, agent: o.agent, callId: toolCall, arguments: JSON.stringify(o.tool.args) });
  s.wait(30);
  const reading = /^(read_file|list_files|search|git_diff|web_search|read_page|notes|load_skill|read_organisation|check_preview)$/.test(o.tool.name);
  s.event("tool.permitted", { name: o.tool.name, rule: reading ? "default:read-only" : o.tool.name === "run" ? "stage:build:allow run(make *)" : "default:workspace-write", agent: o.agent, paths: o.tool.paths ?? [], callId: toolCall, reason: reading ? "Reading is allowed." : "Writing inside the workspace is allowed.", command: o.tool.command ?? null });
  s.wait(250 + (call % 4) * 120);
  s.event("tool.result", { name: o.tool.name, agent: o.agent, callId: toolCall, edited: !reading, content: o.tool.result, credits: 0, isError: false, verified: o.tool.name === "run", errorKind: null, failureKey: null });
}

function working(world: World, employeeId: string | null, run: DemoRun) {
  const e = employeeId ? world.employees.find((x) => x.id === employeeId) : undefined;
  if (!e || e.status === "paused") return;
  e.status = "working";
  e.currentRun = { id: run.run.id, title: run.run.title };
  e.lastActiveAt = new Date().toISOString();
  world.changed.push("Tree", "Employee");
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
// Research: three contractors, a judge, a verdict
// ---------------------------------------------------------------------------------------------

defineScript("research", (world, run) => {
  const p = run.playback?.params ?? {};
  const idea = world.ideas.find((i) => i.id === p.ideaId);
  const story = storyFor(idea?.text ?? "", typeof p.story === "string" ? p.story : null);
  const org = orgOf(run.run.scope);
  const s = new Script();
  const researcherKey = `${org}:researcher`;
  let researcher = employeeAt(world, run.run.scope, "Market researcher");
  s.event("run.started", { holder: "runner-demo-1" });
  s.wait(400).event("message", { data: { autonomy: setting(world, run.run.scope, "autonomy")?.value ?? "auto", estimate: run.run.estimateCredits, headroom: 4200 }, kind: "workflow.step", step: "estimate.gate", agent: "workflow" });
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
  const title = outcome === "build" ? "Verdict: build" : outcome === "change" ? "Verdict: change it" : "Verdict: do not build";
  const tail = outcome === "do-not-build" ? " Nothing will be built unless you overrule it." : outcome === "change" ? " Change it, or build it as described." : " Build it when you are ready.";
  s.event("message", { from: "researcher", text: `${story.headline}.${tail}`, title, milestone: "verdict" });
  s.wait(200).event("estimate.scored", { ratio: 0.42, modelCalls: 14, actualCredits: 0, expectedCredits: run.run.estimateCredits ?? 12, nonBillableCredits: 0 });
  s.event("run.finished", { totals: { credits: 0, modelCalls: 14, nonBillableCredits: 0 }, outcome: "succeeded", summary: "Research finished; the verdict waits for your decision." }, "research:finished");
  return patchTotals(s, run);
});

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
// Build: placement, hires, the plan, each part built and checked, review, publish
// ---------------------------------------------------------------------------------------------

defineScript("build", (world, run) => {
  const p = run.playback?.params ?? {};
  const idea = world.ideas.find((i) => i.id === p.ideaId);
  const existingProject = world.nodes.find((n) => n.ideaId === idea?.id && n.level === "project");
  const base: Story = storyFor(idea?.text ?? "", typeof p.story === "string" ? p.story : null);
  const story: Story = existingProject ? { ...base, name: existingProject.name } : base;
  const fail = p.fail === true;
  const org = orgOf(run.run.scope);
  const divisionPath = existingProject ? existingProject.path.split("/").slice(0, 2).join("/") : `${org}/${story.division.slug}`;
  const projectPath = existingProject?.path ?? `${divisionPath}/${story.project}`;
  const appPath = `${projectPath}/web`;
  // What stood before this run: the script is rebuilt from the world, which its own placement changes.
  const before = (n: { createdAt: string } | undefined) => !!n && n.createdAt < run.run.createdAt;
  const divisionExists = before(node(world, divisionPath));
  const s = new Script();
  const eng = { key: `${projectPath}:engineer`, name: pick(["Arlo", "Juniper", "Felix", "Rosa"], projectPath), role: "Software engineer" };
  const qa = { key: `${projectPath}:qa`, name: pick(["Bea", "Otto", "Nell", "Ivo"], projectPath), role: "QA engineer" };
  const lead = { key: `${divisionPath}:lead`, name: pick(["Sol", "Maren", "Ezra"], divisionPath), role: "Division lead" };
  const engId = uuidFor(`employee:${eng.key}`);
  const qaId = uuidFor(`employee:${qa.key}`);
  const checkpointPlan = setting(world, projectPath, "checkpoint.plan")?.value === "true" && setting(world, projectPath, "autonomy")?.value === "checkpoints";

  s.event("run.started", { holder: "runner-demo-1" });
  s.wait(300).event("estimate.made", { basis: "the starting figure for build runs (fewer than 3 finished runs to learn from)", stage: "start", source: "runner", credits: 120, samples: 0 });
  s.wait(200).event("message", { data: { autonomy: setting(world, projectPath, "autonomy")?.value ?? "auto", estimate: 120, headroom: 4200 }, kind: "workflow.step", step: "estimate.gate", agent: "workflow" });
  s.wait(500).event("message", {
    from: "builder",
    text: divisionExists || before(existingProject) ? `${story.name} will live in ${node(world, divisionPath)?.name ?? story.division.name}, as the project ${story.name}.` : `${story.name} will live in a new division, ${story.division.name}, as the project ${story.name}.`,
    title: "Placed",
    milestone: "placed",
  });
  s.effect((w) => {
    ensureNode(w, divisionPath, story.division.name);
    ensureNode(w, projectPath, story.name, { stage: "planning", ideaId: idea?.id ?? null });
    ensureNode(w, appPath, story.name);
    setStage(w, projectPath, "planning", null);
    newApp(w, appPath, story.name);
    const r = w.runs.find((x) => x.run.id === run.run.id);
    if (r) r.run.scope = projectPath;
    if (idea) {
      const i = w.ideas.find((x) => x.id === idea.id);
      if (i) i.scope = projectPath;
    }
    return ["Tree", "App", "Ontology"];
  }, "build:placed");
  s.event("message", { data: { name: story.name, appId: uuidFor(`app:${appPath}`), appPath, division: divisionPath, projectPath, divisionCreated: !divisionExists }, kind: "workflow.step", step: "placement", agent: "workflow" });
  const hires: { who: { key: string; name: string; role: string }; scope: string; limit: number; reason: string; step: string }[] = [];
  if (!divisionExists) hires.push({ who: lead, scope: divisionPath, limit: 100, reason: "A new division was created for this work, and every division has someone answerable for it.", step: `hire:division:${divisionPath}` });
  hires.push({ who: eng, scope: projectPath, limit: 1500, reason: `${story.name} is entering its build, and somebody must build and maintain it.`, step: `hire:stage:build:${projectPath}` });
  hires.push({ who: qa, scope: projectPath, limit: 600, reason: `${story.name} is entering evaluation, and the person who checks the work must not be the one who did it.`, step: `hire:stage:evaluate:${projectPath}` });
  for (const h of hires) {
    s.wait(400).event("message", { data: { name: h.who.name, role: h.who.role, status: "accepted", employeeId: uuidFor(`employee:${h.who.key}`) }, kind: "workflow.step", step: h.step, agent: "workflow" });
    s.effect((w) => {
      hireEmployee(w, { key: h.who.key, name: h.who.name, role: h.who.role, scope: h.scope, limit: h.limit, mandate: h.who.role === "Software engineer" ? `Build and maintain ${story.name}.` : h.who.role === "QA engineer" ? `Check ${story.name}'s work against its plan, sceptically, before it ships.` : `Answer for ${story.division.name}: its people, its budget and its work.`, reason: h.reason, trigger: h.step.startsWith("hire:division") ? "division" : "stage", runId: run.run.id });
    });
    s.event("message", { from: "runner", text: `${h.who.name} joins as a ${h.who.role.toLowerCase()}, at up to ${h.limit} credits a month: ${h.reason}`, title: `Hired ${h.who.name}`, milestone: h.step.replace(/^hire:/, "hired:") });
  }
  s.mark("build:hired");

  // The plan ----------------------------------------------------------------------------------
  s.wait(500).event("message", { kind: "agent.start", task: `Plan the app described below. It starts from the app kit's template (the Notes example), which it replaces.\n\nThe idea:\n${idea?.text ?? story.name}`, agent: "planner" });
  s.effect((w) => working(w, engId, run));
  for (const [file, result] of [
    ["AGENTS.md", "# AGENTS.md — how this app is built\n\nOne Endgame app: a .NET API that serves its own React front end, as one container."],
    ["docs/app.md", "# The app\n\nThe template's Notes example: a signed-in person keeps notes."],
    ["api/Notes/NotesEndpoints.cs", "public static class NotesEndpoints { … }"],
  ] as const) {
    s.wait(400);
    cycle(s, run, { agent: "planner", employeeId: engId, taskType: "plan", credits: 0.031, tool: { name: "read_file", args: { path: file }, result, paths: [file] }, scope: projectPath });
  }
  const items = story.plan.items.map((i) => ({ id: i.id, text: i.text, detail: i.detail, check: i.check, covers: i.covers }));
  s.wait(1200).event("plan.proposed", { agent: "planner", summary: story.plan.summary, items, requirements: story.plan.requirements, leftOut: story.plan.leftOut }, "build:plan");
  s.effect((w) => setStage(w, projectPath, "planning", null));
  s.event("message", { kind: "agent.reply", agent: "planner", final: true, reply: `${story.plan.items.length}-item plan: ${story.plan.summary}` });
  s.event("message", { from: "builder", title: "The plan", text: `${story.plan.items.length} parts: ${story.plan.summary}`, milestone: "plan" });
  if (checkpointPlan) {
    s.approval({ title: `Agree the plan for ${story.name}?`, detail: `${story.plan.items.length} parts, about 90 credits. ${story.plan.summary}`, onApprove: { kind: "continue" } }, "build:waiting-on-plan");
    s.wait(200).event("plan.accepted", { by: "owner", items, summary: story.plan.summary, requirements: story.plan.requirements, leftOut: story.plan.leftOut });
  } else {
    s.wait(300).event("plan.accepted", { by: "auto-mode", items, summary: story.plan.summary, requirements: story.plan.requirements, leftOut: story.plan.leftOut });
  }
  s.event("message", { data: { items: items.map((i) => ({ id: i.id, check: i.check, deliverable: i.detail })) }, kind: "workflow.step", step: "plan", agent: "workflow" });
  s.wait(200).event("estimate.made", { basis: `the starting figure for build runs (fewer than 3 finished runs to learn from), scaled to a plan of ${items.length} items`, stage: "plan", source: "runner", credits: 90, samples: 0 });
  s.event("message", { data: { credits: 90 }, kind: "workflow.step", step: "estimate.plan", agent: "workflow" });
  s.effect((w) => {
    const r = w.runs.find((x) => x.run.id === run.run.id);
    if (r) r.run.estimateCredits = 90;
    setStage(w, projectPath, "building", null);
    for (const i of items) {
      const id = uuidFor(`task:${run.run.id}:${i.id}`);
      if (!w.tasks.some((t) => t.id === id)) {
        const at = new Date().toISOString();
        w.tasks.unshift({ id, scope: projectPath, runId: run.run.id, parentTaskId: null, title: i.text, description: i.detail, status: "todo", holderRunId: null, holderEmployeeId: null, employeeId: null, claimedAt: null, estimateCredits: 30, actualCredits: null, dependsOn: [], createdAt: at, updatedAt: at });
      }
    }
    return ["Tasks", "Tree"];
  });
  for (const i of items) s.event("task.created", { taskId: uuidFor(`task:${run.run.id}:${i.id}`), title: i.text });

  // Each part ---------------------------------------------------------------------------------
  const sentBack = story.sentBack;
  items.forEach((item, index) => {
    const taskId = uuidFor(`task:${run.run.id}:${item.id}`);
    const builder = `builder-${item.id}-0`;
    s.wait(600).event("message", { kind: "agent.start", task: `Build this one feature of the plan, completely, then commit it.\n\nThe feature: [${item.id}] ${item.detail}\nIt will be checked by: ${item.check}`, agent: builder, taskType: "build" }, `build:part-${index + 1}`);
    s.event("task.claimed", { taskId, holder: eng.name, summary: item.text });
    s.effect((w) => {
      const t = w.tasks.find((x) => x.id === taskId);
      if (t) Object.assign(t, { status: "in_progress", holderRunId: run.run.id, holderEmployeeId: engId, employeeId: engId, claimedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      working(w, engId, run);
      return ["Tasks"];
    });
    const files = item.detail.match(/[\w./-]+\.(cs|tsx?|md)/g)?.slice(0, 4) ?? ["src/App.tsx"];
    for (const f of files) {
      s.wait(500);
      cycle(s, run, { agent: builder, employeeId: engId, taskType: "build", credits: 0.024, tool: { name: "read_file", args: { path: f }, result: `    1\t// ${f}`, paths: [f] }, scope: projectPath });
      s.wait(400);
      cycle(s, run, { agent: builder, employeeId: engId, taskType: "build", credits: 0.041, tool: { name: "edit_file", args: { path: f }, result: `Edited ${f}.`, paths: [f] }, scope: projectPath });
    }
    s.wait(500);
    cycle(s, run, { agent: builder, employeeId: engId, taskType: "build", credits: 0.036, tool: { name: "run", args: { command: "make test" }, result: "Vitest 17 passed · xUnit 14 passed\nexit code 0", command: "make test" }, scope: projectPath });
    cycle(s, run, { agent: builder, employeeId: engId, taskType: "build", credits: 0.028, tool: { name: "git_commit", args: { message: `${item.id}: ${item.text.slice(0, 50)}` }, result: `Committed ${uuidFor(`${item.id}`).slice(0, 7)}.` }, scope: projectPath });
    s.event("message", { kind: "agent.reply", agent: builder, final: true, reply: `Done — the ${item.id} item is built, verified and committed.` });

    const evaluator = `evaluator-${item.id}-0`;
    s.wait(600).event("message", { kind: "agent.start", task: "Evaluate the item now (round 0, built on build).", agent: evaluator, taskType: "evaluate" });
    s.effect((w) => working(w, qaId, run));
    s.wait(400);
    cycle(s, run, { agent: evaluator, employeeId: qaId, taskType: "evaluate", credits: 0.05, tool: { name: "git_diff", args: {}, result: `${files.length} files changed` }, scope: projectPath });
    cycle(s, run, { agent: evaluator, employeeId: qaId, taskType: "evaluate", credits: 0.06, tool: { name: "run", args: { command: "make test", timeout_seconds: 600 }, result: "exit code 0", command: "make test" }, scope: projectPath });
    const failsHere = (sentBack && sentBack.item === item.id) || (fail && index === items.length - 1);
    if (failsHere) {
      const fault = sentBack?.item === item.id ? sentBack : { item: item.id, fault: "The check named in the plan does not pass.", evidence: "make test fails: 2 of 17 Vitest tests fail on the empty state." };
      cycle(s, run, { agent: evaluator, employeeId: qaId, taskType: "evaluate", credits: 0.07, tool: { name: "check_preview", args: { path: "" }, result: fault.evidence }, scope: projectPath });
      s.event("evaluation.failed", { item: item.id, text: item.text, tier: "build", round: 0, faults: [fault.fault], evidence: fault.evidence, summary: `Sent back: ${fault.fault}` }, "build:sent-back");
      s.event("message", { data: { faults: [fault.fault], passed: false, evidence: fault.evidence }, kind: "workflow.step", step: `item:${item.id}:round:0`, agent: "workflow" });
      s.event("message", { from: "evaluator", text: `${qa.name} sent part ${index + 1} back: ${fault.fault} It is being repaired on a stronger model, at no charge.`, title: "Sent back" });
      const repair = `builder-${item.id}-1`;
      s.wait(700).event("message", { kind: "agent.start", task: `Repair this item (round 1). The evaluator found: ${fault.fault}`, agent: repair, taskType: "build" });
      for (let k = 0; k < 3; k += 1) {
        s.wait(500);
        cycle(s, run, { agent: repair, employeeId: engId, taskType: "build", credits: 0.11, model: STRONG, billable: false, tool: { name: k === 2 ? "run" : "edit_file", args: k === 2 ? { command: "make test" } : { path: files[0] ?? "src/App.tsx" }, result: k === 2 ? "exit code 0" : "Edited.", paths: files.slice(0, 1) }, scope: projectPath });
      }
      s.effect((w) => {
        const nc = (w.notCharged[org] ??= { credits: 0, repairs: 0 });
        nc.repairs += 1;
        const tr = w.trackRecords.find((t) => t.employeeId === engId);
        if (tr) {
          tr.work.sentBack += 1;
          tr.repairsNotCharged.calls += 3;
          tr.repairsNotCharged.credits += 0.33;
        }
        return ["Credits", "Employee"];
      });
      if (fail) {
        s.wait(800);
        cycle(s, run, { agent: `evaluator-${item.id}-1`, employeeId: qaId, taskType: "evaluate", credits: 0.06, tool: { name: "run", args: { command: "make test" }, result: "exit code 1" }, scope: projectPath });
        s.event("evaluation.failed", { item: item.id, text: item.text, tier: "build", round: 1, faults: [fault.fault], evidence: "The repair did not pass either: the same 2 tests fail.", summary: "Sent back again: the repair did not fix it." });
        s.event("task.failed", { taskId, reason: "It did not pass its check after a repair." });
        s.effect((w) => {
          const t = w.tasks.find((x) => x.id === taskId);
          if (t) t.status = "failed";
          setStage(w, projectPath, "paused", "The build stopped: one part did not pass its check after a repair.");
          const a = appAt(w, appPath);
          if (a) Object.assign(a, { status: "draft", running: "paused", health: "unknown", healthSummary: "Never published: the build did not succeed." });
          return ["Tasks", "Tree", "App"];
        });
        s.event("run.finished", { totals: {}, outcome: "failed", summary: `The build of ${story.name} stopped: part ${index + 1} did not pass its check after a repair, and nothing was published.` }, "build:failed");
        return;
      }
      s.wait(600);
      cycle(s, run, { agent: `evaluator-${item.id}-1`, employeeId: qaId, taskType: "evaluate", credits: 0.06, tool: { name: "run", args: { command: "make test" }, result: "exit code 0" }, scope: projectPath });
      s.event("evaluation.passed", { item: item.id, text: item.text, tier: "build", round: 1, faults: [], evidence: "Re-checked after the repair: the button clears the footer at 375 pixels and works; make test and make lint pass.", summary: "Repaired and passed." }, "build:repaired");
    } else {
      s.wait(500);
      s.event("evaluation.passed", { item: item.id, text: item.text, tier: "build", round: 0, faults: [], evidence: `${item.check} — confirmed: make test and make lint exit 0.`, summary: "Checked and passed." });
    }
    s.event("message", { data: { passed: true }, kind: "workflow.step", step: `item:${item.id}`, agent: "workflow" });
    s.event("task.done", { taskId, summary: "Built, checked and committed." });
    s.effect((w) => {
      const t = w.tasks.find((x) => x.id === taskId);
      if (t) Object.assign(t, { status: "done", holderRunId: null, holderEmployeeId: null, actualCredits: 4.2, updatedAt: new Date().toISOString() });
      const tr = w.trackRecords.find((x) => x.employeeId === engId);
      if (tr) tr.work.accepted += 1;
      const q = w.trackRecords.find((x) => x.employeeId === qaId);
      if (q) q.work.judged += 1;
      setStage(w, projectPath, index === items.length - 1 ? "evaluating" : "building", null);
      return ["Tasks", "Employee"];
    });
  });
  if (fail) return patchTotals(s, run);

  // Security review ---------------------------------------------------------------------------
  const reviewer = world.employees.find((e) => orgOf(e.scope) === org && e.standing === "security-reviewer");
  s.wait(700).event("message", { kind: "agent.start", task: "Review the app now against your checklist, then reply with the JSON object.", agent: "security-reviewer-0", taskType: "evaluate" }, "build:security-review");
  s.effect((w) => {
    setStage(w, projectPath, "reviewing", null);
    working(w, reviewer?.id ?? null, run);
  });
  for (const f of ["api/Program.cs", "api/Books/BooksEndpoints.cs", "web/src/App.tsx"]) {
    s.wait(400);
    cycle(s, run, { agent: "security-reviewer-0", employeeId: reviewer?.id ?? null, taskType: "evaluate", credits: 0.045, tool: { name: "read_file", args: { path: f }, result: `    1\t// ${f}`, paths: [f] }, scope: projectPath });
  }
  const finding = story.finding;
  if (finding) {
    s.event("message", { from: "security-reviewer", kind: "security.review", passed: false, findings: [finding] });
    s.event("message", { from: "security-reviewer", text: "The security review found 1 problem that would block publishing; they are being fixed now, at no charge.", title: "Security review found problems", milestone: "security:0" }, "build:security-finding");
    s.effect((w) => {
      notify(w, { key: `security:${run.run.id}`, kind: "security.finding", severity: "urgent", title: "The security review found 1 problem", detail: `In "${run.run.title}". Publishing waits until they are fixed.`, scope: projectPath, subject: { kind: "run", id: run.run.id } });
    });
    s.wait(600).event("message", { kind: "agent.start", task: `The security review found problems that block publishing. Fix each one, verify with make lint and make test, and commit.\n\n${JSON.stringify([finding])}`, agent: "builder-security-repair" });
    for (let k = 0; k < 3; k += 1) {
      s.wait(500);
      cycle(s, run, { agent: "builder-security-repair", employeeId: engId, taskType: "build", credits: 0.09, billable: false, tool: { name: k === 2 ? "run" : "edit_file", args: k === 2 ? { command: "make test" } : { path: finding.file }, result: k === 2 ? "exit code 0" : `Edited ${finding.file}.`, paths: [finding.file] }, scope: projectPath });
    }
    s.wait(700).event("message", { kind: "agent.start", task: "Review the app now against your checklist, then reply with the JSON object.", agent: "security-reviewer-1", taskType: "evaluate" });
    cycle(s, run, { agent: "security-reviewer-1", employeeId: reviewer?.id ?? null, taskType: "evaluate", credits: 0.05, tool: { name: "read_file", args: { path: finding.file }, result: "    94\t… b.Id == id && b.AddedById == user.Id …", paths: [finding.file] }, scope: projectPath });
  }
  s.event("message", { from: "security-reviewer", kind: "security.review", passed: true, findings: [] });
  s.event("message", { from: "security-reviewer", text: "The security review checked secrets, sign-in, data, model calls and outbound calls, and found nothing that blocks publishing.", title: "Security review passed", milestone: finding ? "security:1" : "security:0" }, "build:security-passed");

  // Publish -----------------------------------------------------------------------------------
  const commit = uuidFor(`commit:${appPath}`).replace(/-/g, "").slice(0, 40).padEnd(40, "0");
  s.wait(1500).event("message", { data: { image: `app-${uuidFor(`app:${appPath}`)}:${commit}`, state: "running", commit, started: true, visibility: "private" }, kind: "workflow.step", step: "publish", agent: "workflow" });
  s.effect((w) => {
    setStage(w, projectPath, "publishing", null);
    const a = appAt(w, appPath);
    if (a) Object.assign(a, { status: "running", running: "awake", health: "healthy", healthSummary: "Running; nothing measured yet.", version: commit, publishedAt: new Date().toISOString() });
    const versions = (w.versions[uuidFor(`app:${appPath}`)] ??= []);
    for (const v of versions) v.live = false;
    const by = w.employees.find((e) => e.id === engId);
    versions.unshift({ commit, message: "Security fix: a member changes only their own books", at: new Date().toISOString(), author: { kind: "employee", id: engId, name: by?.name ?? eng.name }, live: true });
    for (const i of items.slice().reverse()) versions.push({ commit: uuidFor(`commit:${i.id}`).replace(/-/g, "").slice(0, 40), message: i.text, at: new Date().toISOString(), author: { kind: "employee", id: engId, name: eng.name }, live: false });
    return ["App", "Versions", "Tree"];
  });
  s.event("message", { from: "builder", text: `${story.name} is built and running privately at /${appPath}/. Only you and the people you choose can open it until you make it public.`, title: "Running privately", milestone: "published" }, "build:published");
  s.effect((w) => {
    setStage(w, projectPath, "live", null);
    for (const id of [engId, qaId, reviewer?.id]) if (id) settle(w, id, run.run.id);
    const i = idea ? w.ideas.find((x) => x.id === idea.id) : undefined;
    if (i) i.scope = projectPath;
    return ["Tree", "App"];
  });
  s.wait(300).event("estimate.scored", { ratio: 0, modelCalls: 0, actualCredits: 0, expectedCredits: 90, nonBillableCredits: 0 });
  s.event("run.finished", { totals: {}, outcome: "succeeded", summary: `${story.name} is built and running privately.` }, "build:finished");
  return patchTotals(s, run);
});

function pick(names: string[], seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return names[h % names.length] ?? names[0] ?? "Ada";
}

// ---------------------------------------------------------------------------------------------
// A conversation turn: a streamed reply, and proposals that raise an approval
// ---------------------------------------------------------------------------------------------

defineScript("conversation", (world, run) => {
  const p = run.playback?.params ?? {};
  const text = String(p.text ?? "");
  const scope = run.run.scope;
  const s = new Script();
  const who = typeof p.employeeId === "string" ? world.employees.find((e) => e.id === p.employeeId) : undefined;
  const from = who?.name ?? "assistant";
  s.event("run.started", { holder: "runner-demo-1" });
  s.wait(500);
  cycle(s, run, { agent: "conversation", employeeId: who?.id ?? null, taskType: "conversation", credits: 0.012, tool: { name: "read_organisation", args: { scope }, result: `${node(world, scope)?.name ?? scope}: read.` } });
  s.wait(400);
  cycle(s, run, { agent: "conversation", employeeId: who?.id ?? null, taskType: "conversation", credits: 0.018 });
  const lower = text.toLowerCase();
  const settingAsk = /(checkpoint|autonomy|always[- ]on|sleep|idle)/.test(lower);
  const ideaAsk = !settingAsk && /(idea|build|make (us |me )?an? |could we|new app|we need an? )/.test(lower);
  if (ideaAsk) {
    const ideaText = text.replace(/^(please|can you|could you|could we|let'?s)\s+/i, "").replace(/^(build|make|start)\s+(us\s+|me\s+)?/i, "");
    say(s, from, ["That sounds worth looking into. Before anything is built, research checks who already does it, what they leave undone and whether people would pay.", "I have asked to start researching it; it needs your yes first."]);
    s.approval(
      {
        title: `Start researching an idea: ${clip(ideaText)}?`,
        detail: `start_idea: ${ideaText}. No rule allows start_idea here. Checkpoint: start_idea.`,
        onApprove: { kind: "start-idea", text: ideaText.charAt(0).toUpperCase() + ideaText.slice(1), scope: scope.split("/").slice(0, 2).join("/") },
      },
      "conversation:approval",
    );
    s.wait(400).effect(() => undefined);
    if (p.answer === "rejected") say(s, from, ["Understood — I have not started it. Say the word if you change your mind."]);
    else if (p.answer === "approved") say(s, from, ["Research has started. You will see it on the org chart, and the verdict will wait for you there."]);
  } else if (settingAsk) {
    const always = /always[- ]on/.test(lower);
    const key = always ? "sleep.mode" : /checkpoint/.test(lower) ? "checkpoint.plan" : /idle/.test(lower) ? "sleep.idle_minutes" : "autonomy";
    const value = always ? "always_on" : key === "checkpoint.plan" ? "true" : key === "sleep.idle_minutes" ? "30" : "checkpoints";
    say(s, from, [`I can change that for ${node(world, scope)?.name ?? scope}: ${key} to ${value}. A setting changes only with your yes.`]);
    s.approval({ title: "Change a setting for this part of the organisation?", detail: `adjust_setting: ${key}=${value}. No rule allows adjust_setting here. Checkpoint: adjust_setting.`, onApprove: { kind: "setting", key, value, scope } }, "conversation:approval");
    s.wait(400).effect(() => undefined);
    if (p.answer === "rejected") say(s, from, ["Left as it was."]);
    else if (p.answer === "approved") say(s, from, ["Done. The change applies here and to everything beneath it that does not set its own."]);
  } else {
    say(s, from, answer(world, scope, lower, who));
  }
  s.wait(300).event("run.finished", { totals: {}, outcome: "succeeded", summary: "Replied." }, "conversation:replied");
  return patchTotals(s, run);
});

function clip(t: string) {
  return t.length > 300 ? `${t.slice(0, 148)} … ${t.slice(-148)}` : t;
}

/** A reply, streamed sentence by sentence as separate messages. */
function say(s: Script, from: string, paragraphs: string[]) {
  for (const para of paragraphs) {
    s.wait(900 + Math.min(1800, para.length * 12));
    s.event("message", { from, text: para });
  }
}

function answer(world: World, scope: string, q: string, who: Employee | undefined): string[] {
  const n = node(world, scope);
  const name = n?.name ?? scope;
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
