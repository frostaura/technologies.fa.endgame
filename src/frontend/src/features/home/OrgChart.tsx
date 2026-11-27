import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useViewport } from "@/lib/useViewport";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Disclosure } from "@/components/Fold";
import { Bar } from "@/components/states";
import { Chip as ChipView, PersonChip } from "@/components/ui/chip";
import { NO_VALUE, Stat, StatRow } from "@/components/ui/stat";
import { LINK } from "@/components/ui/layout";
import { Badge } from "@/components/ui/badge";
import { useShowAll } from "@/components/ui/page";
import { buttonVariants } from "@/components/ui/button";
import { formatCredits, formatNumber, headlineCredits, percent, plural, timeAgo } from "@/lib/format";
import { effectiveRole, roleRank } from "@/lib/roles";
import { useGetMeQuery } from "@/store/api";
import { useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { RISE, stagger } from "@/lib/motion";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { Tree, TreeApp, TreeDivision, TreeProject, Worker } from "@/store/types";
import type { Selection } from "@/store/uiSlice";
import { isArchived } from "../tree/treeManage";
import { useMasonry } from "./masonry";
import { activityLine, appChips, appNote, contractorsLabel, progressLine, saysSame, splitWorkers, stageChip, type Chip, workerLabel } from "./treeModel";

/**
 * The chart's geometry. A division column is never narrower than 20 rem on a tablet (so it still takes two) nor 24 rem on a desktop (so a card's figures and names keep their room), and the
 * chart takes as many columns as its width holds, up to four.
 */
const COLUMN = { min: 384, tablet: 320, gap: 24, max: 4 } as const;
/** How many of a division's projects the chart shows before "Show all". */
const PROJECTS_SHOWN = 6;

interface Props {
  tree: Tree;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}

/** Where "Manage" goes for a node: the management screen, scoped to it, in the organisation being shown. */
function useManageHref(): (scope: string) => string {
  const active = useActiveOrganisation();
  const entered = active.entered ? active.organisation?.slug : undefined;
  return (scope) => paths.manage(scope, entered);
}

/** "Add a division", for an Admin or the Owner: the chart's header row carries it as a quiet action. */
export function AddDivision({ tree }: { tree: Tree }) {
  const manage = useManageHref();
  const me = useGetMeQuery(undefined);
  const org = tree.organisation;
  if (!org || roleRank(effectiveRole(tree, me.data, org.slug)) < roleRank("admin")) return null;
  return (
    <Link href={`${manage(org.slug)}&add=1`} className={buttonVariants({ variant: "quiet", size: "sm" })}>
      <Plus aria-hidden className="size-4" />
      Add a division
    </Link>
  );
}

/** How tall a division will draw, before it is measured: its header, and a card's worth for each project and app. */
function estimate(division: TreeDivision): number {
  let h = 88 + (division.workers.length > 0 ? 54 : 0);
  for (const p of division.projects.slice(0, PROJECTS_SHOWN)) h += 120 + p.apps.length * 150 + (p.progress ? 70 : 0) + (p.workers.length > 0 ? 54 : 0);
  return h;
}

export function OrgChart({ tree, selection, onSelect }: Props) {
  const org = tree.organisation;
  const manage = useManageHref();
  const live = tree.divisions.filter((d) => !isArchived(d));
  const archived = tree.divisions.filter((d) => isArchived(d));
  if (!org) return null;
  const draw = (division: TreeDivision, i: number, lone = false, still = false) => (
    <DivisionColumn key={division.id} division={division} orgSlug={org.slug} orgName={org.name} index={i} wide={lone} still={still} selection={selection} onSelect={onSelect} manage={manage} />
  );
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Organisation chart">
        {/* A lone division takes the whole width, its projects side by side, rather than leaving the rest of the page empty. */}
        {live.length === 1 && live[0] ? draw(live[0], 0, true) : <Masonry divisions={live} draw={(d, i, still) => draw(d, i, false, still)} />}
      </section>
      {archived.length > 0 && (
        <Disclosure title={`Archived (${archived.length})`} summary={archived.map((d) => d.name).join(", ")}>
          <section aria-label="Archived divisions">
            <Masonry divisions={archived} draw={(d, i, still) => draw(d, live.length + i, false, still)} />
          </section>
        </Disclosure>
      )}
    </div>
  );
}

