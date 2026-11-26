import type { BadgeTone } from "@/components/ui/badge";
import type { IconName } from "@/components/iconNames";
import { capitalise, formatNumber, plural } from "@/lib/format";
import type { AppAccess, AppHealth, AppRunning, ProjectStage, Tree, TreeApp, Worker } from "@/store/types";
import type { Selection } from "@/store/uiSlice";

export interface Chip {
  label: string;
  tone: BadgeTone;
  icon?: IconName;
}

export function healthChip(health: AppHealth): Chip {
  switch (health) {
    case "healthy":
      return { label: "Healthy", tone: "success", icon: "health" };
    case "degraded":
      return { label: "Struggling", tone: "attention", icon: "health" };
    case "down":
      return { label: "Down", tone: "attention-strong", icon: "health" };
    default:
      return { label: "Health unknown", tone: "quiet", icon: "health" };
  }
}

/**
 * An app's chips on the chart. One the tree reports as starting with nothing ever measured has never been built (a
 * draft, or its first build under way): it is "Not built yet", not "Waking" and "Health unknown" (D30).
 */
export function appChips(app: Pick<TreeApp, "health" | "running" | "access" | "sharedWith" | "visitsToday" | "lastVisitAt">): Chip[] {
  if (app.running === "starting" && app.health === "unknown" && app.visitsToday === null && app.lastVisitAt === null) return [{ label: "Not built yet", tone: "quiet", icon: "build" }];
  return [healthChip(app.health), runningChip(app.running), accessChip(app.access, app.sharedWith)];
}

export function runningChip(running: AppRunning): Chip {
  switch (running) {
    case "always-on":
      return { label: "Always on", tone: "primary", icon: "always-on" };
    case "awake":
      return { label: "Awake", tone: "primary", icon: "always-on" };
    case "asleep":
      return { label: "Asleep", tone: "quiet", icon: "asleep" };
    case "starting":
      return { label: "Waking", tone: "primary", icon: "always-on" };
    default:
      return { label: "Paused", tone: "attention", icon: "asleep" };
  }
}

export function accessChip(access: AppAccess, sharedWith: number): Chip {
  if (access === "public") return { label: "Public", tone: "teal", icon: "public" };
  if (access === "shared") return { label: sharedWith > 0 ? `Shared with ${sharedWith}` : "Shared", tone: "violet", icon: "employee" };
  return { label: "Private", tone: "quiet", icon: "private" };
}

const STAGE_LABEL: Record<ProjectStage, string> = {
  idea: "Idea",
  researching: "Researching",
  verdict: "Idea · paused at verdict",
  planning: "Planning",
  building: "Building",
  evaluating: "Checking",
  reviewing: "Security review",
  publishing: "Publishing",
  live: "Live",
  paused: "Paused",
  dropped: "Dropped",
};

export function stageChip(stage: ProjectStage): Chip {
  const label = STAGE_LABEL[stage];
  if (stage === "verdict") return { label, tone: "attention-strong", icon: "verdict" };
  if (stage === "live") return { label, tone: "success", icon: "publish" };
  if (stage === "paused" || stage === "dropped") return { label, tone: "quiet" };
  if (stage === "researching" || stage === "idea") return { label, tone: "teal", icon: "research" };
  return { label, tone: "solid", icon: "build" };
}

export interface OrgCounts {
  divisions: number;
  projects: number;
  apps: number;
  employees: number;
}

/** Distinct named employees across the whole tree; contractors are not staff and are not counted. */
export function countTree(tree: Tree): OrgCounts {
  const employees = new Set<string>();
  const add = (workers: Worker[]) => workers.forEach((w) => w.kind === "employee" && employees.add(w.id));
  add(tree.organisation?.workers ?? []);
  let projects = 0;
  let apps = 0;
  for (const d of tree.divisions) {
    add(d.workers);
    for (const p of d.projects) {
      projects += 1;
      add(p.workers);
      for (const a of p.apps) {
        apps += 1;
        add(a.workers);
      }
    }
  }
  return { divisions: tree.divisions.length, projects, apps, employees: employees.size };
}

export function findApp(tree: Tree | undefined, appId: string): { app: TreeApp; trail: { label: string; scope: string }[] } | null {
  if (!tree?.organisation) return null;
  const org = tree.organisation;
  for (const d of tree.divisions) {
    for (const p of d.projects) {
      for (const a of p.apps) {
        if (a.id === appId) {
          return {
            app: a,
            trail: [
              { label: org.name, scope: org.slug },
              { label: d.name, scope: `${org.slug}/${d.slug}` },
              { label: p.name, scope: `${org.slug}/${d.slug}/${p.slug}` },
            ],
          };
        }
      }
    }
  }
  return null;
}

