import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useViewport } from "@/lib/useViewport";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Bar } from "@/components/states";
import { Chip as ChipView, PersonChip } from "@/components/ui/chip";
import { NO_VALUE, Stat } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCredits, formatNumber, headlineCredits, headlineNumber, percent, plural, timeAgo } from "@/lib/format";
import { effectiveRole, roleRank } from "@/lib/roles";
import { useGetMeQuery } from "@/store/api";
import { useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { RISE, stagger } from "@/lib/motion";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { Tree, TreeApp, TreeDivision, TreeProject, Worker } from "@/store/types";
import type { Selection } from "@/store/uiSlice";
import { TypingDots } from "./ConversationDock";
import { isArchived } from "../tree/treeManage";
import { activityLine, appChips, appNote, contractorsLabel, progressLine, splitWorkers, stageChip, type Chip, workerLabel } from "./treeModel";

/** Each division takes the next hue in turn, as the design draws Technologies blue and Labs violet. */
const DIVISION_TONES = [
  { badge: "bg-primary", chip: "primary", wire: "border-primary-line", signal: "bg-primary ring-primary/20" },
  { badge: "bg-violet", chip: "violet", wire: "border-violet-line", signal: "bg-violet ring-violet/20" },
  { badge: "bg-teal", chip: "teal", wire: "border-teal/30", signal: "bg-teal ring-teal/20" },
] as const;

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

export function OrgChart({ tree, selection, onSelect }: Props) {
  const org = tree.organisation;
  const manage = useManageHref();
  const me = useGetMeQuery(undefined);
  if (!org) return null;
  // A lone division takes the whole width, its projects side by side, rather than leaving half the page empty.
  const lone = tree.divisions.length === 1;
  const mayAddDivision = roleRank(effectiveRole(tree, me.data, org.slug)) >= roleRank("admin");
  return (
    <section aria-label="Organisation chart" className={cn("grid grid-cols-1 items-start gap-6", !lone && "md:grid-cols-2 2xl:grid-cols-3")}>
      {tree.divisions.map((division, i) => (
        <DivisionColumn
          key={division.id}
          division={division}
          orgSlug={org.slug}
          orgName={org.name}
          tone={DIVISION_TONES[i % DIVISION_TONES.length] ?? DIVISION_TONES[0]}
          index={i}
          wide={lone}
          selection={selection}
          onSelect={onSelect}
          manage={manage}
        />
      ))}
      {mayAddDivision && (
        <Link href={`${manage(org.slug)}&add=1`} className={cn(buttonVariants({ variant: "soft" }), "min-h-16 justify-start gap-3 rounded-md px-5", RISE)}>
          <Icon name="division" tinted />
          Add a division
        </Link>
      )}
    </section>
  );
}


function DivisionColumn({
  division,
  orgSlug,
  orgName,
  tone,
  index,
  wide,
  selection,
  onSelect,
  manage,
}: {
  manage: (scope: string) => string;
  wide: boolean;
  division: TreeDivision;
  orgSlug: string;
  orgName: string;
  tone: (typeof DIVISION_TONES)[number];
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
  const apps = division.projects.reduce((n, p) => n + p.apps.length, 0);
  return (
    <div className={cn("flex min-w-0 flex-col", RISE, stagger(index + 2))}>
      <div
        data-archived={archived || undefined}
        className={cn(
          "relative flex items-center justify-between gap-3 rounded-md border bg-surface px-5 py-4 shadow-card max-sm:flex-wrap max-sm:gap-y-2 max-sm:px-4 max-sm:py-3",
          archived && "bg-ground shadow-none",
          selected && "ring-2 ring-primary",
        )}
      >
        <button
          type="button"
          aria-pressed={selected}
          // A part the person holds no role in is drawn on the way to theirs, but is not theirs to open.
          disabled={division.role === null}
          title={division.role === null ? "You hold no role here" : undefined}
          onClick={() => onSelect({ scope, kind: "division", trail })}
          className="flex min-w-0 items-center gap-3.5 rounded-xs text-left after:absolute after:inset-0 after:rounded-md disabled:cursor-default"
        >
          <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-xs font-display text-lg font-bold text-primary-ink", tone.badge)}>
            {division.name.trim()[0]?.toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-ink-muted">Division{phone && ` · ${plural(division.projects.length, "project")}, ${plural(apps, "app")}`}</span>
            <span className="truncate font-display text-lg font-semibold max-sm:whitespace-normal max-sm:break-words">{division.name}</span>
          </span>
        </button>
        <div className="relative z-10 flex flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:justify-start">
          {archived && <Badge tone="neutral">Archived</Badge>}
          <Badge tone="neutral" className="px-3 py-1 text-sm">
            {formatCredits(division.spend.monthCredits)}
          </Badge>
          {division.role !== null && (
            <Link href={manage(scope)} aria-label={`Manage ${division.name}`} className="flex min-h-touch items-center rounded-xs px-2 text-sm text-primary-link hover:text-primary-hover">
              Manage
            </Link>
          )}
          {phone && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={open ? `Fold ${division.name}` : `Show what is in ${division.name}`}
              onClick={() => setOpen((x) => !x)}
              className="ml-auto flex min-h-touch min-w-touch items-center justify-center rounded-xs text-ink-muted hover:bg-ground"
            >
              <ChevronDown aria-hidden className={cn("size-5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
      <div id={bodyId} ref={body} data-fold-body="" className={folded ? "hidden" : "contents"}>
      {division.workers.length > 0 && (
        <div className="ml-wire border-l-2 border-transparent pl-6 pt-3 max-sm:ml-4 max-sm:pl-3">
          <Workers workers={division.workers} scope={scope} trail={trail} selection={selection} onSelect={onSelect} />
        </div>
      )}
      <div className={cn("relative ml-wire gap-3.5 border-l-2 pl-6 pt-4 max-sm:ml-4 max-sm:pl-3 max-sm:pt-3", wide ? "grid grid-cols-1 items-start lg:grid-cols-2 2xl:grid-cols-3" : "flex flex-col", tone.wire)}>
        {division.projects.length === 0 ? (
          <p data-state="empty" className="px-1 py-2 text-ink-muted lg:col-span-2">No projects in {division.name} yet.</p>
        ) : (
          division.projects.map((project) => (
            <ProjectCard key={project.id} project={project} scope={`${scope}/${project.slug}`} trail={[...trail, project.name]} selection={selection} onSelect={onSelect} manage={manage} />
          ))
        )}
      </div>
      </div>
    </div>
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

  return (
    <article
      aria-label={project.name}
      className={cn(
        "relative flex flex-col gap-3 rounded-md px-5 py-4 transition duration-200 motion-reduce:transition-none max-sm:px-4",
        archived ? "border bg-ground" : "border bg-surface shadow-card hover:-translate-y-0.5 hover:shadow-raised motion-reduce:hover:translate-y-0",
        selected && "ring-2 ring-primary",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-pressed={selected}
          disabled={project.role === null}
          title={project.role === null ? "You hold no role here" : undefined}
          onClick={() => onSelect({ scope, kind: "project", trail })}
          className="rounded-xs text-left text-base font-semibold after:absolute after:inset-0 after:rounded-md disabled:cursor-default"
        >
          {project.name}
        </button>
        <div className="relative z-10 flex flex-wrap items-center gap-1.5">
          {archived ? <Badge tone="neutral">Archived</Badge> : showStage && <ChipRow chips={[stageChip(project.stage)]} />}
          <span className="text-sm text-ink-muted">{headlineCredits(project.spend.monthCredits)} this month</span>
          {project.role !== null && (
            <Link href={manage(scope)} aria-label={`Manage ${project.name}`} className="flex min-h-touch items-center rounded-xs px-2 text-sm text-primary-link hover:text-primary-hover">
              Manage
            </Link>
          )}
        </div>
      </div>

      {(project.note ?? project.notBuilt?.note) && <p className="text-ink-body">{project.note ?? project.notBuilt?.note}</p>}

      {project.progress && (
        <div className="relative flex flex-col gap-2">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-medium">{progressLine(project.progress)}</span>
            <span className="text-ink-muted">
              {/* Never "0 of an estimated 0" (R2-9): no estimate yet reads as what has been spent. */}
              {project.progress.estimatedCredits !== null && project.progress.estimatedCredits > 0
                ? `${formatNumber(project.progress.spentCredits)} of an estimated ${formatCredits(project.progress.estimatedCredits)}`
                : `${formatCredits(project.progress.spentCredits)} so far`}
            </span>
          </div>
          {project.progress.of > 0 && <Bar live className="h-2.5" value={percent(project.progress.done ?? project.progress.step, project.progress.of)} label={progressLine(project.progress)} />}
          <Link href={paths.run(project.progress.runId)} className="relative z-10 self-start rounded-xs font-semibold text-primary-link hover:text-primary-hover">
            Watch the work
          </Link>
        </div>
      )}

      {atVerdict && project.ideaId && (
        <Link href={paths.idea(project.ideaId)} className="relative z-10 self-start rounded-xs font-semibold text-primary-link hover:text-primary-hover">
          Read the verdict
        </Link>
      )}

      {project.apps.length > 0 && (
        <ul aria-label={`Apps in ${project.name}`} className="relative flex flex-col gap-2">
          {project.apps.map((app) => (
            <AppRow key={app.id} app={app} />
          ))}
        </ul>
      )}

      {(employees.length > 0 || contractors) && <Workers workers={unique} scope={scope} trail={trail} selection={selection} onSelect={onSelect} />}
    </article>
  );
}

function AppRow({ app }: { app: TreeApp }) {
  const archived = isArchived(app);
  const chips: Chip[] = archived ? [{ label: "Archived", tone: "neutral" }] : appChips(app);
  return (
    <li className="flex flex-col gap-2 rounded-sm bg-ground px-4 py-3 max-sm:px-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={paths.app(app.id)} className="relative z-10 flex items-center gap-2 rounded-xs font-semibold text-ink hover:text-primary-hover touch:min-h-touch">
          <Icon name="app" tinted className="size-4" />
          {app.name}
        </Link>
        <ChipRow chips={chips} />
      </div>
      {!archived && appNote(app) && <p className="text-sm text-ink-body">{appNote(app)}</p>}
      {/* Two figures, always side by side. Null visits means nothing has been measured yet: unknown, never zero — "—", with why under it. */}
      <div className="grid grid-cols-2 gap-4">
        <Stat
          plain
          label={app.visitsToday !== null || !app.lastVisitAt ? "Visits today" : "Last visit"}
          value={app.visitsToday !== null ? formatNumber(app.visitsToday) : app.lastVisitAt ? timeAgo(app.lastVisitAt) : NO_VALUE}
          tone={app.visitsToday === null && !app.lastVisitAt ? "muted" : "ink"}
          caption={app.visitsToday === null && !app.lastVisitAt ? "Not measured yet" : undefined}
        />
        <Stat plain label="Credits this month" value={headlineNumber(app.spend.monthCredits)} />
      </div>
    </li>
  );
}

/**
 * The people on a node: each employee as a chip in its own colour, with what it is doing now;
 * contractors as one spinning line, since they are a burst and not a roster. Selecting a chip
 * scopes the conversation to that employee.
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
          <TypingDots />
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
