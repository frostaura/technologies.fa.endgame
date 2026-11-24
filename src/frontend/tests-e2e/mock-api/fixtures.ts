/**
 * TEST ONLY. Fixture organisations for the mock control plane. Every name and figure here is
 * invented for the specs and exists nowhere in the running console.
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

export interface MockState {
  signedIn: boolean;
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
  tree: () => unknown;
  credits: () => unknown;
  addIdea: (b: { text: string; constraints: string[] }) => IdeaFixture;
  addRun: (title: string, kind: string) => string;
  addConversation: (scope: string, message: string, employeeId?: string) => string;
}

const now = () => new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function ev(type: string, payload: Record<string, unknown> = {}, delayMs = 60, gate?: string): Omit<MockEvent, "seq" | "at"> {
  return { type, payload, delayMs, ...(gate ? { gate } : {}) };
}

function makeRun(id: string, summary: Partial<RunSummary>, script: Omit<MockEvent, "seq" | "at">[], released = 0): MockRun {
  const events = script.map((e, i) => ({ ...e, seq: i + 1, at: ago(script.length - i) }));
  return {
    summary: { id, kind: "research", title: "Work", scope: "fixture", status: "running", startedAt: ago(30), finishedAt: null, lastSeq: 0, ideaId: null, estimateCredits: null, spentCredits: 0, ...summary },
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
    ev("tool.requested", { tool: "web.search", arguments: { query: "club ladder software" } }),
    ev("tool.permitted", { tool: "web.search", rule: "research may search the web" }),
    ev("tool.result", { tool: "web.search", result: "12 results" }),
    ev("tool.requested", { tool: "shell.exec", arguments: { command: "curl example" } }),
    ev("tool.denied", { tool: "shell.exec", rule: "protected floor: no shell in research", reason: "Research never runs commands." }),
    ev("subagent.started", { subagentId: "s1", brief: "Find three products that already sell club ladders." }),
    ev("subagent.finished", { subagentId: "s1", summary: "Found three, each with pricing." }),
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
    ev("estimate.scored", { estimated: 60, actual: 54 }),
    ev("message", { from: "Ada", text: "Research is done. The verdict is ready for you." }),
    ev("run.finished", { outcome: "succeeded", summary: "Verdict: do not build as its own app.", totals: { credits: 54 } }),
  ];
}

export function scenario(name: ScenarioName): MockState {
  const s: MockState = {
    signedIn: !name.startsWith("signed-out"),
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
    org: name === "first-run" ? null : { id: "org1", slug: "northwind", name: "Northwind", summary: "Ada is chief of staff · all apps healthy" },
    runs: {},
    ideas: {},
    apps: {},
    tree: () => null,
    credits: () => null,
    addIdea: () => ({ id: "", title: "", runId: "", status: "", decision: null }),
    addRun: () => "",
    addConversation: () => "",
  };

  let counter = 0;
  const ada = { id: "e1", name: "Ada", role: "Product researcher", kind: "employee", activity: null as string | null };
  const lin = { id: "e2", name: "Lin", role: "Engineer", kind: "employee", activity: "Building Field notes" };
  const ruth = { id: "e3", name: "Ruth", role: "Security reviewer", kind: "employee", activity: null };

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
      runningCost: { sleep: 30, alwaysOn: 180 },
      sharedWith: 0,
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
      runningCost: { sleep: 20, alwaysOn: 150 },
      sharedWith: 2,
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

  s.runs["run-research"] = makeRun("run-research", { kind: "research", title: "Researching Court ladder", scope: "northwind", ideaId: "idea-ladder", estimateCredits: 60, spentCredits: 0 }, researchScript(true));

  s.runs["run-done"] = makeRun("run-done", { kind: "research", title: "Research: Court ladder", scope: "northwind", ideaId: "idea-ladder", status: "finished", estimateCredits: 60, spentCredits: 54, finishedAt: ago(5) }, researchScript(false));
  s.runs["run-done"].released = s.runs["run-done"].events.length;

  const verdict = {
    outcome: "do-not-build",
    headline: "Do not build this as its own app.",
    summary: "Ladders for clubs are already sold, and nothing in the idea is something they lack.",
    existing: [
      { name: "Fixture Ladders", description: "Ladders and leagues for clubs.", url: "https://example.test/ladders" },
      { name: "Fixture Leagues", description: "Club management with box leagues.", url: null },
    ],
    gap: ["A challenge that books the court in the same step.", "That is a feature, not a product."],
    demand: { paragraphs: ["Members of one club. No one outside it has asked."], evidenceFound: false },
    wouldChange: { text: "Build it as a feature of Booking desk instead.", changeLabel: "add to Booking desk", estimateCredits: 120 },
    method: "Ada briefed one contractor per question. The case against the idea was argued first.",
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
  };
  s.ideas["idea-researching"] = { ...(s.ideas["idea-ladder"] as IdeaFixture), id: "idea-researching", title: "Tide tables", status: "researching", runId: "run-research", verdict: null, research: { estimatedCredits: 60, spentCredits: 8, by: "Ada" } };

  const division = (id: string, slug: string, name: string, monthCredits: number, projects: unknown[]) => ({ id, slug, name, spend: { monthCredits }, workers: [], projects });

  s.tree = () => {
    if (!s.org) return { organisation: null, divisions: [], needsYou: [] };
    const organisation = { ...s.org, spend: { monthCredits: 452 }, workers: [ada] };
    if (name === "empty-org") return { organisation: { ...organisation, summary: null, workers: [] }, divisions: [], needsYou: [] };
    return {
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
            workers: [ada, { id: "c1", name: "Contractor", role: "Researcher", kind: "contractor", activity: "competitor sweep" }, { id: "c2", name: "Contractor", role: "Researcher", kind: "contractor", activity: null }],
            apps: [{ id: "app2", slug: "box", name: "Recipe box", health: "healthy", running: "asleep", access: "shared", sharedWith: 2, visitsToday: null, lastVisitAt: ago(60 * 50), spend: { monthCredits: 22 }, workers: [] }],
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
        { kind: "verdict", id: "n1", ideaId: "idea-ladder", title: "Research says do not build “Court ladder”", verdict: "do-not-build", detail: "Read it, or overrule." },
        { kind: "approval", id: "n2", runId: "run-research", approvalId: "a1", title: "Spend 20 more credits on Tide tables research?", detail: "Ada is waiting for you." },
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
    s.runs[id] = makeRun(id, { kind: "conversation", title: "Conversation", scope, startedAt: now() }, [
      ev("run.started", {}, 50),
      ev("message", { from: who, text: `About “${message}”: one verdict is waiting and one approval.` }, 500),
      ev("run.finished", { outcome: "succeeded", totals: { credits: 0.4 } }, 50),
    ]);
    return id;
  };

  return s;
}
