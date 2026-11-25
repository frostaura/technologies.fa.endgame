import { useEffect, useId, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Link } from "@/components/Link";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { BellIcon, NotificationFeed } from "../notifications/NotificationFeed";
import { useUnread } from "../notifications/useUnread";

const base = "flex min-h-touch min-w-touch items-center justify-center rounded-xs text-ink-muted hover:bg-ground hover:text-ink";

/**
 * The bell in the header: the unread count, and the feed beneath it. On a phone it is a link to the
 * full feed, which uses the whole screen; on anything wider it opens the feed in place.
 */
export function NotificationsBell({ organisation }: { organisation: string }) {
  const unread = useUnread(organisation);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const label = unread === null ? "Notifications" : unread === 0 ? "Notifications, none unread" : `Notifications, ${unread} unread`;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Link href={paths.notifications()} aria-label={label} className={cn(base, "sm:hidden")}>
        <BellIcon unread={unread} />
      </Link>
      <button type="button" aria-label={label} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((x) => !x)} className={cn(base, "hidden sm:flex", open && "bg-ground text-ink")}>
        <BellIcon unread={unread} />
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-40 mt-2 hidden max-h-graph w-dock flex-col gap-3 overflow-y-auto rounded-md border bg-surface p-4 shadow-raised sm:flex">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Notifications</h2>
            <Link href={paths.notifications()} onClick={() => setOpen(false)} className="rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover">
              See all
            </Link>
          </div>
          <ErrorBoundary name="Your notifications">
            <NotificationFeed organisation={organisation} limit={8} compact onNavigate={() => setOpen(false)} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
