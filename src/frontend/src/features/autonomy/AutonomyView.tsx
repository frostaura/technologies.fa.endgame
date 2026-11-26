import { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { effectiveRole } from "@/lib/roles";
import { navigate, paths, useLocation } from "@/lib/router";
import { useActiveTree } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useClearAutonomyMutation, useClearRuleSetMutation, useGetAutonomyQuery, useGetMeQuery, useSetAutonomyMutation, useSetRuleSetMutation } from "@/store/api";
import type { Autonomy, RuleSet, Tree } from "@/store/types";
import { AppShell } from "../shell/AppShell";
import { KNOWN_TOOLS, placements, scopeName, toolLabel } from "../workforce/workforceModel";

const CHECKPOINTS: { key: "start" | "plan" | "hire"; label: string; detail: string }[] = [
  { key: "start", label: "Before work starts", detail: "Wait for your word once the estimate is known." },
  { key: "plan", label: "Before the plan is carried out", detail: "Show you the plan and wait for you to agree it." },
  { key: "hire", label: "Before anyone is hired", detail: "Every hire waits for you, even inside the budget." },
];

const STAGES: Record<string, string> = {
  all: "Every stage",
  research: "Research",
  plan: "Planning",
  build: "Building",
  evaluate: "Checking the work",
  review: "Security review",
  conversation: "The conversation",
};

function stageLabel(stage: string): string {
  return STAGES[stage] ?? stage;
}

/** Where a value came from, said plainly: set here, inherited from a level above, or not set anywhere. */
function Origin({ setAtPath, scope, tree, fallback }: { setAtPath: string | null; scope: string; tree: Tree | undefined; fallback: string }) {
  if (!setAtPath) return <span className="text-sm text-ink-muted">{fallback}</span>;
  if (setAtPath === scope) return <Badge tone="primary">Set here</Badge>;
  return <span className="text-sm text-ink-muted">Inherited from {scopeName(tree, setAtPath)}</span>;
}

/** Autonomy, checkpoints and stage rule sets at any level of the tree. */
export function AutonomyView() {
  const { search } = useLocation();
  // In God mode, the organisation the operator entered (OP-04).
  const tree = useActiveTree();
  const me = useGetMeQuery(undefined);
  const org = tree.data?.organisation;
  const scope = search.get("scope") ?? org?.slug ?? "";
  const query = useGetAutonomyQuery(scope, { skip: !scope });
  const view = scope ? viewOf(query) : tree.isError ? { kind: "failed" as const, reason: "The organisation could not be read.", status: null } : { kind: "loading" as const };
  const name = scopeName(tree.data, scope);
  // The role at this level, as the server resolves it: the deepest grant wins (PPL-01).
  const role = effectiveRole(tree.data, me.data, scope);
  const admin = role === "admin" || role === "owner";

  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), { label: `Autonomy · ${name}` }]} aside={<CascadeAside />}>
      <div className={cn("flex flex-wrap items-end justify-between gap-4", RISE)}>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">How much {name} does on its own</h1>
          <p className="max-w-prose text-ink-body">Set once for the organisation, narrowed for a division, project or app. The credit budget is the limit that is always on.</p>
        </div>
        {tree.data && (
          <span className="flex flex-col gap-1">
            <label htmlFor="autonomy-scope" className="text-sm text-ink-muted">
              Level
            </label>
            <select id="autonomy-scope" value={scope} onChange={(e) => navigate(paths.autonomy(e.target.value), { replace: true })} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3">
              {placements(tree.data).map((p) => (
                <option key={p.scope} value={p.scope}>
                  {`${"— ".repeat(p.depth)}${p.label}`}
                </option>
              ))}
            </select>
          </span>
        )}
      </div>
      {!admin && view.kind === "loaded" && <p className="rounded-xs bg-quiet px-4 py-3 text-quiet-text">You can read these. An Admin or the Owner sets them.</p>}
      {view.kind === "loading" && (
        <Loading label="Loading the autonomy settings" className="flex flex-col gap-4">
          <Skeleton className="h-32 rounded-md" />
          <Skeleton className="h-48 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The autonomy settings could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <ErrorBoundary name="Autonomy and checkpoints">
            <ModeAndCheckpoints autonomy={view.data} tree={tree.data} admin={admin} />
          </ErrorBoundary>
          <ErrorBoundary name="The rule sets">
            <RuleSets autonomy={view.data} tree={tree.data} admin={admin} />
          </ErrorBoundary>
        </>
      )}
    </AppShell>
  );
}

