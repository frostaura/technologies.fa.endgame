import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RISE, stagger } from "@/lib/motion";
import { viewOf } from "@/lib/queryState";
import { covers, roleInTree } from "@/lib/roles";
import { paths } from "@/lib/router";
import { useActiveTree } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { useGetMeQuery } from "@/store/api";
import type { NeedsYou, Tree } from "@/store/types";
import { selected, type Selection } from "@/store/uiSlice";
import { AppShell, type Crumb } from "../shell/AppShell";
import { ConversationDock } from "./ConversationDock";
import { OrgChart } from "./OrgChart";
import { OntologyView } from "./OntologyView";
import { needLines } from "./needsYouModel";
import { countTree, orgFigures, organisationSelection, workerActivity, workerLabel } from "./treeModel";

/** How often the org chart refreshes. Status, spend and who is working are live, not a snapshot. */
export const TREE_POLL_MS = 15_000;

/**
 * Where home starts: the organisation, or — for someone granted only part of the tree — the highest
 * level they hold a role at (ORG-19), so the conversation and the graphs ask where they may.
 */
function homeSelection(tree: Tree): Selection | null {
  const org = tree.organisation;
  if (!org) return null;
  const root = organisationSelection(tree);
  // An older control plane sends no roles: the organisation, as before.
  if (org.role !== null) return root;
  for (const d of tree.divisions) if (d.role) return { scope: `${org.slug}/${d.slug}`, kind: "division", trail: [org.name, d.name] };
  for (const d of tree.divisions)
    for (const p of d.projects) if (p.role) return { scope: `${org.slug}/${d.slug}/${p.slug}`, kind: "project", trail: [org.name, d.name, p.name] };
  for (const d of tree.divisions)
    for (const p of d.projects)
      for (const a of p.apps) if (a.role) return { scope: `${org.slug}/${d.slug}/${p.slug}/${a.slug}`, kind: "app", trail: [org.name, d.name, p.name, a.name] };
  return root;
}

/** A level the viewer may be scoped to: one they hold a role at, not only the path down to one. */
function selectable(tree: Tree, scope: string): boolean {
  return roleInTree(tree, scope) !== null;
}

export function HomeView() {
  // An operator in God mode reads the organisation they entered (OP-04); anyone else reads their own.
  const me = useGetMeQuery(undefined);
  const query = useActiveTree({ pollingInterval: TREE_POLL_MS, skipPollingIfUnfocused: true });
  const view = viewOf(query);
  const dispatch = useAppDispatch();
  const selection = useAppSelector((s) => s.ui.selection);
  const tree = view.kind === "loaded" ? view.data : null;
  const home = tree ? homeSelection(tree) : null;

  // Start at home; drop a selection that no longer exists in the tree, or that this person may not be scoped to.
  useEffect(() => {
    if (!tree || !home || !tree.organisation) return;
    if (!selection || !covers(tree.organisation.slug, selection.scope) || !selectable(tree, selection.scope)) dispatch(selected(home));
  }, [tree, home, selection, dispatch]);

  // A level shown only as the path down to someone's grant is not one they can be scoped to.
  const select = (s: Selection) => {
    if (tree && !selectable(tree, s.scope)) return;
    dispatch(selected(s));
  };
  const crumbs: Crumb[] = crumbsFor(tree, selection, select);
  const hasOrg = !!tree?.organisation;
  const activeSelection = tree && hasOrg ? (selection ?? home) : null;

  return (
    <AppShell crumbs={crumbs} aside={
        tree && activeSelection && tree.divisions.length > 0 ? (
          <ErrorBoundary name="The conversation" resetKey={activeSelection.scope + (activeSelection.employeeId ?? "")}>
            <ConversationDock tree={tree} selection={activeSelection} />
          </ErrorBoundary>
        ) : undefined
      }
    >
      {view.kind === "loading" && <HomeSkeleton />}
      {view.kind === "failed" && <Failed title="The organisation could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <ErrorBoundary name="The org chart">
            {view.data.organisation ? (
              <Organisation tree={view.data} org={view.data.organisation} home={home ?? { scope: view.data.organisation.slug, kind: "organisation", trail: [view.data.organisation.name] }} selection={activeSelection} onSelect={select} />
            ) : me.data?.isOperator ? (
              <OperatorHome />
            ) : view.data.firstRun !== false ? (
              <FirstRun />
            ) : (
              <NotInvited email={me.data?.user.email ?? null} />
            )}
          </ErrorBoundary>
        </>
      )}
    </AppShell>
  );
}

