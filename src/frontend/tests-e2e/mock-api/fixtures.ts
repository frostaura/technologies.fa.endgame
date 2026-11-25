/**
 * TEST ONLY. Fixture organisations for the mock control plane. Every name and figure here is
 * invented for the specs and exists nowhere in the running console. The shapes are the control
 * plane's own (Endgame.Infrastructure/Tree/ConsoleViews.cs and the console endpoints), so the
 * console is driven by what the real system returns.
 */

export type ScenarioName =
  | "populated"
  | "first-run"
  | "empty-org"
  | "signed-out"
  | "signed-out-dev"
  | "tree-fails"
  | "credits-fail"
  | "settings-fail"
  | "estimate-fails"
  | "conversation-fails"
  | "not-owner"
  | "secret-refused"
  | "workforce-refused"
  | "workforce-fails"
  | "viewer"
  | "operator"
  | "slow";

export interface MockEvent {
  seq: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
  delayMs: number;
  /** Not released until this approval id is answered. */
  gate?: string;
}

interface RunSummary {
  id: string;
  kind: string;
  title: string;
  scope: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  lastSeq: number;
  ideaId: string | null;
  estimateCredits: number | null;
  spentCredits: number;
  employeeId: string | null;
  conversationId: string | null;
  budgetExhausted: boolean;
  outcome: string | null;
  summary: string | null;
  createdAt: string;
}

export interface MockRun {
  summary: RunSummary;
  events: MockEvent[];
  released: number;
  paused: boolean;
  pumping: boolean;
  answered: Set<string>;
}

export interface IdeaFixture {
  id: string;
  title: string;
  runId: string;
  status: string;
  decision: unknown;
  [key: string]: unknown;
}

