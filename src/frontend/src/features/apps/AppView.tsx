import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { formatCredits, formatDate, formatDuration, formatNumber, plural, timeAgo } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/store";
import { useGetAppQuery, useGetMeQuery, useGetSecretsQuery, useGetSharesQuery, useGetTreeQuery, useRemoveShareMutation, useUpdateAppSettingsMutation } from "@/store/api";
import { shareApp } from "@/store/sensitive";
import type { AppAccess, AppDetail, AppShareCreated } from "@/store/types";
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

/** Shown wherever the app has not reported a figure yet: unknown is not zero. */
const NOT_MEASURED = "Not measured yet";

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
        {t ? (
          <>
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
          </>
        ) : (
          <>
            <Tile index={2} label="Visits today" value={NOT_MEASURED} valueClass="text-ink-muted" note="It reports its visits once it has run." />
            <Tile index={3} label="Typical response" value={NOT_MEASURED} valueClass="text-ink-muted" note="Measured once it has visitors." />
          </>
        )}
        <Tile index={4} label="Cost this month" value={formatNumber(app.cost.monthCredits)} note={app.cost.capCredits !== null ? `Cap ${formatCredits(app.cost.capCredits)}` : "No cap of its own; the one above applies"} />
      </section>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        {app.settings.access === "shared" ? <Sharing app={app} /> : <SharingOff app={app} />}
        <AppSecrets scope={app.scope} />
      </div>
    </>
  );
}

