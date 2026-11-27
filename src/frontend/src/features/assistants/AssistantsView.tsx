import { organisationsOf, useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { ConfirmCard } from "@/components/ui/confirm";
import { Fragment, useId, useState, type FormEvent } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Check, Copy } from "lucide-react";
import { OneTime } from "@/components/OneTime";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { formatDate, timeAgo } from "@/lib/format";
import { RISE } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { ROLE_MAY, ROLE_NAME, highestIn, roleRank } from "@/lib/roles";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { platformOrigin, useGetMeQuery, useGetTokensQuery, useRevokeTokenMutation } from "@/store/api";
import { createToken } from "@/store/sensitive";
import type { AccessToken, AccessTokenCreated, TokenRole, Tree } from "@/store/types";
import { PageHeader, SECTION, useShowAll } from "@/components/ui/page";
import { AppShell } from "../shell/AppShell";

const EXPIRY: { days: number | null; label: string }[] = [
  { days: 30, label: "In 30 days" },
  { days: 90, label: "In 90 days" },
  { days: 365, label: "In a year" },
  { days: null, label: "Never" },
];

const origin = platformOrigin;

/**
 * AI assistant access (UC-116): let an assistant work with the organisation as a person does, held
 * to a role no higher than yours. The key is shown once; the list shows when each was last used.
 */
