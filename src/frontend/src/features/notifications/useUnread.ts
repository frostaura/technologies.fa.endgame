import { useGetNotificationsQuery } from "@/store/api";

/** How often the feed and the bell refresh. */
export const NOTIFICATIONS_POLL_MS = 30_000;

/** The unread count on the bell; null while it is unknown, so nothing is shown rather than a guess. */
export function useUnread(organisation: string | null): number | null {
  const query = useGetNotificationsQuery(organisation ?? "", { skip: !organisation, pollingInterval: NOTIFICATIONS_POLL_MS, skipPollingIfUnfocused: true });
  return query.data ? query.data.unread : null;
}
