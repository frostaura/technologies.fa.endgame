import { useState, type FormEvent, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCredits, formatDate, formatNumber } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { effectiveRole, roleRank } from "@/lib/roles";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { useAppDispatch, useAppSelector } from "@/store";
import { api, useDecideHireMutation, useEditHireMutation, useGetEmployeesQuery, useGetHireQuery, useGetMeQuery } from "@/store/api";
import type { Hire, Tree } from "@/store/types";
import { AppShell, type Crumb } from "../shell/AppShell";
import { JobFields } from "./JobFields";
import { TRIGGER, draftOf, draftProblem, hireEditFrom, possibleManagers, scopeName, serviceLabel, tierLabel, toolLabel } from "./workforceModel";

/** One hire proposal: the drafted job, what it costs a month, and the owner's call. */
export function HireView({ hireId }: { hireId: string }) {
  const query = useGetHireQuery(hireId);
  const view = viewOf(query);
  const active = useActiveOrganisation();
  const tree = useActiveTree();
  const hire = view.kind === "loaded" ? view.data : null;
  const org = tree.data?.organisation;
  const crumbs: Crumb[] = [
    ...(org ? [{ label: org.name, href: active.entered ? paths.homeOf(org.slug) : paths.home() }, { label: "Hiring", href: paths.hires(hire?.scope ?? org.slug) }] : []),
    { label: hire ? `${hire.name} · ${hire.role}` : "Hire proposal" },
  ];
  return (
    <AppShell crumbs={crumbs} aside={hire ? <CostAside hire={hire} /> : undefined}>
      {view.kind === "loading" && (
        <Loading label="Loading the hire proposal" className="flex flex-col gap-6">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-64 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title={view.status === 404 ? "This hire proposal could not be found" : "The hire proposal could not be loaded"} reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <ErrorBoundary name="The hire proposal">
            <HireBody hire={view.data} tree={tree.data} />
          </ErrorBoundary>
        </>
      )}
    </AppShell>
  );
}

const STATUS = { proposed: { label: "Hire proposed", tone: "violet" }, accepted: { label: "Hired", tone: "success" }, declined: { label: "Declined", tone: "quiet" } } as const;

