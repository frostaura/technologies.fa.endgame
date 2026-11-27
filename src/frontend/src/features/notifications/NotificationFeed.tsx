import { useState, type ReactNode } from "react";
import { TAP } from "@/lib/touch";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, timeAgo } from "@/lib/format";
import { describeError, viewOf } from "@/lib/queryState";
import { cn } from "@/lib/utils";
import { useViewport } from "@/lib/useViewport";
import { useAppSelector } from "@/store";
import { useGetNotificationsQuery, useMarkAllReadMutation, useMarkReadMutation } from "@/store/api";
import type { NotificationItem } from "@/store/types";
import { byDay, notificationHref, notificationLines, PHONE_PAGE, phoneShown, settledLabel } from "./notificationModel";
import { NOTIFICATIONS_POLL_MS } from "./useUnread";

/** The feed of what needs the person, newest first: each links to what it is about, and can be marked read. */
export function NotificationFeed({ organisation, limit, onNavigate, compact = false }: { organisation: string; limit?: number; onNavigate?: () => void; compact?: boolean }) {
  const query = useGetNotificationsQuery(organisation, { pollingInterval: NOTIFICATIONS_POLL_MS, skipPollingIfUnfocused: true });
  const view = viewOf(query);
  const [markAll, all] = useMarkAllReadMutation();
  const [problem, setProblem] = useState<string | null>(null);
  // The feed opens on what is unread and the newest few, and shows older ones a page at a time.
  const [older, setOlder] = useState(0);

  const readAll = async () => {
    setProblem(null);
    try {
      await markAll(organisation).unwrap();
    } catch (e) {
      setProblem(`They were not marked read: ${describeError(e as never)}`);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {view.kind === "loading" && (
        <Loading label="Loading your notifications" className="flex flex-col gap-2">
          <Skeleton className="h-16 rounded-sm" />
          <Skeleton className="h-16 rounded-sm" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="Your notifications could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ink-body">{view.data.unread === 0 ? "Nothing unread." : `${view.data.unread} unread`}</span>
            {view.data.unread > 0 && (
              <Button size="sm" variant="quiet" onClick={() => void readAll()} disabled={all.isLoading}>
                Mark all read
              </Button>
            )}
          </div>
          {problem && (
            <p role="alert" className="text-sm text-attention-text">
              {problem}
            </p>
          )}
          {view.data.notifications.length === 0 ? (
            <Empty icon="notifications" title="Nothing needs you" className={compact ? "p-4" : undefined}>
              Verdicts waiting, approvals, hires, budgets running low and anything that breaks appear here.
            </Empty>
          ) : limit !== undefined ? (
            // The bell's popover: the few that matter most, in the server's order (what is unread first).
            <ul aria-label="Notifications" className="flex flex-col divide-y overflow-hidden rounded-sm border bg-surface">
              {view.data.notifications.slice(0, limit).map((n) => (
                <Row key={n.id} organisation={organisation} item={n} onNavigate={onNavigate} compact />
              ))}
            </ul>
          ) : (
            <Feed items={view.data.notifications} older={older} onOlder={() => setOlder((n) => n + PHONE_PAGE)}>
              {(n) => <Row key={n.id} organisation={organisation} item={n} onNavigate={onNavigate} />}
            </Feed>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The whole feed, by day: every unread notice and the newest ten, at every size, then older ones ten
 * at a time — so thirty notices are never one 6,000-pixel column (real-stack 21).
 */
function Feed({ items, older, onOlder, children }: { items: NotificationItem[]; older: number; onOlder: () => void; children: (n: NotificationItem) => ReactNode }) {
  const shown = phoneShown(items, older);
  const hidden = items.length - shown.length;
  return (
    <>
      <ul aria-label="Notifications" className="flex flex-col gap-5">
        {byDay(shown).map((group) => (
          <li key={group.day} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-ink-muted">{group.day}</h2>
            <ul className="flex flex-col divide-y overflow-hidden rounded-md border bg-surface shadow-card">{group.items.map(children)}</ul>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <Button variant="secondary" className="self-center" onClick={onOlder}>
          Show older ({formatNumber(Math.min(hidden, PHONE_PAGE))} of {formatNumber(hidden)})
        </Button>
      )}
    </>
  );
}

/**
 * One notice. Unread is said one way only: a dot before it (and its title in bold); a read notice has
 * neither. Its kind is one tag, the time sits in one place, and "Mark read" is a quiet action at the end
 * of the tag's line.
 */
function Row({ organisation, item, onNavigate, compact = false }: { organisation: string; item: NotificationItem; onNavigate?: () => void; compact?: boolean }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [markRead] = useMarkReadMutation();
  const [problem, setProblem] = useState<string | null>(null);
  const lines = notificationLines(item);
  // An answered notice is settled: its title already says what happened, so it is never new and has nothing to mark (D40).
  const unread = !item.read && !item.resolved;
  const settled = settledLabel(item);
  // Narrow (a phone, or the bell's popover), the time and "Mark read" end the tag line instead of taking a column.
  const inline = useViewport() === "phone" || compact;
  const read = async () => {
    setProblem(null);
    try {
      await markRead({ organisation, id: item.id }).unwrap();
    } catch (e) {
      setProblem(`Not marked read: ${describeError(e as never)}`);
    }
  };
  return (
    <li
      data-notification={item.id}
      data-read={item.read || item.resolved}
      data-resolved={item.resolved}
      className={cn("grid min-w-0 gap-x-3 gap-y-1 py-3", inline ? "grid-cols-dot-grow" : "grid-cols-dot-grow-end", compact ? "px-3" : "px-4 sm:px-5")}
    >
      <span className={cn("mt-2 size-2 rounded-full", unread ? "bg-primary" : "bg-transparent")}>{unread && <span className="sr-only">Unread</span>}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          href={notificationHref(item)}
          onClick={() => {
            if (unread) void read();
            onNavigate?.();
          }}
          className={cn("break-words hover:text-primary-hover", TAP, unread ? "font-semibold text-ink" : "font-medium text-ink-body")}
        >
          {lines.title}
        </Link>
        {lines.line && <p className="break-words text-sm text-ink-body">{lines.line}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
          <Badge tone={!item.resolved && item.severity === "urgent" ? "warn" : "neutral"}>{lines.kind}</Badge>
          {item.resolved && <Badge tone={settled === "Closed" ? "neutral" : "good"}>{settled}</Badge>}
          {item.emailedAt && <span className="text-xs text-ink-muted">Also e-mailed</span>}
          {technical && <code className="font-mono text-xs text-ink-muted">{item.kind}</code>}
          {technical && lines.technical && <code className="basis-full break-all font-mono text-xs text-ink-muted">{lines.technical}</code>}
          {/* "Mark read" ends the tag's line, at every width; narrow, the time joins it instead of taking a column of its own. */}
          {(inline || unread) && (
            <span className="ml-auto flex items-center gap-1">
              {inline && <Time at={item.createdAt} />}
              {unread && <MarkRead onClick={() => void read()} />}
            </span>
          )}
        </div>
        {problem && (
          <p role="alert" className="text-sm text-attention-text">
            {problem}
          </p>
        )}
      </div>
      {!inline && <Time at={item.createdAt} />}
    </li>
  );
}

function Time({ at }: { at: string }) {
  return (
    <time dateTime={at} title={at} className="whitespace-nowrap pt-0.5 text-xs text-ink-muted">
      {timeAgo(at)}
    </time>
  );
}

function MarkRead({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="quiet" className="-mr-2" onClick={onClick}>
      Mark read
    </Button>
  );
}

export function BellIcon({ unread }: { unread: number | null }) {
  return (
    <span className="relative flex">
      <Icon name="notifications" className="size-5" />
      {unread !== null && unread > 0 && (
        <span aria-hidden className="absolute -right-2 -top-2 flex min-w-5 items-center justify-center rounded-full bg-attention-text px-1 text-xs font-semibold leading-5 text-primary-ink">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </span>
  );
}
