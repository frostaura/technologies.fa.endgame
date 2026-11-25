import { arr, bool, dict, nullable, num, obj, oneOf, record, str, unknownValue, withDefault, type Guard } from "@/lib/guards";
import { normaliseVerdict } from "@/features/verdict/verdictModel";
import type {
  AccessToken,
  AccessTokenCreated,
  AppVersion,
  AppVersions,
  AskAnswer,
  AskChart,
  AskEstimate,
  Member,
  MemberInvitation,
  NotificationFeed,
  OperatorEntry,
  OperatorOrganisation,
  OperatorTopUp,
  OrganisationProvisioned,
  PricingView,
  RestoreResult,
  SavedQuestion,
  AskTechnical,
  Suggestion,
  SuggestionsStarted,
  TopUpRequest,
  AppDetail,
  AppShare,
  Autonomy,
  ConversationHistory,
  Credits,
  Employee,
  EmployeeDetail,
  Estimates,
  Hire,
  Idea,
  IdeaEstimate,
  JobDescription,
  Me,
  MemoryChange,
  MemoryEntry,
  NeedsYou,
  Ontology,
  OperatorAction,
  RecurringRole,
  Run,
  RunEvent,
  SecretList,
  SystemStatus,
  TaskItem,
  TrackRecord,
  Tree,
  TreeApp,
  TreeDivision,
  TreeProject,
  Worker,
} from "./types";

/**
 * One guard per endpoint the console reads, checking exactly the fields its screen relies on.
 * `api.ts` runs each answer through its guard before it reaches the store; a mismatch becomes a
 * failed read that names the field. Fields newer than the oldest stack still running carry a default.
 */

const s = str;
const ns = nullable(str);
const nn = nullable(num);

const role = oneOf(["viewer", "builder", "admin", "owner"] as const);
const level = oneOf(["organisation", "division", "project", "app"] as const);

export const meGuard: Guard<Me> = obj<Me>({
  user: obj<Me["user"]>({ id: s, displayName: s, email: ns }),
  organisation: nullable(obj<NonNullable<Me["organisation"]>>({ id: s, slug: s, name: s })),
  isOperator: withDefault(bool, false),
  passkeys: withDefault(num, 0),
  memberships: withDefault(
    arr(obj<Me["memberships"][number]>({ id: s, scope: s, level, role, organisationId: s, organisationSlug: s, organisationName: s })),
    [],
  ),
});

const spend = obj<{ monthCredits: number }>({ monthCredits: num });

const workerStatus = oneOf(["idle", "working", "paused"] as const);
const worker: Guard<Worker> = (v, path) => {
  const w = obj<Worker>({
    id: s,
    name: s,
    role: s,
    kind: oneOf(["employee", "contractor"] as const),
    activity: ns,
    // Older control planes sent the first five only; a worker with an activity is working.
    status: withDefault(workerStatus, "idle"),
    idle: withDefault(bool, false),
    standing: withDefault(ns, null),
    briefedBy: withDefault(ns, null),
  })(v, path);
  if ((v as { status?: unknown }).status === undefined && w.activity) w.status = "working";
  return w;
};
const workers = withDefault(arr(worker), []);

const health = oneOf(["healthy", "degraded", "down", "unknown"] as const);
const running = oneOf(["asleep", "awake", "always-on", "starting", "paused"] as const);
const access = oneOf(["private", "shared", "public"] as const);
const stage = oneOf(["idea", "researching", "verdict", "planning", "building", "evaluating", "reviewing", "publishing", "live", "paused", "dropped"] as const);
const outcome = oneOf(["build", "change", "do-not-build"] as const);

const treeApp = obj<TreeApp>({ id: s, slug: s, name: s, health, running, access, sharedWith: withDefault(num, 0), visitsToday: nn, lastVisitAt: ns, spend, workers });
const treeProject = obj<TreeProject>({
  id: s,
  slug: s,
  name: s,
  stage,
  ideaId: ns,
  note: ns,
  progress: nullable(obj<NonNullable<TreeProject["progress"]>>({ runId: s, label: s, step: num, of: num, spentCredits: num, estimatedCredits: nn })),
  spend,
  workers,
  apps: arr(treeApp),
});
const treeDivision = obj<TreeDivision>({ id: s, slug: s, name: s, spend, workers, projects: arr(treeProject) });

