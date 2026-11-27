import { useState, type FormEvent } from "react";
import { TAP } from "@/lib/touch";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmCard } from "@/components/ui/confirm";
import { LINK } from "@/components/ui/layout";
import { Cell, Table, TableRow, type Column } from "@/components/ui/table";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatCredits, formatDate, formatNumber, plural } from "@/lib/format";
import { PageHeader, SECTION, useShowAll } from "@/components/ui/page";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { navigate, paths, useLocation } from "@/lib/router";
import { cn } from "@/lib/utils";
import { effectiveRole, roleRank } from "@/lib/roles";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { useGetEmployeesQuery, useGetEmployeesWithReleasedQuery, useGetHiresQuery, useGetMeQuery, useGetRecurringRolesQuery, useProposeHireMutation } from "@/store/api";
import type { Employee, Hire, RecurringRole, Tree } from "@/store/types";
import { AppShell } from "../shell/AppShell";
import { JobFields, type JobDraft } from "./JobFields";
import { GROWING } from "./layout";
import { STATUS as EMPLOYEE_STATUS, TRIGGER, draftProblem, expectedMonthly, hireBadge, nameWithRole, possibleManagers, scopeName, waitingProposal } from "./workforceModel";

/** Hiring at a scope: the proposals waiting and decided, and contractor roles that keep coming back. */
export function HiresView() {
  const { search } = useLocation();
  const active = useActiveOrganisation();
  const me = useGetMeQuery(undefined);
  const tree = useActiveTree();
  const org = tree.data?.organisation;
  const scope = search.get("scope") ?? org?.slug ?? active.organisation?.slug ?? "";
  const name = scopeName(tree.data, scope);
  const isAdmin = roleRank(effectiveRole(tree.data, me.data, scope)) >= roleRank("admin");
  const home = active.entered && org ? paths.homeOf(org.slug) : paths.home();
  const [raising, setRaising] = useState(false);
  return (
    <AppShell
      crumbs={[...(org ? [{ label: org.name, href: home }] : []), ...(org && scope !== org.slug ? [{ label: name, href: paths.manage(scope) }] : []), { label: "Hiring" }]}
      aside={
        scope ? (
          <>
            <ErrorBoundary name="Recurring roles">
              <RecurringRoles scope={scope} tree={tree.data} isAdmin={isAdmin} />
            </ErrorBoundary>
            <ErrorBoundary name="People let go">
              <LetGo scope={scope} tree={tree.data} />
            </ErrorBoundary>
          </>
        ) : undefined
      }
    >
      <PageHeader
        className={RISE}
        title={`Hiring for ${name}`}
        lead="Hires are proposed when the organisation needs someone: a new division, a project reaching a new stage, or a job that keeps coming back. In auto-mode one that fits the budget is taken on at once; otherwise it waits for you here."
        actions={
          scope && isAdmin && !raising ? (
            <Button variant="secondary" onClick={() => setRaising(true)}>
              Ask for a hire
            </Button>
          ) : undefined
        }
      />
      {!scope && tree.isLoading && (
        <Loading label="Loading hiring" className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-md" />
        </Loading>
      )}
      {scope && isAdmin && raising && (
        <ErrorBoundary name="Asking for a hire">
          <RaiseHire scope={scope} name={name} tree={tree.data} onClose={() => setRaising(false)} />
        </ErrorBoundary>
      )}
      {scope && (
        <ErrorBoundary name="The hire proposals">
          <Proposals scope={scope} tree={tree.data} />
        </ErrorBoundary>
      )}
    </AppShell>
  );
}