function ModeAndCheckpoints({ autonomy, tree, admin }: { autonomy: Autonomy; tree: Tree | undefined; admin: boolean }) {
  const [set, setState] = useSetAutonomyMutation();
  const [clear, clearState] = useClearAutonomyMutation();
  const [error, setError] = useState<string | null>(null);
  const scope = autonomy.scope;
  const busy = setState.isLoading || clearState.isLoading;

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(`Not changed: ${describeError(e as never)}`);
    }
  };

  const modes = [
    { value: "auto" as const, title: "Auto-mode", detail: "The workforce runs the whole lifecycle on its own, inside the budget. A verdict of “do not build” still waits for you." },
    { value: "checkpoints" as const, title: "Checkpoints", detail: "The workforce stops for your sign-off at the checkpoints you switch on below." },
  ];

  return (
    <>
      <section aria-labelledby="mode-title" className={cn("flex flex-col gap-3", RISE, stagger(1))}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mode-title" className="text-lg font-semibold">
            How it works
          </h2>
          <span className="flex flex-wrap items-center gap-2">
            <Origin setAtPath={autonomy.autonomySetAtPath} scope={scope} tree={tree} fallback="Not set anywhere: auto-mode by default" />
            {admin && autonomy.autonomySetAtPath === scope && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => clear({ scope, key: "autonomy" }).unwrap())}>
                Use the inherited setting
              </Button>
            )}
          </span>
        </div>
        <div role="radiogroup" aria-label="How it works" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {modes.map((m) => {
            const on = autonomy.autonomy === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!admin || busy}
                onClick={() => !on && void run(() => set({ scope, autonomy: m.value }).unwrap())}
                className={cn(
                  "flex flex-col gap-1.5 rounded-md border px-5 py-4 text-left transition-colors disabled:cursor-default",
                  on ? "border-primary bg-primary-tint ring-2 ring-primary" : "bg-surface hover:bg-ground",
                )}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <span aria-hidden className={cn("size-4 rounded-full border-2", on ? "border-primary bg-primary" : "border-border-strong")} />
                  {m.title}
                </span>
                <span className="text-ink-body">{m.detail}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="checkpoints-title" className={cn("flex flex-col gap-3", RISE, stagger(2))}>
        <h2 id="checkpoints-title" className="text-lg font-semibold">
          Checkpoints
        </h2>
        {autonomy.autonomy === "auto" && <p className="text-ink-muted">Checkpoints stop work only in checkpoints mode. They are kept for when you switch.</p>}
        <ul className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
          {CHECKPOINTS.map((c) => {
            const value = autonomy.checkpoints[c.key] ?? { on: false, setAtPath: null };
            return (
              <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 last:border-b-0">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-sm text-ink-body">{c.detail}</span>
                  <span className="flex flex-wrap items-center gap-2 pt-1">
                    <Origin setAtPath={value.setAtPath} scope={scope} tree={tree} fallback="Not set anywhere: off" />
                    {admin && value.setAtPath === scope && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => clear({ scope, key: `checkpoint.${c.key}` }).unwrap())}>
                        Use the inherited setting
                      </Button>
                    )}
                  </span>
                </span>
                <Switch label={c.label} on={value.on} disabled={!admin || busy} onChange={(on) => void run(() => set({ scope, checkpoints: { [c.key]: on } }).unwrap())} />
              </li>
            );
          })}
        </ul>
        {error && (
          <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
            {error}
          </p>
        )}
      </section>
    </>
  );
}

