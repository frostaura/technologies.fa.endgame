import { useState, type FormEvent, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { estimateHeadline } from "@/lib/estimates";
import { formatCredits, formatNumber, plural, possessive, timeAgo } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf, type ViewState } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { effectiveRole, roleRank } from "@/lib/roles";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import {
  api,
  useGetEmployeesQuery,
  useGetMeQuery,
  useReassignEmployeeMutation,
  useRehireEmployeeMutation,
  useAddMemoryMutation,
  useCorrectMemoryMutation,
  useEmployeeActionMutation,
  useGetEmployeeQuery,
  useGetMemoryChangesQuery,
  useGetMemoryQuery,
  useGetTasksQuery,
  useRemoveMemoryMutation,
  useReviewMemoryMutation,
  useUpdateEmployeeMutation,
} from "@/store/api";
import type { Employee, EmployeeDetail, MemoryChange, MemoryEntry, MemoryKind, TaskItem, TrackRecord, Tree } from "@/store/types";
import { AppShell, type Crumb } from "../shell/AppShell";
import { ConversationDock } from "../home/ConversationDock";
import { namesFor } from "../home/treeModel";
import { useAppDispatch } from "@/store";
import { JobFields } from "./JobFields";
import {
  MEMORY_KIND,
  MEMORY_KINDS,
  STATUS,
  acceptedLine,
  costLine,
  draftOf,
  draftProblem,
  employeeCosts,
  employeePatchFrom,
  entryOrigin,
  lastReview,
  memoryChangeLine,
  memoryChangeTitle,
  memoryChangeWhy,
  placements,
  possibleManagers,
  scopeName,
  serviceLabel,
  tierLabel,
  toolLabel,
} from "./workforceModel";

/** One employee: who it is, what it may do, how well it has done, what it remembers. */
export function EmployeeView({ employeeId }: { employeeId: string }) {
  const query = useGetEmployeeQuery(employeeId);
  const view = viewOf(query);
  const active = useActiveOrganisation();
  const tree = useActiveTree();
  const detail = view.kind === "loaded" ? view.data : null;

  const crumbs: Crumb[] = [];
  if (tree.data?.organisation) crumbs.push({ label: tree.data.organisation.name, href: active.entered ? paths.homeOf(tree.data.organisation.slug) : paths.home() });
  if (detail) for (const name of namesFor(tree.data, detail.employee.scope).slice(1)) crumbs.push({ label: name });
  crumbs.push({ label: detail?.employee.name ?? "Employee" });

  return (
    <AppShell
      crumbs={crumbs}
      aside={
        detail ? (
          <ErrorBoundary name="The memory">
            <MemoryPanel employee={detail.employee} tree={tree.data} />
          </ErrorBoundary>
        ) : undefined
      }
    >
      {view.kind === "loading" && (
        <Loading label="Loading the employee" className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <Skeleton className="h-10 w-64" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Skeleton className="h-28 rounded-md" />
            <Skeleton className="h-28 rounded-md" />
            <Skeleton className="h-28 rounded-md" />
          </div>
          <Skeleton className="h-56 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title={view.status === 404 ? "This employee could not be found" : "The employee could not be loaded"} reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <ErrorBoundary name="The employee">
            <EmployeeBody detail={view.data} tree={tree.data} />
          </ErrorBoundary>
        </>
      )}
    </AppShell>
  );
}

/** What the person may do at the employee's place, as the server resolves their role there. */
function useCan(tree: Tree | undefined, scope: string) {
  const me = useGetMeQuery(undefined);
  const rank = roleRank(effectiveRole(tree, me.data, scope));
  return { admin: rank >= roleRank("admin"), build: rank >= roleRank("builder") };
}

