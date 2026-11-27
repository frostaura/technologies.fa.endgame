import { Link } from "@/components/Link";
import { TAP_LINE } from "@/lib/touch";
import { Bar, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { estimateFigure, estimateHeadline, estimateSpread } from "@/lib/estimates";
import { NO_VALUE, Stat, StatRow } from "@/components/ui/stat";
import { formatCredits, formatDate, formatNumber, percent, plural } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { NEVER_TOPPED_UP } from "@/features/start/startModel";
import { cn } from "@/lib/utils";
import { useGetCreditsQuery, useGetMeQuery } from "@/store/api";
import type { BudgetLine, Credits, MemberRole } from "@/store/types";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { highestGrant, roleRank } from "@/lib/roles";
import { useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { Fold } from "@/components/Fold";
import { SECTION } from "@/components/ui/page";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { AppShell } from "../shell/AppShell";
import { CapControl, NarrowerLimit, NarrowerLimits, OwnLimit, TopUpRequests } from "./CreditsActions";
import { capAbove, noCapLine, paceLine } from "./creditsModel";

export function CreditsView() {
  const me = useGetMeQuery(undefined);
  const active = useActiveOrganisation();
  const org = active.organisation;
  // Someone whose roles all sit below the organisation reads credits at their own level, as home does (ORG-19, CRED-01).
  const own = org && !active.entered && active.role === null ? highestGrant(me.data?.memberships ?? [], org.slug) : undefined;
  const scope = own?.scope ?? org?.slug ?? "";
  const query = useGetCreditsQuery(scope, { skip: !org });
  const view = org ? viewOf(query) : me.isError ? { kind: "failed" as const, reason: "Your session could not be read.", status: null } : { kind: "loading" as const };
  const isAdmin = roleRank(own?.role ?? active.role) >= roleRank("admin");
  const home = active.entered && org ? paths.homeOf(org.slug) : paths.home();

  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: home }] : []), { label: "Credits" }]} aside={view.kind === "loaded" && org ? <OverdraftAside credits={view.data} organisation={org.slug} role={active.role} /> : undefined}>
      {me.data && !org && (
        <p data-state="empty" className="py-1 text-ink-body">
          There are no credits to show until your organisation is named. <Link href={paths.start()} className="font-semibold text-primary-link">Start</Link>
        </p>
      )}
      {view.kind === "loading" && (me.isLoading || org) && (
        <Loading label="Loading credits" className="flex flex-col gap-6">
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-72 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="Credits could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <CreditsBody credits={view.data} organisation={scope} isAdmin={isAdmin} branch={own ? (view.data.budgets[0]?.name ?? own.scope) : null} />
        </>
      )}
    </AppShell>
  );
}

