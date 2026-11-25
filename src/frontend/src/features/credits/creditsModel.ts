import { formatCredits, plural } from "@/lib/format";
import type { BudgetLine, Credits } from "@/store/types";

/**
 * How long the balance lasts at this month's pace, said honestly: a zero or negative balance has no
 * months left to count, and less than one month is said as such — never "about 0 months".
 */
export function paceLine(credits: Pick<Credits, "balance" | "monthsLeftAtPace" | "overdraft">): string {
  if (credits.balance < 0) {
    const limit = overdraftLimit(credits);
    const left = limit + credits.balance;
    return limit > 0 && left > 0
      ? `You are below zero. ${formatCredits(left)} more can be spent before work stops; the next top-up settles the debt first.`
      : "You are below zero, at your limit. Work is paused until a top-up settles the debt.";
  }
  if (credits.balance === 0) {
    const limit = overdraftLimit(credits);
    return limit > 0
      ? `Nothing is left above zero. Work carries on into the overdraft, down to ${formatCredits(limit)} below zero; the next top-up settles it.`
      : "Nothing is left to spend, and there is no overdraft, so work waits for a top-up.";
  }
  const months = credits.monthsLeftAtPace;
  if (months === null) return "Nothing spent yet this month, so there is no pace to project.";
  if (months < 1) return "At this month’s pace, it runs out within the month.";
  return `At this month’s pace, about ${plural(Math.round(months), "month")}.`;
}

/** A whole number of credits typed by a person, or null when it is not one. */
export function parseCredits(text: string): number | null {
  const clean = text.replace(/[\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/** How far below zero the organisation may go: the tighter of FrostAura's limit and its own. */
export function overdraftLimit(credits: Pick<Credits, "overdraft">): number {
  return credits.overdraft ? Math.min(credits.overdraft.frostauraLimit, credits.overdraft.ownLimit ?? Number.POSITIVE_INFINITY) : 0;
}

/**
 * The cap that holds a row when it has none of its own: the nearest level above it with one, read from
 * the rows themselves (they run from the scope down, in tree order). An employee's row is held by its
 * own node first. Null when nothing above has a cap.
 */
export function capAbove(lines: BudgetLine[], line: BudgetLine): BudgetLine | null {
  const chain = line.level === "employee" ? [line.scope, ...ancestors(line.scope)] : ancestors(line.scope);
  for (const scope of chain) {
    const holder = lines.find((l) => l.scope === scope && l.level !== "employee" && l.capCredits !== null);
    if (holder) return holder;
  }
  return null;
}

function ancestors(scope: string): string[] {
  const parts = scope.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, parts.length - 1 - i).join("/"));
}

/** What holds a row with no cap of its own, in words. */
export function noCapLine(lines: BudgetLine[], line: BudgetLine): string {
  const above = capAbove(lines, line);
  return above ? `No cap here; the cap on ${above.name}, ${formatCredits(above.capCredits ?? 0)}, holds` : "No cap here or above it";
}
