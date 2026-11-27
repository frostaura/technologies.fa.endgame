import { useId, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { SECTION } from "@/components/ui/page";
import { TAP } from "@/lib/touch";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Failed, Loading, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { formatCredits, plural } from "@/lib/format";
import { describeError, viewOf } from "@/lib/queryState";
import { navigate, paths } from "@/lib/router";
import { useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { useAppDispatch, useAppSelector } from "@/store";
import { api, useGetCascadeQuery, useRemoveCascadeMutation, useRepublishAppMutation, useSetCascadeMutation, useUpdateAppSettingsMutation } from "@/store/api";
import type { AppDetail, CascadeValue, RestoreResult } from "@/store/types";
import { parseCredits } from "../credits/creditsModel";
import { ArchiveNode, DeleteNode, Outcome, RenameNode } from "../tree/NodeControls";
import { isArchived } from "../tree/treeManage";
import { ALLOWANCE_KEY, CAP_KEY, numberOf as number } from "./appModel";
import { useCardNote } from "@/components/cardNote";

type Said = { ok: boolean; text: string };

/**
 * What the app may spend (APP-11, APP-12): its own monthly cap, and its own AI allowance — what the
 * app's own model calls may spend a month. An Admin sets, changes and removes either; removing one
 * says which then applies. Everyone else reads them.
 */
export function AppSpending({ app, isAdmin, nameOf }: { app: AppDetail; isAdmin: boolean; nameOf: (path: string) => string }) {
  const budgets = useGetCascadeQuery({ scope: app.scope, kind: "budget" });
  const settings = useGetCascadeQuery({ scope: app.scope, kind: "setting" });
  const budgetView = viewOf(budgets);
  const settingView = viewOf(settings);
  return (
    <section aria-labelledby="spending-title" className="flex flex-col gap-3">
      <h2 id="spending-title" className={cn(SECTION, "flex items-center gap-2")}>
        <Icon name="credits" tinted />
        What it may spend
      </h2>
      {(budgetView.kind === "loading" || settingView.kind === "loading") && (
        <Loading label="Loading what it may spend" className="flex flex-col gap-2">
          <Skeleton className="h-16 rounded-xs" />
          <Skeleton className="h-16 rounded-xs" />
        </Loading>
      )}
      {budgetView.kind === "failed" && <Failed title="Its cap could not be loaded" reason={budgetView.reason} status={budgetView.status} onRetry={() => void budgets.refetch()} />}
      {settingView.kind === "failed" && <Failed title="Its AI allowance could not be loaded" reason={settingView.reason} status={settingView.status} onRetry={() => void settings.refetch()} />}
      {budgetView.kind === "loaded" && (
        <Limit
          app={app}
          title="Its monthly cap"
          what="All it spends a month, hosting and AI together. Work and visits stop at it until it is raised or the month turns."
          kind="budget"
          valueKey={CAP_KEY}
          entry={budgetView.data.find((v) => v.key === CAP_KEY)}
          isAdmin={isAdmin}
          nameOf={nameOf}
          noneLine="No cap on it or above it: only the organisation's balance and overdraft hold it."
        />
      )}
      {settingView.kind === "loaded" && (
        <Limit
          app={app}
          title="Its AI allowance"
          what="What the app's own AI may spend a month. Once used, its AI answers stop until the month turns; the rest of the app keeps working."
          kind="setting"
          valueKey={ALLOWANCE_KEY}
          entry={settingView.data.find((v) => v.key === ALLOWANCE_KEY)}
          isAdmin={isAdmin}
          nameOf={nameOf}
          noneLine="None is set on it or above it, so FrostAura's standard allowance applies."
        />
      )}
      {!isAdmin && <p className="text-sm text-ink-muted">An Admin or the Owner sets these.</p>}
    </section>
  );
}

function Limit({
  app,
  title,
  what,
  kind,
  valueKey,
  entry,
  isAdmin,
  nameOf,
  noneLine,
}: {
  app: AppDetail;
  title: string;
  what: string;
  kind: "budget" | "setting";
  valueKey: string;
  entry: CascadeValue | undefined;
  isAdmin: boolean;
  nameOf: (path: string) => string;
  noneLine: string;
}) {
  const [save, saving] = useSetCascadeMutation();
  const [remove, removing] = useRemoveCascadeMutation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(entry && number(entry) !== null ? String(number(entry)) : "");
  // One note for this card, replaced by its next action and cleared when another card acts (D37).
  const [note, setNote] = useCardNote<Said | { removed: true }>(`limit:${valueKey}`);
  const result = note && "text" in note ? note : null;
  const removed = note !== null && "removed" in note;
  const setResult = (r: Said | null) => setNote(r);
  const setRemoved = (r: boolean) => setNote(r ? { removed: true } : null);
  const id = useId();
  const n = parseCredits(value);
  const own = entry?.setAtPath === app.scope;
  const amount = number(entry);
  const inherited = entry && !own ? entry : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (n === null) return;
    setResult(null);
    setOpen(false);
    try {
      await save({ scope: app.scope, kind, key: valueKey, value: n }).unwrap();
      setResult({ ok: true, text: `${app.name} may spend ${formatCredits(n)} a month here.` });
    } catch (e) {
      setResult({ ok: false, text: `It was not saved: ${describeError(e as never)} It is as it was.` });
    }
  };

  const drop = async () => {
    setResult(null);
    setRemoved(true);
    try {
      await remove({ scope: app.scope, kind, key: valueKey }).unwrap();
    } catch (e) {
      setResult({ ok: false, text: `It was not removed: ${describeError(e as never)} It is as it was.` });
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-border-strong bg-surface px-4 py-3">
      <span className="font-semibold">{title}</span>
      <span className="text-sm text-ink-body">{what}</span>
      {/* What holds it now: the amount in a figure's weight, where it was set in plain words beside it; none, as a plain sentence. */}
      {amount !== null && (own || inherited) ? (
        <p className="pt-1 text-ink-body" data-testid={`${valueKey}-now`}>
          <span className="font-semibold tabular-nums text-ink">{formatCredits(amount)} a month</span>
          {own ? `, set on ${app.name}` : `, from ${nameOf((inherited as CascadeValue).setAtPath)}`}
        </p>
      ) : (
        <p className="pt-1 text-sm text-ink-body" data-testid={`${valueKey}-now`}>
          {noneLine}
        </p>
      )}
      {removed && !own && (
        <p role="status" className="text-sm text-success-text">
          {app.name} has none of its own now. {inherited && amount !== null ? `${nameOf(inherited.setAtPath)}'s ${formatCredits(amount)} applies.` : noneLine}
        </p>
      )}
      {isAdmin &&
        (open ? (
          <form onSubmit={(e) => void submit(e)} aria-label={`Set ${title.toLowerCase()}`} className="flex flex-col gap-1.5" noValidate>
            <label htmlFor={id} className="font-medium">
              Credits a month
            </label>
            {/* The field and its buttons share one row, centred on the field. */}
            <div className="flex flex-wrap items-center gap-2">
              <Input id={id} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={Boolean(value.trim()) && n === null} aria-describedby={value.trim() && n === null ? `${id}-problem` : undefined} className="w-auto min-w-0 flex-1 basis-24" />
              <Button type="submit" size="sm" disabled={n === null || saving.isLoading}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Not now
              </Button>
            </div>
            {value.trim() && n === null && (
              <span id={`${id}-problem`} role="alert" className="text-sm text-attention-text">
                Type a number of credits.
              </span>
            )}
          </form>
        ) : (
          <span className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" className="text-primary-link" onClick={() => setOpen(true)}>
              {own ? "Change it" : `Set one for ${app.name}`}
            </Button>
            {own && (
              <Button size="sm" variant="ghost" disabled={removing.isLoading} onClick={() => void drop()}>
                Remove it
              </Button>
            )}
          </span>
        ))}
      {result && <Outcome ok={result.ok}>{result.text}</Outcome>}
    </div>
  );
}

/** How long the app waits with no visitors before it sleeps (APP-05), for a Builder. */
export function IdleMinutes({ app, canChange }: { app: AppDetail; canChange: boolean }) {
  const [update, state] = useUpdateAppSettingsMutation();
  const dispatch = useAppDispatch();
  const [value, setValue] = useState(String(app.idleMinutes));
  const [result, setResult] = useCardNote<Said>("idle-minutes");
  const id = useId();
  const n = Number(value.trim());
  const valid = /^\d+$/.test(value.trim()) && n >= 1 && n <= 1440;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || n === app.idleMinutes) return;
    setResult(null);
    const before = app.idleMinutes;
    const undo = dispatch(api.util.updateQueryData("getApp", app.id, (a) => void (a.idleMinutes = n)));
    try {
      await update({ id: app.id, settings: { idleMinutes: n } }).unwrap();
      setResult({ ok: true, text: `It sleeps after ${plural(n, "idle minute")} now.` });
    } catch (e) {
      undo.undo();
      setValue(String(before));
      setResult({ ok: false, text: `It was not changed: ${describeError(e as never)} It still sleeps after ${plural(before, "idle minute")}.` });
    }
  };

  if (!canChange) return <p className="text-sm text-ink-muted">It sleeps after {plural(app.idleMinutes, "idle minute")}. A Builder or above changes it.</p>;
  return (
    // The field and its button share a row; what saving said sits under them, so neither squeezes the label (D34).
    <form onSubmit={(e) => void submit(e)} aria-label="Idle minutes before it sleeps" className="flex flex-col gap-1.5" noValidate>
      <label htmlFor={id} className="font-medium">
        Sleeps after this many idle minutes
      </label>
      {/* "Save" sits on the field's own row, centred on it; the hint and any problem go under both. */}
      <div className="flex items-center gap-2">
        <Input id={id} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={`${id}-hint${value.trim() && !valid ? ` ${id}-problem` : ""}`} aria-invalid={!valid} className="w-auto min-w-0 flex-1" />
        <Button type="submit" size="sm" variant="outline" disabled={!valid || n === app.idleMinutes || state.isLoading}>
          Save
        </Button>
      </div>
      <span id={`${id}-hint`} className="text-sm text-ink-muted">
        From 1 to 1,440 (a day).
      </span>
      {value.trim() && !valid && (
        <span id={`${id}-problem`} role="alert" className="text-sm text-attention-text">
          A whole number of minutes, from 1 to 1,440.
        </span>
      )}
      {result && <Outcome ok={result.ok}>{result.text}</Outcome>}
    </form>
  );
}

