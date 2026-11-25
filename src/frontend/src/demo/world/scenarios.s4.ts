import type { Employee, Hire, MemoryEntry } from "@/store/types";
import { defineScript, settle, Script } from "../server/engine";
import { blankTrackRecord } from "../server/mutations";
import { headroom, hireNow } from "../server/routes/workforce";
import { ago, organisation, setting, uuidFor, type DemoRun, type World } from "../server/world";
import { IDS, ORG, PEOPLE } from "./default";
import { defineScenario, type Featured, type Scenario } from "./scenarios";

/**
 * The academy's workforce, credits and God-mode scenarios (docs/flows/04, lane S4): hiring with a
 * history, a manager who has gone, contractors working and finishing, an employee at work, at its
 * cap, idle and swept, memory worth tidying, the balance at zero and below it, top-up requests
 * piling up, and an operator log with every kind of entry. Each edits the default world; the
 * host registers them all with one import line.
 */

const day = 24 * 60;
const TECH = `${ORG}/technologies`;
const COURT = `${TECH}/court-booking`;
const id = {
  kasper: uuidFor(`employee:${COURT}:engineer`),
  mina: uuidFor(`employee:${COURT}:qa`),
  odile: uuidFor(`employee:${TECH}:lead`),
  ruth: uuidFor(`employee:${ORG}/learning/course-notes:engineer`),
  tomas: uuidFor(`employee:${ORG}/operations/stock-counter:engineer`),
  dov: uuidFor(`employee:${ORG}/operations:lead`),
  lark: uuidFor("hire:analyst"),
  solHire: uuidFor("hire:s4:sol"),
  sol: uuidFor("employee:s4:sol"),
  beaHire: uuidFor("hire:s4:bea"),
  contractor: uuidFor("contractor:s4:data"),
  reportRun: uuidFor("run:s4:weekly-report"),
  workRun: uuidFor("run:s4:league-blocks"),
  ivo: uuidFor("employee:s4:ivo"),
};

const FEATURED: Featured = { idea: IDS.ideaAllergen, run: IDS.runBuildReadingList, app: IDS.tableBookings, employee: id.kasper, hire: id.lark };

/** Nothing plays unless the scenario says so: the screens hold still while they are read. */
function quiet(w: World) {
  w.runs = w.runs.filter((r) => !r.playback);
  for (const e of w.employees) {
    if (e.currentRun && !w.runs.some((r) => r.run.id === e.currentRun?.id)) {
      e.currentRun = null;
      if (e.status === "working") e.status = "idle";
    }
  }
}

function emp(w: World, key: string): Employee {
  const e = w.employees.find((x) => x.id === key);
  if (!e) throw new Error(`no employee ${key} in the default world`);
  return e;
}

function record(w: World, employeeId: string) {
  let tr = w.trackRecords.find((t) => t.employeeId === employeeId);
  if (!tr) {
    tr = blankTrackRecord(employeeId);
    w.trackRecords.push(tr);
  }
  return tr;
}

function employee(w: World, e: Partial<Employee> & { id: string; name: string; role: string; scope: string }): Employee {
  const full: Employee = {
    kind: "employee",
    status: "idle",
    standing: null,
    reportsTo: null,
    briefedBy: null,
    jobDescription: { mandate: "", scope: e.scope, tools: ["read_file", "remember"], services: [], monthlyCreditLimit: null, modelTier: "research" },
    idle: { flagged: false, since: null, afterDays: 14 },
    currentRun: null,
    lastRunId: null,
    lastActiveAt: null,
    createdAt: ago(3 * day),
    releasedAt: null,
    memoryEntries: 0,
    brief: null,
    ...e,
  };
  w.employees.push(full);
  w.trackRecords.push(blankTrackRecord(full.id));
  return full;
}

// ---------------------------------------------------------------------------------------------
// Hiring
// ---------------------------------------------------------------------------------------------