/** Names for a slug path, read from the tree; unknown segments fall back to the slug itself. */
export function namesFor(tree: Tree | undefined, scope: string | null): string[] {
  if (!scope) return [];
  const [orgSlug, divSlug, projSlug, appSlug] = scope.split("/");
  const names: string[] = [];
  const org = tree?.organisation;
  names.push(org && org.slug === orgSlug ? org.name : (orgSlug ?? ""));
  if (!divSlug) return names;
  const d = tree?.divisions.find((x) => x.slug === divSlug);
  names.push(d?.name ?? divSlug);
  if (!projSlug) return names;
  const p = d?.projects.find((x) => x.slug === projSlug);
  names.push(p?.name ?? projSlug);
  if (!appSlug) return names;
  names.push(p?.apps.find((x) => x.slug === appSlug)?.name ?? appSlug);
  return names;
}

/** Contractors on a node, grouped into one line: they are a burst, not a roster. */
export function splitWorkers(workers: Worker[]): { employees: Worker[]; contractors: { count: number; activity: string | null } | null } {
  const employees = workers.filter((w) => w.kind === "employee");
  const contractors = workers.filter((w) => w.kind === "contractor");
  if (contractors.length === 0) return { employees, contractors: null };
  return { employees, contractors: { count: contractors.length, activity: contractors.find((c) => c.activity)?.activity ?? null } };
}

export function contractorsLabel(c: { count: number; activity: string | null }): string {
  return c.activity ? `${plural(c.count, "contractor")} · ${c.activity}` : plural(c.count, "contractor");
}

export function organisationSelection(tree: Tree): Selection | null {
  const org = tree.organisation;
  return org ? { scope: org.slug, kind: "organisation", trail: [org.name] } : null;
}

/** Who is working anywhere in the tree right now, for the typing line under the conversation. */
export function activeWork(tree: Tree): { id: string; name: string; activity: string }[] {
  const out: { id: string; name: string; activity: string }[] = [];
  const seen = new Set<string>();
  const visit = (workers: Worker[]) => {
    for (const w of workers) {
      if (w.kind === "employee" && w.activity && !seen.has(w.id)) {
        seen.add(w.id);
        out.push({ id: w.id, name: w.name, activity: w.activity });
      }
    }
  };
  visit(tree.organisation?.workers ?? []);
  for (const d of tree.divisions) {
    visit(d.workers);
    for (const p of d.projects) {
      visit(p.workers);
      for (const a of p.apps) visit(a.workers);
    }
  }
  return out;
}

export function orgFigures(counts: OrgCounts, monthCredits: number): { value: string; label: string }[] {
  return [
    { value: formatNumber(counts.divisions), label: counts.divisions === 1 ? "division" : "divisions" },
    { value: formatNumber(counts.apps), label: counts.apps === 1 ? "app" : "apps" },
    { value: formatNumber(counts.employees), label: counts.employees === 1 ? "employee" : "employees" },
    { value: formatNumber(monthCredits), label: "credits this month" },
  ];
}

/**
 * "Kit · Engineer", or just the name when the name is the role (a standing hire named for its job). A contractor has no
 * name of its own (the runner names it after its step): it is its role, "Demand researcher · contractor" (D51).
 */
export function workerLabel(w: { name: string; role: string; kind?: Worker["kind"] }): string {
  if (isContractor(w)) return `${capitalise(w.role.trim() || "Contractor")} · contractor`;
  return w.name.trim().toLowerCase() === w.role.trim().toLowerCase() ? w.name : `${w.name} · ${w.role}`;
}

function isContractor(w: { name: string; kind?: Worker["kind"] }): boolean {
  return w.kind === "contractor" || /\(contractor\)\s*$/i.test(w.name);
}

/** What a worker is doing: its activity, or for a contractor the step it was named after ("Looked for evidence people will pay"). */
export function workerActivity(w: { name: string; activity: string | null; kind?: Worker["kind"] }): string | null {
  if (w.activity) return w.activity;
  return isContractor(w) ? w.name.replace(/\s*\(contractor\)\s*$/i, "").trim() || null : null;
}

/** A run's title prefix ("Change: …") as what a person is doing with it. */
const DOING: Record<string, string> = { build: "building", change: "making a change", research: "researching", "memory review": "reviewing what it remembers" };

/**
 * A worker's activity as a sentence (D82). An activity is usually a run's title ("Change: Show how many books…"), which
 * is no verb: "Theo is change: …" read wrongly. A known prefix becomes what they are doing, a gerund keeps "is", and
 * anything else follows the name ("Theo: …").
 */
export function activityLine(name: string, activity: string): string {
  const text = activity.trim();
  const prefixed = /^([A-Za-z][A-Za-z ]*?):\s+(.+)$/.exec(text);
  const doing = prefixed ? DOING[(prefixed[1] ?? "").toLowerCase()] : undefined;
  if (prefixed && doing) return `${name} is ${doing}: ${prefixed[2]}`;
  if (/^[A-Za-z]+ing\b/.test(text) && !/^(nothing|something|everything|thing)\b/i.test(text)) return `${name} is ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return `${name}: ${text}`;
}

/** A project's work under way: its title, and its step only once there is a plan to count ("step 0 of 0" never, D82). */
export function progressLine(progress: { label: string; step: number; of: number }): string {
  return progress.of > 0 ? `${progress.label}, step ${progress.step} of ${progress.of}` : progress.label;
}