function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn("relative inline-flex h-8 w-14 min-w-touch shrink-0 items-center rounded-full p-1 transition-colors disabled:opacity-60", on ? "bg-primary" : "bg-border-strong")}
    >
      <span aria-hidden className={cn("size-6 rounded-full bg-surface shadow-toggle transition-transform motion-reduce:transition-none", on ? "translate-x-6" : "translate-x-0")} />
      <span className="sr-only">{on ? "On" : "Off"}</span>
    </button>
  );
}

function RuleSets({ autonomy, tree, admin }: { autonomy: Autonomy; tree: Tree | undefined; admin: boolean }) {
  return (
    <section aria-labelledby="rules-title" className={cn("flex flex-col gap-3", RISE, stagger(3))}>
      <div className="flex flex-col gap-1">
        <h2 id="rules-title" className="text-lg font-semibold">
          Rules for each stage
        </h2>
        <p className="text-ink-body">What the workforce may not do, what needs your sign-off first, and what it may do freely. A stage's own rules add to those for every stage.</p>
      </div>
      <ul className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {autonomy.stages.map((stage) => (
          <StageRules key={stage} stage={stage} rule={autonomy.ruleSets.find((r) => r.stage === stage) ?? null} scope={autonomy.scope} tree={tree} admin={admin} />
        ))}
      </ul>
    </section>
  );
}

type ListName = "deny" | "ask" | "allow";

const LISTS: { key: ListName; title: string; empty: string; tone: string }[] = [
  { key: "deny", title: "May not", empty: "Nothing extra is refused", tone: "text-attention-text" },
  { key: "ask", title: "Asks you first", empty: "Nothing waits for you", tone: "text-violet-text" },
  { key: "allow", title: "May do", empty: "Only what the job allows", tone: "text-success-text" },
];