/** Divisions as columns: each stacks under whichever column is shortest, so no column leaves a hole and none runs on alone. */
function Masonry({ divisions, draw }: { divisions: TreeDivision[]; draw: (d: TreeDivision, i: number, still: boolean) => ReactNode }) {
  const viewport = useViewport();
  // A division already on screen that the balancing moves to another column is drawn anew there: it appears in place,
  // without rising in again as if it had just arrived.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const ids = divisions.map((d) => d.id).join(",");
  useEffect(() => {
    const t = window.setTimeout(() => setSeen(new Set(ids.split(","))), 1000);
    return () => window.clearTimeout(t);
  }, [ids]);
  const { container, columns, measure } = useMasonry(divisions, (d) => d.id, estimate, { min: viewport === "desktop" ? COLUMN.min : COLUMN.tablet, gap: COLUMN.gap, max: viewport === "phone" ? 1 : COLUMN.max });
  return (
    <div ref={container} data-columns={columns.length} className="flex items-start gap-6">
      {columns.map((column, c) => (
        <div key={c} data-chart-column="" className="flex min-w-0 flex-1 flex-col gap-6">
          {column.map((d) => (
            <div key={d.id} ref={measure(d.id)} className="min-w-0">
              {draw(d, divisions.indexOf(d), seen.has(d.id))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DivisionColumn({
  division,
  orgSlug,
  orgName,
  index,
  wide,
  still,
  selection,
  onSelect,
  manage,
}: {
  manage: (scope: string) => string;
  wide: boolean;
  still: boolean;
  division: TreeDivision;
  orgSlug: string;
  orgName: string;
  index: number;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const scope = `${orgSlug}/${division.slug}`;
  const trail = [orgName, division.name];
  const selected = selection?.scope === scope && !selection.employeeId;
  const archived = isArchived(division);
  // A phone folds each division to its header, the first one open: the whole organisation reads in a screen or two.
  const phone = useViewport() === "phone";
  const [open, setOpen] = useState(index === 0);
  const folded = phone && !open;
  const bodyId = useId();
  const body = useRef<HTMLDivElement>(null);
  // Something inside asked to be shown (the academy pointing at a project in a folded division): open.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const reveal = () => setOpen(true);
    el.addEventListener("endgame:reveal", reveal);
    return () => el.removeEventListener("endgame:reveal", reveal);
  }, []);
  const projects = division.projects;
  // A division with many projects shows its first few on the chart and "Show all": one long division never strands the rest.
  const { shown, control } = useShowAll(projects, PROJECTS_SHOWN, "projects");
  const hasWorkers = division.workers.length > 0;
  return (
    <div className={cn("flex min-w-0 flex-col", !still && RISE, !still && stagger(index + 2))}>
      <div
        data-archived={archived || undefined}
        data-division-header=""
        className={cn(
          "relative flex items-center gap-3 rounded-md border bg-surface px-5 py-4 shadow-card max-sm:px-4 max-sm:py-3",
          archived && "bg-ground shadow-none",
          selected && "ring-2 ring-primary",
        )}
      >
        <button
          type="button"
          aria-pressed={selected}
          // A part the person holds no role in is drawn on the way to theirs, but is not theirs to open.
          disabled={division.role === null}
          title={division.role === null ? "You hold no role here" : division.name}
          onClick={() => onSelect({ scope, kind: "division", trail })}
          className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xs text-left max-sm:gap-3 after:absolute after:inset-0 after:rounded-md disabled:cursor-default"
        >
          {/* The division's letter, in ink: one look for every division (ARCH-011's single accent). */}
          <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-xs font-display text-lg font-bold max-sm:size-8 max-sm:text-base", archived ? "bg-quiet text-ink-muted" : "bg-ink text-surface")}>
            {division.name.trim()[0]?.toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 gap-x-1 whitespace-nowrap text-xs text-ink-muted">
              <span>{phone ? plural(division.projects.length, "project") : "Division"}</span>
              <span aria-hidden>·</span>
              <span className="whitespace-nowrap">{formatCredits(division.spend.monthCredits)}</span>
            </span>
            {/* Two lines at most, the whole name in the tooltip: a long name never stacks four lines high (console-small 12). */}
            <span data-division-name="" className="line-clamp-2 break-words font-display text-lg font-semibold leading-snug max-sm:text-base">
              {division.name}
            </span>
          </span>
        </button>
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          {archived && <Badge tone="neutral">Archived</Badge>}
          {division.role !== null && (
            // A phone says Manage with its mark, so the name keeps the row's width.
            <Link href={manage(scope)} aria-label={`Manage ${division.name}`} title="Manage" className={buttonVariants({ variant: "quiet", size: phone ? "icon" : "sm" })}>
              {phone ? <Icon name="organisation" className="size-5" /> : "Manage"}
            </Link>
          )}
          {phone && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={open ? `Fold ${division.name}` : `Show what is in ${division.name}`}
              onClick={() => setOpen((x) => !x)}
              className="flex min-h-touch min-w-touch items-center justify-center rounded-xs text-ink-muted hover:bg-ground"
            >
              <ChevronDown aria-hidden className={cn("size-5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
      <div id={bodyId} ref={body} data-fold-body="" className={folded ? "hidden" : "contents"}>
        {wide ? (
          <div className="ml-wire flex flex-col gap-3.5 border-l-2 border-border-strong pl-6 pt-4 max-sm:ml-4 max-sm:pl-3">
            {hasWorkers && <Workers workers={division.workers} scope={scope} trail={trail} selection={selection} onSelect={onSelect} />}
            {projects.length === 0 ? (
              <p data-state="empty" className="px-1 py-2 text-ink-muted">No projects in {division.name} yet.</p>
            ) : (
              <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-2 2xl:grid-cols-3">
                {projects.map((project) => (
                  <ProjectCard key={project.id} project={project} scope={`${scope}/${project.slug}`} trail={[...trail, project.name]} selection={selection} onSelect={onSelect} manage={manage} />
                ))}
              </div>
            )}
          </div>
        ) : (
          // One wire per division: every project hangs off it with the same node, and it ends at the last one.
          <ol aria-label={`In ${division.name}`} className="ml-wire flex flex-col max-sm:ml-4">
            {hasWorkers && (
              <Branch at="chips" last={projects.length === 0}>
                <Workers workers={division.workers} scope={scope} trail={trail} selection={selection} onSelect={onSelect} />
              </Branch>
            )}
            {projects.length === 0 ? (
              <Branch at="chips" last>
                <p data-state="empty" className="flex min-h-touch items-center text-ink-muted">
                  No projects in {division.name} yet.
                </p>
              </Branch>
            ) : (
              shown.map((project, i) => (
                <Branch key={project.id} at="card" last={!control && i === shown.length - 1}>
                  <ProjectCard project={project} scope={`${scope}/${project.slug}`} trail={[...trail, project.name]} selection={selection} onSelect={onSelect} manage={manage} />
                </Branch>
              ))
            )}
            {control && (
              <Branch at="chips" last>
                {control}
              </Branch>
            )}
          </ol>
        )}
      </div>
    </div>
  );
}

/**
 * One thing hanging off a division's wire: the wire runs past it (or stops at it, the last), and a
 * node and a short stub join it at its first line — a card's title row, or a row of people.
 */
function Branch({ at, last, children }: { at: "card" | "chips"; last: boolean; children: ReactNode }) {
  return (
    <li data-branch={at} className="relative pl-6 pt-2.5 max-sm:pl-3">
      <span aria-hidden data-wire="" className={cn("absolute left-0 top-0 w-0.5 bg-border-strong", last ? (at === "card" ? "h-12" : "h-8") : "bottom-0")} />
      <span aria-hidden data-node="" className={cn("absolute -left-1 flex w-7 -translate-y-1/2 items-center max-sm:w-4", at === "card" ? "top-12" : "top-8")}>
        <span className="size-2.5 shrink-0 rounded-full bg-border-strong" />
        <span className="h-0.5 flex-1 bg-border-strong" />
      </span>
      {children}
    </li>
  );
}

function ChipRow({ chips }: { chips: Chip[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <Badge key={chip.label} tone={chip.tone}>
          {chip.label}
        </Badge>
      ))}
    </div>
  );
}

function ProjectCard({ project, scope, trail, selection, onSelect, manage }: { project: TreeProject; scope: string; trail: string[]; selection: Selection | null; onSelect: (s: Selection) => void; manage: (scope: string) => string }) {
  const selected = selection?.scope === scope && !selection.employeeId;
  const archived = isArchived(project);
  const atVerdict = project.stage === "verdict";
  const workers = [...project.workers, ...project.apps.flatMap((a) => a.workers)];
  const unique = [...new Map(workers.map((w) => [w.id, w])).values()];
  const { employees, contractors } = splitWorkers(unique);
  const showStage = project.stage !== "live" || project.apps.length === 0;
  // A project that is one app of the same name: the app's row is the project's body, its name and spend said once.
  const only = project.apps.length === 1 ? project.apps[0] : undefined;
  const merged = !!only && only.name.trim().toLowerCase() === project.name.trim().toLowerCase() && only.spend.monthCredits === project.spend.monthCredits;
  const tag = archived ? <Badge tone="neutral">Archived</Badge> : showStage ? <ChipRow chips={[stageChip(project.stage)]} /> : null;
  // One reason, said once at the project (console-desktop 59): when an app inside says the same thing ("Paused: …"), the
  // fuller of the two wordings stands for both, and the app's tile does not repeat it.
  const ownNote = project.note ?? project.notBuilt?.note ?? null;
  const echoed = ownNote ? project.apps.map((a) => appNote(a)).filter((n): n is string => !!n && saysSame(ownNote, n)) : [];
  const projectNote = ownNote ? [ownNote, ...echoed].reduce((a, b) => (b.length > a.length ? b : a)) : null;

  return (
    <article
      aria-label={project.name}
      className={cn(
        "relative flex flex-col gap-3 rounded-md px-5 py-4 transition duration-200 motion-reduce:transition-none max-sm:px-4",
        archived ? "border bg-ground" : "border bg-surface shadow-card hover:-translate-y-0.5 hover:shadow-raised motion-reduce:hover:translate-y-0",
        selected && "ring-2 ring-primary",
      )}
    >
      {/* Every card's head is the same two lines: its name and Manage, then its stage and its spend. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-pressed={selected}
            disabled={project.role === null}
            title={project.role === null ? "You hold no role here" : project.name}
            onClick={() => onSelect({ scope, kind: "project", trail })}
            className="min-h-touch min-w-0 rounded-xs text-left text-base font-semibold leading-snug after:absolute after:inset-0 after:rounded-md disabled:cursor-default"
          >
            <span className="line-clamp-2 break-words">{project.name}</span>
          </button>
          {project.role !== null && (
            <Link href={manage(scope)} aria-label={`Manage ${project.name}`} className={cn(buttonVariants({ variant: "quiet", size: "sm" }), "relative z-10 shrink-0")}>
              Manage
            </Link>
          )}
        </div>
        {(tag || !merged) && (
          <div className="relative z-10 flex flex-wrap items-center gap-x-2 gap-y-1">
            {tag}
            {!merged && <span className="text-sm text-ink-muted">{headlineCredits(project.spend.monthCredits)} this month</span>}
          </div>
        )}
      </div>

      {projectNote && <p className="text-ink-body">{projectNote}</p>}

      {project.progress && (
        <div className="relative flex flex-col gap-2">
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
            <span className="font-medium">{progressLine(project.progress)}</span>
            <span className="text-ink-muted">
              {/* Never "0 of an estimated 0" (R2-9): no estimate yet reads as what has been spent. */}
              {project.progress.estimatedCredits !== null && project.progress.estimatedCredits > 0
                ? `${formatNumber(project.progress.spentCredits)} of an estimated ${formatCredits(project.progress.estimatedCredits)}`
                : `${formatCredits(project.progress.spentCredits)} so far`}
            </span>
          </div>
          {project.progress.of > 0 && <Bar live className="h-2.5" value={percent(project.progress.done ?? project.progress.step, project.progress.of)} label={progressLine(project.progress)} />}
          <Link href={paths.run(project.progress.runId)} className={cn(LINK, "relative z-10 flex min-h-touch items-center self-start")}>
            Watch the work
          </Link>
        </div>
      )}

      {atVerdict && project.ideaId && (
        <Link href={paths.idea(project.ideaId)} className={cn(LINK, "relative z-10 flex min-h-touch items-center self-start")}>
          Read the verdict
        </Link>
      )}

      {project.apps.length > 0 && (
        <ul aria-label={`Apps in ${project.name}`} className="relative flex flex-col gap-2">
          {project.apps.map((app) => (
            <AppRow key={app.id} app={app} merged={merged} saidAbove={!!projectNote && saysSame(projectNote, appNote(app))} />
          ))}
        </ul>
      )}

      {(employees.length > 0 || contractors) && <Workers workers={unique} scope={scope} trail={trail} selection={selection} onSelect={onSelect} />}
    </article>
  );
}

function AppRow({ app, merged, saidAbove }: { app: TreeApp; merged: boolean; saidAbove: boolean }) {
  const archived = isArchived(app);
  const chips: Chip[] = archived ? [{ label: "Archived", tone: "neutral" }] : appChips(app);
  const unmeasured = app.visitsToday === null && !app.lastVisitAt;
  const unbuilt = !archived && chips.some((c) => c.label.startsWith("Not built"));
  // Why it is paused is said once: by its project, when the project says it (console-desktop 59).
  const note = archived || saidAbove ? null : appNote(app);
  return (
    <li className="flex flex-col gap-2 rounded-sm bg-ground px-4 py-3 max-sm:px-3">
      {merged ? (
        // The project is this app: its tags, and the way to its page, without saying its name twice. The way in keeps
        // one place in every tile, the top right, with the tags flowing beside it and then under it (console-desktop 60).
        <div data-app-head="" className="flow-root">
          {unbuilt ? (
            // Nothing is published yet, so there is nothing to open: said plainly, not offered as a link.
            <span data-app-open="" className="float-right ml-3 flex min-h-touch items-center text-sm text-ink-muted">
              No version yet
            </span>
          ) : (
            <Link data-app-open="" href={paths.app(app.id)} title={app.name} className={cn(LINK, "relative z-10 float-right ml-3 flex min-h-touch items-center gap-1.5 text-sm")}>
              <Icon name="app" className="size-4" />
              Open the app
            </Link>
          )}
          {/* Inline, so the tags run beside the way in and then under it at the full width, never a column of one tag a row. */}
          <span className="block pt-2">
            {chips.map((chip) => (
              <Badge key={chip.label} tone={chip.tone} className="mb-1.5 mr-1.5 align-middle">
                {chip.label}
              </Badge>
            ))}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Link href={paths.app(app.id)} className="relative z-10 flex min-h-touch min-w-0 items-center gap-2 self-start rounded-xs font-semibold text-ink hover:text-primary-hover">
            <Icon name="app" className="size-4 shrink-0" />
            <span className="min-w-0 break-words">{app.name}</span>
          </Link>
          <ChipRow chips={chips} />
        </div>
      )}
      {note && <p className="text-sm text-ink-body">{note}</p>}
      {/*
        Two figures, always side by side, each label one short line so the values sit level at every width (console-desktop
        58): the period is the credits' caption. Null visits means nothing has been measured yet: unknown, never zero — "—",
        with why under it.
      */}
      <StatRow cols={2}>
        <Stat
          plain
          label={app.visitsToday !== null || !app.lastVisitAt ? "Visits today" : "Last visit"}
          value={app.visitsToday !== null ? formatNumber(app.visitsToday) : app.lastVisitAt ? timeAgo(app.lastVisitAt) : NO_VALUE}
          tone={unmeasured ? "muted" : "ink"}
          caption={unmeasured ? "Not measured" : undefined}
        />
        <Stat plain label="Credits" value={formatNumber(app.spend.monthCredits)} caption="This month" />
      </StatRow>
    </li>
  );
}

/** Three dots that rise in turn: someone is at work. */
function WorkingDots() {
  return (
    <span aria-hidden className="flex shrink-0 gap-1">
      <span className="size-1.5 animate-bob rounded-full bg-primary motion-reduce:animate-none" />
      <span className="size-1.5 animate-bob rounded-full bg-primary animate-delay-1 motion-reduce:animate-none" />
      <span className="size-1.5 animate-bob rounded-full bg-primary animate-delay-2 motion-reduce:animate-none" />
    </span>
  );
}

/**
 * The people on a node: each employee as a chip, with what it is doing now; contractors as one
 * spinning chip, since they are a burst and not a roster. Selecting a chip scopes the conversation
 * to that employee.
 */
export function Workers({ workers, scope, trail, selection, onSelect }: { workers: Worker[]; scope: string; trail: string[]; selection: Selection | null; onSelect: (s: Selection) => void }) {
  const { employees, contractors } = splitWorkers(workers);
  const busy = employees.filter((w) => w.activity && w.status !== "paused");
  return (
    <div className="relative flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {employees.map((w) => (
          <WorkerChip key={w.id} worker={w} selected={selection?.employeeId === w.id && selection.scope === scope} onSelect={() => onSelect({ scope, kind: "employee", trail: [...trail, w.name], employeeId: w.id })} />
        ))}
        {contractors && (
          <ChipView className="min-h-touch" icon={<span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-primary motion-reduce:animate-none" />}>
            {contractorsLabel(contractors)}
          </ChipView>
        )}
      </div>
      {busy.map((w) => (
        <span key={w.id} className="flex items-center gap-2 text-sm text-ink-muted">
          <WorkingDots />
          {activityLine(w.name, w.activity ?? "")}
        </span>
      ))}
    </div>
  );
}

function WorkerChip({ worker, selected, onSelect }: { worker: Worker; selected: boolean; onSelect: () => void }) {
  return (
    <PersonChip
      name={worker.name}
      id={worker.id}
      label={workerLabel(worker)}
      selected={selected}
      onSelect={onSelect}
      title={worker.activity ?? workerLabel(worker)}
      after={
        <>
          {worker.status === "paused" && <Badge tone="warn">Paused</Badge>}
          {worker.idle && <Badge tone="neutral">Nothing to do</Badge>}
          {worker.activity && <span className="sr-only">, working: {worker.activity}</span>}
        </>
      }
    />
  );
}