function Proposals({ scope, tree }: { scope: string; tree: Tree | undefined }) {
  const query = useGetHiresQuery({ scope });
  const view = viewOf(query);
  if (view.kind === "loading")
    return (
      <Loading label="Loading the hire proposals" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-32 rounded-md" />
        <Skeleton className="h-32 rounded-md" />
      </Loading>
    );
  if (view.kind === "failed") return <Failed title="The hire proposals could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />;
  const open = view.data.filter((h) => h.status === "proposed");
  const decided = view.data.filter((h) => h.status !== "proposed").sort((x, y) => (y.decision?.at ?? y.createdAt).localeCompare(x.decision?.at ?? x.createdAt));
  return (
    <>
      {view.stale && <Stale reason={view.stale.reason} />}
      {view.data.length === 0 ? (
        <Empty icon="employee" title="No hires have been proposed here">
          When the work here needs someone, a hire is proposed with its job description and what it would cost a month.
        </Empty>
      ) : (
        <>
          <section aria-label="Waiting for you" className={cn("flex flex-col gap-3", RISE, stagger(1))}>
            <h2 className={SECTION}>
              Waiting for you{open.length > 0 && <span className="ml-2 font-sans text-base font-normal tabular-nums text-ink-muted">{formatNumber(open.length)}</span>}
            </h2>
            {open.length === 0 ? (
              <p data-state="empty" className="text-ink-muted">
                Nothing is waiting. Every proposal here has been decided.
              </p>
            ) : (
              <HireRows label="Proposals waiting for you" hires={open} tree={tree} />
            )}
          </section>
          {decided.length > 0 && (
            <section aria-label="Decided" className={cn("flex flex-col gap-3", RISE, stagger(2))}>
              <h2 className={SECTION}>
                Decided<span className="ml-2 font-sans text-base font-normal tabular-nums text-ink-muted">{formatNumber(decided.length)}</span>
              </h2>
              <HireRows label="Proposals decided" hires={decided} tree={tree} />
            </section>
          )}
        </>
      )}
    </>
  );
}

/** The columns of a list of proposals: who and where takes the room, then its cost and its state. */
const HIRE_COLUMNS: Column[] = [
  { key: "hire", header: "Proposal", kind: "grow" },
  { key: "cost", header: "What it costs", kind: "text" },
  { key: "state", header: "State", kind: "status" },
];

/**
 * Proposals as one table (the shared {@link Table}, real-stack 43, console-desktop 48): who and where, why and
 * when; what it would cost; its state. Cards where it is narrow, so an odd number never leaves an orphan; each
 * row opens its proposal; the newest ten, then "Show all".
 */
function HireRows({ label, hires, tree }: { label: string; hires: Hire[]; tree: Tree | undefined }) {
  const list = useShowAll(hires, 10, "proposals");
  return (
    <>
      <Table label={label} columns={HIRE_COLUMNS} at="medium">
        {list.shown.map((h) => (
          <HireRow key={h.id} hire={h} tree={tree} />
        ))}
      </Table>
      {list.control}
    </>
  );
}

function HireRow({ hire, tree }: { hire: Hire; tree: Tree | undefined }) {
  const waiting = hire.status === "proposed" && !hire.withdrawn;
  const badge = waiting ? { label: "Waiting for you", tone: "warn" as const } : hireBadge(hire);
  return (
    // The whole row opens the proposal: its title's link covers the row.
    <TableRow className="relative transition-colors hover:bg-ground">
      <Cell col="hire" primary>
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link href={paths.hire(hire.id)} className="font-semibold text-ink after:absolute after:inset-0">
            {nameWithRole(hire.name, hire.role)} for {scopeName(tree, hire.scope)}
          </Link>
          <span className="text-sm text-ink-muted">
            {TRIGGER[hire.trigger]} · <span className="whitespace-nowrap">{formatDate(hire.createdAt)}</span>
          </span>
          {hire.withdrawn && hire.decision?.note && <span className="text-sm text-ink-body">{hire.decision.note}</span>}
        </span>
      </Cell>
      <Cell col="cost">
        <span className="flex flex-col gap-0.5 text-sm">
          <span className="text-ink-body">About {formatCredits(expectedMonthly(hire))} a month</span>
          {!hire.withinBudget && waiting && <span className="text-attention-text">More than the budget has room for</span>}
        </span>
      </Cell>
      <Cell col="state">
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </Cell>
    </TableRow>
  );
}

