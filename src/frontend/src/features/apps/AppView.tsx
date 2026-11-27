import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { ConfirmCard } from "@/components/ui/confirm";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Failed, Loading, Skeleton, Stale } from "@/components/states";
import { NO_VALUE, Stat, StatRow } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { Alert, STATES } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { LINK_ALONE } from "@/components/ui/layout";
import { Input } from "@/components/ui/field";
import { capitalise, formatCredits, formatDate, formatDuration, formatNumber, headlineNumber, plural, timeAgo } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { plainOrNull } from "@/lib/plain";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/store";
import { useGetAppQuery, useGetCascadeQuery, useGetMeQuery, useGetSecretsQuery, useGetSharesQuery, useRemoveShareMutation, useUpdateAppSettingsMutation } from "@/store/api";
import { shareApp } from "@/store/sensitive";
import type { AppAccess, AppDetail, AppShareCreated } from "@/store/types";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { effectiveRole, roleRank } from "@/lib/roles";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { useAppSelector } from "@/store";
import { AppShell, type Crumb } from "../shell/AppShell";
import { appHealthChip, namesFor } from "../home/treeModel";
import { ItIsYours, TechnicalDetails, WhatItUses } from "./AppAside";
import { AppItself, AppSpending, IdleMinutes, RebuildAndRestart } from "./AppManage";
import { capNote, notOpenable } from "./appModel";
import { TITLE, SECTION } from "@/components/ui/page";
import { AskPanel, Dashboard } from "./AskPanel";
import { useCardNote } from "@/components/cardNote";
import { CardNotesProvider } from "@/components/CardNotes";
import { ChangeRequest } from "./ChangeRequest";
import { History } from "./History";
import { Fold } from "@/components/Fold";
import { TalkLauncher } from "../shell/talk";
import { usePageConversation } from "../conversation/pageConversation";

