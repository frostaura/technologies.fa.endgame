import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { ConfirmCard } from "@/components/ui/confirm";
import { Avatar } from "@/components/Avatar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { NO_VALUE, Stat, StatRow } from "@/components/ui/stat";
import { SECTION, TITLE, useShowAll } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { estimateFigure, estimateHeadline } from "@/lib/estimates";
import { formatCredits, formatNumber, headlineCredits, plural, possessive, timeAgo } from "@/lib/format";
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
import type { Employee, EmployeeDetail, MemoryChange, MemoryEntry, MemoryKind, LedRun, TaskItem, TrackRecord, Tree } from "@/store/types";
import { AppShell, type Crumb } from "../shell/AppShell";
import { ConversationDock } from "../home/ConversationDock";
import { Talk } from "../shell/talk";
import { Fold } from "@/components/Fold";
import { namesFor } from "../home/treeModel";
import { useAppDispatch } from "@/store";
import { JobFields } from "./JobFields";
import { GROWING } from "./layout";
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
  personLabels,
  placements,
  possibleManagers,
  scopeName,
  serviceLabel,
  tierLabel,
  toolLabel,
  workStatus,
} from "./workforceModel";

/**
 * One employee, as a profile (ARCH-011): who it is, where it works, its state and the actions on it in
 * one group; its track record on the figure tiles; then its work and its memory — two across from
 * 1600 — and the conversation. The job it works to, and the contractors it briefs, are beside the page.
 */
