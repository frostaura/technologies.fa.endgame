import type { Employee, Hire, MemoryKind, Ontology, OntologyEdge, OntologyNode } from "@/store/types";
import { append } from "../engine";
import { me, requireRole, scopeOf } from "../access";
import { area, conflict, created, invalid, noContent, notFound, num, ok, problem, Refusal, str, strings } from "../http";
import { blankTrackRecord, startRun } from "../mutations";
import { newId, organisation, orgOf, spentBelow, uuidFor, within, type World } from "../world";

/** `WorkforceEndpoints.cs`: employees, contractors, memory, hires, recurring roles, the ontology. */

function employee(world: World, id: string): Employee {
  const e = world.employees.find((x) => x.id === id);
  if (!e) throw notFound("The employee");
  return e;
}

const KINDS: MemoryKind[] = ["fact", "practice", "preference", "lesson"];
/** The routing table's task types an employee may be given (`appsettings.json`, `ModelGateway:Routes`, less the `app.` ones). */
const TIERS = ["architecture", "ask", "build", "build-t1", "build-t2", "build-t3", "chat", "classify", "code", "evaluate", "plan", "research", "summarise"];

function validateJob(job: Record<string, unknown> | undefined) {
  if (!job) return;
  if (typeof job.mandate === "string" && job.mandate.length > 8000) throw invalid("A mandate is at most 8000 characters.");
  if (Array.isArray(job.tools) && (job.tools.length > 40 || job.tools.some((t) => typeof t !== "string" || !/^[a-z][a-z0-9_]*$/.test(t)))) throw invalid("tools is a list of up to 40 names: lower-case tool names such as read_file or edit_file.");
  const services = ["identity", "models", "secrets", "email", "schedules", "webhooks", "telemetry"];
  if (Array.isArray(job.services) && (job.services.length > 40 || job.services.some((t) => !services.includes(String(t))))) throw invalid("services is a list of up to 40 names: identity, models, secrets, email, schedules, webhooks, telemetry.");
  if (typeof job.monthlyCreditLimit === "number" && job.monthlyCreditLimit < 0) throw invalid("A credit limit cannot be negative.");
  if (typeof job.modelTier === "string" && !TIERS.includes(job.modelTier)) throw invalid(`'${job.modelTier}' is not a model tier: use a routing-table task type such as ${[...TIERS].sort().join(", ")}.`);
}

function applyJob(e: { jobDescription: Employee["jobDescription"] }, job: Record<string, unknown> | undefined) {
  if (!job) return;
  const jd = e.jobDescription;
  if (typeof job.mandate === "string") jd.mandate = job.mandate;
  if (Array.isArray(job.tools)) jd.tools = job.tools.map(String);
  if (Array.isArray(job.services)) jd.services = job.services.map(String);
  if (typeof job.monthlyCreditLimit === "number") jd.monthlyCreditLimit = job.monthlyCreditLimit;
  if (typeof job.modelTier === "string") jd.modelTier = job.modelTier;
}

/**
 * `HireService.HeadroomAsync` (`CreditLedger.Position.Headroom`): the most new work may still spend
 * where the hire would work — the tightest monthly cap on its chain, or the balance down to the
 * overdraft limit, whichever is lower. Worked out again on every read.
 */
export function headroom(world: World, scope: string): number {
  const o = organisation(world, orgOf(scope));
  const limit = o ? (o.ownLimit !== null ? Math.min(o.ownLimit, o.frostauraLimit) : o.frostauraLimit) : 0;
  let room = (o?.balance ?? 0) + limit;
  for (const b of world.budgets) {
    if (!within(scope, b.path)) continue;
    const s = spentBelow(world, b.path);
    room = Math.min(room, b.cap - s.ai - s.hosting);
  }
  return Math.max(0, Math.round(room * 100) / 100);
}

/** An open proposal's room and fit, as they are now (a decided one keeps what it was decided on). */
function withRoom(world: World, h: Hire): Hire {
  if (h.status !== "proposed") return h;
  h.headroomCredits = headroom(world, h.scope);
  h.withinBudget = h.expectedMonthlyCredits <= h.headroomCredits;
  return h;
}

