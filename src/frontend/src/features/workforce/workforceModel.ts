import type { BadgeTone } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/format";
import type { Mode } from "@/features/runs/runModel";
import type { EmployeePatch, EmployeeStatus, Hire, HireEdit, HireTrigger, JobDescription, MemoryChange, MemoryEntry, MemoryKind, PersonRef, RecurringRole, TrackRecord, Tree } from "@/store/types";

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

/**
 * Every tool an employee can be given, in plain words. A test reads the harness's own tools (every
 * `ITool` in the backend) and the demo's, and fails when one has no plain name here.
 */
const TOOLS: Record<string, string> = {
  read_file: "Read files",
  list_files: "Look through the files",
  search: "Search the work",
  web_search: "Search the web",
  read_page: "Read web pages",
  edit_file: "Change files",
  write_file: "Write new files",
  run: "Run commands and tests",
  git_diff: "Compare changes",
  commit: "Save its work",
  git_commit: "Save its work",
  load_skill: "Use a skill",
  remember: "Remember things",
  notes: "Keep notes",
  tasks: "Keep a task list",
  spawn: "Brief contractors",
  brief_contractor: "Brief contractors",
  propose_plan: "Propose a plan",
  mark_item: "Tick off the plan",
  check_preview: "Try the app before it is published",
  sent_emails: "Read the e-mails an app sent",
  read_organisation: "Read the organisation",
  ask_app: "Ask an app's data",
  propose_hire: "Propose hires",
  start_idea: "Start work on an idea",
  change_app: "Ask for a change to an app",
  adjust_setting: "Change a setting",
  try_again: "Try stopped work again",
};

/** A tool's plain name, or null when it has none. */
export function plainTool(tool: string): string | null {
  return TOOLS[tool.replace(/\(.*\)$/, "")] ?? null;
}

export function toolLabel(tool: string, mode: Mode): string {
  const base = tool.replace(/\(.*\)$/, "");
  const plain = TOOLS[base] ?? base.replace(/[_.]+/g, " ");
  if (mode === "technical") return tool === plain ? tool : `${plain} (${tool})`;
  const pattern = tool.match(/\((.*)\)$/)?.[1];
  return pattern ? `${plain}, limited` : plain;
}

/** The tools offered for choosing in a job and in rules; the others come with the work an agent is given. */
export const KNOWN_TOOLS: readonly string[] = ["read_file", "list_files", "search", "web_search", "edit_file", "write_file", "run", "git_diff", "notes", "spawn"];

/**
 * The tools grouped as a person thinks of them, for laying a job's choices out under headings. A
 * tool in no group (one the console does not name, kept on an existing job) goes under "Other".
 */
export const TOOL_GROUPS: readonly { title: string; tools: readonly string[] }[] = [
  { title: "Reading", tools: ["read_file", "list_files", "search", "web_search", "read_page"] },
  { title: "Changing the work", tools: ["edit_file", "write_file", "run", "git_diff", "commit", "git_commit", "check_preview"] },
  { title: "Keeping track and others", tools: ["notes", "remember", "tasks", "spawn", "brief_contractor", "load_skill"] },
];

/** The tools on offer, under their group's heading, in the groups' order; the unknown last, under "Other". */
export function groupedTools(tools: readonly string[]): { title: string; tools: string[] }[] {
  const placed = new Set<string>();
  const groups = TOOL_GROUPS.map((g) => {
    const mine = g.tools.filter((t) => tools.some((x) => x.replace(/\(.*\)$/, "") === t)).flatMap((t) => tools.filter((x) => x.replace(/\(.*\)$/, "") === t));
    mine.forEach((t) => placed.add(t));
    return { title: g.title, tools: mine };
  });
  const other = tools.filter((t) => !placed.has(t));
  return [...groups, { title: "Other", tools: other }].filter((g) => g.tools.length > 0);
}

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
  idle: { label: "Free", tone: "neutral" },
  working: { label: "Working", tone: "info" },
  paused: { label: "Paused", tone: "warn" },
  released: { label: "Let go", tone: "neutral" },
};