export function EmployeeView({ employeeId }: { employeeId: string }) {
  const query = useGetEmployeeQuery(employeeId);
  const view = viewOf(query);
  const active = useActiveOrganisation();
  const tree = useActiveTree();
  const detail = view.kind === "loaded" ? view.data : null;

  const crumbs: Crumb[] = [];
  if (tree.data?.organisation)
    crumbs.push({
      label: tree.data.organisation.name,
      href: active.entered ? paths.homeOf(tree.data.organisation.slug) : paths.home(),
    });
  // Every level above is a place to go: its own page under Manage.
  if (detail) {
    const parts = detail.employee.scope.split("/");
    namesFor(tree.data, detail.employee.scope)
      .slice(1)
      .forEach((name, i) =>
        crumbs.push({
          label: name,
          href: paths.manage(parts.slice(0, i + 2).join("/")),
        }),
      );
  }
  crumbs.push({ label: detail?.employee.name ?? "Employee" });

  return (
    <AppShell crumbs={crumbs} aside={detail ? <EmployeeAside detail={detail} tree={tree.data} /> : undefined}>
      {view.kind === "loading" && (
        <Loading label="Loading the employee" className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <Skeleton className="h-10 w-64" />
          </div>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Skeleton className="h-28 rounded-md" />
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
  return {
    admin: rank >= roleRank("admin"),
    build: rank >= roleRank("builder"),
  };
}

function EmployeeBody({ detail, tree }: { detail: EmployeeDetail; tree: Tree | undefined }) {
  const can = useCan(tree, detail.employee.scope);
  const { employee, trackRecord } = detail;
  const costs = employeeCosts(trackRecord);
  const job = employee.jobDescription;
  const released = employee.status === "released";
  const contractor = employee.kind === "contractor";
  // A contractor is not let go: it finishes its brief, or a person stops it (EMP-07).
  const status = contractor && released ? { label: "Finished", tone: STATUS.released.tone } : STATUS[employee.status];
  const kindWord = contractor ? "Contractor" : "Employee";
  const actions = useActions(employee, tree, can.admin);

  return (
    <>
      {/* A phone draws who this is first, then the button that opens the conversation with it (the order classes). */}
      <header className={cn("flex flex-wrap items-start justify-between gap-x-8 gap-y-4 max-sm:-order-2", RISE)}>
        <div className="flex min-w-0 items-center gap-4 max-sm:items-start">
          <span className={cn("rounded-full", !released && employee.status === "working" && "animate-halo motion-reduce:animate-none")}>
            <Avatar name={employee.name} seed={employee.id} size="lg" className="max-sm:size-12 max-sm:text-xl" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className={cn(TITLE, "break-words")}>{employee.name}</h1>
              <Badge tone={status.tone}>{status.label}</Badge>
              {employee.idle.flagged && !released && <Badge tone="warn">Nothing to do for {plural(employee.idle.afterDays, "day")}</Badge>}
            </div>
            <span className="text-ink-body">
              {employee.role} · {kindWord} · {released && employee.releasedAt ? `${contractor ? "Finished" : "Let go"} ${timeAgo(employee.releasedAt)}` : `${contractor ? "Briefed" : "Hired"} ${timeAgo(employee.createdAt)}`}
              {employee.reportsTo && ` · Reports to ${employee.reportsTo.name}`}
            </span>
            {/* Where it works, always: two people with one name and role are told apart by their place, never by colour alone. */}
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-ink-muted">
                {released ? "Worked at" : "Works at"}{" "}
                <Link href={paths.manage(employee.scope)} className="rounded-xs font-medium text-primary-link hover:text-primary-hover">
                  {scopeName(tree, employee.scope)}
                </Link>
              </span>
              {employee.currentRun && (
                <Link href={paths.run(employee.currentRun.id)} className="min-w-0 rounded-xs text-primary-link hover:text-primary-hover">
                  Working now: {employee.currentRun.title}
                </Link>
              )}
            </span>
          </div>
        </div>
        {actions.buttons}
      </header>

      {/* The chosen action's panel, under the header (on a phone too, before the conversation's launcher). */}
      <div className="flex flex-col gap-4 empty:hidden max-sm:-order-2">{actions.panel}</div>

      <StatRow cols={4} label="Track record" className={cn(RISE, stagger(1))}>
        <Stat
          label="Work accepted"
          value={trackRecord.work.accepted + trackRecord.work.sentBack > 0 ? acceptedLine(trackRecord.work) : NO_VALUE}
          tone={trackRecord.work.accepted + trackRecord.work.sentBack > 0 ? "ink" : "muted"}
          caption={
            trackRecord.work.accepted + trackRecord.work.sentBack === 0
              ? acceptedLine(trackRecord.work)
              : `${trackRecord.work.sentBack > 0 ? `${plural(trackRecord.work.sentBack, "piece")} sent back` : "Nothing sent back"}${trackRecord.work.judged > 0 ? ` · ${plural(trackRecord.work.judged, "judgement")} of others’ work` : ""}`
          }
        />
        <Stat
          label="Repairs not charged"
          value={headlineCredits(trackRecord.repairsNotCharged.credits)}
          caption={trackRecord.repairsNotCharged.calls > 0 ? `${plural(trackRecord.repairsNotCharged.calls, "repair")} of its own mistakes, never billed` : "No repairs of its own work"}
        />
        <Stat label="Cost so far" value={headlineCredits(costs.toDate)} caption={costLine(costs, job.monthlyCreditLimit)} />
        {trackRecord.estimates && trackRecord.estimates.pieces > 0 ? (
          <Stat
            label="Estimates"
            value={estimateFigure(trackRecord.estimates)}
            caption={`${estimateHeadline(trackRecord.estimates)}. Across ${plural(trackRecord.estimates.pieces, "piece")} of work. The largest miss was ${formatNumber(trackRecord.estimates.largestMissPercent)}%.`}
          />
        ) : (
          <Stat label="Estimates" value={NO_VALUE} tone="muted" caption="None scored yet. Scored once its first estimated work finishes." />
        )}
      </StatRow>

      {/*
        Its work and its memory, two across from 1600 (as `ContentGrid`), with the conversation under the
        work so neither column runs on beside empty space; the memory spans both rows. On a phone the grid
        steps aside (`contents`), so the conversation's launcher can take its place near the top.
      */}
      <div className={cn("grid grid-cols-1 items-start gap-6 max-sm:contents 3xl:grid-cols-2 3xl:grid-rows-[auto_1fr]", RISE, stagger(2))}>
        <ErrorBoundary name="Recent work">
          <RecentWork employee={employee} runs={trackRecord.runs} led={detail.recentRuns ?? []} />
        </ErrorBoundary>
        <div className="min-w-0 3xl:col-start-2 3xl:row-span-2 3xl:row-start-1">
          <Fold title={`What ${employee.name} remembers`} summary="Its curated memory, and what changed in it">
            <ErrorBoundary name="The memory">
              <MemoryPanel employee={employee} tree={tree} />
            </ErrorBoundary>
          </Fold>
        </div>
        {employee.kind === "employee" && !released && tree?.organisation && (
          <ErrorBoundary name="The conversation">
            <Talk label={`Talk to ${employee.name}`} launcherClassName="max-sm:-order-1">
              <section aria-labelledby="talk-title" className="flex min-w-0 flex-col gap-3 3xl:col-start-1">
                <h2 id="talk-title" className={SECTION}>
                  Talk to {employee.name}
                </h2>
                {/* The conversation is a framed pane of its own (ARCH-012): no card around it. */}
                <ConversationDock
                  tree={tree}
                  selection={{
                    scope: employee.scope,
                    kind: "employee",
                    trail: [...namesFor(tree, employee.scope), employee.name],
                    employeeId: employee.id,
                  }}
                />
              </section>
            </Talk>
          </ErrorBoundary>
        )}
      </div>
    </>
  );
}

/** Beside the page: the job it works to, and the contractors it briefs (or, for a contractor, its brief). */
function EmployeeAside({ detail, tree }: { detail: EmployeeDetail; tree: Tree | undefined }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const { employee } = detail;
  const job = employee.jobDescription;
  const contractor = employee.kind === "contractor";
  return (
    <>
      <section aria-labelledby="job-title" className="flex flex-col gap-4">
        <h2 id="job-title" className="text-base font-semibold">
          Job description
        </h2>
        <dl className="flex flex-col gap-3.5">
          <JobRow label="Mandate">
            <span className="whitespace-pre-line">{job.mandate || "Not written yet"}</span>
          </JobRow>
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
          {mode === "technical" && (
            <JobRow label="Identifier">
              <code className="break-all font-mono text-sm">{employee.id}</code>
            </JobRow>
          )}
        </dl>
      </section>
      <ContractorsBriefed detail={detail} />
    </>
  );
}

function JobRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="m-0 text-ink">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

type Panel = "edit" | "reassign" | "budget" | "release" | "cap" | "stop" | null;

/**
 * The actions on an employee, as one group in the header, and the panel the chosen one opens under the
 * header at the page's full width — so opening one never moves the group. On a phone the first action
 * stands alone and the rest sit behind "More".
 */
function useActions(employee: Employee, tree: Tree | undefined, admin: boolean): { buttons: ReactNode; panel: ReactNode } {
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
  const contractor = employee.kind === "contractor";
  const org = tree?.organisation?.slug ?? employee.scope.split("/")[0] ?? "";
  const people = useGetEmployeesQuery({ scope: org }, { skip: !org || !admin || contractor });
  const managers = possibleManagers(people.data ?? [], employee.id);
  const labels = personLabels(managers, tree);
  const ids = {
    reassign: useId(),
    manager: useId(),
    budget: useId(),
    rehire: useId(),
    cap: useId(),
  };

  const run = async (work: () => Promise<unknown>, what: string) => {
    setError(null);
    try {
      await work();
      setOpen(null);
    } catch (e) {
      setError(`Could not ${what}: ${describeError(e as never)}`);
    }
  };
  const saveLimit = (event: FormEvent, what: "budget" | "cap") => {
    event.preventDefault();
    const trimmed = budget.trim();
    const n = Number(trimmed);
    if (trimmed !== "" && (!Number.isFinite(n) || n < 0)) {
      setError(what === "budget" ? "A budget is a number of credits a month, or empty for none of its own." : "A cap is a number of credits a month, or empty for none of its own.");
      return;
    }
    void run(
      () =>
        update({
          id: employee.id,
          patch: trimmed === "" ? { clearMonthlyCreditLimit: true } : { jobDescription: { monthlyCreditLimit: n } },
        }).unwrap(),
      what === "budget" ? "change the budget" : "change the cap",
    );
  };
  const toggle = (panel: Panel) => {
    setError(null);
    setOpen((x) => (x === panel ? null : panel));
  };

  if (!admin || (contractor && released)) return { buttons: null, panel: null };

  if (released) {
    // Rehiring is the one action left: the header's group is where it says so, with where it works again.
    return {
      buttons: (
        <form
          aria-label={`Rehire ${employee.name}`}
          className="flex min-w-0 flex-col gap-1.5 max-sm:w-full sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                rehire({
                  id: employee.id,
                  ...(rehireTo !== employee.scope ? { scope: rehireTo } : {}),
                }).unwrap(),
              "rehire",
            );
          }}
        >
          <label htmlFor={ids.rehire} className="text-sm font-medium">
            Where {employee.name} works again
          </label>
          <span className="flex flex-wrap gap-2 max-sm:w-full">
            <Select id={ids.rehire} value={rehireTo} onChange={(e) => setRehireTo(e.target.value)} className="w-72 max-sm:w-full">
              {placements(tree).map((p) => (
                <option key={p.scope} value={p.scope}>
                  {`${"— ".repeat(p.depth)}${p.label}${p.scope === employee.scope ? " (where it was)" : ""}`}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={busy} className="max-sm:w-full">
              Rehire {employee.name}
            </Button>
          </span>
          <span className="text-sm text-ink-muted">Its memory comes back with it, so it does not start cold.</span>
        </form>
      ),
      panel: error ? <ActionError text={error} /> : null,
    };
  }

  const buttons = contractor ? (
    <ActionGroup
      first={
        <Button variant="outline" aria-expanded={open === "cap"} onClick={() => toggle("cap")} disabled={busy} className="max-sm:flex-1">
          Cap its spending
        </Button>
      }
    >
      <Button variant="danger-outline" aria-expanded={open === "stop"} onClick={() => toggle("stop")} disabled={busy} className={MENU_ITEM}>
        Stop this contractor
      </Button>
    </ActionGroup>
  ) : (
    <ActionGroup
      first={
        <Button variant="primary" aria-expanded={open === "edit"} onClick={() => toggle("edit")} disabled={busy} className="max-sm:flex-1">
          Edit the job
        </Button>
      }
      note={employee.standing !== null ? "A standing hire is never let go: every organisation keeps one." : null}
    >
      <Button variant="outline" aria-expanded={open === "reassign"} onClick={() => toggle("reassign")} disabled={busy} className={MENU_ITEM}>
        Reassign
      </Button>
      <Button variant="outline" aria-expanded={open === "budget"} onClick={() => toggle("budget")} disabled={busy} className={MENU_ITEM}>
        Change budget
      </Button>
      {employee.status === "paused" ? (
        <Button variant="outline" onClick={() => void run(() => update({ id: employee.id, patch: { status: "idle" } }).unwrap(), "resume")} disabled={busy} className={MENU_ITEM}>
          Resume
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() =>
            void run(
              () =>
                update({
                  id: employee.id,
                  patch: { status: "paused" },
                }).unwrap(),
              "pause",
            )
          }
          disabled={busy}
          className={MENU_ITEM}
        >
          Pause
        </Button>
      )}
      <Button variant="danger-outline" aria-expanded={open === "release"} onClick={() => toggle("release")} disabled={busy || employee.standing !== null} className={MENU_ITEM}>
        Let go
      </Button>
    </ActionGroup>
  );

  const small = "flex w-full max-w-form flex-col gap-3 rounded-md border bg-surface p-5 shadow-card max-sm:p-4";
  const panel = (
    <>
      {open === "edit" && <EditJob employee={employee} managers={managers} tree={tree} onDone={() => setOpen(null)} onError={setError} />}

      {open === "reassign" && (
        <form
          aria-label="Reassign"
          className={small}
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                reassign({
                  id: employee.id,
                  scope,
                  reportsTo: manager || null,
                }).unwrap(),
              "reassign",
            );
          }}
        >
          <Field id="reassign-to" label={`Move ${employee.name} to`} hint="Its memory travels with it.">
            <Select id="reassign-to" value={scope} onChange={(e) => setScope(e.target.value)}>
              {placements(tree).map((p) => (
                <option key={p.scope} value={p.scope}>
                  {`${"— ".repeat(p.depth)}${p.label}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="reassign-manager" label="Reports to">
            <Select id="reassign-manager" value={manager} onChange={(e) => setManager(e.target.value)}>
              <option value="">Nobody: it answers to you</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {labels.get(m.id)}
                  {m.id === employee.reportsTo?.id ? " (as now)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <span className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || (scope === employee.scope && manager === (employee.reportsTo?.id ?? ""))}>
              Move
            </Button>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </span>
        </form>
      )}

      {(open === "budget" || open === "cap") && (
        <form aria-label={open === "budget" ? "Change budget" : "Cap its spending"} onSubmit={(e) => saveLimit(e, open)} className={small}>
          <div className="grid grid-cols-1 items-end gap-x-5 gap-y-1.5 sm:grid-cols-2">
            <span className="flex flex-col gap-1.5">
              <label htmlFor={open === "budget" ? "budget" : "contractor-cap"} className="font-medium">
                {open === "budget" ? "Credits a month" : "Credits a month, at most"}
              </label>
              <Input id={open === "budget" ? "budget" : "contractor-cap"} inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </span>
            <span className="text-sm text-ink-muted">
              {open === "budget"
                ? "Counts what the contractors it briefs spend too. Leave it empty to have no budget of its own."
                : `Held before each of its calls, so it is never passed${employee.briefedBy ? `; ${possessive(employee.briefedBy.name)} own budget still holds too` : ""}. Leave it empty for no cap of its own.`}
            </span>
          </div>
          <span className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {open === "budget" ? "Save budget" : "Save the cap"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </span>
        </form>
      )}

      {open === "release" && (
        <ConfirmCard
          label="Confirm letting go"
          question={`Let ${employee.name} go?`}
          detail="It leaves the org chart and the bill. Its memory is archived, so rehiring it later is not a cold start. Anyone who reports to it moves up."
          confirm={`Yes, let ${employee.name} go`}
          cancel="Keep"
          busy={busy}
          onConfirm={() => void run(() => act({ id: employee.id, action: "release" }).unwrap(), "let go")}
          onCancel={() => setOpen(null)}
        />
      )}

      {open === "stop" && (
        <ConfirmCard
          label="Confirm stopping"
          question={`Stop ${employee.name}?`}
          detail="It makes no more calls from its next step. What it has done is kept, and the work that briefed it carries on without it. A stopped contractor cannot be started again."
          confirm="Yes, stop it"
          cancel="Keep it working"
          busy={busy}
          onConfirm={() => void run(() => act({ id: employee.id, action: "stop" }).unwrap(), "stop it")}
          onCancel={() => setOpen(null)}
        />
      )}

      {error && <ActionError text={error} />}
    </>
  );
  return { buttons, panel };
}

/** An action inside the group: a button in the row on a tablet or a desktop, a full-width row of the menu on a phone. */
const MENU_ITEM = "max-sm:w-full max-sm:justify-start max-sm:border-transparent max-sm:hover:bg-ground";

/**
 * The header's actions: one row from a tablet up; on a phone, the first action beside "More", which
 * opens the rest as a menu card. The rest stay one set of buttons (not a copy), so the academy and a
 * screen reader find each once; a lesson pointing at one opens the menu (`endgame:reveal`).
 */
function ActionGroup({ first, note, children }: { first: ReactNode; note?: string | null; children: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const reveal = () => setMenu(true);
    el.addEventListener("endgame:reveal", reveal);
    return () => el.removeEventListener("endgame:reveal", reveal);
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-2 max-sm:w-full sm:items-end">
      <div role="group" aria-label="Actions" className="flex flex-wrap items-center gap-2 max-sm:w-full">
        {first}
        <Button variant="outline" aria-expanded={menu} aria-controls={id} onClick={() => setMenu((x) => !x)} className="sm:hidden">
          More
          <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", menu && "rotate-180")} />
        </Button>
        <div
          ref={box}
          id={id}
          data-fold-body=""
          className={cn("sm:contents", menu ? "max-sm:flex" : "max-sm:hidden", "w-full flex-col gap-1 rounded-md border bg-surface p-2 shadow-card")}
          onClick={(e) => {
            // A choice made from the menu closes it; the panel it opens is under the header.
            if ((e.target as HTMLElement).closest("button")) setMenu(false);
          }}
        >
          {children}
        </div>
      </div>
      {note && <span className="text-sm text-ink-muted">{note}</span>}
    </div>
  );
}

/**
 * The whole job, editable (EMP-10): name, role, mandate, what it may use, services, thinking power and
 * manager. The record shows the change at once and puts it back, with the reason, if it is refused.
 */
function EditJob({ employee, managers, tree, onDone, onError }: { employee: Employee; managers: Employee[]; tree: Tree | undefined; onDone: () => void; onError: (reason: string | null) => void }) {
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
    <form onSubmit={(e) => void submit(e)} aria-label={`Edit ${employee.name}'s job`} className="flex w-full flex-col gap-5 rounded-md border bg-surface p-6 shadow-card max-sm:p-4" noValidate>
      <h2 className={SECTION}>{employee.name}&rsquo;s job</h2>
      <JobFields draft={draft} onChange={setDraft} managers={managers} tree={tree} allowStandard={!employee.jobDescription.modelTier} budgetLabel="Its own monthly budget" />
      <span className="flex flex-wrap gap-2 border-t pt-4">
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

function ActionError({ text }: { text: string }) {
  return (
    <p role="alert" className="max-w-form rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
      {text} Nothing was changed.
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------------------------

interface WorkRow {
  id: string;
  title: string;
  href: string | null;
  status: string;
  when: string;
  credits: string | null;
}

function taskRow(t: TaskItem): WorkRow {
  const s = workStatus(t.status);
  const when = s.ended ? `Ended ${timeAgo(t.updatedAt)}` : t.claimedAt ? `Started ${timeAgo(t.claimedAt)}` : `Added ${timeAgo(t.createdAt)}`;
  const credits =
    t.actualCredits !== null ? `${formatNumber(t.actualCredits)}${t.estimateCredits !== null ? ` of ${formatNumber(t.estimateCredits)} estimated` : ""}` : t.estimateCredits !== null ? `${formatNumber(t.estimateCredits)} estimated` : null;
  return {
    id: t.id,
    title: t.title,
    href: t.runId ? paths.run(t.runId) : null,
    status: t.status,
    when,
    credits,
  };
}

function ledRow(r: LedRun): WorkRow {
  const s = workStatus(r.status);
  const when = s.ended && r.finishedAt ? `Ended ${timeAgo(r.finishedAt)}` : `Started ${timeAgo(r.startedAt)}`;
  return {
    id: r.id,
    title: r.title,
    href: paths.run(r.id),
    status: r.status,
    when,
    credits: null,
  };
}

/**
 * Its recent work as one table in one status vocabulary: the tasks it took (a factory build's items,
 * checks and reviews included) or, where its work is not split into tasks (research, reviews), the runs
 * it led (D75). The newest ten, then "Show all".
 */
function RecentWork({ employee, runs: worked, led }: { employee: Employee; runs: TrackRecord["runs"]; led: LedRun[] }) {
  const query = useGetTasksQuery({
    scope: employee.scope,
    limit: 50,
    employeeId: employee.id,
  });
  const view = viewOf(query);
  const tasks = useMemo(() => (view.kind === "loaded" ? view.data.filter((t) => (t.employeeId ?? t.holderEmployeeId) === employee.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : []), [view, employee.id]);
  const byTasks = tasks.length > 0;
  const rows = byTasks ? tasks.map(taskRow) : led.map(ledRow);
  const list = useShowAll(rows, 10, "pieces of work");
  // Its last piece of work is linked from the heading only where the table does not already hold it.
  const last = (byTasks || rows.length === 0) && employee.lastRunId && employee.lastRunId !== employee.currentRun?.id ? employee.lastRunId : null;

  return (
    <section aria-labelledby="work-title" className="flex min-w-0 flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="work-title" className={SECTION}>
          Recent work
        </h2>
        {last && (
          <Link href={paths.run(last)} className="rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover">
            Its last piece of work
          </Link>
        )}
      </div>
      {view.kind === "loading" && (
        <Loading label="Loading recent work" className="flex flex-col gap-2">
          <Skeleton className="h-12 rounded-sm" />
          <Skeleton className="h-12 rounded-sm" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="Recent work could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && view.stale && <Stale reason={view.stale.reason} />}
      {view.kind === "loaded" &&
        (rows.length === 0 ? (
          <p data-state="empty" className="max-w-prose text-ink-muted">
            {worked.finished > 0
              ? `${employee.name} has finished ${plural(worked.finished, "piece")} of work here, none of it split into tasks (research is not).${employee.lastRunId ? " Its last piece of work is linked above." : ""}`
              : `${employee.name} has not taken on any work here yet.`}
          </p>
        ) : (
          <>
            <div className="overflow-hidden rounded-md border bg-surface shadow-card">
              <table aria-label={byTasks ? "Tasks" : "Work it led"} className="w-full border-collapse text-left">
                <thead className="border-b bg-ground text-sm text-ink-muted max-sm:hidden">
                  <tr>
                    <th scope="col" className="w-full px-5 py-2.5 font-medium">
                      Work
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      When
                    </th>
                    {byTasks && (
                      <th scope="col" className="px-5 py-2.5 text-right font-medium">
                        Credits
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.shown.map((r) => {
                    const s = workStatus(r.status);
                    return (
                      <tr key={r.id} data-status={r.status} className="align-top max-sm:flex max-sm:flex-col max-sm:gap-1.5 max-sm:px-4 max-sm:py-3.5">
                        <td className="px-5 py-3 max-sm:p-0">
                          {r.href ? (
                            <Link href={r.href} title={r.title} className="line-clamp-2 rounded-xs font-medium text-primary-link hover:text-primary-hover">
                              {r.title}
                            </Link>
                          ) : (
                            <span title={r.title} className="line-clamp-2 font-medium">
                              {r.title}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 max-sm:hidden">
                          <Badge tone={s.tone}>{s.label}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-sm text-ink-body max-sm:flex max-sm:items-center max-sm:gap-2 max-sm:p-0">
                          <Badge tone={s.tone} className="sm:hidden">
                            {s.label}
                          </Badge>
                          {r.when}
                        </td>
                        {byTasks && <td className="whitespace-nowrap px-5 py-3 text-right text-sm tabular-nums text-ink-body max-sm:p-0 max-sm:text-left">{r.credits ?? NO_VALUE}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {list.control}
          </>
        ))}
    </section>
  );
}

function ContractorsBriefed({ detail }: { detail: EmployeeDetail }) {
  const c = detail.trackRecord.contractors;
  if (detail.employee.kind === "contractor") {
    return detail.employee.brief ? (
      <section aria-labelledby="brief-title" className="flex flex-col gap-2">
        <h2 id="brief-title" className="text-base font-semibold">
          Its brief
        </h2>
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
      <h2 id="contractors-title" className="text-base font-semibold">
        Contractors it has briefed
      </h2>
      <p className="text-ink-body">
        {c.engaged === 0
          ? `${detail.employee.name} has not briefed a contractor yet.`
          : `${plural(c.engaged, "contractor")} so far, ${formatNumber(c.working)} working now. They cost ${formatCredits(c.toDateCredits)} in all, ${formatNumber(c.monthCredits)} this month.`}
      </p>
      {detail.contractors.length > 0 && (
        <ul aria-label="Contractors working now" className="flex flex-col divide-y rounded-sm border">
          {detail.contractors.map((x) => (
            <li key={x.id}>
              <Link href={paths.employee(x.id)} className="flex flex-col gap-1 px-4 py-3 text-ink transition-colors hover:bg-ground">
                <span className="flex items-center gap-2 font-medium">
                  <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-primary motion-reduce:animate-none" />
                  {x.role}
                </span>
                {x.brief && <span className="line-clamp-3 text-sm text-ink-body">{x.brief}</span>}
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

/** A kind of memory as a filter names it. */
const KIND_PLURAL: Record<MemoryKind, string> = {
  fact: "Facts",
  practice: "How it works here",
  preference: "Preferences",
  lesson: "Lessons",
};

/**
 * What it remembers: searchable, narrowed by kind, the newest ten and then "Show all"; its last review
 * and what changed in it under the entries.
 */
function MemoryPanel({ employee, tree }: { employee: Employee; tree: Tree | undefined }) {
  const includeArchived = employee.status === "released";
  const memory = useGetMemoryQuery({ id: employee.id, includeArchived });
  const changes = useGetMemoryChangesQuery(employee.id);
  const view = viewOf(memory);
  const changeView = viewOf(changes);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<MemoryKind | null>(null);
  const can = useCan(tree, employee.scope);
  const editable = can.build && !includeArchived && employee.kind === "employee";
  const changeList = changeView.kind === "loaded" ? changeView.data : [];
  const all = useMemo(() => (view.kind === "loaded" ? view.data : []), [view]);
  const words = search.trim().toLowerCase();
  const found = all.filter((e) => (!kind || e.kind === kind) && (!words || `${e.title} ${e.body}`.toLowerCase().includes(words)));
  // A long memory shows its newest entries and "Show all", so the page never runs to a wall of cards.
  const entries = useShowAll(found, 10, "entries");
  const kinds = MEMORY_KINDS.filter((k) => all.some((e) => e.kind === k));
  const searchId = useId();

  return (
    <section aria-label="Memory" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="memory-title" className={SECTION}>
          What {employee.name} remembers
        </h2>
        <p className="max-w-prose text-ink-body">
          {employee.kind === "contractor"
            ? "A contractor keeps no memory: what it learns goes to the employee who briefed it."
            : includeArchived
              ? "Archived when it was let go. A rehire brings all of it back."
              : `Written by ${employee.name} after each task and tidied at every review. You can read, correct or remove any of it.`}
        </p>
      </div>

      {all.length > 5 && (
        <div className="flex flex-col gap-2.5">
          <span className="relative flex">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <label htmlFor={searchId} className="sr-only">
              Search what {employee.name} remembers
            </label>
            <Input id={searchId} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${formatNumber(all.length)} entries`} className="pl-9" />
          </span>
          {kinds.length > 1 && (
            <div role="group" aria-label="Show entries of one kind" className="no-scrollbar flex flex-wrap gap-2 max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4">
              {[null, ...kinds].map((k) => {
                const n = k ? all.filter((e) => e.kind === k).length : all.length;
                return (
                  <button
                    key={k ?? "all"}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      "inline-flex min-h-touch shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm transition-colors",
                      kind === k ? "border-primary bg-primary-tint font-semibold text-primary-hover" : "bg-surface text-ink-body hover:bg-ground",
                    )}
                  >
                    {k ? KIND_PLURAL[k] : "All"}
                    <span className="tabular-nums text-ink-muted">{formatNumber(n)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

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
        ) : found.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            Nothing {employee.name} remembers matches
            {words ? ` “${search.trim()}”` : ""}
            {kind ? ` among ${KIND_PLURAL[kind].toLowerCase()}` : ""}.
          </p>
        ) : (
          <ul aria-label="Memory entries" className="flex flex-col divide-y overflow-hidden rounded-md border bg-surface shadow-card">
            {entries.shown.map((entry) => (
              <MemoryRow key={entry.id} entry={entry} employee={employee} tree={tree} changes={changeList} editable={editable} includeArchived={includeArchived} />
            ))}
          </ul>
        ))}
      {entries.control}

      {editable &&
        (adding ? (
          <MemoryForm employee={employee} includeArchived={includeArchived} onDone={() => setAdding(false)} />
        ) : (
          <Button variant="outline" className="self-start" onClick={() => setAdding(true)}>
            Add something {employee.name} should know
          </Button>
        ))}

      {employee.kind === "employee" && <ReviewPanel employee={employee} changes={changeView} onRetry={() => void changes.refetch()} editable={editable} />}

      {employee.kind === "employee" && <MemoryHistory changes={changeView} entries={all} onRetry={() => void changes.refetch()} />}
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

  if (editing)
    return (
      <li className="p-3">
        <MemoryForm employee={employee} entry={entry} includeArchived={includeArchived} onDone={() => setEditing(false)} />
      </li>
    );

  const confirmRemove = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      // No reason given is sent as none, so the log never quotes one that was not said (D28).
      await remove({
        id: employee.id,
        entryId: entry.id,
        why: why.trim() || null,
        includeArchived,
      }).unwrap();
    } catch (e) {
      setError(`It was not removed: ${describeError(e as never)}`);
    }
  };

  return (
    <li data-memory={entry.id} className={cn("flex flex-col gap-1 px-5 py-4 max-sm:px-4", pending && "opacity-70")}>
      <span className="font-semibold">{entry.title}</span>
      <span className="max-w-prose whitespace-pre-line text-ink-body">{entry.body}</span>
      <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
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
          <span className="-my-1 flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Correct
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
              Remove
            </Button>
          </span>
        )}
      </span>
      {removing && (
        <ConfirmCard
          label="Confirm removing"
          question={`Remove this from ${possessive(employee.name)} memory?`}
          confirm="Remove it"
          cancel="Keep it"
          busy={removeState.isLoading}
          onSubmit={(e) => void confirmRemove(e)}
          onCancel={() => setRemoving(false)}
          className="mt-2"
        >
          <label htmlFor={`why-${entry.id}`} className="text-sm font-medium text-ink">
            Why should {employee.name} forget this? (optional)
          </label>
          <Input id={`why-${entry.id}`} value={why} onChange={(e) => setWhy(e.target.value)} />
        </ConfirmCard>
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
      if (entry)
        await correct({
          id: employee.id,
          entryId: entry.id,
          title: title.trim(),
          body: body.trim(),
          kind,
          includeArchived,
        }).unwrap();
      else
        await add({
          id: employee.id,
          title: title.trim(),
          body: body.trim(),
          kind,
          includeArchived,
        }).unwrap();
      onDone();
    } catch (e) {
      setError(`${entry ? "The correction" : "It"} was not saved: ${describeError(e as never)}`);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label={entry ? "Correct this memory" : "Add to the memory"} className="flex w-full max-w-form flex-col gap-3 rounded-md border border-primary bg-surface p-4 shadow-card">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field id={`title-${id}`} label="In a few words" className="sm:col-span-2">
          <Input id={`title-${id}`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id={`kind-${id}`} label="Kind">
          <Select id={`kind-${id}`} value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
            {MEMORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {MEMORY_KIND[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id={`body-${id}`} label={`What ${employee.name} should remember`}>
        <Textarea id={`body-${id}`} value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={GROWING} />
      </Field>
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
      <h3 id="memory-history-title" className="text-base font-semibold">
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
            <ol aria-label="Changes to the memory" className="flex flex-col divide-y rounded-md border bg-surface">
              {(all ? changes.data : changes.data.slice(0, 8)).map((c) => {
                const title = memoryChangeTitle(c, entries);
                const why = memoryChangeWhy(c);
                return (
                  <li key={c.id} className="grid grid-cols-1 gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{memoryChangeLine(c)}</span>
                      {title ? `: ${title}` : ""}
                      {why && <span className="block text-xs text-ink-body">“{why}”</span>}
                    </span>
                    <span className="flex flex-wrap gap-x-3 text-xs text-ink-muted sm:justify-end">
                      <time dateTime={c.at} className="whitespace-nowrap">
                        {timeAgo(c.at)}
                      </time>
                      {c.runId && (
                        <Link href={paths.run(c.runId)} className="whitespace-nowrap rounded-xs text-primary-link hover:text-primary-hover">
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
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
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
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-3">
            {queued && (
              <Link href={paths.run(queued)} className="rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover">
                Review started — watch it
              </Link>
            )}
            <Button size="sm" variant="outline" onClick={() => void start()} disabled={state.isLoading || queued !== null}>
              Review now
            </Button>
          </div>
        )}
      </div>
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
      <span className="text-sm text-ink-body">
        {parts.join(", ")}.
        {last.runId && (
          <>
            {" "}
            <Link href={paths.run(last.runId)} className="rounded-xs font-medium text-primary-link hover:text-primary-hover">
              See the review
            </Link>
          </>
        )}
      </span>
    </p>
  );
}