/** Private or public: there is no list of people to manage, and the page says how to start one. */
function SharingOff({ app }: { app: AppDetail }) {
  return (
    <section aria-label="Sharing" className={cn("flex flex-col gap-2 rounded-md border bg-surface px-5 py-4 shadow-card", RISE, stagger(2))}>
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Icon name="employee" tinted />
        Sharing
      </h2>
      <p className="text-ink-body">
        {app.settings.access === "public"
          ? `${app.name} is public, so anyone with the address can open it. To choose who can, set it to Shared.`
          : `${app.name} is private to your organisation. Set it to Shared to invite people by e-mail.`}
      </p>
    </section>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Sharing({ app }: { app: AppDetail }) {
  const query = useGetSharesQuery(app.id);
  const view = viewOf(query);
  const dispatch = useAppDispatch();
  const [remove] = useRemoveShareMutation();
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<AppShareCreated | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const emailId = useId();
  const typed = email.trim();
  const invalid = typed.length > 0 && !EMAIL.test(typed);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (!typed || invalid) return;
    setProblem(null);
    setCreated(null);
    setInviting(true);
    const outcome = await dispatch(shareApp(app.id, typed));
    setInviting(false);
    if (outcome.ok) {
      setEmail("");
      setCreated(outcome.data);
    } else setProblem(`${typed} was not invited: ${outcome.reason} Nothing changed.`);
  };

  const stop = async (address: string) => {
    setConfirmRemove(null);
    setProblem(null);
    try {
      await remove({ appId: app.id, email: address }).unwrap();
    } catch (e) {
      setProblem(`Sharing with ${address} did not stop: ${describeError(e as never)} They still have access.`);
    }
  };

  return (
    <section aria-label="Sharing" className={cn("flex flex-col gap-4 rounded-md border bg-surface px-5 py-4 shadow-card", RISE, stagger(2))}>
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Icon name="employee" tinted />
        Shared with
      </h2>

      {problem && (
        <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
          {problem}
        </p>
      )}

      {created && <InvitationCode created={created} appName={app.name} onDone={() => setCreated(null)} />}

      {view.kind === "loading" && (
        <Loading label="Loading who it is shared with" className="flex flex-col gap-2">
          <Skeleton className="h-12 rounded-sm" />
          <Skeleton className="h-12 rounded-sm" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="Who it is shared with could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          {view.data.length === 0 ? (
            <p data-state="empty" className="text-ink-muted">
              Not shared with anyone yet. Invite someone below; they register at the app with the code you give them.
            </p>
          ) : (
            <ul aria-label="People it is shared with" className="flex flex-col gap-2">
              {view.data.map((share) => (
                <li key={share.email} className="flex flex-col gap-2 rounded-sm bg-ground px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-all font-medium">{share.email}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={share.registered ? "success" : "quiet"}>{share.registered ? "Registered" : `Invited ${timeAgo(share.invitedAt)}`}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(share.email)} aria-label={`Stop sharing with ${share.email}`}>
                        Stop sharing
                      </Button>
                    </div>
                  </div>
                  {confirmRemove === share.email && (
                    <div role="group" aria-label={`Confirm stopping sharing with ${share.email}`} className="flex flex-wrap items-center gap-2 rounded-xs bg-attention-tint px-3 py-2">
                      <span className="text-attention-deep">They lose access at once, and are signed out of {app.name}.</span>
                      <Button size="sm" onClick={() => void stop(share.email)}>
                        Stop sharing
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>
                        Keep it
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <form onSubmit={(e) => void invite(e)} className="flex flex-col gap-2 border-t pt-4" noValidate>
        <label htmlFor={emailId} className="font-medium">
          Invite by e-mail
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={invalid ? `${emailId}-problem` : undefined}
            className="min-h-12 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface px-4"
          />
          <Button type="submit" className="min-h-12 px-5" disabled={!typed || invalid || inviting}>
            {inviting ? "Inviting…" : "Invite"}
          </Button>
        </div>
        {invalid && (
          <span id={`${emailId}-problem`} className="text-sm text-attention-text">
            That does not look like an e-mail address.
          </span>
        )}
      </form>
    </section>
  );
}

/** The one-time code, shown once: it is never stored, and the control plane will not show it again. */
function InvitationCode({ created, appName, onDone }: { created: AppShareCreated; appName: string; onDone: () => void }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.invitationCode);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <div role="status" aria-label="Invitation code" className="flex flex-col gap-3 rounded-sm border border-success-text bg-success-tint px-4 py-3">
      <p className="text-ink">
        {created.email} is invited. Give them this code; they register with it at {appName}&rsquo;s sign-up page before {formatDate(created.expiresAt)}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all rounded-xs bg-surface px-3 py-2 font-mono text-base">{created.invitationCode}</code>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied === "yes" ? "Copied" : "Copy the code"}
        </Button>
      </div>
      {copied === "failed" && <p className="text-sm text-attention-text">The code could not be copied; select it and copy it by hand.</p>}
      <p className="font-semibold text-success-text">It will not be shown again.</p>
      <Button size="sm" variant="ghost" className="self-start" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

/** The names of the secrets the app is given, and where each was set — never a value. */
function AppSecrets({ scope }: { scope: string }) {
  const query = useGetSecretsQuery(scope);
  const view = viewOf(query);
  return (
    <section aria-label="Secrets" className={cn("flex flex-col gap-3 rounded-md border bg-surface px-5 py-4 shadow-card", RISE, stagger(3))}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Icon name="secrets" tinted />
          Secrets
        </h2>
        <Link href={paths.secrets(scope)} className="rounded-xs font-semibold text-primary-link hover:text-primary-hover">
          Manage secrets
        </Link>
      </div>
      {view.kind === "loading" && (
        <Loading label="Loading the secrets" className="flex flex-col gap-2">
          <Skeleton className="h-8 rounded-xs" />
          <Skeleton className="h-8 rounded-xs" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The secrets could not be loaded" reason={view.reason} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" &&
        (view.data.effective.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            No secrets apply to it. Add one, and the app can read it by name.
          </p>
        ) : (
          <ul aria-label="Secrets it can read" className="flex flex-col gap-1.5">
            {view.data.effective.map((secret) => (
              <li key={secret.name} className="flex flex-wrap items-center justify-between gap-2">
                <code className="break-all font-mono text-sm">{secret.name}</code>
                <span className="text-sm text-ink-muted">{secret.inherited ? `Set at ${secret.setAtLevel} level` : "Set on this app"}</span>
              </li>
            ))}
          </ul>
        ))}
    </section>
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
    { value: "sleep", title: "Sleeps when unused", text: `Cheapest. The first visitor waits a few seconds. ${cost ? `About ${formatCredits(cost.sleep)} a month.` : "Its monthly cost is not measured yet."}` },
    { value: "always-on", title: "Always on", text: `Instant for everyone. ${cost ? `About ${formatCredits(cost.alwaysOn)} a month.` : "Its monthly cost is not measured yet."}` },
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
        {confirmPublic && <ConfirmPublic appName={app.name} onConfirm={() => { setConfirmPublic(false); void save({ access: "public" }); }} onCancel={() => setConfirmPublic(false)} />}
      </fieldset>
    </>
  );
}

/** Going public is a person's act (CLAUDE.md rule 10): it waits for this explicit confirmation. */
function ConfirmPublic({ appName, onConfirm, onCancel }: { appName: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      className="flex flex-col gap-3 rounded-sm border border-attention-line bg-attention-tint px-4 py-3 outline-none"
    >
      <p id={titleId} className="font-semibold text-attention-text">
        Make {appName} public?
      </p>
      <p className="text-attention-deep">Anyone with the address will be able to open it, without signing in. Only a person can make this choice.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onConfirm}>
          Make it public
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Keep it as it is
        </Button>
      </div>
    </div>
  );
}
