import { useEffect, useMemo, useState } from "react";
import { Provider } from "react-redux";
import { App } from "@/App";
import { navigate, useLocation } from "@/lib/router";
import { announceReady, announceRoute } from "./bridge";
import { DemoStrip, DeviceSheet } from "./Chrome";
import { askDevice } from "./device";
import { getSession, getStore, getWorld, markWoken, onHostChange, registerShare } from "./host";
import { HostedAppView } from "./hosted/HostedAppView";
import type { HostedAppState, HostedVisitor } from "./hosted/types";
import { authProblems } from "./hosted/edgePages";
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

function HostedRoute({ appId, form, rest }: { appId: string; form: "path" | "subdomain"; rest: string }) {
  const [, bump] = useState(0);
  useEffect(() => onHostChange(() => bump((n) => n + 1)), []);
  const world = getWorld();
  const app = world.apps.find((a) => a.id === appId);
  const session = getSession();
  const visitor = useMemo<HostedVisitor>(() => {
    const kept = visitors.get(appId);
    if (kept) return kept;
    const u = world.users.find((x) => x.id === world.sessionUserId);
    if (u && app) return { kind: roleAt(world, u.id, app.path) ? "member" : "member-without-access", displayName: u.displayName, email: u.email };
    if (session.personaInfo.visitor === "end-user") {
      const share = world.shares.find((s) => s.appId === appId && s.registered);
      return { kind: "end-user", displayName: share ? (share.email.split("@")[0] ?? null) : "A visitor", email: share?.email ?? "visitor@example.com" };
    }
    if (session.personaInfo.visitor === "invited") {
      const share = world.shares.find((s) => s.appId === appId && !s.registered);
      return { kind: "invited", displayName: null, email: share?.email ?? null };
    }
    return { kind: "signed-out", displayName: null, email: null };
  }, [appId, app, world, session]);
  if (!app) return null;
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
          visitors.set(appId, next);
          if (next.kind === "end-user" && next.email) registerShare(appId, next.email);
          bump((n) => n + 1);
        },
        navigate: (r) => navigate(`/__app/${appId}/${form}/${r}`),
        exit: () => navigate(`/apps/${appId}`),
        onWake: () => markWoken(appId),
        // An address registered at this app (KIT-03's "already registered") and, for the end-user persona, their passkey on this device (KIT-04).
        isRegistered: (email) => world.shares.some((s) => s.appId === app.id && s.registered && s.email === email.trim().toLowerCase()),
        returningEndUser: session.personaInfo.visitor === "end-user" ? (() => {
          const share = world.shares.find((s) => s.appId === app.id && s.registered);
          return share ? { kind: "end-user" as const, displayName: share.email.split("@")[0] ?? null, email: share.email } : null;
        })() : undefined,
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

