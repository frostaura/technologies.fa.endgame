import { useId, useState, type FormEvent } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { OneTime } from "@/components/OneTime";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatCredits, formatDate, formatNumber, isValidSlug, slugify, timeAgo } from "@/lib/format";
import { RISE } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import {
  useCloseTopUpRequestMutation,
  useEnterOrganisationMutation,
  useGetMeQuery,
  useGetOperatorOrganisationsQuery,
  useGetOperatorTopUpRequestsQuery,
  useGetOperatorTopUpsQuery,
  useGetPricingQuery,
  useSetOperatorOverdraftMutation,
  useSetPricingMutation,
  useTopUpMutation,
} from "@/store/api";
import { provisionOrganisation } from "@/store/sensitive";
import type { OperatorEntry, OperatorOrganisation, OrganisationProvisioned, Pricing, TopUpRequest } from "@/store/types";
import { parseCredits } from "../credits/creditsModel";
import { AppShell } from "../shell/AppShell";
import { pricingRows } from "./operatorModel";

const STANDING: Record<OperatorOrganisation["standing"], { label: string; tone: "success" | "attention-strong" | "attention" }> = {
  "in-credit": { label: "In credit", tone: "success" },
  overdrawn: { label: "Below zero", tone: "attention" },
  "at-limit": { label: "At its limit", tone: "attention-strong" },
};

/**
 * God mode (UC-111), for FrostAura operators only and distinctly marked: every organisation with its
 * balance and standing; provisioning one for an invited Owner; entering one (logged for its Owner);
 * top-ups and the requests for them; each organisation's deepest overdraft; and the prices.
 */
export function OperatorView() {
  const me = useGetMeQuery(undefined);
  const operator = me.data?.isOperator === true;
  return (
    <AppShell crumbs={[{ label: "God mode" }]} aside={operator ? <ProvisionAside /> : undefined}>
      <header className={cn("flex flex-col gap-1.5", RISE)}>
        <h1 className="flex items-center gap-3 text-3xl font-semibold">
          <Icon name="god-mode" tinted className="size-7" />
          God mode
        </h1>
        <p className="max-w-prose text-ink-body">Every organisation on Endgame. Entering one, topping it up or changing its overdraft is written to a log its Owner reads — operator access is never silent.</p>
      </header>
      {me.data && !operator ? (
        <Failed title="God mode is for FrostAura operators" reason="Your account is not one of FrostAura's operators, so these screens are closed to you." />
      ) : operator ? (
        <>
          <ErrorBoundary name="Every organisation">
            <Organisations />
          </ErrorBoundary>
          <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-2">
            <ErrorBoundary name="Top-up requests">
              <Requests />
            </ErrorBoundary>
            <ErrorBoundary name="Top-ups made">
              <TopUps />
            </ErrorBoundary>
          </div>
          <ErrorBoundary name="The prices">
            <PricingPanel />
          </ErrorBoundary>
        </>
      ) : null}
    </AppShell>
  );
}

