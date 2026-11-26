import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import { describeError, viewOf } from "@/lib/queryState";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useGetNotificationsQuery, useMarkAllReadMutation, useMarkReadMutation } from "@/store/api";
import type { NotificationItem } from "@/store/types";
import { notificationHref, notificationLines } from "./notificationModel";
import { NOTIFICATIONS_POLL_MS } from "./useUnread";

/** The feed of what needs the person, newest first: each links to what it is about, and can be marked read. */
export function NotificationFeed({ organisation, limit, onNavigate, compact = false }: { organisation: string; limit?: number; onNavigate?: () => void; compact?: boolean }) {
  const query = useGetNotificationsQuery(organisation, { pollingInterval: NOTIFICATIONS_POLL_MS, skipPollingIfUnfocused: true });
  const view = viewOf(query);
  const [markAll, all] = useMarkAllReadMutation();
  const [problem, setProblem] = useState<string | null>(null);

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
              <Button size="sm" variant="ghost" onClick={() => void readAll()} disabled={all.isLoading}>
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
          ) : (
            <ul aria-label="Notifications" className="flex flex-col gap-2">
              {view.data.notifications.slice(0, limit).map((n) => (
                <Row key={n.id} organisation={organisation} item={n} onNavigate={onNavigate} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Row({ organisation, item, onNavigate }: { organisation: string; item: NotificationItem; onNavigate?: () => void }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [markRead] = useMarkReadMutation();
  const [problem, setProblem] = useState<string | null>(null);
  const lines = notificationLines(item);
  // An answered notice is settled: its title already says what happened, so it is never new and has nothing to mark (D40).
  const unread = !item.read && !item.resolved;
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
      className={cn("flex min-w-0 flex-col gap-1.5 rounded-sm border px-4 py-3", !unread ? "bg-surface" : item.severity === "urgent" ? "border-attention-line bg-attention-wash" : "border-primary-line bg-primary-tint")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={item.resolved ? "quiet" : item.severity === "urgent" ? "attention-strong" : "primary"}>{lines.kind}</Badge>
        {unread && <span className="text-xs font-semibold text-ink">New</span>}
        {item.resolved && <Badge tone="success">Answered</Badge>}
        <span className="ml-auto text-xs text-ink-muted">{timeAgo(item.createdAt)}</span>
      </div>
      <Link
        href={notificationHref(item)}
        onClick={() => {
          if (unread) void read();
          onNavigate?.();
        }}
        className={cn("break-words hover:text-primary-hover", item.resolved ? "font-medium text-ink-body" : "font-semibold text-ink")}
      >
        {lines.title}
      </Link>
      {lines.line && <p className="line-clamp-2 break-words text-sm text-ink-body">{lines.line}</p>}
      <div className="flex flex-wrap items-center gap-x-3">
        {unread && (
          <Button size="sm" variant="ghost" className="px-0" onClick={() => void read()}>
            Mark read
          </Button>
        )}
        {item.emailedAt && <span className="text-xs text-ink-muted">Also e-mailed</span>}
        {technical && <code className="font-mono text-xs text-ink-muted">{item.kind}</code>}
        {technical && lines.technical && <code className="break-all font-mono text-xs text-ink-muted">{lines.technical}</code>}
      </div>
      {problem && (
        <p role="alert" className="text-sm text-attention-text">
          {problem}
        </p>
      )}
    </li>
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
