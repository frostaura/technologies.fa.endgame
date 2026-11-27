import type { AppTelemetry, Employee, Idea, MemoryEntry, RunEvent, RunningCost, SavedQuestion, TrackRecord } from "@/store/types";
import { blankTrackRecord, notEnoughHistory } from "../server/mutations";
import { titleOf } from "../server/http";
import { DEFAULT_PRICING, WORLD_VERSION, ago, uuidFor, type DemoApp, type DemoNode, type DemoRun, type World } from "../server/world";
import { STORIES, storyFor } from "./story";

/**
 * The default story world: Northwind, an invented squash and social club with a café, a
 * cookery school and a small shop, three divisions deep in Endgame — one idea being researched, verdicts of every
 * kind waiting, one app being built live, and live apps healthy, asleep, paused, crashed and never
 * measured. Two more organisations exist for God mode. Nothing here is a real company or person.
 */

export const ORG = "northwind";
export const PEOPLE = {
  owner: { id: uuidFor("user:mara"), displayName: "Mara Ellison", email: "mara@northwind.example" },
  admin: { id: uuidFor("user:ada"), displayName: "Ada Lovelace", email: "ada@northwind.example" },
  builder: { id: uuidFor("user:lena"), displayName: "Lena Fischer", email: "lena@northwind.example" },
  viewer: { id: uuidFor("user:priya"), displayName: "Priya Shah", email: "priya@northwind.example" },
  divisionAdmin: { id: uuidFor("user:ines"), displayName: "Ines Duarte", email: "ines@northwind.example" },
  operator: { id: uuidFor("user:nell"), displayName: "Nell Avery", email: "nell@frostaura.example" },
  invited: { id: uuidFor("user:tobi"), displayName: "Tobi Adeyemi", email: "tobi@northwind.example" },
  twoOrganisations: { id: uuidFor("user:kai"), displayName: "Kai Moreno", email: "kai@northwind.example" },
  quaysideOwner: { id: uuidFor("user:hal"), displayName: "Hal Bryce", email: "hal@quayside.example" },
  northfieldOwner: { id: uuidFor("user:rhea"), displayName: "Rhea Quill", email: "rhea@northfield.example" },
};

/** The invitation code the "invited" persona was sent (invented; shown in the demo strip). */
export const INVITATION_CODE = "LARK-7Q4M-2PXD";

export const IDS = {
  tableBookings: uuidFor("app:northwind/technologies/court-booking/web"),
  courseNotes: uuidFor("app:northwind/learning/course-notes/web"),
  tutorMatch: uuidFor("app:northwind/learning/tutor-match/web"),
  stockCounter: uuidFor("app:northwind/operations/stock-counter/web"),
  shiftRota: uuidFor("app:northwind/operations/shift-rota/web"),
  readingList: uuidFor("app:northwind/learning/book-club/web"),
  ideaReadingList: uuidFor("idea:reading-list"),
  ideaTides: uuidFor("idea:tides"),
  ideaAllergen: uuidFor("idea:allergen"),
  ideaCookery: uuidFor("idea:cookery"),
  ideaVans: uuidFor("idea:vans"),
  ideaLocator: uuidFor("idea:locator"),
  runResearchTides: uuidFor("run:research:tides"),
  runBuildReadingList: uuidFor("run:build:reading-list"),
};

const MONTH_DAY = () => new Date().getUTCDate();