function EmployeeBody({ detail, tree }: { detail: EmployeeDetail; tree: Tree | undefined }) {
  const can = useCan(tree, detail.employee.scope);
  const mode = useAppSelector((s) => s.ui.mode);
  const { employee, trackRecord } = detail;
  const costs = employeeCosts(trackRecord);
  const job = employee.jobDescription;
  const released = employee.status === "released";
  const contractor = employee.kind === "contractor";
  // A contractor is not let go: it finishes its brief, or a person stops it (EMP-07).
  const status = contractor && released ? { label: "Finished", tone: STATUS.released.tone } : STATUS[employee.status];
  const kindWord = contractor ? "Contractor" : "Employee";

  return (
    <>
      <div className={cn("flex flex-wrap items-start justify-between gap-5", RISE)}>
        <div className="flex min-w-0 items-center gap-4">
          <span className={cn("rounded-full", !released && employee.status === "working" && "animate-halo motion-reduce:animate-none")}>
            <Avatar name={employee.name} seed={employee.id} size="lg" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold sm:text-4xl">{employee.name}</h1>
              <Badge tone={status.tone}>{status.label}</Badge>
              {employee.idle.flagged && !released && <Badge tone="attention">Nothing to do for {plural(employee.idle.afterDays, "day")}</Badge>}
            </div>
            <span className="text-ink-body">
              {employee.role} · {kindWord} ·{" "}
              {released && employee.releasedAt ? `${contractor ? "Finished" : "Let go"} ${timeAgo(employee.releasedAt)}` : `${contractor ? "Briefed" : "Hired"} ${timeAgo(employee.createdAt)}`}
              {employee.reportsTo && ` · Reports to ${employee.reportsTo.name}`}
            </span>
            {employee.currentRun && (
              <Link href={paths.run(employee.currentRun.id)} className="self-start rounded-xs text-primary-link hover:text-primary-hover">
                Working now: {employee.currentRun.title}
              </Link>
            )}
          </div>
        </div>
        {employee.kind === "employee" && can.admin && <EmployeeActions employee={employee} tree={tree} />}
        {contractor && can.admin && !released && <ContractorActions employee={employee} />}
      </div>

      <section aria-label="Track record" className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4", RISE, stagger(1))}>
        <Stat label="Work accepted" value={acceptedLine(trackRecord.work)}>
          {trackRecord.work.sentBack > 0 ? `${plural(trackRecord.work.sentBack, "piece")} sent back` : "Nothing sent back"}
          {trackRecord.work.judged > 0 && ` · ${plural(trackRecord.work.judged, "judgement")} of others’ work`}
        </Stat>
        <Stat label="Repairs not charged" value={formatCredits(trackRecord.repairsNotCharged.credits)}>
          {trackRecord.repairsNotCharged.calls > 0 ? `${plural(trackRecord.repairsNotCharged.calls, "repair")} of its own mistakes, never billed` : "No repairs of its own work"}
        </Stat>
        <Stat label="Cost so far" value={formatCredits(costs.toDate)}>
          {costLine(costs, job.monthlyCreditLimit)}
        </Stat>
        <Stat label="Estimates" value={trackRecord.estimates && trackRecord.estimates.pieces > 0 ? estimateHeadline(trackRecord.estimates) : "None scored yet"}>
          {trackRecord.estimates && trackRecord.estimates.pieces > 0
            ? `Across ${plural(trackRecord.estimates.pieces, "piece")} of work. The largest miss was ${formatNumber(trackRecord.estimates.largestMissPercent)}%.`
            : "Scored once its first estimated work finishes"}
        </Stat>
      </section>

      <section aria-labelledby="job-title" className={cn("flex flex-col gap-3.5", RISE, stagger(2))}>
        <h2 id="job-title" className="text-lg font-semibold">
          Job description
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border bg-surface px-6 py-5 shadow-card sm:grid-cols-4">
          <JobRow label="Mandate">{job.mandate || "Not written yet"}</JobRow>
          <JobRow label="Works at">{scopeName(tree, job.scope || employee.scope)} and everything beneath it</JobRow>
          <JobRow label="May use">{job.tools.length > 0 ? job.tools.map((t) => toolLabel(t, mode)).join(", ") : "Nothing beyond reading what it is given"}</JobRow>
          <JobRow label="Services">{job.services.length > 0 ? job.services.map((x) => serviceLabel(x, mode)).join(", ") : "None of the platform's services"}</JobRow>
          <JobRow label="Budget">
            {contractor
              ? job.monthlyCreditLimit !== null
                ? `${formatCredits(job.monthlyCreditLimit)} a month of its own${employee.briefedBy ? `, inside ${possessive(employee.briefedBy.name)} budget` : ""}`
                : `No cap of its own; ${employee.briefedBy ? `${possessive(employee.briefedBy.name)} budget` : "the one above"} holds`
              : job.monthlyCreditLimit !== null
                ? `${formatCredits(job.monthlyCreditLimit)} a month, including the contractors it briefs`
                : "No cap of its own; the one above holds"}
          </JobRow>
          <JobRow label="Thinking power">{tierLabel(job.modelTier, mode)}</JobRow>
          {mode === "technical" && <JobRow label="Identifier">{employee.id}</JobRow>}
        </dl>
      </section>

      <ErrorBoundary name="Recent work">
        <RecentWork employee={employee} runs={trackRecord.runs} />
      </ErrorBoundary>

      <ContractorsBriefed detail={detail} />

      {employee.kind === "employee" && !released && tree?.organisation && (
        <ErrorBoundary name="The conversation">
          <section aria-labelledby="talk-title" className="flex flex-col gap-3">
            <h2 id="talk-title" className="text-lg font-semibold">
              Talk to {employee.name}
            </h2>
            <div className="rounded-md border bg-surface p-5 shadow-card">
              <ConversationDock
                tree={tree}
                selection={{ scope: employee.scope, kind: "employee", trail: [...namesFor(tree, employee.scope), employee.name], employeeId: employee.id }}
              />
            </div>
          </section>
        </ErrorBoundary>
      )}
    </>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-surface px-5 py-4 shadow-card">
      <span className="text-ink-muted">{label}</span>
      <span className="font-display text-2xl font-semibold">{value}</span>
      <span className="text-sm text-ink-body">{children}</span>
    </div>
  );
}

function JobRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0 sm:col-span-3">{children}</dd>
    </>
  );
}

type Panel = "edit" | "reassign" | "budget" | "release" | null;

function EmployeeActions({ employee, tree }: { employee: Employee; tree: Tree | undefined }) {
  const [update, updating] = useUpdateEmployeeMutation();
  const [act, acting] = useEmployeeActionMutation();
  const [reassign, reassigning] = useReassignEmployeeMutation();
  const [rehire, rehiring] = useRehireEmployeeMutation();
  const [open, setOpen] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState(employee.scope);
  const [manager, setManager] = useState(employee.reportsTo?.id ?? "");
  const [rehireTo, setRehireTo] = useState(employee.scope);
  const [budget, setBudget] = useState(employee.jobDescription.monthlyCreditLimit?.toString() ?? "");
  const busy = updating.isLoading || acting.isLoading || reassigning.isLoading || rehiring.isLoading;
  const released = employee.status === "released";
  const org = tree?.organisation?.slug ?? employee.scope.split("/")[0] ?? "";
  const people = useGetEmployeesQuery({ scope: org }, { skip: !org });
  const managers = possibleManagers(people.data ?? [], employee.id);

  const run = async (work: () => Promise<unknown>, what: string) => {
    setError(null);
    try {
      await work();
      setOpen(null);
    } catch (e) {
      setError(`Could not ${what}: ${describeError(e as never)}`);
    }
  };

  const saveBudget = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = budget.trim();
    const n = Number(trimmed);
    if (trimmed !== "" && (!Number.isFinite(n) || n < 0)) {
      setError("A budget is a number of credits a month, or empty for none of its own.");
      return;
    }
    void run(
      () => update({ id: employee.id, patch: trimmed === "" ? { clearMonthlyCreditLimit: true } : { jobDescription: { monthlyCreditLimit: n } } }).unwrap(),
      "change the budget",
    );
  };

  if (released) {
    return (
      <form
        aria-label={`Rehire ${employee.name}`}
        className="flex w-full flex-col gap-2 rounded-md border bg-surface p-4 sm:w-dock"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => rehire({ id: employee.id, ...(rehireTo !== employee.scope ? { scope: rehireTo } : {}) }).unwrap(), "rehire");
        }}
      >
        <label htmlFor="rehire-to" className="font-medium">
          Where {employee.name} works again
        </label>
        <select id="rehire-to" value={rehireTo} onChange={(e) => setRehireTo(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3">
          {placements(tree).map((p) => (
            <option key={p.scope} value={p.scope}>
              {`${"— ".repeat(p.depth)}${p.label}${p.scope === employee.scope ? " (where it was)" : ""}`}
            </option>
          ))}
        </select>
        <Button type="submit" className="self-start" disabled={busy}>
          Rehire {employee.name}
        </Button>
        <span className="text-sm text-ink-muted">Its memory comes back with it, so it does not start cold.</span>
        {error && <ActionError text={error} />}
      </form>
    );
  }

  const toggle = (panel: Panel) => setOpen((x) => (x === panel ? null : panel));
  return (
    <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
      <div className="flex flex-wrap gap-2.5">
        <Button variant="outline" aria-expanded={open === "edit"} onClick={() => toggle("edit")} disabled={busy}>
          Edit the job
        </Button>
        <Button variant="outline" aria-expanded={open === "reassign"} onClick={() => toggle("reassign")} disabled={busy}>
          Reassign
        </Button>
        <Button variant="outline" aria-expanded={open === "budget"} onClick={() => toggle("budget")} disabled={busy}>
          Change budget
        </Button>
        {employee.status === "paused" ? (
          <Button variant="outline" onClick={() => void run(() => update({ id: employee.id, patch: { status: "idle" } }).unwrap(), "resume")} disabled={busy}>
            Resume
          </Button>
        ) : (
          <Button variant="outline" onClick={() => void run(() => update({ id: employee.id, patch: { status: "paused" } }).unwrap(), "pause")} disabled={busy}>
            Pause
          </Button>
        )}
        <Button variant="soft" aria-expanded={open === "release"} onClick={() => toggle("release")} disabled={busy || employee.standing !== null}>
          Let go
        </Button>
      </div>
      {employee.standing !== null && <span className="text-sm text-ink-muted">A standing hire is never let go: every organisation keeps one.</span>}

      {open === "edit" && <EditJob employee={employee} managers={managers} onDone={() => setOpen(null)} onError={setError} />}

      {open === "reassign" && (
        <form
          aria-label="Reassign"
          className="flex w-full flex-col gap-2 rounded-md border bg-surface p-4 sm:w-dock"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => reassign({ id: employee.id, scope, reportsTo: manager || null }).unwrap(), "reassign");
          }}
        >
          <label htmlFor="reassign-to" className="font-medium">
            Move {employee.name} to
          </label>
          <select id="reassign-to" value={scope} onChange={(e) => setScope(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3">
            {placements(tree).map((p) => (
              <option key={p.scope} value={p.scope}>
                {`${"— ".repeat(p.depth)}${p.label}`}
              </option>
            ))}
          </select>
          <span className="text-sm text-ink-muted">Its memory travels with it.</span>
          <label htmlFor="reassign-manager" className="font-medium">
            Reports to
          </label>
          <select id="reassign-manager" value={manager} onChange={(e) => setManager(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3">
            <option value="">Nobody: it answers to you</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.role}
                {m.id === employee.reportsTo?.id ? " (as now)" : ""}
              </option>
            ))}
          </select>
          <Button type="submit" className="self-start" disabled={busy || (scope === employee.scope && manager === (employee.reportsTo?.id ?? ""))}>
            Move
          </Button>
        </form>
      )}

      {open === "budget" && (
        <form aria-label="Change budget" onSubmit={saveBudget} className="flex w-full flex-col gap-2 rounded-md border bg-surface p-4 sm:w-dock">
          <label htmlFor="budget" className="font-medium">
            Credits a month
          </label>
          <input id="budget" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3" />
          <span className="text-sm text-ink-muted">Counts what the contractors it briefs spend too. Leave it empty to have no budget of its own.</span>
          <Button type="submit" className="self-start" disabled={busy}>
            Save budget
          </Button>
        </form>
      )}

      {open === "release" && (
        <div role="group" aria-label="Confirm letting go" className="flex w-full flex-col gap-2 rounded-md border border-attention-line bg-attention-tint p-4 sm:w-dock">
          <p className="font-medium text-attention-text">Let {employee.name} go?</p>
          <p className="text-sm text-ink">It leaves the org chart and the bill. Its memory is archived, so rehiring it later is not a cold start. Anyone who reports to it moves up.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void run(() => act({ id: employee.id, action: "release" }).unwrap(), "let go")} disabled={busy}>
              Yes, let {employee.name} go
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Keep
            </Button>
          </div>
        </div>
      )}

      {error && <ActionError text={error} />}
    </div>
  );
}

