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
import { AppShell } from "../shell/AppShell";
import { CapControl, NarrowerLimit, NarrowerLimits, OwnLimit, TopUpRequests } from "./CreditsActions";
import { noCapLine, paceLine } from "./creditsModel";

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
        <p data-state="empty" className="rounded-md border border-dashed border-border-strong bg-surface p-6 text-ink-body">
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

/** The highest level a person holds a role at in one organisation: a division before a project before an app. */
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
      {/* The hero: white, the balance as the page's title, the month's figures beside it. Below zero, the figure says so in red. */}
      <section aria-label="Balance" className={cn("flex flex-wrap items-end gap-x-16 gap-y-5 rounded-lg border bg-surface px-6 py-7 shadow-card max-sm:px-5 max-sm:py-5 sm:px-8", RISE)}>
        <div className="flex min-w-0 flex-col gap-1">
          <Stat plain valueAs="h1" size="xl" tone={negative ? "bad" : "ink"} label={<span className="text-eyebrow font-semibold uppercase">{negative ? "Below zero" : "Credits left"}</span>} value={formatNumber(credits.balance)} />
          <span className="text-ink-body">{paceLine(credits)}</span>
        </div>
        <div className="grid grid-cols-3 gap-x-8 gap-y-3 max-sm:w-full max-sm:gap-x-3">
          <Stat plain label="Spent this month" value={formatNumber(credits.month.spent)} />
          <Stat plain label="On AI work" value={formatNumber(credits.month.ai)} />
          <Stat plain label="On hosting" value={formatNumber(credits.month.hosting)} />
        </div>
      </section>

      <section className={cn("flex flex-col gap-3.5", RISE, stagger(1))}>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Budgets</h2>
          <span className="text-ink-body">
            A cap set higher up holds for everything beneath it. Work that would break a cap does not start.{isAdmin ? "" : " An Admin or the Owner sets the caps."}
          </span>
        </div>
        {credits.budgets.length === 0 ? (
          <p data-state="empty" className="rounded-md border border-dashed border-border-strong bg-surface p-5 text-ink-muted">
            No spending or caps anywhere in the tree yet.
          </p>
        ) : (
          // A phone folds the tree to a line: how many levels, how many carry a cap of their own.
          <Fold title="Every level’s spending and cap" summary={`${plural(credits.budgets.filter((l) => l.level !== "employee").length, "level")}, ${plural(credits.budgets.filter((l) => l.capCredits !== null).length, "cap")} set`}>
            <ul aria-label="Budgets" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
              {credits.budgets.map((line) => (
                <BudgetRow key={`${line.scope}#${line.level}#${line.name}`} line={line} lines={credits.budgets} organisation={organisation} isAdmin={isAdmin} />
              ))}
            </ul>
          </Fold>
        )}
      </section>

      <StatRow cols={2} label="How the month went" className={cn(RISE, stagger(2))}>
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
    </>
  );
}

const INDENT: Record<number, string> = { 0: "pl-0", 1: "pl-6", 2: "pl-12", 3: "pl-16", 4: "pl-20" };

function BudgetRow({ line, lines, organisation, isAdmin }: { line: BudgetLine; lines: BudgetLine[]; organisation: string; isAdmin: boolean }) {
  const used = percent(line.spentCredits, line.capCredits);
  const tone = line.depth === 0 ? "ink" : line.depth === 1 ? "primary" : "soft";
  const label = line.capCredits !== null ? `${formatNumber(line.spentCredits)} of ${formatNumber(line.capCredits)} used` : `${formatNumber(line.spentCredits)} used, no cap here`;
  return (
    <li
      data-scope={line.scope}
      className={cn(
        "grid grid-cols-1 items-center gap-x-5 gap-y-2 border-b py-3.5 pr-5 pl-5 transition-colors last:border-b-0 hover:bg-primary-tint sm:grid-cols-5",
        line.depth === 0 && "bg-primary-tint",
      )}
    >
      <span className={cn("min-w-0 truncate sm:col-span-2", INDENT[Math.min(line.depth, 4)], line.depth <= 1 && "font-semibold")}>
        {line.appId ? (
          <Link href={paths.app(line.appId)} className={cn("rounded-xs text-primary-link hover:text-primary-hover", TAP_LINE)}>
            {line.name}
          </Link>
        ) : line.employeeId ? (
          <Link href={paths.employee(line.employeeId)} className={cn("rounded-xs text-primary-link hover:text-primary-hover", TAP_LINE)}>
            {line.name}
          </Link>
        ) : (
          line.name
        )}
        {line.level === "employee" && <span className="block text-xs font-normal text-ink-muted">With the contractors it briefs</span>}
      </span>
      {line.capCredits !== null ? <Bar value={used} label={label} tone={used >= 100 ? "attention" : tone} className="sm:col-span-2" /> : <span className="text-sm text-ink-muted sm:col-span-2">{noCapLine(lines, line)}</span>}
      <span className="text-ink-body sm:text-right">{line.capCredits !== null ? `${formatNumber(line.spentCredits)} of ${formatNumber(line.capCredits)}` : formatNumber(line.spentCredits)}</span>
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
        <h2 className="text-lg font-semibold">If you run out</h2>
        <p className="text-ink-body">Nothing stops at zero. You can go below it, down to your limit, and the next top-up settles it.</p>
        {credits.overdraft ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xs border border-border-strong px-4 py-4">
            <dt className="text-ink-body">Most FrostAura allows you</dt>
            <dd className="text-right font-semibold">{formatNumber(credits.overdraft.frostauraLimit)} below zero</dd>
            <dt className="text-ink-body">Your own limit</dt>
            <dd className="text-right font-semibold">{credits.overdraft.ownLimit !== null ? `${formatNumber(credits.overdraft.ownLimit)} below zero` : "Not set"}</dd>
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
        <h2 className="text-lg font-semibold">At the limit</h2>
        <ul className="flex flex-col gap-2 text-ink-body">
          <li>Employees stop working.</li>
          <li>Apps pause behind a holding page.</li>
          <li>All data, code and memory are kept.</li>
          <li>A top-up brings everything back at once.</li>
        </ul>
        <span className="text-sm text-ink-muted">You are warned at zero and again halfway to the limit.</span>
      </section>
      </Fold>
      <Fold title="Top-ups" summary={credits.topUps.length === 0 ? "None yet" : plural(credits.topUps.length, "top-up")}>
      <section className="flex flex-col gap-2.5">
        <h2 className="text-lg font-semibold">Top-ups</h2>
        {credits.topUps.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            No top-ups yet. FrostAura adds credits on request.
          </p>
        ) : (
          <ul className="flex flex-col rounded-xs border border-border-strong">
            {credits.topUps.map((t, i) => (
              <li key={`${t.at}-${i}`} className="flex justify-between gap-3 border-b px-4 py-3 last:border-b-0">
                <span className="flex flex-col">
                  <span>{t.note}</span>
                  <span className="text-sm text-ink-muted">{formatDate(t.at)}</span>
                </span>
                <span className="font-semibold">+ {formatNumber(t.credits)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      </Fold>
      <section id="asking-for-more" className="flex scroll-mt-6 flex-col gap-2.5">
        <h2 className="text-lg font-semibold">Asking for more</h2>
        <p className="text-ink-body">There is no card on file: FrostAura adds credits by hand when you ask.</p>
        <ErrorBoundary name="Top-up requests">
          <TopUpRequests organisation={organisation} isOwner={isOwner} isAdmin={isAdmin} />
        </ErrorBoundary>
      </section>
    </>
  );
}
