import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { formatCredits, formatDuration, formatNumber, plural, timeAgo } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useGetAppQuery, useGetMeQuery, useGetTreeQuery, useUpdateAppSettingsMutation } from "@/store/api";
import type { AppAccess, AppDetail } from "@/store/types";
import { AppShell, type Crumb } from "../shell/AppShell";
import { healthChip, namesFor } from "../home/treeModel";

export function AppView({ appId }: { appId: string }) {
  const query = useGetAppQuery(appId, { pollingInterval: 20_000, skipPollingIfUnfocused: true });
  const view = viewOf(query);
  const tree = useGetTreeQuery(undefined);
  const me = useGetMeQuery(undefined);
  const app = view.kind === "loaded" ? view.data : null;

  const crumbs: Crumb[] = [];
  const org = me.data?.organisation;
  if (org) crumbs.push({ label: org.name, href: paths.home() });
  if (app) {
    const names = namesFor(tree.data, app.scope);
    for (const n of names.slice(1, -1)) crumbs.push({ label: n });
    crumbs.push({ label: app.name });
  } else crumbs.push({ label: "App" });

  return (
    <AppShell crumbs={crumbs} aside={app ? <Settings app={app} orgName={org?.name ?? "your organisation"} /> : undefined}>
      {view.kind === "loading" && (
        <Loading label="Loading the app" className="flex flex-col gap-6">
          <Skeleton className="h-12 w-1/2" />
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-md" />
            ))}
          </div>
        </Loading>
      )}
      {view.kind === "failed" && <Failed title={view.status === 404 ? "This app could not be found" : "The app could not be loaded"} reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <AppBody app={view.data} />
        </>
      )}
    </AppShell>
  );
}

function AppBody({ app }: { app: AppDetail }) {
  const health = healthChip(app.health.state);
  const t = app.telemetry;
  const healthText = { success: "text-success-text", attention: "text-attention-text", "attention-strong": "text-attention-text" } as Record<string, string>;
  return (
    <>
      <div className={cn("flex flex-wrap items-start justify-between gap-5", RISE)}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-3xl font-semibold">{app.name}</h1>
          <span className="break-all text-ink-body">
            {app.addresses.subdomain ? (
              <>
                {app.addresses.subdomain} · also at {app.addresses.path}
              </>
            ) : (
              app.addresses.path
            )}
          </span>
        </div>
        <a href={app.addresses.subdomain ?? app.addresses.path} target="_blank" rel="noreferrer noopener" className={buttonVariants()}>
          Open the app
        </a>
      </div>

      <section aria-label="Today" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile index={1} label="Health" value={health.label} valueClass={healthText[health.tone] ?? "text-ink"} note={app.health.summary} pulse={app.health.state === "healthy"} />
        <Tile
          index={2}
          label="Visits today"
          value={formatNumber(t.visitsToday)}
          note={t.errorsToday > 0 ? `${plural(t.errorsToday, "error")} in ${plural(t.requestsToday, "request")}` : t.lastVisitAt ? `Last visit ${timeAgo(t.lastVisitAt)}` : "No visits yet"}
        />
        <Tile
          index={3}
          label="Typical response"
          value={t.latencyP50Ms !== null ? formatDuration(t.latencyP50Ms) : "No traffic yet"}
          note={t.latencyP95Ms !== null ? `Slowest 1 in 20: ${formatDuration(t.latencyP95Ms)}` : "Measured once it has visitors"}
        />
        <Tile index={4} label="Cost this month" value={formatNumber(app.cost.monthCredits)} note={app.cost.capCredits !== null ? `Cap ${formatCredits(app.cost.capCredits)}` : "No cap of its own; the one above applies"} />
      </section>
    </>
  );
}