/**
 * The whole job, editable (EMP-10): name, role, mandate, what it may use, services, thinking power and
 * manager. The record shows the change at once and puts it back, with the reason, if it is refused.
 */
function EditJob({ employee, managers, onDone, onError }: { employee: Employee; managers: Employee[]; onDone: () => void; onError: (reason: string | null) => void }) {
  const [update, state] = useUpdateEmployeeMutation();
  const dispatch = useAppDispatch();
  const before = draftOf(employee, employee.jobDescription);
  const [draft, setDraft] = useState(before);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const wrong = draftProblem(draft);
    if (wrong) return setProblem(wrong);
    const patch = employeePatchFrom(before, draft);
    if (Object.keys(patch).length === 0) return onDone();
    setProblem(null);
    onError(null);
    const boss = managers.find((m) => m.id === draft.reportsTo);
    const undo = dispatch(
      api.util.updateQueryData("getEmployee", employee.id, (d) => {
        d.employee.name = draft.name.trim();
        d.employee.role = draft.role.trim();
        d.employee.jobDescription.mandate = draft.mandate.trim();
        d.employee.jobDescription.tools = draft.tools;
        d.employee.jobDescription.services = draft.services;
        if (draft.modelTier) d.employee.jobDescription.modelTier = draft.modelTier;
        d.employee.jobDescription.monthlyCreditLimit = draft.budget.trim() === "" ? null : Number(draft.budget.trim());
        d.employee.reportsTo = boss ? { id: boss.id, name: boss.name } : null;
      }),
    );
    onDone();
    try {
      await update({ id: employee.id, patch }).unwrap();
    } catch (e) {
      undo.undo();
      onError(`Could not change the job: ${describeError(e as never)}`);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label={`Edit ${employee.name}'s job`} className="flex w-full flex-col gap-4 rounded-md border bg-surface p-5 shadow-card" noValidate>
      <h2 className="text-lg font-semibold">{employee.name}&rsquo;s job</h2>
      <JobFields draft={draft} onChange={setDraft} managers={managers} allowStandard={!employee.jobDescription.modelTier} budgetLabel="Its own monthly budget" />
      <span className="flex flex-wrap gap-2">
        <Button type="submit" disabled={state.isLoading}>
          Save the job
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </span>
      {problem && (
        <p role="alert" className="text-sm text-attention-text">
          {problem}
        </p>
      )}
    </form>
  );
}

/**
 * Stopping and capping a contractor (EMP-07). Stopping finishes it at once: the model gateway refuses its next call, so it
 * stops at its next step, what it did is kept, and the work that briefed it carries on without it. A cap holds it to a
 * number of credits a month, inside its briefer's own.
 */
