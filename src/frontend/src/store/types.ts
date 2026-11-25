/**
 * The console's reading of the control plane's public API (ARCH-004), checked field by field
 * against what the control plane returns (`src/backend/Endgame.Infrastructure/Tree/ConsoleViews.cs`,
 * `Endgame.ControlPlane/Endpoints/*`). Where the two differed, the control plane won. Every field
 * is camelCase JSON; GUIDs and timestamps arrive as strings, decimals as numbers.
 */

// ---------------------------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------------------------

/** A role, from the least to the most. */
export type MemberRole = "viewer" | "builder" | "admin" | "owner";

export interface Membership {
  id: string;
  /** Path of slugs to where the role is held. */
  scope: string;
  level: "organisation" | "division" | "project" | "app";
  role: MemberRole;
  organisationId: string;
  organisationSlug: string;
  organisationName: string;
}

export interface Me {
  user: { id: string; displayName: string; email: string | null };
  /** Null on first run: signed in, no organisation named yet. */
  organisation: OrganisationRef | null;
  /** A FrostAura operator (God mode). */
  isOperator: boolean;
  passkeys: number;
  memberships: Membership[];
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
  /** `idle`, `working` or `paused`. */
  status: "idle" | "working" | "paused";
  /** True when it has had no work for longer than the organisation's idle setting. */
  idle: boolean;
  /** A standing hire's role (`security-reviewer`), never released. */
  standing: string | null;
  /** A contractor's briefing employee. */
  briefedBy: string | null;
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
  /** Null until the app has reported anything: not measured, never zero. */
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
  | { kind: "approval"; id: string; runId: string; approvalId: string; title: string; detail: string | null }
  | { kind: "hire"; id: string; hireId: string; title: string; detail: string | null; scope: string; expectedMonthlyCredits: number }
  | { kind: "idle"; id: string; employeeId: string; title: string; detail: string | null };

export interface Tree {
  generatedAt: string;
  /** The signed-in person's role over the whole tree as shown; "none" on first run. */
  viewerRole: MemberRole | "none";
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

/** A product research found that already does this, with what it does and where that was read. */
export interface ExistingProduct {
  name: string;
  /** What it does, in the research's words. */
  does: string | null;
  sources: string[];
}

/** One strand of the research: what it looked into, how hard, and how sure it is. */
export interface Strand {
  id: string;
  title: string;
  searches: number | null;
  sources: number | null;
  confidence: string | null;
}

/** One piece of evidence that people want this (or do not), with where it was read. */
export interface Signal {
  text: string;
  source: string | null;
}

/**
 * The verdict document as the console reads it, normalised by `normaliseVerdict` from whatever
 * research wrote (ARCH-004, the verdict schema). Every list is a list, every text is text.
 */
export interface Verdict {
  outcome: VerdictOutcome;
  headline: string;
  summary: string;
  /** The case against the idea, argued first, as separate points. */
  against: string[];
  existing: { evidence: string[]; products: ExistingProduct[] };
  gap: { paragraphs: string[] };
  demand: { paragraphs: string[]; signals: Signal[]; evidenceFound: boolean };
  /** What to change: set exactly when the outcome is "change" (ARCH-004, the verdict document). */
  suggestedChange: string | null;
  /** What evidence would change the verdict, or null when nothing would. */
  wouldChange: { text: string; changeLabel: string | null; estimateCredits: number | null } | null;
  /** Where research suggests the idea lives once built. */
  placement: { division: string | null; project: string | null; app: string | null; name: string | null } | null;
  /** The red-line screen. Null when research did not record one. */
  redLines: { breached: boolean; line: string | null; reasoning: string | null } | null;
  method: { summary: string | null; argued: string | null; strands: Strand[]; sources: string[]; searches: string[]; searchCount: number | null; confidence: string | null; contractors: number | null };
  /** Rules code applied over the judge's word (e.g. no demand found, so do not build). */
  rulesApplied: string[];
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
  decision: { choice: DecisionChoice; at: string; by: string; overruled: boolean; runId: string | null; via: "person" | "auto-mode" } | null;
  record: VerdictRecord;
  /** The red line the verdict found breached; nothing can be built over it. */
  redLine: string | null;
}

// ---------------------------------------------------------------------------------------------
// Runs and their event stream
// ---------------------------------------------------------------------------------------------

export type RunStatus = "queued" | "running" | "waiting" | "paused" | "finished" | "failed" | "cancelled";

export interface Run {
  id: string;
  kind: "research" | "conversation" | "build" | "factory" | "task" | "review" | "suggest";
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
  /** Set when the run is one employee's. */
  employeeId: string | null;
  /** Set when the run is a turn of a docked conversation. */
  conversationId: string | null;
  /** True once a budget on the run's chain was spent while it ran. */
  budgetExhausted: boolean;
  outcome: string | null;
  summary: string | null;
  createdAt: string;
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
  /** Continue a given conversation; by default the latest one at the scope is continued. */
  conversationId?: string;
}

/** One message of a docked conversation, in the order it was written. */
export interface ConversationMessage {
  runId: string;
  seq: number;
  at: string;
  /** "owner" for the owner's own messages; otherwise who answered. */
  from: string;
  text: string;
}

/** `GET /api/conversations?scope=&employeeId=`: oldest first, at most the last 200 messages. */
export interface ConversationHistory {
  scope: string;
  /** Null when nothing has been said at this scope yet. */
  conversationId: string | null;
  employeeId: string | null;
  messages: ConversationMessage[];
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
  /** From the app's own telemetry (today is the UTC day). Null until it has measured anything. */
  telemetry: AppTelemetry | null;
  cost: { monthCredits: number; capCredits: number | null };
  settings: { running: "sleep" | "always-on"; access: AppAccess };
  /** Expected monthly credits for each running choice, from measured hosting. Null until measured. */
  runningCost: { sleep: number; alwaysOn: number } | null;
  sharedWith: number;
  /** The app's own lifecycle word (draft, building, running, sleeping, failed, stopped, archived). */
  status: string;
  version: string | null;
  publishedAt: string | null;
  /** Minutes idle before it sleeps. */
  idleMinutes: number;
}

export interface AppTelemetry {
  visitsToday: number;
  requestsToday: number;
  errorsToday: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  lastVisitAt: string | null;
}

export type AppSettingsUpdate = Partial<AppDetail["settings"]> & { idleMinutes?: number };

/** `GET /api/apps/{id}/shares`: an address the app is shared with. */
export interface AppShare {
  email: string;
  invitedAt: string;
  /** True once the person has registered with the app. */
  registered: boolean;
}

/** `POST /api/apps/{id}/shares` → the one-time code, returned once and never again. */
export interface AppShareCreated {
  email: string;
  invitationCode: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------------------------
// Secrets — names and where they were set, never a value
// ---------------------------------------------------------------------------------------------

export type ScopeLevel = "organisation" | "division" | "project" | "app";

export interface SecretName {
  name: string;
  setAtLevel: ScopeLevel;
  setAtPath: string;
  setAt: string;
  /** True when it was set above this scope. */
  inherited: boolean;
  /** The paths of higher levels whose secret of the same name this one replaces. */
  overrides: string[];
}

/** `GET /api/secrets?scope=` */
export interface SecretList {
  scope: string;
  effective: SecretName[];
  setBelow: { name: string; setAtPath: string }[];
}

// ---------------------------------------------------------------------------------------------
// Operator access — God mode's audit trail, for the Owner
// ---------------------------------------------------------------------------------------------

export interface OperatorAction {
  id: string;
  at: string;
  /** e.g. organisation.entered, organisation.provisioned, credits.top_up */
  action: string;
  operator: { id: string; email: string | null; displayName: string };
  detail: Record<string, unknown> | null;
}

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
  estimates: Estimates | null;
  notCharged: { credits: number; repairs: number };
  overdraft: { frostauraLimit: number; ownLimit: number | null } | null;
  topUps: { at: string; credits: number; note: string }[];
  /** Credits reserved for work in flight across the organisation. */
  heldCredits: number;
  /** What can still be spent: the balance plus the overdraft limit. */
  available: number;
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

// ---------------------------------------------------------------------------------------------
// The workforce (ARCH-004, Workforce) — `GET /api/employees*`, `/api/hires*`
// ---------------------------------------------------------------------------------------------

export type PlatformService = "identity" | "models" | "secrets" | "email" | "schedules" | "webhooks" | "telemetry";

export interface PersonRef {
  id: string;
  name: string;
}

export interface JobDescription {
  mandate: string;
  /** Path of slugs to where in the cascade it works. */
  scope: string;
  tools: string[];
  services: string[];
  monthlyCreditLimit: number | null;
  /** A routing-table task type; shown in plain words in normal mode. */
  modelTier: string | null;
}

export type EmployeeStatus = "idle" | "working" | "paused" | "released";

export interface Employee {
  id: string;
  kind: "employee" | "contractor";
  name: string;
  role: string;
  status: EmployeeStatus;
  standing: string | null;
  scope: string;
  reportsTo: PersonRef | null;
  briefedBy: PersonRef | null;
  jobDescription: JobDescription;
  idle: { flagged: boolean; since: string | null; afterDays: number };
  currentRun: { id: string; title: string } | null;
  lastRunId: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  releasedAt: string | null;
  memoryEntries: number;
  /** A contractor's brief. */
  brief: string | null;
}

export interface Estimates {
  pieces: number;
  withinPercent: number;
  under: number;
  over: number;
  largestMissPercent: number;
}

export interface TrackRecord {
  employeeId: string;
  work: { accepted: number; sentBack: number; acceptedPercent: number | null };
  runs: { finished: number; succeeded: number; failed: number; cancelled: number };
  repairsNotCharged: { credits: number; calls: number };
  cost: { toDateCredits: number; monthCredits: number };
  contractors: { engaged: number; working: number; toDateCredits: number; monthCredits: number };
  estimates: Estimates | null;
}

/** `GET /api/employees/{id}` */
export interface EmployeeDetail {
  employee: Employee;
  trackRecord: TrackRecord;
  /** Contractors it has briefed that are working now. */
  contractors: Employee[];
  reports: Employee[];
}

export interface JobDescriptionInput {
  mandate?: string;
  tools?: string[];
  services?: string[];
  monthlyCreditLimit?: number;
  modelTier?: string;
}

export interface EmployeePatch {
  name?: string;
  role?: string;
  jobDescription?: JobDescriptionInput;
  reportsTo?: string;
  clearReportsTo?: boolean;
  clearMonthlyCreditLimit?: boolean;
  status?: "paused" | "idle";
}

export type MemoryKind = "fact" | "practice" | "preference" | "lesson";

export interface MemoryEntry {
  id: string;
  employeeId: string;
  scope: string;
  title: string;
  body: string;
  kind: MemoryKind;
  sourceRunId: string | null;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt: string | null;
  archived: boolean;
}

export type MemoryAction = "added" | "corrected" | "merged" | "removed" | "archived" | "restored" | "reviewed";

export interface MemoryChange {
  id: string;
  memoryId: string | null;
  action: MemoryAction;
  /** `employee`, `person`, `review` or `platform`. */
  by: string;
  userId: string | null;
  runId: string | null;
  detail: unknown;
  at: string;
}

export type HireStatus = "proposed" | "accepted" | "declined";
export type HireTrigger = "division" | "stage" | "recurring" | "promotion" | "owner";

export interface Hire {
  id: string;
  status: HireStatus;
  trigger: HireTrigger;
  needKey: string | null;
  scope: string;
  reason: string;
  name: string;
  role: string;
  jobDescription: JobDescription;
  reportsTo: PersonRef | null;
  expectedMonthlyCredits: number;
  withinBudget: boolean;
  headroomCredits: number;
  contractorRole: string | null;
  raisedBy: "person" | "runner";
  raisedByRunId: string | null;
  decision: { via: string; by: string; at: string; note: string | null } | null;
  employeeId: string | null;
  createdAt: string;
}

export interface HireEdit {
  reason?: string;
  name?: string;
  role?: string;
  jobDescription?: JobDescriptionInput;
  expectedMonthlyCredits?: number;
}

export interface HireProposalRequest {
  scope: string;
  name: string;
  role: string;
  reason: string;
  jobDescription: JobDescriptionInput;
  expectedMonthlyCredits: number;
  trigger?: HireTrigger;
  needKey?: string;
}

/** `GET /api/employees/recurring-roles?scope=`: a contractor role that keeps coming back. */
export interface RecurringRole {
  scope: string;
  role: string;
  contractors: number;
  windowDays: number;
  costCredits: number;
  lastBriefedBy: string;
  lastBrief: string;
}

// ---------------------------------------------------------------------------------------------
// Autonomy, checkpoints and stage rule sets — `GET/PUT/DELETE /api/autonomy*`
// ---------------------------------------------------------------------------------------------

export interface CheckpointSetting {
  on: boolean;
  /** Where it was set; null when nowhere, so off. */
  setAtPath: string | null;
}

export interface RuleSet {
  stage: string;
  deny: string[];
  ask: string[];
  allow: string[];
  checkpoints: string[];
  setAtPath: string;
  /** Higher levels whose rule set for this stage this one replaces. */
  overrides: string[];
}

export interface Autonomy {
  scope: string;
  autonomy: "auto" | "checkpoints";
  autonomySetAtPath: string | null;
  checkpoints: Record<string, CheckpointSetting>;
  ruleSets: RuleSet[];
  stages: string[];
}

export interface RuleSetRequest {
  scope: string;
  stage: string;
  deny: string[];
  ask: string[];
  allow: string[];
  checkpoints: string[];
}

// ---------------------------------------------------------------------------------------------
// The ontology — `GET /api/ontology?scope=&view=`
// ---------------------------------------------------------------------------------------------

export type OntologyEdgeType = "owns" | "works-on" | "reports-to" | "depends-on" | "data-flows-to";

export interface OntologyNode {
  id: string;
  /** organisation, division, project, app, employee, contractor, person, secret, service, webhook, schedule */
  type: string;
  name: string;
  scope: string | null;
  status: string | null;
  attributes: Record<string, unknown> | null;
}

export interface OntologyEdge {
  from: string;
  to: string;
  type: string;
  label: string | null;
}

export interface Ontology {
  scope: string;
  generatedAt: string;
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  views: Record<string, string[]>;
}

// ---------------------------------------------------------------------------------------------
// Tasks — `GET /api/tasks?scope=&status=&limit=`
// ---------------------------------------------------------------------------------------------

export interface TaskItem {
  id: string;
  scope: string;
  runId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "blocked" | "done" | "failed" | "cancelled";
  holderRunId: string | null;
  holderEmployeeId: string | null;
  claimedAt: string | null;
  estimateCredits: number | null;
  actualCredits: number | null;
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Ask about this app — `POST /api/apps/{id}/ask*`, `GET/POST/DELETE /api/apps/{id}/dashboard`
// ---------------------------------------------------------------------------------------------

export interface AskEstimate {
  credits: number;
  basis: string;
}

export type ChartKind = "line" | "bar" | "number" | "table";

export interface AskChart {
  kind: ChartKind;
  /** The column on the horizontal axis; null for a single number. */
  x: string | null;
  y: string[];
  series: { name: string; points: { x: unknown; y: number | null }[] }[];
}

export interface AskAnswer {
  question: string;
  answer: string;
  chart: AskChart;
  /** The query that answered it. Technical mode only. */
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  credits: { estimate: number; charged: number };
}

/** A question kept on the dashboard, re-run on every read at no model cost. */
export interface SavedQuestion {
  id: string;
  question: string;
  answer: string;
  sql: string;
  chart: AskChart | null;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  askedAt: string;
  ranAt: string;
  /** Why the saved query no longer runs, when it does not. */
  error: string | null;
}

// ---------------------------------------------------------------------------------------------
// Versions and export — `GET /api/apps/{id}/versions`, `…/restore`, `…/export`
// ---------------------------------------------------------------------------------------------

export interface AppVersion {
  /** The version's id; technical mode only. */
  commit: string;
  message: string;
  at: string;
  author: { kind: "employee" | "person" | "factory"; id: string | null; name: string };
  live: boolean;
}

export interface AppVersions {
  appId: string;
  live: string | null;
  versions: AppVersion[];
  hasMore: boolean;
}

export interface RestoreResult {
  version: AppVersion;
  published: boolean;
  /** A public app becomes private when an earlier version is brought back. */
  madePrivate: boolean;
  publishError: string | null;
}

// ---------------------------------------------------------------------------------------------
// People — `GET/POST/PATCH/DELETE /api/members`
// ---------------------------------------------------------------------------------------------

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  /** Where the grant was set. */
  scope: string;
  role: MemberRole;
  hasPasskey: boolean;
  grantedAt: string;
}

/** `POST /api/members` → the one-time code, shown once and never stored. */
export interface MemberInvitation {
  member: Member;
  invitationCode: string | null;
  expiresAt: string | null;
  /** The code was e-mailed too (only when a mail server is configured). */
  emailed: boolean;
}

// ---------------------------------------------------------------------------------------------
// AI assistant access — `GET/POST/DELETE /api/tokens`
// ---------------------------------------------------------------------------------------------

export type TokenRole = "admin" | "builder" | "viewer";

export interface AccessToken {
  id: string;
  name: string;
  organisation: string;
  role: TokenRole;
  /** The first characters of the token, to recognise it by. */
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

/** `POST /api/tokens` → the token itself, this once. */
export interface AccessTokenCreated {
  token: string;
  accessToken: AccessToken;
}

// ---------------------------------------------------------------------------------------------
// Notifications — `GET /api/notifications`, `POST …/{id}/read`, `POST …/read-all`
// ---------------------------------------------------------------------------------------------

export interface NotificationItem {
  id: string;
  /** verdict, approval, hire, budget.80, budget.cap, credits.zero, overdraft.half, overdraft.limit, app.crashed, security.finding */
  kind: string;
  severity: "info" | "urgent";
  title: string;
  detail: string;
  scope: string;
  /** What needs the person: an idea, a run, a hire, an app… */
  subject: { kind: string; id: string } | null;
  createdAt: string;
  read: boolean;
  emailedAt: string | null;
}

export interface NotificationFeed {
  organisation: string;
  unread: number;
  notifications: NotificationItem[];
}

// ---------------------------------------------------------------------------------------------
// Ideas from the portfolio — `/api/ideas/suggestions*`
// ---------------------------------------------------------------------------------------------

export interface Suggestion {
  id: string;
  scope: string;
  runId: string;
  title: string;
  idea: string;
  /** The gap in the portfolio it fills. */
  gap: string;
  /** Why this organisation is placed to build it. */
  whyUs: string;
  /** What it would reuse of what the organisation already holds. */
  reuses: string[];
  status: "open" | "taken" | "dismissed";
  ideaId: string | null;
  createdAt: string;
}

export interface SuggestionsStarted {
  run: Run;
  estimate: IdeaEstimate;
}

// ---------------------------------------------------------------------------------------------
// Top-ups and the overdraft — `/api/credits/top-up-requests`, `PUT /api/credits/overdraft`
// ---------------------------------------------------------------------------------------------

export interface TopUpRequest {
  id: string;
  organisation: string;
  organisationName: string;
  credits: number;
  note: string;
  status: "open" | "fulfilled" | "declined";
  requestedBy: string;
  requestedByEmail: string | null;
  requestedAt: string;
  closedAt: string | null;
  closeNote: string | null;
  topUpEntryId: string | null;
}

// ---------------------------------------------------------------------------------------------
// God mode — `/api/operator/*`, `POST /api/organisations`, `POST /api/credits/top-ups`
// ---------------------------------------------------------------------------------------------

export interface OperatorOrganisation {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: string;
  balance: number;
  standing: "in-credit" | "overdrawn" | "at-limit";
  overdraft: { frostauraLimit: number; ownLimit: number | null; effective: number };
  apps: number;
  lastActivityAt: string | null;
  openTopUpRequests: number;
}

/** `POST /api/operator/organisations/{slug}/enter`: `logged` says where the Owner reads it. */
export interface OperatorEntry {
  organisationId: string;
  organisation: string;
  role: string;
  enteredAt: string;
  logged: string;
}

export interface OperatorTopUp {
  id: string;
  organisation: string;
  credits: number;
  note: string;
  at: string;
  by: string | null;
  byEmail: string | null;
}

export interface Pricing {
  creditsPerUsd: number;
  /** A factor: 1.0 is no margin. */
  margin: number;
  hosting: { usdPerAwakeHour: number; usdPerGbHourMemory: number; usdPerGbMonthStorage: number; usdPerMillionRequests: number };
  defaultAppModelMonthlyCredits: number;
}

export interface PricingView {
  pricing: Pricing;
  source: "defaults" | "stored";
  updatedAt: string | null;
  updatedBy: string | null;
  history: { at: string; by: string; byEmail: string | null; before: unknown; after: unknown }[];
}

/** `POST /api/organisations` with an owner: the Owner's one-time code, returned once. */
export interface OrganisationProvisioned {
  id: string;
  slug: string;
  name: string;
  ownerEmail: string;
  ownerInvitationCode: string | null;
  invitationExpiresAt: string | null;
  invitationEmailed: boolean;
  nameCheck: { slug: string; source: string; note: string | null } | null;
}