/** Technologies' hiring with a history: Lark waiting, Sol hired by auto-mode, Bea declined by Mara. */
function hiring(w: World) {
  quiet(w);
  const odile = emp(w, id.odile);
  const sol = employee(w, {
    id: id.sol,
    name: "Sol",
    role: "Data engineer",
    scope: TECH,
    reportsTo: { id: odile.id, name: odile.name },
    jobDescription: { mandate: "Keep Technologies' booking and stock figures flowing into one weekly table the other employees can read.", scope: TECH, tools: ["read_file", "search", "notes", "remember"], services: ["telemetry"], monthlyCreditLimit: 60, modelTier: "research" },
  });
  const hire = (h: Partial<Hire> & Pick<Hire, "id" | "status" | "trigger" | "name" | "role" | "reason" | "expectedMonthlyCredits" | "createdAt">): Hire => ({
    needKey: null,
    scope: TECH,
    jobDescription: { mandate: "", scope: TECH, tools: [], services: [], monthlyCreditLimit: null, modelTier: null },
    reportsTo: { id: odile.id, name: odile.name },
    withinBudget: true,
    headroomCredits: 0,
    contractorRole: null,
    raisedBy: "runner",
    raisedByRunId: null,
    decision: null,
    employeeId: null,
    ...h,
  });
  w.hires.push(
    hire({
      id: id.solHire,
      status: "accepted",
      trigger: "stage",
      needKey: `stage:${TECH}:data`,
      name: sol.name,
      role: sol.role,
      reason: "Court booking reached the stage where its weekly figures are read by three employees; one who prepares them saves each of them the work.",
      jobDescription: { ...sol.jobDescription },
      expectedMonthlyCredits: 60,
      headroomCredits: 149.1,
      decision: { via: "auto-mode", by: "auto-mode", at: ago(3 * day), note: "Within budget, so auto-mode hired." },
      employeeId: sol.id,
      createdAt: ago(3 * day),
    }),
    hire({
      id: id.beaHire,
      status: "declined",
      trigger: "recurring",
      needKey: `recurring:${TECH}:copy`,
      name: "Bea",
      role: "Copywriter",
      reason: "Member texts — confirmations, reminders, the league table — were drafted by a contractor 4 times in 30 days.",
      jobDescription: { mandate: "Write every text a member reads, short and plain, for Odile to approve.", scope: TECH, tools: ["read_file", "notes", "remember"], services: [], monthlyCreditLimit: 40, modelTier: "chat" },
      expectedMonthlyCredits: 40,
      withinBudget: true,
      headroomCredits: 120.5,
      decision: { via: "person", by: PEOPLE.owner.displayName, at: ago(9 * day), note: "Odile writes the member texts herself for now." },
      createdAt: ago(10 * day),
    }),
  );
}

/** Every proposal decided: Lark too, declined by Ada. */
function hiresAllDecided(w: World) {
  hiring(w);
  const lark = w.hires.find((h) => h.id === id.lark);
  if (lark) Object.assign(lark, { status: "declined", decision: { via: "person", by: PEOPLE.admin.displayName, at: ago(2 * 60), note: "Not this month: Sol covers the weekly figures." } });
  w.notifications = w.notifications.filter((n) => n.subject?.id !== id.lark);
}

/** Lark was drafted to report to Tomas, who has since been let go. */
function hireManagerGone(w: World) {
  quiet(w);
  const lark = w.hires.find((h) => h.id === id.lark);
  const tomas = emp(w, id.tomas);
  if (lark) lark.reportsTo = { id: tomas.id, name: tomas.name };
}

// ---------------------------------------------------------------------------------------------
// Contractors
// ---------------------------------------------------------------------------------------------

const BRIEF = "Count booked minutes by weekday for the last four weeks and say which evenings have empty courts.";

/** Odile has briefed a data contractor, working now; Kasper and Mina report to her. */
function contractorWorking(w: World, runId: string | null = null) {
  quiet(w);
  const odile = emp(w, id.odile);
  w.employees.push({
    id: id.contractor,
    kind: "contractor",
    name: "Contractor",
    role: "Data contractor",
    status: "working",
    standing: null,
    scope: TECH,
    reportsTo: null,
    briefedBy: { id: odile.id, name: odile.name },
    jobDescription: { mandate: BRIEF, scope: TECH, tools: ["read_organisation", "ask_app"], services: ["telemetry"], monthlyCreditLimit: null, modelTier: "research" },
    idle: { flagged: false, since: null, afterDays: 14 },
    currentRun: runId ? { id: runId, title: "Weekly bookings report" } : null,
    lastRunId: null,
    lastActiveAt: ago(1),
    createdAt: ago(4),
    releasedAt: null,
    memoryEntries: 0,
    brief: BRIEF,
  });
  record(w, id.contractor);
  Object.assign(record(w, odile.id).contractors, { engaged: 7, working: 1, toDateCredits: 56.7, monthCredits: 56.7 });
}