export function AppView({ appId }: { appId: string }) {
  const query = useGetAppQuery(appId, { pollingInterval: 20_000, skipPollingIfUnfocused: true });
  const view = viewOf(query);
  const tree = useActiveTree();
  const active = useActiveOrganisation();
  const me = useGetMeQuery(undefined);
  const app = view.kind === "loaded" ? view.data : null;

  const crumbs: Crumb[] = [];
  // The app's own organisation, from its scope: the person's first organisation may be another one.
  const first = active.organisation ?? me.data?.organisation;
  const appOrg = app?.scope.split("/")[0];
  const member = me.data?.memberships.find((m) => m.organisationSlug === appOrg);
  const org = first && (!appOrg || first.slug === appOrg) ? first : appOrg ? { name: member?.organisationName ?? appOrg, slug: appOrg } : null;
  if (org) crumbs.push({ label: org.name, href: active.entered ? paths.homeOf(org.slug) : paths.home() });
  if (app) {
    const names = namesFor(tree.data, app.scope);
    const parts = app.scope.split("/");
    // Every level above the app is a place to go: its own page under Manage.
    names.slice(1, -1).forEach((n, i) => crumbs.push({ label: n, href: paths.manage(parts.slice(0, i + 2).join("/")) }));
    crumbs.push({ label: app.name });
  } else crumbs.push({ label: "App" });
  // The conversation about this app, docked beside its page (ARCH-012).
  const talk = usePageConversation(app ? { scope: app.scope } : null);

  return (
    <AppShell crumbs={crumbs} aside={app ? <AppAsideColumn app={app} orgName={org?.name ?? "your organisation"} /> : undefined} talk={talk}>
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
      {view.kind === "failed" && <Failed title={view.status === 404 ? "This app could not be found" : "The app could not be loaded"} reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
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

/** What the person may do here, as the cascade resolves their grants. An operator in God mode acts as an Admin. */
function useAppRole(app: AppDetail) {
  const me = useGetMeQuery(undefined);
  const tree = useActiveTree();
  // The tree carries the role the server resolved for this app; in God mode, an Admin's.
  const role = effectiveRole(tree.data, me.data, app.scope);
  return { builder: roleRank(role) >= roleRank("builder"), admin: roleRank(role) >= roleRank("admin"), owner: role === "owner" };
}

/** A path's name from the tree, or its last part. */
function useNameOf() {
  const tree = useActiveTree();
  return (path: string) => {
    const names = namesFor(tree.data, path);
    return names[names.length - 1] ?? path;
  };
}

function AppAsideColumn({ app, orgName }: { app: AppDetail; orgName: string }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const { owner, builder, admin } = useAppRole(app);
  const nameOf = useNameOf();
  // The side panel says one thing at a time: what the last card did (D37).
  return (
    <CardNotesProvider>
      {/* A phone folds each of these to a named row under the page's own sections. */}
      <Fold title="Running and who can open it" summary={`${capitalise(app.settings.access)} · ${app.settings.running === "always-on" ? "always on" : "sleeps when idle"}`}>
        <ErrorBoundary name="The app's settings">
          <Settings app={app} orgName={orgName} canRun={builder} canChooseWho={admin} />
        </ErrorBoundary>
      </Fold>
      <Fold title="What it may spend">
        <ErrorBoundary name="What it may spend">
          <AppSpending app={app} isAdmin={admin} nameOf={nameOf} />
        </ErrorBoundary>
      </Fold>
      <Fold title="What it uses">
        <ErrorBoundary name="What it uses">
          <WhatItUses app={app} canSeeSecrets={admin} />
        </ErrorBoundary>
      </Fold>
      <Fold title="The app itself" summary="Its version, rebuilding it, archiving it">
        <ErrorBoundary name="The app itself">
          <AppItself app={app} canChange={builder} isAdmin={admin} />
        </ErrorBoundary>
        <ErrorBoundary name="The download">
          <ItIsYours app={app} isOwner={owner} />
        </ErrorBoundary>
      </Fold>
      {technical && (
        <Fold title="Technical details">
          <TechnicalDetails app={app} />
        </Fold>
      )}
    </CardNotesProvider>
  );
}

function AppBody({ app }: { app: AppDetail }) {
  const health = appHealthChip(app.health.state, app.running, app.paused);
  const { builder, admin } = useAppRole(app);
  const budgets = useGetCascadeQuery({ scope: app.scope, kind: "budget" });
  const nameOf = useNameOf();
  // Held by its budget (or the organisation's overdraft limit): the amber pause whose action raises the budget, never
  // the red stopped panel and a rebuild that cannot help (ARCH-011).
  const held = heldByBudget(app);
  const stopped = !held && (app.status === "failed" || app.status === "stopped");
  // Once the rebuild works the app reads as running and the panel above goes; what happened stays said.
  const [rebuilt, setRebuilt] = useState<string | null>(null);
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const t = app.telemetry;
  // The figure is the state in a word; an app never published has no health to report, so it is "—", never "Healthy".
  const unpublished = !app.publishedAt && !app.notBuilt && health.label === "Healthy";
  const healthValue: { value: string; tone: "ink" | "muted" | "good" | "bad" } =
    unpublished || health.label === "Health unknown"
      ? { value: NO_VALUE, tone: "muted" }
      : { value: health.label, tone: health.tone === "good" ? "good" : health.tone === "bad" ? "bad" : "ink" };
  return (
    <>
      <header className={cn("flex min-w-0 flex-col gap-2 max-sm:-order-3", RISE)}>
        <h1 className={cn(TITLE, "break-words")}>{app.name}</h1>
        <AppAddress addresses={app.addresses} />
        <OpenTheApp app={app} />
      </header>

      <StatRow cols={4} label="Today" className="max-sm:-order-2">
        <Stat label="Health" value={healthValue.value} tone={healthValue.tone} caption={healthNote(app, technical)} />
        {t ? (
          <>
            <Stat
              label="Visits today"
              value={formatNumber(t.visitsToday)}
              caption={t.errorsToday > 0 ? `${plural(t.errorsToday, "error")} in ${plural(t.requestsToday, "request")}` : t.lastVisitAt ? `Last visit ${timeAgo(t.lastVisitAt)}` : "No visits yet"}
            />
            <Stat
              label="Typical response"
              value={t.latencyP50Ms !== null ? formatDuration(t.latencyP50Ms) : NO_VALUE}
              tone={t.latencyP50Ms !== null ? "ink" : "muted"}
              caption={t.latencyP95Ms !== null ? `Slowest 1 in 20: ${formatDuration(t.latencyP95Ms)}` : "No traffic yet"}
            />
          </>
        ) : (
          <>
            <Stat label="Visits today" value={NO_VALUE} tone="muted" caption={NOT_MEASURED} />
            <Stat label="Typical response" value={NO_VALUE} tone="muted" caption={NOT_MEASURED} />
          </>
        )}
        <Stat label="Cost this month" value={headlineNumber(app.cost.monthCredits)} caption={capNote(app, budgets.data, nameOf)} />
      </StatRow>
      {/* What the figures cannot say in a line: why there are no visits or responses to measure yet. */}
      {!held && (!t || t.latencyP50Ms === null) && (
        <p className="max-w-prose text-sm text-ink-muted">{t ? "Its response times are measured once it has visitors." : "It reports its visits once it has run, and its response times once it has visitors."}</p>
      )}

      {held && (
        <Alert
          state="paused-by-budget"
          testId="paused-by-budget"
          title={`${app.name} is paused by its budget.`}
          action={
            <Link href={paths.credits()} className={buttonVariants({ variant: "secondary" })}>
              Raise the budget
            </Link>
          }
        >
          {pausedNote(app)}
        </Alert>
      )}
      {stopped && builder && (
        <Alert state="crashed" title={app.status === "failed" ? `${app.name} stopped working.` : `${app.name} is stopped.`} action={<RebuildAndRestart app={app} onResult={(r) => setRebuilt(r.published ? `${app.name} is rebuilt and running again.` : null)} />}>
          Rebuilding builds its newest version again and starts it. Nothing in its history changes.
        </Alert>
      )}
      {!stopped && rebuilt && (
        <p role="status" className="rounded-xs bg-success-tint px-4 py-3 text-success-text">
          {rebuilt}
        </p>
      )}

      {/* From 1600 the two ways to act on it sit side by side, tops aligned, each as tall as what it holds. */}
      <div className={cn("grid grid-cols-1 items-start gap-6 max-sm:gap-5", builder && "3xl:grid-cols-2")}>
        {builder && (
          <Fold title={`Change ${app.name}`} summary="Say what to change; it is built in a preview first">
            <ErrorBoundary name="Changing this app">
              <ChangeRequest appId={app.id} appName={app.name} />
            </ErrorBoundary>
          </Fold>
        )}
        <Fold title="Ask about this app" summary="A question about its data, answered with a chart">
          <ErrorBoundary name="Asking about this app">
            <AskPanel appId={app.id} canAsk={builder} />
          </ErrorBoundary>
        </Fold>
      </div>
      <Fold title="Dashboard" summary="The questions kept on it">
        <ErrorBoundary name="The dashboard">
          <Dashboard appId={app.id} canChange={builder} />
        </ErrorBoundary>
      </Fold>

      {/* A phone or a tablet: the button that opens this app's conversation, straight under the figures on a phone (its order class). */}
      <TalkLauncher className="max-sm:-order-1" />

      <div className="grid grid-cols-1 items-start gap-6 max-sm:gap-5 2xl:grid-cols-2">
        <Fold title="History" summary="Every version, and bringing one back">
          <ErrorBoundary name="The history">
            <History app={app} canRestore={builder} />
          </ErrorBoundary>
        </Fold>
        <div className="flex flex-col gap-6 max-sm:gap-5">
          <Fold title="Sharing" summary={app.settings.access === "shared" ? plural(app.sharedWith, "person", "people") : capitalise(app.settings.access)}>
            <ErrorBoundary name="Sharing">{app.settings.access === "shared" ? admin ? <Sharing app={app} /> : <SharingForOthers app={app} /> : <SharingOff app={app} />}</ErrorBoundary>
          </Fold>
          <Fold title="Secrets">
            <ErrorBoundary name="The secrets">
              <AppSecrets scope={app.scope} canSee={admin} />
            </ErrorBoundary>
          </Fold>
        </div>
      </div>
    </>
  );
}

/** An address as a person reads it: no scheme, no closing slash. */
function shortAddress(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * The address written so a line only ever breaks after a "/": every part between slashes keeps its
 * letters together, and a break opportunity follows each slash.
 */
function Breakable({ url }: { url: string }) {
  const parts = shortAddress(url).split("/");
  return (
    <span className="min-w-0 break-normal">
      {parts.map((part, i) => (
        <span key={i}>
          <span className="whitespace-nowrap">
            {part}
            {i < parts.length - 1 ? "/" : ""}
          </span>
          {i < parts.length - 1 && <wbr />}
        </span>
      ))}
    </span>
  );
}

/** Copies an address, and says so for a moment. */
function CopyAddress({ url, label }: { url: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  };
  const said = state === "copied" ? "Copied" : state === "failed" ? "It could not be copied; select it and copy it by hand" : label;
  return (
    <Button variant="quiet" size="icon" onClick={() => void copy()} aria-label={said} title={said}>
      {state === "copied" ? <Check aria-hidden className="size-4 text-success-text" /> : <Copy aria-hidden className="size-4" />}
      <span role="status" className="sr-only">
        {state === "copied" ? "Copied" : state === "failed" ? said : ""}
      </span>
    </Button>
  );
}

/**
 * The app's address (ARCH-011, the apps lane): the one to give people, short, with a copy button; the
 * other address the same app answers at is behind "Also at".
 */
function AppAddress({ addresses }: { addresses: AppDetail["addresses"] }) {
  const main = addresses.subdomain ?? addresses.path;
  const other = addresses.subdomain ? addresses.path : null;
  return (
    <div data-testid="app-address" className="flex min-w-0 flex-wrap items-center gap-x-3">
      <p className="flex min-w-0 max-w-full items-center gap-1 text-ink-body">
        <Breakable url={main} />
        <CopyAddress url={main} label="Copy the address" />
      </p>
      {other && (
        <AlsoAt url={other} />
      )}
    </div>
  );
}

/**
 * "Open the app": the page's one primary action while the app can be used. When it cannot, the same
 * link stays (it shows what its visitors meet) but quietly, beside the reason.
 */
function OpenTheApp({ app }: { app: AppDetail }) {
  const why = notOpenable(app);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
      <a href={app.addresses.subdomain ?? app.addresses.path} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: why ? "secondary" : "primary" }), "max-sm:w-full")}>
        Open the app
      </a>
      {why && (
        <p data-testid="open-note" className="max-w-prose text-sm text-ink-muted">
          {why}
        </p>
      )}
    </div>
  );
}