function crumbsFor(tree: Tree | null, selection: Selection | null, select: (s: Selection) => void): Crumb[] {
  const org = tree?.organisation;
  if (!tree || !org) return [];
  if (!selection || selection.kind === "organisation") return [{ label: org.name }, { label: "Whole organisation" }];
  const parts = selection.scope.split("/");
  return selection.trail.map((label, i) => {
    const isEmployee = selection.kind === "employee" && i === selection.trail.length - 1;
    if (isEmployee || i === selection.trail.length - 1) return { label };
    const scope = parts.slice(0, i + 1).join("/");
    const kind = (["organisation", "division", "project", "app"] as const)[i] ?? "project";
    // A level above someone's grant is a name on the way down, not a place to go.
    if (!selectable(tree, scope)) return { label };
    return { label, onSelect: () => select({ scope, kind, trail: selection.trail.slice(0, i + 1) }) };
  });
}

function Organisation({
  tree,
  org,
  home,
  selection,
  onSelect,
}: {
  tree: Tree;
  org: NonNullable<Tree["organisation"]>;
  home: Selection;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const counts = countTree(tree);
  // The organisation's name takes the person home: the whole organisation, or the highest level they hold.
  const root = home;
  const isRootSelected = selection?.scope === home.scope && selection.kind === home.kind;
  return (
    <>
      <section
        aria-label="Organisation"
        className={cn("relative flex flex-wrap items-end justify-between gap-6 overflow-hidden rounded-lg bg-primary px-6 py-7 text-primary-ink sm:px-8", RISE)}
      >
        <div aria-hidden className="absolute -top-20 right-32 size-aura animate-drift rounded-full bg-violet opacity-75 blur-aura motion-reduce:animate-none" />
        <div aria-hidden className="absolute -bottom-36 -right-16 size-aura animate-drift rounded-full bg-teal opacity-75 blur-aura animate-delay-5 motion-reduce:animate-none" />
        <div className="relative flex flex-col gap-2">
          <span className="text-eyebrow font-semibold uppercase text-primary-ink-soft">Organisation</span>
          <h1 className="font-display text-4xl font-bold sm:text-hero">
            <button type="button" aria-pressed={isRootSelected} onClick={() => onSelect(root)} className="rounded-xs text-left">
              {org.name}
            </button>
          </h1>
          {org.summary && <span className="text-primary-tint">{org.summary}</span>}
          {org.workers.length > 0 && (
            <span className="flex flex-wrap gap-2 pt-1">
              {org.workers.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={selection?.employeeId === w.id && selection.scope === org.slug}
                  onClick={() => onSelect({ scope: org.slug, kind: "employee", trail: [org.name, w.name], employeeId: w.id })}
                  className="inline-flex min-h-touch items-center gap-2 rounded-full bg-surface/15 py-1 pl-1 pr-3 text-sm text-primary-ink hover:bg-surface/25"
                >
                  <Avatar name={w.name} seed={w.id} size="xs" />
                  {workerLabel(w)}
                  {workerActivity(w) && <span className="text-primary-tint">— {workerActivity(w)}</span>}
                </button>
              ))}
            </span>
          )}
        </div>
        <div className="relative flex flex-wrap items-end gap-x-7 gap-y-4">
          {orgFigures(counts, org.spend.monthCredits).map((f) => (
            <div key={f.label} className="flex flex-col">
              <span className="font-display text-3xl font-bold">{f.value}</span>
              <span className="text-primary-tint">{f.label}</span>
            </div>
          ))}
          <Link href={paths.start()} className={cn(buttonVariants({ variant: "white", size: "lg" }))}>
            New idea
          </Link>
        </div>
      </section>

      <NeedsYouStrip items={tree.needsYou} />

      <ManageLinks tree={tree} selection={selection ?? root} />

      {tree.divisions.length === 0 ? (
        <Empty icon="division" title={`${org.name} has nothing in it yet`} action={<Link href={paths.start()} className={buttonVariants({ size: "lg" })}>Describe your first idea</Link>}>
          Describe an idea and Endgame researches it, suggests a division and a name for it, and builds it once you agree.
        </Empty>
      ) : (
        <ChartViews tree={tree} selection={selection ?? root} onSelect={onSelect} />
      )}
    </>
  );
}

/**
 * What an Admin or the Owner manages at the selected level: its secrets, and — for the Owner — the
 * log of every time FrostAura entered. Both follow the selection, as the conversation does.
 */
