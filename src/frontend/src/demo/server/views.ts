import type { AppDetail, BudgetLine, Credits, Idea, Me, Membership, NeedsYou, OperatorOrganisation, Pricing, RunningCost, Tree, TreeApp, TreeDivision, TreeProject, Worker } from "@/store/types";
import { highestIn, homeOrganisation, roleAt } from "./access";
import { ideaState } from "./tryAgain";
import { DEFAULT_PRICING, appAt, chain, levelOf, node, orgOf, organisation, spentBelow, within, type DemoApp, type DemoUser, type World } from "./world";

/**
 * The control plane's views, built from the world: what `ConsoleViews.cs` and the endpoint files
 * project for the console. Handlers call these so every screen reads the same numbers.
 */

export function meView(world: World, u: DemoUser): Me {
  const memberships: Membership[] = world.memberships
    .filter((m) => m.userId === u.id)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((m) => {
      const org = organisation(world, orgOf(m.path));
      return { id: m.id, scope: m.path, level: levelOf(m.path), role: m.role, organisationId: org?.id ?? "", organisationSlug: org?.slug ?? "", organisationName: org?.name ?? "" };
    });
  const home = homeOrganisation(world, u.id);
  const org = home ? organisation(world, home) : undefined;
  return {
    user: { id: u.id, displayName: u.displayName, email: u.email },
    organisation: org ? { id: org.id, slug: org.slug, name: org.name } : null,
    isOperator: u.isOperator,
    passkeys: u.passkeys,
    memberships,
  };
}

function workersAt(world: World, path: string): Worker[] {
  const out: Worker[] = [];
  for (const e of world.employees) {
    if (e.scope !== path || e.status === "released") continue;
    if (e.kind === "contractor" && e.status !== "working") continue;
    out.push({
      id: e.id,
      name: e.name,
      role: e.role,
      kind: e.kind,
      activity: e.currentRun ? activityOf(world, e.currentRun.id, e.kind) : null,
      status: e.status === "working" ? "working" : e.status === "paused" ? "paused" : "idle",
      idle: e.idle.flagged,
      standing: e.standing,
      briefedBy: e.briefedBy?.id ?? null,
    });
  }
  return out;
}

function activityOf(world: World, runId: string, kind: "employee" | "contractor"): string {
  const r = world.runs.find((x) => x.run.id === runId);
  if (!r) return "working";
  if (kind === "contractor") return r.run.kind === "research" ? "researching" : "on a brief";
  return r.run.kind === "research" ? "researching an idea" : r.run.kind === "build" ? "building" : r.run.kind === "conversation" ? "answering you" : "working";
}

/** The viewer's effective role at a node, as the server resolves it; null where they hold none. */
function roleOf(world: World, userId: string, path: string) {
  return roleAt(world, userId, path)?.role ?? null;
}

function treeApp(world: World, a: DemoApp, userId: string): TreeApp {
  const n = node(world, a.path);
  return {
    id: a.id,
    slug: n?.slug ?? a.path.split("/").pop() ?? "",
    name: a.name,
    health: a.health,
    running: a.running,
    access: a.access,
    sharedWith: world.shares.filter((s) => s.appId === a.id).length,
    visitsToday: a.telemetry ? a.telemetry.visitsToday : null,
    lastVisitAt: a.telemetry?.lastVisitAt ?? null,
    spend: { monthCredits: total(world, a.path) },
    workers: workersAt(world, a.path),
    role: roleOf(world, userId, a.path),
    archived: a.status === "archived",
  };
}

function total(world: World, path: string): number {
  const s = spentBelow(world, path);
  return s.ai + s.hosting;
}