export interface AppFixture {
  settings: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SecretEntry {
  scope: string;
  name: string;
  setAt: string;
}

export interface ShareEntry {
  email: string;
  invitedAt: string;
  registered: boolean;
}

export interface MockState {
  signedIn: boolean;
  /** A FrostAura operator, in God mode. */
  isOperator: boolean;
  breadth: BreadthState;
  /** The signed-in person's role over the tree, as GET /api/tree reports it. */
  viewerRole: "owner" | "admin" | "builder" | "viewer" | "none";
  failSecretWrite: boolean;
  developmentSignIn: boolean;
  delayMs: number;
  failTree: boolean;
  failCredits: boolean;
  failSettings: boolean;
  failEstimate: boolean;
  failConversation: boolean;
  failControl: boolean;
  failDecision: boolean;
  failStream: boolean;
  user: { id: string; displayName: string; email: string };
  org: { id: string; slug: string; name: string; summary: string | null } | null;
  runs: Record<string, MockRun>;
  ideas: Record<string, IdeaFixture>;
  apps: Record<string, AppFixture>;
  /** Names and where each was set. A value is never kept, not even by the mock. */
  secrets: SecretEntry[];
  shares: Record<string, ShareEntry[]>;
  operatorLog: unknown[];
  /** The workforce, as `GET /api/employees/{id}` answers (employee, trackRecord, contractors, reports). */
  employees: Record<string, { employee: Record<string, unknown>; trackRecord: Record<string, unknown>; contractors: unknown[]; reports: unknown[] }>;
  memory: Record<string, Record<string, unknown>[]>;
  memoryChanges: Record<string, Record<string, unknown>[]>;
  hires: Record<string, Record<string, unknown> & { status: string; role: string; scope: string; reason: string; expectedMonthlyCredits: number }>;
  recurringRoles: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  /** Autonomy settings and rule sets set at each scope; the view walks the chain. */
  autonomy: Record<string, { autonomy?: string; checkpoints: Record<string, boolean>; ruleSets: Record<string, { deny: string[]; ask: string[]; allow: string[]; checkpoints: string[] }> }>;
  /** Writes to the workforce, hires and autonomy are refused. */
  failWorkforceWrite: boolean;
  /** Reads of the workforce, hires, autonomy and the ontology fail. */
  failWorkforceRead: boolean;
  ontology: () => unknown;
  tree: () => unknown;
  credits: () => unknown;
  addIdea: (b: { text: string; constraints: string[] }) => IdeaFixture;
  addRun: (title: string, kind: string) => string;
  addConversation: (scope: string, message: string, employeeId?: string) => string;
}

import { breadthState, type BreadthState } from "./breadth.ts";

const now = () => new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function ev(type: string, payload: Record<string, unknown> = {}, delayMs = 60, gate?: string): Omit<MockEvent, "seq" | "at"> {
  return { type, payload, delayMs, ...(gate ? { gate } : {}) };
}

function makeRun(id: string, summary: Partial<RunSummary>, script: Omit<MockEvent, "seq" | "at">[], released = 0): MockRun {
  const events = script.map((e, i) => ({ ...e, seq: i + 1, at: ago(script.length - i) }));
  return {
    summary: {
      id,
      kind: "research",
      title: "Work",
      scope: "fixture",
      status: "running",
      startedAt: ago(30),
      finishedAt: null,
      lastSeq: 0,
      ideaId: null,
      estimateCredits: null,
      spentCredits: 0,
      employeeId: null,
      conversationId: null,
      budgetExhausted: false,
      outcome: null,
      summary: null,
      createdAt: ago(30),
      ...summary,
    },
    events,
    released,
    paused: false,
    pumping: false,
    answered: new Set(),
  };
}

/** A research run that reaches an approval, waits for it, then finishes with a verdict. */
function researchScript(withApproval: boolean): Omit<MockEvent, "seq" | "at">[] {
  return [
    ev("run.started", { reason: "Research the idea before anything is built." }),
    ev("estimate.made", { credits: 60 }),
    ev("plan.proposed", {
      summary: "Argue the case against the idea first, then look for a gap and for demand.",
      items: [
        { id: "c1", text: "Name every product already selling this", check: "At least three named, each with a source" },
        { id: "c2", text: "State the gap that is left", check: "One sentence a buyer would recognise" },
      ],
    }),
    ev("plan.accepted", {}),
    ev("task.created", { taskId: "t1", summary: "Sweep existing products" }),
    ev("task.created", { taskId: "t2", summary: "Look for demand" }),
    ev("task.claimed", { taskId: "t1", holder: "Ada", summary: "Sweep existing products" }),
    ev("model.requested", { callId: "k1", taskType: "research.sweep", model: "fixture/model-small", reservedCredits: 4 }),
    ev("model.replied", { callId: "k1", taskType: "research.sweep", model: "fixture/model-small", tokens: { input: 1200, output: 340 }, settledCredits: 1.5 }),
    ev("tool.requested", { agent: "main", callId: "c1", name: "web_search", arguments: { query: "club ladder software" } }),
    ev("tool.permitted", { agent: "main", callId: "c1", name: "web_search", rule: "allow web_search" }),
    ev("tool.result", { agent: "main", callId: "c1", name: "web_search", content: "12 results" }),
    ev("tool.requested", { agent: "main", callId: "c2", name: "run", arguments: { command: "curl example" } }),
    ev("tool.denied", { agent: "main", callId: "c2", name: "run", rule: "protected floor: no shell in research", reason: "Research never runs commands." }),
    ev("subagent.started", { agent: "main", subagent: "s1", title: "Looked for existing products", brief: "Find three products that already sell club ladders.", role: "researcher" }),
    ev("tool.requested", { agent: "s1", callId: "c3", name: "web_search", arguments: { query: "ladder league app" } }),
    ev("subagent.finished", { agent: "main", subagent: "s1", title: "Looked for existing products", summary: "Found three, each with pricing.", stopReason: "completed", searches: 2, report: "{}" }),
    ev("evaluation.passed", { item: "c1", evidence: "Three products named with sources." }),
    ev("task.done", { taskId: "t1", summary: "Three competitors found." }),
    ...(withApproval
      ? [
          ev("approval.requested", { approvalId: "a1", question: "Spend 20 more credits on a wider demand sweep?", detail: "The first sweep found little evidence either way." }, 60),
          ev("approval.answered", { approvalId: "a1" }, 60, "a1"),
        ]
      : []),
    ev("task.claimed", { taskId: "t2", holder: "Ada" }),
    ev("task.done", { taskId: "t2", summary: "No buyer asked for it." }),
    ev("estimate.scored", { expectedCredits: 60, actualCredits: 54, nonBillableCredits: 0, modelCalls: 1 }),
    ev("message", { from: "researcher", title: "The verdict", text: "Research is done. The verdict is ready for you.", milestone: "verdict" }),
    ev("run.finished", { outcome: "succeeded", summary: "Verdict: do not build as its own app.", totals: { credits: 54 } }),
  ];
}

export function scenario(name: ScenarioName): MockState {
  const s: MockState = {
    signedIn: !name.startsWith("signed-out"),
    isOperator: name === "operator",
    breadth: breadthState(),
    viewerRole: name === "first-run" ? "none" : name === "not-owner" ? "admin" : name === "viewer" ? "viewer" : "owner",
    failSecretWrite: name === "secret-refused",
    developmentSignIn: name === "signed-out-dev",
    delayMs: name === "slow" ? 1500 : 0,
    failTree: name === "tree-fails",
    failCredits: name === "credits-fail",
    failSettings: name === "settings-fail",
    failEstimate: name === "estimate-fails",
    failConversation: name === "conversation-fails",
    failControl: false,
    failDecision: false,
    failStream: false,
    user: { id: "u1", displayName: "Fixture Owner", email: "owner@example.test" },
    org: name === "first-run" || name === "operator" ? null : { id: "org1", slug: "northwind", name: "Northwind", summary: "Ada is chief of staff · all apps healthy" },
    runs: {},
    ideas: {},
    apps: {},
    secrets: [
      { scope: "northwind", name: "MAIL_API_KEY", setAt: ago(60 * 24 * 20) },
      { scope: "northwind", name: "MAPS_KEY", setAt: ago(60 * 24 * 12) },
      { scope: "northwind/software", name: "MAPS_KEY", setAt: ago(60 * 24 * 3) },
      { scope: "northwind/software/booking/desk", name: "PAYMENTS_KEY", setAt: ago(60 * 5) },
    ],
    shares: {
      app2: [
        { email: "cook@example.test", invitedAt: ago(60 * 24 * 6), registered: true },
        { email: "taster@example.test", invitedAt: ago(60 * 30), registered: false },
      ],
    },
    employees: {},
    memory: {},
    memoryChanges: {},
    hires: {},
    recurringRoles: [],
    tasks: [],
    autonomy: {},
    failWorkforceWrite: name === "workforce-refused",
    failWorkforceRead: name === "workforce-fails",
    ontology: () => null,
    operatorLog: [
      { id: "op2", at: ago(60 * 26), action: "credits.top_up", operator: { id: "op-u1", email: "support@example.test", displayName: "Fixture Operator" }, detail: { credits: 10000, note: "Added by FrostAura", entryId: "ce1" } },
      { id: "op1", at: ago(60 * 24 * 10), action: "organisation.entered", operator: { id: "op-u1", email: "support@example.test", displayName: "Fixture Operator" }, detail: { path: "northwind" } },
    ],
    tree: () => null,
    credits: () => null,
    addIdea: () => ({ id: "", title: "", runId: "", status: "", decision: null }),
    addRun: () => "",
    addConversation: () => "",
  };

  let counter = 0;
  const ada = { id: "e1", name: "Ada", role: "Product researcher", kind: "employee", activity: null as string | null, status: "idle", idle: false, standing: null, briefedBy: null };
  const lin = { id: "e2", name: "Lin", role: "Engineer", kind: "employee", activity: "Building Field notes", status: "working", idle: false, standing: null, briefedBy: null };
  const ruth = { id: "e3", name: "Ruth", role: "Security reviewer", kind: "employee", activity: null, status: "idle", idle: true, standing: "security-reviewer", briefedBy: null };

  s.apps = {
    app1: {
      id: "app1",
      name: "Booking desk",
      scope: "northwind/software/booking/desk",
      health: { state: "healthy", summary: "No errors in 6 days" },
      running: "always-on",
      addresses: { path: "https://endgame.example.test/northwind/software/booking", subdomain: "https://northwind.example.test/booking" },
      telemetry: { visitsToday: 233, requestsToday: 1800, errorsToday: 0, latencyP50Ms: 180, latencyP95Ms: 540, lastVisitAt: ago(2) },
      cost: { monthCredits: 310, capCredits: 500 },
      settings: { running: "always-on", access: "private" },
      runningCost: { state: "estimated", windowDays: 14, minimumHours: 24, measuredHours: 58, basis: "Measured over the last 14 days: awake 8 of the 58 hours measured, using 448 MB while awake, 2 GB stored and about 59,586 requests a month.", prices: "Today's prices: 0.2 credits an awake hour, 0.4 per GB of memory an awake hour, 10 per GB stored a month and 20 per million requests.", sleep: { credits: 30, awakeHoursPerMonth: 99.3, basis: "Awake about 99 hours a month, as it was 8 of the 58 hours measured in the last 14 days, using 448 MB while awake, with 2 GB stored and about 59,586 requests a month." }, alwaysOn: { credits: 180, awakeHoursPerMonth: 720, basis: "Awake all 720 hours of a month at the 448 MB it uses while awake, with the same 2 GB stored and about 59,586 requests a month." }, measured: { awakeHours: 8, memoryMb: 448, storageMb: 2048, requestsPerMonth: 59586 } },
      sharedWith: 0,
      endUsers: 0,
      status: "running",
      version: "1.4.0",
      publishedAt: ago(60 * 24 * 6),
      idleMinutes: 15,
    },
    app2: {
      id: "app2",
      name: "Recipe box",
      scope: "northwind/research/recipes/box",
      health: { state: "healthy", summary: "Asleep; healthy at its last wake" },
      running: "asleep",
      addresses: { path: "https://endgame.example.test/northwind/research/recipes", subdomain: null },
      telemetry: { visitsToday: 0, requestsToday: 0, errorsToday: 0, latencyP50Ms: null, latencyP95Ms: null, lastVisitAt: ago(60 * 50) },
      cost: { monthCredits: 22, capCredits: null },
      settings: { running: "sleep", access: "shared" },
      runningCost: { state: "estimated", windowDays: 14, minimumHours: 24, measuredHours: 58, basis: "Measured over the last 14 days: awake 8 of the 58 hours measured, using 448 MB while awake, 2 GB stored and about 59,586 requests a month.", prices: "Today's prices: 0.2 credits an awake hour, 0.4 per GB of memory an awake hour, 10 per GB stored a month and 20 per million requests.", sleep: { credits: 20, awakeHoursPerMonth: 99.3, basis: "Awake about 99 hours a month, as it was 8 of the 58 hours measured in the last 14 days, using 448 MB while awake, with 2 GB stored and about 59,586 requests a month." }, alwaysOn: { credits: 150, awakeHoursPerMonth: 720, basis: "Awake all 720 hours of a month at the 448 MB it uses while awake, with the same 2 GB stored and about 59,586 requests a month." }, measured: { awakeHours: 8, memoryMb: 448, storageMb: 2048, requestsPerMonth: 59586 } },
      sharedWith: 2,
      endUsers: 2,
      status: "sleeping",
      version: "0.9.2",
      publishedAt: ago(60 * 24 * 40),
      idleMinutes: 15,
    },
    // Published but not yet measured: telemetry is null and runningCost says there is not enough history yet.
    app3: {
      id: "app3",
      name: "Tide board",
      scope: "northwind/research/recipes/tides",
      health: { state: "healthy", summary: "Running version 0.1.0." },
      running: "awake",
      addresses: { path: "https://endgame.example.test/northwind/research/recipes/tides", subdomain: null },
      telemetry: null,
      cost: { monthCredits: 0, capCredits: null },
      settings: { running: "sleep", access: "public" },
      runningCost: { state: "not-enough-history", windowDays: 14, minimumHours: 24, measuredHours: 0, basis: "Nothing measured yet. An estimate needs at least 24 hours of this app's own use in the last 14 days.", prices: "Today's prices: 0.2 credits an awake hour, 0.4 per GB of memory an awake hour, 10 per GB stored a month and 20 per million requests.", sleep: null, alwaysOn: null, measured: null },
      sharedWith: 0,
      endUsers: 14,
      status: "running",
      version: "0.1.0",
      publishedAt: ago(20),
      idleMinutes: 15,
    },
  };

  s.runs["run-build"] = makeRun(
    "run-build",
    { kind: "build", title: "Building Field notes", scope: "northwind/research/field-notes", estimateCredits: 300, spentCredits: 120 },
    [
      ev("run.started", {}),
      ev("estimate.made", { credits: 300 }),
      ev("task.created", { taskId: "b1", summary: "Sign-in and the notes list" }),
      ev("task.claimed", { taskId: "b1", holder: "Lin" }),
      ev("message", { from: "Lin", text: "The notes list works; sign-in next." }, 200),
    ],
    5,
  );

  // An earlier exchange at the organisation, so the dock has history to read back after a reload.
  s.runs["run-conv-past"] = makeRun(
    "run-conv-past",
    { kind: "conversation", title: "Is anything over budget?", scope: "northwind", status: "finished", finishedAt: ago(90), startedAt: ago(91), createdAt: ago(91), conversationId: "conv-northwind#" },
    [
      ev("message", { from: "owner", userId: "u1", text: "Is anything over budget?" }),
      ev("run.started", {}),
      ev("message", { from: "Ada", text: "Nothing is over budget. Booking desk is at 310 of its 500 credit cap." }),
      ev("run.finished", { outcome: "succeeded", totals: { credits: 0.3 } }),
    ],
  );
  s.runs["run-conv-past"].released = s.runs["run-conv-past"].events.length;

  s.runs["run-research"] = makeRun("run-research", { kind: "research", title: "Researching Court ladder", scope: "northwind", ideaId: "idea-ladder", estimateCredits: 60, spentCredits: 0 }, researchScript(true));

  s.runs["run-done"] = makeRun("run-done", { kind: "research", title: "Research: Court ladder", scope: "northwind", ideaId: "idea-ladder", status: "finished", estimateCredits: 60, spentCredits: 54, finishedAt: ago(5) }, researchScript(false));
  s.runs["run-done"].released = s.runs["run-done"].events.length;
  // A finished build, its log in the shapes the real factory writes: hires as workflow steps beside
  // the runner's own words, a plan whose items name files, checks with evidence about commands.
  s.runs["run-factory"] = makeRun(
    "run-factory",
    { kind: "build", title: "Build: Booking desk", scope: "northwind", status: "finished", estimateCredits: 90, spentCredits: 15, finishedAt: ago(1), outcome: "succeeded", summary: "Booking desk is built and running privately." },
    [
      ev("message", { from: "owner", text: "A booking desk for the club's courts." }, 0),
      ev("run.started", { holder: "runner-1" }, 0),
      ev("estimate.made", { credits: 120, stage: "start", basis: "the starting figure for build runs" }, 0),
      ev("message", { kind: "workflow.step", step: "estimate.gate", agent: "workflow", data: { autonomy: "auto", estimate: 120 } }, 0),
      ev("message", { kind: "workflow.step", step: "hire:stage:build:northwind/software/booking", agent: "workflow", data: { name: "Lin", role: "Engineer", hireId: "h9", status: "accepted", employeeId: "e2" } }, 0),
      ev("message", { from: "runner", title: "Hired Lin", milestone: "hired:stage:build:northwind/software/booking", text: "Lin joins as an engineer, at up to 1500 credits a month: the booking desk is entering its build." }, 0),
      ev("message", { kind: "workflow.step", step: "hire:stage:research:northwind", agent: "workflow", data: { name: "Ada", role: "Product researcher", status: "accepted", employeeId: "e1" } }, 0),
      ev("message", { kind: "agent.start", agent: "planner", task: "Plan the app", taskType: "plan" }, 0),
      ev("tool.requested", { agent: "planner", name: "read_file", arguments: { path: "api/Program.cs" } }, 0),
      ev("plan.proposed", { agent: "planner", items: [{ id: "backend-bookings", text: "api/Bookings/Booking.cs and BookingsEndpoints.cs with a fresh migration; api.tests/BookingsApiTests.cs", check: "make lint and make test pass" }] }, 0),
      ev("plan.accepted", { by: "auto-mode", items: [{ id: "backend-bookings", text: "api/Bookings/Booking.cs and BookingsEndpoints.cs with a fresh migration; api.tests/BookingsApiTests.cs", check: "make lint and make test pass" }] }, 0),
      ev("message", { kind: "agent.start", agent: "builder-backend-bookings-0", taskType: "build" }, 0),
      ev("tool.requested", { agent: "builder-backend-bookings-0", name: "write_file", arguments: { path: "api/Bookings/Booking.cs" } }, 0),
      ev("evaluation.passed", { item: "backend-bookings", text: "api/Bookings/Booking.cs and BookingsEndpoints.cs", tier: "build", round: 0, faults: [], evidence: "make test passed all 14 tests including BookingsApiTests" }, 0),
      ev("message", { kind: "workflow.step", step: "item:backend-bookings", agent: "workflow", data: { passed: true } }, 0),
      ev("message", { kind: "workflow.step", step: "publish", agent: "workflow", data: { commit: "f2a84f83c1f6d2852e9f62f57720ec931052273d", state: "running" } }, 0),
      ev("message", { from: "builder", title: "Running privately", milestone: "published", text: "Booking desk is built and running privately. Only you and the people you choose can open it." }, 0),
      ev("run.finished", { outcome: "succeeded", summary: "Booking desk is built and running privately.", totals: { credits: 15 } }, 0),
    ],
  );
  s.runs["run-factory"].released = s.runs["run-factory"].events.length;

  // The agreed verdict document (ARCH-004, The verdict document), field for field.
  const verdict = {
    outcome: "do-not-build",
    headline: "Do not build this as its own app.",
    summary: "Ladders for clubs are already sold, and nothing in the idea is something they lack.",
    against: "Ladders and leagues are sold to clubs today. The one gap, booking the court in the same step, only has value where the booking system already lives.",
    suggestedChange: null,
    existing: {
      evidence: "Two products already sell ladders to clubs.",
      products: [
        { name: "Fixture Ladders", what: "Ladders and leagues for clubs.", url: "https://example.test/ladders" },
        { name: "Fixture Leagues", what: "Club management with box leagues.", url: null },
      ],
      sources: ["https://example.test/ladders", "https://example.test/leagues/pricing"],
    },
    gap: { evidence: "A challenge that books the court in the same step. That is a feature, not a product." },
    demand: { evidence: "No evidence of demand was found beyond members of one club.", signals: [] },
    wouldChange: "Build it as a feature of Booking desk instead.",
    redLines: { breached: false, line: null, reasoning: "None of the four red lines is near this." },
    placement: { division: "software", project: "court-ladder", app: "ladder", name: "Court ladder" },
    method: {
      searches: 9,
      strands: [
        { id: "existing", title: "Existing products", searches: 4, sources: 5, confidence: "high" },
        { id: "gap", title: "The gap", searches: 2, sources: 2, confidence: "medium" },
        { id: "demand", title: "Demand", searches: 3, sources: 1, confidence: "low" },
      ],
      confidence: "medium",
    },
    rulesApplied: ["No evidence of demand was found, and missing demand counts against building."],
  };
  const record = { total: 4, build: 2, change: 1, doNotBuild: 1, overruled: [{ ideaId: "idea-notes", title: "Field notes", verdict: "change", outcome: "You built it as described. It is still in build." }] };

  s.ideas["idea-ladder"] = {
    id: "idea-ladder",
    title: "Court ladder",
    text: "A ladder for our club.",
    constraints: ["Members sign in"],
    status: "verdict",
    runId: "run-done",
    scope: "northwind/software",
    research: { estimatedCredits: 60, spentCredits: 54, by: "Ada" },
    verdict,
    decision: null,
    record,
    redLine: null,
  };
  s.ideas["idea-researching"] = { ...(s.ideas["idea-ladder"] as IdeaFixture), id: "idea-researching", title: "Tide tables", status: "researching", runId: "run-research", verdict: null, research: { estimatedCredits: 60, spentCredits: 8, by: "Ada" } };

  // The workforce ------------------------------------------------------------------------
  const job = (scope: string, mandate: string, tools: string[], tier: string, limit: number | null) => ({ mandate, scope, tools, services: ["models"], monthlyCreditLimit: limit, modelTier: tier });
  const employee = (w: { id: string; name: string; role: string; status: string; standing: string | null }, scope: string, j: ReturnType<typeof job>, extra: Record<string, unknown> = {}) => ({
    id: w.id,
    kind: "employee",
    name: w.name,
    role: w.role,
    status: w.status,
    standing: w.standing,
    scope,
    reportsTo: null,
    briefedBy: null,
    jobDescription: j,
    idle: { flagged: w.id === "e3", since: w.id === "e3" ? ago(60 * 24 * 15) : null, afterDays: 14 },
    currentRun: w.id === "e2" ? { id: "run-build", title: "Building Field notes" } : null,
    lastRunId: w.id === "e1" ? "run-done" : null,
    lastActiveAt: ago(60),
    createdAt: ago(60 * 24 * 84),
    releasedAt: null,
    memoryEntries: 3,
    brief: null,
    ...extra,
  });
  const track = (id: string, accepted: number, sentBack: number, estimates: unknown) => ({
    employeeId: id,
    work: { accepted, sentBack, acceptedPercent: accepted + sentBack > 0 ? Math.round((accepted / (accepted + sentBack)) * 1000) / 10 : null },
    runs: { finished: accepted + sentBack, succeeded: accepted, failed: sentBack, cancelled: 0 },
    repairsNotCharged: { credits: 18, calls: sentBack },
    cost: { toDateCredits: 1240, monthCredits: 140 },
    contractors: { engaged: 6, working: 2, toDateCredits: 300, monthCredits: 40 },
    estimates,
  });
  s.employees = {
    e1: {
      employee: employee(ada, "northwind/research", job("northwind/research", "Research every new idea before anything is built, and argue the case against it first.", ["read_file", "web_search", "spawn"], "research", 200)),
      trackRecord: track("e1", 19, 3, { pieces: 9, withinPercent: 12, under: 6, over: 3, largestMissPercent: 17 }),
      contractors: [
        { ...employee({ id: "c1", name: "Contractor", role: "Researcher", status: "working", standing: null }, "northwind/research/recipes", job("northwind/research/recipes", "", [], "research", null)), kind: "contractor", brief: "Sweep the competitors of Recipe box.", briefedBy: { id: "e1", name: "Ada" } },
      ],
      reports: [],
    },
    e2: { employee: employee(lin, "northwind/research/field-notes", job("northwind/research/field-notes", "Build Field notes to its plan.", ["read_file", "edit_file", "run"], "build-t1", 300)), trackRecord: track("e2", 4, 1, null), contractors: [], reports: [] },
    e3: { employee: employee(ruth, "northwind", job("northwind", "Check every app for misuse of the platform's services.", ["read_file", "search"], "review", null)), trackRecord: track("e3", 0, 0, null), contractors: [], reports: [] },
  };
  s.memory = {
    e1: [
      { id: "mem1", employeeId: "e1", scope: "northwind", title: "Proof before building", body: "Northwind wants proof someone will pay before it builds.", kind: "preference", sourceRunId: null, createdAt: ago(60 * 24 * 40), updatedAt: ago(60 * 24 * 9), lastReviewedAt: ago(60 * 24 * 9), archived: false },
      { id: "mem2", employeeId: "e1", scope: "northwind/software", title: "Check Booking desk first", body: "Ideas near bookings should be checked against Booking desk first. A feature there usually beats a separate app.", kind: "practice", sourceRunId: "run-done", createdAt: ago(60 * 24 * 20), updatedAt: ago(60 * 24 * 20), lastReviewedAt: ago(60 * 24 * 9), archived: false },
      { id: "mem3", employeeId: "e1", scope: "northwind/research", title: "Three contractors, not six", body: "Splitting the sweep too finely ran 17% over. Use three contractors, not six.", kind: "lesson", sourceRunId: null, createdAt: ago(60 * 24 * 30), updatedAt: ago(60 * 24 * 9), lastReviewedAt: ago(60 * 24 * 9), archived: false },
    ],
    e2: [],
    e3: [],
  };
  s.memoryChanges = {
    e1: [
      { id: "ch3", memoryId: "mem3", action: "corrected", by: "review", userId: null, runId: "run-review", detail: { why: "Habit corrected" }, at: ago(60 * 24 * 9) },
      { id: "ch2", memoryId: "mem9", action: "removed", by: "review", userId: null, runId: "run-review", detail: { why: "Out of date" }, at: ago(60 * 24 * 9) },
      { id: "ch1", memoryId: "mem1", action: "merged", by: "review", userId: null, runId: "run-review", detail: { from: ["mem7", "mem8"] }, at: ago(60 * 24 * 9) },
    ],
    e2: [],
    e3: [],
  };
  s.hires = {
    h1: {
      id: "h1",
      status: "proposed",
      trigger: "recurring",
      needKey: "recurring:northwind/software:support",
      scope: "northwind/software",
      reason: "Members asked 14 questions this week with nobody assigned to answer them.",
      name: "Noor",
      role: "Support writer",
      jobDescription: job("northwind/software", "Answer member questions about Booking desk within a day, and write up what keeps coming back.", ["read_file", "search"], "chat", 300),
      reportsTo: null,
      expectedMonthlyCredits: 300,
      withinBudget: true,
      headroomCredits: 690,
      contractorRole: null,
      raisedBy: "runner",
      raisedByRunId: "run-build",
      decision: null,
      employeeId: null,
      createdAt: ago(60 * 3),
    },
  };
  s.recurringRoles = [{ scope: "northwind/research", role: "Competitor sweep", contractors: 3, windowDays: 30, costCredits: 90, lastBriefedBy: "e1", lastBrief: "Sweep the competitors of a new idea and name each with its price." }];
  s.tasks = [
    { id: "t-1", scope: "northwind/research", runId: "run-done", parentTaskId: null, title: "Research: Court ladder", description: "", status: "done", holderRunId: "run-done", holderEmployeeId: "e1", claimedAt: ago(60 * 24), estimateCredits: 60, actualCredits: 54, dependsOn: [], createdAt: ago(60 * 24), updatedAt: ago(60 * 23) },
    { id: "t-2", scope: "northwind/research/recipes", runId: "run-research", parentTaskId: null, title: "Competitor sweep: Recipe box", description: "", status: "in_progress", holderRunId: "run-research", holderEmployeeId: "e1", claimedAt: ago(30), estimateCredits: 90, actualCredits: null, dependsOn: [], createdAt: ago(30), updatedAt: ago(5) },
  ];
  s.autonomy = {
    northwind: { autonomy: "auto", checkpoints: { hire: true }, ruleSets: { all: { deny: ["run(rm -rf *)"], ask: [], allow: [], checkpoints: [] } } },
    "northwind/software": { checkpoints: { start: true }, ruleSets: { build: { deny: [], ask: ["run"], allow: ["read_file", "edit_file"], checkpoints: [] } } },
  };
  s.ontology = () => ({
    scope: "northwind",
    generatedAt: now(),
    nodes: [
      { id: "organisation:org1", type: "organisation", name: "Northwind", scope: "northwind", status: "active", attributes: null },
      { id: "division:d1", type: "division", name: "Software", scope: "northwind/software", status: "active", attributes: null },
      { id: "division:d2", type: "division", name: "Research", scope: "northwind/research", status: "active", attributes: null },
      { id: "project:p1", type: "project", name: "Booking", scope: "northwind/software/booking", status: "active", attributes: null },
      { id: "project:p3", type: "project", name: "Recipes", scope: "northwind/research/recipes", status: "active", attributes: null },
      { id: "project:p4", type: "project", name: "Field notes", scope: "northwind/research/field-notes", status: "active", attributes: null },
      { id: "app:app1", type: "app", name: "Booking desk", scope: "northwind/software/booking/desk", status: "running", attributes: { version: "1.4.0" } },
      { id: "app:app2", type: "app", name: "Recipe box", scope: "northwind/research/recipes/box", status: "sleeping", attributes: { version: "0.9.2" } },
      { id: "employee:e1", type: "employee", name: "Ada", scope: "northwind/research", status: "idle", attributes: { role: "Product researcher" } },
      { id: "employee:e2", type: "employee", name: "Lin", scope: "northwind/research/field-notes", status: "working", attributes: { role: "Engineer" } },
      { id: "employee:e3", type: "employee", name: "Ruth", scope: "northwind", status: "idle", attributes: { role: "Security reviewer", standing: "security-reviewer" } },
      { id: "contractor:c1", type: "contractor", name: "Contractor", scope: "northwind/research/recipes", status: "working", attributes: { role: "Researcher" } },
      { id: "person:u1", type: "person", name: "Fixture Owner", scope: null, status: null, attributes: null },
      { id: "secret:MAIL_API_KEY", type: "secret", name: "MAIL_API_KEY", scope: "northwind", status: null, attributes: null },
      { id: "service:identity", type: "service", name: "identity", scope: null, status: null, attributes: null },
      { id: "service:email", type: "service", name: "email", scope: null, status: null, attributes: null },
      { id: "service:models", type: "service", name: "models", scope: null, status: null, attributes: null },
      { id: "webhook:w1", type: "webhook", name: "court-sensor", scope: null, status: null, attributes: { path: "/hooks/court-sensor" } },
    ],
    edges: [
      { from: "organisation:org1", to: "division:d1", type: "owns", label: null },
      { from: "organisation:org1", to: "division:d2", type: "owns", label: null },
      { from: "division:d1", to: "project:p1", type: "owns", label: null },
      { from: "division:d2", to: "project:p3", type: "owns", label: null },
      { from: "division:d2", to: "project:p4", type: "owns", label: null },
      { from: "project:p1", to: "app:app1", type: "owns", label: null },
      { from: "project:p3", to: "app:app2", type: "owns", label: null },
      { from: "organisation:org1", to: "secret:MAIL_API_KEY", type: "owns", label: null },
      { from: "employee:e1", to: "division:d2", type: "works-on", label: "Product researcher" },
      { from: "employee:e2", to: "project:p4", type: "works-on", label: "now: Building Field notes" },
      { from: "employee:e3", to: "organisation:org1", type: "works-on", label: "Security reviewer" },
      { from: "contractor:c1", to: "project:p3", type: "works-on", label: "now: competitor sweep" },
      { from: "contractor:c1", to: "employee:e1", type: "reports-to", label: "briefed by" },
      { from: "person:u1", to: "organisation:org1", type: "works-on", label: "owner" },
      { from: "app:app1", to: "service:identity", type: "depends-on", label: null },
      { from: "service:identity", to: "app:app1", type: "data-flows-to", label: "signed-in people" },
      { from: "app:app1", to: "service:email", type: "depends-on", label: null },
      { from: "app:app1", to: "service:email", type: "data-flows-to", label: "outbound mail" },
      { from: "app:app1", to: "service:models", type: "depends-on", label: null },
      { from: "app:app1", to: "service:models", type: "data-flows-to", label: "prompts" },
      { from: "webhook:w1", to: "app:app1", type: "data-flows-to", label: "inbound calls" },
    ],
    views: { "org-chart": ["owns", "works-on", "reports-to"], "data-flow": ["depends-on", "data-flows-to"] },
  });

  const division = (id: string, slug: string, name: string, monthCredits: number, projects: unknown[]) => ({ id, slug, name, spend: { monthCredits }, workers: [], projects });

  s.tree = () => {
    const head = { generatedAt: now(), viewerRole: s.viewerRole };
    if (!s.org) return { ...head, viewerRole: "none", organisation: null, divisions: [], needsYou: [] };
    const organisation = { ...s.org, spend: { monthCredits: 452 }, workers: [ada] };
    if (name === "empty-org") return { ...head, organisation: { ...organisation, summary: null, workers: [] }, divisions: [], needsYou: [] };
    return {
      ...head,
      organisation,
      divisions: [
        division("d1", "software", "Software", 310, [
          {
            id: "p1",
            slug: "booking",
            name: "Booking",
            stage: "live",
            ideaId: null,
            note: null,
            progress: null,
            spend: { monthCredits: 310 },
            workers: [ruth],
            apps: [{ id: "app1", slug: "desk", name: "Booking desk", health: "healthy", running: "always-on", access: "private", sharedWith: 0, visitsToday: 233, lastVisitAt: ago(2), spend: { monthCredits: 310 }, workers: [lin] }],
          },
          { id: "p2", slug: "court-ladder", name: "Court ladder", stage: "verdict", ideaId: "idea-ladder", note: "Research finished. Waiting for your call.", progress: null, spend: { monthCredits: 54 }, workers: [], apps: [] },
        ]),
        division("d2", "research", "Research", 142, [
          {
            id: "p3",
            slug: "recipes",
            name: "Recipes",
            stage: "live",
            ideaId: null,
            note: null,
            progress: null,
            spend: { monthCredits: 22 },
            workers: [ada, { id: "c1", name: "Contractor", role: "Researcher", kind: "contractor", activity: "competitor sweep", status: "working", idle: false, standing: null, briefedBy: "e1" }, { id: "c2", name: "Contractor", role: "Researcher", kind: "contractor", activity: null, status: "working", idle: false, standing: null, briefedBy: "e1" }],
            apps: [
              { id: "app2", slug: "box", name: "Recipe box", health: "healthy", running: "asleep", access: "shared", sharedWith: s.shares.app2?.length ?? 0, visitsToday: null, lastVisitAt: ago(60 * 50), spend: { monthCredits: 22 }, workers: [] },
              { id: "app3", slug: "tides", name: "Tide board", health: "healthy", running: "awake", access: "public", sharedWith: 0, visitsToday: null, lastVisitAt: null, spend: { monthCredits: 0 }, workers: [] },
            ],
          },
          {
            id: "p4",
            slug: "field-notes",
            name: "Field notes",
            stage: "building",
            ideaId: "idea-notes",
            note: null,
            progress: { runId: "run-build", label: "Build", step: 4, of: 7, spentCredits: 120, estimatedCredits: 300 },
            spend: { monthCredits: 120 },
            workers: [lin],
            apps: [],
          },
        ]),
      ],
      needsYou: [
        // As the control plane sends it: the idea's own text as the title, the verdict's whole summary as the detail.
        {
          kind: "verdict",
          id: "n1",
          ideaId: "idea-ladder",
          title: "Court ladder. A ladder league for squash club members to challenge one another on the courts they already book, with results...",
          verdict: "do-not-build",
          detail:
            "The case against first. Three club apps already run ladders for free, and the clubs that want one use them. Commercially it is worse: ladder features are bundled into every booking product. Nobody in the evidence paid for a ladder on its own. Verdict: do not build. Missing evidence of demand is a reason not to spend money.",
        },
        { kind: "approval", id: "n2", runId: "run-research", approvalId: "a1", title: "Spend 20 more credits on Tide tables research?", detail: "Ada is waiting for you." },
        ...Object.values(s.hires)
          .filter((h) => h.status === "proposed")
          .map((h) => ({ kind: "hire", id: `n-${h.id}`, hireId: h.id, title: `A ${String(h.role).toLowerCase()} for ${h.scope === "northwind/research" ? "Research" : "Software"}`, detail: String(h.reason), scope: h.scope, expectedMonthlyCredits: h.expectedMonthlyCredits })),
        { kind: "idle", id: "n4", employeeId: "e3", title: "Ruth has had nothing to do for 14 days", detail: "Give Ruth work, or let Ruth go. Its memory is kept." },
      ],
    };
  };

  s.credits = () => ({
    scope: "northwind",
    balance: name === "empty-org" ? 0 : 9_548,
    month: { spent: 452, ai: 310, hosting: 142 },
    monthsLeftAtPace: 21,
    budgets: [
      { scope: "northwind", name: "Northwind", level: "organisation", depth: 0, spentCredits: 452, capCredits: 2000, appId: null },
      { scope: "northwind/software", name: "Software", level: "division", depth: 1, spentCredits: 310, capCredits: 1000, appId: null },
      { scope: "northwind/software/booking/desk", name: "Booking desk", level: "app", depth: 2, spentCredits: 310, capCredits: 500, appId: "app1" },
      { scope: "northwind/research", name: "Research", level: "division", depth: 1, spentCredits: 142, capCredits: null, appId: null },
      { scope: "northwind/research/field-notes", name: "Field notes", level: "project", depth: 2, spentCredits: 120, capCredits: 300, appId: null },
    ],
    estimates: { pieces: 12, withinPercent: 8, under: 9, over: 3, largestMissPercent: 15 },
    notCharged: { credits: 37, repairs: 2 },
    overdraft: { frostauraLimit: 3000, ownLimit: 1000 },
    topUps: [{ at: ago(60 * 24 * 10), credits: 10_000, note: "Added by FrostAura" }],
    heldCredits: 12,
    available: (name === "empty-org" ? 0 : 9_548) + 3000,
  });

  s.addRun = (title, kind) => {
    counter += 1;
    const id = `run-${kind}-${counter}`;
    s.runs[id] = makeRun(id, { kind, title, scope: s.org?.slug ?? "", startedAt: now() }, [
      ev("run.started", {}),
      ev("plan.proposed", { summary: "Make the smallest thing that works, then check it.", items: [{ id: "x1", text: "It opens and signs a member in", check: "A real browser walk" }] }),
      ev("task.created", { taskId: "x", summary: "First slice" }),
      ev("task.claimed", { taskId: "x", holder: "Lin" }, 400),
    ]);
    return id;
  };

  s.addIdea = (b) => {
    counter += 1;
    const ideaId = `idea-${counter}`;
    const runId = `run-idea-${counter}`;
    s.runs[runId] = makeRun(runId, { kind: "research", title: `Researching your idea`, scope: s.org?.slug ?? "", ideaId, estimateCredits: 60, startedAt: now() }, researchScript(false));
    const created: IdeaFixture = { ...(s.ideas["idea-ladder"] as IdeaFixture), id: ideaId, title: b.text.slice(0, 40), text: b.text, constraints: b.constraints, status: "researching", runId, verdict: null, scope: null };
    s.ideas[ideaId] = created;
    return created;
  };

  s.addConversation = (scope, message, employeeId) => {
    counter += 1;
    const id = `run-conv-${counter}`;
    const who = employeeId ? "Ada" : (scope.split("/").pop() ?? scope);
    s.runs[id] = makeRun(id, { kind: "conversation", title: message.slice(0, 120), scope, startedAt: now(), createdAt: now(), employeeId: employeeId ?? null, conversationId: `conv-${scope}#${employeeId ?? ""}` }, [
      // The control plane writes the owner's own message into the run's log first.
      ev("message", { from: "owner", userId: s.user.id, text: message }, 0),
      ev("run.started", {}, 50),
      ev("message", { from: who, text: `About “${message}”: one verdict is waiting and one approval.` }, 500),
      ev("run.finished", { outcome: "succeeded", totals: { credits: 0.4 } }, 50),
    ]);
    return id;
  };

  return s;
}
