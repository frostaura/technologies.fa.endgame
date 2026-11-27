import { formatNumber } from "@/lib/format";
import type { OperatorOrganisation } from "@/store/types";

const LABELS: Record<string, string> = {
  creditsPerUsd: "Credits per dollar",
  margin: "Margin",
  usdPerAwakeHour: "Per awake hour",
  usdPerGbHourMemory: "Per gigabyte-hour of memory",
  usdPerGbMonthStorage: "Per gigabyte-month stored",
  usdPerMillionRequests: "Per million requests",
  defaultAppModelMonthlyCredits: "Each app's AI allowance",
};

function flat(v: unknown, prefix = ""): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x && typeof x === "object" && !Array.isArray(x)) Object.assign(out, flat(x, `${prefix}${k}.`));
    else out[k] = x;
  }
  return out;
}

function show(v: unknown): string {
  if (v === undefined || v === null) return "—";
  // Hosting rates are fractions of a cent; they are shown as written, not rounded away.
  return typeof v === "number" && Number.isInteger(v) ? formatNumber(v) : String(v);
}

/** What a change to the prices changed, figure by figure; before is null for the first save. */
export function pricingRows(before: unknown, after: unknown): { label: string; before: string; after: string }[] {
  const b = flat(before);
  const a = flat(after);
  return Object.keys(a)
    .filter((k) => b[k] !== a[k])
    .map((k) => ({ label: LABELS[k] ?? k, before: show(b[k]), after: show(a[k]) }));
}

/** An organisation's standing as its tag says it: in credit, below zero (waits on a top-up), or at its limit. */
export const STANDING: Record<OperatorOrganisation["standing"], { label: string; tone: "good" | "warn" | "bad" }> = {
  "in-credit": { label: "In credit", tone: "good" },
  overdrawn: { label: "Below zero", tone: "warn" },
  "at-limit": { label: "At its limit", tone: "bad" },
};