/** Progress of a project's live run: the step it is on of the factory's stages. */
function progressOf(world: World, projectPath: string): TreeProject["progress"] {
  const r = world.runs.find((x) => x.run.kind === "build" && x.run.scope === projectPath && (x.run.status === "running" || x.run.status === "waiting" || x.run.status === "paused" || x.run.status === "queued"));
  if (!r) return null;
  const steps = ["placement", "plan", "build", "evaluate", "review", "publish"];
  const marks = r.events.map((e) => String(e.payload.step ?? e.payload.milestone ?? ""));
  let step = 1;
  if (marks.some((m) => m === "plan")) step = 2;
  if (marks.some((m) => m.startsWith("item:"))) step = 3;
  if (r.events.some((e) => e.type.startsWith("evaluation."))) step = 4;
  if (marks.some((m) => m.startsWith("security"))) step = 5;
  if (marks.some((m) => m === "publish")) step = 6;
  const labels = ["Placing it", "Planning", "Building", "Checking the work", "Security review", "Publishing"];
  return { runId: r.run.id, label: labels[step - 1] ?? "Working", step, of: steps.length, spentCredits: round(r.run.spentCredits), estimatedCredits: r.run.estimateCredits };
}

function round(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function treeView(world: World, userId: string, org: string): Tree {
  const o = organisation(world, org);
  const held = roleAt(world, userId, org);
  const now = new Date().toISOString();
  if (!o) return { generatedAt: now, viewerRole: "none", organisation: null, divisions: [], needsYou: [], firstRun: world.organisations.length === 0 };
  const visible = (path: string) => {
    if (held) return true;
    return world.memberships.some((m) => m.userId === userId && (within(path, m.path) || within(m.path, path)));
  };
  const divisions: TreeDivision[] = world.nodes
    .filter((n) => n.level === "division" && orgOf(n.path) === org && visible(n.path))
    .map((d) => ({
      id: d.id,
      slug: d.slug,
      name: d.name,
      spend: { monthCredits: total(world, d.path) },
      workers: workersAt(world, d.path),
      role: roleOf(world, userId, d.path),
      archived: d.status === "archived",
      projects: world.nodes
        .filter((p) => p.level === "project" && p.path.startsWith(`${d.path}/`) && visible(p.path))
        .map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          // ReadModels.ProjectStage: an archived project is "paused", with the note "Archived.".
          stage: p.status === "archived" ? "paused" : (p.stage ?? "live"),
          ideaId: p.ideaId,
          note: p.status === "archived" ? "Archived." : p.note,
          progress: progressOf(world, p.path),
          spend: { monthCredits: total(world, p.path) },
          workers: workersAt(world, p.path),
          apps: world.apps.filter((a) => a.path.startsWith(`${p.path}/`)).map((a) => treeApp(world, a, userId)),
          role: roleOf(world, userId, p.path),
          archived: p.status === "archived",
        })),
    }));
  const projects = divisions.reduce((n, d) => n + d.projects.length, 0);
  // ReadModels.TreeAsync: the summary counts the apps shown, and someone granted part of the tree
  // sees no organisation-level workers, spend summed from the divisions they see, and only the
  // needs on what their grants cover.
  const apps = divisions.reduce((n, d) => n + d.projects.reduce((m, p) => m + p.apps.length, 0), 0);
  const covered = (path: string) => !!held || world.memberships.some((m) => m.userId === userId && within(path, m.path));
  const people = world.employees.filter((e) => orgOf(e.scope) === org && e.kind === "employee" && e.status !== "released").length;
  const summary = `${divisions.length} ${divisions.length === 1 ? "division" : "divisions"} · ${projects} ${projects === 1 ? "project" : "projects"} · ${apps} ${apps === 1 ? "app" : "apps"} · ${people} ${people === 1 ? "employee" : "employees"}`;
  const viewerRole = held?.role ?? highestIn(world, userId, org) ?? "none";
  return {
    generatedAt: now,
    viewerRole,
    organisation: { id: o.id, slug: o.slug, name: o.name, summary, spend: { monthCredits: held ? total(world, org) : divisions.reduce((n, d) => n + d.spend.monthCredits, 0) }, workers: held ? workersAt(world, org) : [], role: roleOf(world, userId, org) },
    divisions,
    needsYou: needsYou(world, org).filter((n) => covered(needScope(world, n))),
    firstRun: false,
  };
}

