import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { SCROLL_ROW } from "@/components/ui/layout";
import { capitalise } from "@/lib/format";
import { useViewport } from "@/lib/useViewport";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PersonChip } from "@/components/ui/chip";
import { TITLE } from "@/components/ui/page";
import { Stat } from "@/components/ui/stat";
import { buttonVariants } from "@/components/ui/button";
import { RISE, stagger } from "@/lib/motion";
import { viewOf } from "@/lib/queryState";
import { covers, roleInTree } from "@/lib/roles";
import { paths } from "@/lib/router";
import { useActiveTree } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { useGetIdeaQuery, useGetMeQuery } from "@/store/api";
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
    <AppShell
      crumbs={crumbs}
      talk={
        tree && activeSelection && tree.divisions.length > 0
          ? {
              label: `Talk to ${activeSelection.trail[activeSelection.trail.length - 1] ?? tree.organisation?.name ?? "Endgame"}`,
              content: (
                <ErrorBoundary name="The conversation" resetKey={activeSelection.scope + (activeSelection.employeeId ?? "")}>
                  <ConversationDock tree={tree} selection={activeSelection} />
                </ErrorBoundary>
              ),
            }
          : undefined
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
      {/* The hero: white, the organisation's name as the title, its four figures under the name, its people as chips. */}
      <section aria-label="Organisation" className={cn("flex flex-col gap-5 rounded-lg border bg-surface px-6 py-6 shadow-card max-sm:gap-4 max-sm:px-5 max-sm:py-5 sm:px-8", RISE)}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 max-w-prose flex-col gap-1.5">
            <span className="text-eyebrow font-semibold uppercase text-ink-muted">Organisation</span>
            <h1 className={TITLE}>
              <button type="button" aria-pressed={isRootSelected} onClick={() => onSelect(root)} className="rounded-xs text-left touch:min-h-touch">
                {org.name}
              </button>
            </h1>
            {org.summary && <span className="text-ink-body max-sm:text-sm">{org.summary}</span>}
          </div>
          <Link href={paths.start()} className={cn(buttonVariants({ size: "lg" }), "max-sm:order-last max-sm:w-full")}>
            New idea
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-x-8 gap-y-3 self-start max-sm:w-full max-sm:gap-x-3">
          {orgFigures(counts, org.spend.monthCredits).map((f) => (
            <Stat key={f.label} plain label={f.label} value={f.value} className="flex-col-reverse" />
          ))}
        </div>
        {org.workers.length > 0 && (
          // A phone keeps the organisation's own people on one line that scrolls sideways.
          <div className="no-scrollbar flex flex-wrap gap-2 max-sm:-mx-5 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-5">
            {org.workers.map((w) => (
              <PersonChip
                key={w.id}
                name={w.name}
                id={w.id}
                label={workerActivity(w) ? `${workerLabel(w)} — ${workerActivity(w)}` : workerLabel(w)}
                selected={selection?.employeeId === w.id && selection.scope === org.slug}
                onSelect={() => onSelect({ scope: org.slug, kind: "employee", trail: [org.name, w.name], employeeId: w.id })}
              />
            ))}
          </div>
        )}
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
    <nav aria-label="Manage" className={cn(SCROLL_ROW, RISE, stagger(1))}>
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

/** One card style for everything that waits on you; what kind it is, its tag says (ARCH-011). */
const NEED_STYLE: Record<NeedsYou["kind"], { badge: string; tone: BadgeTone }> = {
  verdict: { badge: "Verdict waiting", tone: "warn" },
  approval: { badge: "Approval needed", tone: "warn" },
  hire: { badge: "Hire proposed", tone: "info" },
  idle: { badge: "Nothing to do", tone: "neutral" },
};

/** A verdict research refused over a red line: not waiting for a call, so not marked as one. */
const RED_LINE_STYLE = { badge: "Refused", tone: "bad" as const };

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
  const phone = useViewport() === "phone";
  if (items.length === 0) {
    return (
      <p data-state="empty" className={cn("flex items-center gap-2 text-success-text", RISE, stagger(1))}>
        <Icon name="health" />
        Nothing needs you right now: no verdict, approval or hire is waiting, and no one is idle.
      </p>
    );
  }
  const cards = items.map((item) =>
    item.kind === "verdict" && item.verdict === "do-not-build" ? <RefusableVerdictCard key={item.id} item={item} technical={technical} /> : <NeedCard key={item.id} item={item} technical={technical} redLine={null} />,
  );
  // A phone says how many wait and what the first is, in one row; the list opens from it.
  if (phone) return <NeedsYouSummary items={items}>{cards}</NeedsYouSummary>;
  return (
    <section aria-label="Needs you" className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3", RISE, stagger(1))}>
      {cards}
    </section>
  );
}