export function AssistantsView() {
  const me = useGetMeQuery(undefined);
  const active = useActiveOrganisation();
  const tree = useActiveTree();
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const org = active.organisation;
  // A key belongs to one organisation; the list holds keys for every one the person is in, each named.
  const orgName = (slug: string) => organisationsOf(me.data).find((o) => o.slug === slug)?.name ?? slug;
  const query = useGetTokensQuery(undefined, { skip: !org });
  const view = viewOf(query);
  const title = technical ? "MCP access tokens" : "Let an AI assistant work with your organisation";

  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: active.entered ? paths.homeOf(org.slug) : paths.home() }] : []), { label: technical ? "MCP" : "AI assistants" }]} aside={org ? <Addresses tree={tree.data} technical={technical} /> : undefined}>
      <PageHeader
        className={RISE}
        icon="assistants"
        title={title}
        lead={
          technical
            ? "Personal access tokens (egp_…) for the MCP endpoints: /mcp for the control plane's tools and /mcp/apps/{appId} for each app's own operations. A token acts as you, capped at its role; God mode is never available through one."
            : "Give an assistant a key and it can do what you can do here — read the org chart, start ideas, look after apps — but never more than the role you give it. It can never make an app public, change the overdraft, top up or download an app."
        }
      />

      {me.data && !org ? (
        <Empty icon="organisation" title="There is nothing to connect until your organisation is named" />
      ) : org ? (
        // The key form first, at a width its fields can use; the keys made beneath it, newest live ones first.
        <div className="flex min-w-0 flex-col gap-6">
          <ErrorBoundary name="Making a key">
            <NewToken organisation={org.slug} highest={highestIn(me.data, org.slug)} technical={technical} />
          </ErrorBoundary>
          <section aria-labelledby="keys-title" className="flex min-w-0 flex-col gap-3">
            <h2 id="keys-title" className={SECTION}>
              {technical ? "Tokens" : "Assistants you have let in"}
            </h2>
            {view.kind === "loading" && (
              <Loading label="Loading the assistants you let in" className="flex flex-col gap-2">
                <Skeleton className="h-16 rounded-sm" />
                <Skeleton className="h-16 rounded-sm" />
              </Loading>
            )}
            {view.kind === "failed" && <Failed title="The assistants you let in could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
            {view.kind === "loaded" && (
              <>
                {view.stale && <Stale reason={view.stale.reason} />}
                {view.data.length === 0 ? (
                  <Empty icon="assistants" title="No assistant has a key yet">
                    Make a key here, then give it and the address beside to your assistant.
                  </Empty>
                ) : (
                  <KeyList tokens={view.data} technical={technical} organisation={orgName} />
                )}
              </>
            )}
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}

/**
 * The keys, live ones first: the first ten, then "Show all {n} keys" — fifty keys are never one 5,000-pixel
 * column beside a short form.
 */
function KeyList({ tokens, technical, organisation }: { tokens: AccessToken[]; technical: boolean; organisation: (slug: string) => string }) {
  const sorted = [...tokens].sort((x, y) => Number(live(y)) - Number(live(x)));
  const { shown, control } = useShowAll(sorted, KEYS_SHOWN, "keys");
  return (
    <>
      <ul aria-label="Keys" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
        {shown.map((t) => (
          <TokenRow key={t.id} token={t} technical={technical} organisation={organisation(t.organisation)} />
        ))}
      </ul>
      {control}
    </>
  );
}

/** How many keys the list opens on. */
const KEYS_SHOWN = 10;

/** A key that still works; a revoked or expired one is retired, drawn quietly after the live ones. */
function live(t: AccessToken): boolean {
  return !t.revokedAt && t.active;
}

function status(t: AccessToken): { label: string; tone: "good" | "neutral" } {
  if (t.revokedAt) return { label: "Revoked", tone: "neutral" };
  if (!t.active) return { label: "Expired", tone: "neutral" };
  return { label: "Active", tone: "good" };
}

/** When a key stops, as of now: a revoked key says when it was revoked, never an end it will not reach. */
function lifetime(t: AccessToken): string {
  if (t.revokedAt) return ` · revoked ${formatDate(t.revokedAt)}`;
  if (!t.expiresAt) return " · never ends";
  return ` · ${t.active ? "ends" : "ended"} ${formatDate(t.expiresAt)}`;
}

function TokenRow({ token, technical, organisation }: { token: AccessToken; technical: boolean; organisation: string }) {
  const [revoke, revoking] = useRevokeTokenMutation();
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const s = status(token);
  const drop = async () => {
    setConfirm(false);
    setProblem(null);
    try {
      await revoke(token.id).unwrap();
    } catch (e) {
      setProblem(`The key still works: ${describeError(e as never)}`);
    }
  };
  return (
    // The row, then — directly under it, in the same item — the confirmation its Revoke opened, anchored to it.
    <li data-token={token.id} className={cn("flex flex-col gap-3 border-b px-5 py-3.5 last:border-b-0", !live(token) && "bg-ground")}>
      <div className="grid grid-cols-grow-end items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <span className={cn("break-words font-semibold", !live(token) && "font-medium text-ink-muted")}>{token.name}</span>
          <span className={cn("text-sm", live(token) ? "text-ink-body" : "text-ink-muted")}>
            {ROLE_NAME[token.role]} in {organisation} · made {formatDate(token.createdAt)}
            {lifetime(token)}
          </span>
          <span className="text-sm text-ink-muted">{token.lastUsedAt ? `Last used ${timeAgo(token.lastUsedAt)}` : "Never used"}</span>
          {technical && <code className="font-mono text-xs text-ink-muted">{token.prefix}… · {token.id}</code>}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Badge tone={s.tone}>{s.label}</Badge>
          {token.active && !confirm && (
            <Button size="sm" variant="quiet" disabled={revoking.isLoading} onClick={() => setConfirm(true)}>
              Revoke
            </Button>
          )}
        </div>
      </div>
      {confirm && (
        <ConfirmCard
          label={`Confirm revoking ${token.name}`}
          question={`Revoke ${token.name}?`}
          detail="The assistant using it is shut out at once. This cannot be undone; make a new key to let it back in."
          confirm="Revoke it"
          cancel="Keep it"
          busy={revoking.isLoading}
          onConfirm={() => void drop()}
          onCancel={() => setConfirm(false)}
        />
      )}
      {problem && (
        <p role="alert" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {problem}
        </p>
      )}
    </li>
  );
}

function NewToken({ organisation, highest, technical }: { organisation: string; highest: ReturnType<typeof highestIn>; technical: boolean }) {
  const dispatch = useAppDispatch();
  const ids = { name: useId(), role: useId(), expiry: useId() };
  // An Owner's key is an Admin's; no one's is higher than their own role.
  const roles = (["admin", "builder", "viewer"] as TokenRole[]).filter((r) => roleRank(r) <= roleRank(highest));
  const [name, setName] = useState("");
  const [role, setRole] = useState<TokenRole>(roles.includes("builder") ? "builder" : (roles[0] ?? "viewer"));
  const [expiry, setExpiry] = useState<string>("90");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<AccessTokenCreated | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSending(true);
    setProblem(null);
    setMade(null);
    const outcome = await dispatch(createToken(name, organisation, role, expiry === "never" ? null : Number(expiry)));
    setSending(false);
    if (outcome.ok) {
      setMade(outcome.data);
      setName("");
    } else setProblem(`No key was made: ${outcome.reason}`);
  };

  if (roles.length === 0) {
    return <p className="text-ink-body">You hold no role in this organisation that a key could carry.</p>;
  }

  return (
    <section aria-labelledby={`${ids.name}-title`} className="flex flex-col gap-4 rounded-md border bg-surface p-5 shadow-card sm:p-6">
      <h2 id={`${ids.name}-title`} className={SECTION}>
        {technical ? "New token" : "Make a key"}
      </h2>
      {made && (
        <OneTime label={technical ? "The new token" : "The new key"} value={made.token} onDone={() => setMade(null)}>
          Give this key to {made.accessToken.name}, with the address for the whole organisation. It acts as you, as {ROLE_NAME[made.accessToken.role]}.
          {technical ? " Send it as Authorization: Bearer." : ""}
        </OneTime>
      )}
      {problem && (
        <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
          {problem}
        </p>
      )}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-wide-two">
          <Field id={ids.name} label="Which assistant is it for?" hint="A name you will recognise later, such as “My laptop assistant”." className="sm:col-span-2 xl:col-span-1">
            <Input id={ids.name} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} aria-describedby={`${ids.name}-hint`} />
          </Field>
          <Field id={ids.role} label="What it may do" hint={highest === "owner" ? "As Owner, the most a key can carry is Admin." : "No more than your own role."}>
            <Select id={ids.role} value={role} onChange={(e) => setRole(e.target.value as TokenRole)} aria-describedby={`${ids.role}-hint`}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAME[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={ids.expiry} label="It stops working">
            <Select id={ids.expiry} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY.map((x) => (
                <option key={x.label} value={x.days === null ? "never" : String(x.days)}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button type="submit" disabled={!name.trim() || sending}>
            {sending ? "Making the key…" : technical ? "Create token" : "Make the key"}
          </Button>
          <p className="max-w-prose text-sm text-ink-body">{ROLE_MAY[role]}</p>
        </div>
      </form>
    </section>
  );
}

/** The two addresses an assistant needs: one for the whole organisation, one for each app. */
function Addresses({ tree, technical }: { tree: Tree | undefined; technical: boolean }) {
  const apps = (tree?.divisions ?? []).flatMap((d) => d.projects.flatMap((p) => p.apps.map((a) => ({ id: a.id, name: a.name }))));
  return (
    <section aria-labelledby="addresses-title" className="flex flex-col gap-3">
      <h2 id="addresses-title" className="text-base font-semibold">
        {technical ? "Endpoints" : "The addresses to give it"}
      </h2>
      <Address label={technical ? "Control plane" : "The whole organisation"} value={`${origin()}/mcp`} />
      {apps.length === 0 ? (
        <p className="text-ink-muted">Each app gets an address of its own once it is built.</p>
      ) : (
        <ul aria-label="App addresses" className="flex flex-col gap-3">
          {apps.map((a) => (
            <li key={a.id}>
              <Address label={a.name} value={`${origin()}/mcp/apps/${a.id}`} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-ink-muted">
        {technical ? "Streamable HTTP, stateless; no OAuth — the token is made here." : "The organisation's address lets it do what you do in the console; an app's address lets it use that app the way its people do."}
      </p>
    </section>
  );
}

/** An address shown whole, breaking only after a "/", with a copy button beside its name. */
function Address({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const parts = value.split("/");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-ink-body">{label}</span>
        <Button
          size="sm"
          variant="quiet"
          className="-mr-2 shrink-0"
          aria-label={`Copy the address for ${label}`}
          onClick={() =>
            void navigator.clipboard.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {/* Each segment is kept whole — an app's id never splits at its hyphens (real-stack 55) — and the address breaks only after a "/". */}
      <code className="overflow-x-auto rounded-xs bg-ground px-3 py-2 font-mono text-xs leading-relaxed break-normal">
        {parts.map((part, i) => (
          <Fragment key={i}>
            <span className="whitespace-nowrap">
              {part}
              {i < parts.length - 1 && "/"}
            </span>
            {i < parts.length - 1 && <wbr />}
          </Fragment>
        ))}
      </code>
    </div>
  );
}
