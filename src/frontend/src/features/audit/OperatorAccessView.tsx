import { PageHeader } from "@/components/ui/page";
import { Empty, Failed, Loading, Skeleton, Stale } from "@/components/states";
import { formatCredits, formatDate, formatTime } from "@/lib/format";
import { RISE } from "@/lib/motion";
import { viewOf } from "@/lib/queryState";
import { paths } from "@/lib/router";
import { useActiveOrganisation } from "@/lib/useActiveOrganisation";
import { useAppSelector } from "@/store";
import { useGetOperatorAccessQuery } from "@/store/api";
import type { OperatorAction } from "@/store/types";
import { AppShell } from "../shell/AppShell";

const LINES: Record<string, string> = {
  "tobacco-gambling-finance": "tobacco, exploitative gambling or predatory finance",
  weapons: "weapons used against civilians",
  "animal-harm": "animal harm and industrial cruelty",
  surveillance: "surveillance and authoritarian tooling",
};

/** What an operator did, in plain words. Technical mode adds the raw action and its detail. */
function describeAction(action: OperatorAction): string {
  const detail = action.detail ?? {};
  const credits = typeof detail.credits === "number" ? detail.credits : null;
  const text = (key: string) => (typeof detail[key] === "string" ? (detail[key] as string) : null);
  switch (action.action) {
    case "organisation.entered":
      return "Entered the organisation";
    case "organisation.provisioned":
      return "Set up the organisation";
    case "organisation.screened": {
      const how = text("method") === "manual" ? `by hand${text("reason") ? `: ${text("reason")}` : ""}` : "by a model";
      return text("result") === "breach"
        ? `Screened against the red lines: it crosses ${LINES[text("line") ?? ""] ?? "a red line"} (${how})`
        : `Screened against the red lines: it crosses none (${how})`;
    }
    case "credits.top_up":
      return credits !== null ? `Added ${formatCredits(credits)}` : "Added credits";
    case "overdraft.set":
      return credits !== null ? `Changed the deepest overdraft to ${formatCredits(credits)} below zero` : "Changed the deepest overdraft";
    case "topup_request.fulfilled":
      return credits !== null ? `Answered a top-up request with ${formatCredits(credits)}` : "Answered a top-up request";
    case "topup_request.declined":
      return `Declined a top-up request${credits !== null ? ` for ${formatCredits(credits)}` : ""}${text("note") ? `: ${text("note")}` : ""}`;
    case "pricing.changed":
      return "Changed the prices for every organisation";
    default:
      // Everything else an operator changed inside the organisation, as an Admin, carries its own title.
      return action.action.startsWith("admin.") && text("title") ? `As an Admin: ${text("title")}` : "Acted on the organisation";
  }
}

/**
 * God mode's audit trail, for the Owner: every time someone from FrostAura entered the
 * organisation or acted on it (CLAUDE.md rule 1 — operator access is never silent). Anyone else
 * is refused by the control plane, and that refusal is shown as what it is.
 */
export function OperatorAccessView() {
  const active = useActiveOrganisation();
  const org = active.organisation;
  const query = useGetOperatorAccessQuery(org?.slug ?? "", { skip: !org });
  const view = viewOf(query);
  const technical = useAppSelector((s) => s.ui.mode) === "technical";

  return (
    <AppShell crumbs={[...(org ? [{ label: org.name, href: paths.home() }] : []), { label: "Operator access" }]}>
      <PageHeader
        className={RISE}
        icon="god-mode"
        title="Operator access"
        lead={`Every time someone from FrostAura entered ${org?.name ?? "your organisation"} or acted on it, newest first. It is never silent, and only the Owner can read it.`}
      />

      {!active.isLoading && !org ? (
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
            <Failed title={view.status === 403 ? "Only the Owner can read the operator log" : "The operator log could not be loaded"} reason={view.reason} status={view.status} onRetry={() => void query.refetch()} />
          )}
          {view.kind === "loaded" && (
            <>
              {view.stale && <Stale reason={view.stale.reason} />}
              {view.data.length === 0 ? (
                <Empty icon="god-mode" title={`No one from FrostAura has entered ${org?.name ?? "your organisation"}`}>
                  If anyone does, it is written here first.
                </Empty>
              ) : (
                // One list, newest first, every entry on the same grid: when, then what was done and by whom.
                <ol aria-label="Operator log" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
                  {[...view.data]
                    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
                    .map((entry) => (
                      <li key={entry.id} className="grid grid-cols-1 gap-x-6 gap-y-1 border-b px-5 py-3.5 last:border-b-0 sm:grid-cols-time-grow lg:grid-cols-time-grow-who">
                        <time dateTime={entry.at} className="whitespace-nowrap text-sm tabular-nums text-ink-muted sm:pt-px">
                          {formatDate(entry.at)}, {formatTime(entry.at)}
                        </time>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="break-words font-semibold">{describeAction(entry)}</span>
                          {technical && (
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xs bg-ground px-3 py-2 font-mono text-xs text-ink-body">
                              {entry.action}
                              {entry.detail ? ` ${JSON.stringify(entry.detail)}` : ""}
                            </pre>
                          )}
                        </div>
                        <span className="min-w-0 break-words text-sm text-ink-body sm:col-start-2 lg:col-start-3 lg:pt-px">
                          {entry.operator.displayName || "A FrostAura operator"}
                          {entry.operator.email ? ` · ${entry.operator.email}` : ""}
                        </span>
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