/**
 * One status vocabulary for a piece of work on an employee's record, whether a task it took or a run
 * it led (ARCH-011): a cancelled piece of work is "Cancelled", never "Finished".
 */
export const WORK_STATUS: Record<string, { label: string; tone: BadgeTone; ended: boolean }> = {
  todo: { label: "To do", tone: "neutral", ended: false },
  queued: { label: "Waiting to start", tone: "neutral", ended: false },
  blocked: { label: "Waiting to start", tone: "neutral", ended: false },
  in_progress: { label: "In progress", tone: "info", ended: false },
  running: { label: "In progress", tone: "info", ended: false },
  waiting_approval: { label: "Waiting for you", tone: "warn", ended: false },
  waiting: { label: "Waiting for you", tone: "warn", ended: false },
  paused: { label: "Paused", tone: "warn", ended: false },
  done: { label: "Done", tone: "good", ended: true },
  finished: { label: "Done", tone: "good", ended: true },
  succeeded: { label: "Done", tone: "good", ended: true },
  failed: { label: "Did not succeed", tone: "bad", ended: true },
  cancelled: { label: "Cancelled", tone: "neutral", ended: true },
};

/** A piece of work's status, said in the one vocabulary; an unknown one as itself, neutral. */
export function workStatus(status: string): { label: string; tone: BadgeTone; ended: boolean } {
  return WORK_STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "neutral", ended: false };
}

/**
 * The words that tell people with the same name apart in a list: "Nadia · QA engineer", and where
 * each works when two share a name and a role ("Nadia · QA engineer, Dive Trip Ready"). Two different
 * people are never told apart by their avatar's colour alone.
 */
export function personLabels<T extends { id: string; name: string; role: string; scope: string }>(people: readonly T[], tree: Tree | undefined): Map<string, string> {
  const key = (p: T) => `${p.name.trim().toLowerCase()}|${p.role.trim().toLowerCase()}`;
  const count = new Map<string, number>();
  for (const p of people) count.set(key(p), (count.get(key(p)) ?? 0) + 1);
  return new Map(people.map((p) => [p.id, `${p.name} · ${p.role}${(count.get(key(p)) ?? 0) > 1 ? `, ${scopeName(tree, p.scope)}` : ""}`]));
}

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

/**
 * "Theo, Software engineer": the role as it was written, initialisms and all. When the name is the
 * role (a promoted contractor role is named after it), it is said once.
 */
export function nameWithRole(name: string, role: string): string {
  return name.trim().toLowerCase() === role.trim().toLowerCase() ? name : `${name}, ${role}`;
}

/**
 * What a hire is expected to cost a month: never more than its own budget, which caps it. The
 * proposal's estimate is the server's; a cap set below it is what holds.
 */
export function expectedMonthly(hire: { expectedMonthlyCredits: number; jobDescription: { monthlyCreditLimit: number | null } }): number {
  const cap = hire.jobDescription.monthlyCreditLimit;
  return cap !== null && cap < hire.expectedMonthlyCredits ? cap : hire.expectedMonthlyCredits;
}

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

/** The services an employee may be given, for choosing from. */
export const KNOWN_SERVICES = Object.keys(SERVICES);

/**
 * Thinking power to choose from: a routing-table task type, from the lightest to the strongest. An
 * empty choice keeps the standard one for the work it does.
 */
export const THINKING_POWERS: readonly string[] = ["chat", "research", "build", "build-t2", "build-t3"];

/** Every employee on the payroll who could be someone's manager: not itself, not a contractor, not let go. */
export function possibleManagers<T extends { id: string; kind: string; status: string; name: string }>(people: T[], self: string | null): T[] {
  return people.filter((p) => p.id !== self && p.kind === "employee" && p.status !== "released").sort((a, b) => a.name.localeCompare(b.name));
}

