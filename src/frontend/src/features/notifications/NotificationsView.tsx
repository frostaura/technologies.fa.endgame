import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/states";
import { RISE } from "@/lib/motion";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { AppShell } from "../shell/AppShell";
import { NotificationFeed } from "./NotificationFeed";

/** Everything that needs the person (UC-119), newest first. Owners and Admins see the feed; others an empty one. */
export function NotificationsView() {
  // In God mode, the entered organisation's feed (OP-04).
  const active = useActiveOrganisation();
  const org = active.organisation;
  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), { label: "Notifications" }]}>
      <header className={cn("flex flex-col gap-1.5", RISE)}>
        <h1 className="flex items-center gap-3 text-3xl font-semibold">
          <Icon name="notifications" tinted className="size-7" />
          Notifications
        </h1>
        <p className="max-w-prose text-ink-body">What needs you, newest first. The urgent ones — a cap reached, credits at zero, the overdraft, an app that stopped, a security finding — are e-mailed too, when e-mail is set up.</p>
      </header>
      {!active.isLoading && !org ? (
        <Empty icon="organisation" title="There are no notifications until your organisation is named" />
      ) : org ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ErrorBoundary name="Your notifications">
              <NotificationFeed organisation={org.slug} />
            </ErrorBoundary>
          </div>
          <aside className="flex flex-col gap-2 rounded-md border bg-surface p-5 text-ink-body shadow-card">
            <h2 className="text-lg font-semibold text-ink">What you are told about</h2>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>A verdict waiting for your call</li>
              <li>An approval the work is waiting on</li>
              <li>A hire proposed</li>
              <li>A budget at 80% and at its cap</li>
              <li>Credits at zero, halfway to the overdraft limit, and at it</li>
              <li>An app that stopped working</li>
              <li>A security review that found a problem</li>
              <li>For FrostAura&rsquo;s operators: an Owner asking for a top-up</li>
            </ul>
            <p className="text-sm text-ink-muted">Owners and Admins are told about what their grant covers; others see an empty feed.</p>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}
