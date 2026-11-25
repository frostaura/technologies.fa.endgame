import { IDS, ORG, PEOPLE, defaultWorld } from "./default";
import { DEFAULT_PRICING, WORLD_VERSION, uuidFor, type World } from "../server/world";

/**
 * Scenarios and personas: named presets of the world and of who is signed in. A scenario is one
 * function that edits the default world, so adding one is a few lines; scenarios compose with
 * `+` (`?scenario=build-running+low-credits`), applied left to right. Each may name the route it
 * opens on, a moment its live runs jump to, and the things it features (what `{idea}`, `{run}`,
 * `{app}`, `{employee}` and `{hire}` in an academy route stand for).
 */

export interface Featured {
  idea?: string;
  run?: string;
  app?: string;
  employee?: string;
  hire?: string;
}

export interface Scenario {
  name: string;
  /** One line for the demo strip's menu. */
  title: string;
  apply?: (world: World) => void;
  route?: string;
  /** A named moment (`build:plan`) or script milliseconds to move every live run forward by. */
  seek?: string | number;
  featured?: Featured;
  /** The persona this scenario is meant for, used when none is given. */
  persona?: string;
}

export const SCENARIOS = new Map<string, Scenario>();
const ALIASES = new Map<string, string>();

export function defineScenario(s: Scenario, ...aliases: string[]) {
  SCENARIOS.set(s.name, s);
  for (const a of aliases) ALIASES.set(a, s.name);
}

export function scenarioNamed(name: string): Scenario | undefined {
  return SCENARIOS.get(ALIASES.get(name) ?? name);
}

const BASE_FEATURED: Featured = { idea: IDS.ideaAllergen, run: IDS.runBuildReadingList, app: IDS.tableBookings, employee: uuidFor(`employee:${ORG}/technologies/court-booking:engineer`), hire: uuidFor("hire:analyst") };

/** Live runs stop playing (a quiet world, or one where work has stopped). */
function stopLiveRuns(w: World, summary: string) {
  for (const r of w.runs) {
    if (!r.playback) continue;
    r.playback = null;
    r.run.status = "failed";
    r.run.outcome = "failed";
    r.run.summary = summary;
    r.run.budgetExhausted = true;
    r.run.finishedAt = new Date().toISOString();
    r.events.push({ seq: r.events.length + 1, type: "message", at: r.run.finishedAt, payload: { text: "The credit budget is exhausted, so this run cannot call a model again. Top up or raise the budget, then start new work.", code: "budget_exhausted" } });
    r.events.push({ seq: r.events.length + 1, type: "run.finished", at: r.run.finishedAt, payload: { outcome: "failed", summary, totals: { credits: 0, modelCalls: 0, nonBillableCredits: 0 } } });
    r.run.lastSeq = r.events.length;
  }
}

function emptyWorld(w: World) {
  const fresh: World = { ...w, sessionUserId: null, entered: [], device: [], users: [], organisations: [], nodes: [], memberships: [], apps: [], ideas: [], runs: [], approvals: [], conversations: [], employees: [], trackRecords: [], memory: [], memoryChanges: [], hires: [], recurringRoles: [], tasks: [], spend: [], budgets: [], overdraftLimits: [], notCharged: {}, secrets: [], shares: [], dashboard: [], versions: {}, notifications: [], suggestions: [], tokens: [], settings: [], ruleSets: [], topUpRequests: [], topUps: [], operatorLog: [], pricing: { pricing: DEFAULT_PRICING, source: "defaults", updatedAt: null, updatedBy: null, history: [] }, counter: 0, changed: [], version: WORLD_VERSION };
  Object.assign(w, fresh);
}

defineScenario({ name: "default", title: "Northwind, busy: research and a build playing live", featured: BASE_FEATURED }, "established");

defineScenario({ name: "quiet", title: "Northwind with nothing running", apply: (w) => (w.runs = w.runs.filter((r) => !r.playback)), featured: BASE_FEATURED });