/** The same, with the report it is part of playing: the contractor finishes, and the role is proposed. */
function contractorFinishes(w: World) {
  contractorWorking(w, id.reportRun);
  const odile = emp(w, id.odile);
  Object.assign(odile, { status: "working", currentRun: { id: id.reportRun, title: "Weekly bookings report" } });
  const at = ago(1);
  w.runs.push({
    run: { id: id.reportRun, kind: "task", title: "Weekly bookings report", scope: TECH, status: "running", startedAt: at, finishedAt: null, lastSeq: 1, ideaId: null, estimateCredits: 3, spentCredits: 0, employeeId: odile.id, conversationId: null, budgetExhausted: false, outcome: null, summary: null, canTryAgain: false, createdAt: at },
    events: [{ seq: 1, type: "message", at, payload: { from: "owner", text: "Write this week's bookings report for Technologies." } }],
    playback: { script: "s4-contractor-report", params: {}, elapsed: 0, cursor: 0 },
  });
}

/** `HireService.FinishContractorAsync`: the contractor leaves, its lesson goes to its briefer, and the recurring role is raised as a hire. */
function finishContractor(w: World, run: DemoRun) {
  const c = w.employees.find((e) => e.id === id.contractor);
  const odile = w.employees.find((e) => e.id === id.odile);
  if (!c || !odile || c.status === "released") return [];
  const at = new Date().toISOString();
  Object.assign(c, { status: "released", releasedAt: at, currentRun: null, lastRunId: run.run.id });
  Object.assign(record(w, odile.id).contractors, { working: 0 });
  const learned: MemoryEntry = { id: uuidFor("memory:s4:empty-courts"), employeeId: odile.id, scope: TECH, title: "Empty courts cluster on Tuesday and Wednesday", body: "Over the last four weeks, Tuesday and Wednesday evenings after 20:20 had the most empty courts; Friday and Sunday were full.", kind: "fact", sourceRunId: run.run.id, createdAt: at, updatedAt: at, lastReviewedAt: null, archived: false };
  w.memory.unshift(learned);
  w.memoryChanges.unshift({ id: uuidFor("change:s4:empty-courts"), memoryId: learned.id, action: "added", by: "employee", userId: null, runId: run.run.id, detail: { title: learned.title }, at });
  odile.memoryEntries = w.memory.filter((m) => m.employeeId === odile.id && !m.archived).length;
  const role = w.recurringRoles.find((r) => r.scope === TECH && r.role === c.role);
  if (role) Object.assign(role, { contractors: 7, costCredits: 56.7, lastBrief: BRIEF, lastBriefedBy: odile.name });
  if (role && !w.hires.some((h) => h.needKey === `promotion:${TECH}:${c.role.toLowerCase()}` && h.status !== "declined")) {
    const expected = Math.round(((role.costCredits * 30) / role.windowDays) * 100) / 100;
    const room = headroom(w, TECH);
    const h: Hire = {
      id: uuidFor("hire:s4:promotion"),
      status: "proposed",
      trigger: "promotion",
      needKey: `promotion:${TECH}:${c.role.toLowerCase()}`,
      scope: TECH,
      reason: `${role.contractors} ${c.role} contractors were briefed here in the last ${role.windowDays} days, costing ${role.costCredits} credits. Standing work is cheaper, and better remembered, done by an employee.`,
      name: c.role,
      role: c.role,
      jobDescription: { mandate: `The work ${odile.name} kept briefing contractors for. The latest brief: ${role.lastBrief}`, scope: TECH, tools: [...odile.jobDescription.tools], services: [...odile.jobDescription.services], monthlyCreditLimit: null, modelTier: odile.jobDescription.modelTier },
      reportsTo: { id: odile.id, name: odile.name },
      expectedMonthlyCredits: expected,
      withinBudget: expected <= room,
      headroomCredits: room,
      contractorRole: c.role,
      raisedBy: "runner",
      raisedByRunId: run.run.id,
      decision: null,
      employeeId: null,
      createdAt: at,
    };
    w.hires.unshift(h);
    const checkpoint = setting(w, TECH, "checkpoint.hire")?.value === "true" && setting(w, TECH, "autonomy")?.value === "checkpoints";
    if (!checkpoint && h.withinBudget) hireNow(w, h, "auto-mode", "auto-mode", "Within budget, so auto-mode hired.");
  }
  return ["Employee", "Tree", "Memory", "Hire", "Ontology", "Notifications"];
}

