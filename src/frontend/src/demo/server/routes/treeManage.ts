import type { MemberRole, TreeNode } from "@/store/types";
import { me, requireRole, scopeOf } from "../access";
import { ADAPTERS, KINDS, below, effective, setHere, type Kind } from "../cascade";
import { area, conflict, created, forbidden, invalid, noContent, notFound, ok, str } from "../http";
import { notEnoughHistory } from "../mutations";
import { appAt, chain, levelOf, node, organisation, uuidFor, within, type DemoNode, type World } from "../world";

/**
 * `TreeEndpoints.cs`, its managing half (lane B's screens): creating, renaming, archiving,
 * reactivating and deleting divisions, projects and apps, renaming the organisation, and the
 * cascade's values — read, read beneath, set and removed — with `TreeService` and
 * `CascadeService`'s own refusals.
 */

type Level = "division" | "project" | "app";
const LEVELS: Record<string, Level | "organisation"> = { organisations: "organisation", divisions: "division", projects: "project", apps: "app" };
const PARENT: Record<Level, string> = { division: "organisation", project: "division", app: "project" };
const CREATE: Record<Level, MemberRole> = { division: "admin", project: "builder", app: "builder" };
const CHANGE: Record<Level | "organisation", MemberRole> = { organisation: "owner", division: "admin", project: "builder", app: "builder" };
const DELETE: Record<Level, MemberRole> = { division: "admin", project: "admin", app: "admin" };
const STATUSES: Record<Level | "organisation", string[]> = {
  organisation: ["active", "suspended"],
  division: ["active", "archived"],
  project: ["active", "archived"],
  app: ["draft", "building", "running", "sleeping", "stopped", "failed", "archived"],
};
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nodeView(world: World, n: DemoNode): TreeNode {
  const app = appAt(world, n.path);
  const org = n.level === "organisation" ? organisation(world, n.path) : undefined;
  return { id: app?.id ?? org?.id ?? n.id, level: n.level, slug: n.slug, name: n.name, path: n.path, status: app?.status ?? org?.status ?? n.status ?? "active", createdAt: n.createdAt };
}

/** A node by the id the console holds: an app's and an organisation's ids are their own records'. */
function findNode(world: World, level: Level | "organisation", id: string): DemoNode {
  const n = world.nodes.find((x) => x.level === level && (x.id === id || appAt(world, x.path)?.id === id || (level === "organisation" && organisation(world, x.path)?.id === id)));
  if (!n) throw notFound(`The ${level}`);
  return n;
}

function checkName(name: string) {
  if (!name.trim()) throw invalid("A name cannot be empty.");
  if (name.length > 200) throw invalid("A name is at most 200 characters.");
}

function kindOf(value: string | null | undefined): Kind {
  if (value && (KINDS as readonly string[]).includes(value)) return value as Kind;
  throw invalid(`'${value ?? ""}' is not a cascade kind: use ${KINDS.join(", ")}.`);
}

/** `CascadeService.RoleToSet`. */
function roleToSet(kind: Kind, key: string): MemberRole {
  if (kind === "context") return "builder";
  if (kind === "setting" && key.startsWith("sleep.")) return "builder";
  if (kind === "setting" && key === "overdraft_own_limit") return "owner";
  return "admin";
}