const needsYou: Guard<NeedsYou | null> = (v, path) => {
  const kind = (record(v, path) as { kind?: unknown }).kind;
  switch (kind) {
    case "verdict":
      return obj<Extract<NeedsYou, { kind: "verdict" }>>({ kind: oneOf(["verdict"] as const), id: s, ideaId: s, title: s, verdict: outcome, detail: ns })(v, path);
    case "approval":
      return obj<Extract<NeedsYou, { kind: "approval" }>>({ kind: oneOf(["approval"] as const), id: s, runId: s, approvalId: s, title: s, detail: ns })(v, path);
    case "hire":
      return obj<Extract<NeedsYou, { kind: "hire" }>>({ kind: oneOf(["hire"] as const), id: s, hireId: s, title: s, detail: ns, scope: s, expectedMonthlyCredits: num })(v, path);
    case "idle":
      return obj<Extract<NeedsYou, { kind: "idle" }>>({ kind: oneOf(["idle"] as const), id: s, employeeId: s, title: s, detail: ns })(v, path);
    default:
      // A kind this console does not know yet is left out rather than drawn wrongly.
      return null;
  }
};

export const treeGuard: Guard<Tree> = (v, path) => {
  const t = obj<Omit<Tree, "needsYou"> & { needsYou: (NeedsYou | null)[] }>({
    generatedAt: s,
    viewerRole: withDefault(oneOf(["viewer", "builder", "admin", "owner", "none"] as const), "owner"),
    organisation: nullable(obj<NonNullable<Tree["organisation"]>>({ id: s, slug: s, name: s, summary: ns, spend, workers })),
    divisions: arr(treeDivision),
    needsYou: withDefault(arr(needsYou), []),
  })(v, path);
  return { ...t, needsYou: t.needsYou.filter((n): n is NeedsYou => n !== null) };
};

const estimates = obj<Estimates>({ pieces: num, withinPercent: num, under: num, over: num, largestMissPercent: num });

export const creditsGuard: Guard<Credits> = obj<Credits>({
  scope: s,
  balance: num,
  month: obj<Credits["month"]>({ spent: num, ai: num, hosting: num }),
  monthsLeftAtPace: nn,
  budgets: arr(
    obj<Credits["budgets"][number]>({
      scope: s,
      name: s,
      level: oneOf(["organisation", "division", "project", "app", "employee"] as const),
      depth: num,
      spentCredits: num,
      capCredits: nn,
      appId: ns,
    }),
  ),
  estimates: nullable(estimates),
  notCharged: obj<Credits["notCharged"]>({ credits: num, repairs: num }),
  overdraft: nullable(obj<NonNullable<Credits["overdraft"]>>({ frostauraLimit: num, ownLimit: nn })),
  topUps: arr(obj<Credits["topUps"][number]>({ at: s, credits: num, note: s })),
  heldCredits: withDefault(num, 0),
  available: withDefault(num, 0),
});

export const estimateGuard: Guard<IdeaEstimate> = obj<IdeaEstimate>({ credits: num, basis: s });

const decisionChoice = oneOf(["build", "change", "overrule", "drop"] as const);

export const ideaGuard: Guard<Idea> = obj<Idea>({
  id: s,
  title: s,
  text: s,
  constraints: withDefault(arr(s), []),
  status: oneOf(["researching", "verdict", "decided", "failed"] as const),
  runId: s,
  scope: ns,
  research: obj<Idea["research"]>({ estimatedCredits: num, spentCredits: num, by: ns }),
  verdict: nullable(normaliseVerdict),
  decision: nullable(
    obj<NonNullable<Idea["decision"]>>({ choice: decisionChoice, at: s, by: s, overruled: bool, runId: ns, via: withDefault(oneOf(["person", "auto-mode"] as const), "person") }),
  ),
  record: obj<Idea["record"]>({
    total: num,
    build: num,
    change: num,
    doNotBuild: num,
    overruled: arr(obj<Idea["record"]["overruled"][number]>({ ideaId: s, title: s, verdict: outcome, outcome: s })),
  }),
  redLine: withDefault(ns, null),
});

const runKind = oneOf(["research", "conversation", "build", "factory", "task", "review", "suggest"] as const);
const runStatus = oneOf(["queued", "running", "waiting", "paused", "finished", "failed", "cancelled"] as const);

