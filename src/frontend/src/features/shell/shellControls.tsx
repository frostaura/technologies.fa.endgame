import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, LogOut } from "lucide-react";
import { MENU, MENU_ITEM } from "@/components/ui/layout";
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

export function ModeToggle({ fill = false }: { fill?: boolean }) {
  const mode = useAppSelector((s) => s.ui.mode);
  const dispatch = useAppDispatch();
  const option = (value: "normal" | "technical", label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => dispatch(modeSet(value))}
      className={cn(
        // 36px drawn inside the 44px track; the track's padding is part of the target, and the focus ring stays inside it.
        "relative h-9 rounded-xs px-2.5 text-sm transition-colors after:absolute after:-inset-y-1 after:inset-x-0 focus-visible:ring-inset focus-visible:ring-offset-0 xl:px-4",
        fill && "flex-1 touch:h-10",
        mode === value ? "bg-surface font-semibold text-ink shadow-toggle" : "bg-transparent text-ink-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );
  // The switch is the same width in both modes: System is a link of its own beside it, never inside it.
  return (
    <div role="group" aria-label="Mode" className={cn("relative flex h-11 shrink-0 items-center rounded-xs bg-quiet p-1 ring-1 ring-inset ring-border-strong", fill && "w-full touch:h-12")}>
      {option("normal", "Normal")}
      {option("technical", "Technical")}
    </div>
  );
}

/** Technical mode's System status: an icon link of its own, outside the mode switch. */
export function SystemLink({ className }: { className?: string }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  if (!technical) return null;
  return (
    <Link href={paths.system()} aria-label="System" title="System" className={cn("flex size-11 shrink-0 items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink", className)}>
      <Icon name="health" className="size-5" />
    </Link>
  );
}

/**
 * The balance in the header: a neutral chip that says "Credits", the figure and a small dot — green with room
 * to spend, amber below zero, red only at a real limit (nothing left to spend, overdraft included), grey for
 * an organisation never topped up. It leads to Credits. Never a coloured pill.
 */
export function CreditsPill({ scope }: { scope: string }) {
  const query = useGetCreditsQuery(scope, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const base = "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xs border bg-surface px-3 text-sm text-ink transition-colors hover:bg-ground sm:px-3.5";
  if (query.data) {
    const c = query.data;
    const dot = c.neverToppedUp ? "bg-ink-muted" : c.available <= 0 ? "bg-attention-text" : c.balance < 0 ? "bg-warn" : "bg-success";
    const state = c.neverToppedUp ? "never topped up" : c.available <= 0 ? "at its limit" : c.balance < 0 ? "below zero" : null;
    return (
      <Link href={paths.credits()} data-credits-chip="" className={base}>
        <span aria-hidden className="text-ink-muted">
          Credits
        </span>
        <span aria-hidden className="font-semibold tabular-nums">
          {formatNumber(c.balance)}
        </span>
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
        <span className="sr-only">
          {formatNumber(c.balance)} credits left{state ? `, ${state}` : ""}
        </span>
      </Link>
    );
  }
  if (query.isError) {
    return (
      <Link href={paths.credits()} role="status" data-state="failed" className={base}>
        <span className="text-ink-muted">Credits</span>
        <span className="text-attention-text">unavailable</span>
      </Link>
    );
  }
  return (
    <span role="status" aria-busy="true" className={cn(base, "w-32 animate-shimmer bg-shimmer motion-reduce:animate-none")}>
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
        "min-h-touch rounded-xs text-sm text-ink-muted hover:text-ink disabled:text-ink-muted",
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

/**
 * The account menu, below `hd` where the header has no room for the mode switch and Sign out: your account,
 * the mode, System (in Technical mode) and signing out, under the account icon. From `hd` the icon is a plain
 * link to your account and the rest sit in the header.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-label="Your account, the mode and signing out"
        title="Your account"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((x) => !x)}
        className={cn("flex size-11 items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink", open && "bg-ground text-ink")}
      >
        <Icon name="employee" className="size-5" />
      </button>
      <div id={id} hidden={!open} className={cn(MENU, "absolute right-0 top-full w-72 gap-1 p-2")}>
        <Link href={paths.account()} onClick={() => setOpen(false)} className={MENU_ITEM}>
          <Icon name="employee" className="size-4 text-ink-muted" />
          <span className="flex-1">Your account</span>
          <ChevronRight aria-hidden className="size-4 text-ink-muted" />
        </Link>
        {technical && (
          <Link href={paths.system()} onClick={() => setOpen(false)} className={MENU_ITEM}>
            <Icon name="health" className="size-4 text-ink-muted" />
            <span className="flex-1">System status</span>
            <ChevronRight aria-hidden className="size-4 text-ink-muted" />
          </Link>
        )}
        <div className="flex flex-col gap-1.5 border-y px-1 py-2.5">
          <span className="px-2 text-sm font-medium text-ink-muted">Mode</span>
          <ModeToggle fill />
        </div>
        <SignOut className={cn(MENU_ITEM, "text-ink")} />
      </div>
    </div>
  );
}
