import { useId, useState, type FormEvent } from "react";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatCredits, formatDate, formatNumber } from "@/lib/format";
import { describeError, viewOf } from "@/lib/queryState";
import { useGetTopUpRequestsQuery, useGetTreeQuery, useRequestTopUpMutation, useSetOverdraftMutation } from "@/store/api";
import type { Credits, TopUpRequest } from "@/store/types";
import { placements } from "../workforce/workforceModel";
import { parseCredits } from "./creditsModel";

/**
 * The Owner's own overdraft limit: how far below zero the organisation may go. Never deeper than
 * FrostAura allows — the form says so, checks it, and the control plane refuses it too.
 */
export function OwnLimit({ organisation, credits, isOwner }: { organisation: string; credits: Credits; isOwner: boolean }) {
  const [setOverdraft, saving] = useSetOverdraftMutation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(credits.overdraft?.ownLimit ?? credits.overdraft?.frostauraLimit ?? 0));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = useId();
  const deepest = credits.overdraft?.frostauraLimit ?? 0;
  const n = parseCredits(value);
  const tooDeep = n !== null && n > deepest;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (n === null || tooDeep) return;
    setProblem(null);
    setSaved(false);
    try {
      await setOverdraft({ organisation, scope: organisation, credits: n }).unwrap();
      setSaved(true);
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
          Your own limit is saved.
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
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Not now
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
          Change your limit
        </Button>
      )}
    </div>
  );
}

/** A narrower overdraft for one division, project or app (Admin): it may stop sooner, never go deeper. */
export function NarrowerLimit({ organisation, credits }: { organisation: string; credits: Credits }) {
  const tree = useGetTreeQuery(undefined);
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
      <Button type="submit" size="sm" variant="outline" className="self-start" disabled={n === null || tooDeep || saving.isLoading}>
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

const STATUS: Record<TopUpRequest["status"], { label: string; tone: "primary" | "success" | "quiet" }> = {
  open: { label: "Waiting for FrostAura", tone: "primary" },
  fulfilled: { label: "Added", tone: "success" },
  declined: { label: "Declined", tone: "quiet" },
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
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Not now
              </Button>
            </div>
            {openCount >= 5 && <p className="text-sm text-ink-muted">Five requests are already waiting; FrostAura answers those first.</p>}
          </form>
        ) : (
          <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
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
          {view.kind === "failed" && <Failed title="Your top-up requests could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />}
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
