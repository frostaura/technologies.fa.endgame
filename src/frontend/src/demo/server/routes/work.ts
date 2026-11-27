import type { DecisionChoice, Idea } from "@/store/types";
import { append } from "../engine";
import { homeOrganisation, me, requireRole, scopeOf } from "../access";
import { area, conflict, created, invalid, noContent, notFound, num, ok, problem, Refusal, str, strings, titleOf } from "../http";
import { capabilities, checkFile, content, FileRefused, keep, LIMITS, takesImages, view } from "../conversationKit";
import { setStage, startRun } from "../mutations";
import { startResearch } from "../scripts";
import { changeEstimate, changeText, conversationEstimate, retryEstimate, retryRun, runView, startChange } from "../tryAgain";
import { appView, ideaView } from "../views";
import { newId, orgOf, runRecord, setting, type World } from "../world";

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
  if (a.answer === "expired") throw conflict("The work ended before this was answered, so there is nothing left to approve.");
  if (a.answer) throw conflict(`This approval was already ${a.answer}.`);
  const r = runRecord(world, a.runId);
  a.answer = decision === "approve" ? "approved" : "rejected";
  a.answeredBy = by;
  if (r) {
    append(world, r, "approval.answered", { approvalId: a.id, answer: a.answer, comment: note, by });
    if (!world.approvals.some((x) => x.runId === r.run.id && x.answer === null) && r.run.status === "waiting") r.run.status = "running";
    if (r.playback) r.playback.params = { ...r.playback.params, answer: a.answer };
  }
  if (a.answer === "approved") {
    const act = a.onApprove;
    // What the conversation started, said in its own log so the conversation follows it (`work.started`, ARCH-012).
    const started = (run: { run: { id: string; title: string } } | undefined, workKind: string) => {
      if (r && run && r.run.kind === "conversation") append(world, r, "message", { kind: "work.started", runId: run.run.id, workKind, title: run.run.title });
    };
    if (act.kind === "start-idea") {
      const idea = createIdea(world, act.text, [], act.scope, "conversation");
      started(runRecord(world, idea.runId), "research");
    }
    if (act.kind === "change-app") {
      const app = world.apps.find((x) => x.path === act.scope);
      if (app) started(startChange(world, app, act.request, null, "conversation"), "change");
    }
    if (act.kind === "try-again") {
      const stopped = runRecord(world, act.runId);
      if (stopped) started(retryRun(world, stopped, null, startResearch), "retry");
    }
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
    history: [],
    tryAgain: null,
  };
  world.ideas.push(idea);
  // Nothing is placed in the tree yet: as BuildWorkflow.PlaceAsync, placement is the build's first step (TREE-01).
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
    const applyChange = req.body.applyChange === true;
    const suggested = applyChange && verdict === "change" && typeof i.verdict.suggestedChange === "string" && i.verdict.suggestedChange.trim() ? i.verdict.suggestedChange.trim() : null;
    if (applyChange && !suggested) throw conflict("There is no change from research to apply: the verdict was not 'change', or it named none.");
    // What is built is the idea plus every change agreed after research: the owner's own notes, and research's when accepted.
    const changes = [...new Set([...(i.history ?? []).filter((h) => h.choice === "change" && h.note).map((h) => String(h.note)), ...(suggested ? [suggested] : [])])];
    const project = world.nodes.find((n) => n.ideaId === i.id && n.level === "project");
    if (choice === "build" || choice === "overrule") {
      const runId = newId(world, "run");
      const r = startRun(world, { id: runId, kind: "build", title: `Build: ${titleOf(i.text)}`, scope: project?.path ?? scope, ideaId: i.id, estimateCredits: 120, employeeId: null, conversationId: null }, "build", { ideaId: i.id });
      append(world, r, "message", { from: "owner", text: i.text, constraints: i.constraints.join("\n"), verdict, overruled: choice === "overrule", note, decidedBy: "person", changes, appliedChange: suggested });
      i.status = "decided";
      i.decision = { choice, at, by: u.displayName, overruled: choice === "overrule", runId, via: "person" };
      if (project) setStage(world, project.path, "planning", null);
    } else if (choice === "change") {
      const before = i.verdict;
      i.status = "researching";
      i.verdict = null;
      i.redLine = null;
      const text = note ? `${i.text}\n\nThe change: ${note}` : i.text;
      const r = startResearch(world, i.id, orgOf(scope) === scope ? scope : scope.split("/").slice(0, 2).join("/"), text, i.constraints, "console", null, note);
      i.runId = r.run.id;
      // The change stays the decision until the new verdict lands (`ReadModels`: a change follows its research run), then it is kept in the history.
      i.decision = { choice, at, by: u.displayName, overruled: false, runId: r.run.id, via: "person" };
      i.history = [...(i.history ?? []), { verdict: before.outcome, headline: before.headline ?? null, choice: "change", note, by: u.displayName, at, runId: r.run.id }];
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
    return ok(runView(world, r));
  },

  "POST runs/{id}/retry/estimate": (req, { world }) => {
    const r = runRecord(world, req.params.id ?? "");
    if (!r) throw notFound("The run");
    requireRole(world, r.run.scope, "builder");
    return ok(retryEstimate(world, r));
  },

  "POST runs/{id}/retry": (req, { world }) => {
    const r = runRecord(world, req.params.id ?? "");
    if (!r) throw notFound("The run");
    requireRole(world, r.run.scope, "builder");
    const u = me(world);
    const again = retryRun(world, r, { id: u.id, name: u.displayName }, startResearch);
    return created(runView(world, again));
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
        // Its open approvals expire with it, in the same step (the engine's run.finished).
        append(world, r, "run.finished", { outcome: "cancelled", by: u.displayName, reason: "Cancelled by a person.", summary: "Cancelled." });
        break;
      default:
        throw new Refusal(problem(404, "not_found", "Not found", "There is nothing at this address."));
    }
    world.changed.push("Run", "Tree");
    return ok(runView(world, r));
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

  "POST apps/{id}/changes/estimate": (req, { world }) => {
    const a = world.apps.find((x) => x.id === req.params.id);
    if (!a) throw notFound("The app");
    requireRole(world, a.path, "builder");
    changeText(str(req.body, "request"));
    return ok(changeEstimate(world, a));
  },

  "POST apps/{id}/changes": (req, { world }) => {
    const a = world.apps.find((x) => x.id === req.params.id);
    if (!a) throw notFound("The app");
    requireRole(world, a.path, "builder");
    return created(runView(world, startChange(world, a, str(req.body, "request") ?? "", me(world), "console")));
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

  "POST conversations/estimate": (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, "viewer");
    const employeeId = str(req.body, "employeeId") ?? null;
    const worker = employeeId ? world.employees.find((e) => e.id === employeeId) : undefined;
    if (employeeId && !worker) throw notFound("The employee");
    return ok(conversationEstimate(world, scope, worker?.jobDescription.modelTier ?? null));
  },

  "POST conversations": (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, "builder");
    const message = (str(req.body, "message") ?? "").trim();
    const employeeId = str(req.body, "employeeId") ?? null;
    // Files go by id: each uploaded by this person, at this level, and not sent before (`ConversationService.PostAsync`).
    const ids = strings(req.body, "attachmentIds");
    const files = ids.map((id) => {
      const a = (world.attachments ?? []).find((x) => x.id === id && x.uploadedBy === me(world).id);
      if (!a) throw notFound("The file");
      if (a.runId) throw conflict(`${a.name} was already sent with another message.`);
      if (a.scope !== scope || a.employeeId !== employeeId) throw conflict(`${a.name} was attached in another conversation.`);
      return a;
    });
    if (!message && files.length === 0) throw invalid("A message is 1 to 20000 characters.");
    if (message.length > 20000) throw invalid("A message is 1 to 20000 characters.");
    if (files.length > LIMITS.maxFiles) throw invalid(`A message carries at most ${LIMITS.maxFiles} files.`);
    if (files.reduce((n, f) => n + f.bytes, 0) > LIMITS.maxMessageBytes) throw new Refusal(problem(413, "attachments_too_large", "Too much attached", "The files on one message may come to 25 MB at most."));
    const worker = employeeId ? world.employees.find((e) => e.id === employeeId && e.status !== "released") : undefined;
    if (employeeId && !worker) throw notFound("The employee");
    if (worker?.status === "paused") throw conflict(`${worker.name} is paused, so they are given no new work. Resume them first.`);
    if (files.some((f) => f.kind === "image") && !takesImages(worker?.jobDescription.modelTier ?? "chat"))
      throw new Refusal(problem(422, "images_not_accepted", "Images cannot be sent here", `${worker?.name ?? "Endgame’s assistant"} reads text only, so an image cannot be sent to it. Take the image off, or attach it as a PDF.`));
    const narrowBody = (req.body.narrow ?? {}) as Record<string, unknown>;
    const narrow = { ...(narrowBody.noWebSearch === true ? { noWebSearch: true } : {}), ...(narrowBody.answerOnly === true ? { answerOnly: true } : {}) };
    const given = str(req.body, "conversationId");
    let conversation = given ? world.conversations.find((c) => c.id === given) : world.conversations.find((c) => c.scope === scope && c.employeeId === employeeId);
    if (given && !conversation) throw notFound("The conversation");
    if (conversation && conversation.scope !== scope) throw conflict("This conversation belongs to another scope; start a new one here.");
    if (!conversation) {
      conversation = { id: newId(world, "conversation"), scope, employeeId, runIds: [] };
      world.conversations.push(conversation);
    }
    const first = message ? (message.split("\n")[0] ?? message) : `Sent ${files.map((f) => f.name).join(", ")}`;
    const r = startRun(world, { id: newId(world, "run"), kind: "conversation", title: first.length > 120 ? `${first.slice(0, 117)}...` : first, scope, ideaId: null, estimateCredits: null, employeeId, conversationId: conversation.id }, "conversation", {
      text: message,
      employeeId,
      files: files.map((f) => `${f.name}|${f.kind}|${f.pages ?? ""}`).join("\n") || null,
      answerOnly: narrow.answerOnly === true,
    });
    for (const f of files) f.runId = r.run.id;
    append(world, r, "message", {
      from: "owner",
      userId: me(world).id,
      text: message,
      ...(files.length > 0 ? { attachments: files.map((f) => ({ id: f.id, name: f.name, kind: f.kind, contentType: f.contentType, bytes: f.bytes })) } : {}),
      ...(Object.keys(narrow).length > 0 ? { narrow } : {}),
    });
    conversation.runIds.push(r.run.id);
    world.changed.push("Conversation");
    return created(runView(world, r));
  },

  "GET conversations": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    const employeeId = req.query.get("employeeId");
    const c = world.conversations.find((x) => x.scope === scope && x.employeeId === (employeeId ?? null));
    const messages = (c?.runIds ?? []).flatMap((id) => {
      const r = runRecord(world, id);
      return (r?.events ?? [])
        .filter((e) => e.type === "message" && typeof e.payload.text === "string" && !e.payload.kind && (e.payload.text !== "" || Array.isArray(e.payload.attachments)))
        .map((e) => {
          const from = String(e.payload.from ?? "assistant");
          const by = from === "owner" ? (world.users.find((x) => x.id === e.payload.userId)?.displayName ?? null) : typeof e.payload.by === "string" ? e.payload.by : null;
          const attachments = from === "owner" ? (world.attachments ?? []).filter((a) => a.runId === id).map(view) : [];
          return { runId: id, seq: e.seq, at: e.at, from, text: String(e.payload.text), by, code: typeof e.payload.code === "string" ? e.payload.code : null, attachments };
        });
    });
    // Each turn's run, with its tool count and the work it started, so its card comes back after a reload.
    const turns = (c?.runIds ?? []).flatMap((id) => {
      const r = runRecord(world, id);
      if (!r) return [];
      const started = r.events
        .filter((e) => e.type === "message" && e.payload.kind === "work.started" && typeof e.payload.runId === "string")
        .map((e) => ({ runId: String(e.payload.runId), kind: String(e.payload.workKind ?? ""), title: String(e.payload.title ?? "") }));
      return [{ runId: id, status: r.run.status, toolCalls: r.events.filter((e) => e.type === "tool.requested").length, started }];
    });
    return ok({ scope, conversationId: c?.id ?? null, employeeId: employeeId ?? null, messages: messages.slice(-200), turns });
  },

  "GET conversations/capabilities": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    const employeeId = req.query.get("employeeId");
    if (employeeId && !world.employees.some((e) => e.id === employeeId)) throw notFound("The employee");
    return ok(capabilities(world, scope, employeeId ?? null));
  },

  "POST conversations/attachments": async (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, "builder");
    const file = req.body.file;
    if (!(file instanceof File)) throw invalid("Attach one file, as the form field file.");
    const employeeId = str(req.body, "employeeId") ?? null;
    if (employeeId && !world.employees.some((e) => e.id === employeeId)) throw notFound("The employee");
    const mine = me(world).id;
    const day = Date.now() - 24 * 3600 * 1000;
    world.attachments = (world.attachments ?? []).filter((a) => a.runId || a.uploadedBy !== mine || Date.parse(a.createdAt) > day);
    if (world.attachments.filter((a) => !a.runId && a.uploadedBy === mine).length >= LIMITS.maxUnsentPerPerson)
      throw conflict(`You have ${LIMITS.maxUnsentPerPerson} files waiting to be sent. Send them, or take some off, before adding more.`);
    let checked;
    try {
      checked = await checkFile(file);
    } catch (e) {
      if (e instanceof FileRefused) throw new Refusal(problem(e.status, e.code, "The file was not accepted", e.message));
      throw e;
    }
    const kept = await keep(world, { id: newId(world, "attachment"), name: file.name, contentType: checked.contentType, kind: checked.kind, bytes: file.size, pages: checked.pages, characters: checked.characters, runId: null, scope, employeeId, uploadedBy: mine, createdAt: new Date().toISOString() }, file);
    return created(view(kept));
  },

  "GET conversations/attachments/{id}/content": (req, { world }) => {
    const a = (world.attachments ?? []).find((x) => x.id === req.params.id);
    if (!a || (!a.runId && a.uploadedBy !== me(world).id)) throw notFound("The file");
    requireRole(world, a.scope, "viewer");
    const blob = content(a);
    if (!blob) throw new Refusal(problem(410, "attachment_gone", "Not kept in this demo", "This demo keeps a large file only until the page is reloaded."));
    return { status: 200, body: blob, headers: { "content-type": a.contentType, "x-content-type-options": "nosniff" } };
  },

  "DELETE conversations/attachments/{id}": (req, { world }) => {
    const a = (world.attachments ?? []).find((x) => x.id === req.params.id && x.uploadedBy === me(world).id);
    if (!a) throw notFound("The file");
    if (a.runId) throw conflict(`${a.name} was sent with a message, so it stays with the conversation.`);
    world.attachments = (world.attachments ?? []).filter((x) => x !== a);
    return noContent();
  },
});

/** The autonomy a scope works under: whether a plan waits for a person. */
export function planWaits(world: World, scope: string) {
  return setting(world, scope, "autonomy")?.value === "checkpoints" && setting(world, scope, "checkpoint.plan")?.value === "true";
}
