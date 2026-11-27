import { LogOut } from "lucide-react";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { formatNumber } from "@/lib/format";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { useGetCreditsQuery, useLogoutMutation } from "@/store/api";
import { modeSet, storeEntered } from "@/store/uiSlice";
import { forgetReturnTo } from "@/features/auth/returnTo";

/** The mode toggle, the balance and signing out: the header's on a desktop, More's on a phone. */

export function ModeToggle() {
  const mode = useAppSelector((s) => s.ui.mode);
  const dispatch = useAppDispatch();
  const option = (value: "normal" | "technical", label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => dispatch(modeSet(value))}
      className={cn(
        // 36px drawn inside the 44px track; the track's padding is part of the target, and the focus ring stays inside it.
        "relative h-9 rounded-xs px-2.5 text-sm transition-colors before:absolute before:-inset-y-1 before:inset-x-0 focus-visible:ring-inset focus-visible:ring-offset-0 xl:px-4",
        mode === value ? "bg-surface font-semibold text-ink shadow-toggle" : "bg-transparent text-ink-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Mode" className="flex h-11 shrink-0 items-center rounded-xs bg-quiet p-1 ring-1 ring-inset ring-border-strong">
      {option("normal", "Normal")}
      {option("technical", "Technical")}
      {mode === "technical" && (
        <Link
          href={paths.system()}
          title="System"
          className="relative ml-1 flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-xs px-2 text-sm text-ink-muted before:absolute before:-inset-y-1 before:inset-x-0 hover:text-ink focus-visible:ring-inset focus-visible:ring-offset-0 2xl:px-3"
        >
          <Icon name="health" className="size-4" />
          <span className="sr-only 2xl:not-sr-only">System</span>
        </Link>
      )}
    </div>
  );
}

export function CreditsPill({ scope }: { scope: string }) {
  const query = useGetCreditsQuery(scope, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const base = "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xs px-3 transition sm:gap-2.5 sm:px-4 duration-200 hover:-translate-y-0.5 hover:shadow-press motion-reduce:transition-none motion-reduce:hover:translate-y-0";
  if (query.data) {
    const low = query.data.balance <= 0;
    return (
      <Link href={paths.credits()} className={cn(base, low ? "bg-attention-tint text-ink" : "bg-success-tint text-ink")}>
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", low ? "bg-attention-text" : "bg-success")} />
        <span className="font-semibold">{formatNumber(query.data.balance)}</span>
        <span className={low ? "text-attention-text" : "text-success-text"}>
          credits<span className="sr-only xl:not-sr-only"> left</span>
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

/**
 * Signing out leaves nothing for the next person on this tab: no return address, no entered organisation.
 * `compact`: the header's — an icon below `xl`, where the bar has no room for the words, and the words above.
 */
export function SignOut({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [logout, state] = useLogoutMutation();
  const signOut = async () => {
    forgetReturnTo();
    const done = await logout(undefined);
    if (!("error" in done)) storeEntered(null);
  };
  return (
    <button
      type="button"
      disabled={state.isLoading}
      onClick={() => void signOut()}
      aria-label={compact ? "Sign out" : undefined}
      title={compact ? "Sign out" : undefined}
      className={cn(
        "min-h-touch rounded-xs text-sm text-ink-muted hover:text-ink disabled:opacity-50",
        compact ? "flex size-11 shrink-0 items-center justify-center hover:bg-ground xl:w-auto xl:px-3" : "px-3",
        className,
      )}
    >
      {compact ? (
        <>
          <LogOut aria-hidden className="size-5 xl:hidden" />
          <span className="max-xl:hidden">Sign out</span>
        </>
      ) : (
        "Sign out"
      )}
    </button>
  );
}
