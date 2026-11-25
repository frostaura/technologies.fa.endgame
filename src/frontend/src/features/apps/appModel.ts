import { formatCredits } from "@/lib/format";
import { plainOrNull } from "@/lib/plain";
import type { AppDetail, AppVersion, CascadeValue } from "@/store/types";

/**
 * A version's first line as the owner reads it: a plan item's id prefix ("frontend-books: …") is
 * dropped, the factory's own bookkeeping is named as such, and a line that still names files or
 * commands falls back to who made it. Technical mode shows the line as written.
 */
export function versionTitle(v: AppVersion, technical: boolean): string {
  const first = v.message.split("\n")[0]?.trim() ?? "";
  if (technical) return first || "A change";
  if (v.author.kind === "factory") return "The factory recorded its progress";
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