function RecurringRoles({ scope, tree, isAdmin }: { scope: string; tree: Tree | undefined; isAdmin: boolean }) {
  const hires = useGetHiresQuery({ scope });
  const query = useGetRecurringRolesQuery(scope);
  const view = viewOf(query);
  return (
    <section aria-labelledby="recurring-title" className="flex flex-col gap-3">
      <h2 id="recurring-title" className="text-base font-semibold">
        Contractor roles that keep coming back
      </h2>
      <p className="text-ink-body">A role briefed again and again is cheaper and better as a permanent hire, with a memory of its own.</p>
      {view.kind === "loading" && (
        <Loading label="Loading recurring roles" className="flex flex-col gap-2">
          <Skeleton className="h-20 rounded-xs" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="Recurring roles could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" &&
        (view.data.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            No contractor role recurs here yet.
          </p>
        ) : (
          <ul aria-label="Recurring roles" className="flex flex-col gap-2.5">
            {view.data.map((r) => (
              <RecurringRow key={`${r.scope}-${r.role}`} role={r} tree={tree} isAdmin={isAdmin} waiting={waitingProposal(hires.data, r)} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function RecurringRow({ role, tree, isAdmin, waiting }: { role: RecurringRole; tree: Tree | undefined; isAdmin: boolean; waiting: Hire | null }) {
  const [propose, state] = useProposeHireMutation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const monthly = Math.max(1, Math.round((role.costCredits / Math.max(1, role.windowDays)) * 30));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Give the new employee a name.");
    setError(null);
    try {
      const hire = await propose({
        scope: role.scope,
        name: name.trim(),
        role: role.role,
        reason: `${role.role} was briefed ${plural(role.contractors, "time")} in ${plural(role.windowDays, "day")} with nobody in the role.`,
        jobDescription: { mandate: role.lastBrief },
        expectedMonthlyCredits: monthly,
        trigger: "promotion",
        // The control plane makes the need's key from the role and the place, the same as when it raises it itself.
        contractorRole: role.role,
      }).unwrap();
      navigate(paths.hire(hire.id));
    } catch (e) {
      setError(`The hire was not proposed: ${describeError(e as never)}`);
    }
  };

  return (
    <li className="flex flex-col gap-1.5 rounded-xs border bg-surface px-4 py-3.5">
      <span className="font-semibold">{role.role}</span>
      <span className="text-ink-body">
        Briefed {plural(role.contractors, "time")} in {plural(role.windowDays, "day")} at {scopeName(tree, role.scope)}, costing {formatCredits(role.costCredits)}.
      </span>
      {role.lastBrief && <span className="text-sm text-ink-muted">Last brief: {role.lastBrief}</span>}
      {waiting ? (
        <Link href={paths.hire(waiting.id)} className={cn(LINK, "self-start", TAP)}>
          Already proposed — open it
        </Link>
      ) : open ? (
        <ConfirmCard
          label={`Propose ${role.role} as a hire`}
          question={`Propose ${role.role} as a permanent hire?`}
          confirm="Propose the hire"
          cancel="Cancel"
          destructive={false}
          busy={state.isLoading}
          onSubmit={(e) => void submit(e)}
          onCancel={() => setOpen(false)}
        >
          <Field id={`name-${role.role}`} label="Name the new employee" hint={`Expected about ${formatCredits(monthly)} a month, from what the contractors cost.`}>
            <Input id={`name-${role.role}`} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={`name-${role.role}-hint`} />
          </Field>
        </ConfirmCard>
      ) : isAdmin ? (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
          Propose as a permanent hire
        </Button>
      ) : (
        <span className="text-sm text-ink-muted">An Admin or the Owner proposes it as a hire.</span>
      )}
      {error && (
        <p role="alert" className="text-sm text-attention-text">
          {error}
        </p>
      )}
    </li>
  );
}

const EMPTY: JobDraft = { name: "", role: "", mandate: "", tools: [], services: [], modelTier: "", reportsTo: "", budget: "" };

/**
 * Asking for a hire of your own choosing (HIRE-09): the job, what it should cost a month and why. It
 * is treated like any other proposal: in auto-mode, one inside the budget is hired at once.
 */
function RaiseHire({ scope, name, tree, onClose }: { scope: string; name: string; tree: Tree | undefined; onClose: () => void }) {
  const [propose, state] = useProposeHireMutation();
  const org = scope.split("/")[0] ?? "";
  const people = useGetEmployeesQuery({ scope: org }, { skip: !org });
  const managers = possibleManagers(people.data ?? [], null);
  const [draft, setDraft] = useState<JobDraft>(EMPTY);
  const [reason, setReason] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const wrong = draftProblem(draft);
    const expected = Number(cost.trim());
    if (wrong) return setError(wrong);
    if (cost.trim() === "" || !Number.isFinite(expected) || expected < 0) return setError("Say what it should cost a month, in credits.");
    if (!reason.trim()) return setError("Say why the hire is needed.");
    setError(null);
    try {
      const budget = draft.budget.trim();
      const hire = await propose({
        scope,
        name: draft.name.trim(),
        role: draft.role.trim(),
        reason: reason.trim(),
        expectedMonthlyCredits: expected,
        trigger: "owner",
        jobDescription: {
          mandate: draft.mandate.trim(),
          tools: draft.tools,
          services: draft.services,
          ...(draft.modelTier ? { modelTier: draft.modelTier } : {}),
          ...(budget ? { monthlyCreditLimit: Number(budget) } : {}),
        },
        ...(draft.reportsTo ? { reportsTo: draft.reportsTo } : {}),
      }).unwrap();
      navigate(paths.hire(hire.id));
    } catch (e) {
      setError(`The hire was not asked for: ${describeError(e as never)}`);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label={`Ask for a hire for ${name}`} className="flex flex-col gap-5 rounded-md border bg-surface p-6 shadow-card max-sm:p-4" noValidate>
      <div className="flex flex-col gap-1">
        <h2 className={SECTION}>A hire for {name}</h2>
        <p className="max-w-prose text-ink-body">Draft the job. It becomes a proposal like any other: in auto-mode, one that fits the budget is hired at once; otherwise it waits for you.</p>
      </div>
      <JobFields draft={draft} onChange={setDraft} managers={managers} tree={tree} />
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
        <Field id="raise-cost" label="What it should cost a month">
          <Input id="raise-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field id="raise-reason" label="Why this hire" className="md:col-span-2">
          <Textarea id="raise-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={GROWING} />
        </Field>
      </div>
      <span className="flex flex-wrap gap-2 border-t pt-4">
        <Button type="submit" disabled={state.isLoading}>
          {state.isLoading ? "Asking…" : "Ask for this hire"}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Not now
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

/** Employees let go here (EMP-09): each opens its record, where it can be rehired, here or somewhere else. */
function LetGo({ scope, tree }: { scope: string; tree: Tree | undefined }) {
  const query = useGetEmployeesWithReleasedQuery(scope);
  const view = viewOf(query);
  const released = view.kind === "loaded" ? view.data.filter((e: Employee) => e.status === "released" && e.kind === "employee") : [];
  return (
    <section aria-labelledby="let-go-title" className="flex flex-col gap-3">
      <h2 id="let-go-title" className="text-base font-semibold">
        People let go
      </h2>
      <p className="text-ink-body">Their memory is kept, so rehiring one is not a cold start.</p>
      {view.kind === "loading" && (
        <Loading label="Loading the people let go" className="flex flex-col gap-2">
          <Skeleton className="h-14 rounded-xs" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The people let go could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && view.stale && <Stale reason={view.stale.reason} />}
      {view.kind === "loaded" &&
        (released.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            No one has been let go here.
          </p>
        ) : (
          <ul aria-label="People let go" className="flex flex-col gap-2">
            {released.map((e) => (
              <li key={e.id}>
                <Link href={paths.employee(e.id)} className="flex flex-col gap-0.5 rounded-xs border border-border-strong bg-surface px-4 py-3 text-ink transition-colors hover:bg-ground">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{e.name}</span>
                    <Badge tone={EMPLOYEE_STATUS.released.tone}>{EMPLOYEE_STATUS.released.label}</Badge>
                  </span>
                  <span className="text-sm text-ink-body">
                    {e.role} · was at {scopeName(tree, e.scope)}
                    {e.releasedAt ? ` · ${formatDate(e.releasedAt)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
