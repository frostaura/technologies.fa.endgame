import type { CascadeValue, ScopeLevel } from "@/store/types";
import { chain, levelOf, node, organisation, within, type World } from "./world";

/**
 * The cascade as `CascadeService` keeps it — one value per (level, kind, key), the deepest on a
 * scope's chain winning — read and written over the world's own stores, so that a budget set here
 * is the same cap the credits page reads, a secret the same name the secrets page lists, and so on.
 * Each kind is an adapter; a kind or key with no store of its own lives in `world.settings` or
 * `world.context`. A new kind is one more adapter.
 */

export const KINDS = ["permission", "secret", "budget", "rule_set", "context", "setting"] as const;
export type Kind = (typeof KINDS)[number];

export interface Entry {
  path: string;
  key: string;
  value: unknown;
  setAt: string;
}

interface Adapter {
  list(world: World): Entry[];
  put(world: World, path: string, key: string, value: unknown): void;
  /** False when nothing was set there. */
  remove(world: World, path: string, key: string): boolean;
}

const at = (world: World, path: string) => node(world, path)?.createdAt ?? new Date().toISOString();

/** A setting's stored text read back as the JSON value it was written as. */
function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const settingStore: Adapter = {
  list: (w) => [
    ...w.settings.map((s) => ({ path: s.path, key: s.key, value: parse(s.value), setAt: at(w, s.path) })),
    ...w.overdraftLimits.map((l) => ({ path: l.path, key: "overdraft_limit", value: l.credits, setAt: l.setAt })),
    ...w.organisations.flatMap((o) => [
      ...(o.frostauraLimit > 0 ? [{ path: o.slug, key: "overdraft_limit", value: o.frostauraLimit, setAt: o.createdAt }] : []),
      ...(o.ownLimit !== null ? [{ path: o.slug, key: "overdraft_own_limit", value: o.ownLimit, setAt: o.createdAt }] : []),
    ]),
    ...w.apps.flatMap((a) => [
      { path: a.path, key: "sleep.idle_minutes", value: a.idleMinutes, setAt: a.publishedAt ?? at(w, a.path) },
      { path: a.path, key: "sleep.mode", value: a.runningSetting === "always-on" ? "always_on" : "auto", setAt: a.publishedAt ?? at(w, a.path) },
      { path: a.path, key: "access", value: a.access, setAt: a.publishedAt ?? at(w, a.path) },
    ]),
  ],
  put(w, path, key, value) {
    const o = organisation(w, path);
    const app = w.apps.find((a) => a.path === path);
    if (key === "overdraft_own_limit" && o) o.ownLimit = Number(value);
    else if (key === "overdraft_limit" && o) o.frostauraLimit = Number(value);
    else if (key === "overdraft_limit") {
      w.overdraftLimits = w.overdraftLimits.filter((l) => l.path !== path);
      w.overdraftLimits.push({ path, credits: Number(value), setAt: new Date().toISOString(), setBy: w.sessionUserId });
    } else if (key === "sleep.idle_minutes" && app) app.idleMinutes = Number(value);
    else if (key === "sleep.mode" && app) app.runningSetting = value === "always_on" ? "always-on" : "sleep";
    else if (key === "access" && app) app.access = value as typeof app.access;
    else {
      w.settings = w.settings.filter((s) => !(s.path === path && s.key === key));
      w.settings.push({ path, key, value: typeof value === "string" ? value : JSON.stringify(value) });
    }
  },
  remove(w, path, key) {
    const o = organisation(w, path);
    if (key === "overdraft_own_limit" && o) {
      const was = o.ownLimit !== null;
      o.ownLimit = null;
      return was;
    }
    if (key === "overdraft_limit" && !o) {
      const was = w.overdraftLimits.some((l) => l.path === path);
      w.overdraftLimits = w.overdraftLimits.filter((l) => l.path !== path);
      return was;
    }
    const was = w.settings.some((s) => s.path === path && s.key === key);
    w.settings = w.settings.filter((s) => !(s.path === path && s.key === key));
    return was;
  },
};

