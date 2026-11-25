import { formatCredits, plural } from "@/lib/format";
import type { Credits } from "@/store/types";

/**
 * How long the balance lasts at this month's pace, said honestly: a zero or negative balance has no
 * months left to count, and less than one month is said as such — never "about 0 months".
 */
export function paceLine(credits: Pick<Credits, "balance" | "monthsLeftAtPace" | "overdraft">): string {
  if (credits.balance < 0) {
    const limit = credits.overdraft ? Math.min(credits.overdraft.frostauraLimit, credits.overdraft.ownLimit ?? Number.POSITIVE_INFINITY) : 0;
    const left = limit + credits.balance;
    return limit > 0 && left > 0
      ? `You are below zero. ${formatCredits(left)} more can be spent before work stops; the next top-up settles the debt first.`
      : "You are below zero, at your limit. Work is paused until a top-up settles the debt.";
  }
  if (credits.balance === 0) return "Nothing is left to spend. A top-up starts the work again.";
  const months = credits.monthsLeftAtPace;
  if (months === null) return "Nothing spent yet this month, so there is no pace to project.";
  if (months < 1) return "At this month’s pace, it runs out within the month.";
  return `At this month’s pace, about ${plural(Math.round(months), "month")}.`;
}
