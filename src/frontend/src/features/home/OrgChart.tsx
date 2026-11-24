import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Bar } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { formatCredits, formatNumber, percent, timeAgo } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { Tree, TreeApp, TreeDivision, TreeProject, Worker } from "@/store/types";
import type { Selection } from "@/store/uiSlice";
import { accessChip, contractorsLabel, healthChip, runningChip, splitWorkers, stageChip, type Chip } from "./treeModel";

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

export function OrgChart({ tree, selection, onSelect }: Props) {
  const org = tree.organisation;
  if (!org) return null;
  return (
    <section aria-label="Organisation chart" className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 2xl:grid-cols-3">
      {tree.divisions.map((division, i) => (
        <DivisionColumn
          key={division.id}
          division={division}
          orgSlug={org.slug}
          orgName={org.name}
          tone={DIVISION_TONES[i % DIVISION_TONES.length] ?? DIVISION_TONES[0]}
          index={i}
          selection={selection}
          onSelect={onSelect}
        />
      ))}
    </section>
  );
}

function isActive(division: TreeDivision): boolean {
  const busy = (ws: Worker[]) => ws.some((w) => w.activity);
  return busy(division.workers) || division.projects.some((p) => p.progress !== null || busy(p.workers) || p.apps.some((a) => busy(a.workers)));
}

function DivisionColumn({
  division,
  orgSlug,
  orgName,
  tone,
  index,
  selection,
  onSelect,
}: {
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
  return (
    <div className={cn("flex min-w-0 flex-col", RISE, stagger(index + 2))}>
      <div
        className={cn(
          "relative flex items-center justify-between gap-3 rounded-md border bg-surface px-5 py-4 shadow-card",
          selected && "ring-2 ring-primary",
        )}
      >
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect({ scope, kind: "division", trail })}
          className="flex min-w-0 items-center gap-3.5 rounded-xs text-left after:absolute after:inset-0 after:rounded-md"
        >
          <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-xs font-display text-lg font-bold text-primary-ink", tone.badge)}>
            {division.name.trim()[0]?.toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-ink-muted">Division</span>
            <span className="truncate font-display text-lg font-semibold">{division.name}</span>
          </span>
        </button>
        <Badge tone={tone.chip} className="relative px-3 py-1 text-sm">
          {formatCredits(division.spend.monthCredits)}
        </Badge>
      </div>
      <div className={cn("relative ml-wire flex flex-col gap-3.5 border-l-2 pl-6 pt-4", tone.wire)}>
        {isActive(division) && (
          <span aria-hidden className={cn("absolute -left-1.5 size-2.5 animate-travel rounded-full ring-4 motion-reduce:hidden", tone.signal)} />
        )}
        {division.projects.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-strong bg-surface px-5 py-4 text-ink-muted">No projects in {division.name} yet.</p>
        ) : (
          division.projects.map((project) => (
            <ProjectCard key={project.id} project={project} scope={`${scope}/${project.slug}`} trail={[...trail, project.name]} selection={selection} onSelect={onSelect} />
          ))
        )}
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

function ProjectCard({ project, scope, trail, selection, onSelect }: { project: TreeProject; scope: string; trail: string[]; selection: Selection | null; onSelect: (s: Selection) => void }) {
  const selected = selection?.scope === scope && !selection.employeeId;
  const atVerdict = project.stage === "verdict";
  const workers = [...project.workers, ...project.apps.flatMap((a) => a.workers)];
  const unique = [...new Map(workers.map((w) => [w.id, w])).values()];
  const { employees, contractors } = splitWorkers(unique);
  const showStage = project.stage !== "live" || project.apps.length === 0;

  return (
    <article
      aria-label={project.name}
      className={cn(
        "relative flex flex-col gap-3 rounded-md px-5 py-4 transition duration-200 motion-reduce:transition-none",
        atVerdict ? "border-2 border-dashed border-attention-dash bg-attention-wash" : "border bg-surface shadow-card hover:-translate-y-0.5 hover:shadow-raised motion-reduce:hover:translate-y-0",
        selected && "ring-2 ring-primary",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect({ scope, kind: "project", trail })}
          className="rounded-xs text-left text-base font-semibold after:absolute after:inset-0 after:rounded-md"
        >
          {project.name}
        </button>
        <div className="relative flex flex-wrap items-center gap-1.5">
          {showStage && <ChipRow chips={[stageChip(project.stage)]} />}
          <span className="text-sm text-ink-muted">{formatCredits(project.spend.monthCredits)} this month</span>
        </div>
      </div>

      {project.note && <p className={atVerdict ? "text-attention-deep" : "text-ink-body"}>{project.note}</p>}

      {project.progress && (
        <div className="relative flex flex-col gap-2">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-medium">
              {project.progress.label}, step {project.progress.step} of {project.progress.of}
            </span>
            <span className="text-ink-muted">
              {project.progress.estimatedCredits !== null
                ? `${formatNumber(project.progress.spentCredits)} of an estimated ${formatCredits(project.progress.estimatedCredits)}`
                : `${formatCredits(project.progress.spentCredits)} so far`}
            </span>
          </div>
          <Bar
            live
            className="h-2.5"
            value={percent(project.progress.step, project.progress.of)}
            label={`${project.progress.label}: step ${project.progress.step} of ${project.progress.of}`}
          />
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

      {(employees.length > 0 || contractors) && (
        <div className="relative flex flex-wrap gap-2">
          {employees.map((w) => (
            <WorkerChip key={w.id} worker={w} selected={selection?.employeeId === w.id && selection.scope === scope} onSelect={() => onSelect({ scope, kind: "employee", trail: [...trail, w.name], employeeId: w.id })} />
          ))}
          {contractors && (
            <span className="inline-flex items-center gap-2 rounded-full border border-dashed border-violet-dash px-3 py-1 text-sm text-violet-deep">
              <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-violet-line border-t-violet motion-reduce:animate-none" />
              {contractorsLabel(contractors)}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function AppRow({ app }: { app: TreeApp }) {
  const chips = [healthChip(app.health), runningChip(app.running), accessChip(app.access, app.sharedWith)];
  return (
    <li className="flex flex-col gap-2 rounded-sm bg-ground px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={paths.app(app.id)} className="relative z-10 flex items-center gap-2 rounded-xs font-semibold text-ink hover:text-primary-hover">
          <Icon name="app" tinted className="size-4" />
          {app.name}
        </Link>
        <ChipRow chips={chips} />
      </div>
      <div className="flex flex-wrap gap-6">
        <Figure value={app.visitsToday !== null ? formatNumber(app.visitsToday) : app.lastVisitAt ? timeAgo(app.lastVisitAt) : "None yet"} label={app.visitsToday !== null ? "visits today" : "last visit"} />
        <Figure value={formatNumber(app.spend.monthCredits)} label="credits this month" />
      </div>
    </li>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-xl font-semibold">{value}</span>
      <span className="text-ink-muted">{label}</span>
    </div>
  );
}

function WorkerChip({ worker, selected, onSelect }: { worker: Worker; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      title={worker.activity ?? undefined}
      className={cn(
        "relative z-10 inline-flex min-h-touch items-center gap-2 rounded-full bg-ground py-1 pl-1 pr-3 text-sm transition-colors hover:bg-violet-tint",
        selected && "bg-violet-tint ring-2 ring-violet",
      )}
    >
      <Avatar name={worker.name} seed={worker.id} size="xs" />
      {worker.name} · {worker.role}
      {worker.activity && <span className="sr-only">, working: {worker.activity}</span>}
    </button>
  );
}