/** Where a need sits in the tree: the idea's, the run's, the hire's or the employee's level. */
function needScope(world: World, n: NeedsYou): string {
  if (n.kind === "verdict") return world.ideas.find((i) => i.id === n.ideaId)?.scope ?? "";
  if (n.kind === "approval") return world.runs.find((r) => r.run.id === n.runId)?.run.scope ?? "";
  if (n.kind === "hire") return n.scope;
  return world.employees.find((e) => e.id === n.employeeId)?.scope ?? "";
}

function needsYou(world: World, org: string): NeedsYou[] {
  const out: NeedsYou[] = [];
  for (const i of world.ideas) {
    if (i.status !== "verdict" || !i.verdict || orgOf(world.runs.find((r) => r.run.id === i.runId)?.run.scope ?? org) !== org) continue;
    out.push({ kind: "verdict", id: i.id, ideaId: i.id, title: i.title, verdict: i.verdict.outcome, detail: i.verdict.summary });
  }
  for (const a of world.approvals) {
    const r = world.runs.find((x) => x.run.id === a.runId);
    if (a.answer || !r || orgOf(r.run.scope) !== org) continue;
    out.push({ kind: "approval", id: a.id, runId: a.runId, approvalId: a.id, title: a.title, detail: a.detail });
  }
  for (const h of world.hires) {
    if (h.status !== "proposed" || orgOf(h.scope) !== org) continue;
    out.push({ kind: "hire", id: h.id, hireId: h.id, title: `Hire ${h.name} as ${h.role.toLowerCase()}?`, detail: h.reason, scope: h.scope, expectedMonthlyCredits: h.expectedMonthlyCredits });
  }
  for (const e of world.employees) {
    if (!e.idle.flagged || e.status === "released" || orgOf(e.scope) !== org) continue;
    out.push({ kind: "idle", id: `idle-${e.id}`, employeeId: e.id, title: `${e.name} has had no work for ${e.idle.afterDays} days`, detail: "Keep them on, give them work, or release them; released employees keep their memory archived." });
  }
  return out;
}

export function ideaView(world: World, idea: Idea): Idea {
  const org = orgOf(world.runs.find((r) => r.run.id === idea.runId)?.run.scope ?? idea.scope ?? "");
  const decided = world.ideas.filter((i) => i.verdict && orgOf(world.runs.find((r) => r.run.id === i.runId)?.run.scope ?? i.scope ?? "") === org);
  return {
    ...idea,
    ...ideaState(world, idea),
    history: idea.history ?? [],
    // What research has cost so far, read from its run while no verdict is recorded.
    research: idea.verdict ? idea.research : { ...idea.research, spentCredits: Math.round((world.runs.find((r) => r.run.id === idea.runId)?.run.spentCredits ?? idea.research.spentCredits) * 100) / 100 },
    record: {
      total: decided.length,
      build: decided.filter((i) => i.verdict?.outcome === "build").length,
      change: decided.filter((i) => i.verdict?.outcome === "change").length,
      doNotBuild: decided.filter((i) => i.verdict?.outcome === "do-not-build").length,
      overruled: decided.filter((i) => i.decision?.overruled).map((i) => ({ ideaId: i.id, title: i.title, verdict: i.verdict?.outcome ?? "do-not-build", outcome: appBuiltFrom(world, i.id) ? "built and running" : "building" })),
    },
  };
}

function appBuiltFrom(world: World, ideaId: string): boolean {
  const p = world.nodes.find((n) => n.ideaId === ideaId);
  return !!p && world.apps.some((a) => a.path.startsWith(`${p.path}/`) && a.status !== "building");
}

