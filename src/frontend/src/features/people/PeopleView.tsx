import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ConfirmCard } from "@/components/ui/confirm";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OneTime } from "@/components/OneTime";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Cell, Table, TableRow, type Column } from "@/components/ui/table";
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
import { Fold } from "@/components/Fold";
import { PageHeader, SECTION } from "@/components/ui/page";
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
  // A removal — done or refused — is said here, after the person left the list, where it stays readable.
  const [outcome, setOutcome] = useState<{ done: boolean; text: string } | null>(null);

  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), ...(scope.includes("/") ? [{ label: here }] : []), { label: "People" }]} aside={
        <Fold title="What each role may do" summary="Owner, Admin, Builder and Viewer">
          <RolesAside />
        </Fold>
      }
    >
      <PageHeader
        className={RISE}
        title={`People in ${here}`}
        lead="Everyone with a role here, and where each grant was set. A grant holds for everything beneath where it is set."
        actions={<ScopePicker tree={tree.data} scope={scope} />}
      />

      {!active.isLoading && !scope ? (
        <Empty icon="organisation" title="There is no one to show until your organisation is named" />
      ) : (
        // The people across the page; from 1600 the invitation form sits beside them.
        <div className="grid grid-cols-1 items-start gap-6 3xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="flex min-w-0 flex-col gap-6">
            {view.kind === "loading" && (
              <Loading label="Loading the people" className="flex flex-col gap-2">
                <Skeleton className="h-16 rounded-sm" />
                <Skeleton className="h-16 rounded-sm" />
              </Loading>
            )}
            {outcome && !outcome.done && <Alert state="failed" title={outcome.text} />}
            {outcome?.done && <Alert state="done" title={outcome.text} />}
            {view.kind === "failed" && <Failed title={view.status === 403 ? "You cannot see the people here" : "The people could not be loaded"} reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
            {view.kind === "loaded" && (
              <>
                {view.stale && <Stale reason={view.stale.reason} />}
                {view.data.length === 0 ? (
                  <Empty icon="employee" title={`No one holds a role in ${here} yet`}>
                    Invite someone and they appear here once they accept.
                  </Empty>
                ) : (
                  <>
                    <Rows label="People" variant="member" members={view.data.filter((m) => m.hasPasskey)} row={(m) => <MemberRow key={m.membershipId} variant="member" member={m} scope={scope} tree={tree.data} canChange={admin} self={m.userId === me.data?.user.id} viewerIsOwner={role === "owner"} here={here} onOutcome={setOutcome} />} />
                    {view.data.some((m) => !m.hasPasskey) && (
                      <section aria-labelledby="invitations-title" className="flex flex-col gap-3">
                        <h2 id="invitations-title" className={SECTION}>
                          Invitations waiting
                          <span className="ml-2 font-sans text-base font-normal tabular-nums text-ink-muted">{view.data.filter((m) => !m.hasPasskey).length}</span>
                        </h2>
                        <Rows label="Invitations" variant="invitation" members={view.data.filter((m) => !m.hasPasskey)} row={(m) => <MemberRow key={m.membershipId} variant="invitation" member={m} scope={scope} tree={tree.data} canChange={admin} self={m.userId === me.data?.user.id} viewerIsOwner={role === "owner"} here={here} onOutcome={setOutcome} />} />
                      </section>
                    )}
                  </>
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

/** The columns of a table of grants: the same for people and for invitations, so the two read alike. */
const COLUMNS: Record<"member" | "invitation", Column[]> = {
  member: [
    { key: "person", header: "Person", kind: "grow" },
    { key: "role", header: "Role", kind: "text" },
    { key: "where", header: "Where it was set", kind: "text" },
    { key: "since", header: "Since", kind: "date" },
    { key: "action", header: "Action", kind: "action", hideHeader: true },
  ],
  invitation: [
    { key: "person", header: "Person", kind: "grow" },
    { key: "role", header: "Role", kind: "text" },
    { key: "where", header: "Where it was set", kind: "text" },
    { key: "since", header: "Their invitation", kind: "text" },
    { key: "action", header: "Action", kind: "action", hideHeader: true },
  ],
};

/** A table of grants (the shared {@link Table}): a header row and a row per person, cards where it is narrow. */
function Rows({ label, variant, members, row }: { label: string; variant: keyof typeof COLUMNS; members: Member[]; row: (m: Member) => ReactNode }) {
  return (
    <Table label={label} columns={COLUMNS[variant]} at="wide">
      {members.map(row)}
    </Table>
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
  variant,
  member,
  scope,
  tree,
  canChange,
  self,
  viewerIsOwner,
  here,
  onOutcome,
}: {
  variant: keyof typeof COLUMNS;
  member: Member;
  scope: string;
  tree: Tree | undefined;
  canChange: boolean;
  self: boolean;
  viewerIsOwner: boolean;
  here: string;
  onOutcome: (outcome: { done: boolean; text: string } | null) => void;
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
    onOutcome(null);
    try {
      const revoked = await remove({ scope, membershipId: member.membershipId }).unwrap();
      onOutcome({ done: true, text: removedLine(member.displayName, here, revoked.invitationCancelled) });
    } catch (e) {
      onOutcome({ done: false, text: `${member.displayName} still has their role: ${describeError(e as never)}` });
    }
  };

  const roleCell =
    editable && !inherited ? (
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
      // A role that is not changed here is plain text in the same place as the field, at the field's height, its
      // words where the field's words start (the field's edge and padding, the edge left clear: console-desktop 44).
      <span className="flex min-h-touch items-center border border-transparent px-3 text-sm text-ink touch:text-base">
        {ROLE_NAME[member.role]}
      </span>
    );

  return (
    <TableRow
      data-member={member.email}
      after={
        <>
          {renewed?.invitationCode && (
            <OneTime label={`New invitation code for ${member.displayName}`} value={renewed.invitationCode} onDone={() => setRenewed(null)}>
              {renewed.emailed ? "It was e-mailed to them too." : "E-mail is not set up here, so give them this code yourself."} It works
              {renewed.expiresAt ? ` until ${formatDate(renewed.expiresAt)}` : ` for ${INVITATION_DAYS} days`}; the code they had before no longer does.
            </OneTime>
          )}
          {variant === "invitation" && editable && !inherited && !confirm && (
            <Button size="sm" variant="quiet" className="-ml-3 self-start" disabled={removing.isLoading} onClick={() => setConfirm(true)}>
              Remove {member.displayName}
            </Button>
          )}
          {confirm && (
            <ConfirmCard
              label={`Confirm removing ${member.displayName}`}
              question={`Remove ${member.displayName}?`}
              detail={`${member.displayName} loses this role at once. Grants set elsewhere stay.`}
              confirm="Remove"
              cancel="Keep them"
              busy={removing.isLoading}
              onConfirm={() => void drop()}
              onCancel={() => setConfirm(false)}
            />
          )}
          {problem && (
            <p role="alert" className="rounded-xs bg-attention-tint px-3 py-2 text-sm text-attention-text">
              {problem}
            </p>
          )}
        </>
      }
    >
      <Cell col="person" primary>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold" title={member.displayName}>
            {member.displayName}
            {self && <span className="font-normal text-ink-muted"> (you)</span>}
          </span>
          <span className="truncate text-sm text-ink-body" title={member.email}>
            {member.email}
          </span>
          {technical && <code className="break-all font-mono text-xs text-ink-muted">{member.membershipId}</code>}
          {editable && inherited && <span className="pt-0.5 text-sm text-ink-muted">{fromAbove ? `This grant holds here from ${scopeName(tree, member.scope)}; change it there.` : `Change this grant at ${scopeName(tree, member.scope)}.`}</span>}
        </div>
      </Cell>
      <Cell col="role">{roleCell}</Cell>
      <Cell col="where">
        <span className="text-sm text-ink-body">{inherited ? `Set at ${scopeName(tree, member.scope)}` : "Set here"}</span>
      </Cell>
      <Cell col="since">
        <span className="text-sm text-ink-muted">{member.hasPasskey ? `Since ${formatDate(member.grantedAt)}` : pendingLine(member.invitationExpiresAt)}</span>
      </Cell>
      <Cell col="action">
        {variant === "member" && editable && !inherited && !confirm && (
          <Button size="sm" variant="quiet" aria-label={`Remove ${member.displayName}`} title={`Remove ${member.displayName}`} disabled={removing.isLoading} onClick={() => setConfirm(true)}>
            Remove
          </Button>
        )}
        {variant === "invitation" && editable && !inherited && !renewed && (
          <Button size="sm" variant="secondary" disabled={renewing} onClick={() => void renew()}>
            {renewing ? "Sending a new code…" : "Send a new code"}
          </Button>
        )}
      </Cell>
    </TableRow>
  );
}

/** What People says once a grant is removed; a cancelled code is said, so no one expects it to work (D8). */
function removedLine(name: string, here: string, invitationCancelled: boolean): string {
  return invitationCancelled ? `${name} no longer has a role in ${here}, and the invitation code they were sent no longer works.` : `${name} no longer has a role in ${here}.`;
}

/** What a pending person's row says about their code. */
function pendingLine(expiresAt: string | null): string {
  if (!expiresAt) return "No passkey yet: they sign in with the code they were given";
  return new Date(expiresAt).getTime() < Date.now()
    ? `No passkey yet, and their code expired on ${formatDate(expiresAt)}: send a new one`
    : `No passkey yet: their code works until ${formatDate(expiresAt)}`;
}

/** A part of the invitation form that takes the form's whole width while the form is two across. */
const WIDE = "md:col-span-2 3xl:col-span-1";

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
    <section aria-labelledby={`${ids.email}-title`} className="flex flex-col gap-4 rounded-md border bg-surface p-5 shadow-card max-sm:p-4">
      <h2 id={`${ids.email}-title`} className={SECTION}>
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
      <form onSubmit={(e) => void submit(e)} noValidate className="grid grid-cols-1 gap-3 md:grid-cols-2 3xl:grid-cols-1">
        <Field id={ids.email} label="E-mail address" problem={invalid ? "That does not look like an e-mail address." : null}>
          <Input id={ids.email} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={invalid} aria-describedby={invalid ? `${ids.email}-problem` : undefined} />
        </Field>
        <Field id={ids.name} label="Their name" hint="Optional. Shown to everyone in the organisation.">
          <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={`${ids.name}-hint`} />
        </Field>
        <div className={cn(WIDE, "grid grid-cols-1 gap-3 sm:grid-cols-2 3xl:grid-cols-1")}>
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
        <p className={cn(WIDE, "text-sm text-ink-body")}>{ROLE_MAY[role]}</p>
        <p className={cn(WIDE, "text-sm text-ink-muted")}>Someone new gets a one-time code to make their passkey with. It works for {INVITATION_DAYS} days; a new one can be sent from their row.</p>
        <Button type="submit" className={cn(WIDE, "justify-self-start")} disabled={!typed || invalid || sending}>
          {sending ? "Inviting…" : "Invite"}
        </Button>
      </form>
    </section>
  );
}

function RolesAside() {
  return (
    <section aria-labelledby="roles-title" className="flex flex-col gap-3">
      <h2 id="roles-title" className="text-base font-semibold">
        What each role may do
      </h2>
      {/* Under the page on a tablet the card is the page's width: the four roles two across (console-small 17). */}
      <dl className="flex flex-col divide-y md:max-lg:grid md:max-lg:grid-cols-2 md:max-lg:gap-x-8 md:max-lg:gap-y-4 md:max-lg:divide-y-0">
        {[...ROLES].reverse().map((r) => (
          <div key={r} className="flex flex-col gap-0.5 py-3 first:pt-0 md:max-lg:py-0">
            <dt className="font-semibold">{ROLE_NAME[r]}</dt>
            <dd className="m-0 text-ink-body">{ROLE_MAY[r]}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-muted">A role can be granted at the organisation, a division, a project or an app, and holds for everything beneath it — so one person can be a Builder in one division and a Viewer elsewhere.</p>
    </section>
  );
}
