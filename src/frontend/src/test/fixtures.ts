/**
 * TEST ONLY. Answers in the exact shapes the control plane sends (read from a running stack and
 * from `Endgame.Infrastructure/Work/*`), with invented content. Tests build on these so the
 * console is exercised against what the real system returns, not what it once assumed.
 */

/** A verdict document as research writes it today: sections as `{ evidence }`, products as text. */
export const RESEARCH_VERDICT = {
  outcome: "do-not-build",
  headline: "Every part of this already exists, with no evidence anyone will pay",
  summary: "The case against first. Pager is three commodities bolted together.",
  against: "1) Paging is solved by Beeper Co. 2) Nobody asked for another one.",
  existing: {
    evidence: "Free, maintained products already page people.",
    products: ["Beeper Co (beeper/beeper-server) — open-source paging with escalation", "Ringer — paid paging for small teams"],
  },
  gap: { evidence: "No defensible gap survives the evidence." },
  demand: { evidence: "No evidence of demand was found." },
  wouldChange: "A verified cohort paying a real price.",
  redLines: { line: null, breached: false, reasoning: "None of the four lines is crossed." },
  placement: { app: null, name: null, project: null, division: null },
  method: { argued: "against first", sources: ["https://beeper.example.test/docs", "https://ringer.example.test/pricing"], strands: ["existing", "gap", "demand"], contractors: 3 },
};

export function ideaFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    title: "Pager",
    text: "Pages people",
    constraints: [],
    status: "verdict",
    runId: "r1",
    scope: "acme/tools",
    research: { estimatedCredits: 60, spentCredits: 54, by: "Ada" },
    verdict: RESEARCH_VERDICT,
    decision: null,
    record: { total: 3, build: 1, change: 1, doNotBuild: 1, overruled: [] },
    redLine: null,
    ...overrides,
  };
}

export const JOB = { mandate: "Research every new idea and argue the case against it first.", scope: "acme/tools", tools: ["read_file", "web_search", "spawn"], services: ["models"], monthlyCreditLimit: 200, modelTier: "research" };

export function employeeFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    kind: "employee",
    name: "Ada",
    role: "Product researcher",
    status: "idle",
    standing: null,
    scope: "acme/tools",
    reportsTo: null,
    briefedBy: null,
    jobDescription: JOB,
    idle: { flagged: false, since: null, afterDays: 14 },
    currentRun: null,
    lastRunId: "r1",
    lastActiveAt: "2026-11-24T10:00:00Z",
    createdAt: "2026-09-01T10:00:00Z",
    releasedAt: null,
    memoryEntries: 2,
    brief: null,
    ...overrides,
  };
}

export const TRACK_RECORD = {
  employeeId: "e1",
  work: { accepted: 19, sentBack: 3, acceptedPercent: 86.4, judged: 0 },
  runs: { finished: 22, succeeded: 20, failed: 1, cancelled: 1 },
  repairsNotCharged: { credits: 12.5, calls: 3 },
  cost: { toDateCredits: 1240, monthCredits: 140 },
  contractors: { engaged: 6, working: 1, toDateCredits: 300, monthCredits: 40 },
  estimates: { pieces: 9, withinPercent: 12, under: 6, over: 3, largestMissPercent: 17, typicalGapPercent: -18, typically: "under" },
};

export function employeeDetailFixture(overrides: Record<string, unknown> = {}) {
  return { employee: employeeFixture(overrides), trackRecord: TRACK_RECORD, contractors: [employeeFixture({ id: "c1", kind: "contractor", name: "Contractor", role: "Competitor sweep", status: "working", brief: "Find every club ladder product." })], reports: [] };
}

