import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Failed } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGetSystemStatusQuery, type ServiceHealth, type SystemStatus } from "@/store/api";
import { POLL_INTERVAL_MS, formatCheckedAt, formatLatency, toViewState } from "./statusModel";

export function SystemStatusView() {
  const query = useGetSystemStatusQuery(undefined, { pollingInterval: POLL_INTERVAL_MS, skipPollingIfUnfocused: true });
  const view = toViewState(query);

  return (
    <section aria-labelledby="system-status-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="system-status-title" className="text-2xl font-semibold sm:text-3xl">
            System status
          </h1>
          <p className="text-sm text-ink-muted">Every service, asked directly whether it is healthy.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw aria-hidden className={cn("size-4", query.isFetching && "animate-spin motion-reduce:animate-none")} />
          Check again
        </Button>
      </div>

      {view.kind === "loading" && <LoadingState />}
      {view.kind === "failed" && <Failed title="System status could not be loaded" reason={view.reason} status={view.status} unknown="Nothing below is known until a check succeeds." onRetry={() => void query.refetch()} />}
      {view.kind === "loaded" && <LoadedState status={view.status} stale={view.stale} />}
    </section>
  );
}

function LoadingState() {
  return (
    <Card role="status" aria-busy="true" aria-live="polite" data-state="loading">
      <CardContent className="flex items-center gap-3 pt-5 text-sm text-ink-muted">
        <Loader2 aria-hidden className="size-5 animate-spin text-primary motion-reduce:animate-none" />
        Checking every service…
      </CardContent>
    </Card>
  );
}

function LoadedState({ status, stale }: { status: SystemStatus; stale: { reason: string } | null }) {
  const unhealthy = status.services.filter((s) => s.state !== "healthy");
  const allHealthy = status.overall === "healthy" && status.services.length > 0;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <Card
        data-state={allHealthy ? "healthy" : "unhealthy"}
        className={cn("lg:sticky lg:top-6 lg:w-aside lg:shrink-0", allHealthy ? "bg-success-tint" : "bg-attention-tint")}
      >
        <CardHeader>
          <div className="flex items-center gap-2">
            {allHealthy ? (
              <CheckCircle2 aria-hidden className="size-6 text-success" />
            ) : (
              <AlertTriangle aria-hidden className="size-6 text-attention-text" />
            )}
            <CardTitle className={cn("text-lg", allHealthy ? "text-success-text" : "text-attention-text")}>
              {allHealthy ? "All services healthy" : summariseUnhealthy(unhealthy.length, status.services.length)}
            </CardTitle>
          </div>
          <p className="text-sm text-ink-muted">Checked at {formatCheckedAt(status.checkedAt)}</p>
        </CardHeader>
        {stale && (
          <CardContent>
            <p role="alert" data-state="stale" className="rounded-sm bg-surface p-3 text-sm text-attention-text">
              The latest check failed: {stale.reason} These results are from the last one that succeeded.
            </p>
          </CardContent>
        )}
      </Card>

      {status.services.length === 0 ? (
        <Card role="alert" className="flex-1">
          <CardContent className="pt-5 text-sm text-attention-text">
            The control plane answered, but reported no services. That is a fault, not a quiet system.
          </CardContent>
        </Card>
      ) : (
        <ul aria-label="Services" className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {status.services.map((service) => (
            <li key={service.key}>
              <ServiceCard service={service} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function summariseUnhealthy(count: number, total: number): string {
  if (total === 0) return "No services reported";
  return count === 1 ? `1 of ${total} services unhealthy` : `${count} of ${total} services unhealthy`;
}

function ServiceCard({ service }: { service: ServiceHealth }) {
  const healthy = service.state === "healthy";
  return (
    <Card data-service={service.key} data-state={service.state} className="h-full">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{service.name}</CardTitle>
          <p className="font-mono text-xs text-ink-muted">{formatLatency(service.latencyMs)}</p>
        </div>
        <Badge tone={healthy ? "good" : "bad"}>
          <span aria-hidden className={cn("size-2 rounded-full", healthy ? "bg-success" : "bg-attention-text")} />
          {healthy ? "Healthy" : "Unhealthy"}
        </Badge>
      </CardHeader>
      {service.detail && (
        <CardContent>
          <p className={cn("break-words text-sm", healthy ? "text-ink-muted" : "text-attention-text")}>{service.detail}</p>
        </CardContent>
      )}
    </Card>
  );
}
