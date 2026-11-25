import { useEffect, useEffectEvent, useState, type JSX } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deviceFor } from "./device";
import { EdgeDocument } from "./EdgeDocument";
import {
  applyAuthInfo,
  authProblems,
  displayNameFor,
  normaliseEmail,
  renderAuthPage,
  renderMessagePage,
  renderUnavailablePage,
  UNAVAILABLE_COPY,
  type AppAuthInfo,
  type AuthAction,
  type AuthPageConfig,
} from "./edgePages";
import { addressesOf, addressFor, resolve, restOf } from "./gate";
import { personOf } from "./readingList";
import { ReadingListApp } from "./ReadingListApp";
import type { HostedContext, HostedVisitor } from "./types";

export type { HostedApp, HostedAppState, HostedContext, HostedVisitor, PasskeyPrompt } from "./types";

/** How long a sleeping app takes to wake when the demo does not say. */
export const DEFAULT_WAKE_MS = 2000;

const closedPrompt = () => new DOMException("The passkey prompt was closed.", "NotAllowedError");

/**
 * A hosted app as a visitor meets it: a slim browser frame with the address they used, and below it
 * whatever Endgame's Edge would answer — its own sign-in, sign-up or unavailable page, or the app.
 */
export function HostedAppView({ ctx }: { ctx: HostedContext }): JSX.Element {
  const { app, visitor } = ctx;
  const addresses = addressesOf(app);
  const [wokenApp, setWokenApp] = useState<string | null>(null);
  const resolved = resolve({ app, form: ctx.form, rest: ctx.rest, visitor, awake: wokenApp === app.id });
  const { outcome } = resolved;
  const waking = outcome.kind === "app" && outcome.wake;
  const signingOut = outcome.kind === "sign-out" ? outcome.location : null;
  const wakeMs = ctx.wakeMs ?? DEFAULT_WAKE_MS;

  const woke = useEffectEvent(() => ctx.onWake?.());
  useEffect(() => {
    if (!waking) return;
    const timer = setTimeout(() => {
      setWokenApp(app.id);
      woke();
    }, wakeMs);
    return () => clearTimeout(timer);
  }, [waking, app.id, wakeMs]);

  // `_endgame/auth/sign-out`: the session ends, and the Edge sends the visitor straight back.
  const signOut = useEffectEvent((location: string) => {
    if (visitor.kind === "end-user") deviceFor(app.id).passkeyFor = visitor;
    ctx.onVisitorChange({ kind: "signed-out", displayName: null, email: null });
    ctx.navigate(restOf(addresses, location)?.rest ?? "");
  });
  useEffect(() => {
    if (signingOut !== null) signOut(signingOut);
  }, [signingOut]);

  const site = new URL(addresses.pathHome).host;

  /** Signed in or registered: the demo remembers who, and the page goes to `returnTo`. */
  function finish(next: HostedVisitor, returnTo: string) {
    ctx.onVisitorChange(next);
    ctx.navigate(restOf(addresses, returnTo)?.rest ?? "");
  }

  async function answer(action: AuthAction, config: AuthPageConfig | null): Promise<void> {
    if (action.kind === "follow") {
      const target = restOf(addresses, new URL(action.href, resolved.address).href);
      if (target) ctx.navigate(target.rest);
      return;
    }
    if (!config) return;
    const device = deviceFor(app.id);

    if (action.kind === "member-passkey") {
      if (!(await ctx.passkey({ action: "sign-in", site, account: null }))) throw closedPrompt();
      finish(ctx.memberAccount ?? { kind: "member", displayName: visitor.displayName, email: visitor.email }, config.returnTo);
      return;
    }

    if (action.kind === "dev-member") {
      const member = ctx.developmentMember?.(normaliseEmail(action.email));
      if (!member) throw new Error(authProblems.passkeyNotVerified);
      finish(member, config.returnTo);
      return;
    }

    if (action.kind === "dev-visitor") {
      // `AppIdentityService.DevelopmentSignInAsync`: still within the app's access rule.
      const email = normaliseEmail(action.email);
      if (app.access === "private") throw new Error(authProblems.privateApp);
      if (app.access === "shared" && !(ctx.isShared?.(email) ?? false)) throw new Error(authProblems.notShared);
      const user: HostedVisitor = { kind: "end-user", displayName: displayNameFor(action.displayName, email), email };
      device.registered.add(email);
      finish(user, config.returnTo);
      return;
    }

    if (action.kind === "visitor-passkey") {
      if (!(await ctx.passkey({ action: "sign-in", site, account: null }))) throw closedPrompt();
      const user = ctx.returningEndUser !== undefined ? ctx.returningEndUser : device.passkeyFor;
      if (!user) throw new Error(authProblems.passkeyNotVerified);
      if (app.access === "private") throw new Error(authProblems.privateApp);
      if (app.access === "shared" && user.stillShared === false) throw new Error(authProblems.notShared);
      finish({ ...user, kind: "end-user" }, config.returnTo);
      return;
    }

    // Sign-up: the options call checks everything first; only then does the device make a passkey.
    if (app.access === "private") throw new Error(authProblems.privateApp);
    const email = normaliseEmail(action.email);
    if (app.access === "shared") {
      const refusal = action.invitationCode ? ctx.checkInvitation(email, action.invitationCode) : authProblems.invitation;
      if (refusal !== null) throw new Error(refusal);
    }
    if (ctx.isRegistered ? ctx.isRegistered(email) : device.registered.has(email)) throw new Error(authProblems.alreadyRegistered);
    const displayName = displayNameFor(action.displayName, email);
    if (!(await ctx.passkey({ action: "register", site, account: email }))) throw closedPrompt();
    const user: HostedVisitor = { kind: "end-user", displayName, email };
    device.registered.add(email);
    device.passkeyFor = user;
    finish(user, config.returnTo);
  }

  let body: JSX.Element;
  let tabTitle: string;
  if (outcome.kind === "app" && !outcome.wake) {
    const here = new URL(resolved.address);
    tabTitle = app.name;
    body = (
      <ReadingListApp
        appId={app.id}
        appName={app.name}
        me={outcome.session === null ? null : personOf(visitor)}
        rest={resolved.rest}
        here={here.pathname + here.search}
        addressOf={(rest) => addressFor(addresses, resolved.form, rest)}
        navigate={ctx.navigate}
      />
    );
  } else if (outcome.kind === "app" || outcome.kind === "sign-out") {
    // Waking (the Edge holds the request until the app answers) or about to be sent back.
    tabTitle = resolved.address;
    body = (
      <div className="relative flex-1 bg-surface" data-testid="hosted-waiting" aria-busy="true">
        <p role="status" className="absolute bottom-0 left-0 rounded-xs border bg-ground px-3 py-1 text-xs text-ink-muted">
          Waiting for {new URL(resolved.address).host}…
        </p>
      </div>
    );
  } else if (outcome.kind === "not-found") {
    // An empty 404: what the browser itself shows.
    tabTitle = new URL(resolved.address).host;
    body = (
      <div className="flex flex-1 flex-col items-start gap-3 bg-surface px-6 py-16 sm:px-16" data-testid="hosted-not-found">
        <h1 className="text-2xl font-semibold text-ink">This {new URL(resolved.address).host} page can’t be found</h1>
        <p className="text-sm text-ink-body">No webpage was found for the web address: {resolved.address}</p>
        <p className="text-xs text-ink-muted">HTTP ERROR 404</p>
      </div>
    );
  } else {
    let html: string;
    let prepare: ((doc: Document) => void) | undefined;
    let config: AuthPageConfig | null = null;
    if (outcome.kind === "unavailable") {
      html = renderUnavailablePage(outcome.reason);
      tabTitle = `${UNAVAILABLE_COPY[outcome.reason].title} · Endgame`;
    } else if (outcome.kind === "message") {
      html = renderMessagePage(outcome.title, outcome.message, outcome.link, outcome.linkText);
      tabTitle = `${outcome.title} · Endgame`;
    } else {
      const pageConfig = outcome.config;
      const info: AppAuthInfo = {
        appName: app.name,
        organisationName: app.organisationName,
        signUp: app.access !== "private",
        invitationRequired: app.access === "shared",
        developmentSignIn: ctx.developmentSignIn === true,
      };
      config = pageConfig;
      html = renderAuthPage(outcome.page);
      prepare = (doc) => applyAuthInfo(doc, pageConfig, info);
      tabTitle = `${outcome.page === "sign-up" ? "Create your sign-in" : "Sign in"} · Endgame`;
    }
    body = (
      <EdgeDocument
        html={html}
        docKey={`${resolved.address}|${app.name}|${app.organisationName}|${app.access}`}
        title={tabTitle}
        prepare={prepare}
        onAction={(action) => answer(action, config)}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-ground" data-testid="hosted-app">
      <div className="flex flex-wrap items-center gap-3 border-b bg-surface px-4 py-2">
        <Button variant="ghost" size="sm" onClick={ctx.exit}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to Endgame
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border bg-ground px-4 py-2 text-ink-body">
          <Lock className="size-4 shrink-0 text-ink-muted" aria-hidden />
          <span className="truncate font-mono text-xs" data-testid="hosted-address" title={tabTitle}>
            {resolved.address}
          </span>
        </div>
      </div>
      <div className="h-0.5 bg-surface" aria-hidden>
        {waking ? <div className="h-full origin-left animate-grow bg-primary" /> : null}
      </div>
      <div className="flex flex-1 flex-col">{body}</div>
    </div>
  );
}