/** Held by money: the control plane's pause, or an app paused and not down. */
function heldByBudget(app: AppDetail): boolean {
  if (app.notBuilt) return false;
  return !!app.paused || app.health.state === "paused" || (app.running === "paused" && app.health.state !== "down");
}

/** Why it is held, in the control plane's sentence ("Paused: a monthly budget above it is spent. …"). */
function pausedNote(app: AppDetail): string {
  return app.paused?.note ?? plainOrNull(app.health.summary) ?? "Paused: it serves nobody until it is restored.";
}

/** The health line: one line, in normal mode a version is "the latest version", never its id. */
function healthNote(app: AppDetail, technical: boolean): string {
  if (technical) return app.health.summary;
  if (app.notBuilt) return app.notBuilt.note;
  // Paused: the panel under the figures says why and what restores it; the tile says it in a line.
  if (heldByBudget(app)) return STATES["paused-by-budget"].label;
  if (app.health.state === "healthy" && app.telemetry) return app.telemetry.errorsToday === 0 ? "No errors today" : `${plural(app.telemetry.errorsToday, "error")} today`;
  return plainOrNull(app.health.summary) ?? (app.publishedAt ? `Running the version from ${formatDate(app.publishedAt)}` : "Not published yet");
}

/** Private or public: there is no list of people to manage, and the page says how to start one. */
function SharingOff({ app }: { app: AppDetail }) {
  return (
    <section aria-label="Sharing" className={cn("flex flex-col gap-2 rounded-md border bg-surface px-5 py-4 shadow-card", RISE, stagger(2))}>
      <h2 className={cn(SECTION, "flex items-center gap-2")}>
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

/** A shared app, seen by someone below Admin: how many it is shared with, and who manages the list. */
function SharingForOthers({ app }: { app: AppDetail }) {
  return (
    <section aria-label="Sharing" className={cn("flex flex-col gap-2 rounded-md border bg-surface px-5 py-4 shadow-card", RISE, stagger(2))}>
      <h2 className={cn(SECTION, "flex items-center gap-2")}>
        <Icon name="employee" tinted />
        Shared with
      </h2>
      <p className="text-ink-body">{app.sharedWith === 0 ? `${app.name} is shared, with nobody yet.` : `${app.name} is shared with ${plural(app.sharedWith, "person", "people")}.`}</p>
      <p className="text-sm text-ink-muted">An Admin or the Owner sees who, invites people and stops sharing.</p>
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
      <h2 className={cn(SECTION, "flex items-center gap-2")}>
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
      {view.kind === "failed" && <Failed title="Who it is shared with could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
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
                  {/* Every row the same shape: who and where they stand on the left, "Stop sharing" at the right. */}
                  <div className="flex items-center gap-3">
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                      <span title={share.email} className="max-w-full truncate font-medium">
                        {share.email}
                      </span>
                      <Badge tone={share.registered ? "good" : "neutral"}>{share.registered ? "Registered" : `Invited ${timeAgo(share.invitedAt)}`}</Badge>
                    </div>
                    <Button size="sm" variant="quiet" className="shrink-0" onClick={() => setConfirmRemove(share.email)} aria-label={`Stop sharing with ${share.email}`}>
                      Stop sharing
                    </Button>
                  </div>
                  {confirmRemove === share.email && (
                    <ConfirmCard
                      label={`Confirm stopping sharing with ${share.email}`}
                      question={`Stop sharing with ${share.email}?`}
                      detail={`They lose access at once, and are signed out of ${app.name}.`}
                      confirm="Stop sharing"
                      cancel="Keep it"
                      onConfirm={() => void stop(share.email)}
                      onCancel={() => setConfirmRemove(null)}
                    />
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
          <Input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={invalid ? `${emailId}-problem` : undefined}
            className="flex-1"
          />
          <Button type="submit" className="shrink-0" disabled={!typed || invalid || inviting}>
            {inviting ? "Inviting…" : "Invite"}
          </Button>
        </div>
        {invalid && (
          <span id={`${emailId}-problem`} className="text-sm text-attention-text">
            That does not look like an e-mail address.
          </span>
        )}
        <span className="text-sm text-ink-muted">They register at the app with a one-time code, which lasts 14 days.</span>
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
        {created.emailed
          ? `${created.email} is invited, and the code was e-mailed to them. If it does not arrive, give them this code; they register with it at ${appName}’s sign-up page within 14 days, before ${formatDate(created.expiresAt)}.`
          : `${created.email} is invited. No e-mail was sent, so give them this code; they register with it at ${appName}’s sign-up page within 14 days, before ${formatDate(created.expiresAt)}.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all rounded-xs bg-surface px-3 py-2 font-mono text-base">{created.invitationCode}</code>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {copied === "yes" ? "Copied" : "Copy the code"}
        </Button>
      </div>
      {copied === "failed" && <p className="text-sm text-attention-text">The code could not be copied; select it and copy it by hand.</p>}
      <p className="font-semibold text-success-text">It will not be shown again.</p>
      <Button size="sm" variant="quiet" className="self-start" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

/** The names of the secrets the app is given, and where each was set — never a value. */
function AppSecrets({ scope, canSee }: { scope: string; canSee: boolean }) {
  const query = useGetSecretsQuery(scope, { skip: !canSee });
  const view = viewOf(query);
  if (!canSee) {
    return (
      <section aria-label="Secrets" className={cn("flex flex-col gap-2 rounded-md border bg-surface px-5 py-4 shadow-card", RISE, stagger(3))}>
        <h2 className={cn(SECTION, "flex items-center gap-2")}>
          <Icon name="secrets" tinted />
          Secrets
        </h2>
        <p className="text-sm text-ink-muted">An Admin or the Owner sees which secrets it is given, and adds or changes them.</p>
      </section>
    );
  }
  return (
    <section aria-label="Secrets" className={cn("flex flex-col gap-3 rounded-md border bg-surface px-5 py-4 shadow-card", RISE, stagger(3))}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={cn(SECTION, "flex items-center gap-2")}>
          <Icon name="secrets" tinted />
          Secrets
        </h2>
        <Link href={paths.secrets(scope)} className={LINK_ALONE}>
          Manage secrets
        </Link>
      </div>
      {view.kind === "loading" && (
        <Loading label="Loading the secrets" className="flex flex-col gap-2">
          <Skeleton className="h-8 rounded-xs" />
          <Skeleton className="h-8 rounded-xs" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="The secrets could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" &&
        (view.data.effective.length === 0 ? (
          <p data-state="empty" className="text-ink-muted">
            No secrets apply to it. Add one, and the app can read it by name.
          </p>
        ) : (
          <ul aria-label="Secrets it can read" className="flex flex-col divide-y">
            {/* One shape for every row: the name, then where it was set — beside it from a tablet up, under it on a phone. */}
            {view.data.effective.map((secret) => (
              <li key={secret.name} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <code className="min-w-0 break-all font-mono text-sm">{secret.name}</code>
                <span className="shrink-0 text-sm text-ink-muted">{secret.inherited ? `Set at ${secret.setAtLevel} level` : "Set on this app"}</span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function Settings({ app, orgName, canRun, canChooseWho }: { app: AppDetail; orgName: string; canRun: boolean; canChooseWho: boolean }) {
  const [update] = useUpdateAppSettingsMutation();
  const [error, setError] = useCardNote<string>("settings");
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
  const monthly = (choice: AppDetail["runningCost"]["sleep"]) => (choice ? `About ${formatCredits(choice.credits)} a month.` : "Not enough history yet to say what it costs a month.");
  const options: { value: AppDetail["settings"]["running"]; title: string; text: string; basis: string | null }[] = [
    { value: "sleep", title: "Sleeps when unused", text: `Cheapest. The first visitor waits a few seconds. ${monthly(cost.sleep)}`, basis: cost.sleep?.basis ?? null },
    { value: "always-on", title: "Always on", text: `Instant for everyone. ${monthly(cost.alwaysOn)}`, basis: cost.alwaysOn?.basis ?? null },
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
        <legend className={cn(SECTION, "mb-2.5 flex items-center gap-2")}>
          <Icon name={shown.running === "always-on" ? "always-on" : "asleep"} tinted />
          Running
        </legend>
        {options.map((o) => (
          <Choice key={o.value} name={runName} value={o.value} checked={shown.running === o.value} disabled={!canRun} onChange={() => void save({ running: o.value })}>
            <span className="font-semibold text-ink">{o.title}</span>
            <span className="text-ink-body">{o.text}</span>
            {o.basis && <span className="text-sm text-ink-muted">{o.basis}</span>}
          </Choice>
        ))}
        <p data-state={cost.state} className="text-sm text-ink-muted">
          {cost.state === "estimated" ? cost.basis : `Not enough history yet. ${cost.basis}`} {cost.prices}
        </p>
        {shown.running === "sleep" && <IdleMinutes app={app} canChange={canRun} />}
        {!canRun && <p className="text-sm text-ink-muted">A Builder or above changes how it runs.</p>}
      </fieldset>

      <fieldset className={cn("flex flex-col gap-2.5", RISE, stagger(1))}>
        <legend className={cn(SECTION, "mb-2.5 flex items-center gap-2")}>
          <Icon name={shown.access === "public" ? "public" : "private"} tinted />
          Who can open it
        </legend>
        {access.map((o) => (
          <Choice key={o.value} name={whoName} value={o.value} checked={shown.access === o.value} disabled={!canChooseWho} onChange={() => chooseAccess(o.value)}>
            <span className="text-ink-body">
              <span className="font-semibold text-ink">{o.text.slice(0, o.text.indexOf(":") + 1)}</span>
              {o.text.slice(o.text.indexOf(":") + 1)}
            </span>
          </Choice>
        ))}
        {!canChooseWho && <p className="text-sm text-ink-muted">An Admin or the Owner chooses who can open it.</p>}
        {confirmPublic && <ConfirmPublic appName={app.name} onConfirm={() => { setConfirmPublic(false); void save({ access: "public" }); }} onCancel={() => setConfirmPublic(false)} />}
      </fieldset>
    </>
  );
}

/**
 * One choice of a side-panel setting, drawn as a card: the chosen one is unmistakable (the accent's
 * edge and tint, as well as its filled radio), and its words wrap without leaving one alone on a line.
 */
function Choice({ name, value, checked, disabled, onChange, children }: { name: string; value: string; checked: boolean; disabled: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label
      data-chosen={checked || undefined}
      className={cn(
        "flex gap-3 rounded-sm border px-4 py-3 transition-colors motion-reduce:transition-none",
        checked ? "border-primary bg-primary-tint ring-1 ring-primary" : "border-border-strong bg-surface",
        disabled ? "cursor-default" : "cursor-pointer",
        !disabled && !checked && "hover:border-ink",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="mt-0.5 size-5 shrink-0 accent-primary" />
      <span className="flex min-w-0 flex-col gap-0.5 text-pretty">{children}</span>
    </label>
  );
}

/** Going public is a person's act (CLAUDE.md rule 10): it waits for this explicit confirmation, the house's one confirmation card. */
function ConfirmPublic({ appName, onConfirm, onCancel }: { appName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmCard
      role="alertdialog"
      focus
      destructive={false}
      label={`Make ${appName} public?`}
      question={`Make ${appName} public?`}
      detail="Anyone with the address will be able to open it, without signing in. Only a person can make this choice."
      confirm="Make it public"
      cancel="Keep it as it is"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/** The app's second address, behind a small toggle: said only when asked for. */
function AlsoAt({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="min-w-0 max-w-full text-sm text-ink-muted">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-touch items-center gap-1 rounded-xs hover:text-ink"
      >
        Also at
        <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <p id={id} className={cn("min-w-0 items-center gap-1", open ? "flex" : "hidden")}>
        <Breakable url={url} />
        <CopyAddress url={url} label="Copy the other address" />
      </p>
    </div>
  );
}