function StageRules({ stage, rule, scope, tree, admin }: { stage: string; rule: RuleSet | null; scope: string; tree: Tree | undefined; admin: boolean }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<ListName, string[]>>({ deny: rule?.deny ?? [], ask: rule?.ask ?? [], allow: rule?.allow ?? [] });
  const [save, saveState] = useSetRuleSetMutation();
  const [clear, clearState] = useClearRuleSetMutation();
  const [error, setError] = useState<string | null>(null);
  const busy = saveState.isLoading || clearState.isLoading;
  const setHere = rule?.setAtPath === scope;

  const start = () => {
    setDraft({ deny: rule?.deny ?? [], ask: rule?.ask ?? [], allow: rule?.allow ?? [] });
    setError(null);
    setEditing(true);
  };

  const submit = async () => {
    setError(null);
    setEditing(false);
    try {
      await save({ scope, stage, ...draft, checkpoints: rule?.checkpoints ?? [] }).unwrap();
    } catch (e) {
      setError(`The rules were not saved: ${describeError(e as never)} They are as they were.`);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await clear({ scope, stage }).unwrap();
    } catch (e) {
      setError(`Not removed: ${describeError(e as never)}`);
    }
  };

  return (
    <li data-stage={stage} className="flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{stageLabel(stage)}</h3>
        <Origin setAtPath={rule?.setAtPath ?? null} scope={scope} tree={tree} fallback="No rules set for this stage" />
      </div>
      {setHere && rule && rule.overrides.length > 0 && <p className="text-sm text-ink-muted">Replaces the rules set at {rule.overrides.map((p) => scopeName(tree, p)).join(", ")}.</p>}
      {editing ? (
        <RuleEditor draft={draft} onChange={setDraft} mode={mode} stage={stage} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {LISTS.map((l) => (
            <div key={l.key} className="flex min-w-0 flex-col gap-1.5">
              <span className={cn("text-sm font-semibold", l.tone)}>{l.title}</span>
              {(rule?.[l.key] ?? []).length === 0 ? (
                <span className="text-sm text-ink-muted">{l.empty}</span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {(rule?.[l.key] ?? []).map((r) => (
                    <li key={r} className={cn("break-words text-sm", mode === "technical" && "font-mono")}>
                      {toolLabel(r, mode)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {rule && rule.checkpoints.length > 0 && <p className="text-sm text-ink-body">Also stops for you at: {rule.checkpoints.join(", ")}.</p>}
      {admin && (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" onClick={() => void submit()} disabled={busy}>
                Save for {scopeName(tree, scope)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={start} disabled={busy}>
                {setHere ? "Change" : "Set rules here"}
              </Button>
              {setHere && (
                <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}>
                  Remove here
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {error}
        </p>
      )}
    </li>
  );
}

function RuleEditor({ draft, onChange, mode, stage }: { draft: Record<ListName, string[]>; onChange: (d: Record<ListName, string[]>) => void; mode: "normal" | "technical"; stage: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {LISTS.map((l) => (
        <RuleList key={l.key} title={l.title} tone={l.tone} rules={draft[l.key]} mode={mode} id={`${stage}-${l.key}`} onChange={(rules) => onChange({ ...draft, [l.key]: rules })} />
      ))}
    </div>
  );
}

function RuleList({ title, tone, rules, mode, id, onChange }: { title: string; tone: string; rules: string[]; mode: "normal" | "technical"; id: string; onChange: (rules: string[]) => void }) {
  const [next, setNext] = useState("");
  const add = () => {
    const rule = next.trim();
    if (!rule || rules.includes(rule)) return;
    onChange([...rules, rule]);
    setNext("");
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className={cn("text-sm font-semibold", tone)}>{title}</legend>
      <ul className="flex flex-wrap gap-1.5">
        {rules.map((r) => (
          <li key={r}>
            <button type="button" onClick={() => onChange(rules.filter((x) => x !== r))} className="inline-flex min-h-touch items-center gap-1.5 rounded-full bg-ground px-3 text-sm hover:bg-attention-tint">
              {toolLabel(r, mode)}
              <span aria-hidden>×</span>
              <span className="sr-only">Remove</span>
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor={`add-${id}`} className="sr-only">
        Add to {title}
      </label>
      {mode === "technical" ? (
        <span className="flex gap-2">
          <input id={`add-${id}`} value={next} onChange={(e) => setNext(e.target.value)} onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }} placeholder="tool or tool(pattern)" className="min-h-touch min-w-0 flex-1 rounded-xs border border-border-strong bg-surface px-3 font-mono text-sm" />
          <Button size="sm" variant="outline" onClick={add}>
            Add
          </Button>
        </span>
      ) : (
        <span className="flex gap-2">
          <select id={`add-${id}`} value={next} onChange={(e) => setNext(e.target.value)} className="min-h-touch min-w-0 flex-1 rounded-xs border border-border-strong bg-surface px-2 text-sm">
            <option value="">Choose…</option>
            {KNOWN_TOOLS.filter((t) => !rules.includes(t)).map((t) => (
              <option key={t} value={t}>
                {toolLabel(t, "normal")}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={add} disabled={!next}>
            Add
          </Button>
        </span>
      )}
    </fieldset>
  );
}

function CascadeAside() {
  return (
    <>
      <section className={cn("flex flex-col gap-2.5", RISE)}>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Icon name="organisation" tinted />
          One rule, used everywhere
        </h2>
        <p className="text-ink-body">Whatever is set at a level holds for everything beneath it, until a lower level narrows it. Each value says where it was set.</p>
      </section>
      <section className="flex flex-col gap-2.5">
        <h2 className="text-lg font-semibold">What never changes</h2>
        <ul className="flex flex-col gap-2 text-ink-body">
          <li>The credit budget is always on.</li>
          <li>No one may make an app public but a person.</li>
          <li>Nothing is built over a red line.</li>
          <li>Repairing its own mistake is never billed.</li>
        </ul>
      </section>
    </>
  );
}

