import { useId, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, errorStatus, viewOf, type ViewState } from "@/lib/queryState";
import { paths, useLocation } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/store";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { useGetMeQuery, useGetSecretsQuery, useRemoveSecretMutation } from "@/store/api";
import { secretNameProblem, setSecret } from "@/store/sensitive";
import type { SecretList, SecretName, Tree } from "@/store/types";
import { AppShell, type Crumb } from "../shell/AppShell";
import { namesFor } from "../home/treeModel";

/**
 * The secrets that apply at one scope of the tree: their names, the level that set each, and those
 * set beneath it. A value is write-only — typed, sent, and gone; it is never shown or kept.
 */
export function SecretsView() {
  const { search } = useLocation();
  const me = useGetMeQuery(undefined);
  const active = useActiveOrganisation();
  const tree = useActiveTree();
  const scope = search.get("scope") || active.organisation?.slug || "";
  const query = useGetSecretsQuery(scope, { skip: !scope });
  // With no scope named, the organisation's own is used; before one exists there is nothing to show.
  const view: ViewState<SecretList> | "no-organisation" = scope
    ? viewOf(query)
    : me.data
      ? "no-organisation"
      : me.isError
        ? { kind: "failed", reason: describeError(me.error), status: errorStatus(me.error) }
        : { kind: "loading" };
  const names = namesFor(tree.data, scope || null);
  const here = names[names.length - 1] ?? scope;
  const parts = scope.split("/");

  const crumbs: Crumb[] = [...names.map((label, i) => ({ label, href: paths.secrets(parts.slice(0, i + 1).join("/")) })), { label: "Secrets" }];

  return (
    <AppShell crumbs={crumbs} aside={view !== "no-organisation" && view.kind === "loaded" ? <AddSecret scope={scope} where={here} existing={view.data.effective} /> : undefined}>
      <header className={cn("flex flex-col gap-1.5", RISE)}>
        <h1 className="flex items-center gap-3 text-3xl font-semibold">
          <Icon name="secrets" tinted className="size-7" />
          {/* Before an organisation is named there is nothing to name the secrets for. */}
          {here ? `Secrets for ${here}` : "Secrets"}
        </h1>
        <p className="max-w-prose text-ink-body">
          What applies here, and where each was set. A secret set higher up applies beneath unless a lower level sets its own. A value is never shown, not even to you: to change one, replace it.
        </p>
      </header>

      {view === "no-organisation" ? (
        <Empty icon="organisation" title="There are no secrets until your organisation is named">
          <Link href={paths.start()} className="font-semibold text-primary-link">
            Start
          </Link>
        </Empty>
      ) : (
        <>
          {view.kind === "loading" && (
            <Loading label="Loading the secrets" className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 rounded-md" />
              ))}
            </Loading>
          )}
          {view.kind === "failed" && (
            <Failed title={view.status === 403 ? "You cannot see the secrets here" : "The secrets could not be loaded"} reason={view.reason} refused={view.status === 403} onRetry={() => void query.refetch()} />
          )}
          {view.kind === "loaded" && (
            <>
              {view.stale && <Stale reason={view.stale.reason} />}
              <SecretsBody list={view.data} tree={tree.data} where={here} />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

function SecretsBody({ list, tree, where }: { list: SecretList; tree: Tree | undefined; where: string }) {
  const nameOf = (path: string) => namesFor(tree, path).slice(-1)[0] ?? path;
  return (
    <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-3">
      <section aria-label="Secrets that apply here" className={cn("flex flex-col gap-3 2xl:col-span-2", RISE, stagger(1))}>
        <h2 className="font-display text-lg font-semibold">Applies here</h2>
        {list.effective.length === 0 ? (
          <Empty icon="secrets" title={`No secrets apply to ${where}`}>
            Add one, and everything here and beneath it can read it by name.
          </Empty>
        ) : (
          <ul aria-label="Secrets" className="flex flex-col gap-3">
            {list.effective.map((secret) => (
              <SecretRow key={secret.name} secret={secret} scope={list.scope} nameOf={nameOf} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Secrets set beneath" className={cn("flex flex-col gap-3", RISE, stagger(2))}>
        <h2 className="font-display text-lg font-semibold">Set beneath</h2>
        {list.setBelow.length === 0 ? (
          <p data-state="empty" className="rounded-md border border-dashed border-border-strong bg-surface px-5 py-4 text-ink-muted">
            Nothing beneath {where} sets a secret of its own.
          </p>
        ) : (
          <ul aria-label="Set beneath" className="flex flex-col gap-2 rounded-md border bg-surface px-5 py-4 shadow-card">
            {list.setBelow.map((b) => (
              <li key={`${b.setAtPath}#${b.name}`} className="flex flex-wrap items-center justify-between gap-2">
                <code className="break-all font-mono text-sm">{b.name}</code>
                <Link href={paths.secrets(b.setAtPath)} className="rounded-xs text-sm text-primary-link hover:text-primary-hover">
                  {nameOf(b.setAtPath)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SecretRow({ secret, scope, nameOf }: { secret: SecretName; scope: string; nameOf: (path: string) => string }) {
  const [mode, setMode] = useState<"idle" | "replace" | "remove">("idle");
  const [remove, removing] = useRemoveSecretMutation();
  const [problem, setProblem] = useState<string | null>(null);
  const setHere = !secret.inherited;

  const confirmRemove = async () => {
    setMode("idle");
    setProblem(null);
    try {
      await remove({ scope, name: secret.name }).unwrap();
    } catch (e) {
      setProblem(`${secret.name} was not removed: ${describeError(e as never)} It still applies.`);
    }
  };

  return (
    <li className="flex flex-col gap-3 rounded-md border bg-surface px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <code className="break-all font-mono text-base font-semibold">{secret.name}</code>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {setHere ? (
              <Badge tone="primary">Set here</Badge>
            ) : (
              <Badge tone="quiet">
                Inherited from{" "}
                <Link href={paths.secrets(secret.setAtPath)} className="underline">
                  {nameOf(secret.setAtPath)}
                </Link>
              </Badge>
            )}
            <span>
              {secret.setAtLevel.charAt(0).toUpperCase() + secret.setAtLevel.slice(1)} level · set {timeAgo(secret.setAt)}
            </span>
          </div>
          {secret.overrides.length > 0 && <span className="text-sm text-ink-body">Replaces the one set at {secret.overrides.map(nameOf).join(", ")}.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="soft" onClick={() => setMode(mode === "replace" ? "idle" : "replace")} aria-expanded={mode === "replace"}>
            {setHere ? "Replace" : "Set its own here"}
          </Button>
          {setHere && (
            <Button size="sm" variant="ghost" disabled={removing.isLoading} onClick={() => setMode("remove")}>
              Remove
            </Button>
          )}
        </div>
      </div>

      {problem && (
        <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
          {problem}
        </p>
      )}

      {mode === "remove" && (
        <div role="group" aria-label={`Confirm removing ${secret.name}`} className="flex flex-col gap-2 rounded-sm bg-attention-tint px-4 py-3">
          <p className="text-attention-deep">
            {secret.overrides.length > 0
              ? `Remove ${secret.name} here? The one set at ${nameOf(secret.overrides[0] ?? "")} applies again.`
              : `Remove ${secret.name}? Nothing here or beneath will have it, unless it sets its own.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void confirmRemove()}>
              Remove it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      {mode === "replace" && <SecretForm scope={scope} fixedName={secret.name} />}
    </li>
  );
}

function AddSecret({ scope, where, existing }: { scope: string; where: string; existing: SecretName[] }) {
  return (
    <section aria-label="Add a secret" className={cn("flex flex-col gap-3", RISE)}>
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Icon name="secrets" tinted />
        Add a secret
      </h2>
      <p className="text-ink-body">It applies to {where} and everything beneath it. Saving a name that already applies here replaces it.</p>
      <SecretForm scope={scope} existing={existing} />
    </section>
  );
}

/** Name and value. The value lives only in this form until it is sent, and is cleared as it goes. */
function SecretForm({ scope, fixedName, existing = [] }: { scope: string; fixedName?: string; existing?: SecretName[] }) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState(fixedName ?? "");
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const nameId = useId();
  const valueId = useId();
  const nameProblem = fixedName ? null : secretNameProblem(name);
  const replacing = fixedName !== undefined || existing.some((s) => s.name === name && !s.inherited);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (nameProblem || value.length === 0) return;
    const sending = value;
    setValue("");
    setSaving(true);
    setResult(null);
    const outcome = await dispatch(setSecret(scope, name, sending));
    setSaving(false);
    if (outcome.ok) {
      setResult({ ok: true, text: `${name} is saved. Its value is sealed and will not be shown.` });
      if (!fixedName) setName("");
      setTouched(false);
    } else setResult({ ok: false, text: `${name} was not saved: ${outcome.reason} Nothing changed; type the value again to retry.` });
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3">
      {!fixedName && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="font-medium">
            Name
          </label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase().replace(/[\s-]/g, "_"))}
            onBlur={() => setTouched(true)}
            autoComplete="off"
            spellCheck={false}
            placeholder="STRIPE_API_KEY"
            aria-invalid={touched && !!nameProblem}
            aria-describedby={touched && nameProblem ? `${nameId}-problem` : undefined}
            className="min-h-12 rounded-sm border border-border-strong bg-surface px-4 font-mono"
          />
          {touched && nameProblem && (
            <span id={`${nameId}-problem`} className="text-sm text-attention-text">
              {nameProblem}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={valueId} className="font-medium">
          {fixedName ? `New value for ${fixedName}` : "Value"}
        </label>
        <input
          id={valueId}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          className="min-h-12 rounded-sm border border-border-strong bg-surface px-4 font-mono"
        />
        {touched && value.length === 0 && !saving && !result?.ok && <span className="text-sm text-attention-text">Type the value to store.</span>}
      </div>
      <Button type="submit" className="self-start" disabled={saving}>
        {saving ? "Saving…" : replacing ? "Replace the secret" : "Save the secret"}
      </Button>
      {result && (
        <p role={result.ok ? "status" : "alert"} data-state={result.ok ? undefined : "failed"} className={cn("rounded-xs px-4 py-3", result.ok ? "bg-success-tint text-success-text" : "border border-attention-line bg-attention-tint text-attention-text")}>
          {result.text}
        </p>
      )}
    </form>
  );
}