/** The page itself: the balance, the budget tree, how the month went and the top-ups made. */
function CreditsBody({ credits, organisation, isAdmin, branch }: { credits: Credits; organisation: string; isAdmin: boolean; branch: string | null }) {
  const negative = credits.balance < 0;
  return (
    <>
      {credits.neverToppedUp && (
        <p role="note" data-testid="never-topped-up" className="flex max-w-prose flex-col gap-1 rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-ink">
          {NEVER_TOPPED_UP}
          <button
            type="button"
            onClick={() => document.getElementById("asking-for-more")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="min-h-touch self-start rounded-xs font-semibold text-primary-link hover:text-primary-hover"
          >
            Ask for a top-up
          </button>
        </p>
      )}
      {branch && (
        <p role="note" className="max-w-prose text-ink-body">
          Your role is in {branch}, so this shows its spending and caps. The balance is the whole organisation&rsquo;s, which its work draws on.
        </p>
      )}
      {/* The hero: white, the balance as the page's title, the month's figures across from it. Below zero, the figure says so in red. */}
      <section aria-label="Balance" className={cn("grid grid-cols-1 items-end gap-x-12 gap-y-5 rounded-lg border bg-surface px-6 py-7 shadow-card max-sm:px-5 max-sm:py-5 sm:px-8 lg:grid-cols-grow-end", RISE)}>
        <div className="flex min-w-0 flex-col gap-1">
          <Stat plain valueAs="h1" size="xl" tone={negative ? "bad" : "ink"} label={<span className="text-eyebrow font-semibold uppercase">{negative ? "Below zero" : "Credits left"}</span>} value={formatNumber(credits.balance)} />
          <span className="max-w-prose text-ink-body">{paceLine(credits)}</span>
        </div>
        <div className="grid grid-cols-3 gap-x-10 gap-y-3 max-sm:grid-cols-fit-3 max-sm:justify-between max-sm:gap-x-3">
          <Stat plain label="Spent this month" value={formatNumber(credits.month.spent)} />
          <Stat plain label="On AI work" value={formatNumber(credits.month.ai)} />
          <Stat plain label="On hosting" value={formatNumber(credits.month.hosting)} />
        </div>
      </section>

      {/* At 1600 and wider the tree has the room it needs, and the month's figures and the top-ups sit beside it. */}
      <div className="grid grid-cols-1 items-start gap-6 3xl:grid-cols-main-side">
        <section aria-labelledby="budgets-title" className={cn("flex min-w-0 flex-col gap-3.5", RISE, stagger(1))}>
          <div className="flex flex-col gap-1">
            <h2 id="budgets-title" className={SECTION}>
              Budgets
            </h2>
            <span className="max-w-prose text-ink-body">
              A cap set higher up holds for everything beneath it. Work that would break a cap does not start.{isAdmin ? "" : " An Admin or the Owner sets the caps."}
            </span>
          </div>
          {credits.budgets.length === 0 ? (
            <p data-state="empty" className="py-1 text-ink-muted">
              No spending or caps anywhere in the tree yet.
            </p>
          ) : (
            // A phone folds the tree to a line: how many levels, how many carry a cap of their own.
            <Fold title="Every level’s spending and cap" summary={`${plural(credits.budgets.filter((l) => l.level !== "employee").length, "level")}, ${plural(credits.budgets.filter((l) => l.capCredits !== null).length, "cap")} set`}>
              <BudgetTree lines={credits.budgets} organisation={organisation} isAdmin={isAdmin} />
            </Fold>
          )}
        </section>

        <div className={cn("flex min-w-0 flex-col gap-6", RISE, stagger(2))}>
          <StatRow cols={2} label="How the month went" className="max-sm:grid-cols-1 3xl:grid-cols-1">
            {credits.estimates && credits.estimates.pieces > 0 ? (
              <Stat
                label="Estimates against what it cost"
                value={estimateFigure(credits.estimates)}
                caption={`${estimateHeadline(credits.estimates)}. Across ${plural(credits.estimates.pieces, "piece")} of work this month. ${estimateSpread(credits.estimates)} The largest miss was ${formatNumber(credits.estimates.largestMissPercent)}%.`}
              />
            ) : (
              <Stat label="Estimates against what it cost" value={NO_VALUE} tone="muted" caption="No work has finished this month, so no estimate has been scored yet." />
            )}
            <Stat
              label="What you were not charged for"
              value={formatCredits(credits.notCharged.credits)}
              tone="good"
              caption={
                credits.notCharged.repairs > 0
                  ? `${plural(credits.notCharged.repairs, "repair")} where an employee got it wrong the first time. Fixing its own mistake is never billed.`
                  : "No repairs this month. Fixing its own mistake is never billed."
              }
            />
          </StatRow>
          <Fold title="Top-ups" summary={credits.topUps.length === 0 ? "None yet" : plural(credits.topUps.length, "top-up")}>
            <TopUpLedger topUps={credits.topUps} />
          </Fold>
        </div>
      </div>
    </>
  );
}

/** Every top-up made, newest last as the ledger runs: what it was for, when, and how much. */
function TopUpLedger({ topUps }: { topUps: Credits["topUps"] }) {
  return (
    <section aria-labelledby="top-ups-title" className="flex flex-col gap-2.5">
      <h2 id="top-ups-title" className={SECTION}>
        Top-ups
      </h2>
      {topUps.length === 0 ? (
        <p data-state="empty" className="text-ink-muted">
          No top-ups yet. FrostAura adds credits on request.
        </p>
      ) : (
        <ul aria-label="Top-ups made" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
          {topUps.map((t, i) => (
            <li key={`${t.at}-${i}`} className="grid grid-cols-grow-end items-baseline gap-x-4 border-b px-5 py-3 last:border-b-0">
              <span className="min-w-0 break-words">{t.note}</span>
              <span className="whitespace-nowrap font-semibold tabular-nums">+&nbsp;{formatNumber(t.credits)}</span>
              <span className="col-span-2 text-sm text-ink-muted">{formatDate(t.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The columns every row of the budget tree shares: the level, what it spent, its cap, and (for an Admin) its one action. */
const TREE_COLUMNS = {
  admin: "grid-cols-grow-end sm:grid-cols-budget-tree",
  reader: "grid-cols-grow-end sm:grid-cols-budget-tree-read",
} as const;

/**
 * The budget tree (CRED-02): one dense row per level, indented under its parent, with what it spent this
 * month against its cap and the cap itself. A division folds its projects, apps and employees away.
 */
function BudgetTree({ lines, organisation, isAdmin }: { lines: BudgetLine[]; organisation: string; isAdmin: boolean }) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const columns = isAdmin ? TREE_COLUMNS.admin : TREE_COLUMNS.reader;
  const hidden = (line: BudgetLine) => [...folded].some((scope) => insideDivision(line, scope));
  const toggle = (scope: string) =>
    setFolded((was) => {
      const next = new Set(was);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  // The legend's example of a cap held from above is a real one from this tree.
  const held = lines.map((l) => (l.capCredits === null ? capAbove(lines, l) : null)).find((l) => l !== null) ?? null;
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-md border bg-surface shadow-card">
      <div aria-hidden className={cn("hidden items-end gap-x-4 border-b px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted sm:grid", columns)}>
        <span>Level</span>
        <span>Spent this month</span>
        <span className="text-right">Cap</span>
        {isAdmin && <span />}
      </div>
      <ul aria-label="Budgets" className="flex flex-col">
        {lines.map((line) =>
          hidden(line) ? null : (
            <BudgetRow
              key={`${line.scope}#${line.level}#${line.name}`}
              line={line}
              lines={lines}
              organisation={organisation}
              isAdmin={isAdmin}
              columns={columns}
              fold={line.level === "division" && lines.some((l) => insideDivision(l, line.scope)) ? { folded: folded.has(line.scope), toggle: () => toggle(line.scope) } : null}
            />
          ),
        )}
      </ul>
      {/* What the cap column's marks mean, said once rather than on every row. */}
      <p className="flex flex-wrap gap-x-5 gap-y-1 border-t bg-ground px-5 py-2.5 text-sm text-ink-muted">
        {held && (
          <span>
            <span className="font-semibold text-ink-body">↑&nbsp;{formatNumber(held.capCredits ?? 0)}</span> no cap of its own: the cap above it, shown, holds
          </span>
        )}
        <span>
          <span className="font-semibold text-ink-body">—</span> no cap here or above it
        </span>
        {lines.some((l) => l.level === "employee") && <span>An employee&rsquo;s spending is with the contractors it briefs</span>}
      </p>
    </div>
  );
}

/** Whether a row sits inside a division: its projects and apps, and the employees placed in it. */
function insideDivision(line: BudgetLine, division: string): boolean {
  return line.scope.startsWith(`${division}/`) || (line.level === "employee" && line.scope === division);
}

const KIND: Partial<Record<BudgetLine["level"], string>> = { app: "app", employee: "employee" };

function BudgetRow({
  line,
  lines,
  organisation,
  isAdmin,
  columns,
  fold,
}: {
  line: BudgetLine;
  lines: BudgetLine[];
  organisation: string;
  isAdmin: boolean;
  columns: string;
  fold: { folded: boolean; toggle: () => void } | null;
}) {
  const capped = line.capCredits !== null;
  const used = percent(line.spentCredits, line.capCredits);
  const over = capped && line.spentCredits >= (line.capCredits ?? 0);
  const above = capped ? null : capAbove(lines, line);
  const href = line.appId ? paths.app(line.appId) : line.employeeId ? paths.employee(line.employeeId) : null;
  const top = line.depth <= 1 && line.level !== "employee";
  return (
    <li data-scope={line.scope} data-level={line.level} className={cn("grid items-center gap-x-4 gap-y-1.5 border-b px-5 py-2 last:border-b-0 max-sm:py-3", columns, line.depth === 0 && "bg-ground")}>
      <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${Math.min(line.depth, 5) * 1.5}rem` }}>
        {fold ? (
          <button
            type="button"
            aria-expanded={!fold.folded}
            aria-label={`${fold.folded ? "Show" : "Hide"} what is in ${line.name}`}
            onClick={fold.toggle}
            className="relative -ml-8 mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-xs text-ink-muted after:absolute after:-inset-2.5 after:content-[''] hover:bg-ground hover:text-ink"
          >
            <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", fold.folded && "-rotate-90")} />
          </button>
        ) : null}
        {href ? (
          <Link href={href} className={cn("min-w-0 truncate rounded-xs text-ink underline-offset-2 hover:text-primary-hover hover:underline", top && "font-semibold", TAP_LINE)}>
            {line.name}
          </Link>
        ) : (
          <span className={cn("min-w-0 truncate", top && "font-semibold")}>{line.name}</span>
        )}
        {KIND[line.level] && <span className="shrink-0 text-xs text-ink-muted">{KIND[line.level]}</span>}
      </span>
      <span className="flex min-w-0 flex-col gap-1 max-sm:col-span-2 max-sm:row-start-2">
        <span className="whitespace-nowrap tabular-nums text-ink-body">
          {formatNumber(line.spentCredits)}
          {capped && <span className="text-ink-muted sm:hidden"> of {formatNumber(line.capCredits ?? 0)} this month</span>}
        </span>
        {capped && <Bar value={used} label={`${formatNumber(line.spentCredits)} of ${formatNumber(line.capCredits ?? 0)} used`} tone={over ? "attention" : "primary"} className="h-1.5" />}
      </span>
      <span className="whitespace-nowrap text-right tabular-nums max-sm:hidden">
        {capped ? (
          <span className={cn("font-semibold", over && "text-attention-text")}>{formatNumber(line.capCredits ?? 0)}</span>
        ) : above ? (
          <span aria-label={noCapLine(lines, line)} title={noCapLine(lines, line)} className="text-ink-muted">
            ↑&nbsp;{formatNumber(above.capCredits ?? 0)}
          </span>
        ) : (
          <span aria-label={noCapLine(lines, line)} title={noCapLine(lines, line)} className="text-ink-muted">
            —
          </span>
        )}
      </span>
      {isAdmin && (
        <ErrorBoundary name={`The cap on ${line.name}`}>
          <CapControl line={line} lines={lines} organisation={organisation} />
        </ErrorBoundary>
      )}
    </li>
  );
}

function OverdraftAside({ credits, organisation, role }: { credits: Credits; organisation: string; role: MemberRole | null }) {
  const isOwner = role === "owner";
  const isAdmin = roleRank(role) >= roleRank("admin");
  return (
    <>
      <Fold title="If you run out" summary={credits.overdraft ? `You can go ${formatNumber(credits.overdraft.ownLimit ?? credits.overdraft.frostauraLimit)} below zero` : "Work stops at zero"}>
      <section className={cn("flex flex-col gap-3", RISE)}>
        <h2 className={SECTION}>If you run out</h2>
        <p className="text-ink-body">Nothing stops at zero. You can go below it, down to your limit, and the next top-up settles it.</p>
        {credits.overdraft ? (
          <dl className="grid grid-cols-grow-end gap-x-4 gap-y-2.5 rounded-xs border border-border-strong px-4 py-4">
            <dt className="text-ink-body">Most FrostAura allows</dt>
            <dd className="whitespace-nowrap text-right font-semibold tabular-nums">{formatNumber(credits.overdraft.frostauraLimit)} below zero</dd>
            <dt className="text-ink-body">Your own limit</dt>
            <dd className="whitespace-nowrap text-right font-semibold tabular-nums">{credits.overdraft.ownLimit !== null ? `${formatNumber(credits.overdraft.ownLimit)} below zero` : "Not set"}</dd>
          </dl>
        ) : (
          <p data-state="empty" className="text-ink-muted">
            No overdraft is set for your organisation, so work stops at zero.
          </p>
        )}
        {credits.overdraft && (
          <ErrorBoundary name="Your overdraft limit">
            <OwnLimit organisation={organisation} credits={credits} isOwner={isOwner} />
          </ErrorBoundary>
        )}
        {credits.overdraft && isAdmin && (
          <ErrorBoundary name="The tighter limits">
            <NarrowerLimits credits={credits} organisation={organisation} />
          </ErrorBoundary>
        )}
        {credits.overdraft && isAdmin && (
          <ErrorBoundary name="A tighter limit">
            <NarrowerLimit organisation={organisation} credits={credits} />
          </ErrorBoundary>
        )}
        <p className="text-sm text-ink-muted">An overdraft never carries interest or fees.</p>
      </section>
      </Fold>
      <Fold title="At the limit" summary="What stops, and what is kept">
      <section className="flex flex-col gap-2.5">
        <h2 className={SECTION}>At the limit</h2>
        <ul className="flex flex-col gap-2 text-ink-body">
          <li>Employees stop working.</li>
          <li>Apps pause behind a holding page.</li>
          <li>All data, code and memory are kept.</li>
          <li>A top-up brings everything back at once.</li>
        </ul>
        <span className="text-sm text-ink-muted">You are warned at zero and again halfway to the limit.</span>
      </section>
      </Fold>
      <section id="asking-for-more" className="flex scroll-mt-6 flex-col gap-2.5">
        <h2 className={SECTION}>Asking for more</h2>
        <p className="text-ink-body">There is no card on file: FrostAura adds credits by hand when you ask.</p>
        <ErrorBoundary name="Top-up requests">
          <TopUpRequests organisation={organisation} isOwner={isOwner} isAdmin={isAdmin} />
        </ErrorBoundary>
      </section>
    </>
  );
}
