import { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CHIP } from "@/components/ui/chip";
import { Select } from "@/components/ui/field";
import { PageHeader, SECTION } from "@/components/ui/page";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { effectiveRole } from "@/lib/roles";
import { navigate, paths, useLocation } from "@/lib/router";
import { useActiveTree } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useClearAutonomyMutation, useClearRuleSetMutation, useGetAutonomyQuery, useGetMeQuery, useSetAutonomyMutation, useSetRuleSetMutation } from "@/store/api";
import type { Autonomy, RuleSet, Tree } from "@/store/types";
import { Fold } from "@/components/Fold";
import { formatNumber, plural } from "@/lib/format";
import { AppShell } from "../shell/AppShell";
import { KNOWN_TOOLS, placements, scopeName, toolLabel } from "../workforce/workforceModel";
import { groupRules } from "./autonomyModel";

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
  if (setAtPath === scope) return <Badge tone="info">Set here</Badge>;
  return <span className="text-sm text-ink-muted">Inherited from {scopeName(tree, setAtPath)}</span>;
}

/** "Use the inherited setting": a quiet action beside the "Set here" it undoes, drawn as the link it is. */
function UseInherited({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="quiet" className="px-2 text-primary-link hover:text-primary-hover" disabled={busy} onClick={onClick}>
      Use the inherited setting
    </Button>
  );
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
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), ...(org && scope !== org.slug ? [{ label: name, href: paths.manage(scope) }] : []), { label: "Autonomy" }]} aside={<CascadeAside />}>
      <PageHeader
        className={RISE}
        title={`How much ${name} does on its own`}
        lead="Set once for the organisation, narrowed for a division, project or app. The credit budget is the limit that is always on."
        actions={
          tree.data && (
            <span className="flex w-full flex-col gap-1 sm:w-auto">
              <label htmlFor="autonomy-scope" className="text-sm text-ink-muted">
                Level
              </label>
              <Select id="autonomy-scope" value={scope} onChange={(e) => navigate(paths.autonomy(e.target.value), { replace: true })} className="sm:w-64">
                {placements(tree.data).map((p) => (
                  <option key={p.scope} value={p.scope}>
                    {`${"— ".repeat(p.depth)}${p.label}`}
                  </option>
                ))}
              </Select>
            </span>
          )
        }
      />
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
          <h2 id="mode-title" className={SECTION}>
            How it works
          </h2>
          <span className="flex flex-wrap items-center gap-1">
            <Origin setAtPath={autonomy.autonomySetAtPath} scope={scope} tree={tree} fallback="Not set anywhere: auto-mode by default" />
            {admin && autonomy.autonomySetAtPath === scope && <UseInherited busy={busy} onClick={() => void run(() => clear({ scope, key: "autonomy" }).unwrap())} />}
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
        <h2 id="checkpoints-title" className={SECTION}>
          Checkpoints
        </h2>
        {autonomy.autonomy === "auto" && <p className="text-ink-muted">Checkpoints stop work only in checkpoints mode. They are kept for when you switch.</p>}
        <ul className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
          {CHECKPOINTS.map((c) => {
            const value = autonomy.checkpoints[c.key] ?? { on: false, setAtPath: null };
            return (
              <li key={c.key} className="grid grid-cols-lead-grow items-start gap-x-4 gap-y-1 border-b px-5 py-4 last:border-b-0 sm:grid-cols-lead-grow-end sm:items-center">
                <Switch label={c.label} on={value.on} disabled={!admin || busy} onChange={(on) => void run(() => set({ scope, checkpoints: { [c.key]: on } }).unwrap())} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-sm text-ink-body">{c.detail}</span>
                </span>
                <span className="col-start-2 flex flex-wrap items-center gap-1 sm:col-start-3 sm:justify-end">
                  <Origin setAtPath={value.setAtPath} scope={scope} tree={tree} fallback="Not set anywhere: off" />
                  {admin && value.setAtPath === scope && <UseInherited busy={busy} onClick={() => void run(() => clear({ scope, key: `checkpoint.${c.key}` }).unwrap())} />}
                </span>
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
      className={cn("relative inline-flex h-8 w-14 min-w-touch shrink-0 items-center rounded-full bg-clip-padding p-1 transition-colors disabled:opacity-60 phone:h-auto touch:min-h-touch phone:border-y-touch phone:border-transparent", on ? "bg-primary" : "bg-border-strong")}
    >
      <span aria-hidden className={cn("size-6 rounded-full bg-surface shadow-toggle transition-transform motion-reduce:transition-none", on ? "translate-x-6" : "translate-x-0")} />
      <span className="sr-only">{on ? "On" : "Off"}</span>
    </button>
  );
}

/** The columns every row of the stage matrix shares: the stage and where its rules were set, the three lists, and the actions. */
const MATRIX = "sm:grid sm:grid-cols-stage-matrix sm:items-start sm:gap-x-5";

function RuleSets({ autonomy, tree, admin }: { autonomy: Autonomy; tree: Tree | undefined; admin: boolean }) {
  return (
    <section aria-labelledby="rules-title" className={cn("flex flex-col gap-3", RISE, stagger(3))}>
      <div className="flex flex-col gap-1">
        <h2 id="rules-title" className={SECTION}>
          Rules for each stage
        </h2>
        <p className="max-w-prose text-ink-body">What the workforce may not do, what needs your sign-off first, and what it may do freely. A stage's own rules add to those for every stage.</p>
      </div>
      <Fold title="The stages" summary={`${plural(autonomy.stages.length, "stage")}, ${formatNumber(autonomy.ruleSets.length)} with rules of their own`}>
        <div className="flex min-w-0 flex-col overflow-hidden rounded-md border bg-surface shadow-card">
          <div aria-hidden className={cn("hidden border-b px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted", MATRIX)}>
            <span>Stage</span>
            {LISTS.map((l) => (
              <span key={l.key}>{l.title}</span>
            ))}
            <span />
          </div>
          <ul aria-label="Rules for each stage" className="flex flex-col">
            {autonomy.stages.map((stage) => (
              <StageRules key={stage} stage={stage} rule={autonomy.ruleSets.find((r) => r.stage === stage) ?? null} scope={autonomy.scope} tree={tree} admin={admin} />
            ))}
          </ul>
        </div>
      </Fold>
    </section>
  );
}

type ListName = "deny" | "ask" | "allow";

/** Each list, with a rule it might hold: the technical editor's placeholder, short enough to show whole. */
const LISTS: { key: ListName; title: string; example: string }[] = [
  { key: "deny", title: "May not", example: "run(rm -rf *)" },
  { key: "ask", title: "Asks you first", example: "run(npm install*)" },
  { key: "allow", title: "May do", example: "edit_file" },
];

/** One list's cell in a stage's row: each tool once, and in technical mode the rules beneath it as the harness reads them. */
function RuleCell({ title, rules, mode }: { title: string; rules: string[]; mode: "normal" | "technical" }) {
  const groups = groupRules(rules);
  return (
    <div className="flex min-w-0 gap-2 max-sm:items-baseline sm:flex-col">
      <span className="w-28 shrink-0 text-sm text-ink-muted sm:hidden">{title}</span>
      {groups.length === 0 ? (
        <span className="text-ink-muted">—</span>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {groups.map((g) => (
            <li key={g.tool} title={mode === "normal" && g.limited ? g.rules.join(", ") : undefined} className="flex min-w-0 flex-col text-sm">
              <span>{g.label}</span>
              {mode === "technical" &&
                g.rules.map((r) => (
                  <code key={r} className="break-all font-mono text-xs text-ink-muted">
                    {r}
                  </code>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StageRules({ stage, rule, scope, tree, admin }: { stage: string; rule: RuleSet | null; scope: string; tree: Tree | undefined; admin: boolean }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<ListName, string[]>>({ deny: rule?.deny ?? [], ask: rule?.ask ?? [], allow: rule?.allow ?? [] });
  const [save, saveState] = useSetRuleSetMutation();
  const [clear, clearState] = useClearRuleSetMutation();
  const [error, setError] = useState<string | null>(null);
  const busy = saveState.isLoading || clearState.isLoading;
  const setHere = rule?.setAtPath === scope;
  const empty = !rule || (rule.deny.length === 0 && rule.ask.length === 0 && rule.allow.length === 0);

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
    <li data-stage={stage} className={cn("flex min-w-0 flex-col gap-2.5 border-b px-5 py-3.5 last:border-b-0 max-sm:py-4", MATRIX, "sm:gap-y-3")}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-col sm:items-start">
        <h3 className="font-semibold">{stageLabel(stage)}</h3>
        {rule && <Origin setAtPath={rule.setAtPath} scope={scope} tree={tree} fallback="" />}
      </div>
      {empty ? (
        <span className="text-ink-muted sm:col-span-3">No rules set for this stage</span>
      ) : (
        LISTS.map((l) => <RuleCell key={l.key} title={l.title} rules={rule?.[l.key] ?? []} mode={mode} />)
      )}
      <div className="flex flex-wrap gap-1 sm:flex-col sm:items-end">
        {admin && !editing && (
          <>
            <Button size="sm" variant="secondary" onClick={start} disabled={busy}>
              {setHere ? "Change" : "Set rules here"}
            </Button>
            {setHere && (
              <Button size="sm" variant="quiet" onClick={() => void remove()} disabled={busy}>
                Remove here
              </Button>
            )}
          </>
        )}
      </div>
      {(setHere && rule && rule.overrides.length > 0) || (rule && rule.checkpoints.length > 0) ? (
        <div className="flex flex-col gap-1 text-sm text-ink-body sm:col-span-3 sm:col-start-2">
          {setHere && rule && rule.overrides.length > 0 && <p className="text-ink-muted">Replaces the rules set at {rule.overrides.map((p) => scopeName(tree, p)).join(", ")}.</p>}
          {rule && rule.checkpoints.length > 0 && <p>Also stops for you at: {rule.checkpoints.join(", ")}.</p>}
        </div>
      ) : null}
      {editing && (
        <div className="col-span-full flex flex-col gap-4 rounded-xs bg-ground p-4">
          <RuleEditor draft={draft} onChange={setDraft} mode={mode} stage={stage} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void submit()} disabled={busy}>
              Save for {scopeName(tree, scope)}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="col-span-full rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {error}
        </p>
      )}
    </li>
  );
}

function RuleEditor({ draft, onChange, mode, stage }: { draft: Record<ListName, string[]>; onChange: (d: Record<ListName, string[]>) => void; mode: "normal" | "technical"; stage: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {LISTS.map((l) => (
        <RuleList key={l.key} title={l.title} example={l.example} rules={draft[l.key]} mode={mode} id={`${stage}-${l.key}`} onChange={(rules) => onChange({ ...draft, [l.key]: rules })} />
      ))}
    </div>
  );
}

function RuleList({ title, example, rules, mode, id, onChange }: { title: string; example: string; rules: string[]; mode: "normal" | "technical"; id: string; onChange: (rules: string[]) => void }) {
  const [next, setNext] = useState("");
  const add = () => {
    const rule = next.trim();
    if (!rule || rules.includes(rule)) return;
    onChange([...rules, rule]);
    setNext("");
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <ul className="flex flex-wrap gap-1.5">
        {rules.map((r) => (
          <li key={r}>
            <button type="button" onClick={() => onChange(rules.filter((x) => x !== r))} className={cn(CHIP, "min-h-touch bg-surface px-3 hover:bg-attention-tint", mode === "technical" && "font-mono text-xs")}>
              {mode === "technical" ? r : toolLabel(r, mode)}
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
            }} placeholder={example} title="A tool, or a tool with a pattern" className="min-h-touch min-w-0 flex-1 rounded-xs border border-border-field bg-surface px-3 font-mono text-sm" />
          <Button size="sm" variant="secondary" onClick={add}>
            Add
          </Button>
        </span>
      ) : (
        <span className="flex gap-2">
          <select id={`add-${id}`} value={next} onChange={(e) => setNext(e.target.value)} className="min-h-touch min-w-0 flex-1 rounded-xs border border-border-field bg-surface px-2 text-sm">
            <option value="">Choose…</option>
            {KNOWN_TOOLS.filter((t) => !rules.includes(t)).map((t) => (
              <option key={t} value={t}>
                {toolLabel(t, "normal")}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" onClick={add} disabled={!next}>
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
        <h2 className="text-base font-semibold">One rule, used everywhere</h2>
        <p className="text-ink-body">Whatever is set at a level holds for everything beneath it, until a lower level narrows it. Each value says where it was set.</p>
      </section>
      <section className="flex flex-col gap-2.5">
        <h2 className="text-base font-semibold">What never changes</h2>
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