export function defaultWorld(scenario = "default", persona = "owner"): World {
  const T = Date.now();
  const a = (m: number) => ago(m, T);
  const day = 24 * 60;
  const w: World = {
    version: WORLD_VERSION,
    scenario,
    persona,
    sessionUserId: PEOPLE.owner.id,
    entered: [],
    device: [PEOPLE.owner.id, PEOPLE.admin.id, PEOPLE.builder.id, PEOPLE.viewer.id, PEOPLE.divisionAdmin.id, PEOPLE.operator.id, PEOPLE.twoOrganisations.id],
    users: [
      { ...PEOPLE.owner, passkeys: 2, isOperator: false, invitation: null },
      { ...PEOPLE.admin, passkeys: 1, isOperator: false, invitation: null },
      { ...PEOPLE.builder, passkeys: 1, isOperator: false, invitation: null },
      { ...PEOPLE.viewer, passkeys: 1, isOperator: false, invitation: null },
      { ...PEOPLE.divisionAdmin, passkeys: 1, isOperator: false, invitation: null },
      { ...PEOPLE.operator, passkeys: 1, isOperator: true, invitation: null },
      { ...PEOPLE.invited, passkeys: 0, isOperator: false, invitation: { code: INVITATION_CODE, expiresAt: ago(-6 * day, T) } },
      { ...PEOPLE.quaysideOwner, passkeys: 1, isOperator: false, invitation: null },
      { ...PEOPLE.northfieldOwner, passkeys: 1, isOperator: false, invitation: null },
      { ...PEOPLE.twoOrganisations, passkeys: 1, isOperator: false, invitation: null },
    ],
    organisations: [
      { id: uuidFor("org:northwind"), slug: ORG, name: "Northwind", status: "active", createdAt: a(62 * day), balance: 1840.25, frostauraLimit: 1000, ownLimit: 800, lastActivityAt: a(1) },
      { id: uuidFor("org:quayside"), slug: "quayside", name: "Quayside Bakery", status: "active", createdAt: a(30 * day), balance: -212.4, frostauraLimit: 500, ownLimit: null, lastActivityAt: a(3 * 60) },
      { id: uuidFor("org:frostaura"), slug: "frostaura", name: "FrostAura", status: "active", createdAt: a(90 * day), balance: 0, frostauraLimit: 0, ownLimit: null, lastActivityAt: a(30) },
      { id: uuidFor("org:northfield"), slug: "northfield", name: "Northfield Tutors", status: "active", createdAt: a(21 * day), balance: -300, frostauraLimit: 300, ownLimit: null, lastActivityAt: a(26 * 60) },
    ],
    nodes: [],
    memberships: [
      { id: uuidFor("m:mara"), userId: PEOPLE.owner.id, path: ORG, role: "owner", grantedAt: a(62 * day) },
      { id: uuidFor("m:ada"), userId: PEOPLE.admin.id, path: ORG, role: "admin", grantedAt: a(55 * day) },
      { id: uuidFor("m:lena"), userId: PEOPLE.builder.id, path: ORG, role: "builder", grantedAt: a(40 * day) },
      { id: uuidFor("m:sam"), userId: PEOPLE.viewer.id, path: ORG, role: "viewer", grantedAt: a(33 * day) },
      { id: uuidFor("m:ines"), userId: PEOPLE.divisionAdmin.id, path: `${ORG}/technologies`, role: "admin", grantedAt: a(28 * day) },
      { id: uuidFor("m:tobi"), userId: PEOPLE.invited.id, path: `${ORG}/learning`, role: "builder", grantedAt: a(2 * 60) },
      { id: uuidFor("m:hal"), userId: PEOPLE.quaysideOwner.id, path: "quayside", role: "owner", grantedAt: a(30 * day) },
      { id: uuidFor("m:rhea"), userId: PEOPLE.northfieldOwner.id, path: "northfield", role: "owner", grantedAt: a(21 * day) },
      // FrostAura's own organisation: the operator's home, where top-up requests reach them.
      { id: uuidFor("m:nell"), userId: PEOPLE.operator.id, path: "frostaura", role: "owner", grantedAt: a(90 * day) },
      // Kai belongs to two organisations: a Builder at Northwind and an Admin at Quayside Bakery.
      { id: uuidFor("m:kai:northwind"), userId: PEOPLE.twoOrganisations.id, path: ORG, role: "builder", grantedAt: a(20 * day) },
      { id: uuidFor("m:kai:quayside"), userId: PEOPLE.twoOrganisations.id, path: "quayside", role: "admin", grantedAt: a(12 * day) },
    ],
    apps: [],
    ideas: [],
    runs: [],
    approvals: [],
    conversations: [],
    employees: [],
    trackRecords: [],
    memory: [],
    memoryChanges: [],
    hires: [],
    recurringRoles: [],
    tasks: [],
    spend: [],
    budgets: [],
    overdraftLimits: [],
    notCharged: { [ORG]: { credits: 6.82, repairs: 4 } },
    secrets: [],
    shares: [],
    dashboard: [],
    versions: {},
    notifications: [],
    suggestions: [],
    tokens: [],
    settings: [],
    ruleSets: [],
    topUpRequests: [],
    topUps: [],
    operatorLog: [],
    // Changed once, twenty days ago: the margin went from 1.2 to 1.25.
    pricing: { pricing: DEFAULT_PRICING, source: "stored", updatedAt: a(20 * day), updatedBy: PEOPLE.operator.displayName, history: [{ at: a(20 * day), by: PEOPLE.operator.displayName, byEmail: PEOPLE.operator.email, before: { ...DEFAULT_PRICING, margin: 1.2 }, after: DEFAULT_PRICING }] },
    counter: 0,
    changed: [],
  };

  // The tree ---------------------------------------------------------------------------------
  const n = (path: string, name: string, extra: Partial<DemoNode> = {}): DemoNode => {
    const level = (["organisation", "division", "project", "app"] as const)[path.split("/").length - 1] ?? "app";
    const nd: DemoNode = { id: uuidFor(`node:${path}`), path, slug: path.split("/").pop() ?? path, name, level, createdAt: a(50 * day), stage: level === "project" ? "live" : null, ideaId: null, note: null, ...extra };
    w.nodes.push(nd);
    return nd;
  };
  n(ORG, "Northwind");
  n(`${ORG}/technologies`, "Technologies");
  n(`${ORG}/learning`, "Learning");
  n(`${ORG}/operations`, "Operations");
  n(`${ORG}/technologies/court-booking`, "Court booking");
  n(`${ORG}/technologies/court-booking/web`, "Court booking");
  n(`${ORG}/learning/course-notes`, "Course Notes");
  n(`${ORG}/learning/course-notes/web`, "Course Notes");
  n(`${ORG}/learning/tutor-match`, "Tutor Match");
  n(`${ORG}/learning/tutor-match/web`, "Tutor Match");
  n(`${ORG}/operations/stock-counter`, "Stock Counter", { stage: "paused", note: "Paused: its monthly budget is spent." });
  n(`${ORG}/operations/stock-counter/web`, "Stock Counter");
  n(`${ORG}/operations/shift-rota`, "Shift Rota");
  n(`${ORG}/operations/shift-rota/web`, "Shift Rota");
  // Kept but not served: last summer's events, with history, so it can be archived and not deleted.
  n(`${ORG}/events`, "Events", { status: "archived" });
  n(`${ORG}/events/summer-ladder`, "Summer Ladder", { status: "archived", stage: "paused", note: "Archived." });
  // Nothing attached yet: this one can be deleted.
  n(`${ORG}/operations/gift-cards`, "Gift Cards", { stage: "planning" });
  for (const [slug, name] of [
    ["quayside", "Quayside Bakery"],
    ["quayside/shop", "Shop"],
    ["quayside/shop/orders", "Pre-orders"],
    ["quayside/shop/orders/web", "Pre-orders"],
    ["frostaura", "FrostAura"],
    ["northfield", "Northfield Tutors"],
    ["northfield/tuition", "Tuition"],
    ["northfield/tuition/homework", "Homework Planner"],
    ["northfield/tuition/homework/web", "Homework Planner"],
  ] as const)
    n(slug, name);

  // Apps -------------------------------------------------------------------------------------
  const tele = (visits: number, req: number, err: number, p50: number, p95: number, last: number): AppTelemetry => ({ visitsToday: visits, requestsToday: req, errorsToday: err, latencyP50Ms: p50, latencyP95Ms: p95, lastVisitAt: a(last) });
  const estimated = (sleep: number, on: number, hours: number): RunningCost => ({
    state: "estimated",
    windowDays: 14,
    minimumHours: 24,
    measuredHours: hours,
    basis: `From ${hours} hours of this app's own use in the last 14 days.`,
    prices: "Today's prices: 0.2 credits an awake hour, 0.4 per GB of memory an awake hour, 10 per GB stored a month and 20 per million requests.",
    sleep: { credits: sleep, awakeHoursPerMonth: Math.round((sleep / on) * 730), basis: "Awake only while it is used, then asleep after its idle time." },
    alwaysOn: { credits: on, awakeHoursPerMonth: 730, basis: "Awake every hour of the month." },
    measured: { awakeHours: Math.round(hours * 0.6), memoryMb: 210, storageMb: 340, requestsPerMonth: 48_000 },
  });
  const app = (path: string, name: string, x: Partial<DemoApp>): DemoApp => {
    const d: DemoApp = {
      id: uuidFor(`app:${path}`),
      path,
      name,
      health: "healthy",
      healthSummary: "Healthy.",
      running: "asleep",
      status: "running",
      pausedReason: null,
      access: "private",
      runningSetting: "sleep",
      idleMinutes: 15,
      telemetry: null,
      capCredits: null,
      version: uuidFor(`commit:${path}`).replace(/-/g, "").slice(0, 40),
      publishedAt: a(20 * day),
      endUsers: 0,
      runningCost: notEnoughHistory(0),
      ...x,
    };
    w.apps.push(d);
    return d;
  };
  app(`${ORG}/technologies/court-booking/web`, "Court booking", { running: "always-on", runningSetting: "always-on", access: "shared", healthSummary: "Healthy: 412 requests today, none failed.", telemetry: tele(186, 412, 0, 38, 210, 2), capCredits: 400, endUsers: 3, runningCost: estimated(9.4, 21.9, 310), publishedAt: a(41 * day) });
  app(`${ORG}/learning/course-notes/web`, "Course Notes", { running: "asleep", status: "sleeping", healthSummary: "Asleep; it wakes on the next visit.", telemetry: tele(4, 31, 0, 22, 140, 95), runningCost: estimated(2.1, 18.4, 96), publishedAt: a(33 * day) });
  app(`${ORG}/learning/tutor-match/web`, "Tutor Match", { running: "awake", healthSummary: "Running; nothing measured yet.", telemetry: null, publishedAt: a(40), runningCost: notEnoughHistory(0) });
  app(`${ORG}/operations/stock-counter/web`, "Stock Counter", { running: "paused", status: "stopped", pausedReason: "budget", health: "unknown", healthSummary: "Paused: a monthly budget above it is spent. Raising the budget or the new month restores it.", telemetry: tele(0, 0, 0, 0, 0, 3 * 60), runningCost: estimated(3.2, 17.9, 120), publishedAt: a(25 * day) });
  app(`${ORG}/operations/shift-rota/web`, "Shift Rota", { running: "awake", status: "failed", health: "down", healthSummary: "It crashed and visitors see an unavailable page. Its last good version can be restored from its history.", telemetry: tele(23, 96, 41, 51, 2900, 12), runningCost: estimated(4.8, 19.2, 150), publishedAt: a(12 * day) });
  app("quayside/shop/orders/web", "Pre-orders", { running: "asleep", status: "sleeping", healthSummary: "Asleep; it wakes on the next visit.", telemetry: tele(12, 80, 0, 30, 120, 40) });
  app("northfield/tuition/homework/web", "Homework Planner", { running: "paused", status: "stopped", pausedReason: "overdraft", health: "unknown", healthSummary: "Paused: the organisation reached its overdraft limit. A top-up restores it at once.", telemetry: tele(0, 0, 0, 0, 0, 26 * 60) });

  // Spending this month ------------------------------------------------------------------------
  const sp = (path: string, ai: number, hosting: number) => w.spend.push({ path, ai, hosting });
  sp(`${ORG}`, 61.4, 0);
  sp(`${ORG}/technologies`, 22.1, 0);
  sp(`${ORG}/technologies/court-booking/web`, 310.6, 14.3);
  // Research is charged where it ran: the division the idea was proposed to (nothing is placed until it is built).
  sp(`${ORG}/technologies`, 13.9, 0);
  sp(`${ORG}/learning/course-notes/web`, 44.9, 1.8);
  sp(`${ORG}/learning/tutor-match/web`, 88.2, 0.2);
  sp(`${ORG}/learning`, 11.3, 0);
  sp(`${ORG}/operations/stock-counter/web`, 116.8, 3.2);
  sp(`${ORG}/operations/shift-rota/web`, 71.5, 4.4);
  sp(`${ORG}/operations/van-tracker`, 8.7, 0);
  w.spend.push({ path: `${ORG}/events/summer-ladder`, ai: 0, hosting: 0 });
  sp("quayside/shop/orders/web", 140.2, 6.1);
  sp("northfield/tuition/homework/web", 96.4, 3.6);
  w.budgets.push({ path: `${ORG}/technologies`, cap: 450 }, { path: `${ORG}/learning`, cap: 400 }, { path: `${ORG}/operations/stock-counter`, cap: 120 }, { path: `${ORG}/technologies/court-booking/web`, cap: 400 });
  w.overdraftLimits.push({ path: `${ORG}/operations`, credits: 200, setAt: a(9 * day), setBy: PEOPLE.owner.id });
  w.topUps.push(
    { id: uuidFor("topup:1"), organisation: ORG, credits: 3000, note: "Opening balance", at: a(62 * day), by: PEOPLE.operator.displayName, byEmail: PEOPLE.operator.email, idempotencyKey: "k1" },
    { id: uuidFor("topup:2"), organisation: ORG, credits: 2000, note: "Top-up for the autumn courses", at: a(18 * day), by: PEOPLE.operator.displayName, byEmail: PEOPLE.operator.email, idempotencyKey: "k2" },
    { id: uuidFor("topup:3"), organisation: "quayside", credits: 1000, note: "Opening balance", at: a(30 * day), by: PEOPLE.operator.displayName, byEmail: PEOPLE.operator.email, idempotencyKey: "k3" },
    { id: uuidFor("topup:4"), organisation: "northfield", credits: 500, note: "Opening balance", at: a(21 * day), by: PEOPLE.operator.displayName, byEmail: PEOPLE.operator.email, idempotencyKey: "k4" },
  );
  w.topUpRequests.push(
    { id: uuidFor("tur:1"), organisation: "northfield", organisationName: "Northfield Tutors", credits: 1500, note: "Term starts Monday; the homework planner must be back up.", status: "open", requestedBy: PEOPLE.northfieldOwner.displayName, requestedByEmail: PEOPLE.northfieldOwner.email, requestedAt: a(5 * 60), closedAt: null, closeNote: null, topUpEntryId: null },
    { id: uuidFor("tur:2"), organisation: ORG, organisationName: "Northwind", credits: 2000, note: "Top-up for the autumn courses", status: "fulfilled", requestedBy: PEOPLE.owner.displayName, requestedByEmail: PEOPLE.owner.email, requestedAt: a(19 * day), closedAt: a(18 * day), closeNote: "Done — enjoy the autumn term.", topUpEntryId: uuidFor("topup:2") },
  );

  // The workforce ------------------------------------------------------------------------------
  const emp = (key: string, e: Partial<Employee> & { name: string; role: string; scope: string }, record: Partial<TrackRecord> = {}): Employee => {
    const id = uuidFor(`employee:${key}`);
    const full: Employee = {
      id,
      kind: "employee",
      status: "idle",
      standing: null,
      reportsTo: null,
      briefedBy: null,
      jobDescription: { mandate: `Look after ${e.scope.split("/").pop() ?? e.scope}.`, scope: e.scope, tools: ["read_file", "remember"], services: ["identity", "models", "telemetry"], monthlyCreditLimit: 600, modelTier: "build" },
      idle: { flagged: false, since: null, afterDays: 14 },
      currentRun: null,
      lastRunId: null,
      lastActiveAt: a(3 * 60),
      createdAt: a(45 * day),
      releasedAt: null,
      memoryEntries: 0,
      brief: null,
      ...e,
    };
    w.employees.push(full);
    w.trackRecords.push({ ...blankTrackRecord(id), ...record });
    return full;
  };
  emp(`${ORG}:security`, { name: "Security reviewer", role: "Security reviewer", scope: ORG, standing: "security-reviewer", jobDescription: { mandate: "Review every app before it is published, against the security checklist. Never changes code.", scope: ORG, tools: ["read_file", "search", "git_diff", "load_skill", "remember"], services: [], monthlyCreditLimit: null, modelTier: "evaluate" }, createdAt: a(62 * day) }, { work: { accepted: 0, sentBack: 0, acceptedPercent: null, judged: 9 }, runs: { finished: 9, succeeded: 9, failed: 0, cancelled: 0 }, cost: { toDateCredits: 31.2, monthCredits: 6.4 } });
  const wren = emp(`${ORG}:researcher`, { name: "Wren", role: "Market researcher", scope: ORG, jobDescription: { mandate: "Research every idea before anything is built: who already does it, what they leave undone, and whether people would pay.", scope: ORG, tools: ["web_search", "read_page", "brief_contractor", "notes", "remember"], services: ["models"], monthlyCreditLimit: 400, modelTier: "research" } }, { runs: { finished: 11, succeeded: 11, failed: 0, cancelled: 0 }, cost: { toDateCredits: 188.4, monthCredits: 61.4 }, contractors: { engaged: 33, working: 0, toDateCredits: 142.1, monthCredits: 44.9 }, estimates: { pieces: 11, withinPercent: 45, under: 9, over: 2, largestMissPercent: 58, typicalGapPercent: -41, typically: "under" } });
  const odile = emp(`${ORG}/technologies:lead`, { name: "Odile", role: "Division lead", scope: `${ORG}/technologies`, jobDescription: { mandate: "Answer for Technologies: its people, its budget and its work.", scope: `${ORG}/technologies`, tools: ["read_organisation", "propose_hire", "brief_contractor", "remember"], services: [], monthlyCreditLimit: 100, modelTier: "research" } }, { cost: { toDateCredits: 22.1, monthCredits: 22.1 } });
  const kasper = emp(`${ORG}/technologies/court-booking:engineer`, { name: "Kasper", role: "Software engineer", scope: `${ORG}/technologies/court-booking`, reportsTo: { id: odile.id, name: odile.name }, jobDescription: { mandate: "Build and maintain Court booking.", scope: `${ORG}/technologies/court-booking`, tools: ["read_file", "list_files", "search", "edit_file", "write_file", "run", "git_diff", "git_commit", "load_skill", "remember"], services: ["identity", "models", "secrets", "email", "telemetry"], monthlyCreditLimit: 1500, modelTier: "build" } }, { work: { accepted: 14, sentBack: 2, acceptedPercent: 88, judged: 0 }, runs: { finished: 6, succeeded: 6, failed: 0, cancelled: 0 }, repairsNotCharged: { credits: 3.9, calls: 11 }, cost: { toDateCredits: 402.7, monthCredits: 188.3 }, estimates: { pieces: 16, withinPercent: 38, under: 12, over: 4, largestMissPercent: 64, typicalGapPercent: -36, typically: "under" } });
  emp(`${ORG}/technologies/court-booking:qa`, { name: "Mina", role: "QA engineer", scope: `${ORG}/technologies/court-booking`, reportsTo: { id: odile.id, name: odile.name }, jobDescription: { mandate: "Check Court booking' work against its plan, sceptically, before it ships.", scope: `${ORG}/technologies/court-booking`, tools: ["read_file", "list_files", "search", "run", "git_diff", "check_preview", "remember"], services: ["identity", "telemetry"], monthlyCreditLimit: 600, modelTier: "evaluate" } }, { work: { accepted: 0, sentBack: 0, acceptedPercent: null, judged: 16 }, runs: { finished: 6, succeeded: 6, failed: 0, cancelled: 0 }, cost: { toDateCredits: 96.1, monthCredits: 41.2 } });
  const pell = emp(`${ORG}/learning:lead`, { name: "Pell", role: "Division lead", scope: `${ORG}/learning`, jobDescription: { mandate: "Answer for Learning: its people, its budget and its work.", scope: `${ORG}/learning`, tools: ["read_organisation", "propose_hire", "brief_contractor", "remember"], services: [], monthlyCreditLimit: 100, modelTier: "research" } });
  const ruth = emp(`${ORG}/learning/course-notes:engineer`, { name: "Ruth", role: "Software engineer", scope: `${ORG}/learning/course-notes`, reportsTo: { id: pell.id, name: pell.name }, idle: { flagged: true, since: a(16 * day), afterDays: 14 }, lastActiveAt: a(16 * day) }, { work: { accepted: 7, sentBack: 1, acceptedPercent: 88, judged: 0 }, runs: { finished: 3, succeeded: 3, failed: 0, cancelled: 0 }, cost: { toDateCredits: 120.4, monthCredits: 0 } });
  emp(`${ORG}/learning/tutor-match:engineer`, { name: "Juniper", role: "Software engineer", scope: `${ORG}/learning/tutor-match`, reportsTo: { id: pell.id, name: pell.name }, lastActiveAt: a(40) }, { work: { accepted: 4, sentBack: 0, acceptedPercent: 100, judged: 0 }, runs: { finished: 1, succeeded: 1, failed: 0, cancelled: 0 }, cost: { toDateCredits: 88.2, monthCredits: 88.2 } });
  const dov = emp(`${ORG}/operations:lead`, { name: "Dov", role: "Division lead", scope: `${ORG}/operations` });
  emp(`${ORG}/operations/shift-rota:engineer`, { name: "Sana", role: "Software engineer", scope: `${ORG}/operations/shift-rota`, reportsTo: { id: dov.id, name: dov.name } }, { work: { accepted: 5, sentBack: 1, acceptedPercent: 83, judged: 0 }, runs: { finished: 2, succeeded: 2, failed: 0, cancelled: 0 }, cost: { toDateCredits: 71.5, monthCredits: 71.5 } });
  emp(`${ORG}/operations/stock-counter:engineer`, { name: "Tomas", role: "Software engineer", scope: `${ORG}/operations/stock-counter`, status: "released", releasedAt: a(6 * day), reportsTo: { id: dov.id, name: dov.name } }, { work: { accepted: 6, sentBack: 0, acceptedPercent: 100, judged: 0 }, runs: { finished: 2, succeeded: 2, failed: 0, cancelled: 0 }, cost: { toDateCredits: 116.8, monthCredits: 0 } });
  for (const [k, slug, name, role] of [
    ["q1", "quayside", "Security reviewer", "Security reviewer"],
    ["q2", "quayside/shop/orders", "Pip", "Software engineer"],
    ["n1", "northfield", "Security reviewer", "Security reviewer"],
    ["n2", "northfield/tuition/homework", "Cato", "Software engineer"],
  ] as const)
    emp(k, { name, role, scope: slug, standing: role === "Security reviewer" ? "security-reviewer" : null });

  // Memory: Kasper has a history of curated memory; Ruth has some too ------------------------
  const mem = (e: Employee, key: string, title: string, body: string, kind: MemoryEntry["kind"], mins: number, archived = false): MemoryEntry => {
    const m: MemoryEntry = { id: uuidFor(`memory:${key}`), employeeId: e.id, scope: e.scope, title, body, kind, sourceRunId: null, createdAt: a(mins), updatedAt: a(mins), lastReviewedAt: mins > 10 * day ? a(10 * day) : null, archived };
    w.memory.push(m);
    w.memoryChanges.push({ id: uuidFor(`change:${key}`), memoryId: m.id, action: "added", by: "employee", userId: null, runId: null, detail: { title }, at: a(mins) });
    return m;
  };
  mem(kasper, "k1", "Courts are booked in 40-minute slots", "Every court is sold in 40-minute playing slots from 06:20 to 22:20; members pay in playing minutes, never per booking. Mara confirmed it.", "fact", 30 * day);
  mem(kasper, "k2", "Every member-facing text goes past Odile", "Odile reads any text a member sees (confirmations, reminders) before it ships; propose the words in the plan.", "practice", 25 * day);
  const k3 = mem(kasper, "k3", "Mara prefers short confirmations", "Booking confirmations are two lines: when, and how to change it. No marketing.", "preference", 20 * day);
  mem(kasper, "k4", "Leagues book in blocks", "League nights hold four courts for two hours; a block booking takes the minutes from the league's own balance, and the app never stores card details.", "fact", 14 * day);
  mem(kasper, "k5", "Time zones bit us once", "A reminder job ran in UTC and texted members an hour early in summer. Always schedule in the club's local time.", "lesson", 9 * day);
  mem(ruth, "r1", "Course pages are read on phones", "Nearly every visit to Course Notes is from a phone at the counter; design for one hand.", "fact", 31 * day);
  mem(ruth, "r2", "Old term notes are archived, not deleted", "At the end of each term the notes move to the archive; tutors still look things up.", "practice", 28 * day, true);
  w.memoryChanges.push({ id: uuidFor("change:k3c"), memoryId: k3.id, action: "corrected", by: "person", userId: PEOPLE.owner.id, runId: null, detail: { before: { body: "Confirmations should be friendly and complete." }, after: { body: k3.body } }, at: a(19 * day) });
  w.memoryChanges.push({ id: uuidFor("change:kr"), memoryId: null, action: "reviewed", by: "review", userId: null, runId: null, detail: { reviewed: 5, merged: 1, removed: 0 }, at: a(10 * day) });
  for (const e of w.employees) e.memoryEntries = w.memory.filter((m) => m.employeeId === e.id && !m.archived).length;
  void wren;
  void ruth;

  // A pending hire and a recurring contractor role --------------------------------------------
  w.hires.push({
    id: uuidFor("hire:analyst"),
    status: "proposed",
    trigger: "recurring",
    needKey: `recurring:${ORG}/technologies:data`,
    scope: `${ORG}/technologies`,
    reason: "Technologies has briefed a data contractor 6 times in 30 days for booking and stock reports; a lasting analyst would know the numbers and cost less.",
    name: "Lark",
    role: "Data analyst",
    jobDescription: { mandate: "Answer Technologies' questions about court bookings, playing minutes and league nights from what its apps record; keep a short weekly report.", scope: `${ORG}/technologies`, tools: ["read_organisation", "ask_app", "remember"], services: ["telemetry", "models"], monthlyCreditLimit: 300, modelTier: "research" },
    reportsTo: { id: odile.id, name: odile.name },
    expectedMonthlyCredits: 300,
    withinBudget: false,
    headroomCredits: 102.6,
    contractorRole: "Data contractor",
    raisedBy: "runner",
    raisedByRunId: null,
    decision: null,
    employeeId: null,
    createdAt: a(7 * 60),
  });
  w.recurringRoles.push({ scope: `${ORG}/technologies`, role: "Data contractor", contractors: 6, windowDays: 30, costCredits: 48.6, lastBriefedBy: odile.name, lastBrief: "Count booked minutes by weekday for the last four weeks and say which evenings have empty courts." });

  // Ideas and their verdicts -----------------------------------------------------------------
  // Where each idea was proposed: its research ran there (an idea is placed in the tree only when it is built).
  const proposed = new Map<string, string>();
  const idea = (id: string, text: string, constraints: string[], scope: string, extra: Partial<Idea>): Idea => {
    proposed.set(id, scope);
    const i: Idea = {
      id,
      title: text.length > 120 ? `${text.slice(0, 117)}...` : text,
      text,
      constraints,
      status: "verdict",
      runId: uuidFor(`run:research:${id}`),
      scope,
      research: { estimatedCredits: 12, spentCredits: 9.8, by: wren.name },
      verdict: null,
      decision: null,
      record: { total: 0, build: 0, change: 0, doNotBuild: 0, overruled: [] },
      redLine: null,
      ...extra,
      history: extra.history ?? [],
      tryAgain: extra.tryAgain ?? null,
    };
    w.ideas.push(i);
    return i;
  };
  const verdicts = verdictDocs();
  idea(IDS.ideaAllergen, "Allergen labels for the kitchen: pick a dish, print its allergen label with today's date and use-by.", ["Works on the kitchen tablet"], `${ORG}/technologies`, { scope: null,  verdict: verdicts.build as never });
  idea(IDS.ideaCookery, "Paid online bookings for the kids' cookery club, with a parent account for each family.", ["Parents pay when they book"], `${ORG}/learning`, { scope: null,  verdict: verdicts.change as never });
  idea(IDS.ideaVans, "A live map of our two delivery vans for customers waiting on an order.", [], `${ORG}/operations`, { scope: null,  verdict: verdicts.doNotBuild as never });
  idea(IDS.ideaLocator, "Track where staff go after their shift from their phones, so we know if they work for competitors.", [], `${ORG}/technologies`, { scope: null,  verdict: verdicts.redLine as never, redLine: "surveillance" });
  idea(IDS.ideaTides, "A tide-times board for the harbour café: the next high and low water beside our opening hours, on the screen by the door.", ["Readable from across the room"], `${ORG}/learning`, { scope: null,  status: "researching", verdict: null, research: { estimatedCredits: 12, spentCredits: 0, by: wren.name }, runId: IDS.runResearchTides });
  const rl = idea(IDS.ideaReadingList, "A reading list for the supper club: members sign in, add books with a title, author and a one-line note, mark a book as reading or finished, and see what everyone is reading now.", ["Members sign in", "Works on a phone"], ORG, {
    status: "decided",
    verdict: { ...STORIES["reading-list"]?.verdict, method: { strands: (STORIES["reading-list"]?.strands ?? []).map((s) => ({ id: s.id, title: s.title, sources: s.sources.length + 4, searches: 7, confidence: "high" })), searches: 14, confidence: "high" } } as never,
    decision: { choice: "build", at: a(2), by: PEOPLE.owner.displayName, overruled: false, runId: IDS.runBuildReadingList, via: "person" },
    research: { estimatedCredits: 12, spentCredits: 10.4, by: wren.name },
  });
  void rl;
  // Finished research runs behind each verdict, so "how research got there" opens.
  for (const i of w.ideas.filter((x) => x.verdict)) w.runs.push(historicResearch(i, a, storyFor(i.text, i.id === IDS.ideaReadingList ? "reading-list" : null).strands, proposed.get(i.id) ?? ORG));

  // Finished builds behind the live apps ------------------------------------------------------
  for (const x of w.apps) w.runs.push(historicBuild(x, w.nodes.find((n) => n.path === x.path.split("/").slice(0, 2).join("/"))?.name ?? "its division", a(Number(new Date(T).getTime() - new Date(x.publishedAt ?? a(0)).getTime()) / 60000 + 25), x.publishedAt ?? a(0)));

  // Versions for Court booking and Shift Rota -----------------------------------------------
  // As the control plane lists them (`AppVersionService.ListAsync`, R2-4): only versions that were live, each with its
  // plain title (what was asked for) and the raw commit message beside it; the newest is live and current.
  const versions = (appId: string, list: [string, number, "employee" | "person" | "factory", string, string?][]) => {
    w.versions[appId] = list.map(([title, mins, kind, name, message], i) => ({ commit: uuidFor(`commit:${appId}:${i}`).replace(/-/g, "").slice(0, 40), message: message ?? title, at: a(mins), author: { kind, id: kind === "employee" ? kasper.id : kind === "person" ? PEOPLE.owner.id : null, name }, live: i === 0, current: i === 0, title, runId: null }));
  };
  versions(IDS.tableBookings, [
    ["League block bookings", 2 * day, "employee", "Kasper", "league-blocks: book a court for a league night every week"],
    ["Reminder texts in the club's local time", 9 * day, "employee", "Kasper"],
    ["Shorter booking confirmations", 19 * day, "employee", "Kasper"],
    ["Waiting list when every court is taken", 27 * day, "employee", "Kasper"],
    ["Security fix: a member sees only their own bookings", 40 * day, "employee", "Kasper"],
    ["Court booking: first version", 41 * day, "factory", "The factory"],
  ]);
  versions(IDS.shiftRota, [
    ["Swap requests between staff", 12 * day, "employee", "Sana"],
    ["Shift Rota: first version", 20 * day, "factory", "The factory"],
  ]);
  versions(IDS.courseNotes, [["Course Notes: first version", 33 * day, "factory", "The factory"]]);
  versions(IDS.tutorMatch, [["Tutor Match: first version", 40, "factory", "The factory"]]);
  versions(IDS.stockCounter, [["Stock Counter: first version", 25 * day, "factory", "The factory"]]);

  // Shares, secrets, dashboard, tokens ---------------------------------------------------------
  w.shares.push(
    { appId: IDS.tableBookings, email: "chef@northwind.example", invitedAt: a(30 * day), registered: true, code: "TB-91KD" },
    { appId: IDS.tableBookings, email: "frontofhouse@northwind.example", invitedAt: a(29 * day), registered: true, code: "TB-4XPA" },
    { appId: IDS.tableBookings, email: "weekend.cover@northwind.example", invitedAt: a(26 * 60), registered: false, code: "TB-7QW2" },
  );
  w.secrets.push(
    { path: ORG, name: "PAYMENTS_API_KEY", setAt: a(50 * day) },
    { path: ORG, name: "MAIL_SENDER_ADDRESS", setAt: a(50 * day) },
    { path: `${ORG}/technologies`, name: "RESERVATIONS_PARTNER_TOKEN", setAt: a(35 * day) },
    { path: `${ORG}/technologies/court-booking/web`, name: "SMS_GATEWAY_KEY", setAt: a(27 * day) },
    { path: `${ORG}/technologies/court-booking/web`, name: "PAYMENTS_API_KEY", setAt: a(3 * day) },
    { path: `${ORG}/learning`, name: "VIDEO_ROOM_KEY", setAt: a(20 * day) },
  );
  w.dashboard.push(...dashboard(a));
  w.tokens.push(
    { userId: PEOPLE.owner.id, id: uuidFor("token:desk"), name: "Mara's desktop assistant", organisation: ORG, role: "admin", prefix: "egp_7f3a", createdAt: a(20 * day), expiresAt: null, lastUsedAt: a(35), revokedAt: null, active: true },
    { userId: PEOPLE.owner.id, id: uuidFor("token:old"), name: "Old laptop", organisation: ORG, role: "builder", prefix: "egp_c19e", createdAt: a(50 * day), expiresAt: a(-40 * day), lastUsedAt: a(32 * day), revokedAt: a(31 * day), active: false },
  );

  // What each level says about itself ("What this is") ---------------------------------------
  w.context = [
    { path: ORG, key: "purpose", value: "Northwind is a squash and social club: eight courts, a café, a cookery school for children and a small shop. Members book courts in playing minutes.", setAt: a(60 * day) },
    { path: ORG, key: "tone", value: "Plain, friendly and short. Members read us on a phone between games.", setAt: a(58 * day) },
    { path: `${ORG}/technologies`, key: "audience", value: "Members, coaches and front-of-house staff; most use a phone at the courts.", setAt: a(40 * day) },
    { path: `${ORG}/technologies/court-booking`, key: "rules", value: "Courts are booked in 40-minute slots from 06:20 to 22:20. League nights hold four courts for two hours.", setAt: a(35 * day) },
    { path: `${ORG}/learning`, key: "audience", value: "Parents booking for children aged 7 to 14, and the tutors who teach them.", setAt: a(30 * day) },
  ];
  w.settings.push({ path: `${ORG}/technologies/court-booking/web`, key: "app_models.monthly_credits", value: "150" });
  w.spend.push({ path: `${ORG}/events/summer-ladder`, ai: 3.4, hosting: 0 });

  // Autonomy and rule sets --------------------------------------------------------------------
  w.settings.push({ path: ORG, key: "autonomy", value: "auto" }, { path: ORG, key: "checkpoint.hire", value: "true" }, { path: `${ORG}/operations`, key: "autonomy", value: "checkpoints" }, { path: `${ORG}/operations`, key: "checkpoint.plan", value: "true" });
  w.ruleSets.push(
    { path: ORG, stage: "all", deny: ["run(rm -rf *)", "run(git push*)"], ask: [], allow: [], checkpoints: [] },
    { path: ORG, stage: "build", deny: [], ask: ["run(npm install*)"], allow: ["run(make *)", "edit_file", "write_file"], checkpoints: [] },
    { path: `${ORG}/technologies`, stage: "build", deny: [], ask: ["run(npm install*)", "edit_file(api/Payments/*)"], allow: ["run(make *)", "edit_file"], checkpoints: [] },
  );

  // Notifications of every kind ----------------------------------------------------------------
  const note = (key: string, kind: string, severity: "info" | "urgent", title: string, detail: string, scope: string, subject: { kind: string; id: string } | null, mins: number, read: boolean) =>
    w.notifications.push({ id: uuidFor(`notification:${key}`), kind, severity, title, detail, scope, subject, createdAt: a(mins), read, emailedAt: severity === "urgent" ? a(mins) : null, organisation: scope.split("/")[0] ?? scope });
  note("verdict:allergen", "verdict", "info", "A verdict is waiting: Allergen labels for the kitchen: pick a dish, print its allergen label with today's date and use-by.", String(verdicts.build.summary), `${ORG}/technologies`, { kind: "idea", id: IDS.ideaAllergen }, 50, false);
  note("verdict:cookery", "verdict", "info", "A verdict is waiting: Paid online bookings for the kids' cookery club, with a parent account for each family.", String(verdicts.change.summary), `${ORG}/learning`, { kind: "idea", id: IDS.ideaCookery }, 3 * 60, false);
  note("verdict:locator", "verdict", "info", "A verdict is waiting: Track where staff go after their shift from their phones, so we know if they work for competitors.", String(verdicts.redLine.summary), `${ORG}/technologies`, { kind: "idea", id: IDS.ideaLocator }, 5 * 60, false);
  note("hire:analyst", "hire", "info", "Hire Lark as data analyst?", "Technologies has briefed a data contractor 6 times in 30 days for booking and stock reports; a lasting analyst would know the numbers and cost less.", `${ORG}/technologies`, { kind: "hire", id: uuidFor("hire:analyst") }, 7 * 60, false);
  note("budget.80:technologies", "budget.80", "info", "Technologies has used 80% of its monthly budget", `361.0 of 450 credits spent this month at ${ORG}/technologies.`, `${ORG}/technologies`, null, 20 * 60, false);
  note("budget.cap:stock", "budget.cap", "urgent", "Stock Counter reached its monthly budget", `120 of 120 credits spent this month at ${ORG}/operations/stock-counter. Work there stops until the budget is raised or the month turns.`, `${ORG}/operations/stock-counter`, { kind: "app", id: IDS.stockCounter }, 3 * 60, false);
  note("crashed:rota", "app.crashed", "urgent", "Shift Rota stopped working", "It crashed and visitors see an unavailable page. Its last good version can be restored from its history.", `${ORG}/operations/shift-rota/web`, { kind: "app", id: IDS.shiftRota }, 12, false);
  note("security:tb", "security.finding", "urgent", "The security review found 1 problem", 'In "Build: Court booking for the club". Publishing waits until they are fixed.', `${ORG}/technologies/court-booking`, null, 40 * day, true);
  note("credits.zero:old", "credits.zero", "urgent", "Credits have run out", "The balance is -3.2 credits. Work goes on into the overdraft of up to 800 credits; ask FrostAura for a top-up.", ORG, null, 19 * day, true);
  note("overdraft.half:old", "overdraft.half", "urgent", "Halfway to the overdraft limit", "The balance is -402 credits, of an overdraft limit of 800. At the limit, work stops and apps pause until a top-up.", ORG, null, 18.5 * day, true);
  note("approval:old", "approval", "info", "You approved “Agree the plan for Shift Rota?”", "3 parts, about 90 credits.", `${ORG}/operations/shift-rota`, null, 20 * day, true);
  // Answered long ago: the plan was approved, so the feed shows it as answered (D40).
  for (const n of w.notifications) if (n.id === uuidFor("notification:approval:old")) n.answered = true;
  w.notifications.unshift({ id: uuidFor("notification:topup.requested:north"), kind: "topup.requested", severity: "info", title: "Northfield Tutors asks for 1,500 credits", detail: "Term starts Monday; the homework planner must be back up.", scope: "frostaura", subject: { kind: "topup_request", id: uuidFor("tur:1") }, createdAt: a(5 * 60), read: false, emailedAt: null, organisation: "frostaura" });
  note("overdraft.limit:north", "overdraft.limit", "urgent", "The overdraft limit is reached: work has stopped and apps are paused", "The balance is -300 credits. Nothing is deleted; a top-up restores everything at once.", "northfield", null, 26 * 60, false);

  // Operator log ------------------------------------------------------------------------------
  w.operatorLog.push(
    { id: uuidFor("op:1"), organisation: ORG, at: a(62 * day), action: "organisation.provisioned", operator: { id: PEOPLE.operator.id, email: PEOPLE.operator.email, displayName: PEOPLE.operator.displayName }, detail: { ownerUserId: PEOPLE.owner.id } },
    { id: uuidFor("op:2"), organisation: ORG, at: a(62 * day), action: "credits.top_up", operator: { id: PEOPLE.operator.id, email: PEOPLE.operator.email, displayName: PEOPLE.operator.displayName }, detail: { credits: 3000, note: "Opening balance", entryId: uuidFor("topup:1") } },
    { id: uuidFor("op:3"), organisation: ORG, at: a(19 * day), action: "organisation.entered", operator: { id: PEOPLE.operator.id, email: PEOPLE.operator.email, displayName: PEOPLE.operator.displayName }, detail: { scope: ORG } },
    { id: uuidFor("op:4"), organisation: ORG, at: a(18 * day), action: "credits.top_up", operator: { id: PEOPLE.operator.id, email: PEOPLE.operator.email, displayName: PEOPLE.operator.displayName }, detail: { credits: 2000, note: "Top-up for the autumn courses", entryId: uuidFor("topup:2") } },
    { id: uuidFor("op:5"), organisation: ORG, at: a(18 * day), action: "topup_request.fulfilled", operator: { id: PEOPLE.operator.id, email: PEOPLE.operator.email, displayName: PEOPLE.operator.displayName }, detail: { requestId: uuidFor("tur:2"), credits: 2000, note: "Done — enjoy the autumn term." } },
  );

  // A conversation that happened earlier ------------------------------------------------------
  const convRun = uuidFor("run:conversation:earlier");
  w.conversations.push({ id: uuidFor("conversation:org"), scope: ORG, employeeId: null, runIds: [convRun] });
  w.runs.push({
    run: { id: convRun, kind: "conversation", title: "What did we spend on Court booking last month?", scope: ORG, status: "finished", startedAt: a(2 * day), finishedAt: a(2 * day - 1), lastSeq: 4, ideaId: null, estimateCredits: null, spentCredits: 0.03, employeeId: null, conversationId: uuidFor("conversation:org"), budgetExhausted: false, outcome: "succeeded", summary: "Replied.", createdAt: a(2 * day), canTryAgain: false },
    events: [
      ev(1, "message", { from: "owner", userId: PEOPLE.owner.id, text: "What did we spend on Court booking last month?" }, a(2 * day)),
      ev(2, "run.started", { holder: "runner-demo-1" }, a(2 * day)),
      ev(3, "message", { from: "assistant", text: "Court booking cost 296 credits last month: 281 on work by Kasper and Mina, and 15 on keeping it running always on." }, a(2 * day - 0.5)),
      ev(4, "run.finished", { outcome: "succeeded", summary: "Replied.", totals: { credits: 0.03, modelCalls: 2, nonBillableCredits: 0 } }, a(2 * day - 1)),
    ],
    playback: null,
  });

  // Live work: research for the tide board, and the reading list being built ------------------
  w.runs.push(liveRun(IDS.runResearchTides, "research", `Research: ${titleOf(w.ideas.find((i) => i.id === IDS.ideaTides)?.text ?? "")}`, `${ORG}/learning`, IDS.ideaTides, 12, "research", { ideaId: IDS.ideaTides, story: "tide-board" }, [
    ["message", { via: "console", from: "owner", text: w.ideas.find((i) => i.id === IDS.ideaTides)?.text ?? "", change: null, constraints: "Readable from across the room" }],
    ["estimate.made", { credits: 12, basis: "research", reason: "The measured starting figure for research runs, used until 3 have finished here to learn from. It can never cost more than 111.09 credits, the most its steps could cost; it is charged at what it actually costs.", ceiling: 111.09 }],
  ]));
  w.runs.push(liveRun(IDS.runBuildReadingList, "build", "Build: A reading list for the supper club: members sign in, add books with a title, author and a one-line note, mark a book as rea...", ORG, IDS.ideaReadingList, 120, "build", { ideaId: IDS.ideaReadingList, story: "reading-list" }, [
    ["message", { from: "owner", note: null, text: w.ideas.find((i) => i.id === IDS.ideaReadingList)?.text ?? "", verdict: "build", decidedBy: "person", overruled: false, constraints: "Members sign in\nWorks on a phone" }],
  ]));
  void MONTH_DAY;
  return w;
}