function ManageLinks({ tree, selection }: { tree: Tree; selection: Selection }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const node = selection.kind === "employee" ? { scope: selection.scope, name: selection.trail[selection.trail.length - 2] ?? "" } : { scope: selection.scope, name: selection.trail[selection.trail.length - 1] ?? "" };
  // The role at the level selected, exactly as the server resolves it (PPL-01); an older control plane gives one role for the tree.
  const at = roleInTree(tree, node.scope);
  const role = at === undefined ? tree.viewerRole : at;
  const admin = role === "admin" || role === "owner";
  const ownerOfOrganisation = (tree.organisation ? roleInTree(tree, tree.organisation.slug) : undefined) ?? tree.viewerRole;
  return (
    <nav aria-label="Manage" className={cn("flex flex-wrap gap-2", RISE, stagger(1))}>
      {selection.kind === "employee" && selection.employeeId && (
        <Link href={paths.employee(selection.employeeId)} className={buttonVariants({ variant: "soft" })}>
          <Icon name="employee" tinted className="size-4" />
          {selection.trail[selection.trail.length - 1]}’s record and memory
        </Link>
      )}
      <Link href={paths.manage(node.scope)} className={buttonVariants({ variant: "soft" })}>
        <Icon name="organisation" tinted className="size-4" />
        Manage
      </Link>
      <Link href={paths.autonomy(node.scope)} className={buttonVariants({ variant: "soft" })}>
        <Icon name="plan" tinted className="size-4" />
        Autonomy for {node.name}
      </Link>
      <Link href={paths.hires(node.scope)} className={buttonVariants({ variant: "soft" })}>
        <Icon name="contractors" tinted className="size-4" />
        Hiring
      </Link>
      {selection.kind !== "employee" && selection.kind !== "project" && selection.kind !== "app" && (
        <Link href={paths.suggestions(node.scope)} className={buttonVariants({ variant: "soft" })}>
          <Icon name="research" tinted className="size-4" />
          Ideas from your portfolio
        </Link>
      )}
      {admin && (
        <Link href={paths.people(node.scope)} className={buttonVariants({ variant: "soft" })}>
          <Icon name="employee" tinted className="size-4" />
          People
        </Link>
      )}
      <Link href={paths.assistants()} className={buttonVariants({ variant: "soft" })}>
        <Icon name="assistants" tinted className="size-4" />
        {technical ? "MCP access" : "AI assistants"}
      </Link>
      {admin && (
        <Link href={paths.secrets(node.scope)} className={buttonVariants({ variant: "soft" })}>
          <Icon name="secrets" tinted className="size-4" />
          Secrets for {node.name}
        </Link>
      )}
      {ownerOfOrganisation === "owner" && (
        <Link href={paths.operatorAccess()} className={buttonVariants({ variant: "soft" })}>
          <Icon name="god-mode" tinted className="size-4" />
          Operator access
        </Link>
      )}
    </nav>
  );
}

const NEED_STYLE: Record<NeedsYou["kind"], { badge: string; tone: "white" | "violet" | "quiet"; card: string; detail: string }> = {
  verdict: { badge: "Verdict waiting", tone: "white", card: "border-attention-line bg-attention-tint", detail: "text-attention-deep" },
  approval: { badge: "Approval needed", tone: "violet", card: "border-violet-line bg-violet-tint", detail: "text-violet-deep" },
  hire: { badge: "Hire proposed", tone: "violet", card: "border-violet-line bg-violet-tint", detail: "text-violet-deep" },
  idle: { badge: "Nothing to do", tone: "quiet", card: "border-border-strong bg-surface", detail: "text-ink-body" },
};

function needHref(item: NeedsYou): string {
  switch (item.kind) {
    case "verdict":
      return paths.idea(item.ideaId);
    case "approval":
      return paths.run(item.runId);
    case "hire":
      return paths.hire(item.hireId);
    case "idle":
      return paths.employee(item.employeeId);
  }
}

function NeedsYouStrip({ items }: { items: NeedsYou[] }) {
  const technical = useAppSelector((st) => st.ui.mode) === "technical";
  if (items.length === 0) {
    return (
      <p data-state="empty" className={cn("flex items-center gap-2 text-success-text", RISE, stagger(1))}>
        <Icon name="health" />
        Nothing needs you right now: no verdict, approval or hire is waiting, and no one is idle.
      </p>
    );
  }
  return (
    <section aria-label="Needs you" className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3", RISE, stagger(1))}>
      {items.map((item) => {
        const style = NEED_STYLE[item.kind];
        const lines = needLines(item);
        return (
          <Link
            key={item.id}
            href={needHref(item)}
            className={cn("flex flex-col gap-1.5 rounded-md border px-5 py-4 text-ink transition duration-200 hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0", style.card)}
          >
            <Badge tone={style.tone} className="self-start bg-surface">
              {style.badge}
            </Badge>
            <span className="line-clamp-2 break-words text-base font-semibold">{lines.headline}</span>
            <span className={cn("line-clamp-1 break-words", style.detail)}>{lines.line}</span>
            {technical && item.kind === "approval" && item.technical && <code className="break-all font-mono text-xs text-ink-muted">{item.technical}</code>}
          </Link>
        );
      })}
    </section>
  );
}