export function hireNow(world: World, h: Hire, via: string, by: string, note: string | null) {
  // `EmployeeService.HireAsync`: the manager it was drafted with must still be on the payroll.
  if (h.reportsTo && !world.employees.some((x) => x.id === h.reportsTo?.id && x.status !== "released" && x.kind === "employee")) throw invalid("reportsTo names an employee of this organisation who is on the payroll.");
  const id = uuidFor(`employee:hire:${h.id}`);
  const at = new Date().toISOString();
  world.employees.push({
    id,
    kind: "employee",
    name: h.name,
    role: h.role,
    status: "idle",
    standing: null,
    scope: h.scope,
    reportsTo: h.reportsTo,
    briefedBy: null,
    jobDescription: { ...h.jobDescription },
    idle: { flagged: false, since: null, afterDays: 14 },
    currentRun: null,
    lastRunId: null,
    lastActiveAt: null,
    createdAt: at,
    releasedAt: null,
    memoryEntries: 0,
    brief: null,
  });
  world.trackRecords.push(blankTrackRecord(id));
  Object.assign(h, { status: "accepted", employeeId: id, decision: { via, by, at, note } });
  world.notifications = world.notifications.map((n) => (n.subject?.id === h.id ? { ...n, read: true } : n));
}

/** Who a moved employee reports to: the one named (on the payroll, no loop), or nobody. */
function managerFor(world: World, e: Employee, id: string | undefined): Employee | null {
  if (!id) return null;
  const m = world.employees.find((x) => x.id === id && orgOf(x.scope) === orgOf(e.scope) && x.status !== "released" && x.kind === "employee");
  if (!m) throw invalid("reportsTo names an employee of this organisation who is on the payroll.");
  if (m.id === e.id || m.reportsTo?.id === e.id) throw invalid("That would make a reporting loop: the manager already reports, directly or not, to this employee.");
  return m;
}

/** `RunService.PauseForEmployeeAsync`: every run under way that is theirs, or that they hold a task in, pauses. */
function pauseWorkOf(world: World, e: Employee) {
  const live = world.runs.filter((r) => ["queued", "running", "waiting"].includes(r.run.status) && (r.run.employeeId === e.id || e.currentRun?.id === r.run.id));
  for (const r of live) {
    append(world, r, "message", { text: `Waiting for ${e.name}, who is paused. This work carries on when they are resumed.`, code: "employee_paused" });
    append(world, r, "run.paused", { by: "workforce", reason: "employee_paused", employeeId: e.id });
  }
}

/** `RunService.ResumeForEmployeeAsync`: the runs that paused because of them go on. */
function resumeWorkOf(world: World, e: Employee) {
  for (const r of world.runs) {
    if (r.run.status !== "paused") continue;
    const last = [...r.events].reverse().find((x) => x.type === "run.paused");
    if (last?.payload.reason === "employee_paused" && last.payload.employeeId === e.id) append(world, r, "run.resumed", { by: "workforce", reason: "employee_resumed", employeeId: e.id });
  }
}