function ev(seq: number, type: string, payload: Record<string, unknown>, at: string): RunEvent {
  return { seq, type, at, payload };
}

function liveRun(id: string, kind: "research" | "build", title: string, scope: string, ideaId: string, estimate: number, script: string, params: Record<string, string>, first: [string, Record<string, unknown>][]): DemoRun {
  const at = new Date().toISOString();
  return {
    run: { id, kind, title, scope, status: "queued", startedAt: at, finishedAt: null, lastSeq: first.length, ideaId, estimateCredits: estimate, spentCredits: 0, employeeId: null, conversationId: null, budgetExhausted: false, outcome: null, summary: null, createdAt: at, canTryAgain: false },
    events: first.map(([type, payload], i) => ev(i + 1, type, payload, at)),
    playback: { script, params, elapsed: 0, cursor: 0 },
  };
}

function historicResearch(i: Idea, a: (m: number) => string, strands: { id: string; title: string; brief: string; findings: string[]; sources: string[] }[], scope: string): DemoRun {
  const start = 3 * 24 * 60;
  const events: RunEvent[] = [];
  const push = (type: string, payload: Record<string, unknown>, m: number) => events.push(ev(events.length + 1, type, payload, a(start - m)));
  push("message", { via: "console", from: "owner", text: i.text, change: null, constraints: i.constraints.join("\n") }, 0);
  push("estimate.made", { credits: 12, basis: "research" }, 0);
  push("run.started", { holder: "runner-demo-1" }, 0.1);
  push("message", { from: "researcher", text: "3 researchers are looking, at the same time, at who already does this, what they leave undone, and whether people would pay for it, with up to 7 web searches each.", title: "Research started", milestone: "research.started" }, 0.2);
  for (const s of strands) push("subagent.started", { role: "research contractor", agent: "workflow", brief: s.brief, title: s.title, subagent: `contractor-${s.id}` }, 0.3);
  for (const s of strands) push("subagent.finished", { agent: "workflow", title: s.title, report: { sources: s.sources, findings: s.findings }, summary: s.findings[0] ?? null }, 0.8);
  const v = i.verdict as unknown as Record<string, unknown> | null;
  push("message", { from: "researcher", text: `${String(v?.headline ?? "Research finished")}.`, title: v?.outcome === "build" ? "Verdict: build" : v?.outcome === "change" ? "Verdict: change it" : "Verdict: do not build", milestone: "verdict" }, 1);
  push("estimate.scored", { ratio: 0.8, modelCalls: 14, actualCredits: 9.8, expectedCredits: 12, nonBillableCredits: 0 }, 1);
  push("run.finished", { totals: { credits: 9.8, modelCalls: 14, nonBillableCredits: 0 }, outcome: "succeeded", summary: "Research finished; the verdict waits for your decision." }, 1);
  return { run: { id: i.runId, kind: "research", title: `Research: ${i.title}`, scope, status: "finished", startedAt: a(start), finishedAt: a(start - 1), lastSeq: events.length, ideaId: i.id, estimateCredits: 12, spentCredits: 9.8, employeeId: null, conversationId: null, budgetExhausted: false, outcome: "succeeded", summary: "Research finished; the verdict waits for your decision.", createdAt: a(start), canTryAgain: false }, events, playback: null };
}