function ContractorActions({ employee }: { employee: Employee }) {
  const [update, updating] = useUpdateEmployeeMutation();
  const [act, acting] = useEmployeeActionMutation();
  const [open, setOpen] = useState<"cap" | "stop" | null>(null);
  const [cap, setCap] = useState(employee.jobDescription.monthlyCreditLimit?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const busy = updating.isLoading || acting.isLoading;
  const toggle = (panel: "cap" | "stop") => setOpen((x) => (x === panel ? null : panel));

  const run = async (work: () => Promise<unknown>, what: string) => {
    setError(null);
    try {
      await work();
      setOpen(null);
    } catch (e) {
      setError(`Could not ${what}: ${describeError(e as never)}`);
    }
  };

  const saveCap = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = cap.trim();
    const n = Number(trimmed);
    if (trimmed !== "" && (!Number.isFinite(n) || n < 0)) {
      setError("A cap is a number of credits a month, or empty for none of its own.");
      return;
    }
    void run(() => update({ id: employee.id, patch: trimmed === "" ? { clearMonthlyCreditLimit: true } : { jobDescription: { monthlyCreditLimit: n } } }).unwrap(), "change the cap");
  };

  return (
    <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
      <div className="flex flex-wrap gap-2.5">
        <Button variant="outline" aria-expanded={open === "cap"} onClick={() => toggle("cap")} disabled={busy}>
          Cap its spending
        </Button>
        <Button variant="soft" aria-expanded={open === "stop"} onClick={() => toggle("stop")} disabled={busy}>
          Stop this contractor
        </Button>
      </div>

      {open === "cap" && (
        <form aria-label="Cap its spending" onSubmit={saveCap} className="flex w-full flex-col gap-2 rounded-md border bg-surface p-4 sm:w-dock">
          <label htmlFor="contractor-cap" className="font-medium">
            Credits a month, at most
          </label>
          <input id="contractor-cap" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3" />
          <span className="text-sm text-ink-muted">
            Held before each of its calls, so it is never passed{employee.briefedBy ? `; ${possessive(employee.briefedBy.name)} own budget still holds too` : ""}. Leave it empty for no cap of its own.
          </span>
          <Button type="submit" className="self-start" disabled={busy}>
            Save the cap
          </Button>
        </form>
      )}

      {open === "stop" && (
        <div role="group" aria-label="Confirm stopping" className="flex w-full flex-col gap-2 rounded-md border border-attention-line bg-attention-tint p-4 sm:w-dock">
          <p className="font-medium text-attention-text">Stop {employee.name}?</p>
          <p className="text-sm text-ink">
            It makes no more calls from its next step. What it has done is kept, and the work that briefed it carries on without it. A stopped contractor cannot be started again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void run(() => act({ id: employee.id, action: "stop" }).unwrap(), "stop it")} disabled={busy}>
              Yes, stop it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Keep it working
            </Button>
          </div>
        </div>
      )}

      {error && <ActionError text={error} />}
    </div>
  );
}

function ActionError({ text }: { text: string }) {
  return (
    <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
      {text} Nothing was changed.
    </p>
  );
}

const TASK_STATUS: Record<TaskItem["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  failed: "Did not succeed",
  cancelled: "Cancelled",
};

