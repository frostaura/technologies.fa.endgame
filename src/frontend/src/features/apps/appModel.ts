import { formatNumber, timeAgo } from "@/lib/format";
import { plainOrNull } from "@/lib/plain";
import type { IconName } from "@/components/iconNames";
import type { Mode } from "@/features/runs/runModel";
import { nodeName } from "../home/ontologyModel";
import type { AppDetail, AppVersion, CascadeValue } from "@/store/types";

/** The platform services an app can lean on: each one's icon. Its name is the home matrix's ({@link serviceName}). */
export const SERVICE: Record<string, { icon: IconName }> = {
  identity: { icon: "employee" },
  data: { icon: "project" },
  models: { icon: "research" },
  email: { icon: "email" },
  webhooks: { icon: "incoming-data" },
  schedules: { icon: "schedules" },
  telemetry: { icon: "health" },
};

/**
 * A platform service's name, one name everywhere: the organisation's "How data flows" matrix names its columns with the
 * same function ("Stored data", "Sign-in", "Health and traffic"), so the app page and the suggestions never say it another
 * way. Technical mode adds the internal name in brackets, as the matrix does.
 */
export function serviceName(service: string, mode: Mode = "normal"): string {
  return nodeName({ id: `service:${service}`, type: "service", name: service, scope: null, status: null, attributes: null }, mode);
}

/**
 * A saved step of the factory's own work rather than a change a person would look for (D38): the factory's progress
 * records, and the notes it writes about checking and repairing its work. Normal mode folds these behind "Show every
 * saved step"; the live version is never folded.
 */
export function isBookkeeping(v: AppVersion): boolean {
  if (v.live) return false;
  if (v.author.kind === "factory") return true;
  const first = (v.message.split("\n")[0] ?? "").trim();
  // The factory's check-and-repair notes ("Repair [item] evidence: …", "Verify … (r2)") name its plan items in brackets
  // and its rounds as r1, r2 (R2-4).
  return /^(record|document|docs?\b|chore\b|wip\b|repair\b|verify\b)/i.test(first) || /\brepair round\b/i.test(first) || /\bverification\b/i.test(first) || /\[[a-z0-9]+(?:-[a-z0-9]+)*\]/.test(first) || /\(r\d+\)$/.test(first);
}

/**
 * The services an app uses, from the organisation graph's `depends-on` edges — authoritative now that the graph names
 * `service:data` for an app that has run or stores data (D35), so nothing is guessed here.
 */
export function servicesOf(app: Pick<AppDetail, "id">, graph: { nodes: { id: string; type: string; name: string }[]; edges: { from: string; to: string; type: string }[] }): string[] {
  const named = graph.edges
    .filter((e) => e.type === "depends-on" && e.from === `app:${app.id}`)
    .map((e) => graph.nodes.find((n) => n.id === e.to))
    .filter((n) => n?.type === "service")
    .map((n) => n?.name ?? "");
  return [...new Set(named)];
}

/**
 * Something a suggestion would reuse, in the words the app page uses: a platform service the model names by its key
 * ("identity (service)", "email") reads as that service ("Sign-in", "E-mail") (D50); anything else is kept as written.
 */
export function reuseLabel(text: string): string {
  const t = text.trim();
  const named = t.match(/^(?:the\s+)?([a-z-]+)(?:\s+(?:service|\(service\)))?$/i);
  const key = named?.[1]?.toLowerCase();
  if (key && SERVICE[key]) return serviceName(key);
  return t.replace(/\s+\((service|app|project|division)\)$/i, "");
}

/**
 * A version's first line as the owner reads it: a plan item's id prefix ("frontend-books: …") is
 * dropped, the factory's own bookkeeping is named as such, and a line that still names files or
 * commands falls back to who made it. Technical mode shows the line as written.
 */
export function versionTitle(v: AppVersion, technical: boolean): string {
  const first = v.message.split("\n")[0]?.trim() ?? "";
  if (technical) return first || "A change";
  if (v.author.kind === "factory") return "The factory recorded its progress";
  // A restore's own line (`Restore the version <commit>`) names a commit id: say what it is instead.
  if (/^Restore the version [0-9a-f]{7,40}$/i.test(first)) return "Brought back an earlier version";
  const stripped = first.replace(/^[a-z0-9]+(?:-[a-z0-9]+)*:\s+/, "");
  const sentence = stripped ? `${stripped.charAt(0).toUpperCase()}${stripped.slice(1)}` : "";
  return plainOrNull(sentence) ?? `A change by ${v.author.name}`;
}