function historicBuild(app: DemoApp, division: string, startedAt: string, publishedAt: string): DemoRun {
  const id = uuidFor(`run:build:${app.path}`);
  const project = app.path.split("/").slice(0, 3).join("/");
  const events: RunEvent[] = [];
  const push = (type: string, payload: Record<string, unknown>, at: string) => events.push(ev(events.length + 1, type, payload, at));
  push("run.started", { holder: "runner-demo-1" }, startedAt);
  // The placement step the Runner's journal writes: what the run page reads to lead to the app it built (R7-2).
  push("message", { kind: "workflow.step", agent: "workflow", step: "placement", data: { name: app.name, appId: app.id, appPath: app.path, projectPath: project, division: project.split("/").slice(0, 2).join("/"), divisionName: division, divisionCreated: false, newApp: true } }, startedAt);
  push("message", { from: "builder", text: `${app.name} is a new app. It will live in ${division} as a new project of its own.`, title: "Placed", milestone: "placed" }, startedAt);
  push("plan.accepted", { by: "auto-mode", summary: `${app.name}, in three parts.`, items: [{ id: "backend", text: "What it keeps, and who may change it.", detail: "api: entities, migration, endpoints, tests.", check: "make test passes." }, { id: "frontend", text: "The screens, phone first.", detail: "web: pages and tests.", check: "make test passes." }, { id: "docs", text: "Its documents.", detail: "docs/*.md", check: "The docs describe the app." }] }, startedAt);
  for (const item of ["backend", "frontend", "docs"]) push("evaluation.passed", { item, tier: "build", round: 0, faults: [], evidence: "make test and make lint exit 0.", summary: "Checked and passed." }, publishedAt);
  push("message", { from: "security-reviewer", text: "The security review checked secrets, sign-in, data, model calls and outbound calls, and found nothing that blocks publishing.", title: "Security review passed", milestone: "security:0" }, publishedAt);
  push("message", { from: "builder", text: `${app.name} is built and running privately at /${app.path}/. Only you and the people you choose can open it until you make it public.`, title: "Running privately", milestone: "published" }, publishedAt);
  push("estimate.scored", { ratio: 0.21, modelCalls: 190, actualCredits: 18.9, expectedCredits: 90, nonBillableCredits: 1.4 }, publishedAt);
  push("run.finished", { totals: { credits: 18.9, modelCalls: 190, nonBillableCredits: 1.4 }, outcome: "succeeded", summary: `${app.name} is built and running privately.` }, publishedAt);
  return { run: { id, kind: "build", title: `Build: ${app.name}`, scope: project, status: "finished", startedAt, finishedAt: publishedAt, lastSeq: events.length, ideaId: null, estimateCredits: 90, spentCredits: 18.9, employeeId: null, conversationId: null, budgetExhausted: false, outcome: "succeeded", summary: `${app.name} is built and running privately.`, createdAt: startedAt, canTryAgain: false }, events, playback: null };
}

