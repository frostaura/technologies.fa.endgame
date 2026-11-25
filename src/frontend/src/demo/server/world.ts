import type {
  AccessToken,
  AppAccess,
  AppHealth,
  AppRunning,
  AppTelemetry,
  AppVersion,
  Employee,
  Hire,
  Idea,
  MemberRole,
  MemoryChange,
  MemoryEntry,
  NotificationItem,
  OperatorAction,
  Pricing,
  PricingView,
  ProjectStage,
  RecurringRole,
  Run,
  RunEvent,
  RunningCost,
  SavedQuestion,
  ScopeLevel,
  Suggestion,
  TaskItem,
  TopUpRequest,
  TrackRecord,
} from "@/store/types";

/**
 * The demo's world: everything the fake control plane knows, as plain JSON so it can be saved to
 * sessionStorage and read back. Records hold what the real control plane's tables hold, close to
 * the shapes its endpoints answer with, so a handler mostly reads and filters (ARCH-009).
 */

export interface DemoUser {
  id: string;
  displayName: string;
  email: string;
  /** How many passkeys "this device" holds for them; 0 means they have never registered. */
  passkeys: number;
  isOperator: boolean;
  /** An open invitation: the one-time code (demo only — the real one is stored hashed). */
  invitation: { code: string; expiresAt: string } | null;
}

export interface DemoOrganisation {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: string;
  balance: number;
  /** The overdraft FrostAura allows (set in God mode). */
  frostauraLimit: number;
  /** The Owner's own, tighter limit, or null. */
  ownLimit: number | null;
  lastActivityAt: string | null;
}

export interface DemoNode {
  id: string;
  /** Path of slugs: org, org/division, org/division/project, org/division/project/app. */
  path: string;
  slug: string;
  name: string;
  level: ScopeLevel;
  createdAt: string;
  /** Projects only. */
  stage: ProjectStage | null;
  ideaId: string | null;
  note: string | null;
  /** `archived` for a division or project kept but not served; absent or `active` otherwise. */
  status?: string;
}

export interface DemoMembership {
  id: string;
  userId: string;
  path: string;
  role: MemberRole;
  grantedAt: string;
}

export interface DemoApp {
  id: string;
  path: string;
  name: string;
  health: AppHealth;
  healthSummary: string;
  running: AppRunning;
  /** The app's lifecycle word: draft, building, running, sleeping, failed, stopped. */
  status: string;
  /** Why it is paused, when it is: the overdraft limit or a spent budget. */
  pausedReason: "overdraft" | "budget" | null;
  access: AppAccess;
  runningSetting: "sleep" | "always-on";
  idleMinutes: number;
  telemetry: AppTelemetry | null;
  capCredits: number | null;
  version: string | null;
  publishedAt: string | null;
  endUsers: number;
  runningCost: RunningCost;
}

export interface DemoSecret {
  path: string;
  name: string;
  setAt: string;
}

export interface DemoShare {
  appId: string;
  email: string;
  invitedAt: string;
  registered: boolean;
  code: string;
}

export interface DemoSpend {
  path: string;
  /** Model calls, this month. */
  ai: number;
  /** Hosting, this month. */
  hosting: number;
}

export interface DemoSetting {
  path: string;
  key: string;
  value: string;
}

export interface DemoRuleSet {
  path: string;
  stage: string;
  deny: string[];
  ask: string[];
  allow: string[];
  checkpoints: string[];
}

export interface DemoApproval {
  id: string;
  runId: string;
  title: string;
  detail: string;
  answer: "approved" | "rejected" | null;
  /** What approving it does, by name; read by the run engine. */
  onApprove:
    | { kind: "start-idea"; text: string; scope: string }
    | { kind: "setting"; key: string; value: string; scope: string }
    | { kind: "change-app"; scope: string; request: string }
    | { kind: "try-again"; runId: string; scope: string }
    | { kind: "continue" };
  /** What declining does: the step is skipped and the work goes on (the default), or the work stops. */
  onDecline?: "continues" | "stops";
  /** Which step of its run raised it, so the step after it can read the answer. */
  key?: string;
}

/** A run's playback: which script it follows and how far it has got. */
export interface DemoPlayback {
  script: string;
  params: Record<string, string | number | boolean | null>;
  /** Script milliseconds consumed. */
  elapsed: number;
  /** Index of the next step. */
  cursor: number;
}

export interface DemoRun {
  run: Run;
  events: RunEvent[];
  playback: DemoPlayback | null;
  /** The playback a finished run followed, kept so it can be tried again with the same script and story. */
  ended?: DemoPlayback | null;
}

export interface DemoConversation {
  id: string;
  scope: string;
  employeeId: string | null;
  runIds: string[];
}

export interface DemoTopUp {
  id: string;
  organisation: string;
  credits: number;
  note: string;
  at: string;
  by: string | null;
  byEmail: string | null;
  idempotencyKey: string;
}

export interface DemoNotification extends NotificationItem {
  organisation: string;
}

export interface DemoOperatorAction extends OperatorAction {
  organisation: string;
}

export interface DemoQuestion extends SavedQuestion {
  appId: string;
}

