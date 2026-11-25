import type { BadgeTone } from "@/components/ui/badge";
import type { IconName } from "@/components/iconNames";
import { formatNumber, plural } from "@/lib/format";
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
