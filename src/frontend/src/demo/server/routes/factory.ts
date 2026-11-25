import type { Autonomy, CheckpointSetting } from "@/store/types";
import { requireRole, scopeOf } from "../access";
import { area, invalid, notFound, ok, str, strings } from "../http";
import { chain, type World } from "../world";

/** `FactoryEndpoints.cs`: autonomy, checkpoints and stage rule sets, all set by the cascade. */

const STAGES = ["all", "research", "plan", "build", "evaluate", "review", "conversation"];
const RULE = /^(\*|[a-z][a-z0-9_]*)(\((.+)\))?$/;

export function autonomyView(world: World, scope: string): Autonomy {
  const find = (key: string) => {
    let hit: { value: string; path: string } | null = null;
    for (const p of chain(scope)) {
      const s = world.settings.find((x) => x.path === p && x.key === key);
      if (s) hit = { value: s.value, path: p };
    }
    return hit;
  };
  const mode = find("autonomy");
  const checkpoints: Record<string, CheckpointSetting> = {};
  for (const k of ["start", "plan", "hire"]) {
    const s = find(`checkpoint.${k}`);
    checkpoints[k] = { on: s?.value === "true", setAtPath: s?.path ?? null };
  }
  const ruleSets = STAGES.flatMap((stage) => {
    const onChain = chain(scope).map((p) => world.ruleSets.find((r) => r.path === p && r.stage === stage)).filter((r): r is NonNullable<typeof r> => !!r);
    const last = onChain[onChain.length - 1];
    if (!last) return [];
    return [{ stage, deny: last.deny, ask: last.ask, allow: last.allow, checkpoints: last.checkpoints, setAtPath: last.path, overrides: onChain.slice(0, -1).map((r) => r.path) }];
  });
  return { scope, autonomy: mode?.value === "checkpoints" ? "checkpoints" : "auto", autonomySetAtPath: mode?.path ?? null, checkpoints, ruleSets, stages: STAGES };
}

function put(world: World, path: string, key: string, value: string) {
  world.settings = world.settings.filter((s) => !(s.path === path && s.key === key));
  world.settings.push({ path, key, value });
}

area("FactoryEndpoints", {
  "GET autonomy": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "viewer");
    return ok(autonomyView(world, scope));
  },

  "PUT autonomy": (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, "admin");
    const mode = req.body.autonomy;
    const checkpoints = req.body.checkpoints && typeof req.body.checkpoints === "object" ? (req.body.checkpoints as Record<string, unknown>) : null;
    if (mode === undefined && !checkpoints) throw invalid("Send autonomy ('auto' or 'checkpoints'), checkpoints { start, plan, hire }, or both.");
    if (mode !== undefined && mode !== "auto" && mode !== "checkpoints") throw invalid("autonomy is 'auto' (the workforce runs the lifecycle end to end) or 'checkpoints' (it stops where a checkpoint is set).");
    if (typeof mode === "string") put(world, scope, "autonomy", mode);
    for (const [k, v] of Object.entries(checkpoints ?? {})) if (typeof v === "boolean" && ["start", "plan", "hire"].includes(k)) put(world, scope, `checkpoint.${k}`, String(v));
    world.changed.push("Autonomy");
    return ok(autonomyView(world, scope));
  },

  "DELETE autonomy": (req, { world }) => {
    const key = req.query.get("key") ?? "";
    if (!["autonomy", "checkpoint.start", "checkpoint.plan", "checkpoint.hire"].includes(key)) throw invalid("key is one of autonomy, checkpoint.start, checkpoint.plan, checkpoint.hire.");
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "admin");
    world.settings = world.settings.filter((s) => !(s.path === scope && s.key === key));
    world.changed.push("Autonomy");
    return ok(autonomyView(world, scope));
  },

  "PUT autonomy/rule-sets": (req, { world }) => {
    const scope = scopeOf(world, str(req.body, "scope"));
    requireRole(world, scope, "admin");
    const stage = str(req.body, "stage") ?? "";
    if (!stage) throw invalid("'' is not a cascade key: use 1-200 lower-case letters, digits, dots, hyphens and underscores.");
    const faults: string[] = [];
    if (!STAGES.includes(stage)) faults.push(`'${stage}' is not a stage: a rule set is keyed by all, research, plan, build, evaluate, review, conversation.`);
    const lists = { deny: strings(req.body, "deny"), ask: strings(req.body, "ask"), allow: strings(req.body, "allow"), checkpoints: strings(req.body, "checkpoints") };
    for (const [list, items] of Object.entries(lists)) for (const item of items) if (!RULE.test(item) || item.length > 300) faults.push(`'${JSON.stringify(item)}' in ${list} is not a rule: write a tool name or tool(pattern), for example edit_file or run(git push*).`);
    if (faults.length) throw invalid(faults.join(" "));
    world.ruleSets = world.ruleSets.filter((r) => !(r.path === scope && r.stage === stage));
    world.ruleSets.push({ path: scope, stage, ...lists });
    world.changed.push("Autonomy");
    return ok(autonomyView(world, scope));
  },

  "DELETE autonomy/rule-sets": (req, { world }) => {
    const scope = scopeOf(world, req.query.get("scope"));
    requireRole(world, scope, "admin");
    const stage = req.query.get("stage") ?? "";
    if (!world.ruleSets.some((r) => r.path === scope && r.stage === stage)) throw notFound(`A rule set for '${stage}' set at '${scope}'`);
    world.ruleSets = world.ruleSets.filter((r) => !(r.path === scope && r.stage === stage));
    world.changed.push("Autonomy");
    return ok(autonomyView(world, scope));
  },
});
