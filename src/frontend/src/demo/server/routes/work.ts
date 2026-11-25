import type { DecisionChoice, Idea } from "@/store/types";
import { append } from "../engine";
import { homeOrganisation, me, requireRole, scopeOf } from "../access";
import { area, conflict, created, invalid, notFound, num, ok, problem, Refusal, str, strings, titleOf } from "../http";
import { setStage, startRun } from "../mutations";
import { startResearch } from "../scripts";
import { appView, ideaView } from "../views";
import { node, newId, orgOf, runRecord, setting, uuidFor, type World } from "../world";
import { storyFor } from "../../world/story";

/** `WorkEndpoints.cs`: ideas and decisions, runs and their controls, approvals, tasks, apps, conversations. */

const ESTIMATE_BASIS = "The measured starting figure for research runs, used until 3 have finished here to learn from. It can never cost more than 111.09 credits, the most its steps could cost; it is charged at what it actually costs.";

function findIdea(world: World, id: string): Idea {
  const i = world.ideas.find((x) => x.id === id);
  if (!i) throw notFound("The idea");
  return i;
}

function ideaScope(world: World, i: Idea): string {
  return i.scope ?? runRecord(world, i.runId)?.run.scope ?? "";
}

export function answerApproval(world: World, approvalId: string, decision: "approve" | "reject", by: string, note: string | null = null) {
  const a = world.approvals.find((x) => x.id === approvalId);
  if (!a) throw notFound("The approval");
  if (a.answer) throw conflict(`This approval was already ${a.answer}.`);
  const r = runRecord(world, a.runId);
  a.answer = decision === "approve" ? "approved" : "rejected";
  if (r) {
    append(world, r, "approval.answered", { approvalId: a.id, answer: a.answer, comment: note, by });
    if (!world.approvals.some((x) => x.runId === r.run.id && x.answer === null) && r.run.status === "waiting") r.run.status = "running";
    if (r.playback) r.playback.params = { ...r.playback.params, answer: a.answer };
  }
  if (a.answer === "approved") {
    const act = a.onApprove;
    if (act.kind === "start-idea") createIdea(world, act.text, [], act.scope, "conversation");
    if (act.kind === "setting") {
      const key = act.key === "sleep.mode" ? "sleep.mode" : act.key;
      world.settings = world.settings.filter((s) => !(s.path === act.scope && s.key === key));
      world.settings.push({ path: act.scope, key, value: act.value });
      world.changed.push("Autonomy", "App");
    }
  }
  world.changed.push("Tree", "Run", "Notifications");
}

export function createIdea(world: World, text: string, constraints: string[], scope: string, via: "console" | "conversation" | "suggestion"): Idea {
  const id = newId(world, "idea");
  const story = storyFor(text);
  const idea: Idea = {
    id,
    title: titleOf(text),
    text,
    constraints,
    status: "researching",
    runId: "",
    scope: null,
    research: { estimatedCredits: 12, spentCredits: 0, by: null },
    verdict: null,
    decision: null,
    record: { total: 0, build: 0, change: 0, doNotBuild: 0, overruled: [] },
    redLine: null,
  };
  world.ideas.push(idea);
  // The idea shows on the chart as a project being researched, in the division research suggests.
  const org = orgOf(scope);
  const division = scope.includes("/") ? scope : `${org}/${story.division.slug}`;
  if (!node(world, division)) world.nodes.push({ id: uuidFor(`node:${division}`), path: division, slug: division.split("/")[1] ?? "studio", name: story.division.name, level: "division", createdAt: new Date().toISOString(), stage: null, ideaId: null, note: null });
  let project = `${division}/${story.project}`;
  if (node(world, project)) project = `${project}-${world.counter}`;
  world.nodes.push({ id: uuidFor(`node:${project}`), path: project, slug: project.split("/").pop() ?? story.project, name: story.name, level: "project", createdAt: new Date().toISOString(), stage: "researching", ideaId: id, note: "Research is under way." });
  const r = startResearch(world, id, scope, text, constraints, via, null);
  idea.runId = r.run.id;
  world.changed.push("Tree", "Credits", "Idea");
  return idea;
}

