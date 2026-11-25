import { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Failed, Loading, Skeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { ROLE_MAY, ROLE_NAME, roleRank } from "@/lib/roles";
import { paths } from "@/lib/router";
import { organisationsOf, useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { useGetMeQuery, usePasskeyRegisterCompleteMutation, usePasskeyRegisterOptionsMutation } from "@/store/api";
import type { Me, Membership } from "@/store/types";
import { describePasskeyError, passkeysSupported, registrationJson, toCreationOptions } from "../auth/webauthn";
import { AppShell } from "../shell/AppShell";
import { OrganisationSwitcher } from "./OrganisationSwitcher";

const LEVEL_WORD: Record<Membership["level"], string> = { organisation: "the whole organisation", division: "a division", project: "a project", app: "an app" };

/** Your account (ID-08, ID-09): who you are, your passkeys and adding another, and every role you hold. */
export function AccountView() {
  const me = useGetMeQuery(undefined);
  const view = viewOf(me);
  return (
    <AppShell crumbs={[{ label: "Your account" }]}>
      {view.kind === "loading" && (
        <Loading label="Loading your account" className="flex flex-col gap-6">
          <Skeleton className="h-24 rounded-md" />
          <Skeleton className="h-48 rounded-md" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="Your account could not be loaded" reason={view.reason} onRetry={() => void me.refetch()} />}
      {view.kind === "loaded" && <AccountBody me={view.data} />}
    </AppShell>
  );
}

function AccountBody({ me }: { me: Me }) {
  const organisations = organisationsOf(me);
  const active = useActiveOrganisation();
  return (
    <>
      <div className={cn("flex flex-col gap-1.5", RISE)}>
        <h1 className="text-3xl font-semibold">{me.user.displayName}</h1>
        {me.user.email && <span className="break-all text-ink-body">{me.user.email}</span>}
        {me.isOperator && (
          <Badge tone="attention" className="self-start">
            FrostAura operator
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <ErrorBoundary name="Your passkeys">
          <Passkeys me={me} />
        </ErrorBoundary>
        <section aria-labelledby="roles-title" className={cn("flex flex-col gap-3", RISE, stagger(2))}>
          <h2 id="roles-title" className="text-lg font-semibold">
            Your roles
          </h2>
          {organisations.length > 1 && (
            <div className="flex flex-col gap-2 rounded-md border bg-surface px-5 py-4 shadow-card">
              <span className="text-ink-body">You belong to {plural(organisations.length, "organisation")}. The console shows one at a time.</span>
              <OrganisationSwitcher />
            </div>
          )}
          {organisations.length === 0 ? (
            <p data-state="empty" className="rounded-md border border-dashed border-border-strong bg-surface p-5 text-ink-muted">
              You hold no role in any organisation yet. {me.isOperator ? "As an operator you enter organisations from Every organisation." : "Whoever invited you grants one."}
            </p>
          ) : (
            <ul aria-label="Your roles in each organisation" className="flex flex-col gap-3">
              {organisations.map((org) => {
                const grants = me.memberships.filter((m) => m.organisationSlug === org.slug).sort((a, b) => a.scope.localeCompare(b.scope));
                return (
                  <li key={org.slug} className="flex flex-col gap-2 rounded-md border bg-surface px-5 py-4 shadow-card">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold">
                        <Icon name="organisation" tinted className="size-4" />
                        {org.name}
                      </span>
                      {active.organisation?.slug === org.slug && <Badge tone="primary">Working in it now</Badge>}
                    </span>
                    <ul className="flex flex-col gap-2">
                      {grants.map((g) => (
                        <li key={g.id} className="flex flex-col gap-0.5 rounded-xs bg-ground px-3 py-2">
                          <span>
                            <span className="font-medium">{ROLE_NAME[g.role]}</span> of {g.level === "organisation" ? LEVEL_WORD.organisation : `${LEVEL_WORD[g.level]}, ${g.scope.split("/").slice(1).join(" / ")}`}
                          </span>
                          <span className="text-sm text-ink-muted">{ROLE_MAY[g.role]}</span>
                        </li>
                      ))}
                    </ul>
                    {grants.some((g) => roleRank(g.role) >= roleRank("admin")) && (
                      <Link href={paths.people(org.slug)} className="self-start rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover">
                        People in {org.name}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** Your passkeys: how many, and adding another on this device (ID-08). */
function Passkeys({ me }: { me: Me }) {
  const [options] = usePasskeyRegisterOptionsMutation();
  const [complete] = usePasskeyRegisterCompleteMutation();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "working" } | { kind: "done" } | { kind: "failed"; reason: string }>({ kind: "idle" });
  const supported = passkeysSupported();

  const add = async () => {
    setState({ kind: "working" });
    try {
      // Signed in, the control plane registers the new passkey on this account; the name and e-mail are its own.
      const { publicKey } = await options({ displayName: me.user.displayName, email: me.user.email ?? "" }).unwrap();
      const credential = (await navigator.credentials.create({ publicKey: toCreationOptions(publicKey) })) as PublicKeyCredential | null;
      if (!credential) throw new Error("No passkey was created.");
      await complete({ credential: registrationJson(credential) }).unwrap();
      setState({ kind: "done" });
    } catch (e) {
      setState({ kind: "failed", reason: e && typeof e === "object" && "status" in e ? describeError(e as never) : describePasskeyError(e) });
    }
  };

  return (
    <section aria-labelledby="passkeys-title" className={cn("flex flex-col gap-3 rounded-md border bg-surface px-5 py-5 shadow-card", RISE, stagger(1))}>
      <h2 id="passkeys-title" className="flex items-center gap-2 text-lg font-semibold">
        <Icon name="secrets" tinted />
        Your passkeys
      </h2>
      <p className="text-ink-body">
        {me.passkeys === 0
          ? "No passkey is registered to this account yet."
          : `${plural(me.passkeys, "passkey")} can sign you in. Add one on each device you use, so losing one never locks you out.`}
      </p>
      {!supported && (
        <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-sm text-attention-text">
          This browser cannot make passkeys. Open Endgame in a current browser on a device with a screen lock.
        </p>
      )}
      <Button className="self-start" disabled={!supported || state.kind === "working"} onClick={() => void add()}>
        {state.kind === "working" ? "Waiting for your device…" : "Add another passkey"}
      </Button>
      {state.kind === "done" && (
        <p role="status" className="text-success-text">
          The new passkey is saved. Either one signs you in now.
        </p>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-sm text-attention-text">
          No passkey was added: {state.reason}
        </p>
      )}
    </section>
  );
}