function dashboard(a: (m: number) => string): (SavedQuestion & { appId: string })[] {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const visits = [142, 151, 138, 166, 174, 203, 186];
  const dates = Array.from({ length: 7 }, (_, i) => a((6 - i) * 24 * 60).slice(0, 10));
  return [
    {
      appId: IDS.tableBookings,
      id: uuidFor("q:visits"),
      question: "How many visits a day this week?",
      answer: "Visits rose through the week, from 142 on the first day to a peak of 203 on Saturday.",
      sql: "select date_trunc('day', at) as day, count(*) as visits from visits where at > now() - interval '7 days' group by 1 order by 1",
      chart: { kind: "line", x: "day", y: ["visits"], series: [{ name: "visits", points: dates.map((d, i) => ({ x: d, y: visits[i] ?? 0 })) }] },
      columns: ["day", "visits"],
      rows: dates.map((d, i) => ({ day: d, visits: visits[i] })),
      truncated: false,
      askedAt: a(9 * 24 * 60),
      ranAt: a(1),
      error: null,
      technical: null,
    },
    {
      appId: IDS.tableBookings,
      id: uuidFor("q:weekday"),
      question: "Which weekday gets the most bookings?",
      answer: "Saturday, with 61 bookings in the last four weeks; Tuesday is the quietest at 18.",
      sql: "select to_char(at, 'Dy') as weekday, count(*) as bookings from events where name = 'booking.created' and at > now() - interval '28 days' group by 1",
      chart: { kind: "bar", x: "weekday", y: ["bookings"], series: [{ name: "bookings", points: days.map((d, i) => ({ x: d, y: [24, 18, 22, 31, 47, 61, 39][i] ?? 0 })) }] },
      columns: ["weekday", "bookings"],
      rows: days.map((d, i) => ({ weekday: d, bookings: [24, 18, 22, 31, 47, 61, 39][i] })),
      truncated: false,
      askedAt: a(12 * 24 * 60),
      ranAt: a(1),
      error: null,
      technical: null,
    },
    {
      appId: IDS.tableBookings,
      id: uuidFor("q:covers"),
      question: "How many playing minutes are booked for this weekend?",
      answer: "5,920 playing minutes are booked for Friday to Sunday.",
      sql: "select sum((properties->>'minutes')::int) as minutes from events where name = 'booking.created' and (properties->>'date')::date between date_trunc('week', now()) + interval '4 days' and date_trunc('week', now()) + interval '6 days'",
      chart: { kind: "number", x: null, y: ["minutes"], series: [{ name: "minutes", points: [{ x: null, y: 5920 }] }] },
      columns: ["minutes"],
      rows: [{ minutes: 5920 }],
      truncated: false,
      askedAt: a(2 * 24 * 60),
      ranAt: a(1),
      error: null,
      technical: null,
    },
    {
      appId: IDS.tableBookings,
      id: uuidFor("q:noshows"),
      question: "Which booking times have the most no-shows?",
      answer: "Late Friday slots: 21:00 and 21:40 account for half of all no-shows this month.",
      sql: "select properties->>'time' as time, count(*) as no_shows from events where name = 'booking.no_show' group by 1 order by 2 desc limit 5",
      chart: { kind: "table", x: null, y: ["time", "no_shows"], series: [] },
      columns: ["time", "no_shows"],
      rows: [
        { time: "21:30", no_shows: 7 },
        { time: "21:00", no_shows: 5 },
        { time: "19:30", no_shows: 3 },
        { time: "13:00", no_shows: 2 },
        { time: "12:30", no_shows: 1 },
      ],
      truncated: false,
      askedAt: a(5 * 24 * 60),
      ranAt: a(1),
      error: null,
      technical: null,
    },
  ];
}