area("WorkEndpoints", {
  "POST ideas/estimate": (req, { world }) => {
    me(world);
    const scope = str(req.body, "scope");
    if (scope) requireRole(world, scopeOf(world, scope), "viewer");
    if (!(str(req.body, "text") ?? "").trim()) throw invalid("Describe the idea first; the estimate depends on it.");
    return ok({ credits: 12, basis: ESTIMATE_BASIS });
  },

  "POST ideas": (req, { world }) => {
    const u = me(world);
    const given = str(req.body, "scope");
    const home = homeOrganisation(world, u.id);
    if (!given && !home) throw new Refusal(problem(409, "no_organisation", "Name your organisation first", "An idea belongs to an organisation; create it, then describe the idea."));
    const scope = scopeOf(world, given ?? home);
    requireRole(world, scope, "builder");
    const text = (str(req.body, "text") ?? "").trim();
    if (!text) throw invalid("Describe the idea first; the estimate depends on it.");
    if (scope.split("/").length > 2) throw invalid("An idea is proposed to the organisation or to a division; placement into a project comes after the verdict.");
    const constraints = strings(req.body, "constraints");
    if (text.length > 20000 || constraints.join("\n").length > 20000) throw invalid("Describe the idea in 1 to 20000 characters; constraints up to the same.");
    return created(ideaView(world, createIdea(world, text, constraints, scope, "console")));
  },

  "GET ideas/{id}": (req, { world }) => {
    const i = findIdea(world, req.params.id ?? "");
    requireRole(world, ideaScope(world, i), "viewer");
    return ok(ideaView(world, i));
  },

  "POST ideas/{id}/decision": (req, { world }) => {
    const choice = str(req.body, "choice") as DecisionChoice | undefined;
    const i = findIdea(world, req.params.id ?? "");
    const scope = ideaScope(world, i);
    requireRole(world, scope, "builder");
    if (!choice || !["build", "change", "overrule", "drop"].includes(choice)) throw invalid("A decision is one of build, change, overrule, drop.");
    if (i.status !== "verdict" || !i.verdict) throw conflict(`The idea is ${i.status === "verdict" ? "awaiting_decision" : i.status}; a decision follows a verdict.`);
    if (i.redLine && (choice === "build" || choice === "overrule"))
      throw new Refusal(problem(403, "red_line", "This idea crosses a red line", `The research found it crosses a red line (${i.redLine}). FrostAura never builds it, and no one can overrule that. Change the idea, or drop it.`, { redLine: i.redLine }));
    const verdict = i.verdict.outcome;
    if (choice === "build" && verdict === "do-not-build") throw conflict("The verdict was 'do not build'. Building over it takes an explicit overrule, which the project keeps on record.");
    if (choice === "overrule" && verdict !== "do-not-build") throw conflict(`There is nothing to overrule: the verdict was '${verdict}'.`);
    const u = me(world);
    const note = str(req.body, "note") ?? null;
    const at = new Date().toISOString();
    const project = world.nodes.find((n) => n.ideaId === i.id && n.level === "project");
    if (choice === "build" || choice === "overrule") {
      const runId = newId(world, "run");
      const r = startRun(world, { id: runId, kind: "build", title: `Build: ${titleOf(i.text)}`, scope: project?.path ?? scope, ideaId: i.id, estimateCredits: 120, employeeId: null, conversationId: null }, "build", { ideaId: i.id });
      append(world, r, "message", { from: "owner", text: i.text, constraints: i.constraints.join("\n"), verdict, overruled: choice === "overrule", note, decidedBy: "person" });
      i.status = "decided";
      i.decision = { choice, at, by: u.displayName, overruled: choice === "overrule", runId, via: "person" };
      if (project) setStage(world, project.path, "planning", null);
    } else if (choice === "change") {
      i.status = "researching";
      i.verdict = null;
      i.redLine = null;
      const text = note ? `${i.text}\n\nThe change: ${note}` : i.text;
      const r = startResearch(world, i.id, orgOf(scope) === scope ? scope : scope.split("/").slice(0, 2).join("/"), text, i.constraints, "console", null, note);
      i.runId = r.run.id;
      i.decision = null;
      if (project) setStage(world, project.path, "researching", "Research is under way.");
    } else {
      i.status = "decided";
      i.decision = { choice, at, by: u.displayName, overruled: false, runId: null, via: "person" };
      if (project) setStage(world, project.path, "dropped", "Dropped.");
    }
    world.notifications = world.notifications.map((n) => (n.subject?.id === i.id ? { ...n, read: true } : n));
    world.changed.push("Idea", "Tree", "Credits", "Notifications");
    return ok(ideaView(world, i));
  },

  "GET runs/{id}": (req, { world }) => {
    const r = runRecord(world, req.params.id ?? "");
    if (!r) throw notFound("The run");
    requireRole(world, r.run.scope, "viewer");
    return ok(r.run);
  },

  "POST runs/{id}/{action}": (req, { world }) => {
    const r = runRecord(world, req.params.id ?? "");
    if (!r) throw notFound("The run");
    requireRole(world, r.run.scope, "builder");
    const u = me(world);
    const status = r.run.status === "waiting" ? "waiting_approval" : r.run.status;
    const terminal = r.run.status === "finished" || r.run.status === "failed" || r.run.status === "cancelled";
    switch (req.params.action) {
      case "pause":
        if (!["queued", "running", "waiting"].includes(r.run.status)) throw conflict(`A ${status} run cannot be paused.`);
        append(world, r, "run.paused", { by: u.displayName, reason: "Paused by a person." });
        break;
      case "resume":
        if (r.run.status !== "paused") throw conflict(`Only a paused run can be resumed; this one is ${status}.`);
        append(world, r, "run.resumed", { by: u.displayName });
        if (world.approvals.some((a) => a.runId === r.run.id && a.answer === null)) r.run.status = "waiting";
        break;
      case "cancel":
        if (terminal) throw conflict(`The run has already ${r.run.status}.`);
        append(world, r, "run.finished", { outcome: "cancelled", by: u.displayName, reason: "Cancelled by a person.", summary: "Cancelled." });
        for (const a of world.approvals) if (a.runId === r.run.id && !a.answer) a.answer = "rejected";
        break;
      default:
        throw new Refusal(problem(404, "not_found", "Not found", "There is nothing at this address."));
    }
    world.changed.push("Run", "Tree");
    return ok(r.run);
  },

  "POST runs/{runId}/approvals/{approvalId}": (req, { world }) => {
    const decision = str(req.body, "decision");
    if (decision !== "approve" && decision !== "reject") throw invalid("decision is 'approve' or 'reject'.");
    const r = runRecord(world, req.params.runId ?? "");
    if (!r) throw notFound("The run");
    requireRole(world, r.run.scope, "builder");
    answerApproval(world, req.params.approvalId ?? "", decision, me(world).displayName, str(req.body, "note") ?? null);
    return { status: 204 };
  },

  "GET tasks": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    const employeeId = req.query.get("employeeId");
    const limit = Number(req.query.get("limit") ?? 100);
    return ok(world.tasks.filter((t) => (t.scope === scope || t.scope.startsWith(`${scope}/`)) && (!employeeId || t.employeeId === employeeId)).slice(0, limit));
  },

  "GET apps/{id}": (req, { world }) => {
    const a = world.apps.find((x) => x.id === req.params.id);
    if (!a) throw notFound("The app");
    requireRole(world, a.path, "viewer");
    return ok(appView(world, a));
  },

  "POST apps/{id}/settings": (req, { world }) => {
    const running = str(req.body, "running");
    const access = str(req.body, "access");
    const idle = num(req.body, "idleMinutes");
    if (running === undefined && access === undefined && idle === undefined) throw invalid("Send running ('sleep' or 'always-on'), access, idleMinutes, or a combination.");
    if (running !== undefined && running !== "sleep" && running !== "always-on") throw invalid("running is 'sleep' or 'always-on'.");
    if (access !== undefined && !["private", "shared", "public"].includes(access)) throw invalid("access is 'private', 'shared' or 'public'.");
    const a = world.apps.find((x) => x.id === req.params.id);
    if (!a) throw notFound("The app");
    requireRole(world, a.path, access === undefined ? "builder" : "admin");
    if (running) {
      a.runningSetting = running as "sleep" | "always-on";
      if (a.running !== "paused" && a.status !== "failed") a.running = running === "always-on" ? "always-on" : "awake";
    }
    if (idle !== undefined) {
      if (!Number.isInteger(idle) || idle < 1 || idle > 1440) throw invalid("sleep.idle_minutes is a whole number from 1 to 1440.");
      a.idleMinutes = idle;
    }
    if (access) a.access = access as "private" | "shared" | "public";
    world.changed.push("App", "Tree");
    return ok(appView(world, a));
  },

  "POST conversations": (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, "builder");
    const message = str(req.body, "message") ?? "";
    if (!message.trim() || message.length > 20000) throw invalid("A message is 1 to 20000 characters.");
    const employeeId = str(req.body, "employeeId") ?? null;
    if (employeeId && !world.employees.some((e) => e.id === employeeId && e.status !== "released")) throw notFound("The employee");
    const given = str(req.body, "conversationId");
    let conversation = given ? world.conversations.find((c) => c.id === given) : world.conversations.find((c) => c.scope === scope && c.employeeId === employeeId);
    if (given && !conversation) throw notFound("The conversation");
    if (conversation && conversation.scope !== scope) throw conflict("This conversation belongs to another scope; start a new one here.");
    if (!conversation) {
      conversation = { id: newId(world, "conversation"), scope, employeeId, runIds: [] };
      world.conversations.push(conversation);
    }
    const first = message.split("\n")[0] ?? message;
    const r = startRun(world, { id: newId(world, "run"), kind: "conversation", title: first.length > 120 ? `${first.slice(0, 117)}...` : first, scope, ideaId: null, estimateCredits: null, employeeId, conversationId: conversation.id }, "conversation", { text: message, employeeId });
    append(world, r, "message", { from: "owner", userId: me(world).id, text: message });
    conversation.runIds.push(r.run.id);
    world.changed.push("Conversation");
    return created(r.run);
  },

  "GET conversations": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    const employeeId = req.query.get("employeeId");
    const c = world.conversations.find((x) => x.scope === scope && x.employeeId === (employeeId ?? null));
    const messages = (c?.runIds ?? []).flatMap((id) => {
      const r = runRecord(world, id);
      return (r?.events ?? []).filter((e) => e.type === "message" && typeof e.payload.text === "string" && !e.payload.kind).map((e) => ({ runId: id, seq: e.seq, at: e.at, from: String(e.payload.from ?? "assistant"), text: String(e.payload.text) }));
    });
    return ok({ scope, conversationId: c?.id ?? null, employeeId: employeeId ?? null, messages: messages.slice(-200) });
  },
});

/** The autonomy a scope works under: whether a plan waits for a person. */
export function planWaits(world: World, scope: string) {
  return setting(world, scope, "autonomy")?.value === "checkpoints" && setting(world, scope, "checkpoint.plan")?.value === "true";
}
