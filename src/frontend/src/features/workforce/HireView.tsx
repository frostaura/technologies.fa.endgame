import { useState, type FormEvent, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Link } from "@/components/Link";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { SECTION, SideCard, TITLE } from "@/components/ui/page";
import { Field, Input, Textarea } from "@/components/ui/field";
import { GROWING } from "./layout";
import { ConfirmCard } from "@/components/ui/confirm";
import { Stat } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LINK } from "@/components/ui/layout";
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
import { Fold } from "@/components/Fold";
import { AppShell, type Crumb } from "../shell/AppShell";
import { JobFields } from "./JobFields";
import { TRIGGER, againLine, draftOf, draftProblem, expectedMonthly, hireBadge, holdLine, hireEditFrom, nameWithRole, possibleManagers, scopeName, serviceLabel, tierLabel, toolLabel } from "./workforceModel";

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
    { label: hire ? nameWithRole(hire.name, hire.role).replace(", ", " · ") : "Hire proposal" },
  ];
  return (
    <AppShell crumbs={crumbs} aside={hire ? <CostAside hire={hire} /> : undefined}>
      {view.kind === "loading" && (
        <Loading label="Loading the hire proposal" className="flex flex-col gap-6">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-64 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title={view.status === 404 ? "This hire proposal could not be found" : "The hire proposal could not be loaded"} reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
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
      <section aria-label="The proposed hire" className={cn("flex flex-col gap-3 rounded-lg border bg-surface px-6 py-7 shadow-card sm:px-8", RISE)}>
        <Badge tone={hireBadge(hire).tone} className="self-start">
          {hireBadge(hire).label}
        </Badge>
        <h1 className={cn(TITLE, "max-w-prose")}>{nameWithRole(hire.name, hire.role)}</h1>
        <p className="text-ink-body">
          For {scopeName(tree, hire.scope)} · {TRIGGER[hire.trigger]} · Raised by {hire.raisedBy === "person" ? "a person" : "Endgame"} {formatDate(hire.createdAt)}
        </p>
        {hire.reason && <p className="max-w-prose text-base">{hire.reason}</p>}
      </section>

      {editing ? (
        <EditHire hire={hire} tree={tree} onDone={() => setEditing(false)} onError={setEditError} />
      ) : (
        <Fold title="The drafted job description" summary={`${job.monthlyCreditLimit !== null ? `${formatCredits(job.monthlyCreditLimit)} a month` : "No cap of its own"} · reports to ${hire.reportsTo?.name ?? "you"}`}>
        <section aria-labelledby="jd-title" className={cn("flex flex-col gap-3.5", RISE, stagger(1))}>
          <h2 id="jd-title" className={SECTION}>
            The drafted job description
          </h2>
          {editError && (
            <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
              {editError} The proposal is as it was.
            </p>
          )}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-1 rounded-md border bg-surface px-6 py-5 shadow-card max-sm:px-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-y-3.5">
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
        </Fold>
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
      <dt className="text-ink-muted max-sm:mt-2.5 max-sm:text-sm max-sm:first:mt-0">{label}</dt>
      <dd className="m-0 max-w-prose">{children}</dd>
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
      <div className="flex flex-wrap gap-2 max-sm:flex-col">
        <Button onClick={() => setConfirming("accept")} disabled={state.isLoading} aria-expanded={confirming === "accept"}>
          Hire {hire.name}
        </Button>
        <Button variant="secondary" onClick={onEdit} disabled={state.isLoading}>
          Edit the proposal
        </Button>
        <Button variant="danger-outline" onClick={() => setConfirming("decline")} disabled={state.isLoading} aria-expanded={confirming === "decline"}>
          Decline
        </Button>
      </div>
      {confirming && (
        <ConfirmCard
          label={confirming === "accept" ? "Confirm the hire" : "Confirm declining"}
          question={confirming === "accept" ? `Hire ${hire.name} at about ${formatCredits(expectedMonthly(hire))} a month?` : "Decline this hire? The same need can be raised again later."}
          confirm={confirming === "accept" ? "Yes, hire" : "Yes, decline"}
          cancel="Not now"
          destructive={confirming === "decline"}
          busy={state.isLoading}
          onSubmit={(e) => void submit(e)}
          onCancel={() => setConfirming(null)}
        >
          {confirming === "decline" && hire.holdDays ? <p className="text-sm text-ink-body">{holdLine(hire.holdDays)}</p> : null}
          {confirming === "accept" && !hire.withinBudget && <p className="text-sm text-attention-text">This is more than the budget has room for this month ({formatCredits(hire.headroomCredits)} left).</p>}
          <label htmlFor="hire-note" className="text-sm text-ink-muted">
            A note for the record (optional)
          </label>
          <Input id="hire-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </ConfirmCard>
      )}
    </section>
  );
}

function Decided({ hire }: { hire: Hire }) {
  const d = hire.decision;
  return (
    <section role="status" className="flex flex-col gap-2 rounded-md border bg-surface px-6 py-5">
      {hire.withdrawn ? (
        <>
          <p className="text-base font-semibold">This proposal was withdrawn{d ? ` on ${formatDate(d.at)}` : ""}: nobody needs to answer it.</p>
          {d?.note && <p className="text-ink-body">{d.note}</p>}
        </>
      ) : (
        <>
          <p className="text-base font-semibold">
            {hire.status === "accepted" ? `${hire.name} was hired` : "This hire was declined"}
            {d ? ` ${d.via === "auto-mode" ? "by auto-mode, inside the budget," : `by ${d.by}`} on ${formatDate(d.at)}.` : "."}
          </p>
          {d?.note && <p className="text-ink-body">“{d.note}”</p>}
          {hire.proposedAgainFrom && <p className="text-ink-body">{againLine(hire.proposedAgainFrom)}</p>}
        </>
      )}
      {hire.employeeId && (
        <Link href={paths.employee(hire.employeeId)} className={cn(LINK, "self-start")}>
          See {hire.name}’s record
        </Link>
      )}
    </section>
  );
}

function EditHire({ hire, tree, onDone, onError }: { hire: Hire; tree: Tree | undefined; onDone: () => void; onError: (reason: string | null) => void }) {
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
    // Its own budget caps what it can cost, so an expected cost above the budget is the budget (D24).
    const cap = draft.budget.trim() === "" ? null : Number(draft.budget.trim());
    const expectedMonthlyCredits = cap !== null && cap < expected ? cap : expected;
    // A proposal always says why it is needed: emptying the reason is refused here rather than silently kept.
    if (!reason.trim()) return setError("Say why this hire is needed; a proposal always gives its reason.");
    const change = hireEditFrom(before, draft, { reason: reason.trim(), expectedMonthlyCredits });
    setError(null);
    onError(null);
    const boss = managers.find((m) => m.id === draft.reportsTo);
    // Optimistic beyond what the edit itself patches: what it may use, its thinking power, budget and manager.
    const undo = dispatch(
      api.util.updateQueryData("getHire", hire.id, (h) => {
        h.jobDescription.tools = draft.tools;
        h.jobDescription.services = draft.services;
        if (draft.modelTier) h.jobDescription.modelTier = draft.modelTier;
        h.jobDescription.monthlyCreditLimit = cap;
        h.expectedMonthlyCredits = expectedMonthlyCredits;
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
    <form onSubmit={(e) => void submit(e)} aria-label="Edit the proposal" className="flex flex-col gap-5 rounded-md border bg-surface p-6 shadow-card max-sm:p-4" noValidate>
      <h2 className={SECTION}>Edit the proposal</h2>
      <JobFields draft={draft} onChange={setDraft} managers={managers} tree={tree} allowStandard={!hire.jobDescription.modelTier} />
      <div className="grid grid-cols-1 items-end gap-x-5 gap-y-1.5 md:grid-cols-2">
        <Field id="hire-cost" label="Expected credits a month">
          <Input id="hire-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} aria-describedby="hire-cost-hint" />
        </Field>
        <span id="hire-cost-hint" className="text-sm text-ink-muted md:flex md:min-h-touch md:items-center">
          Its own budget caps what it can cost: an expected cost above the budget is saved as the budget.
        </span>
      </div>
      <Field id="hire-reason" label="Why this hire">
        <Textarea id="hire-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={GROWING} />
      </Field>
      <span className="flex flex-wrap gap-2 border-t pt-4">
        <Button type="submit" disabled={state.isLoading}>
          Save the proposal
        </Button>
        <Button variant="secondary" onClick={onDone}>
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

function CostAside({ hire }: { hire: Hire }) {
  const capped = expectedMonthly(hire) < hire.expectedMonthlyCredits;
  // Only a proposal still waiting is weighed against the budget: a withdrawn, declined or accepted one carries no budget warning.
  const open = hire.status === "proposed" && !hire.withdrawn;
  return (
    <>
      <SideCard label="What it costs" className={RISE}>
        <Stat plain size="lg" label="What it costs" value={formatNumber(expectedMonthly(hire))} caption={capped ? "credits a month, at most" : "credits a month, expected"} />
        {(open || capped) && (
          <div className="flex flex-col gap-1 border-t pt-3">
            {capped && <span className="text-ink-body">Its own budget caps it.</span>}
            {open && (
              <>
                <Badge tone={hire.withinBudget ? "good" : "bad"} className="self-start">
                  {hire.withinBudget ? "Fits the budget" : "More than the budget has room for"}
                </Badge>
                <span className="text-ink-body">{formatCredits(hire.headroomCredits)} of room left this month where it would work.</span>
              </>
            )}
          </div>
        )}
      </SideCard>
      <SideCard>
        <p className="text-ink-body">An employee with nothing to do is flagged and let go, so an idle hire is never paid for. Its memory is kept, so a rehire is not a cold start.</p>
      </SideCard>
    </>
  );
}
