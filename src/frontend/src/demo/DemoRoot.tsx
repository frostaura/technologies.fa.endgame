import { useEffect, useState } from "react";
import { Provider } from "react-redux";
import { App } from "@/App";
import { navigate, useLocation } from "@/lib/router";
import { announceReady, announceRoute } from "./bridge";
import { DemoStrip, DeviceSheet } from "./Chrome";
import { askDevice } from "./device";
import { endConsoleSession, getSession, getStore, getWorld, markWoken, onHostChange, registerShare } from "./host";
import { HostedAppView } from "./hosted/HostedAppView";
import type { HostedAppState, HostedVisitor } from "./hosted/types";
import { EdgeDocument } from "./hosted/EdgeDocument";
import { authProblems, renderUnavailablePage, UNAVAILABLE_COPY } from "./hosted/edgePages";
import { roleAt } from "./server/access";
import { orgOf, organisation } from "./server/world";

/** The demo's page: its chrome, the console (or a hosted app's pages), the device sheet. */

function Outbound() {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setHref((e as CustomEvent<string>).detail);
    window.addEventListener("endgame-demo-outbound", on);
    return () => window.removeEventListener("endgame-demo-outbound", on);
  }, []);
  if (!href) return null;
  return (
    <div data-demo-chrome="" role="status" className="fixed bottom-4 left-1/2 z-50 flex max-w-form -translate-x-1/2 items-center gap-3 rounded-sm bg-ink px-4 py-3 text-sm text-surface shadow-raised">
      <span>In the demo, links out are not followed. This one goes to {new URL(href).hostname}.</span>
      <button type="button" className="min-h-touch rounded-xs px-2 font-semibold underline" onClick={() => setHref(null)}>
        OK
      </button>
    </div>
  );
}

const visitors = new Map<string, HostedVisitor>();

/** The end user whose passkey for this app this device holds: the persona's own registration, or one whose share ended. */
function returningEndUser(appId: string, access: string): HostedVisitor {
  const share = getWorld().shares.find((s) => s.appId === appId && s.registered);
  if (share) return { kind: "end-user", displayName: share.email.split("@")[0] ?? null, email: share.email };
  return { kind: "end-user", displayName: null, email: null, stillShared: access !== "shared" };
}

/** The console account this device's passkey signs in: one with a role on the app first. */
function memberOnDevice(path: string): HostedVisitor | undefined {
  const world = getWorld();
  const people = world.device.flatMap((id) => world.users.filter((u) => u.id === id && u.passkeys > 0));
  const withRole = people.find((u) => roleAt(world, u.id, path));
  const u = withRole ?? people[0];
  return u ? { kind: withRole ? "member" : "member-without-access", displayName: u.displayName, email: u.email } : undefined;
}

