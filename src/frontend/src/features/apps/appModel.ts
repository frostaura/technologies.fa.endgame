import { formatCredits } from "@/lib/format";
import { plainOrNull } from "@/lib/plain";
import type { IconName } from "@/components/iconNames";
import type { AppDetail, AppVersion, CascadeValue } from "@/store/types";

/** The platform services an app can lean on, as the owner reads them. */
export const SERVICE: Record<string, { label: string; icon: IconName }> = {
  identity: { label: "Sign-in", icon: "employee" },
  data: { label: "Data", icon: "project" },
  models: { label: "AI", icon: "research" },
  email: { label: "E-mail", icon: "email" },
  webhooks: { label: "Incoming data", icon: "incoming-data" },
  schedules: { label: "Schedules", icon: "schedules" },
  telemetry: { label: "Visits and errors measured", icon: "health" },
};

/**
 * A saved step of the factory's own work rather than a change a person would look for (D38): the factory's progress
 * records, and the notes it writes about checking and repairing its work. Normal mode folds these behind "Show every
 * saved step"; the live version is never folded.
 */
export function isBookkeeping(v: AppVersion): boolean {
  if (v.live) return false;
  if (v.author.kind === "factory") return true;
  const first = (v.message.split("\n")[0] ?? "").trim();
  return /^(record|document|docs?\b|chore\b|wip\b)/i.test(first) || /\brepair round\b/i.test(first) || /\bverification\b/i.test(first);
}

/**
 * The services an app uses, from the organisation graph's `depends-on` edges. Every app built on the app kit has a
 * database of its own (ARCH: an app is one container with its own database and role), so once it has been built it
 * uses Data whether or not the graph names it (D35); a draft that was never built uses nothing yet.
 */
export function servicesOf(app: Pick<AppDetail, "id" | "status" | "version">, graph: { nodes: { id: string; type: string; name: string }[]; edges: { from: string; to: string; type: string }[] }): string[] {
  const named = graph.edges
    .filter((e) => e.type === "depends-on" && e.from === `app:${app.id}`)
    .map((e) => graph.nodes.find((n) => n.id === e.to))
    .filter((n) => n?.type === "service")
    .map((n) => n?.name ?? "");
  const built = app.status !== "draft" && (app.version !== null || app.status !== "building");
  return [...new Set([...(built ? ["data"] : []), ...named])];
}

/**
 * Something a suggestion would reuse, in the words the app page uses: a platform service the model names by its key
 * ("identity (service)", "email") reads as that service ("Sign-in", "E-mail") (D50); anything else is kept as written.
 */
export function reuseLabel(text: string): string {
  const t = text.trim();
  const named = t.match(/^(?:the\s+)?([a-z-]+)(?:\s+(?:service|\(service\)))?$/i);
  const key = named?.[1]?.toLowerCase();
  if (key && SERVICE[key]) return SERVICE[key].label;
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
  if (/^Restore the version [0-9a-f]{7,40}$/i.test(first)) return "An earlier version, brought back";
  const stripped = first.replace(/^[a-z0-9]+(?:-[a-z0-9]+)*:\s+/, "");
  const sentence = stripped ? `${stripped.charAt(0).toUpperCase()}${stripped.slice(1)}` : "";
  return plainOrNull(sentence) ?? `A change by ${v.author.name}`;
}

export const CAP_KEY = "monthly_credits";
export const ALLOWANCE_KEY = "app_models.monthly_credits";

/** A cascade value that is a number of credits, or null. */
export const numberOf = (v: CascadeValue | undefined) => (typeof v?.value === "number" ? v.value : null);
const number = numberOf;

/** The "Cost this month" tile's note: the app's own cap, a cap set above it and where, or none anywhere. */
export function capNote(app: AppDetail, budgets: CascadeValue[] | undefined, nameOf: (path: string) => string): string {
  const cap = budgets?.find((v) => v.key === CAP_KEY);
  if (budgets === undefined) return app.cost.capCredits !== null ? `Cap ${formatCredits(app.cost.capCredits)}` : "No cap on it or above it";
  if (!cap || number(cap) === null) return "No cap on it or above it";
  if (cap.setAtPath === app.scope) return `Its own cap: ${formatCredits(number(cap) ?? 0)} a month`;
  return `No cap of its own; ${nameOf(cap.setAtPath)}'s ${formatCredits(number(cap) ?? 0)} applies`;
}

