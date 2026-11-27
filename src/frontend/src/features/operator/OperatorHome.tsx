import { Link } from "@/components/Link";
import { Empty, Failed, Loading, Skeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { LINK } from "@/components/ui/layout";
import { SECTION, TITLE } from "@/components/ui/page";
import { NO_VALUE, Stat, StatRow } from "@/components/ui/stat";
import { Cell, Table, TableRow, type Column } from "@/components/ui/table";
import { formatCredits, formatNumber, timeAgo } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { viewOf, type ViewState } from "@/lib/queryState";
import type { OperatorOrganisation } from "@/store/types";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useGetOperatorOrganisationsQuery, useGetOperatorTopUpRequestsQuery } from "@/store/api";
import { STANDING } from "./operatorModel";

/**
 * Home for a FrostAura operator with no organisation of their own (ORG-17): what God mode is for, the way
 * in, the state of every organisation at a glance — and, under it, the organisations themselves and the
 * requests waiting, so the page is an answer rather than one card above an empty screen. Calm and white:
 * the band above the header is the one place God mode is red.
 */
export function OperatorHome() {
  // Figures it could not read stay "—": an unknown is never shown as a zero.
  const orgs = useGetOperatorOrganisationsQuery(undefined);
  const reqs = useGetOperatorTopUpRequestsQuery(undefined);
  const list = orgs.data ?? null;
  const requests = reqs.data ?? null;
  const waiting = requests ? requests.filter((r) => r.status === "open") : null;
  const figure = (n: number | null | undefined) => (n === null || n === undefined ? NO_VALUE : formatNumber(n));
  return (
    <>
      <section aria-label="God mode" className={cn("grid grid-cols-1 items-center gap-x-12 gap-y-8 rounded-lg border bg-surface px-6 py-8 shadow-card sm:px-10 xl:grid-cols-2", RISE)}>
        <div className="flex min-w-0 flex-col items-start gap-4">
          <span className="text-sm font-semibold text-ink-muted">God mode</span>
          <h1 className={cn(TITLE, "max-w-prose")}>You run Endgame for FrostAura. Every organisation is one step away.</h1>
          <p className="max-w-prose text-ink-body">List them, set one up for an invited Owner, top one up or enter it. Each entry is written where that organisation&rsquo;s Owner can read it.</p>
          <Link href={paths.operator()} className={buttonVariants({ size: "lg" })}>
            Every organisation
          </Link>
        </div>
        <StatRow cols={3} label="Every organisation at a glance">
          <Stat label="Organisations" value={figure(list?.length)} />
          <Stat label="Top-ups asked for" value={figure(waiting?.length)} caption={waiting && waiting.length > 0 ? "Waiting for your answer" : undefined} />
          <Stat label="Below zero" value={figure(list ? list.filter((o) => o.balance < 0).length : null)} />
        </StatRow>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-main-side">
        <section aria-labelledby="home-orgs-title" className={cn("flex min-w-0 flex-col gap-3", RISE, stagger(1))}>
          <h2 id="home-orgs-title" className={SECTION}>
            The organisations
          </h2>
          <OrganisationsTable view={viewOf(orgs)} onRetry={() => void orgs.refetch()} />
        </section>
        <section aria-labelledby="home-requests-title" className={cn("flex min-w-0 flex-col gap-3", RISE, stagger(2))}>
          <h2 id="home-requests-title" className={SECTION}>
            Waiting for your answer
          </h2>
          {reqs.isLoading ? (
            <Loading label="Loading the top-up requests">
              <Skeleton className="h-24 rounded-md" />
            </Loading>
          ) : reqs.isError && !requests ? (
            <Failed title="The top-up requests could not be loaded" reason="The list did not load." onRetry={() => void reqs.refetch()} />
          ) : waiting && waiting.length > 0 ? (
            <ul aria-label="Waiting requests" className="flex flex-col overflow-hidden rounded-md border bg-surface shadow-card">
              {waiting.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 border-b px-5 py-3.5 last:border-b-0">
                  <span className="font-semibold">
                    {r.organisationName || r.organisation} asks for {formatCredits(r.credits)}
                  </span>
                  {r.note && <span className="break-words text-sm text-ink-body">{r.note}</span>}
                  <span className="text-sm text-ink-muted">{timeAgo(r.requestedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="credits" title="No request is waiting">
              When an Owner asks for credits, it appears here and in God mode to answer.
            </Empty>
          )}
          {waiting && waiting.length > 0 && (
            <Link href={paths.operator()} className={cn(LINK, "self-start")}>
              Answer them in God mode
            </Link>
          )}
        </section>
      </div>
    </>
  );
}

const COLUMNS: Column[] = [
  { key: "name", header: "Organisation", kind: "grow" },
  { key: "standing", header: "Standing", kind: "status" },
  { key: "balance", header: "Balance", kind: "figure" },
  { key: "active", header: "Last active", kind: "date" },
];

function OrganisationsTable({ view, onRetry }: { view: ViewState<OperatorOrganisation[]>; onRetry: () => void }) {
  if (view.kind === "loading")
    return (
      <Loading label="Loading every organisation">
        <Skeleton className="h-40 rounded-md" />
      </Loading>
    );
  if (view.kind === "failed") return <Failed title="The organisations could not be loaded" reason={view.reason} status={view.status} onRetry={onRetry} />;
  if (view.data.length === 0)
    return (
      <Empty icon="organisation" title="No organisations yet">
        Set the first one up in God mode for an invited Owner.
      </Empty>
    );
  return (
    <Table label="The organisations" columns={COLUMNS} at="narrow">
      {view.data.map((o) => (
        <TableRow key={o.id} data-org={o.slug}>
          <Cell col="name" primary>
            <span className="break-words font-semibold">{o.name}</span>
          </Cell>
          <Cell col="standing">
            <Badge tone={STANDING[o.standing].tone}>{STANDING[o.standing].label}</Badge>
          </Cell>
          <Cell col="balance">
            <span className={cn("whitespace-nowrap tabular-nums", o.balance < 0 && "text-attention-text")}>{formatNumber(o.balance)}</span>
          </Cell>
          <Cell col="active">
            <span className="whitespace-nowrap text-sm text-ink-body">{o.lastActivityAt ? timeAgo(o.lastActivityAt) : "Never"}</span>
          </Cell>
        </TableRow>
      ))}
    </Table>
  );
}
