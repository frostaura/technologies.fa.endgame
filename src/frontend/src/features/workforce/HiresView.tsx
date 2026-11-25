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
import { useGetHiresQuery, useGetRecurringRolesQuery, useGetTreeQuery, useProposeHireMutation } from "@/store/api";
import type { Hire, RecurringRole, Tree } from "@/store/types";
import { AppShell } from "../shell/AppShell";
import { TRIGGER, scopeName } from "./workforceModel";

/** Hiring at a scope: the proposals waiting and decided, and contractor roles that keep coming back. */
export function HiresView() {
  const { search } = useLocation();
  const tree = useGetTreeQuery(undefined);
  const org = tree.data?.organisation;
  const scope = search.get("scope") ?? org?.slug ?? "";
  const name = scopeName(tree.data, scope);
  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), { label: `Hiring · ${name}` }]} aside={scope ? <ErrorBoundary name="Recurring roles"><RecurringRoles scope={scope} tree={tree.data} /></ErrorBoundary> : undefined}>
      <div className={cn("flex flex-col gap-2", RISE)}>
        <h1 className="text-3xl font-semibold">Hiring for {name}</h1>
        <p className="max-w-prose text-ink-body">Hires are proposed when the organisation needs someone: a new division, a project reaching a new stage, or a job that keeps coming back. In auto-mode one that fits the budget is taken on at once; otherwise it waits for you here.</p>
      </div>
      {!scope && tree.isLoading && (
        <Loading label="Loading hiring" className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-md" />
        </Loading>
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
  if (view.kind === "failed") return <Failed title="The hire proposals could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />;
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
          {hire.name}, {hire.role.toLowerCase()} for {scopeName(tree, hire.scope)}
        </span>
        <span className="text-violet-deep">
          About {formatCredits(hire.expectedMonthlyCredits)} a month{hire.withinBudget ? "" : ", more than the budget has room for"}.
        </span>
        <span className="text-sm text-ink-body">
          {TRIGGER[hire.trigger]} · {formatDate(hire.createdAt)}
        </span>
      </Link>
    </li>
  );
}

function RecurringRoles({ scope, tree }: { scope: string; tree: Tree | undefined }) {
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
      {view.kind === "failed" && <Failed title="Recurring roles could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" &&
        (view.data.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            No contractor role recurs here yet.
          </p>
        ) : (
          <ul aria-label="Recurring roles" className="flex flex-col gap-2.5">
            {view.data.map((r) => (
              <RecurringRow key={`${r.scope}-${r.role}`} role={r} tree={tree} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function RecurringRow({ role, tree }: { role: RecurringRole; tree: Tree | undefined }) {
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
        needKey: `promotion:${role.scope}:${role.role}`,
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
      ) : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
          Propose as a permanent hire
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-attention-text">
          {error}
        </p>
      )}
    </li>
  );
}