function HostedRoute({ appId, form, rest }: { appId: string; form: "path" | "subdomain"; rest: string }) {
  const [, bump] = useState(0);
  useEffect(() => onHostChange(() => bump((n) => n + 1)), []);
  const world = getWorld();
  const app = world.apps.find((a) => a.id === appId);
  const session = getSession();
  // Read on every render, so a sign-in, a registration or a sign-out shows at once.
  const visitor = ((): HostedVisitor => {
    const kept = visitors.get(appId);
    if (kept) return kept;
    const u = world.users.find((x) => x.id === world.sessionUserId);
    if (u && app) return { kind: roleAt(world, u.id, app.path) ? "member" : "member-without-access", displayName: u.displayName, email: u.email };
    if (session.personaInfo.visitor === "end-user") {
      const share = world.shares.find((s) => s.appId === appId && s.registered);
      // No longer shared with them (ACC-12): their sessions ended with the share.
      if (!share && app?.access === "shared") return { kind: "signed-out", displayName: null, email: null };
      return { kind: "end-user", displayName: share ? (share.email.split("@")[0] ?? null) : "A visitor", email: share?.email ?? "visitor@example.com" };
    }
    if (session.personaInfo.visitor === "invited") {
      const share = world.shares.find((s) => s.appId === appId && !s.registered);
      return { kind: "invited", displayName: null, email: share?.email ?? null };
    }
    return { kind: "signed-out", displayName: null, email: null };
  })();
  // An address Edge knows nothing about (ACC-16).
  // The Edge's own page for an address it does not know, drawn the full height of the window as any Edge page is.
  if (!app)
    return (
      <div className="flex min-h-screen flex-col bg-ground" data-testid="hosted-unknown">
        <EdgeDocument html={renderUnavailablePage("Temporary")} docKey={`unknown:${appId}`} title={`${UNAVAILABLE_COPY.Temporary.title} · Endgame`} onAction={async () => {}} />
      </div>
    );
  const [org, ...below] = app.path.split("/");
  const state: HostedAppState = world.edgeAnswer?.[app.id] ?? (app.status === "failed" ? "crashed" : app.running === "paused" ? "paused" : app.status === "building" || app.status === "draft" ? "not-published" : app.running === "asleep" ? "asleep" : "running");
  return (
    <HostedAppView
      key={`${appId}:${visitor.kind}:${visitor.email ?? ""}`}
      ctx={{
        app: { id: app.id, name: app.name, organisationName: organisation(world, orgOf(app.path))?.name ?? org ?? "", access: app.access, state, addresses: { path: `https://endgame.example/${app.path}/`, subdomain: `https://${org}.endgame.example/${below.join("/")}/` }, pausedReason: app.pausedReason ?? undefined },
        form,
        rest,
        visitor,
        passkey: async (p) => (await askDevice({ action: p.action, site: p.site, account: p.account, choices: [{ id: "ok", label: p.account ?? "Your passkey for this app" }] })) !== null,
        checkInvitation: (email, code) => {
          const share = world.shares.find((s) => s.appId === app.id && s.email === email.trim().toLowerCase());
          if (!share) return authProblems.notShared;
          return share.code === code.trim() ? null : authProblems.invitation;
        },
        onVisitorChange: (next) => {
          // A member signing out at an app on the platform's host ends their console session too (ACC-11).
          if (next.kind === "signed-out" && form === "path" && (visitor.kind === "member" || visitor.kind === "member-without-access")) endConsoleSession();
          visitors.set(appId, next);
          if (next.kind === "end-user" && next.email) registerShare(appId, next.email);
          bump((n) => n + 1);
        },
        navigate: (r) => navigate(`/__app/${appId}/${form}/${r}`),
        exit: () => navigate(`/apps/${appId}`),
        onWake: () => markWoken(appId),
        // Signed out, "Sign in with a passkey" signs in whoever this device holds a console passkey for (ACC-03).
        ...(visitor.kind === "signed-out" ? { memberAccount: memberOnDevice(app.path) } : {}),
        // An end user's device holds their passkey for this app — still, after the share was taken away (ACC-06, ACC-12).
        ...(session.personaInfo.visitor === "end-user" ? { returningEndUser: returningEndUser(appId, app.access) } : {}),
        isRegistered: (email) => world.shares.some((s) => s.appId === appId && s.email === email && s.registered),
        isShared: (email) => world.shares.some((s) => s.appId === appId && s.email === email),
        developmentSignIn: !!world.developmentSignIn,
        developmentMember: (email) => {
          const address = email || (world.developmentSignIn?.email ?? "");
          const u = world.users.find((x) => x.email === address);
          return { kind: u && roleAt(world, u.id, app.path) ? "member" : "member-without-access", displayName: u?.displayName ?? (address.split("@")[0] ?? address), email: address };
        },
      }}
    />
  );
}

export function DemoRoot({ embedded }: { embedded: boolean }) {
  const [, bump] = useState(0);
  useEffect(() => onHostChange(() => bump((n) => n + 1)), []);
  const { pathname } = useLocation();
  useEffect(() => announceRoute(pathname), [pathname]);
  useEffect(() => announceReady(embedded), [embedded]);
  const hosted = pathname.match(/^\/__app\/([^/]+)\/(path|subdomain)\/?(.*)$/);
  const store = getStore();
  useEffect(() => visitors.clear(), [store]);
  return (
    <>
      {!embedded && <DemoStrip />}
      {hosted ? (
        <HostedRoute appId={hosted[1] ?? ""} form={hosted[2] === "subdomain" ? "subdomain" : "path"} rest={hosted[3] ?? ""} />
      ) : (
        <Provider store={store} key={storeKey(store)}>
          <App />
        </Provider>
      )}
      <DeviceSheet />
      <Outbound />
    </>
  );
}

const keys = new WeakMap<object, string>();
let next = 0;
function storeKey(store: object): string {
  let k = keys.get(store);
  if (!k) {
    next += 1;
    k = String(next);
    keys.set(store, k);
  }
  return k;
}