defineScenario({ name: "fresh-install", title: "A fresh install: nobody has registered yet", apply: emptyWorld, route: "/sign-in", persona: "signed-out" });

defineScenario(
  {
    name: "empty-organisation",
    title: "An organisation with nothing in it yet",
    apply: (w) => {
      const keepUsers = new Set([PEOPLE.owner.id, PEOPLE.operator.id]);
      const org = w.organisations.find((o) => o.slug === ORG);
      emptyWorld(w);
      const base = defaultWorld();
      w.users = base.users.filter((u) => keepUsers.has(u.id));
      w.organisations = org ? [{ ...org, balance: 500, ownLimit: null }] : [];
      w.nodes = base.nodes.filter((n) => n.path === ORG);
      w.memberships = base.memberships.filter((m) => m.userId === PEOPLE.owner.id);
      w.employees = base.employees.filter((e) => e.scope === ORG && e.standing);
      w.trackRecords = base.trackRecords.filter((t) => w.employees.some((e) => e.id === t.employeeId));
      w.topUps = base.topUps.filter((t) => t.organisation === ORG).slice(0, 1).map((t) => ({ ...t, credits: 500 }));
      w.device = [PEOPLE.owner.id, PEOPLE.operator.id];
      w.sessionUserId = PEOPLE.owner.id;
    },
  },
  "first-idea",
);

defineScenario({ name: "research-running", title: "Research playing live", route: "/runs/{run}", featured: { ...BASE_FEATURED, run: IDS.runResearchTides, idea: IDS.ideaTides } }, "researching");
defineScenario({ name: "research-verdict", title: "Research just reached its verdict", route: "/ideas/{idea}", seek: "research:verdict", featured: { ...BASE_FEATURED, run: IDS.runResearchTides, idea: IDS.ideaTides } });
defineScenario({ name: "verdict-build", title: "A verdict: build", route: "/ideas/{idea}", featured: { ...BASE_FEATURED, idea: IDS.ideaAllergen } });
defineScenario({ name: "verdict-change", title: "A verdict: change it", route: "/ideas/{idea}", featured: { ...BASE_FEATURED, idea: IDS.ideaCookery } });
defineScenario({ name: "verdict-do-not-build", title: "A verdict: do not build", route: "/ideas/{idea}", featured: { ...BASE_FEATURED, idea: IDS.ideaVans } });
defineScenario({ name: "verdict-red-line", title: "A verdict: a red line is crossed", route: "/ideas/{idea}", featured: { ...BASE_FEATURED, idea: IDS.ideaLocator } });
defineScenario({ name: "build-running", title: "A build playing live", route: "/runs/{run}", featured: BASE_FEATURED }, "building");
defineScenario({ name: "build-plan", title: "A build, at its plan", route: "/runs/{run}", seek: "build:plan", featured: BASE_FEATURED });
defineScenario({ name: "build-sent-back", title: "A build, a part sent back", route: "/runs/{run}", seek: "build:sent-back", featured: BASE_FEATURED });
defineScenario({ name: "build-security-finding", title: "A build, the security review's finding", route: "/runs/{run}", seek: "build:security-finding", featured: BASE_FEATURED });
defineScenario({ name: "build-published", title: "A build, just published privately", route: "/runs/{run}", seek: "build:published", featured: { ...BASE_FEATURED, app: IDS.readingList } });
defineScenario({
  name: "build-waiting-on-plan",
  title: "A build waiting for you to agree its plan",
  route: "/runs/{run}",
  seek: "build:waiting-on-plan",
  apply: (w) => w.settings.push({ path: ORG, key: "checkpoint.plan", value: "true" }, { path: `${ORG}/learning`, key: "autonomy", value: "checkpoints" }),
  featured: BASE_FEATURED,
});
defineScenario({
  name: "build-failed",
  title: "A build that did not succeed",
  route: "/runs/{run}",
  seek: "build:failed",
  apply: (w) => {
    const r = w.runs.find((x) => x.run.id === IDS.runBuildReadingList);
    if (r?.playback) r.playback.params = { ...r.playback.params, fail: true };
  },
  featured: BASE_FEATURED,
});
defineScenario({ name: "app-busy", title: "A healthy, busy app", route: "/apps/{app}", featured: BASE_FEATURED }, "app-live");
defineScenario({ name: "app-asleep", title: "An app asleep", route: "/apps/{app}", featured: { ...BASE_FEATURED, app: IDS.courseNotes } });
defineScenario({ name: "app-paused", title: "An app paused: its budget is spent", route: "/apps/{app}", featured: { ...BASE_FEATURED, app: IDS.stockCounter } });
defineScenario({ name: "app-crashed", title: "An app that crashed", route: "/apps/{app}", featured: { ...BASE_FEATURED, app: IDS.shiftRota } });
defineScenario({ name: "app-never-measured", title: "An app with nothing measured yet", route: "/apps/{app}", featured: { ...BASE_FEATURED, app: IDS.tutorMatch } });
defineScenario({ name: "employee-memory", title: "An employee with a history", route: "/employees/{employee}", featured: BASE_FEATURED });
defineScenario({ name: "hire-pending", title: "A hire waiting for an answer", route: "/hires/{hire}", featured: BASE_FEATURED });

