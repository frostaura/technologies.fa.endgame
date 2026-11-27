import { useId, useState, type FormEvent } from "react";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { describeError, viewOf } from "@/lib/queryState";
import { useAppSelector } from "@/store";
import { useGetCascadeBelowQuery, useGetCascadeQuery, useRemoveCascadeMutation, useSetCascadeMutation } from "@/store/api";
import type { CascadeValue, ScopeLevel } from "@/store/types";
import { Outcome } from "./NodeControls";
import { contextKeyFrom, contextLabel, contextText, isContextKey } from "./treeManage";

const VALUE_LIMIT = 4000;

/**
 * "What this is": the context a level's work reads — set here, or inherited from above, each saying
 * which level set it — and what levels beneath it replace. A Builder adds, changes and removes the
 * entries set at this level; anyone with a role here reads them.
 */
export function ContextPanel({ scope, name, level, canWrite, nameOf }: { scope: string; name: string; level: ScopeLevel; canWrite: boolean; nameOf: (path: string) => string }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const query = useGetCascadeQuery({ scope, kind: "context" });
  const below = useGetCascadeBelowQuery({ scope, kind: "context" }, { skip: level === "app" });
  const view = viewOf(query);
  const belowView = viewOf(below);
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState<CascadeValue | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const keyName = (key: string) => (technical ? key : contextLabel(key));

  return (
    <section aria-labelledby={`${scope}-what`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={`${scope}-what`} className="text-lg font-semibold">
          What this is
        </h2>
        <p className="text-ink-body">What {name} is, said once. Everything beneath it reads this, unless a lower level says it differently.</p>
      </div>
      {refused && <Outcome ok={false}>{refused}</Outcome>}
      {view.kind === "loading" && (
        <Loading label="Loading what this is" className="flex flex-col gap-2">
          <Skeleton className="h-16 rounded-xs" />
          <Skeleton className="h-16 rounded-xs" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed back={false} title="What this is could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          {view.data.length === 0 ? (
            <p data-state="empty" className="rounded-xs border border-dashed border-border-strong bg-surface px-4 py-3 text-ink-muted">
              Nothing is said about {name} yet{level === "organisation" ? "" : ", here or above it"}.
            </p>
          ) : (
            <ul aria-label={`What ${name} is`} className="flex flex-col gap-2">
              {view.data.map((entry) =>
                replacing?.key === entry.key ? (
                  <li key={entry.key}>
                    <ContextForm scope={scope} entry={entry} onDone={() => setReplacing(null)} onRefused={setRefused} />
                  </li>
                ) : (
                  <ContextRow key={entry.key} entry={entry} scope={scope} label={keyName(entry.key)} canWrite={canWrite} nameOf={nameOf} onChange={() => setReplacing(entry)} />
                ),
              )}
            </ul>
          )}
        </>
      )}
      {canWrite ? (
        adding ? (
          <ContextForm scope={scope} onDone={() => setAdding(false)} onRefused={setRefused} />
        ) : (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setAdding(true)}>
            Say something about {name}
          </Button>
        )
      ) : (
        <p className="text-sm text-ink-muted">A Builder or above changes what is said here.</p>
      )}

      {level !== "app" && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <h3 className="font-display text-base font-semibold">Said differently beneath it</h3>
          {belowView.kind === "loading" && (
            <Loading label="Loading what lower levels say" className="flex flex-col gap-2">
              <Skeleton className="h-10 rounded-xs" />
            </Loading>
          )}
          {belowView.kind === "failed" && <Failed back={false} title="What lower levels say could not be loaded" reason={belowView.reason} status={belowView.status} onRetry={() => void below.refetch()} />}
          {belowView.kind === "loaded" &&
            (belowView.data.length === 0 ? (
              <p data-state="empty" className="text-sm text-ink-muted">
                Nothing beneath {name} replaces or adds to this.
              </p>
            ) : (
              <ul aria-label={`Said beneath ${name}`} className="flex flex-col gap-1.5">
                {belowView.data.map((entry) => {
                  const replaces = view.kind === "loaded" && view.data.some((x) => x.key === entry.key);
                  return (
                    <li key={`${entry.setAtPath}#${entry.key}`} className="flex flex-col gap-0.5 rounded-xs bg-ground px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{keyName(entry.key)}</span>
                        <Badge tone={replaces ? "info" : "neutral"}>{replaces ? `${nameOf(entry.setAtPath)} replaces it` : `Only for ${nameOf(entry.setAtPath)}`}</Badge>
                      </span>
                      <span className="break-words text-sm text-ink-body">{contextText(entry.value)}</span>
                      {technical && <code className="break-all font-mono text-xs text-ink-muted">{entry.setAtPath}</code>}
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      )}
    </section>
  );
}

function ContextRow({ entry, scope, label, canWrite, nameOf, onChange }: { entry: CascadeValue; scope: string; label: string; canWrite: boolean; nameOf: (path: string) => string; onChange: () => void }) {
  const [remove, removing] = useRemoveCascadeMutation();
  const [problem, setProblem] = useState<string | null>(null);
  const here = entry.setAtPath === scope;
  const replaced = entry.overrides.filter((p) => p !== scope);

  const drop = async () => {
    setProblem(null);
    try {
      await remove({ scope, kind: "context", key: entry.key }).unwrap();
    } catch (e) {
      setProblem(`It was not removed: ${describeError(e as never)} It is still said here.`);
    }
  };

  return (
    <li data-context={entry.key} className="flex flex-col gap-1.5 rounded-xs border border-border-strong bg-surface px-4 py-3">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <Badge tone={here ? "info" : "neutral"}>{here ? "Said here" : `From ${nameOf(entry.setAtPath)}`}</Badge>
      </span>
      <span className="whitespace-pre-line break-words text-ink-body">{contextText(entry.value)}</span>
      <span className="text-xs text-ink-muted">
        {entry.setAt ? `Set ${formatDate(entry.setAt)}` : "Set"}
        {here && replaced.length > 0 ? ` · Replaces what ${replaced.map(nameOf).join(" and ")} says` : ""}
      </span>
      {canWrite && (
        <span className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={onChange}>
            {here ? "Change" : "Say it differently here"}
          </Button>
          {here && (
            <Button size="sm" variant="ghost" disabled={removing.isLoading} onClick={() => void drop()}>
              {replaced.length > 0 ? `Remove it; ${nameOf(replaced[0] ?? "")}'s applies again` : "Remove it"}
            </Button>
          )}
        </span>
      )}
      {problem && <Outcome ok={false}>{problem}</Outcome>}
    </li>
  );
}

function ContextForm({ scope, entry, onDone, onRefused }: { scope: string; entry?: CascadeValue; onDone: () => void; onRefused: (reason: string | null) => void }) {
  const [save, saving] = useSetCascadeMutation();
  const [label, setLabel] = useState(entry ? contextLabel(entry.key) : "");
  const [text, setText] = useState(entry ? contextText(entry.value) : "");
  const ids = { label: useId(), text: useId() };
  const key = entry?.key ?? contextKeyFrom(label);
  const keyProblem = !entry && label.trim() && !isContextKey(key) ? "Name it with letters or digits." : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isContextKey(key) || !text.trim() || text.length > VALUE_LIMIT) return;
    onRefused(null);
    onDone(); // Optimistic: the entry shows at once, and goes back if it is refused.
    try {
      await save({ scope, kind: "context", key, value: text.trim() }).unwrap();
    } catch (e) {
      onRefused(`${contextLabel(key)} was not saved: ${describeError(e as never)} What was said before is back.`);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label={entry ? `Change ${contextLabel(entry.key)}` : "Say something about this level"} className="flex flex-col gap-2.5 rounded-xs border border-primary bg-primary-tint p-4" noValidate>
      {entry ? (
        <p className="font-semibold">{contextLabel(entry.key)}</p>
      ) : (
        <Field id={ids.label} label="What it is about" hint="For example: Purpose, Audience, House style." problem={keyProblem}>
          <Input id={ids.label} value={label} onChange={(e) => setLabel(e.target.value)} aria-describedby={`${ids.label}-hint`} />
        </Field>
      )}
      <Field id={ids.text} label="What it says" problem={text.length > VALUE_LIMIT ? `At most ${VALUE_LIMIT} characters.` : null}>
        <Textarea id={ids.text} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <span className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!isContextKey(key) || !text.trim() || text.length > VALUE_LIMIT || saving.isLoading}>
          {entry ? "Save it" : "Add it"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </span>
    </form>
  );
}
