import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/queryState";
import { useAppSelector } from "@/store";
import { useAnswerApprovalMutation } from "@/store/api";
import { answeredText, type DerivedApproval } from "./runModel";

/**
 * One checkpoint a run is waiting on: what will happen if it is approved, in plain words (the tool and its arguments are
 * technical detail), an optional note that goes back to the work with the answer, and what declining does.
 * Used on the run page and inline in the conversation.
 */
export function ApprovalCard({ runId, approval, compact = false }: { runId: string; approval: DerivedApproval; compact?: boolean }) {
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
    <div data-testid="approval-card" className={compact ? "flex flex-col gap-2.5 rounded-md border border-attention-line bg-attention-tint px-4 py-3" : "flex flex-col gap-3 rounded-md border border-attention-line bg-attention-tint px-5 py-4"}>
      <Badge tone="white" className="self-start">
        Needs you
      </Badge>
      <p className="text-base font-semibold">{approval.question}</p>
      {technical && approval.detail && <p className="break-words font-mono text-xs text-attention-deep">{approval.detail}</p>}
      {optimistic ? (
        <p role="status" className="font-medium text-ink">
          {state.isLoading ? `${optimistic === "approve" ? "Approved." : "Declined."} Sending…` : answeredText(optimistic, approval.onDecline)}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={noteId} className="text-sm text-attention-deep">
              Add a note (optional)
            </label>
            <input
              id={noteId}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-touch rounded-xs border border-border-strong bg-surface px-3"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void decide("approve")}>Approve</Button>
            <Button variant="outline" onClick={() => void decide("reject")}>
              Decline
            </Button>
          </div>
          <p className="text-sm text-attention-deep">
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