area("WorkforceEndpoints", {
  "GET employees": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    const released = req.query.get("includeReleased") === "true";
    return ok(world.employees.filter((e) => within(e.scope, scope) && (released || e.status !== "released") && !(e.kind === "contractor" && e.status === "released")));
  },

  "GET employees/recurring-roles": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    // A role stops recurring once an employee holds it there (`EmployeeService.RecurringRolesAsync`).
    const held = (r: { scope: string; role: string }) => world.employees.some((e) => e.kind === "employee" && e.status !== "released" && e.scope === r.scope && e.role.toLowerCase() === r.role.toLowerCase());
    return ok(world.recurringRoles.filter((r) => within(r.scope, scope) && !held(r)));
  },

  "GET employees/{id}": (req, { world }) => {
    const e = employee(world, req.params.id ?? "");
    requireRole(world, e.scope, "viewer");
    const trackRecord = world.trackRecords.find((t) => t.employeeId === e.id) ?? blankTrackRecord(e.id);
    return ok({
      employee: e,
      trackRecord,
      contractors: world.employees.filter((c) => c.kind === "contractor" && c.briefedBy?.id === e.id && c.status === "working"),
      reports: world.employees.filter((r) => r.reportsTo?.id === e.id && r.status !== "released"),
    });
  },

  "PATCH employees/{id}": (req, { world }) => {
    const e = employee(world, req.params.id ?? "");
    requireRole(world, e.scope, "admin");
    if (e.status === "released") throw conflict(`${e.name} has been released; rehire them first.`);
    for (const k of ["name", "role"] as const) {
      const v = str(req.body, k);
      if (v !== undefined && (v.trim().length === 0 || v.length > 200)) throw invalid(`An employee's ${k} is 1 to 200 characters.`);
    }
    const job = req.body.jobDescription as Record<string, unknown> | undefined;
    validateJob(job);
    const status = str(req.body, "status");
    if (status !== undefined && status !== "paused" && status !== "idle") throw invalid("status is 'paused' (stop giving it work) or 'idle' (resume). Release and rehire have their own actions.");
    const reportsTo = str(req.body, "reportsTo");
    if (reportsTo) {
      const m = world.employees.find((x) => x.id === reportsTo && orgOf(x.scope) === orgOf(e.scope) && x.status !== "released" && x.kind === "employee");
      if (!m) throw invalid("reportsTo names an employee of this organisation who is on the payroll.");
      if (m.id === e.id || m.reportsTo?.id === e.id) throw invalid("That would make a reporting loop: the manager already reports, directly or not, to this employee.");
      e.reportsTo = { id: m.id, name: m.name };
    }
    if (req.body.clearReportsTo === true) e.reportsTo = null;
    if (str(req.body, "name")) e.name = str(req.body, "name") ?? e.name;
    if (str(req.body, "role")) e.role = str(req.body, "role") ?? e.role;
    applyJob(e, job);
    if (req.body.clearMonthlyCreditLimit === true) e.jobDescription.monthlyCreditLimit = null;
    if (status === "paused" && e.status !== "paused") pauseWorkOf(world, e);
    if (status === "idle" && e.status === "paused") resumeWorkOf(world, e);
    if (status) e.status = status as "paused" | "idle";
    world.changed.push("Employee", "Tree");
    return ok(e);
  },

  "POST employees/{id}/{action}": (req, { world }) => {
    const e = employee(world, req.params.id ?? "");
    const action = req.params.action;
    if (action === "reviews") {
      requireRole(world, e.scope, "builder");
      if (e.status === "released" || e.kind !== "employee") throw conflict("Only an employee on the payroll has a memory to review.");
      if (e.status === "paused") throw conflict(`${e.name} is paused, so they are given no new work. Resume them first.`);
      const r = startRun(world, { id: newId(world, "run"), kind: "review", title: `Memory review: ${e.name}`, scope: e.scope, ideaId: null, estimateCredits: 2, employeeId: e.id, conversationId: null }, "review", { employeeId: e.id });
      append(world, r, "message", { from: "owner", kind: "memory.review", employeeId: e.id, text: `Review ${e.name}'s memory: merge what repeats, remove what is stale, correct what is wrong, then report it.` });
      return created(r.run);
    }
    if (action === "memory") {
      requireRole(world, e.scope, "builder");
      const title = (str(req.body, "title") ?? "").trim();
      const body = (str(req.body, "body") ?? "").trim();
      const kind = (str(req.body, "kind") ?? "fact") as MemoryKind;
      if (!title || title.length > 200 || !body || body.length > 4000) throw invalid("A memory entry has a title of 1 to 200 characters and a body of 1 to 4000.");
      if (!KINDS.includes(kind)) throw invalid("A memory entry's kind is one of fact, practice, preference, lesson.");
      if (e.status === "released") throw conflict(`${e.name} has been released; their memory is archived until a rehire.`);
      if (e.kind === "contractor") throw invalid("A contractor keeps no memory: what it learned goes to the employee who briefed it, when it finishes.");
      const at = new Date().toISOString();
      const entry = { id: newId(world, "memory"), employeeId: e.id, scope: e.scope, title, body, kind, sourceRunId: null, createdAt: at, updatedAt: at, lastReviewedAt: null, archived: false };
      world.memory.unshift(entry);
      world.memoryChanges.unshift({ id: newId(world, "change"), memoryId: entry.id, action: "added", by: "person", userId: me(world).id, runId: null, detail: { title }, at });
      e.memoryEntries += 1;
      world.changed.push("Memory", "Employee");
      return created(entry);
    }
    requireRole(world, e.scope, "admin");
    const at = new Date().toISOString();
    if (action === "release") {
      if (e.standing) throw new Refusal(problem(409, "standing_hire", "A standing hire is never released", `${e.name} is a standing hire every organisation keeps.`));
      if (e.status === "released") throw conflict(`${e.name} has already been released.`);
      if (e.status === "working") throw conflict(`${e.name} is working on a run; let it finish or cancel it first.`);
      Object.assign(e, { status: "released", releasedAt: at });
      // Anyone who reported to it moves up, to its own manager.
      for (const r of world.employees) if (r.reportsTo?.id === e.id) r.reportsTo = e.reportsTo;
      for (const m of world.memory) if (m.employeeId === e.id) m.archived = true;
      world.memoryChanges.unshift({ id: newId(world, "change"), memoryId: null, action: "archived", by: "platform", userId: null, runId: null, detail: { reason: "released" }, at });
    } else if (action === "rehire") {
      if (e.status !== "released") throw conflict(`Only a released employee is rehired; ${e.name} is ${e.status}.`);
      const scope = str(req.body, "scope");
      if (scope) {
        scopeOf(world, scope);
        if (orgOf(scope) !== orgOf(e.scope)) throw invalid("An employee is rehired into its own organisation.");
        requireRole(world, scope, "admin");
        e.scope = scope;
        e.jobDescription.scope = scope;
      }
      Object.assign(e, { status: "idle", releasedAt: null });
      for (const m of world.memory) if (m.employeeId === e.id) m.archived = false;
      world.memoryChanges.unshift({ id: newId(world, "change"), memoryId: null, action: "restored", by: "platform", userId: null, runId: null, detail: { reason: "rehired" }, at });
    } else if (action === "stop") {
      // `EmployeeService.StopContractorAsync`: finished at once, so it makes no more calls; the briefing work carries on without it.
      if (e.kind !== "contractor") throw invalid(`Only a contractor is stopped; ${e.name} is an employee, who is paused or let go.`);
      if (e.status === "released") throw conflict(`${e.name} has already finished.`);
      Object.assign(e, { status: "released", releasedAt: at, lastRunId: e.currentRun?.id ?? e.lastRunId, currentRun: null });
      const briefer = world.trackRecords.find((t) => t.employeeId === e.briefedBy?.id);
      if (briefer && briefer.contractors.working > 0) briefer.contractors.working -= 1;
    } else if (action === "reassign") {
      const scope = str(req.body, "scope");
      if (!scope) throw invalid("A scope is required, written as org, org/division, org/division/project or org/division/project/app.");
      scopeOf(world, scope);
      if (orgOf(scope) !== orgOf(e.scope)) throw invalid("An employee moves within its own organisation.");
      if (e.kind === "contractor") throw conflict("A contractor works on its brief; it is not reassigned.");
      if (e.status === "released") throw conflict(`${e.name} has been released; rehire them first.`);
      requireRole(world, scope, "admin");
      const manager = managerFor(world, e, str(req.body, "reportsTo"));
      e.scope = scope;
      e.jobDescription.scope = scope;
      e.reportsTo = manager ? { id: manager.id, name: manager.name } : null;
    } else {
      throw new Refusal(problem(404, "not_found", "Not found", "There is nothing at this address."));
    }
    e.memoryEntries = world.memory.filter((m) => m.employeeId === e.id && !m.archived).length;
    world.changed.push("Employee", "Tree", "Ontology", "Memory");
    return ok(e);
  },

  "GET employees/{id}/memory": (req, { world }) => {
    const e = employee(world, req.params.id ?? "");
    requireRole(world, e.scope, "viewer");
    const archived = req.query.get("includeArchived") === "true";
    return ok(world.memory.filter((m) => m.employeeId === e.id && (archived || !m.archived)));
  },

  "GET employees/{id}/memory/changes": (req, { world }) => {
    const e = employee(world, req.params.id ?? "");
    requireRole(world, e.scope, "viewer");
    const removed = Object.entries(world.removedMemory ?? {}).filter(([, owner]) => owner === e.id).map(([entry]) => entry);
    const mine = new Set([...world.memory.filter((m) => m.employeeId === e.id).map((m) => m.id), ...removed]);
    // Newest first, as `MemoryService.ChangesAsync` orders them.
    const changes = world.memoryChanges.filter((c) => (c.memoryId && mine.has(c.memoryId)) || (!c.memoryId && c.by !== "employee"));
    return ok([...changes].sort((a, b) => b.at.localeCompare(a.at)).slice(0, Number(req.query.get("limit") ?? 100)));
  },

  "PATCH employees/{id}/memory/{entryId}": (req, { world }) => {
    const e = employee(world, req.params.id ?? "");
    requireRole(world, e.scope, "builder");
    const m = world.memory.find((x) => x.id === req.params.entryId && x.employeeId === e.id);
    if (!m) throw notFound("The memory entry");
    const title = str(req.body, "title");
    const body = str(req.body, "body");
    const kind = str(req.body, "kind") as MemoryKind | undefined;
    if (title === undefined && body === undefined && kind === undefined) throw invalid("Send a new title, body or kind.");
    if ((title !== undefined && (!title.trim() || title.length > 200)) || (body !== undefined && (!body.trim() || body.length > 4000))) throw invalid("A memory entry has a title of 1 to 200 characters and a body of 1 to 4000.");
    if (kind !== undefined && !KINDS.includes(kind)) throw invalid("A memory entry's kind is one of fact, practice, preference, lesson.");
    const before = { title: m.title, body: m.body, kind: m.kind };
    Object.assign(m, { ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {}), ...(kind ? { kind } : {}), updatedAt: new Date().toISOString() });
    world.memoryChanges.unshift({ id: newId(world, "change"), memoryId: m.id, action: "corrected", by: "person", userId: me(world).id, runId: null, detail: { before, after: { title: m.title, body: m.body, kind: m.kind } }, at: m.updatedAt });
    world.changed.push("Memory");
    return ok(m);
  },

  "DELETE employees/{id}/memory/{entryId}": (req, { world }) => {
    const e = employee(world, req.params.id ?? "");
    requireRole(world, e.scope, "builder");
    const m = world.memory.find((x) => x.id === req.params.entryId && x.employeeId === e.id);
    if (!m) throw notFound("The memory entry");
    world.memory = world.memory.filter((x) => x.id !== m.id);
    (world.removedMemory ??= {})[m.id] = e.id;
    world.memoryChanges.unshift({ id: newId(world, "change"), memoryId: m.id, action: "removed", by: "person", userId: me(world).id, runId: null, detail: { title: m.title, body: m.body, why: req.query.get("why") ?? "" }, at: new Date().toISOString() });
    e.memoryEntries = Math.max(0, e.memoryEntries - 1);
    world.changed.push("Memory", "Employee");
    return noContent();
  },

  "GET hires": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    const status = req.query.get("status");
    if (status && !["proposed", "accepted", "declined"].includes(status)) throw invalid("status is one of proposed, accepted, declined.");
    return ok(world.hires.filter((h) => within(h.scope, scope) && (!status || h.status === status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((h) => withRoom(world, h)));
  },

  "GET hires/{id}": (req, { world }) => {
    const h = world.hires.find((x) => x.id === req.params.id);
    if (!h) throw notFound("The hire proposal");
    requireRole(world, h.scope, "viewer");
    return ok(withRoom(world, h));
  },

  "PATCH hires/{id}": (req, { world }) => {
    const h = world.hires.find((x) => x.id === req.params.id);
    if (!h) throw notFound("The hire proposal");
    requireRole(world, h.scope, "admin");
    if (h.status !== "proposed") throw conflict(`The proposal was ${h.status}; only an open proposal is edited.`);
    const expected = num(req.body, "expectedMonthlyCredits");
    if (expected !== undefined && expected < 0) throw invalid("expectedMonthlyCredits is 0 or more.");
    validateJob(req.body.jobDescription as Record<string, unknown> | undefined);
    for (const k of ["name", "role", "reason"] as const) {
      const v = str(req.body, k);
      if (v !== undefined) h[k] = v;
    }
    const reportsTo = str(req.body, "reportsTo");
    if (reportsTo) {
      const m = world.employees.find((x) => x.id === reportsTo && orgOf(x.scope) === orgOf(h.scope) && x.status !== "released" && x.kind === "employee");
      if (!m) throw invalid("reportsTo names an employee of this organisation who is on the payroll.");
      h.reportsTo = { id: m.id, name: m.name };
    }
    if (req.body.clearReportsTo === true) h.reportsTo = null;
    if (req.body.clearMonthlyCreditLimit === true) h.jobDescription.monthlyCreditLimit = null;
    if (expected !== undefined) h.expectedMonthlyCredits = expected;
    applyJob(h, req.body.jobDescription as Record<string, unknown> | undefined);
    world.changed.push("Hire", "Tree");
    return ok(withRoom(world, h));
  },

  "POST hires/{id}/{decision}": (req, { world }) => {
    const h = world.hires.find((x) => x.id === req.params.id);
    if (!h) throw notFound("The hire proposal");
    requireRole(world, h.scope, "admin");
    if (h.status !== "proposed") throw conflict(`The proposal was already ${h.status}.`);
    const note = str(req.body, "note") ?? null;
    const by = me(world).displayName;
    if (req.params.decision === "accept") hireNow(world, h, "person", by, note);
    else if (req.params.decision === "decline") Object.assign(h, { status: "declined", decision: { via: "person", by, at: new Date().toISOString(), note } });
    else throw new Refusal(problem(404, "not_found", "Not found", "There is nothing at this address."));
    world.changed.push("Hire", "Tree", "Employee", "Ontology", "Notifications");
    return ok(h);
  },

  "POST hires": (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, "admin");
    const trigger = (str(req.body, "trigger") ?? "owner") as Hire["trigger"];
    if (!["division", "stage", "recurring", "promotion", "owner"].includes(trigger)) throw invalid("trigger is one of division, stage, recurring, promotion, owner.");
    const contractorRole = (str(req.body, "contractorRole") ?? "").trim();
    const needKey = str(req.body, "needKey") ?? (trigger === "promotion" && contractorRole ? `promotion:${scope}:${contractorRole.toLowerCase()}` : undefined);
    if (needKey !== undefined && (needKey.length < 1 || needKey.length > 200)) throw invalid("needKey is 1 to 200 characters, the same each time the same need is raised.");
    const same = needKey ? world.hires.find((x) => x.needKey === needKey && x.status !== "declined") : undefined;
    if (same) return ok(same);
    const expected = num(req.body, "expectedMonthlyCredits");
    if (expected === undefined || expected < 0) throw invalid("expectedMonthlyCredits is what the employee should cost a month, in credits (0 or more): shown before anyone accepts it.");
    for (const k of ["name", "role"] as const) {
      const v = (str(req.body, k) ?? "").trim();
      if (!v || v.length > 200) throw invalid(`An employee's ${k} is 1 to 200 characters.`);
    }
    const job = (req.body.jobDescription ?? {}) as Record<string, unknown>;
    validateJob(job);
    const reason = (str(req.body, "reason") ?? "").trim();
    if (!reason || reason.length > 4000) throw invalid("A hire proposal says why it is needed, in 1 to 4000 characters.");
    const room = headroom(world, scope);
    const h: Hire = {
      id: newId(world, "hire"),
      status: "proposed",
      trigger,
      needKey: needKey ?? null,
      scope,
      reason,
      name: (str(req.body, "name") ?? "").trim(),
      role: (str(req.body, "role") ?? "").trim(),
      jobDescription: { mandate: String(job.mandate ?? ""), scope, tools: strings(job, "tools"), services: strings(job, "services"), monthlyCreditLimit: typeof job.monthlyCreditLimit === "number" ? job.monthlyCreditLimit : null, modelTier: typeof job.modelTier === "string" ? job.modelTier : null },
      reportsTo: (() => {
        const id = str(req.body, "reportsTo");
        if (!id) return null;
        const m = world.employees.find((x) => x.id === id && orgOf(x.scope) === orgOf(scope) && x.status !== "released" && x.kind === "employee");
        if (!m) throw invalid("reportsTo names an employee of this organisation who is on the payroll.");
        return { id: m.id, name: m.name };
      })(),
      expectedMonthlyCredits: expected,
      withinBudget: expected <= room,
      headroomCredits: room,
      contractorRole: contractorRole ? contractorRole.slice(0, 200) : null,
      raisedBy: "person",
      raisedByRunId: null,
      decision: null,
      employeeId: null,
      createdAt: new Date().toISOString(),
    };
    world.hires.unshift(h);
    const checkpoints = world.settings.filter((s) => within(scope, s.path));
    const hireCheckpoint = checkpoints.some((s) => s.key === "checkpoint.hire" && s.value === "true") && checkpoints.some((s) => s.key === "autonomy" && s.value === "checkpoints");
    if (!hireCheckpoint && h.withinBudget) hireNow(world, h, "auto-mode", "auto-mode", "Within budget, so auto-mode hired.");
    world.changed.push("Hire", "Tree", "Employee");
    return created(h);
  },

  "GET ontology": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    const view = req.query.get("view") ?? "all";
    if (!["all", "org-chart", "data-flow"].includes(view)) throw invalid("view is all, org-chart, data-flow.");
    return ok(ontology(world, scope));
  },
});