export function appView(world: World, a: DemoApp): AppDetail {
  const org = orgOf(a.path);
  const [, ...rest] = a.path.split("/");
  return {
    id: a.id,
    name: a.name,
    scope: a.path,
    health: { state: a.health, summary: a.healthSummary },
    running: a.running,
    addresses: { path: `https://endgame.example/${a.path}/`, subdomain: `https://${org}.endgame.example/${rest.join("/")}/` },
    telemetry: a.telemetry,
    cost: { monthCredits: total(world, a.path), capCredits: world.budgets.find((b) => b.path === a.path)?.cap ?? null },
    settings: { running: a.runningSetting, access: a.access },
    runningCost: pricedRunningCost(world, a.runningCost),
    sharedWith: world.shares.filter((s) => s.appId === a.id).length,
    endUsers: a.endUsers,
    status: a.status,
    version: a.version,
    publishedAt: a.publishedAt,
    idleMinutes: a.idleMinutes,
  };
}

/** A month of hosting for one way of running, in credits at the given prices (`PricingService`). */
function hostingCredits(p: Pricing, awakeHours: number, m: NonNullable<RunningCost["measured"]>): number {
  const h = p.hosting;
  const usd = awakeHours * h.usdPerAwakeHour + (m.memoryMb / 1024) * awakeHours * h.usdPerGbHourMemory + (m.storageMb / 1024) * h.usdPerGbMonthStorage + (m.requestsPerMonth / 1e6) * h.usdPerMillionRequests;
  return usd * p.creditsPerUsd * p.margin;
}

/**
 * An app's running cost at today's prices: a price change (OP-09) moves every app's monthly figures
 * and the rates it quotes at once, by what changed for that app's own use. At the default prices
 * the figures are the world's own.
 */
export function pricedRunningCost(world: World, rc: RunningCost): RunningCost {
  const p = world.pricing.pricing;
  const n = (v: number) => String(Number(v.toFixed(4)));
  const prices = `Today's prices: ${n(p.hosting.usdPerAwakeHour * p.creditsPerUsd)} credits an awake hour, ${n(p.hosting.usdPerGbHourMemory * p.creditsPerUsd)} per GB of memory an awake hour, ${n(p.hosting.usdPerGbMonthStorage * p.creditsPerUsd)} per GB stored a month and ${n(p.hosting.usdPerMillionRequests * p.creditsPerUsd)} per million requests.`;
  const measured = rc.measured;
  if (!measured) return { ...rc, prices };
  const scale = <T extends { credits: number; awakeHoursPerMonth: number }>(choice: T | null): T | null => {
    if (!choice) return null;
    const before = hostingCredits(DEFAULT_PRICING, choice.awakeHoursPerMonth, measured);
    return before > 0 ? { ...choice, credits: round(choice.credits * (hostingCredits(p, choice.awakeHoursPerMonth, measured) / before)) } : choice;
  };
  return { ...rc, prices, sleep: scale(rc.sleep), alwaysOn: scale(rc.alwaysOn) };
}

