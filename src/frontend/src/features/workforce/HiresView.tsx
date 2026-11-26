import { useState, type FormEvent } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCredits, formatDate, plural } from "@/lib/format";
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
import { STATUS as EMPLOYEE_STATUS, TRIGGER, draftProblem, expectedMonthly, nameWithRole, possibleManagers, scopeName } from "./workforceModel";

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
  return (
    <AppShell
      crumbs={[...(org ? [{ label: org.name, href: home }] : []), { label: `Hiring · ${name}` }]}
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
      <div className={cn("flex flex-col gap-2", RISE)}>
        <h1 className="text-3xl font-semibold">Hiring for {name}</h1>
        <p className="max-w-prose text-ink-body">Hires are proposed when the organisation needs someone: a new division, a project reaching a new stage, or a job that keeps coming back. In auto-mode one that fits the budget is taken on at once; otherwise it waits for you here.</p>
      </div>
      {!scope && tree.isLoading && (
        <Loading label="Loading hiring" className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-md" />
        </Loading>
      )}
      {scope && isAdmin && (
        <ErrorBoundary name="Asking for a hire">
          <RaiseHire scope={scope} name={name} />
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

const STATUS = { proposed: { label: "Waiting for you", tone: "violet" }, accepted: { label: "Hired", tone: "success" }, declined: { label: "Declined", tone: "quiet" } } as const;

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
  const decided = view.data.filter((h) => h.status !== "proposed");
  return (
    <>
      {view.stale && <Stale reason={view.stale.reason} />}
      {view.data.length === 0 ? (
        <Empty icon="employee" title="No hires have been proposed here">
          When the work here needs someone, a hire is proposed with its job description and what it would cost a month.
        </Empty>
      ) : (
        <>
          <section aria-label="Waiting for you" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Waiting for you</h2>
            {open.length === 0 ? (
              <p data-state="empty" className="text-ink-muted">
                Nothing is waiting. Every proposal here has been decided.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {open.map((h, i) => (
                  <HireCard key={h.id} hire={h} tree={tree} index={i} />
                ))}
              </ul>
            )}
          </section>
          {decided.length > 0 && (
            <section aria-label="Decided" className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Decided</h2>
              <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {decided.map((h, i) => (
                  <HireCard key={h.id} hire={h} tree={tree} index={i} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function HireCard({ hire, tree, index }: { hire: Hire; tree: Tree | undefined; index: number }) {
  return (
    <li className={cn(RISE, stagger(index))}>
      <Link
        href={paths.hire(hire.id)}
        className="flex h-full flex-col gap-1.5 rounded-md border border-violet-line bg-violet-tint px-5 py-4 text-ink transition duration-200 hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <Badge tone={STATUS[hire.status].tone} className="self-start bg-surface">
          {STATUS[hire.status].label}
        </Badge>
        <span className="text-base font-semibold">
          {nameWithRole(hire.name, hire.role)} for {scopeName(tree, hire.scope)}
        </span>
        <span className="text-violet-deep">
          About {formatCredits(expectedMonthly(hire))} a month{hire.withinBudget ? "" : ", more than the budget has room for"}.
        </span>
        <span className="text-sm text-ink-body">
          {TRIGGER[hire.trigger]} · {formatDate(hire.createdAt)}
        </span>
      </Link>
    </li>
  );
}

function RecurringRoles({ scope, tree, isAdmin }: { scope: string; tree: Tree | undefined; isAdmin: boolean }) {
  const query = useGetRecurringRolesQuery(scope);
  const view = viewOf(query);
  return (
    <section aria-labelledby="recurring-title" className="flex flex-col gap-3">
      <h2 id="recurring-title" className="text-lg font-semibold">
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
              <RecurringRow key={`${r.scope}-${r.role}`} role={r} tree={tree} isAdmin={isAdmin} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function RecurringRow({ role, tree, isAdmin }: { role: RecurringRole; tree: Tree | undefined; isAdmin: boolean }) {
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
    <li className="flex flex-col gap-1.5 rounded-xs border border-dashed border-violet-dash bg-surface px-4 py-3.5">
      <span className="font-semibold">{role.role}</span>
      <span className="text-ink-body">
        Briefed {plural(role.contractors, "time")} in {plural(role.windowDays, "day")} at {scopeName(tree, role.scope)}, costing {formatCredits(role.costCredits)}.
      </span>
      {role.lastBrief && <span className="text-sm text-ink-muted">Last brief: {role.lastBrief}</span>}
      {open ? (
        <form onSubmit={(e) => void submit(e)} aria-label={`Propose ${role.role} as a hire`} className="flex flex-col gap-2 pt-1">
          <label htmlFor={`name-${role.role}`} className="text-sm font-medium">
            Name the new employee
          </label>
          <input id={`name-${role.role}`} value={name} onChange={(e) => setName(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3" />
          <span className="text-sm text-ink-muted">Expected about {formatCredits(monthly)} a month, from what the contractors cost.</span>
          <span className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={state.isLoading}>
              Propose the hire
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </span>
        </form>
      ) : isAdmin ? (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
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
function RaiseHire({ scope, name }: { scope: string; name: string }) {
  const [propose, state] = useProposeHireMutation();
  const org = scope.split("/")[0] ?? "";
  const people = useGetEmployeesQuery({ scope: org }, { skip: !org });
  const managers = possibleManagers(people.data ?? [], null);
  const [open, setOpen] = useState(false);
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

  if (!open) {
    return (
      <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
        Ask for a hire
      </Button>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} aria-label={`Ask for a hire for ${name}`} className="flex flex-col gap-4 rounded-md border border-violet-line bg-surface p-5 shadow-card" noValidate>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">A hire for {name}</h2>
        <p className="text-ink-body">Draft the job. It becomes a proposal like any other: in auto-mode, one that fits the budget is hired at once; otherwise it waits for you.</p>
      </div>
      <JobFields draft={draft} onChange={setDraft} managers={managers} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <span className="flex flex-col gap-1.5">
          <label htmlFor="raise-cost" className="font-medium">
            What it should cost a month
          </label>
          <input id="raise-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3" />
        </span>
      </div>
      <span className="flex flex-col gap-1.5">
        <label htmlFor="raise-reason" className="font-medium">
          Why this hire
        </label>
        <textarea id="raise-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-xs border border-border-strong bg-surface px-3 py-2" />
      </span>
      <span className="flex flex-wrap gap-2">
        <Button type="submit" disabled={state.isLoading}>
          {state.isLoading ? "Asking…" : "Ask for this hire"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
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
      <h2 id="let-go-title" className="text-lg font-semibold">
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
