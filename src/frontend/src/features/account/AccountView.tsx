import { useState } from "react";
import { TAP } from "@/lib/touch";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Failed, Loading, Skeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, plural } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { SECTION, TITLE } from "@/components/ui/page";
import { Stat, StatRow } from "@/components/ui/stat";
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
      {view.kind === "failed" && <Failed title="Your account could not be loaded" reason={view.reason} status={view.status} onRetry={() => void me.refetch()} />}
      {view.kind === "loaded" && <AccountBody me={view.data} />}
    </AppShell>
  );
}

function AccountBody({ me }: { me: Me }) {
  const organisations = organisationsOf(me);
  const active = useActiveOrganisation();
  return (
    <>
      <header className={cn("flex min-w-0 items-center gap-4", RISE)}>
        <Avatar name={me.user.displayName} seed={me.user.id} size="lg" className="max-sm:size-12 max-sm:text-xl" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className={cn(TITLE, "break-words")}>{me.user.displayName}</h1>
            {me.isOperator && <Badge tone="warn">FrostAura operator</Badge>}
          </div>
          {me.user.email && <span className="break-all text-ink-body">{me.user.email}</span>}
        </div>
      </header>

      <StatRow cols={3} label="Your account at a glance" className={cn(RISE, stagger(1))}>
        <Stat label="Passkeys" value={formatNumber(me.passkeys)} caption={me.passkeys === 0 ? "None yet: add one below" : me.passkeys === 1 ? "One device signs you in" : "Any of them signs you in"} />
        <Stat label="Organisations" value={formatNumber(organisations.length)} caption={organisations.length > 1 ? "The console shows one at a time" : organisations.length === 1 ? (organisations[0]?.name ?? "") : "None yet"} />
        <Stat label="Roles" value={formatNumber(me.memberships.length)} caption={me.memberships.length === 1 ? "One grant, where it was set" : "Each holds where it was set and beneath"} />
      </StatRow>

      {/* Two across from a desktop's width: what signs you in, and what you may do where. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ErrorBoundary name="Your passkeys">
          <Passkeys me={me} />
        </ErrorBoundary>
        <section aria-labelledby="roles-title" className={cn("flex min-w-0 flex-col gap-3", RISE, stagger(2))}>
          <h2 id="roles-title" className={SECTION}>
            Your roles
          </h2>
          {organisations.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-surface px-5 py-4 shadow-card max-sm:px-4">
              <span className="text-ink-body">You belong to {plural(organisations.length, "organisation")}. The console shows one at a time.</span>
              <OrganisationSwitcher />
            </div>
          )}
          {organisations.length === 0 ? (
            <p data-state="empty" className="max-w-prose py-1 text-ink-muted">
              You hold no role in any organisation yet. {me.isOperator ? "As an operator you enter organisations from Every organisation." : "Whoever invited you grants one."}
            </p>
          ) : (
            <ul aria-label="Your roles in each organisation" className="flex flex-col gap-4">
              {organisations.map((org) => {
                const grants = me.memberships.filter((m) => m.organisationSlug === org.slug).sort((a, b) => a.scope.localeCompare(b.scope));
                return (
                  <li key={org.slug} className="overflow-hidden rounded-md border bg-surface shadow-card">
                    <span className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5 max-sm:px-4">
                      <span className="flex min-w-0 items-center gap-2 font-semibold">
                        <Icon name="organisation" className="size-4 shrink-0 text-ink" />
                        <span className="truncate">{org.name}</span>
                      </span>
                      {active.organisation?.slug === org.slug && <Badge tone="info">Working in it now</Badge>}
                    </span>
                    <ul className="flex flex-col divide-y">
                      {grants.map((g) => (
                        <li key={g.id} className="grid grid-cols-1 gap-x-6 gap-y-0.5 px-5 py-3 max-sm:px-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                          <span>
                            <span className="font-medium">{ROLE_NAME[g.role]}</span> of {g.level === "organisation" ? LEVEL_WORD.organisation : `${LEVEL_WORD[g.level]}, ${g.scope.split("/").slice(1).join(" / ")}`}
                          </span>
                          <span className="text-sm text-ink-muted">{ROLE_MAY[g.role]}</span>
                        </li>
                      ))}
                    </ul>
                    {grants.some((g) => roleRank(g.role) >= roleRank("admin")) && (
                      <div className="border-t px-5 py-1 max-sm:px-4">
                        <Link href={paths.people(org.slug)} className={cn("inline-flex items-center rounded-xs text-sm font-semibold text-primary-link hover:text-primary-hover", TAP)}>
                          People in {org.name}
                        </Link>
                      </div>
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

/** What a saved passkey means, by how many there now are. */
function savedPasskey(total: number): string {
  if (total <= 1) return "The passkey is saved. It signs you in now.";
  return total === 2 ? "The new passkey is saved. Either one signs you in now." : "The new passkey is saved. Any of them signs you in now.";
}

/** Your passkeys: how many, and adding another on this device (ID-08). */
function Passkeys({ me }: { me: Me }) {
  const [options] = usePasskeyRegisterOptionsMutation();
  const [complete] = usePasskeyRegisterCompleteMutation();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "working" } | { kind: "done"; total: number } | { kind: "failed"; reason: string }>({ kind: "idle" });
  const supported = passkeysSupported();

  const add = async () => {
    // How many there are once this one is saved: the words differ for a first passkey (ID-08).
    const total = me.passkeys + 1;
    setState({ kind: "working" });
    try {
      // Signed in, the control plane registers the new passkey on this account; the name and e-mail are its own.
      const { publicKey } = await options({ displayName: me.user.displayName, email: me.user.email ?? "" }).unwrap();
      const credential = (await navigator.credentials.create({ publicKey: toCreationOptions(publicKey) })) as PublicKeyCredential | null;
      if (!credential) throw new Error("No passkey was created.");
      await complete({ credential: registrationJson(credential) }).unwrap();
      setState({ kind: "done", total });
    } catch (e) {
      setState({ kind: "failed", reason: e && typeof e === "object" && "status" in e ? describeError(e as never) : describePasskeyError(e) });
    }
  };

  return (
    <section aria-labelledby="passkeys-title" className={cn("flex flex-col gap-3 rounded-md border bg-surface p-5 shadow-card max-sm:p-4", RISE, stagger(2))}>
      <h2 id="passkeys-title" className="flex items-center gap-2 text-lg font-semibold">
        <Icon name="secrets" className="size-5 text-ink" />
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
        {state.kind === "working" ? "Waiting for your device…" : me.passkeys === 0 ? "Add a passkey" : "Add another passkey"}
      </Button>
      {state.kind === "done" && (
        <p role="status" className="text-success-text">
          {savedPasskey(state.total)}
        </p>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-sm text-attention-text">
          No passkey was added: {state.reason}
        </p>
      )}
      <dl className="mt-1 flex flex-col gap-3 border-t pt-4 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-ink">No password to steal</dt>
          <dd className="m-0 text-ink-body">Endgame signs you in with a passkey only. Your device unlocks it with its screen lock, and its secret is never sent to Endgame.</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-ink">One on each device</dt>
          <dd className="m-0 text-ink-body">Add one from each phone and computer you use. A passkey in your phone&rsquo;s or browser&rsquo;s password manager comes with you to your other devices too.</dd>
        </div>
      </dl>
    </section>
  );
}