defineScript("s4-contractor-report", (_world, run) => {
  const s = new Script();
  s.event("run.started", { holder: "runner-demo-1" });
  s.wait(600).event("message", { from: "Odile", text: `Briefed a data contractor: ${BRIEF}` });
  s.wait(5200).effect((w) => finishContractor(w, run), "s4:contractor-finished");
  s.event("message", { from: "Odile", text: "The data contractor finished and handed back what it learned; I have it in my memory now." });
  s.wait(900).event("message", { from: "Odile", text: "This week: 412 bookings, Tuesday and Wednesday evenings had the most empty courts." });
  s.wait(300).effect((w) => {
    settle(w, id.odile, run.run.id);
    return ["Employee", "Tree"];
  });
  s.event("run.finished", { totals: { credits: 0, modelCalls: 0, nonBillableCredits: 0 }, outcome: "succeeded", summary: "The weekly report is written." });
  return s.steps;
});

// ---------------------------------------------------------------------------------------------
// An employee at work, at its cap, with reports; idle, swept, released with a memory
// ---------------------------------------------------------------------------------------------

/** Kasper working on league block bookings, live; it carries on until it is finished or paused. */
function employeeWorking(w: World) {
  quiet(w);
  const kasper = emp(w, id.kasper);
  const at = ago(2);
  Object.assign(kasper, { status: "working", currentRun: { id: id.workRun, title: "League block bookings: hold four courts for two hours" }, lastActiveAt: at });
  w.runs.push({
    run: { id: id.workRun, kind: "task", title: "League block bookings: hold four courts for two hours", scope: COURT, status: "running", startedAt: at, finishedAt: null, lastSeq: 1, ideaId: null, estimateCredits: 6, spentCredits: 0, employeeId: kasper.id, conversationId: null, budgetExhausted: false, outcome: null, summary: null, canTryAgain: false, createdAt: at },
    events: [{ seq: 1, type: "message", at, payload: { from: "owner", text: "League nights should hold four courts for two hours from the league's own minutes." } }],
    playback: { script: "s4-league-blocks", params: {}, elapsed: 0, cursor: 0 },
  });
}

defineScript("s4-league-blocks", (_world, run) => {
  const s = new Script();
  s.event("run.started", { holder: "runner-demo-1" });
  const lines = [
    "Reading how a booking takes minutes from a member's balance.",
    "A block booking takes its minutes from the league's own balance, never a member's.",
    "Four courts, two hours: 12 slots of 40 minutes, held as one booking.",
    "Writing the check that a league cannot book past its balance.",
    "Running the booking tests: 48 passed.",
  ];
  for (const text of lines) s.wait(9000).event("message", { from: "Kasper", text });
  s.wait(4000).effect((w) => {
    settle(w, id.kasper, run.run.id);
    return ["Employee", "Tree"];
  });
  s.event("run.finished", { totals: { credits: 0, modelCalls: 0, nonBillableCredits: 0 }, outcome: "succeeded", summary: "League block bookings are in." });
  return s.steps;
});

/** Kasper's record with work behind it: the tasks it claimed, and the last piece of work it did. */
function employeeRecord(w: World) {
  quiet(w);
  const kasper = emp(w, id.kasper);
  const last = w.runs.find((r) => r.run.scope.startsWith(COURT) && r.run.status === "finished");
  kasper.lastRunId = last?.run.id ?? null;
  const task = (key: string, title: string, status: "done" | "in_progress" | "failed", estimate: number | null, actual: number | null, mins: number) =>
    w.tasks.push({ id: uuidFor(`task:s4:${key}`), scope: COURT, runId: last?.run.id ?? null, parentTaskId: null, title, description: title, status, holderRunId: null, holderEmployeeId: null, employeeId: kasper.id, claimedAt: ago(mins), estimateCredits: estimate, actualCredits: actual, dependsOn: [], createdAt: ago(mins), updatedAt: ago(mins - 30) });
  task("reminders", "Reminder texts in the club's local time", "done", 4, 3.1, 9 * day);
  task("waiting", "Waiting list when every court is taken", "done", 6, 8.4, 27 * day);
  task("confirm", "Shorter booking confirmations", "done", 2, 1.6, 19 * day);
  task("league", "League block bookings", "in_progress", 6, null, 2 * 60);
}