defineScenario({
  name: "low-credits",
  title: "Credits nearly gone",
  apply: (w) => {
    const o = w.organisations.find((x) => x.slug === ORG);
    if (o) o.balance = 38.4;
    w.notifications = w.notifications.filter((n) => n.kind !== "credits.zero");
  },
  route: "/credits",
  featured: BASE_FEATURED,
});

defineScenario({
  name: "at-overdraft-limit",
  title: "At the overdraft limit: work stopped, apps paused",
  apply: (w) => {
    const o = w.organisations.find((x) => x.slug === ORG);
    if (!o) return;
    o.balance = -(o.ownLimit ?? o.frostauraLimit);
    for (const a of w.apps) if (a.path.startsWith(`${ORG}/`) && a.status !== "failed") Object.assign(a, { running: "paused", status: "stopped", pausedReason: "overdraft", health: "unknown", healthSummary: "Paused: the organisation reached its overdraft limit." });
    stopLiveRuns(w, "Stopped at the overdraft limit.");
    w.notifications.unshift({ id: uuidFor("notification:overdraft.limit:northwind"), kind: "overdraft.limit", severity: "urgent", title: "The overdraft limit is reached: work has stopped and apps are paused", detail: `The balance is ${o.balance} credits. Nothing is deleted; a top-up restores everything at once.`, scope: ORG, subject: null, createdAt: new Date().toISOString(), read: false, emailedAt: new Date().toISOString(), organisation: ORG });
  },
  route: "/credits",
  featured: BASE_FEATURED,
});

defineScenario({
  name: "budget-spent",
  title: "Technologies has spent its monthly budget",
  apply: (w) => {
    const b = w.budgets.find((x) => x.path === `${ORG}/technologies`);
    const spent = w.spend.filter((s) => s.path.startsWith(`${ORG}/technologies`)).reduce((n, s) => n + s.ai + s.hosting, 0);
    if (b) b.cap = Math.floor(spent);
    const app = w.apps.find((a) => a.id === IDS.tableBookings);
    if (app) Object.assign(app, { running: "paused", status: "stopped", pausedReason: "budget", health: "unknown", healthSummary: "Paused: Technologies has spent its monthly budget." });
    w.notifications.unshift({ id: uuidFor("notification:budget.cap:tech"), kind: "budget.cap", severity: "urgent", title: "Technologies reached its monthly budget", detail: `${Math.floor(spent)} of ${Math.floor(spent)} credits spent this month at ${ORG}/technologies. Work there stops until the budget is raised or the month turns.`, scope: `${ORG}/technologies`, subject: null, createdAt: new Date().toISOString(), read: false, emailedAt: null, organisation: ORG });
  },
  route: "/credits",
  featured: BASE_FEATURED,
});

