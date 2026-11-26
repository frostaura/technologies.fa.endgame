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
        "min-h-touch rounded-xs px-2.5 text-sm transition-colors lg:px-4",
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

export function CreditsPill({ scope }: { scope: string }) {
  const query = useGetCreditsQuery(scope, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const base = "flex min-h-touch items-center gap-2 rounded-sm px-3 transition sm:gap-2.5 sm:px-4 duration-200 hover:-translate-y-0.5 hover:shadow-press motion-reduce:transition-none motion-reduce:hover:translate-y-0";
  if (query.data) {
    const low = query.data.balance <= 0;
    return (
      <Link href={paths.credits()} className={cn(base, low ? "bg-attention-tint text-ink" : "bg-success-tint text-ink")}>
        <span aria-hidden className={cn("size-2 rounded-full", low ? "bg-attention-text" : "animate-pulse bg-success motion-reduce:animate-none")} />
        <span className="font-semibold">{formatNumber(query.data.balance)}</span>
        <span className={low ? "text-attention-text" : "text-success-text"}>
          credits<span className="sr-only lg:not-sr-only"> left</span>
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

/** Signing out leaves nothing for the next person on this tab: no return address, no entered organisation. */
export function SignOut({ className }: { className?: string }) {
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
      className={cn("min-h-touch rounded-xs px-3 text-sm text-ink-muted hover:text-ink disabled:opacity-50", className)}
    >
      Sign out
    </button>
  );
}