/** `CascadeService.ValidateWellKnownAsync`: the numbers the control plane reads, the overdraft rule, the settings it knows. */
function validate(world: World, scope: string, kind: Kind, key: string, value: unknown) {
  const isOverdraft = kind === "setting" && (key === "overdraft_limit" || key === "overdraft_own_limit");
  const isCredits = (kind === "budget" && key === "monthly_credits") || (kind === "setting" && key === "app_models.monthly_credits");
  if (isOverdraft || isCredits) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`'${key}' is a number of credits.`);
    if (value < 0) throw invalid(`'${key}' cannot be negative.`);
  }
  if (isOverdraft) {
    const atOrg = levelOf(scope) === "organisation";
    const o = organisation(world, scope.split("/")[0] ?? scope);
    const operator = me(world).isOperator;
    if (key === "overdraft_limit" && atOrg && !operator) throw forbidden("An organisation's deepest overdraft is set by a FrostAura operator. Set a tighter one of your own (overdraft_own_limit), or on a division, project or app.");
    if (key === "overdraft_own_limit" && !atOrg) throw invalid("overdraft_own_limit is the organisation's own limit; narrow a division, project or app with overdraft_limit.");
    if (key === "overdraft_own_limit" && o && (value as number) > o.frostauraLimit) throw invalid(`The organisation's own overdraft may be tighter than the ${o.frostauraLimit} credits FrostAura set, never deeper.`);
    if (key === "overdraft_limit" && !atOrg && o) {
      let inherited = o.ownLimit !== null ? Math.min(o.ownLimit, o.frostauraLimit) : o.frostauraLimit;
      for (const p of chain(scope).slice(1, -1)) {
        const l = world.overdraftLimits.find((x) => x.path === p);
        if (l) inherited = Math.min(inherited, l.credits);
      }
      if ((value as number) > inherited) throw invalid(`An overdraft here may be tighter than the ${inherited} credits inherited, never deeper.`);
    }
  }
  if (kind !== "setting") return;
  if (key === "autonomy" && value !== "auto" && value !== "checkpoints") throw invalid("autonomy is 'auto' (the workforce runs the lifecycle end to end) or 'checkpoints' (it stops where a checkpoint is set).");
  if (key.startsWith("checkpoint.") && typeof value !== "boolean") throw invalid(`${key} is true or false.`);
  if (key === "workforce.idle_days" && !(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 365)) throw invalid("workforce.idle_days is a whole number of days from 1 to 365.");
  if (key === "sleep.mode" && value !== "auto" && value !== "always_on") throw invalid("sleep.mode is 'auto' or 'always_on'.");
  if (key === "sleep.idle_minutes" && !(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1440)) throw invalid("sleep.idle_minutes is a whole number from 1 to 1440.");
  if (key === "access" && !["private", "shared", "public"].includes(String(value))) throw invalid("access is 'private', 'shared' or 'public'.");
}

/** What hangs off a node, so it cannot be deleted (`TreeService.DeleteAsync`'s restricting keys). */
function attached(world: World, path: string): boolean {
  const beneath = world.nodes.some((n) => n.path !== path && within(n.path, path));
  const work = world.runs.some((r) => within(r.run.scope, path)) || world.ideas.some((i) => i.scope !== null && within(i.scope, path)) || world.tasks.some((t) => within(t.scope, path));
  const people = world.employees.some((e) => within(e.scope, path));
  const money = world.spend.some((s) => within(s.path, path) && s.ai + s.hosting > 0);
  const app = appAt(world, path);
  const history = app ? (world.versions[app.id] ?? []).length > 0 : false;
  return beneath || work || people || money || history;
}

const nodeRoutes = Object.fromEntries(
  (["divisions", "projects", "apps"] as const).flatMap((plural) => {
    const level = LEVELS[plural] as Level;
    return [
      [
        `POST ${plural}`,
        (req: { body: Record<string, unknown> }, { world }: { world: World }) => {
          const parent = scopeOf(world, str(req.body, "parent"));
          requireRole(world, parent, CREATE[level]);
          const parentLevel = levelOf(parent);
          if (parentLevel !== PARENT[level]) throw invalid(`A ${level} is created under a ${PARENT[level]}; '${parent}' is a ${parentLevel}.`);
          const name = str(req.body, "name") ?? "";
          checkName(name);
          const slug = str(req.body, "slug") ?? "";
          if (slug.length < 2 || slug.length > 40 || !SLUG.test(slug)) throw invalid(`'${slug}' is not a valid slug: use 2-40 lower-case letters, digits and single hyphens, starting and ending with a letter or digit.`);
          const path = `${parent}/${slug}`;
          if (node(world, path)) throw conflict("A sibling already uses that slug.");
          const at = new Date().toISOString();
          const n: DemoNode = { id: uuidFor(`node:${path}:${world.counter++}`), path, slug, name: name.trim(), level, createdAt: at, stage: level === "project" ? "planning" : null, ideaId: null, note: null, status: "active" };
          world.nodes.push(n);
          if (level === "app") {
            world.apps.push({ id: uuidFor(`app:${path}:${world.counter++}`), path, name: name.trim(), health: "unknown", healthSummary: "Not published yet.", running: "asleep", status: "draft", pausedReason: null, access: "private", runningSetting: "sleep", idleMinutes: 15, telemetry: null, capCredits: null, version: null, publishedAt: null, endUsers: 0, runningCost: notEnoughHistory(0) });
          }
          world.changed.push("Tree", "Credits", "Ontology");
          return created(nodeView(world, n));
        },
      ],
    ];
  }),
);