/** A kept question whose query no longer runs: what it counted is no longer recorded (scenario `dashboard-question-broken`). */
export function brokenQuestion(a: (m: number) => string): SavedQuestion & { appId: string } {
  return {
    appId: IDS.tableBookings,
    id: uuidFor("q:old"),
    question: "How many league blocks were refunded?",
    answer: "",
    sql: "select count(*) from events where name = 'deposit.refunded'",
    chart: null,
    columns: [],
    rows: [],
    truncated: false,
    askedAt: a(20 * 24 * 60),
    ranAt: a(1),
    error: "It can no longer be worked out from what the app records. Ask it again, and keep the new answer.",
    technical: { sql: "select count(*) from events where name = 'deposit.refunded'", error: "the event deposit.refunded is no longer recorded" },
    };
}

function verdictDocs() {
  const method = (searches: number, confidence: string) => ({
    strands: [
      { id: "existing", title: "Looked for existing products", sources: 9, searches: 7, confidence },
      { id: "gap", title: "Looked for what they leave undone", sources: 6, searches: 7, confidence },
      { id: "demand", title: "Looked for evidence people will pay", sources: 5, searches: 7, confidence },
    ],
    searches,
    confidence,
  });
  return {
    build: {
      outcome: "build",
      headline: "Build it: labels the kitchen prints today, by hand",
      summary: "The kitchen writes allergen labels by hand at every prep, the label tools found are priced for factories, and a small app on the kitchen tablet that prints from the dish list would save an hour a day and remove the commonest labelling mistake.",
      against: ["Handwritten labels work, and a mistake on a printed label is repeated on every label until someone notices.", "The label printer must be bought; the app cannot help with that."],
      existing: { products: [{ name: "Labelforge", does: "Food labelling software for manufacturers, from 90 a month.", sources: ["https://labelforge.example/pricing"] }, { name: "PrepTag", does: "Day-dot labels with a phone app; no allergens.", sources: ["https://preptag.example"] }], evidence: "The tools found are either priced for factories or leave allergens out." },
      gap: { evidence: "No tool found prints allergens and use-by together for a small kitchen from its own dish list." },
      demand: { evidence: "The demand is the kitchen's own: an hour a day of handwritten labels.", signals: [{ text: "The kitchen writes about 60 labels a day by hand.", source: null }, { text: "Two near-misses with mislabelled sesame were logged this year.", source: "https://forum.kitchens.example/t/labels" }] },
      suggestedChange: null,
      wouldChange: { text: "If the café moved its dishes into a till system that already prints allergen labels, this would no longer be worth building.", changeLabel: null, estimateCredits: null },
      placement: { division: "technologies", project: "allergen-labels", app: "web", name: "Allergen Labels" },
      redLines: { breached: false, line: null, reasoning: "Labels that keep diners safe harm no one." },
      method: method(15, "high"),
    },
    change: {
      outcome: "change",
      headline: "Change it: start with a waiting list, not paid accounts",
      summary: "Families want to know when a place opens far more than they want another account; the cookery club fills by word of mouth and payment already works at the counter. A waiting list with a weekly email answers the real problem for a fraction of the cost.",
      against: ["Parent accounts and online payment are the costly part, and nothing found says families want them.", "Card payments bring refunds and disputes the café does not handle today."],
      existing: { products: [{ name: "Clubhouse Kids", does: "Bookings and payments for children's clubs, 3% a booking.", sources: ["https://clubhouse-kids.example"] }], evidence: "One product does all of it, at a fee per booking." },
      gap: { evidence: "Families complain about missing out when places open, not about paying." },
      demand: { evidence: "Twelve families asked to be told when the next term opens.", signals: [{ text: "Twelve families asked at the counter to be told when places open.", source: null }] },
      suggestedChange: "Start with a waiting list: families leave an email, and the club emails them weekly when places open. Add payments only if the list outgrows the counter.",
      wouldChange: { text: "If the waiting list passes 60 families, paid online booking would be worth researching again.", changeLabel: null, estimateCredits: null },
      placement: { division: "learning", project: "cookery-club", app: "web", name: "Cookery Club" },
      redLines: { breached: false, line: null, reasoning: null },
      method: method(13, "medium"),
    },
    doNotBuild: {
      outcome: "do-not-build",
      headline: "Do not build: the couriers already show this, for free",
      summary: "Both vans already run the delivery firm's app, which sends customers a live map link, and customers in the reviews found say a text with a time window is what they actually want. Building a second map would duplicate a free feature.",
      against: ["The delivery firm's app already shares a live map with each customer, at no cost.", "Showing van positions publicly tells anyone where the vans are, all day."],
      existing: { products: [{ name: "RouteCourier", does: "The delivery firm's own app: routes, and a live map link per customer.", sources: ["https://routecourier.example/features"] }], evidence: "The feature exists in a tool the vans already use." },
      gap: { evidence: "Customers ask for a time window by text, not a map." },
      demand: { evidence: "No evidence of demand was found for a map beyond what the couriers already give." },
      suggestedChange: null,
      wouldChange: { text: "If the delivery firm stopped sharing its map, this would be worth researching again.", changeLabel: null, estimateCredits: null },
      redLines: { breached: false, line: null, reasoning: "Van positions are the business's own; no one is watched." },
      method: method(12, "high"),
      rulesApplied: ["No evidence of demand was found, so the verdict is do not build."],
    },
    redLine: {
      outcome: "do-not-build",
      headline: "Not on Endgame: following staff after their shift is surveillance",
      summary: "Tracking where staff go outside working hours, from their own phones, to find out who else they work for is surveillance of people without their meaningful consent. It crosses one of FrostAura's red lines, so it cannot be built here, and no one can overrule that.",
      against: ["It follows people outside work without their meaningful consent.", "It would be used to act against staff for lawful things they do in their own time."],
      existing: { products: [], evidence: "Not looked into further once the red line was found." },
      gap: { evidence: "Not looked into." },
      demand: { evidence: "No evidence was gathered for an idea that crosses a red line.", evidenceFound: false },
      suggestedChange: null,
      wouldChange: { text: "Nothing would change this verdict while it watches people without their consent. A clear conflict-of-interest policy, agreed with staff, answers the worry without watching anyone.", changeLabel: null, estimateCredits: null },
      redLines: { breached: true, line: "surveillance", reasoning: "Following employees' phones after hours to see who else they work for is surveillance and authoritarian tooling: it watches people without their meaningful consent." },
      method: method(3, "high"),
      rulesApplied: ["A red line was found, so nothing may be built."],
    },
  };
}