export const runGuard: Guard<Run> = obj<Run>({
  id: s,
  kind: runKind,
  title: s,
  scope: s,
  status: runStatus,
  startedAt: s,
  finishedAt: ns,
  lastSeq: withDefault(num, 0),
  ideaId: ns,
  estimateCredits: nn,
  spentCredits: withDefault(num, 0),
  employeeId: withDefault(ns, null),
  conversationId: withDefault(ns, null),
  budgetExhausted: withDefault(bool, false),
  outcome: withDefault(ns, null),
  summary: withDefault(ns, null),
  createdAt: withDefault(s, ""),
});

export const runEventGuard: Guard<RunEvent> = obj<RunEvent>({ seq: num, type: s, at: s, payload: withDefault(record, {}) });

export const conversationGuard: Guard<ConversationHistory> = obj<ConversationHistory>({
  scope: s,
  conversationId: ns,
  employeeId: ns,
  messages: arr(obj<ConversationHistory["messages"][number]>({ runId: s, seq: num, at: s, from: s, text: s })),
});

export const appGuard: Guard<AppDetail> = obj<AppDetail>({
  id: s,
  name: s,
  scope: s,
  health: obj<AppDetail["health"]>({ state: health, summary: s }),
  running,
  addresses: obj<AppDetail["addresses"]>({ path: s, subdomain: ns }),
  telemetry: nullable(
    obj<NonNullable<AppDetail["telemetry"]>>({ visitsToday: num, requestsToday: num, errorsToday: num, latencyP50Ms: nn, latencyP95Ms: nn, lastVisitAt: ns }),
  ),
  cost: obj<AppDetail["cost"]>({ monthCredits: num, capCredits: nn }),
  settings: obj<AppDetail["settings"]>({ running: oneOf(["sleep", "always-on"] as const), access }),
  runningCost: nullable(obj<NonNullable<AppDetail["runningCost"]>>({ sleep: num, alwaysOn: num })),
  sharedWith: withDefault(num, 0),
  status: withDefault(s, ""),
  version: withDefault(ns, null),
  publishedAt: withDefault(ns, null),
  idleMinutes: withDefault(num, 15),
});

export const sharesGuard: Guard<AppShare[]> = arr(obj<AppShare>({ email: s, invitedAt: s, registered: bool }));

export const secretsGuard: Guard<SecretList> = obj<SecretList>({
  scope: s,
  effective: arr(obj<SecretList["effective"][number]>({ name: s, setAtLevel: level, setAtPath: s, setAt: s, inherited: bool, overrides: withDefault(arr(s), []) })),
  setBelow: withDefault(arr(obj<SecretList["setBelow"][number]>({ name: s, setAtPath: s })), []),
});

export const operatorAccessGuard: Guard<OperatorAction[]> = arr(
  obj<OperatorAction>({ id: s, at: s, action: s, operator: obj<OperatorAction["operator"]>({ id: s, email: ns, displayName: s }), detail: nullable(record) }),
);

export const systemGuard: Guard<SystemStatus> = obj<SystemStatus>({
  overall: oneOf(["healthy", "unhealthy"] as const),
  checkedAt: s,
  services: arr(obj<SystemStatus["services"][number]>({ key: s, name: s, state: oneOf(["healthy", "unhealthy"] as const), latencyMs: num, detail: ns })),
});

// The workforce -------------------------------------------------------------------------------

const personRef = obj<{ id: string; name: string }>({ id: s, name: s });

const jobDescription = obj<JobDescription>({
  mandate: withDefault(s, ""),
  scope: s,
  tools: withDefault(arr(s), []),
  services: withDefault(arr(s), []),
  monthlyCreditLimit: nn,
  modelTier: ns,
});

export const employeeGuard: Guard<Employee> = obj<Employee>({
  id: s,
  kind: oneOf(["employee", "contractor"] as const),
  name: s,
  role: s,
  status: oneOf(["idle", "working", "paused", "released"] as const),
  standing: ns,
  scope: s,
  reportsTo: nullable(personRef),
  briefedBy: nullable(personRef),
  jobDescription,
  idle: withDefault(obj<Employee["idle"]>({ flagged: bool, since: ns, afterDays: num }), { flagged: false, since: null, afterDays: 14 }),
  currentRun: nullable(obj<NonNullable<Employee["currentRun"]>>({ id: s, title: s })),
  lastRunId: ns,
  lastActiveAt: ns,
  createdAt: s,
  releasedAt: ns,
  memoryEntries: withDefault(num, 0),
  brief: withDefault(ns, null),
});

