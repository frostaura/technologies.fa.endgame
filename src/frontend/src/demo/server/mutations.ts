import type { Employee, Hire, NotificationItem, ProjectStage, Run, TrackRecord } from "@/store/types";
import { node, orgOf, uuidFor, type DemoApp, type DemoRun, type World } from "./world";

/**
 * World changes more than one handler or script makes: hiring, notifying, placing, starting a run.
 * Each says which RTK Query tags it touched through `world.changed`.
 */

export function notify(world: World, n: Omit<NotificationItem, "id" | "createdAt" | "read" | "emailedAt" | "resolved"> & { key: string; approvalId?: string }) {
  const { key, ...rest } = n;
  const id = uuidFor(`notification:${key}`);
  if (world.notifications.some((x) => x.id === id)) return;
  world.notifications.unshift({ ...rest, id, createdAt: new Date().toISOString(), read: false, emailedAt: null, organisation: orgOf(n.scope) });
  world.changed.push("Notifications");
}

export function blankTrackRecord(employeeId: string): TrackRecord {
  return {
    employeeId,
    work: { accepted: 0, sentBack: 0, acceptedPercent: null, judged: 0 },
    runs: { finished: 0, succeeded: 0, failed: 0, cancelled: 0 },
    repairsNotCharged: { credits: 0, calls: 0 },
    cost: { toDateCredits: 0, monthCredits: 0 },
    contractors: { engaged: 0, working: 0, toDateCredits: 0, monthCredits: 0 },
    estimates: null,
  };
}

const TOOLS: Record<string, string[]> = {
  "Software engineer": ["read_file", "list_files", "search", "edit_file", "write_file", "run", "git_diff", "git_commit", "load_skill", "remember"],
  "QA engineer": ["read_file", "list_files", "search", "run", "git_diff", "check_preview", "remember"],
  "Division lead": ["read_organisation", "propose_hire", "brief_contractor", "remember"],
  "Market researcher": ["web_search", "read_page", "brief_contractor", "notes", "remember"],
};

export function hireEmployee(
  world: World,
  h: { key: string; name: string; role: string; scope: string; limit: number; mandate: string; reason: string; trigger: Hire["trigger"]; runId: string | null; reportsTo?: string | null; via?: string },
): Employee {
  const id = uuidFor(`employee:${h.key}`);
  const existing = world.employees.find((e) => e.id === id);
  if (existing) return existing;
  const at = new Date().toISOString();
  const manager = h.reportsTo ? world.employees.find((e) => e.id === h.reportsTo) : undefined;
  const employee: Employee = {
    id,
    kind: "employee",
    name: h.name,
    role: h.role,
    status: "idle",
    standing: null,
    scope: h.scope,
    reportsTo: manager ? { id: manager.id, name: manager.name } : null,
    briefedBy: null,
    jobDescription: { mandate: h.mandate, scope: h.scope, tools: TOOLS[h.role] ?? ["read_file", "remember"], services: ["identity", "models", "telemetry"], monthlyCreditLimit: h.limit, modelTier: h.role === "QA engineer" ? "evaluate" : h.role === "Software engineer" ? "build" : "research" },
    idle: { flagged: false, since: null, afterDays: 14 },
    currentRun: null,
    lastRunId: null,
    lastActiveAt: null,
    createdAt: at,
    releasedAt: null,
    memoryEntries: 0,
    brief: null,
  };
  world.employees.push(employee);
  world.trackRecords.push(blankTrackRecord(id));
  world.hires.push({
    id: uuidFor(`hire:${h.key}`),
    status: "accepted",
    trigger: h.trigger,
    needKey: `${h.trigger}:${h.scope}`,
    scope: h.scope,
    reason: h.reason,
    name: h.name,
    role: h.role,
    jobDescription: employee.jobDescription,
    reportsTo: employee.reportsTo,
    expectedMonthlyCredits: h.limit,
    withinBudget: true,
    headroomCredits: 4000,
    contractorRole: null,
    raisedBy: "runner",
    raisedByRunId: h.runId,
    decision: { via: h.via ?? "auto-mode", by: h.via ?? "auto-mode", at, note: "Within budget, so auto-mode hired." },
    employeeId: id,
    createdAt: at,
  });
  world.changed.push("Tree", "Employee", "Hire", "Ontology");
  return employee;
}