/** Mina reports to Kasper, so letting Kasper go moves her up. */
function team(w: World) {
  quiet(w);
  const kasper = emp(w, id.kasper);
  emp(w, id.mina).reportsTo = { id: kasper.id, name: kasper.name };
}

/** Kasper has spent his whole monthly budget, and was told so. */
function employeeAtCap(w: World) {
  quiet(w);
  const kasper = emp(w, id.kasper);
  kasper.jobDescription.monthlyCreditLimit = 190;
  record(w, kasper.id).cost.monthCredits = 190;
  w.notifications.unshift({ id: uuidFor("notification:s4:kasper-cap"), kind: "budget.cap", severity: "urgent", title: "Kasper reached their monthly budget", detail: "190 of 190 credits spent this month. They stop until it is raised or the month turns.", scope: COURT, subject: { kind: "employee", id: kasper.id }, createdAt: ago(25), read: false, emailedAt: null, organisation: ORG });
}

/** Learning works under checkpoints, so idle Ruth is held for a person; Ivo, idle in Operations under auto-mode, was let go by the sweep an hour ago. */
function idleSweep(w: World) {
  quiet(w);
  w.settings.push({ path: `${ORG}/learning`, key: "autonomy", value: "checkpoints" });
  const dov = emp(w, id.dov);
  const ivo = employee(w, { id: id.ivo, name: "Ivo", role: "Content writer", scope: `${ORG}/operations`, reportsTo: { id: dov.id, name: dov.name }, status: "released", releasedAt: ago(60), lastActiveAt: ago(17 * day), createdAt: ago(40 * day), idle: { flagged: true, since: ago(17 * day), afterDays: 14 }, jobDescription: { mandate: "Write the shop's product notes and the weekly specials board.", scope: `${ORG}/operations`, tools: ["read_file", "notes", "remember"], services: [], monthlyCreditLimit: 80, modelTier: "chat" } });
  const m: MemoryEntry = { id: uuidFor("memory:s4:ivo"), employeeId: ivo.id, scope: ivo.scope, title: "Specials go up on Thursday", body: "The specials board is written on Wednesday and goes up on Thursday morning.", kind: "practice", sourceRunId: null, createdAt: ago(30 * day), updatedAt: ago(30 * day), lastReviewedAt: null, archived: true };
  w.memory.push(m);
  w.memoryChanges.unshift({ id: uuidFor("change:s4:ivo:archived"), memoryId: null, action: "archived", by: "platform", userId: null, runId: null, detail: { reason: "released" }, at: ago(60) }, { id: uuidFor("change:s4:ivo:added"), memoryId: m.id, action: "added", by: "employee", userId: null, runId: null, detail: { title: m.title }, at: ago(30 * day) });
}

/** Tomas, let go six days ago, with the memory that comes back when he is rehired. */
function releasedWithMemory(w: World) {
  quiet(w);
  const tomas = emp(w, id.tomas);
  const add = (key: string, title: string, body: string, kind: MemoryEntry["kind"], mins: number) => {
    const m: MemoryEntry = { id: uuidFor(`memory:s4:tomas:${key}`), employeeId: tomas.id, scope: tomas.scope, title, body, kind, sourceRunId: null, createdAt: ago(mins), updatedAt: ago(mins), lastReviewedAt: null, archived: true };
    w.memory.push(m);
    w.memoryChanges.push({ id: uuidFor(`change:s4:tomas:${key}`), memoryId: m.id, action: "added", by: "employee", userId: null, runId: null, detail: { title }, at: ago(mins) });
  };
  add("count", "Stock is counted on Monday mornings", "The weekly count happens before the café opens on Monday; the app must be fast on the stockroom tablet.", "fact", 20 * day);
  add("units", "Flour is counted in sacks, milk in crates", "Each item keeps the unit it is bought in; never convert to kilograms on screen.", "practice", 15 * day);
  w.memoryChanges.unshift({ id: uuidFor("change:s4:tomas:archived"), memoryId: null, action: "archived", by: "platform", userId: null, runId: null, detail: { reason: "released" }, at: ago(6 * day) });
}