function RecentWork({ employee, runs: worked }: { employee: Employee; runs: TrackRecord["runs"] }) {
  // The tasks it claimed — a factory build's items, checks and reviews included — kept as its work once they are done.
  const query = useGetTasksQuery({ scope: employee.scope, limit: 50, employeeId: employee.id });
  const view = viewOf(query);
  const tasks = view.kind === "loaded" ? view.data.filter((t) => (t.employeeId ?? t.holderEmployeeId) === employee.id).slice(0, 12) : [];
  const runs = [employee.currentRun ? { id: employee.currentRun.id, title: employee.currentRun.title, now: true } : null, employee.lastRunId && employee.lastRunId !== employee.currentRun?.id ? { id: employee.lastRunId, title: "Its last piece of work", now: false } : null].filter(
    (r): r is { id: string; title: string; now: boolean } => r !== null,
  );

  return (
    <section aria-labelledby="work-title" className={cn("flex flex-col gap-3.5", RISE, stagger(3))}>
      <h2 id="work-title" className="text-lg font-semibold">
        Recent work
      </h2>
      {runs.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={paths.run(r.id)} className="inline-flex min-h-touch items-center gap-2 rounded-full bg-primary-tint px-4 font-medium text-primary-hover hover:bg-primary-line">
                {r.now ? `Now: ${r.title}` : r.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {view.kind === "loading" && (
        <Loading label="Loading recent work" className="flex flex-col gap-2">
          <Skeleton className="h-12 rounded-sm" />
          <Skeleton className="h-12 rounded-sm" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="Recent work could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && view.stale && <Stale reason={view.stale.reason} />}
      {view.kind === "loaded" &&
        (tasks.length === 0 ? (
          <p data-state="empty" className="rounded-md border border-dashed border-border-strong bg-surface p-5 text-ink-muted">
            {worked.finished > 0
              ? `${employee.name} has finished ${plural(worked.finished, "piece")} of work here, none of it split into tasks (research is not).${employee.lastRunId ? " Its last piece of work is linked above." : ""}`
              : `${employee.name} has not taken on any work here yet.`}
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border bg-surface shadow-card">
            <ul aria-label="Tasks" className="flex flex-col divide-y">
              {tasks.map((t) => (
                <li key={t.id} className="grid grid-cols-1 gap-x-5 gap-y-1 px-5 py-3.5 sm:grid-cols-4">
                  <span className="font-medium sm:col-span-2">
                    {t.runId ? (
                      <Link href={paths.run(t.runId)} className="rounded-xs text-primary-link hover:text-primary-hover">
                        {t.title}
                      </Link>
                    ) : (
                      t.title
                    )}
                  </span>
                  <span className="text-ink-body">{TASK_STATUS[t.status]}</span>
                  <span className="text-ink-body sm:text-right">
                    {t.estimateCredits !== null ? `Estimated ${formatNumber(t.estimateCredits)}` : "No estimate"}
                    {t.actualCredits !== null ? `, cost ${formatNumber(t.actualCredits)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

function ContractorsBriefed({ detail }: { detail: EmployeeDetail }) {
  const c = detail.trackRecord.contractors;
  if (detail.employee.kind === "contractor") {
    return detail.employee.brief ? (
      <section className="flex flex-col gap-2 rounded-md border bg-surface px-6 py-5 shadow-card">
        <h2 className="text-lg font-semibold">Its brief</h2>
        <p className="whitespace-pre-line text-ink-body">{detail.employee.brief}</p>
        {detail.employee.briefedBy && (
          <Link href={paths.employee(detail.employee.briefedBy.id)} className="self-start rounded-xs text-primary-link hover:text-primary-hover">
            Briefed by {detail.employee.briefedBy.name}
          </Link>
        )}
      </section>
    ) : null;
  }
  return (
    <section aria-labelledby="contractors-title" className="flex flex-col gap-3">
      <h2 id="contractors-title" className="text-lg font-semibold">
        Contractors it has briefed
      </h2>
      <p className="text-ink-body">
        {c.engaged === 0
          ? `${detail.employee.name} has not briefed a contractor yet.`
          : `${plural(c.engaged, "contractor")} so far, ${formatNumber(c.working)} working now. They cost ${formatCredits(c.toDateCredits)} in all, ${formatNumber(c.monthCredits)} this month.`}
      </p>
      {detail.contractors.length > 0 && (
        <ul aria-label="Contractors working now" className="flex flex-col gap-2">
          {detail.contractors.map((x) => (
            <li key={x.id}>
              <Link href={paths.employee(x.id)} className="flex flex-col gap-1 rounded-sm border border-dashed border-violet-dash bg-surface px-4 py-3 text-ink transition-colors hover:bg-violet-tint">
                <span className="flex items-center gap-2 font-medium">
                  <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-violet-line border-t-violet motion-reduce:animate-none" />
                  {x.role}
                </span>
                {x.brief && <span className="text-ink-body">{x.brief}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {detail.reports.length > 0 && (
        <p className="text-ink-body">
          Reports to it:{" "}
          {detail.reports.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <Link href={paths.employee(r.id)} className="rounded-xs text-primary-link hover:text-primary-hover">
                {r.name}
              </Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------

function MemoryPanel({ employee, tree }: { employee: Employee; tree: Tree | undefined }) {
  const includeArchived = employee.status === "released";
  const memory = useGetMemoryQuery({ id: employee.id, includeArchived });
  const changes = useGetMemoryChangesQuery(employee.id);
  const view = viewOf(memory);
  const changeView = viewOf(changes);
  const [adding, setAdding] = useState(false);
  const can = useCan(tree, employee.scope);
  const editable = can.build && !includeArchived && employee.kind === "employee";
  const changeList = changeView.kind === "loaded" ? changeView.data : [];

  return (
    <section aria-label="Memory" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold">What {employee.name} remembers</h2>
        <p className="text-ink-body">
          {employee.kind === "contractor"
            ? "A contractor keeps no memory: what it learns goes to the employee who briefed it."
            : includeArchived
              ? "Archived when it was let go. A rehire brings all of it back."
              : `Written by ${employee.name} after each task and tidied at every review. You can read, correct or remove any of it.`}
        </p>
      </div>

      {view.kind === "loading" && (
        <Loading label="Loading the memory" className="flex flex-col gap-2.5">
          <Skeleton className="h-20 rounded-xs" />
          <Skeleton className="h-20 rounded-xs" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The memory could not be loaded" reason={view.reason} status={view.status} onRetry={() => void memory.refetch()} />}
      {view.kind === "loaded" && view.stale && <Stale reason={view.stale.reason} />}
      {view.kind === "loaded" &&
        (view.data.length === 0 ? (
          <Empty icon="employee" title="Nothing remembered yet">
            {employee.name} writes down what it learns after each task.
          </Empty>
        ) : (
          <ul aria-label="Memory entries" className="flex flex-col gap-2.5">
            {view.data.map((entry) => (
              <MemoryRow key={entry.id} entry={entry} employee={employee} tree={tree} changes={changeList} editable={editable} includeArchived={includeArchived} />
            ))}
          </ul>
        ))}

      {employee.kind === "employee" && <ReviewPanel employee={employee} changes={changeView} onRetry={() => void changes.refetch()} editable={editable} />}

      {employee.kind === "employee" && <MemoryHistory changes={changeView} entries={view.kind === "loaded" ? view.data : []} onRetry={() => void changes.refetch()} />}

      {editable &&
        (adding ? (
          <MemoryForm
            employee={employee}
            includeArchived={includeArchived}
            onDone={() => setAdding(false)}
          />
        ) : (
          <Button variant="outline" className="self-start" onClick={() => setAdding(true)}>
            Add something {employee.name} should know
          </Button>
        ))}
    </section>
  );
}

function MemoryRow({ entry, employee, tree, changes, editable, includeArchived }: { entry: MemoryEntry; employee: Employee; tree: Tree | undefined; changes: MemoryChange[]; editable: boolean; includeArchived: boolean }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [why, setWhy] = useState("");
  const [remove, removeState] = useRemoveMemoryMutation();
  const [error, setError] = useState<string | null>(null);
  const pending = entry.id.startsWith("pending-");

  if (editing) return <MemoryForm employee={employee} entry={entry} includeArchived={includeArchived} onDone={() => setEditing(false)} />;

  const confirmRemove = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      // No reason given is sent as none, so the log never quotes one that was not said (D28).
      await remove({ id: employee.id, entryId: entry.id, why: why.trim() || null, includeArchived }).unwrap();
    } catch (e) {
      setError(`It was not removed: ${describeError(e as never)}`);
    }
  };

  return (
    <li data-memory={entry.id} className={cn("flex flex-col gap-1.5 rounded-xs border border-border-strong bg-surface px-4 py-3.5", pending && "opacity-70")}>
      <span className="font-semibold">{entry.title}</span>
      <span className="whitespace-pre-line text-ink-body">{entry.body}</span>
      <span className="text-xs text-ink-muted">
        {MEMORY_KIND[entry.kind]} · About {scopeName(tree, entry.scope || employee.scope)} · {pending ? "Saving…" : entryOrigin(entry, changes)}
        {entry.sourceRunId && (
          <>
            {" · "}
            <Link href={paths.run(entry.sourceRunId)} className="rounded-xs text-primary-link hover:text-primary-hover">
              the task
            </Link>
          </>
        )}
      </span>
      {editable && !pending && !removing && (
        <span className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Correct
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
            Remove
          </Button>
        </span>
      )}
      {removing && (
        <form onSubmit={(e) => void confirmRemove(e)} aria-label="Confirm removing" className="flex flex-col gap-2 rounded-xs bg-attention-tint p-3">
          <label htmlFor={`why-${entry.id}`} className="text-sm font-medium text-attention-text">
            Why should {employee.name} forget this? (optional)
          </label>
          <input id={`why-${entry.id}`} value={why} onChange={(e) => setWhy(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3" />
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" type="submit" disabled={removeState.isLoading}>
              Remove it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(false)}>
              Keep it
            </Button>
          </span>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-attention-text">
          {error}
        </p>
      )}
    </li>
  );
}

function MemoryForm({ employee, entry, includeArchived, onDone }: { employee: Employee; entry?: MemoryEntry; includeArchived: boolean; onDone: () => void }) {
  const [title, setTitle] = useState(entry?.title ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [kind, setKind] = useState<MemoryKind>(entry?.kind ?? "fact");
  const [add, adding] = useAddMemoryMutation();
  const [correct, correcting] = useCorrectMemoryMutation();
  const [error, setError] = useState<string | null>(null);
  const id = entry?.id ?? "new";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError("Give it a short title and say what it should remember.");
      return;
    }
    setError(null);
    try {
      if (entry) await correct({ id: employee.id, entryId: entry.id, title: title.trim(), body: body.trim(), kind, includeArchived }).unwrap();
      else await add({ id: employee.id, title: title.trim(), body: body.trim(), kind, includeArchived }).unwrap();
      onDone();
    } catch (e) {
      setError(`${entry ? "The correction" : "It"} was not saved: ${describeError(e as never)}`);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label={entry ? "Correct this memory" : "Add to the memory"} className="flex flex-col gap-2.5 rounded-xs border border-primary bg-primary-tint p-4">
      <label htmlFor={`title-${id}`} className="text-sm font-medium">
        In a few words
      </label>
      <input id={`title-${id}`} value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3" />
      <label htmlFor={`body-${id}`} className="text-sm font-medium">
        What {employee.name} should remember
      </label>
      <textarea id={`body-${id}`} value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="rounded-xs border border-border-strong bg-surface px-3 py-2" />
      <label htmlFor={`kind-${id}`} className="text-sm font-medium">
        Kind
      </label>
      <select id={`kind-${id}`} value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className="min-h-touch rounded-xs border border-border-strong bg-surface px-3">
        {MEMORY_KINDS.map((k) => (
          <option key={k} value={k}>
            {MEMORY_KIND[k]}
          </option>
        ))}
      </select>
      <span className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={adding.isLoading || correcting.isLoading}>
          {entry ? "Save the correction" : "Add it"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
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

/** Every change to the memory, newest first: what changed, who changed it, and when (MEM-01). */
function MemoryHistory({ changes, entries, onRetry }: { changes: ViewState<MemoryChange[]>; entries: MemoryEntry[]; onRetry: () => void }) {
  const [all, setAll] = useState(false);
  return (
    <section aria-labelledby="memory-history-title" className="flex flex-col gap-2">
      <h3 id="memory-history-title" className="font-display text-base font-semibold">
        What changed in it
      </h3>
      {changes.kind === "loading" && (
        <Loading label="Loading what changed" className="flex flex-col gap-2">
          <Skeleton className="h-10 rounded-xs" />
          <Skeleton className="h-10 rounded-xs" />
        </Loading>
      )}
      {changes.kind === "failed" && <Failed title="What changed in the memory could not be loaded" reason={changes.reason} status={changes.status} onRetry={onRetry} />}
      {changes.kind === "loaded" &&
        (changes.data.length === 0 ? (
          <p data-state="empty" className="text-sm text-ink-muted">
            Nothing has changed in it yet.
          </p>
        ) : (
          <>
            <ol aria-label="Changes to the memory" className="flex flex-col divide-y rounded-xs border border-border-strong">
              {(all ? changes.data : changes.data.slice(0, 8)).map((c) => {
                const title = memoryChangeTitle(c, entries);
                const why = memoryChangeWhy(c);
                return (
                  <li key={c.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="text-sm">
                      <span className="font-medium">{memoryChangeLine(c)}</span>
                      {title ? `: ${title}` : ""}
                    </span>
                    {why && <span className="text-xs text-ink-body">“{why}”</span>}
                    <span className="flex flex-wrap gap-2 text-xs text-ink-muted">
                      <time dateTime={c.at}>{timeAgo(c.at)}</time>
                      {c.runId && (
                        <Link href={paths.run(c.runId)} className="rounded-xs text-primary-link hover:text-primary-hover">
                          the work it came from
                        </Link>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            {changes.data.length > 8 && (
              <Button size="sm" variant="ghost" className="self-start" onClick={() => setAll((x) => !x)}>
                {all ? "Show the latest only" : `Show all ${formatNumber(changes.data.length)}`}
              </Button>
            )}
          </>
        ))}
    </section>
  );
}

function ReviewPanel({ employee, changes, onRetry, editable }: { employee: Employee; changes: ViewState<MemoryChange[]>; onRetry: () => void; editable: boolean }) {
  const [review, state] = useReviewMemoryMutation();
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      const run = await review(employee.id).unwrap();
      setQueued(run.id);
    } catch (e) {
      setError(`The review did not start: ${describeError(e as never)}`);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-sm bg-violet-tint px-4 py-4">
      {changes.kind === "loading" && (
        <Loading label="Loading the last review" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
        </Loading>
      )}
      {changes.kind === "failed" && (
        <div role="alert" data-state="failed" className="flex flex-col gap-1 text-sm text-attention-text">
          The last review could not be loaded: {changes.reason}
          <button type="button" onClick={onRetry} className="min-h-touch self-start rounded-xs font-semibold underline">
            Try again
          </button>
        </div>
      )}
      {changes.kind === "loaded" && <ReviewLine changes={changes.data} />}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void start()} disabled={state.isLoading || queued !== null}>
            Review now
          </Button>
          {queued && (
            <Link href={paths.run(queued)} className="rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover">
              Review started — watch it
            </Link>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-attention-text">
          {error}
        </p>
      )}
    </div>
  );
}

function ReviewLine({ changes }: { changes: MemoryChange[] }) {
  const last = lastReview(changes);
  if (!last) {
    return (
      <p data-state="empty" className="text-ink-body">
        <span className="font-semibold">Not reviewed yet.</span> A review merges what repeats, removes what is stale and corrects bad habits.
      </p>
    );
  }
  const parts = [plural(last.merged, "note") + " merged", `${formatNumber(last.removed)} removed as out of date`, plural(last.corrected, "habit") + " corrected"];
  return (
    <p className="flex flex-col gap-0.5">
      <span className="font-semibold">Last review, {timeAgo(last.at)}</span>
      <span className="text-ink-body">{parts.join(", ")}.</span>
      {last.runId && (
        <Link href={paths.run(last.runId)} className="self-start rounded-xs text-sm text-primary-link hover:text-primary-hover">
          See the review
        </Link>
      )}
    </p>
  );
}