function NeedsYouSummary({ items, children }: { items: NeedsYou[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const first = items[0];
  const kinds = [...new Set(items.map((i) => NEED_STYLE[i.kind].badge.toLowerCase()))];
  return (
    <section aria-label="Needs you" className={cn(RISE, stagger(1))}>
      <button
        type="button"
        data-needs-summary=""
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-touch w-full items-center gap-3 rounded-md border border-attention-line bg-attention-tint px-4 py-3 text-left text-ink"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-attention-text font-display text-base font-bold text-primary-ink">{items.length}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{items.length === 1 ? "1 thing needs you" : `${items.length} things need you`}</span>
          <span className="line-clamp-2 text-sm text-attention-deep">{first && items.length === 1 ? needLines(first).headline : capitalise(kinds.join(", "))}</span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-attention-text" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Needs you" description={items.length === 1 ? "1 thing waits for you" : `${items.length} things wait for you`}>
        <div className="flex flex-col gap-3">{children}</div>
      </Sheet>
    </section>
  );
}

/**
 * A do-not-build verdict may be a red-line refusal, which no one can overrule: only dropping or changing the idea is left
 * (VERD-06). The idea says which; until it is read, the card reads as any do-not-build verdict.
 */
function RefusableVerdictCard({ item, technical }: { item: Extract<NeedsYou, { kind: "verdict" }>; technical: boolean }) {
  const idea = useGetIdeaQuery(item.ideaId).data;
  return <NeedCard item={item} technical={technical} redLine={idea?.redLine ?? null} />;
}

function NeedCard({ item, technical, redLine }: { item: NeedsYou; technical: boolean; redLine: string | null }) {
  const style = redLine ? RED_LINE_STYLE : NEED_STYLE[item.kind];
  const lines = needLines(item, redLine);
  return (
    <Link
      href={needHref(item)}
      data-need={item.kind}
      className="flex flex-col gap-1.5 rounded-md border bg-surface px-5 py-4 text-ink shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <Badge tone={style.tone} className="self-start">
        {style.badge}
      </Badge>
      <span className="line-clamp-2 break-words text-base font-semibold">{lines.headline}</span>
      <span className="line-clamp-1 break-words text-ink-body">{lines.line}</span>
      {technical && lines.technical && <code className="break-all font-mono text-xs text-ink-muted">{lines.technical}</code>}
    </Link>
  );
}

type ChartView = "chart" | "org-chart" | "data-flow";

const VIEWS: { value: ChartView; label: string; short: string }[] = [
  { value: "chart", label: "The organisation", short: "Organisation" },
  { value: "org-chart", label: "Who works on what", short: "Who works" },
  { value: "data-flow", label: "How data flows", short: "Data flow" },
];

/** The living org chart, and the same organisation read as a graph: responsibility, and data. */
function ChartViews({ tree, selection, onSelect }: { tree: Tree; selection: Selection; onSelect: (s: Selection) => void }) {
  const [view, setView] = useState<ChartView>("chart");
  const phone = useViewport() === "phone";
  // The graphs ask at the level selected, which is always one the person holds a role at (ORG-19).
  const scope = selection.scope;
  return (
    <div className="flex flex-col gap-4">
      {/* One line on every screen: a phone says each view in a word or two, and keeps the whole name for screen readers. */}
      <div role="tablist" aria-label="View" className="flex flex-wrap gap-1 self-start rounded-xs bg-quiet p-1 max-sm:grid max-sm:w-full max-sm:grid-cols-3 max-sm:self-stretch">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            id={`view-${v.value}`}
            aria-selected={view === v.value}
            aria-controls="chart-panel"
            onClick={() => setView(v.value)}
            aria-label={phone ? v.label : undefined}
            className={cn("min-h-touch rounded-xs px-3 text-sm transition-colors max-sm:px-1 sm:px-4", view === v.value ? "bg-surface font-semibold text-ink shadow-toggle" : "text-ink-muted hover:text-ink")}
          >
            {phone ? v.short : v.label}
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
      <h1 className={cn(TITLE, "max-w-prose")}>You run Endgame for FrostAura. Every organisation is one step away.</h1>
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
      <h1 className={cn(TITLE, "max-w-prose")}>Organisations are set up by FrostAura</h1>
      <p className="max-w-prose text-ink-body">
        {email ? `You are signed in as ${email}, ` : "You are signed in, "}but you hold no role in any organisation yet, and an organisation cannot be started here. FrostAura sets one up for each
        person it invites. If you were invited, sign in with the invitation code you were sent; if someone already works here, ask them to give you a role.
      </p>
    </section>
  );
}

function FirstRun() {
  return (
    <section aria-label="Get started" className={cn("flex flex-col items-start gap-5 rounded-lg border bg-surface px-6 py-10 shadow-card sm:px-10", RISE)}>
      <img src="/brand/endgame-mark.svg" alt="" width={56} height={56} className="size-14 rounded-sm" />
      <h1 className={cn(TITLE, "max-w-prose")}>Name your organisation, then describe your first idea.</h1>
      <p className="max-w-prose text-base text-ink-body">
        Everything you make lives under it. Endgame researches the idea first, tells you plainly whether it is worth building, then builds and runs it.
      </p>
      <Link href={paths.start()} className={buttonVariants({ size: "lg" })}>
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