// ---------------------------------------------------------------------------------------------
// Memory worth tidying
// ---------------------------------------------------------------------------------------------

/** Kasper learned the slot length again on a task, so a review has something to merge. */
function memoryToTidy(w: World) {
  quiet(w);
  const kasper = emp(w, id.kasper);
  const run = w.runs.find((r) => r.run.scope.startsWith(COURT) && r.run.status === "finished") ?? w.runs.find((r) => r.run.status === "finished");
  const at = ago(2 * day);
  const m: MemoryEntry = { id: uuidFor("memory:s4:slots-again"), employeeId: kasper.id, scope: COURT, title: "Courts are booked in 40-minute slots", body: "A booking is always one or more 40-minute slots; the first slot starts at 06:20.", kind: "fact", sourceRunId: run?.run.id ?? null, createdAt: at, updatedAt: at, lastReviewedAt: null, archived: false };
  w.memory.unshift(m);
  w.memoryChanges.unshift({ id: uuidFor("change:s4:slots-again"), memoryId: m.id, action: "added", by: "employee", userId: null, runId: run?.run.id ?? null, detail: { title: m.title }, at });
  kasper.memoryEntries = w.memory.filter((x) => x.employeeId === kasper.id && !x.archived).length;
  // And Mara once told him to forget something that stopped being true.
  const gone = uuidFor("memory:s4:court-four");
  (w.removedMemory ??= {})[gone] = kasper.id;
  w.memoryChanges.push({ id: uuidFor("change:s4:court-four"), memoryId: gone, action: "removed", by: "person", userId: PEOPLE.owner.id, runId: null, detail: { title: "Court 4 is closed on Mondays", body: "Court 4 is closed every Monday for repairs.", why: "Court 4 reopened after the repairs." }, at: ago(12 * day) });
}

// ---------------------------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------------------------

function balance(w: World, credits: number) {
  quiet(w);
  const o = organisation(w, ORG);
  if (o) o.balance = credits;
}

/** Five top-up requests from Northwind already wait for FrostAura. */
function topUpsWaiting(w: World) {
  quiet(w);
  const amounts: [number, string, number][] = [
    [500, "The autumn courses start next week.", 4 * 60],
    [300, "Stock Counter is paused; we need it for Monday's count.", 3 * 60],
    [800, "League season: Court booking is busier than ever.", 2 * 60],
    [250, "", 90],
    [400, "For the cookery club's first month.", 40],
  ];
  amounts.forEach(([credits, note, mins], i) =>
    w.topUpRequests.unshift({ id: uuidFor(`tur:s4:${i}`), organisation: ORG, organisationName: "Northwind", credits, note, status: "open", requestedBy: PEOPLE.owner.displayName, requestedByEmail: PEOPLE.owner.email, requestedAt: ago(mins), closedAt: null, closeNote: null, topUpEntryId: null }),
  );
}

// ---------------------------------------------------------------------------------------------
// The operator log, as the Owner reads it
// ---------------------------------------------------------------------------------------------

/** Every kind of entry FrostAura's operators leave in Northwind's log, newest first. */
function operatorLog(w: World) {
  quiet(w);
  const operator = { id: PEOPLE.operator.id, email: PEOPLE.operator.email, displayName: PEOPLE.operator.displayName };
  const entry = (key: string, mins: number, action: string, detail: Record<string, unknown>) => ({ id: uuidFor(`op:s4:${key}`), organisation: ORG, at: ago(mins), action, operator, detail });
  w.operatorLog.push(entry("screened", 62 * day + 1, "organisation.screened", { method: "model", result: "clear", line: null, reason: "It crosses none of the red lines: what it does harms no one and watches no one.", by: PEOPLE.operator.id }));
  w.operatorLog.sort((a, b) => b.at.localeCompare(a.at));
  w.operatorLog.unshift(
    entry("pricing", 30, "pricing.changed", { margin: 1.25, creditsPerUsd: 100 }),
    entry("accepted", 2 * 60, "admin.POST-hires-id-accept", { title: "Accepted a hire", scope: ORG, method: "POST", path: `/api/hires/${id.lark}/accept` }),
    entry("cap", 2 * 60 + 2, "admin.PUT-cascade", { title: "Set a budget", scope: ORG, method: "PUT", path: "/api/cascade" }),
    entry("entered", 2 * 60 + 5, "organisation.entered", { scope: ORG }),
    entry("declined", 3 * day, "topup_request.declined", { credits: 5000, note: "Five thousand at once is more than a month's pace; ask for 2,000 and we'll add it today." }),
    entry("overdraft", 5 * day, "overdraft.set", { credits: 1000 }),
  );
}