function Organisations() {
  const query = useGetOperatorOrganisationsQuery(undefined, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const view = viewOf(query);
  return (
    <section aria-labelledby="orgs-title" className="flex flex-col gap-3">
      <h2 id="orgs-title" className="text-lg font-semibold">
        Every organisation
      </h2>
      {view.kind === "loading" && (
        <Loading label="Loading every organisation" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Skeleton className="h-48 rounded-md" />
          <Skeleton className="h-48 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The organisations could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          {view.data.length === 0 ? (
            <Empty icon="organisation" title="No organisations yet">
              Provision the first one for an invited Owner.
            </Empty>
          ) : (
            <ul aria-label="Organisations" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {view.data.map((o) => (
                <OrganisationCard key={o.id} org={o} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function OrganisationCard({ org }: { org: OperatorOrganisation }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [enter, entering] = useEnterOrganisationMutation();
  const [entry, setEntry] = useState<OperatorEntry | null>(null);
  const [action, setAction] = useState<"top-up" | "overdraft" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const standing = STANDING[org.standing];

  const go = async () => {
    setProblem(null);
    try {
      setEntry(await enter(org.slug).unwrap());
    } catch (e) {
      setProblem(`You did not enter ${org.name}: ${describeError(e as never)}`);
    }
  };

  return (
    <li data-org={org.slug} className="flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="break-words font-display text-lg font-semibold">{org.name}</span>
          <span className="text-sm text-ink-muted">
            {org.slug} · since {formatDate(org.createdAt)}
            {org.status !== "active" ? ` · ${org.status}` : ""}
          </span>
          {technical && <code className="break-all font-mono text-xs text-ink-muted">{org.id}</code>}
        </div>
        <Badge tone={standing.tone}>{standing.label}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Figure label="Balance" value={formatNumber(org.balance)} />
        <Figure label="Overdraft allowed" value={`${formatNumber(org.overdraft.effective)} below zero`} note={org.overdraft.ownLimit !== null ? `Their own: ${formatNumber(org.overdraft.ownLimit)}; yours: ${formatNumber(org.overdraft.frostauraLimit)}` : `Set by you: ${formatNumber(org.overdraft.frostauraLimit)}`} />
        <Figure label="Apps" value={formatNumber(org.apps)} />
        <Figure label="Last active" value={org.lastActivityAt ? timeAgo(org.lastActivityAt) : "Never"} />
      </dl>
      {org.openTopUpRequests > 0 && (
        <p className="flex items-center gap-2 text-attention-text">
          <Icon name="credits" className="size-4" />
          {org.openTopUpRequests === 1 ? "One top-up request is waiting." : `${org.openTopUpRequests} top-up requests are waiting.`}
        </p>
      )}
      {entry ? (
        <div role="status" className="flex flex-col gap-2 rounded-sm border border-attention-line bg-attention-wash px-4 py-3">
          <p className="font-semibold">You entered {org.name} as an Admin, {timeAgo(entry.enteredAt)}.</p>
          <p className="text-ink-body">{entry.logged ? `Logged: ${entry.logged}` : "This entry is logged where its Owner can read it."}</p>
          <Link href={paths.homeOf(org.slug)} className={cn(buttonVariants({ size: "sm" }), "self-start")}>
            Open its org chart
          </Link>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Entering is logged where {org.name}&rsquo;s Owner can read it.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {!entry && (
          <Button size="sm" onClick={() => void go()} disabled={entering.isLoading}>
            {entering.isLoading ? "Entering…" : `Enter ${org.name}`}
          </Button>
        )}
        <Button size="sm" variant="outline" aria-expanded={action === "top-up"} onClick={() => setAction(action === "top-up" ? null : "top-up")}>
          Top up
        </Button>
        <Button size="sm" variant="soft" aria-expanded={action === "overdraft"} onClick={() => setAction(action === "overdraft" ? null : "overdraft")}>
          Deepest overdraft
        </Button>
      </div>
      {action === "top-up" && <TopUpForm organisation={org.slug} name={org.name} onDone={() => setAction(null)} />}
      {action === "overdraft" && <OverdraftForm org={org} onDone={() => setAction(null)} />}
      {problem && (
        <p role="alert" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {problem}
        </p>
      )}
    </li>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="m-0 font-semibold">{value}</dd>
      {note && <dd className="m-0 text-xs text-ink-muted">{note}</dd>}
    </div>
  );
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** A top-up, optionally answering a request. The key is made once per form, so a double press adds once. */
function TopUpForm({ organisation, name, request, onDone }: { organisation: string; name: string; request?: TopUpRequest; onDone: () => void }) {
  const [topUp, sending] = useTopUpMutation();
  const ids = { credits: useId(), note: useId() };
  const [key] = useState(newKey);
  const [amount, setAmount] = useState(request ? String(request.credits) : "");
  const [note, setNote] = useState(request ? `Answering the request of ${formatDate(request.requestedAt)}` : "");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const n = parseCredits(amount);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!n || n <= 0 || !note.trim()) return;
    setResult(null);
    try {
      await topUp({ organisation, credits: n, note: note.trim(), idempotencyKey: key, ...(request ? { requestId: request.id } : {}) }).unwrap();
      setResult({ ok: true, text: `Added ${formatCredits(n)} to ${name}. Its Owner can read that you did.` });
    } catch (e) {
      setResult({ ok: false, text: `Nothing was added: ${describeError(e as never)}` });
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded-xs border border-border-strong p-4" noValidate aria-label={`Top up ${name}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={ids.credits} label="Credits to add" problem={amount.trim() && !n ? "Type a number of credits." : null}>
          <Input id={ids.credits} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id={ids.note} label="Note" hint="Shown to the Owner beside the top-up.">
          <Input id={ids.note} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} aria-describedby={`${ids.note}-hint`} />
        </Field>
      </div>
      <p className="text-sm text-ink-muted">A top-up settles any debt first and restarts everything paused at once.</p>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-success-text" : "rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text"}>
          {result.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!result?.ok && (
          <Button type="submit" size="sm" disabled={!n || !note.trim() || sending.isLoading}>
            {sending.isLoading ? "Adding…" : request ? "Add it and close the request" : "Add the credits"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDone}>
          {result?.ok ? "Done" : "Not now"}
        </Button>
      </div>
    </form>
  );
}

function OverdraftForm({ org, onDone }: { org: OperatorOrganisation; onDone: () => void }) {
  const [setOverdraft, saving] = useSetOperatorOverdraftMutation();
  const id = useId();
  const [value, setValue] = useState(String(org.overdraft.frostauraLimit));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const n = parseCredits(value);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (n === null) return;
    setResult(null);
    try {
      await setOverdraft({ slug: org.slug, credits: n }).unwrap();
      setResult({ ok: true, text: `${org.name} may now go ${formatNumber(n)} below zero at most. Its own limit can only be tighter.` });
    } catch (e) {
      setResult({ ok: false, text: `The overdraft was not changed: ${describeError(e as never)} It is back to ${formatNumber(org.overdraft.frostauraLimit)}.` });
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded-xs border border-border-strong p-4" noValidate aria-label={`Deepest overdraft for ${org.name}`}>
      <Field id={id} label="The most it may go below zero" hint="No interest and no fees, ever. At the limit its employees stop and its apps pause; nothing is deleted." problem={value.trim() && n === null ? "Type a number of credits." : null}>
        <Input id={id} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={`${id}-hint`} />
      </Field>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-success-text" : "rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text"}>
          {result.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={n === null || saving.isLoading}>
          {saving.isLoading ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {result?.ok ? "Done" : "Not now"}
        </Button>
      </div>
    </form>
  );
}

function Requests() {
  const query = useGetOperatorTopUpRequestsQuery(undefined, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const view = viewOf(query);
  const open = view.kind === "loaded" ? view.data.filter((r) => r.status === "open") : [];
  const closed = view.kind === "loaded" ? view.data.filter((r) => r.status !== "open") : [];
  return (
    <section aria-labelledby="requests-title" className="flex flex-col gap-3">
      <h2 id="requests-title" className="text-lg font-semibold">
        Top-up requests
      </h2>
      {view.kind === "loading" && (
        <Loading label="Loading the top-up requests" className="flex flex-col gap-2">
          <Skeleton className="h-20 rounded-sm" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The top-up requests could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          {open.length === 0 ? (
            <Empty icon="credits" title="No request is waiting" className="p-5">
              When an Owner asks for credits, it appears here to answer.
            </Empty>
          ) : (
            <ul aria-label="Waiting requests" className="flex flex-col gap-3">
              {open.map((r) => (
                <RequestRow key={r.id} request={r} />
              ))}
            </ul>
          )}
          {closed.length > 0 && (
            <details className="rounded-md border bg-surface px-5 py-3">
              <summary className="min-h-touch cursor-pointer py-2 font-medium">Answered ({closed.length})</summary>
              <ul aria-label="Answered requests" className="flex flex-col divide-y">
                {closed.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span>
                      {r.organisationName || r.organisation} · {formatCredits(r.credits)}
                    </span>
                    <Badge tone={r.status === "fulfilled" ? "success" : "quiet"}>{r.status === "fulfilled" ? "Added" : "Declined"}</Badge>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function RequestRow({ request }: { request: TopUpRequest }) {
  const [mode, setMode] = useState<"fulfil" | "decline" | null>(null);
  const [close, closing] = useCloseTopUpRequestMutation();
  const [why, setWhy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const whyId = useId();
  const decline = async () => {
    setProblem(null);
    try {
      await close({ id: request.id, status: "declined", ...(why.trim() ? { note: why.trim() } : {}) }).unwrap();
    } catch (e) {
      setProblem(`The request is still open: ${describeError(e as never)}`);
    }
  };
  return (
    <li data-request={request.id} className="flex flex-col gap-2 rounded-md border border-attention-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {request.organisationName || request.organisation} asks for {formatCredits(request.credits)}
        </span>
        <span className="text-sm text-ink-muted">{timeAgo(request.requestedAt)}</span>
      </div>
      {request.note && <p className="break-words text-ink-body">{request.note}</p>}
      {request.requestedByEmail && <span className="break-all text-sm text-ink-muted">From {request.requestedByEmail}</span>}
      {mode === "fulfil" ? (
        <TopUpForm organisation={request.organisation} name={request.organisationName || request.organisation} request={request} onDone={() => setMode(null)} />
      ) : mode === "decline" ? (
        <div className="flex flex-col gap-2 rounded-xs border border-border-strong p-4">
          <Field id={whyId} label="Why (the Owner reads this)">
            <Textarea id={whyId} rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void decline()} disabled={closing.isLoading}>
              Decline it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
              Not now
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode("fulfil")}>
            Add the credits
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("decline")}>
            Decline
          </Button>
        </div>
      )}
      {problem && (
        <p role="alert" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {problem}
        </p>
      )}
    </li>
  );
}

function TopUps() {
  const query = useGetOperatorTopUpsQuery(undefined);
  const view = viewOf(query);
  return (
    <section aria-labelledby="topups-title" className="flex flex-col gap-3">
      <h2 id="topups-title" className="text-lg font-semibold">
        Top-ups made
      </h2>
      {view.kind === "loading" && (
        <Loading label="Loading the top-ups" className="flex flex-col gap-2">
          <Skeleton className="h-12 rounded-sm" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The top-ups could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" &&
        (view.data.length === 0 ? (
          <Empty icon="credits" title="No top-ups yet" className="p-5" />
        ) : (
          <ul aria-label="Top-ups" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
            {view.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3 last:border-b-0">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{t.organisation}</span>
                  <span className="break-words text-sm text-ink-body">{t.note}</span>
                  <span className="break-all text-xs text-ink-muted">
                    {formatDate(t.at)}
                    {t.byEmail ? ` · by ${t.byEmail}` : ""}
                  </span>
                </span>
                <span className="font-semibold text-success-text">+ {formatNumber(t.credits)}</span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function PricingPanel() {
  const query = useGetPricingQuery(undefined);
  const view = viewOf(query);
  return (
    <section aria-labelledby="pricing-title" className="flex flex-col gap-3">
      <h2 id="pricing-title" className="text-lg font-semibold">
        The prices
      </h2>
      <p className="max-w-prose text-ink-body">Credits are priced at what the work costs plus one margin, so every bill can be explained line by line. A change applies everywhere within a minute and is kept in the history below.</p>
      {view.kind === "loading" && (
        <Loading label="Loading the prices" className="flex flex-col gap-2">
          <Skeleton className="h-64 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The prices could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
          {view.stale && <Stale reason={view.stale.reason} className="xl:col-span-3" />}
          <div className="xl:col-span-2">
            <PricingForm key={JSON.stringify(view.data.pricing)} pricing={view.data.pricing} source={view.data.source} updatedAt={view.data.updatedAt} />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-base font-semibold">Changes</h3>
            {view.data.history.length === 0 ? (
              <p data-state="empty" className="text-ink-muted">
                Never changed: the defaults hold.
              </p>
            ) : (
              <ol aria-label="Price changes" className="flex flex-col gap-2">
                {view.data.history.map((h, i) => (
                  <li key={`${h.at}-${i}`} className="flex flex-col gap-1 rounded-xs border border-border-strong px-3 py-2">
                    <span className="text-sm font-medium">
                      {formatDate(h.at)}
                      {h.byEmail ? ` · ${h.byEmail}` : ""}
                    </span>
                    <ul className="flex flex-col text-sm text-ink-body">
                      {pricingRows(h.before, h.after).map((r) => (
                        <li key={r.label}>
                          {r.label}: {r.before} → {r.after}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const FIELDS: { key: string; label: string; hint: string; read: (p: Pricing) => number; write: (p: Pricing, v: number) => Pricing }[] = [
  { key: "creditsPerUsd", label: "Credits per US dollar", hint: "What one dollar of cost is in credits.", read: (p) => p.creditsPerUsd, write: (p, v) => ({ ...p, creditsPerUsd: v }) },
  { key: "margin", label: "Margin", hint: "A factor on every cost: 1.0 is no margin, 1.2 adds a fifth.", read: (p) => p.margin, write: (p, v) => ({ ...p, margin: v }) },
  { key: "awake", label: "Dollars per awake hour", hint: "Hosting: each hour an app is awake.", read: (p) => p.hosting.usdPerAwakeHour, write: (p, v) => ({ ...p, hosting: { ...p.hosting, usdPerAwakeHour: v } }) },
  { key: "memory", label: "Dollars per gigabyte-hour of memory", hint: "Hosting: memory an awake app holds.", read: (p) => p.hosting.usdPerGbHourMemory, write: (p, v) => ({ ...p, hosting: { ...p.hosting, usdPerGbHourMemory: v } }) },
  { key: "storage", label: "Dollars per gigabyte-month stored", hint: "Hosting: each app's data.", read: (p) => p.hosting.usdPerGbMonthStorage, write: (p, v) => ({ ...p, hosting: { ...p.hosting, usdPerGbMonthStorage: v } }) },
  { key: "requests", label: "Dollars per million requests", hint: "Hosting: traffic.", read: (p) => p.hosting.usdPerMillionRequests, write: (p, v) => ({ ...p, hosting: { ...p.hosting, usdPerMillionRequests: v } }) },
  { key: "appModels", label: "Each app's AI allowance, credits a month", hint: "The default cap on an app's own model calls.", read: (p) => p.defaultAppModelMonthlyCredits, write: (p, v) => ({ ...p, defaultAppModelMonthlyCredits: v }) },
];

function PricingForm({ pricing, source, updatedAt }: { pricing: Pricing; source: string; updatedAt: string | null }) {
  const [setPricing, saving] = useSetPricingMutation();
  const base = useId();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, String(f.read(pricing))])));
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const parsed = FIELDS.map((f) => ({ f, n: Number((values[f.key] ?? "").trim()) }));
  const bad = parsed.filter(({ f, n }) => !(values[f.key] ?? "").trim() || !Number.isFinite(n) || n < 0 || (f.key === "margin" && n < 1)).map(({ f }) => f.key);
  const next = parsed.reduce((p, { f, n }) => f.write(p, n), pricing);
  const changed = JSON.stringify(next) !== JSON.stringify(pricing);

  const save = async () => {
    setConfirm(false);
    setResult(null);
    try {
      await setPricing(next).unwrap();
      setResult({ ok: true, text: "The new prices hold from now on, for every organisation." });
    } catch (e) {
      setResult({ ok: false, text: `The prices were not changed: ${describeError(e as never)}` });
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (changed && bad.length === 0) setConfirm(true);
      }}
      className="flex flex-col gap-4 rounded-md border bg-surface p-5 shadow-card"
      noValidate
    >
      <p className="text-sm text-ink-muted">{source === "stored" && updatedAt ? `Last changed ${formatDate(updatedAt)}.` : "These are the defaults; they have never been changed."}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FIELDS.map((f) => (
          <Field key={f.key} id={`${base}-${f.key}`} label={f.label} hint={f.hint} problem={bad.includes(f.key) ? (f.key === "margin" ? "At least 1.0: a margin below one would sell at a loss." : "A number, zero or more.") : null}>
            <Input id={`${base}-${f.key}`} inputMode="decimal" value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} aria-describedby={`${base}-${f.key}-hint`} aria-invalid={bad.includes(f.key)} />
          </Field>
        ))}
      </div>
      {confirm ? (
        <div role="alertdialog" aria-label="Confirm the new prices" className="flex flex-col gap-2 rounded-sm border border-attention-line bg-attention-tint px-4 py-3">
          <p className="font-semibold text-attention-text">Change the prices for every organisation?</p>
          <p className="text-attention-deep">Work already estimated keeps its estimate; new work is priced with these figures. The change is recorded with your name.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void save()}>
              Change the prices
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Keep them as they are
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" className="self-start" disabled={!changed || bad.length > 0 || saving.isLoading}>
          {saving.isLoading ? "Saving…" : "Save the prices"}
        </Button>
      )}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-success-text" : "rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text"}>
          {result.text}
        </p>
      )}
    </form>
  );
}

function ProvisionAside() {
  const dispatch = useAppDispatch();
  const ids = { name: useId(), slug: useId(), email: useId(), owner: useId() };
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [owner, setOwner] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<OrganisationProvisioned | null>(null);
  const shownSlug = slugTouched ? slug : slugify(name);
  const slugOk = isValidSlug(shownSlug);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !slugOk || !emailOk) return;
    setSending(true);
    setProblem(null);
    setMade(null);
    const outcome = await dispatch(provisionOrganisation(name, shownSlug, email, owner));
    setSending(false);
    if (outcome.ok) {
      setMade(outcome.data);
      setName("");
      setSlug("");
      setSlugTouched(false);
      setEmail("");
      setOwner("");
    } else setProblem(`${name.trim() || "The organisation"} was not set up: ${outcome.reason}`);
  };

  return (
    <section aria-labelledby="provision-title" className="flex flex-col gap-3">
      <h2 id="provision-title" className="text-lg font-semibold">
        Set up an organisation
      </h2>
      <p className="text-ink-body">For a person FrostAura has invited. They become its Owner; there is no self-serve sign-up.</p>
      {made &&
        (made.ownerInvitationCode ? (
          <OneTime label="The Owner's invitation code" value={made.ownerInvitationCode} onDone={() => setMade(null)}>
            {made.name} is set up for {made.ownerEmail}. {made.invitationEmailed ? "The code was e-mailed to them too." : "E-mail is not set up here, so give them this code yourself."} They use it to make their passkey
            {made.invitationExpiresAt ? ` before ${formatDate(made.invitationExpiresAt)}` : ""}.{made.nameCheck?.note ? ` ${made.nameCheck.note}` : ""}
          </OneTime>
        ) : (
          <p role="status" className="rounded-sm border border-success-text bg-success-tint px-4 py-3">
            {made.name} is set up. {made.ownerEmail} already has a passkey, so they can sign in as its Owner now.
          </p>
        ))}
      {problem && (
        <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
          {problem}
        </p>
      )}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
        <Field id={ids.name} label="Its name">
          <Input id={ids.name} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id={ids.slug} label="Its address name" hint={shownSlug ? `Its apps live at /${shownSlug}/… and ${shownSlug}.<domain>.` : "Lowercase letters, digits and hyphens."} problem={shownSlug && !slugOk ? "2 to 40 lowercase letters, digits and hyphens." : null}>
          <Input
            id={ids.slug}
            value={shownSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            aria-describedby={`${ids.slug}-hint`}
          />
        </Field>
        <Field id={ids.email} label="The Owner's e-mail" problem={email.trim() && !emailOk ? "That does not look like an e-mail address." : null}>
          <Input id={ids.email} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id={ids.owner} label="The Owner's name" hint="Optional.">
          <Input id={ids.owner} value={owner} onChange={(e) => setOwner(e.target.value)} />
        </Field>
        <p className="text-sm text-ink-muted">Its name is checked against FrostAura&rsquo;s own addresses, and every idea it has is screened against the red lines.</p>
        <Button type="submit" className="self-start" disabled={!name.trim() || !slugOk || !emailOk || sending}>
          {sending ? "Setting it up…" : "Set it up"}
        </Button>
      </form>
    </section>
  );
}
