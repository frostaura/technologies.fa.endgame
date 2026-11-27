import { useId, useState, type FormEvent } from "react";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatCredits, formatDate, formatNumber } from "@/lib/format";
import { describeError, viewOf } from "@/lib/queryState";
import { useActiveTree } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import {
  api,
  useGetTopUpRequestsQuery,
  useRemoveCascadeMutation,
  useRequestTopUpMutation,
  useSetCascadeMutation,
  useSetOverdraftMutation,
  useUpdateEmployeeMutation,
} from "@/store/api";
import type { BudgetLine, Credits, TopUpRequest } from "@/store/types";
import { placements } from "../workforce/workforceModel";
import { capAbove, parseCredits } from "./creditsModel";

/**
 * The Owner's own overdraft limit: how far below zero the organisation may go. Never deeper than
 * FrostAura allows — the form says so, checks it, and the control plane refuses it too.
 */
export function OwnLimit({ organisation, credits, isOwner }: { organisation: string; credits: Credits; isOwner: boolean }) {
  const [setOverdraft, saving] = useSetOverdraftMutation();
  const [removeCascade, removing] = useRemoveCascadeMutation();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(credits.overdraft?.ownLimit ?? credits.overdraft?.frostauraLimit ?? 0));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Optimistic: "Not set" shows at once, and the limit comes back if the control plane refuses.
  const removeOwn = async () => {
    setProblem(null);
    setSaved(null);
    const undo = dispatch(
      api.util.updateQueryData("getCredits", organisation, (c) => {
        if (c.overdraft) c.overdraft.ownLimit = null;
      }),
    );
    try {
      await removeCascade({ scope: organisation, kind: "setting", key: "overdraft_own_limit" }).unwrap();
      setSaved(`Your own limit is removed. The most FrostAura allows, ${formatNumber(credits.overdraft?.frostauraLimit ?? 0)} below zero, applies now.`);
    } catch (e) {
      undo.undo();
      setProblem(`Your limit was not removed: ${describeError(e as never)} It is back to what it was.`);
    }
  };
  const id = useId();
  const deepest = credits.overdraft?.frostauraLimit ?? 0;
  const n = parseCredits(value);
  const tooDeep = n !== null && n > deepest;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (n === null || tooDeep) return;
    setProblem(null);
    setSaved(null);
    try {
      await setOverdraft({ organisation, scope: organisation, credits: n }).unwrap();
      setSaved("Your own limit is saved.");
      setOpen(false);
    } catch (e) {
      setProblem(`Your limit was not changed: ${describeError(e as never)} It is back to what it was.`);
    }
  };

  if (!isOwner) return <p className="text-sm text-ink-muted">Only the Owner sets the organisation&rsquo;s own limit.</p>;
  return (
    <div className="flex flex-col gap-2">
      {saved && (
        <p role="status" className="text-success-text">
          {saved}
        </p>
      )}
      {problem && (
        <p role="alert" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {problem}
        </p>
      )}
      {open ? (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded-xs border border-border-strong p-4" noValidate>
          <Field
            id={id}
            label="How far below zero you may go"
            hint={deepest > 0 ? `FrostAura allows at most ${formatNumber(deepest)} below zero. Yours can be tighter, never deeper.` : "FrostAura allows no overdraft yet, so your own limit can only be 0. Ask FrostAura for more."}
            problem={n === null && value.trim() ? "Type a number of credits." : tooDeep ? `That is deeper than the ${formatNumber(deepest)} FrostAura allows.` : null}
          >
            <Input id={id} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={`${id}-hint`} aria-invalid={tooDeep || (n === null && value.trim() !== "")} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={n === null || tooDeep || saving.isLoading}>
              {saving.isLoading ? "Saving…" : "Save my limit"}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
              Not now
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Change your limit
          </Button>
          {credits.overdraft?.ownLimit !== null && credits.overdraft?.ownLimit !== undefined && (
            <Button variant="quiet" disabled={removing.isLoading} onClick={() => void removeOwn()}>
              Remove your own limit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** The narrower limits already set (Admin): each division, project or app held to less, with who set it. */
export function NarrowerLimits({ credits, organisation }: { credits: Credits; organisation: string }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const limits = credits.overdraft?.limits ?? [];
  const [removeCascade, removing] = useRemoveCascadeMutation();
  const dispatch = useAppDispatch();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const organisationLimit = Math.min(credits.overdraft?.frostauraLimit ?? 0, credits.overdraft?.ownLimit ?? Number.POSITIVE_INFINITY);

  const remove = async (scope: string, name: string) => {
    setResult(null);
    const undo = dispatch(
      api.util.updateQueryData("getCredits", organisation, (c) => {
        if (c.overdraft) c.overdraft.limits = c.overdraft.limits.filter((l) => l.scope !== scope);
      }),
    );
    try {
      await removeCascade({ scope, kind: "setting", key: "overdraft_limit" }).unwrap();
      const above = limits.filter((l) => l.scope !== scope && scope.startsWith(`${l.scope}/`)).sort((a, b) => b.scope.length - a.scope.length)[0];
      setResult({
        ok: true,
        text: above
          ? `${name} is no longer held to less on its own; ${above.name}'s ${formatNumber(above.credits)} below zero applies.`
          : `${name} is no longer held to less; the organisation's ${formatNumber(organisationLimit)} below zero applies.`,
      });
    } catch (e) {
      undo.undo();
      setResult({ ok: false, text: `${name}'s limit was not removed: ${describeError(e as never)} It still stops at its own limit.` });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-display text-base font-semibold">Tighter limits already set</h3>
      {limits.length === 0 ? (
        <p data-state="empty" className="text-sm text-ink-muted">
          No division, project or app is held to less than the organisation.
        </p>
      ) : (
        <ul aria-label="Tighter limits already set" className="flex flex-col divide-y rounded-xs border border-border-strong">
          {limits.map((l) => (
            <li key={l.scope} className="flex flex-col gap-0.5 px-4 py-2.5">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {l.name} <span className="text-sm font-normal text-ink-muted">{l.level}</span>
                </span>
                <span className="font-semibold">{formatNumber(l.credits)} below zero</span>
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                {l.setByName ? `Set by ${l.setByName}, ${formatDate(l.setAt)}` : `Set ${formatDate(l.setAt)}`}
                <Button size="sm" variant="quiet" disabled={removing.isLoading} onClick={() => void remove(l.scope, l.name)} aria-label={`Remove ${l.name}'s tighter limit`}>
                  Remove
                </Button>
              </span>
              {technical && <code className="break-all font-mono text-xs text-ink-muted">{l.scope}</code>}
            </li>
          ))}
        </ul>
      )}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-sm text-success-text" : "rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text"}>
          {result.text}
        </p>
      )}
    </div>
  );
}

/** A narrower overdraft for one division, project or app (Admin): it may stop sooner, never go deeper. */
export function NarrowerLimit({ organisation, credits }: { organisation: string; credits: Credits }) {
  const tree = useActiveTree();
  const nodes = placements(tree.data).filter((p) => p.depth > 0);
  const [setOverdraft, saving] = useSetOverdraftMutation();
  const ids = { node: useId(), value: useId() };
  const [scope, setScope] = useState("");
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = scope || nodes[0]?.scope || "";
  const n = parseCredits(value);
  const deepest = Math.min(credits.overdraft?.frostauraLimit ?? 0, credits.overdraft?.ownLimit ?? Number.POSITIVE_INFINITY);
  const tooDeep = n !== null && n > deepest;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (n === null || tooDeep || !chosen) return;
    setResult(null);
    const name = nodes.find((x) => x.scope === chosen)?.label ?? chosen;
    try {
      await setOverdraft({ organisation, scope: chosen, credits: n }).unwrap();
      setResult({ ok: true, text: `${name} now stops at ${formatNumber(n)} below zero.` });
      setValue("");
    } catch (e) {
      setResult({ ok: false, text: `${name}'s limit was not set: ${describeError(e as never)}` });
    }
  };

  if (nodes.length === 0) return null;
  // With no overdraft allowed at all, every part already stops at zero: there is nothing tighter to set.
  if (deepest <= 0) return <p className="text-sm text-ink-muted">Every part stops at zero while the organisation has no overdraft, so there is nothing tighter to set.</p>;
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate aria-labelledby={`${ids.node}-title`}>
      <h3 id={`${ids.node}-title`} className="font-display text-base font-semibold">
        A tighter limit for one part
      </h3>
      <p className="text-sm text-ink-body">Hold a division, project or app to less, so it stops before the rest of the organisation does.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Field id={ids.node} label="Which part">
          <Select id={ids.node} value={chosen} onChange={(e) => setScope(e.target.value)}>
            {nodes.map((o) => (
              <option key={o.scope} value={o.scope}>
                {" ".repeat(o.depth - 1)}
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={ids.value} label="Below zero, at most" problem={tooDeep ? `No deeper than the organisation's ${formatNumber(deepest)}.` : null}>
          <Input id={ids.value} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={tooDeep} />
        </Field>
      </div>
      <Button type="submit" size="sm" variant="secondary" className="self-start" disabled={n === null || tooDeep || saving.isLoading}>
        {saving.isLoading ? "Saving…" : "Set this limit"}
      </Button>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-success-text" : "rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text"}>
          {result.text}
        </p>
      )}
    </form>
  );
}

const STATUS: Record<TopUpRequest["status"], { label: string; tone: "info" | "good" | "neutral" }> = {
  open: { label: "Waiting for FrostAura", tone: "info" },
  fulfilled: { label: "Added", tone: "good" },
  declined: { label: "Declined", tone: "neutral" },
};

/** Asking FrostAura for a top-up (the Owner), and every request with what became of it. */
export function TopUpRequests({ organisation, isOwner, isAdmin }: { organisation: string; isOwner: boolean; isAdmin: boolean }) {
  const query = useGetTopUpRequestsQuery(organisation, { skip: !isAdmin });
  const view = viewOf(query);
  const [request, sending] = useRequestTopUpMutation();
  const ids = { credits: useId(), note: useId() };
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const n = parseCredits(amount);
  const openCount = view.kind === "loaded" ? view.data.filter((r) => r.status === "open").length : 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!n || n <= 0) return;
    setResult(null);
    try {
      await request({ organisation, credits: n, note: note.trim() }).unwrap();
      setResult({ ok: true, text: `Asked FrostAura for ${formatCredits(n)}. You are told here when it is added.` });
      setAmount("");
      setNote("");
      setOpen(false);
    } catch (e) {
      setResult({ ok: false, text: `The request was not sent: ${describeError(e as never)}` });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-success-text" : "rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text"}>
          {result.text}
        </p>
      )}
      {isOwner &&
        (open ? (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded-xs border border-border-strong p-4" noValidate>
            <Field id={ids.credits} label="How many credits" problem={amount.trim() && !n ? "Type a number of credits." : null}>
              <Input id={ids.credits} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field id={ids.note} label="A note for FrostAura" hint="Optional.">
              <Textarea id={ids.note} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={!n || sending.isLoading || openCount >= 5}>
                {sending.isLoading ? "Sending…" : "Ask for it"}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
                Not now
              </Button>
            </div>
            {openCount >= 5 && <p className="text-sm text-ink-muted">Five requests are already waiting; FrostAura answers those first.</p>}
          </form>
        ) : (
          <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
            Ask for a top-up
          </Button>
        ))}
      {isAdmin && (
        <>
          {view.kind === "loading" && (
            <Loading label="Loading your top-up requests" className="flex flex-col gap-2">
              <Skeleton className="h-12 rounded-xs" />
            </Loading>
          )}
          {view.kind === "failed" && <Failed title="Your top-up requests could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
          {view.kind === "loaded" && (
            <>
              {view.stale && <Stale reason={view.stale.reason} />}
              {view.data.length === 0 ? (
                <p data-state="empty" className="text-ink-muted">
                  No top-up asked for yet.
                </p>
              ) : (
                <ul aria-label="Top-up requests" className="flex flex-col rounded-xs border border-border-strong">
                  {view.data.map((r) => (
                    <li key={r.id} className="flex flex-col gap-1 border-b px-4 py-3 last:border-b-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{formatCredits(r.credits)}</span>
                        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      </div>
                      <span className="text-sm text-ink-muted">
                        Asked {formatDate(r.requestedAt)}
                        {r.closedAt ? `, answered ${formatDate(r.closedAt)}` : ""}
                      </span>
                      {r.note && <span className="break-words text-sm text-ink-body">{r.note}</span>}
                      {r.closeNote && <span className="break-words text-sm text-ink-body">FrostAura: {r.closeNote}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A row's monthly cap (CRED-03, EMP-03), for an Admin: set, change or remove it. A node's cap is a
 * budget on the cascade; an employee's is on its own record and covers the contractors it briefs.
 * The bar moves at once and goes back if the control plane refuses; a removal says what holds instead.
 */
export function CapControl({ line, lines, organisation }: { line: BudgetLine; lines: BudgetLine[]; organisation: string }) {
  const [setCascade, setting] = useSetCascadeMutation();
  const [removeCascade, removing] = useRemoveCascadeMutation();
  const [updateEmployee, updating] = useUpdateEmployeeMutation();
  const dispatch = useAppDispatch();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(line.capCredits !== null ? String(line.capCredits) : "");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const n = parseCredits(value);
  const busy = setting.isLoading || removing.isLoading || updating.isLoading;
  const same = (l: BudgetLine) => l.scope === line.scope && l.level === line.level && l.name === line.name;

  const patch = (cap: number | null) =>
    dispatch(
      api.util.updateQueryData("getCredits", organisation, (c) => {
        const row = c.budgets.find(same);
        if (row) row.capCredits = cap;
      }),
    );

  const write = async (cap: number | null) => {
    if (line.level === "employee") {
      if (!line.employeeId) throw new Error("This employee's record could not be found.");
      await updateEmployee({ id: line.employeeId, patch: cap === null ? { clearMonthlyCreditLimit: true } : { jobDescription: { monthlyCreditLimit: cap } } }).unwrap();
      dispatch(api.util.invalidateTags(["Credits"]));
    } else if (cap === null) await removeCascade({ scope: line.scope, kind: "budget", key: "monthly_credits" }).unwrap();
    else await setCascade({ scope: line.scope, kind: "budget", key: "monthly_credits", value: cap }).unwrap();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (n === null) return;
    setResult(null);
    setOpen(false);
    const undo = patch(n);
    try {
      await write(n);
      setResult({ ok: true, text: `${line.name} may spend ${formatCredits(n)} a month${line.level === "employee" ? ", with the contractors it briefs" : ""}.` });
    } catch (e) {
      undo.undo();
      setResult({ ok: false, text: `The cap was not ${line.capCredits === null ? "set" : "changed"}: ${describeError(e as never)} It is as it was.` });
    }
  };

  const remove = async () => {
    setResult(null);
    setOpen(false);
    const undo = patch(null);
    try {
      await write(null);
      const above = capAbove(lines, { ...line, capCredits: null });
      setResult({
        ok: true,
        text: above
          ? `${line.name} has no cap of its own now; the cap on ${above.name}, ${formatCredits(above.capCredits ?? 0)} a month, holds it.`
          : `${line.name} has no cap of its own now, and nothing above it has one: only the balance and the overdraft limit hold it.`,
      });
    } catch (e) {
      undo.undo();
      setResult({ ok: false, text: `The cap was not removed: ${describeError(e as never)} It is as it was.` });
    }
  };

  // Two cells of the row's grid: the one action, in the trailing column; and, open, the cap's form across the whole row.
  return (
    <>
      <span className="flex justify-end max-sm:col-start-2 max-sm:row-start-1">
        <Button size="sm" variant="quiet" className="text-primary-link max-sm:px-2" disabled={busy} aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`${line.capCredits === null ? "Set a cap on" : "Change the cap on"} ${line.name}`}>
          {line.capCredits === null ? "Set a cap" : "Change the cap"}
        </Button>
      </span>
      {open && (
        <form onSubmit={(e) => void save(e)} aria-label={`Cap for ${line.name}`} className="col-span-full flex flex-wrap items-end gap-2 rounded-xs bg-ground px-4 py-3" noValidate>
          <Field id={id} label="Credits a month" problem={value.trim() && n === null ? "Type a number of credits." : null} className="min-w-0 flex-1 sm:max-w-48 sm:flex-none">
            <Input id={id} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!value.trim() && n === null} />
          </Field>
          <Button type="submit" size="sm" disabled={n === null || busy}>
            Save the cap
          </Button>
          {line.capCredits !== null && (
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => void remove()} aria-label={`Remove the cap on ${line.name}`}>
              Remove the cap
            </Button>
          )}
          <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
            Not now
          </Button>
        </form>
      )}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={cn("col-span-full", result.ok ? "text-sm text-success-text" : "rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text")}>
          {result.text}
        </p>
      )}
    </>
  );
}