const MEMORY_ACTION: Record<MemoryChange["action"], string> = {
  added: "Added",
  corrected: "Corrected",
  merged: "Merged",
  removed: "Removed",
  archived: "Archived",
  restored: "Restored",
  reviewed: "Reviewed",
};

const MEMORY_BY: Record<string, string> = { employee: "by the employee", person: "by a person", review: "at a review", platform: "by Endgame" };

/** One change to an employee's memory, in plain words: "Corrected by a person". */
export function memoryChangeLine(change: MemoryChange): string {
  return `${MEMORY_ACTION[change.action]} ${MEMORY_BY[change.by] ?? `by ${change.by}`}`;
}

/**
 * The title an entry had when it changed, read defensively from the change's detail: a correction
 * carries `before` and `after`, the others the title itself; otherwise the entry's own.
 */
export function memoryChangeTitle(change: MemoryChange, entries: MemoryEntry[]): string | null {
  const detail = change.detail as { title?: unknown; after?: { title?: unknown } | null; before?: { title?: unknown } | null } | null;
  for (const title of [detail?.after?.title, detail?.title, detail?.before?.title]) if (typeof title === "string" && title.trim()) return title.trim();
  return entries.find((e) => e.id === change.memoryId)?.title ?? null;
}

/** Words the log once stored in place of a reason; they are not one. */
const NO_REASON = new Set(["removed by a person", "no reason given."]);

/** Why an entry was changed or removed, when someone said. */
export function memoryChangeWhy(change: MemoryChange): string | null {
  const detail = change.detail as { why?: unknown } | null;
  const why = typeof detail?.why === "string" ? detail.why.trim() : "";
  return why && !NO_REASON.has(why.toLowerCase()) ? why : null;
}

/** A job as the editor holds it: every field as text, the lists as chosen. */
export interface JobDraftShape {
  name: string;
  role: string;
  mandate: string;
  tools: string[];
  services: string[];
  modelTier: string;
  reportsTo: string;
  budget: string;
}

export function draftOf(who: { name: string; role: string; reportsTo: PersonRef | null }, job: JobDescription): JobDraftShape {
  return {
    name: who.name,
    role: who.role,
    mandate: job.mandate,
    tools: [...job.tools],
    services: [...job.services],
    modelTier: job.modelTier ?? "",
    reportsTo: who.reportsTo?.id ?? "",
    budget: job.monthlyCreditLimit !== null ? String(job.monthlyCreditLimit) : "",
  };
}