export interface World {
  /** Bumped when the world's shape changes, so an old saved world is not read back. */
  version: number;
  scenario: string;
  persona: string;
  /** The signed-in user, or null when signed out. */
  sessionUserId: string | null;
  /** Organisations an operator entered in God mode this visit. */
  entered: string[];
  /** Whose passkeys this browser ("your device") holds. */
  device: string[];
  users: DemoUser[];
  organisations: DemoOrganisation[];
  nodes: DemoNode[];
  memberships: DemoMembership[];
  apps: DemoApp[];
  ideas: Idea[];
  runs: DemoRun[];
  approvals: DemoApproval[];
  conversations: DemoConversation[];
  employees: Employee[];
  trackRecords: TrackRecord[];
  memory: MemoryEntry[];
  memoryChanges: MemoryChange[];
  hires: Hire[];
  recurringRoles: RecurringRole[];
  tasks: TaskItem[];
  spend: DemoSpend[];
  /** Monthly budgets (caps) by path. */
  budgets: { path: string; cap: number }[];
  /** Narrower overdraft limits below the organisation. */
  overdraftLimits: { path: string; credits: number; setAt: string; setBy: string | null }[];
  notCharged: Record<string, { credits: number; repairs: number }>;
  secrets: DemoSecret[];
  shares: DemoShare[];
  dashboard: DemoQuestion[];
  versions: Record<string, AppVersion[]>;
  notifications: DemoNotification[];
  suggestions: Suggestion[];
  /** Each key with the person who made it (`AccessTokens.cs` keeps it per person); `userId` is never sent. */
  tokens: (AccessToken & { userId?: string })[];
  settings: DemoSetting[];
  ruleSets: DemoRuleSet[];
  topUpRequests: TopUpRequest[];
  topUps: DemoTopUp[];
  operatorLog: DemoOperatorAction[];
  pricing: PricingView;
  /** Counters for invented ids. */
  counter: number;
  /** What each level says about itself ("What this is"): the cascade's context values. */
  context?: { path: string; key: string; value: unknown; setAt: string }[];
  /** No model answers (the screening of a new organisation then needs an operator's own decision). */
  modelsOffline?: boolean;
  /** A development deployment (ID-03): the development sign-in is offered, for this account. Never in any other scenario. */
  developmentSignIn?: { email: string };
  /** How many of the next session checks (`GET me`) fail as an unreachable control plane would (ID-05). */
  sessionCheckFailures?: number;
  /** Organisations an operator acted in as an Admin during the request being answered; never saved. */
  actedAsOperator?: string[];
  /** RTK Query tags changed since the page last refreshed; drained by the host, never saved. */
  changed: string[];
}

export const WORLD_VERSION = 1;

export const DEFAULT_PRICING: Pricing = {
  creditsPerUsd: 100,
  margin: 1.25,
  hosting: { usdPerAwakeHour: 0.002, usdPerGbHourMemory: 0.004, usdPerGbMonthStorage: 0.1, usdPerMillionRequests: 0.2 },
  defaultAppModelMonthlyCredits: 200,
};

/** A short, stable, invented id in the shape of a UUID, from a name. */
export function uuidFor(name: string): string {
  const parts: string[] = [];
  let h = 0x811c9dc5;
  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < name.length; i += 1) {
      h ^= name.charCodeAt(i) + round;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    parts.push(h.toString(16).padStart(8, "0"));
  }
  const hex = parts.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A fresh invented id for something made while the page is open. */
export function newId(world: World, kind: string): string {
  world.counter += 1;
  return uuidFor(`${kind}:${world.counter}:${world.scenario}`);
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** A moment the given minutes before the page opened. */
export function ago(minutes: number, base = Date.now()): string {
  return iso(base - minutes * 60_000);
}

export function orgOf(path: string): string {
  return path.split("/")[0] ?? path;
}

export function parentOf(path: string): string | null {
  const i = path.lastIndexOf("/");
  return i < 0 ? null : path.slice(0, i);
}

/** The path and every ancestor, from the organisation down. */
export function chain(path: string): string[] {
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function within(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function levelOf(path: string): ScopeLevel {
  return (["organisation", "division", "project", "app"] as const)[Math.min(3, path.split("/").length - 1)] ?? "organisation";
}

export function node(world: World, path: string): DemoNode | undefined {
  return world.nodes.find((n) => n.path === path);
}

export function appAt(world: World, path: string): DemoApp | undefined {
  return world.apps.find((a) => a.path === path);
}

export function organisation(world: World, slug: string): DemoOrganisation | undefined {
  return world.organisations.find((o) => o.slug === slug);
}

export function user(world: World, id: string | null): DemoUser | undefined {
  return id ? world.users.find((u) => u.id === id) : undefined;
}

export function runRecord(world: World, id: string): DemoRun | undefined {
  return world.runs.find((r) => r.run.id === id);
}

/** Credits spent this month at a path and beneath it. */
export function spentBelow(world: World, path: string): { ai: number; hosting: number } {
  let ai = 0;
  let hosting = 0;
  for (const s of world.spend) {
    if (within(s.path, path)) {
      ai += s.ai;
      hosting += s.hosting;
    }
  }
  return { ai, hosting };
}

/** Add spending at a path and take it off the organisation's balance. */
export function charge(world: World, path: string, credits: number, kind: "ai" | "hosting" = "ai") {
  let line = world.spend.find((s) => s.path === path);
  if (!line) {
    line = { path, ai: 0, hosting: 0 };
    world.spend.push(line);
  }
  line[kind] += credits;
  const org = organisation(world, orgOf(path));
  if (org) {
    org.balance -= credits;
    org.lastActivityAt = new Date().toISOString();
  }
}

/** The value of a cascade setting at a path: the deepest one set on its chain. */
export function setting(world: World, path: string, key: string): DemoSetting | null {
  let found: DemoSetting | null = null;
  for (const p of chain(path)) {
    const s = world.settings.find((x) => x.path === p && x.key === key);
    if (s) found = s;
  }
  return found;
}