export function creditsView(world: World, scope: string): Credits {
  const org = orgOf(scope);
  const o = organisation(world, org);
  const spent = spentBelow(world, scope);
  const lines: BudgetLine[] = [];
  const depthOf = (p: string) => p.split("/").length - 1;
  // `ReadModels.BudgetLinesAsync`: every node in tree order (by name at each level), each followed by its employees with a cap.
  const nodes = world.nodes.filter((x) => within(x.path, scope));
  const parentOf = (p: string) => p.split("/").slice(0, -1).join("/");
  const walk = (n: (typeof nodes)[number]) => {
    const s = spentBelow(world, n.path);
    const cap = world.budgets.find((b) => b.path === n.path)?.cap ?? null;
    lines.push({ scope: n.path, name: n.name, level: n.level, depth: depthOf(n.path), spentCredits: round(s.ai + s.hosting), capCredits: cap, appId: appAt(world, n.path)?.id ?? null });
    for (const e of world.employees.filter((x) => x.kind === "employee" && x.scope === n.path && x.status !== "released" && x.jobDescription.monthlyCreditLimit !== null).sort((a, b) => a.name.localeCompare(b.name))) {
      const tr = world.trackRecords.find((t) => t.employeeId === e.id);
      lines.push({ scope: e.scope, name: e.name, level: "employee", depth: depthOf(e.scope) + 1, spentCredits: tr?.cost.monthCredits ?? 0, capCredits: e.jobDescription.monthlyCreditLimit, appId: null, employeeId: e.id });
    }
    for (const c of nodes.filter((x) => parentOf(x.path) === n.path).sort((a, b) => a.name.localeCompare(b.name))) walk(c);
  };
  const top = nodes.find((x) => x.path === scope);
  if (top) walk(top);
  const balance = o?.balance ?? 0;
  const limit = o ? (o.ownLimit !== null ? Math.min(o.ownLimit, o.frostauraLimit) : o.frostauraLimit) : 0;
  const held = world.runs.filter((r) => orgOf(r.run.scope) === org && (r.run.status === "running" || r.run.status === "waiting")).reduce((n, r) => n + Math.max(0, (r.run.estimateCredits ?? 0) - r.run.spentCredits) * 0.1, 0);
  const monthSpent = spent.ai + spent.hosting;
  const pace = monthSpent > 0 ? balance / (monthSpent * (30 / Math.max(1, new Date().getUTCDate()))) : null;
  const nc = world.notCharged[org] ?? { credits: 0, repairs: 0 };
  return {
    scope,
    balance: round(balance),
    month: { spent: round(monthSpent), ai: round(spent.ai), hosting: round(spent.hosting) },
    monthsLeftAtPace: pace !== null && balance > 0 ? Math.round(pace * 10) / 10 : balance <= 0 ? 0 : null,
    budgets: lines,
    estimates: { pieces: 23, withinPercent: 39, under: 17, over: 6, largestMissPercent: 64, typicalGapPercent: -38, typically: "under" },
    notCharged: nc,
    overdraft: o
      ? {
          frostauraLimit: o.frostauraLimit,
          ownLimit: o.ownLimit,
          limits: world.overdraftLimits
            .filter((l) => within(l.path, org))
            .map((l) => ({ scope: l.path, name: node(world, l.path)?.name ?? l.path, level: levelOf(l.path) as "division" | "project" | "app", credits: l.credits, setAt: l.setAt, setBy: l.setBy, setByName: world.users.find((u) => u.id === l.setBy)?.displayName ?? null })),
        }
      : null,
    topUps: world.topUps.filter((t) => t.organisation === org).map((t) => ({ at: t.at, credits: t.credits, note: t.note })),
    heldCredits: round(held),
    available: round(balance + limit),
  };
}

export function operatorOrganisationView(world: World, slug: string): OperatorOrganisation {
  const o = organisation(world, slug);
  if (!o) throw new Error(`no organisation ${slug}`);
  const effective = o.ownLimit !== null ? Math.min(o.ownLimit, o.frostauraLimit) : o.frostauraLimit;
  const standing = o.balance >= 0 ? "in-credit" : -o.balance >= effective ? "at-limit" : "overdrawn";
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    status: o.status,
    createdAt: o.createdAt,
    balance: round(o.balance),
    standing,
    overdraft: { frostauraLimit: o.frostauraLimit, ownLimit: o.ownLimit, effective },
    apps: world.apps.filter((a) => orgOf(a.path) === slug).length,
    lastActivityAt: o.lastActivityAt,
    openTopUpRequests: world.topUpRequests.filter((r) => r.organisation === slug && r.status === "open").length,
  };
}

/** The nodes on a path's chain, for breadcrumbs and messages. */
export function namesOn(world: World, path: string): string[] {
  return chain(path).map((p) => node(world, p)?.name ?? p);
}