/** What is wrong with a draft, said plainly, or null. */
export function draftProblem(draft: JobDraftShape): string | null {
  if (!draft.name.trim() || !draft.role.trim()) return "It needs a name and a role.";
  const budget = draft.budget.trim();
  if (budget !== "" && !(Number.isFinite(Number(budget)) && Number(budget) >= 0)) return "A budget is a number of credits a month, or empty for none of its own.";
  return null;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** The fields a draft changes, as the employee endpoint takes them; emptied budget and manager are cleared, not kept. */
export function employeePatchFrom(before: JobDraftShape, after: JobDraftShape): EmployeePatch {
  const patch: EmployeePatch = {};
  const job: NonNullable<EmployeePatch["jobDescription"]> = {};
  if (after.name.trim() !== before.name) patch.name = after.name.trim();
  if (after.role.trim() !== before.role) patch.role = after.role.trim();
  if (after.mandate.trim() !== before.mandate) job.mandate = after.mandate.trim();
  if (!same(after.tools, before.tools)) job.tools = after.tools;
  if (!same(after.services, before.services)) job.services = after.services;
  if (after.modelTier !== before.modelTier && after.modelTier) job.modelTier = after.modelTier;
  if (after.budget.trim() !== before.budget) {
    if (after.budget.trim() === "") patch.clearMonthlyCreditLimit = true;
    else job.monthlyCreditLimit = Number(after.budget.trim());
  }
  if (after.reportsTo !== before.reportsTo) {
    if (after.reportsTo) patch.reportsTo = after.reportsTo;
    else patch.clearReportsTo = true;
  }
  if (Object.keys(job).length > 0) patch.jobDescription = job;
  return patch;
}

/** The same for a hire proposal, which also carries its reason and expected monthly cost. */
export function hireEditFrom(before: JobDraftShape, after: JobDraftShape, extra: { reason: string; expectedMonthlyCredits: number }): HireEdit {
  const p = employeePatchFrom(before, after);
  const edit: HireEdit = { reason: extra.reason, expectedMonthlyCredits: extra.expectedMonthlyCredits };
  if (p.name !== undefined) edit.name = p.name;
  if (p.role !== undefined) edit.role = p.role;
  if (p.jobDescription) edit.jobDescription = p.jobDescription;
  if (p.clearMonthlyCreditLimit) edit.clearMonthlyCreditLimit = true;
  if (p.reportsTo !== undefined) edit.reportsTo = p.reportsTo;
  if (p.clearReportsTo) edit.clearReportsTo = true;
  return edit;
}

/**
 * The proposal already waiting for a recurring role, if one is: the control plane raises one need per role and place
 * (`HireService.PromotionNeedKey`), so proposing again only returns it (D78).
 */
export function waitingProposal(hires: Hire[] | undefined, role: RecurringRole): Hire | null {
  const named = role.role.trim().toLowerCase();
  return (
    hires?.find(
      (h) =>
        h.status === "proposed" &&
        h.scope === role.scope &&
        ((h.needKey?.startsWith("promotion:") === true && h.needKey.endsWith(`:${named}`)) || h.contractorRole?.trim().toLowerCase() === named || h.role.trim().toLowerCase() === named),
    ) ?? null
  );
}

/**
 * What an employee has cost (D74). `cost` already counts the contractors it briefs, as its budget does; `own…` is its
 * share alone (`trackRecordGuard` makes an older control plane's figures read the same way).
 */
export function employeeCosts(record: Pick<TrackRecord, "cost">): { toDate: number; month: number; ownMonth: number } {
  return { toDate: record.cost.toDateCredits, month: record.cost.monthCredits, ownMonth: record.cost.ownMonthCredits ?? record.cost.monthCredits };
}

/** The one-line caption under "Cost so far": this month against the budget (the contractors it briefs included). */
export function costLine(costs: { month: number; ownMonth: number }, monthlyLimit: number | null): string {
  return monthlyLimit !== null ? `${formatNumber(costs.month)} of ${formatNumber(monthlyLimit)} this month` : `${formatNumber(costs.month)} this month, no budget of its own`;
}

/** What the cost tile's one-line caption leaves out: the share the contractors it briefs spent (D74), said in a sentence. */
export function costNote(costs: { month: number; ownMonth: number }): string | null {
  return costs.ownMonth < costs.month ? `This month’s cost includes the contractors it briefs; ${formatNumber(costs.ownMonth)} of it is its own.` : null;
}

/** A proposal's state as a badge. One the platform closed itself (`withdrawn`) reads as withdrawn, not as a person's no. */
export function hireBadge(hire: Pick<Hire, "status" | "withdrawn">, proposed = "Hire proposed"): { label: string; tone: BadgeTone } {
  if (hire.withdrawn) return { label: "Withdrawn", tone: "neutral" };
  if (hire.status === "accepted") return { label: "Hired", tone: "good" };
  if (hire.status === "declined") return { label: "Declined", tone: "neutral" };
  return { label: proposed, tone: "info" };
}

/** What a decline holds (R5-3), said before it is made: no new proposal for this role here until the date, unless the person asks. */
export function holdLine(days: number, now: Date = new Date()): string {
  const until = formatDate(new Date(now.getTime() + days * 86_400_000).toISOString());
  return `It will not be proposed again here for ${days} days, until ${until}, however many more contractors are briefed. You can still ask for this hire yourself before then.`;
}

/** When a declined recurring role can come up again (R5-3). */
export function againLine(from: string): string {
  return `It will not be proposed again here before ${formatDate(from)}. You can ask for this hire yourself at any time.`;
}