/** The server's plain title: a string, null for a saved step with none, undefined when the server sends no such field. */
export function plainTitleOf(v: AppVersion): string | null | undefined {
  const raw = v.title !== undefined ? v.title : v.plainTitle;
  if (raw === undefined) return undefined;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

export interface HistoryRow {
  version: AppVersion;
  title: string;
  /** "Live now": in normal mode, the newest published change at or below what is running, never a bookkeeping step. */
  live: boolean;
}

/**
 * The rows History shows (R2-4). Technical mode, or "Show every saved step": every version, its raw first line, the
 * badge where the server puts it. Normal mode: the versions with a plain title the server sent — or, from an older
 * server with none, the changes the D38 rule keeps — and nothing never published; every other saved step is folded,
 * and `folded` counts them. "Live now" moves down from a folded step to the newest change shown beneath it.
 */
export function historyRows(versions: AppVersion[], technical: boolean, every: boolean): { rows: HistoryRow[]; folded: number } {
  const raw = (v: AppVersion) => ({ version: v, title: versionTitle(v, technical), live: v.live });
  if (technical) return { rows: versions.map(raw), folded: 0 };
  const titled = versions.some((v) => plainTitleOf(v) !== undefined);
  // From an older server the live version is a change unless it is itself a bookkeeping step (R2-4).
  const isChange = (v: AppVersion) => v.published !== false && (titled ? Boolean(plainTitleOf(v)) : !isBookkeeping({ ...v, live: false }));
  const titleOf = (v: AppVersion) => plainTitleOf(v) ?? versionTitle(v, false);
  const changes = versions.filter(isChange);
  const liveAt = versions.findIndex((v) => v.live);
  const liveChange = liveAt < 0 ? undefined : versions.slice(liveAt).find(isChange);
  if (every) return { rows: versions.map((v) => ({ version: v, title: titleOf(v), live: v === liveChange })), folded: 0 };
  // Nothing but saved steps yet: the newest one stands for them, so the history is never an empty list.
  const shown = changes.length > 0 ? changes : versions.slice(0, 1);
  return { rows: shown.map((v) => ({ version: v, title: titleOf(v), live: changes.length > 0 ? v === liveChange : v.live })), folded: versions.length - shown.length };
}

export const CAP_KEY = "monthly_credits";
export const ALLOWANCE_KEY = "app_models.monthly_credits";

/** A cascade value that is a number of credits, or null. */
export const numberOf = (v: CascadeValue | undefined) => (typeof v?.value === "number" ? v.value : null);
const number = numberOf;

/**
 * The "Cost this month" tile's note, one short line (a phone's half-width tile): the app's own monthly cap, a cap set above
 * it, or none anywhere. Where a cap above it is set, and that it is monthly, is said in "What it may spend".
 */
export function capNote(app: AppDetail, budgets: CascadeValue[] | undefined): string {
  const cap = budgets?.find((v) => v.key === CAP_KEY);
  if (budgets === undefined) return app.cost.capCredits !== null ? `Cap: ${formatNumber(app.cost.capCredits)}` : "No cap set";
  if (!cap || number(cap) === null) return "No cap set";
  if (cap.setAtPath === app.scope) return `Own cap: ${formatNumber(number(cap) ?? 0)}`;
  return `Cap above: ${formatNumber(number(cap) ?? 0)}`;
}


/**
 * Why a visitor cannot use the app just now, or null when they can. Asleep is not a reason: the first
 * visit wakes it.
 */
export function notOpenable(app: AppDetail): string | null {
  if (app.notBuilt || !app.publishedAt) return "Nothing is published yet, so its visitors are told it is not ready.";
  if (app.paused || app.running === "paused" || app.health.state === "paused") return "It is paused, so its visitors see a holding page until it is restored.";
  if (app.status === "failed" || app.status === "stopped") return "It is not running, so its visitors are told it is unavailable.";
  return null;
}

/**
 * The visits tile's one line, short enough for a phone's half-width tile: the failures among today's requests, or when
 * the last visit was ("Last visit 2 min ago").
 */
export function visitsNote(t: NonNullable<AppDetail["telemetry"]>, now: Date = new Date()): string {
  if (t.errorsToday > 0) return `${formatNumber(t.errorsToday)} of ${formatNumber(t.requestsToday)} failed`;
  if (!t.lastVisitAt) return "No visits yet";
  return `Last visit ${shortAgo(t.lastVisitAt, now)}`;
}

/** "just now", "2 min ago", "3 h ago", "2 days ago": `timeAgo`, cut to fit a figure tile's caption. */
function shortAgo(iso: string, now: Date): string {
  const said = timeAgo(iso, now);
  return said.replace(/\bminutes?\b/, "min").replace(/\bhours?\b/, "h");
}

/** A round step for an axis: 1, 2 or 5 times a power of ten, so about five steps cover the range. */
export function niceStep(range: number, steps = 5): number {
  if (range <= 0) return 1;
  const rough = range / steps;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}
