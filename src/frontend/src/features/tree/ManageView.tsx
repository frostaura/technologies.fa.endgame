import { useState, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { RISE } from "@/lib/motion";
import { viewOf } from "@/lib/queryState";
import { effectiveRole, roleRank } from "@/lib/roles";
import { navigate, paths, useLocation } from "@/lib/router";
import { useActiveOrganisation, useActiveTree } from "@/lib/useActiveOrganisation";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useGetAppQuery, useGetMeQuery, type TreeArg } from "@/store/api";
import type { ManagedLevel, MemberRole } from "@/store/types";
import { CardNotesProvider } from "@/components/CardNotes";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useViewport } from "@/lib/useViewport";
import { AppShell } from "../shell/AppShell";
import { ContextPanel } from "./ContextPanel";
import { ArchiveNode, CreateChild, DeleteNode, RenameNode } from "./NodeControls";
import { LEVEL_NAME, childLevel, flatten, may, nodeAt, whoMay, type ManagedNode } from "./treeManage";

const INDENT: Record<number, string> = { 0: "pl-3", 1: "pl-7", 2: "pl-11", 3: "pl-14" };
const ICON = { organisation: "organisation", division: "division", project: "project", app: "app" } as const;

/**
 * Managing the organisation (TREE-02 to TREE-12, ORG-14): its divisions, projects and apps as one
 * outline, and for the one chosen its name, what it is, what can be added beneath it, and archiving or
 * deleting it. Each control is offered only to the role the control plane asks for; anyone else reads
 * who may.
 */