const changeRoutes = Object.fromEntries(
  (["organisations", "divisions", "projects", "apps"] as const).flatMap((plural) => {
    const level = LEVELS[plural] as Level | "organisation";
    const routes: [string, (req: { params: Record<string, string>; body: Record<string, unknown> }, ctx: { world: World }) => unknown][] = [
      [
        `PATCH ${plural}/{id}`,
        (req, { world }) => {
          const n = findNode(world, level, req.params.id ?? "");
          requireRole(world, n.path, CHANGE[level]);
          const name = str(req.body, "name");
          const status = str(req.body, "status");
          if (level === "organisation" && status !== undefined && !me(world).isOperator) throw forbidden("An organisation is suspended or reinstated by FrostAura.");
          if (name !== undefined) checkName(name);
          if (status !== undefined && !STATUSES[level].includes(status)) throw invalid(`'${status}' is not a status a ${level} can have: use ${STATUSES[level].join(", ")}.`);
          if (name !== undefined) {
            n.name = name.trim();
            const o = level === "organisation" ? organisation(world, n.path) : undefined;
            if (o) o.name = n.name;
            const app = appAt(world, n.path);
            if (app) app.name = n.name;
          }
          if (status !== undefined) {
            const app = appAt(world, n.path);
            const o = level === "organisation" ? organisation(world, n.path) : undefined;
            if (app) app.status = status;
            else if (o) o.status = status;
            else n.status = status;
          }
          world.changed.push("Tree", "App", "Credits", "Me", "Ontology");
          return ok(nodeView(world, n));
        },
      ],
    ];
    if (level !== "organisation") {
      routes.push([
        `DELETE ${plural}/{id}`,
        (req, { world }) => {
          const n = findNode(world, level, req.params.id ?? "");
          requireRole(world, n.path, DELETE[level]);
          if (attached(world, n.path)) throw conflict(`'${n.path}' still has children, work or credit history attached. Archive it instead (status: archived).`);
          world.nodes = world.nodes.filter((x) => x.path !== n.path);
          world.apps = world.apps.filter((a) => a.path !== n.path);
          world.memberships = world.memberships.filter((m) => m.path !== n.path);
          world.settings = world.settings.filter((s) => s.path !== n.path);
          world.budgets = world.budgets.filter((b) => b.path !== n.path);
          world.context = (world.context ?? []).filter((c) => c.path !== n.path);
          world.changed.push("Tree", "Credits", "Ontology");
          return noContent();
        },
      ]);
    }
    return routes;
  }),
);

area("TreeEndpoints", {
  ...(nodeRoutes as Record<string, never>),
  ...(changeRoutes as Record<string, never>),

  "GET cascade": (req, { world }) => {
    const kind = kindOf(req.query.get("kind"));
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, kind === "permission" || kind === "secret" ? "admin" : "viewer");
    return ok(effective(world, scope, kind));
  },

  "GET cascade/below": (req, { world }) => {
    const kind = kindOf(req.query.get("kind"));
    if (kind === "permission") throw invalid("Roles granted beneath a level are listed by /api/members.");
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, kind === "secret" ? "admin" : "viewer");
    return ok(below(world, scope, kind));
  },

  "PUT cascade": (req, { world }) => {
    const kind = kindOf(str(req.body, "kind"));
    const key = str(req.body, "key") ?? "";
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, roleToSet(kind, key));
    if (kind === "secret" ? !/^[A-Z][A-Z0-9_]{1,127}$/.test(key) : !/^[a-z0-9._-]{1,200}$/.test(key)) {
      throw invalid(kind === "secret" ? `'${key}' is not a secret name: use UPPER_SNAKE_CASE, 2-128 characters, starting with a letter (for example STRIPE_API_KEY).` : `'${key}' is not a cascade key: use 1-200 lower-case letters, digits, dots, hyphens and underscores.`);
    }
    if (kind === "permission") throw invalid("Roles are granted through /api/members, which records who granted them.");
    const value = req.body.value;
    if (kind === "secret") {
      if (typeof value !== "string" || value.length === 0) throw invalid("A secret's value is a non-empty string.");
      if (value.length > 16384) throw invalid("A secret's value is at most 16384 characters.");
    } else validate(world, scope, kind, key, value);
    ADAPTERS[kind].put(world, scope, key, kind === "secret" ? null : value);
    world.changed.push("Cascade", "Credits", "App", "Tree", "Secrets", "Autonomy");
    return ok(setHere(world, scope, kind, key));
  },

  "DELETE cascade": (req, { world }) => {
    const kindText = req.query.get("kind");
    const kind = kindOf(kindText);
    const key = req.query.get("key") ?? "";
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, roleToSet(kind, key));
    if (!ADAPTERS[kind].remove(world, scope, key)) throw notFound(`A ${kindText ?? ""} '${key}' set at '${scope}'`);
    world.changed.push("Cascade", "Credits", "App", "Tree", "Secrets", "Autonomy");
    return noContent();
  },
});
