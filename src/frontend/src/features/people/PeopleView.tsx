import { useId, useState, type FormEvent } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { OneTime } from "@/components/OneTime";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { RISE } from "@/lib/motion";
import { describeError, viewOf } from "@/lib/queryState";
import { ROLE_MAY, ROLE_NAME, ROLES, covers, effectiveRole, roleRank } from "@/lib/roles";
import { navigate, paths, useLocation } from "@/lib/router";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { useChangeRoleMutation, useGetMeQuery, useGetMembersQuery, useRemoveMemberMutation } from "@/store/api";
import { inviteMember, reissueInvitation } from "@/store/sensitive";
import type { Member, MemberInvitation, MemberRole, Tree } from "@/store/types";
import { AppShell } from "../shell/AppShell";
import { placements, scopeName } from "../workforce/workforceModel";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Roles a person can be invited to. There is one Owner, the person the organisation was set up for. */
const GRANTABLE: MemberRole[] = ["viewer", "builder", "admin"];
/** How long an invitation code works: the control plane's `AccountService.InvitationLifetime`. */
const INVITATION_DAYS = 7;

/**
 * People (UC-001, *Members*): who holds a role here and at which level each grant was set, invite by
 * e-mail to a role at any level, change or remove a grant, and what each of the four roles may do.
 */
