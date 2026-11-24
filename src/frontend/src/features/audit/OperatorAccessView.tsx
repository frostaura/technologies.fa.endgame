import { Icon } from "@/components/Icon";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { formatCredits, formatDate, formatTime } from "@/lib/format";
import { RISE } from "@/lib/motion";
import { viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store";
import { useGetMeQuery, useGetOperatorAccessQuery } from "@/store/api";
import type { OperatorAction } from "@/store/types";
import { AppShell } from "../shell/AppShell";

/** What an operator did, in plain words. Technical mode adds the raw action and its detail. */
function describeAction(action: OperatorAction): string {
  const credits = typeof action.detail?.credits === "number" ? action.detail.credits : null;
  switch (action.action) {
    case "organisation.entered":
      return "Entered the organisation";
    case "organisation.provisioned":
      return "Set up the organisation";
    case "credits.top_up":
      return credits !== null ? `Added ${formatCredits(credits)}` : "Added credits";
    default:
      return "Acted on the organisation";
  }
}

/**
 * God mode's audit trail, for the Owner: every time someone from FrostAura entered the
 * organisation or acted on it (CLAUDE.md rule 1 — operator access is never silent). Anyone else
 * is refused by the control plane, and that refusal is shown as what it is.
 */
export function OperatorAccessView() {
  const me = useGetMeQuery(undefined);
  const org = me.data?.organisation ?? null;
  const query = useGetOperatorAccessQuery(org?.slug ?? "", { skip: !org });
  const view = viewOf(query);
  const technical = useAppSelector((s) => s.ui.mode) === "technical";

  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), { label: "Operator access" }]}>
      <header className={cn("flex flex-col gap-1.5", RISE)}>
        <h1 className="flex items-center gap-3 text-3xl font-semibold">
          <Icon name="god-mode" tinted className="size-7" />
          Operator access
        </h1>
        <p className="max-w-prose text-ink-body">
          Every time someone from FrostAura entered {org?.name ?? "your organisation"} or acted on it, newest first. It is never silent, and only the Owner can read it.
        </p>
      </header>

      {me.data && !org ? (
        <Empty icon="organisation" title="There is no log until your organisation is named" />
      ) : (
        <>
          {view.kind === "loading" && (
            <Loading label="Loading the operator log" className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 rounded-md" />
              ))}
            </Loading>
          )}
          {view.kind === "failed" && (
            <Failed title={view.status === 403 ? "Only the Owner can read the operator log" : "The operator log could not be loaded"} reason={view.reason} onRetry={() => void query.refetch()} />
          )}
          {view.kind === "loaded" && (
            <>
              {view.stale && <Stale reason={view.stale.reason} />}
              {view.data.length === 0 ? (
                <Empty icon="god-mode" title={`No one from FrostAura has entered ${org?.name ?? "your organisation"}`}>
                  If anyone does, it is written here first.
                </Empty>
              ) : (
                <ol aria-label="Operator log" className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {view.data.map((entry) => (
                    <li key={entry.id} className="flex flex-col gap-1.5 rounded-md border bg-surface px-5 py-4 shadow-card">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-semibold">{describeAction(entry)}</span>
                        <time dateTime={entry.at} className="text-sm text-ink-muted">
                          {formatDate(entry.at)}, {formatTime(entry.at)}
                        </time>
                      </div>
                      <span className="text-ink-body">
                        {entry.operator.displayName || "A FrostAura operator"}
                        {entry.operator.email ? ` · ${entry.operator.email}` : ""}
                      </span>
                      {technical && (
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xs bg-ground px-3 py-2 font-mono text-xs text-ink-body">
                          {entry.action}
                          {entry.detail ? ` ${JSON.stringify(entry.detail)}` : ""}
                        </pre>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