export const employeesGuard: Guard<Employee[]> = arr(employeeGuard);

export const trackRecordGuard: Guard<TrackRecord> = obj<TrackRecord>({
  employeeId: s,
  work: obj<TrackRecord["work"]>({ accepted: num, sentBack: num, acceptedPercent: nn }),
  runs: obj<TrackRecord["runs"]>({ finished: num, succeeded: num, failed: num, cancelled: num }),
  repairsNotCharged: obj<TrackRecord["repairsNotCharged"]>({ credits: num, calls: num }),
  cost: obj<TrackRecord["cost"]>({ toDateCredits: num, monthCredits: num }),
  contractors: obj<TrackRecord["contractors"]>({ engaged: num, working: num, toDateCredits: num, monthCredits: num }),
  estimates: nullable(estimates),
});

export const employeeDetailGuard: Guard<EmployeeDetail> = obj<EmployeeDetail>({
  employee: employeeGuard,
  trackRecord: trackRecordGuard,
  contractors: withDefault(arr(employeeGuard), []),
  reports: withDefault(arr(employeeGuard), []),
});

const memoryKind = oneOf(["fact", "practice", "preference", "lesson"] as const);

export const memoryEntryGuard: Guard<MemoryEntry> = obj<MemoryEntry>({
  id: s,
  employeeId: s,
  scope: s,
  title: s,
  body: s,
  kind: memoryKind,
  sourceRunId: ns,
  createdAt: s,
  updatedAt: s,
  lastReviewedAt: ns,
  archived: withDefault(bool, false),
});

export const memoryGuard: Guard<MemoryEntry[]> = arr(memoryEntryGuard);

export const memoryChangesGuard: Guard<MemoryChange[]> = arr(
  obj<MemoryChange>({
    id: s,
    memoryId: ns,
    action: oneOf(["added", "corrected", "merged", "removed", "archived", "restored", "reviewed"] as const),
    by: s,
    userId: ns,
    runId: ns,
    detail: unknownValue,
    at: s,
  }),
);

export const hireGuard: Guard<Hire> = obj<Hire>({
  id: s,
  status: oneOf(["proposed", "accepted", "declined"] as const),
  trigger: oneOf(["division", "stage", "recurring", "promotion", "owner"] as const),
  needKey: ns,
  scope: s,
  reason: withDefault(s, ""),
  name: s,
  role: s,
  jobDescription,
  reportsTo: nullable(personRef),
  expectedMonthlyCredits: num,
  withinBudget: bool,
  headroomCredits: num,
  contractorRole: ns,
  raisedBy: oneOf(["person", "runner"] as const),
  raisedByRunId: ns,
  decision: nullable(obj<NonNullable<Hire["decision"]>>({ via: s, by: s, at: s, note: ns })),
  employeeId: ns,
  createdAt: s,
});

export const hiresGuard: Guard<Hire[]> = arr(hireGuard);

export const recurringRolesGuard: Guard<RecurringRole[]> = arr(
  obj<RecurringRole>({ scope: s, role: s, contractors: num, windowDays: num, costCredits: num, lastBriefedBy: s, lastBrief: withDefault(s, "") }),
);

// Autonomy ------------------------------------------------------------------------------------

export const autonomyGuard: Guard<Autonomy> = obj<Autonomy>({
  scope: s,
  autonomy: oneOf(["auto", "checkpoints"] as const),
  autonomySetAtPath: ns,
  checkpoints: dict(obj<Autonomy["checkpoints"][string]>({ on: bool, setAtPath: ns })),
  ruleSets: arr(
    obj<Autonomy["ruleSets"][number]>({
      stage: s,
      deny: withDefault(arr(s), []),
      ask: withDefault(arr(s), []),
      allow: withDefault(arr(s), []),
      checkpoints: withDefault(arr(s), []),
      setAtPath: s,
      overrides: withDefault(arr(s), []),
    }),
  ),
  stages: arr(s),
});

// The ontology --------------------------------------------------------------------------------

export const ontologyGuard: Guard<Ontology> = obj<Ontology>({
  scope: s,
  generatedAt: s,
  nodes: arr(obj<Ontology["nodes"][number]>({ id: s, type: s, name: s, scope: ns, status: ns, attributes: nullable(record) })),
  edges: arr(obj<Ontology["edges"][number]>({ from: s, to: s, type: s, label: ns })),
  views: withDefault(dict(arr(s)), {}),
});