/** Rename, archive or delete the app itself (APP-13, APP-14), with the tree's own controls. */
export function AppItself({ app, canChange, isAdmin }: { app: AppDetail; canChange: boolean; isAdmin: boolean }) {
  const active = useActiveOrganisation();
  const tree = undefined;
  const slug = app.scope.split("/").pop() ?? app.scope;
  const archived = isArchived(app);
  const entered = active.entered ? active.organisation?.slug : undefined;
  // A long app name makes long button words ("Archive …", from the tree's own controls): here they wrap inside the card, never past it.
  return (
    <section aria-labelledby="itself-title" className="flex flex-col gap-3 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:py-2 [&_button]:text-left">
      <h2 id="itself-title" className={cn(SECTION, "flex items-center gap-2")}>
        <Icon name="app" tinted />
        The app itself
      </h2>
      {canChange ? (
        <>
          <RenameNode level="app" id={app.id} name={app.name} slug={slug} tree={tree} />
          <ArchiveNode level="app" id={app.id} name={app.name} archived={archived} published={app.version !== null || app.publishedAt !== null} tree={tree} />
        </>
      ) : (
        <p className="text-sm text-ink-muted">A Builder or above renames or archives it.</p>
      )}
      {isAdmin && <DeleteNode level="app" id={app.id} name={app.name} tree={tree} onDeleted={() => navigate(entered ? paths.homeOf(entered) : paths.home())} />}
      <Link href={paths.manage(app.scope, entered)} className={cn("self-start rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover", TAP)}>
        Manage it with the rest of the organisation
      </Link>
    </section>
  );
}

/**
 * Rebuild and restart: builds the newest version again and starts it, after a publish that failed or
 * when the app stopped (a Builder). History and who may open it are unchanged.
 */
export function RebuildAndRestart({ app, onResult }: { app: AppDetail; onResult?: (r: RestoreResult) => void }) {
  const [republish, state] = useRepublishAppMutation();
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setResult(null);
    try {
      const r = await republish(app.id).unwrap();
      onResult?.(r);
      setResult(r.published ? { ok: true, text: `${app.name} is rebuilt and running again.` } : { ok: false, text: `${app.name} could not be rebuilt. ${technical && r.publishError ? r.publishError : "Its last version stays as it is; ask the builder to look."}` });
    } catch (e) {
      setResult({ ok: false, text: `It was not rebuilt: ${describeError(e as never)}` });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" className="self-start" disabled={state.isLoading} onClick={() => void run()}>
        {state.isLoading ? "Rebuilding…" : "Rebuild and restart"}
      </Button>
      {state.isLoading && (
        <p role="status" className="text-sm text-ink-body">
          Building its newest version again, then starting it. It is unavailable for a moment.
        </p>
      )}
      {result && <Outcome ok={result.ok}>{result.text}</Outcome>}
    </div>
  );
}
