import type { BadgeTone } from "@/components/ui/badge";
import type { Mode } from "@/features/runs/runModel";
import type { EmployeeStatus, HireTrigger, MemoryChange, MemoryEntry, MemoryKind, Tree } from "@/store/types";

/**
 * The workforce in plain words. Normal mode never names a model, a tool's internal name or the
 * platform's plumbing: a model tier is "thinking power", a tool is what it lets the employee do.
 * Technical mode shows the real names alongside.
 */

/** A model tier (a routing-table task type) as thinking power. */
export function tierLabel(tier: string | null, mode: Mode): string {
  const plain = plainTier(tier);
  return mode === "technical" && tier ? `${plain} (${tier})` : plain;
}

function plainTier(tier: string | null): string {
  if (!tier) return "Standard";
  const t = tier.toLowerCase();
  if (/t3|architect|frontier/.test(t)) return "Strongest, for the hardest problems";
  if (/t2/.test(t)) return "Stronger, for larger pieces of building";
  if (/build|code|t1/.test(t)) return "Strong, for building";
  if (/research|review|verdict|plan|evaluat/.test(t)) return "Standard, for reading and judging";
  if (/chat|classif|summar|extract|conversation/.test(t)) return "Light, for quick answers";
  return "Standard";
}

const TOOLS: Record<string, string> = {
  read_file: "Read files",
  list_files: "Look through the files",
  search: "Search the work",
  web_search: "Search the web",
  edit_file: "Change files",
  write_file: "Write new files",
  run: "Run commands and tests",
  git_diff: "Compare changes",
  notes: "Keep notes",
  spawn: "Brief contractors",
};

export function toolLabel(tool: string, mode: Mode): string {
  const base = tool.replace(/\(.*\)$/, "");
  const plain = TOOLS[base] ?? base.replace(/[_.]+/g, " ");
  if (mode === "technical") return tool === plain ? tool : `${plain} (${tool})`;
  const pattern = tool.match(/\((.*)\)$/)?.[1];
  return pattern ? `${plain}, limited` : plain;
}

/** Every tool the harness offers, for choosing from in normal mode. */
export const KNOWN_TOOLS = Object.keys(TOOLS);

const SERVICES: Record<string, string> = {
  identity: "Sign-in",
  models: "AI inside apps",
  secrets: "Secrets",
  email: "Email",
  schedules: "Scheduled jobs",
  webhooks: "Incoming data",
  telemetry: "Health and traffic",
};

export function serviceLabel(service: string, mode: Mode): string {
  const plain = SERVICES[service] ?? service;
  return mode === "technical" && plain !== service ? `${plain} (${service})` : plain;
}

export const STATUS: Record<EmployeeStatus, { label: string; tone: BadgeTone }> = {
  idle: { label: "Free", tone: "quiet" },
  working: { label: "Working", tone: "solid" },
  paused: { label: "Paused", tone: "attention" },
  released: { label: "Let go", tone: "quiet" },
};

export const TRIGGER: Record<HireTrigger, string> = {
  division: "A new division needs someone",
  stage: "A project reached a stage that needs someone",
  recurring: "A job keeps coming back",
  promotion: "A contractor role keeps recurring, so it is proposed as a permanent hire",
  owner: "You asked for this hire",
};

export const MEMORY_KIND: Record<MemoryKind, string> = {
  fact: "A fact",
  practice: "How it works here",
  preference: "A preference",
  lesson: "A lesson learned",
};

export const MEMORY_KINDS = Object.keys(MEMORY_KIND) as MemoryKind[];

/** The name of the node a scope (a path of slugs) points at, read from the tree. */
export function scopeName(tree: Tree | undefined, scope: string): string {
  const [orgSlug, divSlug, projSlug, appSlug] = scope.split("/");
  const org = tree?.organisation;
  if (!divSlug) return org && org.slug === orgSlug ? org.name : (orgSlug ?? scope);
  const d = tree?.divisions.find((x) => x.slug === divSlug);
  if (!projSlug) return d?.name ?? divSlug;
  const p = d?.projects.find((x) => x.slug === projSlug);
  if (!appSlug) return p?.name ?? projSlug;
  return p?.apps.find((x) => x.slug === appSlug)?.name ?? appSlug;
}

/** Every node of the tree as somewhere an employee could work, in tree order. */
export function placements(tree: Tree | undefined): { scope: string; label: string; depth: number }[] {
  const org = tree?.organisation;
  if (!tree || !org) return [];
  const out = [{ scope: org.slug, label: org.name, depth: 0 }];
  for (const d of tree.divisions) {
    out.push({ scope: `${org.slug}/${d.slug}`, label: d.name, depth: 1 });
    for (const p of d.projects) {
      out.push({ scope: `${org.slug}/${d.slug}/${p.slug}`, label: p.name, depth: 2 });
      for (const a of p.apps) out.push({ scope: `${org.slug}/${d.slug}/${p.slug}/${a.slug}`, label: a.name, depth: 3 });
    }
  }
  return out;
}

export interface ReviewSummary {
  at: string;
  merged: number;
  removed: number;
  corrected: number;
  runId: string | null;
}

/**
 * The last performance review, read from the memory's change log (newest first): every change the
 * review made carries its run, so its merges, removals and corrections are counted together.
 */
export function lastReview(changes: MemoryChange[]): ReviewSummary | null {
  const marker = changes.find((c) => c.by === "review" || c.action === "reviewed");
  if (!marker) return null;
  const same = changes.filter((c) => (marker.runId ? c.runId === marker.runId : c.at === marker.at) && (c.by === "review" || c.action === "reviewed"));
  const count = (action: MemoryChange["action"]) => same.filter((c) => c.action === action).length;
  return { at: marker.at, merged: count("merged"), removed: count("removed"), corrected: count("corrected"), runId: marker.runId };
}

/** What changed an entry last, for the line under it. */
export function entryOrigin(entry: MemoryEntry, changes: MemoryChange[]): string {
  const latest = changes.find((c) => c.memoryId === entry.id);
  if (latest?.action === "corrected") return latest.by === "review" ? "Corrected at a review" : "Corrected by a person";
  if (latest?.action === "merged") return "Merged at a review";
  if (latest?.by === "person") return "Added by a person";
  if (entry.sourceRunId) return "Learned on a task";
  return "Remembered";
}

/** Accepted work as "19 of 22". */
export function acceptedLine(work: { accepted: number; sentBack: number }): string {
  const total = work.accepted + work.sentBack;
  return total === 0 ? "No work judged yet" : `${work.accepted} of ${total}`;
}
