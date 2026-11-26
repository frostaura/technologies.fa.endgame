import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Link } from "./Link";

export interface NavItem {
  key: string;
  /** The word under the icon. */
  label: string;
  icon: ReactNode;
  /** A place: drawn as a link. */
  href?: string;
  /** An act (opening a sheet): drawn as a button. */
  onClick?: () => void;
  current?: boolean;
  /** Read out instead of the label when the label alone does not say enough ("Notifications, 3 unread"). */
  name?: string;
  /** For a button that opens a sheet. */
  expanded?: boolean;
}

/**
 * The phone's bottom bar: the handful of places a person goes most, one tap each, always in reach of
 * a thumb. It sits above the home indicator's safe area; each item is a full-height touch target.
 */
export function BottomNav({ items, label = "Main" }: { items: NavItem[]; label?: string }) {
  return (
    <nav aria-label={label} data-bottom-nav="" className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 pb-safe-b pl-safe-l pr-safe-r backdrop-blur">
      <ul className="mx-auto flex h-nav max-w-form items-stretch short:h-bar">
        {items.map((item) => {
          const body = (
            <>
              <span aria-hidden className="relative flex">
                {item.icon}
              </span>
              <span className="max-w-full truncate text-xs font-medium leading-tight">{item.label}</span>
            </>
          );
          const cls = cn(
            "flex h-full min-h-touch w-full min-w-touch flex-col items-center justify-center gap-1 rounded-xs px-1 transition-colors short:flex-row short:gap-2",
            item.current ? "text-primary" : "text-ink-muted hover:text-ink",
          );
          return (
            <li key={item.key} className="flex min-w-0 flex-1">
              {item.href ? (
                <Link href={item.href} aria-label={item.name} aria-current={item.current ? "page" : undefined} data-nav={item.key} className={cls}>
                  {body}
                </Link>
              ) : (
                <button type="button" onClick={item.onClick} aria-label={item.name} aria-expanded={item.expanded} data-nav={item.key} className={cls}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