/** Nobody from FrostAura has ever been in. */
function operatorLogEmpty(w: World) {
  quiet(w);
  w.operatorLog = w.operatorLog.filter((x) => x.organisation !== ORG);
}

/**
 * Registered by one import in `host.ts` (not `scenarios.ts`: this file calls its `defineScenario`, so
 * it must run after it); the names carry `s4-` so another file's scenarios never collide.
 */
const SCENARIOS_S4: [Scenario, ...string[]][] = [
  [{ name: "s4-hiring", title: "Hiring with a history: one waiting, one hired by auto-mode, one declined", apply: hiring, route: `/hires?scope=${TECH}`, featured: { ...FEATURED, hire: id.solHire, employee: id.sol } }],
  [{ name: "s4-hires-all-decided", title: "Hiring with every proposal decided", apply: hiresAllDecided, route: `/hires?scope=${TECH}`, featured: { ...FEATURED, hire: id.lark } }],
  [{ name: "s4-hire-manager-gone", title: "A hire drafted to report to someone since let go", apply: hireManagerGone, route: "/hires/{hire}", featured: FEATURED }],
  [{ name: "s4-contractor-working", title: "A contractor at work, briefed by Odile", apply: (w) => contractorWorking(w), route: "/employees/{employee}", featured: { ...FEATURED, employee: id.odile } }],
  [{ name: "s4-contractor-finishes", title: "A contractor finishes, and its recurring role is proposed as a hire", apply: contractorFinishes, route: "/employees/{employee}", featured: { ...FEATURED, employee: id.odile, run: id.reportRun } }],
  [{ name: "s4-employee-working", title: "Kasper at work on league block bookings", apply: employeeWorking, route: "/employees/{employee}", featured: { ...FEATURED, run: id.workRun } }],
  [{ name: "s4-employee-record", title: "Kasper's record, with the work behind it", apply: employeeRecord, route: "/employees/{employee}", featured: FEATURED }],
  [{ name: "s4-employee-team", title: "Kasper with Mina reporting to him", apply: team, route: "/employees/{employee}", featured: FEATURED }],
  [{ name: "s4-employee-at-cap", title: "Kasper has spent his monthly budget", apply: employeeAtCap, route: "/employees/{employee}", featured: FEATURED }],
  [{ name: "s4-idle-sweep", title: "An idle employee held for you, and one auto-mode let go", apply: idleSweep, route: "/", featured: { ...FEATURED, employee: id.ruth } }],
  [{ name: "s4-released-with-memory", title: "Tomas, let go with his memory archived", apply: releasedWithMemory, route: "/employees/{employee}", featured: { ...FEATURED, employee: id.tomas } }],
  [{ name: "s4-memory-to-tidy", title: "Kasper's memory, with a note learned twice", apply: memoryToTidy, route: "/employees/{employee}", featured: FEATURED }],
  [{ name: "s4-credits-at-zero", title: "The balance at exactly zero", apply: (w) => balance(w, 0), route: "/credits", featured: FEATURED }],
  [{ name: "s4-below-zero", title: "Below zero, inside the overdraft", apply: (w) => balance(w, -120), route: "/credits", featured: FEATURED }],
  [{ name: "s4-top-ups-waiting", title: "Five top-up requests already waiting", apply: topUpsWaiting, route: "/credits", featured: FEATURED }],
  [{ name: "s4-operator-log", title: "Northwind's operator log, with every kind of entry", apply: operatorLog, route: "/operator-access", featured: FEATURED }],
  [{ name: "s4-operator-log-empty", title: "Nobody from FrostAura has entered Northwind", apply: operatorLogEmpty, route: "/operator-access", featured: FEATURED }],
];

for (const [s, ...aliases] of SCENARIOS_S4) defineScenario(s, ...aliases);
