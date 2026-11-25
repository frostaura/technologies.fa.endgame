import { useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/components/iconNames";
import { Link } from "@/components/Link";
import { Failed, Loading, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { formatDate, formatTime, plural } from "@/lib/format";
import { viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useGetOntologyQuery, useGetSecretsQuery } from "@/store/api";
import { downloadExport } from "@/store/sensitive";
import type { AppDetail } from "@/store/types";

/** The platform services an app can lean on, as the owner reads them. */
const SERVICE: Record<string, { label: string; icon: IconName }> = {
  identity: { label: "Sign-in", icon: "employee" },
  data: { label: "Data", icon: "project" },
  models: { label: "AI", icon: "research" },
  email: { label: "E-mail", icon: "email" },
  webhooks: { label: "Incoming data", icon: "incoming-data" },
  schedules: { label: "Schedules", icon: "schedules" },
  telemetry: { label: "Visits and errors measured", icon: "health" },
};

function Chip({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="inline-flex min-h-touch items-center gap-2 rounded-full border border-border-strong bg-surface px-3 py-1.5">
      <Icon name={icon} tinted className="size-4" />
      <span>{children}</span>
    </li>
  );
}

/**
 * What the app uses: the platform services it depends on (from the organisation graph), how many people
 * have signed up to it, the secrets it can read by name, who it is shared with, and that AI assistants can
 * work with it.
 */
export function WhatItUses({ app, canSeeSecrets }: { app: AppDetail; canSeeSecrets: boolean }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const graph = useGetOntologyQuery({ scope: app.scope, view: "all" });
  // Which secrets it is given is an Admin's to see; anyone else is told so rather than shown a refusal.
  const secrets = useGetSecretsQuery(app.scope, { skip: !canSeeSecrets });
  const graphView = viewOf(graph);
  const secretsView = viewOf(secrets);
  const services =
    graphView.kind === "loaded"
      ? [...new Set(graphView.data.edges.filter((e) => e.type === "depends-on" && e.from === `app:${app.id}`).map((e) => graphView.data.nodes.find((n) => n.id === e.to)).filter((n) => n?.type === "service").map((n) => n?.name ?? ""))]
      : [];
  const mcp = `${typeof window === "undefined" ? "" : window.location.origin}/mcp/apps/${app.id}`;
  return (
    <section aria-labelledby="uses-title" className="flex flex-col gap-2.5">
      <h2 id="uses-title" className="text-lg font-semibold">
        What it uses
      </h2>
      {graphView.kind === "loading" && (
        <Loading label="Loading what it uses" className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-28 rounded-full" />
          <Skeleton className="h-10 w-20 rounded-full" />
        </Loading>
      )}
      {graphView.kind === "failed" && <Failed title="What it uses could not be loaded" reason={graphView.reason} onRetry={() => void graph.refetch()} />}
      {graphView.kind === "loaded" && (
        <ul aria-label="What it uses" className="flex flex-wrap gap-2">
          {services.map((s) => (
            <Chip key={s} icon={SERVICE[s]?.icon ?? "app"}>
              {technical ? s : (SERVICE[s]?.label ?? s)}
            </Chip>
          ))}
          <Chip icon="employee">{app.endUsers === 0 ? "No one has signed up yet" : `${plural(app.endUsers, "person", "people")} signed up`}</Chip>
          {app.settings.access === "shared" && <Chip icon="employee">{`Shared with ${plural(app.sharedWith, "person", "people")}`}</Chip>}
          {secretsView.kind === "loaded" && secretsView.data.effective.length > 0 && <Chip icon="secrets">{plural(secretsView.data.effective.length, "secret")}</Chip>}
          <Chip icon="assistants">Open to AI assistants</Chip>
        </ul>
      )}
      {secretsView.kind === "loaded" && secretsView.data.effective.length > 0 && (
        <p className="text-sm text-ink-body">
          Secrets it can read: {secretsView.data.effective.map((x) => x.name).join(", ")}.{" "}
          <Link href={paths.secrets(app.scope)} className="rounded-xs text-primary-link hover:text-primary-hover">
            Manage them
          </Link>
        </p>
      )}
      {canSeeSecrets && secretsView.kind === "failed" && <p className="text-sm text-attention-text">Its secrets could not be read: {secretsView.reason}</p>}
      <p className="text-sm text-ink-body">
        An AI assistant you let in can use this app the way a person does.{" "}
        <Link href={paths.assistants()} className="rounded-xs text-primary-link hover:text-primary-hover">
          Let an assistant in
        </Link>
      </p>
      {technical && <code className="break-all font-mono text-xs text-ink-body">MCP: {mcp}</code>}
    </section>
  );
}

/** "It is yours": the Owner downloads the code, its whole history and the app's data, at no cost. */
export function ItIsYours({ app, isOwner }: { app: AppDetail; isOwner: boolean }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "working" } | { kind: "done"; name: string } | { kind: "failed"; reason: string }>({ kind: "idle" });
  const slug = app.scope.split("/").pop() ?? "app";
  const download = async () => {
    setState({ kind: "working" });
    const outcome = await downloadExport(app.id, `${slug}-export.tar.gz`);
    setState(outcome.ok ? { kind: "done", name: outcome.data.fileName } : { kind: "failed", reason: outcome.reason });
  };
  return (
    <section aria-labelledby="yours-title" className="flex flex-col gap-2.5">
      <h2 id="yours-title" className="text-lg font-semibold">
        It is yours
      </h2>
      <p className="text-ink-body">Download the code, its full history and all its data whenever you like, at no cost. Secrets are never included.</p>
      {isOwner ? (
        <>
          <Button variant="outline" className="self-start" disabled={state.kind === "working"} onClick={() => void download()}>
            {state.kind === "working" ? "Preparing the download…" : "Download everything"}
          </Button>
          {state.kind === "done" && (
            <p role="status" className="text-success-text">
              Saved as {state.name}.
            </p>
          )}
          {state.kind === "failed" && (
            <p role="alert" data-state="failed" className="rounded-xs border border-attention-line bg-attention-tint px-4 py-3 text-attention-text">
              The download could not be made: {state.reason}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-muted">Only the Owner can download it.</p>
      )}
    </section>
  );
}

/** Technical mode: what the app is underneath — its lifecycle state, version, addresses and ids. */
export function TechnicalDetails({ app }: { app: AppDetail }) {
  const rows: [string, string][] = [
    ["App id", app.id],
    ["Scope", app.scope],
    ["Lifecycle", app.status || "unknown"],
    ["Container", app.running],
    ["Version", app.version ?? "none published"],
    ["Published", app.publishedAt ? `${formatDate(app.publishedAt)} ${formatTime(app.publishedAt)}` : "never"],
    ["Sleeps after", plural(app.idleMinutes, "idle minute")],
    ["Path address", app.addresses.path],
    ["Subdomain address", app.addresses.subdomain ?? "none"],
  ];
  return (
    <section aria-labelledby="tech-title" className="flex flex-col gap-2.5">
      <h2 id="tech-title" className="flex items-center gap-2 text-lg font-semibold">
        <Icon name="build" tinted />
        Underneath
      </h2>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{k}</dt>
            <dd className={cn("m-0 break-all font-mono text-xs sm:col-span-2")}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