function HireBody({ hire, tree }: { hire: Hire; tree: Tree | undefined }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const job = hire.jobDescription;
  const me = useGetMeQuery(undefined);
  const admin = roleRank(effectiveRole(tree, me.data, hire.scope)) >= roleRank("admin");
  return (
    <>
      <section className={cn("relative flex flex-col gap-3 overflow-hidden rounded-lg bg-violet px-6 py-7 text-primary-ink sm:px-8", RISE)}>
        <div aria-hidden className="absolute -right-16 -top-28 size-aura animate-drift rounded-full bg-primary opacity-60 blur-aura motion-reduce:animate-none" />
        <Badge tone={STATUS[hire.status].tone} className="relative self-start bg-surface">
          {STATUS[hire.status].label}
        </Badge>
        <h1 className="relative text-3xl font-semibold sm:text-4xl">
          {hire.name}, {hire.role.toLowerCase()}
        </h1>
        <p className="relative text-primary-tint">
          For {scopeName(tree, hire.scope)} · {TRIGGER[hire.trigger]} · Raised by {hire.raisedBy === "person" ? "a person" : "Endgame"} {formatDate(hire.createdAt)}
        </p>
        {hire.reason && <p className="relative max-w-prose text-base">{hire.reason}</p>}
      </section>

      {editing ? (
        <EditHire hire={hire} onDone={() => setEditing(false)} onError={setEditError} />
      ) : (
        <section aria-labelledby="jd-title" className={cn("flex flex-col gap-3.5", RISE, stagger(1))}>
          <h2 id="jd-title" className="text-lg font-semibold">
            The drafted job description
          </h2>
          {editError && (
            <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
              {editError} The proposal is as it was.
            </p>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border bg-surface px-6 py-5 shadow-card sm:grid-cols-4">
            <Row label="Mandate">{job.mandate || "Not written yet"}</Row>
            <Row label="Works at">{scopeName(tree, job.scope || hire.scope)} and everything beneath it</Row>
            <Row label="May use">{job.tools.length > 0 ? job.tools.map((t) => toolLabel(t, mode)).join(", ") : "Nothing beyond reading what it is given"}</Row>
            <Row label="Services">{job.services.length > 0 ? job.services.map((x) => serviceLabel(x, mode)).join(", ") : "None of the platform's services"}</Row>
            <Row label="Budget">{job.monthlyCreditLimit !== null ? `${formatCredits(job.monthlyCreditLimit)} a month` : "No cap of its own; the one above holds"}</Row>
            <Row label="Thinking power">{tierLabel(job.modelTier, mode)}</Row>
            <Row label="Reports to">{hire.reportsTo?.name ?? "Nobody: it answers to you"}</Row>
            {hire.contractorRole && <Row label="Replaces">The recurring contractor role “{hire.contractorRole}”</Row>}
          </dl>
        </section>
      )}

      {decisionError && (
        <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
          {decisionError} The proposal is still waiting for you.
        </p>
      )}
      {hire.status === "proposed" ? (
        admin ? (
          !editing && <Decide hire={hire} onEdit={() => setEditing(true)} onError={setDecisionError} />
        ) : (
          <p className="text-ink-muted">An Admin or the Owner decides on hires.</p>
        )
      ) : (
        <Decided hire={hire} />
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0 sm:col-span-3">{children}</dd>
    </>
  );
}

function Decide({ hire, onEdit, onError }: { hire: Hire; onEdit: () => void; onError: (reason: string | null) => void }) {
  const [decide, state] = useDecideHireMutation();
  const [confirming, setConfirming] = useState<"accept" | "decline" | null>(null);
  const [note, setNote] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirming) return;
    onError(null);
    // Optimistic: the page shows the decision at once; a refusal puts the proposal back, with the reason.
    try {
      await decide({ id: hire.id, decision: confirming, ...(note.trim() ? { note: note.trim() } : {}) }).unwrap();
    } catch (e) {
      onError(`Your decision was not recorded: ${describeError(e as never)}`);
    }
  };

  return (
    <section aria-label="Your decision" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={() => setConfirming("accept")} disabled={state.isLoading} aria-expanded={confirming === "accept"}>
          Hire {hire.name}
        </Button>
        <Button size="lg" variant="outline" onClick={onEdit} disabled={state.isLoading}>
          Edit the proposal
        </Button>
        <Button size="lg" variant="ghost" onClick={() => setConfirming("decline")} disabled={state.isLoading} aria-expanded={confirming === "decline"}>
          Decline
        </Button>
      </div>
      {confirming && (
        <form onSubmit={(e) => void submit(e)} aria-label={confirming === "accept" ? "Confirm the hire" : "Confirm declining"} className={cn("flex max-w-prose flex-col gap-2 rounded-md border p-4", confirming === "accept" ? "border-primary bg-primary-tint" : "border-attention-line bg-attention-tint")}>
          <p className="font-medium">
            {confirming === "accept"
              ? `Hire ${hire.name} at about ${formatCredits(hire.expectedMonthlyCredits)} a month?`
              : "Decline this hire? The same need can be raised again later."}
          </p>
          {confirming === "accept" && !hire.withinBudget && <p className="text-sm text-attention-text">This is more than the budget has room for this month ({formatCredits(hire.headroomCredits)} left).</p>}
          <label htmlFor="hire-note" className="text-sm text-ink-muted">
            A note for the record (optional)
          </label>
          <input id="hire-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3" />
          <span className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant={confirming === "accept" ? "primary" : "outline"} disabled={state.isLoading}>
              {confirming === "accept" ? "Yes, hire" : "Yes, decline"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
              Not now
            </Button>
          </span>
        </form>
      )}
    </section>
  );
}

function Decided({ hire }: { hire: Hire }) {
  const d = hire.decision;
  return (
    <section role="status" className="flex flex-col gap-2 rounded-md border bg-surface px-6 py-5">
      <p className="text-base font-semibold">
        {hire.status === "accepted" ? `${hire.name} was hired` : "This hire was declined"}
        {d ? ` ${d.via === "auto-mode" ? "by auto-mode, inside the budget," : `by ${d.by}`} on ${formatDate(d.at)}.` : "."}
      </p>
      {d?.note && <p className="text-ink-body">“{d.note}”</p>}
      {hire.employeeId && (
        <Link href={paths.employee(hire.employeeId)} className="self-start rounded-xs font-semibold text-primary-link hover:text-primary-hover">
          See {hire.name}’s record
        </Link>
      )}
    </section>
  );
}

function EditHire({ hire, onDone, onError }: { hire: Hire; onDone: () => void; onError: (reason: string | null) => void }) {
  const [edit, state] = useEditHireMutation();
  const dispatch = useAppDispatch();
  const org = hire.scope.split("/")[0] ?? "";
  const people = useGetEmployeesQuery({ scope: org }, { skip: !org });
  const managers = possibleManagers(people.data ?? [], null);
  const before = draftOf(hire, hire.jobDescription);
  const [draft, setDraft] = useState(before);
  const [reason, setReason] = useState(hire.reason);
  const [cost, setCost] = useState(String(hire.expectedMonthlyCredits));
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const expected = Number(cost);
    const wrong = draftProblem(draft);
    if (wrong) return setError(wrong);
    if (!Number.isFinite(expected) || expected < 0) return setError("The monthly cost is a number of credits.");
    // A proposal always says why it is needed: emptying the reason is refused here rather than silently kept.
    if (!reason.trim()) return setError("Say why this hire is needed; a proposal always gives its reason.");
    const change = hireEditFrom(before, draft, { reason: reason.trim(), expectedMonthlyCredits: expected });
    setError(null);
    onError(null);
    const boss = managers.find((m) => m.id === draft.reportsTo);
    // Optimistic beyond what the edit itself patches: what it may use, its thinking power, budget and manager.
    const undo = dispatch(
      api.util.updateQueryData("getHire", hire.id, (h) => {
        h.jobDescription.tools = draft.tools;
        h.jobDescription.services = draft.services;
        if (draft.modelTier) h.jobDescription.modelTier = draft.modelTier;
        h.jobDescription.monthlyCreditLimit = draft.budget.trim() === "" ? null : Number(draft.budget.trim());
        h.reportsTo = boss ? { id: boss.id, name: boss.name } : null;
      }),
    );
    onDone(); // The page shows the edit at once and puts it back if it is refused.
    try {
      await edit({ id: hire.id, edit: change }).unwrap();
    } catch (e) {
      undo.undo();
      onError(`The edit was not saved: ${describeError(e as never)}`);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Edit the proposal" className="flex flex-col gap-4 rounded-md border bg-surface p-5 shadow-card" noValidate>
      <h2 className="text-lg font-semibold">Edit the proposal</h2>
      <JobFields draft={draft} onChange={setDraft} managers={managers} allowStandard={!hire.jobDescription.modelTier} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field id="hire-cost" label="Expected credits a month" value={cost} onChange={setCost} numeric />
      </div>
      <label htmlFor="hire-reason" className="text-sm font-medium">
        Why this hire
      </label>
      <textarea id="hire-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="rounded-xs border border-border-strong bg-surface px-3 py-2" />
      <span className="flex flex-wrap gap-2">
        <Button type="submit" disabled={state.isLoading}>
          Save the proposal
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </span>
      {error && (
        <p role="alert" className="text-sm text-attention-text">
          {error}
        </p>
      )}
    </form>
  );
}

function Field({ id, label, value, onChange, numeric = false }: { id: string; label: string; value: string; onChange: (v: string) => void; numeric?: boolean }) {
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input id={id} value={value} inputMode={numeric ? "numeric" : undefined} onChange={(e) => onChange(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3" />
    </span>
  );
}

function CostAside({ hire }: { hire: Hire }) {
  return (
    <>
      <section className={cn("flex flex-col gap-2", RISE)}>
        <h2 className="text-lg font-semibold">What it costs</h2>
        <span className="font-display text-4xl font-semibold">{formatNumber(hire.expectedMonthlyCredits)}</span>
        <span className="text-ink-body">credits a month, expected</span>
      </section>
      <section className={cn("flex flex-col gap-2 rounded-sm px-4 py-4", hire.withinBudget ? "bg-success-tint" : "bg-attention-tint")}>
        <span className={cn("flex items-center gap-2 font-semibold", hire.withinBudget ? "text-success-text" : "text-attention-text")}>
          <Icon name="credits" />
          {hire.withinBudget ? "Fits the budget" : "More than the budget has room for"}
        </span>
        <span className="text-ink">{formatCredits(hire.headroomCredits)} of room left this month where it would work.</span>
      </section>
      <p className="text-ink-body">An employee with nothing to do is flagged and let go, so an idle hire is never paid for. Its memory is kept, so a rehire is not a cold start.</p>
    </>
  );
}
