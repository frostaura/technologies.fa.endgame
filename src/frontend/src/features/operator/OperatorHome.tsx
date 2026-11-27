import { Link } from "@/components/Link";
import { buttonVariants } from "@/components/ui/button";
import { TITLE } from "@/components/ui/page";
import { NO_VALUE, Stat, StatRow } from "@/components/ui/stat";
import { formatNumber } from "@/lib/format";
import { RISE } from "@/lib/motion";
import { paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useGetOperatorOrganisationsQuery, useGetOperatorTopUpRequestsQuery } from "@/store/api";

/**
 * Home for a FrostAura operator with no organisation of their own (ORG-17): what God mode is for, the way
 * in, and the state of every organisation at a glance. Calm and white — the band above the header is the
 * one place God mode is red.
 */
export function OperatorHome() {
  // Figures it could not read stay "—": an unknown is never shown as a zero.
  const list = useGetOperatorOrganisationsQuery(undefined).data ?? null;
  const requests = useGetOperatorTopUpRequestsQuery(undefined).data ?? null;
  const waiting = requests ? requests.filter((r) => r.status === "open").length : null;
  const figure = (n: number | null | undefined) => (n === null || n === undefined ? NO_VALUE : formatNumber(n));
  return (
    <section aria-label="God mode" className={cn("grid grid-cols-1 items-center gap-x-12 gap-y-8 rounded-lg border bg-surface px-6 py-8 shadow-card sm:px-10 xl:grid-cols-2", RISE)}>
      <div className="flex min-w-0 flex-col items-start gap-4">
        <span className="text-eyebrow font-semibold uppercase tracking-wide text-ink-muted">God mode</span>
        <h1 className={cn(TITLE, "max-w-prose")}>You run Endgame for FrostAura. Every organisation is one step away.</h1>
        <p className="max-w-prose text-ink-body">List them, set one up for an invited Owner, top one up or enter it. Each entry is written where that organisation&rsquo;s Owner can read it.</p>
        <Link href={paths.operator()} className={buttonVariants({ size: "lg" })}>
          Every organisation
        </Link>
      </div>
      <StatRow cols={3} label="Every organisation at a glance">
        <Stat label="Organisations" value={figure(list?.length)} />
        <Stat label="Top-ups asked for" value={figure(waiting)} caption={waiting ? "Waiting for your answer" : undefined} />
        <Stat label="Below zero" value={figure(list ? list.filter((o) => o.balance < 0).length : null)} />
      </StatRow>
    </section>
  );
}
