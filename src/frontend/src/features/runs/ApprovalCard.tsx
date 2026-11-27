import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/queryState";
import { useAppSelector } from "@/store";
import { useAnswerApprovalMutation } from "@/store/api";
import { answeredText, EXPIRED, type DerivedApproval } from "./runModel";
import { ClampedText } from "@/components/Fold";

/**
 * One checkpoint a run is waiting on: what will happen if it is approved, in plain words (the tool and its arguments are
 * technical detail), an optional note that goes back to the work with the answer, and what declining does.
 * Used on the run page and inline in the conversation.
 */
export function ApprovalCard({ runId, approval, compact = false }: { runId: string; approval: DerivedApproval; compact?: boolean }) {
  if (approval.answer === EXPIRED) return <ClosedApproval approval={approval} compact={compact} />;
  return <OpenApproval runId={runId} approval={approval} compact={compact} />;
}

/** An approval the work's end closed before anyone answered it (R3-2): nothing is left to decide, so nothing is offered. */
function ClosedApproval({ approval, compact }: { approval: DerivedApproval; compact: boolean }) {
  return (
    <div data-testid="approval-card" data-state="expired" className={compact ? "flex flex-col gap-2 rounded-md border bg-surface px-4 py-3" : "flex flex-col gap-2 rounded-md border bg-surface px-5 py-4"}>
      <Badge tone="neutral" className="self-start">
        No longer waiting
      </Badge>
      <p className="text-base font-medium text-ink-body">{approval.question}</p>
      <p className="text-sm text-ink-muted">{approval.note}</p>
    </div>
  );
}

function OpenApproval({ runId, approval, compact }: { runId: string; approval: DerivedApproval; compact: boolean }) {
  const technical = useAppSelector((s) => s.ui.mode) === "technical";
  const [answer, state] = useAnswerApprovalMutation();
  const [optimistic, setOptimistic] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const noteId = useId();

  const decide = async (decision: "approve" | "reject") => {
    setOptimistic(decision);
    setError(null);
    try {
      const trimmed = note.trim();
      await answer({ runId, approvalId: approval.id, decision, ...(trimmed ? { note: trimmed } : {}) }).unwrap();
    } catch (e) {
      setOptimistic(null);
      setError(describeError(e as never));
    }
  };

  return (
    <div data-testid="approval-card" className={compact ? "flex flex-col gap-2.5 rounded-md border bg-surface px-4 py-3 shadow-card" : "flex flex-col gap-3 rounded-md border bg-surface px-5 py-4 shadow-card"}>
      <Badge tone="warn" className="self-start">
        Needs you
      </Badge>
      <p className="text-base font-semibold">{approval.question}</p>
      {approval.detail && <ClampedText className="break-words text-sm text-ink-body">{approval.detail}</ClampedText>}
      {technical && approval.technical && <p className="break-words font-mono text-xs text-ink-body">{approval.technical}</p>}
      {optimistic ? (
        <p role="status" className="font-medium text-ink">
          {state.isLoading ? `${optimistic === "approve" ? "Approved." : "Declined."} Sending…` : answeredText(optimistic, approval.onDecline)}
        </p>
      ) : (
        <>
          {/* The optional note comes before the answer, so it is written before the answer is given. */}
          <div className="flex flex-col gap-1">
            <label htmlFor={noteId} className="text-sm text-ink-body">
              Add a note (optional)
            </label>
            <input
              id={noteId}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-touch rounded-xs border border-border-field bg-surface px-3"
              autoComplete="off"
            />
          </div>
          {/* On a phone the answer stays in reach above the bottom bar while the card is on screen. */}
          <div className="flex flex-wrap gap-2 max-sm:sticky max-sm:bottom-nav-safe max-sm:z-10 max-sm:-mx-4 max-sm:grid max-sm:grid-cols-2 max-sm:border-t max-sm:bg-surface max-sm:px-4 max-sm:py-2">
            <Button onClick={() => void decide("approve")}>Approve</Button>
            <Button variant="secondary" onClick={() => void decide("reject")}>
              Decline
            </Button>
          </div>
          <p className="text-sm text-ink-body">
            {approval.onDecline === "stops" ? "Declining stops this work." : "Declining skips only this step; the work goes on without it."}
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-attention-text">
          Your answer was not recorded: {error}
        </p>
      )}
    </div>
  );
}