// Tasks ---------------------------------------------------------------------------------------

export const tasksGuard: Guard<TaskItem[]> = arr(
  obj<TaskItem>({
    id: s,
    scope: s,
    runId: ns,
    parentTaskId: ns,
    title: s,
    description: withDefault(s, ""),
    status: oneOf(["todo", "in_progress", "blocked", "done", "failed", "cancelled"] as const),
    holderRunId: ns,
    holderEmployeeId: ns,
    claimedAt: ns,
    estimateCredits: nn,
    actualCredits: nn,
    dependsOn: withDefault(arr(s), []),
    createdAt: s,
    updatedAt: s,
  }),
);

// Ask about this app ----------------------------------------------------------------------------

export const askEstimateGuard: Guard<AskEstimate> = obj<AskEstimate>({ credits: num, basis: s });

const chartKind = oneOf(["line", "bar", "number", "table"] as const);
const chartPoint = obj<AskChart["series"][number]["points"][number]>({ x: unknownValue, y: nn });
export const askChartGuard: Guard<AskChart> = obj<AskChart>({
  kind: chartKind,
  x: withDefault(ns, null),
  y: withDefault(arr(s), []),
  series: withDefault(arr(obj<AskChart["series"][number]>({ name: s, points: arr(chartPoint) })), []),
});
const rows = withDefault(arr(record), []);

export const askAnswerGuard: Guard<AskAnswer> = obj<AskAnswer>({
  question: s,
  answer: s,
  chart: askChartGuard,
  sql: withDefault(s, ""),
  columns: withDefault(arr(s), []),
  rows,
  truncated: withDefault(bool, false),
  credits: obj<AskAnswer["credits"]>({ estimate: num, charged: num }),
});

export const askTechnicalGuard: Guard<AskTechnical> = obj<AskTechnical>({ sql: withDefault(ns, null), error: s });

export const savedQuestionGuard: Guard<SavedQuestion> = obj<SavedQuestion>({
  id: s,
  question: s,
  answer: withDefault(s, ""),
  sql: withDefault(s, ""),
  chart: nullable(askChartGuard),
  columns: withDefault(arr(s), []),
  rows,
  truncated: withDefault(bool, false),
  askedAt: s,
  ranAt: s,
  error: withDefault(ns, null),
  technical: withDefault(nullable(askTechnicalGuard), null),
});
export const dashboardGuard: Guard<SavedQuestion[]> = arr(savedQuestionGuard);

// Versions --------------------------------------------------------------------------------------

const appVersion = obj<AppVersion>({
  commit: s,
  message: s,
  at: s,
  author: obj<AppVersion["author"]>({ kind: oneOf(["employee", "person", "factory"] as const), id: ns, name: s }),
  live: bool,
});
export const versionsGuard: Guard<AppVersions> = obj<AppVersions>({ appId: s, live: ns, versions: arr(appVersion), hasMore: withDefault(bool, false) });
export const restoreGuard: Guard<RestoreResult> = obj<RestoreResult>({ version: appVersion, published: bool, madePrivate: bool, publishError: ns });

// People ----------------------------------------------------------------------------------------

export const memberGuard: Guard<Member> = obj<Member>({ membershipId: s, userId: s, email: s, displayName: s, scope: s, role, hasPasskey: withDefault(bool, false), grantedAt: s });
export const membersGuard: Guard<Member[]> = arr(memberGuard);
export const invitationGuard: Guard<MemberInvitation> = obj<MemberInvitation>({ member: memberGuard, invitationCode: ns, expiresAt: ns, emailed: withDefault(bool, false) });

// AI assistant access ---------------------------------------------------------------------------

export const accessTokenGuard: Guard<AccessToken> = obj<AccessToken>({
  id: s,
  name: s,
  organisation: s,
  role: oneOf(["admin", "builder", "viewer"] as const),
  prefix: s,
  createdAt: s,
  expiresAt: ns,
  lastUsedAt: ns,
  revokedAt: ns,
  active: bool,
});
export const accessTokensGuard: Guard<AccessToken[]> = arr(accessTokenGuard);
export const accessTokenCreatedGuard: Guard<AccessTokenCreated> = obj<AccessTokenCreated>({ token: s, accessToken: accessTokenGuard });