export function contractor(world: World, key: string, scope: string, briefedBy: Employee | undefined, role: string, brief: string, runId: string): Employee {
  const id = uuidFor(`contractor:${key}`);
  let c = world.employees.find((e) => e.id === id);
  if (!c) {
    c = {
      id,
      kind: "contractor",
      name: "Contractor",
      role,
      status: "working",
      standing: null,
      scope,
      reportsTo: null,
      briefedBy: briefedBy ? { id: briefedBy.id, name: briefedBy.name } : null,
      jobDescription: { mandate: brief, scope, tools: ["web_search", "read_page"], services: ["models"], monthlyCreditLimit: null, modelTier: "research" },
      idle: { flagged: false, since: null, afterDays: 14 },
      currentRun: { id: runId, title: brief.slice(0, 60) },
      lastRunId: null,
      lastActiveAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      releasedAt: null,
      memoryEntries: 0,
      brief,
    };
    world.employees.push(c);
  }
  world.changed.push("Tree", "Employee");
  return c;
}

export function setStage(world: World, path: string, stage: ProjectStage, note: string | null = null) {
  const n = node(world, path);
  if (!n) return;
  n.stage = stage;
  n.note = note;
  world.changed.push("Tree");
}

export function ensureNode(world: World, path: string, name: string, extra: Partial<{ stage: ProjectStage; ideaId: string | null; note: string | null }> = {}) {
  let n = node(world, path);
  if (!n) {
    const slug = path.split("/").pop() ?? path;
    const level = (["organisation", "division", "project", "app"] as const)[path.split("/").length - 1] ?? "app";
    n = { id: uuidFor(`node:${path}`), path, slug, name, level, createdAt: new Date().toISOString(), stage: level === "project" ? (extra.stage ?? "planning") : null, ideaId: extra.ideaId ?? null, note: extra.note ?? null };
    world.nodes.push(n);
    world.changed.push("Tree", "Ontology");
  }
  return n;
}

export function newApp(world: World, path: string, name: string): DemoApp {
  const existing = world.apps.find((a) => a.path === path);
  if (existing) return existing;
  const app: DemoApp = {
    id: uuidFor(`app:${path}`),
    path,
    name,
    health: "unknown",
    healthSummary: "Not running yet; it is being built.",
    running: "starting",
    status: "building",
    pausedReason: null,
    access: "private",
    runningSetting: "sleep",
    idleMinutes: 15,
    telemetry: null,
    capCredits: null,
    version: null,
    publishedAt: null,
    endUsers: 0,
    runningCost: notEnoughHistory(0),
  };
  world.apps.push(app);
  world.changed.push("Tree", "App");
  return app;
}

export function notEnoughHistory(hours: number) {
  return {
    state: "not-enough-history" as const,
    windowDays: 14,
    minimumHours: 24,
    measuredHours: hours,
    basis: hours === 0 ? "Nothing measured yet. An estimate needs at least 24 hours of this app's own use in the last 14 days." : `Only ${hours} hours measured so far. An estimate needs at least 24 hours of this app's own use in the last 14 days.`,
    prices: "Today's prices: 0.2 credits an awake hour, 0.4 per GB of memory an awake hour, 10 per GB stored a month and 20 per million requests.",
    sleep: null,
    alwaysOn: null,
    measured: null,
  };
}

/** A new run record, queued, with its first events written by the handler. */
export function startRun(world: World, r: Omit<Run, "status" | "startedAt" | "finishedAt" | "lastSeq" | "spentCredits" | "budgetExhausted" | "outcome" | "summary" | "createdAt" | "canTryAgain">, script: string | null, params: Record<string, string | number | boolean | null> = {}): DemoRun {
  const at = new Date().toISOString();
  const record: DemoRun = {
    run: { ...r, status: "queued", startedAt: at, finishedAt: null, lastSeq: 0, spentCredits: 0, budgetExhausted: false, outcome: null, summary: null, createdAt: at, canTryAgain: false },
    events: [],
    playback: script ? { script, params, elapsed: 0, cursor: 0 } : null,
  };
  world.runs.push(record);
  world.changed.push("Tree", "Run", "Credits");
  return record;
}