function Tile({ index, label, value, note, valueClass, pulse = false }: { index: number; label: string; value: string; note: string; valueClass?: string; pulse?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-md border bg-surface px-5 py-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0", RISE, stagger(index))}>
      <span className="text-ink-muted">{label}</span>
      <span className={cn("flex items-center gap-2.5 font-display text-2xl font-semibold", valueClass)}>
        {pulse && <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-success motion-reduce:animate-none" />}
        {value}
      </span>
      <span className="text-ink-body">{note}</span>
    </div>
  );
}

function Settings({ app, orgName }: { app: AppDetail; orgName: string }) {
  const [update] = useUpdateAppSettingsMutation();
  const [error, setError] = useState<string | null>(null);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const runName = useId();
  const whoName = useId();

  // The choice shows the instant it is made; the cache is patched too, and both roll back on refusal.
  const [draft, setDraft] = useState<Partial<AppDetail["settings"]>>({});
  const shown = { ...app.settings, ...draft };
  const save = async (settings: Partial<AppDetail["settings"]>) => {
    setError(null);
    setDraft(settings);
    try {
      await update({ id: app.id, settings }).unwrap();
    } catch (e) {
      setError(describeError(e as never));
    } finally {
      setDraft({});
    }
  };

  const chooseAccess = (access: AppAccess) => {
    if (access === shown.access) return;
    if (access === "public") {
      setConfirmPublic(true);
      return;
    }
    setConfirmPublic(false);
    void save({ access });
  };

  const cost = app.runningCost;
  const options: { value: AppDetail["settings"]["running"]; title: string; text: string }[] = [
    { value: "sleep", title: "Sleeps when unused", text: `Cheapest. The first visitor waits a few seconds.${cost ? ` About ${formatCredits(cost.sleep)} a month.` : ""}` },
    { value: "always-on", title: "Always on", text: `Instant for everyone.${cost ? ` About ${formatCredits(cost.alwaysOn)} a month.` : ""}` },
  ];
  const access: { value: AppAccess; text: string }[] = [
    { value: "private", text: `Private: only people in ${orgName}` },
    { value: "shared", text: `Shared: people you invite, after they register${app.sharedWith > 0 ? ` (${app.sharedWith} so far)` : ""}` },
    { value: "public", text: "Public: anyone, no sign-in needed to open it" },
  ];

  return (
    <>
      {error && (
        <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
          The change was not saved: {error} The setting is back to what it was.
        </p>
      )}
      <fieldset className={cn("flex flex-col gap-2.5", RISE)}>
        <legend className="mb-2.5 flex items-center gap-2 font-display text-lg font-semibold">
          <Icon name={shown.running === "always-on" ? "always-on" : "asleep"} tinted />
          Running
        </legend>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer gap-3 rounded-xs border bg-surface px-4 py-3.5 transition hover:-translate-y-px hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              shown.running === o.value ? "border-ink" : "border-border-strong",
            )}
          >
            <input type="radio" name={runName} value={o.value} checked={shown.running === o.value} onChange={() => void save({ running: o.value })} className="mt-1 size-4 accent-primary" />
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">{o.title}</span>
              <span className="text-ink-body">{o.text}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={cn("flex flex-col gap-2.5", RISE, stagger(1))}>
        <legend className="mb-2.5 flex items-center gap-2 font-display text-lg font-semibold">
          <Icon name={shown.access === "public" ? "public" : "private"} tinted />
          Who can open it
        </legend>
        {access.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer gap-3 rounded-xs border bg-surface px-4 py-3 transition hover:-translate-y-px hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              shown.access === o.value ? "border-ink" : "border-border-strong",
            )}
          >
            <input type="radio" name={whoName} value={o.value} checked={shown.access === o.value} onChange={() => chooseAccess(o.value)} className="mt-1 size-4 accent-primary" />
            <span>{o.text}</span>
          </label>
        ))}
        {confirmPublic && (
          <div role="group" aria-label="Confirm making it public" className="flex flex-col gap-2 rounded-sm bg-attention-tint px-4 py-3">
            <p className="text-attention-deep">Anyone with the address will be able to open {app.name}, without signing in. Only a person can make this choice.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setConfirmPublic(false);
                  void save({ access: "public" });
                }}
              >
                Make it public
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmPublic(false)}>
                Keep it as it is
              </Button>
            </div>
          </div>
        )}
      </fieldset>
    </>
  );
}
