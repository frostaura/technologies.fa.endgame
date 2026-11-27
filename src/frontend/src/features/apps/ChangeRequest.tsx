import { useId, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/states";
import { SECTION } from "@/components/ui/page";
import { Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmCard } from "@/components/ui/confirm";
import { formatCredits } from "@/lib/format";
import { describeError } from "@/lib/queryState";
import { navigate, paths } from "@/lib/router";
import { useEstimateChangeMutation, useRequestChangeMutation } from "@/store/api";
import type { ChangeEstimate } from "@/store/types";

/**
 * Asking for a change to an app that is already built (CHG-01): the person describes it in their own words, sees what it is
 * expected to cost first (CLAUDE.md rule 11), then starts it and follows it on its own page. The factory screens it against the
 * red lines, plans it from those words, builds and checks each part in a private preview, checks that everything the app did
 * before still works, reviews it and publishes the new version.
 */
export function ChangeRequest({ appId, appName }: { appId: string; appName: string }) {
  const [request, setRequest] = useState("");
  const [estimate, setEstimate] = useState<ChangeEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimateChange, estimating] = useEstimateChangeMutation();
  const [requestChange, starting] = useRequestChangeMutation();
  const fieldId = useId();
  const text = request.trim();

  const price = async (event: FormEvent) => {
    event.preventDefault();
    if (!text) return;
    setError(null);
    try {
      setEstimate(await estimateChange({ appId, request: text }).unwrap());
    } catch (e) {
      setError(`No estimate could be made: ${describeError(e as never)} Nothing was started.`);
    }
  };

  const start = async () => {
    setError(null);
    try {
      const run = await requestChange({ appId, request: text }).unwrap();
      navigate(paths.run(run.id));
    } catch (e) {
      setError(`The change was not started: ${describeError(e as never)}`);
    }
  };

  return (
    <section aria-labelledby={`${fieldId}-title`} data-testid="change-request" className="flex h-full flex-col gap-3 rounded-md border bg-surface p-5 shadow-card sm:p-6">
      <h2 id={`${fieldId}-title`} className={cn(SECTION, "flex items-center gap-2")}>
        <Icon name="build" tinted />
        Change {appName}
      </h2>
      <p className="max-w-prose text-ink-body">
        Describe the change in your own words. It is checked against FrostAura’s red lines, planned from your words, built and checked part by part in a private preview, and
        everything {appName} does now is checked again before the new version is published. Who may open it does not change.
      </p>
      <form onSubmit={(e) => void price(e)} className="mt-auto flex flex-col gap-2">
        <label htmlFor={fieldId} className="font-medium">
          What should change?
        </label>
        <Textarea
          id={fieldId}
          value={request}
          rows={4}
          maxLength={20000}
          onChange={(e) => {
            setRequest(e.target.value);
            setEstimate(null);
          }}
          className="resize-y"
        />
        {estimate ? (
          // The estimate before the change starts (rule 11), as the house's one confirmation.
          <ConfirmCard
            destructive={false}
            label="Confirm making this change"
            question={`Estimated ${formatCredits(estimate.credits)}`}
            detail={estimate.basis}
            confirm={starting.isLoading ? "Starting…" : "Make this change"}
            cancel="Not now"
            busy={starting.isLoading}
            onConfirm={() => void start()}
            onCancel={() => setEstimate(null)}
          />
        ) : (
          <Button type="submit" variant="secondary" className="self-start" disabled={!text || estimating.isLoading}>
            {estimating.isLoading ? (
              <>
                <Spinner inherit />
                Working it out…
              </>
            ) : "See what it costs"}
          </Button>
        )}
      </form>
      {error && (
        <p role="alert" className="rounded-xs bg-attention-tint px-4 py-3 text-attention-text">
          {error}
        </p>
      )}
    </section>
  );
}