// Notifications ---------------------------------------------------------------------------------

export const notificationsGuard: Guard<NotificationFeed> = obj<NotificationFeed>({
  organisation: withDefault(s, ""),
  unread: num,
  notifications: arr(
    obj<NotificationFeed["notifications"][number]>({
      id: s,
      kind: s,
      severity: withDefault(oneOf(["info", "urgent"] as const), "info"),
      title: s,
      detail: withDefault(s, ""),
      scope: withDefault(s, ""),
      subject: nullable(obj<{ kind: string; id: string }>({ kind: s, id: s })),
      createdAt: s,
      read: bool,
      emailedAt: withDefault(ns, null),
    }),
  ),
});

// Ideas from the portfolio ----------------------------------------------------------------------

export const suggestionGuard: Guard<Suggestion> = obj<Suggestion>({
  id: s,
  scope: s,
  runId: s,
  title: s,
  idea: s,
  gap: s,
  whyUs: s,
  reuses: withDefault(arr(s), []),
  status: oneOf(["open", "taken", "dismissed"] as const),
  ideaId: ns,
  createdAt: s,
});
export const suggestionsGuard: Guard<Suggestion[]> = arr(suggestionGuard);
export const suggestionsStartedGuard: Guard<SuggestionsStarted> = obj<SuggestionsStarted>({ run: runGuard, estimate: estimateGuard });

// Top-ups ---------------------------------------------------------------------------------------

export const topUpRequestGuard: Guard<TopUpRequest> = obj<TopUpRequest>({
  id: s,
  organisation: s,
  organisationName: withDefault(s, ""),
  credits: num,
  note: withDefault(s, ""),
  status: oneOf(["open", "fulfilled", "declined"] as const),
  requestedBy: s,
  requestedByEmail: ns,
  requestedAt: s,
  closedAt: ns,
  closeNote: ns,
  topUpEntryId: ns,
});
export const topUpRequestsGuard: Guard<TopUpRequest[]> = arr(topUpRequestGuard);

// God mode --------------------------------------------------------------------------------------

export const operatorOrganisationGuard: Guard<OperatorOrganisation> = obj<OperatorOrganisation>({
  id: s,
  slug: s,
  name: s,
  status: s,
  createdAt: s,
  balance: num,
  standing: oneOf(["in-credit", "overdrawn", "at-limit"] as const),
  overdraft: obj<OperatorOrganisation["overdraft"]>({ frostauraLimit: num, ownLimit: nn, effective: num }),
  apps: num,
  lastActivityAt: ns,
  openTopUpRequests: withDefault(num, 0),
});
export const operatorOrganisationsGuard: Guard<OperatorOrganisation[]> = arr(operatorOrganisationGuard);
export const operatorEntryGuard: Guard<OperatorEntry> = obj<OperatorEntry>({ organisationId: s, organisation: s, role: s, enteredAt: s, logged: withDefault(s, "") });
export const operatorTopUpsGuard: Guard<OperatorTopUp[]> = arr(obj<OperatorTopUp>({ id: s, organisation: s, credits: num, note: withDefault(s, ""), at: s, by: ns, byEmail: ns }));
export const pricingGuard: Guard<PricingView> = obj<PricingView>({
  pricing: obj<PricingView["pricing"]>({
    creditsPerUsd: num,
    margin: num,
    hosting: obj<PricingView["pricing"]["hosting"]>({ usdPerAwakeHour: num, usdPerGbHourMemory: num, usdPerGbMonthStorage: num, usdPerMillionRequests: num }),
    defaultAppModelMonthlyCredits: num,
  }),
  source: withDefault(oneOf(["defaults", "stored"] as const), "defaults"),
  updatedAt: ns,
  updatedBy: ns,
  history: withDefault(arr(obj<PricingView["history"][number]>({ at: s, by: s, byEmail: ns, before: unknownValue, after: unknownValue })), []),
});
export const provisionedGuard: Guard<OrganisationProvisioned> = obj<OrganisationProvisioned>({
  id: s,
  slug: s,
  name: s,
  ownerEmail: s,
  ownerInvitationCode: ns,
  invitationExpiresAt: ns,
  invitationEmailed: withDefault(bool, false),
  nameCheck: withDefault(nullable(obj<NonNullable<OrganisationProvisioned["nameCheck"]>>({ slug: s, source: s, note: ns })), null),
});
