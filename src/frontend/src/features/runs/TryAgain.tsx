import { useState } from "react";
import { Link } from "@/components/Link";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatCredits } from "@/lib/format";
import { describeError } from "@/lib/queryState";
import { navigate, paths } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useEstimateRetryMutation, useRetryRunMutation } from "@/store/api";
import type { RetryEstimate } from "@/store/types";
import { keptText, STOPPED, type StopReason } from "./retryModel";

/**
 * Starting stopped work again (CHG-03, VERD-12, RUN-10): the estimate first (CLAUDE.md rule 11), with what is kept, then the new
 * attempt, which carries on from where this one stopped. The person lands on the new attempt's page.
 */
export function TryAgain({ runId, why, ideaId = null, showCredits = false }: { runId: string; why: StopReason; ideaId?: string | null; showCredits?: boolean }) {
  const [estimateRetry, estimating] = useEstimateRetryMutation();
  const [retry, starting] = useRetryRunMutation();
  const [estimate, setEstimate] = useState<RetryEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const price = async () => {
    setError(null);
    try {
      setEstimate(await estimateRetry(runId).unwrap());
    } catch (e) {
      setError(`No estimate could be made: ${describeError(e as never)} Nothing was started.`);
    }
  };

  const start = async () => {
    setError(null);
    try {
      const again = await retry({ runId, ideaId }).unwrap();
      navigate(paths.run(again.id));
    } catch (e) {
      setError(`It was not started again: ${describeError(e as never)}`);
    }
  };

  return (
    <section aria-label="Try again" data-testid="try-again" className="flex flex-col gap-3 rounded-md border border-attention-line bg-attention-tint px-5 py-4">
      <p className="font-medium text-ink">{STOPPED[why]}</p>
      {estimate ? (
        <>
          <p className="text-ink-body">{keptText(estimate)}</p>
          <p className="font-display text-xl font-semibold">Estimated {formatCredits(estimate.credits)}</p>
          <p className="text-sm text-ink-body">{estimate.basis}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void start()} disabled={starting.isLoading}>
              {starting.isLoading ? "Starting…" : "Start it again"}
            </Button>
            <Button variant="ghost" onClick={() => setEstimate(null)}>
              Not now
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void price()} disabled={estimating.isLoading}>
            {estimating.isLoading ? "Working it out…" : "Try again"}
          </Button>
          <span className="text-sm text-ink-body">It picks up where this stopped; you see what it costs first.</span>
          {showCredits && (
            <Link href={paths.credits()} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              See credits
            </Link>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-attention-text">
          {error}
        </p>
      )}
    </section>
  );
}