defineScenario({ name: "god-mode", title: "God mode: every organisation", route: "/operator", persona: "operator", featured: BASE_FEATURED });

// ---------------------------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------------------------

export interface Persona {
  name: string;
  title: string;
  /** Who is signed in, or null. */
  userId: string | null;
  /** Edits the world for this persona (after the scenario). */
  apply?: (world: World) => void;
  /** Who this persona is when they open a hosted app. */
  visitor?: "member" | "member-without-access" | "invited" | "end-user" | "signed-out";
}

export const PERSONAS = new Map<string, Persona>();
const PERSONA_ALIASES = new Map<string, string>();

export function definePersona(p: Persona, ...aliases: string[]) {
  PERSONAS.set(p.name, p);
  for (const a of aliases) PERSONA_ALIASES.set(a, p.name);
}

export function personaNamed(name: string): Persona | undefined {
  return PERSONAS.get(PERSONA_ALIASES.get(name) ?? name);
}

definePersona({ name: "owner", title: `${PEOPLE.owner.displayName} · Owner`, userId: PEOPLE.owner.id }, "assistant", "host-admin");
definePersona({ name: "admin", title: `${PEOPLE.admin.displayName} · Admin`, userId: PEOPLE.admin.id });
definePersona({ name: "builder", title: `${PEOPLE.builder.displayName} · Builder`, userId: PEOPLE.builder.id });
definePersona({ name: "viewer", title: `${PEOPLE.viewer.displayName} · Viewer`, userId: PEOPLE.viewer.id, visitor: "member" });
definePersona({ name: "division-admin", title: `${PEOPLE.divisionAdmin.displayName} · Admin of Technologies`, userId: PEOPLE.divisionAdmin.id, visitor: "member-without-access" });
definePersona({ name: "operator", title: `${PEOPLE.operator.displayName} · FrostAura operator`, userId: PEOPLE.operator.id, visitor: "member-without-access" });
definePersona({ name: "invited", title: `${PEOPLE.invited.displayName} · invited, not yet registered`, userId: null, visitor: "invited" });
definePersona({ name: "end-user", title: "An end user of a shared app", userId: null, visitor: "end-user" });
definePersona({ name: "signed-out", title: "Signed out", userId: null, visitor: "signed-out" });
definePersona({
  name: "first-run",
  title: "Signed in on a fresh install, no organisation yet",
  userId: uuidFor("user:kit"),
  apply: (w) => {
    emptyWorld(w);
    w.users.push({ id: uuidFor("user:kit"), displayName: "Kit Marlow", email: "kit@northwind.example", passkeys: 1, isOperator: false, invitation: null });
    w.device = [uuidFor("user:kit")];
  },
});

/** Build a world for a scenario (or a `+` list of them) and a persona. */
export function buildWorld(scenario: string, persona: string): { world: World; scenarios: Scenario[]; persona: Persona } {
  const names = scenario.split("+").map((s) => s.trim()).filter(Boolean);
  const list = (names.length ? names : ["default"]).map((n) => scenarioNamed(n)).filter((s): s is Scenario => !!s);
  if (list.length === 0) list.push(SCENARIOS.get("default") as Scenario);
  const chosen = personaNamed(persona) ?? personaNamed(list.find((s) => s.persona)?.persona ?? "owner") ?? (PERSONAS.get("owner") as Persona);
  const world = defaultWorld(scenario, chosen.name);
  for (const s of list) s.apply?.(world);
  chosen.apply?.(world);
  world.sessionUserId = chosen.userId && world.users.some((u) => u.id === chosen.userId) ? chosen.userId : null;
  return { world, scenarios: list, persona: chosen };
}

/** The route a scenario list opens on, with its featured things filled in. */
export function resolveRoute(route: string, scenarios: Scenario[]): string {
  const featured: Featured = Object.assign({}, BASE_FEATURED, ...scenarios.map((s) => s.featured ?? {}));
  return route.replace(/\{(idea|run|app|employee|hire)\}/g, (_m, key: keyof Featured) => featured[key] ?? "");
}