export const MEMORY = [
  { id: "m1", employeeId: "e1", scope: "acme", title: "Proof before building", body: "Acme wants proof someone will pay before it builds.", kind: "preference", sourceRunId: null, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", lastReviewedAt: "2026-11-15T10:00:00Z", archived: false },
  { id: "m2", employeeId: "e1", scope: "acme/tools", title: "Three contractors, not six", body: "Splitting the sweep too finely ran 17% over.", kind: "lesson", sourceRunId: "r1", createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z", lastReviewedAt: "2026-11-15T10:00:00Z", archived: false },
];

export const MEMORY_CHANGES = [
  { id: "x4", memoryId: "m2", action: "corrected", by: "review", userId: null, runId: "rv1", detail: { why: "Habit corrected" }, at: "2026-11-15T10:00:00Z" },
  { id: "x3", memoryId: "m9", action: "removed", by: "review", userId: null, runId: "rv1", detail: { why: "Out of date" }, at: "2026-11-15T10:00:00Z" },
  { id: "x2", memoryId: "m1", action: "merged", by: "review", userId: null, runId: "rv1", detail: { from: ["m7", "m8"] }, at: "2026-11-15T10:00:00Z" },
  { id: "x1", memoryId: "m1", action: "added", by: "employee", userId: null, runId: "r1", detail: null, at: "2026-10-01T10:00:00Z" },
];

export function hireFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "h1",
    status: "proposed",
    trigger: "stage",
    needKey: "stage:acme/tools/ledger:build",
    scope: "acme/tools",
    reason: "Ledger entered its build and nobody here builds.",
    name: "Lin",
    role: "Engineer",
    jobDescription: { ...JOB, mandate: "Build Ledger to its plan.", tools: ["read_file", "edit_file", "run"], modelTier: "build-t1", monthlyCreditLimit: 300 },
    reportsTo: null,
    expectedMonthlyCredits: 300,
    withinBudget: false,
    headroomCredits: 120,
    contractorRole: null,
    raisedBy: "runner",
    raisedByRunId: "r2",
    decision: null,
    employeeId: null,
    createdAt: "2026-11-24T09:00:00Z",
    ...overrides,
  };
}

export function autonomyFixture(overrides: Record<string, unknown> = {}) {
  return {
    scope: "acme/tools",
    autonomy: "checkpoints",
    autonomySetAtPath: "acme",
    checkpoints: { start: { on: true, setAtPath: "acme/tools" }, plan: { on: false, setAtPath: null }, hire: { on: true, setAtPath: "acme" } },
    ruleSets: [
      { stage: "all", deny: ["run(rm -rf *)"], ask: [], allow: [], checkpoints: [], setAtPath: "acme", overrides: [] },
      { stage: "build", deny: [], ask: ["run"], allow: ["edit_file", "read_file"], checkpoints: [], setAtPath: "acme/tools", overrides: ["acme"] },
    ],
    stages: ["all", "research", "plan", "build", "evaluate", "review", "conversation"],
    ...overrides,
  };
}

export const ONTOLOGY = {
  scope: "acme",
  generatedAt: "2026-11-24T10:00:00Z",
  nodes: [
    { id: "organisation:o1", type: "organisation", name: "Acme", scope: "acme", status: "active", attributes: null },
    { id: "division:d1", type: "division", name: "Tools", scope: "acme/tools", status: "active", attributes: null },
    { id: "app:a1", type: "app", name: "Ledger web", scope: "acme/tools/ledger/web", status: "running", attributes: { version: "1.0.0" } },
    { id: "employee:e1", type: "employee", name: "Ada", scope: "acme/tools", status: "working", attributes: { role: "Product researcher", standing: null, modelTier: "research", monthlyCreditLimit: 200 } },
    { id: "service:models", type: "service", name: "models", scope: null, status: null, attributes: null },
    { id: "service:identity", type: "service", name: "identity", scope: null, status: null, attributes: null },
  ],
  edges: [
    { from: "organisation:o1", to: "division:d1", type: "owns", label: null },
    { from: "division:d1", to: "app:a1", type: "owns", label: null },
    { from: "employee:e1", to: "division:d1", type: "works-on", label: "Product researcher" },
    { from: "app:a1", to: "service:models", type: "depends-on", label: null },
    { from: "app:a1", to: "service:models", type: "data-flows-to", label: "prompts" },
    { from: "app:a1", to: "service:identity", type: "depends-on", label: null },
    { from: "service:identity", to: "app:a1", type: "data-flows-to", label: "signed-in end users" },
  ],
  views: { "org-chart": ["owns", "works-on", "reports-to"], "data-flow": ["depends-on", "data-flows-to"] },
};
