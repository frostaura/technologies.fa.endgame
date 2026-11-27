import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Failed, Loading, Skeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, SECTION } from "@/components/ui/page";
import { Stat, StatRow } from "@/components/ui/stat";
import { formatNumber, formatTime } from "@/lib/format";
import { RISE, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store";
import { useGetSystemStatusQuery, type SystemStatus } from "@/store/api";
import { modeSet } from "@/store/uiSlice";
import { AppShell } from "../shell/AppShell";
import { SystemStatusView } from "./SystemStatusView";
import { POLL_INTERVAL_MS, toViewState } from "./statusModel";

/**
 * The System page. Technical mode lists every service by name; normal mode never names infrastructure (CLAUDE.md
 * rule 12), so it says in plain words whether Endgame is working, how much of it answered and when it was asked —
 * a page with an answer on it rather than a heading over an empty screen (console-desktop 49).
 */
export function SystemRoute() {
  const mode = useAppSelector((s) => s.ui.mode);
  return (
    <AppShell crumbs={[{ label: "System" }]} aside={mode === "technical" ? undefined : <TechnicalAside />}>
      {mode === "technical" ? <SystemStatusView /> : <PlainStatus />}
    </AppShell>
  );
}

function PlainStatus() {
  const query = useGetSystemStatusQuery(undefined, { pollingInterval: POLL_INTERVAL_MS, skipPollingIfUnfocused: true });
  const view = toViewState(query);
  return (
    <>
      <PageHeader className={RISE} icon="health" title="Is Endgame working?" lead="Every part Endgame runs on is asked directly, every ten seconds, whether it is working." />
      {view.kind === "loading" && (
        <Loading label="Checking whether Endgame is working" className="flex flex-col gap-4">
          <Skeleton className="h-48 rounded-lg" />
        </Loading>
      )}
      {view.kind === "failed" && <Failed title="Endgame could not be asked how it is" reason="The check did not get an answer, so nothing is known about the rest until it does." status={view.status} onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && <PlainAnswer status={view.status} stale={view.stale !== null} />}
    </>
  );
}

/** What a person can expect while part of Endgame is not answering. */
const WHILE_DOWN = ["Work under way waits, and carries on when it is back.", "An app that relies on the missing part may be slow to wake.", "Nothing is lost: data, code and memory are kept."];

function PlainAnswer({ status, stale }: { status: SystemStatus; stale: boolean }) {
  const total = status.services.length;
  const answering = status.services.filter((s) => s.state === "healthy").length;
  const working = status.overall === "healthy" && total > 0 && answering === total;
  return (
    <>
      <section aria-label="Whether Endgame is working" data-state={working ? "healthy" : "unhealthy"} className={cn("flex flex-col gap-6 rounded-lg border bg-surface px-6 py-7 shadow-card max-sm:px-5 max-sm:py-5 sm:px-8", RISE, stagger(1))}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {working ? <CheckCircle2 aria-hidden className="size-7 shrink-0 text-success" /> : <AlertTriangle aria-hidden className="size-7 shrink-0 text-attention-text" />}
          <h2 className="font-display text-2xl font-semibold tracking-tight">{working ? "Everything is working" : total === 0 ? "Endgame could not list its parts" : "Part of Endgame is not answering"}</h2>
          <Badge tone={working ? "good" : "bad"}>{working ? "Healthy" : "Needs attention"}</Badge>
        </div>
        <p className="max-w-prose text-ink-body">
          {working
            ? "Every part answered the last check. Work, apps and the conversation run as usual."
            : total === 0
              ? "The check answered but named nothing it runs on. That is a fault, not a quiet system: FrostAura is told."
              : "FrostAura is told when a part stops answering. Until it is back, some work may wait."}
          {stale ? " The latest check failed, so this is the last answer that came." : ""}
        </p>
        <StatRow cols={3} className="max-sm:grid-cols-1">
          <Stat plain label="Parts answering" value={`${formatNumber(answering)} of ${formatNumber(total)}`} />
          <Stat plain label="Not answering" value={formatNumber(total - answering)} tone={working ? "ink" : "bad"} />
          <Stat plain label="Last checked" value={formatTime(status.checkedAt)} />
        </StatRow>
      </section>
      {!working && total > 0 && (
        <section aria-labelledby="while-down-title" className={cn("flex flex-col gap-2.5", RISE, stagger(2))}>
          <h2 id="while-down-title" className={SECTION}>
            While it is not answering
          </h2>
          <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5 text-ink-body">
            {WHILE_DOWN.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function TechnicalAside() {
  const dispatch = useAppDispatch();
  return (
    <section aria-labelledby="system-detail-title" className={cn("flex flex-col gap-2.5", RISE)}>
      <h2 id="system-detail-title" className="text-base font-semibold">
        Which part, and why
      </h2>
      <p className="text-ink-body">Technical mode names each part Endgame runs on, how fast it answered and what it said.</p>
      <Button variant="secondary" className="self-start" onClick={() => dispatch(modeSet("technical"))}>
        Switch to technical mode
      </Button>
    </section>
  );
}