const budgetStore: Adapter = {
  list: (w) => w.budgets.map((b) => ({ path: b.path, key: "monthly_credits", value: b.cap, setAt: at(w, b.path) })),
  put(w, path, _key, value) {
    w.budgets = w.budgets.filter((b) => b.path !== path);
    w.budgets.push({ path, cap: Number(value) });
  },
  remove(w, path) {
    const was = w.budgets.some((b) => b.path === path);
    w.budgets = w.budgets.filter((b) => b.path !== path);
    return was;
  },
};

const contextStore: Adapter = {
  list: (w) => w.context ?? [],
  put(w, path, key, value) {
    w.context = [...(w.context ?? []).filter((c) => !(c.path === path && c.key === key)), { path, key, value, setAt: new Date().toISOString() }];
  },
  remove(w, path, key) {
    const was = (w.context ?? []).some((c) => c.path === path && c.key === key);
    w.context = (w.context ?? []).filter((c) => !(c.path === path && c.key === key));
    return was;
  },
};

const secretStore: Adapter = {
  list: (w) => w.secrets.map((s) => ({ path: s.path, key: s.name, value: null, setAt: s.setAt })),
  put(w, path, key) {
    w.secrets = [...w.secrets.filter((s) => !(s.path === path && s.name === key)), { path, name: key, setAt: new Date().toISOString() }];
  },
  remove(w, path, key) {
    const was = w.secrets.some((s) => s.path === path && s.name === key);
    w.secrets = w.secrets.filter((s) => !(s.path === path && s.name === key));
    return was;
  },
};

const ruleSetStore: Adapter = {
  list: (w) => w.ruleSets.map((r) => ({ path: r.path, key: r.stage, value: { deny: r.deny, ask: r.ask, allow: r.allow, checkpoints: r.checkpoints }, setAt: at(w, r.path) })),
  put(w, path, key, value) {
    const v = (value ?? {}) as Record<string, string[] | undefined>;
    w.ruleSets = [...w.ruleSets.filter((r) => !(r.path === path && r.stage === key)), { path, stage: key, deny: v.deny ?? [], ask: v.ask ?? [], allow: v.allow ?? [], checkpoints: v.checkpoints ?? [] }];
  },
  remove(w, path, key) {
    const was = w.ruleSets.some((r) => r.path === path && r.stage === key);
    w.ruleSets = w.ruleSets.filter((r) => !(r.path === path && r.stage === key));
    return was;
  },
};

const permissionStore: Adapter = {
  list: (w) => w.memberships.map((m) => ({ path: m.path, key: m.userId, value: m.role, setAt: m.grantedAt })),
  put: () => undefined,
  remove: () => false,
};

export const ADAPTERS: Record<Kind, Adapter> = { permission: permissionStore, secret: secretStore, budget: budgetStore, rule_set: ruleSetStore, context: contextStore, setting: settingStore };

function view(kind: Kind, e: Entry, overrides: string[]): CascadeValue {
  return { kind, key: e.key, value: kind === "secret" ? null : e.value, setAtLevel: levelOf(e.path) as ScopeLevel, setAtPath: e.path, setAt: e.setAt, overrides };
}

/** The effective values of a kind at a scope: per key the deepest on its chain, with the levels it replaces. */
export function effective(world: World, scope: string, kind: Kind): CascadeValue[] {
  const onChain = chain(scope);
  const byKey = new Map<string, Entry[]>();
  for (const e of ADAPTERS[kind].list(world)) {
    if (!onChain.includes(e.path)) continue;
    byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  }
  return [...byKey.values()]
    .map((list) => list.sort((a, b) => a.path.split("/").length - b.path.split("/").length))
    .map((list) => {
      const last = list[list.length - 1] as Entry;
      return view(kind, last, list.slice(0, -1).map((e) => e.path).reverse());
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** The values of a kind set strictly beneath a scope. */
export function below(world: World, scope: string, kind: Kind): CascadeValue[] {
  return ADAPTERS[kind]
    .list(world)
    .filter((e) => e.path !== scope && within(e.path, scope))
    .map((e) => view(kind, e, []))
    .sort((a, b) => a.setAtPath.localeCompare(b.setAtPath) || a.key.localeCompare(b.key));
}

/** The one value set at exactly this scope, as the view the control plane returns after a write. */
export function setHere(world: World, scope: string, kind: Kind, key: string): CascadeValue | undefined {
  return effective(world, scope, kind).find((v) => v.key === key && v.setAtPath === scope);
}