export function ManageView() {
  const active = useActiveOrganisation();
  const me = useGetMeQuery(undefined);
  const query = useActiveTree();
  const arg: TreeArg = undefined;
  const view = viewOf(query);
  const { search } = useLocation();
  const nodes = view.kind === "loaded" ? flatten(view.data) : [];
  const org = active.organisation;
  const asked = search.get("scope");
  const selected = nodeAt(nodes, asked ?? "") ?? nodes[0] ?? null;
  const entered = active.entered ? org?.slug : undefined;
  const roleOf = (scope: string): MemberRole | null => effectiveRole(query.data, me.data, scope);
  const nameOf = (path: string) => nodeAt(nodes, path)?.name ?? path.split("/").pop() ?? path;
  // A phone takes two steps: the outline alone, then the part chosen (a page of its own, so Back returns to the outline).
  const phone = useViewport() === "phone";
  const select = (scope: string) => navigate(paths.manage(scope, entered), { replace: !phone });
  const outlineHref = `/tree${entered ? `?organisation=${encodeURIComponent(entered)}` : ""}`;
  const step: "both" | "outline" | "part" = !phone ? "both" : asked ? "part" : "outline";

  return (
    <AppShell
      crumbs={[
        ...(org ? [{ label: org.name, href: entered ? paths.homeOf(entered) : paths.home() }] : []),
        ...(step === "part" && selected ? [{ label: "Manage", href: outlineHref }, { label: selected.name }] : [{ label: "Manage" }]),
      ]}
    >
      <div className={cn("flex flex-col gap-2", RISE)}>
        <h1 className="text-3xl font-semibold max-sm:text-2xl">{org ? `Manage ${view.kind === "loaded" ? (view.data.organisation?.name ?? org.name) : org.name}` : "Manage the organisation"}</h1>
        <p className="max-w-prose text-ink-body">Add divisions, projects and apps, rename them, say what each one is, and archive what you no longer use. A part&rsquo;s address is set when it is made and never changes.</p>
      </div>

      {!org && !active.isLoading && (
        <Empty icon="organisation" title="There is no organisation to manage yet" action={<Link href={paths.start()} className={buttonVariants()}>Name your organisation</Link>}>
          Name your organisation, and its divisions, projects and apps are managed here.
        </Empty>
      )}
      {(active.isLoading || (org && view.kind === "loading")) && (
        <Loading label="Loading the organisation" className="flex flex-col gap-6 lg:flex-row">
          <Skeleton className="h-80 rounded-md lg:w-aside 3xl:w-aside-wide" />
          <Skeleton className="h-80 rounded-md lg:flex-1" />
        </Loading>
      )}
      {org && view.kind === "failed" && <Failed title="The organisation could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && selected && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          {/* Two panes: the outline, as wide as a side panel, and the part chosen filling the rest. */}
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            {step !== "part" && <Outline nodes={nodes} selected={step === "outline" ? "" : selected.scope} onSelect={select} />}
            {step === "part" && (
              <Link href={outlineHref} className="flex min-h-touch items-center gap-1 self-start rounded-xs font-semibold text-primary-link">
                <ChevronLeft aria-hidden className="size-4" />
                Every part of the organisation
              </Link>
            )}
            {step !== "outline" && (
              <ErrorBoundary name="The part chosen" resetKey={selected.scope}>
                <NodePanel
                  key={selected.scope}
                  node={selected}
                  nodes={nodes}
                  role={roleOf(selected.scope)}
                  tree={arg}
                  onSelect={select}
                  startAdding={search.get("add") === "1"}
                  context={
                    <ErrorBoundary name="What this is" resetKey={selected.scope}>
                      <ContextPanel key={selected.scope} scope={selected.scope} name={selected.name} level={selected.level} canWrite={roleRank(roleOf(selected.scope)) >= roleRank("builder")} nameOf={nameOf} />
                    </ErrorBoundary>
                  }
                />
              </ErrorBoundary>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

function Outline({ nodes, selected, onSelect }: { nodes: ManagedNode[]; selected: string; onSelect: (scope: string) => void }) {
  return (
    <nav aria-label="Every part of the organisation" className="flex flex-col overflow-hidden rounded-md border bg-surface py-2 shadow-card lg:w-aside lg:shrink-0 3xl:w-aside-wide">
      <ul className="flex flex-col">
        {nodes.map((n) => (
          <li key={n.scope}>
            <button
              type="button"
              aria-current={n.scope === selected ? "true" : undefined}
              onClick={() => onSelect(n.scope)}
              className={cn(
                "flex min-h-touch w-full items-center gap-2.5 py-2 pr-3 text-left transition-colors hover:bg-primary-tint",
                INDENT[n.depth],
                n.scope === selected && "bg-primary-tint font-semibold",
                n.archived && "text-ink-muted",
              )}
            >
              <Icon name={ICON[n.level]} className={cn("size-4 shrink-0", n.archived ? "text-ink-muted" : "text-ink-body")} />
              {/* Names are never cut: a long one wraps under itself. */}
              <span className="min-w-0 flex-1 break-words">{n.name}</span>
              {n.archived && <Badge tone="neutral">Archived</Badge>}
              <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-muted sm:hidden" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NodePanel({
  node,
  nodes,
  role,
  tree,
  onSelect,
  startAdding,
  context,
}: {
  node: ManagedNode;
  nodes: ManagedNode[];
  role: MemberRole | null;
  tree: TreeArg;
  onSelect: (scope: string) => void;
  startAdding: boolean;
  context: ReactNode;
}) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [adding, setAdding] = useState(startAdding);
  const child = childLevel(node.level);
  const managed = node.level !== "organisation" ? (node.level as ManagedLevel) : null;
  const app = useGetAppQuery(node.id, { skip: node.level !== "app" || !node.archived });
  const published = app.data ? app.data.version !== null || app.data.publishedAt !== null : false;
  const children = nodes.filter((n) => n.parent === node.scope);
  const parentName = node.parent ? (nodeAt(nodes, node.parent)?.name ?? node.parent) : null;

  // One message at a time in the panel (D37): renaming, archiving and deleting replace each other's note.
  return (
    <CardNotesProvider>
      <section aria-label={`${LEVEL_NAME[node.level]}: ${node.name}`} className="flex min-w-0 flex-1 flex-col gap-6 rounded-md border bg-surface px-6 py-6 shadow-card max-sm:px-4 max-sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-eyebrow font-semibold uppercase text-ink-muted">
              {LEVEL_NAME[node.level]}
              {parentName ? ` in ${parentName}` : ""}
            </span>
            <h2 className="break-words font-display text-2xl font-semibold">{node.name}</h2>
            <span className="break-all text-sm text-ink-muted">Its address: {node.scope}</span>
            {technical && <code className="break-all font-mono text-xs text-ink-muted">{node.id}</code>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {node.archived ? <Badge tone="neutral">Archived</Badge> : <Badge tone="good">Active</Badge>}
            {node.level === "app" && (
              <Link href={paths.app(node.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                The app&rsquo;s page
              </Link>
            )}
          </div>
        </div>

        {/* What it is called and holds, and archiving it; beside them at wide sizes (under them on narrower ones), what it is. */}
        <div className="grid grid-cols-1 items-start gap-x-10 gap-y-6 2xl:grid-cols-2">
          <div className="flex min-w-0 flex-col divide-y">
            <section aria-labelledby={`${node.scope}-name`} className="flex flex-col gap-3 py-6 first:pt-0 last:pb-0">
              <h3 id={`${node.scope}-name`} className={SUB}>
                Its name
              </h3>
              {may("rename", node.level, role) ? (
                <RenameNode level={managed ?? "organisation"} id={node.id} name={node.name} slug={node.slug} tree={tree} />
              ) : (
                <p className="text-sm text-ink-muted">{capital(whoMay("rename", node.level))} renames {node.level === "organisation" ? "the organisation" : `${article(node.level)} ${node.level}`}.</p>
              )}
            </section>

            {child && (
              <section aria-labelledby={`${node.scope}-in`} className="flex flex-col gap-3 py-6 first:pt-0 last:pb-0">
                <h3 id={`${node.scope}-in`} className={SUB}>
                  What is in it
                </h3>
                {children.length === 0 ? (
                  <p data-state="empty" className="text-sm text-ink-muted">
                    No {plural(child)} in {node.name} yet.
                  </p>
                ) : (
                  <ul aria-label={`In ${node.name}`} className="flex flex-col divide-y rounded-sm border">
                    {children.map((c) => (
                      <li key={c.scope}>
                        <button type="button" onClick={() => onSelect(c.scope)} className={cn("flex min-h-touch w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ground", c.archived && "text-ink-muted")}>
                          <Icon name={ICON[c.level]} className="size-4 shrink-0 text-ink-muted" />
                          <span className="min-w-0 flex-1 break-words">{c.name}</span>
                          {c.archived && <Badge tone="neutral">Archived</Badge>}
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {may("create", node.level, role) ? (
                  adding ? (
                    <CreateChild level={child} parent={node.scope} parentName={node.name} onCancel={() => setAdding(false)} onCreated={(made) => onSelect(made.path)} />
                  ) : (
                    <Button size="sm" variant="outline" className="self-start" onClick={() => setAdding(true)}>
                      Add {article(child)} {child}
                    </Button>
                  )
                ) : (
                  <p className="text-sm text-ink-muted">
                    {capital(whoMay("create", node.level))} adds {article(child)} {child} here.
                  </p>
                )}
              </section>
            )}

            {managed && (
              <section aria-labelledby={`${node.scope}-archive`} className="flex flex-col gap-3 py-6 first:pt-0 last:pb-0">
                <h3 id={`${node.scope}-archive`} className={SUB}>
                  Archive or delete
                </h3>
                {may("archive", node.level, role) ? (
                  <ArchiveNode level={managed} id={node.id} name={node.name} archived={node.archived} published={published} tree={tree} />
                ) : (
                  <p className="text-sm text-ink-muted">{capital(whoMay("archive", node.level))} archives {article(node.level)} {node.level}.</p>
                )}
                {may("delete", node.level, role) ? (
                  <DeleteNode level={managed} id={node.id} name={node.name} tree={tree} onDeleted={() => onSelect(node.parent ?? node.scope)} />
                ) : (
                  <p className="text-sm text-ink-muted">{capital(whoMay("delete", node.level))} deletes {article(node.level)} {node.level} with nothing in it.</p>
                )}
              </section>
            )}
          </div>
          <div className="min-w-0 border-t pt-6 2xl:border-l 2xl:border-t-0 2xl:pl-10 2xl:pt-0">{context}</div>
        </div>
      </section>
    </CardNotesProvider>
  );
}

/** A heading inside the part's card. */
const SUB = "font-display text-base font-semibold";

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const article = (word: string) => (word === "app" || word === "organisation" ? "an" : "a");
const plural = (level: ManagedLevel) => `${level}s`;
