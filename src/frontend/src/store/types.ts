/**
 * The console's reading of the control plane's public API (ARCH-004). Where ARCH-004 names an
 * endpoint but not its JSON, the shape here is the console's assumption, listed for the
 * control-plane lane in docs/use-cases/UC-001-console.md. Every field is camelCase JSON.
 */

// ---------------------------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------------------------

export interface Me {
  user: { id: string; displayName: string; email: string | null };
  /** Null on first run: signed in, no organisation named yet. */
  organisation: OrganisationRef | null;
}

export interface OrganisationRef {
  id: string;
  slug: string;
  name: string;
}

/** `GET /api/auth/options` — what sign-in methods this deployment offers. */
export interface AuthOptions {
  passkey: boolean;
  /** True only in development. The console shows the development sign-in only when this is true. */
  developmentSignIn: boolean;
}

// ---------------------------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------------------------

export type AppHealth = "healthy" | "degraded" | "down" | "unknown";
export type AppRunning = "asleep" | "awake" | "always-on" | "starting" | "paused";
export type AppAccess = "private" | "shared" | "public";
export type ProjectStage = "idea" | "researching" | "verdict" | "planning" | "building" | "evaluating" | "reviewing" | "publishing" | "live" | "paused" | "dropped";

export interface Worker {
  id: string;
  name: string;
  role: string;
  kind: "employee" | "contractor";
  /** What it is doing right now, in plain language, or null when idle. */
  activity: string | null;
}

export interface Spend {
  /** Credits spent at this node and beneath it this calendar month. */
  monthCredits: number;
}

export interface TreeApp {
  id: string;
  slug: string;
  name: string;
  health: AppHealth;
  running: AppRunning;
  access: AppAccess;
  /** How many people it is shared with; meaningful when access is "shared". */
  sharedWith: number;
  visitsToday: number | null;
  lastVisitAt: string | null;
  spend: Spend;
  workers: Worker[];
}

export interface ProjectProgress {
  runId: string;
  label: string;
  step: number;
  of: number;
  spentCredits: number;
  estimatedCredits: number | null;
}

export interface TreeProject {
  id: string;
  slug: string;
  name: string;
  stage: ProjectStage;
  /** The idea this project came from, when it is still waiting on or carrying a verdict. */
  ideaId: string | null;
  /** Plain-language line under the name, e.g. why it is paused. */
  note: string | null;
  progress: ProjectProgress | null;
  spend: Spend;
  workers: Worker[];
  apps: TreeApp[];
}

export interface TreeDivision {
  id: string;
  slug: string;
  name: string;
  spend: Spend;
  workers: Worker[];
  projects: TreeProject[];
}

export type NeedsYou =
  | { kind: "verdict"; id: string; ideaId: string; title: string; verdict: VerdictOutcome; detail: string | null }
  | { kind: "approval"; id: string; runId: string; approvalId: string; title: string; detail: string | null };

export interface Tree {
  /** Null on first run. */
  organisation: (OrganisationRef & { summary: string | null; spend: Spend; workers: Worker[] }) | null;
  divisions: TreeDivision[];
  needsYou: NeedsYou[];
}

// ---------------------------------------------------------------------------------------------
// Ideas and verdicts
// ---------------------------------------------------------------------------------------------

export type VerdictOutcome = "build" | "change" | "do-not-build";
export type DecisionChoice = "build" | "change" | "overrule" | "drop";

export interface IdeaEstimate {
  credits: number;
  /** One plain sentence on what the estimate covers. */
  basis: string;
}

export interface CreateIdeaRequest {
  text: string;
  constraints: string[];
}

export interface Verdict {
  outcome: VerdictOutcome;
  headline: string;
  summary: string;
  existing: { name: string; description: string; url: string | null }[];
  gap: string[];
  demand: { paragraphs: string[]; evidenceFound: boolean };
  /** What would change the verdict, or null when nothing would. */
  wouldChange: { text: string; changeLabel: string | null; estimateCredits: number | null } | null;
  method: string | null;
}

export interface VerdictRecord {
  total: number;
  build: number;
  change: number;
  doNotBuild: number;
  overruled: { ideaId: string; title: string; verdict: VerdictOutcome; outcome: string }[];
}

export interface Idea {
  id: string;
  title: string;
  text: string;
  constraints: string[];
  status: "researching" | "verdict" | "decided" | "failed";
  runId: string;
  /** Path of slugs to where the idea is placed, once placed. */
  scope: string | null;
  research: { estimatedCredits: number; spentCredits: number; by: string | null };
  verdict: Verdict | null;
  decision: { choice: DecisionChoice; at: string; by: string; overruled: boolean; runId: string | null } | null;
  record: VerdictRecord;
}

// ---------------------------------------------------------------------------------------------
// Runs and their event stream
// ---------------------------------------------------------------------------------------------

export type RunStatus = "queued" | "running" | "waiting" | "paused" | "finished" | "failed" | "cancelled";

export interface Run {
  id: string;
  kind: "research" | "conversation" | "build" | "factory";
  title: string;
  scope: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** The last sequence number written; the stream resumes after it. */
  lastSeq: number;
  ideaId: string | null;
  estimateCredits: number | null;
  spentCredits: number;
}

export interface RunEvent {
  seq: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface ConversationRequest {
  scope: string;
  message: string;
  /** Set when the conversation is with one employee rather than a node. */
  employeeId?: string;
}

// ---------------------------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------------------------

export interface AppDetail {
  id: string;
  name: string;
  scope: string;
  health: { state: AppHealth; summary: string };
  running: AppRunning;
  addresses: { path: string; subdomain: string | null };
  telemetry: {
    visitsToday: number;
    requestsToday: number;
    errorsToday: number;
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    lastVisitAt: string | null;
  };
  cost: { monthCredits: number; capCredits: number | null };
  settings: { running: "sleep" | "always-on"; access: AppAccess };
  /** Expected monthly credits for each running choice, so the choice is made with its price. */
  runningCost: { sleep: number; alwaysOn: number } | null;
  sharedWith: number;
}

export type AppSettingsUpdate = Partial<AppDetail["settings"]>;

// ---------------------------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------------------------

export interface BudgetLine {
  scope: string;
  name: string;
  level: "organisation" | "division" | "project" | "app" | "employee";
  depth: number;
  spentCredits: number;
  capCredits: number | null;
  appId: string | null;
}

export interface Credits {
  scope: string;
  balance: number;
  month: { spent: number; ai: number; hosting: number };
  monthsLeftAtPace: number | null;
  budgets: BudgetLine[];
  estimates: { pieces: number; withinPercent: number; under: number; over: number; largestMissPercent: number } | null;
  notCharged: { credits: number; repairs: number };
  overdraft: { frostauraLimit: number; ownLimit: number | null } | null;
  topUps: { at: string; credits: number; note: string }[];
}

// ---------------------------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------------------------

export type HealthState = "healthy" | "unhealthy";

export interface ServiceHealth {
  key: string;
  name: string;
  state: HealthState;
  latencyMs: number;
  detail: string | null;
}

export interface SystemStatus {
  overall: HealthState;
  checkedAt: string;
  services: ServiceHealth[];
}
