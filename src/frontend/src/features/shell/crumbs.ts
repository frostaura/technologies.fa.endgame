import { shortTitle } from "@/lib/plain";
import type { Crumb } from "./AppShell";

/**
 * The trail as every page shows it: from the organisation, down, with the current place last. A page
 * that starts lower (Account, System, Not found) has the organisation put in front; a place named the
 * same as the level above it (an app named for its project) is shown once, as the deeper of the two.
 */
export function normaliseCrumbs(crumbs: Crumb[], org: Crumb | null): Crumb[] {
  const withOrg = org && crumbs.length > 0 && crumbs[0]?.label !== org.label ? [org, ...crumbs] : crumbs;
  return withOrg.filter((crumb, i) => withOrg[i + 1]?.label !== crumb.label);
}

/**
 * A place's short name, for the header and the trail: the crumb's own `short` when the page gives one,
 * otherwise its label cut at a word to 32 characters. The page's heading carries the name in full.
 */
export function crumbShort(crumb: Crumb, max = 32): string {
  return crumb.short ?? shortTitle(crumb.label, max);
}