function ontology(world: World, scope: string): Ontology {
  // `OntologyService.BuildAsync`: ids are "<kind>:<id>", and an app depends on a platform service only once it has used it.
  const nodes: OntologyNode[] = [];
  const edges: OntologyEdge[] = [];
  const keyOf = (path: string) => {
    const app = world.apps.find((a) => a.path === path);
    const n = world.nodes.find((x) => x.path === path);
    return app ? `app:${app.id}` : n ? `${n.level}:${n.id}` : null;
  };
  for (const n of world.nodes.filter((x) => within(x.path, scope))) {
    const app = world.apps.find((a) => a.path === n.path);
    if (n.level === "app" && !app) continue;
    const id = app ? `app:${app.id}` : `${n.level}:${n.id}`;
    nodes.push({ id, type: n.level, name: n.name, scope: n.path, status: app ? app.status : n.stage, attributes: app ? { version: app.version } : null });
    const parent = world.nodes.find((p) => n.path.startsWith(`${p.path}/`) && p.path.split("/").length === n.path.split("/").length - 1);
    if (parent) edges.push({ from: `${parent.level}:${parent.id}`, to: id, type: "owns", label: null });
  }
  for (const e of world.employees.filter((x) => within(x.scope, scope) && x.status !== "released")) {
    const id = `${e.kind}:${e.id}`;
    nodes.push({ id, type: e.kind, name: e.name, scope: e.scope, status: e.status, attributes: { role: e.role } });
    const at = keyOf(e.scope);
    if (at) edges.push({ from: id, to: at, type: "works-on", label: e.role });
    if (e.reportsTo) edges.push({ from: id, to: `employee:${e.reportsTo.id}`, type: "reports-to", label: null });
  }
  for (const s of world.secrets.filter((x) => within(x.path, scope))) {
    const id = `secret:${s.path}:${s.name}`;
    nodes.push({ id, type: "secret", name: s.name, scope: s.path, status: null, attributes: null });
    const owner = keyOf(s.path);
    if (owner) edges.push({ from: owner, to: id, type: "owns", label: null });
  }
  const service = (name: string) => {
    const id = `service:${name}`;
    if (!nodes.some((n) => n.id === id)) nodes.push({ id, type: "service", name, scope: null, status: null, attributes: null });
    return id;
  };
  for (const a of world.apps.filter((x) => within(x.path, scope))) {
    const id = `app:${a.id}`;
    if (world.spend.some((s) => s.path === a.path && s.ai > 0)) {
      edges.push({ from: id, to: service("models"), type: "depends-on", label: null }, { from: id, to: service("models"), type: "data-flows-to", label: "prompts" });
    }
    if (a.endUsers > 0 || world.shares.some((s) => s.appId === a.id) || (a.telemetry?.visitsToday ?? 0) > 0) {
      edges.push({ from: id, to: service("identity"), type: "depends-on", label: null }, { from: service("identity"), to: id, type: "data-flows-to", label: "signed-in people" });
    }
    if (a.telemetry) {
      edges.push({ from: id, to: service("telemetry"), type: "depends-on", label: null }, { from: id, to: service("telemetry"), type: "data-flows-to", label: "operational telemetry" });
    }
  }
  const orgChart = nodes.filter((n) => ["organisation", "division", "project", "app", "employee"].includes(n.type)).map((n) => n.id);
  const dataFlow = nodes.filter((n) => ["app", "service", "secret"].includes(n.type)).map((n) => n.id);
  return { scope, generatedAt: new Date().toISOString(), nodes, edges, views: { "org-chart": orgChart, "data-flow": dataFlow, all: nodes.map((n) => n.id) } };
}