type ChartView = "chart" | "org-chart" | "data-flow";

const VIEWS: { value: ChartView; label: string }[] = [
  { value: "chart", label: "The organisation" },
  { value: "org-chart", label: "Who works on what" },
  { value: "data-flow", label: "How data flows" },
];

/** The living org chart, and the same organisation read as a graph: responsibility, and data. */
function ChartViews({ tree, selection, onSelect }: { tree: Tree; selection: Selection; onSelect: (s: Selection) => void }) {
  const [view, setView] = useState<ChartView>("chart");
  // The graphs ask at the level selected, which is always one the person holds a role at (ORG-19).
  const scope = selection.scope;
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="View" className="flex flex-wrap gap-1 self-start rounded-xs bg-quiet p-1">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            id={`view-${v.value}`}
            aria-selected={view === v.value}
            aria-controls="chart-panel"
            onClick={() => setView(v.value)}
            className={cn("min-h-touch rounded-xs px-3 text-sm transition-colors sm:px-4", view === v.value ? "bg-surface font-semibold text-ink shadow-toggle" : "text-ink-muted hover:text-ink")}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div id="chart-panel" role="tabpanel" aria-labelledby={`view-${view}`}>
        <ErrorBoundary name={VIEWS.find((v) => v.value === view)?.label ?? "The chart"} resetKey={view}>
          {view === "chart" ? <OrgChart tree={tree} selection={selection} onSelect={onSelect} /> : <OntologyView scope={scope} view={view} />}
        </ErrorBoundary>
      </div>
    </div>
  );
}

/** An operator with no organisation of their own starts in God mode. */
function OperatorHome() {
  return (
    <section aria-label="God mode" className={cn("flex flex-col items-start gap-4 rounded-lg border-2 border-attention-text bg-surface px-6 py-8 sm:px-10", RISE)}>
      <span className="flex items-center gap-2 font-semibold uppercase tracking-wide text-attention-text">
        <Icon name="god-mode" />
        God mode
      </span>
      <h1 className="max-w-prose font-display text-3xl font-bold sm:text-4xl">You run Endgame for FrostAura. Every organisation is one step away.</h1>
      <p className="max-w-prose text-ink-body">List them, set one up for an invited Owner, top one up or enter it. Each entry is written where that organisation&rsquo;s Owner can read it.</p>
      <Link href={paths.operator()} className={buttonVariants({ size: "lg" })}>
        Every organisation
      </Link>
    </section>
  );
}

/** Signed in, with no role anywhere, after the first organisation exists: organisations are FrostAura's to set up (ORG-03). */
function NotInvited({ email }: { email: string | null }) {
  return (
    <section aria-label="No organisation yet" className={cn("flex flex-col items-start gap-4 rounded-lg border bg-surface px-6 py-8 shadow-card sm:px-10", RISE)}>
      <Icon name="organisation" tinted className="size-8" />
      <h1 className="max-w-prose font-display text-3xl font-bold sm:text-4xl">Organisations are set up by FrostAura</h1>
      <p className="max-w-prose text-ink-body">
        {email ? `You are signed in as ${email}, ` : "You are signed in, "}but you hold no role in any organisation yet, and an organisation cannot be started here. FrostAura sets one up for each
        person it invites. If you were invited, sign in with the invitation code you were sent; if someone already works here, ask them to give you a role.
      </p>
    </section>
  );
}

function FirstRun() {
  return (
    <section aria-label="Get started" className={cn("relative flex flex-col items-start gap-5 overflow-hidden rounded-lg bg-primary px-6 py-10 text-primary-ink sm:px-10", RISE)}>
      <div aria-hidden className="absolute -top-20 right-24 size-aura animate-drift rounded-full bg-violet opacity-75 blur-aura motion-reduce:animate-none" />
      <img src="/brand/endgame-mark.svg" alt="" width={56} height={56} className="relative size-14 rounded-sm ring-4 ring-surface/30" />
      <h1 className="relative max-w-prose font-display text-4xl font-bold sm:text-hero">Name your organisation, then describe your first idea.</h1>
      <p className="relative max-w-prose text-base text-primary-tint">
        Everything you make lives under it. Endgame researches the idea first, tells you plainly whether it is worth building, then builds and runs it.
      </p>
      <Link href={paths.start()} className={cn("relative", buttonVariants({ variant: "white", size: "lg" }))}>
        Start
      </Link>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <Loading label="Loading the organisation" className="flex flex-col gap-6">
      <Skeleton className="h-40 rounded-lg" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton className="h-24 rounded-md" />
        <Skeleton className="h-24 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-4">
            <Skeleton className="h-20 rounded-md" />
            <Skeleton className="ml-wire h-40 rounded-md" />
            <Skeleton className="ml-wire h-32 rounded-md" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

