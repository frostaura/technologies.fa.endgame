import { useState } from "react";
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
  const select = (scope: string) => navigate(paths.manage(scope, entered), { replace: true });

  return (
    <AppShell
      crumbs={[...(org ? [{ label: org.name, href: entered ? paths.homeOf(entered) : paths.home() }] : []), { label: "Manage" }]}
      aside={
        selected ? (
          <ErrorBoundary name="What this is" resetKey={selected.scope}>
            <ContextPanel key={selected.scope} scope={selected.scope} name={selected.name} level={selected.level} canWrite={roleRank(roleOf(selected.scope)) >= roleRank("builder")} nameOf={nameOf} />
          </ErrorBoundary>
        ) : undefined
      }
    >
      <div className={cn("flex flex-col gap-2", RISE)}>
        <h1 className="text-3xl font-semibold">{org ? `Manage ${view.kind === "loaded" ? (view.data.organisation?.name ?? org.name) : org.name}` : "Manage the organisation"}</h1>
        <p className="max-w-prose text-ink-body">Add divisions, projects and apps, rename them, say what each one is, and archive what you no longer use. A part&rsquo;s address is set when it is made and never changes.</p>
      </div>

      {!org && !active.isLoading && (
        <Empty icon="organisation" title="There is no organisation to manage yet" action={<Link href={paths.start()} className={buttonVariants()}>Name your organisation</Link>}>
          Name your organisation, and its divisions, projects and apps are managed here.
        </Empty>
      )}
      {(active.isLoading || (org && view.kind === "loading")) && (
        <Loading label="Loading the organisation" className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-md" />
          <Skeleton className="h-80 rounded-md lg:col-span-2" />
        </Loading>
      )}
      {org && view.kind === "failed" && <Failed title="The organisation could not be loaded" reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && selected && (
        <>
          {view.stale && <Stale reason={view.stale.reason} />}
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
            <Outline nodes={nodes} selected={selected.scope} onSelect={select} />
            <ErrorBoundary name="The part chosen" resetKey={selected.scope}>
              <NodePanel key={selected.scope} node={selected} nodes={nodes} role={roleOf(selected.scope)} tree={arg} onSelect={select} startAdding={search.get("add") === "1"} />
            </ErrorBoundary>
          </div>
        </>
      )}
    </AppShell>
  );
}

function Outline({ nodes, selected, onSelect }: { nodes: ManagedNode[]; selected: string; onSelect: (scope: string) => void }) {
  return (
    <nav aria-label="Every part of the organisation" className="flex flex-col overflow-hidden rounded-md border bg-surface py-2 shadow-card">
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
              <Icon name={ICON[n.level]} tinted={!n.archived} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{n.name}</span>
              {n.archived && <Badge tone="quiet">Archived</Badge>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NodePanel({ node, nodes, role, tree, onSelect, startAdding }: { node: ManagedNode; nodes: ManagedNode[]; role: MemberRole | null; tree: TreeArg; onSelect: (scope: string) => void; startAdding: boolean }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [adding, setAdding] = useState(startAdding);
  const child = childLevel(node.level);
  const managed = node.level !== "organisation" ? (node.level as ManagedLevel) : null;
  const app = useGetAppQuery(node.id, { skip: node.level !== "app" || !node.archived });
  const published = app.data ? app.data.version !== null || app.data.publishedAt !== null : false;
  const children = nodes.filter((n) => n.parent === node.scope);
  const parentName = node.parent ? (nodeAt(nodes, node.parent)?.name ?? node.parent) : null;

  return (
    <section aria-label={`${LEVEL_NAME[node.level]}: ${node.name}`} className="flex flex-col gap-5 rounded-md border bg-surface px-5 py-5 shadow-card lg:col-span-2">
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
          {node.archived ? <Badge tone="quiet">Archived</Badge> : <Badge tone="success">Active</Badge>}
          {node.level === "app" && (
            <Link href={paths.app(node.id)} className="rounded-xs font-semibold text-primary-link hover:text-primary-hover">
              The app&rsquo;s page
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-base font-semibold">Its name</h3>
          {may("rename", node.level, role) ? (
            <RenameNode level={managed ?? "organisation"} id={node.id} name={node.name} slug={node.slug} tree={tree} />
          ) : (
            <p className="text-sm text-ink-muted">{capital(whoMay("rename", node.level))} renames {node.level === "organisation" ? "the organisation" : `${article(node.level)} ${node.level}`}.</p>
          )}
        </div>

        {child && (
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-base font-semibold">What is in it</h3>
            {children.length === 0 ? (
              <p data-state="empty" className="text-sm text-ink-muted">
                No {plural(child)} in {node.name} yet.
              </p>
            ) : (
              <ul aria-label={`In ${node.name}`} className="flex flex-wrap gap-2">
                {children.map((c) => (
                  <li key={c.scope}>
                    <Button size="sm" variant="soft" onClick={() => onSelect(c.scope)}>
                      {c.name}
                      {c.archived && <Badge tone="quiet">Archived</Badge>}
                    </Button>
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
          </div>
        )}
      </div>

      {managed && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <h3 className="font-display text-base font-semibold">Archive or delete</h3>
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
        </div>
      )}
    </section>
  );
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const article = (word: string) => (word === "app" || word === "organisation" ? "an" : "a");
const plural = (level: ManagedLevel) => `${level}s`;