export function PeopleView() {
  const { search } = useLocation();
  const me = useGetMeQuery(undefined);
  // In God mode, the organisation entered (OP-04).
  const active = useActiveOrganisation();
  const tree = useActiveTree();
  const scope = search.get("scope") || active.organisation?.slug || "";
  const query = useGetMembersQuery(scope, { skip: !scope });
  const view = viewOf(query);
  // The role here exactly as the server resolves it: the deepest grant wins, the Owner everywhere (PPL-01).
  const role = effectiveRole(tree.data, me.data, scope);
  const admin = roleRank(role) >= roleRank("admin");
  const org = active.organisation;
  const here = scopeName(tree.data, scope);
  // A removal refused after the person left the list is said here, where it stays readable.
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), ...(scope.includes("/") ? [{ label: here }] : []), { label: "People" }]} aside={<RolesAside />}>
      <header className={cn("flex flex-wrap items-end justify-between gap-4", RISE)}>
        <div className="flex flex-col gap-1.5">
          <h1 className="flex items-center gap-3 text-3xl font-semibold">
            <Icon name="employee" tinted className="size-7" />
            People in {here}
          </h1>
          <p className="max-w-prose text-ink-body">Everyone with a role here, and where each grant was set. A grant holds for everything beneath where it is set.</p>
        </div>
        <ScopePicker tree={tree.data} scope={scope} />
      </header>

      {!active.isLoading && !scope ? (
        <Empty icon="organisation" title="There is no one to show until your organisation is named" />
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
            {view.kind === "loading" && (
              <Loading label="Loading the people" className="flex flex-col gap-2">
                <Skeleton className="h-16 rounded-sm" />
                <Skeleton className="h-16 rounded-sm" />
              </Loading>
            )}
            {problem && (
              <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
                {problem}
              </p>
            )}
            {view.kind === "failed" && <Failed title={view.status === 403 ? "You cannot see the people here" : "The people could not be loaded"} reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
            {view.kind === "loaded" && (
              <>
                {view.stale && <Stale reason={view.stale.reason} />}
                {view.data.length === 0 ? (
                  <Empty icon="employee" title={`No one holds a role in ${here} yet`}>
                    Invite someone and they appear here once they accept.
                  </Empty>
                ) : (
                  <ul aria-label="People" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
                    {view.data.map((m) => (
                      <MemberRow key={m.membershipId} member={m} scope={scope} tree={tree.data} canChange={admin} self={m.userId === me.data?.user.id} viewerIsOwner={role === "owner"} onRefused={setProblem} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          {admin && (
            <ErrorBoundary name="Inviting">
              <Invite scope={scope} tree={tree.data} viewerIsOwner={role === "owner"} />
            </ErrorBoundary>
          )}
        </div>
      )}
    </AppShell>
  );
}

function ScopePicker({ tree, scope }: { tree: Tree | undefined; scope: string }) {
  const options = placements(tree);
  const id = useId();
  if (options.length <= 1) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm text-ink-muted">
        Show people at
      </label>
      <Select id={id} value={scope} onChange={(e) => navigate(paths.people(e.target.value))} className="sm:w-72">
        {options.map((o) => (
          <option key={o.scope} value={o.scope}>
            {" ".repeat(o.depth)}
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function MemberRow({
  member,
  scope,
  tree,
  canChange,
  self,
  viewerIsOwner,
  onRefused,
}: {
  member: Member;
  scope: string;
  tree: Tree | undefined;
  canChange: boolean;
  self: boolean;
  viewerIsOwner: boolean;
  onRefused: (text: string | null) => void;
}) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [changeRole, changing] = useChangeRoleMutation();
  const [remove, removing] = useRemoveMemberMutation();
  const dispatch = useAppDispatch();
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [renewed, setRenewed] = useState<MemberInvitation | null>(null);
  const selectId = useId();
  const inherited = member.scope !== scope;
  // Set above this level (the Owner, an organisation-wide Admin) rather than here or beneath it.
  const fromAbove = inherited && covers(member.scope, scope);
  // The Owner's grant is not changed here; an Admin's grant, to or from Admin, is the Owner's to change.
  const editable = canChange && member.role !== "owner" && !self && (viewerIsOwner || member.role !== "admin");

  const change = async (role: MemberRole) => {
    setProblem(null);
    try {
      await changeRole({ scope, membershipId: member.membershipId, role }).unwrap();
    } catch (e) {
      setProblem(`The role was not changed: ${describeError(e as never)} It is back to ${ROLE_NAME[member.role]}.`);
    }
  };
  const renew = async () => {
    setProblem(null);
    setRenewed(null);
    setRenewing(true);
    const outcome = await dispatch(reissueInvitation(scope, member.membershipId));
    setRenewing(false);
    if (outcome.ok) setRenewed(outcome.data);
    else setProblem(`No new code was sent: ${outcome.reason} The code ${member.displayName} has still works.`);
  };
  const drop = async () => {
    setConfirm(false);
    onRefused(null);
    try {
      await remove({ scope, membershipId: member.membershipId }).unwrap();
    } catch (e) {
      onRefused(`${member.displayName} still has their role: ${describeError(e as never)}`);
    }
  };

  return (
    <li data-member={member.email} className="flex flex-col gap-2 border-b px-5 py-4 last:border-b-0">
      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-name-figures">
        <div className="flex min-w-0 flex-col md:col-span-2">
          <span className="break-words font-semibold">
            {member.displayName}
            {self && <span className="font-normal text-ink-muted"> (you)</span>}
          </span>
          <span className="break-all text-sm text-ink-body">{member.email}</span>
          {technical && <code className="break-all font-mono text-xs text-ink-muted">{member.membershipId}</code>}
        </div>
        <div className="flex flex-col">
          {editable && !inherited ? (
            <>
              <label htmlFor={selectId} className="sr-only">
                Role for {member.displayName}
              </label>
              <Select id={selectId} value={member.role} disabled={changing.isLoading} onChange={(e) => void change(e.target.value as MemberRole)}>
                {GRANTABLE.filter((r) => viewerIsOwner || r !== "admin").map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAME[r]}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            <Badge tone={member.role === "owner" ? "solid" : member.role === "admin" ? "primary" : member.role === "builder" ? "teal" : "quiet"} className="self-start">
              {ROLE_NAME[member.role]}
            </Badge>
          )}
        </div>
        <span className="text-sm text-ink-body">{inherited ? `Set at ${scopeName(tree, member.scope)}` : "Set here"}</span>
        <span className="text-sm text-ink-muted">{member.hasPasskey ? `Since ${formatDate(member.grantedAt)}` : pendingLine(member.invitationExpiresAt)}</span>
      </div>
      {renewed?.invitationCode && (
        <OneTime label={`New invitation code for ${member.displayName}`} value={renewed.invitationCode} onDone={() => setRenewed(null)}>
          {renewed.emailed ? "It was e-mailed to them too." : "E-mail is not set up here, so give them this code yourself."} It works
          {renewed.expiresAt ? ` until ${formatDate(renewed.expiresAt)}` : ` for ${INVITATION_DAYS} days`}; the code they had before no longer does.
        </OneTime>
      )}
      {editable && !inherited && !member.hasPasskey && !renewed && (
        <Button size="sm" variant="soft" className="self-start" disabled={renewing} onClick={() => void renew()}>
          {renewing ? "Sending a new code…" : "Send a new code"}
        </Button>
      )}
      {editable && !inherited && !confirm && (
        <Button size="sm" variant="ghost" className="self-start" disabled={removing.isLoading} onClick={() => setConfirm(true)}>
          Remove {member.displayName}
        </Button>
      )}
      {confirm && (
        <div role="group" aria-label={`Confirm removing ${member.displayName}`} className="flex flex-wrap items-center gap-2 rounded-xs bg-attention-tint px-3 py-2">
          <span className="text-attention-deep">{member.displayName} loses this role at once. Grants set elsewhere stay.</span>
          <Button size="sm" onClick={() => void drop()}>
            Remove
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Keep them
          </Button>
        </div>
      )}
      {editable && inherited && <span className="text-sm text-ink-muted">{fromAbove ? `This grant holds here from ${scopeName(tree, member.scope)}; change it there.` : `Change this grant at ${scopeName(tree, member.scope)}.`}</span>}
      {problem && (
        <p role="alert" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
          {problem}
        </p>
      )}
    </li>
  );
}

/** What a pending person's row says about their code. */
function pendingLine(expiresAt: string | null): string {
  if (!expiresAt) return "No passkey yet: they sign in with the code they were given";
  return new Date(expiresAt).getTime() < Date.now()
    ? `No passkey yet, and their code expired on ${formatDate(expiresAt)}: send a new one`
    : `No passkey yet: their code works until ${formatDate(expiresAt)}`;
}

function Invite({ scope, tree, viewerIsOwner }: { scope: string; tree: Tree | undefined; viewerIsOwner: boolean }) {
  const dispatch = useAppDispatch();
  const ids = { email: useId(), name: useId(), role: useId(), level: useId() };
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [level, setLevel] = useState(scope);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [invited, setInvited] = useState<MemberInvitation | null>(null);
  const typed = email.trim();
  const invalid = typed.length > 0 && !EMAIL.test(typed);
  const options = placements(tree).filter((o) => o.scope === scope || o.scope.startsWith(`${scope}/`));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!typed || invalid) return;
    setSending(true);
    setProblem(null);
    setInvited(null);
    const outcome = await dispatch(inviteMember(level || scope, typed, name.trim() || typed.split("@")[0] || typed, role));
    setSending(false);
    if (outcome.ok) {
      setInvited(outcome.data);
      setEmail("");
      setName("");
    } else setProblem(`${typed} was not invited: ${outcome.reason} Nothing changed.`);
  };

  return (
    <section aria-labelledby={`${ids.email}-title`} className="flex flex-col gap-4 rounded-md border bg-surface p-5 shadow-card">
      <h2 id={`${ids.email}-title`} className="text-lg font-semibold">
        Invite someone
      </h2>
      {invited &&
        (invited.invitationCode ? (
          <OneTime label="Invitation code" value={invited.invitationCode} onDone={() => setInvited(null)}>
            {invited.member.displayName} is invited as {ROLE_NAME[invited.member.role]} at {scopeName(tree, invited.member.scope)}.{" "}
            {invited.emailed ? "The code was e-mailed to them too." : "E-mail is not set up here, so give them this code yourself."} They use it to make their passkey
            {invited.expiresAt ? ` before ${formatDate(invited.expiresAt)}` : ""}.
          </OneTime>
        ) : (
          <p role="status" className="rounded-sm border border-success-text bg-success-tint px-4 py-3">
            {invited.member.displayName} already has a passkey, so they now hold {ROLE_NAME[invited.member.role]} at {scopeName(tree, invited.member.scope)} and can sign in straight away.
          </p>
        ))}
      {problem && (
        <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
          {problem}
        </p>
      )}
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3">
        <Field id={ids.email} label="E-mail address" problem={invalid ? "That does not look like an e-mail address." : null}>
          <Input id={ids.email} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={invalid} aria-describedby={invalid ? `${ids.email}-problem` : undefined} />
        </Field>
        <Field id={ids.name} label="Their name" hint="Optional. Shown to everyone in the organisation.">
          <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={`${ids.name}-hint`} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <Field id={ids.role} label="Role">
            <Select id={ids.role} value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
              {GRANTABLE.filter((r) => viewerIsOwner || r !== "admin").map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAME[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={ids.level} label="Where" hint="The role holds here and beneath.">
            <Select id={ids.level} value={level} onChange={(e) => setLevel(e.target.value)} aria-describedby={`${ids.level}-hint`}>
              {(options.length > 0 ? options : [{ scope, label: scopeName(tree, scope), depth: 0 }]).map((o) => (
                <option key={o.scope} value={o.scope}>
                  {" ".repeat(Math.max(0, o.depth - (scope.split("/").length - 1)))}
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-sm text-ink-body">{ROLE_MAY[role]}</p>
        <p className="text-sm text-ink-muted">Someone new gets a one-time code to make their passkey with. It works for {INVITATION_DAYS} days; a new one can be sent from their row.</p>
        <Button type="submit" className="self-start" disabled={!typed || invalid || sending}>
          {sending ? "Inviting…" : "Invite"}
        </Button>
      </form>
    </section>
  );
}

function RolesAside() {
  return (
    <section aria-labelledby="roles-title" className="flex flex-col gap-3">
      <h2 id="roles-title" className="text-lg font-semibold">
        What each role may do
      </h2>
      <dl className="flex flex-col gap-3">
        {[...ROLES].reverse().map((r) => (
          <div key={r} className="flex flex-col gap-0.5 rounded-xs border border-border-strong px-4 py-3">
            <dt className="font-semibold">{ROLE_NAME[r]}</dt>
            <dd className="m-0 text-ink-body">{ROLE_MAY[r]}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-muted">A role can be granted at the organisation, a division, a project or an app, and holds for everything beneath it — so one person can be a Builder in one division and a Viewer elsewhere.</p>
    </section>
  );
}
