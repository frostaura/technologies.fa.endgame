import type { ReactNode } from "react";
import { Link } from "@/components/Link";
import { Icon } from "@/components/Icon";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { shortTitle } from "@/lib/plain";
import { useAppDispatch, useAppSelector } from "@/store";
import { useGetCreditsQuery, useGetMeQuery, useLogoutMutation } from "@/store/api";
import { modeSet } from "@/store/uiSlice";
import { GodModeBand } from "./GodModeBand";
import { NotificationsBell } from "./NotificationsBell";

export interface Crumb {
  label: string;
  href?: string;
  /** Instead of a link: select this level in place (the home screen's breadcrumb). */
  onSelect?: () => void;
}

/**
 * The console frame, as drawn: the mark, where you are, the mode toggle and the balance. The page
 * below is full width; each screen decides its own columns.
 */
export function AppShell({ crumbs, aside, children }: { crumbs: Crumb[]; aside?: ReactNode; children: ReactNode }) {
  const { data: me } = useGetMeQuery(undefined);
  const org = me?.organisation ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xs focus:bg-surface focus:px-4 focus:py-2">
        Skip to the content
      </a>
      {me?.isOperator && <GodModeBand />}
      <header className="border-b bg-surface">
        {/*
          Desktop: one row. Phone: two — the mark, where you are and sign-out; then the mode toggle
          and the balance. Where you are keeps to one line there, showing its last two steps.
        */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:gap-x-4 sm:gap-y-3 sm:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-x-3 sm:flex-wrap sm:gap-x-5 sm:gap-y-2">
            <Link href={paths.home()} aria-label="Endgame home" className="flex shrink-0 items-center gap-2.5 rounded-xs text-ink">
              <img src="/brand/endgame-mark.svg" alt="" width={30} height={30} className="size-8" />
              <span className={cn("font-display text-lg font-bold tracking-tight", crumbs.length > 0 && "hidden sm:inline")}>Endgame</span>
            </Link>
            {crumbs.length > 0 && <Breadcrumb crumbs={crumbs} />}
          </div>
          <div className="order-last flex w-full items-center justify-between gap-3 sm:order-none sm:w-auto sm:justify-end">
            <ModeToggle />
            {org && <CreditsPill scope={org.slug} />}
          </div>
          {org && <NotificationsBell organisation={org.slug} />}
          {me && <SignOut />}
        </div>
      </header>
      <div className="flex flex-1 flex-col lg:flex-row">
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 outline-none sm:px-8 sm:py-8 lg:py-10">
          {children}
        </main>
        {aside && (
          <aside className="flex min-w-0 flex-col gap-7 border-t bg-surface px-4 py-8 sm:px-8 lg:w-dock lg:shrink-0 lg:border-l lg:border-t-0 lg:py-10 xl:w-dock">{aside}</aside>
        )}
      </div>
    </div>
  );
}

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  // On a phone only the last two steps show, after an ellipsis, so the header stays two rows.
  const firstShownOnPhone = Math.max(0, crumbs.length - 2);
  return (
    <nav aria-label="Where you are" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-ink-muted sm:flex-wrap">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          // A step is a name, not a paragraph: a run titled with its whole idea is cut to a line.
          const label = shortTitle(crumb.label, 48);
          return (
            <li
              key={`${i}-${crumb.label}`}
              className={cn(
                "min-w-0 items-center gap-2",
                i < firstShownOnPhone ? "hidden sm:flex" : "flex",
                // The steps hidden on a phone leave an ellipsis, drawn by CSS with empty alternative text so it is never read out.
                i === firstShownOnPhone && i > 0 && "before:shrink-0 before:[content:'…_/'_/_''] sm:before:[content:none]",
              )}
            >
              {i > 0 && <span aria-hidden className={cn(i === firstShownOnPhone && "hidden sm:inline")}>/</span>}
              {crumb.onSelect && !last ? (
                <button type="button" onClick={crumb.onSelect} className="min-h-touch min-w-0 truncate rounded-xs text-primary-link hover:text-primary-hover">
                  {label}
                </button>
              ) : crumb.href && !last ? (
                <Link href={crumb.href} className="min-w-0 truncate rounded-xs text-primary-link hover:text-primary-hover">
                  {label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} title={label !== crumb.label ? crumb.label : undefined} className={cn("truncate", last && "font-medium text-ink")}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ModeToggle() {
  const mode = useAppSelector((s) => s.ui.mode);
  const dispatch = useAppDispatch();
  const option = (value: "normal" | "technical", label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => dispatch(modeSet(value))}
      className={cn(
        "min-h-touch rounded-xs px-2.5 text-sm transition-colors sm:px-4",
        mode === value ? "bg-surface font-semibold text-ink shadow-toggle" : "bg-transparent text-ink-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Mode" className="flex rounded-xs bg-quiet p-1">
      {option("normal", "Normal")}
      {option("technical", "Technical")}
      {mode === "technical" && (
        <Link href={paths.system()} className="ml-1 flex min-h-touch min-w-touch items-center justify-center gap-1.5 rounded-xs px-2 text-sm text-ink-muted hover:text-ink sm:px-3">
          <Icon name="health" className="size-4" />
          <span className="sr-only sm:not-sr-only">System</span>
        </Link>
      )}
    </div>
  );
}

function CreditsPill({ scope }: { scope: string }) {
  const query = useGetCreditsQuery(scope, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const base = "flex min-h-touch items-center gap-2 rounded-sm px-3 transition sm:gap-2.5 sm:px-4 duration-200 hover:-translate-y-0.5 hover:shadow-press motion-reduce:transition-none motion-reduce:hover:translate-y-0";
  if (query.data) {
    const low = query.data.balance <= 0;
    return (
      <Link href={paths.credits()} className={cn(base, low ? "bg-attention-tint text-ink" : "bg-success-tint text-ink")}>
        <span aria-hidden className={cn("size-2 rounded-full", low ? "bg-attention-text" : "animate-pulse bg-success motion-reduce:animate-none")} />
        <span className="font-semibold">{formatNumber(query.data.balance)}</span>
        <span className={low ? "text-attention-text" : "text-success-text"}>
          credits<span className="sr-only sm:not-sr-only"> left</span>
        </span>
      </Link>
    );
  }
  if (query.isError) {
    return (
      <Link href={paths.credits()} role="status" data-state="failed" className={cn(base, "bg-attention-tint text-attention-text")}>
        Balance unavailable
      </Link>
    );
  }
  return (
    <span role="status" aria-busy="true" className={cn(base, "w-32 animate-shimmer sm:w-40 bg-shimmer text-ink-muted motion-reduce:animate-none")}>
      <span className="sr-only">Loading the balance</span>
    </span>
  );
}

function SignOut() {
  const [logout, state] = useLogoutMutation();
  return (
    <button
      type="button"
      disabled={state.isLoading}
      onClick={() => void logout(undefined)}
      className="min-h-touch rounded-xs px-3 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
